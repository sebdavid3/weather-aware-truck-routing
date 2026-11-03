"""Open-Meteo forecasts for grid cells: caching, batching and the ETA sampling rule.

docs/api-usage.md explains the quota strategy (cells, cache, batches, errors)
and docs/weather-risk-decisions.md which variables and hours a checkpoint uses.
"""

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable, Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import NamedTuple

import httpx
from django.core.cache import BaseCache
from django.core.cache import cache as default_cache

from planner.risk import Conditions
from planner.upstream import UpstreamFailed, get_with_retry

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
CELLS_PER_DEGREE = 20  # 0.05° cells, about 5.5 km on a side.
MAX_CELLS_PER_REQUEST = 300  # Keeps the GET URL well under common length limits.
PARALLEL_REQUESTS = 2
# Open-Meteo allows 600 locations a minute per IP; requests are paced to stay under this.
MINUTE_BUDGET = 550
WINDOW_S = 60.0
SECONDS_PER_REQUEST = 2.0  # Rough time for one batch to come back, for wait estimates.
CACHE_TTL_S = 3600  # The models update about hourly.
REQUEST_TIMEOUT_S = 10.0
RETRY_DELAY_S = 1.0
HOUR_S = 3600
DAY_S = 24 * HOUR_S

# Open-Meteo's reason text for each 429, the limit it names and when to retry.
RATE_LIMITS = (
    ("Minutely", "minute", 60),
    ("Hourly", "hour", HOUR_S),
    ("Daily", "day", DAY_S),
)


class WeatherError(Exception):
    """The forecast can't be used for this request."""


class WeatherUnavailable(WeatherError):
    """Open-Meteo failed, rejected the request or returned incomplete data."""


class WeatherRateLimited(WeatherError):
    """Open-Meteo refused the request because a usage limit was reached."""

    def __init__(self, limit: str, retry_after_s: int):
        super().__init__(f"Open-Meteo {limit} limit reached; retry in {retry_after_s} s")
        self.limit = limit
        self.retry_after_s = retry_after_s


@dataclass(frozen=True, order=True)
class Cell:
    """A 0.05° square of the forecast grid, identified by integer indices.

    Points in the same cell share one forecast, so routes that overlap and
    searches that cross the same area reuse the same API calls and cache.
    """

    lat_index: int
    lon_index: int

    @classmethod
    def containing(cls, lat: float, lon: float) -> "Cell":
        return cls(round(lat * CELLS_PER_DEGREE), round(lon * CELLS_PER_DEGREE))

    @property
    def lat(self) -> float:
        return self.lat_index / CELLS_PER_DEGREE

    @property
    def lon(self) -> float:
        return self.lon_index / CELLS_PER_DEGREE


class HourValues(NamedTuple):
    """Open-Meteo's values for one cell, stamped at one UTC hour."""

    wind_mph: float | None
    gust_mph: float | None
    rain_in: float | None
    showers_in: float | None
    snowfall_in: float | None


# Request order; must match HourValues' fields.
VARIABLES = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall")

# One UTC day of a cell's forecast: 24 hours, None where an hour is missing.
DayBlock = list[HourValues | None]


@dataclass(frozen=True)
class Sample:
    """What a checkpoint gets: the conditions to classify, plus gusts to show."""

    conditions: Conditions
    gust_mph: float


def hour_window(at: datetime) -> tuple[int, int]:
    """Unix timestamps of the UTC hours that start and end the hour containing `at`."""
    if at.tzinfo is None:
        raise ValueError("Times must be timezone-aware")
    start = int(at.timestamp()) // HOUR_S * HOUR_S
    return start, start + HOUR_S


class Forecast:
    """Hourly values for a set of cells, keyed by the unix hour they're stamped with."""

    def __init__(self, hours: Mapping[Cell, Mapping[int, HourValues | None]]):
        self._hours = hours

    def sample(self, cell: Cell, at: datetime) -> Sample:
        """Conditions in `cell` at time `at`.

        Rain, showers, snowfall and gusts are totals or maxima over the
        preceding hour, so they come from the value stamped at the end of the
        hour containing `at`. Wind speed is instantaneous, so it's interpolated
        between the start and end of that hour, then rounded like the API.
        """
        start, end = hour_window(at)
        first = self._values(cell, start)
        last = self._values(cell, end)
        fraction = (at.timestamp() - start) / HOUR_S
        wind = first.wind_mph + (last.wind_mph - first.wind_mph) * fraction
        return Sample(
            conditions=Conditions(
                wind_mph=round(wind, 1),
                rain_in_per_hr=round(last.rain_in + last.showers_in, 3),
                snow_in_per_hr=last.snowfall_in,
            ),
            gust_mph=last.gust_mph,
        )

    def _values(self, cell: Cell, hour: int) -> HourValues:
        values = self._hours.get(cell, {}).get(hour)
        if values is None or None in values:
            stamp = datetime.fromtimestamp(hour, UTC)
            raise WeatherUnavailable(f"No forecast for {cell} at {stamp:%Y-%m-%d %H:%M} UTC")
        return values


class MinuteBudget:
    """Locations requested from Open-Meteo in the last minute, shared by every request.

    A trip that needs more than a minute's budget waits for it to free up instead of
    failing: the server runs one process, so this sees all of its own traffic.
    """

    def __init__(
        self,
        limit: int = MINUTE_BUDGET,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._limit = limit
        self._clock = clock
        self._sleep = sleep
        self._spent: deque[tuple[float, int]] = deque()
        self._lock = threading.Lock()

    def take(self, most: int) -> int:
        """Grant up to `most` locations, waiting until at least a useful batch fits.

        Batches shrink to what the minute has left, so a long trip uses each minute fully
        instead of waiting for room for a whole batch.
        """
        while True:
            with self._lock:
                now = self._clock()
                granted, wait = _grant(self._spent, now, most, self._limit)
                if granted:
                    self._spent.append((now, granted))
                    return granted
            self._sleep(wait)

    def estimate(self, count: int, batch: int = MAX_CELLS_PER_REQUEST) -> float:
        """Seconds until `count` locations, fetched in batches, would all have been requested."""
        with self._lock:
            now = self._clock()
            spent = deque(self._spent)
        at = now
        while count > 0:
            granted, wait = _grant(spent, at, min(count, batch), self._limit)
            if granted:
                spent.append((at, granted))
                count -= granted
            else:
                at += wait
        return at - now


# Smallest batch worth sending while waiting for more of the minute to free up.
MIN_BATCH = 50


def _grant(spent: deque[tuple[float, int]], now: float, most: int, limit: int) -> tuple[int, float]:
    """How many of `most` locations fit now, or how long until a useful batch does."""
    while spent and spent[0][0] <= now - WINDOW_S:
        spent.popleft()
    room = limit - sum(size for _, size in spent)
    if room >= min(most, MIN_BATCH):
        return min(most, room), 0.0
    return 0, spent[0][0] + WINDOW_S - now if spent else 0.0


class OpenMeteoClient:
    def __init__(
        self,
        http: httpx.Client | None = None,
        cache: BaseCache = default_cache,
        retry_delay_s: float = RETRY_DELAY_S,
        budget: MinuteBudget | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._http = http or httpx.Client(timeout=REQUEST_TIMEOUT_S)
        self._cache = cache
        self._retry_delay_s = retry_delay_s
        self._budget = budget or MinuteBudget(sleep=sleep)
        self._sleep = sleep

    def forecast(self, points: Iterable[tuple[Cell, datetime]]) -> Forecast:
        """Get what's needed to sample each (cell, time) point, from the cache first."""
        blocks, missing = self._lookup(points)
        if missing:
            blocks.update(self._fetch(missing))
        return Forecast(_hours_from_blocks(blocks))

    def pending(self, points: Iterable[tuple[Cell, datetime]]) -> tuple[int, float]:
        """How many cells a forecast for these points would fetch, and about how long it takes."""
        _, missing = self._lookup(points)
        cells = len({cell for cell, _ in missing})
        if not cells:
            return 0, 0.0
        batches = (cells + MAX_CELLS_PER_REQUEST - 1) // MAX_CELLS_PER_REQUEST
        return cells, self._budget.estimate(cells) + batches * SECONDS_PER_REQUEST

    def _lookup(
        self, points: Iterable[tuple[Cell, datetime]]
    ) -> tuple[dict[tuple[Cell, date], DayBlock], list[tuple[Cell, date]]]:
        days_by_cell: dict[Cell, set[date]] = defaultdict(set)
        for cell, at in points:
            start, end = hour_window(at)
            days_by_cell[cell].update({_utc_date(start), _utc_date(end)})

        keys = {
            (cell, day): _cache_key(cell, day)
            for cell, days in days_by_cell.items()
            for day in days
        }
        cached = self._cache.get_many(keys.values())
        blocks = {pair: cached[key] for pair, key in keys.items() if key in cached}
        return blocks, [pair for pair in keys if pair not in blocks]

    def _fetch(self, missing: list[tuple[Cell, date]]) -> dict[tuple[Cell, date], DayBlock]:
        # Open-Meteo applies one date range to every coordinate in a request,
        # so cells that miss the same days share requests.
        days_by_cell: dict[Cell, set[date]] = defaultdict(set)
        for cell, day in missing:
            days_by_cell[cell].add(day)
        cells_by_range: dict[tuple[date, date], list[Cell]] = defaultdict(list)
        for cell, days in days_by_cell.items():
            cells_by_range[(min(days), max(days))].append(cell)
        blocks: dict[tuple[Cell, date], DayBlock] = {}
        error: WeatherError | None = None
        with ThreadPoolExecutor(max_workers=PARALLEL_REQUESTS) as pool:
            futures = []
            for (first, last), cells in cells_by_range.items():
                while cells:
                    # Waits here when the minute's budget is spent; batches take what is left.
                    size = self._budget.take(min(len(cells), MAX_CELLS_PER_REQUEST))
                    batch, cells = cells[:size], cells[size:]
                    futures.append(pool.submit(self._request_paced, batch, first, last))
            for future in as_completed(futures):
                try:
                    fetched = future.result()
                except WeatherError as exc:
                    error = error or exc
                    continue
                # Cache each response as it lands, so a retry after a failure reuses it.
                self._cache.set_many(
                    {_cache_key(cell, day): block for (cell, day), block in fetched.items()},
                    CACHE_TTL_S,
                )
                blocks.update(fetched)
        if error:
            raise error
        return blocks

    def _request_paced(
        self, cells: list[Cell], first: date, last: date
    ) -> dict[tuple[Cell, date], DayBlock]:
        """A batch, waited out once when Open-Meteo still says the minute's limit is reached.

        That happens when other traffic from the same IP used part of the minute. The hourly
        and daily limits fail at once: waiting them out would leave the request hanging.
        """
        try:
            return self._request(cells, first, last)
        except WeatherRateLimited as exc:
            if exc.limit != "minute":
                raise
            self._sleep(exc.retry_after_s)
            return self._request(cells, first, last)

    def _request(
        self, cells: list[Cell], first: date, last: date
    ) -> dict[tuple[Cell, date], DayBlock]:
        response = self._get(
            {
                "latitude": ",".join(f"{cell.lat:.2f}" for cell in cells),
                "longitude": ",".join(f"{cell.lon:.2f}" for cell in cells),
                "hourly": ",".join(VARIABLES),
                "wind_speed_unit": "mph",
                "precipitation_unit": "inch",
                "timeformat": "unixtime",
                "start_date": first.isoformat(),
                "end_date": last.isoformat(),
            }
        )
        try:
            payload = response.json()
            # A single coordinate comes back as an object, several as a list.
            locations = payload if isinstance(payload, list) else [payload]
            if len(locations) != len(cells):
                raise WeatherUnavailable(
                    f"Open-Meteo returned {len(locations)} locations for {len(cells)} cells"
                )
            blocks: dict[tuple[Cell, date], DayBlock] = {}
            for cell, location in zip(cells, locations, strict=True):
                blocks.update(_day_blocks(cell, location["hourly"]))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise WeatherUnavailable(f"Unexpected Open-Meteo response: {exc!r}") from exc
        return blocks

    def _get(self, params: dict[str, str]) -> httpx.Response:
        try:
            response = get_with_retry(
                self._http,
                OPEN_METEO_URL,
                params,
                service="Open-Meteo",
                retry_delay_s=self._retry_delay_s,
            )
        except UpstreamFailed as exc:
            raise WeatherUnavailable(str(exc)) from exc
        if response.status_code == 429:
            raise _rate_limited(response)
        if not response.is_success:
            raise WeatherUnavailable(f"Open-Meteo rejected the request: {_reason(response)}")
        return response


def _day_blocks(cell: Cell, hourly: dict) -> dict[tuple[Cell, date], DayBlock]:
    blocks: dict[tuple[Cell, date], DayBlock] = {}
    columns = [hourly[name] for name in VARIABLES]
    for index, stamp in enumerate(hourly["time"]):
        block = blocks.setdefault((cell, _utc_date(stamp)), [None] * 24)
        block[stamp % DAY_S // HOUR_S] = HourValues(*(column[index] for column in columns))
    return blocks


def _hours_from_blocks(
    blocks: Mapping[tuple[Cell, date], DayBlock],
) -> dict[Cell, dict[int, HourValues | None]]:
    hours: dict[Cell, dict[int, HourValues | None]] = defaultdict(dict)
    for (cell, day), block in blocks.items():
        day_start = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp())
        for hour, values in enumerate(block):
            hours[cell][day_start + hour * HOUR_S] = values
    return hours


def _cache_key(cell: Cell, day: date) -> str:
    return f"weather:v1:{cell.lat_index}:{cell.lon_index}:{day.isoformat()}"


def _utc_date(stamp: int) -> date:
    return datetime.fromtimestamp(stamp, UTC).date()


def _reason(response: httpx.Response) -> str:
    try:
        return str(response.json()["reason"])
    except (ValueError, KeyError, TypeError):
        return response.text[:200]


def _rate_limited(response: httpx.Response) -> WeatherRateLimited:
    reason = _reason(response)
    for word, limit, retry_after_s in RATE_LIMITS:
        if word in reason:
            return WeatherRateLimited(limit, retry_after_s)
    return WeatherRateLimited("minute", 60)

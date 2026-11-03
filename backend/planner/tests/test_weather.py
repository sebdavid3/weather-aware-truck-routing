"""Weather client tests against a fake Open-Meteo; they never touch the network."""

import json
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from django.core.cache.backends.locmem import LocMemCache

from planner.risk import RiskLevel, assess
from planner.weather import (
    DAY_S,
    HOUR_S,
    VARIABLES,
    Cell,
    HourValues,
    MinuteBudget,
    OpenMeteoClient,
    WeatherRateLimited,
    WeatherUnavailable,
)

FIXTURES = Path(__file__).parent / "fixtures"
CALM = HourValues(wind_mph=5.0, gust_mph=8.0, rain_in=0.0, showers_in=0.0, snowfall_in=0.0)
DALLAS = Cell.containing(32.7767, -96.7970)


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def unix(text: str) -> int:
    return int(utc(text).timestamp())


def day_start(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp())


class FakeOpenMeteo:
    """Answers like Open-Meteo, with values from `values(cell, unix_hour)`.

    Queued `failures` (responses or exceptions) are served first, in order.
    """

    def __init__(self, values: Callable[[Cell, int], HourValues] = lambda cell, hour: CALM):
        self.values = values
        self.requests: list[httpx.Request] = []
        self.failures: list[httpx.Response | Exception] = []
        self._lock = threading.Lock()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        with self._lock:
            self.requests.append(request)
            failure = self.failures.pop(0) if self.failures else None
        if isinstance(failure, Exception):
            raise failure
        if failure is not None:
            return failure
        return self.answer(request)

    def answer(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        coordinates = zip(
            params["latitude"].split(","), params["longitude"].split(","), strict=True
        )
        first = date.fromisoformat(params["start_date"])
        last = date.fromisoformat(params["end_date"])
        hours = list(range(day_start(first), day_start(last) + DAY_S, HOUR_S))
        locations = []
        for lat, lon in coordinates:
            cell = Cell.containing(float(lat), float(lon))
            rows = [self.values(cell, hour) for hour in hours]
            hourly = {name: [row[i] for row in rows] for i, name in enumerate(VARIABLES)}
            hourly["time"] = hours
            locations.append({"latitude": float(lat), "longitude": float(lon), "hourly": hourly})
        # Like the real API: one coordinate comes back as an object, several as a list.
        return httpx.Response(200, json=locations if len(locations) > 1 else locations[0])

    def coordinate_counts(self) -> list[int]:
        return sorted(len(r.url.params["latitude"].split(",")) for r in self.requests)


class FakeClock:
    """Time that only moves when the code under test sleeps."""

    def __init__(self):
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def make_client(
    fake: FakeOpenMeteo, clock: FakeClock | None = None, limit: int = 550
) -> OpenMeteoClient:
    clock = clock or FakeClock()
    return OpenMeteoClient(
        http=httpx.Client(transport=httpx.MockTransport(fake)),
        cache=LocMemCache(f"weather-test-{uuid.uuid4()}", {}),
        retry_delay_s=0,
        budget=MinuteBudget(limit=limit, clock=clock, sleep=clock.sleep),
        sleep=clock.sleep,
    )


# Cells


def test_cell_snaps_to_the_005_degree_grid():
    cell = Cell.containing(32.8118, -96.8033)

    assert cell == Cell(656, -1936)
    assert (cell.lat, cell.lon) == (32.8, -96.8)


def test_points_a_kilometer_apart_can_share_a_cell():
    assert Cell.containing(32.800, -96.800) == Cell.containing(32.809, -96.795)


# Sampling at an ETA


def test_sample_uses_the_hour_containing_the_eta():
    ten, eleven = unix("2026-10-31T10:00"), unix("2026-10-31T11:00")

    def values(cell: Cell, hour: int) -> HourValues:
        if hour == ten:
            # Rain stamped 10:00 fell from 9:00 to 10:00, before the truck arrives.
            return HourValues(30.0, 40.0, 0.9, 0.0, 0.0)
        if hour == eleven:
            return HourValues(36.0, 50.0, 0.252, 0.248, 0.1)
        return CALM

    client = make_client(FakeOpenMeteo(values))
    eta = utc("2026-10-31T10:20")

    sample = client.forecast([(DALLAS, eta)]).sample(DALLAS, eta)

    assert sample.conditions.wind_mph == 32.0  # A third of the way from 30.0 to 36.0.
    assert sample.conditions.rain_in_per_hr == 0.5  # rain + showers stamped 11:00.
    assert sample.conditions.snow_in_per_hr == 0.1
    assert sample.gust_mph == 50.0
    assert assess(sample.conditions, load_lb=20_000).level == RiskLevel.SEVERE


def test_sample_on_the_hour_takes_that_hours_wind_and_the_next_hours_rain():
    ten, eleven = unix("2026-10-31T10:00"), unix("2026-10-31T11:00")

    def values(cell: Cell, hour: int) -> HourValues:
        if hour == ten:
            return HourValues(30.0, 40.0, 0.9, 0.0, 0.0)
        if hour == eleven:
            return HourValues(36.0, 50.0, 0.2, 0.0, 0.0)
        return CALM

    client = make_client(FakeOpenMeteo(values))
    eta = utc("2026-10-31T10:00")

    sample = client.forecast([(DALLAS, eta)]).sample(DALLAS, eta)

    assert sample.conditions.wind_mph == 30.0
    assert sample.conditions.rain_in_per_hr == 0.2


def test_sample_across_midnight_uses_both_days():
    midnight = unix("2026-11-01T00:00")

    def values(cell: Cell, hour: int) -> HourValues:
        return HourValues(20.0, 30.0, 0.3, 0.0, 0.0) if hour == midnight else CALM

    fake = FakeOpenMeteo(values)
    client = make_client(fake)
    eta = utc("2026-10-31T23:30")

    sample = client.forecast([(DALLAS, eta)]).sample(DALLAS, eta)

    assert sample.conditions.wind_mph == 12.5
    assert sample.conditions.rain_in_per_hr == 0.3
    params = fake.requests[0].url.params
    assert (params["start_date"], params["end_date"]) == ("2026-10-31", "2026-11-01")


def test_sample_needs_a_timezone_aware_time():
    client = make_client(FakeOpenMeteo())

    with pytest.raises(ValueError):
        client.forecast([(DALLAS, datetime(2026, 10, 31, 10, 20))])


def test_a_missing_value_makes_the_forecast_unavailable():
    eleven = unix("2026-10-31T11:00")

    def values(cell: Cell, hour: int) -> HourValues:
        return CALM._replace(rain_in=None) if hour == eleven else CALM

    client = make_client(FakeOpenMeteo(values))
    eta = utc("2026-10-31T10:20")
    forecast = client.forecast([(DALLAS, eta)])

    with pytest.raises(WeatherUnavailable):
        forecast.sample(DALLAS, eta)


def test_parses_a_recorded_open_meteo_response():
    payload = json.loads((FIXTURES / "open_meteo_two_locations.json").read_text())
    fake = FakeOpenMeteo()
    fake.failures.append(httpx.Response(200, json=payload))
    client = make_client(fake)
    dallas, oklahoma_city = Cell.containing(32.80, -96.80), Cell.containing(35.45, -97.50)
    eta = utc("2026-10-31T05:30")

    forecast = client.forecast([(dallas, eta), (oklahoma_city, eta)])

    for cell, location in zip((dallas, oklahoma_city), payload, strict=True):
        hourly = location["hourly"]
        five = hourly["time"].index(unix("2026-10-31T05:00"))
        wind = hourly["wind_speed_10m"]
        sample = forecast.sample(cell, eta)
        assert sample.conditions.wind_mph == round((wind[five] + wind[five + 1]) / 2, 1)
        assert sample.gust_mph == hourly["wind_gusts_10m"][five + 1]


# Requests and cache


def test_request_asks_for_the_documented_units_and_variables():
    fake = FakeOpenMeteo()
    make_client(fake).forecast([(DALLAS, utc("2026-10-31T10:20"))])

    params = fake.requests[0].url.params
    assert params["hourly"] == "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
    assert params["wind_speed_unit"] == "mph"
    assert params["precipitation_unit"] == "inch"
    assert params["timeformat"] == "unixtime"
    assert (params["latitude"], params["longitude"]) == ("32.80", "-96.80")


def test_points_in_the_same_cell_are_fetched_once():
    fake = FakeOpenMeteo()
    eta = utc("2026-10-31T10:20")

    make_client(fake).forecast([(DALLAS, eta), (DALLAS, eta + timedelta(minutes=5))])

    assert fake.coordinate_counts() == [1]


def test_cells_are_batched_300_per_request():
    fake = FakeOpenMeteo()
    eta = utc("2026-10-31T10:20")
    cells = [Cell(600 + i, -1900) for i in range(301)]

    make_client(fake).forecast([(cell, eta) for cell in cells])

    assert fake.coordinate_counts() == [1, 300]


def test_a_second_forecast_for_the_same_points_uses_the_cache():
    fake = FakeOpenMeteo()
    client = make_client(fake)
    points = [(DALLAS, utc("2026-10-31T10:20"))]

    client.forecast(points)
    client.forecast(points)

    assert len(fake.requests) == 1


def test_only_days_missing_from_the_cache_are_fetched():
    fake = FakeOpenMeteo()
    client = make_client(fake)

    client.forecast([(DALLAS, utc("2026-10-31T10:20"))])
    client.forecast([(DALLAS, utc("2026-10-31T23:30"))])

    params = fake.requests[1].url.params
    assert (params["start_date"], params["end_date"]) == ("2026-11-01", "2026-11-01")


def test_successful_batches_are_cached_even_when_another_fails():
    fake = FakeOpenMeteo()
    single_cell_answers = fake.answer

    def answer(request: httpx.Request) -> httpx.Response:
        if "," not in request.url.params["latitude"]:
            return httpx.Response(429, json={"reason": "Minutely API request limit exceeded."})
        return single_cell_answers(request)

    fake.answer = answer
    client = make_client(fake)
    eta = utc("2026-10-31T10:20")
    cells = [Cell(600 + i, -1900) for i in range(301)]

    with pytest.raises(WeatherRateLimited):
        client.forecast([(cell, eta) for cell in cells])
    requests_before = len(fake.requests)
    client.forecast([(cell, eta) for cell in cells[:300]])

    assert len(fake.requests) == requests_before


# Errors


MINUTELY = "Minutely API request limit exceeded. Please try again in one minute."


@pytest.mark.parametrize(
    ("reason", "limit", "retry_after_s"),
    [
        ("Hourly API request limit exceeded. Please try again in the next hour.", "hour", 3600),
        ("Daily API request limit exceeded. Please try again tomorrow.", "day", 86400),
    ],
)
def test_an_hourly_or_daily_limit_is_reported_and_not_retried(reason, limit, retry_after_s):
    fake = FakeOpenMeteo()
    fake.failures.append(httpx.Response(429, json={"error": True, "reason": reason}))

    with pytest.raises(WeatherRateLimited) as raised:
        make_client(fake).forecast([(DALLAS, utc("2026-10-31T10:20"))])

    assert (raised.value.limit, raised.value.retry_after_s) == (limit, retry_after_s)
    assert len(fake.requests) == 1


def test_a_minute_limit_is_waited_out_once():
    fake = FakeOpenMeteo()
    fake.failures.append(httpx.Response(429, json={"error": True, "reason": MINUTELY}))
    clock = FakeClock()

    make_client(fake, clock).forecast([(DALLAS, utc("2026-10-31T10:20"))])

    assert clock.slept == [60]
    assert len(fake.requests) == 2


def test_a_minute_limit_that_persists_is_reported():
    fake = FakeOpenMeteo()
    fake.failures.extend([httpx.Response(429, json={"reason": MINUTELY})] * 2)

    with pytest.raises(WeatherRateLimited) as raised:
        make_client(fake).forecast([(DALLAS, utc("2026-10-31T10:20"))])

    assert raised.value.limit == "minute"


# Pacing


def test_a_trip_over_the_minute_budget_waits_instead_of_failing():
    fake = FakeOpenMeteo()
    clock = FakeClock()
    eta = utc("2026-10-31T10:20")
    cells = [Cell(600 + i, -1900) for i in range(700)]

    forecast = make_client(fake, clock).forecast([(cell, eta) for cell in cells])

    # The first minute takes 300 + 250, the rest waits for the minute to pass.
    assert fake.coordinate_counts() == [150, 250, 300]
    assert sum(clock.slept) == pytest.approx(60)
    assert forecast.sample(cells[-1], eta).conditions.wind_mph == 5.0


def test_pending_counts_uncached_cells_and_estimates_the_wait():
    fake = FakeOpenMeteo()
    clock = FakeClock()
    client = make_client(fake, clock)
    eta = utc("2026-10-31T10:20")
    small = [(Cell(600 + i, -1900), eta) for i in range(10)]
    large = [(Cell(800 + i, -1900), eta) for i in range(700)]

    assert client.pending(small)[0] == 10
    assert client.pending(small)[1] < 10
    client.forecast(small)
    assert client.pending(small) == (0, 0.0)
    cells, seconds = client.pending(large)
    assert cells == 700
    assert seconds > 60
    assert fake.requests and len(fake.requests) == 1  # pending() never calls the API.


def test_the_budget_frees_up_as_the_minute_passes():
    clock = FakeClock()
    budget = MinuteBudget(limit=550, clock=clock, sleep=clock.sleep)

    assert budget.take(300) == 300
    clock.now += 30
    assert budget.take(200) == 200
    assert budget.take(100) == 50  # Only 50 of the minute are left: the batch shrinks to fit.
    assert clock.slept == []
    assert budget.take(100) == 100  # Nothing left: waits until the first 300 are a minute old.

    assert clock.slept == [pytest.approx(30)]


@pytest.mark.parametrize(
    "failure",
    [httpx.Response(503, text="Service Unavailable"), httpx.ReadTimeout("timed out")],
)
def test_a_server_error_or_timeout_is_retried_once(failure):
    fake = FakeOpenMeteo()
    fake.failures.append(failure)
    eta = utc("2026-10-31T10:20")

    forecast = make_client(fake).forecast([(DALLAS, eta)])

    assert forecast.sample(DALLAS, eta).conditions.wind_mph == 5.0
    assert len(fake.requests) == 2


def test_two_server_errors_make_the_forecast_unavailable():
    fake = FakeOpenMeteo()
    fake.failures.extend([httpx.Response(500), httpx.Response(502)])

    with pytest.raises(WeatherUnavailable):
        make_client(fake).forecast([(DALLAS, utc("2026-10-31T10:20"))])

    assert len(fake.requests) == 2


def test_a_rejected_request_is_not_retried():
    fake = FakeOpenMeteo()
    fake.failures.append(
        httpx.Response(
            400, json={"error": True, "reason": "Parameter 'start_date' is out of range"}
        )
    )

    with pytest.raises(WeatherUnavailable, match="start_date"):
        make_client(fake).forecast([(DALLAS, utc("2026-10-31T10:20"))])

    assert len(fake.requests) == 1


def test_a_response_with_the_wrong_number_of_locations_is_rejected():
    fake = FakeOpenMeteo()
    fake.failures.append(httpx.Response(200, json=[{"hourly": {}}, {"hourly": {}}]))

    with pytest.raises(WeatherUnavailable):
        make_client(fake).forecast([(DALLAS, utc("2026-10-31T10:20"))])

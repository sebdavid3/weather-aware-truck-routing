"""Truck routes from TomTom's Routing API, with up to three distinct options.

TomTom often returns fewer alternatives than asked for, or near-copies of the
main route. Routes that share most of their weather cells with a better one
are dropped, and missing options are filled with detours that must pass near
a point on each side of the main route.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from django.core.cache import BaseCache
from django.core.cache import cache as default_cache

from planner.geometry import LatLon, Polyline, bearing_deg, haversine_m, offset_point
from planner.trip import TravelTimeProfile
from planner.upstream import UpstreamFailed, get_with_retry
from planner.weather import Cell

logger = logging.getLogger(__name__)

TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{locations}/json"
ROUTE_OPTIONS = 3
# Measured on four US trips: 2 alternatives gave the same three distinct routes
# as TomTom's maximum of 5, two to three times faster (Dallas -> Chicago: 5.3 s
# vs 10.4 s). Near-copies are still replaced with detours.
MAX_ALTERNATIVES = 2
MAX_SHARED_CELLS = 0.85  # Routes sharing more of their cells are the same choice weather-wise.
OVERLAP_SAMPLE_M = 2_000
DETOUR_OFFSET_FRACTION = 0.15  # Of the straight-line trip distance.
DETOUR_OFFSET_MIN_M = 20_000
DETOUR_OFFSET_MAX_M = 150_000
DETOUR_RADIUS_FRACTION = 0.3  # Of the offset; how close the detour must pass.
CACHE_TTL_S = 3600
REQUEST_TIMEOUT_S = 20.0
RETRY_DELAY_S = 1.0
RATE_LIMIT_RETRY_S = 5
NO_ROUTE_CODES = ("NO_ROUTE_FOUND", "MAP_MATCHING_FAILURE")


class RoutingError(Exception):
    """Routes can't be produced for this request."""


class RoutingUnavailable(RoutingError):
    """TomTom failed, rejected our request or the API key, or answered unexpectedly."""


class RoutingRateLimited(RoutingError):
    def __init__(self, retry_after_s: int):
        super().__init__(f"TomTom request limit reached; retry in {retry_after_s} s")
        self.retry_after_s = retry_after_s


class NoRouteFound(RoutingError):
    """No truck route connects the points, or a point is too far from any road."""


@dataclass(frozen=True)
class Route:
    polyline: Polyline
    profile: TravelTimeProfile
    drive_time_s: float


@dataclass(frozen=True)
class Detour:
    """A point the route must pass within `radius_m` of, without splitting it into legs."""

    center: LatLon
    radius_m: int


class TomTomRouter:
    def __init__(
        self,
        api_key: str,
        http: httpx.Client | None = None,
        cache: BaseCache = default_cache,
        retry_delay_s: float = RETRY_DELAY_S,
    ):
        self._api_key = api_key
        self._http = http or httpx.Client(timeout=REQUEST_TIMEOUT_S)
        self._cache = cache
        self._retry_delay_s = retry_delay_s

    def routes(self, origin: LatLon, destination: LatLon, depart_at: datetime) -> list[Route]:
        """Up to three distinct truck routes, best first. `depart_at` must not be in the past."""
        key = _cache_key(origin, destination, depart_at)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        found = self._calculate([origin, destination], depart_at, MAX_ALTERNATIVES)
        if not found:
            raise NoRouteFound("TomTom returned no routes")
        options = distinct_routes(found, ROUTE_OPTIONS)
        if len(options) < ROUTE_OPTIONS:
            for detour in detours(origin, destination, options[0]):
                try:
                    found = self._calculate([origin, detour, destination], depart_at, 0)
                except NoRouteFound:
                    continue
                options = distinct_routes([*options, *found], ROUTE_OPTIONS)
                if len(options) == ROUTE_OPTIONS:
                    break

        self._cache.set(key, options, CACHE_TTL_S)
        return options

    def _calculate(
        self, stops: Sequence[LatLon | Detour], depart_at: datetime, max_alternatives: int
    ) -> list[Route]:
        url = TOMTOM_ROUTE_URL.format(locations=":".join(_location(stop) for stop in stops))
        params = {
            "key": self._api_key,
            "travelMode": "truck",
            "vehicleCommercial": "true",
            "routeType": "fastest",
            # Historic traffic for the departure time; live traffic only helps a
            # trip starting now and would make cached routes stale sooner.
            "traffic": "false",
            "departAt": depart_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "maxAlternatives": str(max_alternatives),
            "routeRepresentation": "polyline",
            "extendedRouteRepresentation": ["distance", "travelTime"],
        }
        try:
            response = get_with_retry(
                self._http, url, params, service="TomTom", retry_delay_s=self._retry_delay_s
            )
        except UpstreamFailed as exc:
            raise RoutingUnavailable(str(exc)) from exc
        if response.status_code == 429:
            raise RoutingRateLimited(_retry_after(response))
        if not response.is_success:
            raise _rejection(response)
        try:
            return [_parse_route(route) for route in response.json()["routes"]]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RoutingUnavailable(f"Unexpected TomTom response: {exc!r}") from exc


def distinct_routes(routes: Sequence[Route], limit: int) -> list[Route]:
    """Routes in the given order, skipping any that mostly overlaps one already kept."""
    kept: list[Route] = []
    kept_cells: list[frozenset[Cell]] = []
    for route in routes:
        cells = route_cells(route.polyline)
        if all(shared_fraction(cells, other) <= MAX_SHARED_CELLS for other in kept_cells):
            kept.append(route)
            kept_cells.append(cells)
            if len(kept) == limit:
                break
    return kept


def route_cells(polyline: Polyline) -> frozenset[Cell]:
    distances = [*range(0, int(polyline.length_m), OVERLAP_SAMPLE_M), polyline.length_m]
    return frozenset(Cell.containing(*polyline.point_at(d)) for d in distances)


def shared_fraction(a: frozenset[Cell], b: frozenset[Cell]) -> float:
    return len(a & b) / min(len(a), len(b))


def detours(origin: LatLon, destination: LatLon, main: Route) -> list[Detour]:
    """Points to the left and right of the main route's midpoint, across the trip's heading."""
    offset = haversine_m(origin, destination) * DETOUR_OFFSET_FRACTION
    offset = min(max(offset, DETOUR_OFFSET_MIN_M), DETOUR_OFFSET_MAX_M)
    middle = main.polyline.point_at(main.polyline.length_m / 2)
    heading = bearing_deg(origin, destination)
    radius = int(offset * DETOUR_RADIUS_FRACTION)
    return [Detour(offset_point(middle, heading + side, offset), radius) for side in (90, -90)]


def _location(stop: LatLon | Detour) -> str:
    if isinstance(stop, Detour):
        return f"circle({stop.center[0]:.5f},{stop.center[1]:.5f},{stop.radius_m})"
    return f"{stop[0]:.5f},{stop[1]:.5f}"


def _parse_route(route: dict) -> Route:
    # Detours use circle waypoints, which don't split the route, so there is one leg.
    points = [(p["latitude"], p["longitude"]) for leg in route["legs"] for p in leg["points"]]
    polyline = Polyline(points)
    drive_time_s = float(route["summary"]["travelTimeInSeconds"])
    # `progress` gives the driving time at some points; map those points to
    # distances along our polyline so checkpoints can interpolate between them.
    samples = {0.0: 0.0}
    for entry in route.get("progress", []):
        samples[polyline.distances_m[entry["pointIndex"]]] = float(entry["travelTimeInSeconds"])
    samples[polyline.length_m] = drive_time_s
    distances = sorted(samples)
    return Route(
        polyline=polyline,
        profile=TravelTimeProfile(distances, [samples[d] for d in distances]),
        drive_time_s=drive_time_s,
    )


def _rejection(response: httpx.Response) -> RoutingError:
    try:
        error = response.json().get("detailedError", {})
        code, message = error.get("code", ""), error.get("message", "")
    except (ValueError, AttributeError):
        code, message = "", response.text[:200]
    if response.status_code == 400 and code in NO_ROUTE_CODES:
        return NoRouteFound(message or code)
    if response.status_code in (401, 403):  # 401 for a missing key, 403 for a bad one.
        logger.error("TomTom rejected the API key: %s", message)
        return RoutingUnavailable("TomTom rejected the API key")
    return RoutingUnavailable(f"TomTom rejected the request ({response.status_code}): {message}")


def _retry_after(response: httpx.Response) -> int:
    try:
        return max(1, int(response.headers.get("Retry-After", RATE_LIMIT_RETRY_S)))
    except ValueError:
        return RATE_LIMIT_RETRY_S


def _cache_key(origin: LatLon, destination: LatLon, depart_at: datetime) -> str:
    return (
        f"route:v1:{origin[0]:.5f},{origin[1]:.5f}:{destination[0]:.5f},{destination[1]:.5f}:"
        f"{depart_at.astimezone(UTC):%Y-%m-%dT%H:%M}"
    )

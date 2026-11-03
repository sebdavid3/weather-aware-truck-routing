"""TomTom router tests against a fake TomTom; they never touch the network."""

import threading
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from django.core.cache.backends.locmem import LocMemCache

from planner.geometry import Polyline, haversine_m
from planner.routing import (
    NoRouteFound,
    Route,
    RoutingRateLimited,
    RoutingUnavailable,
    TomTomRouter,
    detours,
    distinct_routes,
)
from planner.trip import TravelTimeProfile

ORIGIN = (30.0, -97.0)
DESTINATION = (31.0, -97.0)
DEPART = datetime(2099, 11, 2, 12, 0, tzinfo=UTC)  # Far enough ahead never to be clamped to now.


def line(lon: float, steps: int = 10) -> list[tuple[float, float]]:
    """Points due north from latitude 30 to 31 along `lon`."""
    return [(30.0 + i / steps, lon) for i in range(steps + 1)]


def route_json(points: list[tuple[float, float]], hours: float = 1.0) -> dict:
    """A TomTom route at constant speed, with progress at every other point."""
    total_s = int(hours * 3600)
    distances = [0.0]
    for a, b in zip(points, points[1:], strict=False):
        distances.append(distances[-1] + haversine_m(a, b))
    progress = [
        {
            "pointIndex": i,
            "distanceInMeters": round(distances[i]),
            "travelTimeInSeconds": round(total_s * distances[i] / distances[-1]),
        }
        for i in range(0, len(points), 2)
    ]
    return {
        "summary": {"lengthInMeters": round(distances[-1]), "travelTimeInSeconds": total_s},
        "legs": [{"points": [{"latitude": lat, "longitude": lon} for lat, lon in points]}],
        "progress": progress,
    }


def ok(*routes: dict) -> httpx.Response:
    return httpx.Response(200, json={"formatVersion": "0.0.12", "routes": list(routes)})


def error(status: int, code: str = "", message: str = "") -> httpx.Response:
    return httpx.Response(status, json={"detailedError": {"code": code, "message": message}})


class FakeTomTom:
    """Serves queued responses (or raises queued exceptions) in order."""

    def __init__(self, *responses: httpx.Response | Exception):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []
        self._lock = threading.Lock()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        with self._lock:
            self.requests.append(request)
            response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def make_router(fake: FakeTomTom) -> TomTomRouter:
    return TomTomRouter(
        api_key="test-key",
        http=httpx.Client(transport=httpx.MockTransport(fake)),
        cache=LocMemCache(f"routing-test-{uuid.uuid4()}", {}),
        retry_delay_s=0,
    )


def as_route(points: list[tuple[float, float]]) -> Route:
    polyline = Polyline(points)
    return Route(polyline, TravelTimeProfile([0.0, polyline.length_m], [0.0, 3600.0]), 3600.0)


# Request and response


def test_request_asks_for_a_commercial_truck_route_with_travel_times():
    fake = FakeTomTom(ok(route_json(line(-97.0)), route_json(line(-96.0)), route_json(line(-98.0))))

    make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    request = fake.requests[0]
    assert request.url.path.endswith("/calculateRoute/30.00000,-97.00000:31.00000,-97.00000/json")
    params = request.url.params
    assert params["key"] == "test-key"
    assert params["travelMode"] == "truck"
    assert params["vehicleCommercial"] == "true"
    assert params["traffic"] == "false"
    assert params["departAt"] == "2099-11-02T12:00:00Z"
    assert params["maxAlternatives"] == "2"
    assert params.get_list("extendedRouteRepresentation") == ["distance", "travelTime"]


def test_route_keeps_the_polyline_and_driving_time_profile():
    fake = FakeTomTom(ok(route_json(line(-97.0), hours=2)))
    fake.responses.extend([ok(route_json(line(-97.0))), ok(route_json(line(-97.0)))])

    route = make_router(fake).routes(ORIGIN, DESTINATION, DEPART)[0]

    assert route.polyline.points[0] == ORIGIN
    assert route.polyline.points[-1] == DESTINATION
    assert route.drive_time_s == 7200
    assert route.profile.time_at(route.polyline.length_m / 2) == pytest.approx(3600, abs=1)


# Choosing three distinct routes


def test_three_distinct_alternatives_need_no_detours():
    fake = FakeTomTom(ok(route_json(line(-97.0)), route_json(line(-96.0)), route_json(line(-98.0))))

    routes = make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert len(routes) == 3
    assert len(fake.requests) == 1


def test_near_copies_are_dropped_and_replaced_with_detours():
    fake = FakeTomTom(
        ok(route_json(line(-97.0)), route_json(line(-97.001))),  # The second is ~100 m away.
        ok(route_json(line(-96.5))),
        ok(route_json(line(-97.5))),
    )

    routes = make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert [r.polyline.points[5][1] for r in routes] == [-97.0, -96.5, -97.5]
    detour_paths = [request.url.path for request in fake.requests[1:]]
    assert all("circle(" in path for path in detour_paths)
    assert [request.url.params["maxAlternatives"] for request in fake.requests[1:]] == ["0", "0"]


def test_a_detour_that_copies_a_kept_route_is_skipped():
    fake = FakeTomTom(
        ok(route_json(line(-97.0))),
        ok(route_json(line(-97.001))),
        ok(route_json(line(-97.5))),
    )

    routes = make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert len(routes) == 2


def test_a_detour_without_a_route_is_skipped():
    fake = FakeTomTom(
        ok(route_json(line(-97.0)), route_json(line(-96.0))),
        error(400, "NO_ROUTE_FOUND", "NO_ROUTE_FOUND: no route"),
        ok(route_json(line(-98.0))),
    )

    routes = make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert len(routes) == 3


def test_distinct_routes_keeps_the_order_and_the_limit():
    a, b, c = as_route(line(-97.0)), as_route(line(-96.0)), as_route(line(-98.0))
    copy_of_a = as_route(line(-97.001))

    assert distinct_routes([a, copy_of_a, b, c], 2) == [a, b]


def test_detours_sit_on_both_sides_of_the_main_route():
    main = as_route(line(-97.0))

    left_or_right = detours(ORIGIN, DESTINATION, main)

    longitudes = sorted(d.center[1] for d in left_or_right)
    assert longitudes[0] < -97.0 < longitudes[1]
    for detour in left_or_right:
        # 15% of ~111 km is under the 20 km minimum offset.
        assert haversine_m((30.5, -97.0), detour.center) == pytest.approx(20_000, rel=0.01)
        assert detour.radius_m == 6_000


# Cache and errors


def test_a_second_request_for_the_same_trip_uses_the_cache():
    fake = FakeTomTom(ok(route_json(line(-97.0)), route_json(line(-96.0)), route_json(line(-98.0))))
    router = make_router(fake)

    router.routes(ORIGIN, DESTINATION, DEPART)
    router.routes(ORIGIN, DESTINATION, DEPART)

    assert len(fake.requests) == 1


def test_a_past_departure_asks_for_now_and_caches_under_the_requested_time():
    fake = FakeTomTom(ok(route_json(line(-97.0)), route_json(line(-96.0)), route_json(line(-98.0))))
    router = make_router(fake)
    five_minutes_ago = datetime.now(UTC) - timedelta(minutes=5)

    router.routes(ORIGIN, DESTINATION, five_minutes_ago)
    router.routes(ORIGIN, DESTINATION, five_minutes_ago)

    sent = datetime.fromisoformat(fake.requests[0].url.params["departAt"].replace("Z", "+00:00"))
    assert sent > datetime.now(UTC)
    assert len(fake.requests) == 1


def test_no_route_between_the_points():
    fake = FakeTomTom(error(400, "MAP_MATCHING_FAILURE", "MAP_MATCHING_FAILURE: origin"))

    with pytest.raises(NoRouteFound):
        make_router(fake).routes(ORIGIN, DESTINATION, DEPART)


def test_a_rate_limit_is_not_retried():
    fake = FakeTomTom(httpx.Response(429, headers={"Retry-After": "2"}))

    with pytest.raises(RoutingRateLimited) as raised:
        make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert raised.value.retry_after_s == 2
    assert len(fake.requests) == 1


@pytest.mark.parametrize("status", [401, 403])
def test_a_missing_or_rejected_api_key_is_reported_without_retrying(status):
    fake = FakeTomTom(error(status, message="You are missing valid authentication credentials"))

    with pytest.raises(RoutingUnavailable, match="API key"):
        make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert len(fake.requests) == 1


def test_a_server_error_is_retried_once():
    fake = FakeTomTom(
        httpx.Response(503),
        ok(route_json(line(-97.0)), route_json(line(-96.0)), route_json(line(-98.0))),
    )

    routes = make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

    assert len(routes) == 3
    assert len(fake.requests) == 2


def test_an_unexpected_response_is_unavailable():
    fake = FakeTomTom(httpx.Response(200, json={"routes": [{"legs": []}]}))

    with pytest.raises(RoutingUnavailable):
        make_router(fake).routes(ORIGIN, DESTINATION, DEPART)

"""HTTP endpoints, with a fake router and a fake Open-Meteo behind them."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest

from planner import planning, views
from planner.geometry import Polyline
from planner.routing import Route, RoutingRateLimited, RoutingUnavailable
from planner.tests.test_routing import as_route, line
from planner.tests.test_weather import CALM, FakeOpenMeteo, make_client
from planner.trip import TravelTimeProfile
from planner.weather import HourValues

CENTRAL = ZoneInfo("America/Chicago")  # The time zone of the test trip's origin.
STORMY = HourValues(wind_mph=50.0, gust_mph=70.0, rain_in=0.0, showers_in=0.0, snowfall_in=0.0)


class FakeRouter:
    def __init__(self, routes=None, error=None):
        self._routes = routes or [as_route(line(-97.0)), as_route(line(-96.0))]
        self._error = error

    def routes(self, origin, destination, depart_at):
        if self._error:
            raise self._error
        return self._routes


def local_departure(hours_from_now: float) -> str:
    moment = datetime.now(CENTRAL) + timedelta(hours=hours_from_now)
    return moment.strftime("%Y-%m-%dT%H:%M")


def trip(**overrides) -> dict:
    return {
        "origin": {"lat": 30.0, "lon": -97.0},
        "destination": {"lat": 31.0, "lon": -97.0},
        "departure": local_departure(2),
        "load_lb": 35_000,
        "interval_miles": 25,
        "rest_breaks": False,
    } | overrides


@pytest.fixture
def backends(monkeypatch):
    """Swap the real clients for fakes; tests adjust them through the returned dict."""
    fakes = {"router": FakeRouter(), "weather": FakeOpenMeteo()}
    monkeypatch.setattr(views, "router", lambda: fakes["router"])
    monkeypatch.setattr(views, "weather", lambda: make_client(fakes["weather"]))
    return fakes


def test_routes_returns_scored_routes_and_a_recommendation(client, backends):
    # Storm along longitude -97 (route A); route B at -96 stays calm.
    backends["weather"].values = lambda cell, hour: STORMY if cell.lon == -97.0 else CALM

    response = client.post("/api/routes", trip(), content_type="application/json")

    assert response.status_code == 200
    body = response.json()
    assert body["recommended"] == "B"
    assert body["timezone"] == "America/Chicago"
    by_name = {route["name"]: route for route in body["routes"]}
    assert by_name["A"]["miles_by_level"]["no_travel"] == by_name["A"]["distance_miles"]
    assert by_name["B"]["worst_level"] == "low"
    assert [by_name["A"]["rank"], by_name["B"]["rank"]] == [2, 1]
    assert body["reasons"] == ["69 fewer No Travel miles than Route A"]
    for route in body["routes"]:
        assert len(route["segments"]) == len(route["checkpoints"])
        assert route["checkpoints"][0]["mile"] == 0.0


def test_rest_breaks_add_stops_to_long_routes(client, backends):
    polyline = Polyline(line(-97.0))
    twelve_hours = 12 * 3600.0
    slow = Route(
        polyline, TravelTimeProfile([0.0, polyline.length_m], [0.0, twelve_hours]), twelve_hours
    )
    backends["router"] = FakeRouter([slow])

    body = client.post(
        "/api/routes", trip(rest_breaks=True), content_type="application/json"
    ).json()

    route = body["routes"][0]
    assert [stop["kind"] for stop in route["stops"]] == ["break", "rest"]
    assert route["duration_minutes"] == 12 * 60 + 30 + 10 * 60


def test_preview_shows_routes_and_the_forecast_work_ahead(client, backends):
    response = client.post("/api/routes/preview", trip(), content_type="application/json")

    body = response.json()
    assert response.status_code == 200
    assert [route["name"] for route in body["routes"]] == ["A", "B"]
    assert all(len(route["line"]) >= 2 for route in body["routes"])
    assert body["checkpoints"] == body["to_fetch"] > 0
    assert body["wait_seconds"] < 10
    assert backends["weather"].requests == []  # The preview never fetches weather.


def test_heatmap_has_49_hours_for_each_corridor_point(client, backends):
    response = client.post("/api/heatmap", trip(), content_type="application/json")

    body = response.json()
    assert response.status_code == 200
    assert body["hours"] == 48
    assert len(body["points"]) == len(body["levels"]) > 0
    assert all(len(levels) == 49 for levels in body["levels"])


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"departure": local_departure(-1)}, "departure"),
        ({"departure": local_departure(24 * 7 + 1)}, "departure"),
        ({"destination": {"lat": 30.0, "lon": -97.0}}, "destination"),
        ({"interval_miles": 15}, "interval_miles"),
        ({"load_lb": 90_000}, "load_lb"),
        ({"origin": {"lat": 95.0, "lon": -97.0}}, "origin"),
    ],
)
def test_invalid_trips_are_rejected(client, backends, overrides, field):
    response = client.post("/api/routes", trip(**overrides), content_type="application/json")

    assert response.status_code == 400
    assert field in response.json()


def test_a_departure_a_few_minutes_ago_is_accepted(client, backends):
    response = client.post(
        "/api/routes", trip(departure=local_departure(-0.1)), content_type="application/json"
    )

    assert response.status_code == 200


def test_too_many_checkpoints_asks_for_a_longer_interval(client, backends, monkeypatch):
    monkeypatch.setattr(planning, "MAX_CHECKPOINT_CELLS", 3)

    response = client.post("/api/routes", trip(), content_type="application/json")

    assert response.status_code == 422
    assert "longer checkpoint interval" in response.json()["detail"]


def test_a_rate_limit_becomes_503_with_retry_after(client, backends):
    backends["router"] = FakeRouter(error=RoutingRateLimited(7))

    response = client.post("/api/routes", trip(), content_type="application/json")

    assert response.status_code == 503
    assert response["Retry-After"] == "7"


def test_upstream_failures_reach_the_user_without_provider_details(client, backends):
    backends["router"] = FakeRouter(
        error=RoutingUnavailable("TomTom rejected the request (400): x")
    )

    response = client.post("/api/routes", trip(), content_type="application/json")

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Truck routes aren't available right now. Try again in a moment."
    }


def test_places_needs_three_characters(client):
    assert client.get("/api/places?q=da").json() == {"places": []}


def test_repeating_a_search_reuses_every_cached_forecast(client, monkeypatch):
    """A repeat, or the same trip with another load, makes no new weather or routing calls."""
    from django.core.cache import cache

    from planner.weather import OpenMeteoClient

    cache.clear()
    fake_weather = FakeOpenMeteo()
    long_routes = [
        as_route([(30.0 + i / 10, lon) for i in range(101)]) for lon in (-97.0, -96.0, -95.0)
    ]
    weather = OpenMeteoClient(
        http=httpx.Client(transport=httpx.MockTransport(fake_weather)), retry_delay_s=0
    )
    monkeypatch.setattr(views, "router", lambda: FakeRouter(long_routes))
    monkeypatch.setattr(views, "weather", lambda: weather)

    def search(**overrides):
        for url in ("/api/routes", "/api/heatmap"):
            response = client.post(url, trip(**overrides), content_type="application/json")
            assert response.status_code == 200

    search()
    calls = len(fake_weather.requests)
    search()
    search(load_lb=45_000)

    assert len(fake_weather.requests) == calls

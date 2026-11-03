"""Turns a trip request into scored routes and a corridor forecast.

This is where routing, checkpoints, weather, risk and ranking meet; each of
those modules stays independent of the others and of the web layer.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import pairwise

from planner.corridor import corridor
from planner.geometry import METERS_PER_MILE, LatLon, simplify, slice_between
from planner.ranking import rank, recommendation_reasons, summarize, warning
from planner.risk import RiskLevel, assess
from planner.routing import Route, TomTomRouter
from planner.trip import arrival, place_checkpoints, planned_stops, timezone_at
from planner.weather import Cell, OpenMeteoClient

MAX_CHECKPOINT_CELLS = 400  # docs/api-usage.md: the per-search cap.
HEATMAP_HOURS = 48
DISPLAY_TOLERANCE_M = 30  # Map lines lose no visible detail at this simplification.
ROUTE_NAMES = "ABCDE"


class TooManyCheckpoints(Exception):
    pass


@dataclass(frozen=True)
class TripRequest:
    origin: LatLon
    destination: LatLon
    departure: datetime  # UTC.
    load_lb: int
    interval_miles: int
    rest_breaks: bool


def plan_trip(trip: TripRequest, router: TomTomRouter, weather: OpenMeteoClient) -> dict:
    routes = _routes(trip, router)
    plans = []
    for name, route in zip(ROUTE_NAMES, routes, strict=False):
        stops = planned_stops(route.drive_time_s) if trip.rest_breaks else []
        checkpoints = place_checkpoints(route.polyline, trip.interval_miles, route.profile)
        timed = [
            (
                checkpoint,
                Cell.containing(*checkpoint.position),
                arrival(trip.departure, checkpoint.drive_time_s, stops),
            )
            for checkpoint in checkpoints
        ]
        plans.append((name, route, stops, timed))

    cells = {cell for *_, timed in plans for _, cell, _ in timed}
    if len(cells) > MAX_CHECKPOINT_CELLS:
        raise TooManyCheckpoints(
            f"This trip needs {len(cells)} weather checkpoints, over the limit of "
            f"{MAX_CHECKPOINT_CELLS}. Choose a longer checkpoint interval."
        )
    forecast = weather.forecast([(cell, eta) for *_, timed in plans for _, cell, eta in timed])

    results, summaries = [], []
    for name, route, stops, timed in plans:
        scored = []
        for checkpoint, cell, eta in timed:
            sample = forecast.sample(cell, eta)
            scored.append((checkpoint, eta, sample, assess(sample.conditions, trip.load_lb)))
        arrives = arrival(trip.departure, route.drive_time_s, stops)
        summary = summarize(
            name,
            [
                (risk.level, checkpoint.covered_m / METERS_PER_MILE)
                for checkpoint, _, _, risk in scored
            ],
            (arrives - trip.departure).total_seconds(),
        )
        summaries.append(summary)
        results.append(
            {
                "name": name,
                "distance_miles": round(route.polyline.length_m / METERS_PER_MILE),
                "drive_minutes": round(route.drive_time_s / 60),
                "duration_minutes": summary.duration_minutes,
                "arrival": _iso(arrives),
                "miles_by_level": {
                    _level(level): miles for level, miles in summary.miles_by_level.items()
                },
                "average_risk": summary.average_risk,
                "worst_level": _level(summary.worst_level),
                "segments": _segments(route, scored),
                "checkpoints": [_checkpoint(*item) for item in scored],
                "stops": [_stop(route, stop, trip.departure, stops) for stop in stops],
            }
        )

    ranked = rank(summaries)
    ranks = {summary.name: position for position, summary in enumerate(ranked, start=1)}
    for result in results:
        result["rank"] = ranks[result["name"]]
    return {
        "departure": _iso(trip.departure),
        "timezone": timezone_at(trip.origin).key,
        "load_lb": trip.load_lb,
        "interval_miles": trip.interval_miles,
        "rest_breaks": trip.rest_breaks,
        "recommended": ranked[0].name,
        "reasons": recommendation_reasons(ranked),
        "warning": warning(ranked),
        "routes": results,
    }


def plan_heatmap(trip: TripRequest, router: TomTomRouter, weather: OpenMeteoClient) -> dict:
    """Risk levels for the corridor at each hour from departure to 48 h later."""
    lattice = corridor([route.polyline for route in _routes(trip, router)])
    cells = lattice.cells
    times = [trip.departure + timedelta(hours=hour) for hour in range(HEATMAP_HOURS + 1)]
    forecast = weather.forecast([(cell, time) for cell in cells for time in times])
    return {
        "departure": _iso(trip.departure),
        "hours": HEATMAP_HOURS,
        "spacing_miles": round(lattice.spacing_miles, 1),
        "points": [[round(cell.lon, 2), round(cell.lat, 2)] for cell in cells],
        "levels": [
            [
                assess(forecast.sample(cell, time).conditions, trip.load_lb).level.value
                for time in times
            ]
            for cell in cells
        ],
    }


def _routes(trip: TripRequest, router: TomTomRouter) -> list[Route]:
    # TomTom rejects departures in the past; a departure up to 15 minutes ago
    # is allowed, and routes for "now" are the closest it can give.
    now = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(minutes=1)
    return router.routes(trip.origin, trip.destination, max(trip.departure, now))


def _segments(route: Route, scored: list) -> list[dict]:
    """The route line cut into the stretch each checkpoint covers, colored by its level."""
    polyline = route.polyline
    kept = simplify(polyline.points, DISPLAY_TOLERANCE_M)
    points = [polyline.points[i] for i in kept]
    distances = [polyline.distances_m[i] for i in kept]
    marks = [checkpoint.distance_m for checkpoint, *_ in scored]
    bounds = [0.0, *((a + b) / 2 for a, b in pairwise(marks)), polyline.length_m]
    return [
        {
            "level": _level(risk.level),
            "coordinates": [_lon_lat(p) for p in slice_between(points, distances, start, end)],
        }
        for (*_, risk), start, end in zip(scored, bounds, bounds[1:], strict=False)
    ]


def _checkpoint(checkpoint, eta: datetime, sample, risk) -> dict:
    conditions = sample.conditions
    return {
        "mile": round(checkpoint.distance_m / METERS_PER_MILE, 1),
        "position": _lon_lat(checkpoint.position),
        "eta": _iso(eta),
        "level": _level(risk.level),
        "levels": {"wind": _level(risk.wind), "rain": _level(risk.rain), "snow": _level(risk.snow)},
        "wind_mph": conditions.wind_mph,
        "gust_mph": sample.gust_mph,
        "rain_in_per_hr": conditions.rain_in_per_hr,
        "snow_in_per_hr": conditions.snow_in_per_hr,
    }


def _stop(route: Route, stop, departure: datetime, stops) -> dict:
    distance = route.profile.distance_at(stop.drive_time_s)
    starts = arrival(departure, stop.drive_time_s, stops)
    return {
        "kind": stop.kind.value,
        "start": _iso(starts),
        "end": _iso(starts + timedelta(seconds=stop.duration_s)),
        "mile": round(distance / METERS_PER_MILE, 1),
        "position": _lon_lat(route.polyline.point_at(distance)),
    }


def _level(level: RiskLevel) -> str:
    return level.name.lower()


def _lon_lat(point: LatLon) -> list[float]:
    return [round(point[1], 5), round(point[0], 5)]


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

"""Checkpoints along a route, the miles each one covers, and when the truck reaches it.

Rules from docs/weather-risk-decisions.md: checkpoints at the origin, every N
miles and the destination, each covering half the distance to each neighbor;
optional hours-of-service stops added to the driving time.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

from timezonefinder import TimezoneFinder

from planner.geometry import METERS_PER_MILE, LatLon, Polyline, interpolate

HOUR_S = 3600
# Federal hours-of-service limits for property-carrying drivers, simplified
# as the decisions doc describes: the driver starts fresh, only driving counts.
BREAK_AFTER_DRIVING_S = 8 * HOUR_S
BREAK_S = HOUR_S // 2
REST_AFTER_DRIVING_S = 11 * HOUR_S
REST_S = 10 * HOUR_S

_timezone_finder = TimezoneFinder()


@dataclass(frozen=True)
class Checkpoint:
    distance_m: float
    position: LatLon
    drive_time_s: float
    covered_m: float  # Half the distance to each neighbor.


class StopKind(StrEnum):
    BREAK = "break"
    REST = "rest"


@dataclass(frozen=True)
class Stop:
    kind: StopKind
    drive_time_s: float  # Driving time when the stop starts.
    duration_s: float


class TravelTimeProfile:
    """Driving time from the start as a function of distance along the route.

    Built from the router's (distance, time) samples and interpolated linearly
    between them.
    """

    def __init__(self, distances_m: Sequence[float], times_s: Sequence[float]):
        if len(distances_m) != len(times_s) or len(distances_m) < 2:
            raise ValueError("Need at least two matching distance and time samples")
        if any(b < a for a, b in zip(distances_m, distances_m[1:], strict=False)):
            raise ValueError("Distances must be ascending")
        self._distances_m = list(distances_m)
        self._times_s = list(times_s)

    def time_at(self, distance_m: float) -> float:
        return interpolate(self._distances_m, self._times_s, distance_m)

    def distance_at(self, time_s: float) -> float:
        """Where the truck is after `time_s` of driving; the inverse of time_at."""
        return interpolate(self._times_s, self._distances_m, time_s)


def place_checkpoints(
    polyline: Polyline, interval_miles: int, profile: TravelTimeProfile
) -> list[Checkpoint]:
    interval_m = interval_miles * METERS_PER_MILE
    length = polyline.length_m
    distances = [i * interval_m for i in range(int(length // interval_m) + 1)]
    if length - distances[-1] > 1.0:  # Skip a destination within a meter of the last mark.
        distances.append(length)
    else:
        distances[-1] = length

    checkpoints = []
    for i, distance in enumerate(distances):
        before = (distance - distances[i - 1]) / 2 if i > 0 else 0.0
        after = (distances[i + 1] - distance) / 2 if i + 1 < len(distances) else 0.0
        checkpoints.append(
            Checkpoint(
                distance_m=distance,
                position=polyline.point_at(distance),
                drive_time_s=profile.time_at(distance),
                covered_m=before + after,
            )
        )
    return checkpoints


def planned_stops(total_drive_s: float) -> list[Stop]:
    """Hours-of-service stops a driver must take before `total_drive_s` of driving.

    A 30-minute break at 8, 19, 30... hours of driving and a 10-hour rest at 11,
    22, 33... A limit reached exactly at the destination needs no stop.
    """
    stops = []
    period_start = 0
    while period_start + BREAK_AFTER_DRIVING_S < total_drive_s:
        stops.append(Stop(StopKind.BREAK, period_start + BREAK_AFTER_DRIVING_S, BREAK_S))
        rest_at = period_start + REST_AFTER_DRIVING_S
        if rest_at < total_drive_s:
            stops.append(Stop(StopKind.REST, rest_at, REST_S))
        period_start = rest_at
    return stops


def elapsed_s(drive_time_s: float, stops: Sequence[Stop]) -> float:
    """Clock time from departure after `drive_time_s` of driving, including earlier stops."""
    return drive_time_s + sum(s.duration_s for s in stops if s.drive_time_s < drive_time_s)


def arrival(departure: datetime, drive_time_s: float, stops: Sequence[Stop]) -> datetime:
    return departure + timedelta(seconds=elapsed_s(drive_time_s, stops))


def timezone_at(position: LatLon) -> ZoneInfo:
    name = _timezone_finder.timezone_at(lat=position[0], lng=position[1])
    if name is None:
        raise ValueError(f"No time zone found at {position}")
    return ZoneInfo(name)


def departure_utc(local_departure: datetime, origin: LatLon) -> datetime:
    """Read a wall-clock departure as local time at the origin and convert it to UTC.

    A time repeated by the fall-back change resolves to its first occurrence.
    """
    if local_departure.tzinfo is not None:
        raise ValueError("The departure must be a wall-clock time without a time zone")
    local = local_departure.replace(tzinfo=timezone_at(origin), fold=0)
    return local.astimezone(UTC)

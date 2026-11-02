"""Distances and positions along a route polyline."""

import math
from bisect import bisect_right
from collections.abc import Sequence

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1609.344

LatLon = tuple[float, float]


def haversine_m(a: LatLon, b: LatLon) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def bearing_deg(a: LatLon, b: LatLon) -> float:
    """Initial compass bearing from `a` to `b`, in degrees from north."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return math.degrees(math.atan2(y, x)) % 360


def offset_point(start: LatLon, bearing: float, distance_m: float) -> LatLon:
    """The point `distance_m` from `start` heading `bearing` degrees."""
    lat1, lon1 = map(math.radians, start)
    theta = math.radians(bearing)
    delta = distance_m / EARTH_RADIUS_M
    lat2 = math.asin(
        math.sin(lat1) * math.cos(delta) + math.cos(lat1) * math.sin(delta) * math.cos(theta)
    )
    lon2 = lon1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(lat1),
        math.cos(delta) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180


class Polyline:
    """A route's points with the distance from the start to each of them."""

    def __init__(self, points: Sequence[LatLon]):
        if len(points) < 2:
            raise ValueError("A polyline needs at least two points")
        self.points = list(points)
        self.distances_m = [0.0]
        for previous, point in zip(self.points, self.points[1:], strict=False):
            self.distances_m.append(self.distances_m[-1] + haversine_m(previous, point))

    @property
    def length_m(self) -> float:
        return self.distances_m[-1]

    def point_at(self, distance_m: float) -> LatLon:
        """The point `distance_m` along the polyline, clamped to its ends."""
        if distance_m <= 0:
            return self.points[0]
        if distance_m >= self.length_m:
            return self.points[-1]
        i = bisect_right(self.distances_m, distance_m) - 1
        start, end = self.points[i], self.points[i + 1]
        span = self.distances_m[i + 1] - self.distances_m[i]
        fraction = (distance_m - self.distances_m[i]) / span if span else 0.0
        return (
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
        )


def interpolate(xs: Sequence[float], ys: Sequence[float], x: float) -> float:
    """Piecewise-linear y at `x`, clamped to the first and last points; xs ascending."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = bisect_right(xs, x) - 1
    span = xs[i + 1] - xs[i]
    fraction = (x - xs[i]) / span if span else 0.0
    return ys[i] + (ys[i + 1] - ys[i]) * fraction

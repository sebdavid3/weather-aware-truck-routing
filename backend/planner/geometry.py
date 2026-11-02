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


def simplify(points: Sequence[LatLon], tolerance_m: float) -> list[int]:
    """Indices of the points Douglas-Peucker keeps, always including both ends.

    Distances use a local equirectangular projection, accurate enough at the
    tolerances a map line needs.
    """
    if len(points) < 3:
        return list(range(len(points)))
    lat0 = math.radians(sum(lat for lat, _ in points) / len(points))
    scale_x = math.cos(lat0) * math.pi / 180 * EARTH_RADIUS_M
    scale_y = math.pi / 180 * EARTH_RADIUS_M
    xy = [(lon * scale_x, lat * scale_y) for lat, lon in points]

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        (x1, y1), (x2, y2) = xy[first], xy[last]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        farthest, farthest_d = -1, tolerance_m
        for i in range(first + 1, last):
            x, y = xy[i]
            if length:
                d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length
            else:
                d = math.hypot(x - x1, y - y1)
            if d > farthest_d:
                farthest, farthest_d = i, d
        if farthest >= 0:
            keep[farthest] = True
            stack += [(first, farthest), (farthest, last)]
    return [i for i, kept in enumerate(keep) if kept]


def slice_between(
    points: Sequence[LatLon], distances_m: Sequence[float], start_m: float, end_m: float
) -> list[LatLon]:
    """The part of a line between two distances along it, with interpolated ends."""
    inside = [p for p, d in zip(points, distances_m, strict=True) if start_m < d < end_m]
    return [
        _point_at(points, distances_m, start_m),
        *inside,
        _point_at(points, distances_m, end_m),
    ]


def _point_at(points: Sequence[LatLon], distances_m: Sequence[float], distance_m: float) -> LatLon:
    lat = interpolate(distances_m, [p[0] for p in points], distance_m)
    lon = interpolate(distances_m, [p[1] for p in points], distance_m)
    return lat, lon

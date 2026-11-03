"""A regular lattice of forecast points over the trip corridor, for the heatmap."""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from planner.geometry import METERS_PER_MILE, Polyline
from planner.weather import Cell

MAX_POINTS = 150  # docs/api-usage.md: keeps a search under Open-Meteo's per-minute limit.
MIN_SPACING_MILES = 10.0
SPACING_GROWTH = 1.15
MILES_PER_DEGREE_LAT = 69.05


@dataclass(frozen=True)
class Corridor:
    cells: list[Cell]
    spacing_miles: float


def corridor(polylines: Sequence[Polyline], max_points: int = MAX_POINTS) -> Corridor:
    """Lattice nodes the routes pass, as dense as `max_points` allows.

    Routes are snapped to a square lattice instead of sampled on their own,
    so where routes share a road they share nodes, and the heatmap's density
    stays even instead of doubling on overlaps.
    """
    spacing = MIN_SPACING_MILES
    while True:
        cells = _lattice_cells(polylines, spacing)
        if len(cells) <= max_points:
            return Corridor(cells, spacing)
        spacing *= SPACING_GROWTH


def _lattice_cells(polylines: Sequence[Polyline], spacing_miles: float) -> list[Cell]:
    mean_lat = sum(p[0] for line in polylines for p in line.points) / sum(
        len(line.points) for line in polylines
    )
    lat_step = spacing_miles / MILES_PER_DEGREE_LAT
    lon_step = lat_step / math.cos(math.radians(mean_lat))
    # Half-spacing samples guarantee every lattice square a route crosses is hit.
    sample_m = spacing_miles * METERS_PER_MILE / 2
    nodes: dict[tuple[int, int], None] = {}
    for line in polylines:
        for step in range(int(line.length_m // sample_m) + 1):
            lat, lon = line.point_at(step * sample_m)
            nodes.setdefault((round(lat / lat_step), round(lon / lon_step)))
        lat, lon = line.points[-1]
        nodes.setdefault((round(lat / lat_step), round(lon / lon_step)))
    return list(
        dict.fromkeys(Cell.containing(row * lat_step, col * lon_step) for row, col in nodes)
    )

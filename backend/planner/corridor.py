"""Grid cells covering the trip corridor, for the forecast heatmap."""

from collections.abc import Sequence

from planner.geometry import METERS_PER_MILE, Polyline, bearing_deg, offset_point
from planner.weather import Cell

MAX_POINTS = 150  # docs/api-usage.md: keeps a search under Open-Meteo's per-minute limit.
MIN_SPACING_MILES = 10.0
SPACING_GROWTH = 1.2
LATERAL_OFFSETS_MILES = (-25.0, 0.0, 25.0)
HEADING_SPAN_M = 2_000  # Distance on each side used to measure the route's heading.


def corridor_cells(polylines: Sequence[Polyline], max_points: int = MAX_POINTS) -> list[Cell]:
    """Cells along every route and across it, spaced as tightly as `max_points` allows.

    Routes that share a road share cells, so overlapping routes don't stack
    up in the heatmap.
    """
    spacing = MIN_SPACING_MILES
    while True:
        cells = _cells(polylines, spacing * METERS_PER_MILE)
        if len(cells) <= max_points:
            return cells
        spacing *= SPACING_GROWTH


def _cells(polylines: Sequence[Polyline], spacing_m: float) -> list[Cell]:
    cells: dict[Cell, None] = {}
    for line in polylines:
        steps = max(1, round(line.length_m / spacing_m))
        for step in range(steps + 1):
            distance = line.length_m * step / steps
            center = line.point_at(distance)
            heading = bearing_deg(
                line.point_at(distance - HEADING_SPAN_M), line.point_at(distance + HEADING_SPAN_M)
            )
            for offset in LATERAL_OFFSETS_MILES:
                point = offset_point(center, heading + 90, offset * METERS_PER_MILE)
                cells.setdefault(Cell.containing(*point))
    return list(cells)

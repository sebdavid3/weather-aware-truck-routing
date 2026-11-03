from planner.corridor import MAX_POINTS, corridor
from planner.geometry import Polyline


def north(lon: float, start: float = 30.0, end: float = 34.0) -> Polyline:
    steps = 40
    return Polyline([(start + (end - start) * i / steps, lon) for i in range(steps + 1)])


def test_a_route_gets_a_node_about_every_spacing():
    result = corridor([north(-97.0)])

    # 4 degrees of latitude is about 276 miles; at 10-mile spacing about 28 nodes.
    assert result.spacing_miles == 10.0
    assert 26 <= len(result.cells) <= 30


def test_routes_on_the_same_road_share_nodes():
    alone = corridor([north(-97.0)])
    twice = corridor([north(-97.0), north(-97.0005)])

    assert len(twice.cells) == len(alone.cells)


def test_spacing_grows_to_stay_within_the_budget():
    routes = [north(-97.0 - i, 25.0, 45.0) for i in range(4)]

    result = corridor(routes)

    assert len(result.cells) <= MAX_POINTS
    assert result.spacing_miles > 10.0

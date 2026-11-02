import math

import pytest

from planner.geometry import EARTH_RADIUS_M, Polyline, haversine_m, interpolate

ONE_DEGREE_M = math.pi / 180 * EARTH_RADIUS_M


def test_haversine_one_degree_of_latitude():
    assert haversine_m((30.0, -97.0), (31.0, -97.0)) == pytest.approx(ONE_DEGREE_M)


def test_polyline_accumulates_distance():
    line = Polyline([(30.0, -97.0), (30.5, -97.0), (31.0, -97.0)])

    assert line.distances_m == pytest.approx([0.0, ONE_DEGREE_M / 2, ONE_DEGREE_M])
    assert line.length_m == pytest.approx(ONE_DEGREE_M)


def test_point_at_interpolates_within_a_segment():
    line = Polyline([(30.0, -97.0), (31.0, -97.0)])

    assert line.point_at(ONE_DEGREE_M / 4) == pytest.approx((30.25, -97.0))


def test_point_at_clamps_to_the_ends():
    line = Polyline([(30.0, -97.0), (31.0, -97.0)])

    assert line.point_at(-5.0) == (30.0, -97.0)
    assert line.point_at(ONE_DEGREE_M * 2) == (31.0, -97.0)


def test_polyline_needs_two_points():
    with pytest.raises(ValueError):
        Polyline([(30.0, -97.0)])


def test_interpolate_is_piecewise_linear_and_clamped():
    xs, ys = [0.0, 10.0, 20.0], [0.0, 100.0, 120.0]

    assert interpolate(xs, ys, 5.0) == 50.0
    assert interpolate(xs, ys, 15.0) == 110.0
    assert interpolate(xs, ys, -1.0) == 0.0
    assert interpolate(xs, ys, 25.0) == 120.0

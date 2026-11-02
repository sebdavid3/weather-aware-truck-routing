"""Checkpoints, rest stops and time zones, with the cases from docs/weather-risk-decisions.md."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from planner.geometry import METERS_PER_MILE, Polyline
from planner.trip import (
    StopKind,
    TravelTimeProfile,
    arrival,
    departure_utc,
    elapsed_s,
    place_checkpoints,
    planned_stops,
    timezone_at,
)

HOUR = 3600
MINUTE = 60
DALLAS = (32.7767, -96.7970)
DENVER = (39.7392, -104.9903)


def straight_route() -> Polyline:
    # One degree of latitude due north: about 69.1 miles.
    return Polyline([(30.0, -97.0), (30.5, -97.0), (31.0, -97.0)])


def constant_speed(line: Polyline, hours: float) -> TravelTimeProfile:
    return TravelTimeProfile([0.0, line.length_m], [0.0, hours * HOUR])


# Checkpoints


def test_checkpoints_sit_every_interval_and_at_the_destination():
    line = straight_route()

    checkpoints = place_checkpoints(line, 25, constant_speed(line, 1))

    miles = [c.distance_m / METERS_PER_MILE for c in checkpoints]
    assert miles[:3] == pytest.approx([0, 25, 50])
    assert miles[3] == pytest.approx(line.length_m / METERS_PER_MILE)
    assert checkpoints[0].position == (30.0, -97.0)
    assert checkpoints[-1].position == (31.0, -97.0)


def test_each_checkpoint_covers_half_the_distance_to_each_neighbor():
    line = straight_route()

    checkpoints = place_checkpoints(line, 25, constant_speed(line, 1))

    covered = [c.covered_m / METERS_PER_MILE for c in checkpoints]
    last_gap = line.length_m / METERS_PER_MILE - 50
    assert covered == pytest.approx([12.5, 25, 12.5 + last_gap / 2, last_gap / 2])
    assert sum(c.covered_m for c in checkpoints) == pytest.approx(line.length_m)


def test_checkpoint_drive_time_follows_the_profile():
    line = straight_route()
    # Slow first half: 45 minutes for the first half, 15 for the second.
    profile = TravelTimeProfile([0.0, line.length_m / 2, line.length_m], [0, 45 * MINUTE, HOUR])

    checkpoints = place_checkpoints(line, 25, profile)

    quarter = 25 * METERS_PER_MILE / (line.length_m / 2)
    assert checkpoints[1].drive_time_s == pytest.approx(quarter * 45 * MINUTE)
    assert checkpoints[-1].drive_time_s == HOUR


def test_a_route_shorter_than_the_interval_has_origin_and_destination():
    line = straight_route()

    checkpoints = place_checkpoints(line, 100, constant_speed(line, 1))

    assert [c.distance_m for c in checkpoints] == [0.0, line.length_m]
    assert [c.covered_m for c in checkpoints] == pytest.approx([line.length_m / 2] * 2)


def test_travel_time_profile_rejects_bad_samples():
    with pytest.raises(ValueError):
        TravelTimeProfile([0.0], [0.0])
    with pytest.raises(ValueError):
        TravelTimeProfile([0.0, 10.0, 5.0], [0.0, 1.0, 2.0])


# Rest stops


def drive(hours: int, minutes: int = 0) -> float:
    return hours * HOUR + minutes * MINUTE


@pytest.mark.parametrize(
    ("driving", "expected"),
    [
        (drive(7, 59), drive(7, 59)),
        (drive(8, 0), drive(8, 0)),
        (drive(8, 1), drive(8, 31)),
        (drive(11, 0), drive(11, 30)),
        (drive(11, 1), drive(21, 31)),
        (drive(19, 1), drive(30, 1)),
        (drive(45), drive(87)),
    ],
)
def test_eta_with_rest_breaks(driving, expected):
    # Stops are planned for the whole trip; a checkpoint only counts earlier ones.
    stops = planned_stops(drive(60))

    assert elapsed_s(driving, stops) == expected


def test_eta_without_rest_breaks_is_the_driving_time():
    assert elapsed_s(drive(8, 1), []) == drive(8, 1)


def test_a_trip_of_exactly_eleven_hours_needs_no_rest():
    stops = planned_stops(drive(11))

    assert [s.kind for s in stops] == [StopKind.BREAK]
    assert elapsed_s(drive(11), stops) == drive(11, 30)


def test_stops_alternate_breaks_and_rests():
    stops = planned_stops(drive(25))

    assert [(s.kind, s.drive_time_s / HOUR) for s in stops] == [
        (StopKind.BREAK, 8),
        (StopKind.REST, 11),
        (StopKind.BREAK, 19),
        (StopKind.REST, 22),
    ]


def test_eta_grows_strictly_with_driving_time():
    stops = planned_stops(drive(60))
    etas = [elapsed_s(minute * MINUTE, stops) for minute in range(60 * 60)]

    assert all(a < b for a, b in zip(etas, etas[1:], strict=False))


# Time zones


def test_time_zone_comes_from_coordinates():
    assert timezone_at(DALLAS) == ZoneInfo("America/Chicago")
    assert timezone_at(DENVER) == ZoneInfo("America/Denver")


def test_departure_is_read_as_local_time_at_the_origin():
    assert departure_utc(datetime(2026, 11, 2, 6, 0), DALLAS) == datetime(
        2026, 11, 2, 12, 0, tzinfo=UTC
    )


def test_arrival_across_the_fall_back_change_keeps_real_hours():
    departure = departure_utc(datetime(2026, 10, 31, 22, 0), DALLAS)

    arrives = arrival(departure, 6 * HOUR, [])

    assert arrives == datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
    local = arrives.astimezone(ZoneInfo("America/Chicago"))
    assert (local.hour, local.tzname()) == (3, "CST")


def test_a_repeated_fall_back_time_resolves_to_its_first_occurrence():
    assert departure_utc(datetime(2026, 11, 1, 1, 30), DALLAS) == datetime(
        2026, 11, 1, 6, 30, tzinfo=UTC
    )


def test_departure_must_be_wall_clock_time():
    with pytest.raises(ValueError):
        departure_utc(datetime(2026, 11, 2, 6, 0, tzinfo=UTC), DALLAS)


def test_arrival_adds_stops_to_the_clock():
    departure = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)

    assert arrival(departure, drive(12), planned_stops(drive(12))) == departure + timedelta(
        hours=22, minutes=30
    )

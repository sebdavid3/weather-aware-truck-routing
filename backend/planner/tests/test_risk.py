"""Boundary cases from docs/weather-risk-decisions.md, one row per edge."""

import pytest

from planner.risk import (
    Conditions,
    RiskLevel,
    assess,
    classify_rain,
    classify_snow,
    classify_wind,
    classify_wind_with_load,
)

LOW = RiskLevel.LOW
MODERATE = RiskLevel.MODERATE
HIGH = RiskLevel.HIGH
SEVERE = RiskLevel.SEVERE
NO_TRAVEL = RiskLevel.NO_TRAVEL


@pytest.mark.parametrize(
    ("speed_mph", "expected"),
    [
        (0.0, LOW),
        (24.9, LOW),
        (25.0, MODERATE),
        (34.5, MODERATE),  # Falls between the brief's integer ranges 25–34 and 35–44.
        (34.9, MODERATE),
        (35.0, HIGH),
        (44.9, HIGH),
        (45.0, SEVERE),
        (54.9, SEVERE),
        (55.0, NO_TRAVEL),
        (80.0, NO_TRAVEL),
    ],
)
def test_classify_wind(speed_mph, expected):
    assert classify_wind(speed_mph) == expected


@pytest.mark.parametrize(
    ("rate", "expected"),
    [
        (0.0, LOW),
        (0.099, LOW),
        (0.10, MODERATE),
        (0.249, MODERATE),
        (0.25, HIGH),
        (0.499, HIGH),
        (0.50, SEVERE),
        (1.00, SEVERE),
        (1.004, NO_TRAVEL),
    ],
)
def test_classify_rain(rate, expected):
    assert classify_rain(rate) == expected


@pytest.mark.parametrize(
    ("rate", "expected"),
    [
        (0.0, LOW),
        (0.49, LOW),
        (0.5, MODERATE),
        (0.99, MODERATE),
        (1.0, HIGH),
        (1.99, HIGH),
        (2.0, SEVERE),
        (3.0, SEVERE),
        (3.01, NO_TRAVEL),
    ],
)
def test_classify_snow(rate, expected):
    assert classify_snow(rate) == expected


@pytest.mark.parametrize(
    ("speed_mph", "load_lb", "expected"),
    [
        (45.0, 30_000, SEVERE),
        (45.0, 30_001, NO_TRAVEL),
        (54.9, 30_001, NO_TRAVEL),
        (35.0, 40_000, HIGH),
        (35.0, 40_001, SEVERE),
        (44.9, 40_001, SEVERE),
        (40.0, 35_000, HIGH),  # Over 30,000 lb but below the 35–44 mph rule's 40,000 lb.
        (34.9, 50_000, MODERATE),
        (55.0, 0, NO_TRAVEL),
        (10.0, 80_000, LOW),
    ],
)
def test_classify_wind_with_load(speed_mph, load_lb, expected):
    assert classify_wind_with_load(speed_mph, load_lb) == expected


def test_assess_takes_the_worst_condition():
    result = assess(Conditions(wind_mph=10.0, rain_in_per_hr=0.30, snow_in_per_hr=0.6), 20_000)

    assert result.wind == LOW
    assert result.rain == HIGH
    assert result.snow == MODERATE
    assert result.level == HIGH


def test_load_rules_only_raise_wind():
    result = assess(Conditions(wind_mph=10.0, rain_in_per_hr=0.60, snow_in_per_hr=0.0), 80_000)

    assert result.wind == LOW
    assert result.rain == SEVERE
    assert result.level == SEVERE


def test_load_can_make_wind_the_deciding_condition():
    result = assess(Conditions(wind_mph=40.0, rain_in_per_hr=0.30, snow_in_per_hr=0.0), 45_000)

    assert result.wind == SEVERE
    assert result.rain == HIGH
    assert result.level == SEVERE


def test_levels_are_ordered_from_best_to_worst():
    assert [level.value for level in (LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL)] == [0, 1, 2, 3, 4]

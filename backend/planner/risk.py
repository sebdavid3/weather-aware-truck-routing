"""Weather risk classification for a single checkpoint.

Thresholds and edge handling follow docs/weather-risk-decisions.md. Every
function here is pure: no I/O, no clock, no settings.
"""

from dataclasses import dataclass
from enum import IntEnum


class RiskLevel(IntEnum):
    """Risk levels, ordered from best to worst.

    The order lets max() pick the worst level, and the value is the score
    used for a route's average risk.
    """

    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4


@dataclass(frozen=True)
class Conditions:
    """Forecast at a checkpoint for the hour the truck passes it."""

    wind_mph: float
    rain_in_per_hr: float
    snow_in_per_hr: float


@dataclass(frozen=True)
class RiskAssessment:
    """A checkpoint's level and the level of each condition behind it."""

    level: RiskLevel
    wind: RiskLevel
    rain: RiskLevel
    snow: RiskLevel


def classify_wind(speed_mph: float) -> RiskLevel:
    if speed_mph >= 55:
        return RiskLevel.NO_TRAVEL
    if speed_mph >= 45:
        return RiskLevel.SEVERE
    if speed_mph >= 35:
        return RiskLevel.HIGH
    if speed_mph >= 25:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_rain(rate_in_per_hr: float) -> RiskLevel:
    # No Travel is strict (> 1.00), so Severe includes 1.00 itself.
    if rate_in_per_hr > 1.00:
        return RiskLevel.NO_TRAVEL
    if rate_in_per_hr >= 0.50:
        return RiskLevel.SEVERE
    if rate_in_per_hr >= 0.25:
        return RiskLevel.HIGH
    if rate_in_per_hr >= 0.10:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_snow(rate_in_per_hr: float) -> RiskLevel:
    # No Travel is strict (> 3.0), so Severe includes 3.0 itself.
    if rate_in_per_hr > 3.0:
        return RiskLevel.NO_TRAVEL
    if rate_in_per_hr >= 2.0:
        return RiskLevel.SEVERE
    if rate_in_per_hr >= 1.0:
        return RiskLevel.HIGH
    if rate_in_per_hr >= 0.5:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_wind_with_load(speed_mph: float, load_lb: float) -> RiskLevel:
    """Wind level after the load rules, which can only raise it."""
    if 45 <= speed_mph < 55 and load_lb > 30_000:
        return RiskLevel.NO_TRAVEL
    if 35 <= speed_mph < 45 and load_lb > 40_000:
        return RiskLevel.SEVERE
    return classify_wind(speed_mph)


def assess(conditions: Conditions, load_lb: float) -> RiskAssessment:
    """Classify each condition; the checkpoint takes the worst of them."""
    wind = classify_wind_with_load(conditions.wind_mph, load_lb)
    rain = classify_rain(conditions.rain_in_per_hr)
    snow = classify_snow(conditions.snow_in_per_hr)
    return RiskAssessment(level=max(wind, rain, snow), wind=wind, rain=rain, snow=snow)

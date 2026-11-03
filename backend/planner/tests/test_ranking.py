"""Ranking cases from docs/weather-risk-decisions.md, plus summaries and explanations."""

import pytest

from planner.ranking import (
    NO_TRAVEL_WARNING,
    RouteSummary,
    explain,
    rank,
    recommendation_reasons,
    summarize,
    warning,
)
from planner.risk import RiskLevel

LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL = RiskLevel


def summary(
    name: str,
    *,
    no_travel: int = 0,
    severe: int = 0,
    high: int = 0,
    average: float = 0.0,
    minutes: int = 600,
) -> RouteSummary:
    miles = dict.fromkeys(RiskLevel, 0) | {NO_TRAVEL: no_travel, SEVERE: severe, HIGH: high}
    return RouteSummary(name, miles, average, LOW, minutes)


# Summaries


def test_summarize_adds_miles_per_level_and_weights_the_average():
    result = summarize("A", [(LOW, 50.0), (HIGH, 25.0), (LOW, 12.5), (SEVERE, 12.5)], 3600 * 2.5)

    assert result.miles_by_level == {
        LOW: 63,  # Halves round up: 62.5 -> 63.
        MODERATE: 0,
        HIGH: 25,
        SEVERE: 13,
        NO_TRAVEL: 0,
    }
    # (2 x 25 + 3 x 12.5) / 100 = 0.875
    assert result.average_risk == 0.9
    assert result.worst_level == SEVERE
    assert result.duration_minutes == 150


def test_a_short_stretch_of_a_level_still_counts_as_a_mile():
    # A destination checkpoint can cover under a mile; rounding it to 0 would hide it.
    result = summarize("A", [(LOW, 50.0), (LOW, 50.4), (NO_TRAVEL, 0.4)], 3600)

    assert result.miles_by_level[NO_TRAVEL] == 1
    assert warning([result]) == NO_TRAVEL_WARNING


def test_a_hidden_no_travel_stretch_cannot_win_on_time():
    risky = summarize("A", [(LOW, 100.4), (NO_TRAVEL, 0.4)], 3600)
    clean = summarize("B", [(LOW, 100.8)], 4200)

    assert [s.name for s in rank([risky, clean])] == ["B", "A"]


def test_average_risk_rounds_halves_up():
    # 0.25 is stored as 0.2499999...; it still shows, and ranks, as 0.3.
    result = summarize("A", [(MODERATE, 25.0), (LOW, 75.0)], 3600)

    assert result.average_risk == 0.3


def test_summarize_an_all_low_route():
    result = summarize("A", [(LOW, 10.0), (LOW, 10.0)], 1200)

    assert result.average_risk == 0.0
    assert result.worst_level == LOW


# Ranking


def test_no_travel_miles_come_first():
    a = summary("A", no_travel=10)
    b = summary("B", severe=50)

    assert [s.name for s in rank([a, b])] == ["B", "A"]


def test_average_risk_ties_at_display_precision_so_time_decides():
    # 0.82 and 0.79 both display as 0.8; A is 3 h faster.
    a = summary("A", average=round(0.82, 1), minutes=600)
    b = summary("B", average=round(0.79, 1), minutes=780)

    assert [s.name for s in rank([b, a])] == ["A", "B"]


def test_a_visible_average_risk_difference_beats_travel_time():
    a = summary("A", average=round(0.86, 1), minutes=600)
    b = summary("B", average=round(0.79, 1), minutes=900)

    assert [s.name for s in rank([a, b])] == ["B", "A"]


def test_severe_then_high_miles_decide_before_average_risk():
    a = summary("A", severe=10, average=0.1)
    b = summary("B", severe=0, high=40, average=1.5)
    c = summary("C", severe=0, high=20, average=2.0)

    assert [s.name for s in rank([a, b, c])] == ["C", "B", "A"]


def test_full_ties_keep_the_router_order():
    a, b = summary("A"), summary("B")

    assert [s.name for s in rank([a, b])] == ["A", "B"]


# Explanations


@pytest.mark.parametrize(
    ("winner", "other", "expected"),
    [
        (
            summary("A", no_travel=0, severe=50),
            summary("B", no_travel=10),
            "10 fewer No Travel miles than Route B",
        ),
        (
            summary("A", severe=10, high=5),
            summary("B", severe=10, high=30),
            "same Severe miles as Route B; 25 fewer High miles",
        ),
        (
            summary("A", average=0.4),
            summary("B", average=0.8),
            "lower average risk than Route B (0.4 vs 0.8)",
        ),
        (
            summary("A", average=0.8, minutes=600),
            summary("B", average=0.8, minutes=785),
            "same average risk as Route B; 3 h 5 min faster",
        ),
        (
            summary("A", severe=1_200),
            summary("B", severe=2_450),
            "1,250 fewer Severe miles than Route B",
        ),
        (
            summary("A", no_travel=5, severe=20, high=40, average=1.2, minutes=600),
            summary("B", no_travel=5, severe=20, high=40, average=1.2, minutes=640),
            "same No Travel, Severe and High miles and average risk as Route B; 40 min faster",
        ),
        (
            summary("A"),
            summary("B"),
            "ties with Route B on every criterion; the router listed it first",
        ),
    ],
)
def test_explain_names_the_deciding_criterion(winner, other, expected):
    assert explain(winner, other) == expected


def test_recommendation_reasons_compare_the_winner_with_each_other_route():
    ranked = rank([summary("A", high=30), summary("B", high=0), summary("C", severe=5)])

    assert recommendation_reasons(ranked) == [
        "30 fewer High miles than Route A",
        "5 fewer Severe miles than Route C",
    ]


def test_warning_only_when_the_winner_has_no_travel_miles():
    assert (
        warning(rank([summary("A", no_travel=5), summary("B", no_travel=8)])) == NO_TRAVEL_WARNING
    )
    assert warning(rank([summary("A", severe=5)])) is None

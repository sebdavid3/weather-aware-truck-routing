"""Route summaries, the recommendation order and why the winner won.

The order follows docs/weather-risk-decisions.md: No Travel miles, Severe
miles, High miles, average risk, then travel time, each compared at the
precision the UI shows.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from planner.risk import RiskLevel

NO_TRAVEL_WARNING = (
    "Every route has No Travel conditions at this departure time. Consider leaving at another time."
)


@dataclass(frozen=True)
class RouteSummary:
    """A route's totals, rounded to what the UI shows; ranking uses these same values."""

    name: str
    miles_by_level: dict[RiskLevel, int]
    average_risk: float
    worst_level: RiskLevel
    duration_minutes: int

    @property
    def key(self) -> tuple[int, int, int, float, int]:
        miles = self.miles_by_level
        return (
            miles[RiskLevel.NO_TRAVEL],
            miles[RiskLevel.SEVERE],
            miles[RiskLevel.HIGH],
            self.average_risk,
            self.duration_minutes,
        )


def summarize(
    name: str, covered: Iterable[tuple[RiskLevel, float]], duration_s: float
) -> RouteSummary:
    """Totals from each checkpoint's (level, miles covered)."""
    exact = dict.fromkeys(RiskLevel, 0.0)
    for level, miles in covered:
        exact[level] += miles
    total = sum(exact.values())
    average = sum(level.value * miles for level, miles in exact.items()) / total if total else 0.0
    return RouteSummary(
        name=name,
        miles_by_level={level: round(miles) for level, miles in exact.items()},
        average_risk=round(average, 1),
        worst_level=max(
            (level for level, miles in exact.items() if miles > 0), default=RiskLevel.LOW
        ),
        duration_minutes=round(duration_s / 60),
    )


def rank(summaries: Sequence[RouteSummary]) -> list[RouteSummary]:
    """Best first. The sort is stable, so full ties keep the router's order."""
    return sorted(summaries, key=lambda summary: summary.key)


# Each criterion: its label and how a better value reads against a worse one.
CRITERIA = (
    ("No Travel miles", "fewer"),
    ("Severe miles", "fewer"),
    ("High miles", "fewer"),
    ("average risk", "lower"),
    ("travel time", "shorter"),
)


def explain(winner: RouteSummary, other: RouteSummary) -> str:
    """Why `winner` ranks above `other`, naming the criterion that decided."""
    same = []
    for (label, better), mine, theirs in zip(CRITERIA, winner.key, other.key, strict=True):
        if mine == theirs:
            # "Same 0 Severe miles" says nothing; only shared nonzero miles are worth naming.
            if not (label.endswith(" miles") and mine == 0):
                same.append(label)
        elif same:
            decided = _difference(label, better, mine, theirs)
            return f"same {_join(same)} as Route {other.name}; {decided}"
        else:
            return _difference(label, better, mine, theirs, versus=f"Route {other.name}")
    return f"ties with Route {other.name} on every criterion; the router listed it first"


def recommendation_reasons(ranked: Sequence[RouteSummary]) -> list[str]:
    winner = ranked[0]
    return [_capitalize(explain(winner, other)) for other in ranked[1:]]


def warning(ranked: Sequence[RouteSummary]) -> str | None:
    return NO_TRAVEL_WARNING if ranked[0].miles_by_level[RiskLevel.NO_TRAVEL] > 0 else None


def _difference(label: str, better: str, mine: float, theirs: float, versus: str = "") -> str:
    than = f" than {versus}" if versus else ""
    if label == "average risk":
        return f"lower average risk{than} ({mine:.1f} vs {theirs:.1f})"
    if label == "travel time":
        return f"{_format_minutes(theirs - mine)} faster{than}"
    return f"{theirs - mine:,} {better} {label}{than}"


def _format_minutes(minutes: float) -> str:
    hours, rest = divmod(int(minutes), 60)
    if hours and rest:
        return f"{hours} h {rest} min"
    return f"{hours} h" if hours else f"{rest} min"


def _join(labels: list[str]) -> str:
    """["No Travel miles", "Severe miles"] -> "No Travel and Severe miles"."""
    miles = [label.removesuffix(" miles") for label in labels if label.endswith(" miles")]
    others = [label for label in labels if not label.endswith(" miles")]
    return _list([f"{_list(miles)} miles", *others] if miles else others)


def _list(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]

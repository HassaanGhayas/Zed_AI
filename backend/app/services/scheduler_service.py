"""Spaced-repetition scheduler (SM-2 / FSRS-lite). Pure functions, no I/O.

Memory model: recall decays as R(t) = 0.7 ** (t / S), where S is the stability
in days, so R is exactly AT_RISK_RECALL (0.70) when a review becomes due
(`stability_days` after the last one). A successful review grows S; a failed
one resets it. Scheduler, summary and curve all use this same formula.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

AT_RISK_RECALL = 0.70
MIN_STABILITY_DAYS = 1.0
MAX_STABILITY_DAYS = 365.0
HIGH_REPS = 5
SUCCESS_STATUS = "CORRECT"


@dataclass(frozen=True)
class ConceptState:
    strength: float
    stability_days: float
    reps: int
    lapses: int
    last_reviewed: datetime
    next_due: datetime


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def predicted_recall(stability_days: float, last_reviewed: Optional[datetime], now: datetime) -> float:
    """Predicted recall now: 0.7 ** (elapsed_days / stability). 0.0 if never reviewed."""
    if last_reviewed is None:
        return 0.0
    stability = max(float(stability_days or 0.0), 0.01)
    elapsed_days = max((_utc(now) - _utc(last_reviewed)).total_seconds() / 86400.0, 0.0)
    return AT_RISK_RECALL ** (elapsed_days / stability)


def growth_factor(score: int) -> float:
    """Stability multiplier for a successful review: 1.5 (score 0) .. 3.0 (score 100)."""
    return 1.5 + _clamp(score, 0, 100) / 100.0 * 1.5


def update(
    strength: float,
    stability_days: float,
    reps: int,
    lapses: int,
    status: str,
    score: int,
    now: datetime,
    last_reviewed: Optional[datetime] = None,
) -> ConceptState:
    """Apply one review and return the new state including `next_due`.

    `last_reviewed` (optional) lets the current recall be computed from decay;
    without it the stored `strength` is used as the current recall.
    """
    now = _utc(now)
    score = int(_clamp(score, 0, 100))
    stability = max(float(stability_days or MIN_STABILITY_DAYS), 0.01)
    reps = max(int(reps or 0), 0)
    lapses = max(int(lapses or 0), 0)

    if last_reviewed is not None:
        current = predicted_recall(stability, last_reviewed, now)
    else:
        current = _clamp(float(strength or 0.0), 0.0, 1.0)

    if status == SUCCESS_STATUS:
        new_stability = _clamp(stability * growth_factor(score), MIN_STABILITY_DAYS, MAX_STABILITY_DAYS)
        new_reps = reps + 1
        new_lapses = lapses
        # Refresh towards the demonstrated score, keeping some memory of prior recall.
        if reps == 0:
            # First review: no prior memory to blend with; seed from the score.
            new_strength = score / 100.0
        else:
            new_strength = 0.4 * current + 0.6 * (score / 100.0)
    else:
        new_lapses = lapses + 1
        new_reps = 0
        new_stability = max(MIN_STABILITY_DAYS, stability / 2.0) if reps >= HIGH_REPS else MIN_STABILITY_DAYS
        if reps == 0:
            new_strength = score / 100.0
        else:
            new_strength = 0.3 * current + 0.7 * (score / 100.0)

    return ConceptState(
        strength=round(_clamp(new_strength, 0.0, 1.0), 4),
        stability_days=round(new_stability, 4),
        reps=new_reps,
        lapses=new_lapses,
        last_reviewed=now,
        next_due=now + timedelta(days=new_stability),
    )


def is_at_risk(
    stability_days: float,
    last_reviewed: Optional[datetime],
    next_due: Optional[datetime],
    now: datetime,
) -> bool:
    """At risk when predicted recall < 0.70 or the review is overdue."""
    if last_reviewed is None and next_due is None:
        return False
    if next_due is not None and _utc(next_due) < _utc(now):
        return True
    return last_reviewed is not None and predicted_recall(stability_days, last_reviewed, now) < AT_RISK_RECALL

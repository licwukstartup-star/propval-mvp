"""
Similarity scoring engine for comparable properties.

Scores each candidate against the subject property across multiple dimensions.
Higher score = more similar = less adjustment needed.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


# ── Dimension weights ──
DEFAULT_WEIGHTS = {
    "distance":       0.20,
    "recency":        0.15,
    "size":           0.20,
    "bedrooms":       0.10,
    "age":            0.05,
    "epc":            0.10,
    "imd":            0.10,
    "tier":           0.05,
    "completeness":   0.05,
}

# Tier score lookup
TIER_SCORES = {1: 1.0, 2: 0.75, 3: 0.50, 4: 0.25}


@dataclass
class ScoreBreakdown:
    """Per-dimension scores (0-1) and the composite result."""
    distance:     float | None = None
    recency:      float | None = None
    size:         float | None = None
    bedrooms:     float | None = None
    age:          float | None = None
    epc:          float | None = None
    imd:          float | None = None
    tier:         float | None = None
    completeness: float | None = None
    composite:    float = 0.0

    def to_dict(self) -> dict[str, float | None]:
        return {
            "distance": self.distance,
            "recency": self.recency,
            "size": self.size,
            "bedrooms": self.bedrooms,
            "age": self.age,
            "epc": self.epc,
            "imd": self.imd,
            "tier": self.tier,
            "completeness": self.completeness,
            "composite": self.composite,
        }


def _safe_val(obj: Any, key: str) -> float | int | None:
    """Extract a numeric value from a dict or pydantic model."""
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _dim_distance(comp: Any, _subj: Any) -> float | None:
    d = _safe_val(comp, "distance_m")
    if d is None:
        return None
    return max(0.0, 1.0 - min(d / 2000.0, 1.0))


def _dim_recency(comp: Any, _subj: Any) -> float | None:
    m = _safe_val(comp, "months_ago")
    if m is None:
        return None
    return max(0.0, 1.0 - min(m / 36.0, 1.0))


def _dim_size(comp: Any, subj: Any) -> float | None:
    c = _safe_val(comp, "floor_area_sqm")
    s = _safe_val(subj, "floor_area_sqm")
    if c is None or s is None or s <= 0:
        return None
    return max(0.0, 1.0 - min(abs(c - s) / s, 1.0))


def _dim_bedrooms(comp: Any, subj: Any) -> float | None:
    c = _safe_val(comp, "bedrooms")
    s = _safe_val(subj, "bedrooms")
    if c is None or s is None:
        return None
    return max(0.0, 1.0 - min(abs(c - s) / 3.0, 1.0))


def _dim_age(comp: Any, subj: Any) -> float | None:
    c = _safe_val(comp, "build_year") or _safe_val(comp, "construction_age_best")
    s = _safe_val(subj, "build_year") or _safe_val(subj, "construction_age_best")
    if c is None or s is None:
        return None
    return max(0.0, 1.0 - min(abs(c - s) / 100.0, 1.0))


def _dim_epc(comp: Any, subj: Any) -> float | None:
    c = _safe_val(comp, "epc_score")
    s = _safe_val(subj, "epc_score")
    if c is None or s is None:
        return None
    return max(0.0, 1.0 - min(abs(c - s) / 50.0, 1.0))


def _dim_imd(comp: Any, subj: Any) -> float | None:
    c = _safe_val(comp, "imd_decile")
    s = _safe_val(subj, "imd_decile")
    if c is None or s is None:
        return None
    return max(0.0, 1.0 - min(abs(c - s) / 5.0, 1.0))


def _dim_tier(comp: Any, _subj: Any) -> float | None:
    t = _safe_val(comp, "geographic_tier")
    if t is None:
        return None
    return TIER_SCORES.get(int(t), 0.25)


def _dim_completeness(comp: Any, _subj: Any) -> float:
    fields = ["floor_area_sqm", "epc_score", "imd_decile", "bedrooms", "build_year"]
    present = sum(1 for f in fields if _safe_val(comp, f) is not None)
    return present / len(fields)


# Map dimension names to scorer functions
_SCORERS = {
    "distance":     _dim_distance,
    "recency":      _dim_recency,
    "size":         _dim_size,
    "bedrooms":     _dim_bedrooms,
    "age":          _dim_age,
    "epc":          _dim_epc,
    "imd":          _dim_imd,
    "tier":         _dim_tier,
    "completeness": _dim_completeness,
}


def score_comparable(
    comp: Any,
    subject: Any,
    weights: dict[str, float] | None = None,
) -> ScoreBreakdown:
    """Score a single comparable against the subject property.

    Args:
        comp: Comparable candidate (dict or pydantic model).
        subject: Subject property (dict or pydantic model).
        weights: Optional weight overrides per dimension.

    Returns:
        ScoreBreakdown with per-dimension and composite scores.
    """
    w = weights or DEFAULT_WEIGHTS
    breakdown = ScoreBreakdown()

    total_weight = 0.0
    weighted_sum = 0.0

    for dim_name, scorer in _SCORERS.items():
        raw_score = scorer(comp, subject)
        setattr(breakdown, dim_name, raw_score)

        dim_weight = w.get(dim_name, 0.0)
        if raw_score is None:
            # Missing data: redistribute weight
            continue
        total_weight += dim_weight
        weighted_sum += raw_score * dim_weight

    breakdown.composite = weighted_sum / total_weight if total_weight > 0 else 0.0
    return breakdown


def score_pool(
    comparables: list[Any],
    subject: Any,
    weights: dict[str, float] | None = None,
) -> list[tuple[Any, ScoreBreakdown]]:
    """Score all comparables in a pool and return sorted by composite score (desc).

    Returns:
        List of (comparable, ScoreBreakdown) tuples, highest score first.
    """
    scored = [
        (comp, score_comparable(comp, subject, weights))
        for comp in comparables
    ]
    scored.sort(key=lambda x: x[1].composite, reverse=True)
    return scored

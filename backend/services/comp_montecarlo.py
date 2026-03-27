"""
Monte Carlo Comparable Adjustment Engine.

Runs N iterations, each time:
  1. Sampling 5 comps from the pool (weighted by similarity score)
  2. Sampling adjustment coefficients from borough-specific LR distributions
  3. Applying adjustments to derive adjusted PSF per comp
  4. Reconciling 5 adjusted values into one implied MV

The output is a distribution of MVs representing the uncertainty in both
comp selection and adjustment magnitude.
"""

from __future__ import annotations
import math
import numpy as np
from dataclasses import dataclass, field
from typing import Any

from .comp_scoring import ScoreBreakdown, score_pool
from .lr_coefficients import AdjustmentCoeffs, load_coefficients


# ── EPC ordinal mapping ──
EPC_ORD = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7}


@dataclass
class CompAdjustment:
    """Adjustment breakdown for a single comparable."""
    transaction_id: str | None
    address:        str
    postcode:       str
    price:          int
    floor_area_sqm: float
    raw_psf:        float
    time_adj_pct:   float
    size_adj_pct:   float
    rooms_adj_pct:  float
    epc_adj_pct:    float
    imd_adj_pct:    float
    age_adj_pct:    float
    total_adj_pct:  float
    adjusted_psf:   float
    implied_mv:     float
    similarity:     float

    def to_dict(self) -> dict:
        return {
            "transaction_id": self.transaction_id,
            "address": self.address,
            "postcode": self.postcode,
            "price": self.price,
            "floor_area_sqm": self.floor_area_sqm,
            "raw_psf": round(self.raw_psf, 2),
            "time_adj_pct": round(self.time_adj_pct * 100, 2),
            "size_adj_pct": round(self.size_adj_pct * 100, 2),
            "rooms_adj_pct": round(self.rooms_adj_pct * 100, 2),
            "epc_adj_pct": round(self.epc_adj_pct * 100, 2),
            "imd_adj_pct": round(self.imd_adj_pct * 100, 2),
            "age_adj_pct": round(self.age_adj_pct * 100, 2),
            "total_adj_pct": round(self.total_adj_pct * 100, 2),
            "adjusted_psf": round(self.adjusted_psf, 2),
            "implied_mv": round(self.implied_mv),
            "similarity": round(self.similarity, 4),
        }


@dataclass
class MCResult:
    """Full Monte Carlo simulation result."""
    iterations:          int
    best_5:              list[CompAdjustment]  # modal best 5 with median adjustments
    valuation:           dict[str, float]      # median, mean, p5, p25, p75, p95, std
    histogram:           list[dict]            # [{bin_center, count, density}] for chart
    selection_frequency: list[dict]            # [{transaction_id, address, frequency, similarity}]
    coefficients_used:   dict                  # borough LR coefficients for transparency

    def to_dict(self) -> dict:
        return {
            "iterations": self.iterations,
            "best_5": [c.to_dict() for c in self.best_5],
            "valuation": {k: round(v) if k != "std" else round(v, 2) for k, v in self.valuation.items()},
            "histogram": self.histogram,
            "selection_frequency": self.selection_frequency,
            "coefficients_used": self.coefficients_used,
        }


def _safe(obj: Any, key: str, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _epc_ord(rating: str | None) -> int | None:
    if not rating:
        return None
    return EPC_ORD.get(rating.strip().upper())


def _compute_comp_adjustment(
    comp: Any,
    subject: Any,
    coeffs: AdjustmentCoeffs,
    rng: np.random.Generator,
    hpi_factor: float = 1.0,
) -> tuple[float, dict[str, float]]:
    """Compute adjusted PSF for one comp in one MC iteration.

    Returns (adjusted_psf, adjustment_pcts_dict).
    """
    comp_sqm = _safe(comp, "floor_area_sqm")
    subj_sqm = _safe(subject, "floor_area_sqm")
    comp_price = _safe(comp, "price", 0)

    if not comp_sqm or comp_sqm <= 0 or not subj_sqm or subj_sqm <= 0:
        return 0.0, {}

    raw_psf = comp_price / comp_sqm

    # ── Sample coefficients from Normal(coeff, SE) ──
    se_frac = coeffs.se_fraction

    # Time adjustment: HPI-based with sampled correlation
    time_corr = rng.uniform(0.3, 1.0)
    time_adj = (hpi_factor - 1.0) * time_corr

    # Size adjustment: use log_floor_area coefficient
    # In log space: delta = coeff * (log(comp_sqm) - log(subj_sqm))
    # We want adjustment FROM comp TO subject, so negate
    size_coeff = rng.normal(coeffs.log_floor_area, abs(coeffs.log_floor_area) * se_frac)
    log_size_diff = math.log(comp_sqm) - math.log(subj_sqm)
    # Positive log_size_diff means comp is bigger → subject should be worth less per sqm?
    # Actually: LR coeff on log_floor_area predicts log(price).
    # If comp is bigger, its price includes extra size.  To adjust PSF to subject size:
    # We want PSF as if comp were subject's size.
    # adj_factor = exp(size_coeff * (log(subj_sqm) - log(comp_sqm)))
    size_adj = math.exp(size_coeff * (math.log(subj_sqm) - math.log(comp_sqm))) - 1.0

    # Rooms adjustment
    comp_rooms = _safe(comp, "bedrooms")
    subj_rooms = _safe(subject, "bedrooms")
    rooms_adj = 0.0
    if comp_rooms is not None and subj_rooms is not None and comp_rooms != subj_rooms:
        rooms_coeff = rng.normal(coeffs.rooms, abs(coeffs.rooms) * se_frac)
        # Positive coeff means more rooms = higher price
        # If subject has more rooms than comp, subject is worth more → positive adj
        rooms_adj = rooms_coeff * (subj_rooms - comp_rooms)

    # EPC adjustment
    comp_epc = _safe(comp, "epc_score") or 0
    subj_epc = _safe(subject, "epc_score") or 0
    epc_adj = 0.0
    if comp_epc and subj_epc and comp_epc != subj_epc:
        # epc_ord coefficient is per ordinal band (A=1, G=7)
        # epc_score is 1-100, roughly 14 points per band
        epc_coeff = rng.normal(coeffs.epc_ord, abs(coeffs.epc_ord) * se_frac)
        # Lower epc_ord = better rating = higher price (coeff is typically negative)
        # Convert score diff to approx band diff
        band_diff = (comp_epc - subj_epc) / 14.0
        # If subject has higher score (better), comp's band is "worse" → positive adj
        epc_adj = -epc_coeff * band_diff  # negate because lower ord = better

    # IMD adjustment (houses have imd_norm; for flats use postcode_encoded as proxy)
    comp_imd = _safe(comp, "imd_decile")
    subj_imd = _safe(subject, "imd_decile")
    imd_adj = 0.0
    if comp_imd is not None and subj_imd is not None and comp_imd != subj_imd and coeffs.imd_norm != 0:
        imd_coeff = rng.normal(coeffs.imd_norm, abs(coeffs.imd_norm) * se_frac)
        # imd_norm: higher = less deprived = higher price (positive coeff)
        # imd_decile: 1=most deprived, 10=least deprived
        # Normalise decile diff to ~0-1 scale (÷10)
        imd_diff = (subj_imd - comp_imd) / 10.0
        imd_adj = imd_coeff * imd_diff

    # Age/build year adjustment
    comp_year = _safe(comp, "build_year") or _safe(comp, "construction_age_best")
    subj_year = _safe(subject, "build_year") or _safe(subject, "construction_age_best")
    age_adj = 0.0
    if comp_year and subj_year and comp_year != subj_year:
        year_coeff = rng.normal(coeffs.build_year, abs(coeffs.build_year) * se_frac)
        age_adj = year_coeff * (subj_year - comp_year)

    # Total multiplicative adjustment (in log space, additive)
    total_adj = time_adj + size_adj + rooms_adj + epc_adj + imd_adj + age_adj

    # Cap: don't let total adjustment exceed ±50%
    total_adj = max(-0.50, min(total_adj, 0.50))

    adjusted_psf = raw_psf * (1.0 + total_adj)

    adj_pcts = {
        "time": time_adj,
        "size": size_adj,
        "rooms": rooms_adj,
        "epc": epc_adj,
        "imd": imd_adj,
        "age": age_adj,
        "total": total_adj,
    }
    return adjusted_psf, adj_pcts


def run_simulation(
    comparables: list[Any],
    subject: Any,
    borough_slug: str,
    property_type: str,
    hpi_factor: float = 1.0,
    iterations: int = 50_000,
    top_n: int = 10,
    weights: dict[str, float] | None = None,
    params_dir: str | None = None,
    seed: int | None = None,
) -> MCResult:
    """Run the full Monte Carlo comparable adjustment simulation.

    Args:
        comparables: Pool of comparable candidates (dicts or pydantic models).
        subject: Subject property.
        borough_slug: e.g. "sutton" — determines which LR coefficients to use.
        property_type: "flat" or "house".
        hpi_factor: HPI adjustment factor (1.0 = no time change).
        iterations: Number of MC iterations.
        top_n: Number of comps to sample per iteration.
        weights: Optional scoring weight overrides.
        params_dir: Override path to params directory.
        seed: Random seed for reproducibility.

    Returns:
        MCResult with distribution and best-5 breakdown.
    """
    rng = np.random.default_rng(seed)

    # Load borough-specific coefficients
    coeffs = load_coefficients(borough_slug, property_type, params_dir)
    if coeffs is None:
        raise ValueError(f"No LR coefficients found for {borough_slug}/{property_type}")

    subj_sqm = _safe(subject, "floor_area_sqm")
    if not subj_sqm or subj_sqm <= 0:
        raise ValueError("Subject must have floor_area_sqm > 0")

    # Score the pool
    scored = score_pool(comparables, subject, weights)

    # Need at least top_n comps with floor area
    valid = [(c, s) for c, s in scored if _safe(c, "floor_area_sqm") and _safe(c, "floor_area_sqm") > 0]
    if len(valid) < 2:
        raise ValueError(f"Need at least 2 valid comparables, got {len(valid)}")

    actual_n = min(top_n, len(valid))

    # Build sampling weights from similarity scores
    comps_list = [c for c, _ in valid]
    scores_list = [s.composite for _, s in valid]
    scores_arr = np.array(scores_list)
    # Ensure no zero weights
    scores_arr = np.maximum(scores_arr, 0.01)
    probs = scores_arr / scores_arr.sum()

    # Track selection frequency and accumulated adjustments
    n_comps = len(comps_list)
    selection_count = np.zeros(n_comps, dtype=np.int64)
    # For median adjustments of the modal top-5
    adj_accum: dict[int, list[dict[str, float]]] = {i: [] for i in range(n_comps)}

    mv_samples = np.empty(iterations)

    for it in range(iterations):
        # Step A: Sample top_n comps without replacement
        indices = rng.choice(n_comps, size=actual_n, replace=False, p=probs)
        selection_count[indices] += 1

        # Step B+C: Adjust each sampled comp
        adjusted_mvs = []
        adjusted_weights = []

        for idx in indices:
            comp = comps_list[idx]
            adj_psf, adj_pcts = _compute_comp_adjustment(
                comp, subject, coeffs, rng, hpi_factor
            )
            if adj_psf > 0:
                implied_mv = adj_psf * subj_sqm
                adjusted_mvs.append(implied_mv)
                adjusted_weights.append(scores_list[idx])
                adj_accum[idx].append(adj_pcts)

        # Step D: Weighted average reconciliation
        if adjusted_mvs:
            w = np.array(adjusted_weights)
            w = w / w.sum()
            mv_samples[it] = np.average(adjusted_mvs, weights=w)
        else:
            mv_samples[it] = 0.0

    # Filter out zero MVs
    mv_valid = mv_samples[mv_samples > 0]
    if len(mv_valid) == 0:
        raise ValueError("All MC iterations produced zero MV — check input data")

    # ── Valuation distribution ──
    # Mode: peak of the density — use histogram binning to find densest region
    mode_bins = 100
    mode_counts, mode_edges = np.histogram(mv_valid, bins=mode_bins)
    mode_idx = int(np.argmax(mode_counts))
    mode_val = float((mode_edges[mode_idx] + mode_edges[mode_idx + 1]) / 2.0)
    # Round to nearest £1,000
    mode_val = round(mode_val / 1000) * 1000

    valuation = {
        "median": float(np.median(mv_valid)),
        "mean":   float(np.mean(mv_valid)),
        "mode":   mode_val,
        "p5":     float(np.percentile(mv_valid, 5)),
        "p10":    float(np.percentile(mv_valid, 10)),
        "p15":    float(np.percentile(mv_valid, 15)),
        "p25":    float(np.percentile(mv_valid, 25)),
        "p75":    float(np.percentile(mv_valid, 75)),
        "p85":    float(np.percentile(mv_valid, 85)),
        "p90":    float(np.percentile(mv_valid, 90)),
        "p95":    float(np.percentile(mv_valid, 95)),
        "std":    float(np.std(mv_valid)),
        "iterations_valid": int(len(mv_valid)),
    }

    # ── Selection frequency ──
    freq = selection_count / iterations
    freq_list = []
    for i in range(n_comps):
        freq_list.append({
            "transaction_id": _safe(comps_list[i], "transaction_id"),
            "address": _safe(comps_list[i], "address", ""),
            "frequency": round(float(freq[i]), 4),
            "similarity": round(scores_list[i], 4),
        })
    freq_list.sort(key=lambda x: x["frequency"], reverse=True)

    # ── Best 5: most frequently selected comps with median adjustments ──
    top_indices = np.argsort(selection_count)[::-1][:top_n]
    best_5 = []
    for idx in top_indices:
        comp = comps_list[idx]
        comp_sqm = _safe(comp, "floor_area_sqm") or 1
        raw_psf = (_safe(comp, "price", 0)) / comp_sqm

        # Median adjustments across all iterations this comp appeared
        adjs = adj_accum[idx]
        if adjs:
            med_time  = float(np.median([a["time"]  for a in adjs]))
            med_size  = float(np.median([a["size"]  for a in adjs]))
            med_rooms = float(np.median([a["rooms"] for a in adjs]))
            med_epc   = float(np.median([a["epc"]   for a in adjs]))
            med_imd   = float(np.median([a["imd"]   for a in adjs]))
            med_age   = float(np.median([a["age"]   for a in adjs]))
            med_total = float(np.median([a["total"] for a in adjs]))
        else:
            med_time = med_size = med_rooms = med_epc = med_imd = med_age = med_total = 0.0

        adj_psf = raw_psf * (1.0 + med_total)
        implied_mv = adj_psf * subj_sqm

        best_5.append(CompAdjustment(
            transaction_id=_safe(comp, "transaction_id"),
            address=_safe(comp, "address", ""),
            postcode=_safe(comp, "postcode", ""),
            price=_safe(comp, "price", 0),
            floor_area_sqm=comp_sqm,
            raw_psf=raw_psf,
            time_adj_pct=med_time,
            size_adj_pct=med_size,
            rooms_adj_pct=med_rooms,
            epc_adj_pct=med_epc,
            imd_adj_pct=med_imd,
            age_adj_pct=med_age,
            total_adj_pct=med_total,
            adjusted_psf=adj_psf,
            implied_mv=implied_mv,
            similarity=scores_list[idx],
        ))

    # ── Histogram for distribution chart (70 bins) ──
    n_bins = 70
    hist_min = float(np.min(mv_valid))
    hist_max = float(np.max(mv_valid))
    hist_range = hist_max - hist_min if hist_max > hist_min else 1.0
    bin_width = hist_range / n_bins
    counts, bin_edges = np.histogram(mv_valid, bins=n_bins)
    total_area = len(mv_valid) * bin_width
    histogram = []
    for i in range(n_bins):
        center = float(bin_edges[i] + bin_edges[i + 1]) / 2.0
        density = float(counts[i]) / total_area if total_area > 0 else 0.0
        histogram.append({
            "bin_center": round(center),
            "count": int(counts[i]),
            "density": round(density, 8),
        })

    return MCResult(
        iterations=iterations,
        best_5=best_5,
        valuation=valuation,
        histogram=histogram,
        selection_frequency=freq_list[:20],  # top 20 for transparency
        coefficients_used=coeffs.to_dict(),
    )

"""
Borough-specific LR coefficient loader for the Monte Carlo adjustment engine.

Reads pre-trained LR coefficients from Supabase `lr_model_coefficients` table.
Falls back to local JSON files if Supabase is unavailable.

The LR operates in log-price space, so raw coefficients represent approximate
percentage impacts: a coefficient of 0.047 on 'rooms' means ~+4.7% per room.
"""

from __future__ import annotations
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path


# Fallback path to local processed params files
_PARAMS_DIR = Path(__file__).resolve().parents[2] / "Research" / "EPC PPD merge project" / "processed"


@dataclass
class AdjustmentCoeffs:
    """Borough+type-specific adjustment coefficients from LR model.

    Each coefficient is in log-price space (≈ percentage impact).
    The `se` (standard error) is derived from model MdAPE as a proxy,
    since sklearn LR doesn't provide per-coefficient SEs.
    """
    borough:       str
    property_type: str   # "flat" | "house"
    n_train:       int
    r_squared:     float  # proxy: 1 - (mdape/100)^2
    mdape:         float

    # Per-feature coefficients (log-price space)
    rooms:         float   # per bedroom/room difference
    epc_ord:       float   # per EPC ordinal band (A=1..G=7)
    build_year:    float   # per year of construction difference
    sale_months:   float   # per month since transaction
    imd_norm:      float   # per normalised IMD unit (houses only; 0=deprived, 1=affluent)
    log_floor_area: float  # log(sqm) coefficient (size elasticity)

    # Floor-level (flats only)
    is_ground_floor: float
    is_top_floor:    float

    # Structure type (houses only)
    st_D:          float   # detached premium
    st_S:          float   # semi-detached premium (baseline = terraced)
    is_bungalow:   float

    # Era coefficients (relative to baseline)
    era_coefficients: dict[str, float]

    # Uncertainty: global SE proxy derived from model MdAPE
    # Applied as a fraction of each coefficient during MC sampling
    se_fraction: float

    def get_rooms_range(self) -> tuple[float, float]:
        se = abs(self.rooms) * self.se_fraction
        return (self.rooms - 2 * se, self.rooms + 2 * se)

    def get_epc_range(self) -> tuple[float, float]:
        se = abs(self.epc_ord) * self.se_fraction
        return (self.epc_ord - 2 * se, self.epc_ord + 2 * se)

    def get_build_year_range(self) -> tuple[float, float]:
        se = abs(self.build_year) * self.se_fraction
        return (self.build_year - 2 * se, self.build_year + 2 * se)

    def get_sale_months_range(self) -> tuple[float, float]:
        se = abs(self.sale_months) * self.se_fraction
        return (self.sale_months - 2 * se, self.sale_months + 2 * se)

    def get_imd_range(self) -> tuple[float, float]:
        se = abs(self.imd_norm) * self.se_fraction
        return (self.imd_norm - 2 * se, self.imd_norm + 2 * se)

    def get_size_range(self) -> tuple[float, float]:
        se = abs(self.log_floor_area) * self.se_fraction
        return (self.log_floor_area - 2 * se, self.log_floor_area + 2 * se)

    def to_dict(self) -> dict:
        return {
            "borough": self.borough,
            "property_type": self.property_type,
            "n_train": self.n_train,
            "mdape": self.mdape,
            "coefficients": {
                "rooms":          self.rooms,
                "epc_ord":        self.epc_ord,
                "build_year":     self.build_year,
                "sale_months":    self.sale_months,
                "imd_norm":       self.imd_norm,
                "log_floor_area": self.log_floor_area,
                "is_ground_floor": self.is_ground_floor,
                "is_top_floor":   self.is_top_floor,
                "st_D":           self.st_D,
                "st_S":           self.st_S,
                "is_bungalow":    self.is_bungalow,
            },
            "era_coefficients": self.era_coefficients,
            "se_fraction": self.se_fraction,
        }


# ── Cache ──
_cache: dict[str, AdjustmentCoeffs] = {}


def _se_fraction_from_mdape(mdape: float) -> float:
    """Derive a standard-error fraction from model MdAPE.

    Clamped to [0.05, 0.40] to avoid degenerate cases.
    """
    return max(0.05, min(mdape / 100.0, 0.40))


def _row_to_coeffs(row: dict) -> AdjustmentCoeffs:
    """Convert a Supabase row (or equivalent dict) to AdjustmentCoeffs."""
    raw_coeffs = row.get("lr_coefficients_raw", {})
    mdape = float(row.get("lr_mdape", 15.0))
    era = row.get("era_coefficients", {})
    stats = row.get("train_stats", {})

    return AdjustmentCoeffs(
        borough=row.get("borough", ""),
        property_type=row.get("property_type", ""),
        n_train=stats.get("n_train", 0),
        r_squared=max(0, 1.0 - (mdape / 100.0) ** 2),
        mdape=mdape,
        rooms=raw_coeffs.get("rooms", 0.0),
        epc_ord=raw_coeffs.get("epc_ord", 0.0),
        build_year=raw_coeffs.get("build_year", 0.0),
        sale_months=raw_coeffs.get("sale_months", 0.0),
        imd_norm=raw_coeffs.get("imd_norm", 0.0),
        log_floor_area=raw_coeffs.get("log_floor_area", 0.0),
        is_ground_floor=raw_coeffs.get("is_ground_floor", 0.0),
        is_top_floor=raw_coeffs.get("is_top_floor", 0.0),
        st_D=raw_coeffs.get("st_D", 0.0),
        st_S=raw_coeffs.get("st_S", 0.0),
        is_bungalow=raw_coeffs.get("is_bungalow", 0.0),
        era_coefficients=era,
        se_fraction=_se_fraction_from_mdape(mdape),
    )


def _load_from_supabase(borough_slug: str, property_type: str) -> AdjustmentCoeffs | None:
    """Load coefficients from Supabase lr_model_coefficients table."""
    try:
        from supabase import create_client
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")
        if not url or not key:
            return None

        sb = create_client(url, key)
        result = (
            sb.table("lr_model_coefficients")
            .select("*")
            .eq("borough_slug", borough_slug)
            .eq("property_type", property_type)
            .limit(1)
            .execute()
        )
        if result.data:
            return _row_to_coeffs(result.data[0])
        return None
    except Exception as e:
        logging.warning("Supabase LR coefficient fetch failed: %s", e)
        return None


def _load_from_local(borough_slug: str, property_type: str, params_dir: Path | None = None) -> AdjustmentCoeffs | None:
    """Fallback: load coefficients from local JSON files."""
    base = params_dir or _PARAMS_DIR
    params_path = base / f"semv_{borough_slug}_params.json"
    if not params_path.exists():
        return None

    with open(params_path) as f:
        data = json.load(f)

    model_data = data.get("models", {}).get(property_type)
    if not model_data:
        return None

    ensemble = model_data.get("ensemble", {})
    semv = model_data.get("semv_params", {})

    # Build a row dict matching Supabase schema
    row = {
        "borough": data.get("borough", borough_slug),
        "property_type": property_type,
        "lr_mdape": ensemble.get("lr_mdape", 15.0),
        "lr_coefficients_raw": ensemble.get("lr_coefficients_raw", {}),
        "era_coefficients": semv.get("era_coefficients", ensemble.get("era_coefficients", {})),
        "train_stats": semv.get("train_stats", {}),
    }
    return _row_to_coeffs(row)


def load_coefficients(
    borough_slug: str,
    property_type: str,
    params_dir: Path | str | None = None,
) -> AdjustmentCoeffs | None:
    """Load LR adjustment coefficients for a borough + property type.

    Tries Supabase first, falls back to local JSON files.
    Results are cached in memory for the process lifetime.

    Args:
        borough_slug: e.g. "sutton", "merton"
        property_type: "flat" or "house"
        params_dir: Override path to local processed/ directory (fallback only)

    Returns:
        AdjustmentCoeffs or None if not found in either source.
    """
    cache_key = f"{borough_slug}_{property_type}"
    if cache_key in _cache:
        return _cache[cache_key]

    # Try Supabase first
    coeffs = _load_from_supabase(borough_slug, property_type)
    if coeffs:
        logging.info("LR coefficients loaded from Supabase: %s/%s", borough_slug, property_type)
        _cache[cache_key] = coeffs
        return coeffs

    # Fallback to local JSON
    local_dir = Path(params_dir) if params_dir else None
    coeffs = _load_from_local(borough_slug, property_type, local_dir)
    if coeffs:
        logging.info("LR coefficients loaded from local JSON: %s/%s", borough_slug, property_type)
        _cache[cache_key] = coeffs
        return coeffs

    logging.warning("No LR coefficients found for %s/%s", borough_slug, property_type)
    return None


def list_available_boroughs(params_dir: Path | str | None = None) -> list[str]:
    """List all borough slugs with available params files (local only)."""
    base = Path(params_dir) if params_dir else _PARAMS_DIR
    slugs = []
    for p in base.glob("semv_*_params.json"):
        slug = p.stem.replace("semv_", "").replace("_params", "")
        slugs.append(slug)
    return sorted(slugs)


def clear_cache():
    """Clear the coefficient cache (useful for testing)."""
    _cache.clear()

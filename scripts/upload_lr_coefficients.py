"""
Upload LR model coefficients from local JSON files to Supabase.

Usage:
    python scripts/upload_lr_coefficients.py

Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
Creates the table if it doesn't exist (runs migration SQL), then upserts all 65 rows.
"""

import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

from supabase import create_client

PARAMS_DIR = ROOT / "Research" / "EPC PPD merge project" / "processed"
MIGRATION_SQL = ROOT / "supabase" / "migrations" / "033_lr_model_coefficients.sql"


def get_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
        sys.exit(1)
    return create_client(url, key)


def run_migration(sb):
    """Create the table if it doesn't exist by running the migration SQL via RPC."""
    sql = MIGRATION_SQL.read_text()
    try:
        sb.rpc("exec_sql", {"sql": sql}).execute()
        print("Migration executed via RPC")
    except Exception:
        # RPC may not exist — try postgrest approach or just proceed
        # (table may already exist from a previous run)
        print("Note: Could not run migration via RPC — table may already exist")


def extract_row(borough_data: dict, model_type: str) -> dict | None:
    """Extract one row for upload from a params JSON."""
    model = borough_data.get("models", {}).get(model_type)
    if not model:
        return None

    ensemble = model.get("ensemble", {})
    semv = model.get("semv_params", {})

    return {
        "borough": borough_data.get("borough", ""),
        "borough_slug": borough_data.get("slug", ""),
        "property_type": model_type,
        "lr_mdape": ensemble.get("lr_mdape"),
        "mc_range_pp": ensemble.get("mc_range_pp"),
        "intercept": ensemble.get("intercept"),
        "lr_coefficients_raw": ensemble.get("lr_coefficients_raw", {}),
        "era_coefficients": semv.get("era_coefficients", {}),
        "scaler_means": semv.get("scaler_means", {}),
        "scaler_scales": semv.get("scaler_scales", {}),
        "train_stats": semv.get("train_stats", {}),
        "feature_cols": model.get("feature_cols", []),
    }


def main():
    sb = get_supabase()

    # Collect all rows
    rows = []
    for path in sorted(PARAMS_DIR.glob("semv_*_params.json")):
        with open(path) as f:
            data = json.load(f)

        for model_type in ["flat", "house"]:
            row = extract_row(data, model_type)
            if row:
                rows.append(row)
                print(f"  {row['borough_slug']:30s} {model_type:5s}  mdape={row['lr_mdape']:.1f}%  n={row['train_stats'].get('n_train', '?')}")

    print(f"\nTotal rows to upload: {len(rows)}")
    total_bytes = sum(len(json.dumps(r).encode()) for r in rows)
    print(f"Total payload: {total_bytes:,} bytes ({total_bytes/1024:.1f} KB)")

    # Upsert in batches (Supabase handles 65 rows easily in one go)
    try:
        result = sb.table("lr_model_coefficients").upsert(
            rows,
            on_conflict="borough_slug,property_type"
        ).execute()
        print(f"\nUploaded {len(result.data)} rows successfully")
    except Exception as e:
        print(f"\nUpload failed: {e}")
        print("\nYou may need to create the table first. Run this SQL in Supabase SQL Editor:")
        print(f"  {MIGRATION_SQL}")
        sys.exit(1)


if __name__ == "__main__":
    main()

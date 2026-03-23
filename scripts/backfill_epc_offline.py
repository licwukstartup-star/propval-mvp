"""
EPC Backfill -Option C: Offline Join
Exports data locally, joins in pandas, uploads to staging, applies gently.

Usage:
    python scripts/backfill_epc_offline.py export      # Phase 1: download CSVs
    python scripts/backfill_epc_offline.py join         # Phase 2: local join
    python scripts/backfill_epc_offline.py upload       # Phase 3: insert into staging
    python scripts/backfill_epc_offline.py apply        # Phase 4: batched UPDATE
    python scripts/backfill_epc_offline.py verify       # Phase 5: check counts
"""

import sys, os, time, csv, json
import httpx
import pandas as pd

SUPABASE_URL = "https://pphkbiogdrpdedyotkop.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwaGtiaW9nZHJwZGVkeW90a29wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjM3NTY5OSwiZXhwIjoyMDg3OTUxNjk5fQ.V4huiOZf6q_9Xzb7y1ptCheQmrfwBajSYgNXUypCyxY"
HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}

DATA_DIR = os.path.join(os.path.dirname(__file__), "epc_backfill_data")
TX_CSV = os.path.join(DATA_DIR, "transactions_to_backfill.csv")
EPC_CSV = os.path.join(DATA_DIR, "epc_certificates.csv")
JOINED_CSV = os.path.join(DATA_DIR, "joined_backfill.csv")
PROGRESS_FILE = os.path.join(DATA_DIR, "upload_progress.txt")
APPLY_PROGRESS_FILE = os.path.join(DATA_DIR, "apply_progress.txt")


def export_table_keyset(table, columns, filters, output_path, pk_col, page_size=5000, delay=3, max_retries=10):
    """Export a table using keyset pagination on primary key. Minimal CPU."""
    client = httpx.Client(timeout=120)
    select = ",".join(columns)
    last_key = ""
    total = 0
    page = 0
    consecutive_errors = 0

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()

        while True:
            url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}&order={pk_col}&limit={page_size}"
            for filt in filters:
                url += f"&{filt}"
            if last_key:
                url += f"&{pk_col}=gt.{last_key}"

            try:
                resp = client.get(url, headers=HEADERS)
            except httpx.ReadTimeout:
                consecutive_errors += 1
                wait = min(30 * consecutive_errors, 120)
                print(f"  TIMEOUT page {page} (attempt {consecutive_errors}) -waiting {wait}s...", flush=True)
                if consecutive_errors >= max_retries:
                    print(f"  FATAL: {max_retries} consecutive timeouts. Aborting.", flush=True)
                    break
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                consecutive_errors += 1
                wait = min(30 * consecutive_errors, 120)
                print(f"  ERROR page {page}: {resp.status_code} (attempt {consecutive_errors}) -waiting {wait}s...", flush=True)
                if consecutive_errors >= max_retries:
                    print(f"  FATAL: {max_retries} consecutive errors. Aborting.", flush=True)
                    break
                time.sleep(wait)
                continue

            consecutive_errors = 0  # reset on success
            rows = resp.json()
            if not rows:
                break

            for row in rows:
                writer.writerow(row)
            last_key = rows[-1][pk_col]
            total += len(rows)
            page += 1

            if page % 10 == 0:
                print(f"  {table}: {total:,} rows exported (page {page})", flush=True)

            time.sleep(delay)

    print(f"  {table}: DONE - {total:,} rows -> {output_path}")
    return total


def phase_export():
    """Phase 1: Export transactions needing backfill + epc_certificates."""
    print("=== PHASE 1: EXPORT ===")
    os.makedirs(DATA_DIR, exist_ok=True)

    # Export ALL transactions -NO server-side filters at all
    # Any WHERE on unindexed columns causes seq scans that timeout on free tier
    # Pure keyset pagination on PK = pure index scan = minimal CPU
    # We filter locally in Phase 2
    print("\nExporting transactions (transaction_id, lmk_key, epc_built_form) -all rows...")
    export_table_keyset(
        table="transactions",
        columns=["transaction_id", "lmk_key", "epc_built_form"],
        filters=[],
        output_path=TX_CSV,
        pk_col="transaction_id",
        page_size=5000,
        delay=3,
    )

    print("\nExporting epc_certificates (lmk_key, built_form, habitable_rooms, energy_score)...")
    export_table_keyset(
        table="epc_certificates",
        columns=["lmk_key", "built_form", "habitable_rooms", "energy_score"],
        filters=[],
        output_path=EPC_CSV,
        pk_col="lmk_key",
        page_size=5000,
        delay=3,
    )


def phase_join():
    """Phase 2: Local join -zero Supabase CPU."""
    print("=== PHASE 2: LOCAL JOIN ===")

    tx_all = pd.read_csv(TX_CSV, dtype=str)
    epc = pd.read_csv(EPC_CSV, dtype=str)
    print(f"  Total transactions with lmk_key: {len(tx_all):,}")
    print(f"  EPC certificates loaded:         {len(epc):,}")

    # Filter locally: only rows where lmk_key exists AND epc_built_form is still NULL
    has_lmk = tx_all["lmk_key"].notna()
    needs_backfill = tx_all["epc_built_form"].isna()
    tx = tx_all[has_lmk & needs_backfill][["transaction_id", "lmk_key"]].copy()
    no_lmk = (~has_lmk).sum()
    already_done = (has_lmk & ~needs_backfill).sum()
    print(f"  No lmk_key (no EPC link):        {no_lmk:,}")
    print(f"  Already backfilled (skip):       {already_done:,}")
    print(f"  Need backfill:                   {len(tx):,}")

    merged = tx.merge(epc, on="lmk_key", how="left")
    matched = merged[merged["built_form"].notna()].copy()
    unmatched = len(merged) - len(matched)
    print(f"  Matched: {len(matched):,}")
    print(f"  No EPC match (can't backfill): {unmatched:,}")

    # Apply COALESCE logic
    matched["epc_built_form"] = matched["built_form"].fillna("Unknown")

    # Convert numeric columns -keep as strings for REST API but clean NaN
    matched["habitable_rooms"] = matched["habitable_rooms"].where(matched["habitable_rooms"].notna(), None)
    matched["energy_score"] = matched["energy_score"].where(matched["energy_score"].notna(), None)

    # Output only the columns we need for the update
    out = matched[["transaction_id", "epc_built_form", "habitable_rooms", "energy_score"]]
    out.to_csv(JOINED_CSV, index=False)
    print(f"  Joined CSV written: {len(out):,} rows -> {JOINED_CSV}")


def phase_upload():
    """Phase 3: Upload joined data to _epc_staging table."""
    print("=== PHASE 3: UPLOAD TO STAGING ===")
    print("  PREREQUISITE: Run this SQL in Supabase SQL Editor first:")
    print("    CREATE UNLOGGED TABLE _epc_staging (")
    print("        transaction_id TEXT PRIMARY KEY,")
    print("        epc_built_form TEXT,")
    print("        habitable_rooms SMALLINT,")
    print("        energy_score SMALLINT")
    print("    );")
    print()

    df = pd.read_csv(JOINED_CSV, dtype=str)
    total = len(df)
    print(f"  Rows to upload: {total:,}")

    # Resume support
    start_row = 0
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            start_row = int(f.read().strip())
        print(f"  Resuming from row {start_row:,}")

    client = httpx.Client(timeout=60)
    batch_size = 500
    uploaded = start_row

    for i in range(start_row, total, batch_size):
        batch = df.iloc[i:i + batch_size]
        rows = []
        for _, row in batch.iterrows():
            r = {"transaction_id": row["transaction_id"], "epc_built_form": row["epc_built_form"]}
            if pd.notna(row["habitable_rooms"]):
                r["habitable_rooms"] = int(float(row["habitable_rooms"]))
            if pd.notna(row["energy_score"]):
                r["energy_score"] = int(float(row["energy_score"]))
            rows.append(r)

        resp = client.post(
            f"{SUPABASE_URL}/rest/v1/_epc_staging",
            headers={**HEADERS, "Prefer": "return=minimal"},
            json=rows,
        )
        if resp.status_code not in (200, 201):
            print(f"  ERROR at row {i}: {resp.status_code} {resp.text[:200]}")
            time.sleep(10)
            continue

        uploaded = i + len(batch)
        # Save progress
        with open(PROGRESS_FILE, "w") as f:
            f.write(str(uploaded))

        if (i // batch_size) % 20 == 0:
            print(f"  Uploaded {uploaded:,} / {total:,} ({100*uploaded/total:.1f}%)", flush=True)

        time.sleep(3)

    print(f"  DONE -{uploaded:,} rows uploaded to _epc_staging")


def phase_apply():
    """Phase 4: Apply updates from staging to transactions."""
    print("=== PHASE 4: APPLY UPDATES ===")
    print("  PREREQUISITE: Run this SQL in Supabase SQL Editor first:")
    print("    CREATE OR REPLACE FUNCTION apply_epc_staging(batch_size INT DEFAULT 5000)")
    print("    RETURNS INT AS $$")
    print("    DECLARE updated INT;")
    print("    BEGIN")
    print("        WITH batch AS (")
    print("            SELECT s.* FROM _epc_staging s")
    print("            JOIN transactions t ON t.transaction_id = s.transaction_id")
    print("            WHERE t.epc_built_form IS NULL")
    print("            LIMIT batch_size")
    print("        )")
    print("        UPDATE transactions t")
    print("        SET epc_built_form = b.epc_built_form,")
    print("            habitable_rooms = b.habitable_rooms,")
    print("            energy_score = b.energy_score")
    print("        FROM batch b")
    print("        WHERE t.transaction_id = b.transaction_id;")
    print("        GET DIAGNOSTICS updated = ROW_COUNT;")
    print("        RETURN updated;")
    print("    END; $$ LANGUAGE plpgsql SET statement_timeout = '120s';")
    print()

    client = httpx.Client(timeout=130)
    total = 0
    batch_num = 1

    while True:
        resp = client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/apply_epc_staging",
            headers=HEADERS,
            json={"batch_size": 5000},
        )
        data = resp.json()

        if isinstance(data, dict) and "code" in data:
            print(f"  Batch {batch_num}: DB error {data['code']} -waiting 60s...", flush=True)
            time.sleep(60)
            continue

        count = data
        if count is None or count == 0:
            break

        total += count
        print(f"  Batch {batch_num}: {count} rows updated (total: {total:,})", flush=True)
        batch_num += 1
        time.sleep(30)  # 30s gap -full CPU recovery

    print(f"  DONE -{total:,} rows updated in transactions")


def phase_verify():
    """Phase 5: Verify counts."""
    print("=== PHASE 5: VERIFY ===")
    client = httpx.Client(timeout=30)
    h = {**HEADERS, "Prefer": "count=exact", "Range": "0-0"}

    r1 = client.get(f"{SUPABASE_URL}/rest/v1/transactions?select=transaction_id&epc_built_form=not.is.null", headers=h)
    r2 = client.get(f"{SUPABASE_URL}/rest/v1/transactions?select=transaction_id&lmk_key=not.is.null&epc_built_form=is.null", headers=h)

    print(f"  Rows with EPC data:    {r1.headers.get('content-range', '?')}")
    print(f"  Rows still missing:    {r2.headers.get('content-range', '?')}")
    print()
    print("  Cleanup SQL (run in SQL Editor):")
    print("    DROP TABLE IF EXISTS _epc_staging;")
    print("    DROP FUNCTION IF EXISTS backfill_epc_batch;")
    print("    DROP FUNCTION IF EXISTS apply_epc_staging;")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()
    if cmd == "export":
        phase_export()
    elif cmd == "join":
        phase_join()
    elif cmd == "upload":
        phase_upload()
    elif cmd == "apply":
        phase_apply()
    elif cmd == "verify":
        phase_verify()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)

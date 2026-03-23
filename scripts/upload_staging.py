"""Phase 2a: Upload joined CSV to _epc_staging table. Gentle batches."""
import os
import csv
import time
from pathlib import Path

import httpx
import pandas as pd

SUPABASE_URL = "https://pphkbiogdrpdedyotkop.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwaGtiaW9nZHJwZGVkeW90a29wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjM3NTY5OSwiZXhwIjoyMDg3OTUxNjk5fQ.V4huiOZf6q_9Xzb7y1ptCheQmrfwBajSYgNXUypCyxY"
HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

DATA_DIR = Path(__file__).resolve().parent / "epc_backfill_data"
JOINED_CSV = DATA_DIR / "joined_backfill.csv"
PROGRESS_FILE = DATA_DIR / "upload_progress.txt"

BATCH_SIZE = 500
DELAY = 3

df = pd.read_csv(JOINED_CSV, dtype=str)
total = len(df)
print(f"Rows to upload: {total:,}")

# Resume support
start_row = 0
if PROGRESS_FILE.exists():
    start_row = int(PROGRESS_FILE.read_text().strip())
    print(f"Resuming from row {start_row:,}")

client = httpx.Client(timeout=60)
uploaded = start_row
consecutive_errors = 0

for i in range(start_row, total, BATCH_SIZE):
    batch = df.iloc[i:i + BATCH_SIZE]
    rows = []
    for _, row in batch.iterrows():
        r = {
            "transaction_id": row["transaction_id"],
            "epc_built_form": row["epc_built_form"],
            "habitable_rooms": int(float(row["habitable_rooms"])) if pd.notna(row["habitable_rooms"]) else None,
            "energy_score": int(float(row["energy_score"])) if pd.notna(row["energy_score"]) else None,
        }
        rows.append(r)

    try:
        resp = client.post(
            f"{SUPABASE_URL}/rest/v1/_epc_staging",
            headers=HEADERS,
            json=rows,
        )
    except httpx.ReadTimeout:
        consecutive_errors += 1
        wait = min(30 * consecutive_errors, 120)
        print(f"  TIMEOUT at row {i} (attempt {consecutive_errors}) - waiting {wait}s...", flush=True)
        if consecutive_errors >= 10:
            print("  FATAL: 10 consecutive timeouts.", flush=True)
            break
        time.sleep(wait)
        continue

    if resp.status_code not in (200, 201):
        consecutive_errors += 1
        wait = min(30 * consecutive_errors, 120)
        print(f"  ERROR at row {i}: {resp.status_code} (attempt {consecutive_errors}) - waiting {wait}s...", flush=True)
        if consecutive_errors >= 10:
            print("  FATAL: 10 consecutive errors.", flush=True)
            break
        time.sleep(wait)
        continue

    consecutive_errors = 0
    uploaded = i + len(batch)
    PROGRESS_FILE.write_text(str(uploaded))

    batch_num = i // BATCH_SIZE
    if batch_num % 20 == 0:
        pct = 100 * uploaded / total
        print(f"  Uploaded {uploaded:,} / {total:,} ({pct:.1f}%)", flush=True)

    time.sleep(DELAY)

print(f"DONE - {uploaded:,} rows uploaded to _epc_staging")

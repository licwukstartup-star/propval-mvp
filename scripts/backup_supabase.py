"""Supabase table backup — exports critical tables to timestamped JSON files.

Free-tier Supabase has ZERO automatic backups. This script is the sole
backup mechanism. Run it at least every 2 days (maximum acceptable data
loss = 48 hours per the PropVal mandate).

Usage:
    # Manual run
    py -3.11 scripts/backup_supabase.py

    # Windows Task Scheduler (every 2 days)
    schtasks /create /tn "PropVal Backup" /tr "py -3.11 C:\\path\\to\\scripts\\backup_supabase.py" /sc daily /ri 2880 /st 03:00

    # Linux/macOS cron (every 2 days at 03:00)
    0 3 */2 * * cd /path/to/propval-mvp && python scripts/backup_supabase.py

Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env at project root.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load environment from project root .env
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")

from supabase import create_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# Tables to back up — ordered by criticality
CRITICAL_TABLES = [
    "cases",
    "case_comparables",
    "firm_templates",
]

IMPORTANT_TABLES = [
    "property_enrichment",
    "ai_usage_log",
    "news_articles",
]

# Where to store backups
BACKUP_DIR = PROJECT_ROOT / "backups"

# Retention: keep last N backups per table
MAX_BACKUPS_PER_TABLE = 10

# Supabase paginates at 1000 rows — fetch in pages
PAGE_SIZE = 1000


def _get_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
        sys.exit(1)
    return create_client(url, key)


def _fetch_all_rows(client, table: str) -> list[dict]:
    """Fetch all rows from a table, paginating if needed."""
    all_rows = []
    offset = 0
    while True:
        resp = (
            client.table(table)
            .select("*")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return all_rows


def _rotate_old_backups(table: str):
    """Delete oldest backups beyond MAX_BACKUPS_PER_TABLE."""
    pattern = f"{table}_*.json"
    existing = sorted(BACKUP_DIR.glob(pattern))
    while len(existing) > MAX_BACKUPS_PER_TABLE:
        oldest = existing.pop(0)
        oldest.unlink()
        logger.info("  Rotated old backup: %s", oldest.name)


def run_backup():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    client = _get_client()

    all_tables = CRITICAL_TABLES + IMPORTANT_TABLES
    total_rows = 0
    failed_tables = []

    for table in all_tables:
        try:
            rows = _fetch_all_rows(client, table)
            filename = f"{table}_{timestamp}.json"
            filepath = BACKUP_DIR / filename

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "table": table,
                        "exported_at": datetime.now(timezone.utc).isoformat(),
                        "row_count": len(rows),
                        "data": rows,
                    },
                    f,
                    indent=2,
                    default=str,
                )

            total_rows += len(rows)
            logger.info("  %s: %d rows -> %s", table, len(rows), filename)
            _rotate_old_backups(table)

        except Exception as exc:
            logger.error("  FAILED to back up %s: %s", table, exc)
            failed_tables.append(table)

    logger.info(
        "Backup complete: %d tables, %d total rows, %d failures",
        len(all_tables) - len(failed_tables),
        total_rows,
        len(failed_tables),
    )

    if failed_tables:
        logger.error("FAILED tables: %s", ", ".join(failed_tables))
        sys.exit(1)


if __name__ == "__main__":
    logger.info("PropVal Supabase Backup — %s", datetime.now(timezone.utc).isoformat())
    run_backup()

"""
OS Open UPRN Coordinate Service
================================
Provides building-level coordinate lookups via a local SQLite database
containing ~41.5M UPRNs mapped to WGS84 lat/lon coordinates.

Source: OS Open UPRN (Ordnance Survey, Open Government Licence)
Accuracy: Within building footprint (~1-5m)
Coverage: All of Great Britain

Contains OS data Crown copyright and database right 2026.

Usage:
    svc = UPRNCoordService.load()         # called once at startup
    result = svc.lookup("10008331635")    # (lat, lon) or None
    results = svc.lookup_batch(["10008331635", "5300009236"])  # {uprn: (lat, lon)}
"""

import logging
import sqlite3
import time
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "uprn_coords.db"


class UPRNCoordService:
    """SQLite-backed UPRN → coordinate lookup service."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._con = sqlite3.connect(str(db_path), check_same_thread=False)
        self._con.execute("PRAGMA journal_mode=WAL")
        self._con.execute("PRAGMA cache_size=-256000")  # 256 MB cache
        self._con.execute("PRAGMA mmap_size=1073741824")  # 1 GB mmap
        self._count = self._con.execute("SELECT count(*) FROM uprn_coords").fetchone()[0]

    def lookup(self, uprn: str | int | None) -> tuple[float, float] | None:
        """Return (lat, lon) for a single UPRN, or None if not found."""
        if uprn is None:
            return None
        try:
            uprn_int = int(str(uprn).strip())
        except (ValueError, TypeError):
            return None
        row = self._con.execute(
            "SELECT lat, lon FROM uprn_coords WHERE uprn = ?", (uprn_int,)
        ).fetchone()
        return (row[0], row[1]) if row else None

    def lookup_batch(self, uprns: list[str | int]) -> dict[str, tuple[float, float]]:
        """Return {uprn_str: (lat, lon)} for a batch of UPRNs."""
        if not uprns:
            return {}
        result = {}
        # Process in chunks of 500 (SQLite variable limit)
        clean = []
        for u in uprns:
            try:
                clean.append((str(u).strip(), int(str(u).strip())))
            except (ValueError, TypeError):
                continue

        for i in range(0, len(clean), 500):
            batch = clean[i:i + 500]
            placeholders = ",".join("?" for _ in batch)
            int_vals = [b[1] for b in batch]
            rows = self._con.execute(
                f"SELECT uprn, lat, lon FROM uprn_coords WHERE uprn IN ({placeholders})",
                int_vals
            ).fetchall()
            for r in rows:
                result[str(r[0])] = (r[1], r[2])
        return result

    @property
    def loaded(self) -> bool:
        return self._con is not None

    @property
    def count(self) -> int:
        return self._count

    @classmethod
    def load(cls, path: str | Path | None = None) -> "UPRNCoordService | None":
        """Load the SQLite database and return a service instance, or None on failure."""
        db_path = Path(path) if path else _DEFAULT_PATH
        if not db_path.exists():
            log.warning(
                "UPRN coords: database not found at %s — UPRN coordinate lookup disabled. "
                "Run script 21_build_uprn_coords_db.py to create it.",
                db_path,
            )
            return None
        try:
            t0 = time.monotonic()
            svc = cls(db_path)
            log.info(
                "UPRN coords: Loaded %s (%s UPRNs) in %.1fs",
                db_path.name, f"{svc.count:,}", time.monotonic() - t0,
            )
            return svc
        except Exception:
            log.exception("UPRN coords: Failed to load database")
            return None

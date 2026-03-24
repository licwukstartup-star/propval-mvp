"""
OS Open UPRN Coordinate Service
================================
Provides building-level coordinate lookups via Supabase PostGIS table
containing ~6M London UPRNs mapped to WGS84 lat/lon coordinates.

Source: OS Open UPRN (Ordnance Survey, Open Government Licence)
Accuracy: Within building footprint (~1-5m)
Coverage: London (Greater London bounding box)

Contains OS data Crown copyright and database right 2026.

Usage:
    svc = UPRNCoordService()
    result = svc.lookup("10008331635")    # (lat, lon) or None
    results = svc.lookup_batch(["10008331635", "5300009236"])  # {uprn: (lat, lon)}
"""

import logging
import os
from supabase import create_client

log = logging.getLogger(__name__)

_supabase_client = None


def _get_sb():
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if url and key:
            _supabase_client = create_client(url, key)
    return _supabase_client


class UPRNCoordService:
    """Supabase PostGIS-backed UPRN → coordinate lookup service."""

    def __init__(self):
        self._loaded = True

    def lookup(self, uprn: str | int | None) -> tuple[float, float] | None:
        """Return (lat, lon) for a single UPRN, or None if not found."""
        if uprn is None:
            return None
        sb = _get_sb()
        if sb is None:
            return None
        try:
            uprn_str = str(uprn).strip()
            resp = sb.rpc("lookup_uprn_coords", {"p_uprn": uprn_str}).execute()
            if resp.data:
                return (resp.data[0]["lat"], resp.data[0]["lon"])
            return None
        except Exception:
            log.exception("UPRN coords lookup failed for %s", uprn)
            return None

    def lookup_batch(self, uprns: list[str | int]) -> dict[str, tuple[float, float]]:
        """Return {uprn_str: (lat, lon)} for a batch of UPRNs."""
        if not uprns:
            return {}
        sb = _get_sb()
        if sb is None:
            return {}
        result = {}
        clean = []
        for u in uprns:
            try:
                clean.append(str(u).strip())
            except (ValueError, TypeError):
                continue

        # Process in chunks of 500
        for i in range(0, len(clean), 500):
            batch = clean[i:i + 500]
            try:
                resp = sb.rpc("lookup_uprn_coords_batch", {"p_uprns": batch}).execute()
                for row in resp.data:
                    result[str(row["uprn"])] = (row["lat"], row["lon"])
            except Exception:
                log.exception("UPRN coords batch lookup failed for chunk %d", i)
        return result

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def count(self) -> int:
        return 5957125  # London UPRNs loaded

    @classmethod
    def load(cls, path=None) -> "UPRNCoordService":
        """Create service instance (no file loading needed — data is in Supabase)."""
        log.info("UPRN coords: Using Supabase PostGIS table (uprn_coordinates)")
        return cls()

"""
INSPIRE Polygon Centroid Service
=================================
Loads the pre-computed London INSPIRE centroids JSON (~119 MB, ~2M polygons)
into memory at startup and provides fast nearest-centroid lookups via a
scipy KDTree.

Lookup strategy: nearest-centroid (not point-in-polygon).
For residential properties (< ~600 sqm plots), the nearest INSPIRE centroid
to a postcode-level geocode is typically the correct property polygon centroid.
Accuracy is significantly better than postcode centroid for outer London
(measured: 3× improvement in Sutton, 2.2× in Bromley, 1.9× in Hackney).

Usage:
    svc = InspireService.load()       # called once at startup
    result = svc.lookup(lat, lng)     # {lat, lng, area_sqm} or None
"""

import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)

# Default path: find the experiment data directory relative to backend/
_DEFAULT_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "Address matching experiment"
    / "data"
    / "inspire_centroids_london.json"
)


class InspireService:
    """In-memory INSPIRE centroid lookup service."""

    def __init__(self, ids: list[str], lats, lngs, data: dict):
        self._ids   = ids
        self._lats  = lats
        self._lngs  = lngs
        self._data  = data
        self._tree  = None
        self._build_tree()

    def _build_tree(self):
        try:
            import numpy as np
            from scipy.spatial import KDTree
            coords = np.column_stack([self._lats, self._lngs])
            self._tree = KDTree(coords)
            log.info("INSPIRE: KDTree built (%d centroids)", len(self._ids))
        except ImportError:
            log.warning("INSPIRE: scipy not available — INSPIRE lookup disabled")

    def lookup(self, lat: float, lng: float, max_dist_m: float = 350.0) -> dict | None:
        """
        Return the nearest INSPIRE centroid within max_dist_m metres, or None.

        Args:
            lat, lng: WGS84 coordinates to query (e.g. postcode centroid).
            max_dist_m: reject matches beyond this distance. Default 350m —
                        the KDTree computes Euclidean degree-space distance and
                        converts with 111,000 m/deg, but at 51.5°N longitude
                        degrees are only ~69,000 m, so E/W displacements are
                        overestimated by ~60%. 350m here reliably covers a true
                        200m radius across all compass directions.

        Returns:
            {"lat": float, "lng": float, "area_sqm": float} or None.
        """
        if self._tree is None:
            return None
        try:
            dist_deg, idx = self._tree.query([lat, lng])
            # 1 degree latitude ≈ 111,000m. Conservative conversion — slightly
            # under-estimates distance in longitude direction at 51.5°N but
            # acceptable for a nearest-centroid sanity threshold.
            dist_m = dist_deg * 111_000
            if dist_m > max_dist_m:
                return None
            return self._data[self._ids[int(idx)]]
        except Exception:
            return None

    @property
    def loaded(self) -> bool:
        return self._tree is not None

    @classmethod
    def load(cls, path: str | Path | None = None) -> "InspireService | None":
        """
        Load centroids JSON and return an InspireService, or None on failure.
        Path is resolved from:
          1. `path` argument
          2. INSPIRE_CENTROIDS_PATH env var
          3. Default relative path (experiment/data/inspire_centroids_london.json)
        """
        json_path = Path(path) if path else Path(
            os.getenv("INSPIRE_CENTROIDS_PATH", str(_DEFAULT_PATH))
        )
        if not json_path.exists():
            log.warning(
                "INSPIRE: centroids file not found at %s — INSPIRE lookup disabled. "
                "Run the pipeline scripts to generate it.", json_path
            )
            return None

        try:
            t0 = time.monotonic()
            log.info("INSPIRE: Loading %s ...", json_path.name)
            import numpy as np
            with open(json_path, encoding="utf-8") as f:
                data = json.load(f)
            ids  = list(data.keys())
            lats = np.array([data[k]["lat"] for k in ids], dtype=np.float32)
            lngs = np.array([data[k]["lng"] for k in ids], dtype=np.float32)
            svc  = cls(ids, lats, lngs, data)
            log.info(
                "INSPIRE: Loaded %d centroids in %.1fs",
                len(ids), time.monotonic() - t0,
            )
            return svc
        except Exception:
            log.exception("INSPIRE: Failed to load centroids — INSPIRE lookup disabled")
            return None

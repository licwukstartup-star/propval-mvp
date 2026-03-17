"""
INSPIRE Polygon Centroid Service
=================================
Loads the pre-computed London INSPIRE centroids JSON (~119 MB, ~2M polygons)
into memory at startup and provides fast nearest-centroid lookups via a
scipy KDTree.

Also provides polygon geometry lookups from a SQLite database for rendering
title boundaries on the map and calculating site area.

Lookup strategy: nearest-centroid (not point-in-polygon).
For residential properties (< ~600 sqm plots), the nearest INSPIRE centroid
to a postcode-level geocode is typically the correct property polygon centroid.
Accuracy is significantly better than postcode centroid for outer London
(measured: 3× improvement in Sutton, 2.2× in Bromley, 1.9× in Hackney).

Usage:
    svc = InspireService.load()       # called once at startup
    result = svc.lookup(lat, lng)     # {lat, lng, area_sqm, inspire_id} or None
    polygons = svc.get_polygons([(lat1, lng1), (lat2, lng2)])  # GeoJSON FeatureCollection
"""

import json
import logging
import os
import sqlite3
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

_DEFAULT_POLYGONS_DB = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "inspire_polygons.db"
)


class InspireService:
    """In-memory INSPIRE centroid lookup service with polygon DB."""

    def __init__(self, ids: list[str], lats, lngs, data: dict, db_path: Path | None = None):
        self._ids   = ids
        self._lats  = lats
        self._lngs  = lngs
        self._data  = data
        self._tree  = None
        self._db_path = db_path
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
            {"lat": float, "lng": float, "area_sqm": float, "inspire_id": str} or None.
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
            iid = self._ids[int(idx)]
            result = dict(self._data[iid])
            result["inspire_id"] = iid
            return result
        except Exception:
            return None

    @property
    def loaded(self) -> bool:
        return self._tree is not None

    @property
    def has_polygons(self) -> bool:
        return self._db_path is not None and self._db_path.exists()

    def lookup_batch(self, coords: list[tuple[float, float]], max_dist_m: float = 350.0) -> list[dict | None]:
        """Look up multiple coordinates. Returns list of results (None for misses)."""
        if self._tree is None:
            return [None] * len(coords)
        import numpy as np
        points = np.array(coords, dtype=np.float32)
        dists, idxs = self._tree.query(points)
        results = []
        for dist_deg, idx in zip(dists, idxs):
            dist_m = dist_deg * 111_000
            if dist_m > max_dist_m:
                results.append(None)
            else:
                iid = self._ids[int(idx)]
                r = dict(self._data[iid])
                r["inspire_id"] = iid
                results.append(r)
        return results

    def get_polygons(self, coords: list[tuple[float, float]], max_dist_m: float = 350.0) -> dict:
        """
        Given a list of (lat, lon) pairs, return a GeoJSON FeatureCollection
        of INSPIRE title boundary polygons.

        Each feature includes properties: inspire_id, area_sqm, centroid_lat, centroid_lon.
        """
        empty = {"type": "FeatureCollection", "features": []}
        if not self.has_polygons:
            log.warning("INSPIRE: polygon DB not available")
            return empty

        # Step 1: KDTree lookup to get INSPIRE IDs
        hits = self.lookup_batch(coords, max_dist_m)
        inspire_ids = []
        hit_map = {}  # inspire_id -> centroid data
        for hit in hits:
            if hit and hit["inspire_id"] not in hit_map:
                inspire_ids.append(int(hit["inspire_id"]))
                hit_map[hit["inspire_id"]] = hit

        if not inspire_ids:
            return empty

        # Step 2: Fetch polygon geometries from SQLite
        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
            placeholders = ",".join("?" * len(inspire_ids))
            rows = conn.execute(
                f"SELECT inspire_id, geojson FROM polygons WHERE inspire_id IN ({placeholders})",
                inspire_ids,
            ).fetchall()
            conn.close()
        except Exception:
            log.exception("INSPIRE: polygon DB query failed")
            return empty

        # Step 3: Build GeoJSON FeatureCollection
        features = []
        for inspire_id, geojson_str in rows:
            iid = str(inspire_id)
            centroid = hit_map.get(iid, {})
            features.append({
                "type": "Feature",
                "properties": {
                    "inspire_id": iid,
                    "area_sqm": centroid.get("area_sqm"),
                    "centroid_lat": centroid.get("lat"),
                    "centroid_lon": centroid.get("lng"),
                },
                "geometry": json.loads(geojson_str),
            })

        return {"type": "FeatureCollection", "features": features}

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

        # Resolve polygon DB path
        db_path = Path(os.getenv("INSPIRE_POLYGONS_DB", str(_DEFAULT_POLYGONS_DB)))
        if not db_path.exists():
            log.warning("INSPIRE: polygon DB not found at %s — polygon lookups disabled", db_path)
            db_path = None

        try:
            t0 = time.monotonic()
            log.info("INSPIRE: Loading %s ...", json_path.name)
            import numpy as np
            with open(json_path, encoding="utf-8") as f:
                data = json.load(f)
            ids  = list(data.keys())
            lats = np.array([data[k]["lat"] for k in ids], dtype=np.float32)
            lngs = np.array([data[k]["lng"] for k in ids], dtype=np.float32)
            svc  = cls(ids, lats, lngs, data, db_path=db_path)
            log.info(
                "INSPIRE: Loaded %d centroids in %.1fs (polygons: %s)",
                len(ids), time.monotonic() - t0,
                "available" if db_path else "unavailable",
            )
            return svc
        except Exception:
            log.exception("INSPIRE: Failed to load centroids — INSPIRE lookup disabled")
            return None

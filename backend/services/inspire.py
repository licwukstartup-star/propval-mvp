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
import math
import os
import sqlite3
import time
from pathlib import Path

# At ~51.5°N (London), 1° longitude ≈ cos(51.5°) × 111,000 ≈ 69,200m.
# We scale longitudes by this factor so KDTree Euclidean distance ≈ real distance.
_LON_SCALE = math.cos(math.radians(51.5))  # ≈ 0.6225

log = logging.getLogger(__name__)

# Default path: find the experiment data directory relative to backend/
_DEFAULT_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "Research"
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
            # Scale longitudes by cos(lat) so Euclidean distance ≈ real distance
            coords = np.column_stack([self._lats, self._lngs * _LON_SCALE])
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
            dist_deg, idx = self._tree.query([lat, lng * _LON_SCALE])
            # In scaled space, 1 unit ≈ 1 degree latitude ≈ 111,000m
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
        points[:, 1] *= _LON_SCALE  # scale longitudes to match KDTree
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

    def get_polygons_in_radius(self, lat: float, lon: float, radius_m: float = 1609.0, max_polygons: int = 8000) -> dict:
        """
        Return ALL INSPIRE polygons within radius as a GeoJSON FeatureCollection.

        Uses KDTree.query_ball_point for fast spatial query, then batch-fetches
        polygon geometries from SQLite.

        Args:
            lat, lon: WGS84 centre point.
            radius_m: search radius in metres (default 1609 = 1 mile).
            max_polygons: cap to prevent browser meltdown in dense areas.

        Returns:
            GeoJSON FeatureCollection with all polygon features in the area.
        """
        empty = {"type": "FeatureCollection", "features": []}
        if self._tree is None or not self.has_polygons:
            return empty

        import numpy as np

        # In scaled space, 1 unit ≈ 1° lat ≈ 111,000m
        radius_deg = radius_m / 111_000
        indices = self._tree.query_ball_point([lat, lon * _LON_SCALE], r=radius_deg)

        if not indices:
            return empty

        # Sort by distance from centre so cap keeps the closest polygons
        if len(indices) > max_polygons:
            centre = np.array([lat, lon * _LON_SCALE])
            coords = np.array([[self._lats[i], self._lngs[i] * _LON_SCALE] for i in indices])
            dists = np.sum((coords - centre) ** 2, axis=1)
            sorted_order = np.argsort(dists)
            indices = [indices[j] for j in sorted_order[:max_polygons]]
            log.warning("INSPIRE radius: capped to %d nearest (of %d total)", max_polygons, len(sorted_order))

        # Gather inspire_ids and centroid metadata
        inspire_ids = []
        centroid_map = {}
        for idx in indices:
            iid = self._ids[int(idx)]
            int_id = int(iid)
            inspire_ids.append(int_id)
            centroid_map[iid] = self._data.get(iid, {})

        # Batch fetch from SQLite (chunk to respect variable limit)
        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
            rows = []
            chunk_size = 500
            for i in range(0, len(inspire_ids), chunk_size):
                chunk = inspire_ids[i:i + chunk_size]
                placeholders = ",".join("?" * len(chunk))
                rows.extend(conn.execute(
                    f"SELECT inspire_id, geojson FROM polygons WHERE inspire_id IN ({placeholders})",
                    chunk,
                ).fetchall())
            conn.close()
        except Exception:
            log.exception("INSPIRE radius: polygon DB query failed")
            return empty

        # Build GeoJSON features
        features = []
        for inspire_id, geojson_str in rows:
            iid = str(inspire_id)
            centroid = centroid_map.get(iid, {})
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

        log.info("INSPIRE radius: %.0fm from (%.5f, %.5f) → %d polygons", radius_m, lat, lon, len(features))
        return {"type": "FeatureCollection", "features": features}

    def get_polygons_near_points(self, points: list[tuple[float, float]], radius_m: float = 50.0, max_polygons: int = 500) -> dict:
        """Return deduplicated INSPIRE polygons within radius_m of ANY of the given points."""
        empty = {"type": "FeatureCollection", "features": []}
        if self._tree is None or not self.has_polygons or not points:
            return empty

        radius_deg = radius_m / 111_000
        unique_indices: set[int] = set()
        for lat, lon in points:
            indices = self._tree.query_ball_point([lat, lon * _LON_SCALE], r=radius_deg)
            unique_indices.update(int(i) for i in indices)

        if not unique_indices:
            return empty

        if len(unique_indices) > max_polygons:
            unique_indices = set(list(unique_indices)[:max_polygons])
            log.warning("INSPIRE near-points: capped to %d polygons", max_polygons)

        inspire_ids = []
        centroid_map = {}
        for idx in unique_indices:
            iid = self._ids[idx]
            inspire_ids.append(int(iid))
            centroid_map[iid] = self._data.get(iid, {})

        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
            rows = []
            chunk_size = 500
            for i in range(0, len(inspire_ids), chunk_size):
                chunk = inspire_ids[i:i + chunk_size]
                placeholders = ",".join("?" * len(chunk))
                rows.extend(conn.execute(
                    f"SELECT inspire_id, geojson FROM polygons WHERE inspire_id IN ({placeholders})",
                    chunk,
                ).fetchall())
            conn.close()
        except Exception:
            log.exception("INSPIRE near-points: polygon DB query failed")
            return empty

        features = []
        for inspire_id, geojson_str in rows:
            iid = str(inspire_id)
            centroid = centroid_map.get(iid, {})
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

        log.info("INSPIRE near-points: %d points, %.0fm radius → %d polygons", len(points), radius_m, len(features))
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

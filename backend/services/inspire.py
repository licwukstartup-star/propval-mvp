"""
INSPIRE Polygon Service
========================
Provides INSPIRE title boundary lookups via Supabase PostGIS table
containing ~2M London INSPIRE polygons with centroids and boundary geometry.

Source: HMLR INSPIRE Index Polygons (Open Government Licence)
Coverage: All 33 London boroughs

Lookup strategy: nearest-centroid via PostGIS spatial query.
For residential properties (< ~600 sqm plots), the nearest INSPIRE centroid
is typically the correct property polygon centroid.

Usage:
    svc = InspireService.load()
    result = svc.lookup(lat, lng)     # {lat, lng, area_sqm, inspire_id} or None
    polygons = svc.get_polygons([(lat1, lng1), ...])  # GeoJSON FeatureCollection
"""

import json
import logging

from services.supabase_admin import get_service_client as _get_sb

log = logging.getLogger(__name__)


class InspireService:
    """Supabase PostGIS-backed INSPIRE polygon lookup service."""

    def __init__(self):
        self._loaded = True

    def lookup(self, lat: float, lng: float, max_dist_m: float = 350.0) -> dict | None:
        """Return the nearest INSPIRE centroid within max_dist_m metres, or None."""
        sb = _get_sb()
        if sb is None:
            return None
        try:
            resp = sb.rpc("nearest_title_boundary", {
                "p_lon": lng,
                "p_lat": lat,
                "p_max_dist": max_dist_m,
            }).execute()
            if resp.data:
                row = resp.data[0]
                return {
                    "lat": lat,
                    "lng": lng,
                    "area_sqm": row["area_sqm"],
                    "inspire_id": row["inspire_id"],
                }
            return None
        except Exception:
            log.exception("INSPIRE lookup failed")
            return None

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def has_polygons(self) -> bool:
        return True

    def lookup_batch(self, coords: list[tuple[float, float]], max_dist_m: float = 350.0) -> list[dict | None]:
        """Look up multiple coordinates. Returns list of results (None for misses)."""
        return [self.lookup(lat, lng, max_dist_m) for lat, lng in coords]

    def get_polygons(self, coords: list[tuple[float, float]], max_dist_m: float = 350.0) -> dict:
        """Given a list of (lat, lon) pairs, return GeoJSON FeatureCollection of INSPIRE polygons."""
        empty = {"type": "FeatureCollection", "features": []}
        sb = _get_sb()
        if sb is None:
            return empty

        # Step 1: find nearest INSPIRE IDs for each coord
        hits = self.lookup_batch(coords, max_dist_m)
        inspire_ids = []
        hit_map = {}
        for hit in hits:
            if hit and hit["inspire_id"] not in hit_map:
                inspire_ids.append(hit["inspire_id"])
                hit_map[hit["inspire_id"]] = hit

        if not inspire_ids:
            return empty

        # Step 2: fetch polygon geometries from Supabase
        try:
            resp = sb.rpc("get_inspire_polygons", {"p_ids": inspire_ids}).execute()
            features = []
            for row in (resp.data or []):
                iid = row["inspire_id"]
                centroid = hit_map.get(iid, {})
                features.append({
                    "type": "Feature",
                    "properties": {
                        "inspire_id": iid,
                        "area_sqm": row.get("area_sqm"),
                        "centroid_lat": centroid.get("lat"),
                        "centroid_lon": centroid.get("lng"),
                    },
                    "geometry": json.loads(row["geojson"]),
                })
            return {"type": "FeatureCollection", "features": features}
        except Exception:
            log.exception("INSPIRE polygon fetch failed")
            return empty

    def get_polygons_in_radius(self, lat: float, lon: float, radius_m: float = 1609.0, max_polygons: int = 8000) -> dict:
        """Return ALL INSPIRE polygons within radius as a GeoJSON FeatureCollection."""
        empty = {"type": "FeatureCollection", "features": []}
        sb = _get_sb()
        if sb is None:
            return empty

        try:
            resp = sb.rpc("get_inspire_polygons_in_radius", {
                "p_lon": lon,
                "p_lat": lat,
                "p_radius": radius_m,
                "p_limit": max_polygons,
            }).execute()
            features = []
            for row in (resp.data or []):
                features.append({
                    "type": "Feature",
                    "properties": {
                        "inspire_id": row["inspire_id"],
                        "area_sqm": row.get("area_sqm"),
                        "centroid_lat": row.get("centroid_lat"),
                        "centroid_lon": row.get("centroid_lon"),
                    },
                    "geometry": json.loads(row["geojson"]),
                })
            log.info("INSPIRE radius: %.0fm from (%.5f, %.5f) → %d polygons", radius_m, lat, lon, len(features))
            return {"type": "FeatureCollection", "features": features}
        except Exception:
            log.exception("INSPIRE radius query failed")
            return empty

    def get_polygons_near_points(self, points: list[tuple[float, float]], radius_m: float = 50.0, max_polygons: int = 500) -> dict:
        """Return deduplicated INSPIRE polygons within radius_m of ANY of the given points."""
        empty = {"type": "FeatureCollection", "features": []}
        sb = _get_sb()
        if sb is None or not points:
            return empty

        try:
            # Convert points to format for RPC
            points_json = [{"lat": p[0], "lon": p[1]} for p in points]
            resp = sb.rpc("get_inspire_polygons_near_points", {
                "p_points": json.dumps(points_json),
                "p_radius": radius_m,
                "p_limit": max_polygons,
            }).execute()
            features = []
            for row in (resp.data or []):
                features.append({
                    "type": "Feature",
                    "properties": {
                        "inspire_id": row["inspire_id"],
                        "area_sqm": row.get("area_sqm"),
                        "centroid_lat": row.get("centroid_lat"),
                        "centroid_lon": row.get("centroid_lon"),
                    },
                    "geometry": json.loads(row["geojson"]),
                })
            log.info("INSPIRE near-points: %d points, %.0fm radius → %d polygons", len(points), radius_m, len(features))
            return {"type": "FeatureCollection", "features": features}
        except Exception:
            log.exception("INSPIRE near-points query failed")
            return empty

    @classmethod
    def load(cls, path=None) -> "InspireService":
        """Create service instance (no file loading — data is in Supabase PostGIS)."""
        log.info("INSPIRE: Using Supabase PostGIS table (title_boundaries)")
        return cls()

"""
Local Property Database Service
================================
Provides fast, pre-enriched comparable lookups from the local DuckDB containing
1.1M matched PPD+EPC records with building-level OS Open UPRN coordinates.

This replaces the Supabase PPD cache + live EPC API enrichment pipeline for
London properties, providing:
  - Zero external API calls (all data local)
  - Pre-matched EPC enrichment (floor area, rating, age band, type)
  - Building-level coordinates (~1-5m accuracy)
  - Sub-second query times

Coverage: Greater London, 2015-present, ~1.1M transactions.
Falls back to the existing Supabase pipeline for properties outside London
or where the local DB has insufficient results.

Contains OS data Crown copyright and database right 2026.
"""

import logging
import re
import threading
import time
from datetime import date, timedelta
from pathlib import Path

import duckdb

log = logging.getLogger(__name__)

_DEFAULT_PATH = Path(__file__).resolve().parent.parent.parent / "Research" / "EPC PPD merge project" / "db" / "propval.duckdb"


def _approx_build_year(age_band: str | None) -> int | None:
    """Extract approximate build year from EPC construction-age-band string."""
    if not age_band:
        return None
    m = re.search(r"(\d{4})\s*-\s*(\d{4})", age_band)
    if m:
        return (int(m.group(1)) + int(m.group(2))) // 2
    m = re.search(r"before\s+(\d{4})", age_band, re.IGNORECASE)
    if m:
        return int(m.group(1)) - 10
    m = re.search(r"(\d{4})\s+onwards", age_band, re.IGNORECASE)
    if m:
        return int(m.group(1)) + 2
    return None


def _derive_era(age_band: str | None) -> str | None:
    """Derive building era label from EPC construction-age-band."""
    if not age_band:
        return None
    yr = _approx_build_year(age_band)
    if yr is None:
        return None
    if yr < 1900:
        return "Victorian/Edwardian"
    if yr < 1919:
        return "Edwardian"
    if yr < 1945:
        return "Inter-war"
    if yr < 1965:
        return "Post-war"
    if yr < 1980:
        return "1965-1979"
    if yr < 2000:
        return "1980-1999"
    return "Modern"


def _derive_property_type(epc_type: str | None) -> str | None:
    """Map EPC property type to our internal type."""
    if not epc_type:
        return None
    t = epc_type.strip().lower()
    if t in ("flat", "maisonette"):
        return "flat"
    if t in ("house", "bungalow"):
        return "house"
    return None


# PPD single-letter property type -> (property_type, house_sub_type)
_PPD_TYPE_MAP = {
    "D": ("house", "detached"),
    "S": ("house", "semi-detached"),
    "T": ("house", "terraced"),
    "F": ("flat", None),
    "O": (None, None),
}


class LocalPropertyDB:
    """DuckDB-backed local property database for comparable search.

    Optimized schema: matched table has pre-computed outward_code column
    and denormalized ppd fields (duration, old_new, ppd_category).
    Table is sorted by outward_code for DuckDB zone-map acceleration.
    """

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._con = duckdb.connect(str(db_path), read_only=True)
        self._lock = threading.Lock()
        self._count = self._con.execute("SELECT count(*) FROM matched").fetchone()[0]
        # Cache all outward codes in memory for O(1) has_outward checks
        rows = self._con.execute("SELECT DISTINCT outward_code FROM matched").fetchall()
        self._outward_codes: frozenset[str] = frozenset(r[0] for r in rows if r[0])

    def lookup_construction_age(self, uprn: str | None, postcode: str | None,
                                address1: str | None = None) -> dict:
        """Look up PropVal's best construction age estimate from the enriched table.

        Returns dict with keys: age_best, age_estimated, age_source, age_band.
        Matches by UPRN first, then falls back to ADDRESS1+POSTCODE.
        """
        result = {"age_best": None, "age_estimated": None, "age_source": None, "age_band": None}

        with self._lock:
            # Try UPRN match first (most reliable)
            if uprn:
                uprn_clean = str(uprn).strip()
                row = self._con.execute("""
                    SELECT age_best, age_estimated, age_source, CONSTRUCTION_AGE_BAND
                    FROM construction_age
                    WHERE UPRN = ?
                    LIMIT 1
                """, [uprn_clean]).fetchone()
                if row:
                    result["age_best"] = row[0]
                    result["age_estimated"] = row[1]
                    result["age_source"] = row[2]
                    result["age_band"] = row[3]
                    return result

            # Fallback: ADDRESS1 + POSTCODE
            if address1 and postcode:
                row = self._con.execute("""
                    SELECT age_best, age_estimated, age_source, CONSTRUCTION_AGE_BAND
                    FROM construction_age
                    WHERE POSTCODE = ? AND ADDRESS1 = ?
                    LIMIT 1
                """, [postcode.strip().upper(), address1.strip()]).fetchone()
                if row:
                    result["age_best"] = row[0]
                    result["age_estimated"] = row[1]
                    result["age_source"] = row[2]
                    result["age_band"] = row[3]
                    return result

        return result

    def query_sale_history(self, uprn: str | None, postcode: str | None,
                           saon: str | None = None, paon: str | None = None) -> list[dict]:
        """Look up sale history from both matched and unmatched PPD tables.

        Matches by UPRN first. Falls back to SAON+postcode or PAON+postcode.
        Returns list of dicts with: date, price, tenure, new_build, category.
        """
        results: list[dict] = []
        with self._lock:
            # Try UPRN match first (most reliable)
            if uprn:
                uprn_clean = str(uprn).strip()
                rows = self._con.execute("""
                    SELECT date_of_transfer, price, duration, old_new, ppd_category,
                           saon, paon, street
                    FROM matched
                    WHERE UPRN = ?
                    ORDER BY date_of_transfer DESC
                """, [uprn_clean]).fetchall()
                if rows:
                    # Filter by SAON if provided (building-level UPRNs can return all flats)
                    if saon:
                        saon_upper = saon.strip().upper()
                        variants = {saon_upper}
                        if saon_upper.startswith("FLAT "):
                            variants.add("APARTMENT " + saon_upper[5:])
                        elif saon_upper.startswith("APARTMENT "):
                            variants.add("FLAT " + saon_upper[10:])
                        elif saon_upper.startswith("APT "):
                            variants.add("FLAT " + saon_upper[4:])
                        m = re.search(r"(\d+\w*)", saon_upper)
                        if m:
                            variants.add(m.group(1))
                        rows = [r for r in rows if (r[5] or "").strip().upper() in variants]
                    for r in rows:
                        results.append({
                            "date": str(r[0])[:10], "price": r[1],
                            "tenure": "leasehold" if r[2] == "L" else "freehold" if r[2] == "F" else None,
                            "new_build": r[3] == "Y",
                            "category": "A (standard)" if r[4] == "A" else "B (non-standard)" if r[4] == "B" else r[4],
                            "saon": r[5], "paon": r[6], "street": r[7],
                        })
                    return results

            # Fallback: SAON + postcode (for flats)
            if saon and postcode:
                saon_upper = saon.strip().upper()
                # Try exact match, then FLAT/APARTMENT swap
                variants = [saon_upper]
                if saon_upper.startswith("APARTMENT "):
                    variants.append("FLAT " + saon_upper[len("APARTMENT "):])
                elif saon_upper.startswith("APT "):
                    variants.append("FLAT " + saon_upper[len("APT "):])
                elif saon_upper.startswith("FLAT "):
                    variants.append("APARTMENT " + saon_upper[len("FLAT "):])
                # Also try just the number
                m = re.search(r"(\d+\w*)", saon_upper)
                if m:
                    variants.append(m.group(1))

                pc = postcode.strip().upper()
                for table in ("matched", "unmatched"):
                    placeholders = " OR ".join(["UPPER(saon) = ?"] * len(variants))
                    rows = self._con.execute(f"""
                        SELECT date_of_transfer, price, duration, old_new, ppd_category,
                               saon, paon, street
                        FROM {table}
                        WHERE postcode = ? AND ({placeholders})
                        ORDER BY date_of_transfer DESC
                    """, [pc] + variants).fetchall()
                    for r in rows:
                        results.append({
                            "date": str(r[0])[:10], "price": r[1],
                            "tenure": "leasehold" if r[2] == "L" else "freehold" if r[2] == "F" else r[2],
                            "new_build": r[3] == "Y",
                            "category": "A (standard)" if r[4] == "A" else "B (non-standard)" if r[4] == "B" else r[4],
                            "saon": r[5], "paon": r[6], "street": r[7],
                        })
                if results:
                    # Deduplicate by date+price
                    seen = set()
                    deduped = []
                    for r in results:
                        key = (r["date"], r["price"])
                        if key not in seen:
                            seen.add(key)
                            deduped.append(r)
                    return deduped

            # Fallback: PAON + postcode (for houses only — skip if SAON was requested)
            if paon and postcode and not saon:
                pc = postcode.strip().upper()
                paon_upper = paon.strip().upper()
                for table in ("matched", "unmatched"):
                    rows = self._con.execute(f"""
                        SELECT date_of_transfer, price, duration, old_new, ppd_category,
                               saon, paon, street
                        FROM {table}
                        WHERE postcode = ? AND UPPER(paon) = ?
                        ORDER BY date_of_transfer DESC
                    """, [pc, paon_upper]).fetchall()
                    for r in rows:
                        results.append({
                            "date": str(r[0])[:10], "price": r[1],
                            "tenure": "leasehold" if r[2] == "L" else "freehold" if r[2] == "F" else r[2],
                            "new_build": r[3] == "Y",
                            "category": "A (standard)" if r[4] == "A" else "B (non-standard)" if r[4] == "B" else r[4],
                            "saon": r[5], "paon": r[6], "street": r[7],
                        })

        return results

    def _row_to_dict(self, row: tuple, cols: list[str]) -> dict:
        """Convert a DuckDB row + column names into a dict matching the ppd_cache format
        WITH pre-applied EPC enrichment and coordinates."""
        d = dict(zip(cols, row))

        pc = (d.get("postcode") or "").strip().upper()
        ppd_code = (d.get("property_type") or d.get("ppd_type") or "").strip().upper()
        prop_type, sub_type = _PPD_TYPE_MAP.get(ppd_code, (None, None))

        # EPC-derived type overrides PPD type when available
        epc_prop_type = _derive_property_type(d.get("epc_type"))
        if epc_prop_type:
            prop_type = epc_prop_type

        duration = (d.get("duration") or "").strip().upper()
        tenure = "freehold" if duration == "F" else "leasehold" if duration == "L" else None

        old_new = (d.get("old_new") or "").strip().upper()
        cat = (d.get("ppd_category") or "").strip().upper()[:1] or None

        # Floor area
        floor_area = None
        try:
            fa = d.get("TOTAL_FLOOR_AREA")
            if fa:
                floor_area = float(str(fa))
        except (ValueError, TypeError):
            pass

        # Build year
        build_year = _approx_build_year(d.get("CONSTRUCTION_AGE_BAND"))
        era = _derive_era(d.get("CONSTRUCTION_AGE_BAND"))

        # Building name from EPC ADDRESS1
        building_name = None
        a1 = (d.get("ADDRESS1") or "").strip()
        m = re.match(r"^(?:FLAT|APT|APARTMENT|UNIT)\s+\d+\w*\s*(.+)?$", a1, re.IGNORECASE)
        if m and m.group(1):
            rem = m.group(1).strip()
            if not re.match(r"^\d", rem):
                building_name = rem.title()

        deed = ""
        dt = d.get("date_of_transfer")
        if dt:
            deed = str(dt)[:10]

        return {
            # Core PPD fields
            "transaction_id": d.get("transaction_id"),
            "sale_date":      deed,
            "price":          int(d.get("price") or 0),
            "postcode":       pc,
            "outward_code":   d.get("outward_code") or (pc.split()[0] if " " in pc else pc[:-3].strip()),
            "tenure":         tenure,
            "property_type":  prop_type,
            "house_sub_type": sub_type,
            "new_build":      old_new == "Y",
            "category":       cat,
            "saon":           (d.get("saon") or "").strip().upper(),
            "paon":           (d.get("paon") or "").strip().upper(),
            "street":         (d.get("street") or "").strip().upper(),

            # Pre-applied EPC enrichment
            "epc_matched":    d.get("LMK_KEY") is not None,
            "epc_uprn":       d.get("UPRN"),
            "bedrooms":       None,
            "floor_area_sqm": floor_area,
            "build_year":     build_year,
            "building_era":   era,
            "building_name":  building_name,
            "epc_rating":     d.get("CURRENT_ENERGY_RATING"),
            "epc_score":      None,

            # Pre-resolved coordinates (OS Open UPRN)
            "_lat":           d.get("lat"),
            "_lon":           d.get("lon"),
            "_coord_source":  d.get("coord_source"),
        }

    def _query(self, sql: str, params: list = None) -> list[dict]:
        """Execute query and return list of enriched dicts. Thread-safe via lock."""
        with self._lock:
            result = self._con.execute(sql, params or []).fetchall()
            if not result:
                return []
            cols = [desc[0] for desc in self._con.description]
        return [self._row_to_dict(row, cols) for row in result]

    def autocomplete_by_postcode(self, postcode: str) -> list[dict]:
        """Return distinct address+UPRN pairs for autocomplete dropdown."""
        pc = postcode.strip().upper()
        with self._lock:
            result = self._con.execute("""
                SELECT DISTINCT
                    COALESCE(saon, '') AS saon,
                    COALESCE(paon, '') AS paon,
                    COALESCE(street, '') AS street,
                    postcode,
                    COALESCE(UPRN, '') AS uprn
                FROM matched
                WHERE postcode = ?
                ORDER BY paon, saon
            """, [pc]).fetchall()
        if not result:
            return []
        seen: set[str] = set()
        addresses: list[dict] = []
        for saon, paon, street, pc_val, uprn in result:
            parts = [p for p in [saon, paon, street, pc_val] if p.strip()]
            addr = ", ".join(parts)
            key = addr.upper()
            if key not in seen:
                seen.add(key)
                addresses.append({"address": addr, "uprn": uprn})
        return addresses

    def query_postcode(self, postcode: str, months: int,
                       val_date: date | None = None) -> list[dict]:
        """All matched transactions for an exact postcode within last N months."""
        anchor = val_date or date.today()
        date_from = (anchor - timedelta(days=months * 30)).isoformat()
        return self._query("""
            SELECT * FROM matched
            WHERE postcode = ?
              AND CAST(date_of_transfer AS VARCHAR) >= ?
            ORDER BY date_of_transfer DESC
        """, [postcode.strip().upper(), date_from])

    def query_outward(self, outward: str, months: int,
                      val_date: date | None = None) -> list[dict]:
        """All matched transactions for an outward code within last N months."""
        anchor = val_date or date.today()
        date_from = (anchor - timedelta(days=months * 30)).isoformat()
        return self._query("""
            SELECT * FROM matched
            WHERE outward_code = ?
              AND CAST(date_of_transfer AS VARCHAR) >= ?
            ORDER BY date_of_transfer DESC
        """, [outward.strip().upper(), date_from])

    def query_building(self, outward: str, building_name: str, months: int,
                       val_date: date | None = None) -> list[dict]:
        """Transactions where PAON contains building name in outward code area."""
        anchor = val_date or date.today()
        date_from = (anchor - timedelta(days=months * 30)).isoformat()
        bldg = building_name.strip().upper()
        return self._query("""
            SELECT * FROM matched
            WHERE outward_code = ?
              AND (UPPER(paon) LIKE ? OR UPPER(paon) LIKE ?)
              AND CAST(date_of_transfer AS VARCHAR) >= ?
            ORDER BY date_of_transfer DESC
        """, [outward.strip().upper(), f"{bldg}%", f"% {bldg}%", date_from])

    def query_paon_street(self, outward: str, paon: str, street: str, months: int,
                          val_date: date | None = None) -> list[dict]:
        """Transactions matching PAON + street in outward code area."""
        anchor = val_date or date.today()
        date_from = (anchor - timedelta(days=months * 30)).isoformat()
        return self._query("""
            SELECT * FROM matched
            WHERE outward_code = ?
              AND UPPER(paon) = ?
              AND UPPER(street) = ?
              AND CAST(date_of_transfer AS VARCHAR) >= ?
            ORDER BY date_of_transfer DESC
        """, [outward.strip().upper(), paon.strip().upper(),
              street.strip().upper(), date_from])

    def query_street(self, outward: str, street: str, months: int,
                     val_date: date | None = None) -> list[dict]:
        """All transactions on a street in outward code area."""
        anchor = val_date or date.today()
        date_from = (anchor - timedelta(days=months * 30)).isoformat()
        return self._query("""
            SELECT * FROM matched
            WHERE outward_code = ?
              AND UPPER(street) = ?
              AND CAST(date_of_transfer AS VARCHAR) >= ?
            ORDER BY date_of_transfer DESC
        """, [outward.strip().upper(), street.strip().upper(), date_from])

    def query_street_multi(self, outward_codes: list[str], street: str, months: int,
                           val_date: date | None = None) -> list[dict]:
        """All transactions on a street across multiple outward codes."""
        anchor = val_date or date.today()
        date_from = (anchor - timedelta(days=months * 30)).isoformat()
        ocs = [oc.strip().upper() for oc in outward_codes]
        placeholders = ",".join("?" for _ in ocs)
        return self._query(f"""
            SELECT * FROM matched
            WHERE outward_code IN ({placeholders})
              AND UPPER(street) = ?
              AND CAST(date_of_transfer AS VARCHAR) >= ?
            ORDER BY date_of_transfer DESC
        """, ocs + [street.strip().upper(), date_from])

    def query_browse(self, outward: str, filters: dict,
                     val_date: date | None = None) -> list[dict]:
        """Browse all sales in outward code with optional filters."""
        conditions = ["outward_code = ?"]
        params: list = [outward.strip().upper()]

        if filters.get("property_type"):
            conditions.append("ppd_type = ?")
            params.append(filters["property_type"].strip().upper())
        if filters.get("estate_type"):
            conditions.append("duration = ?")
            params.append(filters["estate_type"].strip().upper())
        if filters.get("min_date"):
            conditions.append("CAST(date_of_transfer AS VARCHAR) >= ?")
            params.append(filters["min_date"])
        if filters.get("max_date"):
            conditions.append("CAST(date_of_transfer AS VARCHAR) <= ?")
            params.append(filters["max_date"])
        if filters.get("min_price"):
            conditions.append("price >= ?")
            params.append(int(filters["min_price"]))
        if filters.get("max_price"):
            conditions.append("price <= ?")
            params.append(int(filters["max_price"]))
        if filters.get("new_build"):
            conditions.append("old_new = ?")
            params.append(filters["new_build"].strip().upper())
        if filters.get("exclude_postcode"):
            conditions.append("postcode != ?")
            params.append(filters["exclude_postcode"].strip().upper())

        where = " AND ".join(conditions)
        return self._query(f"""
            SELECT * FROM matched
            WHERE {where}
            ORDER BY date_of_transfer DESC
            LIMIT 500
        """, params)

    def has_outward(self, outward: str) -> bool:
        """O(1) check if we have data for this outward code (cached in memory at startup)."""
        return outward.strip().upper() in self._outward_codes

    @property
    def outward_codes(self) -> frozenset[str]:
        return self._outward_codes

    @property
    def loaded(self) -> bool:
        return self._con is not None

    @property
    def count(self) -> int:
        return self._count

    @classmethod
    def load(cls, path: str | Path | None = None) -> "LocalPropertyDB | None":
        """Load the DuckDB database and return a service instance."""
        db_path = Path(path) if path else _DEFAULT_PATH
        if not db_path.exists():
            log.warning(
                "Local property DB not found at %s -- local comparable search disabled.",
                db_path,
            )
            return None
        try:
            t0 = time.monotonic()
            svc = cls(db_path)
            log.info(
                "Local property DB: Loaded %s (%s matched records, %d outward codes) in %.1fs",
                db_path.name, f"{svc.count:,}", len(svc._outward_codes), time.monotonic() - t0,
            )
            return svc
        except Exception:
            log.exception("Local property DB: Failed to load")
            return None

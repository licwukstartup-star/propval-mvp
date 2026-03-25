"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { API_BASE } from "@/lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  mode:                  "building" | "outward";
  locked?:               boolean;           // outward mode: block search until building search is done
  onSearchComplete?:     (ids: string[], addressKeys: string[]) => void;  // building mode: notify parent
  onSearchResult?:       (result: SearchResponse) => void;  // notify parent of search results for persistence
  initialResult?:        SearchResponse | null;              // pre-loaded results from saved case
  excludeIds?:           string[];          // outward mode: transaction IDs to skip
  excludeAddressKeys?:   string[];          // outward mode: address keys (SAON|POSTCODE) to skip
  onAdopt?:              (comp: ComparableCandidate) => void;
  onAdoptAll?:           (comps: ComparableCandidate[]) => void;
  onUnadoptAll?:         (comps: ComparableCandidate[]) => void;
  adoptedIds?:           Set<string>;       // transaction_id|address keys already adopted
  valuationDate:         string;            // shared valuation date (controlled by parent)
  onValuationDateChange: (d: string) => void;
  uprn:               string | null;
  lat:                number | null;
  lon:                number | null;
  postcode:           string | null;
  floorArea:          number | null;
  rooms:              number | null;
  ageBand:            string | null;
  epcRating:          string | null;
  propertyType:       string | null;
  builtForm:          string | null;
  tenure:             string | null;
  buildingName:       string | null;
  paonNumber:         string | null;
  saon:               string | null;
  streetName:         string | null;
  lastSoldPrice?:     number | null;
  lastSoldDate?:      string | null;
  subjectImdDecile?:  number | null;
}

export interface ComparableCandidate {
  transaction_id:       string | null;
  address:              string;
  postcode:             string;
  outward_code:         string;
  saon:                 string | null;
  tenure:               string | null;
  property_type:        string | null;
  house_sub_type:       string | null;
  bedrooms:             number | null;
  building_name:        string | null;
  building_era:         string | null;
  construction_age_band: string | null;
  construction_age_best: number | null;
  build_year:            number | null;
  build_year_estimated:  boolean;
  floor_area_sqm:       number | null;
  price:                number;
  transaction_date:     string;
  new_build:            boolean;
  transaction_category: string | null;
  geographic_tier:      number;
  tier_label:           string;
  spec_relaxations:     string[];
  time_window_months:   number;
  epc_matched:          boolean;
  epc_rating:           string | null;
  epc_score:            number | null;
  months_ago:           number | null;
  lease_remaining:      string | null;
  distance_m:           number | null;
  coord_source:         string | null;
  lat:                  number | null;
  lon:                  number | null;
  imd_decile?:          number | null;
  // Option E: UPRN Timeline snapshot fields (populated after API persist)
  snapshot_id?:         string;
  case_comp_id?:        string;
  source?:              string;   // hmlr_ppd | epc | additional | csv_import | manual | user_override
  [key: string]:        unknown;
}

interface SearchMetadata {
  tiers_searched:           number;
  spec_relaxations_applied: string[];
  total_candidates_scanned: number;
  search_duration_ms:       number;
  target_met:               boolean;
}

export interface SearchResponse {
  target_count:    number;
  comparables:     ComparableCandidate[];
  search_metadata: SearchMetadata;
}

// ─── Derivation helpers (EPC → spec format) ──────────────────────────────────

function derivePropertyType(epc: string | null): "flat" | "house" {
  if (!epc) return "flat";
  const v = epc.toLowerCase();
  if (v.includes("flat") || v.includes("maisonette")) return "flat";
  return "house";
}

function deriveHouseSubType(builtForm: string | null): string | null {
  if (!builtForm) return null;
  const bf = builtForm.toLowerCase();
  if (bf.includes("semi")) return "semi-detached";
  if (bf.includes("end") && (bf.includes("terrace") || bf.includes("terr"))) return "end-terrace";
  if (bf.includes("terrace") || bf.includes("terr") || bf.includes("mid")) return "terraced";
  if (bf.includes("detached")) return "detached";
  return null;
}

const AGE_BAND_YEAR: Record<string, number> = {
  "before 1900": 1890, "1900-1929": 1915, "1930-1949": 1940,
  "1950-1966":   1958, "1967-1975": 1971, "1976-1982": 1979,
  "1983-1990":   1987, "1991-1995": 1993, "1996-2002": 1999,
  "2003-2006":   2005, "2007 onwards": 2010,
};

function deriveBuildYear(ageBand: string | null): number | null {
  if (!ageBand) return null;
  const b = ageBand.toLowerCase().trim();
  for (const [key, yr] of Object.entries(AGE_BAND_YEAR)) {
    if (key.includes(b) || b.includes(key)) return yr;
  }
  return null;
}

function deriveBuildingEra(buildYear: number | null): "period" | "modern" | null {
  if (buildYear === null) return null;
  return buildYear >= 2000 ? "modern" : "period";
}

/**
 * Derive era from an EPC age band string using the *upper* year of the range.
 * "1996-2002" → upper bound 2002 ≥ 2000 → modern (midpoint 1999 would be wrong).
 */
function deriveEraFromAgeBand(ageBand: string | null): "period" | "modern" | null {
  if (!ageBand) return null;
  const b = ageBand.toLowerCase().trim();
  if (b.includes("onwards") || b.includes("new")) return "modern";
  if (b.includes("before")) return "period";
  const years = [...b.matchAll(/\d{4}/g)].map(m => parseInt(m[0], 10));
  if (years.length === 0) return null;
  return Math.max(...years) >= 2000 ? "modern" : "period";
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtPrice(p: number): string {
  return "£" + p.toLocaleString("en-GB");
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleDateString("en-GB", { month: "short" });
  const yr = String(d.getFullYear()).slice(-2);
  return `${day} ${mon} ${yr}`;
}

function fmtMonthsAgo(n: number | null): string {
  if (n === null) return "";
  if (n < 1) return "< 1 month ago";
  if (n === 1) return "1 month ago";
  if (n < 12) return `${n} months ago`;
  const yrs = Math.floor(n / 12);
  const mo  = n % 12;
  if (mo === 0) return `${yrs} yr ago`;
  return `${yrs} yr ${mo} mo ago`;
}

// ─── Tier styling ─────────────────────────────────────────────────────────────

const TIER_STYLE: Record<number, { pill: string; header: string; icon: string }> = {
  1: { pill: "bg-[#39FF14]/15 text-[var(--color-status-success)]",  header: "bg-[#39FF14]/5  border-[#39FF14]/30", icon: "🏢" },
  2: { pill: "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)]",   header: "bg-[var(--color-btn-primary-bg)]/5  border-[var(--color-accent)]/30",  icon: "🏘️" },
  3: { pill: "bg-[#FFB800]/15 text-[var(--color-status-warning)]",  header: "bg-[#FFB800]/5  border-[#FFB800]/30", icon: "📍" },
  4: { pill: "bg-[var(--color-text-secondary)]/15 text-[var(--color-text-secondary)]",  header: "bg-[#94A3B8]/10 border-[var(--color-border)]",   icon: "🗺️" },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ComparableSearch({
  mode, locked = false, onSearchComplete, onSearchResult, initialResult = null,
  excludeIds = [], excludeAddressKeys = [],
  onAdopt, onAdoptAll, onUnadoptAll, adoptedIds = new Set(),
  valuationDate, onValuationDateChange,
  uprn, lat, lon, postcode, floorArea, rooms, ageBand, epcRating,
  propertyType, builtForm, tenure, buildingName, paonNumber, saon, streetName,
  lastSoldPrice = null, lastSoldDate = null, subjectImdDecile = null,
}: Props) {
  const { session } = useAuth();
  const isBuilding = mode === "building";
  const [targetCount,    setTargetCount]    = useState(10);
  const [loading,             setLoading]             = useState(false);
  const [error,               setError]               = useState<string | null>(null);
  const [result,              setResult]              = useState<SearchResponse | null>(initialResult);
  const [rejected,            setRejected]            = useState<Set<string>>(new Set());
  const [sortBy,              setSortBy]              = useState<SortKey>("default");
  const [sortDir,             setSortDir]             = useState<"asc" | "desc">("desc");
  const [filtersOpen,         setFiltersOpen]         = useState(false);
  const [filterTenure,        setFilterTenure]        = useState<"all" | "freehold" | "leasehold">("all");
  const [filterType,          setFilterType]          = useState<"all" | "flat" | "house">("all");
  const [filterEpcVerified,   setFilterEpcVerified]   = useState<"all" | "yes" | "no">("all");
  const [filterNewBuild,      setFilterNewBuild]      = useState<"all" | "yes" | "no">("all");
  const [filterMinPrice,      setFilterMinPrice]      = useState<string>("");
  const [filterMaxPrice,      setFilterMaxPrice]      = useState<string>("");
  const [filterMinArea,       setFilterMinArea]       = useState<string>("");
  const [filterMaxArea,       setFilterMaxArea]       = useState<string>("");
  const [filterMinRooms,      setFilterMinRooms]      = useState<string>("");
  const [filterMaxRooms,      setFilterMaxRooms]      = useState<string>("");
  const [filterMinAge,        setFilterMinAge]        = useState<string>("");
  const [filterMaxAge,        setFilterMaxAge]        = useState<string>("");
  const [filterEpcRating,     setFilterEpcRating]     = useState<Set<string>>(new Set());
  const [filterPostcode,      setFilterPostcode]      = useState<Set<string>>(new Set());
  const [filterAddress,       setFilterAddress]       = useState<string>("");
  const [filterMinPsf,        setFilterMinPsf]        = useState<string>("");
  const [filterMaxPsf,        setFilterMaxPsf]        = useState<string>("");
  const [filterMinDate,       setFilterMinDate]       = useState<string>("");
  const [filterMaxDate,       setFilterMaxDate]       = useState<string>("");
  const [filterMinImd,        setFilterMinImd]        = useState<string>("");
  const [filterMaxImd,        setFilterMaxImd]        = useState<string>("");
  const [ageMin,              setAgeMin]              = useState(-50);   // e.g. -50 = allow 50 yrs older
  const [ageMax,              setAgeMax]              = useState(30);    // e.g. +30 = allow 30 yrs newer
  const [outwardEnabled,      setOutwardEnabled]      = useState(false); // outward mode only
  const [radiusMiles,         setRadiusMiles]         = useState<number | null>(null); // max radius in miles (null = no limit)
  const [buildingMonths,      setBuildingMonths]      = useState(36);    // Tier 1 time window (same building / same street)
  const [neighbouringMonths,  setNeighbouringMonths]  = useState(12);    // outward mode only

  // Sync local result with parent state when initialResult changes
  // (e.g. case restore while component is already mounted)
  useEffect(() => {
    if (initialResult && !result) {
      setResult(initialResult);
    }
  }, [initialResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // When loading from saved case, fire onSearchComplete so outward tab unlocks
  useEffect(() => {
    if (initialResult && isBuilding && onSearchComplete) {
      const ids = initialResult.comparables
        .map(c => c.transaction_id)
        .filter((id): id is string => id !== null);
      const addressKeys = initialResult.comparables
        .filter(c => c.saon)
        .map(c => `${c.saon!.toUpperCase()}|${c.postcode}`);
      onSearchComplete(ids, addressKeys);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildYear  = deriveBuildYear(ageBand);
  const era        = deriveEraFromAgeBand(ageBand) ?? deriveBuildingEra(buildYear);
  const propType   = derivePropertyType(propertyType);
  const subType    = propType === "house" ? deriveHouseSubType(builtForm) : null;
  const normTenure = tenure?.toLowerCase() === "freehold" ? "freehold" : "leasehold";
  // Normalise rooms: EPC may return "" when the field is absent
  const normRooms: number | null = (rooms !== null && rooms !== undefined && String(rooms) !== "" && !isNaN(Number(rooms)))
    ? Number(rooms) : null;

  async function runSearch() {
    if (!valuationDate) { setError("Please select a valuation date before searching."); return; }
    if (!postcode) { setError("No postcode available."); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    setRejected(new Set());

    const address = [buildingName, streetName, postcode]
      .filter(Boolean).join(", ");

    const body = {
      subject: {
        address:       address || postcode,
        postcode:      postcode,
        uprn:          uprn ?? undefined,
        lat:           lat ?? undefined,
        lon:           lon ?? undefined,
        tenure:        normTenure,
        property_type: propType,
        house_sub_type: subType,
        bedrooms:       normRooms ?? undefined,
        building_name:  buildingName ?? undefined,
        paon_number:    paonNumber ?? undefined,
        saon:           saon ?? undefined,
        building_era:   era ?? undefined,
        build_year:     buildYear ?? undefined,
        street_name:    streetName ?? undefined,
      },
      target_count:   targetCount,
      valuation_date: valuationDate || undefined,
      max_tier:                isBuilding ? 2 : (outwardEnabled ? 4 : 3),
      building_months:         buildingMonths,
      neighbouring_months:     neighbouringMonths,
      age_min:                 ageMin,
      age_max:                 ageMax,
      exclude_transaction_ids: isBuilding ? [] : excludeIds,
      exclude_address_keys:    isBuilding ? [] : excludeAddressKeys,
      max_distance_m:          radiusMiles != null ? Math.round(radiusMiles * 1609.34) : undefined,
    };

    try {
      const r = await fetch(`${API_BASE}/api/comparables/search`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body:    JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail ?? `HTTP ${r.status}`);
      }
      const data: SearchResponse = await r.json();
      setResult(data);
      if (onSearchResult) onSearchResult(data);
      if (isBuilding && onSearchComplete) {
        const ids = data.comparables
          .map(c => c.transaction_id)
          .filter((id): id is string => id !== null);
        // Address keys: SAON|POSTCODE — used to exclude same flat even across different transactions
        const addressKeys = data.comparables
          .filter(c => c.saon)
          .map(c => `${c.saon!.toUpperCase()}|${c.postcode}`);
        onSearchComplete(ids, addressKeys);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed.");
      // Unlock wider comparables even when building search errors —
      // otherwise the user is stuck with no way to proceed.
      if (isBuilding && onSearchComplete) onSearchComplete([], []);
    } finally {
      setLoading(false);
    }
  }

  // Valuation year for building age calculations
  const valuationYear = valuationDate
    ? new Date(valuationDate).getFullYear()
    : new Date().getFullYear();

  // ── Subject info card ──

  const eraLabel = era
    ? (() => {
        const label = era.charAt(0).toUpperCase() + era.slice(1);
        if (buildYear != null) {
          const age = valuationYear - buildYear;
          return `${label} (${buildYear}, ${age} yr${age !== 1 ? "s" : ""})`;
        }
        return label;
      })()
    : null;

  const subjectSummary = [
    propType === "flat" ? "Flat" : "House",
    subType ? `(${subType})` : null,
    normTenure === "freehold" ? "Freehold" : "Leasehold",
    normRooms != null ? `${normRooms} habitable room${normRooms !== 1 ? "s" : ""}` : null,
    eraLabel,
    floorArea ? `${floorArea} m²` : null,
  ].filter(Boolean).join(" · ");

  // ── Sort & group comparables by tier ──

  function sortComps(comps: ComparableCandidate[]): ComparableCandidate[] {
    if (sortBy === "default") return comps;
    const sorted = [...comps].sort((a, b) => {
      let av: number, bv: number;
      switch (sortBy) {
        case "date":
          av = new Date(a.transaction_date).getTime();
          bv = new Date(b.transaction_date).getTime();
          break;
        case "size":
          av = a.floor_area_sqm ?? -1;
          bv = b.floor_area_sqm ?? -1;
          break;
        case "price":
          av = a.price;
          bv = b.price;
          break;
        case "psf":
          av = a.floor_area_sqm ? a.price / (a.floor_area_sqm * 10.764) : -1;
          bv = b.floor_area_sqm ? b.price / (b.floor_area_sqm * 10.764) : -1;
          break;
        case "postcode":
          return sortDir === "asc"
            ? (a.postcode ?? "").localeCompare(b.postcode ?? "")
            : (b.postcode ?? "").localeCompare(a.postcode ?? "");
        case "type":
          return sortDir === "asc"
            ? (a.property_type ?? "").localeCompare(b.property_type ?? "")
            : (b.property_type ?? "").localeCompare(a.property_type ?? "");
        case "rooms":
          av = a.bedrooms ?? -1;
          bv = b.bedrooms ?? -1;
          break;
        case "epc":
          av = a.epc_rating ? a.epc_rating.charCodeAt(0) : 999;
          bv = b.epc_rating ? b.epc_rating.charCodeAt(0) : 999;
          break;
        case "imd":
          av = a.imd_decile ?? 0;
          bv = b.imd_decile ?? 0;
          break;
        case "age":
          av = a.construction_age_best ?? -1;
          bv = b.construction_age_best ?? -1;
          break;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }

  // ── Filter logic ──────────────────────────────────────────────────────────
  function filterComps(comps: ComparableCandidate[]): ComparableCandidate[] {
    return comps.filter(c => {
      if (filterTenure !== "all" && c.tenure?.toLowerCase() !== filterTenure) return false;
      if (filterType !== "all") {
        const ct = c.property_type?.toLowerCase() ?? "";
        const isFlat = ct.includes("flat") || ct.includes("maisonette");
        if (filterType === "flat" && !isFlat) return false;
        if (filterType === "house" && isFlat) return false;
      }
      if (filterEpcVerified === "yes" && !c.epc_matched) return false;
      if (filterEpcVerified === "no" && c.epc_matched) return false;
      if (filterNewBuild === "yes" && !c.new_build) return false;
      if (filterNewBuild === "no" && c.new_build) return false;
      const minP = filterMinPrice ? Number(filterMinPrice) : null;
      const maxP = filterMaxPrice ? Number(filterMaxPrice) : null;
      if (minP != null && c.price < minP) return false;
      if (maxP != null && c.price > maxP) return false;
      const minA = filterMinArea ? Number(filterMinArea) : null;
      const maxA = filterMaxArea ? Number(filterMaxArea) : null;
      if (minA != null && (c.floor_area_sqm == null || c.floor_area_sqm < minA)) return false;
      if (maxA != null && (c.floor_area_sqm == null || c.floor_area_sqm > maxA)) return false;
      const minR = filterMinRooms ? Number(filterMinRooms) : null;
      const maxR = filterMaxRooms ? Number(filterMaxRooms) : null;
      if (minR != null && (c.bedrooms == null || c.bedrooms < minR)) return false;
      if (maxR != null && (c.bedrooms == null || c.bedrooms > maxR)) return false;
      if (filterEpcRating.size > 0 && (!c.epc_rating || !filterEpcRating.has(c.epc_rating))) return false;
      const minAge = filterMinAge ? Number(filterMinAge) : null;
      const maxAge = filterMaxAge ? Number(filterMaxAge) : null;
      if (minAge != null && (c.construction_age_best == null || c.construction_age_best < minAge)) return false;
      if (maxAge != null && (c.construction_age_best == null || c.construction_age_best > maxAge)) return false;
      if (filterPostcode.size > 0 && !filterPostcode.has(c.postcode)) return false;
      if (filterAddress && !c.address.toLowerCase().includes(filterAddress.toLowerCase())) return false;
      if (filterMinPsf || filterMaxPsf) {
        const psf = c.floor_area_sqm ? c.price / (c.floor_area_sqm * 10.7639) : null;
        const minPsf = filterMinPsf ? Number(filterMinPsf) : null;
        const maxPsf = filterMaxPsf ? Number(filterMaxPsf) : null;
        if (minPsf != null && (psf == null || psf < minPsf)) return false;
        if (maxPsf != null && (psf == null || psf > maxPsf)) return false;
      }
      if (filterMinDate && c.transaction_date < filterMinDate) return false;
      if (filterMaxDate && c.transaction_date > filterMaxDate) return false;
      const minImd = filterMinImd ? Number(filterMinImd) : null;
      const maxImd = filterMaxImd ? Number(filterMaxImd) : null;
      if (minImd != null && (c.imd_decile == null || c.imd_decile < minImd)) return false;
      if (maxImd != null && (c.imd_decile == null || c.imd_decile > maxImd)) return false;
      return true;
    });
  }

  const activeFilterCount = [
    filterTenure !== "all",
    filterType !== "all",
    filterEpcVerified !== "all",
    filterNewBuild !== "all",
    filterMinPrice !== "",
    filterMaxPrice !== "",
    filterMinArea !== "",
    filterMaxArea !== "",
    filterMinRooms !== "",
    filterMaxRooms !== "",
    filterMinAge !== "",
    filterMaxAge !== "",
    filterEpcRating.size > 0,
    filterPostcode.size > 0,
    filterAddress !== "",
    filterMinPsf !== "",
    filterMaxPsf !== "",
    filterMinDate !== "",
    filterMaxDate !== "",
    filterMinImd !== "",
    filterMaxImd !== "",
  ].filter(Boolean).length;

  function clearAllFilters() {
    setFilterTenure("all"); setFilterType("all"); setFilterEpcVerified("all");
    setFilterNewBuild("all"); setFilterMinPrice(""); setFilterMaxPrice("");
    setFilterMinArea(""); setFilterMaxArea(""); setFilterMinRooms(""); setFilterMaxRooms("");
    setFilterMinAge(""); setFilterMaxAge(""); setFilterEpcRating(new Set());
    setFilterPostcode(new Set()); setFilterAddress("");
    setFilterMinPsf(""); setFilterMaxPsf(""); setFilterMinDate(""); setFilterMaxDate("");
    setFilterMinImd(""); setFilterMaxImd("");
  }

  const byTier: Record<number, ComparableCandidate[]> = {};
  if (result) {
    const filtered = filterComps(result.comparables);
    if (sortBy === "default") {
      for (const c of filtered) {
        if (!byTier[c.geographic_tier]) byTier[c.geographic_tier] = [];
        byTier[c.geographic_tier].push(c);
      }
    } else {
      // When sorted, show all in a single flat list (tier grouping would break sort order)
      byTier[0] = sortComps(filtered);
    }
  }

  const activeCount = result
    ? result.comparables.filter(c => !rejected.has(c.transaction_id ?? c.address)).length
    : 0;

  const filteredTotal = result ? filterComps(result.comparables).length : 0;

  return (
    <div className="space-y-5">

      {/* ── Locked notice (outward mode, building search not yet done) ── */}
      {locked && (
        <div className="rounded-2xl border border-[#FFB800]/40 bg-[#FFB800]/10 px-5 py-4 text-sm text-[var(--color-status-warning)] flex items-start gap-3">
          <span className="text-lg leading-none">🔒</span>
          <div>
            <p className="font-semibold">Run Same Building Sales first</p>
            <p className="text-xs mt-0.5 text-[var(--color-status-warning)]">
              Complete the Same Building Sales search before searching neighbouring properties.
              This ensures same-building results are excluded from this search.
            </p>
          </div>
        </div>
      )}

      {/* ── Controls ── */}
      <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-4 py-3 shadow-md shadow-black/20 space-y-2.5 ${locked ? "opacity-50 pointer-events-none select-none" : ""}`}>
        {/* Single compact row: date + sliders + button */}
        <div className="flex items-end gap-3 flex-wrap">
          {/* Valuation date */}
          <div className="shrink-0">
            <label className="block text-[10px] font-medium text-[var(--color-text-secondary)]/70 mb-0.5">
              Val. date <span className="text-[var(--color-accent-pink)]">*</span>
            </label>
            <input
              type="date"
              value={valuationDate}
              onChange={e => onValuationDateChange(e.target.value)}
              className={`border rounded-lg px-2 py-1 text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${
                !valuationDate ? "border-[#FF2D78]/60" : "border-[var(--color-border)]"
              }`}
            />
          </div>

          {/* Time window slider */}
          <div className="flex-1 min-w-[140px] max-w-[200px]">
            <label className="block text-[10px] font-medium text-[var(--color-text-secondary)]/70 mb-0.5">
              Time <span className="font-semibold text-[var(--color-text-primary)]">{isBuilding ? buildingMonths : neighbouringMonths}mo</span>
            </label>
            {isBuilding ? (
              <input type="range" min={12} max={36} step={6} value={buildingMonths}
                onChange={e => setBuildingMonths(Number(e.target.value))}
                className="w-full h-1.5 accent-[var(--color-accent)]" />
            ) : (
              <input type="range" min={6} max={24} step={6} value={neighbouringMonths}
                onChange={e => setNeighbouringMonths(Number(e.target.value))}
                className="w-full h-1.5 accent-[var(--color-accent)]" />
            )}
            <div className="flex justify-between text-[9px] text-[var(--color-text-secondary)]/50 -mt-0.5">
              {(isBuilding ? [12, 24, 36] : [6, 12, 24]).map(v => <span key={v}>{v}</span>)}
            </div>
          </div>

          {/* Building age — dual range */}
          <div className="flex-1 min-w-[160px] max-w-[240px]">
            <label className="block text-[10px] font-medium text-[var(--color-text-secondary)]/70 mb-0.5">
              Age <span className="font-semibold text-[var(--color-text-primary)]">{ageMin}/{ageMax > 0 ? "+" : ""}{ageMax}yr</span>
            </label>
            <div className="relative h-4">
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded bg-[var(--color-border)]" />
              <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-[var(--color-accent)]"
                style={{ left: `${((ageMin + 150) / 300) * 100}%`, right: `${((150 - ageMax) / 300) * 100}%` }} />
              <input type="range" min={-150} max={150} step={10} value={ageMin}
                onChange={e => { const v = Number(e.target.value); if (v <= ageMax) setAgeMin(v); }}
                className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-bg-panel)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--color-accent)] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-bg-panel)]" />
              <input type="range" min={-150} max={150} step={10} value={ageMax}
                onChange={e => { const v = Number(e.target.value); if (v >= ageMin) setAgeMax(v); }}
                className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-bg-panel)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--color-accent)] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-bg-panel)]" />
            </div>
            <div className="flex justify-between text-[9px] text-[var(--color-text-secondary)]/50 -mt-0.5">
              <span>-150</span><span>0</span><span>+150</span>
            </div>
          </div>

          {/* Target count — outward only */}
          {!isBuilding && (
            <div className="shrink-0">
              <label className="block text-[10px] font-medium text-[var(--color-text-secondary)]/70 mb-0.5">Target</label>
              <div className="flex gap-0.5">
                {[5, 8, 10, 15, 20].map(n => (
                  <button key={n} onClick={() => setTargetCount(n)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      targetCount === n
                        ? "bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]"
                        : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                    }`}
                  >{n}</button>
                ))}
              </div>
            </div>
          )}

          {/* Radius filter — outward only */}
          {!isBuilding && (
            <div className="shrink-0">
              <label className="block text-[10px] font-medium text-[var(--color-text-secondary)]/70 mb-0.5">Radius</label>
              <div className="flex gap-0.5">
                {([null, 0.5, 1, 1.5, 2, 3] as (number | null)[]).map(r => (
                  <button key={String(r)} onClick={() => setRadiusMiles(r)}
                    className={`px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${
                      radiusMiles === r
                        ? "bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]"
                        : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                    }`}
                  >{r == null ? "All" : `${r}mi`}</button>
                ))}
              </div>
            </div>
          )}

          {/* Adjacent toggle — outward only */}
          {!isBuilding && (
            <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
              <button onClick={() => setOutwardEnabled(v => !v)}
                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${outwardEnabled ? "bg-[var(--color-btn-primary-bg)]" : "bg-[var(--color-border)]"}`}
                role="switch" aria-checked={outwardEnabled}>
                <span className={`inline-block h-3 w-3 rounded-full bg-[var(--color-text-primary)] shadow transform transition-transform duration-200 ${outwardEnabled ? "translate-x-3" : "translate-x-0"}`} />
              </button>
              <span className="text-[10px] text-[var(--color-text-secondary)]">Adj. areas</span>
            </div>
          )}

          {/* Search button */}
          <button onClick={runSearch} disabled={loading || !postcode || !valuationDate}
            className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)] hover:bg-[#00D4E0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={!valuationDate ? "Set valuation date first" : undefined}
          >
            {loading ? "Searching…" : "Find comparables"}
          </button>
        </div>

        {/* Exclusion notice — outward mode */}
        {!isBuilding && (excludeIds.length > 0 || excludeAddressKeys.length > 0) && (
          <p className="text-[10px] text-[var(--color-accent)]/80">
            ℹ Same Building results excluded ({excludeAddressKeys.length} address{excludeAddressKeys.length !== 1 ? "es" : ""}{excludeIds.length > 0 ? ` + ${excludeIds.length} ID${excludeIds.length !== 1 ? "s" : ""}` : ""})
          </p>
        )}

        {/* Hard deck — single compact line */}
        <p className="text-[10px] text-[var(--color-text-secondary)]/50">
          Hard deck: {normTenure} · {propType}{subType ? ` (${subType})` : ""}{era ? ` · ${era}` : ""}{normRooms != null ? ` · ${normRooms} hab. rooms` : ""}
          {" · "}
          {isBuilding
            ? `T1 (building, ${buildingMonths}mo) + T2 (postcode)`
            : `T3 (outward)${outwardEnabled ? " + T4 (adjacent)" : ""} — ${neighbouringMonths}mo`
          }
        </p>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl bg-[#FF3131]/10 border border-[#FF3131]/40 px-4 py-3 text-sm text-[#FF3131]">
          {error}
        </div>
      )}

      {/* ── No coverage notice ── */}
      {result && result.search_metadata.total_candidates_scanned === 0 && result.comparables.length === 0 && (
        <div className="rounded-xl border border-[var(--color-status-warning)]/40 bg-[var(--color-status-warning)]/10 px-5 py-4 text-sm">
          <div className="flex items-start gap-3">
            <span className="text-[var(--color-status-warning)] text-base leading-none mt-0.5">⚠</span>
            <div>
              <p className="font-semibold text-[var(--color-status-warning)]">No comparable data available for this area</p>
              <p className="text-[var(--color-text-secondary)] mt-1">
                This postcode is outside our current data coverage. Comparable evidence is available for London boroughs only during the pilot phase.
                You can still add comparables manually using the <strong>Additional</strong> tab.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="space-y-4">
          {/* Metadata bar */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <span>
              {activeFilterCount > 0 ? (
                <>
                  <span className="font-semibold text-[var(--color-accent-pink)]">{filteredTotal}</span>
                  <span className="text-[var(--color-text-secondary)]/70"> of </span>
                  <span className="font-semibold text-[var(--color-text-primary)]">{result.comparables.length}</span> shown
                </>
              ) : (
                <>
                  <span className="font-semibold text-[var(--color-text-primary)]">{activeCount}</span> of{" "}
                  <span className="font-semibold">{result.comparables.length}</span> comparables
                </>
              )}
              {result.search_metadata.target_met
                ? <span className="ml-1 text-[var(--color-status-success)] font-medium">(target met)</span>
                : <span className="ml-1 text-[var(--color-status-warning)] font-medium">(below target)</span>}
            </span>
            <span>·</span>
            <span>{result.search_metadata.total_candidates_scanned} candidates scanned</span>
            <span>·</span>
            <span>{result.search_metadata.search_duration_ms} ms</span>
            {result.search_metadata.spec_relaxations_applied.length > 0 && (
              <>
                <span>·</span>
                <span className="text-[var(--color-status-warning)] font-medium">
                  Relaxed: {result.search_metadata.spec_relaxations_applied.join(", ")}
                </span>
              </>
            )}
          </div>

          {/* ── Integrated Sort & Filter toolbar ── */}
          {result.comparables.length > 0 && (
            <div className="space-y-0">
              {/* Toolbar row */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">

                  {/* Filter toggle */}
                  <button
                    onClick={() => setFiltersOpen(v => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md border transition-colors ${
                      filtersOpen || activeFilterCount > 0
                        ? "bg-[#FF2D78]/15 text-[var(--color-accent-pink)] border-[#FF2D78]/30"
                        : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)]"
                    }`}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                    Filter
                    {activeFilterCount > 0 && (
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold bg-[#FF2D78] text-white">
                        {activeFilterCount}
                      </span>
                    )}
                    <svg className={`w-3 h-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>

                {/* Adopt All / Unadopt All — applies to filtered results */}
                {onAdoptAll && (() => {
                  const filtered = filterComps(result.comparables).filter(c => !rejected.has(c.transaction_id ?? c.address));
                  const unadopted = filtered.filter(c => !adoptedIds.has(c.transaction_id ?? c.address));
                  const adopted = filtered.filter(c => adoptedIds.has(c.transaction_id ?? c.address));
                  const allAdopted = unadopted.length === 0 && adopted.length > 0;
                  const hasFilters = activeFilterCount > 0;
                  const label = hasFilters ? "Adopt Filtered" : "Adopt All";
                  const unadoptLabel = hasFilters ? "Unadopt Filtered" : "Unadopt All";
                  return allAdopted ? (
                    <button
                      onClick={() => onUnadoptAll?.(adopted)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors bg-[#FF3131]/15 text-[#FF3131] border border-[#FF3131]/30 hover:bg-[#FF3131]/25"
                    >
                      {unadoptLabel} ({adopted.length})
                    </button>
                  ) : (
                    <button
                      onClick={() => onAdoptAll(unadopted)}
                      disabled={filtered.length === 0}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                        filtered.length === 0
                          ? "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]/50 cursor-not-allowed border border-[var(--color-border)]/50"
                          : "bg-[#39FF14]/15 text-[var(--color-status-success)] border border-[#39FF14]/30 hover:bg-[#39FF14]/25"
                      }`}
                    >
                      {label} ({unadopted.length})
                    </button>
                  );
                })()}
              </div>

              {/* ── Filter panel (collapsible) ── */}
              {filtersOpen && (() => {
                const comps = result ? result.comparables : [];
                const uniq = (vals: (number | null | undefined)[]) => [...new Set(vals.filter((v): v is number => v != null))].sort((a, b) => a - b);
                const prices = uniq(comps.map(c => c.price));
                const areas = uniq(comps.map(c => c.floor_area_sqm));
                const rooms = uniq(comps.map(c => c.bedrooms));
                const years = uniq(comps.map(c => c.construction_age_best));
                const postcodes = [...new Set(comps.map(c => c.postcode).filter(Boolean))].sort();
                const psfs = comps.filter(c => c.floor_area_sqm && c.floor_area_sqm > 0).map(c => Math.round(c.price / (c.floor_area_sqm! * 10.7639)));
                const psfValues = [...new Set(psfs)].sort((a, b) => a - b);
                const fmtP = (v: number) => v >= 1_000_000 ? `£${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 2)}m` : `£${(v / 1_000).toFixed(0)}k`;
                const lbl = "block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]/70 mb-1.5";
                const sel = "w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] cursor-pointer";
                const inp = "w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]";
                const tog = (active: boolean) => `px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors capitalize ${active ? "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30" : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"}`;
                const ratingColor: Record<string, string> = { A: "#39FF14", B: "#4ADE80", C: "#FBBF24", D: "#F97316", E: "#EA580C", F: "#FF3131", G: "#FF3131" };

                return (
                <div className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] p-4 space-y-3">

                  {/* Section 1: Property characteristics */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className={lbl}>Type</label>
                      <div className="flex gap-1">
                        {(["all", "flat", "house"] as const).map(v => (
                          <button key={v} onClick={() => setFilterType(v)} className={tog(filterType === v)}>{v}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Tenure</label>
                      <div className="flex gap-1">
                        {(["all", "freehold", "leasehold"] as const).map(v => (
                          <button key={v} onClick={() => setFilterTenure(v)} className={tog(filterTenure === v)}>{v}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>New Build</label>
                      <div className="flex gap-1">
                        {(["all", "yes", "no"] as const).map(v => (
                          <button key={v} onClick={() => setFilterNewBuild(v)} className={tog(filterNewBuild === v)}>{v}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>EPC Verified</label>
                      <div className="flex gap-1">
                        {(["all", "yes", "no"] as const).map(v => (
                          <button key={v} onClick={() => setFilterEpcVerified(v)} className={tog(filterEpcVerified === v)}>{v}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>EPC Rating</label>
                      <div className="flex gap-0.5">
                        {["A", "B", "C", "D", "E", "F", "G"].map(r => {
                          const on = filterEpcRating.has(r);
                          return (
                            <button key={r} onClick={() => setFilterEpcRating(prev => { const n = new Set(prev); if (n.has(r)) n.delete(r); else n.add(r); return n; })}
                              className={`w-7 h-7 text-[10px] font-bold rounded-md border transition-colors ${on ? "" : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"}`}
                              style={on ? { backgroundColor: `${ratingColor[r]}20`, color: ratingColor[r], borderColor: `${ratingColor[r]}80` } : undefined}
                            >{r}</button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[var(--color-border)]/40" />

                  {/* Section 2: Price & size ranges */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className={lbl}>Sold Price</label>
                      <div className="flex items-center gap-1">
                        <select value={filterMinPrice} onChange={e => setFilterMinPrice(e.target.value)} className={sel}>
                          <option value="">Min</option>
                          {prices.map(p => <option key={p} value={String(p)}>{fmtP(p)}</option>)}
                        </select>
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <select value={filterMaxPrice} onChange={e => setFilterMaxPrice(e.target.value)} className={sel}>
                          <option value="">Max</option>
                          {prices.map(p => <option key={p} value={String(p)}>{fmtP(p)}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>£/sqft</label>
                      <div className="flex items-center gap-1">
                        <select value={filterMinPsf} onChange={e => setFilterMinPsf(e.target.value)} className={sel}>
                          <option value="">Min</option>
                          {psfValues.map(v => <option key={v} value={String(v)}>£{v.toLocaleString("en-GB")}</option>)}
                        </select>
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <select value={filterMaxPsf} onChange={e => setFilterMaxPsf(e.target.value)} className={sel}>
                          <option value="">Max</option>
                          {psfValues.map(v => <option key={v} value={String(v)}>£{v.toLocaleString("en-GB")}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Floor Area (m²)</label>
                      <div className="flex items-center gap-1">
                        <select value={filterMinArea} onChange={e => setFilterMinArea(e.target.value)} className={sel}>
                          <option value="">Min</option>
                          {areas.map(a => <option key={a} value={String(a)}>{a}</option>)}
                        </select>
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <select value={filterMaxArea} onChange={e => setFilterMaxArea(e.target.value)} className={sel}>
                          <option value="">Max</option>
                          {areas.map(a => <option key={a} value={String(a)}>{a}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Hab. Rooms</label>
                      <div className="flex items-center gap-1">
                        <select value={filterMinRooms} onChange={e => setFilterMinRooms(e.target.value)} className={sel}>
                          <option value="">Min</option>
                          {rooms.map(r => <option key={r} value={String(r)}>{r}</option>)}
                        </select>
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <select value={filterMaxRooms} onChange={e => setFilterMaxRooms(e.target.value)} className={sel}>
                          <option value="">Max</option>
                          {rooms.map(r => <option key={r} value={String(r)}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[var(--color-border)]/40" />

                  {/* Section 3: Time & location */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className={lbl}>Sale Date</label>
                      <div className="flex items-center gap-1">
                        <input type="date" value={filterMinDate} onChange={e => setFilterMinDate(e.target.value)} className={inp} />
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <input type="date" value={filterMaxDate} onChange={e => setFilterMaxDate(e.target.value)} className={inp} />
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Build Year</label>
                      <div className="flex items-center gap-1">
                        <select value={filterMinAge} onChange={e => setFilterMinAge(e.target.value)} className={sel}>
                          <option value="">Min</option>
                          {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                        </select>
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <select value={filterMaxAge} onChange={e => setFilterMaxAge(e.target.value)} className={sel}>
                          <option value="">Max</option>
                          {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>IMD Decile</label>
                      <div className="flex items-center gap-1">
                        <select value={filterMinImd} onChange={e => setFilterMinImd(e.target.value)} className={sel}>
                          <option value="">Min</option>
                          {[1,2,3,4,5,6,7,8,9,10].map(d => <option key={d} value={String(d)}>{d}</option>)}
                        </select>
                        <span className="text-[var(--color-text-muted)] text-[10px]">–</span>
                        <select value={filterMaxImd} onChange={e => setFilterMaxImd(e.target.value)} className={sel}>
                          <option value="">Max</option>
                          {[1,2,3,4,5,6,7,8,9,10].map(d => <option key={d} value={String(d)}>{d}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Postcode</label>
                      <div className="flex flex-wrap gap-1">
                        {postcodes.map(pc => {
                          const on = filterPostcode.has(pc);
                          return (
                            <button key={pc} onClick={() => setFilterPostcode(prev => { const n = new Set(prev); if (n.has(pc)) n.delete(pc); else n.add(pc); return n; })}
                              className={tog(on)}
                            >{pc}</button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>Address</label>
                      <input type="text" value={filterAddress} onChange={e => setFilterAddress(e.target.value)} placeholder="Search..." className={inp} />
                    </div>
                  </div>

                  {/* Active filters summary & clear */}
                  {activeFilterCount > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]/50">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {filterTenure !== "all" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {filterTenure}
                            <button onClick={() => setFilterTenure("all")} className="hover:text-white">×</button>
                          </span>
                        )}
                        {filterType !== "all" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {filterType}
                            <button onClick={() => setFilterType("all")} className="hover:text-white">×</button>
                          </span>
                        )}
                        {filterEpcVerified !== "all" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            EPC {filterEpcVerified === "yes" ? "verified" : "unverified"}
                            <button onClick={() => setFilterEpcVerified("all")} className="hover:text-white">×</button>
                          </span>
                        )}
                        {filterNewBuild !== "all" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {filterNewBuild === "yes" ? "new build" : "not new build"}
                            <button onClick={() => setFilterNewBuild("all")} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinPrice || filterMaxPrice) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            £{filterMinPrice || "0"}–£{filterMaxPrice || "∞"}
                            <button onClick={() => { setFilterMinPrice(""); setFilterMaxPrice(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinArea || filterMaxArea) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {filterMinArea || "0"}–{filterMaxArea || "∞"} m²
                            <button onClick={() => { setFilterMinArea(""); setFilterMaxArea(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinAge || filterMaxAge) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            Built {filterMinAge || "…"}–{filterMaxAge || "…"}
                            <button onClick={() => { setFilterMinAge(""); setFilterMaxAge(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinRooms || filterMaxRooms) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {filterMinRooms || "0"}–{filterMaxRooms || "∞"} rooms
                            <button onClick={() => { setFilterMinRooms(""); setFilterMaxRooms(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                        {filterEpcRating.size > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            EPC {[...filterEpcRating].sort().join(", ")}
                            <button onClick={() => setFilterEpcRating(new Set())} className="hover:text-white">×</button>
                          </span>
                        )}
                        {filterPostcode.size > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {[...filterPostcode].join(", ")}
                            <button onClick={() => setFilterPostcode(new Set())} className="hover:text-white">×</button>
                          </span>
                        )}
                        {filterAddress && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            &quot;{filterAddress}&quot;
                            <button onClick={() => setFilterAddress("")} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinPsf || filterMaxPsf) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            £{filterMinPsf || "0"}–£{filterMaxPsf || "∞"}/sqft
                            <button onClick={() => { setFilterMinPsf(""); setFilterMaxPsf(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinDate || filterMaxDate) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            {filterMinDate || "…"} to {filterMaxDate || "…"}
                            <button onClick={() => { setFilterMinDate(""); setFilterMaxDate(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                        {(filterMinImd || filterMaxImd) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                            IMD {filterMinImd || "1"}–{filterMaxImd || "10"}
                            <button onClick={() => { setFilterMinImd(""); setFilterMaxImd(""); }} className="hover:text-white">×</button>
                          </span>
                        )}
                      </div>
                      <button onClick={clearAllFilters}
                        className="text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent-pink)] transition-colors shrink-0 ml-2"
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Active filter pills (shown when panel is collapsed) */}
              {!filtersOpen && activeFilterCount > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {filterTenure !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                      {filterTenure} <button onClick={() => setFilterTenure("all")} className="hover:text-white">×</button>
                    </span>
                  )}
                  {filterType !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                      {filterType} <button onClick={() => setFilterType("all")} className="hover:text-white">×</button>
                    </span>
                  )}
                  {filterEpcVerified !== "all" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FF2D78]/10 text-[var(--color-accent-pink)] border border-[#FF2D78]/20">
                      EPC {filterEpcVerified === "yes" ? "verified" : "unverified"} <button onClick={() => setFilterEpcVerified("all")} className="hover:text-white">×</button>
                    </span>
                  )}
                  {activeFilterCount > 3 && (
                    <span className="text-[10px] text-[var(--color-text-secondary)]">+{activeFilterCount - 3} more</span>
                  )}
                  <button onClick={clearAllFilters}
                    className="text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent-pink)] transition-colors ml-1"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Subject property row ── */}
          <div className="rounded-2xl border border-[#00E5FF]/40 overflow-hidden shadow-lg shadow-[#00E5FF]/10">
            <div className="px-4 py-2.5 border-b border-[#00E5FF]/30 bg-gradient-to-r from-[#00E5FF]/15 via-[#00E5FF]/8 to-transparent flex items-center gap-2">
              <span>🏠</span>
              <span className="font-orbitron font-bold text-xs text-[#00E5FF] tracking-wider drop-shadow-[0_0_6px_rgba(0,229,255,0.4)]">SUBJECT PROPERTY</span>
            </div>
            <div className="overflow-x-auto">
              <div className="bg-[var(--color-bg-panel)] min-w-[960px]">
                <CompTableHeader />
                <div className="grid items-center gap-x-3 px-4 py-2.5 border-t border-[var(--color-border)]/60 bg-[var(--color-btn-primary-bg)]/5"
                  style={{ gridTemplateColumns: COMP_GRID }}>
                  {/* Arrow (empty) */}
                  <span />
                  {/* Address */}
                  <span className="text-xs font-medium text-[var(--color-accent)] truncate" title={[saon, buildingName, streetName].filter(Boolean).join(", ")}>
                    {[saon, buildingName, streetName].filter(Boolean).join(", ") || "—"}
                  </span>
                  {/* Postcode */}
                  <span className="text-xs text-[var(--color-text-secondary)] text-right">{postcode}</span>
                  {/* Sold Price */}
                  <span className="text-xs font-bold text-[var(--color-accent)] text-right">
                    {lastSoldPrice != null ? fmtPrice(lastSoldPrice) : <span className="text-[var(--color-text-secondary)]/40 font-normal">—</span>}
                  </span>
                  {/* Size ft² */}
                  <span className="text-xs text-[var(--color-text-secondary)] text-right">
                    {floorArea != null ? Math.round(floorArea * 10.7639).toLocaleString("en-GB") : <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* £/sqft */}
                  <span className="text-xs text-[var(--color-text-secondary)] text-right">
                    {lastSoldPrice != null && floorArea != null ? `£${Math.round(lastSoldPrice / (floorArea * 10.7639)).toLocaleString("en-GB")}` : <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* Date */}
                  <span className="text-xs text-[var(--color-text-secondary)] text-right">
                    {lastSoldDate ? fmtDate(lastSoldDate) : <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* Type */}
                  <span className="text-xs text-[var(--color-text-secondary)] capitalize truncate text-right" title={propType && subType ? `${propType} (${subType})` : propType ?? undefined}>
                    {propType ? <>{propType}{subType ? <span className="text-[var(--color-text-secondary)]/50"> ({subType})</span> : ""}</> : <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* H. Rm */}
                  <span className="text-xs text-[var(--color-text-secondary)] text-right">{normRooms ?? <span className="text-[var(--color-text-secondary)]/40">—</span>}</span>
                  {/* EPC */}
                  <span className={`text-xs font-semibold text-right ${epcRating ? (EPC_TEXT[epcRating] ?? "text-[var(--color-text-secondary)]") : ""}`}>
                    {epcRating ?? <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* IMD */}
                  <span className="flex items-center justify-end">
                    {subjectImdDecile != null ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: IMD_COLOURS[subjectImdDecile] ?? "#94A3B8" }}
                            title={`IMD Decile ${subjectImdDecile} (1=most deprived, 10=least)`}>
                        {subjectImdDecile}
                      </span>
                    ) : <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* Era */}
                  <span className="text-xs text-cyan-400 font-medium text-right">
                    {buildYear != null ? `c.${buildYear}` : <span className="text-[var(--color-text-secondary)]/40">—</span>}
                  </span>
                  {/* Checkbox (empty) */}
                  <span />
                </div>
              </div>
            </div>
          </div>

          {/* Tier groups */}
          {Object.entries(byTier)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([tierStr, comps]) => {
              const tier = Number(tierStr);
              const isSorted = sortBy !== "default" && tier === 0;
              const style = isSorted ? TIER_STYLE[1] : (TIER_STYLE[tier] ?? TIER_STYLE[4]);
              const active  = comps.filter(c => !rejected.has(c.transaction_id ?? c.address));
              const removed = comps.filter(c =>  rejected.has(c.transaction_id ?? c.address));
              const label   = isSorted
                ? `ALL COMPARABLES — SORTED BY ${sortBy === "psf" ? "£/SQFT" : sortBy.toUpperCase()}`
                : (comps[0]?.tier_label ?? `Tier ${tier}`);

              return (
                <div key={tier} className="rounded-2xl border overflow-hidden shadow-lg shadow-black/30">
                  {/* Tier header */}
                  <div className={`px-4 py-2.5 border-b flex items-center justify-between ${style.header}`}>
                    <div className="flex items-center gap-2">
                      <span>{isSorted ? "📊" : style.icon}</span>
                      <span className="font-orbitron font-bold text-xs text-[var(--color-text-primary)] tracking-wider">{label.toUpperCase()}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.pill}`}>
                        {active.length} found
                      </span>
                    </div>
                    {!isSorted && (
                      <span className="text-xs text-[var(--color-text-secondary)]/70">
                        {comps[0]?.time_window_months} month window
                      </span>
                    )}
                  </div>

                  {/* Comparable table */}
                  <div className="overflow-x-auto">
                  <div className="divide-y divide-[var(--color-border)]/60 bg-[var(--color-bg-panel)] min-w-[960px]">
                    <CompTableHeader sortBy={sortBy} sortDir={sortDir} onSort={(key: SortKey) => {
                      if (sortBy === key && key !== "default") {
                        setSortDir(d => d === "desc" ? "asc" : "desc");
                      } else {
                        setSortBy(key);
                        setSortDir("desc");
                      }
                    }} />
                    {active.map((comp, idx) => (
                      <CompCard
                        key={comp.transaction_id ?? idx}
                        comp={comp}
                        valuationYear={valuationYear}
                        isAdopted={adoptedIds.has(comp.transaction_id ?? comp.address)}
                        onAdopt={onAdopt ? () => onAdopt(comp) : undefined}
                        onReject={() => {
                          const k = comp.transaction_id ?? comp.address;
                          setRejected(prev => new Set([...prev, k]));
                        }}
                      />
                    ))}
                    {removed.map((comp, idx) => (
                      <RemovedRow
                        key={comp.transaction_id ?? idx}
                        comp={comp}
                        onRestore={() => {
                          const k = comp.transaction_id ?? comp.address;
                          setRejected(prev => {
                            const next = new Set(prev);
                            next.delete(k);
                            return next;
                          });
                        }}
                      />
                    ))}
                  </div>
                  </div>
                </div>
              );
            })}

          {result.comparables.length === 0 && (
            <div className="text-sm text-[var(--color-text-secondary)] text-center py-8 space-y-1">
              <p>No comparable sales found.</p>
              {result.search_metadata.search_duration_ms > 22000 ? (
                <p className="text-[var(--color-status-warning)] text-xs">
                  ⚠ The Land Registry SPARQL endpoint was slow (
                  {(result.search_metadata.search_duration_ms / 1000).toFixed(0)}s) —
                  queries may have timed out. Try again or widen the time window.
                </p>
              ) : (
                <p className="text-xs">Try widening the time window or adjusting the subject property data.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Comparable card ──────────────────────────────────────────────────────────

const EPC_BADGE: Record<string, string> = {
  A: "bg-[#16A34A]/20 text-[var(--color-status-success)]",
  B: "bg-[#22C55E]/20 text-[#4ADE80]",
  C: "bg-[#FBBF24]/20 text-[#FBBF24]",
  D: "bg-[#F97316]/20 text-[#F97316]",
  E: "bg-[#EA580C]/20 text-[#EA580C]",
  F: "bg-[#DC2626]/20 text-[#FF3131]",
  G: "bg-[#DC2626]/20 text-[#FF3131]",
};

export const EPC_TEXT: Record<string, string> = {
  A: "text-[var(--color-status-success)]",
  B: "text-[#4ADE80]",
  C: "text-[#FBBF24]",
  D: "text-[#F97316]",
  E: "text-[#EA580C]",
  F: "text-[#FF3131]",
  G: "text-[#FF3131]",
};

export const IMD_COLOURS: Record<number, string> = {
  1: "#DC2626", 2: "#EA580C", 3: "#F97316", 4: "#FBBF24", 5: "#FDE047",
  6: "#BEF264", 7: "#86EFAC", 8: "#4ADE80", 9: "#22C55E", 10: "#16A34A",
};

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-bg-base)] px-4 py-2.5">
      <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]/60 mb-0.5">{label}</dt>
      <dd className="text-sm text-[var(--color-text-primary)]">{value ?? <span className="text-[var(--color-text-secondary)]/40">—</span>}</dd>
    </div>
  );
}

/* ── Grid template for comp table ──────────────────────────────────────────── */
export const COMP_GRID = "24px 1.5fr 76px 92px 64px 72px 86px 96px 48px 40px 36px 58px 32px";

type SortKey = "default" | "date" | "size" | "price" | "psf" | "postcode" | "type" | "rooms" | "epc" | "imd" | "age";

export function CompTableHeader({ sortBy, sortDir, onSort }: {
  sortBy?: SortKey;
  sortDir?: "asc" | "desc";
  onSort?: (key: SortKey) => void;
}) {
  const hdr = "text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)]/60 font-medium truncate";
  const s = "cursor-pointer hover:text-[var(--color-text-primary)] transition-colors select-none";
  const arrow = (key: string) => sortBy === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const a = (key: string) => sortBy === key ? "text-[var(--color-accent)]" : "";
  const click = (key: SortKey) => onSort ? () => onSort(key) : undefined;

  return (
    <div className="grid items-center gap-x-3 px-4 py-2.5 border-b border-[var(--color-border)]/40" style={{ gridTemplateColumns: COMP_GRID }}>
      <span />
      <span className={hdr}>Address</span>
      <span className={`${hdr} text-right ${s} ${a("postcode")}`} onClick={click("postcode")}>Postcode{arrow("postcode")}</span>
      <span className={`${hdr} text-right ${s} ${a("price")}`} onClick={click("price")}>Sold Price{arrow("price")}</span>
      <span className={`${hdr} text-right ${s} ${a("size")}`} onClick={click("size")}>Ft&sup2;{arrow("size")}</span>
      <span className={`${hdr} text-right ${s} ${a("psf")}`} onClick={click("psf")}>&pound;/sqft{arrow("psf")}</span>
      <span className={`${hdr} text-right ${s} ${a("date")}`} onClick={click("date")}>Date{arrow("date")}</span>
      <span className={`${hdr} text-right ${s} ${a("type")}`} onClick={click("type")}>Type{arrow("type")}</span>
      <span className={`${hdr} text-right ${s} ${a("rooms")}`} onClick={click("rooms")}>H. Rm{arrow("rooms")}</span>
      <span className={`${hdr} text-right ${s} ${a("epc")}`} onClick={click("epc")}>EPC{arrow("epc")}</span>
      <span className={`${hdr} text-right ${s} ${a("imd")}`} onClick={click("imd")}>IMD{arrow("imd")}</span>
      <span className={`text-[10px] tracking-wider text-[var(--color-text-secondary)]/60 font-medium truncate text-right ${s} ${a("age")}`} onClick={click("age")}><span className="lowercase">c</span><span className="uppercase">. age</span>{arrow("age")}</span>
      <span />
    </div>
  );
}

export function CompCard({ comp, valuationYear, isAdopted, onAdopt, onReject, sizeElasticity = 0, subjectSqft = null, timeAdjFactor = 1 }: {
  comp: ComparableCandidate;
  valuationYear: number;
  isAdopted: boolean;
  onAdopt?: () => void;
  onReject: () => void;
  sizeElasticity?: number;
  subjectSqft?: number | null;
  timeAdjFactor?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const relaxBadges = comp.spec_relaxations.map(r => {
    if (r === "type")     return { label: "type relaxed",     cls: "bg-[#FFB800]/10 text-[var(--color-status-warning)]" };
    if (r === "bedrooms") return { label: "rooms relaxed", cls: "bg-[#FFB800]/10 text-[var(--color-status-warning)]" };
    return { label: r, cls: "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]" };
  });

  const exactSqft = comp.floor_area_sqm != null ? comp.floor_area_sqm * 10.7639 : null;
  const pricePsf = exactSqft != null ? Math.round(comp.price / exactSqft) : null;
  const areaSqft = exactSqft != null ? Math.round(exactSqft) : null;

  // ── Size adjustment ────────────────────────────────────────────────────────
  const beta = sizeElasticity / 100;
  let sizeAdjPsf: number | null = null;
  let sizeAdjPct = 0;
  let sizeCapped = false;

  if (beta > 0 && exactSqft != null && subjectSqft != null && subjectSqft > 0) {
    const timeAdjPsf = (comp.price * timeAdjFactor) / exactSqft;
    const rawFactor = Math.pow(exactSqft / subjectSqft, beta);
    const rawAdjPsf = timeAdjPsf * rawFactor;
    const limitPsf = comp.price / subjectSqft;
    const subjectIsSmaller = subjectSqft < exactSqft;

    let finalPsf = rawAdjPsf;
    if (subjectIsSmaller && rawAdjPsf * subjectSqft >= comp.price) {
      finalPsf = limitPsf;
      sizeCapped = true;
    } else if (!subjectIsSmaller && rawAdjPsf * subjectSqft <= comp.price) {
      finalPsf = limitPsf;
      sizeCapped = true;
    }
    sizeAdjPsf = Math.round(finalPsf);
    sizeAdjPct = ((finalPsf - timeAdjPsf) / timeAdjPsf) * 100;
  }

  // ── Indicator dots for relaxations / cat B / new build ─────────────────────
  const dots: { color: string; title: string }[] = [];
  if (comp.spec_relaxations.length > 0) dots.push({ color: "bg-[#FFB800]", title: comp.spec_relaxations.map(r => r === "type" ? "type relaxed" : r === "bedrooms" ? "rooms relaxed" : r).join(", ") });
  if (comp.transaction_category === "B") dots.push({ color: "bg-[#FAFF00]", title: "Cat B (non-standard)" });
  if (comp.new_build) dots.push({ color: "bg-[#818CF8]", title: "New build" });

  const cleanAddress = comp.postcode ? comp.address.replace(new RegExp(`\\s*${comp.postcode.replace(/\s+/g, '\\s*')}\\s*`, 'i'), '').trim() : comp.address;

  const dash = <span className="text-[var(--color-text-secondary)]/40">—</span>;

  return (
    <div className={`flex flex-col transition-colors ${isAdopted ? "bg-[#39FF14]/8" : "hover:bg-[var(--color-bg-surface)]"}`}>
      {/* ── Summary grid row ─────────────────────────────────────────────── */}
      <div
        className="grid items-center gap-x-3 px-4 py-2.5 cursor-pointer"
        style={{ gridTemplateColumns: COMP_GRID }}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Expand arrow */}
        <svg className={`w-3 h-3 text-[var(--color-text-secondary)]/50 transition-transform ${expanded ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 4l8 6-8 6V4z"/></svg>

        {/* Address + dots */}
        <div className="min-w-0 flex items-center gap-1.5">
          {dots.length > 0 && (
            <span className="flex gap-0.5 shrink-0">
              {dots.map((d, i) => (
                <span key={i} className={`w-1.5 h-1.5 rounded-full ${d.color}`} title={d.title} />
              ))}
            </span>
          )}
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate" title={cleanAddress}>{cleanAddress}</span>
        </div>

        {/* Postcode */}
        <span className="text-xs text-[var(--color-text-secondary)] text-right">{comp.postcode}</span>

        {/* Price */}
        <span className="text-xs font-bold text-[var(--color-accent)] text-right">{fmtPrice(comp.price)}</span>

        {/* Size ft² */}
        <span className="text-xs text-[var(--color-text-secondary)] text-right">
          {areaSqft != null ? areaSqft.toLocaleString("en-GB") : dash}
        </span>

        {/* £/sqft */}
        <span className="text-xs text-[var(--color-text-secondary)] text-right">
          {pricePsf != null ? `£${pricePsf.toLocaleString("en-GB")}` : dash}
        </span>

        {/* Date */}
        <span className="text-xs text-[var(--color-text-secondary)] text-right">{fmtDate(comp.transaction_date)}</span>

        {/* Type */}
        <span className="text-xs text-[var(--color-text-secondary)] capitalize truncate text-right" title={comp.property_type && comp.house_sub_type ? `${comp.property_type} (${comp.house_sub_type})` : comp.property_type ?? undefined}>
          {comp.property_type ? (
            <>{comp.property_type}{comp.house_sub_type ? <span className="text-[var(--color-text-secondary)]/50"> ({comp.house_sub_type})</span> : ""}</>
          ) : dash}
        </span>

        {/* H. Rm */}
        <span className="text-xs text-[var(--color-text-secondary)] text-right">{comp.bedrooms ?? dash}</span>

        {/* EPC */}
        <span className={`text-xs font-semibold text-right ${comp.epc_rating ? (EPC_TEXT[comp.epc_rating] ?? "text-[var(--color-text-secondary)]") : ""}`}>
          {comp.epc_rating ?? dash}
        </span>

        {/* IMD */}
        <span className="flex items-center justify-end">
          {comp.imd_decile != null ? (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: IMD_COLOURS[comp.imd_decile] ?? "#94A3B8" }}
                  title={`IMD Decile ${comp.imd_decile} (1=most deprived, 10=least)`}>
              {comp.imd_decile}
            </span>
          ) : dash}
        </span>

        {/* Era */}
        <span className="text-xs text-cyan-400 font-medium text-right">
          {comp.construction_age_best != null ? `c.${comp.construction_age_best}` : dash}
        </span>

        {/* Checkbox */}
        <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
          {onAdopt && (
            <input
              type="checkbox"
              checked={isAdopted}
              onChange={() => onAdopt()}
              title={isAdopted ? "Remove from Adopted" : "Adopt"}
              className="w-3.5 h-3.5 rounded border-[var(--color-border)] accent-[#39FF14] cursor-pointer"
            />
          )}
        </div>
      </div>

      {/* ── Expanded detail panel ─────────────────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-[365ms] ease-[cubic-bezier(0.2,0.0,0.2,1)] ${expanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="ml-6 border-t border-[var(--color-border)]/60 border-l-2 border-l-[var(--color-accent)]/30 bg-[var(--color-bg-base)] cursor-pointer" onClick={() => setExpanded(false)}>
          {/* Badges row */}
          <div className="px-4 py-2 flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)]/40">
            {comp.epc_rating && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${EPC_BADGE[comp.epc_rating] ?? "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]"}`}>
                EPC {comp.epc_rating}{comp.epc_score != null ? ` (${comp.epc_score})` : ""}
              </span>
            )}
            {relaxBadges.map((b, i) => (
              <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.cls}`}>
                ⚠ {b.label}
              </span>
            ))}
            {comp.transaction_category === "B" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#FAFF00]/10 text-[#FAFF00] font-medium">
                Cat B (non-standard)
              </span>
            )}
            {comp.new_build && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#7B2FBE]/20 text-[#818CF8] font-medium">
                New build
              </span>
            )}
            {comp.tenure === "leasehold" && comp.lease_remaining && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${comp.lease_remaining === "Expired" ? "bg-[#FF3131]/10 text-[#FF3131]" : "bg-[#CBD5E1]/10 text-[#CBD5E1]"}`}>
                {comp.lease_remaining} remaining
              </span>
            )}
          </div>

          {/* Transaction details */}
          <div className="px-4 py-2 border-b border-[var(--color-border)]/40">
            <h3 className="font-orbitron text-[var(--color-accent)] text-[10px] tracking-[2px] uppercase">Transaction</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--color-border)]/40">
            <DetailField label="Price" value={fmtPrice(comp.price)} />
            <DetailField label="Date" value={fmtDate(comp.transaction_date)} />
            <DetailField label="£/sq ft" value={pricePsf != null ? `£${pricePsf.toLocaleString("en-GB")}` : null} />
            <DetailField label="Category" value={comp.transaction_category === "B" ? "B (non-standard)" : comp.transaction_category === "A" ? "A (standard)" : comp.transaction_category} />
          </div>

          {/* Property details */}
          <div className="px-4 py-2 border-b border-t border-[var(--color-border)]/40">
            <h3 className="font-orbitron text-[var(--color-accent)] text-[10px] tracking-[2px] uppercase">Property Details</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--color-border)]/40">
            <DetailField label="Property Type" value={
              comp.property_type
                ? <span className="capitalize">{comp.property_type}{comp.house_sub_type ? ` (${comp.house_sub_type})` : ""}</span>
                : null
            } />
            <DetailField label="Tenure" value={
              comp.tenure ? (
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                  comp.tenure === "freehold" ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]" : "bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]"
                }`}>
                  <span className="capitalize">{comp.tenure}</span>
                </span>
              ) : null
            } />
            <DetailField label="Hab. Rooms" value={comp.bedrooms} />
            <DetailField label="Floor Area" value={
              comp.floor_area_sqm != null
                ? <>{comp.floor_area_sqm} m² <span className="text-[var(--color-text-secondary)]/70">/ {areaSqft?.toLocaleString("en-GB")} ft²</span></>
                : null
            } />
            <DetailField label="Construction Era" value={
              comp.construction_age_band
                ? <span className="capitalize">{comp.construction_age_band}</span>
                : null
            } />
            <DetailField label="Building Age" value={
              comp.construction_age_best != null
                ? <span className="text-cyan-400 font-medium">c.{comp.construction_age_best}</span>
                : null
            } />
            <DetailField label="New Build" value={comp.new_build ? "Yes" : "No"} />
            <DetailField label="Energy Rating" value={
              comp.epc_rating
                ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${EPC_BADGE[comp.epc_rating] ?? "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]"}`}>
                    EPC {comp.epc_rating}{comp.epc_score != null ? ` (${comp.epc_score})` : ""}
                  </span>
                : null
            } />
          </div>

          {/* Lease & Location */}
          <div className="px-4 py-2 border-b border-t border-[var(--color-border)]/40">
            <h3 className="font-orbitron text-[var(--color-accent)] text-[10px] tracking-[2px] uppercase">Lease & Location</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--color-border)]/40">
            <DetailField label="Lease Remaining" value={
              comp.lease_remaining
                ? <span className={comp.lease_remaining === "Expired" ? "text-[#FF3131] font-semibold" : ""}>{comp.lease_remaining}</span>
                : comp.tenure === "freehold" ? "N/A (freehold)" : null
            } />
            <DetailField label="Distance" value={comp.distance_m != null ? `${Math.round(comp.distance_m).toLocaleString("en-GB")} m` : null} />
            <DetailField label="Time Ago" value={comp.months_ago != null ? fmtMonthsAgo(comp.months_ago) : null} />
            <DetailField label="EPC Verified" value={
              <span className={comp.epc_matched ? "text-[var(--color-status-success)]" : "text-[var(--color-text-secondary)]"}>
                {comp.epc_matched ? "Yes" : "No"}
              </span>
            } />
            <DetailField label="IMD Decile" value={
              comp.imd_decile != null ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: IMD_COLOURS[comp.imd_decile] ?? "#94A3B8" }} />
                  <span>{comp.imd_decile} / 10</span>
                  <span className="text-[var(--color-text-secondary)]/60 text-[10px]">
                    {comp.imd_decile <= 3 ? "(deprived)" : comp.imd_decile >= 8 ? "(affluent)" : ""}
                  </span>
                </span>
              ) : null
            } />
          </div>

          {/* Size adjustment (moved from summary into expanded) */}
          {sizeElasticity > 0 && (
            exactSqft != null && subjectSqft != null && subjectSqft > 0 ? (
              <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs border-t border-[var(--color-border)]/40">
                <span className="text-[var(--color-text-secondary)]">Size Adj:</span>
                <span className={`font-semibold ${sizeAdjPct >= 0 ? "text-[var(--color-status-success)]" : "text-[var(--color-accent-pink)]"}`}>
                  {sizeAdjPct >= 0 ? "+" : ""}{sizeAdjPct.toFixed(1)}%
                </span>
                <span className="text-[var(--color-text-muted)]">|</span>
                <span className="text-[var(--color-text-secondary)]">
                  Comp: {areaSqft?.toLocaleString("en-GB")} ft² → Subject: {Math.round(subjectSqft).toLocaleString("en-GB")} ft²
                </span>
                <span className="text-[var(--color-text-muted)]">|</span>
                <span className="text-[var(--color-text-secondary)]">
                  Adj PSF: <span className="font-medium text-[var(--color-text-primary)]">
                    {sizeAdjPsf != null ? `£${sizeAdjPsf.toLocaleString("en-GB")}` : "—"}
                  </span>
                </span>
                {sizeCapped && (
                  <span className="text-[#F59E0B] font-semibold">⚠ Capped</span>
                )}
              </div>
            ) : (
              <div className="px-4 py-2.5 text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border)]/40">
                Floor areas required for size adjustment
              </div>
            )
          )}

          {/* Adopt / Reject buttons at bottom of expanded panel */}
          <div className="px-4 py-3 flex items-center gap-2 border-t border-[var(--color-border)]/40 bg-[var(--color-bg-base)]">
            {onAdopt && (
              <button
                onClick={(e) => { e.stopPropagation(); onAdopt(); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isAdopted
                    ? "bg-[#39FF14]/15 text-[var(--color-status-success)] border-[#39FF14]/40 hover:bg-[#39FF14]/25"
                    : "bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[#39FF14]/60 hover:text-[var(--color-status-success)]"
                }`}
              >
                {isAdopted ? "✓ Adopted" : "Adopt"}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onReject(); }}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-status-danger)]/60 hover:text-[var(--color-status-danger)] transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

function RemovedRow({ comp, onRestore }: {
  comp: ComparableCandidate;
  onRestore: () => void;
}) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between bg-[var(--color-bg-surface)]/50">
      <span className="text-xs text-[var(--color-text-secondary)] truncate">{comp.address} — removed</span>
      <button
        onClick={onRestore}
        className="text-xs text-[var(--color-accent)] hover:text-[#67E8F9] font-medium ml-3 shrink-0"
      >
        Restore
      </button>
    </div>
  );
}

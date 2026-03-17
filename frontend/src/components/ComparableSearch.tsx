"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

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

function fmtPrice(p: number): string {
  return "£" + p.toLocaleString("en-GB");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
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
}: Props) {
  const { session } = useAuth();
  const isBuilding = mode === "building";
  const [targetCount,    setTargetCount]    = useState(10);
  const [loading,             setLoading]             = useState(false);
  const [error,               setError]               = useState<string | null>(null);
  const [result,              setResult]              = useState<SearchResponse | null>(initialResult);
  const [rejected,            setRejected]            = useState<Set<string>>(new Set());
  const [sortBy,              setSortBy]              = useState<"default" | "date" | "size" | "price" | "psf">("default");
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
  const [filterEpcRating,     setFilterEpcRating]     = useState<Set<string>>(new Set());
  const [outwardEnabled,      setOutwardEnabled]      = useState(false); // outward mode only
  const [buildingMonths,      setBuildingMonths]      = useState(36);    // Tier 1 time window (same building / same street)
  const [neighbouringMonths,  setNeighbouringMonths]  = useState(12);    // outward mode only

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
      exclude_transaction_ids: isBuilding ? [] : excludeIds,
      exclude_address_keys:    isBuilding ? [] : excludeAddressKeys,
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
    filterEpcRating.size > 0,
  ].filter(Boolean).length;

  function clearAllFilters() {
    setFilterTenure("all"); setFilterType("all"); setFilterEpcVerified("all");
    setFilterNewBuild("all"); setFilterMinPrice(""); setFilterMaxPrice("");
    setFilterMinArea(""); setFilterMaxArea(""); setFilterMinRooms(""); setFilterMaxRooms("");
    setFilterEpcRating(new Set());
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
      <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5 shadow-lg shadow-black/30 space-y-4 ${locked ? "opacity-50 pointer-events-none select-none" : ""}`}>
        <h3 className="font-semibold text-[var(--color-text-primary)] text-sm">
          {isBuilding ? "Same Building Sales" : "Additional Sales"}
        </h3>

        {/* Subject summary */}
        <div className="rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          <span className="font-medium text-[var(--color-text-primary)]">Subject: </span>{subjectSummary || "—"}
          {isBuilding && buildingName && (
            <span className="ml-2 text-[var(--color-text-secondary)]">· {buildingName}</span>
          )}
          {!isBuilding && streetName && (
            <span className="ml-2 text-[var(--color-text-secondary)]">· {streetName}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          {/* Target count — outward mode only */}
          {!isBuilding && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Target comparables</label>
              <div className="flex gap-1">
                {[5, 8, 10, 15, 20].map(n => (
                  <button
                    key={n}
                    onClick={() => setTargetCount(n)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      targetCount === n
                        ? "bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]"
                        : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Valuation date — compulsory, shared across both tabs */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              Valuation date <span className="text-[var(--color-accent-pink)]">*</span>
            </label>
            <input
              type="date"
              value={valuationDate}
              onChange={e => onValuationDateChange(e.target.value)}
              className={`border rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] ${
                !valuationDate ? "border-[#FF2D78]/60" : "border-[var(--color-border)]"
              }`}
            />
          </div>

          {/* Time window slider */}
          {isBuilding ? (
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Time window
                <span className="ml-1.5 font-semibold text-[var(--color-text-primary)]">{buildingMonths} months</span>
              </label>
              <input
                type="range"
                min={12} max={36} step={6}
                value={buildingMonths}
                onChange={e => setBuildingMonths(Number(e.target.value))}
                list="building-months-ticks"
                className="w-full accent-[var(--color-accent)]"
              />
              <datalist id="building-months-ticks">
                {[12, 18, 24, 30, 36].map(v => <option key={v} value={v} />)}
              </datalist>
              <div className="flex justify-between text-xs text-[var(--color-text-secondary)]/70 mt-0.5">
                {[12, 18, 24, 30, 36].map(v => <span key={v}>{v}</span>)}
              </div>
            </div>
          ) : (
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Time window
                <span className="ml-1.5 font-semibold text-[var(--color-text-primary)]">{neighbouringMonths} months</span>
              </label>
              <input
                type="range"
                min={6} max={24} step={6}
                value={neighbouringMonths}
                onChange={e => setNeighbouringMonths(Number(e.target.value))}
                list="neighbouring-months-ticks"
                className="w-full accent-[var(--color-accent)]"
              />
              <datalist id="neighbouring-months-ticks">
                {[6, 12, 18, 24].map(v => <option key={v} value={v} />)}
              </datalist>
              <div className="flex justify-between text-xs text-[var(--color-text-secondary)]/70 mt-0.5">
                {[6, 12, 18, 24].map(v => <span key={v}>{v}</span>)}
              </div>
            </div>
          )}

          {/* Search button */}
          <button
            onClick={runSearch}
            disabled={loading || !postcode || !valuationDate}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-text)]
                       hover:bg-[#00D4E0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={!valuationDate ? "Set valuation date first" : undefined}
          >
            {loading ? "Searching…" : "Find comparables"}
          </button>

          {/* Outward mode only: adjacent areas toggle */}
          {!isBuilding && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOutwardEnabled(v => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
                            transition-colors duration-200 focus:outline-none
                            ${outwardEnabled ? "bg-[var(--color-btn-primary-bg)]" : "bg-[var(--color-border)]"}`}
                role="switch"
                aria-checked={outwardEnabled}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-[var(--color-text-primary)] shadow transform transition-transform duration-200
                                 ${outwardEnabled ? "translate-x-4" : "translate-x-0"}`} />
              </button>
              <div>
                <span className="text-xs text-[var(--color-text-secondary)]">Include adjacent areas</span>
                <span className="ml-1 text-xs text-[var(--color-text-secondary)]/70">(Tier 4)</span>
              </div>
            </div>
          )}
        </div>

        {/* Exclusion notice for outward mode */}
        {!isBuilding && (excludeIds.length > 0 || excludeAddressKeys.length > 0) && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-btn-primary-bg)]/10 border border-[var(--color-accent)]/30 px-3 py-2 text-xs text-[var(--color-accent)]">
            <span>ℹ</span>
            <span>
              Properties already found in Same Building Sales will be excluded
              {excludeAddressKeys.length > 0 && (
                <span> (<span className="font-semibold">{excludeAddressKeys.length} unit{excludeAddressKeys.length !== 1 ? "s" : ""}</span> by address)</span>
              )}
              {excludeIds.length > 0 && (
                <span> + <span className="font-semibold">{excludeIds.length} transaction{excludeIds.length !== 1 ? "s" : ""}</span> by ID</span>
              )}
              .
            </span>
          </div>
        )}

        {/* Hard deck info */}
        <div className="text-xs text-[var(--color-text-secondary)]/70 space-y-0.5">
          <p>
            <span className="text-[var(--color-text-secondary)]">Hard deck:</span>{" "}
            <span className="text-[var(--color-text-secondary)] font-medium">{normTenure}</span>
            {" · "}
            <span className="text-[var(--color-text-secondary)] font-medium">{propType}</span>
            {subType && <span className="text-[var(--color-text-secondary)]"> ({subType})</span>}
            {era && <span className="text-[var(--color-text-secondary)] font-medium"> · {era}</span>}
            {normRooms != null && <span className="text-[var(--color-text-secondary)] font-medium"> · {normRooms} hab. rooms</span>}
          </p>
          <p>
            {isBuilding
              ? <>Tier 1 (same building, {buildingMonths} mo) + Tier 2 (same postcode). Tenure never relaxed. Building era (flats) never relaxed.</>
              : <>Tier 3 (same outward code){outwardEnabled ? " + Tier 4 (adjacent areas)" : ""} — {neighbouringMonths} month window. Expands: type ±1 → habitable rooms ±1. Tenure never relaxed.</>
            }
          </p>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-xl bg-[#FF3131]/10 border border-[#FF3131]/40 px-4 py-3 text-sm text-[#FF3131]">
          {error}
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
                  {/* Sort buttons */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[var(--color-text-secondary)]/70 mr-1">Sort:</span>
                    {([
                      ["default", "Tier"],
                      ["date",    "Date"],
                      ["price",   "Price"],
                      ["size",    "Size"],
                      ["psf",     "£/sqft"],
                    ] as [typeof sortBy, string][]).map(([key, label]) => {
                      const active = sortBy === key;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            if (active && key !== "default") {
                              setSortDir(d => d === "desc" ? "asc" : "desc");
                            } else {
                              setSortBy(key);
                              setSortDir(key === "date" ? "desc" : key === "default" ? "desc" : "desc");
                            }
                          }}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                            active
                              ? "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                              : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)]"
                          }`}
                        >
                          {label}
                          {active && key !== "default" && (
                            <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Divider */}
                  <div className="h-5 w-px bg-[var(--color-border)]" />

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

                {/* Adopt All / Unadopt All */}
                {onAdoptAll && (() => {
                  const nonRejected = result.comparables.filter(c => !rejected.has(c.transaction_id ?? c.address));
                  const unadopted = nonRejected.filter(c => !adoptedIds.has(c.transaction_id ?? c.address));
                  const adopted = nonRejected.filter(c => adoptedIds.has(c.transaction_id ?? c.address));
                  const allAdopted = unadopted.length === 0 && adopted.length > 0;
                  return allAdopted ? (
                    <button
                      onClick={() => onUnadoptAll?.(adopted)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors bg-[#FF3131]/15 text-[#FF3131] border border-[#FF3131]/30 hover:bg-[#FF3131]/25"
                    >
                      Unadopt All ({adopted.length})
                    </button>
                  ) : (
                    <button
                      onClick={() => onAdoptAll(unadopted)}
                      disabled={nonRejected.length === 0}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                        nonRejected.length === 0
                          ? "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]/50 cursor-not-allowed border border-[var(--color-border)]/50"
                          : "bg-[#39FF14]/15 text-[var(--color-status-success)] border border-[#39FF14]/30 hover:bg-[#39FF14]/25"
                      }`}
                    >
                      Adopt All ({unadopted.length})
                    </button>
                  );
                })()}
              </div>

              {/* ── Filter panel (collapsible) ── */}
              {filtersOpen && (
                <div className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] p-4 space-y-4">
                  {/* Row 1: Toggle filters */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {/* Tenure */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Tenure</label>
                      <div className="flex gap-1">
                        {(["all", "freehold", "leasehold"] as const).map(v => (
                          <button key={v} onClick={() => setFilterTenure(v)}
                            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors capitalize ${
                              filterTenure === v
                                ? "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                                : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"
                            }`}
                          >{v}</button>
                        ))}
                      </div>
                    </div>

                    {/* Property type */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Type</label>
                      <div className="flex gap-1">
                        {(["all", "flat", "house"] as const).map(v => (
                          <button key={v} onClick={() => setFilterType(v)}
                            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors capitalize ${
                              filterType === v
                                ? "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                                : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"
                            }`}
                          >{v}</button>
                        ))}
                      </div>
                    </div>

                    {/* EPC verified */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">EPC Verified</label>
                      <div className="flex gap-1">
                        {(["all", "yes", "no"] as const).map(v => (
                          <button key={v} onClick={() => setFilterEpcVerified(v)}
                            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors capitalize ${
                              filterEpcVerified === v
                                ? "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                                : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"
                            }`}
                          >{v}</button>
                        ))}
                      </div>
                    </div>

                    {/* New build */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">New Build</label>
                      <div className="flex gap-1">
                        {(["all", "yes", "no"] as const).map(v => (
                          <button key={v} onClick={() => setFilterNewBuild(v)}
                            className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors capitalize ${
                              filterNewBuild === v
                                ? "bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                                : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"
                            }`}
                          >{v}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Range filters */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {/* Price range */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Price Range (£)</label>
                      <div className="flex items-center gap-1.5">
                        <input type="number" placeholder="Min" value={filterMinPrice} onChange={e => setFilterMinPrice(e.target.value)}
                          className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        <span className="text-[var(--color-text-muted)] text-xs">–</span>
                        <input type="number" placeholder="Max" value={filterMaxPrice} onChange={e => setFilterMaxPrice(e.target.value)}
                          className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      </div>
                    </div>

                    {/* Floor area range */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Floor Area (m²)</label>
                      <div className="flex items-center gap-1.5">
                        <input type="number" placeholder="Min" value={filterMinArea} onChange={e => setFilterMinArea(e.target.value)}
                          className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        <span className="text-[var(--color-text-muted)] text-xs">–</span>
                        <input type="number" placeholder="Max" value={filterMaxArea} onChange={e => setFilterMaxArea(e.target.value)}
                          className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      </div>
                    </div>

                    {/* Rooms range */}
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Hab. Rooms</label>
                      <div className="flex items-center gap-1.5">
                        <input type="number" placeholder="Min" value={filterMinRooms} onChange={e => setFilterMinRooms(e.target.value)} min="0" max="20"
                          className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        <span className="text-[var(--color-text-muted)] text-xs">–</span>
                        <input type="number" placeholder="Max" value={filterMaxRooms} onChange={e => setFilterMaxRooms(e.target.value)} min="0" max="20"
                          className="w-full bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: EPC rating multi-select */}
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">EPC Rating</label>
                    <div className="flex gap-1">
                      {["A", "B", "C", "D", "E", "F", "G"].map(r => {
                        const sel = filterEpcRating.has(r);
                        const ratingColor: Record<string, string> = {
                          A: "#39FF14", B: "#4ADE80", C: "#FBBF24", D: "#F97316", E: "#EA580C", F: "#FF3131", G: "#FF3131",
                        };
                        return (
                          <button key={r} onClick={() => setFilterEpcRating(prev => {
                            const next = new Set(prev);
                            if (next.has(r)) next.delete(r); else next.add(r);
                            return next;
                          })}
                            className={`w-8 h-7 text-xs font-bold rounded-md border transition-colors ${
                              sel
                                ? `border-[${ratingColor[r]}]/50 text-[${ratingColor[r]}]`
                                : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)]"
                            }`}
                            style={sel ? { backgroundColor: `${ratingColor[r]}20`, color: ratingColor[r], borderColor: `${ratingColor[r]}80` } : undefined}
                          >{r}</button>
                        );
                      })}
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
                      </div>
                      <button onClick={clearAllFilters}
                        className="text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-accent-pink)] transition-colors shrink-0 ml-2"
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              )}

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

                  {/* Comparable cards */}
                  <div className="divide-y divide-[var(--color-border)]/60 bg-[var(--color-bg-panel)]">
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

export function CompCard({ comp, valuationYear, isAdopted, onAdopt, onReject, sizeElasticity = 0, subjectSqft = null, timeAdjFactor = 1 }: {
  comp: ComparableCandidate;
  valuationYear: number;
  isAdopted: boolean;
  onAdopt?: () => void;
  onReject: () => void;
  sizeElasticity?: number;      // 0–50 (percentage); maps to β 0.00–0.50
  subjectSqft?: number | null;  // subject property floor area in sq ft
  timeAdjFactor?: number;       // HPI time-adj factor (default 1 = no adj)
}) {
  const relaxBadges = comp.spec_relaxations.map(r => {
    if (r === "type")     return { label: "type relaxed",     cls: "bg-[#FFB800]/10 text-[var(--color-status-warning)]" };
    if (r === "bedrooms") return { label: "rooms relaxed", cls: "bg-[#FFB800]/10 text-[var(--color-status-warning)]" };
    return { label: r, cls: "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]" };
  });

  // (1) Price per sq ft  (1 m² = 10.7639 ft²)
  const exactSqft = comp.floor_area_sqm != null ? comp.floor_area_sqm * 10.7639 : null;
  const pricePsf = exactSqft != null ? Math.round(comp.price / exactSqft) : null;

  // (2) Building age as at valuation date
  const buildAge = comp.build_year != null ? valuationYear - comp.build_year : null;

  // (4) Size in ft²
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

  return (
    <div className={`px-4 py-3 flex flex-col gap-1.5 transition-colors ${isAdopted ? "bg-[#39FF14]/8" : "hover:bg-[var(--color-bg-surface)]"}`}>
      {/* Row 1: address + price + adopt button */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{comp.address}</p>
          <p className="text-xs text-[var(--color-text-secondary)]/70">{comp.postcode}</p>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <div className="text-right">
            <p className="text-sm font-bold text-[var(--color-accent)]">
              {fmtPrice(comp.price)}
              {pricePsf != null && (
                <span className="ml-1.5 text-xs font-normal text-[var(--color-text-secondary)]">
                  £{pricePsf.toLocaleString("en-GB")}/sq ft
                </span>
              )}
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]/70">{fmtDate(comp.transaction_date)}</p>
          </div>
          {onAdopt && (
            <button
              onClick={onAdopt}
              title={isAdopted ? "Remove from Adopted Comparables" : "Add to Adopted Comparables"}
              className={`mt-0.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                isAdopted
                  ? "bg-[#39FF14]/15 text-[var(--color-status-success)] border-[#39FF14]/40 hover:bg-[#39FF14]/25"
                  : "bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[#39FF14]/60 hover:text-[var(--color-status-success)]"
              }`}
            >
              {isAdopted ? "✓ Adopted" : "Adopt"}
            </button>
          )}
        </div>
      </div>

      {/* Row 2: attributes */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {comp.tenure && (
          <span className="capitalize">{comp.tenure}</span>
        )}
        {/* (3) Lease remaining */}
        {comp.tenure === "leasehold" && comp.lease_remaining && (
          <span className={`font-medium ${
            comp.lease_remaining === "Expired" ? "text-[#FF3131]" : "text-[#CBD5E1]"
          }`}>
            {comp.lease_remaining} remaining
          </span>
        )}
        {comp.property_type && (
          <span className="capitalize">
            {comp.property_type}{comp.house_sub_type ? ` (${comp.house_sub_type})` : ""}
          </span>
        )}
        {comp.bedrooms != null && (
          <span>{comp.bedrooms} hab. rooms</span>
        )}
        {/* (4) Size: m² and ft² */}
        {comp.floor_area_sqm != null && (
          <span>
            {comp.floor_area_sqm} m²
            {areaSqft != null && (
              <span className="text-[var(--color-text-secondary)]/70"> / {areaSqft.toLocaleString("en-GB")} ft²</span>
            )}
          </span>
        )}
        {/* (2) Build year, era, and age */}
        {comp.build_year != null && (
          <span>
            Built {comp.build_year}
            {comp.build_year_estimated && (
              <span className="text-[var(--color-text-secondary)]/70 italic"> est.</span>
            )}
            {buildAge != null && (
              <span className="text-[var(--color-text-secondary)]/70"> ({buildAge} yrs)</span>
            )}
          </span>
        )}
        {comp.building_era && (
          <span className="capitalize">{comp.building_era}</span>
        )}
        {comp.new_build && (
          <span className="bg-[#7B2FBE]/20 text-[#818CF8] px-1.5 py-0.5 rounded-full font-medium">
            New build
          </span>
        )}
        {comp.months_ago != null && (
          <span className="text-[var(--color-text-secondary)]/70">{fmtMonthsAgo(comp.months_ago)}</span>
        )}
        {comp.epc_rating && (
          <span className={`px-1.5 py-0.5 rounded font-semibold ${
            ({ A: "bg-[#16A34A]/20 text-[var(--color-status-success)]",
               B: "bg-[#22C55E]/20 text-[#4ADE80]",
               C: "bg-[#FBBF24]/20 text-[#FBBF24]",
               D: "bg-[#F97316]/20 text-[#F97316]",
               E: "bg-[#EA580C]/20 text-[#EA580C]",
               F: "bg-[#DC2626]/20 text-[#FF3131]",
               G: "bg-[#DC2626]/20 text-[#FF3131]",
            } as Record<string, string>)[comp.epc_rating] || "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]"
          }`}>
            EPC {comp.epc_rating}{comp.epc_score != null ? ` (${comp.epc_score})` : ""}
          </span>
        )}
      </div>

      {/* Row 3: badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          comp.epc_matched ? "bg-[#39FF14]/10 text-[var(--color-status-success)]" : "bg-[var(--color-border)]/50 text-[var(--color-text-secondary)]"
        }`}>
          {comp.epc_matched ? "EPC verified" : "Unverified spec"}
        </span>
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
      </div>

      {/* Row 4: size adjustment (only when β > 0) */}
      {sizeElasticity > 0 && (
        exactSqft != null && subjectSqft != null && subjectSqft > 0 ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs pt-1 border-t border-[var(--color-border)]/40">
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
          <div className="text-xs text-[var(--color-text-muted)] pt-1 border-t border-[var(--color-border)]/40">
            Floor areas required for size adjustment
          </div>
        )
      )}

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

"use client";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  mode:                  "building" | "outward";
  locked?:               boolean;           // outward mode: block search until building search is done
  onSearchComplete?:     (ids: string[], addressKeys: string[]) => void;  // building mode: notify parent
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
}

interface SearchMetadata {
  tiers_searched:           number;
  spec_relaxations_applied: string[];
  total_candidates_scanned: number;
  search_duration_ms:       number;
  target_met:               boolean;
}

interface SearchResponse {
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
  1: { pill: "bg-[#39FF14]/15 text-[#39FF14]",  header: "bg-[#39FF14]/5  border-[#39FF14]/30", icon: "🏢" },
  2: { pill: "bg-[#00F0FF]/15 text-[#00F0FF]",   header: "bg-[#00F0FF]/5  border-[#00F0FF]/30",  icon: "🏘️" },
  3: { pill: "bg-[#FFB800]/15 text-[#FFB800]",  header: "bg-[#FFB800]/5  border-[#FFB800]/30", icon: "📍" },
  4: { pill: "bg-[#94A3B8]/15 text-[#94A3B8]",  header: "bg-[#94A3B8]/10 border-[#334155]",   icon: "🗺️" },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ComparableSearch({
  mode, locked = false, onSearchComplete, excludeIds = [], excludeAddressKeys = [],
  onAdopt, onAdoptAll, onUnadoptAll, adoptedIds = new Set(),
  valuationDate, onValuationDateChange,
  uprn, postcode, floorArea, rooms, ageBand, epcRating,
  propertyType, builtForm, tenure, buildingName, paonNumber, saon, streetName,
}: Props) {
  const { session } = useAuth();
  const isBuilding = mode === "building";
  const [targetCount,    setTargetCount]    = useState(10);
  const [loading,             setLoading]             = useState(false);
  const [error,               setError]               = useState<string | null>(null);
  const [result,              setResult]              = useState<SearchResponse | null>(null);
  const [rejected,            setRejected]            = useState<Set<string>>(new Set());
  const [sortBy,              setSortBy]              = useState<"default" | "date" | "size" | "price" | "psf">("default");
  const [sortDir,             setSortDir]             = useState<"asc" | "desc">("desc");
  const [outwardEnabled,      setOutwardEnabled]      = useState(false); // outward mode only
  const [buildingMonths,      setBuildingMonths]      = useState(30);    // building mode only
  const [neighbouringMonths,  setNeighbouringMonths]  = useState(12);    // outward mode only

  const buildYear  = deriveBuildYear(ageBand);
  const era        = deriveEraFromAgeBand(ageBand) ?? deriveBuildingEra(buildYear);
  const propType   = derivePropertyType(propertyType);
  const subType    = propType === "house" ? deriveHouseSubType(builtForm) : null;
  const normTenure = tenure?.toLowerCase() === "freehold" ? "freehold" : "leasehold";
  // Normalise rooms: EPC may return "" when the field is absent
  const normRooms: number | null = (rooms !== null && rooms !== undefined && String(rooms) !== "" && !isNaN(Number(rooms)))
    ? Number(rooms) : null;

  async function runSearch() {
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

  const byTier: Record<number, ComparableCandidate[]> = {};
  if (result) {
    if (sortBy === "default") {
      for (const c of result.comparables) {
        if (!byTier[c.geographic_tier]) byTier[c.geographic_tier] = [];
        byTier[c.geographic_tier].push(c);
      }
    } else {
      // When sorted, show all in a single flat list (tier grouping would break sort order)
      byTier[0] = sortComps(result.comparables);
    }
  }

  const activeCount = result
    ? result.comparables.filter(c => !rejected.has(c.transaction_id ?? c.address)).length
    : 0;

  return (
    <div className="space-y-5">

      {/* ── Locked notice (outward mode, building search not yet done) ── */}
      {locked && (
        <div className="rounded-2xl border border-[#FFB800]/40 bg-[#FFB800]/10 px-5 py-4 text-sm text-[#FFB800] flex items-start gap-3">
          <span className="text-lg leading-none">🔒</span>
          <div>
            <p className="font-semibold">Run Same Building Sales first</p>
            <p className="text-xs mt-0.5 text-[#FFB800]">
              Complete the Same Building Sales search before searching neighbouring properties.
              This ensures same-building results are excluded from this search.
            </p>
          </div>
        </div>
      )}

      {/* ── Controls ── */}
      <div className={`rounded-2xl border border-[#334155] bg-[#111827] p-5 shadow-lg shadow-black/30 space-y-4 ${locked ? "opacity-50 pointer-events-none select-none" : ""}`}>
        <h3 className="font-semibold text-[#E2E8F0] text-sm">
          {isBuilding ? "Same Building Sales" : "Additional Sales"}
        </h3>

        {/* Subject summary */}
        <div className="rounded-lg bg-[#1E293B] border border-[#334155] px-4 py-3 text-xs text-[#94A3B8]">
          <span className="font-medium text-[#E2E8F0]">Subject: </span>{subjectSummary || "—"}
          {isBuilding && buildingName && (
            <span className="ml-2 text-[#94A3B8]">· {buildingName}</span>
          )}
          {!isBuilding && streetName && (
            <span className="ml-2 text-[#94A3B8]">· {streetName}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-4 items-end">
          {/* Target count — outward mode only */}
          {!isBuilding && (
            <div>
              <label className="block text-xs font-medium text-[#94A3B8] mb-1">Target comparables</label>
              <div className="flex gap-1">
                {[5, 8, 10, 15, 20].map(n => (
                  <button
                    key={n}
                    onClick={() => setTargetCount(n)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      targetCount === n
                        ? "bg-[#00F0FF] text-[#0A0E1A]"
                        : "bg-[#1E293B] text-[#94A3B8] hover:bg-[#334155]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Valuation date — building mode only; outward tab inherits this value */}
          {isBuilding && (
            <div>
              <label className="block text-xs font-medium text-[#94A3B8] mb-1">
                Valuation date <span className="font-normal text-[#94A3B8]/70">(optional)</span>
              </label>
              <input
                type="date"
                value={valuationDate}
                onChange={e => onValuationDateChange(e.target.value)}
                className="border border-[#334155] rounded-lg px-3 py-1.5 text-xs text-[#E2E8F0] bg-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#00F0FF]"
              />
            </div>
          )}

          {/* Time window slider */}
          {isBuilding ? (
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-[#94A3B8] mb-1">
                Time window
                <span className="ml-1.5 font-semibold text-[#E2E8F0]">{buildingMonths} months</span>
              </label>
              <input
                type="range"
                min={12} max={36} step={6}
                value={buildingMonths}
                onChange={e => setBuildingMonths(Number(e.target.value))}
                list="building-months-ticks"
                className="w-full accent-[#00F0FF]"
              />
              <datalist id="building-months-ticks">
                {[12, 18, 24, 30, 36].map(v => <option key={v} value={v} />)}
              </datalist>
              <div className="flex justify-between text-xs text-[#94A3B8]/70 mt-0.5">
                {[12, 18, 24, 30, 36].map(v => <span key={v}>{v}</span>)}
              </div>
            </div>
          ) : (
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-[#94A3B8] mb-1">
                Time window
                <span className="ml-1.5 font-semibold text-[#E2E8F0]">{neighbouringMonths} months</span>
              </label>
              <input
                type="range"
                min={6} max={24} step={6}
                value={neighbouringMonths}
                onChange={e => setNeighbouringMonths(Number(e.target.value))}
                list="neighbouring-months-ticks"
                className="w-full accent-[#00F0FF]"
              />
              <datalist id="neighbouring-months-ticks">
                {[6, 12, 18, 24].map(v => <option key={v} value={v} />)}
              </datalist>
              <div className="flex justify-between text-xs text-[#94A3B8]/70 mt-0.5">
                {[6, 12, 18, 24].map(v => <span key={v}>{v}</span>)}
              </div>
            </div>
          )}

          {/* Search button */}
          <button
            onClick={runSearch}
            disabled={loading || !postcode}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-[#00F0FF] text-[#0A0E1A]
                       hover:bg-[#00D4E0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                            ${outwardEnabled ? "bg-[#00F0FF]" : "bg-[#334155]"}`}
                role="switch"
                aria-checked={outwardEnabled}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-[#E2E8F0] shadow transform transition-transform duration-200
                                 ${outwardEnabled ? "translate-x-4" : "translate-x-0"}`} />
              </button>
              <div>
                <span className="text-xs text-[#94A3B8]">Include adjacent areas</span>
                <span className="ml-1 text-xs text-[#94A3B8]/70">(Tier 4)</span>
              </div>
            </div>
          )}
        </div>

        {/* Exclusion notice for outward mode */}
        {!isBuilding && (excludeIds.length > 0 || excludeAddressKeys.length > 0) && (
          <div className="flex items-center gap-2 rounded-lg bg-[#00F0FF]/10 border border-[#00F0FF]/30 px-3 py-2 text-xs text-[#00F0FF]">
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
        <div className="text-xs text-[#94A3B8]/70 space-y-0.5">
          <p>
            <span className="text-[#94A3B8]">Hard deck:</span>{" "}
            <span className="text-[#94A3B8] font-medium">{normTenure}</span>
            {" · "}
            <span className="text-[#94A3B8] font-medium">{propType}</span>
            {subType && <span className="text-[#94A3B8]"> ({subType})</span>}
            {era && <span className="text-[#94A3B8] font-medium"> · {era}</span>}
            {normRooms != null && <span className="text-[#94A3B8] font-medium"> · {normRooms} hab. rooms</span>}
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
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
            <span>
              <span className="font-semibold text-[#E2E8F0]">{activeCount}</span> of{" "}
              <span className="font-semibold">{result.comparables.length}</span> comparables
              {result.search_metadata.target_met
                ? <span className="ml-1 text-[#39FF14] font-medium">(target met)</span>
                : <span className="ml-1 text-[#FFB800] font-medium">(below target)</span>}
            </span>
            <span>·</span>
            <span>{result.search_metadata.total_candidates_scanned} candidates scanned</span>
            <span>·</span>
            <span>{result.search_metadata.search_duration_ms} ms</span>
            {result.search_metadata.spec_relaxations_applied.length > 0 && (
              <>
                <span>·</span>
                <span className="text-[#FFB800] font-medium">
                  Relaxed: {result.search_metadata.spec_relaxations_applied.join(", ")}
                </span>
              </>
            )}
          </div>

          {/* Sort buttons + Adopt All */}
          {result.comparables.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              {/* Sort buttons */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#94A3B8]/70 mr-1">Sort:</span>
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
                          ? "bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/30"
                          : "bg-[#1E293B] text-[#94A3B8] border-[#334155] hover:text-[#E2E8F0] hover:border-[#475569]"
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
                        ? "bg-[#1E293B] text-[#94A3B8]/50 cursor-not-allowed border border-[#334155]/50"
                        : "bg-[#39FF14]/15 text-[#39FF14] border border-[#39FF14]/30 hover:bg-[#39FF14]/25"
                    }`}
                  >
                    Adopt All ({unadopted.length})
                  </button>
                );
              })()}
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
                      <span className="font-orbitron font-bold text-xs text-[#E2E8F0] tracking-wider">{label.toUpperCase()}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.pill}`}>
                        {active.length} found
                      </span>
                    </div>
                    {!isSorted && (
                      <span className="text-xs text-[#94A3B8]/70">
                        {comps[0]?.time_window_months} month window
                      </span>
                    )}
                  </div>

                  {/* Comparable cards */}
                  <div className="divide-y divide-[#334155]/60 bg-[#111827]">
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
            <div className="text-sm text-[#94A3B8] text-center py-8 space-y-1">
              <p>No comparable sales found.</p>
              {result.search_metadata.search_duration_ms > 22000 ? (
                <p className="text-[#FFB800] text-xs">
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
    if (r === "type")     return { label: "type relaxed",     cls: "bg-[#FFB800]/10 text-[#FFB800]" };
    if (r === "bedrooms") return { label: "rooms relaxed", cls: "bg-[#FFB800]/10 text-[#FFB800]" };
    return { label: r, cls: "bg-[#334155]/50 text-[#94A3B8]" };
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
    <div className={`px-4 py-3 flex flex-col gap-1.5 transition-colors ${isAdopted ? "bg-[#39FF14]/8" : "hover:bg-[#1E293B]"}`}>
      {/* Row 1: address + price + adopt button */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#E2E8F0] truncate">{comp.address}</p>
          <p className="text-xs text-[#94A3B8]/70">{comp.postcode}</p>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <div className="text-right">
            <p className="text-sm font-bold text-[#00F0FF]">
              {fmtPrice(comp.price)}
              {pricePsf != null && (
                <span className="ml-1.5 text-xs font-normal text-[#94A3B8]">
                  £{pricePsf.toLocaleString("en-GB")}/sq ft
                </span>
              )}
            </p>
            <p className="text-xs text-[#94A3B8]/70">{fmtDate(comp.transaction_date)}</p>
          </div>
          {onAdopt && (
            <button
              onClick={onAdopt}
              title={isAdopted ? "Remove from Adopted Comparables" : "Add to Adopted Comparables"}
              className={`mt-0.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                isAdopted
                  ? "bg-[#39FF14]/15 text-[#39FF14] border-[#39FF14]/40 hover:bg-[#39FF14]/25"
                  : "bg-transparent text-[#94A3B8] border-[#334155] hover:border-[#39FF14]/60 hover:text-[#39FF14]"
              }`}
            >
              {isAdopted ? "✓ Adopted" : "Adopt"}
            </button>
          )}
        </div>
      </div>

      {/* Row 2: attributes */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#94A3B8]">
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
              <span className="text-[#94A3B8]/70"> / {areaSqft.toLocaleString("en-GB")} ft²</span>
            )}
          </span>
        )}
        {/* (2) Build year and age */}
        {comp.build_year != null && (
          <span>
            Built {comp.build_year}
            {comp.build_year_estimated && (
              <span className="text-[#94A3B8]/70 italic"> est.</span>
            )}
            {buildAge != null && (
              <span className="text-[#94A3B8]/70"> ({buildAge} yrs)</span>
            )}
          </span>
        )}
        {comp.new_build && (
          <span className="bg-[#7B2FBE]/20 text-[#818CF8] px-1.5 py-0.5 rounded-full font-medium">
            New build
          </span>
        )}
        {comp.months_ago != null && (
          <span className="text-[#94A3B8]/70">{fmtMonthsAgo(comp.months_ago)}</span>
        )}
        {comp.epc_rating && (
          <span className={`px-1.5 py-0.5 rounded font-semibold ${
            ({ A: "bg-[#16A34A]/20 text-[#39FF14]",
               B: "bg-[#22C55E]/20 text-[#4ADE80]",
               C: "bg-[#FBBF24]/20 text-[#FBBF24]",
               D: "bg-[#F97316]/20 text-[#F97316]",
               E: "bg-[#EA580C]/20 text-[#EA580C]",
               F: "bg-[#DC2626]/20 text-[#FF3131]",
               G: "bg-[#DC2626]/20 text-[#FF3131]",
            } as Record<string, string>)[comp.epc_rating] || "bg-[#334155]/50 text-[#94A3B8]"
          }`}>
            EPC {comp.epc_rating}{comp.epc_score != null ? ` (${comp.epc_score})` : ""}
          </span>
        )}
      </div>

      {/* Row 3: badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          comp.epc_matched ? "bg-[#39FF14]/10 text-[#39FF14]" : "bg-[#334155]/50 text-[#94A3B8]"
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs pt-1 border-t border-[#334155]/40">
            <span className="text-[#94A3B8]">Size Adj:</span>
            <span className={`font-semibold ${sizeAdjPct >= 0 ? "text-[#39FF14]" : "text-[#FF2D78]"}`}>
              {sizeAdjPct >= 0 ? "+" : ""}{sizeAdjPct.toFixed(1)}%
            </span>
            <span className="text-[#475569]">|</span>
            <span className="text-[#94A3B8]">
              Comp: {areaSqft?.toLocaleString("en-GB")} ft² → Subject: {Math.round(subjectSqft).toLocaleString("en-GB")} ft²
            </span>
            <span className="text-[#475569]">|</span>
            <span className="text-[#94A3B8]">
              Adj PSF: <span className="font-medium text-[#F5E6C8]">
                {sizeAdjPsf != null ? `£${sizeAdjPsf.toLocaleString("en-GB")}` : "—"}
              </span>
            </span>
            {sizeCapped && (
              <span className="text-[#F59E0B] font-semibold">⚠ Capped</span>
            )}
          </div>
        ) : (
          <div className="text-xs text-[#475569] pt-1 border-t border-[#334155]/40">
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
    <div className="px-4 py-2.5 flex items-center justify-between bg-[#1E293B]/50">
      <span className="text-xs text-[#94A3B8] truncate">{comp.address} — removed</span>
      <button
        onClick={onRestore}
        className="text-xs text-[#00F0FF] hover:text-[#67E8F9] font-medium ml-3 shrink-0"
      >
        Restore
      </button>
    </div>
  );
}

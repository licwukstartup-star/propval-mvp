"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ComparableCandidate } from "@/components/ComparableSearch";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrowseRow {
  transaction_id: string;
  address:        string;
  postcode:       string;
  price:          number;
  date:           string;
  property_type:  string;
  tenure:         string;
  new_build:      boolean;
  category:       string;
  _type_code:     string;
  _tenure_code:   string;
  raw_saon:          string;
  _paon:          string;
  _street:        string;
  _locality:      string;
  _town:          string;
  _district:      string;
  _county:        string;
  // EPC enrichment (populated after enrich call)
  bedrooms?:       number | null;
  floor_area_sqm?: number | null;
  epc_rating?:     string | null;
  epc_score?:      number | null;
  build_year?:     number | null;
  building_era?:   string | null;
  epc_matched?:    boolean;
}

interface Props {
  outwardCode:    string;
  subjectAddress: string;
  subjectSaon:    string | null;
  subjectPaon:    string | null;
  subjectStreet:  string | null;
  subjectPostcode: string;
  subjectPropertyType: string | null;  // "Flat" / "House" etc
  subjectTenure:  string | null;       // "freehold" / "leasehold"
  subjectEpcScore:   number | null;
  subjectEpcRating:  string | null;  // letter grade A-G
  subjectFloorArea:  number | null;    // m²
  subjectRooms:      number | null;
  subjectAgeBand:    string | null;
  subjectLeaseTermYears: number | null;
  subjectLeaseExpiry:    string | null;
  onAdopt:        (comp: ComparableCandidate) => void;
  adoptedIds:     Set<string>;
}

type SortKey = "date" | "price" | "saon" | "paon" | "street" | "locality" | "town" | "district" | "county" | "postcode" | "outward" | "inward" | "property_type" | "tenure" | "bedrooms" | "floor_area_sqm" | "epc_rating";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BrowseSales({ outwardCode, subjectAddress, subjectSaon, subjectPaon, subjectStreet, subjectPostcode, subjectPropertyType, subjectTenure, subjectEpcScore, subjectEpcRating, subjectFloorArea, subjectRooms, subjectAgeBand, subjectLeaseTermYears, subjectLeaseExpiry, onAdopt, adoptedIds }: Props) {
  const { session } = useAuth();

  // Data
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichedCount, setEnrichedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [totalFromServer, setTotalFromServer] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Search scope
  const [searchPostcode, setSearchPostcode] = useState("");

  // Filters
  const [filterType, setFilterType] = useState<string>(
    subjectPropertyType?.toLowerCase().includes("flat") ? "F" :
    subjectPropertyType?.toLowerCase().includes("maisonette") ? "F" :
    subjectPropertyType ? "D,S,T" : ""
  );
  const [filterTenure, setFilterTenure] = useState<string>(
    subjectTenure === "freehold" ? "F" :
    subjectTenure === "leasehold" ? "L" :
    subjectPropertyType?.toLowerCase().includes("flat") || subjectPropertyType?.toLowerCase().includes("maisonette") ? "L" : ""
  );
  const [filterMinDate, setFilterMinDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [filterMaxDate, setFilterMaxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterMinPrice, setFilterMinPrice] = useState("");
  const [filterMaxPrice, setFilterMaxPrice] = useState("");
  const [filterNewBuild, setFilterNewBuild] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Column filters (Excel-style: column key → Set of allowed values; empty = show all)
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState("");
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setOpenFilter(null);
        setFilterSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Refs for sticky measurement
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [headerH, setHeaderH] = useState(29);

  // Column resize state
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).parentElement!;
    const startW = th.getBoundingClientRect().width;
    resizingRef.current = { col, startX: e.clientX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(30, resizingRef.current.startW + diff);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    if (!theadRef.current) return;
    const h = theadRef.current.getBoundingClientRect().height;
    if (h > 0 && h !== headerH) setHeaderH(h);
  }, [rows.length, headerH]);

  // Fetched flag
  const [fetched, setFetched] = useState(false);

  // ── Fetch browse data ──────────────────────────────────────────────────
  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!session?.access_token || !outwardCode) return;
    setLoading(true);
    setError(null);
    setEnrichedCount(0);

    try {
      const body: Record<string, unknown> = {
        outward_code: outwardCode,
      };
      if (forceRefresh) body.force_refresh = true;
      // If flat, filter server-side for F only
      if (filterType === "F") {
        body.property_type = "F";
      }
      // For houses (D,S,T), don't set server filter — we'll filter client-side
      if (filterTenure) body.estate_type = filterTenure;
      if (filterMinDate) body.min_date = filterMinDate;
      if (filterMaxDate) body.max_date = filterMaxDate;
      if (filterMinPrice) body.min_price = parseInt(filterMinPrice);
      if (filterMaxPrice) body.max_price = parseInt(filterMaxPrice);
      if (filterNewBuild) body.new_build = filterNewBuild;

      const resp = await fetch(`${API_BASE}/api/comparables/browse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      let results: BrowseRow[] = data.results || [];


      // Client-side filter for house types (D, S, T — exclude F and O)
      if (filterType === "D,S,T") {
        results = results.filter(r => ["D", "S", "T"].includes(r._type_code));
      }

      setRows(results);
      setTotalFromServer(data.total);
      setDurationMs(data.duration_ms);
      setFetched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, outwardCode, filterType, filterTenure, filterMinDate, filterMaxDate, filterMinPrice, filterMaxPrice, filterNewBuild]);

  // Auto-fetch on mount (once only — ref guards against StrictMode double-mount)
  const didFetch = useRef(false);
  useEffect(() => {
    if (!didFetch.current && !fetched) {
      didFetch.current = true;
      fetchData();
    }
  }, [fetched, fetchData]);

  // ── Sort logic ─────────────────────────────────────────────────────────
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "price" || key === "date" ? "desc" : "asc");
    }
  };

  // Column value accessor for filtering
  const colVal = useCallback((row: BrowseRow, col: string): string => {
    switch (col) {
      case "saon": return row.raw_saon || "(blank)";
      case "paon": return row._paon || "(blank)";
      case "street": return row._street || "(blank)";
      case "postcode": return row.postcode;
      case "outward": return row.postcode.split(/\s+/)[0];
      case "inward": return row.postcode.split(/\s+/)[1] ?? "";
      case "property_type": return row.property_type;
      case "tenure": return row.tenure;
      case "date": return row.date;
      case "epc_rating": return row.epc_rating || "(blank)";
      default: return "";
    }
  }, []);

  // Apply column filters then sort
  const filtered = rows.filter(row => {
    for (const [col, allowed] of Object.entries(columnFilters)) {
      if (allowed.size === 0) continue;
      if (!allowed.has(colVal(row, col))) return false;
    }
    return true;
  });

  // ── Enrich with EPC ────────────────────────────────────────────────────
  const enrichAll = useCallback(async () => {
    if (!session?.access_token || filtered.length === 0 || filtered.length > 100) return;
    setEnriching(true);

    try {
      const toEnrich = filtered.filter(r => r.epc_matched === undefined);
      if (toEnrich.length === 0) {
        setEnrichedCount(filtered.filter(r => r.epc_matched !== undefined).length);
        setEnriching(false);
        return;
      }

      const payload = toEnrich.map(r => ({
        transaction_id: r.transaction_id,
        raw_saon: r.raw_saon,
        _paon: r._paon,
        _street: r._street,
        postcode: r.postcode,
      }));

      const resp = await fetch(`${API_BASE}/api/comparables/enrich`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ transactions: payload }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const enriched: Record<string, Record<string, unknown>> = data.enriched || {};

      setRows(prev => prev.map(r => {
        const e = enriched[r.transaction_id];
        if (!e) return r;
        return {
          ...r,
          bedrooms: e.bedrooms as number | null,
          floor_area_sqm: e.floor_area_sqm as number | null,
          epc_rating: e.epc_rating as string | null,
          epc_score: e.epc_score as number | null,
          build_year: e.build_year as number | null,
          building_era: e.building_era as string | null,
          epc_matched: e.epc_matched as boolean,
        };
      }));

      const alreadyEnriched = filtered.filter(r => r.epc_matched !== undefined && !toEnrich.some(t => t.transaction_id === r.transaction_id)).length;
      setEnrichedCount(alreadyEnriched + Object.keys(enriched).length);
    } catch {
      // Silently fail enrichment — PPD data is still visible
    } finally {
      setEnriching(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, filtered]);

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "date": return dir * a.date.localeCompare(b.date);
      case "price": return dir * (a.price - b.price);
      case "saon": return dir * a.raw_saon.localeCompare(b.raw_saon);
      case "paon": return dir * a._paon.localeCompare(b._paon);
      case "street": return dir * a._street.localeCompare(b._street);
      case "locality": return dir * a._locality.localeCompare(b._locality);
      case "town": return dir * a._town.localeCompare(b._town);
      case "district": return dir * a._district.localeCompare(b._district);
      case "county": return dir * a._county.localeCompare(b._county);
      case "postcode": return dir * a.postcode.localeCompare(b.postcode);
      case "outward": return dir * a.postcode.split(/\s+/)[0].localeCompare(b.postcode.split(/\s+/)[0]);
      case "inward": return dir * (a.postcode.split(/\s+/)[1] ?? "").localeCompare(b.postcode.split(/\s+/)[1] ?? "");
      case "property_type": return dir * a.property_type.localeCompare(b.property_type);
      case "tenure": return dir * a.tenure.localeCompare(b.tenure);
      case "bedrooms": return dir * ((a.bedrooms ?? 0) - (b.bedrooms ?? 0));
      case "floor_area_sqm": return dir * ((a.floor_area_sqm ?? 0) - (b.floor_area_sqm ?? 0));
      case "epc_rating": return dir * ((a.epc_rating ?? "Z").localeCompare(b.epc_rating ?? "Z"));
      default: return 0;
    }
  });

  // Unique values for a column (from all rows, not filtered)
  const uniqueVals = useCallback((col: string): string[] => {
    const set = new Set<string>();
    rows.forEach(r => set.add(colVal(r, col)));
    return [...set].sort();
  }, [rows, colVal]);

  // Toggle a value in a column filter
  const toggleFilterValue = (col: string, val: string) => {
    setColumnFilters(prev => {
      const cur = new Set(prev[col] || []);
      if (cur.has(val)) cur.delete(val); else cur.add(val);
      const next = { ...prev };
      if (cur.size === 0) delete next[col]; else next[col] = cur;
      return next;
    });
  };

  // Select all / clear all for a column
  const selectAllFilter = (col: string) => {
    setColumnFilters(prev => { const next = { ...prev }; delete next[col]; return next; });
  };
  const clearAllFilter = (col: string) => {
    setColumnFilters(prev => ({ ...prev, [col]: new Set<string>() }));
  };

  const activeFilterCount = Object.keys(columnFilters).length;

  // ── Adopt handler ──────────────────────────────────────────────────────
  const handleAdopt = (row: BrowseRow) => {
    const comp: ComparableCandidate = {
      transaction_id: row.transaction_id,
      address: `${row.address}, ${row.postcode}`,
      postcode: row.postcode,
      outward_code: outwardCode,
      saon: row.raw_saon || null,
      tenure: row._tenure_code === "F" ? "freehold" : row._tenure_code === "L" ? "leasehold" : null,
      property_type: row._type_code === "F" ? "flat" : "house",
      house_sub_type: null,
      bedrooms: row.bedrooms ?? null,
      building_name: null,
      building_era: row.building_era ?? null,
      build_year: row.build_year ?? null,
      build_year_estimated: false,
      floor_area_sqm: row.floor_area_sqm ?? null,
      price: row.price,
      transaction_date: row.date,
      new_build: row.new_build,
      transaction_category: row.category || null,
      geographic_tier: 0,
      tier_label: "Browse",
      spec_relaxations: [],
      time_window_months: 36,
      epc_matched: row.epc_matched ?? false,
      epc_rating: row.epc_rating ?? null,
      epc_score: row.epc_score ?? null,
      months_ago: null,
      lease_remaining: null,
    };
    onAdopt(comp);
  };

  // ── Sort arrow ─────────────────────────────────────────────────────────
  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const headerClass = "px-2 py-1.5 text-left text-[10px] font-semibold cursor-pointer select-none hover:text-[#00F0FF] transition-colors whitespace-nowrap relative";

  const resizeHandle = (col: string) => (
    <span
      onMouseDown={(e) => onResizeStart(col, e)}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/30"
    />
  );

  // Filterable columns
  const filterableCols = new Set(["saon", "paon", "street", "postcode", "outward", "inward", "property_type", "tenure", "epc_rating"]);

  // Excel-style filter dropdown
  const filterDropdown = (col: string) => {
    if (!filterableCols.has(col)) return null;
    const hasFilter = col in columnFilters;
    return (
      <>
        <button
          onClick={(e) => { e.stopPropagation(); setOpenFilter(prev => prev === col ? null : col); setFilterSearch(""); }}
          className={`ml-1 inline-flex items-center text-[8px] ${hasFilter ? "text-[#00F0FF]" : "text-current opacity-50 hover:opacity-100"}`}
          title="Filter"
        >▼</button>
        {openFilter === col && (
          <div
            ref={filterDropdownRef}
            className="absolute top-full left-0 z-50 mt-0.5 bg-[#1E293B] border border-[#334155] rounded shadow-lg shadow-black/40"
            style={{ minWidth: 160, maxHeight: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search box */}
            <div className="p-1.5 border-b border-[#334155]">
              <input
                type="text"
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                placeholder="Search..."
                autoFocus
                className="w-full bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0] outline-none focus:border-[#00F0FF]"
                style={{ colorScheme: "dark" }}
              />
            </div>
            {/* Select All / Clear All */}
            <div className="flex gap-2 px-2 py-1 border-b border-[#334155] text-[9px]">
              <button onClick={() => selectAllFilter(col)} className="text-[#00F0FF] hover:underline">Select All</button>
              <button onClick={() => clearAllFilter(col)} className="text-[#FF2D78] hover:underline">Clear All</button>
            </div>
            {/* Value checkboxes */}
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              {uniqueVals(col)
                .filter(v => !filterSearch || v.toLowerCase().includes(filterSearch.toLowerCase()))
                .map(val => {
                  const checked = !columnFilters[col] || columnFilters[col].has(val);
                  return (
                    <label key={val} className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-[#E2E8F0] hover:bg-[#334155]/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (!columnFilters[col]) {
                            // First click: select only this one (deselect all others)
                            const all = new Set(uniqueVals(col));
                            all.delete(val);
                            setColumnFilters(prev => ({ ...prev, [col]: new Set([val]) }));
                          } else {
                            toggleFilterValue(col, val);
                          }
                        }}
                        className="w-3 h-3 rounded accent-[#00F0FF]"
                      />
                      <span className="truncate">{val || "(blank)"}</span>
                    </label>
                  );
                })}
            </div>
          </div>
        )}
      </>
    );
  };

  // Lease remaining years
  const leaseRemaining = (() => {
    if (subjectLeaseExpiry) {
      const exp = new Date(subjectLeaseExpiry);
      const diff = exp.getFullYear() - new Date().getFullYear();
      return diff > 0 ? `${diff} yrs remaining` : "Expired";
    }
    if (subjectLeaseTermYears) return `${subjectLeaseTermYears} yr term`;
    return null;
  })();

  return (
    <div className="space-y-4">
      {/* ── Compact toolbar ──────────────────────────────────────────── */}
      <div className="bg-[#111827] border border-[#334155] rounded-lg px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search scope */}
          <select value={searchPostcode}
            onChange={e => {
              const pc = e.target.value;
              setSearchPostcode(pc);
              if (pc) {
                setColumnFilters(prev => ({ ...prev, postcode: new Set([pc]) }));
              } else {
                setColumnFilters(prev => { const next = { ...prev }; delete next.postcode; return next; });
              }
            }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">All Postcodes</option>
            {[...new Set(rows.map(r => r.postcode))].sort().map(pc => (
              <option key={pc} value={pc}>{pc}</option>
            ))}
          </select>
          <select value={columnFilters.outward ? [...columnFilters.outward][0] ?? "" : ""}
            onChange={e => {
              const ow = e.target.value;
              if (ow) {
                setColumnFilters(prev => ({ ...prev, outward: new Set([ow]) }));
              } else {
                setColumnFilters(prev => { const next = { ...prev }; delete next.outward; return next; });
              }
            }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">All Outward</option>
            {[...new Set(rows.map(r => r.postcode.split(/\s+/)[0]))].sort().map(ow => (
              <option key={ow} value={ow}>{ow}</option>
            ))}
          </select>
          <select value={columnFilters.paon ? [...columnFilters.paon][0] ?? "" : ""}
            onChange={e => {
              const v = e.target.value;
              if (v) {
                setColumnFilters(prev => ({ ...prev, paon: new Set([v]) }));
              } else {
                setColumnFilters(prev => { const next = { ...prev }; delete next.paon; return next; });
              }
            }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">All Buildings</option>
            {[...new Set(rows.map(r => r._paon || "(blank)"))].sort().map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <select value={columnFilters.street ? [...columnFilters.street][0] ?? "" : ""}
            onChange={e => {
              const v = e.target.value;
              if (v) {
                setColumnFilters(prev => ({ ...prev, street: new Set([v]) }));
              } else {
                setColumnFilters(prev => { const next = { ...prev }; delete next.street; return next; });
              }
            }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">All Streets</option>
            {[...new Set(rows.map(r => r._street || "(blank)"))].sort().map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <span className="text-[#334155]">|</span>
          {/* Server-side filters */}
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setFetched(false); }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">All Types</option>
            <option value="F">Flats</option>
            <option value="D,S,T">Houses</option>
            <option value="D">Detached</option>
            <option value="S">Semi</option>
            <option value="T">Terraced</option>
          </select>
          <select value={filterTenure} onChange={e => { setFilterTenure(e.target.value); setFetched(false); }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">All Tenure</option>
            <option value="F">Freehold</option>
            <option value="L">Leasehold</option>
          </select>
          <input type="date" value={filterMinDate} onChange={e => { setFilterMinDate(e.target.value); setFetched(false); }}
            style={{ colorScheme: "dark" }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]" />
          <span className="text-[#94A3B8] text-[10px]">to</span>
          <input type="date" value={filterMaxDate} onChange={e => { setFilterMaxDate(e.target.value); setFetched(false); }}
            style={{ colorScheme: "dark" }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]" />
          <input type="number" value={filterMinPrice} onChange={e => { setFilterMinPrice(e.target.value); setFetched(false); }}
            placeholder="Min £" className="w-20 bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]" />
          <input type="number" value={filterMaxPrice} onChange={e => { setFilterMaxPrice(e.target.value); setFetched(false); }}
            placeholder="Max £" className="w-20 bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]" />
          <select value={filterNewBuild} onChange={e => { setFilterNewBuild(e.target.value); setFetched(false); }}
            className="bg-[#0A0E1A] border border-[#334155] rounded px-2 py-1 text-[10px] text-[#E2E8F0]">
            <option value="">New Build?</option>
            <option value="N">Existing</option>
            <option value="Y">New Build</option>
          </select>

          <button onClick={() => { setFetched(false); }}
            className="px-2.5 py-1 text-[10px] font-medium rounded bg-[#00F0FF] text-[#0A0E1A] hover:bg-[#00F0FF]/80 transition-colors">
            Apply
          </button>
          <button onClick={() => { fetchData(true); }} disabled={loading}
            className="px-2.5 py-1 text-[10px] font-medium rounded border border-[#334155] text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#94A3B8] transition-colors disabled:opacity-40"
            title="Force re-download from HMLR">
            Refresh
          </button>

          {/* Survivor count */}
          {!loading && rows.length > 0 && (
            <span className="text-[10px] tabular-nums" style={{ color: sorted.length <= 100 ? "#39FF14" : "#FFB800" }}>
              {sorted.length}{sorted.length !== rows.length ? `/${rows.length}` : ""} result{sorted.length !== 1 ? "s" : ""}
            </span>
          )}

          {/* Clear column filters */}
          {activeFilterCount > 0 && (
            <button onClick={() => setColumnFilters({})}
              className="px-2 py-0.5 text-[9px] rounded border border-[#FF2D78]/40 text-[#FF2D78] hover:bg-[#FF2D78]/10 transition-colors">
              Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
            </button>
          )}

          {/* EPC enrich — survivors only, max 100 */}
          {sorted.length > 0 && sorted.length <= 100 ? (
            <button onClick={enrichAll} disabled={enriching}
              className="px-2.5 py-1 text-[10px] font-medium rounded border border-[#7B2FBE]/40 text-[#c084fc] hover:bg-[#7B2FBE]/10 transition-colors disabled:opacity-40">
              {enriching ? `Enriching... (${enrichedCount}/${filtered.filter(r => r.epc_matched === undefined).length})` :
               enrichedCount > 0 ? `EPC Enriched (${enrichedCount}/${sorted.length})` :
               `Enrich EPC (${sorted.length})`}
            </button>
          ) : sorted.length > 100 ? (
            <span className="text-[9px] text-[#FFB800]/80">{"\u2264"}100 survivors to enrich</span>
          ) : null}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-[#FF3131]/10 border border-[#FF3131]/30 rounded-lg p-3 text-xs text-[#FF3131]">{error}</div>
      )}

      {/* ── Loading ───────────────────────────────────────────────── */}
      {loading && (
        <div className="text-center py-8 text-[#94A3B8] text-sm">Loading transactions...</div>
      )}

      {/* ── Table ─────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="border border-[#334155] rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full min-w-max text-xs table-fixed">
              <thead className="sticky top-0 z-10" ref={theadRef}>
                <tr className="bg-gradient-to-r from-[#00F0FF] to-[#FF2D78] text-[#0A0E1A]">
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold" style={{ width: 32 }}></th>
                  <th className={headerClass} style={colWidths.saon ? { width: colWidths.saon } : {}} onClick={() => toggleSort("saon")}>Flat/Apt{sortArrow("saon")}{filterDropdown("saon")}{resizeHandle("saon")}</th>
                  <th className={headerClass} style={colWidths.paon ? { width: colWidths.paon } : {}} onClick={() => toggleSort("paon")}>Building{sortArrow("paon")}{filterDropdown("paon")}{resizeHandle("paon")}</th>
                  <th className={headerClass} style={colWidths.street ? { width: colWidths.street } : {}} onClick={() => toggleSort("street")}>Street{sortArrow("street")}{filterDropdown("street")}{resizeHandle("street")}</th>
                  {/* Hidden: Locality, Town, District, County — data kept, columns hidden */}
                  <th className={headerClass} style={colWidths.postcode ? { width: colWidths.postcode } : {}} onClick={() => toggleSort("postcode")}>Postcode{sortArrow("postcode")}{filterDropdown("postcode")}{resizeHandle("postcode")}</th>
                  <th className={headerClass} style={colWidths.outward ? { width: colWidths.outward } : {}} onClick={() => toggleSort("outward")}>Outward{sortArrow("outward")}{filterDropdown("outward")}{resizeHandle("outward")}</th>
                  <th className={headerClass} style={colWidths.inward ? { width: colWidths.inward } : {}} onClick={() => toggleSort("inward")}>Inward{sortArrow("inward")}{filterDropdown("inward")}{resizeHandle("inward")}</th>
                  <th className={headerClass} style={colWidths.price ? { width: colWidths.price } : {}} onClick={() => toggleSort("price")}>Price{sortArrow("price")}{resizeHandle("price")}</th>
                  <th className={headerClass} style={colWidths.date ? { width: colWidths.date } : {}} onClick={() => toggleSort("date")}>Date{sortArrow("date")}{resizeHandle("date")}</th>
                  <th className={headerClass} style={colWidths.type ? { width: colWidths.type } : {}} onClick={() => toggleSort("property_type")}>Type{sortArrow("property_type")}{filterDropdown("property_type")}{resizeHandle("type")}</th>
                  <th className={headerClass} style={colWidths.tenure ? { width: colWidths.tenure } : {}} onClick={() => toggleSort("tenure")}>Tenure{sortArrow("tenure")}{filterDropdown("tenure")}{resizeHandle("tenure")}</th>
                  {/* EPC columns */}
                  <th className={headerClass} style={colWidths.beds ? { width: colWidths.beds } : {}} onClick={() => toggleSort("bedrooms")}>Beds{sortArrow("bedrooms")}{resizeHandle("beds")}</th>
                  <th className={headerClass} style={colWidths.area ? { width: colWidths.area } : {}} onClick={() => toggleSort("floor_area_sqm")}>Area m²{sortArrow("floor_area_sqm")}{resizeHandle("area")}</th>
                  <th className={headerClass} style={colWidths.epc ? { width: colWidths.epc } : {}} onClick={() => toggleSort("epc_rating")}>EPC{sortArrow("epc_rating")}{filterDropdown("epc_rating")}{resizeHandle("epc")}</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-semibold relative" style={colWidths.ppm2 ? { width: colWidths.ppm2 } : {}}>£/m²{resizeHandle("ppm2")}</th>
                </tr>
              </thead>
              <tbody>
                {/* ── Subject property row (frozen) ────────────────── */}
                <tr
                  className="sticky z-10"
                  style={{ top: `${headerH}px`, background: "#0F1620", boxShadow: "0 4px 0 0 rgba(0,240,255,0.3)" }}
                >
                  <td className="px-2 py-2">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider" style={{ background: "#00F0FF22", color: "#00F0FF" }}>S</span>
                  </td>
                  <td className="px-2 py-2 text-[#00F0FF] font-semibold text-xs break-words">{subjectSaon || "—"}</td>
                  <td className="px-2 py-2 text-[#00F0FF] font-semibold text-xs break-words">{subjectPaon || "—"}</td>
                  <td className="px-2 py-2 text-[#00F0FF] font-semibold text-xs break-words">{subjectStreet || "—"}</td>
                  {/* Hidden: Locality, Town, District, County */}
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-xs">{subjectPostcode}</td>
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-xs">{subjectPostcode.trim().split(/\s+/)[0]}</td>
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-xs">{subjectPostcode.trim().split(/\s+/)[1] ?? ""}</td>
                  <td className="px-2 py-2 text-[#475569] text-right">—</td>
                  <td className="px-2 py-2 text-[#475569]">—</td>
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-xs">{subjectPropertyType ?? "—"}</td>
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-xs">
                    {subjectTenure ? subjectTenure.charAt(0).toUpperCase() + subjectTenure.slice(1) : "—"}
                    {leaseRemaining && subjectTenure?.toLowerCase() === "leasehold" ? <span className="text-[#94A3B8] text-[10px] ml-1">({leaseRemaining})</span> : null}
                  </td>
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-center text-xs tabular-nums">{subjectRooms ?? "—"}</td>
                  <td className="px-2 py-2 text-[#00F0FF]/80 text-right text-xs tabular-nums">{subjectFloorArea ?? "—"}</td>
                  <td className="px-2 py-2 text-center">
                    {subjectEpcRating ? (
                      <span className={`inline-block w-5 h-5 rounded text-[10px] font-bold leading-5 text-center ${
                        subjectEpcRating <= "B" ? "bg-[#39FF14]/20 text-[#39FF14]" :
                        subjectEpcRating <= "D" ? "bg-[#FFB800]/20 text-[#FFB800]" :
                        "bg-[#FF3131]/20 text-[#FF3131]"
                      }`}>{subjectEpcRating}</span>
                    ) : <span className="text-[#475569]">—</span>}
                  </td>
                  <td className="px-2 py-2 text-[#475569] text-right">—</td>
                </tr>
                {sorted.map((row, i) => {
                  const isAdopted = adoptedIds.has(row.transaction_id);
                  const isSamePostcode = row.postcode === subjectPostcode;
                  const ppm2 = row.floor_area_sqm ? Math.round(row.price / row.floor_area_sqm) : null;

                  return (
                    <tr key={row.transaction_id}
                      className={`border-t border-[#334155]/40 transition-colors ${
                        isAdopted ? "bg-[#39FF14]/10" :
                        isSamePostcode ? "bg-[#00F0FF]/5" :
                        i % 2 === 0 ? "bg-[#111827]" : "bg-[#1E293B]"
                      } hover:bg-[#334155]/40`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => handleAdopt(row)}
                          className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
                            isAdopted
                              ? "bg-[#39FF14]/20 text-[#39FF14] border border-[#39FF14]/40"
                              : "bg-[#334155]/40 text-[#94A3B8] border border-[#334155] hover:border-[#00F0FF] hover:text-[#00F0FF]"
                          }`}
                          title={isAdopted ? "Remove from adopted" : "Adopt this comparable"}
                        >
                          {isAdopted ? "✓" : "+"}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-[#E2E8F0] break-words">{row.raw_saon || "—"}</td>
                      <td className="px-2 py-1.5 text-[#E2E8F0] break-words">{row._paon || "—"}</td>
                      <td className="px-2 py-1.5 text-[#E2E8F0] break-words">{row._street || "—"}</td>
                      {/* Hidden: Locality, Town, District, County */}
                      <td className="px-2 py-1.5 text-[#94A3B8]">{row.postcode}</td>
                      <td className="px-2 py-1.5 text-[#94A3B8]">{row.postcode.split(/\s+/)[0]}</td>
                      <td className="px-2 py-1.5 text-[#94A3B8]">{row.postcode.split(/\s+/)[1] ?? ""}</td>
                      <td className="px-2 py-1.5 text-[#E2E8F0] font-mono tabular-nums text-right">
                        £{row.price.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-[#94A3B8] tabular-nums">{row.date}</td>
                      <td className="px-2 py-1.5 text-[#94A3B8]">{row.property_type}</td>
                      <td className="px-2 py-1.5 text-[#94A3B8]">{row.tenure}</td>
                      {/* EPC columns */}
                      <td className="px-2 py-1.5 text-[#E2E8F0] text-center tabular-nums">
                        {row.bedrooms != null ? row.bedrooms : <span className="text-[#475569]">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-[#E2E8F0] text-right tabular-nums">
                        {row.floor_area_sqm != null ? row.floor_area_sqm.toFixed(0) : <span className="text-[#475569]">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {row.epc_rating ? (
                          <span className={`inline-block w-5 h-5 rounded text-[10px] font-bold leading-5 text-center ${
                            row.epc_rating <= "B" ? "bg-[#39FF14]/20 text-[#39FF14]" :
                            row.epc_rating <= "D" ? "bg-[#FFB800]/20 text-[#FFB800]" :
                            "bg-[#FF3131]/20 text-[#FF3131]"
                          }`}>{row.epc_rating}</span>
                        ) : <span className="text-[#475569]">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[#94A3B8]">
                        {ppm2 ? `£${ppm2.toLocaleString()}` : <span className="text-[#475569]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {!loading && fetched && rows.length === 0 && (
        <div className="text-center py-8 text-[#94A3B8] text-sm">
          No transactions found. Try adjusting your filters.
        </div>
      )}
    </div>
  );
}

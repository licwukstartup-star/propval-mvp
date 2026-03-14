"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import dynamic from "next/dynamic";
import { EpcBadge } from "./components/EpcBadge";
import PropCard from "./components/PropCard";
import HpiAutoFetch from "./components/HpiAutoFetch";
import ComparableSearch, { type ComparableCandidate, type SearchResponse, CompCard } from "@/components/ComparableSearch";
import ManualComparableForm from "@/components/ManualComparableForm";
import AdditionalComparable from "@/components/AdditionalComparable";

import { exportWordReport, type WordReportData } from "./components/exportWordReport";
import { useAuth } from "@/components/AuthProvider";
import ReportTyping from "./components/ReportTyping";
import ReportPreview from "./components/ReportPreview";
import SEMVTab from "./components/SEMVTab";
import HpiTab from "./components/HpiTab";
import SaveCaseDialog from "./components/SaveCaseDialog";
import MyCasesPanel from "./components/MyCasesPanel";

// Extracted modules
import type { PropertyResult, CardSizeKey, TabKey, AdoptedSortKey, SavedCaseSummary, HpiTrendSlice, HpiValueKey } from "@/types/property";
import { API_BASE, FULL_POSTCODE_RE } from "@/lib/constants";
import { formatPrice, fmtDate, yearsMonths, fmtK, fmtPsf, fmtDateShort } from "@/lib/formatters";
import { planningDecisionStyle, FLOOD_STYLE, GRADE_STYLE, ADOPTED_TIER_STYLE, CARD_SIZES_KEY, SIZE_PRESETS, PROP_CARD_DEFAULTS, appleFont, iosBlue, iosPurple, rptSection, rptH2, rptTable, rptTh, rptTdL, rptTdV, rptTdS, rptStripe } from "@/lib/styles";
import { hpiKeyForComp, computeAdjFactor, computeSizeAdj } from "@/lib/hpi-adjustments";

const PropertyMap = dynamic(() => import("./components/PropertyMap"), { ssr: false });
import type { CrimeCluster } from "./components/PropertyMap";

// PropCard, HpiAutoFetch extracted to ./components/PropCard.tsx and ./components/HpiAutoFetch.tsx

export default function Home() {
  const { session, isAdmin } = useAuth();
  const [address, setAddress] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [loading, setLoading] = useState(false);
  // Admin stopwatch
  const [searchElapsed, setSearchElapsed] = useState<number | null>(null);
  const searchStartRef = useRef<number>(0);
  useEffect(() => {
    if (!loading) return;
    searchStartRef.current = performance.now();
    setSearchElapsed(0);
    const iv = setInterval(() => setSearchElapsed(performance.now() - searchStartRef.current), 100);
    return () => { clearInterval(iv); setSearchElapsed(prev => prev !== null ? performance.now() - searchStartRef.current : prev); };
  }, [loading]);
  const [result, setResult] = useState<PropertyResult | null>(null);
  const [aiNarrative, setAiNarrative] = useState<{ location_summary: string | null; property_overview: string | null; market_context: string | null } | null>(null);
  const [aiNarrativeLoading, setAiNarrativeLoading] = useState<{ location_summary: boolean; property_overview: boolean; market_context: boolean }>({ location_summary: false, property_overview: false, market_context: false });
  const [aiNarrativeEditing, setAiNarrativeEditing] = useState<{ location_summary: boolean; property_overview: boolean; market_context: boolean }>({ location_summary: false, property_overview: false, market_context: false });
  const aiEditRefs = useRef<{ location_summary: HTMLTextAreaElement | null; property_overview: HTMLTextAreaElement | null; market_context: HTMLTextAreaElement | null }>({ location_summary: null, property_overview: null, market_context: null });
  const [enrichSlowDone, setEnrichSlowDone] = useState(false);
  const [enrichSlowError, setEnrichSlowError] = useState(false);
  const [reportContent, setReportContent] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("property");
  const DEFAULT_TAB_ORDER: TabKey[] = ["property", "map", "comparables", "wider", "additional", "hpi", "adopted", "report_typing", "semv", "report"];
  const [tabOrder, setTabOrder] = useState<TabKey[]>(DEFAULT_TAB_ORDER);
  const dragTabRef = useRef<TabKey | null>(null);
  const compClusterTabs: TabKey[] = ["comparables", "wider", "additional", "adopted"];
  const [compDropdownOpen, setCompDropdownOpen] = useState(false);
  const compDropdownRef = useRef<HTMLDivElement>(null);
  const compBtnRef = useRef<HTMLButtonElement>(null);
  const [compDropdownPos, setCompDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const compCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openCompDropdown = useCallback(() => {
    if (compCloseTimer.current) { clearTimeout(compCloseTimer.current); compCloseTimer.current = null; }
    if (compBtnRef.current) {
      const r = compBtnRef.current.getBoundingClientRect();
      setCompDropdownPos({ top: r.bottom + 4, left: r.left });
    }
    setCompDropdownOpen(true);
  }, []);
  const closeCompDropdown = useCallback(() => {
    compCloseTimer.current = setTimeout(() => setCompDropdownOpen(false), 150);
  }, []);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const leftFadeRef = useRef<HTMLDivElement>(null);
  const rightFadeRef = useRef<HTMLDivElement>(null);
  const tabScrollRaf = useRef<number | null>(null);
  const tabScrollSpeed = useRef(0);
  const stopTabScroll = useCallback(() => {
    if (tabScrollRaf.current) { cancelAnimationFrame(tabScrollRaf.current); tabScrollRaf.current = null; }
    tabScrollSpeed.current = 0;
  }, []);
  const startTabScroll = useCallback((direction: "left" | "right") => {
    stopTabScroll();
    const sign = direction === "left" ? -1 : 1;
    const maxSpeed = 27;
    const accel = 0.9;
    const tick = () => {
      tabScrollSpeed.current = Math.min(tabScrollSpeed.current + accel, maxSpeed);
      tabScrollRef.current?.scrollBy({ left: sign * tabScrollSpeed.current });
      tabScrollRaf.current = requestAnimationFrame(tick);
    };
    tabScrollRaf.current = requestAnimationFrame(tick);
  }, [stopTabScroll]);

  // Show/hide gradient fade hover zones based on scroll position
  const updateFades = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    const showLeft = el.scrollLeft > 8;
    const showRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 8;
    if (leftFadeRef.current) {
      leftFadeRef.current.style.opacity = showLeft ? "1" : "0";
      leftFadeRef.current.style.pointerEvents = showLeft ? "auto" : "none";
    }
    if (rightFadeRef.current) {
      rightFadeRef.current.style.opacity = showRight ? "1" : "0";
      rightFadeRef.current.style.pointerEvents = showRight ? "auto" : "none";
    }
  }, []);

  // Auto-scroll active tab into view
  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    const btn = el.querySelector(`[data-tab="${activeTab}"]`) as HTMLElement;
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTab]);

  // Update fades on mount, resize, and tab order changes
  useEffect(() => {
    // Wait one frame for DOM layout to stabilise before measuring scroll overflow
    const raf = requestAnimationFrame(() => updateFades());
    window.addEventListener("resize", updateFades);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", updateFades); stopTabScroll(); };
  }, [tabOrder, updateFades, stopTabScroll]);

  const [adoptedSortPostcode, setAdoptedSortPostcode] = useState<AdoptedSortKey>("default");
  const [adoptedSortDirPostcode, setAdoptedSortDirPostcode] = useState<"asc" | "desc">("desc");
  const [buildingSearchIds, setBuildingSearchIds] = useState<string[]>([]);
  const [buildingSearchAddressKeys, setBuildingSearchAddressKeys] = useState<string[]>([]);
  const [buildingSearchDone, setBuildingSearchDone] = useState(false);
  const [buildingSearchResult, setBuildingSearchResult] = useState<SearchResponse | null>(null);
  const [outwardSearchResult, setOutwardSearchResult] = useState<SearchResponse | null>(null);
  const [adoptedComparables, setAdoptedComparables] = useState<ComparableCandidate[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [hpiCorrelation, setHpiCorrelation] = useState(100);
  const [sizeElasticity, setSizeElasticity] = useState(15); // β in percent (0–50)
  const [valuationDate, setValuationDate] = useState("");
  const [cardSizes, setCardSizes] = useState<Record<string, CardSizeKey>>({ ...PROP_CARD_DEFAULTS });
  const [isCustomising, setIsCustomising] = useState(false);
  const printTitleRef = useRef<string>("");

  // Autocomplete dropdown state
  const [suggestions, setSuggestions] = useState<{ address: string; uprn: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);
  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map tab: postcode → centroid coords for adopted comparables
  const [compCoords, setCompCoords] = useState<Record<string, { lat: number; lon: number }>>({});

  // Map: lazy-mount so hooks don't fire until user first opens Map tab
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => { if (activeTab === "map" && !mapMounted) setMapMounted(true); }, [activeTab, mapMounted]);

  // Map layer toggles (lifted here so they persist across tab switches)
  const [mapShowFlood, setMapShowFlood] = useState(false);
  const [mapShowRings, setMapShowRings] = useState(true);
  const [mapShowLandUse, setMapShowLandUse] = useState(true);
  const [mapShowDeprivation, setMapShowDeprivation] = useState(false);
  const [mapShowRoadNoise, setMapShowRoadNoise] = useState(false);
  const [mapShowRailNoise, setMapShowRailNoise] = useState(false);
  const [mapShowCrime, setMapShowCrime] = useState(false);
  const [mapShowIncome, setMapShowIncome] = useState(false);
  const [mapShowEducation, setMapShowEducation] = useState(false);
  const [mapShowHeritage, setMapShowHeritage] = useState(false);
  const [mapTileLayer, setMapTileLayer] = useState<"dark" | "satellite" | "street">("dark");
  const [mapLandUseCache, setMapLandUseCache] = useState<GeoJSON.FeatureCollection | null>(null);
  const [mapImdCache, setMapImdCache] = useState<GeoJSON.FeatureCollection | null>(null);
  const [mapIncomeCache, setMapIncomeCache] = useState<GeoJSON.FeatureCollection | null>(null);
  const [mapEducationCache, setMapEducationCache] = useState<GeoJSON.FeatureCollection | null>(null);
  const [mapCrimeCache, setMapCrimeCache] = useState<CrimeCluster[] | null>(null);

  // Pre-fetch Land Use data as soon as coordinates are available (Overpass is slow, start early)
  const landUseFetchRef = useRef(false);
  useEffect(() => {
    if (!result?.lat || !result?.lon || mapLandUseCache || landUseFetchRef.current) return;
    landUseFetchRef.current = true;
    const query = `[out:json][timeout:30];(way["landuse"~"retail|commercial|industrial|recreation_ground"](around:4828,${result.lat},${result.lon});relation["landuse"~"retail|commercial|industrial|recreation_ground"](around:4828,${result.lat},${result.lon});way["leisure"~"park|garden|recreation_ground|playground|nature_reserve"](around:4828,${result.lat},${result.lon});relation["leisure"~"park|garden|recreation_ground|playground|nature_reserve"](around:4828,${result.lat},${result.lon}););out body;>;out skel qt;`;
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    })
      .then(r => { if (!r.ok) throw new Error(`Overpass ${r.status}`); return r.json(); })
      .then(data => {
        // Inline osmToGeoJSON — same logic as PropertyMap
        const nodes = new Map<number, [number, number]>();
        const ways = new Map<number, { nodes: number[]; tags?: Record<string, string> }>();
        for (const el of data.elements) {
          if (el.type === "node" && el.lat != null && el.lon != null) nodes.set(el.id, [el.lon, el.lat]);
          if (el.type === "way") ways.set(el.id, { nodes: el.nodes ?? [], tags: el.tags });
        }
        const features: GeoJSON.Feature[] = [];
        for (const [, way] of ways) {
          const tag = way.tags?.landuse ?? way.tags?.leisure;
          if (!tag) continue;
          const coords = way.nodes.map((nid: number) => nodes.get(nid)).filter(Boolean) as [number, number][];
          if (coords.length < 3) continue;
          features.push({ type: "Feature", properties: { landuse: way.tags?.landuse, leisure: way.tags?.leisure, name: way.tags?.name }, geometry: { type: "Polygon", coordinates: [coords] } });
        }
        for (const el of data.elements) {
          const tag = el.tags?.landuse ?? el.tags?.leisure;
          if (el.type !== "relation" || !tag || !el.members) continue;
          for (const member of el.members) {
            if (member.type === "way" && member.role === "outer") {
              const way = ways.get(member.ref);
              if (!way) continue;
              const coords = way.nodes.map((nid: number) => nodes.get(nid)).filter(Boolean) as [number, number][];
              if (coords.length < 3) continue;
              features.push({ type: "Feature", properties: { landuse: el.tags?.landuse, leisure: el.tags?.leisure, name: el.tags?.name }, geometry: { type: "Polygon", coordinates: [coords] } });
            }
          }
        }
        setMapLandUseCache({ type: "FeatureCollection", features });
      })
      .catch(() => { /* silently ignore */ })
      .finally(() => { landUseFetchRef.current = false; });
  }, [result?.lat, result?.lon, mapLandUseCache]);

  // Pre-fetch IMD + Income + Education (single ArcGIS query with all fields)
  const imdFetchRef = useRef(false);
  useEffect(() => {
    if (!result?.lat || !result?.lon || imdFetchRef.current) return;
    // Skip if all three caches already populated
    if (mapImdCache && mapIncomeCache && mapEducationCache) return;
    imdFetchRef.current = true;

    const IMD_FULL = "https://services-eu1.arcgis.com/EbKcOS6EXZroSyoi/arcgis/rest/services/Indices_of_Multiple_Deprivation_(IMD)_2019/FeatureServer/0/query";

    const dLat = 0.018, dLon = 0.03;
    const bbox = `${result.lon - dLon},${result.lat - dLat},${result.lon + dLon},${result.lat + dLat}`;

    (async () => {
      try {
        // Single query: fetch all IMD sub-domains + overall decile with geometry
        const url = new URL(IMD_FULL);
        url.searchParams.set("geometry", bbox);
        url.searchParams.set("geometryType", "esriGeometryEnvelope");
        url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
        url.searchParams.set("outFields", "lsoa11cd,lsoa11nm,IMDDec0,IncDec,IncScore,IncRank,EduDec,EduScore,EduRank");
        url.searchParams.set("f", "geojson");
        url.searchParams.set("inSR", "4326");
        url.searchParams.set("outSR", "4326");

        const res = await fetch(url.toString());
        if (res.ok) {
          const fc = await res.json() as GeoJSON.FeatureCollection;
          if (fc.features?.length) {
            // Add ls11cd/ls11nm aliases for popup compatibility
            for (const f of fc.features) {
              f.properties = { ...f.properties, ls11cd: f.properties?.lsoa11cd, ls11nm: f.properties?.lsoa11nm };
            }
            if (!mapImdCache) setMapImdCache(fc);
            if (!mapIncomeCache) setMapIncomeCache(fc);
            if (!mapEducationCache) setMapEducationCache(fc);
          }
        }
      } catch (err) { console.warn("[PreFetch IMD/Income/Education] failed:", err); }
      finally { imdFetchRef.current = false; }
    })();
  }, [result?.lat, result?.lon, mapImdCache, mapIncomeCache, mapEducationCache]);

  // Pre-fetch Crime data
  const crimeFetchRef = useRef(false);
  useEffect(() => {
    if (!result?.lat || !result?.lon || mapCrimeCache || crimeFetchRef.current) return;
    crimeFetchRef.current = true;
    (async () => {
      try {
        const metaRes = await fetch("https://data.police.uk/api/crime-last-updated");
        if (!metaRes.ok) return;
        const meta = await metaRes.json();
        const month = (meta.date as string).slice(0, 7);
        const res = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${result.lat}&lng=${result.lon}&date=${month}`);
        if (!res.ok) return;
        const crimes: Array<{ category: string; location: { latitude: string; longitude: string; street: { name: string } } }> = await res.json();
        const clusterMap = new Map<string, { lat: number; lon: number; count: number; categories: Record<string, number>; street: string }>();
        for (const c of crimes) {
          const key = `${c.location.latitude},${c.location.longitude}`;
          let cluster = clusterMap.get(key);
          if (!cluster) { cluster = { lat: parseFloat(c.location.latitude), lon: parseFloat(c.location.longitude), count: 0, categories: {}, street: c.location.street.name }; clusterMap.set(key, cluster); }
          cluster.count++;
          cluster.categories[c.category] = (cluster.categories[c.category] || 0) + 1;
        }
        setMapCrimeCache(Array.from(clusterMap.values()));
      } catch { /* silently ignore */ }
      finally { crimeFetchRef.current = false; }
    })();
  }, [result?.lat, result?.lon, mapCrimeCache]);

  // ── Saved cases state ──────────────────────────────────────────────────
  const [showCasesPanel, setShowCasesPanel] = useState(false);
  const [casesList, setCasesList] = useState<SavedCaseSummary[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);
  const [savingCase, setSavingCase] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveCaseType, setSaveCaseType] = useState<"research" | "full_valuation">("research");
  const [currentCaseStatus, setCurrentCaseStatus] = useState<string>("in_progress");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedAtRef = useRef(0);   // timestamp of last case load — suppress auto-save for 3s after
  const [pendingExitAfterSave, setPendingExitAfterSave] = useState(false);
  const pendingExitRef = useRef(false);
  const [pendingHomeReset, setPendingHomeReset] = useState(false);
  const [casesFilter, setCasesFilter] = useState<string>("all");
  const [casesSort, setCasesSort] = useState<string>("updated");
  const [casesSortDir, setCasesSortDir] = useState<"asc" | "desc">("desc");

  const fetchCases = useCallback(async () => {
    if (!session?.access_token) return;
    setCasesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/cases`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCasesList(data.cases ?? []);
      }
    } catch { /* ignore */ }
    finally { setCasesLoading(false); }
  }, [session?.access_token]);

  // Reset to clean search-only state (extracted so it can be called after save dialog)
  const doResetHome = useCallback(() => {
    setResult(null);
    setError(null);
    setAddress("");
    setActiveTab("property");
    setAdoptedComparables([]);
    setBuildingSearchIds([]);
    setBuildingSearchAddressKeys([]);
    setBuildingSearchDone(false);
    setBuildingSearchResult(null);
    setOutwardSearchResult(null);
    setCurrentCaseId(null);
    setSaveCaseType("research");
    setCurrentCaseStatus("in_progress");
    setValuationDate("");
    setHpiCorrelation(100);
    setSizeElasticity(0);
    setMapMounted(false);
    setMapLandUseCache(null);
    setMapImdCache(null);
    setMapIncomeCache(null);
    setMapEducationCache(null);
    setMapCrimeCache(null);
    landUseFetchRef.current = false;
    imdFetchRef.current = false;
    crimeFetchRef.current = false;
    setCompCoords({});
    setPendingExitAfterSave(false);
    setManualMode(false);
  }, []);

  // Keep UI state in a ref so fire-and-forget save always captures latest
  const uiStateRef = useRef<Record<string, unknown>>({});
  uiStateRef.current = {
    activeTab,
    cardSizes,
    mapLayers: {
      flood: mapShowFlood, rings: mapShowRings, landUse: mapShowLandUse,
      deprivation: mapShowDeprivation, roadNoise: mapShowRoadNoise, railNoise: mapShowRailNoise,
      crime: mapShowCrime, income: mapShowIncome, education: mapShowEducation, heritage: mapShowHeritage,
    },
    mapTileLayer,
  };

  // ---------------------------------------------------------------------------
  // Snapshot API helpers (Option E: UPRN Timeline)
  // ---------------------------------------------------------------------------

  /** Convert a case_comps API row (with nested property_snapshots) → ComparableCandidate */
  function caseCompToCandidate(cc: Record<string, unknown>): ComparableCandidate {
    const snap = (cc.property_snapshots ?? {}) as Record<string, unknown>;
    return {
      transaction_id: (snap.source_ref as string) ?? null,
      address:        snap.address as string,
      postcode:       snap.postcode as string,
      outward_code:   snap.outward_code as string,
      saon:           (snap.saon as string) ?? null,
      tenure:         (snap.tenure as string) ?? null,
      property_type:  (snap.property_type as string) ?? null,
      house_sub_type: (snap.house_sub_type as string) ?? null,
      bedrooms:       (snap.bedrooms as number) ?? null,
      building_name:  (snap.building_name as string) ?? null,
      building_era:   (snap.building_era as string) ?? null,
      build_year:     (snap.build_year as number) ?? null,
      build_year_estimated: (snap.build_year_estimated as boolean) ?? false,
      floor_area_sqm: (snap.floor_area_sqm as number) ?? null,
      price:          snap.price as number,
      transaction_date: snap.transaction_date as string,
      new_build:      (snap.new_build as boolean) ?? false,
      transaction_category: (snap.transaction_category as string) ?? null,
      geographic_tier: (cc.geographic_tier as number) ?? 0,
      tier_label:     (cc.tier_label as string) ?? "",
      spec_relaxations: (cc.spec_relaxations as string[]) ?? [],
      time_window_months: 0,
      epc_matched:    !!(snap.epc_rating),
      epc_rating:     (snap.epc_rating as string) ?? null,
      epc_score:      (snap.epc_score as number) ?? null,
      months_ago:     null,
      lease_remaining: null,
      snapshot_id:    snap.id as string,
      case_comp_id:   cc.id as string,
      source:         snap.source as string,
    };
  }

  /** Build the POST body for /api/snapshots/adopt from a ComparableCandidate */
  function candidateToAdoptBody(comp: ComparableCandidate, caseId: string) {
    // Determine source: if it has a transaction_id and no explicit source, it's from HMLR PPD
    const source = comp.source ?? (comp.transaction_id ? "hmlr_ppd" : "manual");
    return {
      case_id: caseId,
      source,
      source_ref: comp.transaction_id ?? undefined,
      address: comp.address,
      postcode: comp.postcode,
      outward_code: comp.outward_code,
      saon: comp.saon ?? undefined,
      tenure: comp.tenure ?? undefined,
      property_type: comp.property_type ?? undefined,
      house_sub_type: comp.house_sub_type ?? undefined,
      bedrooms: comp.bedrooms ?? undefined,
      building_name: comp.building_name ?? undefined,
      building_era: comp.building_era ?? undefined,
      build_year: comp.build_year ?? undefined,
      build_year_estimated: comp.build_year_estimated,
      floor_area_sqm: comp.floor_area_sqm ?? undefined,
      price: comp.price,
      transaction_date: comp.transaction_date,
      new_build: comp.new_build,
      transaction_category: comp.transaction_category ?? undefined,
      epc_rating: comp.epc_rating ?? undefined,
      epc_score: comp.epc_score ?? undefined,
      geographic_tier: comp.geographic_tier,
      tier_label: comp.tier_label,
      spec_relaxations: comp.spec_relaxations?.length ? comp.spec_relaxations : undefined,
    };
  }

  /** Adopt a comp via the snapshot API. Returns the comp with snapshot_id/case_comp_id attached. */
  async function adoptCompAPI(comp: ComparableCandidate, caseId: string): Promise<ComparableCandidate | null> {
    if (!session?.access_token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/snapshots/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(candidateToAdoptBody(comp, caseId)),
      });
      if (res.status === 409) return { ...comp }; // already adopted — keep in state
      if (!res.ok) { console.error("adoptCompAPI failed:", res.status); return null; }
      const data = await res.json();
      return { ...comp, snapshot_id: data.snapshot_id, case_comp_id: data.case_comp?.id };
    } catch (e) { console.error("adoptCompAPI error:", e); return null; }
  }

  /** Unadopt a comp via the snapshot API (soft-delete). */
  async function unadoptCompAPI(comp: ComparableCandidate): Promise<boolean> {
    if (!session?.access_token || !comp.case_comp_id) return false;
    try {
      const res = await fetch(`${API_BASE}/api/case-comps/${comp.case_comp_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      return res.ok;
    } catch (e) { console.error("unadoptCompAPI error:", e); return false; }
  }

  /** Load adopted comps from the case-comps API. Returns null on failure (caller should fall back). */
  async function loadCompsFromAPI(caseId: string): Promise<ComparableCandidate[] | null> {
    if (!session?.access_token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/case-comps?case_id=${caseId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.comps?.length) return null; // no comps in API — fall back to JSON blob
      return (data.comps as Record<string, unknown>[]).map(caseCompToCandidate);
    } catch { return null; }
  }

  /** Bulk-sync local-only comps (no case_comp_id) to the API after first save. */
  async function syncLocalCompsToAPI(comps: ComparableCandidate[], caseId: string): Promise<ComparableCandidate[]> {
    const results: ComparableCandidate[] = [];
    for (const comp of comps) {
      if (comp.case_comp_id) { results.push(comp); continue; } // already synced
      const synced = await adoptCompAPI(comp, caseId);
      results.push(synced ?? comp); // keep original if API fails
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Adopt / unadopt handlers (API-backed when case exists, local-only otherwise)
  // ---------------------------------------------------------------------------

  /** Toggle-adopt a single comparable. */
  const handleAdopt = useCallback(async (comp: ComparableCandidate) => {
    const k = comp.transaction_id ?? comp.address;
    setAdoptedComparables(prev => {
      const exists = prev.some(c => (c.transaction_id ?? c.address) === k);
      if (exists) {
        // Unadopt — fire API in background
        const existing = prev.find(c => (c.transaction_id ?? c.address) === k);
        if (existing?.case_comp_id && currentCaseId) unadoptCompAPI(existing);
        return prev.filter(c => (c.transaction_id ?? c.address) !== k);
      }
      return [...prev, comp];
    });
    // If adopting (not toggling off) and case exists, persist to API
    const alreadyAdopted = adoptedComparables.some(c => (c.transaction_id ?? c.address) === k);
    if (!alreadyAdopted && currentCaseId) {
      const synced = await adoptCompAPI(comp, currentCaseId);
      if (synced) {
        setAdoptedComparables(prev =>
          prev.map(c => (c.transaction_id ?? c.address) === k ? { ...c, snapshot_id: synced.snapshot_id, case_comp_id: synced.case_comp_id } : c)
        );
      }
    }
  }, [currentCaseId, adoptedComparables, session?.access_token]);

  /** Batch-adopt multiple comparables. */
  const handleAdoptAll = useCallback(async (comps: ComparableCandidate[]) => {
    const existing = new Set(adoptedComparables.map(c => c.transaction_id ?? c.address));
    const newComps = comps.filter(c => !existing.has(c.transaction_id ?? c.address));
    if (!newComps.length) return;
    setAdoptedComparables(prev => [...prev, ...newComps]);
    // Persist new comps to API in background
    if (currentCaseId) {
      for (const comp of newComps) {
        const synced = await adoptCompAPI(comp, currentCaseId);
        if (synced) {
          const k = comp.transaction_id ?? comp.address;
          setAdoptedComparables(prev =>
            prev.map(c => (c.transaction_id ?? c.address) === k ? { ...c, snapshot_id: synced.snapshot_id, case_comp_id: synced.case_comp_id } : c)
          );
        }
      }
    }
  }, [currentCaseId, adoptedComparables, session?.access_token]);

  /** Batch-unadopt multiple comparables. */
  const handleUnadoptAll = useCallback(async (comps: ComparableCandidate[]) => {
    const toRemove = new Set(comps.map(c => c.transaction_id ?? c.address));
    // Fire API calls for any that have case_comp_id
    if (currentCaseId) {
      for (const comp of comps) {
        const existing = adoptedComparables.find(c => (c.transaction_id ?? c.address) === (comp.transaction_id ?? comp.address));
        if (existing?.case_comp_id) unadoptCompAPI(existing);
      }
    }
    setAdoptedComparables(prev => prev.filter(c => !toRemove.has(c.transaction_id ?? c.address)));
  }, [currentCaseId, adoptedComparables, session?.access_token]);

  /** Unadopt a single comp (used in Adopted tab). */
  const handleUnadoptOne = useCallback(async (comp: ComparableCandidate) => {
    if (comp.case_comp_id && currentCaseId) unadoptCompAPI(comp);
    setAdoptedComparables(prev => prev.filter(c => (c.transaction_id ?? c.address) !== (comp.transaction_id ?? comp.address)));
  }, [currentCaseId, session?.access_token]);

  /** Add a manual/additional comparable. */
  const handleAddManual = useCallback(async (comp: ComparableCandidate) => {
    setAdoptedComparables(prev => [...prev, comp]);
    if (currentCaseId) {
      const synced = await adoptCompAPI(comp, currentCaseId);
      if (synced) {
        const k = comp.transaction_id ?? comp.address;
        setAdoptedComparables(prev =>
          prev.map(c => (c.transaction_id ?? c.address) === k ? { ...c, snapshot_id: synced.snapshot_id, case_comp_id: synced.case_comp_id } : c)
        );
      }
    }
  }, [currentCaseId, session?.access_token]);

  async function saveCase(silent = false) {
    if (!result || !session?.access_token) return;
    if (!silent) setSavingCase(true);
    if (silent) setAutoSaveStatus("saving");
    try {
      const method = currentCaseId ? "PATCH" : "POST";
      const url = currentCaseId ? `${API_BASE}/api/cases/${currentCaseId}` : `${API_BASE}/api/cases`;
      const searchResults = { building: buildingSearchResult, outward: outwardSearchResult };
      const payload = currentCaseId
        ? { comparables: adoptedComparables, search_results: searchResults, valuation_date: valuationDate || null, hpi_correlation: hpiCorrelation, size_elasticity: sizeElasticity, ai_narrative: aiNarrative, report_content: reportContent, ui_state: uiStateRef.current }
        : { address: result.address, postcode: result.postcode, uprn: result.uprn, case_type: saveCaseType, property_data: result, comparables: adoptedComparables, search_results: searchResults, valuation_date: valuationDate || null, hpi_correlation: hpiCorrelation, size_elasticity: sizeElasticity, ai_narrative: aiNarrative, report_content: reportContent, ui_state: uiStateRef.current };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = await res.json();
      const isNewCase = !currentCaseId;
      setCurrentCaseId(saved.id);
      setShowSaveDialog(false);
      // Sync local-only comps to snapshot API after first save (new case gets an ID)
      if (isNewCase && adoptedComparables.length > 0) {
        syncLocalCompsToAPI(adoptedComparables, saved.id).then(synced => setAdoptedComparables(synced));
      }
      if (pendingExitRef.current) {
        doResetHome();
        return;
      }
      if (silent) { setAutoSaveStatus("saved"); setTimeout(() => setAutoSaveStatus("idle"), 2000); }
    } catch {
      if (silent) { setAutoSaveStatus("error"); setTimeout(() => setAutoSaveStatus("idle"), 3000); }
      else alert("Failed to save case.");
    }
    finally { if (!silent) setSavingCase(false); }
  }

  // Auto-save: debounce 3s after changes to comparables/valuation params (only for existing cases)
  const saveCaseRef = useRef(saveCase);
  saveCaseRef.current = saveCase;

  // Fire-and-forget save using keepalive fetch (reliable during page unload)
  const fireAndForgetSave = useCallback(() => {
    if (!currentCaseId || !result || !session?.access_token) return;
    if (["issued", "archived"].includes(currentCaseStatus)) return;
    const url = `${API_BASE}/api/cases/${currentCaseId}`;
    const payload = { comparables: adoptedComparables, search_results: { building: buildingSearchResult, outward: outwardSearchResult }, valuation_date: valuationDate || null, hpi_correlation: hpiCorrelation, size_elasticity: sizeElasticity, ai_narrative: aiNarrative, report_content: reportContent, ui_state: uiStateRef.current };
    try {
      fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => { /* best effort — ignore network errors */ });
    } catch { /* best effort */ }
  }, [currentCaseId, result, session?.access_token, currentCaseStatus, adoptedComparables, valuationDate, hpiCorrelation, sizeElasticity, buildingSearchResult, outwardSearchResult, aiNarrative]);

  const fireAndForgetSaveRef = useRef(fireAndForgetSave);
  fireAndForgetSaveRef.current = fireAndForgetSave;

  // Refs to track current state inside event listeners (closures)
  const resultRef = useRef(result);
  resultRef.current = result;
  const currentCaseIdRef = useRef(currentCaseId);
  currentCaseIdRef.current = currentCaseId;
  pendingExitRef.current = pendingExitAfterSave;

  useEffect(() => {
    if (!currentCaseId || ["issued", "archived"].includes(currentCaseStatus)) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    // Skip auto-save for 3s after loading a case (avoids race with stale state)
    if (Date.now() - loadedAtRef.current < 3000) return;
    autoSaveTimerRef.current = setTimeout(() => {
      saveCaseRef.current(true);
    }, 1500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptedComparables, valuationDate, hpiCorrelation, sizeElasticity, currentCaseId, currentCaseStatus,
      activeTab, cardSizes, mapShowFlood, mapShowRings, mapShowLandUse, mapShowDeprivation,
      mapShowRoadNoise, mapShowRailNoise, mapShowCrime, mapShowIncome, mapShowEducation, mapShowHeritage, mapTileLayer]);

  async function loadCase(c: SavedCaseSummary) {
    if (!session?.access_token) return;
    // Save current case before loading a different one
    if (currentCaseId && currentCaseId !== c.id && !["issued", "archived"].includes(currentCaseStatus)) {
      await saveCaseRef.current(true);
    }
    setCasesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/cases/${c.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error("Load failed");
      const data = await res.json();
      const snapshot = (data.property_snapshot ?? data.property_data) as PropertyResult;
      loadedAtRef.current = Date.now();  // suppress auto-save during state restoration
      setResult(snapshot);
      setEnrichSlowDone(true);  // saved case already enriched
      // Try loading comps from case-comps API (Option E), fall back to JSON blob
      const apiComps = await loadCompsFromAPI(data.id);
      setAdoptedComparables(apiComps ?? data.comparables ?? []);
      // Restore saved AI narrative if available (no auto-generation)
      if (data.ai_narrative && (data.ai_narrative.location_summary || data.ai_narrative.property_overview || data.ai_narrative.market_context)) {
        setAiNarrative(data.ai_narrative);
      } else {
        setAiNarrative(null);
      }
      // Restore saved report content
      setReportContent(data.report_content ?? null);
      // Backfill INSPIRE coords if missing (cases saved before this feature)
      if (!snapshot?.inspire_lat && snapshot?.lat && snapshot?.lon) {
        fetch(`${API_BASE}/api/property/inspire-lookup`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ lat: snapshot.lat, lon: snapshot.lon }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.inspire_lat) setResult(prev => prev ? { ...prev, inspire_lat: d.inspire_lat, inspire_lon: d.inspire_lon } : prev); })
          .catch(() => {});
      }
      // Backfill HPI if missing from old case
      if (!snapshot?.hpi && snapshot?.postcode) {
        fetch(`${API_BASE}/api/property/hpi`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ postcode: snapshot.postcode, property_type: snapshot.property_type, built_form: snapshot.built_form }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.hpi) setResult(prev => prev ? { ...prev, hpi: d.hpi } : prev); })
          .catch(() => {});
      }
      // Restore cached search results
      const sr = data.search_results ?? {};
      setBuildingSearchResult(sr.building ?? null);
      setOutwardSearchResult(sr.outward ?? null);
      // If building results exist, mark building search as done so outward tab unlocks
      if (sr.building) {
        const ids = (sr.building.comparables ?? [])
          .map((c: ComparableCandidate) => c.transaction_id)
          .filter((id: string | null): id is string => id !== null);
        const addressKeys = (sr.building.comparables ?? [])
          .filter((c: ComparableCandidate) => c.saon)
          .map((c: ComparableCandidate) => `${c.saon!.toUpperCase()}|${c.postcode}`);
        setBuildingSearchIds(ids);
        setBuildingSearchAddressKeys(addressKeys);
        setBuildingSearchDone(true);
      } else {
        setBuildingSearchIds([]);
        setBuildingSearchAddressKeys([]);
        setBuildingSearchDone(false);
      }
      setValuationDate(data.valuation_date ?? "");
      setHpiCorrelation(data.hpi_correlation ?? 100);
      setSizeElasticity(data.size_elasticity ?? 0);
      setCurrentCaseId(data.id);
      setSaveCaseType(data.case_type ?? "research");
      setCurrentCaseStatus(data.status === "draft" ? "in_progress" : (data.status ?? "in_progress"));
      setAddress(data.address);

      // Restore UI state (tab, map layers, card sizes)
      const ui = data.ui_state;
      if (ui) {
        setActiveTab(ui.activeTab ?? "property");
        if (ui.cardSizes) setCardSizes(ui.cardSizes);
        if (ui.mapLayers) {
          setMapShowFlood(ui.mapLayers.flood ?? false);
          setMapShowRings(ui.mapLayers.rings ?? true);
          setMapShowLandUse(ui.mapLayers.landUse ?? true);
          setMapShowDeprivation(ui.mapLayers.deprivation ?? false);
          setMapShowRoadNoise(ui.mapLayers.roadNoise ?? false);
          setMapShowRailNoise(ui.mapLayers.railNoise ?? false);
          setMapShowCrime(ui.mapLayers.crime ?? false);
          setMapShowIncome(ui.mapLayers.income ?? false);
          setMapShowEducation(ui.mapLayers.education ?? false);
          setMapShowHeritage(ui.mapLayers.heritage ?? false);
        }
        if (ui.mapTileLayer) setMapTileLayer(ui.mapTileLayer);
      } else {
        setActiveTab("property");
      }

      setShowCasesPanel(false);
      setError(null);
    } catch { alert("Failed to load case."); }
    finally { setCasesLoading(false); }
  }

  async function deleteCase(id: string) {
    if (!session?.access_token) return;
    if (!confirm("Delete this saved case?")) return;
    try {
      await fetch(`${API_BASE}/api/cases/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setCasesList(prev => prev.filter(c => c.id !== id));
      if (currentCaseId === id) setCurrentCaseId(null);
    } catch { alert("Failed to delete case."); }
  }

  async function updateCaseStatus(newStatus: string) {
    if (!currentCaseId || !session?.access_token) return;
    setStatusUpdating(newStatus);
    try {
      const res = await fetch(`${API_BASE}/api/cases/${currentCaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Update failed");
      setCurrentCaseStatus(newStatus);
    } catch { alert("Failed to update status."); }
    finally { setStatusUpdating(null); }
  }

  useEffect(() => {
    const onBefore = () => { document.title = printTitleRef.current; };
    const onAfter  = () => { document.title = "PropVal"; };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint",  onAfter);
    const onOpenCases = () => { setShowCasesPanel(true); fetchCases(); };
    window.addEventListener("open-my-cases", onOpenCases);
    // Save on exit: fire a keepalive save when user closes tab/browser
    const onBeforeUnload = () => { fireAndForgetSaveRef.current(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    // Navbar navigation intercept: save before navigating away
    const onBeforeNavigate = () => { fireAndForgetSaveRef.current(); };
    window.addEventListener("propval-before-navigate", onBeforeNavigate);
    // Logo click: set flag → useEffect handles save + reset
    const onResetHome = () => {
      if (resultRef.current && !currentCaseIdRef.current) {
        if (confirm("You have unsaved work. Save before exiting?")) {
          setShowSaveDialog(true);
          setPendingExitAfterSave(true);
          return;
        }
      }
      setPendingHomeReset(true);
    };
    window.addEventListener("propval-reset-home", onResetHome);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint",  onAfter);
      window.removeEventListener("open-my-cases", onOpenCases);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("propval-before-navigate", onBeforeNavigate);
      window.removeEventListener("propval-reset-home", onResetHome);
    };
  }, [fetchCases]);

  // Handle PropVal logo click: save current case (with ui_state) then reset
  useEffect(() => {
    if (!pendingHomeReset) return;
    let cancelled = false;
    (async () => {
      if (currentCaseId && !["issued", "archived"].includes(currentCaseStatus)) {
        await saveCaseRef.current(true);
      }
      if (!cancelled) {
        setPendingHomeReset(false);
        doResetHome();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHomeReset]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CARD_SIZES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, CardSizeKey>;
        setCardSizes(prev => ({ ...prev, ...parsed }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setIsCustomising(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function handleCardSizeChange(id: string, size: CardSizeKey) {
    const next = { ...cardSizes, [id]: size };
    setCardSizes(next);
    try { localStorage.setItem(CARD_SIZES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function resetCardSizes() {
    setCardSizes({ ...PROP_CARD_DEFAULTS });
    try { localStorage.removeItem(CARD_SIZES_KEY); } catch { /* ignore */ }
  }

  // Geocode comparable postcodes via postcodes.io bulk API when Map tab opens
  useEffect(() => {
    if (activeTab !== "map" || adoptedComparables.length === 0) return;
    const uniquePcs = [...new Set(adoptedComparables.map(c => c.postcode))];
    const missing = uniquePcs.filter(pc => !compCoords[pc]);
    if (missing.length === 0) return;
    fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: missing }),
    })
      .then(r => r.json())
      .then(data => {
        const updates: Record<string, { lat: number; lon: number }> = {};
        for (const item of (data.result ?? [])) {
          if (item.result?.latitude) {
            updates[item.query] = { lat: item.result.latitude, lon: item.result.longitude };
          }
        }
        if (Object.keys(updates).length > 0) setCompCoords(prev => ({ ...prev, ...updates }));
      })
      .catch(() => { /* silently ignore — subject pin still shows */ });
  }, [activeTab, adoptedComparables]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAddressChange(val: string) {
    setAddress(val);
    setSuggestionIdx(-1);
    const pcMatch = val.match(FULL_POSTCODE_RE);
    if (!pcMatch) { setSuggestions([]); setShowSuggestions(false); return; }
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      setShowSuggestions(true);
      try {
        const res = await fetch(`${API_BASE}/api/property/autocomplete?postcode=${encodeURIComponent(pcMatch[0])}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const list: { address: string; uprn: string }[] = data.addresses ?? [];
          setSuggestions(list);
          setShowSuggestions(true); // always show — even if empty, we show "not listed" link
        }
      } catch { /* silently ignore */ }
      finally { setSuggestionsLoading(false); }
    }, 400);
  }

  function handleSuggestionKeyDown(e: React.KeyboardEvent) {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestionIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && suggestionIdx >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[suggestionIdx]);
    } else if (e.key === "Escape") { setShowSuggestions(false); setSuggestionIdx(-1); }
  }

  const searchFormRef = useRef<HTMLFormElement>(null);
  const searchFormRef2 = useRef<HTMLFormElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  function pickSuggestion(s: { address: string; uprn: string }) {
    setAddress(s.address);
    setShowSuggestions(false); setSuggestions([]); setSuggestionIdx(-1);
    // Auto-submit search immediately after picking an address
    setTimeout(() => {
      const form = searchFormRef.current ?? searchFormRef2.current;
      form?.requestSubmit();
    }, 0);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;

    // Save current case before starting a new search
    if (currentCaseId && !["issued", "archived"].includes(currentCaseStatus)) {
      await saveCaseRef.current(true);
    }

    setLoading(true);
    // Keep previous result visible while loading — cleared only on success or error
    setError(null);

    // Cancel any previous in-flight search to prevent stale results
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 95000);

    try {
      const res = await fetch(`${API_BASE}/api/property/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ address }),
        signal: controller.signal,
      });

      let data: PropertyResult;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `Error ${res.status}`);
      setResult(data);
      setError(null);
      setActiveTab("property");
      // Fire slow enrichment (council tax + planning flood) in background
      setEnrichSlowDone(false);
      setEnrichSlowError(false);
      const slowController = new AbortController();
      setTimeout(() => slowController.abort(), 95000);
      fetch(`${API_BASE}/api/property/enrich-slow`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ postcode: data.postcode, address: data.address, lat: data.lat, lon: data.lon }),
        signal: slowController.signal,
      }).then(r => r.ok ? r.json() : null).then(slow => {
        if (slow) setResult(prev => prev ? {
          ...prev,
          council_tax_band: slow.council_tax_band ?? prev.council_tax_band,
          planning_flood_zone: slow.planning_flood_zone ?? prev.planning_flood_zone,
          rivers_sea_risk: slow.rivers_sea_risk ?? prev.rivers_sea_risk,
          surface_water_risk: slow.surface_water_risk ?? prev.surface_water_risk,
        } : prev);
      }).catch(() => { setEnrichSlowError(true); }).finally(() => setEnrichSlowDone(true));
      // Backfill HPI if initial search returned null (timeout)
      if (!data.hpi && data.postcode) {
        fetch(`${API_BASE}/api/property/hpi`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ postcode: data.postcode, property_type: data.property_type, built_form: data.built_form }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.hpi) setResult(prev => prev ? { ...prev, hpi: d.hpi } : prev); })
          .catch(() => {});
      }
      // AI narrative: reset (user must click to generate)
      setAiNarrative(null);
      setBuildingSearchIds([]);
      setBuildingSearchAddressKeys([]);
      setBuildingSearchDone(false);
      setBuildingSearchResult(null);
      setOutwardSearchResult(null);
      setMapMounted(false);
      setMapLandUseCache(null);
      setMapImdCache(null);
      setMapIncomeCache(null);
      setMapEducationCache(null);
      setMapCrimeCache(null);
      landUseFetchRef.current = false;
      setAdoptedComparables([]);
      setCurrentCaseId(null);
      setSaveCaseType("research");
      setCurrentCaseStatus("in_progress");
      setValuationDate("");
    } catch (err) {
      // If this search was cancelled by a newer search, silently ignore
      if (controller.signal.aborted && searchAbortRef.current !== controller) return;
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out. The server took too long to respond.");
      } else {
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  async function downloadEpc(certUrl: string) {
    try {
      const res = await fetch(`${API_BASE}/api/property/epc-pdf?cert_url=${encodeURIComponent(certUrl)}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `epc-${certUrl.split("/").pop()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download EPC PDF.");
    }
  }

  const epcFields: [string, string | number | null][] = result
    ? [
        ["Property type", result.property_type],
        ["Built form", result.built_form],
        ["Floor area", result.floor_area_m2 != null ? `${result.floor_area_m2} m²` : null],
        ["Construction era", result.construction_age_band],
        ["Habitable rooms", result.num_rooms],
        ["Heating", result.heating_type],
        ["Inspection date", result.inspection_date],
        ["Admin district", result.admin_district],
        ["Region", result.region],
        ["LSOA", result.lsoa],
        [
          `Coordinates (${result.coord_source ?? "geocoder"})`,
          result.lat != null && result.lon != null
            ? `${result.lat.toFixed(5)}, ${result.lon.toFixed(5)}`
            : null,
        ],
        [
          "Coordinates (HMLR INSPIRE)",
          result.inspire_lat != null && result.inspire_lon != null
            ? `${result.inspire_lat.toFixed(5)}, ${result.inspire_lon.toFixed(5)}`
            : null,
        ],
      ]
    : [];

  const valuationYear = valuationDate ? new Date(valuationDate).getFullYear() : new Date().getFullYear();
  const adoptedIds = new Set(adoptedComparables.map(c => c.transaction_id ?? c.address));
  const adoptedByTier: Record<number, ComparableCandidate[]> = {};
  for (const c of adoptedComparables) {
    if (!adoptedByTier[c.geographic_tier]) adoptedByTier[c.geographic_tier] = [];
    adoptedByTier[c.geographic_tier].push(c);
  }
  // Adopted comps for display
  const adoptedPostcodeComps = adoptedComparables;

  function sortAdoptedComps(comps: ComparableCandidate[], sortKey: AdoptedSortKey, dir: "asc" | "desc"): ComparableCandidate[] {
    if (sortKey === "default") return comps;
    return [...comps].sort((a, b) => {
      let av: number, bv: number;
      switch (sortKey) {
        case "date":  av = new Date(a.transaction_date).getTime(); bv = new Date(b.transaction_date).getTime(); break;
        case "size":  av = a.floor_area_sqm ?? -1; bv = b.floor_area_sqm ?? -1; break;
        case "price": av = a.price; bv = b.price; break;
        case "psf":   av = a.floor_area_sqm ? a.price / (a.floor_area_sqm * 10.764) : -1; bv = b.floor_area_sqm ? b.price / (b.floor_area_sqm * 10.764) : -1; break;
      }
      return dir === "asc" ? av - bv : bv - av;
    });
  }

  // ── Adopted comparables dashboard stats ──────────────────────────────────
  const adoptedPrices    = adoptedComparables.map(c => c.price);
  const adoptedPriceMin  = adoptedPrices.length ? Math.min(...adoptedPrices) : 0;
  const adoptedPriceMax  = adoptedPrices.length ? Math.max(...adoptedPrices) : 0;
  const adoptedPriceAvg  = adoptedPrices.length ? adoptedPrices.reduce((a, b) => a + b, 0) / adoptedPrices.length : 0;

  const adoptedWithArea  = adoptedComparables.filter(c => c.floor_area_sqm != null && c.floor_area_sqm > 0);
  const adoptedPsfs      = adoptedWithArea.map(c => c.price / (c.floor_area_sqm! * 10.764));
  const adoptedPsfMin    = adoptedPsfs.length ? Math.min(...adoptedPsfs) : null;
  const adoptedPsfMax    = adoptedPsfs.length ? Math.max(...adoptedPsfs) : null;
  const adoptedPsfAvg    = adoptedPsfs.length ? adoptedPsfs.reduce((a, b) => a + b, 0) / adoptedPsfs.length : null;

  const adoptedSizes     = adoptedWithArea.map(c => c.floor_area_sqm!);
  const adoptedSizeMin   = adoptedSizes.length ? Math.min(...adoptedSizes) : null;
  const adoptedSizeMax   = adoptedSizes.length ? Math.max(...adoptedSizes) : null;
  const adoptedSizeAvg   = adoptedSizes.length ? adoptedSizes.reduce((a, b) => a + b, 0) / adoptedSizes.length : null;

  const adoptedDatesSorted = [...adoptedComparables.map(c => c.transaction_date)].sort();
  const adoptedDateMin   = adoptedDatesSorted[0] ?? null;
  const adoptedDateMax   = adoptedDatesSorted[adoptedDatesSorted.length - 1] ?? null;

  const subjectAreaM2    = result?.floor_area_m2 ?? null;
  const subjectAreaSqft  = subjectAreaM2 != null ? subjectAreaM2 * 10.764 : null;
  const indicativeValLow = adoptedPsfMin != null && subjectAreaSqft != null ? adoptedPsfMin * subjectAreaSqft : null;
  const indicativeValHigh= adoptedPsfMax != null && subjectAreaSqft != null ? adoptedPsfMax * subjectAreaSqft : null;
  const indicativeValMid = adoptedPsfAvg != null && subjectAreaSqft != null ? adoptedPsfAvg * subjectAreaSqft : null;

  // ── Time-adjusted (HPI correlation) ─────────────────────────────────────
  const hpiTrend    = (result?.hpi?.trend ?? []) as HpiTrendSlice[];
  const adjFactors  = adoptedComparables.map(c => computeAdjFactor(c, hpiTrend, hpiCorrelation));
  const adjPsfsWithArea = adoptedComparables
    .map((c, i) => c.floor_area_sqm != null
      ? Math.round(c.price * adjFactors[i] / (c.floor_area_sqm * 10.764))
      : null)
    .filter((v): v is number => v != null);
  const adjPsfMin = adjPsfsWithArea.length ? Math.min(...adjPsfsWithArea) : null;
  const adjPsfMax = adjPsfsWithArea.length ? Math.max(...adjPsfsWithArea) : null;
  const adjPsfAvg = adjPsfsWithArea.length ? Math.round(adjPsfsWithArea.reduce((a, b) => a + b, 0) / adjPsfsWithArea.length) : null;
  const adjIndicativeLow  = adjPsfMin != null && subjectAreaSqft != null ? Math.round(adjPsfMin * subjectAreaSqft) : null;
  const adjIndicativeHigh = adjPsfMax != null && subjectAreaSqft != null ? Math.round(adjPsfMax * subjectAreaSqft) : null;
  const adjIndicativeMid  = adjPsfAvg != null && subjectAreaSqft != null ? Math.round(adjPsfAvg * subjectAreaSqft) : null;

  // ── Size-adjusted (β power curve on top of time adjustment) ──────────────
  const betaFloat = sizeElasticity / 100;
  const sizeAdjResults = adoptedComparables.map((c, i) => {
    const sqft = c.floor_area_sqm != null ? c.floor_area_sqm * 10.764 : null;
    const timeAdjPsf = sqft != null ? (c.price * adjFactors[i]) / sqft : null;
    if (sqft == null || subjectAreaSqft == null || timeAdjPsf == null) {
      return { adjPsf: timeAdjPsf, pctChange: 0, capped: false };
    }
    return computeSizeAdj(sqft, subjectAreaSqft, timeAdjPsf, c.price, betaFloat);
  });
  const sizeAdjPsfsArr = sizeAdjResults.map(r => r.adjPsf).filter((v): v is number => v != null);
  const sizeAdjPsfMin = sizeAdjPsfsArr.length ? Math.min(...sizeAdjPsfsArr) : null;
  const sizeAdjPsfMax = sizeAdjPsfsArr.length ? Math.max(...sizeAdjPsfsArr) : null;
  const sizeAdjPsfAvg = sizeAdjPsfsArr.length ? Math.round(sizeAdjPsfsArr.reduce((a, b) => a + b, 0) / sizeAdjPsfsArr.length) : null;
  const sizeAdjIndLow  = sizeAdjPsfMin != null && subjectAreaSqft != null ? Math.round(sizeAdjPsfMin * subjectAreaSqft) : null;
  const sizeAdjIndHigh = sizeAdjPsfMax != null && subjectAreaSqft != null ? Math.round(sizeAdjPsfMax * subjectAreaSqft) : null;
  const sizeAdjIndMid  = sizeAdjPsfAvg != null && subjectAreaSqft != null ? Math.round(sizeAdjPsfAvg * subjectAreaSqft) : null;

  return (
    <main className="min-h-screen bg-[#0A0E1A] flex flex-col items-center px-4">

      {!result ? (
        /* ── Initial state: no result yet ─ centred search ────────────────── */
        <div className="w-full max-w-xl py-16">
          <div className="mb-1">
            <h1 className="text-3xl font-bold font-orbitron text-[#00F0FF] tracking-wider">PropVal</h1>
          </div>
          <p className="text-sm text-[#94A3B8] mb-8">
            {manualMode ? "Type the full address to search" : "Enter a UK postcode and select the address"}
          </p>

          <form ref={searchFormRef} onSubmit={handleSearch} className="flex gap-2 mb-2 items-center">
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type="text"
                value={address}
                onChange={(e) => handleAddressChange(e.target.value)}
                onKeyDown={(e) => {
                  handleSuggestionKeyDown(e);
                  // In postcode mode, block Enter unless a suggestion is selected (force pick from list)
                  if (!manualMode && e.key === "Enter" && suggestionIdx < 0) e.preventDefault();
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                placeholder={manualMode ? "e.g. 41 Gander Green Lane SM1 2EG" : "e.g. SM1 2EG"}
                disabled={loading}
                className="w-full rounded-lg border border-[#334155] bg-[#1E293B] text-[#E2E8F0] placeholder:text-[#94A3B8]/50 px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#00F0FF] disabled:opacity-50"
              />
              {(showSuggestions || suggestionsLoading) && !manualMode && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#1E293B", border: "1px solid #334155", borderRadius: 8, maxHeight: 320, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                  {suggestionsLoading && <div style={{ padding: "10px 14px", fontSize: 12, color: "#94A3B8" }}>Loading addresses…</div>}
                  {!suggestionsLoading && suggestions.map((s, i) => (
                    <div key={i} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }} onMouseEnter={() => setSuggestionIdx(i)}
                      style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: i === suggestionIdx ? "#00F0FF" : "#E2E8F0", background: i === suggestionIdx ? "rgba(0,240,255,0.08)" : "transparent", borderBottom: "1px solid rgba(51,65,85,0.3)" }}>
                      {s.address}
                    </div>
                  ))}
                  {!suggestionsLoading && (
                    <div
                      onMouseDown={(e) => { e.preventDefault(); setManualMode(true); setShowSuggestions(false); }}
                      style={{ padding: "10px 14px", fontSize: 12, color: "#FFB800", cursor: "pointer", borderTop: "1px solid #334155", background: "rgba(255,184,0,0.05)" }}
                    >
                      Address not listed? Click here to type full address manually
                    </div>
                  )}
                </div>
              )}
              {/* Manual mode autocomplete (same as before) */}
              {(showSuggestions || suggestionsLoading) && manualMode && suggestions.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#1E293B", border: "1px solid #334155", borderRadius: 8, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                  {suggestionsLoading && <div style={{ padding: "10px 14px", fontSize: 12, color: "#94A3B8" }}>Loading addresses…</div>}
                  {!suggestionsLoading && suggestions.map((s, i) => (
                    <div key={i} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }} onMouseEnter={() => setSuggestionIdx(i)}
                      style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: i === suggestionIdx ? "#00F0FF" : "#E2E8F0", background: i === suggestionIdx ? "rgba(0,240,255,0.08)" : "transparent", borderBottom: i < suggestions.length - 1 ? "1px solid rgba(51,65,85,0.5)" : "none" }}>
                      {s.address}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {manualMode && (
              <button
                type="submit"
                disabled={loading || !address.trim()}
                className="rounded-lg bg-[#00F0FF] text-[#0A0E1A] px-5 py-2.5 text-sm font-bold shadow-sm hover:bg-[#00D4E0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Searching…" : "Search"}
              </button>
            )}
            {isAdmin && searchElapsed !== null && (
              <span className="text-xs font-mono text-[#94A3B8] whitespace-nowrap ml-2">{(searchElapsed / 1000).toFixed(1)}s</span>
            )}
          </form>
          {manualMode && (
            <button
              onClick={() => { setManualMode(false); setAddress(""); setSuggestions([]); setShowSuggestions(false); }}
              className="text-xs text-[#94A3B8] hover:text-[#00F0FF] transition-colors mb-6 cursor-pointer"
            >
              ← Back to postcode lookup
            </button>
          )}
          {!manualMode && <div className="mb-6" />}

          {loading && (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#00F0FF] border-t-transparent" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-[#FF3131]/40 bg-[#FF3131]/10 px-4 py-3 text-sm text-[#FF3131]">
              {error}
            </div>
          )}
        </div>
      ) : (
        /* ── Result loaded: tabs pinned to top ─────────────────────────────── */
        <div className="w-full max-w-6xl px-4 pt-6">
          <style>{`
            @keyframes propCardJiggle {
              0%   { transform: rotate(-0.4deg) scale(0.99); }
              100% { transform: rotate(0.4deg)  scale(0.99); }
            }
            @keyframes propCardPopIn {
              0%   { opacity: 0; transform: scale(0.82) translateY(-6px); }
              100% { opacity: 1; transform: scale(1)    translateY(0); }
            }
          `}</style>

          {/* Tab bar — scrollable, drag to reorder */}
          <div className="relative mb-6 no-print">
            {/* Left hover-to-scroll zone — subtle translucent cyan hint */}
            <div ref={leftFadeRef} className="pointer-events-none absolute left-0 top-0 bottom-0 w-14 z-10 opacity-0 transition-opacity" style={{ background: "linear-gradient(to right, rgba(0,240,255,0.20) 0%, rgba(0,240,255,0.08) 40%, transparent 100%)" }} onMouseEnter={() => startTabScroll("left")} onMouseLeave={stopTabScroll} />

            {/* Scrollable tab strip */}
            <div ref={tabScrollRef} className="flex items-end overflow-x-auto border-b border-[#334155] scrollbar-hide scroll-smooth" onScroll={updateFades}>
              {(() => {
                const labels: Record<TabKey, string> = { property: "Property Information", map: "Map", hpi: "HPI", comparables: "Direct Comparables", wider: "Wider Comparables", additional: "Additional Comparables", adopted: "Adopted Comparables", report_typing: "Report Typing", semv: "SEMV", report: "Report" };
                const compShortLabels: Record<string, string> = { comparables: "Direct", wider: "Wider", additional: "Additional", adopted: "Adopted" };
                let compClusterRendered = false;
                return tabOrder.map((tab) => {
                  // ── Comparables cluster: render a single dropdown button in place of first comp tab ──
                  if (compClusterTabs.includes(tab)) {
                    if (compClusterRendered) return null; // skip 2nd & 3rd
                    compClusterRendered = true;
                    const isCompActive = compClusterTabs.includes(activeTab);
                    const adoptedBadge = adoptedComparables.length > 0 ? adoptedComparables.length : null;
                    const activeCompLabel = isCompActive ? compShortLabels[activeTab] : null;
                    return (
                      <div key="comp-cluster" className="relative flex-shrink-0 mr-1 -mb-px" onMouseEnter={openCompDropdown} onMouseLeave={closeCompDropdown}>
                        <button
                          ref={compBtnRef}
                          data-tab={isCompActive ? activeTab : "comparables"}
                          onClick={() => { if (!isCompActive) { setActiveTab("comparables"); setCompDropdownOpen(false); } }}
                          className={`flex items-center gap-1 whitespace-nowrap px-5 py-2.5 text-sm font-medium rounded-t-lg border transition-colors ${
                            isCompActive
                              ? "bg-[#111827] border-[#334155] text-[#00F0FF]"
                              : "border-transparent text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]"
                          }`}
                          style={isCompActive ? { borderBottomColor: "#111827" } : undefined}
                        >
                          Comparable
                          {adoptedBadge !== null && (
                            <span className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-[#39FF14] text-[#0A0E1A]">
                              {adoptedBadge}
                            </span>
                          )}
                          <svg className={`w-3.5 h-3.5 ml-1 transition-transform ${compDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        {compDropdownOpen && ReactDOM.createPortal(
                          <div
                            ref={compDropdownRef}
                            onMouseEnter={openCompDropdown}
                            onMouseLeave={closeCompDropdown}
                            className="fixed min-w-[200px] rounded-lg border border-[#334155] bg-[#111827] shadow-lg shadow-black/40 py-1"
                            style={{ top: compDropdownPos.top, left: compDropdownPos.left, zIndex: 9999 }}
                          >
                            {compClusterTabs.map(ct => {
                              const isActive = activeTab === ct;
                              const badge = ct === "adopted" && adoptedComparables.length > 0 ? adoptedComparables.length : null;
                              return (
                                <button
                                  key={ct}
                                  onClick={() => { setActiveTab(ct); setCompDropdownOpen(false); }}
                                  className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center justify-between ${
                                    isActive ? "text-[#00F0FF] bg-[#00F0FF]/10" : "text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]"
                                  }`}
                                >
                                  {labels[ct]}
                                  {badge !== null && (
                                    <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-[#39FF14] text-[#0A0E1A]">
                                      {badge}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>,
                          document.body
                        )}
                      </div>
                    );
                  }
                  // ── Regular tab button ──
                  const active = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      data-tab={tab}
                      draggable
                      onDragStart={(e) => {
                        dragTabRef.current = tab;
                        e.dataTransfer.effectAllowed = "move";
                        if (e.currentTarget) {
                          e.dataTransfer.setDragImage(e.currentTarget, e.currentTarget.offsetWidth / 2, e.currentTarget.offsetHeight / 2);
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragTabRef.current;
                        if (!from || from === tab) return;
                        setTabOrder(prev => {
                          const next = [...prev];
                          const fromIdx = next.indexOf(from);
                          const toIdx = next.indexOf(tab);
                          if (fromIdx === -1 || toIdx === -1) return prev;
                          next.splice(fromIdx, 1);
                          next.splice(toIdx, 0, from);
                          return next;
                        });
                        dragTabRef.current = null;
                      }}
                      onDragEnd={() => { dragTabRef.current = null; }}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-shrink-0 whitespace-nowrap mr-1 px-5 py-2.5 text-sm font-medium rounded-t-lg border -mb-px transition-colors cursor-grab active:cursor-grabbing ${
                        active
                          ? "bg-[#111827] border-[#334155] text-[#00F0FF]"
                          : "border-transparent text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-[#1E293B]"
                      }`}
                      style={active ? { borderBottomColor: "#111827" } : undefined}
                    >
                      {labels[tab]}
                    </button>
                  );
                });
              })()}
            </div>

            {/* Right hover-to-scroll zone — subtle translucent cyan hint */}
            <div ref={rightFadeRef} className="pointer-events-none absolute right-0 top-0 bottom-0 w-14 z-10 opacity-0 transition-opacity" style={{ background: "linear-gradient(to left, rgba(0,240,255,0.20) 0%, rgba(0,240,255,0.08) 40%, transparent 100%)" }} onMouseEnter={() => startTabScroll("right")} onMouseLeave={stopTabScroll} />
          </div>

          {/* ── Action bar: case controls + customise ──────────────────────────── */}
          <div className="flex items-center justify-between mb-4 no-print">
            {/* Left: save + auto-save indicator + status flow */}
            <div className="flex items-center gap-2">
              {!currentCaseId && (
                <button
                  onClick={() => setShowSaveDialog(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#39FF14]/40 text-[#39FF14] hover:bg-[#39FF14]/10 transition-colors"
                >
                  Create a New Case
                </button>
              )}
              {currentCaseId && (
                <span className={`text-[10px] px-2 py-1 rounded ${
                  autoSaveStatus === "saving" ? "text-[#FFB800]"
                  : autoSaveStatus === "saved" ? "text-[#39FF14]"
                  : autoSaveStatus === "error" ? "text-[#FF3131]"
                  : "text-[#475569]"
                }`}>
                  {autoSaveStatus === "saving" ? "Saving..."
                  : autoSaveStatus === "saved" ? "Saved"
                  : autoSaveStatus === "error" ? "Save failed"
                  : ["issued", "archived"].includes(currentCaseStatus) ? "Locked" : "Auto-save on"}
                </span>
              )}
              {currentCaseId && (() => {
                const allStatuses: { key: string; label: string; color: string }[] = [
                  { key: "in_progress", label: "In Progress", color: "border-[#FFB800]/40 text-[#FFB800] bg-[#FFB800]/10" },
                  { key: "complete", label: "Complete", color: "border-[#39FF14]/40 text-[#39FF14] bg-[#39FF14]/10" },
                  { key: "issued", label: "Issued", color: "border-[#00F0FF]/40 text-[#00F0FF] bg-[#00F0FF]/10" },
                  { key: "archived", label: "Archived", color: "border-[#334155] text-[#94A3B8] bg-[#334155]/20" },
                ];
                const statusFlow: Record<string, string[]> = {
                  in_progress: ["complete"],
                  complete: ["in_progress", "issued"],
                  issued: ["archived"],
                  archived: [],
                };
                const allowed = statusFlow[currentCaseStatus] ?? [];
                return (
                  <div className="flex items-center gap-1">
                    {allStatuses.map(s => {
                      const isCurrent = currentCaseStatus === s.key;
                      const isAllowed = allowed.includes(s.key);
                      return (
                        <button
                          key={s.key}
                          onClick={() => {
                            if (isAllowed && s.key === "issued" && !confirm("Issue this case? It will become locked and cannot be edited.")) return;
                            if (isAllowed) updateCaseStatus(s.key);
                          }}
                          disabled={(!isAllowed && !isCurrent) || !!statusUpdating}
                          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                            isCurrent
                              ? s.color + " ring-1 ring-current"
                              : isAllowed && !statusUpdating
                                ? "border-[#334155] text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#475569] cursor-pointer"
                                : "border-[#1E293B] text-[#334155] cursor-not-allowed opacity-40"
                          }`}
                        >
                          {statusUpdating === s.key && (
                            <svg className="animate-spin h-2.5 w-2.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                            </svg>
                          )}
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            {/* Right: customise + Save & Exit */}
            <div className="flex items-center gap-2">
              {activeTab === "property" && isCustomising && (
                <button
                  onClick={resetCardSizes}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#334155] text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#475569] hover:bg-[#1E293B] transition-colors"
                >
                  ↺ Reset
                </button>
              )}
              {activeTab === "property" && (
                <button
                  onClick={() => setIsCustomising(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    isCustomising
                      ? "border-[#00F0FF]/60 bg-[#00F0FF]/10 text-[#00F0FF]"
                      : "border-[#334155] text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#475569] hover:bg-[#1E293B]"
                  }`}
                >
                  {isCustomising ? "✓ Done" : "⊹ Customise"}
                </button>
              )}
              <button
                onClick={async () => {
                  if (currentCaseId) {
                    await saveCase(true);
                    doResetHome();
                  } else if (result) {
                    setPendingExitAfterSave(true);
                    setShowSaveDialog(true);
                  } else {
                    doResetHome();
                  }
                }}
                disabled={savingCase}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg border border-transparent transition-all disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 hover:shadow-[0_0_16px_#FF2D7866]"
                style={{
                  backgroundColor: '#FF2D78',
                  color: '#FFFFFF',
                  boxShadow: '0 0 10px #FF2D7833',
                }}
              >
                {savingCase ? (
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                )}
                {savingCase ? "Saving…" : "Save & Exit"}
              </button>
              {currentCaseId && (
                <button
                  onClick={() => {
                    if (!confirm("Are you sure you want to delete this case?")) return;
                    if (!confirm("This action cannot be undone. Delete permanently?")) return;
                    deleteCase(currentCaseId);
                    doResetHome();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all"
                  style={{
                    background: 'transparent',
                    color: '#FF3131',
                    borderColor: '#FF313166',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#FF313118';
                    e.currentTarget.style.borderColor = '#FF3131';
                    e.currentTarget.style.boxShadow = '0 0 12px #FF313144';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = '#FF313166';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                  </svg>
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* ── Tab 1: Property Information ─────────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "property" ? undefined : "none" }}>
            <div className="space-y-5">

            {/* Search bar — disabled while a case is loaded (Save & Exit to unlock) */}
            <form ref={searchFormRef2} onSubmit={handleSearch} className="flex gap-2 items-center">
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  onKeyDown={(e) => {
                    handleSuggestionKeyDown(e);
                    if (!manualMode && e.key === "Enter" && suggestionIdx < 0) e.preventDefault();
                  }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                  placeholder={currentCaseId ? "Save & Exit to search a new address" : (manualMode ? "e.g. 41 Gander Green Lane SM1 2EG" : "e.g. SM1 2EG")}
                  disabled={loading || !!currentCaseId}
                  className="w-full rounded-lg border border-[#334155] bg-[#1E293B] text-[#E2E8F0] placeholder:text-[#94A3B8]/50 px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#00F0FF] disabled:opacity-50"
                />
                {(showSuggestions || suggestionsLoading) && !manualMode && !currentCaseId && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#1E293B", border: "1px solid #334155", borderRadius: 8, maxHeight: 320, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                    {suggestionsLoading && <div style={{ padding: "10px 14px", fontSize: 12, color: "#94A3B8" }}>Loading addresses…</div>}
                    {!suggestionsLoading && suggestions.map((s, i) => (
                      <div key={i} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }} onMouseEnter={() => setSuggestionIdx(i)}
                        style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: i === suggestionIdx ? "#00F0FF" : "#E2E8F0", background: i === suggestionIdx ? "rgba(0,240,255,0.08)" : "transparent", borderBottom: "1px solid rgba(51,65,85,0.3)" }}>
                        {s.address}
                      </div>
                    ))}
                    {!suggestionsLoading && (
                      <div
                        onMouseDown={(e) => { e.preventDefault(); setManualMode(true); setShowSuggestions(false); }}
                        style={{ padding: "10px 14px", fontSize: 12, color: "#FFB800", cursor: "pointer", borderTop: "1px solid #334155", background: "rgba(255,184,0,0.05)" }}
                      >
                        Address not listed? Click here to type full address manually
                      </div>
                    )}
                  </div>
                )}
                {(showSuggestions || suggestionsLoading) && manualMode && suggestions.length > 0 && !currentCaseId && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#1E293B", border: "1px solid #334155", borderRadius: 8, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                    {suggestionsLoading && <div style={{ padding: "10px 14px", fontSize: 12, color: "#94A3B8" }}>Loading addresses…</div>}
                    {!suggestionsLoading && suggestions.map((s, i) => (
                      <div key={i} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }} onMouseEnter={() => setSuggestionIdx(i)}
                        style={{ padding: "9px 14px", fontSize: 13, cursor: "pointer", color: i === suggestionIdx ? "#00F0FF" : "#E2E8F0", background: i === suggestionIdx ? "rgba(0,240,255,0.08)" : "transparent", borderBottom: i < suggestions.length - 1 ? "1px solid rgba(51,65,85,0.5)" : "none" }}>
                        {s.address}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {manualMode && (
                <button
                  type="submit"
                  disabled={loading || !address.trim() || !!currentCaseId}
                  className="rounded-lg bg-[#00F0FF] text-[#0A0E1A] px-5 py-2.5 text-sm font-bold shadow-sm hover:bg-[#00D4E0] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Searching…" : "Search"}
                </button>
              )}
              {isAdmin && searchElapsed !== null && (
                <span className="text-xs font-mono text-[#94A3B8] whitespace-nowrap ml-2">{(searchElapsed / 1000).toFixed(1)}s</span>
              )}
            </form>
            {manualMode && !currentCaseId && (
              <button
                onClick={() => { setManualMode(false); setAddress(""); setSuggestions([]); setShowSuggestions(false); }}
                className="text-xs text-[#94A3B8] hover:text-[#00F0FF] transition-colors mt-1 cursor-pointer"
              >
                ← Back to postcode lookup
              </button>
            )}

            {loading && (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#00F0FF] border-t-transparent" />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-[#FF3131]/40 bg-[#FF3131]/10 px-4 py-3 text-sm text-[#FF3131]">
                {error}
              </div>
            )}

            {/* ── Enrichment degraded notice ── */}
            {enrichSlowError && (
              <div className="flex items-start gap-3 rounded-lg border border-[#FFB800]/40 bg-[#FFB800]/10 px-4 py-3 text-sm mb-2">
                <span className="text-[#FFB800] text-base leading-none mt-0.5">⚠</span>
                <span className="text-[#FFB800]">Some background data (council tax, flood zones) could not be loaded. These fields may show as unavailable.</span>
              </div>
            )}

            {/* ── No-EPC notice ── */}
            {!result.epc_matched && (
              <div className="flex items-start gap-3 rounded-lg border border-[#FFB800]/40 bg-[#FFB800]/10 px-4 py-3 text-sm">
                <span className="text-[#FFB800] text-base leading-none mt-0.5">⚠</span>
                <div>
                  <span className="font-semibold text-[#FFB800]">No EPC record found for this property.</span>
                  <span className="text-[#94A3B8] ml-1">Energy certificate data is unavailable. All planning, flood, and environmental data are still shown.</span>
                </div>
              </div>
            )}

            {/* ── Resizable card grid ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridAutoRows: "minmax(120px, auto)", gridAutoFlow: "dense", gap: 16 }}>

            {/* EPC card */}
            <PropCard id="epc" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#334155]/60">
                <div>
                  <p className="text-xs text-[#94A3B8]/70 mb-0.5">Matched address</p>
                  <p className="font-semibold text-[#E2E8F0]">{result.address}</p>
                  {result.uprn && (
                    <p className="text-xs text-[#94A3B8]/70 mt-0.5">UPRN: {result.uprn}</p>
                  )}
                  {result.coord_source && (
                    <p className="text-xs text-[#94A3B8]/70 mt-0.5">
                      Coords via {result.coord_source}
                    </p>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-px bg-[#334155]/40">
                {epcFields.map(([label, value]) => {
                  const isEmpty = value === null || value === undefined || value === "";
                  return (
                    <div key={label} className="bg-[#111827] px-4 py-3">
                      <dt className="text-xs text-[#94A3B8]/70">{label}</dt>
                      <dd className="mt-0.5 text-sm font-medium flex items-center gap-2">
                        {isEmpty ? (
                          <span className="text-[#475569] font-normal">Data Not Available</span>
                        ) : (
                          <span className="text-[#E2E8F0]">{String(value)}</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
                {/* Council tax band — left cell */}
                {(() => {
                  const CT_COLORS: Record<string, { bg: string; dark: boolean }> = {
                    A: { bg: "#008054", dark: false },
                    B: { bg: "#19b459", dark: false },
                    C: { bg: "#8dce46", dark: true  },
                    D: { bg: "#ffd500", dark: true  },
                    E: { bg: "#fcaa65", dark: true  },
                    F: { bg: "#ef8023", dark: false },
                    G: { bg: "#e9153b", dark: false },
                    H: { bg: "#c0392b", dark: false },
                  };
                  const ctBand = result.council_tax_band?.toUpperCase();
                  const ctColors = ctBand ? (CT_COLORS[ctBand] ?? { bg: "#9ca3af", dark: false }) : null;
                  return (
                    <div className="bg-[#111827] px-4 py-3">
                      <dt className="text-xs text-[#94A3B8]/70 mb-1.5">Council tax band</dt>
                      <dd>
                        {ctBand && ctColors ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "6px",
                            padding: "3px 10px 3px 4px", borderRadius: "999px",
                            border: `1.5px solid ${ctColors.bg}`, backgroundColor: `${ctColors.bg}1a`,
                          }}>
                            <span style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              width: "24px", height: "24px", borderRadius: "50%",
                              backgroundColor: ctColors.bg, color: ctColors.dark ? "#1a1a1a" : "#ffffff",
                              fontWeight: 700, fontSize: "13px",
                            }}>{ctBand}</span>
                            <span style={{ fontSize: "13px", fontWeight: 600, color: "#E2E8F0" }}>Band {ctBand}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[#94A3B8]">{enrichSlowDone ? "Unavailable" : <span className="animate-pulse">Loading…</span>}</span>
                        )}
                      </dd>
                    </div>
                  );
                })()}
                {/* Energy score — right cell */}
                {(() => {
                  const epcScore = result.energy_score != null ? Number(result.energy_score) : null;
                  const EPC_COLORS = [
                    { band: "A", min: 92, color: "#008054", dark: false },
                    { band: "B", min: 81, color: "#19b459", dark: false },
                    { band: "C", min: 69, color: "#8dce46", dark: true  },
                    { band: "D", min: 55, color: "#ffd500", dark: true  },
                    { band: "E", min: 39, color: "#fcaa65", dark: true  },
                    { band: "F", min: 21, color: "#ef8023", dark: false },
                    { band: "G", min: 1,  color: "#e9153b", dark: false },
                  ];
                  const epcConfig = epcScore != null
                    ? (EPC_COLORS.find(b => epcScore >= b.min) ?? EPC_COLORS[EPC_COLORS.length - 1])
                    : null;
                  return (
                    <div className="bg-[#111827] px-4 py-3">
                      <dt className="text-xs text-[#94A3B8]/70 mb-1.5">Energy score</dt>
                      <dd>
                        {epcConfig && epcScore != null ? (
                          result.epc_url ? (
                            <span className="inline-flex items-center gap-2">
                              <a href={result.epc_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                                <span style={{
                                  display: "inline-flex", alignItems: "center", gap: "6px",
                                  padding: "3px 10px 3px 4px", borderRadius: "999px",
                                  border: `1.5px solid ${epcConfig.color}`, backgroundColor: `${epcConfig.color}1a`,
                                  cursor: "pointer",
                                }}>
                                  <span style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: "24px", height: "24px", borderRadius: "50%",
                                    backgroundColor: epcConfig.color, color: epcConfig.dark ? "#1a1a1a" : "#ffffff",
                                    fontWeight: 700, fontSize: "13px",
                                  }}>{epcConfig.band}</span>
                                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#E2E8F0" }}>{epcScore}</span>
                                  <span style={{ fontSize: "10px", fontWeight: 500, color: "#94A3B8" }}>View certificate ↗</span>
                                </span>
                              </a>
                              <button
                                onClick={() => downloadEpc(result.epc_url!)}
                                className="inline-flex items-center gap-1 text-[10px] text-[#94A3B8] hover:text-[#00F0FF] transition-colors"
                                title="Save EPC as PDF"
                              >
                                📄 Save as PDF
                              </button>
                            </span>
                          ) : (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: "6px",
                              padding: "3px 10px 3px 4px", borderRadius: "999px",
                              border: `1.5px solid ${epcConfig.color}`, backgroundColor: `${epcConfig.color}1a`,
                            }}>
                              <span style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: "24px", height: "24px", borderRadius: "50%",
                                backgroundColor: epcConfig.color, color: epcConfig.dark ? "#1a1a1a" : "#ffffff",
                                fontWeight: 700, fontSize: "13px",
                              }}>{epcConfig.band}</span>
                              <span style={{ fontSize: "13px", fontWeight: 600, color: "#E2E8F0" }}>{epcScore}</span>
                            </span>
                          )
                        ) : (
                          <span className="text-[#475569] font-normal text-sm">Data Not Available</span>
                        )}
                      </dd>
                    </div>
                  );
                })()}
              </dl>
            </div>
            </PropCard>

            {/* Tenure card */}
            {result.tenure && (
            <PropCard id="tenure" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
              <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
                <div className="px-6 py-4 border-b border-[#334155]/60">
                  <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Tenure</h2>
                  <p className="text-xs text-[#94A3B8]/70 mt-0.5">HM Land Registry Price Paid Data</p>
                </div>
                <div className="px-6 py-5 space-y-4">
                  {/* Badge */}
                  <div className="flex items-center gap-3">
                    {result.tenure === "Freehold" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#39FF14]/15 px-3 py-1.5 text-sm font-semibold text-[#39FF14]">
                        <span className="h-2 w-2 rounded-full bg-[#39FF14]" />
                        Freehold
                      </span>
                    )}
                    {result.tenure === "Leasehold" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFB800]/15 px-3 py-1.5 text-sm font-semibold text-[#FFB800]">
                        <span className="h-2 w-2 rounded-full bg-[#FFB800]" />
                        Leasehold
                      </span>
                    )}
                    {result.tenure !== "Freehold" && result.tenure !== "Leasehold" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#334155] px-3 py-1.5 text-sm font-semibold text-[#E2E8F0]">
                        {result.tenure}
                      </span>
                    )}
                  </div>

                  {/* Definition */}
                  <p className="text-sm text-[#94A3B8]">
                    {result.tenure === "Freehold" && "The owner holds both the property and the land outright with no time limit. No ground rent or service charges payable to a landlord."}
                    {result.tenure === "Leasehold" && "The owner holds the property for a fixed term under a lease from a freeholder (landlord). Subject to ground rent, service charges, and lease terms."}
                  </p>

                  {/* Lease details */}
                  {result.tenure === "Leasehold" && (
                    <div>
                      {(result.lease_commencement && result.lease_expiry_date) ? (() => {
                        const start = new Date(result.lease_commencement);
                        const expiry = new Date(result.lease_expiry_date!);
                        const today = new Date();
                        const totalTerm = yearsMonths(start, expiry);
                        const remaining = yearsMonths(today, expiry);
                        const remYears = expiry.getFullYear() - today.getFullYear() - (
                          (expiry.getMonth() < today.getMonth() || (expiry.getMonth() === today.getMonth() && expiry.getDate() < today.getDate())) ? 1 : 0
                        );
                        const remColour = remYears < 80 ? "text-[#FF3131]" : remYears < 100 ? "text-[#FFB800]" : "text-[#39FF14]";
                        return (
                          <>
                            <dl className="grid grid-cols-2 gap-px bg-[#334155]/40 rounded-lg overflow-hidden">
                              <div className="bg-[#111827] px-4 py-3">
                                <dt className="text-xs text-[#94A3B8]">Commencement</dt>
                                <dd className="mt-1 text-sm font-medium text-[#E2E8F0]">{fmtDate(result.lease_commencement)}</dd>
                              </div>
                              <div className="bg-[#111827] px-4 py-3">
                                <dt className="text-xs text-[#94A3B8]">Expiry</dt>
                                <dd className="mt-1 text-sm font-medium text-[#E2E8F0]">{fmtDate(result.lease_expiry_date!)}</dd>
                              </div>
                              <div className="bg-[#111827] px-4 py-3">
                                <dt className="text-xs text-[#94A3B8]">Total term</dt>
                                <dd className="mt-1 text-sm font-medium text-[#E2E8F0]">{totalTerm}</dd>
                              </div>
                              <div className="bg-[#111827] px-4 py-3">
                                <dt className="text-xs text-[#94A3B8]">Remaining</dt>
                                <dd className={`mt-1 text-sm font-semibold ${remColour}`}>{remaining}</dd>
                              </div>
                            </dl>
                            {remYears < 80 && (
                              <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#FF3131]/10 border border-[#FF3131]/30 px-4 py-3">
                                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#FF3131]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                </svg>
                                <p className="text-xs text-[#FF3131]">
                                  <strong>Mortgage risk:</strong> Fewer than 80 years remaining. Most lenders require at least 85 years to grant a mortgage. A lease extension should be considered.
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })() : (
                        <p className="text-xs text-[#94A3B8]/70 italic">Lease term details not yet available · extended data coming soon</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </PropCard>
            )}

            {/* Sales history card */}
            <PropCard id="sales" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
              <div className="px-6 py-4 border-b border-[#334155]/60">
                <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Sale History</h2>
                <p className="text-xs text-[#94A3B8]/70 mt-0.5">Land Registry Price Paid Data</p>
              </div>

              {(result.sales ?? []).length === 0 ? (
                <p className="px-6 py-4 text-sm text-[#94A3B8]">
                  No Land Registry transactions found
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#1E293B] text-xs text-[#94A3B8] uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">Date</th>
                        <th className="px-4 py-2.5 text-right font-medium">Price</th>
                        <th className="px-4 py-2.5 text-left font-medium">Tenure</th>
                        <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#334155]/60">
                      {(result.sales ?? []).map((sale, i) => (
                        <tr key={i} className="hover:bg-[#1E293B]">
                          <td className="px-4 py-3 text-[#94A3B8] tabular-nums">{sale.date}</td>
                          <td className="px-4 py-3 text-right font-bold text-[#00F0FF] tabular-nums">
                            {formatPrice(sale.price)}
                          </td>
                          <td className="px-4 py-3 text-[#94A3B8]">{sale.tenure}</td>
                          <td className="px-4 py-3 text-[#94A3B8]">
                            {sale.property_type}
                            {sale.new_build && (
                              <span className="ml-1.5 inline-block rounded bg-[#7B2FBE]/20 px-1.5 py-0.5 text-xs font-medium text-[#818CF8]">
                                New build
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </PropCard>

            {/* Flood Risk card */}
            <PropCard id="flood" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
              <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
                <div className="px-6 py-4 border-b border-[#334155]/60">
                  <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Flood Risk</h2>
                  <p className="text-xs text-[#94A3B8]/70 mt-0.5">Environment Agency data</p>
                </div>

                {/* Row 1: NaFRA2 assessed risk (with defences) */}
                <div className="border-b border-[#334155]/60">
                  <div className="px-6 py-2 bg-[#1E293B]">
                    <p className="text-xs font-medium text-[#94A3B8]">Assessed risk — NaFRA2 Jan 2025</p>
                    <p className="text-xs text-[#94A3B8]/70">Modelled probability including flood defences · insurance context</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-px bg-[#334155]/40">
                    <div className="bg-[#111827] px-4 py-3">
                      <dt className="text-xs text-[#94A3B8]/70">Rivers &amp; Sea</dt>
                      <dd className="mt-1">
                        {result.rivers_sea_risk ? (
                          <span className={`inline-block rounded-md px-2.5 py-1 text-sm font-semibold ${FLOOD_STYLE[result.rivers_sea_risk] ?? "bg-[#334155] text-[#E2E8F0]"}`}>
                            {result.rivers_sea_risk}
                          </span>
                        ) : (
                          <span className="text-sm text-[#94A3B8]/70">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="bg-[#111827] px-4 py-3">
                      <dt className="text-xs text-[#94A3B8]/70">Surface Water</dt>
                      <dd className="mt-1">
                        {result.surface_water_risk ? (
                          <span className={`inline-block rounded-md px-2.5 py-1 text-sm font-semibold ${FLOOD_STYLE[result.surface_water_risk] ?? "bg-[#334155] text-[#E2E8F0]"}`}>
                            {result.surface_water_risk}
                          </span>
                        ) : (
                          <span className="text-sm text-[#94A3B8]/70">—</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Row 2: Statutory planning flood zone (without defences) */}
                {!result.planning_flood_zone && (
                  <div className="px-4 py-3">
                    <dt className="text-xs text-[#94A3B8]/70 mb-1">NPPF Flood Zone</dt>
                    <dd className="text-xs text-[#94A3B8] animate-pulse">Loading…</dd>
                  </div>
                )}
                {result.planning_flood_zone && (
                  <div>
                    <div className="px-6 py-2 bg-[#1E293B]">
                      <p className="text-xs font-medium text-[#94A3B8]">Statutory planning flood zone</p>
                      <p className="text-xs text-[#94A3B8]/70">Undefended flood extent · mortgage lenders · planning policy</p>
                    </div>
                    <dl className="px-4 py-3">
                      <dt className="text-xs text-[#94A3B8]/70 mb-1">NPPF Flood Zone</dt>
                      <dd>
                        <span className={`inline-block rounded-md px-2.5 py-1 text-sm font-semibold ${
                          result.planning_flood_zone === "Zone 1" ? "bg-[#39FF14]/10 text-[#39FF14]" :
                          result.planning_flood_zone === "Zone 2" ? "bg-[#FFB800]/10 text-[#FFB800]" :
                          "bg-[#FF3131]/10 text-[#FF3131]"
                        }`}>
                          {result.planning_flood_zone}
                        </span>
                        <span className="ml-2 text-xs text-[#94A3B8]/70">
                          {result.planning_flood_zone === "Zone 1" && "Low probability (<0.1% annual)"}
                          {result.planning_flood_zone === "Zone 2" && "Medium probability (0.1–1% annual)"}
                          {result.planning_flood_zone === "Zone 3" && "High probability (>1% annual)"}
                        </span>
                      </dd>
                    </dl>
                  </div>
                )}

                <div className="px-6 py-3 bg-[#FFB800]/8 border-t border-[#FFB800]/20">
                  <p className="text-xs text-[#FFB800]">
                    NaFRA2 includes flood defence modelling but not manual EA overrides for exceptional schemes (e.g. Thames Barrier).
                    The{" "}
                    <a
                      href="https://check-long-term-flood-risk.service.gov.uk"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-[#FFB800]/80"
                    >
                      GOV.UK flood risk checker
                    </a>
                    {" "}may show lower risk for well-defended riverside areas.
                  </p>
                </div>
              </div>
            </PropCard>


            {/* Conservation Areas + Natural England card */}
            <PropCard id="conservation" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
              {/* Conservation Area section */}
              <div className="px-6 py-4 border-b border-[#334155]/60">
                <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Conservation Area</h2>
                <p className="text-xs text-[#94A3B8]/70 mt-0.5">Planning Data — Historic England designation</p>
                <p className="text-xs text-[#FFB800]/60 mt-1">⚠ planning.data.gov.uk coverage: ~135/340 councils (40%). Verify with local authority.</p>
              </div>
              {(result.conservation_areas ?? []).length === 0 ? (
                <div className="flex items-center gap-2 px-6 py-4">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/70 shrink-0" />
                  <p className="text-sm text-[#94A3B8]">Not within a conservation area</p>
                </div>
              ) : (
                <ul className="divide-y divide-[#334155]/60">
                  {(result.conservation_areas ?? []).map((ca) => (
                    <li key={ca.reference || ca.name} className="px-6 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#FFB800] shrink-0 mt-0.5" />
                            <span className="text-sm font-semibold text-[#E2E8F0]">{ca.name}</span>
                          </div>
                          {ca.designation_date && (
                            <p className="text-xs text-[#94A3B8]/70 mt-1 ml-4">
                              Designated {ca.designation_date.slice(0, 4)}
                            </p>
                          )}
                        </div>
                        {ca.documentation_url && (
                          <a
                            href={ca.documentation_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-xs text-[#00F0FF] hover:underline whitespace-nowrap"
                          >
                            Appraisal →
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Natural England designations section */}
              <div className="border-t border-[#334155]">
                <div className="px-6 py-3 bg-[#1E293B] border-b border-[#334155]/60">
                  <h3 className="text-sm font-semibold text-[#E2E8F0]">Natural Environment</h3>
                  <p className="text-xs text-[#94A3B8]/70 mt-0.5">Natural England — statutory designations</p>
                </div>

                {/* AONB */}
                <div className="flex items-start gap-3 px-6 py-3 border-b border-[#334155]/60">
                  <div className="flex-1">
                    <p className="text-xs text-[#94A3B8]/70 mb-1">National Landscape (AONB)</p>
                    {result.aonb ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14] shrink-0" />
                        <span className="text-sm font-semibold text-[#E2E8F0]">{result.aonb}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/50 shrink-0" />
                        <span className="text-sm text-[#94A3B8]">Not within an AONB</span>
                      </div>
                    )}
                  </div>

                  {/* Green Belt */}
                  <div className="flex-1">
                    <p className="text-xs text-[#94A3B8]/70 mb-1">Green Belt</p>
                    {result.green_belt ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14] shrink-0" />
                        <span className="text-sm font-semibold text-[#E2E8F0]">Within Green Belt</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/50 shrink-0" />
                        <span className="text-sm text-[#94A3B8]">Not in Green Belt</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Radon */}
                <div className="flex items-start gap-3 px-6 py-3 border-t border-[#334155]/60">
                  <div className="flex-1">
                    <p className="text-xs text-[#94A3B8]/70 mb-1">Radon Risk</p>
                    {(() => {
                      const RADON_STYLE: Record<string, { dot: string; text: string; label: string }> = {
                        "Lower":             { dot: "bg-[#39FF14]/70",  text: "text-[#94A3B8]",   label: "Lower (<1%)" },
                        "Intermediate":      { dot: "bg-[#FFB800]/70", text: "text-[#94A3B8]",   label: "Intermediate (1–3%)" },
                        "Intermediate-High": { dot: "bg-[#FFB800]",    text: "text-[#FFB800]",   label: "Intermediate-High (3–10%)" },
                        "High":              { dot: "bg-[#FF8C00]",    text: "text-[#FF8C00]",   label: "High (10–30%)" },
                        "Very High":         { dot: "bg-[#FF3131]",    text: "text-[#FF3131]",   label: "Very High (>30%)" },
                      };
                      const s = result.radon_risk ? RADON_STYLE[result.radon_risk] : null;
                      return s ? (
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                          <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[#475569] shrink-0" />
                          <span className="text-sm text-[#94A3B8]/70">Data not available</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* SSSI */}
                <div className="px-6 py-3 border-b border-[#334155]/60">
                  <p className="text-xs text-[#94A3B8]/70 mb-1.5">SSSI within 2 km</p>
                  {(result.sssi ?? []).length === 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/50 shrink-0" />
                      <span className="text-sm text-[#94A3B8]">No SSSIs within 2 km</span>
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {(result.sssi ?? []).map((name) => (
                        <li key={name} className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[#00F0FF] shrink-0" />
                          <span className="text-sm text-[#E2E8F0]">{name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Ancient Woodland */}
                <div className="px-6 py-3">
                  <p className="text-xs text-[#94A3B8]/70 mb-1.5">Ancient Woodland within 50 m</p>
                  {(result.ancient_woodland ?? []).length === 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/50 shrink-0" />
                      <span className="text-sm text-[#94A3B8]">No ancient woodland within 50 m</span>
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {(result.ancient_woodland ?? []).map((aw) => (
                        <li key={aw.name} className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14] shrink-0" />
                          <span className="text-sm text-[#E2E8F0]">{aw.name}</span>
                          <span className="text-xs text-[#94A3B8]/70">
                            {aw.type === "ASNW" ? "Ancient Semi-Natural" : aw.type === "PAWS" ? "Replanted Ancient" : aw.type}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            </PropCard>

            {/* Coal Mining Risk + Brownfield Land card */}
            <PropCard id="coal" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">

              {/* Coal Mining section */}
              <div className="px-6 py-4 border-b border-[#334155]/60">
                <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Coal Mining Risk</h2>
                <p className="text-xs text-[#94A3B8]/70 mt-0.5">Mining Remediation Authority</p>
              </div>
              <div className="flex items-start gap-3 px-6 py-3 border-b border-[#334155]/60">
                <div className="flex-1">
                  <p className="text-xs text-[#94A3B8]/70 mb-1">Development High Risk Area</p>
                  {result.coal_mining_high_risk ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#FF3131] shrink-0" />
                      <span className="text-sm font-semibold text-[#FF3131]">Within High Risk Area</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/70 shrink-0" />
                      <span className="text-sm text-[#94A3B8]">Not in High Risk Area</span>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-[#94A3B8]/70 mb-1">Coalfield</p>
                  {result.coal_mining_in_coalfield ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#FFB800] shrink-0" />
                      <span className="text-sm font-semibold text-[#E2E8F0]">Within Coalfield</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/70 shrink-0" />
                      <span className="text-sm text-[#94A3B8]">Not in coalfield</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Listed Buildings section */}
              <div className="px-6 py-3 bg-[#1E293B] border-b border-[#334155]/60">
                <h3 className="text-xs font-orbitron text-[#00F0FF] tracking-[3px] uppercase">Listed Buildings</h3>
                <p className="text-xs text-[#94A3B8]/70 mt-0.5">Historic England NHLE — within 50 m</p>
                <p className="text-xs text-[#FFB800]/60 mt-1">⚠ planning.data.gov.uk outlines: 74 providers, partial coverage. NHLE point data is authoritative.</p>
              </div>
              {(result.listed_buildings ?? []).length === 0 ? (
                <div className="flex items-center gap-2 px-6 py-3 border-b border-[#334155]/60">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/70 shrink-0" />
                  <p className="text-sm text-[#94A3B8]">No listed buildings within 50 m</p>
                </div>
              ) : (
                <ul className="divide-y divide-[#334155]/60 border-b border-[#334155]/60">
                  {(result.listed_buildings ?? []).map((lb) => (
                    <li key={lb.list_entry ?? lb.name} className="flex items-start gap-3 px-6 py-3">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${GRADE_STYLE[lb.grade] ?? "bg-[#334155] text-[#E2E8F0]"}`}>
                        {lb.grade}
                      </span>
                      <div className="min-w-0">
                        {lb.url ? (
                          <a href={lb.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[#00F0FF] hover:underline">
                            {lb.name}
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-[#E2E8F0]">{lb.name}</span>
                        )}
                        {lb.list_entry && <p className="text-xs text-[#94A3B8]/70 mt-0.5">List entry {lb.list_entry}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Brownfield section */}
              <div className="px-6 py-3 bg-[#1E293B] border-b border-[#334155]/60">
                <h3 className="text-xs font-orbitron text-[#00F0FF] tracking-[3px] uppercase">Brownfield Land</h3>
                <p className="text-xs text-[#94A3B8]/70 mt-0.5">Previously developed land within 100 m — Planning Data</p>
              </div>
              {(result.brownfield ?? []).length === 0 ? (
                <div className="flex items-center gap-2 px-6 py-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/70 shrink-0" />
                  <p className="text-sm text-[#94A3B8]">No brownfield sites within 100 m</p>
                </div>
              ) : (
                <ul className="divide-y divide-[#334155]/60">
                  {(result.brownfield ?? []).map((site, i) => (
                    <li key={i} className="px-6 py-3">
                      <div className="flex items-start gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#FFB800] shrink-0 mt-1.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#E2E8F0] leading-snug">{site.name}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                            {site.hectares && <span className="text-xs text-[#94A3B8]">{site.hectares} ha</span>}
                            {site.planning_status && (
                              <span className="text-xs text-[#94A3B8] capitalize">{site.planning_status.replace(/-/g, " ")}</span>
                            )}
                            {site.planning_date && (
                              <span className="text-xs text-[#94A3B8]">Permission {site.planning_date.slice(0, 4)}</span>
                            )}
                            {site.hazardous_substances && (
                              <span className="text-xs font-medium text-[#FF3131]">Hazardous substances</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </PropCard>

            {/* Ground Conditions card */}
            <PropCard id="ground" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            {(() => {
              const GS_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
                "Low":        { dot: "bg-[#39FF14]/70", text: "text-[#39FF14]", bg: "bg-[#39FF14]/10" },
                "Moderate":   { dot: "bg-[#FFB800]",    text: "text-[#FFB800]", bg: "bg-[#FFB800]/10" },
                "Significant":{ dot: "bg-[#FF3131]",    text: "text-[#FF3131]", bg: "bg-[#FF3131]/10" },
              };
              const badge = (val: string | null) => {
                const s = val ? GS_STYLE[val] : null;
                return s ? (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                    {val}
                  </span>
                ) : (
                  <span className="text-sm text-[#475569]">—</span>
                );
              };
              const HAZARDS: { label: string; val: string | null; definition: string }[] = [
                {
                  label: "Shrink-swell clay",
                  val: result.ground_shrink_swell,
                  definition: "Clay soils expand when wet and shrink when dry. Seasonal moisture changes cause ground movement that can crack foundations, walls and drainage — the single largest cause of subsidence damage to UK buildings.",
                },
                {
                  label: "Landslides",
                  val: result.ground_landslides,
                  definition: "Susceptibility to slope instability and mass ground movement, including rotational slips and shallow translational slides. Relevant on sloped ground or near steep cuttings.",
                },
                {
                  label: "Compressible ground",
                  val: result.ground_compressible,
                  definition: "Soft, organic-rich deposits such as peat or soft alluvium that compress slowly under structural load, causing long-term settlement and differential movement.",
                },
                {
                  label: "Collapsible deposits",
                  val: result.ground_collapsible,
                  definition: "Loose soils with a fragile open structure (e.g. loess, made ground) that can rapidly consolidate when wetted, producing sudden uneven settlement.",
                },
                {
                  label: "Running sand",
                  val: result.ground_running_sand,
                  definition: "Saturated granular soils that flow like a liquid when disturbed or excavated. Poses a hazard during foundation excavation, piling or basement construction.",
                },
                {
                  label: "Soluble rocks",
                  val: result.ground_soluble_rocks,
                  definition: "Limestone, chalk or gypsum that slowly dissolves in groundwater, forming underground cavities and sinkholes. Subsidence can occur without warning above cavities.",
                },
              ];
              return (
                <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
                  <div className="px-6 py-4 border-b border-[#334155]/60">
                    <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Ground Conditions</h2>
                    <p className="text-xs text-[#94A3B8]/70 mt-0.5">BGS GeoSure — geological hazard susceptibility</p>
                  </div>

                  {/* Risk level legend */}
                  <div className="px-6 py-3 bg-[#1E293B] border-b border-[#334155]/60">
                    <p className="text-xs font-medium text-[#94A3B8] mb-2">Susceptibility levels</p>
                    <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                      {(["Low", "Moderate", "Significant"] as const).map((lvl) => {
                        const desc: Record<string, string> = {
                          Low: "Negligible — standard building practice adequate",
                          Moderate: "Some susceptibility — targeted investigation recommended",
                          Significant: "High susceptibility — specialist ground investigation required",
                        };
                        const s = GS_STYLE[lvl];
                        return (
                          <div key={lvl} className="flex items-center gap-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                            <span className="text-xs text-[#94A3B8]">
                              <span className="font-semibold">{lvl}</span>
                              {" — "}
                              {desc[lvl]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Hazard rows */}
                  <dl className="divide-y divide-[#334155]/60">
                    {HAZARDS.map(({ label, val, definition }) => (
                      <div key={label} className="flex items-start justify-between gap-6 px-6 py-4">
                        <div className="flex-1 min-w-0">
                          <dt className="text-sm font-medium text-[#E2E8F0]">{label}</dt>
                          <dd className="text-xs text-[#94A3B8]/70 mt-1 leading-relaxed">{definition}</dd>
                        </div>
                        <div className="shrink-0 pt-0.5">{badge(val)}</div>
                      </div>
                    ))}
                  </dl>

                  {/* Footer disclaimer */}
                  <div className="px-6 py-3 bg-[#1E293B] border-t border-[#334155]/60">
                    <p className="text-xs text-[#94A3B8]/70 leading-relaxed">
                      <span className="font-medium text-[#94A3B8]">Important:</span>{" "}
                      BGS GeoSure data is a 5 km regional susceptibility indicator derived from underlying geology. It reflects the potential for ground hazards based on rock and soil type — not actual conditions at this specific property. These ratings do not replace a site-specific ground investigation report, which is essential before any development, structural alteration or foundation design.
                    </p>
                  </div>
                </div>
              );
            })()}
            </PropCard>

            {/* Nearby Planning Applications card */}
            <PropCard id="planning" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full flex flex-col">
              <div className="px-6 py-4 border-b border-[#334155]/60">
                <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Nearby Planning Applications</h2>
                <p className="text-xs text-[#94A3B8]/70 mt-0.5">GLA Planning London Datahub — within 500 m</p>
              </div>
              {result.nearby_planning_london_only && result.region !== "London" ? (
                <div className="flex items-center gap-2 px-6 py-4">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#67E8F9] shrink-0" />
                  <p className="text-sm text-[#94A3B8]">Planning application data available for London properties only</p>
                </div>
              ) : (result.nearby_planning ?? []).length === 0 ? (
                <div className="flex items-center gap-2 px-6 py-4">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#39FF14]/70 shrink-0" />
                  <p className="text-sm text-[#94A3B8]">No recent applications within 500 m</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto max-h-[420px]">
                  <ul className="divide-y divide-[#334155]/60">
                    {(result.nearby_planning ?? []).map((app, i) => {
                      const ds = planningDecisionStyle(app.decision);
                      const desc = app.description
                        ? app.description.length > 120 ? app.description.slice(0, 120) + "…" : app.description
                        : "No description";
                      const decDate = app.decision_date
                        ? (() => {
                            const parts = app.decision_date.split("/");
                            if (parts.length === 3) {
                              const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                              const mIdx = parseInt(parts[1], 10) - 1;
                              return `${months[mIdx] ?? parts[1]} ${parts[2]}`;
                            }
                            return app.decision_date;
                          })()
                        : null;
                      return (
                        <li key={app.lpa_app_no || i} className="px-6 py-3 hover:bg-[#1E293B]/50 transition-colors">
                          <div className="flex items-start gap-3">
                            <span className={`shrink-0 mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ds.bg} ${ds.text}`}>
                              {app.decision ?? "Pending"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-[#E2E8F0] leading-snug">{desc}</p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                                {app.street_name && (
                                  <span className="text-xs text-[#94A3B8]">{app.street_name}</span>
                                )}
                                {app.distance_m != null && (
                                  <span className="text-xs text-[#94A3B8]/60">{app.distance_m} m</span>
                                )}
                                {decDate && (
                                  <span className="text-xs text-[#94A3B8]/60">{decDate}</span>
                                )}
                                {app.application_type && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#334155]/60 text-[#94A3B8]/80">{app.application_type}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            </PropCard>

            {/* Asbestos Risk card */}
            <PropCard id="asbestos" isCustomising={isCustomising} cardSizes={cardSizes} onSizeChange={handleCardSizeChange}>
            {(() => {
              const band = result.construction_age_band;

              // Parse start year from EPC age band string
              let startYear: number | null = null;
              if (band) {
                if (band.toLowerCase().startsWith("before")) {
                  startYear = 1899;
                } else {
                  const m = band.match(/^(\d{4})/);
                  if (m) startYear = parseInt(m[1]);
                }
              }

              type AsbestosRisk = "High" | "Moderate" | "Low";
              let risk: AsbestosRisk | null = null;
              if (startYear !== null) {
                if (startYear < 1983)       risk = "High";
                else if (startYear < 2000)  risk = "Moderate";
                else                        risk = "Low";
              }

              const RISK_CONFIG: Record<AsbestosRisk, { dot: string; pill: string; definition: string }> = {
                High: {
                  dot:  "bg-[#FF3131]",
                  pill: "bg-[#FF3131]/10 text-[#FF3131]",
                  definition:
                    "Built during peak asbestos use. Blue (crocidolite), brown (amosite) and white (chrysotile) asbestos were all in widespread use. A professional Asbestos Management Survey (HSG264) is strongly recommended before any renovation, structural or intrusive work.",
                },
                Moderate: {
                  dot:  "bg-[#FFB800]",
                  pill: "bg-[#FFB800]/10 text-[#FFB800]",
                  definition:
                    "Built partly within the asbestos era. Blue and brown asbestos were banned in 1985, but white asbestos remained legal until November 1999. An Asbestos Management Survey is advised before any intrusive works.",
                },
                Low: {
                  dot:  "bg-[#39FF14]/70",
                  pill: "bg-[#39FF14]/10 text-[#39FF14]",
                  definition:
                    "Built after the November 1999 total UK asbestos ban. Asbestos is unlikely to be present unless earlier materials were retained or reused during a subsequent refurbishment.",
                },
              };

              const cfg = risk ? RISK_CONFIG[risk] : null;

              return (
                <div className="rounded-xl border border-[#334155] bg-[#111827] shadow-lg shadow-black/30 overflow-hidden h-full">
                  <div className="px-6 py-4 border-b border-[#334155]/60">
                    <h2 className="font-orbitron text-[#00F0FF] text-[11px] tracking-[3px] uppercase">Asbestos Risk</h2>
                    <p className="text-xs text-[#94A3B8]/70 mt-0.5">Age-based indicator — HSE precautionary approach</p>
                  </div>

                  <div className="px-6 py-4">
                    {/* Risk badge + construction date */}
                    <div className="flex flex-wrap items-center gap-4 mb-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${cfg ? cfg.pill : "bg-[#FFB800]/10 text-[#FFB800]"}`}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${cfg ? cfg.dot : "bg-[#FFB800]"}`} />
                        {risk ? `${risk} Risk` : "Unknown — survey advised"}
                      </span>
                      {band && (
                        <span className="text-sm text-[#94A3B8]">
                          Construction: <span className="font-medium text-[#E2E8F0]">{band}</span>
                        </span>
                      )}
                    </div>

                    {/* Definition */}
                    <p className="text-sm text-[#94A3B8] leading-relaxed">
                      {cfg
                        ? cfg.definition
                        : "Build date not recorded in EPC. As a precaution, treat the property as potentially containing asbestos and commission an Asbestos Management Survey before any renovation work."}
                    </p>

                    {/* Key ban date reference tiles */}
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-[#1E293B] px-3 py-2.5">
                        <p className="text-xs font-medium text-[#94A3B8] mb-0.5">1985 — Phase 1 ban</p>
                        <p className="text-xs text-[#94A3B8]/70">Blue &amp; brown asbestos prohibited</p>
                      </div>
                      <div className="rounded-lg bg-[#1E293B] px-3 py-2.5">
                        <p className="text-xs font-medium text-[#94A3B8] mb-0.5">1999 — Full ban</p>
                        <p className="text-xs text-[#94A3B8]/70">All asbestos types prohibited in UK</p>
                      </div>
                    </div>
                  </div>

                  {/* Footer disclaimer */}
                  <div className="px-6 py-3 bg-[#1E293B] border-t border-[#334155]/60">
                    <p className="text-xs text-[#94A3B8]/70 leading-relaxed">
                      <span className="font-medium text-[#94A3B8]">Important:</span>{" "}
                      This is an age-based indicator only. No public database of property-level asbestos surveys exists in the UK. Only a UKAS-accredited Asbestos Management Survey (HSG264) can confirm presence or absence. HSE guidance states: any building built or refurbished before 2000 should be assumed to contain asbestos until surveyed.
                    </p>
                  </div>
                </div>
              );
            })()}
            </PropCard>


            </div>

            </div>{/* /space-y-5 */}
          </div>{/* /property tab */}

          {/* ── Tab 2: Same Building Sales ───────────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "comparables" ? undefined : "none" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#00F0FF] mb-4 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00F0FF]" />
              Direct Comparables
            </h2>
            <ComparableSearch
              key={`building-${result.uprn ?? result.postcode}-${currentCaseId ?? "new"}`}
              mode="building"
              initialResult={buildingSearchResult}
              onSearchResult={setBuildingSearchResult}
              onSearchComplete={(ids, addressKeys) => {
                setBuildingSearchIds(ids);
                setBuildingSearchAddressKeys(addressKeys);
                setBuildingSearchDone(true);
              }}
              onAdopt={handleAdopt}
              onAdoptAll={handleAdoptAll}
              onUnadoptAll={handleUnadoptAll}
              adoptedIds={adoptedIds}
              valuationDate={valuationDate}
              onValuationDateChange={setValuationDate}
              uprn={result.uprn}
              lat={result.lat}
              lon={result.lon}
              postcode={result.postcode}
              floorArea={result.floor_area_m2}
              rooms={result.num_rooms}
              ageBand={result.construction_age_band}
              epcRating={result.energy_rating}
              propertyType={result.property_type}
              builtForm={result.built_form}
              tenure={result.tenure}
              buildingName={result.building_name}
              paonNumber={result.paon_number}
              saon={result.saon}
              streetName={result.street_name}
            />
          </div>

          {/* ── Tab: Wider Comparables ───────────────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "wider" ? undefined : "none" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#00F0FF] mb-4 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00F0FF]" />
              Wider Comparables
            </h2>
            <ComparableSearch
              key={`wider-${result.uprn ?? result.postcode}-${currentCaseId ?? "new"}`}
              mode="outward"
              initialResult={outwardSearchResult}
              onSearchResult={setOutwardSearchResult}
              locked={!buildingSearchDone}
              excludeIds={buildingSearchIds}
              excludeAddressKeys={buildingSearchAddressKeys}
              onAdopt={handleAdopt}
              onAdoptAll={handleAdoptAll}
              onUnadoptAll={handleUnadoptAll}
              adoptedIds={adoptedIds}
              valuationDate={valuationDate}
              onValuationDateChange={setValuationDate}
              uprn={result.uprn}
              lat={result.lat}
              lon={result.lon}
              postcode={result.postcode}
              floorArea={result.floor_area_m2}
              rooms={result.num_rooms}
              ageBand={result.construction_age_band}
              epcRating={result.energy_rating}
              propertyType={result.property_type}
              builtForm={result.built_form}
              tenure={result.tenure}
              buildingName={result.building_name}
              paonNumber={result.paon_number}
              saon={result.saon}
              streetName={result.street_name}
            />
          </div>

          {/* ── Tab: Additional Comparables ────────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "additional" ? undefined : "none" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#00F0FF] mb-4 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF2D78]" />
              Additional Comparables
            </h2>
            <AdditionalComparable
              onAdopt={(comp) => handleAddManual({ ...comp, source: "additional" })}
              adoptedIds={adoptedIds}
              valuationDate={valuationDate}
            />
          </div>

          {/* ── Tab 4: Adopted Comparables ───────────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "adopted" ? undefined : "none" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[#00F0FF] flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#39FF14]" />
                Adopted Comparables
                {adoptedComparables.length > 0 && (
                  <span className="ml-1 text-[#39FF14]">({adoptedComparables.length})</span>
                )}
              </h2>
              <button
                onClick={() => setShowManualForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#FF2D78]/40 bg-[#FF2D78]/10 text-[#FF2D78] hover:bg-[#FF2D78]/20 transition-colors"
              >
                <span>✏️</span> Add Manual
              </button>
            </div>
            {adoptedComparables.length === 0 ? (
              <div className="text-center py-16 text-[#94A3B8]/70 space-y-3">
                <p className="text-4xl">📋</p>
                <p className="text-sm font-medium text-[#94A3B8]">No comparables adopted yet</p>
                <p className="text-xs text-[#94A3B8]/70">Click <span className="font-semibold text-[#E2E8F0]">Adopt</span> on any comparable in the search tabs, or add your own:</p>
                <button
                  onClick={() => setShowManualForm(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-[#FF2D78]/40 bg-[#FF2D78]/10 text-[#FF2D78] hover:bg-[#FF2D78]/20 transition-colors"
                >
                  <span>✏️</span> Add Manual Comparable
                </button>
              </div>
            ) : (
              <div className="space-y-4">

                {/* ── HPI Correlation slider ──────────────────────────────── */}
                {hpiTrend.length > 0 && (
                  <div className="rounded-xl border border-[#334155] bg-[#111827] px-5 py-3 flex items-center gap-4 no-print">
                    <div className="text-xs text-[#94A3B8] uppercase tracking-wide whitespace-nowrap font-medium">HPI Correlation</div>
                    <input type="range" min={0} max={100} step={1} value={hpiCorrelation}
                      onChange={e => setHpiCorrelation(Number(e.target.value))}
                      className="flex-1 accent-[#00F0FF]" />
                    <div className="text-sm font-bold text-[#00F0FF] tabular-nums w-10 text-right">{hpiCorrelation}%</div>
                    <div className="text-[10px] text-[#475569] whitespace-nowrap">0% = no adj · 100% = full HPI</div>
                  </div>
                )}

                {/* ── Size Elasticity slider ───────────────────────────────── */}
                <div className={`rounded-xl border px-5 py-3 flex items-center gap-4 no-print transition-colors ${sizeElasticity > 0 ? "border-[#F59E0B]/40 bg-[#F59E0B]/5" : "border-[#334155] bg-[#111827]"}`}>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="text-xs text-[#94A3B8] uppercase tracking-wide font-medium">Size Elasticity (β)</span>
                    <span className="text-[#94A3B8]/50 text-xs cursor-help select-none" title="Controls how much £/sq ft adjusts for size differences. 0% = no adjustment. Higher values = stronger size premium for smaller units. Typical range for London residential: 10–30%.">ⓘ</span>
                  </div>
                  <input type="range" min={0} max={50} step={1} value={sizeElasticity}
                    onChange={e => setSizeElasticity(Number(e.target.value))}
                    className={`flex-1 ${sizeElasticity > 0 ? "accent-[#F59E0B]" : "accent-[#334155]"}`} />
                  <div className={`text-sm font-bold tabular-nums w-10 text-right ${sizeElasticity > 0 ? "text-[#F59E0B]" : "text-[#94A3B8]"}`}>{sizeElasticity}%</div>
                  <div className="text-[10px] text-[#475569] whitespace-nowrap">0% = no adj · 50% = max</div>
                </div>

                {/* ── Floating statistics dashboard ──────────────────────── */}
                <div className="sticky top-4 z-10 rounded-2xl overflow-hidden shadow-[0_0_20px_#00F0FF22] border border-[#334155]">

                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#0A0E1A]">
                    <span className="text-[11px] font-orbitron font-bold tracking-widest text-[#00F0FF] uppercase">Comparable Statistics</span>
                    <span className="text-[11px] text-[#94A3B8]">{adoptedComparables.length} comparable{adoptedComparables.length !== 1 ? "s" : ""}</span>
                  </div>

                  {/* 4-column stats */}
                  <div className="grid grid-cols-4 divide-x divide-[#334155] border-b border-[#334155] bg-[#111827]">
                    {/* Price */}
                    <div className="px-3 py-3">
                      <p className="text-[9px] font-orbitron font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">Price</p>
                      <p className="text-sm font-bold text-[#E2E8F0] leading-snug tabular-nums">
                        {fmtK(adoptedPriceMin)}<span className="text-[#334155] font-normal">–</span>{fmtK(adoptedPriceMax)}
                      </p>
                      <p className="text-[11px] text-[#94A3B8] mt-1 tabular-nums">avg {fmtK(adoptedPriceAvg)}</p>
                    </div>

                    {/* £/sqft */}
                    <div className="px-3 py-3">
                      <p className="text-[9px] font-orbitron font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">£ / sqft</p>
                      {adoptedPsfMin != null ? (
                        <>
                          <p className="text-sm font-bold text-[#E2E8F0] leading-snug tabular-nums">
                            {fmtPsf(adoptedPsfMin)}<span className="text-[#334155] font-normal">–</span>{fmtPsf(adoptedPsfMax!)}
                          </p>
                          <p className="text-[11px] text-[#94A3B8] mt-1 tabular-nums">avg {fmtPsf(adoptedPsfAvg!)}</p>
                          {adjPsfAvg != null && hpiCorrelation > 0 && adjPsfAvg !== Math.round(adoptedPsfAvg!) && (
                            <p className="text-[11px] text-[#67E8F9] mt-0.5 tabular-nums">adj {fmtPsf(adjPsfAvg)}</p>
                          )}
                          {sizeAdjPsfAvg != null && sizeElasticity > 0 && (
                            <p className="text-[11px] text-[#F59E0B] mt-0.5 tabular-nums">β-adj {fmtPsf(sizeAdjPsfAvg)}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-[#475569] mt-2">No area data</p>
                      )}
                    </div>

                    {/* Floor area */}
                    <div className="px-3 py-3">
                      <p className="text-[9px] font-orbitron font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">Floor Area</p>
                      {adoptedSizeMin != null ? (
                        <>
                          <p className="text-sm font-bold text-[#E2E8F0] leading-snug tabular-nums">
                            {Math.round(adoptedSizeMin)}<span className="text-[#334155] font-normal">–</span>{Math.round(adoptedSizeMax!)} m²
                          </p>
                          <p className="text-[11px] text-[#94A3B8] mt-1 tabular-nums">avg {Math.round(adoptedSizeAvg!)} m²</p>
                        </>
                      ) : (
                        <p className="text-[11px] text-[#475569] mt-2">No area data</p>
                      )}
                    </div>

                    {/* Date range */}
                    <div className="px-3 py-3">
                      <p className="text-[9px] font-orbitron font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">Date Range</p>
                      {adoptedDateMin && (
                        <>
                          <p className="text-sm font-bold text-[#E2E8F0] leading-snug">{fmtDateShort(adoptedDateMin)}</p>
                          <p className="text-[11px] text-[#94A3B8] mt-1">to {fmtDateShort(adoptedDateMax!)}</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Indicative valuation model */}
                  <div className="px-4 py-3 bg-[#0A0E1A]">
                    <p className="text-[9px] font-orbitron font-bold tracking-widest text-[#00F0FF] uppercase mb-1.5">
                      Indicative Valuation{sizeElasticity > 0 && subjectAreaSqft != null ? " (size+time adj)" : hpiCorrelation > 0 && hpiTrend.length > 0 ? " (time-adjusted)" : ""}
                      {subjectAreaM2 != null && (
                        <span className="ml-1.5 text-[#94A3B8] normal-case font-normal tracking-normal">
                          — subject {Math.round(subjectAreaM2)} m² · {Math.round(subjectAreaM2 * 10.764)} sqft
                        </span>
                      )}
                    </p>
                    {(() => {
                      const useSize = sizeElasticity > 0 && subjectAreaSqft != null && sizeAdjIndLow != null;
                      const useAdj = !useSize && hpiCorrelation > 0 && hpiTrend.length > 0 && adjIndicativeLow != null;
                      const low  = useSize ? sizeAdjIndLow  : useAdj ? adjIndicativeLow  : indicativeValLow;
                      const high = useSize ? sizeAdjIndHigh : useAdj ? adjIndicativeHigh : indicativeValHigh;
                      const mid  = useSize ? sizeAdjIndMid  : useAdj ? adjIndicativeMid  : indicativeValMid;
                      const psf  = useSize ? sizeAdjPsfAvg  : useAdj ? adjPsfAvg         : (adoptedPsfAvg != null ? Math.round(adoptedPsfAvg) : null);
                      return low != null ? (
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span className="text-lg font-bold text-[#00F0FF] tabular-nums" style={{ textShadow: "0 0 10px #00F0FF66" }}>
                            {fmtK(low)} – {fmtK(high!)}
                          </span>
                          {mid != null && (
                            <span className="text-sm font-semibold text-[#67E8F9] tabular-nums">
                              mid {fmtK(mid)}
                            </span>
                          )}
                          {psf != null && (
                            <span className="text-xs text-[#94A3B8] tabular-nums">
                              @ {fmtPsf(psf)} avg psf
                            </span>
                          )}
                          <span className="ml-auto text-[10px] text-[#475569] font-normal">
                            {adoptedWithArea.length}/{adoptedComparables.length} comps have area data
                          </span>
                        </div>
                      ) : (
                        <p className="text-sm text-[#94A3B8]">
                          {subjectAreaM2 == null
                            ? "Subject floor area unknown — cannot derive valuation"
                            : "EPC area data needed on comparables to model valuation"}
                        </p>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Comparable cards with independent sort per group ──── */}
                <p className="text-sm text-[#94A3B8]">
                  <span className="font-semibold text-[#E2E8F0]">{adoptedComparables.length}</span> comparable{adoptedComparables.length !== 1 ? "s" : ""} adopted
                </p>

                {/* ── Adopted comparables grouped by tier ─────────────────── */}
                {adoptedPostcodeComps.length > 0 && (() => {
                  const sorted = sortAdoptedComps(adoptedPostcodeComps, adoptedSortPostcode, adoptedSortDirPostcode);
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-orbitron font-bold tracking-widest text-[#00F0FF] uppercase">
                          All Adopted ({adoptedPostcodeComps.length})
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-[#94A3B8]/70 mr-1">Sort:</span>
                          {([["default", "Tier"], ["date", "Date"], ["price", "Price"], ["size", "Size"], ["psf", "£/sqft"]] as [AdoptedSortKey, string][]).map(([key, label]) => {
                            const active = adoptedSortPostcode === key;
                            return (
                              <button key={key}
                                onClick={() => {
                                  if (active && key !== "default") setAdoptedSortDirPostcode(d => d === "desc" ? "asc" : "desc");
                                  else { setAdoptedSortPostcode(key); setAdoptedSortDirPostcode("desc"); }
                                }}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                                  active ? "bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/30" : "bg-[#1E293B] text-[#94A3B8] border-[#334155] hover:text-[#E2E8F0] hover:border-[#475569]"
                                }`}
                              >
                                {label}{active && key !== "default" && <span className="ml-1">{adoptedSortDirPostcode === "asc" ? "↑" : "↓"}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {adoptedSortPostcode === "default" ? (
                        Object.entries(adoptedByTier)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([tierStr, comps]) => {
                            const tier = Number(tierStr);
                            const style = ADOPTED_TIER_STYLE[tier] ?? ADOPTED_TIER_STYLE[4];
                            const label = comps[0]?.tier_label ?? `Tier ${tier}`;
                            return (
                              <div key={tier} className="rounded-2xl border border-[#334155] overflow-hidden shadow-lg shadow-black/30">
                                <div className={`px-4 py-2.5 border-b flex items-center justify-between ${style.header}`}>
                                  <div className="flex items-center gap-2">
                                    <span>{style.icon}</span>
                                    <span className="font-orbitron font-bold text-xs text-[#E2E8F0] tracking-wider">{label.toUpperCase()}</span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.pill}`}>{comps.length} adopted</span>
                                  </div>
                                </div>
                                <div className="divide-y divide-[#334155]/60 bg-[#111827]">
                                  {comps.map((comp, idx) => {
                                    const globalIdx = adoptedComparables.indexOf(comp);
                                    return (
                                      <CompCard key={comp.transaction_id ?? idx} comp={comp} valuationYear={valuationYear} isAdopted={true}
                                        onAdopt={() => handleUnadoptOne(comp)}
                                        onReject={() => {}} sizeElasticity={sizeElasticity} subjectSqft={subjectAreaSqft} timeAdjFactor={adjFactors[globalIdx] ?? 1} />
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })
                      ) : (
                        <div className="rounded-2xl border border-[#334155] overflow-hidden shadow-lg shadow-black/30">
                          <div className="px-4 py-2.5 border-b flex items-center gap-2 bg-[#00F0FF]/5 border-[#00F0FF]/30">
                            <span>📊</span>
                            <span className="font-orbitron font-bold text-xs text-[#E2E8F0] tracking-wider">
                              SORTED BY {adoptedSortPostcode === "psf" ? "£/SQFT" : adoptedSortPostcode.toUpperCase()}
                            </span>
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#00F0FF]/15 text-[#00F0FF]">{sorted.length} adopted</span>
                          </div>
                          <div className="divide-y divide-[#334155]/60 bg-[#111827]">
                            {sorted.map((comp, idx) => {
                              const globalIdx = adoptedComparables.indexOf(comp);
                              return (
                                <CompCard key={comp.transaction_id ?? idx} comp={comp} valuationYear={valuationYear} isAdopted={true}
                                  onAdopt={() => handleUnadoptOne(comp)}
                                  onReject={() => {}} sizeElasticity={sizeElasticity} subjectSqft={subjectAreaSqft} timeAdjFactor={adjFactors[globalIdx] ?? 1} />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            )}

            {/* Manual comparable form modal */}
            {showManualForm && (
              <ManualComparableForm
                onAdd={(comp) => handleAddManual({ ...comp, source: "manual" })}
                onClose={() => setShowManualForm(false)}
                subjectPostcode={result?.postcode}
                subjectTenure={result?.tenure}
                subjectPropertyType={result?.property_type}
              />
            )}
          </div>

          {/* ── SEMV Tab ──────────────────────────────────────────────────── */}
          {activeTab === "semv" && (() => {
            const layer1All = [
              ...(buildingSearchResult?.comparables ?? []),
              ...(outwardSearchResult?.comparables ?? []),
            ];
            // De-duplicate by transaction_id
            const seen = new Set<string>();
            const layer1Deduped = layer1All.filter(c => {
              const key = c.transaction_id ?? c.address;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            const mvStr = reportContent?.valuer_inputs?.market_value ?? "";
            const mvNum = parseFloat(mvStr.replace(/,/g, "")) || null;
            return (
              <div className="pb-8">
              <SEMVTab
                layer1Comps={layer1Deduped}
                adoptedComparables={adoptedComparables}
                adoptedMV={mvNum}
                subjectSizeSqft={subjectAreaSqft}
                hpiTrend={hpiTrend}
                valuationDate={valuationDate}
                subjectPropertyType={result?.property_type ?? null}
                subjectHouseSubType={result?.built_form ?? null}
                subjectEpcScore={result?.energy_score ?? null}
                subjectSaon={result?.saon ?? null}
              />
              </div>
            );
          })()}

          {/* ── Tab 5: Report (Print Preview) ──────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "report" ? undefined : "none" }}>
            <ReportPreview result={result} adoptedComparables={adoptedComparables} session={session} reportContent={reportContent} valuationDate={valuationDate} />
          </div>

          {/* ── Map tab — full-bleed: edge-to-edge, fills remaining viewport ── */}
          {mapMounted && (
          <div style={{
            display: activeTab === "map" ? undefined : "none",
            position: "relative",
            /* Break out of the max-w-6xl px-4 parent container */
            marginLeft: "calc(-50vw + 50%)",
            marginRight: "calc(-50vw + 50%)",
            width: "100vw",
            /* Fill from tabs to bottom of viewport */
            height: "calc(100vh - 140px)",
          }}>
            {result.lat != null && result.lon != null ? (
              <PropertyMap
                subjectLat={result.lat}
                subjectLon={result.lon}
                subjectAddress={result.address}
                subjectEpc={result.energy_rating}
                subjectFloodRisk={result.rivers_sea_risk}
                adoptedComparables={adoptedComparables}
                compCoords={compCoords}
                onRemoveComparable={(comp) => setAdoptedComparables(prev =>
                  prev.filter(c => (c.transaction_id ?? c.address) !== (comp.transaction_id ?? comp.address))
                )}
                showFlood={mapShowFlood} onShowFloodChange={setMapShowFlood}
                showRings={mapShowRings} onShowRingsChange={setMapShowRings}
                showLandUse={mapShowLandUse} onShowLandUseChange={setMapShowLandUse}
                showDeprivation={mapShowDeprivation} onShowDeprivationChange={setMapShowDeprivation}
                showRoadNoise={mapShowRoadNoise} onShowRoadNoiseChange={setMapShowRoadNoise}
                showRailNoise={mapShowRailNoise} onShowRailNoiseChange={setMapShowRailNoise}
                showCrime={mapShowCrime} onShowCrimeChange={setMapShowCrime}
                showIncome={mapShowIncome} onShowIncomeChange={setMapShowIncome}
                showEducation={mapShowEducation} onShowEducationChange={setMapShowEducation}
                showHeritage={mapShowHeritage} onShowHeritageChange={setMapShowHeritage}
                tileLayer={mapTileLayer} onTileLayerChange={setMapTileLayer}
                incomeCache={mapIncomeCache} onIncomeCacheChange={setMapIncomeCache}
                educationCache={mapEducationCache} onEducationCacheChange={setMapEducationCache}
                crimeCache={mapCrimeCache} onCrimeCacheChange={setMapCrimeCache}
                landUseCache={mapLandUseCache} onLandUseCacheChange={setMapLandUseCache}
                imdCache={mapImdCache} onImdCacheChange={setMapImdCache}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                No coordinates available for this property.
              </div>
            )}
          </div>
          )}

          {/* ── Tab 6: House Price Index ─────────────────────────────────────── */}
          <HpiAutoFetch
            active={activeTab === "hpi"}
            hpi={result.hpi}
            postcode={result.postcode}
            propertyType={result.property_type}
            builtForm={result.built_form}
            token={session?.access_token}
            onHpi={(hpi) => setResult(prev => prev ? { ...prev, hpi } : prev)}
          />
          <div className="pb-8" style={{ display: activeTab === "hpi" ? undefined : "none" }}>
            <HpiTab result={result} />
          </div>
          {/* ── Tab: Report Typing ─────────────────────────────────────────────── */}
          <div className="pb-8" style={{ display: activeTab === "report_typing" ? undefined : "none" }}>
            <ReportTyping result={result} adoptedComparables={adoptedComparables} session={session} reportContent={reportContent} onReportContentChange={(c) => setReportContent(prev => ({ ...prev, ...c }))} onSave={() => saveCase(false)} valuationDate={valuationDate} />
          </div>

        </div>
      )
      }

      {/* ── Save Case dialog ────────────────────────────────────────────────── */}
      {showSaveDialog && (
        <SaveCaseDialog
          result={result}
          saveCaseType={saveCaseType}
          onSaveCaseTypeChange={setSaveCaseType}
          onSave={() => saveCase()}
          onCancel={() => setShowSaveDialog(false)}
          savingCase={savingCase}
          pendingExitAfterSave={pendingExitAfterSave}
          onResetHome={doResetHome}
        />
      )}

      {/* ── My Cases slide-out panel ────────────────────────────────────────── */}
      {showCasesPanel && (
        <MyCasesPanel
          casesList={casesList}
          casesLoading={casesLoading}
          currentCaseId={currentCaseId}
          casesFilter={casesFilter}
          casesSort={casesSort}
          casesSortDir={casesSortDir}
          onSetCasesFilter={setCasesFilter}
          onSetCasesSort={setCasesSort}
          onSetCasesSortDir={setCasesSortDir}
          onLoadCase={loadCase}
          onDeleteCase={deleteCase}
          onClose={() => setShowCasesPanel(false)}
        />
      )}

    </main>
  );
}

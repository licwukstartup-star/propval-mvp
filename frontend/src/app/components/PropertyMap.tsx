"use client";

// Leaflet CSS must be imported here (inside the dynamically-imported module) so it
// only runs client-side and is present before any Leaflet rendering begins.
import "leaflet/dist/leaflet.css";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  WMSTileLayer,
  Circle,
  CircleMarker,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { ComparableCandidate } from "@/components/ComparableSearch";

// Fix Leaflet's default icon paths broken by webpack/Next.js bundling.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Types ─────────────────────────────────────────────────────────────────────

type TileLayerKey = "dark" | "satellite" | "street";

interface PropertyMapProps {
  subjectLat: number;
  subjectLon: number;
  subjectAddress: string;
  subjectEpc: string | null;
  subjectFloodRisk: string | null;
  adoptedComparables: ComparableCandidate[];
  compCoords: Record<string, { lat: number; lon: number }>;
  onRemoveComparable?: (comp: ComparableCandidate) => void;
  showFlood: boolean; onShowFloodChange: (v: boolean) => void;
  showRings: boolean; onShowRingsChange: (v: boolean) => void;
  showLandUse: boolean; onShowLandUseChange: (v: boolean) => void;
  showDeprivation: boolean; onShowDeprivationChange: (v: boolean) => void;
  showRoadNoise: boolean; onShowRoadNoiseChange: (v: boolean) => void;
  showRailNoise: boolean; onShowRailNoiseChange: (v: boolean) => void;
  showCrime: boolean; onShowCrimeChange: (v: boolean) => void;
  showIncome: boolean; onShowIncomeChange: (v: boolean) => void;
  showEducation: boolean; onShowEducationChange: (v: boolean) => void;
  tileLayer: TileLayerKey; onTileLayerChange: (v: TileLayerKey) => void;
  landUseCache: GeoJSON.FeatureCollection | null; onLandUseCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  imdCache: GeoJSON.FeatureCollection | null; onImdCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  incomeCache: GeoJSON.FeatureCollection | null; onIncomeCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  educationCache: GeoJSON.FeatureCollection | null; onEducationCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  crimeCache: CrimeCluster[] | null; onCrimeCacheChange: (v: CrimeCluster[] | null) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(p: number) {
  return "£" + p.toLocaleString("en-GB");
}

function fmtPsf(comp: ComparableCandidate) {
  if (!comp.floor_area_sqm) return null;
  return "£" + Math.round(comp.price / (comp.floor_area_sqm * 10.764)).toLocaleString("en-GB") + "/sqft";
}

function floodColour(risk: string) {
  if (risk === "High")   return "#FF3131";
  if (risk === "Medium") return "#FFB800";
  return "#39FF14";
}

const FLOOD_WMS = "https://environment.data.gov.uk/spatialdata/nafra2-risk-of-flooding-from-rivers-and-sea/wms";
const ROAD_NOISE_WMS = "https://environment.data.gov.uk/spatialdata/road-noise-all-metrics-england-round-4/wms";
const RAIL_NOISE_WMS = "https://environment.data.gov.uk/spatialdata/rail-noise-lden-england-round-2/wms";

// ── Tile layer configs ────────────────────────────────────────────────────────

const TILE_LAYERS = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    subdomains: undefined,
  },
  street: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
  },
} as const;


// ── Distance rings config ─────────────────────────────────────────────────────

const DISTANCE_RINGS = [
  { radius: 805,   label: "0.5 mi", dash: "6 4" },
  { radius: 1609,  label: "1 mi",   dash: "8 6" },
  { radius: 3219,  label: "2 mi",   dash: "9 7" },
  { radius: 4828,  label: "3 mi",   dash: "10 8" },
  { radius: 8047,  label: "5 mi",   dash: "12 10" },
];

// ── Sub-component: auto-fit bounds ────────────────────────────────────────────

function FitBounds({ subject, compCoords }: {
  subject: [number, number];
  compCoords: Record<string, { lat: number; lon: number }>;
}) {
  const map = useMap();
  const hasFitted = useRef(false);
  useEffect(() => {
    if (hasFitted.current) return;
    const points: L.LatLngExpression[] = [subject];
    Object.values(compCoords).forEach(c => points.push([c.lat, c.lon]));
    if (points.length > 1) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      hasFitted.current = true;
    }
  }, [map, subject, compCoords]);
  return null;
}

// ── Sub-component: defer overlays until map is ready ──────────────────────

function useMapReady() {
  const map = useMap();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (map.getSize().x > 0) { setReady(true); return; }
    const onReady = () => setReady(true);
    map.whenReady(onReady);
    return () => { map.off("load", onReady); };
  }, [map]);
  return ready;
}

// ── Sub-component: fullscreen toggle ──────────────────────────────────────────

function FullscreenControl() {
  const map = useMap();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      setTimeout(() => map.invalidateSize(), 100);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [map]);

  const toggle = () => {
    const container = map.getContainer().closest("[data-map-wrapper]") as HTMLElement;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <button
      onClick={toggle}
      title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      style={{
        position: "absolute", bottom: 80, right: 12, zIndex: 1000,
        background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
        color: "#E2E8F0",
        border: "1px solid #334155", borderRadius: 8,
        width: 32, height: 32, fontSize: 16,
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
      }}
    >
      {isFullscreen ? "⊡" : "⊞"}
    </button>
  );
}

// ── Custom scale bar ──────────────────────────────────────────────────────────

const SCALE_STEPS = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

function CustomScaleBar() {
  const map = useMap();
  const [scaleM, setScaleM] = useState(100);
  const [barPx, setBarPx] = useState(100);

  useEffect(() => {
    const update = () => {
      const center = map.getCenter();
      // metres per pixel at current zoom
      const mpp = (40075016.686 * Math.cos((center.lat * Math.PI) / 180)) /
        Math.pow(2, map.getZoom() + 8);
      // pick a nice round distance that fits ~120-200px
      const targetPx = 160;
      const targetM = mpp * targetPx;
      let best = SCALE_STEPS[0];
      for (const s of SCALE_STEPS) {
        if (s <= targetM * 1.2) best = s;
      }
      setScaleM(best);
      setBarPx(Math.round(best / mpp));
    };
    update();
    map.on("zoomend moveend", update);
    return () => { map.off("zoomend moveend", update); };
  }, [map]);

  const labelM = scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`;
  const mi = scaleM * 0.000621371;
  const labelImp = mi >= 0.1 ? `${mi < 1 ? mi.toFixed(2) : mi.toFixed(1)} mi` : `${Math.round(scaleM * 1.09361)} yd`;
  // number of tick marks (including endpoints)
  const ticks = 5;

  return (
    <div style={{
      position: "absolute", top: 50, left: 12, zIndex: 1000,
      background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
      borderRadius: 8, padding: "6px 12px 6px",
      border: "1px solid #334155", boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
      fontFamily: "var(--font-mono), monospace", fontSize: 10, color: "#E2E8F0",
      userSelect: "none", pointerEvents: "none",
    }}>
      {/* Scale bar with ticks */}
      <div style={{ position: "relative", width: barPx, height: 10 }}>
        {Array.from({ length: ticks - 1 }).map((_, i) => {
          const segW = barPx / (ticks - 1);
          return (
            <div key={i} style={{
              position: "absolute", left: i * segW, top: 2, width: segW, height: 4,
              background: i % 2 === 0 ? "#00F0FF" : "rgba(0, 240, 255, 0.25)",
              borderLeft: i === 0 ? "1px solid #00F0FF" : undefined,
              borderRight: "1px solid #00F0FF",
            }} />
          );
        })}
        {Array.from({ length: ticks }).map((_, i) => {
          const x = (barPx / (ticks - 1)) * i;
          return (
            <div key={`t${i}`} style={{
              position: "absolute", left: x, top: 0, width: 1, height: 8,
              background: "#00F0FF",
            }} />
          );
        })}
      </div>
      {/* Labels row: 0 on left, metric + imperial on right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2, fontWeight: 600, letterSpacing: 0.5 }}>
        <span style={{ color: "#94A3B8", fontSize: 8 }}>0</span>
        <span style={{ whiteSpace: "nowrap" }}>
          <span style={{ color: "#00F0FF", fontSize: 9 }}>{labelM}</span>
          <span style={{ color: "#334155", margin: "0 3px" }}>|</span>
          <span style={{ color: "#FF2D78", fontSize: 9 }}>{labelImp}</span>
        </span>
      </div>
    </div>
  );
}

// ── Land use colours (retail, commercial, industrial, etc.) ───────────────────

const LANDUSE_STYLES: Record<string, { fill: string; stroke: string; label: string }> = {
  retail:              { fill: "#FBBF24", stroke: "#F59E0B", label: "Retail / High Street" },
  commercial:          { fill: "#60A5FA", stroke: "#3B82F6", label: "Commercial" },
  industrial:          { fill: "#A78BFA", stroke: "#7C3AED", label: "Industrial" },
  park:                { fill: "#4ADE80", stroke: "#22C55E", label: "Park" },
  garden:              { fill: "#86EFAC", stroke: "#4ADE80", label: "Garden" },
  recreation_ground:   { fill: "#6EE7B7", stroke: "#34D399", label: "Recreation Ground" },
  playground:          { fill: "#A7F3D0", stroke: "#6EE7B7", label: "Playground" },
  nature_reserve:      { fill: "#2DD4BF", stroke: "#14B8A6", label: "Nature Reserve" },
};

function landUseStyle(feature: GeoJSON.Feature | undefined) {
  const landuse = (feature?.properties?.landuse ?? feature?.properties?.leisure) as string | undefined;
  const style = LANDUSE_STYLES[landuse ?? ""] ?? LANDUSE_STYLES.commercial;
  return {
    fillColor: style.fill,
    fillOpacity: 0.2,
    color: style.stroke,
    weight: 1.5,
    opacity: 0.6,
  };
}

// ── Hook: fetch land use polygons from Overpass ───────────────────────────────

function useLandUseGeoJSON(
  lat: number, lon: number, enabled: boolean,
  cache: GeoJSON.FeatureCollection | null, setCache: (v: GeoJSON.FeatureCollection | null) => void,
) {
  const [geoKey, setGeoKey] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (cache || loadingRef.current) return;
    if (!enabled) return;
    loadingRef.current = true;

    let cancelled = false;
    const query = `[out:json][timeout:30];(way["landuse"~"retail|commercial|industrial|recreation_ground"](around:4828,${lat},${lon});relation["landuse"~"retail|commercial|industrial|recreation_ground"](around:4828,${lat},${lon});way["leisure"~"park|garden|recreation_ground|playground|nature_reserve"](around:4828,${lat},${lon});relation["leisure"~"park|garden|recreation_ground|playground|nature_reserve"](around:4828,${lat},${lon}););out body;>;out skel qt;`;

    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    })
      .then(r => {
        if (!r.ok) throw new Error(`Overpass ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const fc = osmToGeoJSON(data);
        console.log("[LandUse] features:", fc.features.length);
        setCache(fc);
        setGeoKey(k => k + 1);
      })
      .catch(err => {
        console.warn("[LandUse] fetch failed:", err);
      })
      .finally(() => { loadingRef.current = false; });
    return () => { cancelled = true; loadingRef.current = false; };
  }, [lat, lon, enabled, cache, setCache]);

  // Bump key whenever cache arrives (pre-fetch or local fetch)
  const prevCacheRef = useRef(cache);
  useEffect(() => {
    if (cache && cache !== prevCacheRef.current) setGeoKey(k => k + 1);
    prevCacheRef.current = cache;
  }, [cache]);

  return { geojson: cache, geoKey };
}

// ── Minimal OSM JSON → GeoJSON converter ──────────────────────────────────────

function osmToGeoJSON(osm: { elements: Array<{ type: string; id: number; tags?: Record<string, string>; lat?: number; lon?: number; nodes?: number[]; members?: Array<{ type: string; ref: number; role: string }>; }> }): GeoJSON.FeatureCollection {
  const nodes = new Map<number, [number, number]>();
  const ways = new Map<number, { nodes: number[]; tags?: Record<string, string> }>();

  for (const el of osm.elements) {
    if (el.type === "node" && el.lat != null && el.lon != null) {
      nodes.set(el.id, [el.lon, el.lat]);
    }
    if (el.type === "way") {
      ways.set(el.id, { nodes: el.nodes ?? [], tags: el.tags });
    }
  }

  const features: GeoJSON.Feature[] = [];

  // Convert ways to polygons
  for (const [, way] of ways) {
    const tag = way.tags?.landuse ?? way.tags?.leisure;
    if (!tag) continue;
    const coords = way.nodes.map(nid => nodes.get(nid)).filter(Boolean) as [number, number][];
    if (coords.length < 3) continue;
    features.push({
      type: "Feature",
      properties: { landuse: way.tags?.landuse, leisure: way.tags?.leisure, name: way.tags?.name },
      geometry: { type: "Polygon", coordinates: [coords] },
    });
  }

  // Convert relations (multipolygons) - outer ways only for simplicity
  for (const el of osm.elements) {
    const tag = el.tags?.landuse ?? el.tags?.leisure;
    if (el.type !== "relation" || !tag || !el.members) continue;
    for (const member of el.members) {
      if (member.type === "way" && member.role === "outer") {
        const way = ways.get(member.ref);
        if (!way) continue;
        const coords = way.nodes.map(nid => nodes.get(nid)).filter(Boolean) as [number, number][];
        if (coords.length < 3) continue;
        features.push({
          type: "Feature",
          properties: { landuse: el.tags?.landuse, leisure: el.tags?.leisure, name: el.tags?.name },
          geometry: { type: "Polygon", coordinates: [coords] },
        });
      }
    }
  }

  return { type: "FeatureCollection", features };
}

// ── IMD Deprivation decile colours (1 = most deprived → 10 = least) ──────

const IMD_DECILE_COLOURS: Record<number, string> = {
  1: "#DC2626", 2: "#EA580C", 3: "#F97316", 4: "#FBBF24", 5: "#FDE047",
  6: "#BEF264", 7: "#86EFAC", 8: "#4ADE80", 9: "#22C55E", 10: "#16A34A",
};

function imdStyle(feature: GeoJSON.Feature | undefined) {
  const decile = feature?.properties?.IMDDec0 as number | undefined;
  return {
    fillColor: IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047",
    fillOpacity: 0.35,
    color: "#334155",
    weight: 1,
    opacity: 0.6,
  };
}

// ── Hook: fetch IMD overall decile choropleth (single query to IMD Full) ──

function useImdGeoJSON(
  lat: number, lon: number, enabled: boolean,
  cache: GeoJSON.FeatureCollection | null, setCache: (v: GeoJSON.FeatureCollection | null) => void,
) {
  const [geoKey, setGeoKey] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (cache || loadingRef.current) return;
    if (!enabled) return;
    loadingRef.current = true;
    let cancelled = false;

    const dLat = 0.018;
    const dLon = 0.03;
    const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;

    const url = new URL(IMD_FULL_URL);
    url.searchParams.set("geometry", bbox);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "lsoa11cd,lsoa11nm,IMDDec0");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");

    fetch(url.toString())
      .then(r => {
        if (!r.ok) throw new Error(`IMD ArcGIS ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const fc = data as GeoJSON.FeatureCollection;
        if (!fc.features) { console.warn("[IMD] no features in response"); return; }
        // Add ls11cd/ls11nm aliases for popup compatibility
        for (const f of fc.features) {
          f.properties = { ...f.properties, ls11cd: f.properties?.lsoa11cd, ls11nm: f.properties?.lsoa11nm };
        }
        console.log("[IMD] features:", fc.features.length);
        setCache(fc);
        setGeoKey(k => k + 1);
      })
      .catch(err => {
        console.warn("[IMD] fetch failed:", err);
      })
      .finally(() => { loadingRef.current = false; });
    return () => { cancelled = true; loadingRef.current = false; };
  }, [lat, lon, enabled, cache, setCache]);

  // Bump key whenever cache arrives (pre-fetch or local fetch)
  const prevCacheRef = useRef(cache);
  useEffect(() => {
    if (cache && cache !== prevCacheRef.current) setGeoKey(k => k + 1);
    prevCacheRef.current = cache;
  }, [cache]);

  return { geojson: cache, geoKey };
}

// ── Income Deprivation layer (IMD 2019 Income sub-domain) ────────────────

const IMD_FULL_URL = "https://services-eu1.arcgis.com/EbKcOS6EXZroSyoi/arcgis/rest/services/Indices_of_Multiple_Deprivation_(IMD)_2019/FeatureServer/0/query";

function incomeStyle(feature: GeoJSON.Feature | undefined) {
  const decile = feature?.properties?.IncDec as number | undefined;
  return {
    fillColor: IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047",
    fillOpacity: 0.35,
    color: "#334155",
    weight: 1,
    opacity: 0.6,
  };
}

function useIncomeGeoJSON(
  lat: number, lon: number, enabled: boolean,
  cache: GeoJSON.FeatureCollection | null, setCache: (v: GeoJSON.FeatureCollection | null) => void,
) {
  const [geoKey, setGeoKey] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (cache || loadingRef.current) return;
    if (!enabled) return;
    loadingRef.current = true;
    let cancelled = false;

    const dLat = 0.018;
    const dLon = 0.03;
    const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;

    const url = new URL(IMD_FULL_URL);
    url.searchParams.set("geometry", bbox);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "lsoa11cd,lsoa11nm,IncDec,IncScore,IncRank");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");

    fetch(url.toString())
      .then(r => {
        if (!r.ok) throw new Error(`Income ArcGIS ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const fc = data as GeoJSON.FeatureCollection;
        if (!fc.features) { console.warn("[Income] no features in response"); return; }
        console.log("[Income] features:", fc.features.length);
        setCache(fc);
        setGeoKey(k => k + 1);
      })
      .catch(err => {
        console.warn("[Income] fetch failed:", err);
      })
      .finally(() => { loadingRef.current = false; });
    return () => { cancelled = true; loadingRef.current = false; };
  }, [lat, lon, enabled, cache, setCache]);

  const prevCacheRef = useRef(cache);
  useEffect(() => {
    if (cache && cache !== prevCacheRef.current) setGeoKey(k => k + 1);
    prevCacheRef.current = cache;
  }, [cache]);

  return { geojson: cache, geoKey };
}

// ── Education Deprivation layer (IMD 2019 Education sub-domain) ──────────

function educationStyle(feature: GeoJSON.Feature | undefined) {
  const decile = feature?.properties?.EduDec as number | undefined;
  return {
    fillColor: IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047",
    fillOpacity: 0.35,
    color: "#334155",
    weight: 1,
    opacity: 0.6,
  };
}

function useEducationGeoJSON(
  lat: number, lon: number, enabled: boolean,
  cache: GeoJSON.FeatureCollection | null, setCache: (v: GeoJSON.FeatureCollection | null) => void,
) {
  const [geoKey, setGeoKey] = useState(0);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (cache || loadingRef.current) return;
    if (!enabled) return;
    loadingRef.current = true;
    let cancelled = false;

    const dLat = 0.018;
    const dLon = 0.03;
    const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;

    const url = new URL(IMD_FULL_URL);
    url.searchParams.set("geometry", bbox);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "lsoa11cd,lsoa11nm,EduDec,EduScore,EduRank");
    url.searchParams.set("f", "geojson");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");

    fetch(url.toString())
      .then(r => {
        if (!r.ok) throw new Error(`Education ArcGIS ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const fc = data as GeoJSON.FeatureCollection;
        if (!fc.features) { console.warn("[Education] no features in response"); return; }
        console.log("[Education] features:", fc.features.length);
        setCache(fc);
        setGeoKey(k => k + 1);
      })
      .catch(err => {
        console.warn("[Education] fetch failed:", err);
      })
      .finally(() => { loadingRef.current = false; });
    return () => { cancelled = true; loadingRef.current = false; };
  }, [lat, lon, enabled, cache, setCache]);

  const prevCacheRef = useRef(cache);
  useEffect(() => {
    if (cache && cache !== prevCacheRef.current) setGeoKey(k => k + 1);
    prevCacheRef.current = cache;
  }, [cache]);

  return { geojson: cache, geoKey };
}

// ── Crime data types & colours ────────────────────────────────────────────

interface CrimePoint {
  lat: number;
  lon: number;
  category: string;
  street: string;
  month: string;
  id: number;
}

export interface CrimeCluster {
  lat: number;
  lon: number;
  count: number;
  categories: Record<string, number>;
  street: string;
}

const CRIME_COLOURS: Record<string, { fill: string; label: string }> = {
  "violent-crime":        { fill: "#DC2626", label: "Violence & Sexual Offences" },
  "burglary":             { fill: "#F97316", label: "Burglary" },
  "robbery":              { fill: "#EF4444", label: "Robbery" },
  "vehicle-crime":        { fill: "#3B82F6", label: "Vehicle Crime" },
  "anti-social-behaviour":{ fill: "#FBBF24", label: "Anti-Social Behaviour" },
  "shoplifting":          { fill: "#A78BFA", label: "Shoplifting" },
  "criminal-damage-arson":{ fill: "#FB923C", label: "Criminal Damage & Arson" },
  "drugs":                { fill: "#34D399", label: "Drugs" },
  "other-theft":          { fill: "#60A5FA", label: "Other Theft" },
  "public-order":         { fill: "#F472B6", label: "Public Order" },
  "other":                { fill: "#94A3B8", label: "Other" },
};

function crimeColour(category: string): string {
  return CRIME_COLOURS[category]?.fill ?? CRIME_COLOURS.other.fill;
}

// ── Hook: fetch street-level crime from Police API ───────────────────────

function useCrimeData(
  lat: number, lon: number, enabled: boolean,
  cache: CrimeCluster[] | null, setCache: (v: CrimeCluster[] | null) => void,
) {
  const loadingRef = useRef(false);

  useEffect(() => {
    if (cache || loadingRef.current) return;
    if (!enabled) return;
    loadingRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        // Fetch latest available month first
        const metaRes = await fetch("https://data.police.uk/api/crime-last-updated");
        if (!metaRes.ok) throw new Error(`Police meta ${metaRes.status}`);
        const meta = await metaRes.json();
        // date is like "2026-01-01", we need "2026-01"
        const month = (meta.date as string).slice(0, 7);

        const res = await fetch(
          `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lon}&date=${month}`
        );
        if (!res.ok) throw new Error(`Police API ${res.status}`);
        const crimes: Array<{
          id: number; category: string; month: string;
          location: { latitude: string; longitude: string; street: { name: string } };
        }> = await res.json();
        if (cancelled) return;

        console.log("[Crime] raw incidents:", crimes.length);

        // Cluster by anonymised location (Police API snaps to ~street level)
        const clusterMap = new Map<string, CrimeCluster>();
        for (const c of crimes) {
          const key = `${c.location.latitude},${c.location.longitude}`;
          let cluster = clusterMap.get(key);
          if (!cluster) {
            cluster = {
              lat: parseFloat(c.location.latitude),
              lon: parseFloat(c.location.longitude),
              count: 0,
              categories: {},
              street: c.location.street.name,
            };
            clusterMap.set(key, cluster);
          }
          cluster.count++;
          cluster.categories[c.category] = (cluster.categories[c.category] || 0) + 1;
        }

        const clusters = Array.from(clusterMap.values());
        console.log("[Crime] clusters:", clusters.length);
        setCache(clusters);
      } catch (err) {
        console.warn("[Crime] fetch failed:", err);
      } finally {
        loadingRef.current = false;
      }
    })();
    return () => { cancelled = true; loadingRef.current = false; };
  }, [lat, lon, enabled, cache, setCache]);

  return cache;
}

// ── Deferred overlays: waits for map ready before rendering layers ────────

function DeferredOverlays({
  showFlood, showRoadNoise, showRailNoise,
  showDeprivation, imdData, imdKey, onEachImd,
  showIncome, incomeData, incomeKey, onEachIncome,
  showEducation, educationData, educationKey, onEachEducation,
  showLandUse, landUseData, landUseKey, onEachLandUse,
  showRings, subjectLat, subjectLon,
  showCrime, crimeData,
}: {
  showFlood: boolean; showRoadNoise: boolean; showRailNoise: boolean;
  showDeprivation: boolean; imdData: GeoJSON.FeatureCollection | null; imdKey: number;
  onEachImd: (f: GeoJSON.Feature, l: L.Layer) => void;
  showIncome: boolean; incomeData: GeoJSON.FeatureCollection | null; incomeKey: number;
  onEachIncome: (f: GeoJSON.Feature, l: L.Layer) => void;
  showEducation: boolean; educationData: GeoJSON.FeatureCollection | null; educationKey: number;
  onEachEducation: (f: GeoJSON.Feature, l: L.Layer) => void;
  showLandUse: boolean; landUseData: GeoJSON.FeatureCollection | null; landUseKey: number;
  onEachLandUse: (f: GeoJSON.Feature, l: L.Layer) => void;
  showRings: boolean; subjectLat: number; subjectLon: number;
  showCrime: boolean; crimeData: CrimeCluster[] | null;
}) {
  const ready = useMapReady();
  if (!ready) return null;

  return (
    <>
      {/* EA NaFRA2 flood risk WMS overlay */}
      {showFlood && (
        <WMSTileLayer url={FLOOD_WMS} layers="rofrs_4band" transparent={true} opacity={0.55} format="image/png" version="1.3.0" />
      )}

      {/* Road noise WMS overlay (Lden = day-evening-night weighted, Round 4) */}
      {showRoadNoise && (
        <WMSTileLayer url={ROAD_NOISE_WMS} layers="Road_Noise_Lden_England_Round_4_All" transparent={true} opacity={0.55} format="image/png" version="1.1.1" />
      )}

      {/* Rail noise WMS overlay (Lden, Round 2) */}
      {showRailNoise && (
        <WMSTileLayer url={RAIL_NOISE_WMS} layers="Rail_Noise_Lden_England_Round_2" transparent={true} opacity={0.55} format="image/png" version="1.1.1" />
      )}

      {/* IMD Deprivation overlay (LSOA polygons) */}
      {showDeprivation && imdData && imdData.features && imdData.features.length > 0 && (
        <GeoJSON key={`imd-${imdKey}`} data={imdData} style={imdStyle} onEachFeature={onEachImd} />
      )}

      {/* Income Deprivation overlay (LSOA polygons) */}
      {showIncome && incomeData && incomeData.features && incomeData.features.length > 0 && (
        <GeoJSON key={`inc-${incomeKey}`} data={incomeData} style={incomeStyle} onEachFeature={onEachIncome} />
      )}

      {/* Education Deprivation overlay (LSOA polygons) */}
      {showEducation && educationData && educationData.features && educationData.features.length > 0 && (
        <GeoJSON key={`edu-${educationKey}`} data={educationData} style={educationStyle} onEachFeature={onEachEducation} />
      )}

      {/* Land use overlay (retail / commercial / industrial) */}
      {showLandUse && landUseData && landUseData.features && landUseData.features.length > 0 && (
        <GeoJSON key={`lu-${landUseKey}`} data={landUseData} style={landUseStyle} onEachFeature={onEachLandUse} />
      )}

      {/* Distance rings around subject with labels */}
      {showRings && DISTANCE_RINGS.map(ring => {
        const labelLat = subjectLat + ring.radius / 111320;
        const ringLabelIcon = L.divIcon({
          className: "",
          html: `<div style="
            font-size:9px;font-weight:700;color:#C4B5FD;
            text-shadow:0 0 4px #7B2FBE,0 1px 2px #000;
            letter-spacing:0.06em;white-space:nowrap;
            pointer-events:none;
          ">${ring.label}</div>`,
          iconSize: [40, 14],
          iconAnchor: [20, 14],
        });
        return (
          <span key={ring.radius}>
            <Circle
              center={[subjectLat, subjectLon]}
              radius={ring.radius}
              pathOptions={{
                color: "#C4B5FD", weight: 2, opacity: 0.8,
                fillColor: "#7B2FBE", fillOpacity: 0.03, dashArray: ring.dash,
              }}
            />
            <Marker position={[labelLat, subjectLon]} icon={ringLabelIcon} interactive={false} />
          </span>
        );
      })}

      {/* Crime clusters */}
      {showCrime && crimeData && crimeData.map((cluster, i) => {
        if (!cluster.lat || !cluster.lon || isNaN(cluster.lat) || isNaN(cluster.lon)) return null;
        const topCat = Object.entries(cluster.categories)
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
        const radius = Math.min(4 + Math.sqrt(cluster.count) * 2, 14);
        return (
          <CircleMarker
            key={`crime-${i}`}
            center={[cluster.lat, cluster.lon]}
            radius={radius}
            pathOptions={{ fillColor: crimeColour(topCat), fillOpacity: 0.7, color: "#fff", weight: 1, opacity: 0.8 }}
          >
            <Popup className="propval-popup" minWidth={180}>
              <div style={{ fontSize: 11, color: "#E2E8F0" }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#FF6B6B" }}>
                  {cluster.count} crime{cluster.count > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 6 }}>
                  {cluster.street}
                </div>
                {Object.entries(cluster.categories)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, count]) => (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: crimeColour(cat), flexShrink: 0 }} />
                      <span style={{ fontSize: 10 }}>{CRIME_COLOURS[cat]?.label ?? cat} ({count})</span>
                    </div>
                  ))}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PropertyMap({
  subjectLat,
  subjectLon,
  subjectAddress,
  subjectEpc,
  subjectFloodRisk,
  adoptedComparables,
  compCoords,
  onRemoveComparable,
  showFlood, onShowFloodChange: setShowFlood,
  showRings, onShowRingsChange: setShowRings,
  showLandUse, onShowLandUseChange: setShowLandUse,
  showDeprivation, onShowDeprivationChange: setShowDeprivation,
  showRoadNoise, onShowRoadNoiseChange: setShowRoadNoise,
  showRailNoise, onShowRailNoiseChange: setShowRailNoise,
  showCrime, onShowCrimeChange: setShowCrime,
  showIncome, onShowIncomeChange: setShowIncome,
  showEducation, onShowEducationChange: setShowEducation,
  tileLayer, onTileLayerChange: setTileLayer,
  landUseCache, onLandUseCacheChange,
  imdCache, onImdCacheChange,
  incomeCache, onIncomeCacheChange,
  educationCache, onEducationCacheChange,
  crimeCache, onCrimeCacheChange,
}: PropertyMapProps) {
  const { geojson: landUseData, geoKey: landUseKey } = useLandUseGeoJSON(subjectLat, subjectLon, showLandUse, landUseCache, onLandUseCacheChange);
  const { geojson: imdData, geoKey: imdKey } = useImdGeoJSON(subjectLat, subjectLon, showDeprivation, imdCache, onImdCacheChange);
  const { geojson: incomeData, geoKey: incomeKey } = useIncomeGeoJSON(subjectLat, subjectLon, showIncome, incomeCache, onIncomeCacheChange);
  const { geojson: educationData, geoKey: educationKey } = useEducationGeoJSON(subjectLat, subjectLon, showEducation, educationCache, onEducationCacheChange);
  const crimeData = useCrimeData(subjectLat, subjectLon, showCrime, crimeCache, onCrimeCacheChange);

  const onEachImd = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const decile = feature.properties?.IMDDec0 as number | undefined;
    const name = feature.properties?.ls11nm as string | undefined;
    const code = feature.properties?.ls11cd as string | undefined;
    const colour = IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047";
    (layer as L.Path).bindPopup(
      `<div style="font-size:11px;color:#E2E8F0">
        <b style="color:${colour}">IMD Decile ${decile ?? "?"}/10</b><br/>
        ${name ?? "Unknown LSOA"}<br/>
        <span style="color:#94A3B8;font-size:10px">${code ?? ""}</span>
      </div>`,
      { className: "propval-popup" }
    );
  }, []);

  const onEachIncome = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const decile = feature.properties?.IncDec as number | undefined;
    const score = feature.properties?.IncScore as number | undefined;
    const name = feature.properties?.lsoa11nm as string | undefined;
    const code = feature.properties?.lsoa11cd as string | undefined;
    const colour = IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047";
    const pct = score != null ? `${(score * 100).toFixed(1)}%` : "?";
    (layer as L.Path).bindPopup(
      `<div style="font-size:11px;color:#E2E8F0">
        <b style="color:${colour}">Income Decile ${decile ?? "?"}/10</b><br/>
        <span style="font-size:10px">Income-deprived: ${pct} of population</span><br/>
        ${name ?? "Unknown LSOA"}<br/>
        <span style="color:#94A3B8;font-size:10px">${code ?? ""}</span>
      </div>`,
      { className: "propval-popup" }
    );
  }, []);

  const onEachEducation = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const decile = feature.properties?.EduDec as number | undefined;
    const score = feature.properties?.EduScore as number | undefined;
    const name = feature.properties?.lsoa11nm as string | undefined;
    const code = feature.properties?.lsoa11cd as string | undefined;
    const colour = IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047";
    (layer as L.Path).bindPopup(
      `<div style="font-size:11px;color:#E2E8F0">
        <b style="color:${colour}">Education Decile ${decile ?? "?"}/10</b><br/>
        <span style="font-size:10px">Education score: ${score?.toFixed(2) ?? "?"}</span><br/>
        ${name ?? "Unknown LSOA"}<br/>
        <span style="color:#94A3B8;font-size:10px">${code ?? ""}</span>
      </div>`,
      { className: "propval-popup" }
    );
  }, []);

  const onEachLandUse = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const landuse = (feature.properties?.landuse ?? feature.properties?.leisure) as string;
    const name = feature.properties?.name as string | undefined;
    const style = LANDUSE_STYLES[landuse] ?? LANDUSE_STYLES.commercial;
    const label = name ? `<b>${name}</b><br/>${style.label}` : style.label;
    (layer as L.Path).bindPopup(
      `<div style="font-size:11px;color:#E2E8F0">${label}</div>`,
      { className: "propval-popup" }
    );
  }, []);

  const subjectIcon = useMemo(() => L.divIcon({
    className: "",
    html: `<div style="
      width:24px;height:24px;border-radius:50%;
      background:radial-gradient(circle at 35% 35%, #67E8F9, #00F0FF);
      border:2.5px solid #fff;
      box-shadow:0 0 12px #00F0FF,0 0 28px #00F0FF66;
      animation:pulse-cyan 2s ease-in-out infinite;
    "></div>`,
    iconSize:    [24, 24],
    iconAnchor:  [12, 12],
    popupAnchor: [0, -16],
  }), []);

  const compIcon = useMemo(() => L.divIcon({
    className: "",
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:radial-gradient(circle at 35% 35%, #FF6FA3, #FF2D78);
      border:2px solid #fff;
      box-shadow:0 0 8px #FF2D78,0 0 16px #FF2D7866;
    "></div>`,
    iconSize:    [16, 16],
    iconAnchor:  [8, 8],
    popupAnchor: [0, -12],
  }), []);

  const tile = TILE_LAYERS[tileLayer];

  return (
    <div data-map-wrapper style={{ position: "relative", height: "100%" }}>

      {/* Inject pulse animation + hide default Leaflet chrome */}
      <style>{`
        @keyframes pulse-cyan {
          0%, 100% { box-shadow: 0 0 12px #00F0FF, 0 0 28px #00F0FF66; }
          50% { box-shadow: 0 0 20px #00F0FF, 0 0 44px #00F0FFAA; }
        }
        .propval-popup .leaflet-popup-content-wrapper {
          background: #111827 !important;
          color: #E2E8F0 !important;
          border: 1px solid #334155 !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.6), 0 0 15px #00F0FF22 !important;
        }
        .propval-popup .leaflet-popup-tip {
          background: #111827 !important;
          border: 1px solid #334155 !important;
        }
        .propval-popup .leaflet-popup-close-button {
          color: #94A3B8 !important;
        }
        .propval-popup .leaflet-popup-close-button:hover {
          color: #00F0FF !important;
        }
        /* Hide default Leaflet attribution & zoom controls */
        .leaflet-control-attribution { display: none !important; }
        .leaflet-control-zoom { display: none !important; }
      `}</style>

      {/* ── Floating: tile switcher + fullscreen (top-left row) ────────── */}
      <div style={{
        position: "absolute", top: 12, left: 12, zIndex: 1000,
        display: "flex", gap: 6, alignItems: "center",
      }}>
      <div style={{
        display: "flex", gap: 2,
        background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
        borderRadius: 8, border: "1px solid #334155",
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        overflow: "hidden",
      }}>
        {(["dark", "satellite", "street"] as TileLayerKey[]).map(key => (
          <button
            key={key}
            onClick={() => setTileLayer(key)}
            style={{
              padding: "5px 10px", fontSize: 10, fontWeight: 600,
              letterSpacing: "0.05em", textTransform: "uppercase",
              cursor: "pointer", border: "none",
              background: tileLayer === key ? "#00F0FF" : "transparent",
              color: tileLayer === key ? "#0A0E1A" : "#94A3B8",
              transition: "all 0.2s",
            }}
          >
            {key}
          </button>
        ))}
      </div>
      {/* Fullscreen button */}
      <button
        onClick={() => {
          const container = document.querySelector("[data-map-wrapper]") as HTMLElement;
          if (!container) return;
          if (!document.fullscreenElement) container.requestFullscreen();
          else document.exitFullscreen();
        }}
        title="Fullscreen"
        style={{
          background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
          color: "#E2E8F0",
          border: "1px solid #334155", borderRadius: 8,
          width: 32, height: 32, fontSize: 16,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
          flexShrink: 0,
        }}
      >
        ⊞
      </button>
      </div>

      {/* ── Floating: layer toggle buttons (top-right) ───────────────────── */}
      <div style={{
        position: "absolute", top: 12, right: 12, zIndex: 1000,
        display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end",
        maxWidth: 320,
      }}>
        <ToggleBtn label="Flood" active={showFlood} color="#FF2D78" onClick={() => setShowFlood(!showFlood)} />
        <ToggleBtn label="Land Use" active={showLandUse} color="#FBBF24" onClick={() => setShowLandUse(!showLandUse)} />
        <ToggleBtn label="Deprivation" active={showDeprivation} color="#F97316" onClick={() => setShowDeprivation(!showDeprivation)} />
        <ToggleBtn label="Road Noise" active={showRoadNoise} color="#EF4444" onClick={() => setShowRoadNoise(!showRoadNoise)} />
        <ToggleBtn label="Rail Noise" active={showRailNoise} color="#A855F7" onClick={() => setShowRailNoise(!showRailNoise)} />
        <ToggleBtn label="Income" active={showIncome} color="#22C55E" onClick={() => setShowIncome(!showIncome)} />
        <ToggleBtn label="Education" active={showEducation} color="#3B82F6" onClick={() => setShowEducation(!showEducation)} />
        <ToggleBtn label="Crime" active={showCrime} color="#DC2626" onClick={() => setShowCrime(!showCrime)} />
        <ToggleBtn label="Rings" active={showRings} color="#7B2FBE" onClick={() => setShowRings(!showRings)} />
      </div>

      <MapContainer
        key={`map-${subjectLat}-${subjectLon}`}
        center={[subjectLat, subjectLon]}
        zoom={15}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url={tile.url}
          attribution={tile.attribution}
          subdomains={tile.subdomains || undefined}
          maxZoom={19}
        />

        <CustomScaleBar />
        <FitBounds subject={[subjectLat, subjectLon]} compCoords={compCoords} />
        {/* Fullscreen control moved to floating top-left row */}

        <DeferredOverlays
          showFlood={showFlood} showRoadNoise={showRoadNoise} showRailNoise={showRailNoise}
          showDeprivation={showDeprivation} imdData={imdData} imdKey={imdKey} onEachImd={onEachImd}
          showIncome={showIncome} incomeData={incomeData} incomeKey={incomeKey} onEachIncome={onEachIncome}
          showEducation={showEducation} educationData={educationData} educationKey={educationKey} onEachEducation={onEachEducation}
          showLandUse={showLandUse} landUseData={landUseData} landUseKey={landUseKey} onEachLandUse={onEachLandUse}
          showRings={showRings} subjectLat={subjectLat} subjectLon={subjectLon}
          showCrime={showCrime} crimeData={crimeData}
        />

        {/* Subject property marker */}
        <Marker position={[subjectLat, subjectLon]} icon={subjectIcon}>
          <Popup className="propval-popup" minWidth={220}>
            <div style={{ fontSize: 10, color: "#00F0FF", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>
              Subject Property
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, lineHeight: 1.4, color: "#E2E8F0" }}>
              {subjectAddress}
            </div>
            {subjectEpc && (
              <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>EPC</span>
                <span style={{ fontWeight: 700, color: "#39FF14", fontSize: 13 }}>{subjectEpc}</span>
              </div>
            )}
            {subjectFloodRisk && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Flood</span>
                <span style={{ fontWeight: 600, color: floodColour(subjectFloodRisk), fontSize: 13 }}>{subjectFloodRisk}</span>
              </div>
            )}
          </Popup>
        </Marker>

        {/* Comparable markers */}
        {adoptedComparables.map((comp, i) => {
          const coords = compCoords[comp.postcode];
          if (!coords) return null;
          const psf = fmtPsf(comp);
          return (
            <Marker key={comp.transaction_id ?? i} position={[coords.lat, coords.lon]} icon={compIcon}>
              <Popup className="propval-popup" minWidth={200}>
                <div style={{ fontSize: 10, color: "#FF2D78", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>
                  Comparable {i + 1}
                </div>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, lineHeight: 1.4, color: "#E2E8F0" }}>
                  {comp.address}
                </div>
                <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Price</span>
                  <span style={{ fontWeight: 700, color: "#E2E8F0" }}>{fmtPrice(comp.price)}</span>
                </div>
                {psf && (
                  <div style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Rate</span>
                    <span style={{ fontWeight: 600, color: "#67E8F9" }}>{psf}</span>
                  </div>
                )}
                <div style={{ marginBottom: onRemoveComparable ? 8 : 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Date</span>
                  <span style={{ color: "#E2E8F0" }}>{comp.transaction_date.slice(0, 7)}</span>
                </div>
                {onRemoveComparable && (
                  <button
                    onClick={() => onRemoveComparable(comp)}
                    style={{
                      width: "100%", padding: "5px 0", fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      background: "#FF3131", color: "#fff", border: "none",
                      borderRadius: 4, cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#E02020")}
                    onMouseLeave={e => (e.currentTarget.style.background = "#FF3131")}
                  >
                    Remove Comparable
                  </button>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* ── Floating: Legend (top-left, below scale bar) ──────────────── */}
      <div style={{
        position: "absolute", top: 100, left: 12, zIndex: 1000,
        background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
        border: "1px solid #334155", borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        padding: "8px 12px", fontSize: 10, color: "#94A3B8",
        display: "flex", flexDirection: "column", gap: 5,
        maxHeight: "calc(100% - 120px)", overflowY: "auto",
      }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748B", marginBottom: 2 }}>Legend</div>
        <LegendItem color="#00F0FF" glow label="Subject property" />
        <LegendItem color="#FF2D78" label="Comparable" />
        {showRings && <LegendItem color="#7B2FBE" dashed label="Distance rings" />}
        {showFlood && <LegendItem color="#3B82F6" filled label="Flood risk zone" />}
        {showRoadNoise && <LegendItem color="#EF4444" filled label="Road noise (Lden)" />}
        {showRailNoise && <LegendItem color="#A855F7" filled label="Rail noise (Lden)" />}
        {showIncome && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>Income Deprivation</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(d => (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 10, height: 8, borderRadius: 1, background: IMD_DECILE_COLOURS[d], opacity: 0.7 }} />
                  <span style={{ fontSize: 7, color: "#94A3B8" }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "#94A3B8" }}>
              <span>Most deprived</span>
              <span>Least</span>
            </div>
          </div>
        )}
        {showEducation && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>Education Deprivation</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(d => (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 10, height: 8, borderRadius: 1, background: IMD_DECILE_COLOURS[d], opacity: 0.7 }} />
                  <span style={{ fontSize: 7, color: "#94A3B8" }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "#94A3B8" }}>
              <span>Most deprived</span>
              <span>Least</span>
            </div>
          </div>
        )}
        {showCrime && <LegendItem color="#DC2626" label="Crime hotspot" />}
        {showDeprivation && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em" }}>IMD Deprivation</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(d => (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 10, height: 8, borderRadius: 1, background: IMD_DECILE_COLOURS[d], opacity: 0.7 }} />
                  <span style={{ fontSize: 7, color: "#94A3B8" }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "#94A3B8" }}>
              <span>Most deprived</span>
              <span>Least</span>
            </div>
          </div>
        )}
        {showLandUse && (
          <>
            <LegendItem color="#FBBF24" filled label="Retail / High Street" />
            <LegendItem color="#60A5FA" filled label="Commercial" />
            <LegendItem color="#A78BFA" filled label="Industrial" />
            <LegendItem color="#4ADE80" filled label="Park / Garden" />
            <LegendItem color="#6EE7B7" filled label="Recreation / Playground" />
            <LegendItem color="#2DD4BF" filled label="Nature Reserve" />
          </>
        )}
      </div>
    </div>
  );
}

// ── Small UI components ───────────────────────────────────────────────────────

function ToggleBtn({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 8px", fontSize: 10, fontWeight: 600,
        letterSpacing: "0.04em", cursor: "pointer", borderRadius: 6,
        background: active ? color : "rgba(10, 14, 26, 0.85)",
        backdropFilter: active ? undefined : "blur(8px)",
        color: active ? "#fff" : "#94A3B8",
        border: `1px solid ${active ? color : "#334155"}`,
        boxShadow: active ? `0 0 10px ${color}66, 0 2px 8px rgba(0,0,0,0.4)` : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "all 0.2s",
      }}
    >
      {label}
    </button>
  );
}

function LegendItem({ color, label, glow, dashed, filled }: {
  color: string; label: string; glow?: boolean; dashed?: boolean; filled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {filled ? (
        <div style={{ width: 12, height: 8, borderRadius: 2, background: color, opacity: 0.5 }} />
      ) : dashed ? (
        <div style={{ width: 12, height: 0, borderTop: `2px dashed ${color}`, opacity: 0.6 }} />
      ) : (
        <div style={{
          width: 10, height: 10, borderRadius: "50%", background: color,
          border: "1.5px solid #fff",
          boxShadow: glow ? `0 0 6px ${color}` : "none",
        }} />
      )}
      <span>{label}</span>
    </div>
  );
}

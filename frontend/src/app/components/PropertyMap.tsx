"use client";

// Leaflet CSS must be imported here (inside the dynamically-imported module) so it
// only runs client-side and is present before any Leaflet rendering begins.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

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
import "leaflet.markercluster";
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
  showHeritage: boolean; onShowHeritageChange: (v: boolean) => void;
  showTitleBoundary: boolean; onShowTitleBoundaryChange: (v: boolean) => void;
  tileLayer: TileLayerKey; onTileLayerChange: (v: TileLayerKey) => void;
  landUseCache: GeoJSON.FeatureCollection | null; onLandUseCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  imdCache: GeoJSON.FeatureCollection | null; onImdCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  incomeCache: GeoJSON.FeatureCollection | null; onIncomeCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  educationCache: GeoJSON.FeatureCollection | null; onEducationCacheChange: (v: GeoJSON.FeatureCollection | null) => void;
  crimeCache: CrimeCluster[] | null; onCrimeCacheChange: (v: CrimeCluster[] | null) => void;
  titleBoundaryData: GeoJSON.FeatureCollection | null;
  subjectInspireId: string | null;
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
  if (risk === "High")   return "var(--color-status-danger)";
  if (risk === "Medium") return "var(--color-status-warning)";
  return "var(--color-status-success)";
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
    Object.values(compCoords).forEach(c => {
      if (c.lat != null && c.lon != null && !isNaN(c.lat) && !isNaN(c.lon)) points.push([c.lat, c.lon]);
    });
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

/** Fixes grey/missing tiles when map mounts inside a hidden (display:none) container */
function InvalidateSizeOnVisible() {
  const map = useMap();
  useEffect(() => {
    // Immediate + delayed invalidation covers both instant and animated tab reveals
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 400);

    // ResizeObserver catches any later container size changes
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => { clearTimeout(t1); clearTimeout(t2); ro.disconnect(); };
  }, [map]);
  return null;
}

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
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border)", borderRadius: 8,
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
      border: "1px solid var(--color-border)", boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
      fontFamily: "var(--font-mono), monospace", fontSize: 10, color: "var(--color-text-primary)",
      userSelect: "none", pointerEvents: "none",
    }}>
      {/* Scale bar with ticks */}
      <div style={{ position: "relative", width: barPx, height: 10 }}>
        {Array.from({ length: ticks - 1 }).map((_, i) => {
          const segW = barPx / (ticks - 1);
          return (
            <div key={i} style={{
              position: "absolute", left: i * segW, top: 2, width: segW, height: 4,
              background: i % 2 === 0 ? "var(--color-accent)" : "rgba(0, 240, 255, 0.25)",
              borderLeft: i === 0 ? "1px solid var(--color-accent)" : undefined,
              borderRight: "1px solid var(--color-accent)",
            }} />
          );
        })}
        {Array.from({ length: ticks }).map((_, i) => {
          const x = (barPx / (ticks - 1)) * i;
          return (
            <div key={`t${i}`} style={{
              position: "absolute", left: x, top: 0, width: 1, height: 8,
              background: "var(--color-accent)",
            }} />
          );
        })}
      </div>
      {/* Labels row: 0 on left, metric + imperial on right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2, fontWeight: 600, letterSpacing: 0.5 }}>
        <span style={{ color: "var(--color-text-secondary)", fontSize: 8 }}>0</span>
        <span style={{ whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--color-accent)", fontSize: 9 }}>{labelM}</span>
          <span style={{ color: "var(--color-border)", margin: "0 3px" }}>|</span>
          <span style={{ color: "var(--color-accent-pink)", fontSize: 9 }}>{labelImp}</span>
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

// ── Title boundary (INSPIRE) styles ──────────────────────────────────────────

function titleBoundaryStyle(isSubject: boolean) {
  return {
    fillColor: isSubject ? "var(--color-accent)" : "var(--color-accent-pink)",
    fillOpacity: isSubject ? 0.18 : 0.10,
    color: isSubject ? "var(--color-accent)" : "var(--color-accent-pink)",
    weight: isSubject ? 2.5 : 1.5,
    opacity: isSubject ? 0.9 : 0.6,
    dashArray: isSubject ? undefined : "4 4",
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

// ── Hook: fetch listed buildings from Historic England NHLE ArcGIS ────────────

interface ListedBuildingMarker {
  listEntry: number;
  name: string;
  grade: string; // "I", "II*", "II"
  url: string;
  lat: number;
  lon: number;
}

const NHLE_URL = "https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query";

function useListedBuildings(lat: number, lon: number, enabled: boolean) {
  const [data, setData] = useState<ListedBuildingMarker[] | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!enabled || data || loadingRef.current) return;
    loadingRef.current = true;
    let cancelled = false;

    const params = new URLSearchParams({
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      outSR: "4326",
      distance: "50",
      units: "esriSRUnit_Meter",
      outFields: "ListEntry,Name,Grade,hyperlink",
      returnGeometry: "true",
      f: "json",
    });

    fetch(`${NHLE_URL}?${params}`)
      .then(r => { if (!r.ok) throw new Error(`NHLE ${r.status}`); return r.json(); })
      .then(json => {
        if (cancelled) return;
        const features = json.features ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buildings: ListedBuildingMarker[] = features
          .filter((f: { attributes: { Name?: string }; geometry?: { points?: number[][]; x?: number; y?: number } }) =>
            f.attributes?.Name && f.geometry)
          .map((f: { attributes: { ListEntry: number; Name: string; Grade: string; hyperlink: string }; geometry: { points?: number[][]; x?: number; y?: number } }) => {
            // ArcGIS returns multipoint {points:[[lon,lat]]} or point {x,y}
            const g = f.geometry;
            const lon = g.points?.[0]?.[0] ?? g.x;
            const lat = g.points?.[0]?.[1] ?? g.y;
            return {
              listEntry: f.attributes.ListEntry,
              name: f.attributes.Name.replace(/\b\w+/g, (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
              grade: f.attributes.Grade,
              url: f.attributes.hyperlink || "",
              lat: lat!,
              lon: lon!,
            };
          })
          .filter((b: ListedBuildingMarker) => b.lat != null && b.lon != null && !isNaN(b.lat) && !isNaN(b.lon));
        console.log(`[Heritage] ${buildings.length} listed buildings within 50m`);
        setData(buildings);
      })
      .catch(err => console.warn("[Heritage] fetch failed:", err))
      .finally(() => { loadingRef.current = false; });

    return () => { cancelled = true; loadingRef.current = false; };
  }, [lat, lon, enabled, data]);

  return data;
}

const GRADE_COLOURS: Record<string, { bg: string; border: string }> = {
  "I":   { bg: "var(--color-status-danger)", border: "#FF6B6B" },
  "II*": { bg: "var(--color-status-warning)", border: "#FBBF24" },
  "II":  { bg: "var(--color-status-info)", border: "var(--color-accent)" },
};

// ── Comparable cluster layer ──────────────────────────────────────────────────

function ComparableClusterLayer({
  comparables, compCoords, onRemoveComparable,
  subjectLat, subjectLon, subjectAddress, subjectEpc, subjectFloodRisk,
}: {
  comparables: ComparableCandidate[];
  compCoords: Record<string, { lat: number; lon: number }>;
  onRemoveComparable?: (comp: ComparableCandidate) => void;
  subjectLat: number;
  subjectLon: number;
  subjectAddress: string;
  subjectEpc: string | null;
  subjectFloodRisk: string | null;
}) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  // Store callback ref so popup event listeners always use latest
  const onRemoveRef = useRef(onRemoveComparable);
  onRemoveRef.current = onRemoveComparable;

  useEffect(() => {
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 35,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      animate: true,
      chunkedLoading: true,
      spiderfyDistanceMultiplier: 1.8,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        // Check if subject marker is in this cluster (has zIndexOffset 10000)
        const hasSubject = c.getAllChildMarkers().some(m => (m.options.zIndexOffset ?? 0) >= 10000);
        const bg = hasSubject
          ? "radial-gradient(circle at 35% 35%, var(--color-status-info), var(--color-accent))"
          : "radial-gradient(circle at 35% 35%, #FF6FA3, var(--color-accent-pink))";
        const shadow = hasSubject ? "var(--color-accent)" : "var(--color-accent-pink)";
        return L.divIcon({
          className: "",
          html: `<div style="
            width:26px;height:26px;border-radius:50%;
            background:${bg};
            border:2px solid #fff;
            box-shadow:0 0 10px ${shadow},0 0 20px ${shadow}66;
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:800;color:#fff;
          ">${count}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
      },
    });

    const compIcon = L.divIcon({
      className: "",
      html: `<div style="
        width:16px;height:16px;border-radius:50%;
        background:radial-gradient(circle at 35% 35%, #FF6FA3, var(--color-accent-pink));
        border:2px solid #fff;
        box-shadow:0 0 8px var(--color-accent-pink),0 0 16px color-mix(in srgb, var(--color-accent-pink) 40%, transparent);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -12],
    });

    comparables.forEach((comp, i) => {
      // Prefer building-level coords (keyed by transaction_id) over postcode centroid
      const coords = compCoords[comp.transaction_id || comp.postcode] || compCoords[comp.postcode];
      if (!coords || coords.lat == null || coords.lon == null) return;

      const marker = L.marker([coords.lat, coords.lon], { icon: compIcon });
      const psf = comp.floor_area_sqm
        ? "£" + Math.round(comp.price / (comp.floor_area_sqm * 10.764)).toLocaleString("en-GB") + "/sqft"
        : null;
      const price = "£" + comp.price.toLocaleString("en-GB");
      const removeId = `remove-comp-${comp.transaction_id ?? i}`;

      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:270px;max-width:340px">
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--color-accent-pink);text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Comp ${i + 1}</span>
            <span style="font-weight:700;font-size:16px;color:var(--color-text-primary)">${price}</span>
            ${psf ? `<span style="font-size:14px;color:var(--color-status-info);font-weight:600">${psf}</span>` : ""}
            <span style="font-size:14px;color:var(--color-text-secondary)">${comp.transaction_date.slice(0, 7)}</span>
          </div>
          <div style="font-size:14px;line-height:1.3;color:var(--color-text-primary);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${comp.address}</div>
          ${process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY
            ? `<div style="width:100%;height:180px;margin-bottom:${onRemoveRef.current ? 8 : 0}px;border-radius:8px;overflow:hidden;background:#1a1a2e">
                <iframe
                  width="100%" height="100%" style="border:none;display:block"
                  loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                  src="https://www.google.com/maps/embed/v1/streetview?location=${coords.lat},${coords.lon}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY}">
                </iframe>
              </div>`
            : `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coords.lat},${coords.lon}" target="_blank" rel="noopener noreferrer" style="
                display:inline-flex;align-items:center;gap:6px;margin-top:6px;margin-bottom:${onRemoveRef.current ? 10 : 0}px;
                font-size:14px;font-weight:700;color:var(--color-status-warning);text-decoration:none;
                text-transform:uppercase;letter-spacing:0.06em;
              ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                Street View
              </a>`
          }
          ${onRemoveRef.current ? `<button id="${removeId}" style="
            width:100%;padding:7px 0;font-size:13px;font-weight:700;
            text-transform:uppercase;letter-spacing:0.06em;
            background:var(--color-status-danger);color:#fff;border:none;
            border-radius:6px;cursor:pointer;
          ">Remove Comparable</button>` : ""}
        </div>`,
        { className: "propval-popup", maxWidth: 350, autoPanPadding: L.point(40, 40), autoPan: true, closeOnClick: false }
      );

      if (onRemoveRef.current) {
        marker.on("popupopen", () => {
          const btn = document.getElementById(removeId);
          if (btn) {
            btn.onclick = () => {
              onRemoveRef.current?.(comp);
              map.closePopup();
            };
          }
        });
      }

      cluster.addLayer(marker);
    });

    // Add subject property marker into the same cluster group
    const sIcon = L.divIcon({
      className: "",
      html: `<div style="
        width:24px;height:24px;border-radius:50%;
        background:radial-gradient(circle at 35% 35%, var(--color-status-info), var(--color-accent));
        border:2.5px solid #fff;
        box-shadow:0 0 12px var(--color-accent),0 0 28px color-mix(in srgb, var(--color-accent) 40%, transparent);
        animation:pulse-cyan 2s ease-in-out infinite;
      "></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -16],
    });
    const subjectMarker = L.marker([subjectLat, subjectLon], { icon: sIcon, zIndexOffset: 10000 });
    const floodBadge = subjectFloodRisk
      ? `<span style="font-size:10px;font-weight:600;color:${subjectFloodRisk === "High" ? "var(--color-status-danger)" : subjectFloodRisk === "Medium" ? "var(--color-status-warning)" : "var(--color-status-success)"}">${subjectFloodRisk}</span>` : "";
    const epcBadge = subjectEpc
      ? `<span style="font-size:10px;font-weight:700;color:var(--color-status-success)">${subjectEpc}</span>` : "";
    const badges = [epcBadge, floodBadge].filter(Boolean).join('<span style="color:var(--color-border);margin:0 4px">·</span>');
    subjectMarker.bindPopup(
      `<div style="font-family:system-ui;min-width:270px;max-width:340px">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--color-accent);text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Subject</span>
          ${badges}
        </div>
        <div style="font-size:14px;line-height:1.3;color:var(--color-text-primary);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${subjectAddress}</div>
        ${process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY
          ? `<div style="width:100%;height:180px;border-radius:8px;overflow:hidden;background:#1a1a2e">
              <iframe
                width="100%" height="100%" style="border:none;display:block"
                loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                src="https://www.google.com/maps/embed/v1/streetview?location=${subjectLat},${subjectLon}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY}">
              </iframe>
            </div>`
          : `<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${subjectLat},${subjectLon}" target="_blank" rel="noopener noreferrer" style="
              display:inline-flex;align-items:center;gap:6px;margin-top:10px;
              font-size:14px;font-weight:700;color:var(--color-status-warning);text-decoration:none;
              text-transform:uppercase;letter-spacing:0.06em;
            ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-status-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              Street View
            </a>`
        }
      </div>`,
      { className: "propval-popup", maxWidth: 350, autoPanPadding: L.point(40, 40), autoPan: true, closeOnClick: false }
    );
    cluster.addLayer(subjectMarker);

    // Close popups that auto-open during spiderfy animation (marker lands under cursor),
    // but only if the popup opened within the spiderfy animation window (not user-initiated).
    let spiderfyTime = 0;
    cluster.on("spiderfied", () => { spiderfyTime = Date.now(); });
    cluster.on("popupopen", () => {
      if (Date.now() - spiderfyTime < 300) {
        setTimeout(() => map.closePopup(), 50);
      }
    });

    map.addLayer(cluster);
    clusterRef.current = cluster;

    return () => {
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  // Only rebuild when comparables or coords actually change — subject props are stable per property
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, comparables, compCoords, subjectLat, subjectLon]);

  return null;
}

// ── Heritage cluster layer ───────────────────────────────────────────────────

function HeritageClusterLayer({ buildings }: { buildings: ListedBuildingMarker[] }) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }
    if (buildings.length === 0) return;

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 30,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      animate: true,
      chunkedLoading: true,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        // Check highest grade in cluster
        const markers = c.getAllChildMarkers();
        let hasGradeI = false;
        let hasGradeIIStar = false;
        markers.forEach(m => {
          const g = (m.options as { grade?: string }).grade;
          if (g === "I") hasGradeI = true;
          if (g === "II*") hasGradeIIStar = true;
        });
        const color = hasGradeI ? "var(--color-status-danger)" : hasGradeIIStar ? "var(--color-status-warning)" : "var(--color-status-info)";
        return L.divIcon({
          className: "",
          html: `<div style="
            width:24px;height:24px;border-radius:4px;
            background:${color};color:var(--color-bg-base);
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:800;
            border:2px solid #fff;
            box-shadow:0 0 8px ${color}88;
            transform:rotate(45deg);
          "><span style="transform:rotate(-45deg)">${count}</span></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
      },
    });

    buildings.forEach(b => {
      if (b.lat == null || b.lon == null || isNaN(b.lat) || isNaN(b.lon)) return;
      const gc = GRADE_COLOURS[b.grade] ?? GRADE_COLOURS["II"];
      const icon = L.divIcon({
        className: "",
        html: `<div style="
          width:12px;height:12px;
          background:${gc.bg};
          border:1.5px solid ${gc.border};
          border-radius:2px;
          box-shadow:0 0 6px ${gc.bg}88;
          transform:rotate(45deg);
        "></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -10],
      });
      const marker = L.marker([b.lat, b.lon], { icon, grade: b.grade } as L.MarkerOptions);
      marker.bindPopup(
        `<div style="font-family:system-ui;min-width:180px">
          <div style="font-size:10px;color:${gc.bg};text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:4px">
            Grade ${b.grade} Listed
          </div>
          <div style="font-weight:600;font-size:12px;margin-bottom:6px;line-height:1.4;color:var(--color-text-primary)">
            ${b.name}
          </div>
          <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:${b.url ? 6 : 0}px">
            List Entry: ${b.listEntry}
          </div>
          ${b.url ? `<a href="${b.url}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:var(--color-accent);text-decoration:underline">View on Historic England</a>` : ""}
        </div>`,
        { className: "propval-popup" }
      );
      cluster.addLayer(marker);
    });

    map.addLayer(cluster);
    clusterRef.current = cluster;

    return () => {
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  }, [map, buildings]);

  return null;
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
    color: "var(--color-border)",
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
    color: "var(--color-border)",
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
    color: "var(--color-border)",
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
            font-size:9px;font-weight:700;color:var(--color-accent-purple-text);
            text-shadow:0 0 4px var(--color-accent-purple),0 1px 2px #000;
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
                color: "var(--color-accent-purple-text)", weight: 2, opacity: 0.8,
                fillColor: "var(--color-accent-purple)", fillOpacity: 0.03, dashArray: ring.dash,
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
              <div style={{ fontSize: 11, color: "var(--color-text-primary)" }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "#FF6B6B" }}>
                  {cluster.count} crime{cluster.count > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 6 }}>
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
  showHeritage, onShowHeritageChange: setShowHeritage,
  showTitleBoundary, onShowTitleBoundaryChange: setShowTitleBoundary,
  tileLayer, onTileLayerChange: setTileLayer,
  landUseCache, onLandUseCacheChange,
  imdCache, onImdCacheChange,
  incomeCache, onIncomeCacheChange,
  educationCache, onEducationCacheChange,
  crimeCache, onCrimeCacheChange,
  titleBoundaryData,
  subjectInspireId,
}: PropertyMapProps) {
  const { geojson: landUseData, geoKey: landUseKey } = useLandUseGeoJSON(subjectLat, subjectLon, showLandUse, landUseCache, onLandUseCacheChange);
  const { geojson: imdData, geoKey: imdKey } = useImdGeoJSON(subjectLat, subjectLon, showDeprivation, imdCache, onImdCacheChange);
  const { geojson: incomeData, geoKey: incomeKey } = useIncomeGeoJSON(subjectLat, subjectLon, showIncome, incomeCache, onIncomeCacheChange);
  const { geojson: educationData, geoKey: educationKey } = useEducationGeoJSON(subjectLat, subjectLon, showEducation, educationCache, onEducationCacheChange);
  const crimeData = useCrimeData(subjectLat, subjectLon, showCrime, crimeCache, onCrimeCacheChange);
  const heritageData = useListedBuildings(subjectLat, subjectLon, showHeritage);

  // Toggle counters — force full Leaflet layer re-creation each time a layer is toggled on,
  // preventing stale event bindings that cause click/popup glitches on GeoJSON features.
  const [luToggle, setLuToggle] = useState(0);
  const [imdToggle, setImdToggle] = useState(0);
  const [incToggle, setIncToggle] = useState(0);
  const [eduToggle, setEduToggle] = useState(0);
  useEffect(() => { if (showLandUse) setLuToggle(n => n + 1); }, [showLandUse]);
  useEffect(() => { if (showDeprivation) setImdToggle(n => n + 1); }, [showDeprivation]);
  useEffect(() => { if (showIncome) setIncToggle(n => n + 1); }, [showIncome]);
  useEffect(() => { if (showEducation) setEduToggle(n => n + 1); }, [showEducation]);

  const onEachImd = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const decile = feature.properties?.IMDDec0 as number | undefined;
    const name = feature.properties?.ls11nm as string | undefined;
    const code = feature.properties?.ls11cd as string | undefined;
    const colour = IMD_DECILE_COLOURS[decile ?? 5] ?? "#FDE047";
    (layer as L.Path).bindPopup(
      `<div style="font-size:11px;color:var(--color-text-primary)">
        <b style="color:${colour}">IMD Decile ${decile ?? "?"}/10</b><br/>
        ${name ?? "Unknown LSOA"}<br/>
        <span style="color:var(--color-text-secondary);font-size:10px">${code ?? ""}</span>
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
      `<div style="font-size:11px;color:var(--color-text-primary)">
        <b style="color:${colour}">Income Decile ${decile ?? "?"}/10</b><br/>
        <span style="font-size:10px">Income-deprived: ${pct} of population</span><br/>
        ${name ?? "Unknown LSOA"}<br/>
        <span style="color:var(--color-text-secondary);font-size:10px">${code ?? ""}</span>
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
      `<div style="font-size:11px;color:var(--color-text-primary)">
        <b style="color:${colour}">Education Decile ${decile ?? "?"}/10</b><br/>
        <span style="font-size:10px">Education score: ${score?.toFixed(2) ?? "?"}</span><br/>
        ${name ?? "Unknown LSOA"}<br/>
        <span style="color:var(--color-text-secondary);font-size:10px">${code ?? ""}</span>
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
      `<div style="font-size:11px;color:var(--color-text-primary)">${label}</div>`,
      { className: "propval-popup" }
    );
    // Prevent click events from bubbling to layers below, which causes
    // popups to fail when multiple polygon overlays are stacked.
    (layer as L.Path).on("click", (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
    });
  }, []);

  // Title boundary (INSPIRE) style + popup per feature
  const titleBoundaryKey = useMemo(() => titleBoundaryData?.features?.length ?? 0, [titleBoundaryData]);

  const titleBoundaryStyleFn = useCallback((feature: GeoJSON.Feature | undefined) => {
    const iid = feature?.properties?.inspire_id;
    const isSubject = iid != null && iid === subjectInspireId;
    return titleBoundaryStyle(isSubject);
  }, [subjectInspireId]);

  const onEachTitleBoundary = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const area = feature.properties?.area_sqm as number | undefined;
    const label = feature.properties?.label as string | undefined;
    const iid = feature.properties?.inspire_id;
    const isSubject = iid != null && iid === subjectInspireId;
    const areaStr = area != null ? `${area.toLocaleString("en-GB", { maximumFractionDigits: 0 })} m²` : "—";
    const acresStr = area != null ? `${(area / 4047).toFixed(2)} acres` : "";
    const tag = isSubject
      ? '<span style="color:var(--color-accent);font-weight:bold">Subject Property</span>'
      : '<span style="color:var(--color-accent-pink)">Comparable</span>';
    (layer as L.Path).bindPopup(
      `<div style="font-size:11px;color:var(--color-text-primary)">
        ${tag}<br/>
        ${label ? `<b>${label}</b><br/>` : ""}
        <span style="font-size:10px">Site area: ${areaStr}</span><br/>
        ${acresStr ? `<span style="font-size:10px;color:var(--color-text-secondary)">${acresStr}</span>` : ""}
      </div>`,
      { className: "propval-popup" }
    );
  }, [subjectInspireId]);

  const tile = TILE_LAYERS[tileLayer];

  return (
    <div data-map-wrapper style={{ position: "relative", height: "100%" }}>

      {/* Inject pulse animation + hide default Leaflet chrome */}
      <style>{`
        @keyframes pulse-cyan {
          0%, 100% { box-shadow: 0 0 12px var(--color-accent), 0 0 28px color-mix(in srgb, var(--color-accent) 40%, transparent); }
          50% { box-shadow: 0 0 20px var(--color-accent), 0 0 44px color-mix(in srgb, var(--color-accent) 67%, transparent); }
        }
        .propval-popup .leaflet-popup-content-wrapper {
          background: var(--color-bg-panel) !important;
          color: var(--color-text-primary) !important;
          border: 1px solid var(--color-border) !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.6), 0 0 15px color-mix(in srgb, var(--color-accent) 13%, transparent) !important;
        }
        .propval-popup .leaflet-popup-tip {
          background: var(--color-bg-panel) !important;
          border: 1px solid var(--color-border) !important;
        }
        .propval-popup .leaflet-popup-close-button {
          color: var(--color-text-secondary) !important;
        }
        .propval-popup .leaflet-popup-close-button:hover {
          color: var(--color-accent) !important;
        }
        /* Hide default Leaflet attribution & zoom controls */
        .leaflet-control-attribution { display: none !important; }
        .leaflet-control-zoom { display: none !important; }
        /* Override default MarkerCluster styles — we use custom iconCreateFunction */
        .marker-cluster-small, .marker-cluster-medium, .marker-cluster-large {
          background: transparent !important;
        }
        .marker-cluster-small div, .marker-cluster-medium div, .marker-cluster-large div {
          background: transparent !important;
        }
        .leaflet-cluster-anim .leaflet-marker-icon, .leaflet-cluster-anim .leaflet-marker-shadow {
          transition: transform 0.25s ease-out, opacity 0.25s ease-out;
        }
      `}</style>

      {/* ── Floating: tile switcher + fullscreen (top-left row) ────────── */}
      <div style={{
        position: "absolute", top: 12, left: 12, zIndex: 1000,
        display: "flex", gap: 6, alignItems: "center",
      }}>
      <div style={{
        display: "flex", gap: 2,
        background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
        borderRadius: 8, border: "1px solid var(--color-border)",
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
              background: tileLayer === key ? "var(--color-accent)" : "transparent",
              color: tileLayer === key ? "var(--color-bg-base)" : "var(--color-text-secondary)",
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
          color: "var(--color-text-primary)",
          border: "1px solid var(--color-border)", borderRadius: 8,
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
        maxWidth: 380,
      }}>
        <ToggleBtn label="Flood" active={showFlood} color="var(--color-accent-pink)" onClick={() => setShowFlood(!showFlood)} />
        <ToggleBtn label="Land Use" active={showLandUse} color="#FBBF24" onClick={() => setShowLandUse(!showLandUse)} />
        <ToggleBtnGroup label="Noise" color="#EF4444" active={showRoadNoise || showRailNoise}>
          <ToggleBtn label="Road Noise" active={showRoadNoise} color="#EF4444" onClick={() => setShowRoadNoise(!showRoadNoise)} />
          <ToggleBtn label="Rail Noise" active={showRailNoise} color="#A855F7" onClick={() => setShowRailNoise(!showRailNoise)} />
        </ToggleBtnGroup>
        <ToggleBtnGroup label="Deprivation" color="#F97316" active={showDeprivation || showIncome || showEducation}>
          <ToggleBtn label="Overall IMD" active={showDeprivation} color="#F97316" onClick={() => setShowDeprivation(!showDeprivation)} />
          <ToggleBtn label="Income" active={showIncome} color="#22C55E" onClick={() => setShowIncome(!showIncome)} />
          <ToggleBtn label="Education" active={showEducation} color="#3B82F6" onClick={() => setShowEducation(!showEducation)} />
        </ToggleBtnGroup>
        <ToggleBtn label="Crime" active={showCrime} color="#DC2626" onClick={() => setShowCrime(!showCrime)} />
        <ToggleBtn label="Heritage" active={showHeritage} color="var(--color-status-warning)" onClick={() => setShowHeritage(!showHeritage)} />
        <ToggleBtn label="Title" active={showTitleBoundary} color="var(--color-accent)" onClick={() => setShowTitleBoundary(!showTitleBoundary)} />
        <ToggleBtn label="Rings" active={showRings} color="var(--color-accent-purple)" onClick={() => setShowRings(!showRings)} />
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
          {...(tile.subdomains ? { subdomains: tile.subdomains } : {})}
          maxZoom={19}
        />

        <InvalidateSizeOnVisible />
        <CustomScaleBar />
        <FitBounds subject={[subjectLat, subjectLon]} compCoords={compCoords} />
        {/* Fullscreen control moved to floating top-left row */}

        <DeferredOverlays
          showFlood={showFlood} showRoadNoise={showRoadNoise} showRailNoise={showRailNoise}
          showDeprivation={showDeprivation} imdData={imdData} imdKey={imdKey + imdToggle * 1000} onEachImd={onEachImd}
          showIncome={showIncome} incomeData={incomeData} incomeKey={incomeKey + incToggle * 1000} onEachIncome={onEachIncome}
          showEducation={showEducation} educationData={educationData} educationKey={educationKey + eduToggle * 1000} onEachEducation={onEachEducation}
          showLandUse={showLandUse} landUseData={landUseData} landUseKey={landUseKey + luToggle * 1000} onEachLandUse={onEachLandUse}
          showRings={showRings} subjectLat={subjectLat} subjectLon={subjectLon}
          showCrime={showCrime} crimeData={crimeData}
        />

        {/* Title boundary polygons (INSPIRE freehold extents) */}
        {showTitleBoundary && titleBoundaryData && titleBoundaryData.features && titleBoundaryData.features.length > 0 && (
          <GeoJSON key={`tb-${titleBoundaryKey}`} data={titleBoundaryData} style={titleBoundaryStyleFn} onEachFeature={onEachTitleBoundary} />
        )}

        {/* Subject + Comparable markers — clustered together */}
        <ComparableClusterLayer
          comparables={adoptedComparables}
          compCoords={compCoords}
          onRemoveComparable={onRemoveComparable}
          subjectLat={subjectLat}
          subjectLon={subjectLon}
          subjectAddress={subjectAddress}
          subjectEpc={subjectEpc ?? null}
          subjectFloodRisk={subjectFloodRisk ?? null}
        />

        {/* Listed buildings (Heritage) — clustered */}
        {showHeritage && heritageData && heritageData.length > 0 && (
          <HeritageClusterLayer buildings={heritageData} />
        )}
      </MapContainer>

      {/* ── Floating: Legend (top-left, below scale bar) ──────────────── */}
      <div style={{
        position: "absolute", top: 100, left: 12, zIndex: 1000,
        background: "rgba(10, 14, 26, 0.85)", backdropFilter: "blur(8px)",
        border: "1px solid var(--color-border)", borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
        padding: "8px 12px", fontSize: 10, color: "var(--color-text-secondary)",
        display: "flex", flexDirection: "column", gap: 5,
        maxHeight: "calc(100% - 120px)", overflowY: "auto",
      }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-text-muted)", marginBottom: 2 }}>Legend</div>
        <LegendItem color="var(--color-accent)" glow label="Subject property" />
        <LegendItem color="var(--color-accent-pink)" label="Comparable" />
        {showTitleBoundary && <LegendItem color="var(--color-accent)" filled label="Title boundary" />}
        {showRings && <LegendItem color="var(--color-accent-purple)" dashed label="Distance rings" />}
        {showFlood && <LegendItem color="#3B82F6" filled label="Flood risk zone" />}
        {showRoadNoise && <LegendItem color="#EF4444" filled label="Road noise (Lden)" />}
        {showRailNoise && <LegendItem color="#A855F7" filled label="Rail noise (Lden)" />}
        {showIncome && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Income Deprivation</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(d => (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 10, height: 8, borderRadius: 1, background: IMD_DECILE_COLOURS[d], opacity: 0.7 }} />
                  <span style={{ fontSize: 7, color: "var(--color-text-secondary)" }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "var(--color-text-secondary)" }}>
              <span>Most deprived</span>
              <span>Least</span>
            </div>
          </div>
        )}
        {showEducation && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Education Deprivation</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(d => (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 10, height: 8, borderRadius: 1, background: IMD_DECILE_COLOURS[d], opacity: 0.7 }} />
                  <span style={{ fontSize: 7, color: "var(--color-text-secondary)" }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "var(--color-text-secondary)" }}>
              <span>Most deprived</span>
              <span>Least</span>
            </div>
          </div>
        )}
        {showCrime && <LegendItem color="#DC2626" label="Crime hotspot" />}
        {showHeritage && (
          <>
            <LegendItem color="var(--color-status-danger)" label="Grade I Listed" />
            <LegendItem color="var(--color-status-warning)" label="Grade II* Listed" />
            <LegendItem color="var(--color-status-info)" label="Grade II Listed" />
          </>
        )}
        {showDeprivation && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>IMD Deprivation</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(d => (
                <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: 10, height: 8, borderRadius: 1, background: IMD_DECILE_COLOURS[d], opacity: 0.7 }} />
                  <span style={{ fontSize: 7, color: "var(--color-text-secondary)" }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "var(--color-text-secondary)" }}>
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

function ToggleBtnGroup({ label, color, active, children }: {
  label: string; color: string; active: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 200);
  };

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        style={{
          padding: "4px 8px", fontSize: 10, fontWeight: 600,
          letterSpacing: "0.04em", cursor: "pointer", borderRadius: 6,
          background: active ? color : "rgba(10, 14, 26, 0.85)",
          backdropFilter: active ? undefined : "blur(8px)",
          color: active ? "#fff" : "var(--color-text-secondary)",
          border: `1px solid ${active ? color : "var(--color-border)"}`,
          boxShadow: active ? `0 0 10px ${color}66, 0 2px 8px rgba(0,0,0,0.4)` : "0 2px 8px rgba(0,0,0,0.3)",
          transition: "all 0.2s",
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        {label}
        <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0,
          display: "flex", flexDirection: "column", gap: 3,
          background: "rgba(10, 14, 26, 0.95)", backdropFilter: "blur(12px)",
          border: "1px solid var(--color-border)", borderRadius: 8,
          padding: 4, minWidth: 110,
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
          zIndex: 1001,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

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
        color: active ? "#fff" : "var(--color-text-secondary)",
        border: `1px solid ${active ? color : "var(--color-border)"}`,
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

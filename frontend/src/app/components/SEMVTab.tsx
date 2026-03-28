"use client";
import { useMemo, useState, useRef, useCallback } from "react";
import { fmtK, fmtPsf, fmtDateShort } from "@/lib/formatters";
import { computeAdjFactor, computeSizeAdj } from "@/lib/hpi-adjustments";
import { scorePool, type ScoredComparable, type ScoreBreakdown } from "@/lib/comp-scoring";
import { API_BASE } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────
interface ComparableCandidate {
  transaction_id: string | null;
  address: string;
  postcode: string;
  property_type: string | null;
  house_sub_type: string | null;
  floor_area_sqm: number | null;
  price: number;
  transaction_date: string;
  bedrooms: number | null;
  epc_score: number | null;
  [key: string]: unknown;
}

type HpiTrendSlice = {
  month: string;
  hpi_all: number | null;
  hpi_flat: number | null;
  hpi_semi: number | null;
  hpi_detached: number | null;
  hpi_terraced: number | null;
};

// ── Auto-select MC result types ──
interface AutoSelectComp {
  transaction_id: string | null;
  address: string;
  price: number;
  floor_area_sqm: number;
  raw_psf: number;
  time_adj_pct: number;
  size_adj_pct: number;
  rooms_adj_pct: number;
  epc_adj_pct: number;
  imd_adj_pct: number;
  age_adj_pct: number;
  total_adj_pct: number;
  adjusted_psf: number;
  implied_mv: number;
  similarity: number;
}

interface AutoSelectResult {
  iterations: number;
  best_5: AutoSelectComp[];
  valuation: {
    median: number;
    mean: number;
    mode: number;
    p5: number;
    p10: number;
    p15: number;
    p25: number;
    p75: number;
    p85: number;
    p90: number;
    p95: number;
    std: number;
    iterations_valid: number;
  };
  histogram: { bin_center: number; count: number; density: number }[];
  selection_frequency: { transaction_id: string; address: string; frequency: number; similarity: number }[];
  coefficients_used: { borough: string; property_type: string; mdape: number; coefficients: Record<string, number> };
  elapsed_ms: number;
}

interface SEMVTabProps {
  layer1Comps: ComparableCandidate[];
  adoptedComparables: ComparableCandidate[];
  adoptedMV: number | null;
  subjectSizeSqft: number | null;
  hpiTrend: HpiTrendSlice[];
  valuationDate: string;
  subjectPropertyType: string | null;
  subjectHouseSubType: string | null;
  subjectEpcScore: number | null;
  subjectSaon: string | null;
  subjectAreaM2: number | null;
  subjectBedrooms: number | null;
  subjectBuildYear: number | null;
  subjectImdDecile: number | null;
  subjectAddress: string | null;
  subjectPostcode: string | null;
  subjectTenure: string | null;
  boroughSlug: string | null;
  accessToken: string | null;
  planningExtensions: { has_extension: boolean; extensions: { reference: string; description: string; decision_date: string; extension_types: string[]; estimated_sqm: number }[]; total_additional_sqm: number } | null;
  savedAutoSelectResult: AutoSelectResult | null;
  onAutoSelectResult: (result: AutoSelectResult | null) => void;
  hpiCorrelation: number;
  onHpiCorrelationChange: (v: number) => void;
  compSizeElasticity: number;
  onCompSizeElasticityChange: (v: number) => void;
  epcBeta: number;
  onEpcBetaChange: (v: number) => void;
  floorPremium: number;
  onFloorPremiumChange: (v: number) => void;
  onAdoptedMVChange?: (mv: number) => void;
}

// ── Floor level inference from SAON / flat number ────────────────────────────
// UK flat numbering conventions:
//   "Flat 3"        → flat 3 (sequential, floor ≈ ceil(n/2) for small blocks)
//   "Flat 301"      → floor 3 (first digit = floor for 3-digit numbers)
//   "Flat 12"       → floor 1 (first digit = floor for 2-digit numbers in larger blocks)
//   "Ground Floor"  → floor 0
//   "First Floor"   → floor 1
//   "Basement"      → floor -1
// Returns null if we can't infer.
function inferFloorFromSaon(saon: string | null | undefined): number | null {
  if (!saon) return null;
  const s = saon.trim().toUpperCase();

  // Named floors
  if (/BASEMENT|LOWER\s*GROUND/i.test(s)) return -1;
  if (/GROUND\s*FLOOR/i.test(s)) return 0;
  if (/FIRST\s*FLOOR/i.test(s)) return 1;
  if (/SECOND\s*FLOOR/i.test(s)) return 2;
  if (/THIRD\s*FLOOR/i.test(s)) return 3;
  if (/FOURTH\s*FLOOR/i.test(s)) return 4;
  if (/FIFTH\s*FLOOR/i.test(s)) return 5;

  // Extract the numeric part from patterns like "FLAT 3", "APARTMENT 12", "UNIT 301"
  const m = s.match(/(?:FLAT|APARTMENT|APT|UNIT)\s*(\d+)/i);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (isNaN(num) || num <= 0) return null;

  // 3+ digit numbers: first digit is likely the floor (e.g. 301 → floor 3)
  if (num >= 100) return Math.floor(num / 100);

  // 2-digit numbers: first digit is likely the floor (e.g. 12 → floor 1)
  if (num >= 10) return Math.floor(num / 10);

  // Single digit (1-9): assume roughly 2 flats per floor
  // Flat 1-2 → ground/1st, Flat 3-4 → 1st/2nd, etc.
  return Math.max(0, Math.ceil(num / 2) - 1);
}

// ── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple hash for deterministic seeding
function hashInputs(comps: ComparableCandidate[], mv: number): number {
  let h = mv;
  for (const c of comps) {
    h = ((h << 5) - h + c.price) | 0;
    h = ((h << 5) - h + (c.floor_area_sqm ?? 0)) | 0;
  }
  return Math.abs(h);
}

// ── HPI helpers ──────────────────────────────────────────────────────────────
function hpiKeyForComp(comp: ComparableCandidate): keyof HpiTrendSlice {
  const pt = (comp.property_type ?? "").toLowerCase();
  const hs = (comp.house_sub_type ?? "").toLowerCase();
  if (pt === "flat") return "hpi_flat";
  if (hs === "semi-detached") return "hpi_semi";
  if (hs === "terraced" || hs === "end-terrace") return "hpi_terraced";
  if (hs === "detached") return "hpi_detached";
  return "hpi_all";
}

function getHpiForMonth(
  trend: HpiTrendSlice[],
  month: string,
  comp: ComparableCandidate
): number | null {
  let point = trend.find((t) => t.month === month);
  // Fallback: if exact month not found, use nearest available month
  if (!point && trend.length > 0) {
    if (month > trend[trend.length - 1].month) {
      point = trend[trend.length - 1]; // beyond range → use latest
    } else if (month < trend[0].month) {
      point = trend[0]; // before range → use earliest
    }
  }
  if (!point) return null;
  const prefKey = hpiKeyForComp(comp);
  const val = point[prefKey] as number | null;
  return val ?? (point.hpi_all as number | null);
}

// ── Layer 1 Auto-Selection ───────────────────────────────────────────────────
// Ranks the full comparable universe by similarity to the subject and returns
// the top MAX_LAYER1 comps. Ensures the Monte Carlo engine works with a tight,
// high-quality set rather than a noisy 50+ comp dump.
const MAX_LAYER1 = 10;

function selectBestComps(
  allComps: ComparableCandidate[],
  subjectSizeSqft: number,
  valuationDate: string,
  subjectEpcScore: number | null,
): ComparableCandidate[] {
  if (allComps.length <= MAX_LAYER1) return allComps;

  const valDateMs = new Date(valuationDate).getTime();
  const maxAgeDays = 365 * 3;

  const scored = allComps.map((c) => {
    // Size similarity (requires floor area)
    let sizeSim = 0.3; // neutral if no data
    if (c.floor_area_sqm != null && c.floor_area_sqm > 0 && subjectSizeSqft > 0) {
      const sqft = c.floor_area_sqm * 10.764;
      const sizeDiff = Math.abs(subjectSizeSqft - sqft) / Math.max(subjectSizeSqft, sqft);
      sizeSim = Math.exp(-8 * sizeDiff);
    }

    // Date recency
    const txMs = new Date(c.transaction_date).getTime();
    const ageDays = Math.max(0, (valDateMs - txMs) / 86_400_000);
    const dateSim = Math.exp(-2 * (ageDays / maxAgeDays));

    // EPC similarity
    let epcSim = 0.5;
    if (subjectEpcScore != null && c.epc_score != null) {
      const epcDiff = Math.abs(subjectEpcScore - c.epc_score) / 100;
      epcSim = Math.exp(-3 * epcDiff);
    }

    // Has floor area data? Strong bonus — comps without size are much less useful
    const hasSize = c.floor_area_sqm != null && c.floor_area_sqm > 0 ? 1.0 : 0.2;

    const score = hasSize * sizeSim * (dateSim * 0.6 + epcSim * 0.4);
    return { comp: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_LAYER1).map((s) => s.comp);
}

// ── Monte Carlo Engine ───────────────────────────────────────────────────────
interface SimulationResult {
  simMVs: number[];
  mean: number;
  stdDev: number;
  p1: number;
  p5: number;
  p95: number;
  p99: number;
  percentile: number;
  sigma: number;
  mode: number;
  compsUsed: number;
}

function runMonteCarlo(
  layer1: ComparableCandidate[],
  subjectSizeSqft: number,
  adoptedMV: number,
  hpiTrend: HpiTrendSlice[],
  valuationDate: string,
  subjectPropertyType: string | null,
  subjectHouseSubType: string | null,
  subjectEpcScore: number | null,
  subjectSaon: string | null,
  sizeElasticityOverride: number | null = null,
  hpiCorrelationPct: number = 50,
  epcBetaPct: number = 50,
  floorPremiumPct: number = 50
): SimulationResult {
  const N_SIMS = 100_000;
  const rng = mulberry32(hashInputs(layer1, adoptedMV));

  // Infer subject floor level from SAON
  const subjectFloor = inferFloorFromSaon(subjectSaon);

  // Pre-compute raw PSF and HPI for each comp
  // Hard filter: drop comps with >25% size difference from subject
  // A valuer would never use a 1,200 ft² comp for a 600 ft² subject
  const SIZE_GATE = 0.25;
  const compsWithData = layer1
    .filter((c) => {
      if (c.floor_area_sqm == null || c.floor_area_sqm <= 0) return false;
      const sqft = c.floor_area_sqm * 10.764;
      const diff = Math.abs(subjectSizeSqft - sqft) / Math.max(subjectSizeSqft, sqft);
      return diff <= SIZE_GATE;
    })
    .map((c) => {
      const sqft = c.floor_area_sqm! * 10.764;
      const rawPsf = c.price / sqft;
      const txMonth = c.transaction_date.slice(0, 7);
      const valMonth = valuationDate.slice(0, 7);
      const compHpi = getHpiForMonth(hpiTrend, txMonth, c);
      // For subject HPI, use the valuation date month with a synthetic comp matching subject type
      const subjectProxy = {
        ...c,
        property_type: subjectPropertyType,
        house_sub_type: subjectHouseSubType,
      } as ComparableCandidate;
      const subjectHpi = getHpiForMonth(hpiTrend, valMonth, subjectProxy);
      const compFloor = inferFloorFromSaon(c.saon as string | null);
      return { sqft, rawPsf, price: c.price, compHpi, subjectHpi, bedrooms: c.bedrooms, epcScore: c.epc_score, txDate: c.transaction_date, compFloor };
    });

  if (compsWithData.length < 3) {
    return { simMVs: [], mean: 0, stdDev: 0, p1: 0, p5: 0, p95: 0, p99: 0, percentile: 0, sigma: 0, mode: 0, compsUsed: compsWithData.length };
  }

  const n = compsWithData.length;
  const simMVs = new Float64Array(N_SIMS);

  // ── Pre-compute similarity scores (comp vs subject) ──
  // Dimensions: size proximity, date recency, EPC closeness
  // Each dimension yields 0–1 (1 = identical to subject)
  const valDateMs = new Date(valuationDate).getTime();
  const maxAgeDays = 365 * 3; // 3 years = max plausible comp age

  const similarityScores = compsWithData.map((comp) => {
    // Size similarity: steep exponential decay — acts as a GATE
    // A comp 2x subject size is essentially a different property type
    const sizeDiff = subjectSizeSqft > 0 && comp.sqft > 0
      ? Math.abs(subjectSizeSqft - comp.sqft) / Math.max(subjectSizeSqft, comp.sqft)
      : 0.5;
    const sizeSim = Math.exp(-8 * sizeDiff); // 0%→1.0, 10%→0.45, 30%→0.09, 50%→0.02

    // Date recency: 1 when same day, decays with age
    const txMs = new Date(comp.txDate).getTime();
    const ageDays = Math.max(0, (valDateMs - txMs) / 86_400_000);
    const dateSim = Math.exp(-2 * (ageDays / maxAgeDays)); // e^0 = 1, e^(-2) ≈ 0.14 at 3yr

    // EPC similarity: 1 when identical score, decays with point gap
    let epcSim = 0.5; // neutral if no data
    if (subjectEpcScore != null && comp.epcScore != null) {
      const epcDiff = Math.abs(subjectEpcScore - comp.epcScore) / 100;
      epcSim = Math.exp(-3 * epcDiff);
    }

    // MULTIPLICATIVE blend: size is a gate — wrong size kills similarity
    // regardless of how recent or EPC-close the comp is.
    // A valuer would never heavily weight a comp 2x the subject's size.
    return sizeSim * (dateSim * 0.65 + epcSim * 0.35);
  });

  // Pre-compute cumulative similarity for weighted random selection
  // This lets us sample comps proportional to their similarity score
  const simTotal = similarityScores.reduce((a, b) => a + b, 0);
  const cumSim = new Float64Array(n);
  cumSim[0] = similarityScores[0] / simTotal;
  for (let i = 1; i < n; i++) {
    cumSim[i] = cumSim[i - 1] + similarityScores[i] / simTotal;
  }

  // Pre-allocate reusable buffers to avoid per-iteration heap allocations
  const pickedBuf = new Int32Array(n);
  const excludedBuf = new Uint8Array(n); // boolean flags, faster than Set
  const weightsBuf = new Float64Array(n);
  const adjPricesBuf = new Float64Array(n);

  // Weighted random pick using exclusion flags array (no Set allocation)
  function weightedPick(rng: () => number, excl: Uint8Array): number {
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = rng();
      for (let i = 0; i < n; i++) {
        if (r <= cumSim[i]) {
          if (!excl[i]) return i;
          break;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!excl[i]) return i;
    }
    return 0;
  }

  for (let sim = 0; sim < N_SIMS; sim++) {
    // Randomness 1 — How many comps to pick (1 to N)
    const pickCount = Math.floor(rng() * n) + 1;

    // Reset exclusion flags (only the portion we need)
    excludedBuf.fill(0);

    // Similarity-weighted selection into pre-allocated buffer
    for (let i = 0; i < pickCount; i++) {
      const idx = weightedPick(rng, excludedBuf);
      pickedBuf[i] = idx;
      excludedBuf[idx] = 1;
    }

    // Randomness 2 — Adjustment parameters
    const hpiCentre = hpiCorrelationPct / 100;
    const passthroughRate = Math.max(0, Math.min(1, hpiCentre + (rng() - 0.5) * 0.4));
    const epcCentre = (epcBetaPct / 100) * 0.005;
    const betaEpc = Math.max(0, epcCentre + (rng() - 0.5) * 0.002);
    const sizeAlpha = sizeElasticityOverride != null
      ? sizeElasticityOverride
      : -0.15 + rng() * 0.65;
    const floorCentre = 0.001 + (floorPremiumPct / 100) * 0.019;
    const floorPrem = Math.max(0, floorCentre + (rng() - 0.5) * 0.008);

    // Randomness 3 — Similarity-biased weights (reuse pre-allocated buffers)
    let weightSum = 0;

    for (let i = 0; i < pickCount; i++) {
      const compIdx = pickedBuf[i];
      const comp = compsWithData[compIdx];

      // Time adjustment (HPI-based)
      let timeAdj = 0;
      if (comp.compHpi != null && comp.subjectHpi != null && comp.compHpi > 0) {
        timeAdj =
          ((comp.subjectHpi - comp.compHpi) / comp.compHpi) * passthroughRate;
      }

      // EPC adjustment
      let epcAdj = 0;
      if (subjectEpcScore != null && comp.epcScore != null && comp.epcScore > 0) {
        epcAdj = (subjectEpcScore - comp.epcScore) * betaEpc;
      }

      // Size adjustment
      let sizeAdj = 0;
      if (subjectSizeSqft > 0 && comp.sqft > 0) {
        sizeAdj = sizeAlpha * (subjectSizeSqft - comp.sqft) / comp.sqft;
      }

      // Floor level adjustment
      let floorAdj = 0;
      if (subjectFloor != null && comp.compFloor != null) {
        floorAdj = (subjectFloor - comp.compFloor) * floorPrem;
      }

      let adjPrice = comp.price * (1 + timeAdj + epcAdj + sizeAdj + floorAdj);

      // Monotonicity clamp
      if (sizeAlpha >= 0) {
        if (subjectSizeSqft < comp.sqft) {
          adjPrice = Math.min(adjPrice, comp.price);
        } else if (subjectSizeSqft > comp.sqft) {
          adjPrice = Math.max(adjPrice, comp.price);
        }
      }
      adjPricesBuf[i] = adjPrice;

      const noise = 0.2 + rng() * 1.6;
      const w = similarityScores[compIdx] * noise;
      weightsBuf[i] = w;
      weightSum += w;
    }

    // Weighted average adjusted price → simulated MV
    let simMV = 0;
    for (let i = 0; i < pickCount; i++) {
      simMV += (weightsBuf[i] / weightSum) * adjPricesBuf[i];
    }
    simMVs[sim] = simMV;
  }

  // Sort Float64Array in-place (no copy needed)
  simMVs.sort();
  const sorted = simMVs;
  let sum = 0;
  for (let i = 0; i < N_SIMS; i++) sum += sorted[i];
  const mean = sum / N_SIMS;
  let varSum = 0;
  for (let i = 0; i < N_SIMS; i++) { const d = sorted[i] - mean; varSum += d * d; }
  const stdDev = Math.sqrt(varSum / N_SIMS);
  const p1 = sorted[Math.floor(N_SIMS * 0.01)];
  const p5 = sorted[Math.floor(N_SIMS * 0.05)];
  const p95 = sorted[Math.floor(N_SIMS * 0.95)];
  const p99 = sorted[Math.floor(N_SIMS * 0.99)];

  // Percentile of adopted MV (binary search on sorted array)
  let lo = 0, hi = N_SIMS;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < adoptedMV) lo = mid + 1; else hi = mid;
  }
  const percentile = Math.round((lo / N_SIMS) * 100);
  const sigma = stdDev > 0 ? (adoptedMV - mean) / stdDev : 0;

  // Compute mode: find the value at the peak of the distribution
  // Use histogram binning on sorted array to find the densest region
  const modeBins = 70;
  const modeRange = sorted[N_SIMS - 1] - sorted[0] || 1;
  const modeBinWidth = modeRange / modeBins;
  let maxCount = 0;
  let modeIdx = 0;
  for (let b = 0; b < modeBins; b++) {
    const lo2 = sorted[0] + b * modeBinWidth;
    const hi2 = lo2 + modeBinWidth;
    let count = 0;
    for (let i = 0; i < N_SIMS; i++) {
      if (sorted[i] >= lo2 && sorted[i] < hi2) count++;
      else if (sorted[i] >= hi2) break;
    }
    if (count > maxCount) {
      maxCount = count;
      modeIdx = b;
    }
  }
  const mode = Math.round((sorted[0] + (modeIdx + 0.5) * modeBinWidth) / 1000) * 1000;

  return { simMVs: Array.from(sorted), mean, stdDev, p1, p5, p95, p99, percentile, sigma, mode, compsUsed: n };
}

// ── PDF Chart (SVG) ──────────────────────────────────────────────────────────
function PdfChart({
  simMVs,
  mean,
  mode,
  adoptedMV,
  p1,
  p99,
  stdDev,
  onAdoptedMVChange,
}: {
  simMVs: number[];
  mean: number;
  mode: number;
  adoptedMV: number;
  p1: number;
  p99: number;
  stdDev: number;
  onAdoptedMVChange?: (mv: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; value: number; pct: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragMV, setDragMV] = useState<number | null>(null);

  // The displayed MV: use drag value while dragging, otherwise prop
  const displayMV = dragMV ?? adoptedMV;

  const W = 800;
  const H = 300;
  const PAD_L = 70;
  const PAD_R = 30;
  const PAD_T = 35;
  const PAD_B = 60;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const bins = 70;
  // Extend chart range to include adoptedMV so the marker always sits at its true position
  const rawMin = simMVs.length >= 2 ? simMVs[0] : 0;
  const rawMax = simMVs.length >= 2 ? simMVs[simMVs.length - 1] : 1;
  const minV = Math.min(rawMin, adoptedMV);
  const maxV = Math.max(rawMax, adoptedMV);
  const range = maxV - minV || 1;
  const binWidth = range / bins;

  // Build histogram + densities (memoised for hover lookups)
  const { densities, maxDensity, points } = useMemo(() => {
    if (simMVs.length < 2) return { densities: [], maxDensity: 0, points: [] as { x: number; y: number; d: number; v: number }[] };

    const counts = new Array(bins).fill(0);
    for (const v of simMVs) {
      const idx = Math.min(Math.floor((v - minV) / binWidth), bins - 1);
      counts[idx]++;
    }
    const totalArea = simMVs.length * binWidth;
    const dens = counts.map((c: number) => c / totalArea);
    const maxD = Math.max(...dens);

    const xScale = (v: number) => PAD_L + ((v - minV) / range) * plotW;
    const yScale = (d: number) => PAD_T + plotH - (d / maxD) * plotH;

    const pts = dens.map((d: number, i: number) => {
      const v = minV + (i + 0.5) * binWidth;
      return { x: xScale(v), y: yScale(d), d, v };
    });
    return { densities: dens, maxDensity: maxD, points: pts };
  }, [simMVs, minV, maxV, range, binWidth, bins, plotW, plotH]);

  // Percentile lookup: what % of simMVs are below a given value
  const pctBelow = useCallback((val: number) => {
    if (simMVs.length === 0) return 0;
    let lo = 0, hi = simMVs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (simMVs[mid] < val) lo = mid + 1; else hi = mid;
    }
    return Math.round((lo / simMVs.length) * 100);
  }, [simMVs]);

  // Convert client X → value on the chart axis
  const clientXToValue = useCallback((clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return adoptedMV;
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const clampedX = Math.max(PAD_L, Math.min(PAD_L + plotW, svgX));
    const val = minV + ((clampedX - PAD_L) / plotW) * range;
    // Round to nearest £1,000 for clean values
    return Math.round(val / 1000) * 1000;
  }, [W, plotW, minV, range, adoptedMV]);

  // ── MV line drag handlers ──
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    setDragMV(clientXToValue(e.clientX));
  }, [clientXToValue]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    setDragMV(clientXToValue(e.clientX));
  }, [dragging, clientXToValue]);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    (e.target as Element).releasePointerCapture(e.pointerId);
    setDragging(false);
    const finalMV = clientXToValue(e.clientX);
    setDragMV(null);
    if (onAdoptedMVChange && finalMV > 0) {
      onAdoptedMVChange(finalMV);
    }
  }, [dragging, clientXToValue, onAdoptedMVChange]);

  // Mouse/touch → SVG coordinate → nearest curve point (hover tooltip)
  const handlePointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging) return; // Don't show hover tooltip while dragging MV line
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;

    // Find nearest point by x
    let best = points[0];
    let bestDist = Math.abs(svgX - best.x);
    for (let i = 1; i < points.length; i++) {
      const dist = Math.abs(svgX - points[i].x);
      if (dist < bestDist) { best = points[i]; bestDist = dist; }
    }
    // Only show if within plot area
    if (svgX >= PAD_L && svgX <= PAD_L + plotW) {
      setHover({ x: best.x, y: best.y, value: best.v, pct: pctBelow(best.v) });
    } else {
      setHover(null);
    }
  }, [points, pctBelow, W, plotW, dragging]);

  if (simMVs.length < 2) return null;

  // X/Y scales (for static elements)
  const xScale = (v: number) => PAD_L + ((v - minV) / range) * plotW;
  const yScale = (d: number) => PAD_T + plotH - (d / maxDensity) * plotH;

  // Catmull-Rom to cubic bezier path
  let path = `M ${points[0].x},${yScale(0)} L ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  const lastPt = points[points.length - 1];
  path += ` L ${lastPt.x},${yScale(0)}`;

  // P1-P99 shaded region (98% CI)
  const p1x = xScale(p1);
  const p99x = xScale(p99);
  const shadePoints = points.filter((p) => p.x >= p1x && p.x <= p99x);
  let shadePath = "";
  if (shadePoints.length > 1) {
    shadePath = `M ${p1x},${yScale(0)} L ${shadePoints[0].x},${shadePoints[0].y}`;
    for (let i = 1; i < shadePoints.length; i++) {
      shadePath += ` L ${shadePoints[i].x},${shadePoints[i].y}`;
    }
    shadePath += ` L ${p99x},${yScale(0)} Z`;
  }

  const meanX = xScale(mean);
  const modeX = xScale(mode);
  const mvX = xScale(displayMV);

  // X-axis labels — snap to clean round numbers so labels align with actual values
  const niceStep = (() => {
    const rough = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    if (norm <= 1) return mag;
    if (norm <= 2) return 2 * mag;
    if (norm <= 5) return 5 * mag;
    return 10 * mag;
  })();
  const ticks: { v: number; x: number }[] = [];
  const tickStart = Math.ceil(minV / niceStep) * niceStep;
  for (let v = tickStart; v <= maxV; v += niceStep) {
    ticks.push({ v, x: xScale(v) });
  }

  // Compact format for axis ticks (clean round numbers)
  const fmt = (v: number) => {
    if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}m`;
    return `£${Math.round(v / 1000)}k`;
  };
  // Full precision for marker labels so they match their x position
  const fmtFull = (v: number) => "£" + Math.round(v).toLocaleString("en-GB");

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: 320, touchAction: "none" }}
      onPointerMove={handlePointer}
      onPointerLeave={() => setHover(null)}
    >
      {/* P1-P99 shaded area (98% CI) */}
      {shadePath && (
        <path d={shadePath} fill="var(--color-accent)" opacity={0.1} />
      )}

      {/* Distribution curve */}
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} opacity={0.8} />

      {/* Filled area under curve */}
      <path d={path + " Z"} fill="var(--color-accent)" opacity={0.05} />

      {/* ±0.25σ, ±0.5σ and ±1σ bands */}
      {[
        { n: 0.25, color: "var(--color-accent-purple)", opacity: 0.12 },
        { n: 0.5, color: "var(--color-accent-purple)", opacity: 0.08 },
        { n: 1, color: "var(--color-accent-purple)", opacity: 0.04 },
      ].map(({ n, color, opacity: fillOp }, idx) => {
        const lo = xScale(Math.max(minV, mean - n * stdDev));
        const hi = xScale(Math.min(maxV, mean + n * stdDev));
        const labelY = PAD_T + plotH + 26 + idx * 11;
        return (
          <g key={n}>
            <rect x={lo} y={PAD_T} width={hi - lo} height={plotH} fill={color} opacity={fillOp} />
            {/* Left σ line */}
            <line x1={lo} y1={PAD_T} x2={lo} y2={PAD_T + plotH}
              stroke={color} strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
            {/* Right σ line */}
            <line x1={hi} y1={PAD_T} x2={hi} y2={PAD_T + plotH}
              stroke={color} strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
            {/* Labels at bottom */}
            <text x={lo} y={labelY} fill={color} fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif" opacity={0.7}>
              -{n}σ {fmtFull(mean - n * stdDev)}
            </text>
            <text x={hi} y={labelY} fill={color} fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif" opacity={0.7}>
              +{n}σ {fmtFull(mean + n * stdDev)}
            </text>
          </g>
        );
      })}

      {/* Mean dashed line + label hugging the line inside chart */}
      <line
        x1={meanX} y1={PAD_T} x2={meanX} y2={PAD_T + plotH}
        stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.7}
      />
      <text
        x={meanX + 5} y={PAD_T + 15}
        fill="var(--color-accent)" fontSize={10} textAnchor="start" fontFamily="Inter, sans-serif" opacity={0.9}
      >
        Mean
      </text>
      <text
        x={meanX + 5} y={PAD_T + 27}
        fill="var(--color-accent)" fontSize={10} textAnchor="start" fontFamily="Inter, sans-serif" fontWeight="bold" opacity={0.9}
      >
        {fmtFull(mean)}
      </text>

      {/* Mode line + label hugging the line inside chart, lower position */}
      <line
        x1={modeX} y1={PAD_T} x2={modeX} y2={PAD_T + plotH}
        stroke="var(--color-status-success)" strokeWidth={1.5} strokeDasharray="3,3" opacity={0.7}
      />
      <text
        x={modeX - 5} y={PAD_T + plotH * 0.45}
        fill="var(--color-status-success)" fontSize={10} textAnchor="end" fontFamily="Inter, sans-serif" opacity={0.85}
      >
        Mode
      </text>
      <text
        x={modeX - 5} y={PAD_T + plotH * 0.45 + 12}
        fill="var(--color-status-success)" fontSize={10} textAnchor="end" fontFamily="Inter, sans-serif" fontWeight="bold" opacity={0.85}
      >
        {fmtFull(mode)}
      </text>

      {/* Adopted MV — draggable line + marker */}
      <g
        style={{ cursor: dragging ? "grabbing" : "ew-resize" }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        {/* Wide invisible hit area for easy grab */}
        <rect
          x={mvX - 12} y={PAD_T - 10}
          width={24} height={plotH + 30}
          fill="transparent"
        />
        {/* Visible line */}
        <line
          x1={mvX} y1={PAD_T} x2={mvX} y2={PAD_T + plotH}
          stroke="var(--color-accent-pink)" strokeWidth={dragging ? 3 : 2} opacity={0.9}
        />
        {/* Glow while dragging */}
        {dragging && (
          <line
            x1={mvX} y1={PAD_T} x2={mvX} y2={PAD_T + plotH}
            stroke="var(--color-accent-pink)" strokeWidth={8} opacity={0.15}
          />
        )}
        {/* Triangle marker */}
        <polygon
          points={`${mvX},${PAD_T + plotH + 2} ${mvX - 8},${PAD_T + plotH + 14} ${mvX + 8},${PAD_T + plotH + 14}`}
          fill="var(--color-accent-pink)"
          stroke={dragging ? "var(--color-text-primary)" : "none"}
          strokeWidth={dragging ? 1 : 0}
        />
        {/* Label — offset higher to avoid overlap with Mean label */}
        <text x={mvX} y={PAD_T - 18} fill="var(--color-accent-pink)" fontSize={11} textAnchor="middle" fontWeight="bold" fontFamily="Inter, sans-serif">
          {dragging ? fmtFull(displayMV) : `Adopted ${fmtFull(displayMV)}`}
        </text>
      </g>

      {/* X axis */}
      <line x1={PAD_L} y1={PAD_T + plotH} x2={PAD_L + plotW} y2={PAD_T + plotH} stroke="var(--color-border)" strokeWidth={1} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.x} y1={PAD_T + plotH} x2={t.x} y2={PAD_T + plotH + 6} stroke="var(--color-border)" />
          <text x={t.x} y={PAD_T + plotH + 22} fill="var(--color-text-secondary)" fontSize={10} textAnchor="middle" fontFamily="Inter, sans-serif">
            {fmt(t.v)}
          </text>
        </g>
      ))}

      {/* Axis labels */}
      <text x={PAD_L + plotW / 2} y={H - 5} fill="var(--color-text-secondary)" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif">
        Market Value
      </text>
      <text x={15} y={PAD_T + plotH / 2} fill="var(--color-text-secondary)" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif" transform={`rotate(-90, 15, ${PAD_T + plotH / 2})`}>
        Density
      </text>

      {/* Interactive hover dot + crosshair + tooltip */}
      {hover && (
        <g>
          {/* Vertical crosshair */}
          <line x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + plotH}
            stroke="var(--color-text-primary)" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.4} />
          {/* Horizontal crosshair */}
          <line x1={PAD_L} y1={hover.y} x2={PAD_L + plotW} y2={hover.y}
            stroke="var(--color-text-primary)" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.3} />
          {/* Glow ring */}
          <circle cx={hover.x} cy={hover.y} r={8} fill="var(--color-accent)" opacity={0.15} />
          {/* Dot */}
          <circle cx={hover.x} cy={hover.y} r={4.5} fill="var(--color-accent)" stroke="var(--color-bg-base)" strokeWidth={2} />
          {/* Tooltip background — flips below dot when near top */}
          {(() => {
            const label = `${fmtFull(hover.value)}  ·  P${hover.pct}`;
            const tw = label.length * 6.5 + 16;
            const th = 24;
            const gap = 12;  // space between dot and tooltip
            // Flip below when not enough room above
            const above = hover.y - gap - th >= PAD_T - 4;
            const ty = above ? hover.y - gap - th : hover.y + gap;
            // Keep tooltip within horizontal chart bounds
            let tx = hover.x - tw / 2;
            if (tx < PAD_L) tx = PAD_L;
            if (tx + tw > PAD_L + plotW) tx = PAD_L + plotW - tw;
            return (
              <g>
                <rect x={tx} y={ty} width={tw} height={th} rx={6}
                  fill="var(--color-bg-base)" stroke="var(--color-accent)" strokeWidth={0.8} opacity={0.92} />
                <text x={tx + tw / 2} y={ty + 16} fill="var(--color-text-primary)" fontSize={11} textAnchor="middle"
                  fontFamily="JetBrains Mono, Fira Code, monospace" fontWeight="600">
                  {fmtFull(hover.value)}
                  <tspan fill="var(--color-text-secondary)" fontWeight="400">  ·  </tspan>
                  <tspan fill="var(--color-accent)">P{hover.pct}</tspan>
                </text>
              </g>
            );
          })()}
        </g>
      )}

      {/* Invisible overlay to capture pointer events across the full plot area */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH}
        fill="transparent" style={{ cursor: "crosshair" }} />
    </svg>
  );
}

// ── Sigma-based colour spectrum ──────────────────────────────────────────────
// Maps absolute sigma distance to a continuous colour:
//   0σ = deep green (#00C853), 0.5σ = green (#39FF14), 1σ = yellow-green (#A8E600)
//   1.5σ = amber (#FFB800), 2σ = orange (#FF8A00), 2.5σ+ = red (#FF3131)
function sigmaToColor(absSigma: number): string {
  const stops: [number, [number, number, number]][] = [
    [0.0, [0, 200, 83]],     // #00C853 deep green — right at the mean
    [0.5, [57, 255, 20]],    // #39FF14 neon green
    [1.0, [168, 230, 0]],    // #A8E600 yellow-green — edge of 1σ
    [1.5, [255, 184, 0]],    // #FFB800 amber
    [2.0, [255, 138, 0]],    // #FF8A00 orange — edge of 2σ
    [2.5, [255, 49, 49]],    // #FF3131 red
  ];
  const s = Math.min(absSigma, 2.5);
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(255,49,49)";
}

function sigmaToLabel(absSigma: number): string {
  if (absSigma <= 0.5) return "STRONG — WELL CENTRED";
  if (absSigma <= 1.0) return "WITHIN NORMAL RANGE";
  if (absSigma <= 1.5) return "MARGINAL — APPROACHING LIMIT";
  if (absSigma <= 2.0) return "ELEVATED — REVIEW RECOMMENDED";
  return "ALARM — EXCEEDS 2σ THRESHOLD";
}

// ── Gauge Component ──────────────────────────────────────────────────────────
function DeltaGauge({ percentile, sigma }: { percentile: number; sigma: number }) {
  const absSigma = Math.abs(sigma);
  const color = sigmaToColor(absSigma);
  const label = sigmaToLabel(absSigma);

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 90;
  const rInner = 78;
  const strokeW = 10;
  const thinStroke = 3;
  const circ = 2 * Math.PI * rOuter;
  const circInner = 2 * Math.PI * rInner;
  const progress = percentile / 100;

  // Tick marks — each tick gets its OWN colour from the spectrum
  const tickCount = 50;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const frac = i / tickCount;
    const angle = frac * 360 - 90;
    const rad = (angle * Math.PI) / 180;
    const isMajor = i % 5 === 0;
    const r1 = rOuter + 6;
    const r2 = rOuter + (isMajor ? 14 : 10);
    // Map tick position to sigma: P50=0σ, and scale outward
    // ticks 0→25 = P0→P50 (left tail), ticks 25→50 = P50→P100 (right tail)
    const tickPct = frac * 100;
    const tickSigma = Math.abs(tickPct - 50) / 50 * 2.5; // 0 at P50, 2.5 at extremes
    return {
      x1: cx + r1 * Math.cos(rad),
      y1: cy + r1 * Math.sin(rad),
      x2: cx + r2 * Math.cos(rad),
      y2: cy + r2 * Math.sin(rad),
      isMajor,
      isLit: frac <= progress,
      tickColor: sigmaToColor(tickSigma),
    };
  });

  // Arc gradient: always shows the full spectrum green→yellow→orange→red
  const arcGradStops = [
    { offset: "0%", color: "#00C853" },
    { offset: "25%", color: "var(--color-status-success)" },
    { offset: "50%", color: "#A8E600" },
    { offset: "70%", color: "var(--color-status-warning)" },
    { offset: "85%", color: "#FF8A00" },
    { offset: "100%", color: "var(--color-status-danger)" },
  ];

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <defs>
            <linearGradient id="gaugeSpectrumGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              {arcGradStops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </linearGradient>
            <filter id="gaugeGlow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Outer tick marks — spectrum coloured */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={t.isLit ? t.tickColor : "var(--color-bg-surface)"}
              strokeWidth={t.isMajor ? 2 : 1}
              opacity={t.isLit ? 0.8 : 0.25}
              strokeLinecap="round"
            />
          ))}

          {/* Background ring */}
          <circle
            cx={cx} cy={cy} r={rOuter}
            fill="none" stroke="var(--color-bg-surface)" strokeWidth={strokeW}
          />

          {/* Faint inner ring */}
          <circle
            cx={cx} cy={cy} r={rInner}
            fill="none" stroke="var(--color-bg-surface)" strokeWidth={thinStroke}
            opacity={0.4}
          />

          {/* Progress arc — spectrum gradient */}
          <circle
            cx={cx} cy={cy} r={rOuter}
            fill="none" stroke="url(#gaugeSpectrumGrad)" strokeWidth={strokeW}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            filter="url(#gaugeGlow)"
          />

          {/* Inner progress ring (thin, uses current sigma colour) */}
          <circle
            cx={cx} cy={cy} r={rInner}
            fill="none" stroke={color} strokeWidth={thinStroke}
            strokeDasharray={circInner}
            strokeDashoffset={circInner * (1 - progress)}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity={0.4}
          />

          {/* Centre dark fill */}
          <circle cx={cx} cy={cy} r={rInner - 6} fill="var(--color-bg-base)" opacity={0.6} />
        </svg>

        {/* Centre text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-5xl font-bold tracking-tight"
            style={{
              color,
              fontFamily: "Orbitron, Inter, sans-serif",
              textShadow: `0 0 20px ${color}44, 0 0 40px ${color}22`,
            }}
          >
            P{percentile}
          </span>
          <span className="text-[10px] text-[var(--color-text-secondary)] tracking-[0.2em] mt-1">PERCENTILE</span>
        </div>
      </div>
      <span
        className="text-xs font-semibold tracking-[0.15em] px-4 py-1.5 rounded-full"
        style={{
          color,
          backgroundColor: `${color.replace("rgb", "rgba").replace(")", ",0.08)")}`,
          border: `1px solid ${color.replace("rgb", "rgba").replace(")", ",0.2)")}`,
          boxShadow: `0 0 12px ${color.replace("rgb", "rgba").replace(")", ",0.1)")}`,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Format helpers ───────────────────────────────────────────────────────────
function fmtGBP(v: number): string {
  return "£" + Math.round(v).toLocaleString("en-GB");
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function SEMVTab({
  layer1Comps,
  adoptedComparables,
  adoptedMV,
  subjectSizeSqft,
  hpiTrend,
  valuationDate,
  subjectPropertyType,
  subjectHouseSubType,
  subjectEpcScore,
  subjectSaon,
  subjectAreaM2,
  subjectBedrooms,
  subjectBuildYear,
  subjectImdDecile,
  subjectAddress,
  subjectPostcode,
  subjectTenure,
  boroughSlug,
  accessToken,
  planningExtensions,
  savedAutoSelectResult,
  onAutoSelectResult,
  hpiCorrelation,
  onHpiCorrelationChange,
  compSizeElasticity,
  onCompSizeElasticityChange,
  epcBeta,
  onEpcBetaChange,
  floorPremium,
  onFloorPremiumChange,
  onAdoptedMVChange,
}: SEMVTabProps) {
  // ── Auto-select state — initialise from saved case data ──
  const [autoSelectResult, setAutoSelectResultLocal] = useState<AutoSelectResult | null>(savedAutoSelectResult);
  const [autoSelectLoading, setAutoSelectLoading] = useState(false);
  const [autoSelectError, setAutoSelectError] = useState<string | null>(null);
  const [adoptedAdjustedAreaM2, setAdoptedAdjustedAreaM2] = useState<number | null>(null);
  const [checkedExtensions, setCheckedExtensions] = useState<Record<string, boolean>>({});

  // Effective floor area: use adopted adjusted area if set, otherwise EPC area
  const effectiveAreaM2 = adoptedAdjustedAreaM2 ?? subjectAreaM2;

  // Wrap setter to also notify parent for persistence
  const setAutoSelectResult = useCallback((r: AutoSelectResult | null) => {
    setAutoSelectResultLocal(r);
    onAutoSelectResult(r);
  }, [onAutoSelectResult]);

  // ── Similarity scores for the comp pool ──
  const subjectForScoring = useMemo(() => ({
    floor_area_sqm: effectiveAreaM2,
    bedrooms: subjectBedrooms,
    build_year: subjectBuildYear,
    epc_score: subjectEpcScore,
    imd_decile: subjectImdDecile,
  }), [effectiveAreaM2, subjectBedrooms, subjectBuildYear, subjectEpcScore, subjectImdDecile]);

  const scoredComps = useMemo(
    () => scorePool(layer1Comps, subjectForScoring),
    [layer1Comps, subjectForScoring]
  );

  // Map transaction_id/address → similarity score for display
  const similarityMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const { comparable, score } of scoredComps) {
      const key = (comparable as any).transaction_id ?? (comparable as any).address;
      m.set(key, score.composite);
    }
    return m;
  }, [scoredComps]);

  // ── Auto-compose SEMV pool: all direct (tier 1-2) + top 30 scored wider (tier 3-4) ──
  const semvPool = useMemo(() => {
    const direct: ComparableCandidate[] = [];
    const wider: ComparableCandidate[] = [];
    for (const c of layer1Comps) {
      const tier = (c as any).geographic_tier;
      if (tier != null && tier <= 2) {
        direct.push(c);
      } else {
        wider.push(c);
      }
    }
    // Score wider comps and take top 30
    const scoredWider = scorePool(wider, subjectForScoring);
    const top30Wider = scoredWider.slice(0, 30).map(s => s.comparable as ComparableCandidate);
    return [...direct, ...top30Wider];
  }, [layer1Comps, subjectForScoring]);

  // Auto-select handler — uses the auto-composed SEMV pool (direct + top 30 wider)
  const handleAutoSelect = useCallback(async () => {
    if (!boroughSlug || !subjectPropertyType || !effectiveAreaM2 || !subjectPostcode || !subjectTenure || !accessToken) return;
    if (semvPool.length < 2) return;
    setAutoSelectLoading(true);
    setAutoSelectError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
      const res = await fetch(`${API_BASE}/api/comparables/auto-select`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject: {
            address: subjectAddress ?? "",
            postcode: subjectPostcode,
            tenure: subjectTenure,
            property_type: subjectPropertyType,
            bedrooms: subjectBedrooms,
            floor_area_sqm: effectiveAreaM2,
            build_year: subjectBuildYear,
            epc_score: subjectEpcScore,
            imd_decile: subjectImdDecile,
          },
          comparables: semvPool,
          borough_slug: boroughSlug,
          property_type: subjectPropertyType,
          hpi_factor: 1.0,  // TODO: compute from HPI trend
          iterations: 10000,
          top_n: 10,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? "Auto-select failed");
      }
      const data: AutoSelectResult = await res.json();
      setAutoSelectResult(data);
    } catch (e: any) {
      setAutoSelectError(e.message ?? "Unknown error");
    } finally {
      setAutoSelectLoading(false);
    }
  }, [boroughSlug, subjectPropertyType, subjectAreaM2, subjectPostcode, subjectTenure,
      subjectAddress, subjectBedrooms, subjectBuildYear, subjectEpcScore, subjectImdDecile, semvPool, accessToken, effectiveAreaM2]);

  // ── Auto-trigger: run MC as soon as we have a valid SEMV pool ──
  const autoSelectRanRef = useRef(!!savedAutoSelectResult?.histogram);
  const prevPoolSize = useRef(0);
  // Reset when pool changes significantly (new search)
  const poolLen = semvPool.length;
  if (poolLen !== prevPoolSize.current) {
    autoSelectRanRef.current = false;
    prevPoolSize.current = poolLen;
    setAutoSelectError(null);
    // Only reset local state during render — notify parent via effect
    setAutoSelectResultLocal(null);
  }

  // Fire auto-select once when pool is ready
  if (
    !autoSelectRanRef.current &&
    !autoSelectLoading &&
    (!autoSelectResult || !autoSelectResult.histogram) &&
    semvPool.length >= 2 &&
    boroughSlug &&
    subjectPropertyType &&
    effectiveAreaM2 &&
    effectiveAreaM2 > 0 &&
    subjectPostcode &&
    subjectTenure &&
    accessToken
  ) {
    autoSelectRanRef.current = true;
    // Defer to avoid calling setState during render
    setTimeout(() => handleAutoSelect(), 0);
  }

  // Validation
  const hasLayer1 = layer1Comps.length >= 3;
  const hasAdopted = adoptedComparables.length > 0;
  const hasMV = adoptedMV != null && adoptedMV > 0;
  const hasSize = subjectSizeSqft != null && subjectSizeSqft > 0;

  // ── Adopted comparable statistics ──────────────────────────────────────────
  const adoptedStats = useMemo(() => {
    const prices = adoptedComparables.map(c => c.price);
    const priceMin = prices.length ? Math.min(...prices) : 0;
    const priceMax = prices.length ? Math.max(...prices) : 0;
    const priceAvg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    const withArea = adoptedComparables.filter(c => c.floor_area_sqm != null && c.floor_area_sqm > 0);
    const psfs = withArea.map(c => c.price / (c.floor_area_sqm! * 10.764));
    const psfMin = psfs.length ? Math.min(...psfs) : null;
    const psfMax = psfs.length ? Math.max(...psfs) : null;
    const psfAvg = psfs.length ? psfs.reduce((a, b) => a + b, 0) / psfs.length : null;

    const sizes = withArea.map(c => c.floor_area_sqm!);
    const sizeMin = sizes.length ? Math.min(...sizes) : null;
    const sizeMax = sizes.length ? Math.max(...sizes) : null;
    const sizeAvg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null;

    const dates = adoptedComparables.map(c => c.transaction_date).filter(Boolean).sort();
    const dateMin = dates[0] ?? null;
    const dateMax = dates[dates.length - 1] ?? null;

    // Time-adjusted PSF
    const adjFactors = adoptedComparables.map(c => computeAdjFactor(c, hpiTrend, hpiCorrelation));
    const adjPsfsWithArea = adoptedComparables
      .map((c, i) => c.floor_area_sqm != null && c.floor_area_sqm > 0
        ? Math.round(c.price * adjFactors[i] / (c.floor_area_sqm * 10.764))
        : null)
      .filter((v): v is number => v != null);
    const adjPsfAvg = adjPsfsWithArea.length ? Math.round(adjPsfsWithArea.reduce((a, b) => a + b, 0) / adjPsfsWithArea.length) : null;
    const adjPsfMin = adjPsfsWithArea.length ? Math.min(...adjPsfsWithArea) : null;

    // Size-adjusted PSF
    const betaFloat = compSizeElasticity / 100;
    const sizeAdjPsfsArr: number[] = [];
    adoptedComparables.forEach((c, i) => {
      const sqft = c.floor_area_sqm != null && c.floor_area_sqm > 0 ? c.floor_area_sqm * 10.764 : null;
      const timeAdjPsf = sqft != null ? (c.price * adjFactors[i]) / sqft : null;
      if (sqft != null && timeAdjPsf != null && subjectSizeSqft != null && betaFloat !== 0) {
        const { adjPsf } = computeSizeAdj(sqft, subjectSizeSqft, timeAdjPsf, c.price, betaFloat);
        sizeAdjPsfsArr.push(Math.round(adjPsf));
      }
    });
    const sizeAdjPsfMin = sizeAdjPsfsArr.length ? Math.min(...sizeAdjPsfsArr) : null;
    const sizeAdjPsfMax = sizeAdjPsfsArr.length ? Math.max(...sizeAdjPsfsArr) : null;
    const sizeAdjPsfAvg = sizeAdjPsfsArr.length ? Math.round(sizeAdjPsfsArr.reduce((a, b) => a + b, 0) / sizeAdjPsfsArr.length) : null;

    // Indicative valuation
    const subSqft = subjectSizeSqft;
    const useSize = compSizeElasticity !== 0 && subSqft != null && sizeAdjPsfMin != null;
    const useAdj = !useSize && hpiCorrelation > 0 && hpiTrend.length > 0 && adjPsfMin != null;
    const indLow = useSize ? Math.round(sizeAdjPsfMin! * subSqft!) : useAdj ? Math.round(adjPsfMin! * subSqft!) : (psfMin != null && subSqft != null ? Math.round(psfMin * subSqft) : null);
    const indHigh = useSize ? Math.round(sizeAdjPsfMax! * subSqft!) : useAdj ? Math.round(Math.max(...adjPsfsWithArea) * subSqft!) : (psfMax != null && subSqft != null ? Math.round(psfMax * subSqft) : null);
    const indMid = useSize ? Math.round(sizeAdjPsfAvg! * subSqft!) : useAdj ? Math.round(adjPsfAvg! * subSqft!) : (psfAvg != null && subSqft != null ? Math.round(psfAvg * subSqft) : null);
    const indPsf = useSize ? sizeAdjPsfAvg : useAdj ? adjPsfAvg : (psfAvg != null ? Math.round(psfAvg) : null);

    return {
      priceMin, priceMax, priceAvg,
      psfMin, psfMax, psfAvg, adjPsfAvg, sizeAdjPsfAvg,
      sizeMin, sizeMax, sizeAvg,
      dateMin, dateMax,
      withAreaCount: withArea.length,
      indLow, indHigh, indMid, indPsf,
      useSize, useAdj,
    };
  }, [adoptedComparables, hpiTrend, hpiCorrelation, compSizeElasticity, subjectSizeSqft]);

  // Layer 1 = adopted comps + auto-selected best comps (deduped)
  const selectedLayer1 = useMemo(() => {
    // Start with adopted comparables
    const adoptedIds = new Set(adoptedComparables.map(c => c.transaction_id ?? c.address));
    // Auto-select from HMLR universe, excluding those already adopted
    const nonAdopted = layer1Comps.filter(c => !adoptedIds.has(c.transaction_id ?? c.address));
    const autoSelected = hasSize
      ? selectBestComps(nonAdopted, subjectSizeSqft!, valuationDate, subjectEpcScore)
      : nonAdopted.slice(0, MAX_LAYER1);
    // Merge: adopted first, then fill with auto-selected up to MAX_LAYER1
    const remaining = Math.max(0, MAX_LAYER1 - adoptedComparables.length);
    return [...adoptedComparables, ...autoSelected.slice(0, remaining)];
  }, [layer1Comps, adoptedComparables, subjectSizeSqft, valuationDate, subjectEpcScore, hasSize]);

  const compsWithSize = useMemo(
    () => selectedLayer1.filter((c) => c.floor_area_sqm != null && c.floor_area_sqm > 0),
    [selectedLayer1]
  );

  // Derive Monte Carlo size elasticity override from the unified prop
  const sizeElasticityOverride = compSizeElasticity === 0 ? null : compSizeElasticity / 100;

  // Seed MV for simulation: user-entered MV if available, otherwise indicative mid from comparables
  const seedMV = hasMV ? adoptedMV! : (adoptedStats.indMid ?? null);
  const hasSeedMV = seedMV != null && seedMV > 0;

  const ready = hasLayer1 && hasAdopted && hasSeedMV && hasSize && compsWithSize.length >= 2;

  // Run simulation on selected Layer 1 (max 20 best comps)
  const sim = useMemo(() => {
    if (!ready) return null;
    return runMonteCarlo(
      selectedLayer1,
      subjectSizeSqft!,
      seedMV!,
      hpiTrend,
      valuationDate,
      subjectPropertyType,
      subjectHouseSubType,
      subjectEpcScore,
      subjectSaon,
      sizeElasticityOverride,
      hpiCorrelation,
      epcBeta,
      floorPremium
    );
  }, [selectedLayer1, subjectSizeSqft, seedMV, hpiTrend, valuationDate, subjectPropertyType, subjectHouseSubType, subjectEpcScore, subjectSaon, sizeElasticityOverride, hpiCorrelation, epcBeta, floorPremium, ready]);

  // Effective MV: use adopted MV from Report Typing, or default to the distribution mode
  const effectiveMV = hasMV ? adoptedMV! : (sim?.mode ?? seedMV);

  // Build adopted set for quick lookup
  const adoptedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of adoptedComparables) {
      ids.add(c.transaction_id ?? c.address);
    }
    return ids;
  }, [adoptedComparables]);

  // Build selected Layer 1 set for table display
  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of selectedLayer1) {
      ids.add(c.transaction_id ?? c.address);
    }
    return ids;
  }, [selectedLayer1]);

  // ── Auto-select can run with just search results + subject size — no adoption needed ──
  const autoSelectReady = semvPool.length >= 2 && hasSize && !!boroughSlug && !!subjectPropertyType;

  if (!ready && !autoSelectReady) {
    const missing: string[] = [];
    if (!hasLayer1 && semvPool.length < 2) missing.push("comparable search (minimum 2 results)");
    if (!hasSize) missing.push("subject property floor area");
    if (!boroughSlug) missing.push("borough identification (for LR coefficients)");

    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-[var(--color-text-secondary)] text-sm max-w-md">
          <p className="text-[var(--color-accent)] font-semibold text-base mb-3" style={{ fontFamily: "Orbitron, Inter, sans-serif" }}>
            SEMV ANALYSIS
          </p>
          <p className="mb-4">
            Complete the following to run SEMV analysis:
          </p>
          <ul className="text-left space-y-1.5">
            {missing.map((m, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[var(--color-status-danger)] mt-0.5">&#x2717;</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // Old SEMV sim results (only available when adopted comps + MV exist)
  const simMVs = sim?.simMVs ?? [];
  const mean = sim?.mean ?? 0;
  const stdDev = sim?.stdDev ?? 0;
  const p1 = sim?.p1 ?? 0;
  const p99 = sim?.p99 ?? 0;
  const mode = sim?.mode ?? 0;
  const percentile = useMemo(() => {
    if (!simMVs.length || !effectiveMV) return 0;
    let lo = 0, hi = simMVs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (simMVs[mid] < effectiveMV) lo = mid + 1; else hi = mid;
    }
    return Math.round((lo / simMVs.length) * 100);
  }, [simMVs, effectiveMV]);
  const sigma = stdDev > 0 && effectiveMV ? (effectiveMV - mean) / stdDev : 0;

  return (
    <div className="space-y-3 pb-6">
      {/* Row 1: Adjustment sliders (2x2 grid) + Key stats — only when old SEMV is ready */}
      {ready && (<>
      {/* Row 1: Adjustment sliders (2x2 grid) + Key stats */}
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        {/* Left: 2x2 slider grid */}
        <div className="grid grid-cols-2 gap-2 no-print">
          {/* HPI */}
          {hpiTrend.length > 0 && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wide font-medium">HPI</span>
                <span className="text-xs font-bold text-[var(--color-accent)] tabular-nums">{hpiCorrelation}%</span>
              </div>
              <input type="range" min={0} max={100} step={5} value={hpiCorrelation}
                onChange={e => onHpiCorrelationChange(Number(e.target.value))}
                list="hpi-ticks" className="w-full h-1.5 accent-[var(--color-accent)]" />
              <datalist id="hpi-ticks">{Array.from({ length: 21 }, (_, i) => <option key={i} value={i * 5} />)}</datalist>
            </div>
          )}
          {/* Size */}
          <div className={`rounded-lg border px-3 py-2 transition-colors ${compSizeElasticity !== 0 ? "border-[#F59E0B]/40 bg-[#F59E0B]/5" : "border-[var(--color-border)] bg-[var(--color-bg-panel)]"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wide font-medium">Size</span>
              <span className={`text-xs font-bold tabular-nums ${compSizeElasticity !== 0 ? "text-[#F59E0B]" : "text-[var(--color-text-secondary)]"}`}>{compSizeElasticity}%</span>
            </div>
            <input type="range" min={-50} max={50} step={5} value={compSizeElasticity}
              onChange={e => onCompSizeElasticityChange(Number(e.target.value))}
              list="size-ticks" className={`w-full h-1.5 ${compSizeElasticity !== 0 ? "accent-[#F59E0B]" : "accent-[var(--color-border)]"}`} />
            <datalist id="size-ticks">{Array.from({ length: 21 }, (_, i) => <option key={i} value={-50 + i * 5} />)}</datalist>
          </div>
          {/* EPC */}
          <div className={`rounded-lg border px-3 py-2 transition-colors ${epcBeta !== 50 ? "border-[#10B981]/40 bg-[#10B981]/5" : "border-[var(--color-border)] bg-[var(--color-bg-panel)]"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wide font-medium">EPC</span>
              <span className={`text-xs font-bold tabular-nums ${epcBeta !== 50 ? "text-[#10B981]" : "text-[var(--color-text-secondary)]"}`}>{epcBeta}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={epcBeta}
              onChange={e => onEpcBetaChange(Number(e.target.value))}
              list="epc-ticks" className={`w-full h-1.5 ${epcBeta !== 50 ? "accent-[#10B981]" : "accent-[var(--color-border)]"}`} />
            <datalist id="epc-ticks">{Array.from({ length: 21 }, (_, i) => <option key={i} value={i * 5} />)}</datalist>
          </div>
          {/* Floor */}
          <div className={`rounded-lg border px-3 py-2 transition-colors ${floorPremium !== 50 ? "border-[#8B5CF6]/40 bg-[#8B5CF6]/5" : "border-[var(--color-border)] bg-[var(--color-bg-panel)]"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wide font-medium">Floor</span>
              <span className={`text-xs font-bold tabular-nums ${floorPremium !== 50 ? "text-[#8B5CF6]" : "text-[var(--color-text-secondary)]"}`}>{floorPremium}%</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={floorPremium}
              onChange={e => onFloorPremiumChange(Number(e.target.value))}
              list="floor-ticks" className={`w-full h-1.5 ${floorPremium !== 50 ? "accent-[#8B5CF6]" : "accent-[var(--color-border)]"}`} />
            <datalist id="floor-ticks">{Array.from({ length: 21 }, (_, i) => <option key={i} value={i * 5} />)}</datalist>
          </div>
        </div>

        {/* Right: Comparable stats compact */}
        {hasAdopted && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
              <span className="text-[9px] font-bold tracking-[1.5px] text-[var(--color-accent)] uppercase">Comparables</span>
              <span className="text-[9px] text-[var(--color-text-secondary)]">{adoptedComparables.length} adopted</span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[var(--color-border)]">
              {[
                { label: "Price Range", value: `${fmtK(adoptedStats.priceMin)}–${fmtK(adoptedStats.priceMax)}`, sub: `avg ${fmtK(adoptedStats.priceAvg)}` },
                { label: "£/sqft", value: adoptedStats.psfMin != null ? `${fmtPsf(adoptedStats.psfMin)}–${fmtPsf(adoptedStats.psfMax!)}` : "—", sub: adoptedStats.psfAvg != null ? `avg ${fmtPsf(adoptedStats.psfAvg)}${adoptedStats.adjPsfAvg != null && hpiCorrelation > 0 && adoptedStats.adjPsfAvg !== Math.round(adoptedStats.psfAvg!) ? ` · adj ${fmtPsf(adoptedStats.adjPsfAvg)}` : ""}` : undefined },
                { label: "Floor Area", value: adoptedStats.sizeMin != null ? `${Math.round(adoptedStats.sizeMin * 10.764).toLocaleString()}–${Math.round(adoptedStats.sizeMax! * 10.764).toLocaleString()} sqft` : "—", sub: adoptedStats.sizeAvg != null ? `avg ${Math.round(adoptedStats.sizeAvg * 10.764).toLocaleString()} sqft` : undefined },
                { label: "Date Range", value: adoptedStats.dateMin ? `${fmtDateShort(adoptedStats.dateMin)}–${fmtDateShort(adoptedStats.dateMax ?? adoptedStats.dateMin)}` : "—" },
              ].map((s, i) => (
                <div key={i} className="bg-[var(--color-bg-panel)] px-3 py-2">
                  <p className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wide mb-0.5">{s.label}</p>
                  <p className="text-xs font-bold text-[var(--color-text-primary)] tabular-nums leading-tight">{s.value}</p>
                  {s.sub && <p className="text-[10px] text-[var(--color-text-secondary)] tabular-nums mt-0.5">{s.sub}</p>}
                </div>
              ))}
            </div>
            {/* Indicative valuation */}
            {adoptedStats.indLow != null && (
              <div className="px-3 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg-base)]">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[9px] text-[var(--color-accent)] uppercase tracking-wide font-bold">Indicative</span>
                  <span className="text-sm font-bold text-[var(--color-accent)] tabular-nums" style={{ textShadow: "0 0 8px var(--color-accent-dim)" }}>
                    {fmtK(adoptedStats.indLow)}–{fmtK(adoptedStats.indHigh!)}
                  </span>
                  {adoptedStats.indMid != null && <span className="text-xs font-semibold text-[var(--color-status-info)] tabular-nums">mid {fmtK(adoptedStats.indMid)}</span>}
                  {adoptedStats.indPsf != null && <span className="text-[10px] text-[var(--color-text-secondary)] tabular-nums">@ {fmtPsf(adoptedStats.indPsf)}/sqft</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 2: Monte Carlo stats (single row) + PDF chart side by side */}
      <div className="grid grid-cols-[280px_1fr] gap-3">
        {/* Left: Stats column */}
        <div className="grid auto-rows-auto gap-1.5">
          {[
            { label: "Adopted MV", value: subjectSizeSqft ? `${fmtGBP(effectiveMV!)} / £${Math.round(effectiveMV! / subjectSizeSqft).toLocaleString()} psf` : fmtGBP(effectiveMV!), color: "var(--color-accent-pink)" },
            { label: "Mode (Peak)", value: subjectSizeSqft ? `${fmtGBP(mode)} / £${Math.round(mode / subjectSizeSqft).toLocaleString()} psf` : fmtGBP(mode), color: "var(--color-status-success)" },
            { label: "Sim Mean", value: subjectSizeSqft ? `${fmtGBP(mean)} / £${Math.round(mean / subjectSizeSqft).toLocaleString()} psf` : fmtGBP(mean), color: "var(--color-accent)" },
            { label: "Std Dev (1σ)", value: fmtGBP(stdDev), color: "var(--color-text-primary)" },
            { label: "0.25σ Range", value: `${fmtGBP(mean - 0.25 * stdDev)} – ${fmtGBP(mean + 0.25 * stdDev)}`, color: "var(--color-text-primary)" },
            { label: "0.5σ Range", value: `${fmtGBP(mean - 0.5 * stdDev)} – ${fmtGBP(mean + 0.5 * stdDev)}`, color: "var(--color-text-primary)" },
            { label: "1σ Range (68%)", value: `${fmtGBP(mean - stdDev)} – ${fmtGBP(mean + stdDev)}`, color: "var(--color-text-primary)" },
            { label: "98% CI (P1–P99)", value: `${fmtGBP(p1)} – ${fmtGBP(p99)}`, color: "var(--color-accent)" },
          ].map((s, i) => (
            <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-1.5 flex items-center justify-between">
              <span className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wide">{s.label}</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Right: PDF chart */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
          <p className="text-[9px] tracking-[0.12em] text-[var(--color-text-secondary)] uppercase mb-1">Probability Density Function</p>
          <PdfChart simMVs={simMVs} mean={mean} mode={mode} adoptedMV={effectiveMV!} p1={p1} p99={p99} stdDev={stdDev} onAdoptedMVChange={onAdoptedMVChange} />
        </div>
      </div>

      {/* 4. Layer 1 Table — selected best comps */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-[10px] tracking-[0.12em] text-[var(--color-text-secondary)] uppercase">
            LAYER 1 — {adoptedComparables.length} adopted + {selectedLayer1.length - adoptedComparables.length} auto-selected = {selectedLayer1.length} of {layer1Comps.length + adoptedComparables.length} &middot; {sim!.compsUsed} passed &plusmn;25% size gate
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 13%, transparent), color-mix(in srgb, var(--color-accent-pink) 13%, transparent))" }}>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium">#</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium">Address</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-right">Size ft²</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-right">Sale Price</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-right">Raw PSF</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-right">Adj PSF</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-center">Date</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-center">Sim</th>
                <th className="px-3 py-2 text-[var(--color-text-secondary)] font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...selectedLayer1]
                .sort((a, b) => {
                  const aAdopted = adoptedIds.has(a.transaction_id ?? a.address) ? 0 : 1;
                  const bAdopted = adoptedIds.has(b.transaction_id ?? b.address) ? 0 : 1;
                  return aAdopted - bAdopted;
                })
                .map((c, i) => {
                  const isAdopted = adoptedIds.has(c.transaction_id ?? c.address);
                  const sqft = c.floor_area_sqm != null ? Math.round(c.floor_area_sqm * 10.764) : null;
                  const psf = sqft != null && sqft > 0 ? c.price / sqft : null;
                  // Check if comp passes the ±25% size gate
                  const sizeExcluded = sqft != null && subjectSizeSqft != null && subjectSizeSqft > 0
                    ? Math.abs(subjectSizeSqft - sqft) / Math.max(subjectSizeSqft, sqft) > 0.25
                    : false;

                  // Deterministic adjusted PSF (midpoint of each parameter range)
                  let adjPsf: number | null = null;
                  if (sqft != null && sqft > 0 && subjectSizeSqft != null && subjectSizeSqft > 0 && !sizeExcluded) {
                    const txMonth = c.transaction_date.slice(0, 7);
                    const valMonth = valuationDate.slice(0, 7);
                    const compHpi = getHpiForMonth(hpiTrend, txMonth, c);
                    const subjectProxy = { ...c, property_type: subjectPropertyType, house_sub_type: subjectHouseSubType } as ComparableCandidate;
                    const subHpi = getHpiForMonth(hpiTrend, valMonth, subjectProxy);
                    const detSizeAlpha = sizeElasticityOverride != null ? sizeElasticityOverride : 0.175;
                    let timeAdj = 0;
                    if (compHpi != null && subHpi != null && compHpi > 0) {
                      timeAdj = ((subHpi - compHpi) / compHpi) * 0.25;
                    }
                    let epcAdj = 0;
                    if (subjectEpcScore != null && c.epc_score != null && c.epc_score > 0) {
                      epcAdj = (subjectEpcScore - c.epc_score) * 0.0025;
                    }
                    const sizeAdj = detSizeAlpha * (subjectSizeSqft - sqft) / sqft;
                    let floorAdj = 0;
                    const compFloor = inferFloorFromSaon(c.saon as string | null);
                    const subjFloor = inferFloorFromSaon(subjectSaon);
                    if (subjFloor != null && compFloor != null) {
                      floorAdj = (subjFloor - compFloor) * 0.01;
                    }
                    let adjPrice = c.price * (1 + timeAdj + epcAdj + sizeAdj + floorAdj);
                    if (detSizeAlpha >= 0) {
                      if (subjectSizeSqft < sqft) adjPrice = Math.min(adjPrice, c.price);
                      else if (subjectSizeSqft > sqft) adjPrice = Math.max(adjPrice, c.price);
                    }
                    adjPsf = adjPrice / subjectSizeSqft;
                  }
                  return (
                    <tr
                      key={c.transaction_id ?? `${c.address}-${i}`}
                      className={i % 2 === 0 ? "bg-[var(--color-bg-panel)]" : "bg-[var(--color-bg-surface)]"}
                      style={sizeExcluded ? { opacity: 0.4 } : undefined}
                    >
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{i + 1}</td>
                      <td className="px-3 py-2 text-[var(--color-text-primary)] max-w-[240px] truncate">{c.address}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                        {sqft != null ? sqft.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">{fmtGBP(c.price)}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-primary)]">
                        {psf != null ? fmtPsf(psf) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {adjPsf != null ? (
                          <span className={adjPsf > (psf ?? 0) ? "text-[var(--color-status-success)]" : adjPsf < (psf ?? 0) ? "text-[var(--color-status-warning)]" : "text-[var(--color-text-primary)]"}>
                            {fmtPsf(adjPsf)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center text-[var(--color-text-secondary)]">
                        {c.transaction_date.slice(0, 7)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(() => {
                          const simScore = similarityMap.get(c.transaction_id ?? c.address);
                          if (simScore == null) return "—";
                          const pct = Math.round(simScore * 100);
                          return (
                            <span className={`text-[10px] font-semibold tabular-nums ${
                              pct >= 80 ? "text-[var(--color-status-success)]" :
                              pct >= 60 ? "text-[#F59E0B]" :
                              "text-[var(--color-status-danger)]"
                            }`}>
                              {pct}%
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {sizeExcluded ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-[var(--color-border)]/50 text-[var(--color-text-muted)] border border-[var(--color-text-muted)]/30 line-through">
                            SIZE EXCLUDED
                          </span>
                        ) : isAdopted ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-[var(--color-btn-primary-bg)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30">
                            ADOPTED
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-[#ff8a00]/15 text-[#ff8a00] border border-[#ff8a00]/30">
                            LAYER 1
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      </>)}

      {/* 6. Auto-Select Best 5 — MC Adjustment Engine */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
          <div>
            <h3 className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider" style={{ fontFamily: "Orbitron, Inter, sans-serif" }}>
              Auto-Select &amp; Adjust (MC)
            </h3>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
              {(() => {
                const direct = semvPool.filter((c: any) => c.geographic_tier != null && c.geographic_tier <= 2).length;
                const wider = semvPool.length - direct;
                return `Pool: ${direct} direct + ${wider} wider (top 30) = ${semvPool.length} comps`;
              })()}
            </p>
          </div>
          {autoSelectLoading && (
            <span className="text-xs text-[var(--color-accent)] animate-pulse">Running 50K iterations…</span>
          )}
        </div>

        {/* Planning extension checklist */}
        {planningExtensions?.has_extension && (() => {
          const exts = planningExtensions.extensions ?? [];
          const selectedSqm = exts.reduce((sum: number, ext: any) => {
            const key = ext.reference || `ext-${ext.decision_date}`;
            const isChecked = checkedExtensions[key] ?? false;
            return sum + (isChecked ? (Number(ext.estimated_sqm) || 0) : 0);
          }, 0);
          const adjustedArea = Math.round((Number(subjectAreaM2) || 0) + selectedSqm);
          const confidenceLabel: Record<string, { text: string; color: string }> = {
            likely_new: { text: "LIKELY NEW", color: "#F59E0B" },
            uncertain: { text: "NET CHANGE UNCERTAIN", color: "#94A3B8" },
            already_in_epc: { text: "ALREADY IN EPC", color: "var(--color-status-success)" },
          };
          const baseEpc = (planningExtensions as any).base_epc;

          return (
            <div className="border-b border-[#F59E0B]/30 bg-[#F59E0B]/5">
              <div className="px-4 py-2.5">
                <p className="text-xs font-semibold text-[#F59E0B] mb-2">
                  &#9888; Planning Extensions Detected — select which to include in floor area
                </p>

                {/* Extension checklist */}
                <div className="space-y-1.5">
                  {exts.map((ext: any, i: number) => {
                    const key = ext.reference || `ext-${i}`;
                    const isChecked = checkedExtensions[key] ?? false;
                    const conf = confidenceLabel[ext.confidence] ?? confidenceLabel.likely_new;
                    const sqm = Number(ext.estimated_sqm) || 0;

                    return (
                      <label key={key} className="flex items-start gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            setCheckedExtensions(prev => ({ ...prev, [key]: e.target.checked }));
                            // Reset adopted area when selections change
                            if (adoptedAdjustedAreaM2) {
                              setAdoptedAdjustedAreaM2(null);
                            }
                          }}
                          className="mt-1 accent-[#F59E0B]"
                        />
                        <div className="flex-1 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-[var(--color-text-primary)]">{ext.reference}</span>
                            <span className="text-[var(--color-text-muted)]">({ext.decision_date})</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ color: conf.color, backgroundColor: `color-mix(in srgb, ${conf.color} 15%, transparent)` }}>
                              {conf.text}
                            </span>
                            <span className="font-bold text-[#F59E0B]">+{sqm}sqm est.</span>
                            {(ext as any).has_demolition && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--color-status-danger)]/10 text-[var(--color-status-danger)]">
                                INCLUDES DEMOLITION
                              </span>
                            )}
                          </div>
                          <p className="text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">{ext.description}</p>
                          {(ext as any).estimate_note && (ext as any).estimate_note !== "Gross addition" && (
                            <p className="text-[10px] text-[var(--color-status-warning)] mt-0.5">{(ext as any).estimate_note}</p>
                          )}
                          {ext.confidence_reason && (
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5 italic">{ext.confidence_reason}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Base EPC + history */}
                <div className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                  {baseEpc && (
                    <span className="font-semibold text-[var(--color-text-secondary)]">
                      Base EPC: {baseEpc.date} — {baseEpc.sqm}sqm
                    </span>
                  )}
                  {(planningExtensions as any).epc_history?.length > 1 && (
                    <span className="ml-2">
                      (history: {(planningExtensions as any).epc_history.map((e: any) => `${e.date} ${e.sqm}sqm`).join(" → ")})
                    </span>
                  )}
                </div>

                {/* Summary + adopt button */}
                <div className="mt-3 flex items-center gap-3 pt-2 border-t border-[#F59E0B]/20">
                  <p className="text-xs text-[var(--color-text-primary)] font-medium">
                    Base: {subjectAreaM2 ?? "?"}sqm {selectedSqm > 0 ? `+ ${selectedSqm}sqm selected = ${adjustedArea}sqm` : "(none selected)"}
                  </p>
                  {adoptedAdjustedAreaM2 ? (
                    <span className="px-2.5 py-1 rounded text-[10px] font-semibold bg-[var(--color-status-success)]/15 text-[var(--color-status-success)] border border-[var(--color-status-success)]/30">
                      ADOPTED — {adoptedAdjustedAreaM2}sqm ({Math.round(adoptedAdjustedAreaM2 * 10.764)} sqft)
                    </span>
                  ) : selectedSqm > 0 ? (
                    <button
                      onClick={() => {
                        setAdoptedAdjustedAreaM2(adjustedArea);
                        autoSelectRanRef.current = false;
                        setAutoSelectResultLocal(null);
                        onAutoSelectResult(null);
                      }}
                      className="px-2.5 py-1 rounded text-[10px] font-semibold transition-colors
                        bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30
                        hover:bg-[#F59E0B]/25"
                    >
                      Adopt {adjustedArea}sqm & re-run SEMV
                    </button>
                  ) : (
                    <span className="text-[10px] text-[var(--color-text-muted)]">Tick extensions to include, then adopt</span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {autoSelectError && (
          <div className="px-4 py-2 text-xs text-[var(--color-status-danger)] bg-[var(--color-status-danger)]/5">
            {autoSelectError}
          </div>
        )}

        {!boroughSlug && (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">
            Borough not identified — auto-select requires borough-specific LR coefficients
          </div>
        )}

        {autoSelectResult && (
          <div className="divide-y divide-[var(--color-border)]">
            {/* Valuation Distribution Summary */}
            <div className="px-4 py-3">
              <div className="grid grid-cols-5 gap-3 text-center">
                <div>
                  <div className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">P5</div>
                  <div className="text-sm font-bold text-[var(--color-text-primary)]">{fmtK(autoSelectResult.valuation.p5)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">Median</div>
                  <div className="text-sm font-bold text-[var(--color-text-primary)]">{fmtK(autoSelectResult.valuation.median)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-[var(--color-accent)] uppercase tracking-wide mb-0.5 font-semibold">Mode</div>
                  <div className="text-base font-bold text-[var(--color-accent)]">{fmtK(autoSelectResult.valuation.mode ?? autoSelectResult.valuation.median)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">Mean</div>
                  <div className="text-sm font-bold text-[var(--color-text-primary)]">{fmtK(autoSelectResult.valuation.mean)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide mb-0.5">P95</div>
                  <div className="text-sm font-bold text-[var(--color-text-primary)]">{fmtK(autoSelectResult.valuation.p95)}</div>
                </div>
              </div>
              <div className="mt-2 text-center text-[10px] text-[var(--color-text-muted)]">
                {autoSelectResult.iterations.toLocaleString()} iterations in {autoSelectResult.elapsed_ms}ms
                &middot; {autoSelectResult.coefficients_used.borough} {autoSelectResult.coefficients_used.property_type} model
                &middot; MdAPE {autoSelectResult.coefficients_used.mdape.toFixed(1)}%
              </div>
            </div>

            {/* Distribution Chart */}
            {autoSelectResult.histogram?.length > 0 && (() => {
              const hist = autoSelectResult.histogram;
              const val = autoSelectResult.valuation;
              const W = 800, H = 240;
              const PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 40;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;

              const maxDensity = Math.max(...hist.map(h => h.density));
              const minV = hist[0].bin_center;
              const maxV = hist[hist.length - 1].bin_center;
              const range = maxV - minV || 1;

              const xScale = (v: number) => PAD_L + ((v - minV) / range) * plotW;
              const yScale = (d: number) => PAD_T + plotH - (d / maxDensity) * plotH;

              // Build smooth curve path
              const points = hist.map(h => ({ x: xScale(h.bin_center), y: yScale(h.density), v: h.bin_center }));
              let path = `M ${points[0].x},${yScale(0)} L ${points[0].x},${points[0].y}`;
              for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;
                path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
              }
              path += ` L ${points[points.length - 1].x},${yScale(0)} Z`;

              // P5-P95 shaded region
              const p5x = xScale(val.p5);
              const p95x = xScale(val.p95);
              const shadePoints = points.filter(p => p.x >= p5x && p.x <= p95x);
              let shadePath = "";
              if (shadePoints.length > 1) {
                shadePath = `M ${p5x},${yScale(0)} L ${shadePoints[0].x},${shadePoints[0].y}`;
                for (let i = 1; i < shadePoints.length; i++) {
                  shadePath += ` L ${shadePoints[i].x},${shadePoints[i].y}`;
                }
                shadePath += ` L ${p95x},${yScale(0)} Z`;
              }

              const modeX = xScale(val.mode ?? val.median);
              const meanX = xScale(val.mean);

              // X-axis ticks
              const rough = range / 5;
              const mag = Math.pow(10, Math.floor(Math.log10(rough)));
              const norm = rough / mag;
              const niceStep = norm <= 1 ? mag : norm <= 2 ? 2 * mag : norm <= 5 ? 5 * mag : 10 * mag;
              const ticks: { v: number; x: number }[] = [];
              for (let v = Math.ceil(minV / niceStep) * niceStep; v <= maxV; v += niceStep) {
                ticks.push({ v, x: xScale(v) });
              }
              const fmt = (v: number) => v >= 1_000_000 ? `£${(v / 1_000_000).toFixed(1)}m` : `£${Math.round(v / 1000)}k`;

              return (
                <div className="px-4 py-3">
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }}>
                    {/* P5-P95 shaded area */}
                    {shadePath && <path d={shadePath} fill="var(--color-accent)" opacity={0.12} />}

                    {/* Distribution curve */}
                    <path d={path} fill="var(--color-accent)" opacity={0.06} />
                    <path d={path.replace(/ Z$/, "")} fill="none" stroke="var(--color-accent)" strokeWidth={2} opacity={0.8} />

                    {/* Mode line */}
                    <line x1={modeX} y1={PAD_T} x2={modeX} y2={PAD_T + plotH}
                      stroke="var(--color-accent)" strokeWidth={2} />
                    <text x={modeX + 5} y={PAD_T + 14} fill="var(--color-accent)" fontSize={10} fontFamily="Inter, sans-serif" fontWeight="bold">
                      Mode {fmt(val.mode ?? val.median)}
                    </text>

                    {/* Mean dashed line */}
                    <line x1={meanX} y1={PAD_T} x2={meanX} y2={PAD_T + plotH}
                      stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.6} />
                    <text x={meanX - 5} y={PAD_T + 28} fill="var(--color-accent)" fontSize={9} textAnchor="end" fontFamily="Inter, sans-serif" opacity={0.7}>
                      Mean {fmt(val.mean)}
                    </text>

                    {/* P5 / P95 labels */}
                    <line x1={p5x} y1={PAD_T} x2={p5x} y2={PAD_T + plotH}
                      stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
                    <text x={p5x} y={PAD_T + plotH + 14} fill="var(--color-text-muted)" fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif">
                      P5 {fmt(val.p5)}
                    </text>
                    <line x1={p95x} y1={PAD_T} x2={p95x} y2={PAD_T + plotH}
                      stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
                    <text x={p95x} y={PAD_T + plotH + 14} fill="var(--color-text-muted)" fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif">
                      P95 {fmt(val.p95)}
                    </text>

                    {/* P10 / P90 and P15 / P85 lines */}
                    {[
                      { p: 10, low: val.p10, high: val.p90, label: "P10", labelHi: "P90", opacity: 0.35, dash: "4,4" },
                      { p: 15, low: val.p15, high: val.p85, label: "P15", labelHi: "P85", opacity: 0.25, dash: "2,3" },
                    ].map(({ p, low, high, label, labelHi, opacity: op, dash }) => {
                      if (low == null || high == null) return null;
                      const lx = xScale(low);
                      const hx = xScale(high);
                      const labelY = p === 10 ? PAD_T + 12 : PAD_T + 24;
                      return (
                        <g key={p}>
                          <line x1={lx} y1={PAD_T} x2={lx} y2={PAD_T + plotH}
                            stroke="var(--color-accent)" strokeWidth={1} strokeDasharray={dash} opacity={op} />
                          <text x={lx} y={labelY} fill="var(--color-accent)" fontSize={8} textAnchor="middle" fontFamily="Inter, sans-serif" opacity={0.7}>
                            {label} {fmt(low)}
                          </text>
                          <line x1={hx} y1={PAD_T} x2={hx} y2={PAD_T + plotH}
                            stroke="var(--color-accent)" strokeWidth={1} strokeDasharray={dash} opacity={op} />
                          <text x={hx} y={labelY} fill="var(--color-accent)" fontSize={8} textAnchor="middle" fontFamily="Inter, sans-serif" opacity={0.7}>
                            {labelHi} {fmt(high)}
                          </text>
                        </g>
                      );
                    })}

                    {/* X-axis ticks */}
                    {ticks.map(t => (
                      <g key={t.v}>
                        <line x1={t.x} y1={PAD_T + plotH} x2={t.x} y2={PAD_T + plotH + 5} stroke="var(--color-text-muted)" opacity={0.4} />
                        <text x={t.x} y={PAD_T + plotH + 30} fill="var(--color-text-muted)" fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif">
                          {fmt(t.v)}
                        </text>
                      </g>
                    ))}

                    {/* Axes */}
                    <line x1={PAD_L} y1={PAD_T + plotH} x2={PAD_L + plotW} y2={PAD_T + plotH}
                      stroke="var(--color-border)" strokeWidth={1} />
                  </svg>
                </div>
              );
            })()}

            {/* Adjustment Grid — Best 5 */}
            <div className="px-4 py-3">
              <div className="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wide font-medium mb-2">
                Best 10 Comparables — Adjustment Grid
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="text-left px-2 py-1.5 text-[var(--color-text-muted)] font-medium w-[160px]"></th>
                      {autoSelectResult.best_5.map((c, i) => (
                        <th key={i} className="text-center px-2 py-1.5 text-[var(--color-text-secondary)] font-medium min-w-[100px]">
                          Comp {i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-[var(--color-border)]/50">
                      <td className="px-2 py-1.5 text-[var(--color-text-muted)]">Address</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-[var(--color-text-primary)] text-center text-[10px] max-w-[120px] truncate" title={c.address}>
                          {c.address.split(",")[0]}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--color-border)]/50 bg-[var(--color-bg-surface)]">
                      <td className="px-2 py-1.5 text-[var(--color-text-muted)]">Postcode</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-[var(--color-text-secondary)] text-center text-[10px]">
                          {(c as any).postcode ?? "—"}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--color-border)]/50 bg-[var(--color-bg-surface)]">
                      <td className="px-2 py-1.5 text-[var(--color-text-muted)]">Transaction price</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-[var(--color-text-primary)] text-center font-medium">
                          £{c.price.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--color-border)]/50">
                      <td className="px-2 py-1.5 text-[var(--color-text-muted)]">Floor area (sqft)</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-[var(--color-text-primary)] text-center">{Math.round(c.floor_area_sqm * 10.764)}</td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--color-border)]/50 bg-[var(--color-bg-surface)]">
                      <td className="px-2 py-1.5 text-[var(--color-text-muted)]">Raw PSF</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-[var(--color-text-primary)] text-center">£{Math.round(c.raw_psf / 10.764)}/sqft</td>
                      ))}
                    </tr>
                    {/* Adjustment rows */}
                    {(["time", "size", "rooms", "epc", "imd", "age"] as const).map((dim) => {
                      const label = { time: "Time (HPI)", size: "Size", rooms: "Bedrooms", epc: "EPC", imd: "IMD", age: "Age" }[dim];
                      const key = `${dim}_adj_pct` as keyof AutoSelectComp;
                      return (
                        <tr key={dim} className="border-b border-[var(--color-border)]/50">
                          <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{label} adj</td>
                          {autoSelectResult.best_5.map((c, i) => {
                            const v = c[key] as number;
                            return (
                              <td key={i} className={`px-2 py-1.5 text-center font-medium ${
                                Math.abs(v) < 0.1 ? "text-[var(--color-text-muted)]" :
                                v > 0 ? "text-[var(--color-status-success)]" : "text-[var(--color-status-warning)]"
                              }`}>
                                {Math.abs(v) < 0.1 ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {/* Totals */}
                    <tr className="border-b-2 border-[var(--color-border)] bg-[var(--color-bg-surface)]">
                      <td className="px-2 py-1.5 text-[var(--color-text-primary)] font-semibold">Total adj</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className={`px-2 py-1.5 text-center font-bold ${
                          c.total_adj_pct > 0 ? "text-[var(--color-status-success)]" :
                          c.total_adj_pct < 0 ? "text-[var(--color-status-warning)]" : "text-[var(--color-text-primary)]"
                        }`}>
                          {c.total_adj_pct > 0 ? "+" : ""}{c.total_adj_pct.toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--color-border)]/50">
                      <td className="px-2 py-1.5 text-[var(--color-text-primary)] font-semibold">Adjusted PSF</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-center font-bold text-[var(--color-accent)]">
                          £{Math.round(c.adjusted_psf / 10.764)}/sqft
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-[var(--color-border)]/50 bg-[var(--color-bg-surface)]">
                      <td className="px-2 py-1.5 text-[var(--color-text-primary)] font-semibold">Implied MV</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-center font-bold text-[var(--color-accent)]">
                          {fmtK(c.implied_mv)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-2 py-1.5 text-[var(--color-text-muted)]">Similarity</td>
                      {autoSelectResult.best_5.map((c, i) => (
                        <td key={i} className="px-2 py-1.5 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            c.similarity >= 0.8 ? "bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]" :
                            c.similarity >= 0.6 ? "bg-[#F59E0B]/15 text-[#F59E0B]" :
                            "bg-[var(--color-status-danger)]/15 text-[var(--color-status-danger)]"
                          }`}>
                            {(c.similarity * 100).toFixed(0)}%
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 7. Methodology Footer */}
      <p className="text-[10px] text-[var(--color-text-muted)] text-center leading-relaxed max-w-2xl mx-auto">
        SEMV V1.0 &middot; 100,000 Monte Carlo simulations &middot;
        Auto-selected top {selectedLayer1.length} of {layer1Comps.length} comps by similarity &middot;
        Hard size gate &plusmn;25% &middot; Similarity-biased selection &amp; weighting &middot;
        HPI [{hpiCorrelation}%], Size &alpha; [{compSizeElasticity === 0 ? "-15% to 50%" : `fixed ${compSizeElasticity}%`}], EPC [{epcBeta}%], Floor [{floorPremium}%] &middot;
        Layer 1 = adopted + auto-selected (max {MAX_LAYER1}) &middot; Layer 2 = unregistered (unobservable) &middot;
        Layer 3 = surveyor adopted &middot;
        Confidence assessment only — this is not a valuation
      </p>
    </div>
  );
}

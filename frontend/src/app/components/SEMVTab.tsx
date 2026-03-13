"use client";
import { useMemo, useState, useRef, useCallback } from "react";

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

// ── Monte Carlo Engine ───────────────────────────────────────────────────────
interface SimulationResult {
  simMVs: number[];
  mean: number;
  stdDev: number;
  p5: number;
  p95: number;
  percentile: number;
  sigma: number;
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
  subjectSaon: string | null
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
    return { simMVs: [], mean: 0, stdDev: 0, p5: 0, p95: 0, percentile: 0, sigma: 0, compsUsed: compsWithData.length };
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

  // Weighted random pick: returns comp index proportional to similarity
  function weightedPick(rng: () => number, excluded: Set<number>): number {
    // Retry up to 20 times to find a non-excluded comp
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = rng();
      for (let i = 0; i < n; i++) {
        if (r <= cumSim[i]) {
          if (!excluded.has(i)) return i;
          break;
        }
      }
    }
    // Fallback: pick first non-excluded
    for (let i = 0; i < n; i++) {
      if (!excluded.has(i)) return i;
    }
    return 0;
  }

  for (let sim = 0; sim < N_SIMS; sim++) {
    // Randomness 1 — How many comps to pick (1 to N)
    const pickCount = Math.floor(rng() * n) + 1;

    // Similarity-weighted selection: more similar comps are more likely to be chosen
    // (replaces uniform Fisher-Yates shuffle)
    const picked: number[] = [];
    const excluded = new Set<number>();
    for (let i = 0; i < pickCount; i++) {
      const idx = weightedPick(rng, excluded);
      picked.push(idx);
      excluded.add(idx);
    }

    // Randomness 2 — Adjustment parameters
    const passthroughRate = rng(); // Uniform[0, 1] — full range of HPI indexation
    const betaEpc = rng() * 0.005; // Uniform[0, 0.005] — 0–0.5% per EPC point
    const sizeAlpha = rng() * 0.5; // Uniform[0, 0.5] — size elasticity, capped at 50%
    const floorPremium = 0.001 + rng() * 0.019; // Uniform[0.1%, 2%] per floor — higher floor = more expensive

    // Randomness 3 — Similarity-biased weights
    // Base weight = similarity score; noise = rng() in [0.2, 1.8]
    // More similar comps naturally get higher weight, but with per-sim variation
    let weightSum = 0;
    const weights: number[] = [];
    const adjPrices: number[] = [];

    for (let i = 0; i < pickCount; i++) {
      const compIdx = picked[i];
      const comp = compsWithData[compIdx];

      // Time adjustment (HPI-based)
      let timeAdj = 0;
      if (comp.compHpi != null && comp.subjectHpi != null && comp.compHpi > 0) {
        timeAdj =
          ((comp.subjectHpi - comp.compHpi) / comp.compHpi) * passthroughRate;
      }

      // EPC adjustment — better EPC = premium, worse = discount
      let epcAdj = 0;
      if (subjectEpcScore != null && comp.epcScore != null && comp.epcScore > 0) {
        epcAdj = (subjectEpcScore - comp.epcScore) * betaEpc;
      }

      // Size adjustment — elasticity-based, capped at 50%, with monotonicity guard.
      // If subject is larger than comp, price adjusts up (but not by more than alpha
      // of the proportional size difference). Vice versa for smaller subject.
      let sizeAdj = 0;
      if (subjectSizeSqft > 0 && comp.sqft > 0) {
        sizeAdj = sizeAlpha * (subjectSizeSqft - comp.sqft) / comp.sqft;
      }

      // Floor level adjustment — higher floors command a premium
      let floorAdj = 0;
      if (subjectFloor != null && comp.compFloor != null) {
        const floorDiff = subjectFloor - comp.compFloor;
        floorAdj = floorDiff * floorPremium;
      }

      let adjPrice = comp.price * (1 + timeAdj + epcAdj + sizeAdj + floorAdj);

      // Monotonicity clamp: a smaller subject must not produce a higher price
      // than the comp's raw price; a larger subject must not produce a lower price.
      if (subjectSizeSqft < comp.sqft) {
        adjPrice = Math.min(adjPrice, comp.price);
      } else if (subjectSizeSqft > comp.sqft) {
        adjPrice = Math.max(adjPrice, comp.price);
      }
      adjPrices.push(adjPrice);

      // Similarity-biased weight: similarity * random noise [0.2, 1.8]
      const noise = 0.2 + rng() * 1.6;
      const w = similarityScores[compIdx] * noise;
      weights.push(w);
      weightSum += w;
    }

    // Weighted average adjusted price → simulated MV
    let simMV = 0;
    for (let i = 0; i < pickCount; i++) {
      simMV += (weights[i] / weightSum) * adjPrices[i];
    }
    simMVs[sim] = simMV;
  }

  // Sort for percentile calculation
  const sorted = Array.from(simMVs).sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / N_SIMS;
  const variance =
    sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / N_SIMS;
  const stdDev = Math.sqrt(variance);
  const p5 = sorted[Math.floor(N_SIMS * 0.05)];
  const p95 = sorted[Math.floor(N_SIMS * 0.95)];

  // Percentile of adopted MV
  let below = 0;
  for (const v of sorted) {
    if (v < adoptedMV) below++;
    else break;
  }
  const percentile = Math.round((below / N_SIMS) * 100);
  const sigma = stdDev > 0 ? (adoptedMV - mean) / stdDev : 0;

  return { simMVs: sorted, mean, stdDev, p5, p95, percentile, sigma, compsUsed: n };
}

// ── PDF Chart (SVG) ──────────────────────────────────────────────────────────
function PdfChart({
  simMVs,
  mean,
  adoptedMV,
  p5,
  p95,
  stdDev,
}: {
  simMVs: number[];
  mean: number;
  adoptedMV: number;
  p5: number;
  p95: number;
  stdDev: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; value: number; pct: number } | null>(null);

  const W = 800;
  const H = 300;
  const PAD_L = 70;
  const PAD_R = 30;
  const PAD_T = 20;
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

  // Mouse/touch → SVG coordinate → nearest curve point
  const handlePointer = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
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
  }, [points, pctBelow, W, plotW]);

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

  // P5-P95 shaded region
  const p5x = xScale(p5);
  const p95x = xScale(p95);
  const shadePoints = points.filter((p) => p.x >= p5x && p.x <= p95x);
  let shadePath = "";
  if (shadePoints.length > 1) {
    shadePath = `M ${p5x},${yScale(0)} L ${shadePoints[0].x},${shadePoints[0].y}`;
    for (let i = 1; i < shadePoints.length; i++) {
      shadePath += ` L ${shadePoints[i].x},${shadePoints[i].y}`;
    }
    shadePath += ` L ${p95x},${yScale(0)} Z`;
  }

  const meanX = xScale(mean);
  const mvX = xScale(adoptedMV);

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
      {/* P5-P95 shaded area */}
      {shadePath && (
        <path d={shadePath} fill="#00F0FF" opacity={0.1} />
      )}

      {/* Distribution curve */}
      <path d={path} fill="none" stroke="#00F0FF" strokeWidth={2} opacity={0.8} />

      {/* Filled area under curve */}
      <path d={path + " Z"} fill="#00F0FF" opacity={0.05} />

      {/* ±1σ and ±2σ bands */}
      {[
        { n: 1, color: "#7B2FBE", opacity: 0.08 },
        { n: 2, color: "#7B2FBE", opacity: 0.04 },
      ].map(({ n, color, opacity: fillOp }) => {
        const lo = xScale(Math.max(minV, mean - n * stdDev));
        const hi = xScale(Math.min(maxV, mean + n * stdDev));
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
            <text x={lo} y={PAD_T + plotH + 36} fill={color} fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif" opacity={0.7}>
              -{n}σ {fmtFull(mean - n * stdDev)}
            </text>
            <text x={hi} y={PAD_T + plotH + 36} fill={color} fontSize={9} textAnchor="middle" fontFamily="Inter, sans-serif" opacity={0.7}>
              +{n}σ {fmtFull(mean + n * stdDev)}
            </text>
          </g>
        );
      })}

      {/* Mean dashed line */}
      <line
        x1={meanX} y1={PAD_T} x2={meanX} y2={PAD_T + plotH}
        stroke="#00F0FF" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.7}
      />
      <text x={meanX} y={PAD_T - 5} fill="#00F0FF" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif">
        Mean {fmtFull(mean)}
      </text>

      {/* Adopted MV solid line */}
      <line
        x1={mvX} y1={PAD_T} x2={mvX} y2={PAD_T + plotH}
        stroke="#FF2D78" strokeWidth={2} opacity={0.9}
      />
      {/* Triangle marker */}
      <polygon
        points={`${mvX},${PAD_T + plotH + 2} ${mvX - 6},${PAD_T + plotH + 12} ${mvX + 6},${PAD_T + plotH + 12}`}
        fill="#FF2D78"
      />
      <text x={mvX} y={PAD_T - 5} fill="#FF2D78" fontSize={11} textAnchor="middle" fontWeight="bold" fontFamily="Inter, sans-serif">
        Adopted {fmtFull(adoptedMV)}
      </text>

      {/* X axis */}
      <line x1={PAD_L} y1={PAD_T + plotH} x2={PAD_L + plotW} y2={PAD_T + plotH} stroke="#334155" strokeWidth={1} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.x} y1={PAD_T + plotH} x2={t.x} y2={PAD_T + plotH + 6} stroke="#334155" />
          <text x={t.x} y={PAD_T + plotH + 22} fill="#94A3B8" fontSize={10} textAnchor="middle" fontFamily="Inter, sans-serif">
            {fmt(t.v)}
          </text>
        </g>
      ))}

      {/* Axis labels */}
      <text x={PAD_L + plotW / 2} y={H - 5} fill="#94A3B8" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif">
        Market Value
      </text>
      <text x={15} y={PAD_T + plotH / 2} fill="#94A3B8" fontSize={11} textAnchor="middle" fontFamily="Inter, sans-serif" transform={`rotate(-90, 15, ${PAD_T + plotH / 2})`}>
        Density
      </text>

      {/* Interactive hover dot + crosshair + tooltip */}
      {hover && (
        <g>
          {/* Vertical crosshair */}
          <line x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + plotH}
            stroke="#E2E8F0" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.4} />
          {/* Horizontal crosshair */}
          <line x1={PAD_L} y1={hover.y} x2={PAD_L + plotW} y2={hover.y}
            stroke="#E2E8F0" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.3} />
          {/* Glow ring */}
          <circle cx={hover.x} cy={hover.y} r={8} fill="#00F0FF" opacity={0.15} />
          {/* Dot */}
          <circle cx={hover.x} cy={hover.y} r={4.5} fill="#00F0FF" stroke="#0A0E1A" strokeWidth={2} />
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
                  fill="#0A0E1A" stroke="#00F0FF" strokeWidth={0.8} opacity={0.92} />
                <text x={tx + tw / 2} y={ty + 16} fill="#E2E8F0" fontSize={11} textAnchor="middle"
                  fontFamily="JetBrains Mono, Fira Code, monospace" fontWeight="600">
                  {fmtFull(hover.value)}
                  <tspan fill="#94A3B8" fontWeight="400">  ·  </tspan>
                  <tspan fill="#00F0FF">P{hover.pct}</tspan>
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
    { offset: "25%", color: "#39FF14" },
    { offset: "50%", color: "#A8E600" },
    { offset: "70%", color: "#FFB800" },
    { offset: "85%", color: "#FF8A00" },
    { offset: "100%", color: "#FF3131" },
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
              stroke={t.isLit ? t.tickColor : "#1E293B"}
              strokeWidth={t.isMajor ? 2 : 1}
              opacity={t.isLit ? 0.8 : 0.25}
              strokeLinecap="round"
            />
          ))}

          {/* Background ring */}
          <circle
            cx={cx} cy={cy} r={rOuter}
            fill="none" stroke="#1E293B" strokeWidth={strokeW}
          />

          {/* Faint inner ring */}
          <circle
            cx={cx} cy={cy} r={rInner}
            fill="none" stroke="#1E293B" strokeWidth={thinStroke}
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
          <circle cx={cx} cy={cy} r={rInner - 6} fill="#0A0E1A" opacity={0.6} />
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
          <span className="text-[10px] text-[#94A3B8] tracking-[0.2em] mt-1">PERCENTILE</span>
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

function fmtPsf(v: number): string {
  return "£" + v.toFixed(0) + "/ft²";
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
}: SEMVTabProps) {
  // Validation
  const hasLayer1 = layer1Comps.length >= 3;
  const hasAdopted = adoptedComparables.length > 0;
  const hasMV = adoptedMV != null && adoptedMV > 0;
  const hasSize = subjectSizeSqft != null && subjectSizeSqft > 0;

  const compsWithSize = useMemo(
    () => layer1Comps.filter((c) => c.floor_area_sqm != null && c.floor_area_sqm > 0),
    [layer1Comps]
  );

  const ready = hasLayer1 && hasAdopted && hasMV && hasSize && compsWithSize.length >= 3;

  // Run simulation
  const sim = useMemo(() => {
    if (!ready) return null;
    return runMonteCarlo(
      layer1Comps,
      subjectSizeSqft!,
      adoptedMV!,
      hpiTrend,
      valuationDate,
      subjectPropertyType,
      subjectHouseSubType,
      subjectEpcScore,
      subjectSaon
    );
  }, [layer1Comps, subjectSizeSqft, adoptedMV, hpiTrend, valuationDate, subjectPropertyType, subjectHouseSubType, subjectEpcScore, subjectSaon, ready]);

  // Build adopted set for quick lookup
  const adoptedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of adoptedComparables) {
      ids.add(c.transaction_id ?? c.address);
    }
    return ids;
  }, [adoptedComparables]);

  if (!ready) {
    const missing: string[] = [];
    if (!hasLayer1) missing.push("comparable search (minimum 3 results)");
    if (!hasAdopted) missing.push("adopted comparables");
    if (!hasMV) missing.push("Market Value in Report Typing");
    if (!hasSize) missing.push("subject property floor area");
    if (hasLayer1 && compsWithSize.length < 3) missing.push("at least 3 comparables with floor area data");

    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-[#94A3B8] text-sm max-w-md">
          <p className="text-[#00F0FF] font-semibold text-base mb-3" style={{ fontFamily: "Orbitron, Inter, sans-serif" }}>
            SEMV ANALYSIS
          </p>
          <p className="mb-4">
            Complete the following to run SEMV analysis:
          </p>
          <ul className="text-left space-y-1.5">
            {missing.map((m, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[#FF3131] mt-0.5">&#x2717;</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const { simMVs, mean, stdDev, p5, p95, percentile, sigma } = sim!;

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Delta Gauge */}
      <div className="flex flex-col items-center gap-4 py-6">
        <DeltaGauge percentile={percentile} sigma={sigma} />
        <p className="text-[#94A3B8] text-sm text-center">
          Adopted MV is <span className="text-[#E2E8F0] font-semibold">{sigma >= 0 ? "+" : ""}{sigma.toFixed(2)}&sigma;</span> from distribution mean
        </p>
        <p className="text-[#E2E8F0] text-sm text-center max-w-lg">
          The adopted MV of <span className="font-semibold text-[#FF2D78]">{fmtGBP(adoptedMV!)}</span> sits at the <span className="font-semibold" style={{ color: sigmaToColor(Math.abs(sigma)) }}>{percentile === 0 ? "<1" : percentile === 100 ? ">99" : percentile}th percentile</span> of the modelled distribution.
        </p>
      </div>

      {/* 2. Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Adopted MV", value: fmtGBP(adoptedMV!), accent: "#FF2D78" },
          { label: "Distribution Mean", value: fmtGBP(mean), accent: "#00F0FF" },
          { label: "Std Deviation (1σ)", value: fmtGBP(stdDev), accent: "#7B2FBE" },
          { label: "1σ Range (68%)", value: `${fmtGBP(mean - stdDev)} – ${fmtGBP(mean + stdDev)}`, accent: "#7B2FBE" },
          { label: "2σ Range (95%)", value: `${fmtGBP(mean - 2 * stdDev)} – ${fmtGBP(mean + 2 * stdDev)}`, accent: "#7B2FBE" },
          { label: "90% Interval (P5–P95)", value: `${fmtGBP(p5)} – ${fmtGBP(p95)}`, accent: "#00F0FF" },
        ].map((s, i) => (
          <div
            key={i}
            className="rounded-xl border border-[#334155] bg-[#111827] p-4 text-center"
          >
            <p className="text-[10px] tracking-[0.12em] text-[#94A3B8] uppercase mb-1">{s.label}</p>
            <p className="text-lg font-bold" style={{ color: s.accent }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* 3. PDF Chart */}
      <div className="rounded-xl border border-[#334155] bg-[#111827] p-4">
        <p className="text-[10px] tracking-[0.12em] text-[#94A3B8] uppercase mb-3">PROBABILITY DENSITY FUNCTION</p>
        <PdfChart simMVs={simMVs} mean={mean} adoptedMV={adoptedMV!} p5={p5} p95={p95} stdDev={stdDev} />
      </div>

      {/* 4. Layer 1 vs Layer 3 Table */}
      <div className="rounded-xl border border-[#334155] bg-[#111827] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#334155]">
          <p className="text-[10px] tracking-[0.12em] text-[#94A3B8] uppercase">
            COMPARABLE UNIVERSE — {layer1Comps.length} TRANSACTIONS ({sim!.compsUsed} passed ±25% size gate)
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ background: "linear-gradient(90deg, #00F0FF22, #FF2D7822)" }}>
                <th className="px-3 py-2 text-[#94A3B8] font-medium">#</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium">Address</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium text-right">Size ft²</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium text-right">Sale Price</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium text-right">Raw PSF</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium text-right">Adj PSF</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium text-center">Date</th>
                <th className="px-3 py-2 text-[#94A3B8] font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...layer1Comps]
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
                    // Midpoint adjustments: passthrough 0.5, betaEpc 0.0015, sizeAlpha 0.25, floorPremium 1%
                    let timeAdj = 0;
                    if (compHpi != null && subHpi != null && compHpi > 0) {
                      timeAdj = ((subHpi - compHpi) / compHpi) * 0.25;
                    }
                    let epcAdj = 0;
                    if (subjectEpcScore != null && c.epc_score != null && c.epc_score > 0) {
                      epcAdj = (subjectEpcScore - c.epc_score) * 0.0025;
                    }
                    let sizeAdj = 0.25 * (subjectSizeSqft - sqft) / sqft;
                    let floorAdj = 0;
                    const compFloor = inferFloorFromSaon(c.saon as string | null);
                    const subjFloor = inferFloorFromSaon(subjectSaon);
                    if (subjFloor != null && compFloor != null) {
                      floorAdj = (subjFloor - compFloor) * 0.01;
                    }
                    let adjPrice = c.price * (1 + timeAdj + epcAdj + sizeAdj + floorAdj);
                    // Monotonicity clamp
                    if (subjectSizeSqft < sqft) adjPrice = Math.min(adjPrice, c.price);
                    else if (subjectSizeSqft > sqft) adjPrice = Math.max(adjPrice, c.price);
                    adjPsf = adjPrice / subjectSizeSqft;
                  }
                  return (
                    <tr
                      key={c.transaction_id ?? `${c.address}-${i}`}
                      className={i % 2 === 0 ? "bg-[#111827]" : "bg-[#1E293B]"}
                      style={sizeExcluded ? { opacity: 0.4 } : undefined}
                    >
                      <td className="px-3 py-2 text-[#94A3B8]">{i + 1}</td>
                      <td className="px-3 py-2 text-[#E2E8F0] max-w-[240px] truncate">{c.address}</td>
                      <td className="px-3 py-2 text-right text-[#E2E8F0]">
                        {sqft != null ? sqft.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-[#E2E8F0]">{fmtGBP(c.price)}</td>
                      <td className="px-3 py-2 text-right text-[#E2E8F0]">
                        {psf != null ? fmtPsf(psf) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {adjPsf != null ? (
                          <span className={adjPsf > (psf ?? 0) ? "text-[#39FF14]" : adjPsf < (psf ?? 0) ? "text-[#FF9500]" : "text-[#E2E8F0]"}>
                            {fmtPsf(adjPsf)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center text-[#94A3B8]">
                        {c.transaction_date.slice(0, 7)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {sizeExcluded ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-[#334155]/50 text-[#64748B] border border-[#475569]/30 line-through">
                            SIZE EXCLUDED
                          </span>
                        ) : isAdopted ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/30">
                            ADOPTED
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-[#ff8a00]/15 text-[#ff8a00] border border-[#ff8a00]/30">
                            HMLR ONLY
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

      {/* 5. Methodology Footer */}
      <p className="text-[10px] text-[#475569] text-center leading-relaxed max-w-2xl mx-auto">
        SEMV V1.0 &middot; 100,000 Monte Carlo simulations &middot;
        Hard size gate &plusmn;25% &middot; Similarity-biased selection &amp; weighting &middot;
        Size &alpha; [0–0.5], floor premium [0.1–2%/floor], time passthrough [0–1], EPC &beta; [0–0.5%] &middot;
        Layer 1 = HMLR observable universe &middot; Layer 2 = unregistered (unobservable) &middot;
        Layer 3 = surveyor adopted &middot;
        Confidence assessment only — this is not a valuation
      </p>
    </div>
  );
}

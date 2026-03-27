/**
 * Comparable similarity scoring engine (frontend mirror).
 *
 * Mirrors backend/services/comp_scoring.py for real-time UI feedback
 * before the full MC simulation runs server-side.
 */

export interface ScoreBreakdown {
  distance: number | null;
  recency: number | null;
  size: number | null;
  bedrooms: number | null;
  age: number | null;
  epc: number | null;
  imd: number | null;
  tier: number | null;
  completeness: number | null;
  composite: number;
}

export interface ScoredComparable<T = any> {
  comparable: T;
  score: ScoreBreakdown;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  distance: 0.2,
  recency: 0.15,
  size: 0.2,
  bedrooms: 0.1,
  age: 0.05,
  epc: 0.1,
  imd: 0.1,
  tier: 0.05,
  completeness: 0.05,
};

const TIER_SCORES: Record<number, number> = { 1: 1.0, 2: 0.75, 3: 0.5, 4: 0.25 };

function val(obj: any, key: string): number | null | undefined {
  if (!obj) return null;
  return obj[key] ?? null;
}

function dimDistance(comp: any): number | null {
  const d = val(comp, "distance_m");
  if (d == null) return null;
  return Math.max(0, 1 - Math.min(d / 2000, 1));
}

function dimRecency(comp: any): number | null {
  const m = val(comp, "months_ago");
  if (m == null) return null;
  return Math.max(0, 1 - Math.min(m / 36, 1));
}

function dimSize(comp: any, subj: any): number | null {
  const c = val(comp, "floor_area_sqm");
  const s = val(subj, "floor_area_sqm");
  if (c == null || s == null || s <= 0) return null;
  return Math.max(0, 1 - Math.min(Math.abs(c - s) / s, 1));
}

function dimBedrooms(comp: any, subj: any): number | null {
  const c = val(comp, "bedrooms");
  const s = val(subj, "bedrooms");
  if (c == null || s == null) return null;
  return Math.max(0, 1 - Math.min(Math.abs(c - s) / 3, 1));
}

function dimAge(comp: any, subj: any): number | null {
  const c = val(comp, "build_year") ?? val(comp, "construction_age_best");
  const s = val(subj, "build_year") ?? val(subj, "construction_age_best");
  if (c == null || s == null) return null;
  return Math.max(0, 1 - Math.min(Math.abs(c - s) / 100, 1));
}

function dimEpc(comp: any, subj: any): number | null {
  const c = val(comp, "epc_score");
  const s = val(subj, "epc_score");
  if (c == null || s == null) return null;
  return Math.max(0, 1 - Math.min(Math.abs(c - s) / 50, 1));
}

function dimImd(comp: any, subj: any): number | null {
  const c = val(comp, "imd_decile");
  const s = val(subj, "imd_decile");
  if (c == null || s == null) return null;
  return Math.max(0, 1 - Math.min(Math.abs(c - s) / 5, 1));
}

function dimTier(comp: any): number | null {
  const t = val(comp, "geographic_tier");
  if (t == null) return null;
  return TIER_SCORES[t] ?? 0.25;
}

function dimCompleteness(comp: any): number {
  const fields = ["floor_area_sqm", "epc_score", "imd_decile", "bedrooms", "build_year"];
  let present = 0;
  for (const f of fields) {
    if (val(comp, f) != null) present++;
  }
  return present / fields.length;
}

type DimScorer = (comp: any, subj: any) => number | null;

const SCORERS: Record<string, DimScorer> = {
  distance: (c) => dimDistance(c),
  recency: (c) => dimRecency(c),
  size: dimSize,
  bedrooms: dimBedrooms,
  age: dimAge,
  epc: dimEpc,
  imd: dimImd,
  tier: (c) => dimTier(c),
  completeness: (c) => dimCompleteness(c),
};

export function scoreComparable(
  comp: any,
  subject: any,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): ScoreBreakdown {
  const breakdown: ScoreBreakdown = {
    distance: null,
    recency: null,
    size: null,
    bedrooms: null,
    age: null,
    epc: null,
    imd: null,
    tier: null,
    completeness: null,
    composite: 0,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [dim, scorer] of Object.entries(SCORERS)) {
    const raw = scorer(comp, subject);
    (breakdown as any)[dim] = raw;

    const w = weights[dim] ?? 0;
    if (raw == null) continue;
    totalWeight += w;
    weightedSum += raw * w;
  }

  breakdown.composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return breakdown;
}

export function scorePool<T = any>(
  comparables: T[],
  subject: any,
  weights?: Record<string, number>,
): ScoredComparable<T>[] {
  const scored = comparables.map((comp) => ({
    comparable: comp,
    score: scoreComparable(comp, subject, weights),
  }));
  scored.sort((a, b) => b.score.composite - a.score.composite);
  return scored;
}

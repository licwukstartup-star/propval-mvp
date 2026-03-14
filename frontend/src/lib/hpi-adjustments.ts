// HPI time-adjustment helpers extracted from page.tsx
import type { ComparableCandidate } from "@/components/ComparableSearch";
import type { HpiValueKey, HpiTrendSlice } from "@/types/property";

export function hpiKeyForComp(comp: ComparableCandidate): HpiValueKey {
  const pt = (comp.property_type ?? "").toLowerCase();
  const hs = (comp.house_sub_type ?? "").toLowerCase();
  if (pt === "flat") return "hpi_flat";
  if (hs === "semi-detached") return "hpi_semi";
  if (hs === "terraced" || hs === "end-terrace") return "hpi_terraced";
  if (hs === "detached") return "hpi_detached";
  return "hpi_all";
}

export function computeAdjFactor(
  comp: ComparableCandidate,
  trend: HpiTrendSlice[],
  correlation: number
): number {
  if (!trend.length || correlation === 0) return 1;
  const txMonth  = comp.transaction_date.slice(0, 7);
  const prefKey  = hpiKeyForComp(comp);
  const txPoint  = trend.find(t => t.month === txMonth);
  const nowPoint = trend[trend.length - 1];
  if (!txPoint || !nowPoint) return 1;

  // Use type-specific series only if available in BOTH points — avoids mixing series
  const useKey: HpiValueKey =
    prefKey !== "hpi_all" && txPoint[prefKey] != null && nowPoint[prefKey] != null
      ? prefKey : "hpi_all";

  const hpiTx  = txPoint[useKey];
  const hpiNow = nowPoint[useKey];
  if (hpiTx == null || hpiNow == null) return 1;

  return 1 + (hpiNow / hpiTx - 1) * (correlation / 100);
}

export function computeSizeAdj(
  compSqft: number,
  subjectSqft: number,
  timeAdjPsf: number,
  compPrice: number,
  beta: number
): { adjPsf: number; pctChange: number; capped: boolean } {
  if (beta === 0) return { adjPsf: timeAdjPsf, pctChange: 0, capped: false };
  const rawFactor = Math.pow(compSqft / subjectSqft, beta);
  const rawAdjPsf = timeAdjPsf * rawFactor;
  const limitPsf = compPrice / subjectSqft;
  const subjectIsSmaller = subjectSqft < compSqft;
  let adjPsf = rawAdjPsf;
  let capped = false;
  if (subjectIsSmaller && rawAdjPsf * subjectSqft >= compPrice) {
    adjPsf = limitPsf;
    capped = true;
  } else if (!subjectIsSmaller && rawAdjPsf * subjectSqft <= compPrice) {
    adjPsf = limitPsf;
    capped = true;
  }
  return { adjPsf, pctChange: ((adjPsf - timeAdjPsf) / timeAdjPsf) * 100, capped };
}

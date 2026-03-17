"use client";

import React from "react";
import { HpiBarChart } from "./HpiBarChart";
import { HpiIndexChart } from "./HpiIndexChart";
import type { PropertyResult } from "@/types/property";

interface HpiTabProps {
  result: PropertyResult;
}

export default function HpiTab({ result }: HpiTabProps) {
  if (!result.hpi) {
    return (
      <div className="text-center py-20 text-[var(--color-text-secondary)]/70 space-y-2">
        <p className="text-4xl">📊</p>
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">Loading HPI data...</p>
        <p className="text-xs text-[var(--color-text-secondary)]/60">Fetching House Price Index from Land Registry...</p>
      </div>
    );
  }

  const hpi = result.hpi;
  const latest = hpi.trend[hpi.trend.length - 1];

  // Determine type label — use both property_type and built_form
  // (EPC property-type is "House"/"Flat"; sub-type lives in built-form e.g. "Semi-Detached")
  const pt = (result.property_type ?? "").toLowerCase();
  const bf = (result.built_form ?? "").toLowerCase();
  const isFlat      = pt.includes("flat") || pt.includes("maisonette");
  const isSemi      = !isFlat && (pt.includes("semi")    || bf.includes("semi"));
  const isDetached  = !isFlat && !isSemi && (pt.includes("detach") || bf.includes("detach"));
  const isTerraced  = !isFlat && !isSemi && (pt.includes("terrace") || bf.includes("terrace"));
  const typeLabel   = isFlat ? "Flat / Maisonette" : isDetached ? "Detached" : isSemi ? "Semi-detached" : isTerraced ? "Terraced" : null;
  const typeAnnualChange = latest
    ? isFlat ? latest.annual_change_flat_pct
      : isSemi ? latest.annual_change_semi_pct
      : isDetached ? latest.annual_change_detached_pct
      : isTerraced ? latest.annual_change_terraced_pct
      : null
    : null;

  // Compute type-specific avg price from latest trend point directly (not from backend pre-computation)
  const typeAvgPrice = latest
    ? isFlat ? latest.avg_price_flat
      : isSemi ? latest.avg_price_semi
      : isDetached ? latest.avg_price_detached
      : isTerraced ? latest.avg_price_terraced
      : null
    : null;

  const INDEX_SERIES = [
    { key: "hpi_detached" as const, label: "Detached",          shortLabel: "Detached",  color: "var(--color-accent-purple)", isSubject: isDetached },
    { key: "hpi_semi"     as const, label: "Semi-detached",     shortLabel: "Semi-det.", color: "var(--color-status-warning)", isSubject: isSemi     },
    { key: "hpi_terraced" as const, label: "Terraced",          shortLabel: "Terraced",  color: "var(--color-status-success)", isSubject: isTerraced },
    { key: "hpi_flat"     as const, label: "Flat / Maisonette", shortLabel: "Flat/Mais", color: "var(--color-accent)", isSubject: isFlat     },
  ];

  const fmtChange = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const changeColor = (v: number | null) =>
    v == null ? "var(--color-text-secondary)" : v >= 0 ? "var(--color-status-success)" : "var(--color-status-danger)";

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron font-bold text-lg text-[var(--color-accent)] uppercase tracking-wider">
            House Price Index
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {hpi.local_authority} · Data as at {hpi.data_month} · Source: HMLR UK HPI
          </p>
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Avg price — type-specific, fall back to all if type unknown */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-5 py-4 text-center">
          <div className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
            Avg price{typeLabel ? ` (${typeLabel})` : " (all types)"}
          </div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
            {(typeAvgPrice ?? hpi.avg_price) != null
              ? `£${Math.round((typeAvgPrice ?? hpi.avg_price)!).toLocaleString("en-GB")}`
              : "—"}
          </div>
        </div>

        {/* Annual change (type-specific) */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-5 py-4 text-center">
          <div className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
            Annual change{typeLabel ? ` (${typeLabel})` : " (all)"}
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: changeColor(typeAnnualChange ?? hpi.annual_change_pct) }}>
            {fmtChange(typeAnnualChange ?? hpi.annual_change_pct)}
          </div>
        </div>

        {/* Annual change all types */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-5 py-4 text-center">
          <div className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">Annual change (all types)</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: changeColor(hpi.annual_change_pct) }}>
            {fmtChange(hpi.annual_change_pct)}
          </div>
        </div>

        {/* Monthly change + sales volume */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-5 py-4 text-center">
          <div className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">Monthly change</div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: changeColor(hpi.monthly_change_pct) }}>
            {fmtChange(hpi.monthly_change_pct)}
          </div>
          {hpi.sales_volume != null && (
            <div className="text-xs text-[var(--color-text-secondary)] mt-2">
              {hpi.sales_volume.toLocaleString("en-GB")} sales
            </div>
          )}
        </div>
      </div>

      {/* ── Trend bar chart (type-specific avg price) ───────────── */}
      {(() => {
        const typePriceKey = isFlat ? "avg_price_flat" : isDetached ? "avg_price_detached" : isSemi ? "avg_price_semi" : isTerraced ? "avg_price_terraced" : null;
        const getPrice = typePriceKey
          ? (t: typeof hpi.trend[0]) => t[typePriceKey as keyof typeof t] as number | null
          : (t: typeof hpi.trend[0]) => t.avg_price;
        const chartLabel = typeLabel ? `${typeLabel} average price` : "Average price (all types)";
        const typePts = hpi.trend.filter(t => getPrice(t) != null);
        if (typePts.length < 2) return null;
        const typePrices = typePts.map(t => getPrice(t)!);
        const tMin = Math.min(...typePrices);
        const tMax = Math.max(...typePrices);
        return (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-6">
            <h3 className="text-xs font-orbitron font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">
              {chartLabel} — {typePts[0]?.month} to {typePts[typePts.length - 1]?.month}
            </h3>
            <HpiBarChart pts={typePts} getPrice={getPrice} barColor="var(--color-accent)" maColor="var(--color-accent-pink)" />
            <div className="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-2 tabular-nums">
              <span>£{Math.round(tMin).toLocaleString("en-GB")}</span>
              <span>£{Math.round(tMax).toLocaleString("en-GB")}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Property type breakdown table ────────────────────────── */}
      {latest && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)]/60">
            <h3 className="text-xs font-orbitron font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
              By property type — {hpi.data_month}
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-pink) 100%)" }}>
                <th className="px-6 py-3 text-left text-xs font-bold text-[var(--color-bg-base)] uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-[var(--color-bg-base)] uppercase tracking-wider">Avg price</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-[var(--color-bg-base)] uppercase tracking-wider">Annual change</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Detached",          price: latest.avg_price_detached, change: latest.annual_change_detached_pct },
                { label: "Semi-detached",     price: latest.avg_price_semi,     change: latest.annual_change_semi_pct },
                { label: "Terraced",          price: latest.avg_price_terraced, change: latest.annual_change_terraced_pct },
                { label: "Flat / Maisonette", price: latest.avg_price_flat,     change: latest.annual_change_flat_pct },
              ].map((row, i) => {
                const highlight =
                  (row.label === "Flat / Maisonette" && isFlat) ||
                  (row.label === "Detached" && isDetached) ||
                  (row.label === "Semi-detached" && isSemi) ||
                  (row.label === "Terraced" && isTerraced);
                return (
                  <tr key={row.label}
                    className={i % 2 === 0 ? "bg-[var(--color-bg-panel)]" : "bg-[var(--color-bg-surface)]"}
                    style={highlight ? { boxShadow: "inset 3px 0 0 var(--color-accent)" } : undefined}
                  >
                    <td className="px-6 py-3 font-medium" style={{ color: highlight ? "var(--color-accent)" : "var(--color-text-primary)" }}>
                      {row.label}
                      {highlight && <span className="ml-2 text-[10px] text-[var(--color-accent)]/60 uppercase tracking-wide">subject</span>}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums text-[var(--color-text-primary)]">
                      {row.price != null ? `£${Math.round(row.price).toLocaleString("en-GB")}` : "—"}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums font-semibold" style={{ color: changeColor(row.change) }}>
                      {fmtChange(row.change)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── HPI index by type ────────────────────────────────────── */}
      {hpi.trend.length >= 3 && (() => {
        const firstMonth = hpi.trend[0]?.month;
        const lastMonth  = hpi.trend[hpi.trend.length - 1]?.month;
        return (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-6">
            <h3 className="text-xs font-orbitron font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">
              House Price Index by type — {firstMonth} to {lastMonth}
            </h3>
            <p className="text-[10px] text-[var(--color-text-muted)] mb-4">3-month moving average · rebased Jan 2023 = 100 · subject type highlighted · drag to explore</p>
            <HpiIndexChart trend={hpi.trend} series={INDEX_SERIES} />
          </div>
        );
      })()}

    </div>
  );
}

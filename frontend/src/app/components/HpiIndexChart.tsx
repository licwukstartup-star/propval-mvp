"use client";

import { useState } from "react";

type HpiKey = "hpi_detached" | "hpi_semi" | "hpi_terraced" | "hpi_flat";

interface SeriesDef {
  key: HpiKey;
  label: string;
  shortLabel: string;
  color: string;
  isSubject: boolean;
}

interface TrendPoint {
  month: string;
  hpi_detached: number | null;
  hpi_semi: number | null;
  hpi_terraced: number | null;
  hpi_flat: number | null;
}

interface HpiIndexChartProps {
  trend: TrendPoint[];
  series: SeriesDef[];
}

export function HpiIndexChart({ trend, series }: HpiIndexChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const n = trend.length;
  if (n < 3) return null;

  const allVals = series.flatMap(s =>
    trend.map(t => t[s.key]).filter((v): v is number => v != null)
  );
  if (allVals.length === 0) return null;

  const dataMin = Math.min(...allVals);
  const dataMax = Math.max(...allVals);
  const pad = (dataMax - dataMin) * 0.12 || 2;
  const gMin = Math.min(dataMin - pad, 97);
  const gMax = Math.max(dataMax + pad, 103);
  const gRange = gMax - gMin;

  const VW = 600, H_PLOT = 140, H_LABEL = 16, H_TOTAL = H_PLOT + H_LABEL;
  const bw = VW / n;
  const idxY = (v: number) => H_PLOT - ((v - gMin) / gRange) * (H_PLOT - 6);
  const ref100Y = idxY(100);

  // 3-month MA points per position
  type MaPoint = {
    x: number;
    month: string;
    values: Partial<Record<HpiKey, number>>;
    ys: Partial<Record<HpiKey, number>>;
  };

  const maPoints: MaPoint[] = [];
  for (let i = 2; i < n; i++) {
    const x = (i + 0.5) * bw;
    const values: Partial<Record<HpiKey, number>> = {};
    const ys: Partial<Record<HpiKey, number>> = {};
    for (const s of series) {
      const p0 = trend[i - 2][s.key];
      const p1 = trend[i - 1][s.key];
      const p2 = trend[i][s.key];
      if (p0 != null && p1 != null && p2 != null) {
        const ma = (p0 + p1 + p2) / 3;
        values[s.key] = ma;
        ys[s.key] = idxY(ma);
      }
    }
    maPoints.push({ x, month: trend[i].month, values, ys });
  }

  // Polyline per series
  const polylines: Partial<Record<HpiKey, string>> = {};
  for (const s of series) {
    const pts = maPoints
      .filter(mp => mp.ys[s.key] != null)
      .map(mp => `${mp.x.toFixed(1)},${mp.ys[s.key]!.toFixed(1)}`);
    if (pts.length >= 2) polylines[s.key] = pts.join(" ");
  }

  // Scrubber state
  const effIdx = activeIdx !== null
    ? Math.max(0, Math.min(activeIdx, maPoints.length - 1))
    : maPoints.length - 1;
  const ap = maPoints[effIdx];

  const getNearestIdx = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * VW;
    let best = 0, bestDist = Infinity;
    maPoints.forEach((mp, i) => {
      const dist = Math.abs(mp.x - svgX);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  };

  // Tooltip: fixed to top corner opposite the active point
  const TW = 138, TH = 76;
  const ttX = ap ? (ap.x < VW / 2 ? VW - TW - 4 : 4) : 0;
  const ttY = 4;

  return (
    <svg
      viewBox={`0 0 ${VW} ${H_TOTAL}`}
      width="100%"
      style={{ display: "block", cursor: "crosshair", touchAction: "none", userSelect: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setActiveIdx(getNearestIdx(e));
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0 && e.pointerType === "mouse") return;
        setActiveIdx(getNearestIdx(e));
      }}
    >
      {/* Reference line at 100 */}
      <line x1="0" y1={ref100Y.toFixed(1)} x2={VW} y2={ref100Y.toFixed(1)}
        stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="4,3" opacity="0.7" />
      <text x={VW - 3} y={ref100Y - 3} textAnchor="end" fontSize="7.5" fill="var(--color-text-secondary)">100</text>

      {/* X-axis year labels */}
      {trend.map((t, i) => t.month.slice(5) === "01" ? (
        <text key={t.month} x={(i + 0.5) * bw} y={H_TOTAL - 2}
          textAnchor="middle" fontSize="8" fill="var(--color-text-muted)" fontFamily="monospace">
          {t.month.slice(0, 4)}
        </text>
      ) : null)}

      {/* Series lines — non-subject first so subject renders on top */}
      {[...series].reverse().map(s => {
        const pts = polylines[s.key];
        if (!pts) return null;
        return (
          <polyline key={s.key} points={pts} fill="none"
            stroke={s.color}
            strokeWidth={s.isSubject ? "2.5" : "1.2"}
            strokeLinejoin="round" strokeLinecap="round"
            opacity={s.isSubject ? 1 : 0.45}
            style={s.isSubject ? { filter: `drop-shadow(0 0 4px ${s.color}99)` } : undefined}
          />
        );
      })}

      {/* Scrubber */}
      {ap && (
        <g>
          {/* Vertical dashed guide */}
          <line
            x1={ap.x.toFixed(1)} y1="0"
            x2={ap.x.toFixed(1)} y2={H_PLOT}
            stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="3,2" opacity="0.55"
          />
          {/* Dot on each series */}
          {[...series].reverse().map(s => {
            const y = ap.ys[s.key];
            if (y == null) return null;
            return (
              <circle key={s.key}
                cx={ap.x.toFixed(1)} cy={y.toFixed(1)}
                r={s.isSubject ? "5" : "3.5"}
                fill={s.color} stroke="var(--color-bg-base)" strokeWidth="1.5"
              />
            );
          })}
          {/* Tooltip */}
          <rect x={ttX} y={ttY} width={TW} height={TH} rx="4"
            fill="var(--color-bg-base)" stroke="var(--color-border)" strokeWidth="1" opacity="0.92" />
          {/* Month */}
          <text x={ttX + TW / 2} y={ttY + 11} textAnchor="middle"
            fontSize="7" fill="var(--color-text-secondary)" fontFamily="monospace">
            {ap.month}
          </text>
          {/* One row per series */}
          {series.map((s, i) => {
            const v = ap.values[s.key];
            return (
              <text key={s.key} x={ttX + 6} y={ttY + 22 + i * 13}
                textAnchor="start" fontSize="7" fill={s.color}>
                {s.shortLabel}:{" "}
                <tspan fontWeight="bold" fontSize="8.5">
                  {v != null ? v.toFixed(1) : "—"}
                  {s.isSubject ? " ◀" : ""}
                </tspan>
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}

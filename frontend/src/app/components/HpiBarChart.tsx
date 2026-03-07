"use client";

import { useState } from "react";

interface HpiBarChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pts: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPrice: (t: any) => number | null;
  barColor: string;
  maColor: string;
}

export function HpiBarChart({ pts, getPrice, barColor, maColor }: HpiBarChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const valid = pts.filter((t) => getPrice(t) != null);
  if (valid.length < 2) return null;

  const prices = valid.map((t) => getPrice(t) as number);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const pRange = pMax - pMin || 1;

  const VW = 600, H_PLOT = 120, H_LABEL = 16, H_TOTAL = H_PLOT + H_LABEL;
  const n = valid.length;
  const bw = VW / n;
  const barH = (p: number) => Math.max(4, ((p - pMin) / pRange) * (H_PLOT - 10) + 4);

  // Monthly avg polyline (connects bar tops)
  const monthlyPolyline = valid
    .map((_: unknown, i: number) => `${((i + 0.5) * bw).toFixed(1)},${(H_PLOT - barH(prices[i])).toFixed(1)}`)
    .join(" ");

  // 3-month MA data
  const maData: { x: number; y: number; ma: number; month: string }[] = [];
  for (let i = 2; i < n; i++) {
    const ma = (prices[i - 2] + prices[i - 1] + prices[i]) / 3;
    maData.push({
      x: (i + 0.5) * bw,
      y: H_PLOT - barH(ma),
      ma,
      month: valid[i].month as string,
    });
  }
  const maPolyline = maData.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" ");

  // Scrubber: default to last MA point
  const eff = activeIdx !== null
    ? Math.max(0, Math.min(activeIdx, maData.length - 1))
    : maData.length - 1;
  const ap = maData[eff] ?? null;

  // Monthly avg dot: maData[eff] corresponds to valid[eff + 2]
  const monthlyDotIdx = eff + 2;
  const monthlyDotPrice = monthlyDotIdx < n ? prices[monthlyDotIdx] : null;
  const monthlyDotY = monthlyDotPrice != null ? H_PLOT - barH(monthlyDotPrice) : null;

  const getNearestIdx = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * VW;
    // Adjust for H_TOP offset
    let best = 0, bestDist = Infinity;
    maData.forEach((d, i) => {
      const dist = Math.abs(d.x - svgX);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  };

  // Tooltip box — fixed to opposite top corner so it never overlaps the active point
  const TW = 120, TH = 38;
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
      <g>
        {/* Bars */}
        {valid.map((t: { month: string }, i: number) => {
          const h = barH(prices[i]);
          const isLast = i === n - 1;
          return (
            <g key={t.month}>
              <rect
                x={i * bw + 0.5} y={H_PLOT - h}
                width={Math.max(1, bw - 1)} height={h}
                fill={isLast ? barColor : "#1E293B"}
                opacity={isLast ? 1 : 0.9}
              />
              {t.month.slice(5) === "01" && (
                <text x={(i + 0.5) * bw} y={H_PLOT + H_LABEL - 2} textAnchor="middle"
                  fontSize="8" fill="#475569" fontFamily="monospace">
                  {t.month.slice(0, 4)}
                </text>
              )}
            </g>
          );
        })}

        {/* Monthly avg curve */}
        <polyline points={monthlyPolyline} fill="none"
          stroke={barColor} strokeWidth="1"
          strokeLinejoin="round" strokeLinecap="round" opacity="0.45" />

        {/* 3-month MA curve */}
        {maData.length > 1 && (
          <polyline points={maPolyline} fill="none"
            stroke={maColor} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        )}

        {/* Scrubber: vertical guide + dots + tooltip */}
        {ap && (
          <g>
            {/* Vertical dashed guide */}
            <line
              x1={ap.x.toFixed(1)} y1="0"
              x2={ap.x.toFixed(1)} y2={H_PLOT}
              stroke="#475569" strokeWidth="1" strokeDasharray="3,2" opacity="0.55"
            />
            {/* Dot on monthly avg */}
            {monthlyDotY != null && (
              <circle
                cx={ap.x.toFixed(1)} cy={monthlyDotY.toFixed(1)} r="4"
                fill={barColor} stroke="#0A0E1A" strokeWidth="2"
              />
            )}
            {/* Dot on MA */}
            <circle
              cx={ap.x.toFixed(1)} cy={ap.y.toFixed(1)} r="5"
              fill={maColor} stroke="#0A0E1A" strokeWidth="2"
            />
            {/* Tooltip background */}
            <rect x={ttX} y={ttY} width={TW} height={TH} rx="4"
              fill="#0A0E1A" stroke="#334155" strokeWidth="1" opacity="0.92" />
            {/* Month label */}
            <text x={ttX + TW / 2} y={ttY + 10} textAnchor="middle"
              fontSize="7" fill="#94A3B8" fontFamily="monospace">
              {ap.month}
            </text>
            {/* Monthly avg price */}
            <text x={ttX + 6} y={ttY + 22} textAnchor="start"
              fontSize="7" fill={barColor}>
              {"Monthly: "}
              <tspan fontWeight="bold" fontSize="8.5">
                {monthlyDotPrice != null ? `\u00A3${Math.round(monthlyDotPrice).toLocaleString("en-GB")}` : "—"}
              </tspan>
            </text>
            {/* 3-month MA price */}
            <text x={ttX + 6} y={ttY + 33} textAnchor="start"
              fontSize="7" fill={maColor}>
              {"3m MA: "}
              <tspan fontWeight="bold" fontSize="8.5">
                {`\u00A3${Math.round(ap.ma).toLocaleString("en-GB")}`}
              </tspan>
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}

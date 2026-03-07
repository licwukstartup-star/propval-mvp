"use client";

import { useState } from "react";

// Official EPC band colours and score ranges
const BANDS: { band: string; min: number; color: string; range: string; darkText: boolean }[] = [
  { band: "A", min: 92, color: "#008054", range: "92–100", darkText: false },
  { band: "B", min: 81, color: "#19b459", range: "81–91",  darkText: false },
  { band: "C", min: 69, color: "#8dce46", range: "69–80",  darkText: true  },
  { band: "D", min: 55, color: "#ffd500", range: "55–68",  darkText: true  },
  { band: "E", min: 39, color: "#fcaa65", range: "39–54",  darkText: true  },
  { band: "F", min: 21, color: "#ef8023", range: "21–38",  darkText: false },
  { band: "G", min: 1,  color: "#e9153b", range: "1–20",   darkText: false },
];

function getBandConfig(score: number) {
  return BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
}

interface EpcBadgeProps {
  score: number;
  certificateUrl: string | null;
  onDownloadPdf?: () => void;
}

export function EpcBadge({ score, certificateUrl, onDownloadPdf }: EpcBadgeProps) {
  const [hovered, setHovered] = useState(false);
  const { band, color, range, darkText } = getBandConfig(score);
  const letterColor = darkText ? "#1a1a1a" : "#ffffff";

  const pill = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        padding: "4px 14px 4px 4px",
        borderRadius: "999px",
        border: `1.5px solid ${color}`,
        backgroundColor: hovered ? `${color}1a` : "transparent",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hovered ? `0 4px 14px ${color}4d` : "none",
        transition: "all 0.2s ease",
        cursor: certificateUrl ? "pointer" : "default",
        textDecoration: "none",
      }}
    >
      {/* Coloured band letter — circle */}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          backgroundColor: color,
          color: letterColor,
          fontWeight: 700,
          fontSize: "17px",
          flexShrink: 0,
          boxShadow: `0 2px 6px ${color}66`,
        }}
      >
        {band}
      </span>

      {/* Label */}
      <div style={{ lineHeight: 1 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: hovered && certificateUrl ? color : "#E2E8F0",
            transition: "color 0.2s ease",
            marginBottom: "3px",
          }}
        >
          {certificateUrl ? "View EPC ↗" : `Band ${band}`}
        </div>
        <div style={{ fontSize: "11px", color: "#94A3B8" }}>
          {certificateUrl ? "Official certificate" : range}
        </div>
      </div>
    </div>
  );

  return (
    <div className="px-4 py-3 bg-[#111827]">
      <dt className="text-xs text-[#94A3B8]/70 mb-2">Energy score</dt>

      <dd className="flex items-center gap-3">
        {/* Numeric score */}
        <span className="text-2xl font-bold text-[#E2E8F0] tabular-nums">{score}</span>

        {/* Badge — wrapped in <a> if we have a URL */}
        {certificateUrl ? (
          <a
            href={certificateUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="View official EPC certificate"
            style={{ textDecoration: "none" }}
          >
            {pill}
          </a>
        ) : (
          pill
        )}
      </dd>

      {/* Download PDF */}
      {onDownloadPdf && (
        <div className="mt-3 pt-3 border-t border-[#334155]/60">
          <button
            onClick={onDownloadPdf}
            className="flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#00F0FF] transition-colors"
          >
            <span>📄</span>
            <span>Download PDF</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Compact variant ───────────────────────────────────────────────────────────

interface EpcBadgeCompactProps {
  score: number;
  certificateUrl: string | null;
}

export function EpcBadgeCompact({ score, certificateUrl }: EpcBadgeCompactProps) {
  const [hovered, setHovered] = useState(false);
  const { band, color, darkText } = getBandConfig(score);
  const letterColor = darkText ? "#1a1a1a" : "#ffffff";

  const inner = (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 8px 3px 3px",
        borderRadius: "999px",
        border: `1.5px solid ${color}`,
        backgroundColor: hovered ? `${color}1a` : "transparent",
        transition: "all 0.2s ease",
        cursor: certificateUrl ? "pointer" : "default",
        textDecoration: "none",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "22px",
          height: "22px",
          borderRadius: "4px",
          backgroundColor: color,
          color: letterColor,
          fontWeight: 700,
          fontSize: "12px",
          flexShrink: 0,
        }}
      >
        {band}
      </span>
      <span
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: hovered && certificateUrl ? color : "#94A3B8",
          transition: "color 0.2s ease",
          whiteSpace: "nowrap",
        }}
      >
        {hovered && certificateUrl ? "View certificate" : "↗"}
      </span>
    </span>
  );

  if (certificateUrl) {
    return (
      <a href={certificateUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
        {inner}
      </a>
    );
  }
  return inner;
}

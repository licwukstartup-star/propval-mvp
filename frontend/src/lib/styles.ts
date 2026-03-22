// Style lookup tables extracted from page.tsx
import type React from "react";
import type { CardSizeKey } from "@/types/property";

export function planningDecisionStyle(decision: string | null): { bg: string; text: string } {
  if (!decision) return { bg: "bg-[#FFB800]/10", text: "text-[#FFB800]" };
  const d = decision.toLowerCase();
  if (d.includes("approv") || d.includes("grant")) return { bg: "bg-[#39FF14]/10", text: "text-[#39FF14]" };
  if (d.includes("refus")) return { bg: "bg-[#FF3131]/10", text: "text-[#FF3131]" };
  if (d.includes("withdraw")) return { bg: "bg-[#94A3B8]/10", text: "text-[#94A3B8]" };
  return { bg: "bg-[#FFB800]/10", text: "text-[#FFB800]" };
}

export const FLOOD_STYLE: Record<string, string> = {
  "Very Low": "bg-[#39FF14]/10 text-[#39FF14]",
  "Low":      "bg-[#39FF14]/10 text-[#39FF14]",
  "Medium":   "bg-[#FFB800]/10 text-[#FFB800]",
  "High":     "bg-[#FF3131]/10 text-[#FF3131]",
};

export const GRADE_STYLE: Record<string, string> = {
  "I":   "bg-[#FF3131]/15 text-[#FF3131]",
  "II*": "bg-[#FFB800]/15 text-[#FFB800]",
  "II":  "bg-[#00F0FF]/15 text-[#00F0FF]",
};

export const ADOPTED_TIER_STYLE: Record<number, { pill: string; header: string; icon: string }> = {
  0: { pill: "bg-[#FF2D78]/15 text-[#FF2D78]",  header: "bg-[#FF2D78]/5  border-[#FF2D78]/30", icon: "✏️" },
  1: { pill: "bg-[#39FF14]/15 text-[#39FF14]",  header: "bg-[#39FF14]/5  border-[#39FF14]/30", icon: "🏢" },
  2: { pill: "bg-[#00F0FF]/15 text-[#00F0FF]",   header: "bg-[#00F0FF]/5  border-[#00F0FF]/30",  icon: "🏘️" },
  3: { pill: "bg-[#FFB800]/15 text-[#FFB800]",  header: "bg-[#FFB800]/5  border-[#FFB800]/30", icon: "📍" },
  4: { pill: "bg-[#94A3B8]/15 text-[#94A3B8]",  header: "bg-[#94A3B8]/10 border-[#334155]",   icon: "🗺️" },
};

// Report inline style constants — iOS design language
export const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
export const iosBlue   = "#007AFF";
export const iosPurple = "#5856D6";
export const rptSection: React.CSSProperties = { marginBottom: "32px" };
export const rptH2: React.CSSProperties = {
  fontSize: "13px", fontWeight: 600, color: iosBlue,
  borderLeft: "3px solid " + iosBlue, paddingLeft: "10px",
  marginBottom: "14px", marginTop: 0,
  fontFamily: appleFont, letterSpacing: "-0.01em",
};
export const rptTable: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: appleFont };
export const rptTh: React.CSSProperties = {
  backgroundColor: "#F2F2F7", fontWeight: 600, padding: "8px 12px",
  textAlign: "left", border: "1px solid #C6C6C8", fontSize: "11px",
  color: "#8E8E93", letterSpacing: "0.04em", textTransform: "uppercase",
  fontFamily: appleFont,
};
export const rptTdL: React.CSSProperties = {
  padding: "8px 12px", border: "1px solid #E5E5EA",
  fontWeight: 500, color: "#8E8E93", width: "38%", verticalAlign: "top",
  backgroundColor: "#FFFFFF", fontSize: "12px",
  fontFamily: appleFont,
};
export const rptTdV: React.CSSProperties = {
  padding: "8px 12px", border: "1px solid #E5E5EA", color: "#000000", verticalAlign: "top",
  fontFamily: appleFont,
};
export const rptTdS: React.CSSProperties = {
  ...rptTdV, color: "#8E8E93", fontSize: "11px", width: "22%",
};
export const rptStripe = (i: number): React.CSSProperties =>
  ({ backgroundColor: i % 2 === 0 ? "#F9F9FB" : "#FFFFFF" });

// Card size constants
export const CARD_SIZES_KEY = "propval-card-sizes-v1";

export const SIZE_PRESETS: { key: CardSizeKey; label: string; cols: number; rows: number }[] = [
  { key: "1x1", label: "Small", cols: 1, rows: 1 },
  { key: "2x1", label: "Wide",  cols: 2, rows: 1 },
  { key: "3x1", label: "Full",  cols: 3, rows: 1 },
  { key: "1x2", label: "Tall",  cols: 1, rows: 2 },
  { key: "2x2", label: "Large", cols: 2, rows: 2 },
];

export const PROP_CARD_DEFAULTS: Record<string, CardSizeKey> = {
  epc:          "2x2",
  tenure:       "1x1",
  coordinates:  "1x1",
  sales:        "3x1",
  flood:        "1x1",
  conservation: "1x1",
  coal:         "1x1",
  ground:       "2x1",
  asbestos:     "1x1",
  connectivity: "2x1",
  imd:          "1x1",
  planning:     "3x1",
};

"use client"

import type { ReportTypingState } from "../types"
import CoverContent from "../sections/CoverContent"
import SummaryContent from "../sections/SummaryContent"
import InstructionsScopeContent from "../sections/InstructionsScopeContent"
import PropertyContent from "../sections/PropertyContent"
import TenureMarketContent from "../sections/TenureMarketContent"
import ValuationContent from "../sections/ValuationContent"
import AppendicesContent from "../sections/AppendicesContent"

/* ── Document section heading ─────────────────────────────────────────── */
function DocHeading({ title }: { title: string }) {
  return (
    <div className="mb-4 mt-8 first:mt-0">
      <h2 className="text-sm font-bold uppercase tracking-[2px] pb-2"
        style={{ color: "#007AFF", borderBottom: "2px solid #007AFF", fontFamily: "Calibri, 'Segoe UI', sans-serif" }}>
        {title}
      </h2>
    </div>
  )
}

/* ── Page break indicator ─────────────────────────────────────────────── */
function PageBreak() {
  return (
    <div className="my-6 flex items-center gap-3">
      <div className="flex-1 h-px" style={{ background: "repeating-linear-gradient(90deg, var(--color-border) 0, var(--color-border) 4px, transparent 4px, transparent 8px)" }} />
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>page break</span>
      <div className="flex-1 h-px" style={{ background: "repeating-linear-gradient(90deg, var(--color-border) 0, var(--color-border) 4px, transparent 4px, transparent 8px)" }} />
    </div>
  )
}

export default function DocumentView({ state }: { state: ReportTypingState }) {
  return (
    <div className="flex justify-center">
      {/* A4-ish paper simulation */}
      <div
        className="w-full max-w-[210mm] rounded-lg shadow-2xl overflow-hidden"
        style={{
          backgroundColor: "#FFFFFF",
          color: "#1C1C1E",
          minHeight: "297mm",
          padding: "40px 48px",
          fontFamily: "Calibri, 'Segoe UI', sans-serif",
          boxShadow: "0 0 40px rgba(0, 240, 255, 0.05), 0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Cover Page */}
        <DocHeading title="Cover Page" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_input]:!bg-[#F2F2F7] [&_input]:!border-[#E5E5EA] [&_input]:!text-[#1C1C1E] [&_span]:!text-[#636366]">
          <CoverContent state={state} />
        </div>

        <PageBreak />

        {/* Summary Information */}
        <DocHeading title="Summary Information" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_input]:!bg-[#F2F2F7] [&_input]:!border-[#E5E5EA] [&_input]:!text-[#1C1C1E] [&_span]:!text-[#636366]">
          <SummaryContent state={state} />
        </div>

        <PageBreak />

        {/* Section 1 */}
        <DocHeading title="Section 1: Instructions, Scope & Investigations" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_input]:!bg-[#F2F2F7] [&_input]:!border-[#E5E5EA] [&_input]:!text-[#1C1C1E] [&_textarea]:!bg-[#F2F2F7] [&_textarea]:!border-[#E5E5EA] [&_textarea]:!text-[#1C1C1E] [&_span]:!text-[#636366] [&_button]:!text-[#007AFF] [&_button]:!border-[#007AFF33]">
          <InstructionsScopeContent state={state} />
        </div>

        <PageBreak />

        {/* Section 2 */}
        <DocHeading title="Section 2: The Property" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_input]:!bg-[#F2F2F7] [&_input]:!border-[#E5E5EA] [&_input]:!text-[#1C1C1E] [&_textarea]:!bg-[#F2F2F7] [&_textarea]:!border-[#E5E5EA] [&_textarea]:!text-[#1C1C1E] [&_span]:!text-[#636366] [&_button]:!text-[#007AFF] [&_button]:!border-[#007AFF33]">
          <PropertyContent state={state} />
        </div>

        <PageBreak />

        {/* Section 3 */}
        <DocHeading title="Section 3: Tenure & Market Commentary" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_input]:!bg-[#F2F2F7] [&_input]:!border-[#E5E5EA] [&_input]:!text-[#1C1C1E] [&_span]:!text-[#636366] [&_button]:!text-[#007AFF] [&_button]:!border-[#007AFF33]">
          <TenureMarketContent state={state} />
        </div>

        <PageBreak />

        {/* Section 4 */}
        <DocHeading title="Section 4: Valuation" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_input]:!bg-[#F2F2F7] [&_input]:!border-[#E5E5EA] [&_input]:!text-[#1C1C1E] [&_span]:!text-[#636366] [&_button]:!text-[#007AFF] [&_button]:!border-[#007AFF33]">
          <ValuationContent state={state} />
        </div>

        <PageBreak />

        {/* Appendices */}
        <DocHeading title="Appendices" />
        <div className="space-y-3 [&_*]:!text-[#1C1C1E] [&_.text-xs]:!text-[#636366] [&_span]:!text-[#636366]">
          <AppendicesContent />
        </div>
      </div>
    </div>
  )
}

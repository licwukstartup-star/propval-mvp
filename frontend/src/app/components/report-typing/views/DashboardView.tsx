"use client"

import { useState } from "react"
import type { ReportTypingState, SectionCompletionInfo } from "../types"
import { SECTION_DEFS } from "../constants"
import CatBadge from "../shared/CatBadge"
import Placeholder from "../shared/Placeholder"
import CoverContent from "../sections/CoverContent"
import SummaryContent from "../sections/SummaryContent"
import InstructionsScopeContent from "../sections/InstructionsScopeContent"
import PropertyContent from "../sections/PropertyContent"
import TenureMarketContent from "../sections/TenureMarketContent"
import ValuationContent from "../sections/ValuationContent"
import AppendicesContent from "../sections/AppendicesContent"

/* ── Completion ring ──────────────────────────────────────────────────── */
function CompletionRing({ percentage, size = 36 }: { percentage: number; size?: number }) {
  const r = (size - 6) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percentage / 100) * circumference
  const color = percentage === 100 ? "var(--color-status-success)" : percentage > 50 ? "var(--color-status-warning)" : "var(--color-accent-pink)"
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-bg-surface)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} className="transition-all duration-500" />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="text-[8px] font-mono" fill={color}>
        {percentage}%
      </text>
    </svg>
  )
}

/* ── Section card ─────────────────────────────────────────────────────── */
function SectionCard({ def, completion, isSelected, onClick }: {
  def: typeof SECTION_DEFS[number]; completion: SectionCompletionInfo; isSelected: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg p-3 transition-all duration-200"
      style={{
        backgroundColor: isSelected ? "var(--color-bg-base)" : "var(--color-bg-panel)",
        border: isSelected ? "1px solid var(--color-accent)" : "1px solid var(--color-bg-surface)",
        boxShadow: isSelected ? "0 0 12px color-mix(in srgb, var(--color-accent) 20%, transparent)" : "none",
      }}
    >
      <div className="flex items-start gap-2.5">
        <CompletionRing percentage={completion.percentage} />
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold uppercase tracking-wider truncate" style={{ color: isSelected ? "var(--color-accent)" : "var(--color-text-primary)" }}>
            {def.title}
          </h4>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {def.cats.map(c => <CatBadge key={c} cat={c} />)}
          </div>
          {completion.total > 0 && (
            <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>
              {completion.filled}/{completion.total} fields
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

/* ── Detail panel content ─────────────────────────────────────────────── */
function DetailContent({ sectionId, state }: { sectionId: string; state: ReportTypingState }) {
  switch (sectionId) {
    case "cover": return <CoverContent state={state} />
    case "toc": return <Placeholder text="Auto-generated at final report export. Based on active sections and appendices." />
    case "summary": return <SummaryContent state={state} />
    case "s1": return <InstructionsScopeContent state={state} />
    case "s2": return <PropertyContent state={state} />
    case "s3": return <TenureMarketContent state={state} />
    case "s4": return <ValuationContent state={state} />
    case "appendices": return <AppendicesContent />
    default: return null
  }
}

export default function DashboardView({ state }: { state: ReportTypingState }) {
  const [selectedId, setSelectedId] = useState("s2")
  const { sectionCompletion, overallCompletion } = state

  return (
    <div className="flex gap-4" style={{ minHeight: "600px" }}>
      {/* Left panel — cards */}
      <div className="w-[38%] shrink-0 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 250px)" }}>
        {/* Overall progress */}
        <div className="rounded-lg p-3 mb-3" style={{ backgroundColor: "var(--color-bg-panel)", border: "1px solid var(--color-bg-surface)" }}>
          <div className="flex items-center gap-3">
            <CompletionRing percentage={overallCompletion} size={44} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-primary)" }}>Overall Progress</p>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                {SECTION_DEFS.filter(d => sectionCompletion[d.id]?.isComplete).length}/{SECTION_DEFS.filter(d => d.fields.length > 0).length} sections complete
              </p>
            </div>
          </div>
        </div>

        {SECTION_DEFS.map(def => (
          <SectionCard
            key={def.id}
            def={def}
            completion={sectionCompletion[def.id] ?? { total: 0, filled: 0, percentage: 100, isComplete: true }}
            isSelected={selectedId === def.id}
            onClick={() => setSelectedId(def.id)}
          />
        ))}
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 rounded-lg overflow-y-auto p-5" style={{
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-bg-surface)",
        maxHeight: "calc(100vh - 250px)",
      }}>
        <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--color-accent)" }}>
          {SECTION_DEFS.find(d => d.id === selectedId)?.title}
        </h3>
        <div className="space-y-4">
          <DetailContent sectionId={selectedId} state={state} />
        </div>
      </div>
    </div>
  )
}

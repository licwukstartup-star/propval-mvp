"use client"

import type { ReportTypingState } from "../types"
import { CAT_COLORS, SECTION_DEFS } from "../constants"
import Section from "../shared/Section"
import CatBadge from "../shared/CatBadge"
import Placeholder from "../shared/Placeholder"
import CoverContent from "../sections/CoverContent"
import SummaryContent from "../sections/SummaryContent"
import InstructionsScopeContent from "../sections/InstructionsScopeContent"
import PropertyContent from "../sections/PropertyContent"
import TenureMarketContent from "../sections/TenureMarketContent"
import ValuationContent from "../sections/ValuationContent"
import AppendicesContent from "../sections/AppendicesContent"

/* ── Progress bar ─────────────────────────────────────────────────────── */
function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden mb-1" style={{ backgroundColor: "var(--color-bg-surface)" }}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${percentage}%`,
          background: "linear-gradient(90deg, var(--color-accent), var(--color-accent-pink))",
        }}
      />
    </div>
  )
}

/* ── Category legend ──────────────────────────────────────────────────── */
function CategoryLegend() {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Object.entries(CAT_COLORS).map(([k]) => <CatBadge key={k} cat={k} />)}
    </div>
  )
}

export default function ClassicView({ state }: { state: ReportTypingState }) {
  const { sectionCompletion, overallCompletion } = state

  return (
    <div className="space-y-2">
      {/* Progress bar + legend */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-3">
          <ProgressBar percentage={overallCompletion} />
          <span className="text-xs font-mono shrink-0" style={{ color: "var(--color-accent)" }}>{overallCompletion}%</span>
        </div>
        <CategoryLegend />
      </div>

      {/* ── Cover Page ──────────────────────────────────────────────────── */}
      <Section id="cover" title="Cover Page" cats={["A", "B", "F"]} completion={sectionCompletion.cover}>
        <CoverContent state={state} />
      </Section>

      {/* ── Table of Contents ───────────────────────────────────────────── */}
      <Section id="toc" title="Table of Contents" cats={["F"]} completion={sectionCompletion.toc}>
        <Placeholder text="Auto-generated at final report export. Based on active sections and appendices." />
      </Section>

      {/* ── Summary Information ─────────────────────────────────────────── */}
      <Section id="summary" title="Summary Information" cats={["B", "C"]} completion={sectionCompletion.summary}>
        <SummaryContent state={state} />
      </Section>

      {/* ── Section 1 ───────────────────────────────────────────────────── */}
      <Section id="s1" title="Section 1: Instructions, Scope & Investigations" cats={["A", "B", "E"]} completion={sectionCompletion.s1}>
        <InstructionsScopeContent state={state} />
      </Section>

      {/* ── Section 2 ───────────────────────────────────────────────────── */}
      <Section id="s2" title="Section 2: The Property" cats={["C", "D", "E"]} defaultOpen completion={sectionCompletion.s2}>
        <PropertyContent state={state} />
      </Section>

      {/* ── Section 3 ───────────────────────────────────────────────────── */}
      <Section id="s3" title="Section 3: Tenure & Market Commentary" cats={["A", "C", "D", "E"]} completion={sectionCompletion.s3}>
        <TenureMarketContent state={state} />
      </Section>

      {/* ── Section 4 ───────────────────────────────────────────────────── */}
      <Section id="s4" title="Section 4: Valuation" cats={["A", "E"]} completion={sectionCompletion.s4}>
        <ValuationContent state={state} />
      </Section>

      {/* ── Appendices ──────────────────────────────────────────────────── */}
      <Section id="appendices" title="Appendices" cats={["F"]} completion={sectionCompletion.appendices}>
        <AppendicesContent />
      </Section>
    </div>
  )
}

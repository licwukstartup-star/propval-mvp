"use client"

import { useState } from "react"
import type { ReportTypingState } from "../types"
import { WIZARD_STEPS } from "../constants"
import Placeholder from "../shared/Placeholder"
import CoverContent from "../sections/CoverContent"
import SummaryContent from "../sections/SummaryContent"
import InstructionsScopeContent from "../sections/InstructionsScopeContent"
import PropertyContent from "../sections/PropertyContent"
import TenureMarketContent from "../sections/TenureMarketContent"
import ValuationContent from "../sections/ValuationContent"
import AppendicesContent from "../sections/AppendicesContent"

/* ── Step indicator ───────────────────────────────────────────────────── */
function StepIndicator({ steps, current, completions, onStepClick }: {
  steps: typeof WIZARD_STEPS; current: number; completions: number[]; onStepClick: (i: number) => void
}) {
  return (
    <div className="flex items-center gap-0 mb-6 overflow-x-auto pb-2">
      {steps.map((step, i) => {
        const isActive = i === current
        const isDone = completions[i] === 100
        const isPast = i < current
        return (
          <div key={i} className="flex items-center">
            <button onClick={() => onStepClick(i)} className="flex flex-col items-center gap-1 min-w-[80px] group">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                style={{
                  background: isActive ? "var(--color-accent)" : isDone ? "var(--color-status-success)" : "var(--color-bg-surface)",
                  color: isActive || isDone ? "var(--color-bg-base)" : "var(--color-text-secondary)",
                  boxShadow: isActive ? "0 0 12px color-mix(in srgb, var(--color-accent) 40%, transparent)" : "none",
                  border: `2px solid ${isActive ? "var(--color-accent)" : isDone ? "var(--color-status-success)" : "var(--color-border)"}`,
                }}
              >
                {isDone ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className="text-[10px] uppercase tracking-wider text-center leading-tight"
                style={{ color: isActive ? "var(--color-accent)" : isPast || isDone ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>
                {step.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div className="w-6 h-0.5 -mt-4 mx-0.5" style={{
                background: i < current ? "var(--color-status-success)" : "var(--color-border)",
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Step content renderer ────────────────────────────────────────────── */
function StepContent({ step, state }: { step: number; state: ReportTypingState }) {
  switch (step) {
    case 0: return (
      <div className="space-y-4">
        <CoverContent state={state} />
        <Placeholder text="Table of Contents — auto-generated at final report export." />
      </div>
    )
    case 1: return <div className="space-y-4"><SummaryContent state={state} /></div>
    case 2: return <div className="space-y-4"><InstructionsScopeContent state={state} /></div>
    case 3: return <div className="space-y-4"><PropertyContent state={state} /></div>
    case 4: return <div className="space-y-4"><TenureMarketContent state={state} /></div>
    case 5: return <div className="space-y-4"><ValuationContent state={state} /></div>
    case 6: return <div className="space-y-4"><AppendicesContent /></div>
    default: return null
  }
}

export default function WizardView({ state }: { state: ReportTypingState }) {
  const [current, setCurrent] = useState(0)
  const { sectionCompletion } = state

  // Calculate per-step completion by averaging section completions
  const stepCompletions = WIZARD_STEPS.map(step => {
    const sects = step.sectionIds.map(id => sectionCompletion[id])
    const totals = sects.reduce((acc, s) => ({ t: acc.t + s.total, f: acc.f + s.filled }), { t: 0, f: 0 })
    return totals.t > 0 ? Math.round((totals.f / totals.t) * 100) : 100
  })

  return (
    <div>
      <StepIndicator steps={WIZARD_STEPS} current={current} completions={stepCompletions} onStepClick={setCurrent} />

      {/* Step header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-primary)" }}>
          {WIZARD_STEPS[current].label}
        </h3>
        <span className="text-xs font-mono" style={{ color: stepCompletions[current] === 100 ? "var(--color-status-success)" : "var(--color-accent)" }}>
          {stepCompletions[current]}% complete
        </span>
      </div>

      {/* Content area */}
      <div className="rounded-lg p-5" style={{ backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-bg-surface)" }}>
        <StepContent step={current} state={state} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-5">
        <button
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full border transition-all disabled:opacity-30"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Step {current + 1} of {WIZARD_STEPS.length}
        </span>
        <button
          onClick={() => setCurrent(c => Math.min(WIZARD_STEPS.length - 1, c + 1))}
          disabled={current === WIZARD_STEPS.length - 1}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full transition-all disabled:opacity-30"
          style={{ backgroundColor: "var(--color-accent)", color: "var(--color-bg-base)", fontWeight: 700 }}
        >
          Next
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import FirmTemplateSettings from "./FirmTemplateSettings"
import useReportTypingState from "./report-typing/useReportTypingState"
import FloatingSaveButton from "./report-typing/shared/FloatingSaveButton"
import ClassicView from "./report-typing/views/ClassicView"
import WizardView from "./report-typing/views/WizardView"
import DashboardView from "./report-typing/views/DashboardView"
import DocumentView from "./report-typing/views/DocumentView"
import type { ViewMode, ReportTypingProps } from "./report-typing/types"

// Re-export types for backwards compatibility (used by ReportPreview.tsx)
export type { ReportMetadata, ValuerInputs, ReportContentData } from "./report-typing/types"

// Lazy-load the Editor view (TipTap, only load when selected)
const EditorView = dynamic(() => import("./report-typing/views/EditorView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-96" style={{ backgroundColor: "var(--color-bg-surface)" }}>
      <div className="text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Loading document editor...</p>
      </div>
    </div>
  ),
})

const VIEW_LABELS: Record<ViewMode, string> = {
  classic: "Classic",
  wizard: "Wizard",
  dashboard: "Dashboard",
  document: "Document",
  editor: "Editor",
}

const LS_KEY = "propval-report-view-mode"

export default function ReportTyping(props: ReportTypingProps) {
  const state = useReportTypingState(props)
  const [viewMode, setViewMode] = useState<ViewMode>("classic")

  // Load persisted view preference
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY) as ViewMode | null
    if (saved && saved in VIEW_LABELS) setViewMode(saved)
  }, [])

  const changeView = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem(LS_KEY, mode)
  }

  if (!props.result) return null

  return (
    <div className={viewMode === "editor" ? "space-y-1" : "space-y-2"}>
      {/* Firm Template Settings Modal */}
      {state.showFirmSettings && (
        <FirmTemplateSettings
          session={props.session}
          onClose={() => state.setShowFirmSettings(false)}
          onSaved={state.handleFirmSaved}
        />
      )}

      {/* Header — compact in editor mode */}
      <div className={`flex items-center justify-between ${viewMode === "editor" ? "mb-1" : "mb-4"}`}>
        <div>
          <h2 className="font-orbitron text-[var(--color-accent)] text-sm tracking-[3px] uppercase">Report Typing</h2>
          {viewMode !== "editor" && (
            <p className="text-xs text-[var(--color-text-secondary)]/70 mt-0.5">Draft and edit report sections before export</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* View mode selector */}
          <select
            value={viewMode}
            onChange={e => changeView(e.target.value as ViewMode)}
            className="text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer focus:outline-none transition-colors"
            style={{
              backgroundColor: "var(--color-bg-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            {(Object.entries(VIEW_LABELS) as [ViewMode, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {/* Firm Template button */}
          <button onClick={() => state.setShowFirmSettings(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--color-accent-purple) 27%, transparent)", color: "var(--color-accent-purple-text)", backgroundColor: "color-mix(in srgb, var(--color-accent-purple) 7%, transparent)" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-accent-purple) 13%, transparent)" }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-accent-purple) 7%, transparent)" }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Firm Template
          </button>
        </div>
      </div>

      {/* Active view */}
      {viewMode === "classic" && <ClassicView state={state} />}
      {viewMode === "wizard" && <WizardView state={state} />}
      {viewMode === "dashboard" && <DashboardView state={state} />}
      {viewMode === "document" && <DocumentView state={state} />}
      {viewMode === "editor" && <EditorView state={state} />}

      {/* Floating save button */}
      {props.onSave && (
        <FloatingSaveButton saving={state.saving} saveFlash={state.saveFlash} onSave={state.handleSave} />
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import type { ReportTypingState, AiSectionKey } from "../types"

interface AiSidebarProps {
  state: ReportTypingState
  onInsert: (key: AiSectionKey, text: string) => void
  collapsed: boolean
  onToggle: () => void
}

const AI_SECTIONS: { key: AiSectionKey; label: string; section: string }[] = [
  { key: "location_description", label: "Location Description", section: "2.2" },
  { key: "subject_development", label: "Subject Development", section: "2.3" },
  { key: "subject_building", label: "Subject Building", section: "2.3" },
  { key: "subject_property", label: "Subject Property", section: "2.3" },
  { key: "market_commentary", label: "Market Commentary", section: "3.3" },
  { key: "valuation_considerations", label: "Valuation Considerations", section: "3.6" },
]

export default function AiSidebar({ state, onInsert, collapsed, onToggle }: AiSidebarProps) {
  const [expandedKey, setExpandedKey] = useState<AiSectionKey | null>(null)

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-10 h-full border-l transition-colors"
        style={{
          backgroundColor: "var(--color-bg-surface)",
          borderColor: "var(--color-border)",
        }}
        title="Open AI Sidebar (Ctrl+Shift+A)"
      >
        <svg className="w-5 h-5 rotate-180" style={{ color: "var(--color-status-warning)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    )
  }

  return (
    <div
      className="flex flex-col border-l overflow-y-auto"
      style={{
        width: 220,
        minWidth: 220,
        backgroundColor: "var(--color-bg-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" style={{ color: "var(--color-status-warning)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M5 14.5l-1.43 1.43a2.25 2.25 0 000 3.182l1.61 1.61a2.25 2.25 0 003.182 0L9.8 19.28m9.5-4.5l1.43 1.43a2.25 2.25 0 010 3.182l-1.61 1.61" />
          </svg>
          <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: "var(--color-text-primary)" }}>
            AI
          </span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Close sidebar"
        >
          <svg className="w-4 h-4" style={{ color: "var(--color-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Section list */}
      <div className="flex-1 overflow-y-auto">
        {AI_SECTIONS.map(({ key, label, section }) => {
          const text = state.aiSections[key] || ""
          const isLoading = state.aiLoading[key]
          const isExpanded = expandedKey === key
          const hasText = text.length > 0
          const wordCount = hasText ? text.split(/\s+/).length : 0

          return (
            <div
              key={key}
              className="border-b"
              style={{ borderColor: "var(--color-border)" }}
            >
              {/* Section header */}
              <button
                className="w-full flex items-center justify-between px-2 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
                onClick={() => setExpandedKey(isExpanded ? null : key)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded flex-shrink-0"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--color-status-warning) 13%, transparent)",
                      color: "var(--color-status-warning)",
                    }}
                  >
                    {section}
                  </span>
                  <span className="text-[11px] truncate" style={{ color: "var(--color-text-primary)" }}>
                    {label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Status badge */}
                  {isLoading ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded animate-pulse"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--color-status-warning) 13%, transparent)",
                        color: "var(--color-status-warning)",
                      }}
                    >
                      Generating...
                    </span>
                  ) : hasText ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--color-status-success) 13%, transparent)",
                        color: "var(--color-status-success)",
                      }}
                    >
                      {wordCount}w
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--color-text-secondary) 13%, transparent)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Empty
                    </span>
                  )}
                  {/* Chevron */}
                  <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    style={{ color: "var(--color-text-secondary)" }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-2 pb-2">
                  {/* Preview */}
                  {hasText && (
                    <div
                      className="text-[11px] leading-relaxed mb-2 p-2 rounded max-h-40 overflow-y-auto"
                      style={{
                        color: "var(--color-text-secondary)",
                        backgroundColor: "var(--color-bg-primary)",
                      }}
                    >
                      {text.length > 500 ? text.slice(0, 500) + "..." : text}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => state.generateAiSection(key)}
                      disabled={isLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                      style={{
                        borderColor: "color-mix(in srgb, var(--color-status-warning) 27%, transparent)",
                        color: "var(--color-status-warning)",
                        backgroundColor: "color-mix(in srgb, var(--color-status-warning) 7%, transparent)",
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3" />
                      </svg>
                      {isLoading ? "Generating..." : hasText ? "Regenerate" : "Generate"}
                    </button>

                    {hasText && (
                      <button
                        onClick={() => onInsert(key, text)}
                        className="flex items-center justify-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors"
                        style={{
                          borderColor: "color-mix(in srgb, var(--color-accent) 27%, transparent)",
                          color: "var(--color-accent)",
                          backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
                        }}
                        title="Insert into document at the correct section"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Insert
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <div className="px-2 py-1.5 border-t text-[9px]" style={{
        borderColor: "var(--color-border)",
        color: "var(--color-text-secondary)",
      }}>
        Generate AI text, then insert into document.
      </div>
    </div>
  )
}

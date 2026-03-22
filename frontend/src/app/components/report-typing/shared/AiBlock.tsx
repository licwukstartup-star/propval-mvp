"use client"

import { useRef, useEffect, useCallback } from "react"
import CatBadge from "./CatBadge"
import type { AiSectionKey } from "../types"

interface AiBlockProps {
  sectionKey: AiSectionKey
  label: string
  text: string | undefined
  loading: boolean
  editing: boolean
  onGenerate: (key: AiSectionKey) => void
  onSaveEdit: (key: AiSectionKey, text: string) => void
  onSetEditing: (key: AiSectionKey, editing: boolean) => void
}

const NO_PROMPT_MSG = "No AI prompt configured"

export default function AiBlock({ sectionKey, label, text, loading, editing, onGenerate, onSaveEdit, onSetEditing }: AiBlockProps) {
  const editRef = useRef<HTMLTextAreaElement | null>(null)
  const isNoPrompt = text?.startsWith(NO_PROMPT_MSG)

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }, [])

  // Auto-size on enter edit mode
  useEffect(() => {
    if (editing && editRef.current) autoResize(editRef.current)
  }, [editing, autoResize])

  return (
    <div className="mt-3 rounded-md p-3" style={{ backgroundColor: "var(--color-bg-base)", border: "1px dashed var(--color-accent-purple-dim)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--color-accent-purple-text)" }}>{label}</span>
        <CatBadge cat="D" />
      </div>
      {isNoPrompt ? (
        <div className="flex items-center gap-2 py-2">
          <svg className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-status-info)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            No AI prompt configured for this section. Set up your bespoke prompt in <strong>Firm Template Settings → AI Prompt Instructions</strong>.
          </span>
        </div>
      ) : text && !editing ? (
        <div>
          <p className="text-xs italic mb-1.5" style={{ color: "var(--color-status-warning)" }}>AI-Assisted Draft — Requires Professional Review</p>
          <div className="text-sm leading-relaxed space-y-2" style={{ color: "var(--color-text-primary)" }}>
            {text.split(/\n\n|(?=•\s)/).map(p => p.trim()).filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => onSetEditing(sectionKey, true)}
              className="text-xs px-2 py-0.5 rounded border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-btn-primary-bg)]/10 transition-colors">
              Edit
            </button>
            <button onClick={() => onGenerate(sectionKey)} disabled={loading}
              className="text-xs px-2 py-0.5 rounded border border-[var(--color-status-warning)]/30 text-[var(--color-status-warning)] hover:bg-[var(--color-status-warning)]/10 transition-colors disabled:opacity-50">
              {loading ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      ) : editing ? (
        <div>
          <textarea
            ref={editRef}
            defaultValue={text ?? ""}
            rows={3}
            onInput={e => autoResize(e.currentTarget)}
            className="w-full text-sm px-2.5 py-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none resize-y overflow-hidden"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={() => onSaveEdit(sectionKey, editRef.current?.value ?? "")}
              className="text-xs px-2 py-0.5 rounded bg-[var(--color-status-success)] text-[var(--color-bg-base)] font-semibold hover:bg-[var(--color-status-success)] transition-colors">
              Save
            </button>
            <button onClick={() => onSetEditing(sectionKey, false)}
              className="text-xs px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button onClick={() => onGenerate(sectionKey)} disabled={loading}
            className="text-xs px-3 py-1 rounded bg-[var(--color-status-warning)]/20 text-[var(--color-status-warning)] border border-[var(--color-status-warning)]/30 hover:bg-[var(--color-status-warning)]/30 transition-colors disabled:opacity-50">
            {loading ? "Generating…" : "Generate with AI"}
          </button>
        </div>
      )}
    </div>
  )
}

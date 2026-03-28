"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { API_BASE } from "@/lib/constants"

/* ── Template field definitions ─────────────────────────────────────────── */
interface TemplateField {
  key: string
  label: string
  section: string
  placeholder: string
  rows: number
}

const SECTION_FIELDS: TemplateField[] = [
  { key: "firm_name", label: "Firm Name", section: "Firm Identity", placeholder: "e.g. Smith & Partners Chartered Surveyors", rows: 1 },
  { key: "firm_address", label: "Firm Address", section: "Firm Identity", placeholder: "e.g. 10 High Street, London EC1A 1BB", rows: 2 },
  { key: "firm_rics_number", label: "RICS Firm Number", section: "Firm Identity", placeholder: "e.g. 123456", rows: 1 },
  { key: "instructions", label: "1.1 — Instructions", section: "Section 1: Instructions & Scope", placeholder: "We have been instructed by [Client] to undertake a valuation of the above property for mortgage/secured lending purposes in accordance with…", rows: 5 },
  { key: "purpose", label: "1.3 — Purpose of Valuation (Boilerplate)", section: "Section 1: Instructions & Scope", placeholder: "This valuation has been prepared for mortgage/secured lending purposes for the use of the instructing lender…", rows: 4 },
  { key: "purpose_options", label: "1.3 — Purpose of Valuation (Dropdown Options)", section: "Section 1: Instructions & Scope", placeholder: "Secured Lending\nHelp to Buy\nRight to Buy\nShared Ownership\nCapital Gains Tax (CGT)\nProbate / Inheritance Tax\nMatrimonial / Divorce\nInsurance Reinstatement\nPrivate / Market Appraisal", rows: 8 },
  { key: "responsibility", label: "1.9 — Responsibility", section: "Section 1: Instructions & Scope", placeholder: "This report is prepared for the named client only. No responsibility is accepted to any third party who may use or rely upon it…", rows: 4 },
  { key: "disclosure", label: "1.10 — Disclosure", section: "Section 1: Instructions & Scope", placeholder: "We confirm that we have no material connection or involvement with the property or parties that could give rise to a conflict of interest…", rows: 3 },
  { key: "pi_insurance", label: "1.11 — PI Insurance", section: "Section 1: Instructions & Scope", placeholder: "Professional indemnity insurance is held with [Insurer] under policy number [Number] with a limit of indemnity of £[Amount]…", rows: 3 },
  { key: "expertise", label: "1.12 — Expertise", section: "Section 1: Instructions & Scope", placeholder: "The valuer has sufficient knowledge of the local market and the skills and understanding to undertake the valuation competently…", rows: 3 },
  { key: "inspection", label: "1.13 — Inspection", section: "Section 1: Instructions & Scope", placeholder: "An internal and external inspection of the property was carried out on [date]. The inspection was conducted by [name], MRICS…", rows: 3 },
  { key: "environmental", label: "2.9 — Environmental Matters", section: "Section 2: The Property", placeholder: "We have not carried out any investigation into the presence or absence of contamination, pollutants, or hazardous substances…", rows: 4 },
  { key: "asbestos", label: "2.15 — Asbestos", section: "Section 2: The Property", placeholder: "We have not carried out an asbestos survey. For properties constructed before 2000, it should be assumed that asbestos-containing materials may be present…", rows: 4 },
  { key: "fire_risk", label: "2.18 — Fire Risk & EWS1", section: "Section 2: The Property", placeholder: "We have not carried out a fire risk assessment. For buildings over 11m or 18m in height, an EWS1 form may be required…", rows: 4 },
  { key: "methodology", label: "4.1 — Methodology", section: "Section 4: Valuation", placeholder: "We have adopted the comparative method of valuation, having regard to recent comparable transactions in the locality, adjusted as appropriate for differences in…", rows: 5 },
  { key: "general_comments", label: "4.6 — General Comments", section: "Section 4: Valuation", placeholder: "Our valuation has been prepared on the basis of the information available at the date of valuation and reflects the state of the market at that date…", rows: 5 },
  // AI prompt customisation
  { key: "ai_prompt_location", label: "2.2 — Location Description", section: "AI Prompt Instructions", placeholder: "Required. Tell the AI what to write for this section. Example: Write 2-3 paragraphs covering neighbourhood character, amenities, schools, transport, broadband, heritage and flood designations. 200-350 words, formal third person.", rows: 5 },
  { key: "ai_prompt_subject_development", label: "2.3a — Subject Development", section: "AI Prompt Instructions", placeholder: "Tell the AI what to write about the wider development (estate, complex, or scheme) the property sits within. Example: Describe the development/estate context, age, layout, communal areas, parking, and management arrangements. 100-200 words, formal third person.", rows: 5 },
  { key: "ai_prompt_subject_building", label: "2.3b — Subject Building", section: "AI Prompt Instructions", placeholder: "Tell the AI what to write about the specific building. Example: Describe the building type, construction method, number of storeys, external walls, roof type, windows, and common parts. 100-200 words, formal third person.", rows: 5 },
  { key: "ai_prompt_subject_property", label: "2.3c — Subject Property", section: "AI Prompt Instructions", placeholder: "Tell the AI what to write about the individual dwelling/unit. Example: Describe the accommodation, room layout, floor area, internal condition, fixtures, heating system, and EPC rating. 100-200 words, formal third person.", rows: 5 },
  { key: "ai_prompt_market", label: "3.3 — Market Commentary", section: "AI Prompt Instructions", placeholder: "Required. Tell the AI what to write for this section. Example: Write 2-3 paragraphs covering HPI average price and trends, transaction history with capital growth, market direction and supply/demand. 200-350 words, formal third person.", rows: 5 },
  { key: "ai_prompt_valuation", label: "3.6 — Valuation Considerations", section: "AI Prompt Instructions", placeholder: "Required. Tell the AI what to write for this section. Example: Write 2-4 paragraphs covering positive value factors, adverse/risk factors, tenure and legal constraints, brief summary. 250-400 words, formal third person.", rows: 5 },
]

/* ── Group fields by section ─────────────────────────────────────────────── */
const SECTIONS = [...new Set(SECTION_FIELDS.map(f => f.section))]

/* ── Types ───────────────────────────────────────────────────────────────── */
export interface FirmTemplate {
  [key: string]: string
}

interface FirmTemplateSettingsProps {
  session: any
  onClose: () => void
  onSaved?: (template: FirmTemplate) => void
  scrollToField?: string | null
}

const AI_PROMPT_KEYS = new Set(["ai_prompt_location", "ai_prompt_subject_development", "ai_prompt_subject_building", "ai_prompt_subject_property", "ai_prompt_market", "ai_prompt_valuation"])

/** Keys stored as JSON arrays but edited as newline-separated text */
const JSON_ARRAY_KEYS = new Set(["purpose_options"])

/** Convert a JSON array string to newline-separated text for editing */
function jsonArrayToLines(raw: string | undefined): string {
  if (!raw) return ""
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.join("\n")
  } catch { /* not valid JSON, return as-is */ }
  return raw
}

/** Convert newline-separated text back to a JSON array string for storage */
function linesToJsonArray(text: string): string {
  const arr = text.split("\n").map(s => s.trim()).filter(Boolean)
  return JSON.stringify(arr)
}

export default function FirmTemplateSettings({ session, onClose, onSaved, scrollToField }: FirmTemplateSettingsProps) {
  const [template, setTemplate] = useState<FirmTemplate>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<"ok" | "err" | null>(null)
  const [dirty, setDirty] = useState(false)
  const aiTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }, [])

  // Load existing template
  useEffect(() => {
    if (!session?.access_token) return
    setLoading(true)
    fetch(`${API_BASE}/api/firm-templates`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        const t: FirmTemplate = {}
        for (const f of SECTION_FIELDS) {
          const raw = data[f.key] ?? ""
          t[f.key] = JSON_ARRAY_KEYS.has(f.key) ? jsonArrayToLines(raw) : raw
        }
        setTemplate(t)
      })
      .catch(err => console.error("Failed to load firm template:", err))
      .finally(() => setLoading(false))
  }, [session])

  // Auto-resize AI prompt textareas after template loads
  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(() => {
        for (const key of AI_PROMPT_KEYS) {
          autoResize(aiTextareaRefs.current[key])
        }
      })
    }
  }, [loading, autoResize])

  // Scroll to target field after loading
  useEffect(() => {
    if (!loading && scrollToField && fieldRefs.current[scrollToField]) {
      requestAnimationFrame(() => {
        const el = fieldRefs.current[scrollToField!]
        if (el && scrollContainerRef.current) {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
          el.classList.add("ring-2", "ring-[var(--color-accent-purple)]", "rounded-lg")
          setTimeout(() => el.classList.remove("ring-2", "ring-[var(--color-accent-purple)]", "rounded-lg"), 2000)
        }
      })
    }
  }, [loading, scrollToField])

  const updateField = useCallback((key: string, value: string) => {
    setTemplate(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!session?.access_token) return
    setSaving(true)
    setFlash(null)
    try {
      const res = await fetch(`${API_BASE}/api/firm-templates`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(template).map(([k, v]) =>
              [k, JSON_ARRAY_KEYS.has(k) ? linesToJsonArray(v) : v]
            )
          )
        ),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFlash("ok")
      setDirty(false)
      onSaved?.(data)
    } catch {
      setFlash("err")
    } finally {
      setSaving(false)
      setTimeout(() => setFlash(null), 2000)
    }
  }, [session, template, onSaved])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: "0 0 40px color-mix(in srgb, var(--color-accent-purple) 13%, transparent), 0 8px 32px rgba(0,0,0,0.6)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-accent-purple) 13%, transparent)", color: "var(--color-accent-purple-text)" }}>
              A — Firm Template
            </span>
            <h2 className="font-orbitron text-[var(--color-accent)] text-sm tracking-[2px] uppercase">Firm Template Settings</h2>
          </div>
          <button onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              <span className="ml-3 text-sm text-[var(--color-text-secondary)]">Loading template…</span>
            </div>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                Set your firm&apos;s standard boilerplate text for each RICS report section below.
                This text auto-populates into every new case. Valuers can override per-case if needed.
              </p>

              {SECTIONS.map(section => (
                <div key={section}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-1"
                    style={{ color: section === "AI Prompt Instructions" ? "var(--color-status-warning)" : "var(--color-accent-purple-text)", borderBottom: `1px solid color-mix(in srgb, ${section === "AI Prompt Instructions" ? "var(--color-status-warning)" : "var(--color-accent-purple)"} 20%, transparent)`, paddingBottom: "6px" }}>
                    {section}
                  </h3>
                  {section === "AI Prompt Instructions" && (
                    <p className="text-[11px] leading-relaxed mb-3" style={{ color: "var(--color-text-secondary)" }}>
                      Write bespoke instructions for each AI report section.
                      Tell the AI what to focus on, what tone to use, and what to include or exclude.
                      Each section requires a prompt before AI generation can be used. The AI always receives the property data automatically.
                    </p>
                  )}
                  <div className="space-y-3">
                    {SECTION_FIELDS.filter(f => f.section === section).map(field => (
                      <div key={field.key} ref={el => { fieldRefs.current[field.key] = el }}>
                        <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--color-text-secondary)" }}>
                          {field.label}
                        </label>
                        {JSON_ARRAY_KEYS.has(field.key) && (
                          <p className="text-[10px] mb-1" style={{ color: "var(--color-text-muted)" }}>
                            One option per line. These appear in the Purpose of Valuation dropdown on the Cover page.
                          </p>
                        )}
                        {field.rows <= 1 ? (
                          <input
                            type="text"
                            value={template[field.key] ?? ""}
                            onChange={e => updateField(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className="w-full text-xs px-3 py-2 rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-purple)]/60 focus:outline-none transition-colors placeholder:text-[var(--color-text-muted)]"
                          />
                        ) : (
                          <textarea
                            ref={AI_PROMPT_KEYS.has(field.key) ? (el) => { aiTextareaRefs.current[field.key] = el } : undefined}
                            value={template[field.key] ?? ""}
                            onChange={e => {
                              updateField(field.key, e.target.value)
                              if (AI_PROMPT_KEYS.has(field.key)) autoResize(e.target)
                            }}
                            onInput={AI_PROMPT_KEYS.has(field.key) ? e => autoResize(e.currentTarget) : undefined}
                            placeholder={field.placeholder}
                            rows={AI_PROMPT_KEYS.has(field.key) ? 2 : field.rows}
                            className="w-full text-xs px-3 py-2 rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent-purple)]/60 focus:outline-none transition-colors placeholder:text-[var(--color-text-muted)] leading-relaxed"
                            style={AI_PROMPT_KEYS.has(field.key) ? { resize: "none", overflow: "hidden" } : undefined}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
          <div className="text-[10px]" style={{ color: dirty ? "var(--color-status-warning)" : "var(--color-status-success)" }}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors">
              {dirty ? "Discard & Close" : "Close"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="text-xs px-5 py-2 rounded-lg font-semibold transition-all duration-200 disabled:opacity-40"
              style={{
                background: flash === "ok" ? "var(--color-status-success)" : flash === "err" ? "var(--color-status-danger)" : "var(--color-accent-purple)",
                color: flash === "ok" || flash === "err" ? "var(--color-bg-base)" : "var(--color-btn-primary-text)",
                boxShadow: dirty ? "0 0 12px color-mix(in srgb, var(--color-accent-purple) 27%, transparent)" : "none",
              }}
            >
              {saving ? "Saving…" : flash === "ok" ? "Saved!" : flash === "err" ? "Error" : "Save Template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

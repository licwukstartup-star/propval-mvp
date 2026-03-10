"use client"

import { useState, useEffect, useCallback } from "react"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

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
  { key: "purpose", label: "1.3 — Purpose of Valuation", section: "Section 1: Instructions & Scope", placeholder: "This valuation has been prepared for mortgage/secured lending purposes for the use of the instructing lender…", rows: 4 },
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
}

export default function FirmTemplateSettings({ session, onClose, onSaved }: FirmTemplateSettingsProps) {
  const [template, setTemplate] = useState<FirmTemplate>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<"ok" | "err" | null>(null)
  const [dirty, setDirty] = useState(false)

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
          t[f.key] = data[f.key] ?? ""
        }
        setTemplate(t)
      })
      .catch(err => console.error("Failed to load firm template:", err))
      .finally(() => setLoading(false))
  }, [session])

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
        body: JSON.stringify(template),
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
        className="bg-[#0A0E1A] border border-[#334155] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: "0 0 40px #7B2FBE22, 0 8px 32px rgba(0,0,0,0.6)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <div className="flex items-center gap-3">
            <span className="text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
              style={{ backgroundColor: "#7B2FBE22", color: "#C4B5FD" }}>
              A — Firm Template
            </span>
            <h2 className="font-orbitron text-[#00F0FF] text-sm tracking-[2px] uppercase">Firm Template Settings</h2>
          </div>
          <button onClick={onClose}
            className="text-[#94A3B8] hover:text-[#E2E8F0] transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-[#00F0FF]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              <span className="ml-3 text-sm text-[#94A3B8]">Loading template…</span>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                Set your firm&apos;s standard boilerplate text for each RICS report section below.
                This text auto-populates into every new case. Valuers can override per-case if needed.
              </p>

              {SECTIONS.map(section => (
                <div key={section}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-3"
                    style={{ color: "#C4B5FD", borderBottom: "1px solid #7B2FBE33", paddingBottom: "6px" }}>
                    {section}
                  </h3>
                  <div className="space-y-3">
                    {SECTION_FIELDS.filter(f => f.section === section).map(field => (
                      <div key={field.key}>
                        <label className="text-[10px] font-medium mb-1 block" style={{ color: "#94A3B8" }}>
                          {field.label}
                        </label>
                        {field.rows <= 1 ? (
                          <input
                            type="text"
                            value={template[field.key] ?? ""}
                            onChange={e => updateField(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className="w-full text-xs px-3 py-2 rounded-lg bg-[#111827] border border-[#334155] text-[#E2E8F0] focus:border-[#7B2FBE]/60 focus:outline-none transition-colors placeholder:text-[#475569]"
                          />
                        ) : (
                          <textarea
                            value={template[field.key] ?? ""}
                            onChange={e => updateField(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            rows={field.rows}
                            className="w-full text-xs px-3 py-2 rounded-lg bg-[#111827] border border-[#334155] text-[#E2E8F0] focus:border-[#7B2FBE]/60 focus:outline-none transition-colors resize-y placeholder:text-[#475569] leading-relaxed"
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#334155]">
          <div className="text-[10px]" style={{ color: dirty ? "#FFB800" : "#39FF14" }}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="text-[11px] px-4 py-2 rounded-lg border border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] transition-colors">
              {dirty ? "Discard & Close" : "Close"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="text-[11px] px-5 py-2 rounded-lg font-semibold transition-all duration-200 disabled:opacity-40"
              style={{
                background: flash === "ok" ? "#39FF14" : flash === "err" ? "#FF3131" : "#7B2FBE",
                color: flash === "ok" || flash === "err" ? "#0A0E1A" : "#FFFFFF",
                boxShadow: dirty ? "0 0 12px #7B2FBE44" : "none",
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

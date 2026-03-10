"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import FirmTemplateSettings, { type FirmTemplate } from "./FirmTemplateSettings"

/* ── Category badge ─────────────────────────────────────────────────────── */
const CAT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  A: { bg: "#7B2FBE22", text: "#C4B5FD", label: "Firm Template" },
  B: { bg: "#00F0FF22", text: "#67E8F9", label: "Case Metadata" },
  C: { bg: "#39FF1422", text: "#39FF14", label: "Auto (API)" },
  D: { bg: "#FFB80022", text: "#FFB800", label: "AI Assisted" },
  E: { bg: "#FF2D7822", text: "#FF2D78", label: "Valuer Input" },
  F: { bg: "#94A3B822", text: "#94A3B8", label: "Auto Assembly" },
}

/* ── Report metadata type ─────────────────────────────────────────────── */
export interface ReportMetadata {
  report_reference: string
  report_date: string
  instruction_date: string
  inspection_date: string
  valuation_date: string
  client_name: string
  applicant_name: string
  bank_reference: string
  preparer_name: string
  counter_signatory: string
}

function CatBadge({ cat }: { cat: string }) {
  const c = CAT_COLORS[cat] ?? CAT_COLORS.F
  return (
    <span className="text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {cat} — {c.label}
    </span>
  )
}

/* ── Collapsible section ────────────────────────────────────────────────── */
function Section({ id, title, cats, defaultOpen, children }: {
  id: string; title: string; cats: string[]; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #1E293B" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#1E293B]/50"
        style={{ backgroundColor: open ? "#0F172A" : "#111827" }}
      >
        <span className="text-[10px] transition-transform" style={{ color: "#94A3B8", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
        <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: "#E2E8F0" }}>{title}</span>
        <div className="flex gap-1.5">
          {cats.map(c => <CatBadge key={c} cat={c} />)}
        </div>
      </button>
      {open && (
        <div className="px-4 py-4 space-y-3" style={{ backgroundColor: "#0A0E1A", borderTop: "1px solid #1E293B" }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ── Sub-section (no collapse, just a label) ────────────────────────────── */
function Sub({ num, title, cats, children }: {
  num: string; title: string; cats?: string[]; children: React.ReactNode
}) {
  return (
    <div className="rounded-md p-3" style={{ backgroundColor: "#111827", border: "1px solid #1E293B" }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono" style={{ color: "#00F0FF" }}>{num}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#94A3B8" }}>{title}</span>
        {cats && <div className="flex gap-1 ml-auto">{cats.map(c => <CatBadge key={c} cat={c} />)}</div>}
      </div>
      {children}
    </div>
  )
}

/* ── Placeholder for unbuilt sections ───────────────────────────────────── */
function Placeholder({ text }: { text: string }) {
  return <p className="text-[11px] italic" style={{ color: "#94A3B8" }}>{text}</p>
}

/* ── Auto-populated read-only field ─────────────────────────────────────── */
function AutoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] shrink-0" style={{ color: "#94A3B8" }}>{label}:</span>
      <span className="text-xs" style={{ color: value ? "#E2E8F0" : "#475569" }}>{value || "—"}</span>
    </div>
  )
}

/* ── Editable metadata field ───────────────────────────────────────────── */
function MetaField({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: "text" | "date"
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] shrink-0 w-28" style={{ color: "#94A3B8" }}>{label}:</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 text-xs px-2 py-1 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none transition-colors"
        placeholder={type === "date" ? "" : `Enter ${label.toLowerCase()}`}
      />
    </div>
  )
}

/* ── Tick box field ────────────────────────────────────────────────────── */
function TickField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded border-[#334155] bg-[#1E293B] accent-[#00F0FF]" />
      <span className="text-[11px] group-hover:text-[#E2E8F0] transition-colors" style={{ color: "#94A3B8" }}>{label}</span>
    </label>
  )
}

/* ── Currency input ───────────────────────────────────────────────────── */
function CurrencyField({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] shrink-0 w-28" style={{ color: "#94A3B8" }}>{label}:</span>
      <div className="flex items-center flex-1 gap-1">
        <span className="text-xs" style={{ color: "#94A3B8" }}>£</span>
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 text-xs px-2 py-1 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none transition-colors"
          placeholder="0" />
        {suffix && <span className="text-[10px]" style={{ color: "#94A3B8" }}>{suffix}</span>}
      </div>
    </div>
  )
}

/* ── Risk badge ─────────────────────────────────────────────────────────── */
function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return <span className="text-xs" style={{ color: "#475569" }}>—</span>
  const r = risk.toLowerCase()
  const color = r.includes("high") ? "#FF3131" : r.includes("medium") ? "#FFB800" : r.includes("low") ? "#39FF14" : "#94A3B8"
  return <span className="text-xs font-semibold" style={{ color }}>{risk}</span>
}

/* ══════════════════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════════════════ */
const EMPTY_META: ReportMetadata = {
  report_reference: "", report_date: "", instruction_date: "", inspection_date: "",
  valuation_date: "", client_name: "", applicant_name: "", bank_reference: "",
  preparer_name: "", counter_signatory: "",
}

type AiSectionKey = "location_description" | "building_description" | "market_commentary" | "valuation_considerations"

/* ── Valuer input types ───────────────────────────────────────────────── */
export interface ValuerInputs {
  // 1.7 Basis of Valuation
  basis_market_value: boolean
  basis_market_rent: boolean
  basis_mv_90day: boolean
  basis_mv_180day: boolean
  basis_birc: boolean
  // 1.8 Conflict of Interest
  conflict_of_interest: boolean
  conflict_notes: string
  // 1.14 Special Assumptions
  assumption_no_deleterious: boolean
  assumption_no_contamination: boolean
  assumption_good_title: boolean
  assumption_statutory_compliance: boolean
  assumption_no_encroachment: boolean
  assumption_bespoke: string
  // 2.4 Measurement
  gia_sqm: string
  gia_adopted_epc: boolean
  // 2.5 Site Area
  site_area_sqm: string
  // 2.7 Services
  service_gas: boolean
  service_water: boolean
  service_electricity: boolean
  service_drainage: boolean
  // 2.8 Condition
  condition_rating: string  // "good" | "fair" | "poor" | ""
  condition_notes: string
  // 4.2 Market Rent
  market_rent: string
  market_rent_frequency: string  // "pa" | "pcm"
  // 4.3 Market Value
  market_value: string
  // 4.4 Suitable Security
  suitable_security: boolean
  // 4.5 BIRC
  birc_value: string
  birc_rate_psm: string
}

const EMPTY_VALUER: ValuerInputs = {
  basis_market_value: true, basis_market_rent: false, basis_mv_90day: false, basis_mv_180day: false, basis_birc: true,
  conflict_of_interest: false, conflict_notes: "",
  assumption_no_deleterious: true, assumption_no_contamination: true, assumption_good_title: true,
  assumption_statutory_compliance: true, assumption_no_encroachment: true, assumption_bespoke: "",
  gia_sqm: "", gia_adopted_epc: false,
  site_area_sqm: "",
  service_gas: true, service_water: true, service_electricity: true, service_drainage: true,
  condition_rating: "", condition_notes: "",
  market_rent: "", market_rent_frequency: "pa",
  market_value: "",
  suitable_security: true,
  birc_value: "", birc_rate_psm: "",
}

interface ReportContentData {
  metadata?: Partial<ReportMetadata>
  ai_sections?: Partial<Record<AiSectionKey, string>>
  valuer_inputs?: Partial<ValuerInputs>
}

interface ReportTypingProps {
  result: any
  adoptedComparables: any[]
  session: any
  reportContent?: ReportContentData | null
  onReportContentChange?: (content: Partial<ReportContentData>) => void
  onSave?: () => Promise<void>
  valuationDate?: string
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export default function ReportTyping({ result, adoptedComparables, session, reportContent, onReportContentChange, onSave, valuationDate: parentValuationDate }: ReportTypingProps) {
  const [meta, setMeta] = useState<ReportMetadata>({ ...EMPTY_META, ...reportContent?.metadata })
  const metaRef = useRef(meta)
  metaRef.current = meta

  // AI section state
  const [aiSections, setAiSections] = useState<Partial<Record<AiSectionKey, string>>>(reportContent?.ai_sections ?? {})
  const [aiLoading, setAiLoading] = useState<Record<AiSectionKey, boolean>>({ location_description: false, building_description: false, market_commentary: false, valuation_considerations: false })
  const [aiEditing, setAiEditing] = useState<Record<AiSectionKey, boolean>>({ location_description: false, building_description: false, market_commentary: false, valuation_considerations: false })
  const aiEditRefs = useRef<Partial<Record<AiSectionKey, HTMLTextAreaElement | null>>>({})

  // Valuer input state
  const [valuer, setValuer] = useState<ValuerInputs>({ ...EMPTY_VALUER, ...reportContent?.valuer_inputs })

  // Save button state
  const [saving, setSaving] = useState(false)
  const [saveFlash, setSaveFlash] = useState<"ok" | "err" | null>(null)

  // Firm template state
  const [firmTemplate, setFirmTemplate] = useState<FirmTemplate>({})
  const [showFirmSettings, setShowFirmSettings] = useState(false)

  // Load firm template on mount
  useEffect(() => {
    if (!session?.access_token) return
    fetch(`${API_BASE}/api/firm-templates`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => setFirmTemplate(data))
      .catch(err => console.error("Failed to load firm template:", err))
  }, [session])

  // Sync from parent when case loads
  useEffect(() => {
    if (reportContent?.metadata) {
      setMeta({ ...EMPTY_META, ...reportContent.metadata })
    }
    if (reportContent?.ai_sections) {
      setAiSections(reportContent.ai_sections)
    }
    if (reportContent?.valuer_inputs) {
      setValuer({ ...EMPTY_VALUER, ...reportContent.valuer_inputs })
    }
  }, [reportContent])

  // Echo valuation date from Direct Comparables tab
  useEffect(() => {
    if (parentValuationDate && parentValuationDate !== meta.valuation_date) {
      setMeta(prev => {
        const next = { ...prev, valuation_date: parentValuationDate }
        notifyParent({ metadata: next })
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentValuationDate])

  // Notify parent on changes (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyParent = useCallback((partialUpdate: Partial<ReportContentData>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onReportContentChange?.(partialUpdate)
    }, 800)
  }, [onReportContentChange])

  const updateMeta = useCallback((field: keyof ReportMetadata, value: string) => {
    setMeta(prev => {
      const next = { ...prev, [field]: value }
      notifyParent({ metadata: next })
      return next
    })
  }, [notifyParent])

  const updateValuer = useCallback(<K extends keyof ValuerInputs>(field: K, value: ValuerInputs[K]) => {
    setValuer(prev => {
      const next = { ...prev, [field]: value }
      notifyParent({ valuer_inputs: next })
      return next
    })
  }, [notifyParent])

  // Number-to-words helper for market value display
  const numberToWords = (n: number): string => {
    if (isNaN(n) || n === 0) return ""
    const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "")
    if (n < 1000) return ones[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + numberToWords(n % 100) : "")
    if (n < 1_000_000) return numberToWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + numberToWords(n % 1000) : "")
    return numberToWords(Math.floor(n / 1_000_000)) + " million" + (n % 1_000_000 ? " " + numberToWords(n % 1_000_000) : "")
  }

  // Generate AI section
  const generateAiSection = useCallback(async (key: AiSectionKey) => {
    if (!session?.access_token || !result) return
    setAiLoading(prev => ({ ...prev, [key]: true }))
    try {
      const body = { ...result, requested_section: key }
      const res = await fetch(`${API_BASE}/api/property/ai-narrative`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const text = data[key] || ""
      setAiSections(prev => {
        const next = { ...prev, [key]: text }
        // Schedule parent notification after render (avoid setState-during-render)
        queueMicrotask(() => onReportContentChange?.({ ai_sections: next }))
        return next
      })
    } catch (err) {
      console.error(`AI generation failed for ${key}:`, err)
    } finally {
      setAiLoading(prev => ({ ...prev, [key]: false }))
    }
  }, [session, result, onReportContentChange])

  const saveAiEdit = useCallback((key: AiSectionKey) => {
    const text = aiEditRefs.current[key]?.value ?? ""
    setAiSections(prev => {
      const next = { ...prev, [key]: text }
      queueMicrotask(() => onReportContentChange?.({ ai_sections: next }))
      return next
    })
    setAiEditing(prev => ({ ...prev, [key]: false }))
  }, [onReportContentChange])

  // AI section block renderer
  function AiBlock({ sectionKey, label }: { sectionKey: AiSectionKey; label: string }) {
    const text = aiSections[sectionKey]
    const loading = aiLoading[sectionKey]
    const editing = aiEditing[sectionKey]

    return (
      <div className="mt-3 rounded-md p-3" style={{ backgroundColor: "#0A0E1A", border: "1px dashed #6366F144" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: "#A5B4FC" }}>{label}</span>
          <CatBadge cat="D" />
        </div>
        {text && !editing ? (
          <div>
            <p className="text-xs leading-relaxed" style={{ color: "#E2E8F0" }}>{text}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setAiEditing(prev => ({ ...prev, [sectionKey]: true }))}
                className="text-[10px] px-2 py-0.5 rounded border border-[#00F0FF]/30 text-[#00F0FF] hover:bg-[#00F0FF]/10 transition-colors">
                Edit
              </button>
              <button onClick={() => generateAiSection(sectionKey)} disabled={loading}
                className="text-[10px] px-2 py-0.5 rounded border border-[#FFB800]/30 text-[#FFB800] hover:bg-[#FFB800]/10 transition-colors disabled:opacity-50">
                {loading ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          </div>
        ) : editing ? (
          <div>
            <textarea
              ref={el => { aiEditRefs.current[sectionKey] = el }}
              defaultValue={text ?? ""}
              rows={5}
              className="w-full text-xs px-2 py-1.5 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none resize-y"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => saveAiEdit(sectionKey)}
                className="text-[10px] px-2 py-0.5 rounded bg-[#39FF14] text-[#0A0E1A] font-semibold hover:bg-[#32E612] transition-colors">
                Save
              </button>
              <button onClick={() => setAiEditing(prev => ({ ...prev, [sectionKey]: false }))}
                className="text-[10px] px-2 py-0.5 rounded border border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button onClick={() => generateAiSection(sectionKey)} disabled={loading}
              className="text-[10px] px-3 py-1 rounded bg-[#FFB800]/20 text-[#FFB800] border border-[#FFB800]/30 hover:bg-[#FFB800]/30 transition-colors disabled:opacity-50">
              {loading ? "Generating…" : "Generate with AI"}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Firm template text display helper
  function FirmText({ fieldKey, fallback }: { fieldKey: string; fallback: string }) {
    const text = firmTemplate[fieldKey]
    if (text) {
      return <p className="text-[11px] leading-relaxed" style={{ color: "#E2E8F0" }}>{text}</p>
    }
    return (
      <div className="flex items-center gap-2">
        <p className="text-[11px] italic" style={{ color: "#94A3B8" }}>{fallback}</p>
        <button onClick={() => setShowFirmSettings(true)}
          className="text-[9px] px-1.5 py-0.5 rounded border border-[#7B2FBE]/30 text-[#C4B5FD] hover:bg-[#7B2FBE]/10 transition-colors">
          Set up
        </button>
      </div>
    )
  }

  if (!result) return null

  const r = result

  return (
    <div className="space-y-2">
      {/* Firm Template Settings Modal */}
      {showFirmSettings && (
        <FirmTemplateSettings
          session={session}
          onClose={() => setShowFirmSettings(false)}
          onSaved={(t) => { setFirmTemplate(t); setShowFirmSettings(false) }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-orbitron text-[#00F0FF] text-xs tracking-[3px] uppercase">Report Typing</h2>
          <p className="text-[10px] text-[#94A3B8]/70 mt-0.5">Draft and edit report sections before export</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowFirmSettings(true)}
            className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: "#7B2FBE44", color: "#C4B5FD", backgroundColor: "#7B2FBE11" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#7B2FBE22" }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#7B2FBE11" }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Firm Template
          </button>
          <div className="flex gap-1.5 flex-wrap justify-end">
            {Object.entries(CAT_COLORS).map(([k]) => <CatBadge key={k} cat={k} />)}
          </div>
        </div>
      </div>

      {/* ── Cover Page ──────────────────────────────────────────────────── */}
      <Section id="cover" title="Cover Page" cats={["A", "B", "F"]}>
        {firmTemplate.firm_name && <AutoField label="Firm" value={firmTemplate.firm_name} />}
        <AutoField label="Property Address" value={r.address} />
        <AutoField label="Postcode" value={r.postcode} />
        <Sub num="" title="Report Reference" cats={["B"]}>
          <MetaField label="Report Ref" value={meta.report_reference} onChange={v => updateMeta("report_reference", v)} />
        </Sub>
        <Sub num="" title="Date of Report" cats={["B"]}>
          <MetaField label="Report Date" value={meta.report_date} onChange={v => updateMeta("report_date", v)} type="date" />
        </Sub>
        <Sub num="" title="Client" cats={["B"]}>
          <MetaField label="Client Name" value={meta.client_name} onChange={v => updateMeta("client_name", v)} />
        </Sub>
      </Section>

      {/* ── Table of Contents ───────────────────────────────────────────── */}
      <Section id="toc" title="Table of Contents" cats={["F"]}>
        <Placeholder text="Auto-generated at final report export. Based on active sections and appendices." />
      </Section>

      {/* ── Summary Information ─────────────────────────────────────────── */}
      <Section id="summary" title="Summary Information" cats={["B", "C"]}>
        <AutoField label="Property Address" value={r.address} />
        <AutoField label="Property Type" value={r.property_type} />
        <Sub num="" title="Applicant & Bank Reference" cats={["B"]}>
          <MetaField label="Applicant" value={meta.applicant_name} onChange={v => updateMeta("applicant_name", v)} />
          <MetaField label="Bank Ref" value={meta.bank_reference} onChange={v => updateMeta("bank_reference", v)} />
        </Sub>
        <Sub num="" title="Signatories" cats={["B"]}>
          <MetaField label="Preparer" value={meta.preparer_name} onChange={v => updateMeta("preparer_name", v)} />
          <MetaField label="Counter-signatory" value={meta.counter_signatory} onChange={v => updateMeta("counter_signatory", v)} />
        </Sub>
      </Section>

      {/* ── Section 1: Instructions & Scope ─────────────────────────────── */}
      <Section id="s1" title="Section 1: Instructions, Scope & Investigations" cats={["A", "B", "E"]}>
        <Sub num="1.1" title="Instructions" cats={["A", "B"]}>
          <FirmText fieldKey="instructions" fallback="No instructions boilerplate set — configure in Firm Template settings" />
          <div className="mt-2">
            <MetaField label="Instruction Date" value={meta.instruction_date} onChange={v => updateMeta("instruction_date", v)} type="date" />
          </div>
        </Sub>
        <Sub num="1.2" title="Client" cats={["A", "B"]}>
          <AutoField label="Client" value={meta.client_name || "—"} />
          <AutoField label="Applicant" value={meta.applicant_name || "—"} />
        </Sub>
        <Sub num="1.3" title="Purpose of Valuation" cats={["A", "B"]}>
          <FirmText fieldKey="purpose" fallback="No purpose of valuation boilerplate set" />
        </Sub>
        <Sub num="1.4–1.6" title="Dates & Standards" cats={["A", "B"]}>
          <div>
            <AutoField label="Valuation Date" value={meta.valuation_date ? new Date(meta.valuation_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"} />
            {!meta.valuation_date && (
              <p className="text-[9px] mt-0.5" style={{ color: "#FF2D78" }}>Set in Direct Comparables tab before searching</p>
            )}
          </div>
          <MetaField label="Inspection Date" value={meta.inspection_date} onChange={v => updateMeta("inspection_date", v)} type="date" />
          <p className="text-[10px] mt-1" style={{ color: "#94A3B8" }}>Standards: RICS Red Book Global &amp; UK National Supplement</p>
        </Sub>
        <Sub num="1.7" title="Basis of Valuation" cats={["A", "E"]}>
          <div className="space-y-1.5">
            <TickField label="Market Value (MV)" checked={valuer.basis_market_value} onChange={v => updateValuer("basis_market_value", v)} />
            <TickField label="Market Rent (MR)" checked={valuer.basis_market_rent} onChange={v => updateValuer("basis_market_rent", v)} />
            <TickField label="MV — 90-day restricted realisation" checked={valuer.basis_mv_90day} onChange={v => updateValuer("basis_mv_90day", v)} />
            <TickField label="MV — 180-day restricted realisation" checked={valuer.basis_mv_180day} onChange={v => updateValuer("basis_mv_180day", v)} />
            <TickField label="Building Insurance Reinstatement Cost (BIRC)" checked={valuer.basis_birc} onChange={v => updateValuer("basis_birc", v)} />
          </div>
        </Sub>
        <Sub num="1.8" title="Conflict of Interest" cats={["A", "E"]}>
          <TickField label="Conflict of interest declared" checked={valuer.conflict_of_interest} onChange={v => updateValuer("conflict_of_interest", v)} />
          {valuer.conflict_of_interest && (
            <div className="mt-1.5">
              <MetaField label="Details" value={valuer.conflict_notes} onChange={v => updateValuer("conflict_notes", v)} />
            </div>
          )}
          {!valuer.conflict_of_interest && (
            <p className="text-[10px] mt-1" style={{ color: "#39FF14" }}>No conflict of interest. Standard declaration applies.</p>
          )}
        </Sub>
        <Sub num="1.9–1.11" title="Responsibility, Disclosure, PI Insurance" cats={["A"]}>
          <div className="space-y-2">
            <FirmText fieldKey="responsibility" fallback="No responsibility statement set" />
            <FirmText fieldKey="disclosure" fallback="No disclosure statement set" />
            <FirmText fieldKey="pi_insurance" fallback="No PI insurance details set" />
          </div>
        </Sub>
        <Sub num="1.12" title="Expertise" cats={["A", "B"]}>
          <AutoField label="Preparer" value={meta.preparer_name || "—"} />
          <FirmText fieldKey="expertise" fallback="No expertise statement set" />
        </Sub>
        <Sub num="1.13" title="Inspection" cats={["A", "B"]}>
          <AutoField label="Inspection Date" value={meta.inspection_date || "—"} />
          <FirmText fieldKey="inspection" fallback="No inspection boilerplate set" />
        </Sub>
        <Sub num="1.14" title="Special Assumptions" cats={["E"]}>
          <div className="space-y-1.5">
            <TickField label="No deleterious or hazardous materials" checked={valuer.assumption_no_deleterious} onChange={v => updateValuer("assumption_no_deleterious", v)} />
            <TickField label="No contamination" checked={valuer.assumption_no_contamination} onChange={v => updateValuer("assumption_no_contamination", v)} />
            <TickField label="Good and marketable title" checked={valuer.assumption_good_title} onChange={v => updateValuer("assumption_good_title", v)} />
            <TickField label="Statutory compliance" checked={valuer.assumption_statutory_compliance} onChange={v => updateValuer("assumption_statutory_compliance", v)} />
            <TickField label="No encroachments" checked={valuer.assumption_no_encroachment} onChange={v => updateValuer("assumption_no_encroachment", v)} />
          </div>
          <div className="mt-2">
            <span className="text-[10px]" style={{ color: "#94A3B8" }}>Bespoke assumptions:</span>
            <textarea value={valuer.assumption_bespoke} onChange={e => updateValuer("assumption_bespoke", e.target.value)}
              rows={2} placeholder="Enter any additional special assumptions…"
              className="w-full mt-1 text-xs px-2 py-1.5 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none resize-y" />
          </div>
        </Sub>
      </Section>

      {/* ── Section 2: The Property ─────────────────────────────────────── */}
      <Section id="s2" title="Section 2: The Property" cats={["C", "D", "E"]} defaultOpen>
        <Sub num="2.1" title="Site — Title Number" cats={["C"]}>
          <Placeholder text="Land Registry title number — auto from API (future)" />
        </Sub>

        <Sub num="2.2" title="Location Description" cats={["C", "D"]}>
          <div className="space-y-1.5">
            <AutoField label="Local Authority" value={r.admin_district} />
            <AutoField label="Region" value={r.region} />
            <AutoField label="LSOA" value={r.lsoa} />
            <AutoField label="Coordinates" value={r.lat != null ? `${r.lat.toFixed(5)}, ${r.lon?.toFixed(5)}` : null} />
          </div>
          <AiBlock sectionKey="location_description" label="AI Location Description" />
        </Sub>

        <Sub num="2.3" title="Property Description" cats={["D", "E"]}>
          <div className="space-y-1.5">
            <AutoField label="Property Type" value={r.property_type} />
            <AutoField label="Built Form" value={r.built_form} />
            <AutoField label="Construction Era" value={r.construction_age_band} />
            <AutoField label="Heating" value={r.heating_type} />
          </div>
          <AiBlock sectionKey="building_description" label="AI Building Description" />
        </Sub>

        <Sub num="2.4" title="Measurement" cats={["E"]}>
          <AutoField label="EPC Floor Area" value={r.floor_area_m2 ? `${r.floor_area_m2} sqm` : null} />
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] shrink-0 w-28" style={{ color: "#94A3B8" }}>GIA (sqm):</span>
            <input type="text" value={valuer.gia_sqm} onChange={e => updateValuer("gia_sqm", e.target.value)}
              className="w-24 text-xs px-2 py-1 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none" placeholder="0" />
            {r.floor_area_m2 && !valuer.gia_adopted_epc && (
              <button onClick={() => { updateValuer("gia_sqm", String(r.floor_area_m2)); updateValuer("gia_adopted_epc", true) }}
                className="text-[10px] px-2 py-0.5 rounded border border-[#00F0FF]/30 text-[#00F0FF] hover:bg-[#00F0FF]/10 transition-colors">
                Adopt EPC
              </button>
            )}
            {valuer.gia_adopted_epc && <span className="text-[10px]" style={{ color: "#39FF14" }}>Adopted from EPC</span>}
          </div>
          {valuer.gia_sqm && <AutoField label="GIA (sqft)" value={`${(parseFloat(valuer.gia_sqm) * 10.764).toFixed(0)} sqft`} />}
        </Sub>

        <Sub num="2.5" title="Site Area" cats={["E"]}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] shrink-0 w-28" style={{ color: "#94A3B8" }}>Site Area (sqm):</span>
            <input type="text" value={valuer.site_area_sqm} onChange={e => updateValuer("site_area_sqm", e.target.value)}
              className="w-24 text-xs px-2 py-1 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none" placeholder="0" />
          </div>
          {valuer.site_area_sqm && parseFloat(valuer.site_area_sqm) > 0 && (
            <div className="mt-1 space-y-0.5">
              <AutoField label="Acres" value={(parseFloat(valuer.site_area_sqm) / 4047).toFixed(3)} />
              <AutoField label="Hectares" value={(parseFloat(valuer.site_area_sqm) / 10000).toFixed(4)} />
            </div>
          )}
        </Sub>

        <Sub num="2.7" title="Services" cats={["E"]}>
          <div className="grid grid-cols-2 gap-1.5">
            <TickField label="Mains gas" checked={valuer.service_gas} onChange={v => updateValuer("service_gas", v)} />
            <TickField label="Mains water" checked={valuer.service_water} onChange={v => updateValuer("service_water", v)} />
            <TickField label="Mains electricity" checked={valuer.service_electricity} onChange={v => updateValuer("service_electricity", v)} />
            <TickField label="Mains drainage" checked={valuer.service_drainage} onChange={v => updateValuer("service_drainage", v)} />
          </div>
        </Sub>

        <Sub num="2.8" title="Condition" cats={["D", "E"]}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] shrink-0" style={{ color: "#94A3B8" }}>Overall:</span>
            {(["good", "fair", "poor"] as const).map(opt => (
              <button key={opt} onClick={() => updateValuer("condition_rating", opt)}
                className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-colors capitalize ${
                  valuer.condition_rating === opt
                    ? opt === "good" ? "border-[#39FF14]/50 bg-[#39FF14]/15 text-[#39FF14]"
                      : opt === "fair" ? "border-[#FFB800]/50 bg-[#FFB800]/15 text-[#FFB800]"
                      : "border-[#FF3131]/50 bg-[#FF3131]/15 text-[#FF3131]"
                    : "border-[#334155] text-[#94A3B8] hover:border-[#475569]"
                }`}>
                {opt}
              </button>
            ))}
          </div>
          <textarea value={valuer.condition_notes} onChange={e => updateValuer("condition_notes", e.target.value)}
            rows={2} placeholder="Condition observations…"
            className="w-full text-xs px-2 py-1.5 rounded bg-[#1E293B] border border-[#334155] text-[#E2E8F0] focus:border-[#00F0FF]/50 focus:outline-none resize-y" />
        </Sub>

        <Sub num="2.9" title="Environmental Matters" cats={["A"]}>
          <FirmText fieldKey="environmental" fallback="No environmental disclaimer set" />
        </Sub>

        <Sub num="2.10" title="Green Belt" cats={["C"]}>
          <AutoField label="Green Belt" value={r.green_belt ? "Yes — within Green Belt" : "No"} />
        </Sub>

        <Sub num="2.11" title="Brownfield" cats={["C"]}>
          <AutoField label="Brownfield" value={r.brownfield?.length > 0 ? `Yes — ${r.brownfield.length} site(s) nearby` : "No brownfield sites identified"} />
        </Sub>

        <Sub num="2.12" title="Coal Mining" cats={["C"]}>
          <AutoField label="Coalfield" value={r.coal_mining_in_coalfield ? "Within coalfield" : "Not in coalfield"} />
          <AutoField label="High Risk" value={r.coal_mining_high_risk ? "Yes — high risk area" : "No"} />
        </Sub>

        <Sub num="2.13" title="Radon" cats={["C"]}>
          <AutoField label="Radon Risk" value={r.radon_risk} />
        </Sub>

        <Sub num="2.14" title="Ground Conditions" cats={["C"]}>
          <AutoField label="Shrink-Swell" value={r.ground_shrink_swell} />
          <AutoField label="Landslides" value={r.ground_landslides} />
          <AutoField label="Compressible" value={r.ground_compressible} />
          <AutoField label="Collapsible" value={r.ground_collapsible} />
          <AutoField label="Running Sand" value={r.ground_running_sand} />
          <AutoField label="Soluble Rocks" value={r.ground_soluble_rocks} />
        </Sub>

        <Sub num="2.15" title="Asbestos" cats={["A"]}>
          {r.construction_age_band && !r.construction_age_band.includes("200") && !r.construction_age_band.includes("201") && !r.construction_age_band.includes("202") ? (
            <p className="text-[10px] mb-1.5" style={{ color: "#FFB800" }}>Pre-2000 construction — asbestos warning applies</p>
          ) : (
            <p className="text-[10px] mb-1.5" style={{ color: "#94A3B8" }}>Post-2000 construction — standard disclaimers apply</p>
          )}
          <FirmText fieldKey="asbestos" fallback="No asbestos disclaimer set" />
        </Sub>

        <Sub num="2.17" title="Flood Risk" cats={["C"]}>
          <div className="flex gap-6">
            <div><span className="text-[10px] text-[#94A3B8]">Planning Zone: </span><RiskBadge risk={r.planning_flood_zone ?? "Zone 1"} /></div>
            <div><span className="text-[10px] text-[#94A3B8]">Rivers & Sea: </span><RiskBadge risk={r.rivers_sea_risk} /></div>
            <div><span className="text-[10px] text-[#94A3B8]">Surface Water: </span><RiskBadge risk={r.surface_water_risk} /></div>
          </div>
        </Sub>

        <Sub num="2.18" title="Fire Risk & Cladding / EWS1" cats={["A", "E"]}>
          <FirmText fieldKey="fire_risk" fallback="No fire risk / EWS1 boilerplate set" />
        </Sub>

        <Sub num="2.19" title="Planning & Heritage" cats={["C"]}>
          <AutoField label="Listed Buildings (75m)" value={r.listed_buildings?.length > 0 ? `${r.listed_buildings.length} listed building(s) nearby` : "None identified"} />
          <AutoField label="Conservation Area" value={r.conservation_areas?.length > 0 ? `${r.conservation_areas.length} conservation area(s)` : "None identified"} />
          <AutoField label="AONB" value={r.aonb || "None identified"} />
          <AutoField label="SSSI" value={r.sssi?.length > 0 ? r.sssi.join(", ") : "None identified"} />
        </Sub>

        <Sub num="2.20" title="Energy Performance (EPC)" cats={["C"]}>
          <AutoField label="EPC Rating" value={r.energy_rating} />
          <AutoField label="EPC Score" value={r.energy_score?.toString()} />
          <AutoField label="Floor Area" value={r.floor_area_m2 ? `${r.floor_area_m2} sqm` : null} />
          <AutoField label="Habitable Rooms" value={r.num_rooms?.toString()} />
        </Sub>

        <Sub num="2.21" title="Council Tax" cats={["C"]}>
          <AutoField label="Local Authority" value={r.admin_district} />
          <AutoField label="Council Tax Band" value={r.council_tax_band ? `Band ${r.council_tax_band}` : null} />
        </Sub>
      </Section>

      {/* ── Section 3: Tenure & Market Commentary ───────────────────────── */}
      <Section id="s3" title="Section 3: Tenure & Market Commentary" cats={["A", "C", "D", "E"]}>
        <Sub num="3.1" title="Tenure" cats={["C", "E"]}>
          <AutoField label="Tenure" value={r.tenure} />
          {r.tenure?.toLowerCase().includes("leasehold") && (
            <div className="mt-1 space-y-0.5">
              <AutoField label="Lease Commencement" value={r.lease_commencement} />
              <AutoField label="Lease Term" value={r.lease_term_years ? `${r.lease_term_years} years` : null} />
              <AutoField label="Lease Expiry" value={r.lease_expiry_date} />
            </div>
          )}
        </Sub>

        <Sub num="3.2" title="Tenancies" cats={["E"]}>
          <Placeholder text="Occupancy status dropdown + tenancy agreement upload (future)" />
        </Sub>

        <Sub num="3.3" title="General Market Comments" cats={["A", "D"]}>
          <AiBlock sectionKey="market_commentary" label="AI Local Market Commentary" />
        </Sub>

        <Sub num="3.4" title="Transaction History" cats={["C"]}>
          {r.sales?.length > 0 ? (
            <div className="space-y-1">
              {r.sales.slice(0, 8).map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span style={{ color: "#94A3B8" }}>{s.date}</span>
                  <span style={{ color: "#E2E8F0" }}>£{typeof s.price === "number" ? s.price.toLocaleString() : s.price}</span>
                </div>
              ))}
            </div>
          ) : (
            <Placeholder text="No transaction history found for this property" />
          )}
        </Sub>

        <Sub num="3.5" title="Comparable Evidence" cats={["E"]}>
          {adoptedComparables.length > 0 ? (
            <p className="text-[11px]" style={{ color: "#39FF14" }}>{adoptedComparables.length} comparable(s) adopted — displayed from Adopted Comparables tab</p>
          ) : (
            <Placeholder text="No comparables adopted yet — use the comparable tabs to select evidence" />
          )}
        </Sub>

        <Sub num="3.6" title="Valuation Considerations" cats={["D"]}>
          <AiBlock sectionKey="valuation_considerations" label="AI Valuation Considerations" />
        </Sub>
      </Section>

      {/* ── Section 4: Valuation ────────────────────────────────────────── */}
      <Section id="s4" title="Section 4: Valuation" cats={["A", "E"]}>
        <Sub num="4.1" title="Methodology" cats={["A"]}>
          <FirmText fieldKey="methodology" fallback="No methodology statement set" />
        </Sub>
        <Sub num="4.2" title="Market Rent" cats={["E"]}>
          {valuer.basis_market_rent ? (
            <div>
              <CurrencyField label="Market Rent" value={valuer.market_rent} onChange={v => updateValuer("market_rent", v)} suffix={valuer.market_rent_frequency} />
              <div className="flex gap-2 mt-1.5">
                {(["pa", "pcm"] as const).map(f => (
                  <button key={f} onClick={() => updateValuer("market_rent_frequency", f)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      valuer.market_rent_frequency === f ? "border-[#00F0FF]/50 bg-[#00F0FF]/10 text-[#00F0FF]" : "border-[#334155] text-[#94A3B8]"
                    }`}>
                    {f === "pa" ? "Per Annum" : "Per Calendar Month"}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: "#94A3B8" }}>Market Rent not selected in Basis of Valuation (1.7)</p>
          )}
        </Sub>
        <Sub num="4.3" title="Market Value" cats={["E"]}>
          <CurrencyField label="Market Value" value={valuer.market_value} onChange={v => updateValuer("market_value", v)} />
          {valuer.market_value && parseFloat(valuer.market_value.replace(/,/g, "")) > 0 && (
            <p className="text-[10px] mt-1 italic" style={{ color: "#67E8F9" }}>
              ({numberToWords(parseFloat(valuer.market_value.replace(/,/g, "")))} pounds)
            </p>
          )}
        </Sub>
        <Sub num="4.4" title="Suitable Security" cats={["E"]}>
          <div className="flex items-center gap-3">
            {([true, false] as const).map(v => (
              <button key={String(v)} onClick={() => updateValuer("suitable_security", v)}
                className={`text-[10px] px-3 py-0.5 rounded-full border transition-colors ${
                  valuer.suitable_security === v
                    ? v ? "border-[#39FF14]/50 bg-[#39FF14]/15 text-[#39FF14]" : "border-[#FF3131]/50 bg-[#FF3131]/15 text-[#FF3131]"
                    : "border-[#334155] text-[#94A3B8]"
                }`}>
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
          <p className="text-[10px] mt-1" style={{ color: valuer.suitable_security ? "#39FF14" : "#FF3131" }}>
            {valuer.suitable_security
              ? "In our opinion, the property provides suitable security for mortgage purposes."
              : "In our opinion, the property does not provide suitable security for mortgage purposes."}
          </p>
        </Sub>
        <Sub num="4.5" title="Reinstatement Costs (BIRC)" cats={["E"]}>
          <AutoField label="GIA" value={valuer.gia_sqm ? `${valuer.gia_sqm} sqm` : (r.floor_area_m2 ? `${r.floor_area_m2} sqm (EPC)` : null)} />
          <CurrencyField label="Rebuild Rate" value={valuer.birc_rate_psm} onChange={v => updateValuer("birc_rate_psm", v)} suffix="/sqm" />
          <CurrencyField label="BIRC Total" value={valuer.birc_value} onChange={v => updateValuer("birc_value", v)} />
          {valuer.birc_rate_psm && (valuer.gia_sqm || r.floor_area_m2) && !valuer.birc_value && (
            <button onClick={() => {
              const area = parseFloat(valuer.gia_sqm || String(r.floor_area_m2) || "0")
              const rate = parseFloat(valuer.birc_rate_psm || "0")
              if (area > 0 && rate > 0) updateValuer("birc_value", String(Math.round(area * rate)))
            }}
              className="mt-1.5 text-[10px] px-2 py-0.5 rounded border border-[#00F0FF]/30 text-[#00F0FF] hover:bg-[#00F0FF]/10 transition-colors">
              Calculate (GIA × rate)
            </button>
          )}
        </Sub>
        <Sub num="4.6" title="General Comments" cats={["A"]}>
          <FirmText fieldKey="general_comments" fallback="No general comments boilerplate set" />
        </Sub>
        <Sub num="4.7" title="Report Signatures" cats={["B", "F"]}>
          <AutoField label="Preparer" value={meta.preparer_name || "—"} />
          <AutoField label="Counter-signatory" value={meta.counter_signatory || "—"} />
          <p className="text-[10px]" style={{ color: "#94A3B8" }}>Signatures and qualifications auto-assembled at export.</p>
        </Sub>
      </Section>

      {/* ── Appendices ──────────────────────────────────────────────────── */}
      <Section id="appendices" title="Appendices" cats={["F"]}>
        <Placeholder text="Auto-assembled at final report export:" />
        <div className="space-y-1 ml-3">
          {[
            "I — Instruction Letter (uploaded)",
            "II — Terms & Conditions (firm template)",
            "III — OS Map (auto-generated)",
            "IV — Location Plans (auto-generated)",
            "V — EPC Certificate (from API / uploaded)",
            "Flood Risk Map (auto-generated)",
            "Noise Map (auto-generated)",
            "IMD Map (auto-generated)",
            "Comparable Location Map (auto-generated)",
          ].map((a, i) => (
            <p key={i} className="text-[11px]" style={{ color: "#94A3B8" }}>• {a}</p>
          ))}
        </div>
      </Section>

      {/* ── Floating Save Button ──────────────────────────────────────────── */}
      {onSave && (
        <button
          onClick={async () => {
            setSaving(true)
            setSaveFlash(null)
            try {
              // Flush any pending debounced changes first
              if (debounceRef.current) {
                clearTimeout(debounceRef.current)
                debounceRef.current = null
                onReportContentChange?.({ metadata: meta, ai_sections: aiSections, valuer_inputs: valuer })
              }
              await new Promise(r => setTimeout(r, 50)) // let state propagate
              await onSave()
              setSaveFlash("ok")
            } catch {
              setSaveFlash("err")
            } finally {
              setSaving(false)
              setTimeout(() => setSaveFlash(null), 2000)
            }
          }}
          disabled={saving}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg transition-all duration-200"
          style={{
            background: saveFlash === "ok" ? "#39FF14" : saveFlash === "err" ? "#FF3131" : "#00F0FF",
            color: "#0A0E1A",
            fontWeight: 700,
            fontSize: "13px",
            boxShadow: `0 0 20px ${saveFlash === "ok" ? "#39FF1444" : saveFlash === "err" ? "#FF313144" : "#00F0FF44"}, 0 4px 12px rgba(0,0,0,0.4)`,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
          ) : saveFlash === "ok" ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          ) : saveFlash === "err" ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
          )}
          {saving ? "Saving…" : saveFlash === "ok" ? "Saved" : saveFlash === "err" ? "Error" : "Save Report"}
        </button>
      )}
    </div>
  )
}

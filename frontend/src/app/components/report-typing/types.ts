import type { FirmTemplate } from "../FirmTemplateSettings"

/* ── Report metadata ──────────────────────────────────────────────────── */
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

/* ── AI section keys ──────────────────────────────────────────────────── */
export type AiSectionKey = "location_description" | "subject_development" | "subject_building" | "subject_property" | "market_commentary" | "valuation_considerations"

/* ── Valuer inputs ────────────────────────────────────────────────────── */
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

/* ── Report content data (persisted to case) ─────────────────────────── */
export interface ReportContentData {
  metadata?: Partial<ReportMetadata>
  ai_sections?: Partial<Record<AiSectionKey, string>>
  valuer_inputs?: Partial<ValuerInputs>
  sfdt_document?: string  // Syncfusion SFDT JSON (serialised document for Editor view)
}

/* ── Component props ──────────────────────────────────────────────────── */
export interface ReportTypingProps {
  result: any
  adoptedComparables: any[]
  session: any
  reportContent?: ReportContentData | null
  onReportContentChange?: (content: Partial<ReportContentData>) => void
  onSave?: () => Promise<void>
  valuationDate?: string
}

/* ── View modes ───────────────────────────────────────────────────────── */
export type ViewMode = "classic" | "wizard" | "document" | "dashboard" | "editor"

/* ── Hook return type — shared across all views ──────────────────────── */
export interface ReportTypingState {
  // State
  meta: ReportMetadata
  valuer: ValuerInputs
  aiSections: Partial<Record<AiSectionKey, string>>
  aiLoading: Record<AiSectionKey, boolean>
  aiEditing: Record<AiSectionKey, boolean>
  firmTemplate: FirmTemplate
  saving: boolean
  saveFlash: "ok" | "err" | null
  showFirmSettings: boolean

  // Actions
  updateMeta: (field: keyof ReportMetadata, value: string) => void
  updateValuer: <K extends keyof ValuerInputs>(field: K, value: ValuerInputs[K]) => void
  updateValuerBatch: (updates: Partial<ValuerInputs>) => void
  generateAiSection: (key: AiSectionKey) => Promise<void>
  saveAiEdit: (key: AiSectionKey, text: string) => void
  setAiEditing: (key: AiSectionKey, editing: boolean) => void
  setShowFirmSettings: (show: boolean) => void
  handleFirmSaved: (t: FirmTemplate) => void
  handleSave: () => Promise<void>

  // Derived
  numberToWords: (n: number) => string
  sectionCompletion: Record<string, SectionCompletionInfo>
  overallCompletion: number

  // Props pass-through
  result: any
  adoptedComparables: any[]
  onSave?: () => Promise<void>
}

/* ── Section completion ───────────────────────────────────────────────── */
export interface SectionCompletionInfo {
  total: number
  filled: number
  percentage: number
  isComplete: boolean
}

/* ── Section definition for registry ─────────────────────────────────── */
export interface FieldDef {
  key: string
  source: "meta" | "valuer" | "ai" | "auto" | "firm"
  required: boolean
}

export interface SectionDef {
  id: string
  title: string
  cats: string[]
  wizardStep: number
  fields: FieldDef[]
}

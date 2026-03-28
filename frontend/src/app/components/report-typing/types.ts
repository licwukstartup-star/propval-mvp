import type { FirmTemplate } from "../FirmTemplateSettings"
import type { Signatory } from "./shared/SignatorySelect"

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
  purpose_of_valuation: string
  preparer_qualifications: string
  counter_signatory: string
  counter_signatory_qualifications: string
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
  caseId?: string | null
  reportContent?: ReportContentData | null
  onReportContentChange?: (content: Partial<ReportContentData>) => void
  onSave?: () => Promise<void>
  valuationDate?: string
  activePanelSlug?: string | null
  onPanelChange?: (slug: string | null) => void
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
  signatories: Signatory[]
  showSignatorySettings: boolean
  saving: boolean
  saveFlash: "ok" | "err" | null
  showFirmSettings: boolean
  firmSettingsTarget: string | null
  templateSchema: TemplateSchema | null
  templateName: string | null

  // Panel state
  activePanel: PanelConfig | null
  availablePanels: PanelConfig[]
  panelReminders: ActiveReminder[]
  setActivePanel: (slug: string | null) => void

  // Actions
  updateMeta: (field: keyof ReportMetadata, value: string) => void
  updateValuer: <K extends keyof ValuerInputs>(field: K, value: ValuerInputs[K]) => void
  updateValuerBatch: (updates: Partial<ValuerInputs>) => void
  generateAiSection: (key: AiSectionKey) => Promise<void>
  saveAiEdit: (key: AiSectionKey, text: string) => void
  setAiEditing: (key: AiSectionKey, editing: boolean) => void
  setShowFirmSettings: (show: boolean) => void
  openFirmSettingsAt: (fieldKey: string) => void
  setShowSignatorySettings: (show: boolean) => void
  setSignatories: (sigs: Signatory[]) => void
  handleFirmSaved: (t: FirmTemplate) => void
  handleSave: () => Promise<void>

  // Derived
  numberToWords: (n: number) => string
  sectionCompletion: Record<string, SectionCompletionInfo>
  overallCompletion: number

  // Props pass-through
  result: any
  adoptedComparables: any[]
  caseId?: string | null
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

/* ── Panel config (from panel_configs table) ─────────────────────────── */

export interface PanelFieldOverride {
  min_count?: number
  require_ranking?: boolean
  required?: boolean
  min_length?: number
}

export interface PanelInlineReminder {
  trigger_field: string
  condition: string
  message: string
  severity: "warning" | "info"
}

export interface PanelConfig {
  id: string
  slug: string
  name: string
  description?: string
  is_active: boolean
  config: {
    version?: string
    extra_sections?: Array<{
      id: string
      type: string
      title: string
      insert_after: string
      ai_section_key?: string
      source_field?: string
      panel_boilerplate?: string | null
    }>
    hidden_sections?: string[]
    section_order?: string[]
    field_overrides?: Record<string, PanelFieldOverride>
    inline_reminders?: PanelInlineReminder[]
    qa_rules?: string[]
    boilerplate_overrides?: Record<string, string>
    branding_overrides?: Partial<{ accent_color: string; font_family: string }>
  }
}

export interface ActiveReminder {
  field: string
  message: string
  severity: "warning" | "info"
}

/* ── Template schema (JSONB from report_templates table) ─────────────── */

export interface TemplateSectionDef {
  id: string
  title: string
  type: "cover_page" | "boilerplate" | "narrative" | "data_field" | "comparables_table" | "valuation_summary" | "auto" | "image" | "image_grid" | "appendices" | "placeholder"
  /** Firm template field key (for boilerplate type) */
  source_field?: string
  /** AI section key (for narrative type) */
  ai_section_key?: string
  /** Data field keys (for data_field type) */
  fields?: string[]
  /** Source reference (for auto type) */
  source?: string
  /** Columns for comparables_table */
  columns?: string[]
  /** Max rows for comparables_table */
  max_rows?: number
  /** Image grid layout e.g. "2x3" */
  layout?: string
  /** Nested subsections */
  subsections?: TemplateSectionDef[]
}

export interface TemplateSchema {
  version: string
  page: {
    size: string
    margins: { top: number; right: number; bottom: number; left: number }
    orientation: string
  }
  branding: {
    font_family: string
    font_size: number
    accent_color: string
  }
  header: {
    layout: string
    content: string[]
  }
  footer: {
    content: string
  }
  sections: TemplateSectionDef[]
}

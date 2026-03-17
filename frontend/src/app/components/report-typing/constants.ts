import type { ReportMetadata, ValuerInputs, SectionDef } from "./types"

/* ── Category badge colours ───────────────────────────────────────────── */
export const CAT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  A: { bg: "color-mix(in srgb, var(--color-accent-purple) 13%, transparent)", text: "var(--color-accent-purple-text)", label: "Firm Template" },
  B: { bg: "color-mix(in srgb, var(--color-accent) 13%, transparent)", text: "var(--color-status-info)", label: "Case Metadata" },
  C: { bg: "color-mix(in srgb, var(--color-status-success) 8%, transparent)", text: "var(--color-status-success)", label: "Auto (API)" },
  D: { bg: "color-mix(in srgb, var(--color-status-warning) 13%, transparent)", text: "var(--color-status-warning)", label: "AI Assisted" },
  E: { bg: "color-mix(in srgb, var(--color-accent-pink) 13%, transparent)", text: "var(--color-accent-pink)", label: "Valuer Input" },
  F: { bg: "color-mix(in srgb, var(--color-text-secondary) 13%, transparent)", text: "var(--color-text-secondary)", label: "Auto Assembly" },
}

/* ── Empty defaults ───────────────────────────────────────────────────── */
export const EMPTY_META: ReportMetadata = {
  report_reference: "", report_date: "", instruction_date: "", inspection_date: "",
  valuation_date: "", client_name: "", applicant_name: "", bank_reference: "",
  preparer_name: "", counter_signatory: "",
}

export const EMPTY_VALUER: ValuerInputs = {
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

/* ── Section definitions ──────────────────────────────────────────────── */
export const SECTION_DEFS: SectionDef[] = [
  {
    id: "cover", title: "Cover Page", cats: ["A", "B", "F"], wizardStep: 0,
    fields: [
      { key: "report_reference", source: "meta", required: true },
      { key: "report_date", source: "meta", required: true },
      { key: "client_name", source: "meta", required: true },
    ],
  },
  {
    id: "toc", title: "Table of Contents", cats: ["F"], wizardStep: 0,
    fields: [], // auto-generated
  },
  {
    id: "summary", title: "Summary Information", cats: ["B", "C"], wizardStep: 1,
    fields: [
      { key: "applicant_name", source: "meta", required: false },
      { key: "bank_reference", source: "meta", required: false },
      { key: "preparer_name", source: "meta", required: true },
      { key: "counter_signatory", source: "meta", required: false },
    ],
  },
  {
    id: "s1", title: "Section 1: Instructions, Scope & Investigations", cats: ["A", "B", "E"], wizardStep: 2,
    fields: [
      { key: "instruction_date", source: "meta", required: true },
      { key: "inspection_date", source: "meta", required: true },
      { key: "valuation_date", source: "meta", required: true },
      { key: "instructions", source: "firm", required: true },
      { key: "purpose", source: "firm", required: true },
      { key: "condition_rating", source: "valuer", required: false },
    ],
  },
  {
    id: "s2", title: "Section 2: The Property", cats: ["C", "D", "E"], wizardStep: 3,
    fields: [
      { key: "location_description", source: "ai", required: true },
      { key: "subject_development", source: "ai", required: false },
      { key: "subject_building", source: "ai", required: false },
      { key: "subject_property", source: "ai", required: false },
      { key: "gia_sqm", source: "valuer", required: false },
      { key: "condition_rating", source: "valuer", required: true },
      { key: "condition_notes", source: "valuer", required: false },
    ],
  },
  {
    id: "s3", title: "Section 3: Tenure & Market Commentary", cats: ["A", "C", "D", "E"], wizardStep: 4,
    fields: [
      { key: "market_commentary", source: "ai", required: true },
      { key: "valuation_considerations", source: "ai", required: true },
    ],
  },
  {
    id: "s4", title: "Section 4: Valuation", cats: ["A", "E"], wizardStep: 5,
    fields: [
      { key: "market_value", source: "valuer", required: true },
      { key: "methodology", source: "firm", required: true },
    ],
  },
  {
    id: "appendices", title: "Appendices", cats: ["F"], wizardStep: 6,
    fields: [], // auto-assembled
  },
]

/* ── Wizard step labels ───────────────────────────────────────────────── */
export const WIZARD_STEPS = [
  { label: "Cover", sectionIds: ["cover", "toc"] },
  { label: "Summary", sectionIds: ["summary"] },
  { label: "Instructions & Scope", sectionIds: ["s1"] },
  { label: "The Property", sectionIds: ["s2"] },
  { label: "Tenure & Market", sectionIds: ["s3"] },
  { label: "Valuation", sectionIds: ["s4"] },
  { label: "Appendices", sectionIds: ["appendices"] },
]

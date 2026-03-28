/**
 * resolvePlaceholders.ts
 *
 * Maps placeholder keys to their resolved string values from case data.
 * Used by both the schema renderer (to embed resolved values in HTML)
 * and the PlaceholderNodeView (to show resolved text in preview mode).
 */

import type { ReportMetadata, ValuerInputs, AiSectionKey } from "../types"

export interface ResolverData {
  firmTemplate: Record<string, string>
  meta: ReportMetadata
  result: any
  aiSections: Partial<Record<AiSectionKey, string>>
  valuer: ValuerInputs
  adoptedComparables: any[]
}

/** Format ISO date to readable UK format */
function fmtDate(iso: string): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    })
  } catch { return "" }
}

/** Format price to £n,nnn */
function fmtPrice(n: number | string): string {
  const num = typeof n === "string" ? parseFloat(n) : n
  if (!num || isNaN(num)) return ""
  return `£${num.toLocaleString("en-GB")}`
}

/**
 * Resolve all placeholder keys to their current string values.
 * Returns empty string for unresolved placeholders (not "—").
 */
export function resolvePlaceholders(data: ResolverData): Record<string, string> {
  const { firmTemplate: ft, meta: m, result: r, aiSections: ai, valuer: v, adoptedComparables: comps } = data

  const giaSqm = v.gia_sqm ? parseFloat(v.gia_sqm) : r?.floor_area_m2
  const giaSqft = giaSqm ? Math.round(parseFloat(String(giaSqm)) * 10.7639) : null

  const resolved: Record<string, string> = {
    // ── Category B — Case Metadata ──
    valuation_date: fmtDate(m.valuation_date),
    inspection_date: fmtDate(m.inspection_date),
    instruction_date: fmtDate(m.instruction_date),
    report_date: fmtDate(m.report_date),
    report_reference: m.report_reference || "",
    client_name: m.client_name || "",
    client_address: "", // not in current meta
    applicant_name: m.applicant_name || "",
    bank_reference: m.bank_reference || "",
    property_address: r?.address || "",
    property_postcode: r?.postcode || "",
    uprn: r?.uprn || "",
    valuation_purpose: "", // not in current meta directly
    valuation_basis: [
      v.basis_market_value ? "Market Value" : "",
      v.basis_market_rent ? "Market Rent" : "",
      v.basis_mv_90day ? "MV (90-day)" : "",
      v.basis_mv_180day ? "MV (180-day)" : "",
      v.basis_birc ? "BIRC" : "",
    ].filter(Boolean).join(", "),
    report_type: "", // from case
    inspection_type: "", // from case
    preparer_name: m.preparer_name || "",
    preparer_quals: m.preparer_qualifications || "",
    preparer_title: "",
    countersig_name: m.counter_signatory || "",
    countersig_quals: m.counter_signatory_qualifications || "",
    countersig_title: "",
    complexity: "",
    case_status: "",

    // ── Category C — API Auto-populated ──
    epc_rating: r?.energy_rating || "",
    epc_score: r?.energy_score != null ? String(r.energy_score) : "",
    epc_potential: r?.potential_energy_rating || "",
    epc_floor_area: r?.floor_area_m2 != null ? `${r.floor_area_m2} sq m` : "",
    epc_construction_age: r?.construction_age_band || "",
    epc_walls: r?.walls_description || "",
    epc_roof: r?.roof_description || "",
    epc_heating: r?.mainheat_description || r?.heating_description || "",
    epc_windows: r?.windows_description || "",
    epc_hotwater: r?.hot_water_description || "",
    epc_certificate_number: r?.lmk_key || "",
    epc_inspection_date: r?.epc_inspection_date ? fmtDate(r.epc_inspection_date) : "",
    title_number: r?.title_number || "",
    tenure: r?.tenure || "",
    lease_start: r?.lease_start_date ? fmtDate(r.lease_start_date) : "",
    lease_term: r?.lease_term_years != null ? `${r.lease_term_years} years` : "",
    lease_unexpired: r?.lease_unexpired != null ? `${r.lease_unexpired} years` : "",
    ground_rent: r?.ground_rent != null ? fmtPrice(r.ground_rent) : "",
    service_charge: r?.service_charge != null ? fmtPrice(r.service_charge) : "",
    local_authority: r?.admin_district || "",
    ward: r?.ward || "",
    region: r?.region || "",
    latitude: r?.latitude != null ? String(r.latitude) : "",
    longitude: r?.longitude != null ? String(r.longitude) : "",
    ptal_rating: r?.ptal || "",
    nearest_station: r?.nearest_station || "",
    station_distance: r?.station_distance || "",
    flood_zone: r?.planning_flood_zone || "",
    flood_risk_level: r?.rivers_sea_risk || "",
    radon_risk: r?.radon_risk || "",
    coal_mining: r?.coal_mining || "",
    noise_level: r?.noise_level || "",
    broadband_speed: r?.broadband_speed != null ? `${r.broadband_speed} Mbps` : "",
    listed_status: r?.listed_status || "",
    conservation_area: r?.conservation_area || "",
    brownfield: r?.brownfield != null ? (r.brownfield ? "Yes" : "No") : "",
    aonb: r?.aonb != null ? (r.aonb ? "Yes" : "No") : "",
    council_tax_band: r?.council_tax_band || "",
    imd_rank: r?.imd_rank != null ? String(r.imd_rank) : "",
    imd_decile: r?.imd_decile != null ? String(r.imd_decile) : "",
    nearby_planning: "", // JSON — not rendered as simple text
    opportunity_area: r?.opportunity_area || "",
    site_allocation: r?.site_allocation != null ? (r.site_allocation ? "Yes" : "No") : "",
    housing_zone: r?.housing_zone != null ? (r.housing_zone ? "Yes" : "No") : "",

    // ── Category D — AI-Generated ──
    location_description: ai.location_description || "",
    development_description: ai.subject_development || "",
    building_description: ai.subject_building || "",
    property_summary: ai.subject_property || "",
    market_commentary: ai.market_commentary || "",
    valuation_considerations: ai.valuation_considerations || "",
    environmental_commentary: "", // not yet in ai sections
    fire_risk_commentary: "", // not yet in ai sections

    // ── Category E — Valuer Input ──
    num_floors: "", // from proforma
    floor_level: "",
    num_bedrooms: r?.number_habitable_rooms != null ? String(r.number_habitable_rooms) : "",
    num_bathrooms: "",
    num_receptions: "",
    accommodation_schedule: "",
    orientation: "",
    outlook: "",
    parking: "",
    garden: "",
    condition_overall: v.condition_rating || "",
    condition_notes: v.condition_notes || "",
    gia_sqft: giaSqft != null ? `${giaSqft} sq ft` : "",
    gia_sqm: giaSqm != null ? `${giaSqm} sq m` : "",
    site_area: v.site_area_sqm || "",
    measurement_source: v.gia_adopted_epc ? "EPC" : "Surveyor",
    market_value: v.market_value ? fmtPrice(v.market_value) : "",
    market_value_words: "", // TODO: number-to-words utility
    market_rent: v.market_rent ? fmtPrice(v.market_rent) : "",
    market_rent_words: "",
    reinstatement_cost: v.birc_value ? fmtPrice(v.birc_value) : "",
    reinstatement_words: "",
    suitable_security: v.suitable_security ? "Yes" : "No",
    security_caveats: "",
    special_assumptions: [
      v.assumption_no_deleterious ? "No deleterious or hazardous materials" : "",
      v.assumption_no_contamination ? "No contamination" : "",
      v.assumption_good_title ? "Good and marketable title" : "",
      v.assumption_statutory_compliance ? "Statutory compliance" : "",
      v.assumption_no_encroachment ? "No encroachments" : "",
      v.assumption_bespoke || "",
    ].filter(Boolean).join(". "),
    adopted_psf: "",
    comp_count: comps?.length != null ? String(comps.length) : "0",
    comps_table: "", // rendered as a table, not text
    comp_address: "",
    comp_price: "",
    comp_date: "",
    comp_area: "",
    comp_psf: "",

    // ── Firm template fields (Category A — resolved as text) ──
    firm_name: ft.firm_name || "",
    firm_address: ft.firm_address || "",
    firm_rics_number: ft.firm_rics_number || "",
  }

  return resolved
}

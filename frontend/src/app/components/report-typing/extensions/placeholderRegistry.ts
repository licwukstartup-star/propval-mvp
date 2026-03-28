/**
 * Placeholder Registry — single source of truth for all template placeholders.
 * Mirrors PROPVAL_PLACEHOLDER_REGISTRY.md (v1.0, 17 March 2026).
 *
 * Categories:
 *   A — Firm template boilerplate (no placeholders, stored as firm_templates text)
 *   B — Case metadata (24)
 *   C — API auto-populated (43)
 *   D — AI-assisted professional content (8)
 *   E — Valuer-only professional content (33)
 *   F — Automated assembly (15)
 */

export interface PlaceholderDef {
  key: string
  label: string
  category: "B" | "C" | "D" | "E" | "F"
  required: boolean
  source: string          // DB table.column or "Calculated" / "AI" / "Assembly"
  sections: string[]      // Report sections where this placeholder appears
  type: "TEXT" | "DATE" | "INT" | "FLOAT" | "DECIMAL" | "BOOL" | "ENUM" | "CHAR" | "JSON" | "IMAGE" | "HTML/DOCX" | "PDF/IMAGE" | "IMAGE[]"
}

// ── Category B — Case Metadata (24) ──────────────────────────────────────

const CAT_B: PlaceholderDef[] = [
  { key: "valuation_date", label: "Valuation Date", category: "B", required: true, source: "cases.valuation_date", sections: ["Cover", "1.1", "4.3", "4.7"], type: "DATE" },
  { key: "inspection_date", label: "Inspection Date", category: "B", required: true, source: "cases.inspection_date", sections: ["1.5", "2.1"], type: "DATE" },
  { key: "instruction_date", label: "Instruction Date", category: "B", required: false, source: "cases.instruction_date", sections: ["1.1"], type: "DATE" },
  { key: "report_date", label: "Report Date", category: "B", required: true, source: "cases.report_date", sections: ["Cover", "4.7"], type: "DATE" },
  { key: "report_reference", label: "Report Reference", category: "B", required: true, source: "cases.report_reference", sections: ["Cover", "header"], type: "TEXT" },
  { key: "client_name", label: "Client Name", category: "B", required: true, source: "clients.name", sections: ["Cover", "1.2"], type: "TEXT" },
  { key: "client_address", label: "Client Address", category: "B", required: false, source: "clients.address", sections: ["1.2"], type: "TEXT" },
  { key: "applicant_name", label: "Applicant Name", category: "B", required: false, source: "cases.applicant_name", sections: ["Cover", "1.2"], type: "TEXT" },
  { key: "bank_reference", label: "Bank Reference", category: "B", required: false, source: "cases.bank_reference", sections: ["Cover", "1.2"], type: "TEXT" },
  { key: "property_address", label: "Property Address", category: "B", required: true, source: "properties.full_address", sections: ["Cover", "header", "2.1+"], type: "TEXT" },
  { key: "property_postcode", label: "Property Postcode", category: "B", required: true, source: "properties.postcode", sections: ["Cover", "2.1"], type: "TEXT" },
  { key: "uprn", label: "UPRN", category: "B", required: false, source: "properties.uprn", sections: ["Internal"], type: "TEXT" },
  { key: "valuation_purpose", label: "Valuation Purpose", category: "B", required: true, source: "cases.valuation_purpose", sections: ["Cover", "1.1", "1.3"], type: "ENUM" },
  { key: "valuation_basis", label: "Valuation Basis", category: "B", required: true, source: "cases.valuation_basis", sections: ["1.3", "4.1"], type: "ENUM" },
  { key: "report_type", label: "Report Type", category: "B", required: false, source: "cases.report_type", sections: ["Cover", "1.1"], type: "ENUM" },
  { key: "inspection_type", label: "Inspection Type", category: "B", required: false, source: "cases.inspection_type", sections: ["1.5"], type: "ENUM" },
  { key: "preparer_name", label: "Preparer Name", category: "B", required: true, source: "profiles.full_name", sections: ["1.6", "4.7"], type: "TEXT" },
  { key: "preparer_quals", label: "Preparer Qualifications", category: "B", required: true, source: "profiles.qualifications", sections: ["1.6", "4.7"], type: "TEXT" },
  { key: "preparer_title", label: "Preparer Title", category: "B", required: false, source: "profiles.job_title", sections: ["4.7"], type: "TEXT" },
  { key: "countersig_name", label: "Counter-Signatory Name", category: "B", required: false, source: "profiles.full_name", sections: ["1.6", "4.7"], type: "TEXT" },
  { key: "countersig_quals", label: "Counter-Signatory Quals", category: "B", required: false, source: "profiles.qualifications", sections: ["1.6", "4.7"], type: "TEXT" },
  { key: "countersig_title", label: "Counter-Signatory Title", category: "B", required: false, source: "profiles.job_title", sections: ["4.7"], type: "TEXT" },
  { key: "complexity", label: "Complexity", category: "B", required: false, source: "cases.complexity", sections: ["Internal"], type: "ENUM" },
  { key: "case_status", label: "Case Status", category: "B", required: false, source: "cases.status", sections: ["Internal"], type: "ENUM" },
]

// ── Category C — API Auto-populated (43) ─────────────────────────────────

const CAT_C: PlaceholderDef[] = [
  // EPC Register
  { key: "epc_rating", label: "EPC Rating", category: "C", required: false, source: "epc_certificates.current_energy_rating", sections: ["2.9"], type: "CHAR" },
  { key: "epc_score", label: "EPC Score", category: "C", required: false, source: "epc_certificates.current_energy_efficiency", sections: ["2.9"], type: "INT" },
  { key: "epc_potential", label: "EPC Potential Rating", category: "C", required: false, source: "epc_certificates.potential_energy_rating", sections: ["2.9"], type: "CHAR" },
  { key: "epc_floor_area", label: "EPC Floor Area", category: "C", required: false, source: "epc_certificates.total_floor_area", sections: ["2.3", "2.4"], type: "FLOAT" },
  { key: "epc_construction_age", label: "Construction Age", category: "C", required: false, source: "epc_certificates.construction_age_band", sections: ["2.3"], type: "TEXT" },
  { key: "epc_walls", label: "Wall Description", category: "C", required: false, source: "epc_certificates.walls_description", sections: ["2.3"], type: "TEXT" },
  { key: "epc_roof", label: "Roof Description", category: "C", required: false, source: "epc_certificates.roof_description", sections: ["2.3"], type: "TEXT" },
  { key: "epc_heating", label: "Heating Description", category: "C", required: false, source: "epc_certificates.heating_description", sections: ["2.3"], type: "TEXT" },
  { key: "epc_windows", label: "Window Description", category: "C", required: false, source: "epc_certificates.windows_description", sections: ["2.3"], type: "TEXT" },
  { key: "epc_hotwater", label: "Hot Water Description", category: "C", required: false, source: "epc_certificates.hot_water_description", sections: ["2.3"], type: "TEXT" },
  { key: "epc_certificate_number", label: "EPC Certificate Number", category: "C", required: false, source: "epc_certificates.lmk_key", sections: ["Appendix V"], type: "TEXT" },
  { key: "epc_inspection_date", label: "EPC Inspection Date", category: "C", required: false, source: "epc_certificates.inspection_date", sections: ["2.9"], type: "DATE" },

  // Land Registry / Title
  { key: "title_number", label: "Title Number", category: "C", required: false, source: "cases.title_number", sections: ["2.1"], type: "TEXT" },
  { key: "tenure", label: "Tenure", category: "C", required: true, source: "properties.tenure", sections: ["2.1", "3.1"], type: "ENUM" },
  { key: "lease_start", label: "Lease Start Date", category: "C", required: false, source: "cases.lease_start_date", sections: ["3.1"], type: "DATE" },
  { key: "lease_term", label: "Lease Term (Years)", category: "C", required: false, source: "cases.lease_term_years", sections: ["3.1"], type: "INT" },
  { key: "lease_unexpired", label: "Unexpired Lease Term", category: "C", required: false, source: "Calculated", sections: ["3.1"], type: "INT" },
  { key: "ground_rent", label: "Ground Rent", category: "C", required: false, source: "cases.ground_rent", sections: ["3.1"], type: "DECIMAL" },
  { key: "service_charge", label: "Service Charge", category: "C", required: false, source: "cases.service_charge", sections: ["3.1"], type: "DECIMAL" },

  // Location & Geography
  { key: "local_authority", label: "Local Authority", category: "C", required: false, source: "postcodes_io.admin_district", sections: ["2.2", "header"], type: "TEXT" },
  { key: "ward", label: "Ward", category: "C", required: false, source: "postcodes_io.ward", sections: ["Internal"], type: "TEXT" },
  { key: "region", label: "Region", category: "C", required: false, source: "postcodes_io.region", sections: ["Internal"], type: "TEXT" },
  { key: "latitude", label: "Latitude", category: "C", required: false, source: "properties.latitude", sections: ["Internal"], type: "FLOAT" },
  { key: "longitude", label: "Longitude", category: "C", required: false, source: "properties.longitude", sections: ["Internal"], type: "FLOAT" },
  { key: "ptal_rating", label: "PTAL Rating", category: "C", required: false, source: "tfl_api.ptal_score", sections: ["2.2"], type: "TEXT" },
  { key: "nearest_station", label: "Nearest Station", category: "C", required: false, source: "tfl_api/naptan", sections: ["2.2"], type: "TEXT" },
  { key: "station_distance", label: "Station Distance", category: "C", required: false, source: "Calculated", sections: ["2.2"], type: "TEXT" },

  // Flood Risk
  { key: "flood_zone", label: "Flood Zone", category: "C", required: false, source: "ea_flood.flood_zone", sections: ["2.7"], type: "TEXT" },
  { key: "flood_risk_level", label: "Flood Risk Level", category: "C", required: false, source: "ea_flood.risk_level", sections: ["2.7"], type: "TEXT" },

  // Environmental
  { key: "radon_risk", label: "Radon Risk", category: "C", required: false, source: "uk_radon.risk_level", sections: ["2.7"], type: "TEXT" },
  { key: "coal_mining", label: "Coal Mining", category: "C", required: false, source: "coal_authority.status", sections: ["2.7"], type: "TEXT" },
  { key: "noise_level", label: "Noise Level", category: "C", required: false, source: "defra_noise.level", sections: ["2.7"], type: "TEXT" },

  // Broadband
  { key: "broadband_speed", label: "Broadband Speed", category: "C", required: false, source: "ofcom_broadband.avg_download", sections: ["2.2"], type: "FLOAT" },

  // Planning & Designations
  { key: "listed_status", label: "Listed Status", category: "C", required: false, source: "historic_england.grade", sections: ["2.8"], type: "TEXT" },
  { key: "conservation_area", label: "Conservation Area", category: "C", required: false, source: "gla_conservation_areas", sections: ["2.8"], type: "TEXT" },
  { key: "brownfield", label: "Brownfield", category: "C", required: false, source: "gla_brownfield", sections: ["Internal"], type: "BOOL" },
  { key: "aonb", label: "AONB", category: "C", required: false, source: "natural_england", sections: ["2.7"], type: "BOOL" },
  { key: "council_tax_band", label: "Council Tax Band", category: "C", required: false, source: "voa_council_tax.band", sections: ["2.1"], type: "CHAR" },

  // Deprivation
  { key: "imd_rank", label: "IMD Rank", category: "C", required: false, source: "imd_2025.rank", sections: ["Internal"], type: "INT" },
  { key: "imd_decile", label: "IMD Decile", category: "C", required: false, source: "imd_2025.decile", sections: ["2.2"], type: "INT" },

  // Planning London Datahub
  { key: "nearby_planning", label: "Nearby Planning", category: "C", required: false, source: "pld_applications_cache", sections: ["2.8"], type: "JSON" },
  { key: "opportunity_area", label: "Opportunity Area", category: "C", required: false, source: "gla_opportunity_areas", sections: ["2.2"], type: "TEXT" },
  { key: "site_allocation", label: "Site Allocation", category: "C", required: false, source: "gla_site_allocations", sections: ["2.8"], type: "BOOL" },
  { key: "housing_zone", label: "Housing Zone", category: "C", required: false, source: "gla_housing_zones", sections: ["2.8"], type: "BOOL" },
]

// ── Category D — AI-Assisted Professional Content (8) ────────────────────

const CAT_D: PlaceholderDef[] = [
  { key: "location_description", label: "Location Description", category: "D", required: false, source: "AI + Cat C data", sections: ["2.2"], type: "TEXT" },
  { key: "development_description", label: "Development Description", category: "D", required: false, source: "AI + photos/brochure", sections: ["2.3"], type: "TEXT" },
  { key: "building_description", label: "Building Description", category: "D", required: false, source: "AI + photos", sections: ["2.3"], type: "TEXT" },
  { key: "property_summary", label: "Property Summary", category: "D", required: false, source: "AI + proforma data", sections: ["2.3"], type: "TEXT" },
  { key: "market_commentary", label: "Market Commentary", category: "D", required: false, source: "AI + RICS data + news", sections: ["3.3"], type: "TEXT" },
  { key: "valuation_considerations", label: "Valuation Considerations", category: "D", required: false, source: "AI + Sections 1-4", sections: ["3.6"], type: "TEXT" },
  { key: "environmental_commentary", label: "Environmental Commentary", category: "D", required: false, source: "AI + Cat C env data", sections: ["2.7"], type: "TEXT" },
  { key: "fire_risk_commentary", label: "Fire Risk Commentary", category: "D", required: false, source: "AI + EWS1 data", sections: ["2.7.1"], type: "TEXT" },
]

// ── Category E — Valuer-Only Professional Content (33) ───────────────────

const CAT_E: PlaceholderDef[] = [
  // Subject Property Proforma
  { key: "num_floors", label: "Number of Floors", category: "E", required: false, source: "case_proforma.num_floors", sections: ["2.3"], type: "INT" },
  { key: "floor_level", label: "Floor Level", category: "E", required: false, source: "case_proforma.floor_level", sections: ["2.3"], type: "TEXT" },
  { key: "num_bedrooms", label: "Bedrooms", category: "E", required: false, source: "case_proforma.bedrooms", sections: ["2.3", "2.4"], type: "INT" },
  { key: "num_bathrooms", label: "Bathrooms", category: "E", required: false, source: "case_proforma.bathrooms", sections: ["2.3"], type: "INT" },
  { key: "num_receptions", label: "Reception Rooms", category: "E", required: false, source: "case_proforma.receptions", sections: ["2.3"], type: "INT" },
  { key: "accommodation_schedule", label: "Accommodation Schedule", category: "E", required: false, source: "case_proforma.rooms[]", sections: ["2.3"], type: "JSON" },
  { key: "orientation", label: "Orientation", category: "E", required: false, source: "case_proforma.orientation", sections: ["2.3"], type: "ENUM" },
  { key: "outlook", label: "Outlook", category: "E", required: false, source: "case_proforma.outlook", sections: ["2.3"], type: "TEXT" },
  { key: "parking", label: "Parking", category: "E", required: false, source: "case_proforma.parking", sections: ["2.3"], type: "ENUM" },
  { key: "garden", label: "Garden", category: "E", required: false, source: "case_proforma.garden", sections: ["2.3"], type: "ENUM" },
  { key: "condition_overall", label: "Condition", category: "E", required: false, source: "case_proforma.condition", sections: ["2.6"], type: "ENUM" },
  { key: "condition_notes", label: "Condition Notes", category: "E", required: false, source: "case_proforma.condition_notes", sections: ["2.6"], type: "TEXT" },
  { key: "gia_sqft", label: "GIA (sq ft)", category: "E", required: false, source: "cases.gia_sqft", sections: ["2.4"], type: "FLOAT" },
  { key: "gia_sqm", label: "GIA (sq m)", category: "E", required: false, source: "cases.gia_sqm", sections: ["2.4"], type: "FLOAT" },
  { key: "site_area", label: "Site Area", category: "E", required: false, source: "cases.site_area_sqm", sections: ["2.4"], type: "FLOAT" },
  { key: "measurement_source", label: "Measurement Source", category: "E", required: false, source: "cases.measurement_source", sections: ["2.4"], type: "ENUM" },

  // Valuation Figures
  { key: "market_value", label: "Market Value", category: "E", required: true, source: "cases.market_value", sections: ["4.3"], type: "DECIMAL" },
  { key: "market_value_words", label: "Market Value (Words)", category: "E", required: false, source: "Calculated", sections: ["4.3"], type: "TEXT" },
  { key: "market_rent", label: "Market Rent", category: "E", required: false, source: "cases.market_rent", sections: ["4.2"], type: "DECIMAL" },
  { key: "market_rent_words", label: "Market Rent (Words)", category: "E", required: false, source: "Calculated", sections: ["4.2"], type: "TEXT" },
  { key: "reinstatement_cost", label: "Reinstatement Cost", category: "E", required: false, source: "cases.birc", sections: ["4.5"], type: "DECIMAL" },
  { key: "reinstatement_words", label: "Reinstatement (Words)", category: "E", required: false, source: "Calculated", sections: ["4.5"], type: "TEXT" },
  { key: "suitable_security", label: "Suitable Security", category: "E", required: false, source: "cases.suitable_security", sections: ["4.4"], type: "BOOL" },
  { key: "security_caveats", label: "Security Caveats", category: "E", required: false, source: "cases.security_caveats", sections: ["4.4"], type: "TEXT" },
  { key: "special_assumptions", label: "Special Assumptions", category: "E", required: false, source: "cases.special_assumptions", sections: ["1.4"], type: "TEXT" },
  { key: "adopted_psf", label: "Adopted £/sq ft", category: "E", required: false, source: "cases.adopted_psf", sections: ["3.6"], type: "DECIMAL" },

  // Comparable Evidence
  { key: "comp_count", label: "Comparable Count", category: "E", required: false, source: "Calculated", sections: ["3.5"], type: "INT" },
  { key: "comps_table", label: "Comparables Table", category: "E", required: false, source: "case_comparables[]", sections: ["3.5"], type: "JSON" },
  { key: "comp_address", label: "Comp Address", category: "E", required: false, source: "case_comparables.address", sections: ["3.5"], type: "TEXT" },
  { key: "comp_price", label: "Comp Price", category: "E", required: false, source: "case_comparables.price", sections: ["3.5"], type: "DECIMAL" },
  { key: "comp_date", label: "Comp Date", category: "E", required: false, source: "case_comparables.sale_date", sections: ["3.5"], type: "DATE" },
  { key: "comp_area", label: "Comp Floor Area", category: "E", required: false, source: "case_comparables.floor_area", sections: ["3.5"], type: "FLOAT" },
  { key: "comp_psf", label: "Comp £/sq ft", category: "E", required: false, source: "case_comparables.psf", sections: ["3.5"], type: "DECIMAL" },
]

// ── Category F — Automated Assembly (15) ─────────────────────────────────

const CAT_F: PlaceholderDef[] = [
  { key: "cover_page", label: "Cover Page", category: "F", required: false, source: "Assembly", sections: ["Cover"], type: "HTML/DOCX" },
  { key: "toc", label: "Table of Contents", category: "F", required: false, source: "Assembly", sections: ["Page 2"], type: "HTML/DOCX" },
  { key: "page_number", label: "Page Number", category: "F", required: false, source: "Assembly", sections: ["Footer"], type: "INT" },
  { key: "total_pages", label: "Total Pages", category: "F", required: false, source: "Assembly", sections: ["Footer"], type: "INT" },
  { key: "photo_grid", label: "Photo Grid", category: "F", required: false, source: "case_photos[]", sections: ["2.3"], type: "IMAGE[]" },
  { key: "os_map", label: "OS Map", category: "F", required: false, source: "OS Data Hub API", sections: ["Appendix III"], type: "IMAGE" },
  { key: "location_plan", label: "Location Plan", category: "F", required: false, source: "Mapping API", sections: ["Appendix IV"], type: "IMAGE" },
  { key: "comp_location_map", label: "Comp Location Map", category: "F", required: false, source: "Calculated", sections: ["3.5", "Appendix"], type: "IMAGE" },
  { key: "epc_certificate", label: "EPC Certificate", category: "F", required: false, source: "EPC API / upload", sections: ["Appendix V"], type: "PDF/IMAGE" },
  { key: "flood_map", label: "Flood Map", category: "F", required: false, source: "EA flood API", sections: ["Appendix"], type: "IMAGE" },
  { key: "noise_map", label: "Noise Map", category: "F", required: false, source: "DEFRA noise API", sections: ["Appendix"], type: "IMAGE" },
  { key: "imd_map", label: "IMD Map", category: "F", required: false, source: "IMD data", sections: ["Appendix"], type: "IMAGE" },
  { key: "number_to_words", label: "Number to Words", category: "F", required: false, source: "Utility function", sections: ["4.2-4.5"], type: "TEXT" },
  { key: "date_format_long", label: "Date (Long)", category: "F", required: false, source: "Utility function", sections: ["Throughout"], type: "TEXT" },
  { key: "date_format_short", label: "Date (Short)", category: "F", required: false, source: "Utility function", sections: ["Header"], type: "TEXT" },
]

// ── Combined registry ────────────────────────────────────────────────────

const ALL_PLACEHOLDERS: PlaceholderDef[] = [...CAT_B, ...CAT_C, ...CAT_D, ...CAT_E, ...CAT_F]

/** Map keyed by placeholder key for O(1) lookup */
export const PLACEHOLDER_REGISTRY: Record<string, PlaceholderDef> = Object.fromEntries(
  ALL_PLACEHOLDERS.map((p) => [p.key, p])
)

/** Get all placeholders for a given category */
export function getPlaceholdersByCategory(category: PlaceholderDef["category"]): PlaceholderDef[] {
  return ALL_PLACEHOLDERS.filter((p) => p.category === category)
}

/** Get all placeholders that appear in a given report section */
export function getPlaceholdersBySection(section: string): PlaceholderDef[] {
  return ALL_PLACEHOLDERS.filter((p) => p.sections.includes(section))
}

/** Get all required placeholders */
export function getRequiredPlaceholders(): PlaceholderDef[] {
  return ALL_PLACEHOLDERS.filter((p) => p.required)
}

/** Total count for verification against PROPVAL_PLACEHOLDER_REGISTRY.md */
export const PLACEHOLDER_COUNT = ALL_PLACEHOLDERS.length

export default PLACEHOLDER_REGISTRY

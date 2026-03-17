/**
 * buildTemplate.ts
 *
 * Builds TipTap-compatible HTML content representing the full RICS valuation
 * report structure. Each AI section includes a placeholder marker that the
 * editor can find and replace when AI text is generated.
 *
 * Content categories:
 *   firm  — Category A (firm template boilerplate)
 *   meta  — Category B (case metadata)
 *   auto  — Category C (API data)
 *   ai    — Category D (AI-generated, editable)
 *   valuer — Category E (valuer input)
 */

import type { ReportMetadata, ValuerInputs, AiSectionKey } from "../types"

interface TemplateData {
  firmTemplate: Record<string, string>
  meta: ReportMetadata
  result: any
  aiSections: Partial<Record<AiSectionKey, string>>
  valuer: ValuerInputs
  adoptedComparables: any[]
}

/** Format date string to readable format */
function fmtDate(iso: string): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    })
  } catch { return iso }
}

/** Format price */
function fmtPrice(n: number | string): string {
  const num = typeof n === "string" ? parseFloat(n) : n
  if (!num || isNaN(num)) return "—"
  return `£${num.toLocaleString("en-GB")}`
}

/** Wrap firm template text in a styled non-editable block */
function firmBlock(key: string, text: string): string {
  if (!text) return `<p><em style="color: #8E8E93">Firm template "${key}" not configured. Set up in Firm Template settings.</em></p>`
  return text.split("\n\n").map(p => `<p>${p}</p>`).join("")
}

/** AI section placeholder or existing content */
function aiBlock(key: AiSectionKey, text: string | undefined): string {
  if (text) {
    return text.split("\n\n").map(p => `<p>${p}</p>`).join("")
  }
  return `<p><em style="color: #FF9500">[AI: ${key}] — Click "Generate" in the AI sidebar to populate this section.</em></p>`
}

/**
 * Build the full report as TipTap-compatible HTML.
 */
export function buildReportContent(data: TemplateData): string {
  const { firmTemplate: ft, meta: m, result: r, aiSections: ai, valuer: v, adoptedComparables: comps } = data

  const sections: string[] = []

  // ═══════════════════════════════════════════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  sections.push(`
    <div class="report-page cover-page" data-page="cover">
      <div style="text-align: center; padding-top: 60px;">
        <p style="color: #8E8E93; font-size: 24px; font-weight: bold; letter-spacing: 4px;">PROPVAL</p>
        <h1 style="color: #007AFF; font-size: 22px; margin-top: 8px;">Residential Valuation Report</h1>
        <p style="margin-top: 32px;"><strong style="font-size: 16px;">${ft.firm_name || "Firm Name"}</strong></p>
        <p style="color: #636366; font-size: 11px;">${ft.firm_address || ""}</p>
        <hr style="margin: 32px auto; width: 60%; border-color: #E5E5EA;" />
        <p style="font-size: 18px; font-weight: bold; margin-top: 24px;">${r?.address || "Property Address"}</p>
        <p style="font-size: 14px; color: #636366;">${r?.postcode || ""}</p>
        <div style="margin-top: 40px; color: #636366; font-size: 11px;">
          <p>Date of Report: ${fmtDate(m.report_date)}</p>
          <p>Valuation Date: ${fmtDate(m.valuation_date)}</p>
          <p>Client: ${m.client_name || "—"}</p>
          <p>Report Ref: ${m.report_reference || "—"}</p>
        </div>
      </div>
    </div>
  `)

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY INFORMATION
  // ═══════════════════════════════════════════════════════════════════════════

  sections.push(`
    <div class="report-page" data-page="summary">
      <h2 style="color: #007AFF; border-bottom: 2px solid #007AFF; padding-bottom: 4px;">Summary Information</h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <tbody>
          <tr><td style="padding: 6px 8px; font-weight: 600; width: 40%; color: #636366;">Property</td><td style="padding: 6px 8px;">${r?.address || "—"}</td></tr>
          <tr style="background: #F9F9FB;"><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Client</td><td style="padding: 6px 8px;">${m.client_name || "—"}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Applicant</td><td style="padding: 6px 8px;">${m.applicant_name || "—"}</td></tr>
          <tr style="background: #F9F9FB;"><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Bank Reference</td><td style="padding: 6px 8px;">${m.bank_reference || "—"}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Prepared by</td><td style="padding: 6px 8px;">${m.preparer_name || "—"}</td></tr>
          <tr style="background: #F9F9FB;"><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Counter-signatory</td><td style="padding: 6px 8px;">${m.counter_signatory || "—"}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Valuation Date</td><td style="padding: 6px 8px;">${fmtDate(m.valuation_date)}</td></tr>
          <tr style="background: #F9F9FB;"><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Inspection Date</td><td style="padding: 6px 8px;">${fmtDate(m.inspection_date)}</td></tr>
          <tr><td style="padding: 6px 8px; font-weight: 600; color: #636366;">Instruction Date</td><td style="padding: 6px 8px;">${fmtDate(m.instruction_date)}</td></tr>
        </tbody>
      </table>
    </div>
  `)

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: INSTRUCTIONS & SCOPE
  // ═══════════════════════════════════════════════════════════════════════════

  const bases: string[] = []
  if (v.basis_market_value) bases.push("Market Value")
  if (v.basis_market_rent) bases.push("Market Rent")
  if (v.basis_mv_90day) bases.push("Market Value (90-day restricted marketing)")
  if (v.basis_mv_180day) bases.push("Market Value (180-day restricted marketing)")
  if (v.basis_birc) bases.push("Buildings Insurance Reinstatement Cost (BIRC)")

  const assumptions: string[] = []
  if (v.assumption_no_deleterious) assumptions.push("No deleterious or hazardous materials")
  if (v.assumption_no_contamination) assumptions.push("No contamination")
  if (v.assumption_good_title) assumptions.push("Good and marketable title")
  if (v.assumption_statutory_compliance) assumptions.push("Statutory compliance")
  if (v.assumption_no_encroachment) assumptions.push("No encroachments")
  if (v.assumption_bespoke) assumptions.push(v.assumption_bespoke)

  sections.push(`
    <div class="report-page" data-page="s1">
      <h2 style="color: #007AFF; border-bottom: 2px solid #007AFF; padding-bottom: 4px;">1 &nbsp; Instructions, Scope of Enquiries &amp; Investigations</h2>

      <h3>1.1 &nbsp; Instructions</h3>
      ${firmBlock("instructions", ft.instructions)}

      <h3>1.3 &nbsp; Purpose of Valuation</h3>
      ${firmBlock("purpose", ft.purpose)}

      <h3>1.6 &nbsp; Valuation Standards</h3>
      <p>This valuation has been prepared in accordance with the RICS Valuation – Global Standards (the "Red Book").</p>

      <h3>1.7 &nbsp; Basis of Valuation</h3>
      <p>${bases.join(", ") || "Market Value"}</p>

      <h3>1.9 &nbsp; Responsibility to Third Parties</h3>
      ${firmBlock("responsibility", ft.responsibility)}

      <h3>1.10 &nbsp; Disclosure &amp; Publication</h3>
      ${firmBlock("disclosure", ft.disclosure)}

      <h3>1.11 &nbsp; PI Insurance and Limitations on Liability</h3>
      ${firmBlock("pi_insurance", ft.pi_insurance)}

      <h3>1.12 &nbsp; Expertise</h3>
      ${firmBlock("expertise", ft.expertise)}

      <h3>1.13 &nbsp; Inspection</h3>
      ${firmBlock("inspection", ft.inspection)}

      <h3>1.14 &nbsp; Special Assumptions</h3>
      <p>${assumptions.join(". ") || "No special assumptions."}</p>
    </div>
  `)

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: THE PROPERTY
  // ═══════════════════════════════════════════════════════════════════════════

  const giaSqm = v.gia_sqm ? parseFloat(v.gia_sqm) : r?.floor_area_m2
  const giaSqft = giaSqm ? Math.round(parseFloat(String(giaSqm)) * 10.7639) : ""

  // Flood data
  const floodItems = [
    r?.planning_flood_zone ? `Planning Flood Zone: ${r.planning_flood_zone}` : null,
    r?.rivers_sea_risk ? `Rivers & Sea Risk: ${r.rivers_sea_risk}` : null,
    r?.surface_water_risk ? `Surface Water Risk: ${r.surface_water_risk}` : null,
  ].filter(Boolean)

  sections.push(`
    <div class="report-page" data-page="s2">
      <h2 style="color: #007AFF; border-bottom: 2px solid #007AFF; padding-bottom: 4px;">2 &nbsp; The Property</h2>

      <h3>2.2 &nbsp; Location</h3>
      <p style="color: #636366; font-size: 11px;">Local Authority: ${r?.admin_district || "—"} &nbsp;|&nbsp; Region: ${r?.region || "—"}</p>
      ${aiBlock("location_description", ai.location_description)}

      <h3>2.3 &nbsp; Property Description</h3>
      <h4>Subject Development</h4>
      ${aiBlock("subject_development", ai.subject_development)}
      <h4>Subject Building</h4>
      ${aiBlock("subject_building", ai.subject_building)}
      <h4>Subject Property</h4>
      ${aiBlock("subject_property", ai.subject_property)}

      <h3>2.3.1 &nbsp; Property Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          ${r?.property_type ? `<tr><td style="padding: 4px 8px; font-weight: 600; color: #636366; width: 40%;">Property Type</td><td style="padding: 4px 8px;">${r.property_type}</td></tr>` : ""}
          ${r?.built_form ? `<tr style="background: #F9F9FB;"><td style="padding: 4px 8px; font-weight: 600; color: #636366;">Built Form</td><td style="padding: 4px 8px;">${r.built_form}</td></tr>` : ""}
          ${r?.construction_age_band ? `<tr><td style="padding: 4px 8px; font-weight: 600; color: #636366;">Construction Era</td><td style="padding: 4px 8px;">${r.construction_age_band}</td></tr>` : ""}
          ${r?.energy_rating ? `<tr style="background: #F9F9FB;"><td style="padding: 4px 8px; font-weight: 600; color: #636366;">EPC Rating</td><td style="padding: 4px 8px;">${r.energy_rating} (${r.energy_score || "—"})</td></tr>` : ""}
          ${r?.council_tax_band ? `<tr><td style="padding: 4px 8px; font-weight: 600; color: #636366;">Council Tax Band</td><td style="padding: 4px 8px;">${r.council_tax_band}</td></tr>` : ""}
        </tbody>
      </table>

      <h3>2.4 &nbsp; Measurement</h3>
      <p>Gross Internal Area: ${giaSqm || "—"} sq m${giaSqft ? ` (${giaSqft} sq ft)` : ""}</p>

      <h3>2.8 &nbsp; Condition</h3>
      <p>General Condition: <strong>${v.condition_rating || "Not assessed"}</strong></p>
      ${v.condition_notes ? `<p>${v.condition_notes}</p>` : ""}

      <h3>2.9 &nbsp; Environmental Matters</h3>
      ${firmBlock("environmental", ft.environmental)}

      <h3>2.15 &nbsp; Asbestos</h3>
      ${firmBlock("asbestos", ft.asbestos)}

      <h3>2.17 &nbsp; Flood Risk</h3>
      ${floodItems.length ? floodItems.map(f => `<p>${f}</p>`).join("") : "<p>Flood risk data not available.</p>"}

      <h3>2.18 &nbsp; Fire Risk and Cladding</h3>
      ${firmBlock("fire_risk", ft.fire_risk)}
    </div>
  `)

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: TENURE AND MARKET COMMENTARY
  // ═══════════════════════════════════════════════════════════════════════════

  const tenureText = r?.tenure || "Tenure not confirmed."
  const leaseInfo = r?.lease_expiry_date ? ` Lease expiry: ${fmtDate(r.lease_expiry_date)}.` : ""

  // Transaction history
  const salesHtml = r?.sales?.length
    ? r.sales.map((s: any) =>
      `<tr><td style="padding: 4px 8px;">${fmtDate(s.date || s.transaction_date)}</td><td style="padding: 4px 8px; font-weight: 600;">${fmtPrice(s.price || s.amount)}</td></tr>`
    ).join("")
    : `<tr><td colspan="2" style="padding: 4px 8px;"><em>No previous transactions found.</em></td></tr>`

  sections.push(`
    <div class="report-page" data-page="s3">
      <h2 style="color: #007AFF; border-bottom: 2px solid #007AFF; padding-bottom: 4px;">3 &nbsp; Tenure and Market Commentary</h2>

      <h3>3.1 &nbsp; Tenure</h3>
      <p>${tenureText}${leaseInfo}</p>

      <h3>3.3 &nbsp; General Market Comments</h3>
      ${aiBlock("market_commentary", ai.market_commentary)}

      <h3>3.4 &nbsp; Transaction History</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr style="background: #F2F2F7;"><th style="padding: 6px 8px; text-align: left;">Date</th><th style="padding: 6px 8px; text-align: left;">Price</th></tr></thead>
        <tbody>${salesHtml}</tbody>
      </table>

      <h3>3.5 &nbsp; Residential Sales Comparable Evidence</h3>
      <p>${comps?.length ? `${comps.length} comparable(s) adopted. See appendix for full details.` : "No comparables adopted."}</p>

      <h3>3.6 &nbsp; Valuation Considerations</h3>
      ${aiBlock("valuation_considerations", ai.valuation_considerations)}
    </div>
  `)

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: VALUATION
  // ═══════════════════════════════════════════════════════════════════════════

  const mrText = v.market_rent
    ? `${fmtPrice(v.market_rent)} ${v.market_rent_frequency === "pcm" ? "per calendar month" : "per annum"}`
    : "Not assessed."

  sections.push(`
    <div class="report-page" data-page="s4">
      <h2 style="color: #007AFF; border-bottom: 2px solid #007AFF; padding-bottom: 4px;">4 &nbsp; Valuation</h2>

      <h3>4.1 &nbsp; Methodology</h3>
      ${firmBlock("methodology", ft.methodology)}

      <h3>4.2 &nbsp; Market Rent</h3>
      <p>${mrText}</p>

      <h3>4.3 &nbsp; Market Value</h3>
      <p style="text-align: center; font-size: 20px; font-weight: bold; color: #007AFF; padding: 16px 0;">
        ${v.market_value ? fmtPrice(v.market_value) : "£___________"}
      </p>

      <h3>4.4 &nbsp; Suitable Security</h3>
      <p>${v.suitable_security ? "In our opinion the property provides suitable security for mortgage purposes." : "The property does not provide suitable security for mortgage purposes."}</p>

      <h3>4.5 &nbsp; Buildings Insurance Reinstatement Cost</h3>
      <p>${v.birc_value ? fmtPrice(v.birc_value) : "Not assessed."}</p>

      <h3>4.6 &nbsp; General Comments</h3>
      ${firmBlock("general_comments", ft.general_comments)}

      <hr style="margin: 24px 0; border-color: #E5E5EA;" />

      <h3>Signed</h3>
      <p>Prepared by: ${m.preparer_name || "___________"}</p>
      <p>Counter-signatory: ${m.counter_signatory || "Pending review"}</p>
      <p>Date: ${fmtDate(m.report_date)}</p>
    </div>
  `)

  return sections.join("\n")
}

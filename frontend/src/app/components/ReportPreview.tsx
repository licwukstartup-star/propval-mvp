"use client"

import type { ReportMetadata, ValuerInputs } from "./ReportTyping"
import type { FirmTemplate } from "./FirmTemplateSettings"
import { useState, useEffect } from "react"
import { API_BASE } from "@/lib/constants"

/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmtDate(d: string | undefined | null) {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}
function fmtCurrency(v: string | undefined | null) {
  if (!v) return "—"
  const n = parseFloat(v.replace(/,/g, ""))
  if (isNaN(n) || n === 0) return "—"
  return "£" + n.toLocaleString("en-GB")
}
function numberToWords(n: number): string {
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

/* ── Types ────────────────────────────────────────────────────────────── */
interface ReportPreviewProps {
  result: any
  adoptedComparables: any[]
  session: any
  reportContent?: {
    metadata?: Partial<ReportMetadata>
    ai_sections?: Partial<Record<string, string>>
    valuer_inputs?: Partial<ValuerInputs>
  } | null
  valuationDate?: string
}

/* ── A4 page wrapper ─────────────────────────────────────────────────── */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white text-black mx-auto mb-8 shadow-2xl relative"
      style={{
        width: "210mm", minHeight: "297mm", padding: "25mm 20mm 25mm 20mm",
        fontFamily: "'Calibri', 'Segoe UI', sans-serif", fontSize: "11pt", lineHeight: "1.5",
        boxShadow: "0 4px 40px rgba(0,0,0,0.5)",
      }}>
      {children}
    </div>
  )
}

/* ── Section heading ─────────────────────────────────────────────────── */
function SH({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: "13pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px",
      color: "#007AFF", borderBottom: "2px solid #007AFF", paddingBottom: "4px", marginTop: "18pt", marginBottom: "10pt",
    }}>{children}</h2>
  )
}

/* ── Sub-section heading ─────────────────────────────────────────────── */
function SSH({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: "11pt", fontWeight: 700, color: "#1C1C1E", marginTop: "12pt", marginBottom: "4pt",
    }}>{num && <span style={{ color: "#007AFF", marginRight: "6px" }}>{num}</span>}{children}</h3>
  )
}

/* ── Label : Value row ───────────────────────────────────────────────── */
function Row({ label, value, even }: { label: string; value: string | null | undefined; even?: boolean }) {
  return (
    <div style={{
      display: "flex", padding: "3pt 6pt",
      backgroundColor: even ? "#F2F2F7" : "white",
      borderBottom: "1px solid #E5E5EA",
    }}>
      <span style={{ width: "40%", fontSize: "10pt", color: "#636366", flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, fontSize: "10pt", color: "#1C1C1E" }}>{value || "—"}</span>
    </div>
  )
}

/* ── Paragraph text ──────────────────────────────────────────────────── */
function Para({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: "10pt", color: "#1C1C1E", marginBottom: "6pt", textAlign: "justify" }}>{children}</p>
}

/* ── Risk colour ─────────────────────────────────────────────────────── */
function riskColor(risk: string | null) {
  if (!risk) return "#636366"
  const r = risk.toLowerCase()
  if (r.includes("high")) return "#FF3B30"
  if (r.includes("medium")) return "#FF9500"
  if (r.includes("low") || r.includes("zone 1")) return "#34C759"
  return "#636366"
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════════════ */
export default function ReportPreview({ result, adoptedComparables, session, reportContent, valuationDate }: ReportPreviewProps) {
  const r = result ?? {}
  const meta: ReportMetadata = {
    report_reference: "", report_date: "", instruction_date: "", inspection_date: "",
    valuation_date: valuationDate || "", client_name: "", applicant_name: "", bank_reference: "",
    preparer_name: "", counter_signatory: "",
    ...reportContent?.metadata,
  }
  if (valuationDate && !meta.valuation_date) meta.valuation_date = valuationDate
  const ai = reportContent?.ai_sections ?? {}
  const v: ValuerInputs = {
    basis_market_value: true, basis_market_rent: false, basis_mv_90day: false, basis_mv_180day: false, basis_birc: true,
    conflict_of_interest: false, conflict_notes: "",
    assumption_no_deleterious: true, assumption_no_contamination: true, assumption_good_title: true,
    assumption_statutory_compliance: true, assumption_no_encroachment: true, assumption_bespoke: "",
    gia_sqm: "", gia_adopted_epc: false, site_area_sqm: "",
    service_gas: true, service_water: true, service_electricity: true, service_drainage: true,
    condition_rating: "", condition_notes: "",
    market_rent: "", market_rent_frequency: "pa", market_value: "",
    suitable_security: true, birc_value: "", birc_rate_psm: "",
    ...reportContent?.valuer_inputs,
  }

  // Load firm template
  const [firm, setFirm] = useState<FirmTemplate>({})
  useEffect(() => {
    if (!session?.access_token) return
    fetch(`${API_BASE}/api/firm-templates`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(setFirm)
      .catch(() => {})
  }, [session])

  const bases = [
    v.basis_market_value && "Market Value (MV)",
    v.basis_market_rent && "Market Rent (MR)",
    v.basis_mv_90day && "MV — 90-day restricted realisation",
    v.basis_mv_180day && "MV — 180-day restricted realisation",
    v.basis_birc && "Building Insurance Reinstatement Cost (BIRC)",
  ].filter(Boolean)

  const assumptions = [
    v.assumption_no_deleterious && "No deleterious or hazardous materials",
    v.assumption_no_contamination && "No contamination",
    v.assumption_good_title && "Good and marketable title",
    v.assumption_statutory_compliance && "Statutory compliance",
    v.assumption_no_encroachment && "No encroachments",
  ].filter(Boolean)

  const services = [
    v.service_gas && "Mains gas",
    v.service_water && "Mains water",
    v.service_electricity && "Mains electricity",
    v.service_drainage && "Mains drainage",
  ].filter(Boolean)

  const mvNum = v.market_value ? parseFloat(v.market_value.replace(/,/g, "")) : 0

  return (
    <div className="py-8 px-4" style={{ backgroundColor: "#1a1a2e", minHeight: "100vh" }}>
      {/* Print button */}
      <div className="flex justify-center mb-6 gap-3">
        <button
          onClick={() => window.print()}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ backgroundColor: "#007AFF", color: "white" }}
        >
          Print / Save as PDF
        </button>
      </div>

      {/* ── COVER PAGE ──────────────────────────────────────────────────── */}
      <Page>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "247mm", textAlign: "center" }}>
          {firm.firm_name && (
            <p style={{ fontSize: "14pt", color: "#636366", marginBottom: "40pt", textTransform: "uppercase", letterSpacing: "3px" }}>
              {firm.firm_name}
            </p>
          )}
          {firm.firm_address && (
            <p style={{ fontSize: "9pt", color: "#636366", marginBottom: "30pt", whiteSpace: "pre-line" }}>
              {firm.firm_address}
            </p>
          )}

          <div style={{ borderTop: "3px solid #007AFF", borderBottom: "3px solid #007AFF", padding: "30pt 0", margin: "0 40pt" }}>
            <p style={{ fontSize: "20pt", fontWeight: 700, color: "#007AFF", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "12pt" }}>
              Residential Valuation Report
            </p>
            <p style={{ fontSize: "10pt", color: "#636366", marginBottom: "20pt" }}>
              RICS Valuation — Global Standards (Red Book)
            </p>
            <p style={{ fontSize: "14pt", fontWeight: 600, color: "#1C1C1E", marginBottom: "8pt" }}>
              {r.address || "—"}
            </p>
            <p style={{ fontSize: "12pt", color: "#636366" }}>
              {r.postcode || "—"}
            </p>
          </div>

          <div style={{ marginTop: "40pt", fontSize: "10pt", color: "#636366" }}>
            {meta.client_name && <p>Prepared for: <strong style={{ color: "#1C1C1E" }}>{meta.client_name}</strong></p>}
            {meta.report_reference && <p style={{ marginTop: "4pt" }}>Report Ref: {meta.report_reference}</p>}
            <p style={{ marginTop: "4pt" }}>Date of Valuation: {fmtDate(meta.valuation_date)}</p>
            <p style={{ marginTop: "4pt" }}>Date of Report: {fmtDate(meta.report_date)}</p>
          </div>

          {firm.firm_rics_number && (
            <p style={{ fontSize: "9pt", color: "#636366", marginTop: "30pt" }}>
              RICS Firm No: {firm.firm_rics_number}
            </p>
          )}
        </div>
      </Page>

      {/* ── SUMMARY INFORMATION ─────────────────────────────────────────── */}
      <Page>
        <SH>Summary Information</SH>
        <Row label="Property Address" value={r.address} even />
        <Row label="Postcode" value={r.postcode} />
        <Row label="Property Type" value={r.property_type} even />
        <Row label="Tenure" value={r.tenure} />
        <Row label="Applicant" value={meta.applicant_name} even />
        <Row label="Bank Reference" value={meta.bank_reference} />
        <Row label="Valuation Date" value={fmtDate(meta.valuation_date)} even />
        <Row label="Inspection Date" value={fmtDate(meta.inspection_date)} />
        <Row label="Floor Area (GIA)" value={v.gia_sqm ? `${v.gia_sqm} sqm` : (r.floor_area_m2 ? `${r.floor_area_m2} sqm (EPC)` : null)} even />
        <Row label="EPC Rating" value={r.energy_rating ? `${r.energy_rating} (${r.energy_score})` : null} />
        <Row label="Market Value" value={fmtCurrency(v.market_value)} even />
        {v.basis_market_rent && <Row label="Market Rent" value={v.market_rent ? `${fmtCurrency(v.market_rent)} ${v.market_rent_frequency}` : null} />}
        <Row label="BIRC" value={fmtCurrency(v.birc_value)} even={!v.basis_market_rent} />
        <Row label="Suitable Security" value={v.suitable_security ? "Yes" : "No"} even={v.basis_market_rent} />
        <Row label="Preparer" value={meta.preparer_name} even={!v.basis_market_rent} />
        <Row label="Counter-signatory" value={meta.counter_signatory} even={v.basis_market_rent} />

        {/* ── SECTION 1 ──────────────────────────────────────────────────── */}
        <SH>Section 1 — Instructions, Scope &amp; Investigations</SH>

        <SSH num="1.1">Instructions</SSH>
        <Para>{firm.instructions || "—"}</Para>
        {meta.instruction_date && <Para>Date of instruction: {fmtDate(meta.instruction_date)}</Para>}

        <SSH num="1.2">Client</SSH>
        <Row label="Client" value={meta.client_name} even />
        <Row label="Applicant" value={meta.applicant_name} />

        <SSH num="1.3">Purpose of Valuation</SSH>
        <Para>{firm.purpose || "—"}</Para>

        <SSH num="1.4–1.6">Dates &amp; Standards</SSH>
        <Row label="Valuation Date" value={fmtDate(meta.valuation_date)} even />
        <Row label="Inspection Date" value={fmtDate(meta.inspection_date)} />
        <Row label="Report Date" value={fmtDate(meta.report_date)} even />
        <Para>Prepared in accordance with the RICS Valuation — Global Standards (effective 31 January 2022) and the UK National Supplement (effective November 2023).</Para>

        <SSH num="1.7">Basis of Valuation</SSH>
        {bases.length > 0 ? (
          <ul style={{ paddingLeft: "16pt", fontSize: "10pt", color: "#1C1C1E" }}>
            {bases.map((b, i) => <li key={i} style={{ marginBottom: "2pt" }}>{b}</li>)}
          </ul>
        ) : <Para>—</Para>}

        <SSH num="1.8">Conflict of Interest</SSH>
        {v.conflict_of_interest ? (
          <Para>A conflict of interest has been declared: {v.conflict_notes || "See details."}</Para>
        ) : (
          <Para>We confirm that we have no conflict of interest in undertaking this valuation.</Para>
        )}
      </Page>

      {/* ── SECTION 1 CONTINUED ─────────────────────────────────────────── */}
      <Page>
        <SSH num="1.9–1.11">Responsibility, Disclosure &amp; PI Insurance</SSH>
        {firm.responsibility && <><SSH num="">Responsibility</SSH><Para>{firm.responsibility}</Para></>}
        {firm.disclosure && <><SSH num="">Disclosure</SSH><Para>{firm.disclosure}</Para></>}
        {firm.pi_insurance && <><SSH num="">Professional Indemnity Insurance</SSH><Para>{firm.pi_insurance}</Para></>}

        <SSH num="1.12">Expertise</SSH>
        {meta.preparer_name && <Para>This report has been prepared by {meta.preparer_name}.</Para>}
        <Para>{firm.expertise || "—"}</Para>

        <SSH num="1.13">Inspection</SSH>
        {meta.inspection_date && <Para>An inspection was carried out on {fmtDate(meta.inspection_date)}.</Para>}
        <Para>{firm.inspection || "—"}</Para>

        <SSH num="1.14">Special Assumptions</SSH>
        <Para>This valuation has been prepared on the basis of the following assumptions:</Para>
        {assumptions.length > 0 && (
          <ul style={{ paddingLeft: "16pt", fontSize: "10pt", color: "#1C1C1E" }}>
            {assumptions.map((a, i) => <li key={i} style={{ marginBottom: "2pt" }}>{a}</li>)}
          </ul>
        )}
        {v.assumption_bespoke && <Para>{v.assumption_bespoke}</Para>}

        {/* ── SECTION 2 ──────────────────────────────────────────────────── */}
        <SH>Section 2 — The Property</SH>

        <SSH num="2.2">Location</SSH>
        <Row label="Local Authority" value={r.admin_district} even />
        <Row label="Region" value={r.region} />
        <Row label="LSOA" value={r.lsoa} even />
        {r.lat != null && <Row label="Coordinates" value={`${r.lat.toFixed(5)}, ${r.lon?.toFixed(5)}`} />}
        {ai.location_description && <Para>{ai.location_description}</Para>}

        <SSH num="2.3">Property Description</SSH>
        <Row label="Property Type" value={r.property_type} even />
        <Row label="Built Form" value={r.built_form} />
        <Row label="Construction Era" value={r.construction_age_band} even />
        <Row label="Heating" value={r.heating_type} />
        {ai.subject_development && <><SSH num="2.3a">Subject Development</SSH><Para>{ai.subject_development}</Para></>}
        {ai.subject_building && <><SSH num="2.3b">Subject Building</SSH><Para>{ai.subject_building}</Para></>}
        {ai.subject_property && <><SSH num="2.3c">Subject Property</SSH><Para>{ai.subject_property}</Para></>}
      </Page>

      {/* ── SECTION 2 CONTINUED ─────────────────────────────────────────── */}
      <Page>
        <SSH num="2.4">Measurement</SSH>
        <Row label="EPC Floor Area" value={r.floor_area_m2 ? `${r.floor_area_m2} sqm` : null} even />
        <Row label="GIA (Adopted)" value={v.gia_sqm ? `${v.gia_sqm} sqm (${(parseFloat(v.gia_sqm) * 10.764).toFixed(0)} sqft)` : null} />
        {v.gia_adopted_epc && <Para><em>GIA adopted from EPC certificate.</em></Para>}

        {v.site_area_sqm && parseFloat(v.site_area_sqm) > 0 && (
          <>
            <SSH num="2.5">Site Area</SSH>
            <Row label="Site Area" value={`${v.site_area_sqm} sqm (${(parseFloat(v.site_area_sqm) / 4047).toFixed(3)} acres)`} even />
          </>
        )}

        <SSH num="2.7">Services</SSH>
        <Para>{services.length > 0 ? `The property is connected to ${services.join(", ").toLowerCase()}.` : "Service connections not confirmed."}</Para>

        <SSH num="2.8">Condition</SSH>
        {v.condition_rating && <Para>Overall condition: <strong style={{ textTransform: "capitalize" }}>{v.condition_rating}</strong></Para>}
        {v.condition_notes && <Para>{v.condition_notes}</Para>}

        <SSH num="2.9">Environmental Matters</SSH>
        <Para>{firm.environmental || "—"}</Para>

        <SSH num="2.10–2.14">Environmental &amp; Ground Conditions</SSH>
        <Row label="Brownfield" value={r.brownfield?.length > 0 ? `${r.brownfield.length} site(s) nearby` : "No"} />
        <Row label="Coalfield" value={r.coal_mining_in_coalfield ? "Within coalfield" : "Not in coalfield"} even />
        <Row label="Coal Mining High Risk" value={r.coal_mining_high_risk ? "Yes" : "No"} />
        <Row label="Radon Risk" value={r.radon_risk} even />
        <Row label="Shrink-Swell" value={r.ground_shrink_swell} />
        <Row label="Landslides" value={r.ground_landslides} even />
        <Row label="Compressible Ground" value={r.ground_compressible} />
        <Row label="Collapsible Ground" value={r.ground_collapsible} even />
        <Row label="Running Sand" value={r.ground_running_sand} />
        <Row label="Soluble Rocks" value={r.ground_soluble_rocks} even />

        <SSH num="2.15">Asbestos</SSH>
        <Para>{firm.asbestos || "—"}</Para>
      </Page>

      {/* ── FLOOD, FIRE, PLANNING, EPC ──────────────────────────────────── */}
      <Page>
        <SSH num="2.17">Flood Risk</SSH>
        <Row label="Planning Flood Zone" value={r.planning_flood_zone ?? "Zone 1"} even />
        <Row label="Rivers & Sea Risk" value={r.rivers_sea_risk} />
        <Row label="Surface Water Risk" value={r.surface_water_risk} even />
        {/* colour indicators */}
        <div style={{ display: "flex", gap: "16pt", marginTop: "4pt", marginBottom: "8pt" }}>
          {[
            { l: "Planning Zone", v: r.planning_flood_zone ?? "Zone 1" },
            { l: "Rivers & Sea", v: r.rivers_sea_risk },
            { l: "Surface Water", v: r.surface_water_risk },
          ].map((item, i) => (
            <span key={i} style={{ fontSize: "9pt", color: riskColor(item.v), fontWeight: 600 }}>
              {item.l}: {item.v || "—"}
            </span>
          ))}
        </div>

        <SSH num="2.18">Fire Risk &amp; Cladding / EWS1</SSH>
        <Para>{firm.fire_risk || "—"}</Para>

        <SSH num="2.19">Planning &amp; Heritage</SSH>
        <Row label="Listed Buildings (75m)" value={r.listed_buildings?.length > 0 ? `${r.listed_buildings.length} listed building(s) nearby` : "None identified"} even />
        <Row label="Conservation Area" value={r.conservation_areas?.length > 0 ? `${r.conservation_areas.length} conservation area(s)` : "None identified"} />
        <Row label="AONB" value={r.aonb || "None identified"} even />
        <Row label="SSSI" value={r.sssi?.length > 0 ? r.sssi.join(", ") : "None identified"} />

        <SSH num="2.20">Energy Performance (EPC)</SSH>
        <Row label="EPC Rating" value={r.energy_rating} even />
        <Row label="EPC Score" value={r.energy_score?.toString()} />
        <Row label="Floor Area" value={r.floor_area_m2 ? `${r.floor_area_m2} sqm` : null} even />
        <Row label="Habitable Rooms" value={r.num_rooms?.toString()} />

        <SSH num="2.21">Council Tax</SSH>
        <Row label="Local Authority" value={r.admin_district} even />
        <Row label="Council Tax Band" value={r.council_tax_band ? `Band ${r.council_tax_band}` : null} />
      </Page>

      {/* ── SECTION 3 ───────────────────────────────────────────────────── */}
      <Page>
        <SH>Section 3 — Tenure &amp; Market Commentary</SH>

        <SSH num="3.1">Tenure</SSH>
        <Row label="Tenure" value={r.tenure} even />
        {r.tenure?.toLowerCase().includes("leasehold") && (
          <>
            <Row label="Lease Commencement" value={r.lease_commencement} />
            <Row label="Lease Term" value={r.lease_term_years ? `${r.lease_term_years} years` : null} even />
            <Row label="Lease Expiry" value={r.lease_expiry_date} />
          </>
        )}

        <SSH num="3.3">General Market Commentary</SSH>
        <Para>{ai.market_commentary || "—"}</Para>

        <SSH num="3.4">Transaction History</SSH>
        {r.sales?.length > 0 ? (
          <div>
            {r.sales.slice(0, 10).map((s: any, i: number) => (
              <Row key={i} label={s.date} value={`£${typeof s.price === "number" ? s.price.toLocaleString() : s.price}`} even={i % 2 === 0} />
            ))}
          </div>
        ) : <Para>No transaction history found for this property.</Para>}

        <SSH num="3.5">Comparable Evidence</SSH>
        {adoptedComparables.length > 0 ? (
          <div style={{ marginTop: "6pt" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr",
              fontSize: "9pt", fontWeight: 700, color: "white", padding: "4pt 6pt",
              background: "linear-gradient(90deg, #007AFF 0%, var(--color-accent-pink) 100%)", borderRadius: "3pt 3pt 0 0",
            }}>
              <span>Address</span><span>Price</span><span>Date</span><span>Type</span><span>Area</span>
            </div>
            {adoptedComparables.slice(0, 10).map((c: any, i: number) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr",
                fontSize: "9pt", padding: "3pt 6pt",
                backgroundColor: i % 2 === 0 ? "white" : "#F2F2F7", borderBottom: "1px solid #E5E5EA",
              }}>
                <span style={{ color: "#1C1C1E" }}>{c.address || "—"}</span>
                <span style={{ color: "#1C1C1E" }}>£{typeof c.price === "number" ? c.price.toLocaleString() : c.price}</span>
                <span style={{ color: "#636366" }}>{c.transaction_date || c.date || "—"}</span>
                <span style={{ color: "#636366" }}>{c.property_type || "—"}</span>
                <span style={{ color: "#636366" }}>{c.floor_area_sqm ? `${Math.round(c.floor_area_sqm).toLocaleString()}m²` : (c.floor_area ? `${parseFloat(c.floor_area).toLocaleString()}m²` : "—")}</span>
              </div>
            ))}
          </div>
        ) : <Para>No comparable evidence adopted.</Para>}

        <SSH num="3.6">Valuation Considerations</SSH>
        <Para>{ai.valuation_considerations || "—"}</Para>
      </Page>

      {/* ── SECTION 4 ───────────────────────────────────────────────────── */}
      <Page>
        <SH>Section 4 — Valuation</SH>

        <SSH num="4.1">Methodology</SSH>
        <Para>{firm.methodology || "—"}</Para>

        {v.basis_market_rent && (
          <>
            <SSH num="4.2">Market Rent</SSH>
            <div style={{
              padding: "10pt 16pt", margin: "8pt 0", border: "2px solid #007AFF", borderRadius: "4pt",
              textAlign: "center",
            }}>
              <p style={{ fontSize: "9pt", color: "#636366", marginBottom: "4pt" }}>Market Rent</p>
              <p style={{ fontSize: "16pt", fontWeight: 700, color: "#1C1C1E" }}>
                {fmtCurrency(v.market_rent)} {v.market_rent_frequency === "pa" ? "per annum" : "per calendar month"}
              </p>
            </div>
          </>
        )}

        <SSH num="4.3">Market Value</SSH>
        <div style={{
          padding: "14pt 16pt", margin: "8pt 0", border: "3px solid #007AFF", borderRadius: "4pt",
          textAlign: "center", backgroundColor: "#F2F2F7",
        }}>
          <p style={{ fontSize: "9pt", color: "#636366", marginBottom: "4pt" }}>Market Value as at {fmtDate(meta.valuation_date)}</p>
          <p style={{ fontSize: "22pt", fontWeight: 700, color: "#007AFF" }}>
            {fmtCurrency(v.market_value)}
          </p>
          {mvNum > 0 && (
            <p style={{ fontSize: "10pt", color: "#636366", marginTop: "4pt", fontStyle: "italic" }}>
              ({numberToWords(mvNum)} pounds)
            </p>
          )}
        </div>

        <SSH num="4.4">Suitable Security</SSH>
        <Para>
          {v.suitable_security
            ? "In our opinion, the property provides suitable security for mortgage purposes."
            : "In our opinion, the property does not provide suitable security for mortgage purposes."}
        </Para>

        <SSH num="4.5">Reinstatement Cost (BIRC)</SSH>
        <Row label="GIA" value={v.gia_sqm ? `${v.gia_sqm} sqm` : (r.floor_area_m2 ? `${r.floor_area_m2} sqm (EPC)` : null)} even />
        <Row label="Rebuild Rate" value={v.birc_rate_psm ? `${fmtCurrency(v.birc_rate_psm)}/sqm` : null} />
        <Row label="BIRC Total" value={fmtCurrency(v.birc_value)} even />

        <SSH num="4.6">General Comments</SSH>
        <Para>{firm.general_comments || "—"}</Para>

        {/* ── SIGNATURES ─────────────────────────────────────────────────── */}
        <div style={{ marginTop: "40pt", borderTop: "2px solid #E5E5EA", paddingTop: "16pt" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: "9pt", color: "#636366", marginBottom: "30pt" }}>Signed:</p>
              <p style={{ fontSize: "10pt", fontWeight: 600, color: "#1C1C1E" }}>{meta.preparer_name || "—"}</p>
              <p style={{ fontSize: "9pt", color: "#636366" }}>MRICS Registered Valuer</p>
              <p style={{ fontSize: "9pt", color: "#636366" }}>Date: {fmtDate(meta.report_date)}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: "9pt", color: "#636366", marginBottom: "30pt" }}>Counter-signed:</p>
              <p style={{ fontSize: "10pt", fontWeight: 600, color: "#1C1C1E" }}>{meta.counter_signatory || "—"}</p>
              <p style={{ fontSize: "9pt", color: "#636366" }}>MRICS</p>
            </div>
          </div>
        </div>
      </Page>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; margin: 0 !important; }
          .py-8 { padding: 0 !important; background: white !important; }
          button { display: none !important; }
          [class*="Page"] { box-shadow: none !important; margin: 0 !important; }
        }
        @page { size: A4; margin: 0; }
      `}</style>
    </div>
  )
}

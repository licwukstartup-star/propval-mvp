/**
 * buildTemplateFromSchema.ts
 *
 * Schema-driven report renderer. Reads a TemplateSchema (JSONB from
 * report_templates table) and produces TipTap-compatible HTML with
 * embedded PlaceholderNode spans and SectionBlock wrappers.
 *
 * Replaces the hardcoded buildTemplate.ts for template-aware reports.
 */

import type { ReportMetadata, ValuerInputs, AiSectionKey, TemplateSchema, TemplateSectionDef } from "../types"
import { PLACEHOLDER_REGISTRY } from "../extensions/placeholderRegistry"
import { resolvePlaceholders, type ResolverData } from "./resolvePlaceholders"

// Re-export the data interface so callers use the same shape
export type { ResolverData as TemplateData }

// ── Helpers ──────────────────────────────────────────────────────────────

/** Escape HTML special characters to prevent injection */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** Emit a placeholder <span> that TipTap will parse as a PlaceholderNode atom */
function ph(key: string): string {
  const def = PLACEHOLDER_REGISTRY[key]
  const label = esc(def?.label || key)
  const category = def?.category || "B"
  const required = def?.required ?? false
  return `<span data-placeholder-key="${esc(key)}" data-category="${category}" data-required="${required}" data-label="${label}">${label}</span>`
}

/** Emit a section block wrapper div */
function sectionOpen(id: string, type: string, title: string): string {
  return `<div data-section-id="${id}" data-section-type="${type}" data-section-title="${title}" class="report-section">`
}
const sectionClose = "</div>"

/** Styled heading matching buildTemplate.ts blue headings */
function h2(text: string, accent: string): string {
  return `<h2 style="color: ${accent}; border-bottom: 2px solid ${accent}; padding-bottom: 4px;">${text}</h2>`
}
function h3(text: string): string {
  return `<h3>${text}</h3>`
}
function h4(text: string): string {
  return `<h4>${text}</h4>`
}

/** Firm boilerplate — shows content or a setup prompt */
function firmBlock(key: string, text: string): string {
  if (!text) return `<p><em style="color: #8E8E93">Firm template "${key}" not configured. Set up in Firm Template settings.</em></p>`
  return text.split("\n\n").map(p => `<p>${p}</p>`).join("")
}

/** AI section — shows content or a generate prompt */
function aiBlock(key: string, text: string | undefined): string {
  if (text) return text.split("\n\n").map(p => `<p>${p}</p>`).join("")
  return `<p><em style="color: #FF9500">[AI: ${key}] — Click "Generate" in the AI sidebar to populate this section.</em></p>`
}

/** Format price */
function fmtPrice(n: number | string): string {
  const num = typeof n === "string" ? parseFloat(n) : n
  if (!num || isNaN(num)) return "—"
  return `£${num.toLocaleString("en-GB")}`
}

/** Format date */
function fmtDate(iso: string): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  } catch { return "—" }
}

// ── Section Renderers ────────────────────────────────────────────────────

function renderCoverPage(
  section: TemplateSectionDef,
  data: ResolverData,
  accent: string
): string {
  const { firmTemplate: ft, meta: m, result: r } = data
  return `
    ${sectionOpen(section.id, section.type, section.title)}
    <div style="text-align: center; padding-top: 60px;">
      <p style="color: #8E8E93; font-size: 24px; font-weight: bold; letter-spacing: 4px;">PROPVAL</p>
      <h1 style="color: ${accent}; font-size: 22px; margin-top: 8px;">${section.title}</h1>
      <p style="margin-top: 32px;"><strong style="font-size: 16px;">${ft.firm_name || "Firm Name"}</strong></p>
      <p style="color: #636366; font-size: 11px;">${ft.firm_address || ""}</p>
      <hr style="margin: 32px auto; width: 60%; border-color: #E5E5EA;" />
      <p style="font-size: 18px; font-weight: bold; margin-top: 24px;">${ph("property_address")}</p>
      <p style="font-size: 14px; color: #636366;">${ph("property_postcode")}</p>
      <div style="margin-top: 40px; color: #636366; font-size: 11px;">
        <p>Date of Report: ${ph("report_date")}</p>
        <p>Valuation Date: ${ph("valuation_date")}</p>
        <p>Client: ${ph("client_name")}</p>
        <p>Report Ref: ${ph("report_reference")}</p>
      </div>
    </div>
    ${sectionClose}`
}

function renderBoilerplate(
  section: TemplateSectionDef,
  data: ResolverData,
  accent: string
): string {
  const parts: string[] = []
  parts.push(sectionOpen(section.id, section.type, section.title))
  parts.push(h2(section.title, accent))

  if (section.subsections) {
    for (const sub of section.subsections) {
      parts.push(renderSubsection(sub, data, accent))
    }
  } else if (section.source_field) {
    parts.push(firmBlock(section.source_field, data.firmTemplate[section.source_field] || ""))
  }

  parts.push(sectionClose)
  return parts.join("\n")
}

function renderNarrative(
  section: TemplateSectionDef,
  data: ResolverData,
  accent: string
): string {
  const parts: string[] = []
  parts.push(sectionOpen(section.id, section.type, section.title))
  parts.push(h2(section.title, accent))

  if (section.subsections) {
    for (const sub of section.subsections) {
      parts.push(renderSubsection(sub, data, accent))
    }
  } else if (section.ai_section_key) {
    parts.push(aiBlock(section.ai_section_key, data.aiSections[section.ai_section_key as AiSectionKey]))
  }

  parts.push(sectionClose)
  return parts.join("\n")
}

function renderDataField(
  section: TemplateSectionDef,
  data: ResolverData,
  resolved: Record<string, string>
): string {
  const parts: string[] = []

  if (section.fields && section.fields.length > 0) {
    // Render each field as a placeholder chip with its label
    for (const fieldKey of section.fields) {
      const value = resolved[fieldKey]
      if (value) {
        parts.push(`<p>${ph(fieldKey)}: ${value}</p>`)
      } else {
        parts.push(`<p>${ph(fieldKey)}</p>`)
      }
    }
  } else {
    parts.push(`<p><em style="color: #FF3B30">[data_field section "${esc(section.title)}" has no fields configured]</em></p>`)
  }

  return parts.join("\n")
}

function renderComparablesTable(
  section: TemplateSectionDef,
  data: ResolverData,
  accent: string
): string {
  const comps = Array.isArray(data.adoptedComparables) ? data.adoptedComparables : []
  const parts: string[] = []
  parts.push(sectionOpen(section.id, section.type, section.title))
  parts.push(h2(section.title, accent))

  if (comps.length === 0) {
    parts.push(`<p>No comparables adopted.</p>`)
  } else {
    parts.push(`<p>${comps.length} comparable${comps.length !== 1 ? "s" : ""} adopted. Source: HM Land Registry Price Paid Data.</p>`)
    parts.push(`<table style="width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px;">`)
    parts.push(`<thead><tr style="background: #F2F2F7;">
      <th style="padding: 6px 8px; text-align: left;">Address</th>
      <th style="padding: 6px 8px; text-align: left;">Price</th>
      <th style="padding: 6px 8px; text-align: left;">Date</th>
      <th style="padding: 6px 8px; text-align: left;">Type</th>
      <th style="padding: 6px 8px; text-align: left;">Tenure</th>
      <th style="padding: 6px 8px; text-align: right;">Area</th>
      <th style="padding: 6px 8px; text-align: right;">£/sq ft</th>
    </tr></thead>`)
    parts.push(`<tbody>`)

    const maxRows = section.max_rows || 6
    const displayed = comps.slice(0, maxRows)
    for (let i = 0; i < displayed.length; i++) {
      const c = displayed[i]
      const areaSqm = c.floor_area_sqm ? parseFloat(c.floor_area_sqm) : null
      const areaSqft = areaSqm ? Math.round(areaSqm * 10.7639) : null
      const priceSqft = areaSqft && c.price ? Math.round(c.price / areaSqft) : null
      const bg = i % 2 === 1 ? ' style="background: #F9F9FB;"' : ""
      parts.push(`<tr${bg}>
        <td style="padding: 4px 8px;">${c.address || "—"}</td>
        <td style="padding: 4px 8px; font-weight: 600;">${fmtPrice(c.price)}</td>
        <td style="padding: 4px 8px;">${fmtDate(c.transaction_date)}</td>
        <td style="padding: 4px 8px;">${c.property_type || "—"}</td>
        <td style="padding: 4px 8px;">${c.tenure || "—"}</td>
        <td style="padding: 4px 8px; text-align: right;">${areaSqft ? areaSqft + " sq ft" : "—"}</td>
        <td style="padding: 4px 8px; text-align: right; font-weight: 600; color: ${accent};">${priceSqft ? "£" + priceSqft.toLocaleString("en-GB") : "—"}</td>
      </tr>`)
    }

    parts.push(`</tbody></table>`)
  }

  parts.push(sectionClose)
  return parts.join("\n")
}

function renderValuationSummary(
  section: TemplateSectionDef,
  data: ResolverData,
  accent: string,
  resolved: Record<string, string>
): string {
  const parts: string[] = []
  parts.push(sectionOpen(section.id, section.type, section.title))
  parts.push(h2(section.title, accent))

  if (section.subsections) {
    for (const sub of section.subsections) {
      parts.push(renderSubsection(sub, data, accent, resolved))
    }
  }

  // Signature block
  parts.push(`<hr style="margin: 24px 0; border-color: #E5E5EA;" />`)
  parts.push(`<h3>Signed</h3>`)
  parts.push(`<p>Prepared by: ${ph("preparer_name")}</p>`)
  parts.push(`<p>Counter-signatory: ${ph("countersig_name")}</p>`)
  parts.push(`<p>Date: ${ph("report_date")}</p>`)

  parts.push(sectionClose)
  return parts.join("\n")
}

function renderAppendices(
  section: TemplateSectionDef,
  accent: string
): string {
  const parts: string[] = []
  parts.push(sectionOpen(section.id, section.type, section.title))
  parts.push(h2(section.title, accent))

  if (section.subsections) {
    for (const sub of section.subsections) {
      parts.push(h3(sub.title))
      if (sub.type === "image" || sub.type === "image_grid") {
        parts.push(`<p><em style="color: #8E8E93">[${sub.title}] — auto-assembled at export.</em></p>`)
      } else {
        parts.push(`<p><em style="color: #8E8E93">[${sub.title}] — placeholder for future content.</em></p>`)
      }
    }
  } else {
    parts.push(`<p><em style="color: #8E8E93">Appendices auto-assembled at final report export.</em></p>`)
  }

  parts.push(sectionClose)
  return parts.join("\n")
}

/** Render a subsection based on its type */
function renderSubsection(
  sub: TemplateSectionDef,
  data: ResolverData,
  accent: string,
  resolved?: Record<string, string>
): string {
  const parts: string[] = []
  parts.push(h3(sub.title))

  switch (sub.type) {
    case "boilerplate":
      if (sub.source_field) {
        parts.push(firmBlock(sub.source_field, data.firmTemplate[sub.source_field] || ""))
      }
      break

    case "narrative":
      if (sub.ai_section_key) {
        parts.push(aiBlock(sub.ai_section_key, data.aiSections[sub.ai_section_key as AiSectionKey]))
      }
      break

    case "data_field":
      if (resolved && sub.fields) {
        parts.push(renderDataField(sub, data, resolved))
      }
      break

    case "auto":
      // Auto-populated from property data — render tenure, transaction history, etc.
      if (sub.source === "property_data") {
        const tenureText = data.result?.tenure || "Tenure not confirmed."
        const leaseInfo = data.result?.lease_expiry_date ? ` Lease expiry: ${fmtDate(data.result.lease_expiry_date)}.` : ""
        parts.push(`<p>${tenureText}${leaseInfo}</p>`)
      }
      break

    case "placeholder":
      parts.push(`<p><em style="color: #8E8E93">[${sub.title}] — placeholder.</em></p>`)
      break

    case "image":
      parts.push(`<p><em style="color: #8E8E93">[${sub.title}] — auto-assembled at export.</em></p>`)
      break

    case "image_grid":
      parts.push(`<p><em style="color: #8E8E93">[Photo grid] — auto-assembled at export.</em></p>`)
      break

    default:
      parts.push(`<p><em style="color: #8E8E93">[${sub.title}]</em></p>`)
  }

  return parts.join("\n")
}

// ── Main Renderer ────────────────────────────────────────────────────────

/**
 * Build report HTML from a template schema + case data.
 * Produces TipTap-compatible HTML with PlaceholderNode spans and SectionBlock wrappers.
 */
export function buildTemplateFromSchema(
  schema: TemplateSchema,
  data: ResolverData
): string {
  const accent = schema.branding?.accent_color || "#007AFF"
  const resolved = resolvePlaceholders(data)
  const html: string[] = []

  for (const section of schema.sections) {
    switch (section.type) {
      case "cover_page":
        html.push(renderCoverPage(section, data, accent))
        break

      case "boilerplate":
        html.push(renderBoilerplate(section, data, accent))
        break

      case "narrative":
        html.push(renderNarrative(section, data, accent))
        break

      case "comparables_table":
        html.push(renderComparablesTable(section, data, accent))
        break

      case "valuation_summary":
        html.push(renderValuationSummary(section, data, accent, resolved))
        break

      case "appendices":
        html.push(renderAppendices(section, accent))
        break

      default:
        // Unknown section type — render as generic section
        html.push(`${sectionOpen(section.id, section.type, section.title)}`)
        html.push(h2(section.title, accent))
        html.push(`<p><em style="color: #8E8E93">[${section.type}] section — not yet supported.</em></p>`)
        html.push(sectionClose)
    }
  }

  return html.join("\n")
}

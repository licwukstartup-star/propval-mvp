/**
 * Client-side panel merge — mirrors backend panel_service.py exactly.
 *
 * Merges a panel config overlay onto a base template schema.
 * Pure function, no side effects.
 */

import type { PanelConfig, ActiveReminder } from "./types"

interface PanelConfigData {
  extra_sections?: Array<{
    id: string; type: string; title: string; insert_after: string
    ai_section_key?: string; source_field?: string; panel_boilerplate?: string | null
  }>
  hidden_sections?: string[]
  section_order?: string[]
  field_overrides?: Record<string, any>
  inline_reminders?: Array<{ trigger_field: string; condition: string; message: string; severity: "warning" | "info" }>
  boilerplate_overrides?: Record<string, string>
  branding_overrides?: Partial<{ accent_color: string; font_family: string }>
}

interface Section {
  id: string
  type: string
  title: string
  ai_section_key?: string
  source_field?: string
  override_text?: string
  subsections?: Section[]
  [key: string]: any
}

interface SchemaLike {
  sections: Section[]
  branding?: Record<string, any>
  panel_field_overrides?: Record<string, any>
  panel_inline_reminders?: any[]
  [key: string]: any
}

export function mergePanelWithTemplate(
  templateSchema: SchemaLike,
  panelConfig: PanelConfigData | null | undefined,
): SchemaLike {
  if (!panelConfig) return templateSchema

  // Deep clone
  const merged: SchemaLike = JSON.parse(JSON.stringify(templateSchema))
  let sections = merged.sections || []

  // 1. Inject extra_sections
  for (const extra of panelConfig.extra_sections || []) {
    const newSection: Section = {
      id: extra.id,
      type: extra.type || "narrative",
      title: extra.title || "",
    }
    if (extra.ai_section_key) newSection.ai_section_key = extra.ai_section_key
    if (extra.source_field) newSection.source_field = extra.source_field
    if (extra.panel_boilerplate) newSection.override_text = extra.panel_boilerplate

    let inserted = false
    if (extra.insert_after) {
      for (let i = 0; i < sections.length; i++) {
        if (sections[i].id === extra.insert_after) {
          sections.splice(i + 1, 0, newSection)
          inserted = true
          break
        }
        // Check subsections
        for (const sub of sections[i].subsections || []) {
          if (sub.id === extra.insert_after) {
            sections.splice(i + 1, 0, newSection)
            inserted = true
            break
          }
        }
        if (inserted) break
      }
    }
    if (!inserted) sections.push(newSection)
  }

  // 2. Remove hidden_sections
  const hidden = new Set(panelConfig.hidden_sections || [])
  if (hidden.size > 0) {
    sections = sections.filter(s => !hidden.has(s.id))
    for (const s of sections) {
      if (s.subsections) {
        s.subsections = s.subsections.filter(sub => !hidden.has(sub.id))
      }
    }
  }

  // 3. Apply section_order
  const order = panelConfig.section_order || []
  if (order.length > 0) {
    const orderMap = new Map(order.map((id, i) => [id, i]))
    const ordered = sections.filter(s => orderMap.has(s.id)).sort((a, b) => orderMap.get(a.id)! - orderMap.get(b.id)!)
    const remaining = sections.filter(s => !orderMap.has(s.id))
    sections = [...ordered, ...remaining]
  }

  merged.sections = sections

  // 4. Merge branding
  if (panelConfig.branding_overrides && Object.keys(panelConfig.branding_overrides).length > 0) {
    merged.branding = { ...(merged.branding || {}), ...panelConfig.branding_overrides }
  }

  // 5. Apply boilerplate_overrides
  const overrides = panelConfig.boilerplate_overrides || {}
  if (Object.keys(overrides).length > 0) {
    for (const s of merged.sections) {
      if (s.source_field && s.source_field in overrides) {
        s.override_text = overrides[s.source_field]
      }
      for (const sub of s.subsections || []) {
        if (sub.source_field && sub.source_field in overrides) {
          sub.override_text = overrides[sub.source_field]
        }
      }
    }
  }

  // 6. Attach field_overrides
  if (panelConfig.field_overrides) {
    merged.panel_field_overrides = panelConfig.field_overrides
  }

  // 7. Attach inline_reminders
  if (panelConfig.inline_reminders) {
    merged.panel_inline_reminders = panelConfig.inline_reminders
  }

  return merged
}

/**
 * Evaluate panel inline reminders against current report state.
 */
export function evaluateReminders(
  panelConfig: PanelConfigData | null | undefined,
  state: {
    comparables_count: number
    comparables_ranked?: boolean
    fields: Record<string, string | number | boolean>
  },
): ActiveReminder[] {
  if (!panelConfig?.inline_reminders) return []

  const active: ActiveReminder[] = []

  for (const reminder of panelConfig.inline_reminders) {
    const { trigger_field, condition, message, severity } = reminder
    let triggered = false

    if (condition.includes("count <")) {
      const threshold = parseInt(condition.split("<")[1].trim(), 10)
      if (trigger_field === "comparables" && state.comparables_count < threshold) {
        triggered = true
      }
    } else if (condition === "not_ranked") {
      if (!state.comparables_ranked) triggered = true
    } else if (condition === "empty") {
      const val = state.fields[trigger_field]
      if (!val || !String(val).trim()) triggered = true
    } else if (condition.includes("length <")) {
      const threshold = parseInt(condition.split("<")[1].trim(), 10)
      const val = state.fields[trigger_field] || ""
      if (String(val).length < threshold) triggered = true
    }

    if (triggered) {
      active.push({ field: trigger_field, message, severity })
    }
  }

  return active
}

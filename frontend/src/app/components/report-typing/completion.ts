import type { ReportMetadata, ValuerInputs, AiSectionKey, SectionCompletionInfo } from "./types"
import type { FirmTemplate } from "../FirmTemplateSettings"
import { SECTION_DEFS } from "./constants"

export function calculateSectionCompletion(
  sectionId: string,
  meta: ReportMetadata,
  valuer: ValuerInputs,
  aiSections: Partial<Record<AiSectionKey, string>>,
  firmTemplate: FirmTemplate,
  result: any,
): SectionCompletionInfo {
  const section = SECTION_DEFS.find(s => s.id === sectionId)
  if (!section) return { total: 0, filled: 0, percentage: 100, isComplete: true }

  const requiredFields = section.fields.filter(f => f.required)
  if (requiredFields.length === 0) return { total: 0, filled: 0, percentage: 100, isComplete: true }

  let filled = 0
  for (const field of requiredFields) {
    let hasValue = false
    switch (field.source) {
      case "meta":
        hasValue = !!(meta as any)[field.key]
        break
      case "valuer": {
        const v = (valuer as any)[field.key]
        hasValue = v !== "" && v !== undefined && v !== null
        break
      }
      case "ai":
        hasValue = !!(aiSections as any)[field.key]
        break
      case "auto":
        hasValue = !!(result as any)?.[field.key]
        break
      case "firm":
        hasValue = !!(firmTemplate as any)[field.key]
        break
    }
    if (hasValue) filled++
  }

  return {
    total: requiredFields.length,
    filled,
    percentage: Math.round((filled / requiredFields.length) * 100),
    isComplete: filled === requiredFields.length,
  }
}

export function calculateAllCompletions(
  meta: ReportMetadata,
  valuer: ValuerInputs,
  aiSections: Partial<Record<AiSectionKey, string>>,
  firmTemplate: FirmTemplate,
  result: any,
): { sections: Record<string, SectionCompletionInfo>; overall: number } {
  const sections: Record<string, SectionCompletionInfo> = {}
  let totalFields = 0
  let totalFilled = 0

  for (const def of SECTION_DEFS) {
    const info = calculateSectionCompletion(def.id, meta, valuer, aiSections, firmTemplate, result)
    sections[def.id] = info
    totalFields += info.total
    totalFilled += info.filled
  }

  return {
    sections,
    overall: totalFields > 0 ? Math.round((totalFilled / totalFields) * 100) : 100,
  }
}

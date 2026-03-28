import type { FirmTemplate } from "../../FirmTemplateSettings"

interface FirmTextProps {
  fieldKey: string
  fallback: string
  firmTemplate: FirmTemplate
  onOpenSettings: () => void
  /** Optional token replacements, e.g. { purpose_of_valuation: "Secured Lending" } */
  replacements?: Record<string, string>
}

export default function FirmText({ fieldKey, fallback, firmTemplate, onOpenSettings, replacements }: FirmTextProps) {
  let text = firmTemplate[fieldKey]
  if (text) {
    if (replacements) {
      for (const [token, value] of Object.entries(replacements)) {
        text = text.replaceAll(`{${token}}`, value || `[${token}]`)
      }
    }
    return <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-primary)" }}>{text}</p>
  }
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs italic" style={{ color: "var(--color-text-secondary)" }}>{fallback}</p>
      <button onClick={onOpenSettings}
        className="text-xs px-1.5 py-0.5 rounded border border-[var(--color-accent-purple)]/30 text-[var(--color-accent-purple-text)] hover:bg-[var(--color-accent-purple)]/10 transition-colors">
        Set up
      </button>
    </div>
  )
}

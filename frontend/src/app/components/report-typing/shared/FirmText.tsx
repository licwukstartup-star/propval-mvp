import type { FirmTemplate } from "../../FirmTemplateSettings"

interface FirmTextProps {
  fieldKey: string
  fallback: string
  firmTemplate: FirmTemplate
  onOpenSettings: () => void
}

export default function FirmText({ fieldKey, fallback, firmTemplate, onOpenSettings }: FirmTextProps) {
  const text = firmTemplate[fieldKey]
  if (text) {
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

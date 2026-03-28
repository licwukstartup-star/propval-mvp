"use client"

/**
 * PanelSwitcher — compact dropdown for switching panel themes.
 *
 * Renders as a pill badge in the report typing header. Switching panels
 * is instant — like switching light/dark mode. Same data, different
 * presentation and requirements.
 */

import type { PanelConfig } from "../types"

interface PanelSwitcherProps {
  activePanel: PanelConfig | null
  availablePanels: PanelConfig[]
  onPanelChange: (slug: string | null) => void
}

export default function PanelSwitcher({ activePanel, availablePanels, onPanelChange }: PanelSwitcherProps) {
  if (availablePanels.length === 0) return null

  return (
    <select
      value={activePanel?.slug || ""}
      onChange={e => onPanelChange(e.target.value || null)}
      className="text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer focus:outline-none transition-colors"
      style={{
        backgroundColor: activePanel
          ? "color-mix(in srgb, var(--color-status-warning) 10%, transparent)"
          : "var(--color-bg-surface)",
        borderColor: activePanel
          ? "color-mix(in srgb, var(--color-status-warning) 40%, transparent)"
          : "var(--color-border)",
        color: activePanel
          ? "var(--color-status-warning)"
          : "var(--color-text-primary)",
        fontWeight: activePanel ? 600 : 400,
      }}
      title="Select panel theme"
    >
      <option value="">No Panel</option>
      {availablePanels.map(p => (
        <option key={p.slug} value={p.slug}>{p.name}</option>
      ))}
    </select>
  )
}

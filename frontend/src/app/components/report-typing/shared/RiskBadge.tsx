export default function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>—</span>
  const r = risk.toLowerCase()
  const color = r.includes("high") ? "var(--color-status-danger)" : r.includes("medium") ? "var(--color-status-warning)" : r.includes("low") ? "var(--color-status-success)" : "var(--color-text-secondary)"
  return <span className="text-sm font-semibold" style={{ color }}>{risk}</span>
}

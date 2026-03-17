export default function AutoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs shrink-0" style={{ color: "var(--color-text-secondary)" }}>{label}:</span>
      <span className="text-sm" style={{ color: value ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>{value || "—"}</span>
    </div>
  )
}

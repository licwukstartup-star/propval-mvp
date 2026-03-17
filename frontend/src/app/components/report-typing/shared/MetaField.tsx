export default function MetaField({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: "text" | "date"
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs shrink-0 w-32" style={{ color: "var(--color-text-secondary)" }}>{label}:</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${type === "date" ? "w-40" : "flex-1"} text-sm px-2.5 py-1.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none transition-colors`}
        placeholder={type === "date" ? "" : `Enter ${label.toLowerCase()}`}
      />
    </div>
  )
}

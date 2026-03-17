export default function CurrencyField({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs shrink-0 w-32" style={{ color: "var(--color-text-secondary)" }}>{label}:</span>
      <div className="flex items-center flex-1 gap-1">
        <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>£</span>
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 text-sm px-2.5 py-1.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none transition-colors"
          placeholder="0" />
        {suffix && <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{suffix}</span>}
      </div>
    </div>
  )
}

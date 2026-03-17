export default function TickField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bg-surface)] accent-[var(--color-accent)]" />
      <span className="text-sm group-hover:text-[var(--color-text-primary)] transition-colors" style={{ color: "var(--color-text-secondary)" }}>{label}</span>
    </label>
  )
}

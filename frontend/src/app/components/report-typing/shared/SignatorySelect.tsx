"use client"

import { useState } from "react"

export interface Signatory {
  id: string
  full_name: string
  rics_number: string
  qualifications: string
  role_title: string
  email: string
  phone: string
  can_prepare: boolean
  can_countersign: boolean
}

interface SignatorySelectProps {
  label: string
  signatories: Signatory[]
  filter: "prepare" | "countersign"
  value: string
  onChange: (name: string, qualifications: string) => void
  onOpenRegistry?: () => void
}

export default function SignatorySelect({ label, signatories, filter, value, onChange, onOpenRegistry }: SignatorySelectProps) {
  const [manual, setManual] = useState(false)
  const filtered = signatories.filter(s => filter === "prepare" ? s.can_prepare : s.can_countersign)
  const matched = filtered.find(s => s.full_name === value)

  if (manual) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs shrink-0 w-32" style={{ color: "var(--color-text-secondary)" }}>{label}:</span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value, "")}
          className="flex-1 text-sm px-2.5 py-1.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none transition-colors"
          placeholder={`Enter ${label.toLowerCase()} name`}
        />
        <button onClick={() => setManual(false)} className="text-[10px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
          List
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs shrink-0 w-32" style={{ color: "var(--color-text-secondary)" }}>{label}:</span>
      <select
        value={matched ? value : value ? "__manual__" : ""}
        onChange={e => {
          const v = e.target.value
          if (v === "__manual__") { setManual(true); return }
          if (v === "__registry__") { onOpenRegistry?.(); return }
          const sig = filtered.find(s => s.full_name === v)
          onChange(v, sig?.qualifications ?? "")
        }}
        className="flex-1 text-sm px-2.5 py-1.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none transition-colors cursor-pointer"
      >
        <option value="">— Select {label.toLowerCase()} —</option>
        {filtered.map(s => (
          <option key={s.id} value={s.full_name}>
            {s.full_name}{s.qualifications ? ` (${s.qualifications})` : ""}{s.role_title ? ` — ${s.role_title}` : ""}
          </option>
        ))}
        <option value="__manual__">Other — type manually</option>
        {onOpenRegistry && <option value="__registry__">Manage staff registry…</option>}
      </select>
      {matched && matched.qualifications && (
        <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-secondary)" }}>{matched.qualifications}</span>
      )}
    </div>
  )
}

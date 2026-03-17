"use client"

import { useState } from "react"
import CatBadge from "./CatBadge"
import type { SectionCompletionInfo } from "../types"

interface SectionProps {
  id: string
  title: string
  cats: string[]
  defaultOpen?: boolean
  completion?: SectionCompletionInfo
  children: React.ReactNode
}

function CompletionRing({ percentage }: { percentage: number }) {
  const r = 8
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percentage / 100) * circumference
  const color = percentage === 100 ? "var(--color-status-success)" : percentage > 50 ? "var(--color-status-warning)" : "var(--color-accent-pink)"
  return (
    <svg width="22" height="22" className="shrink-0">
      <circle cx="11" cy="11" r={r} fill="none" stroke="var(--color-bg-surface)" strokeWidth="2.5" />
      <circle cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 11 11)" className="transition-all duration-500" />
      {percentage === 100 && (
        <path d="M7.5 11l2.5 2.5 4.5-4.5" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

export default function Section({ id, title, cats, defaultOpen, completion, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-bg-surface)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--color-bg-surface)]/50"
        style={{ backgroundColor: open ? "var(--color-bg-base)" : "var(--color-bg-panel)" }}
      >
        <span className="text-xs transition-transform" style={{ color: "var(--color-text-secondary)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
        {completion && <CompletionRing percentage={completion.percentage} />}
        <span className="text-sm font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--color-text-primary)" }}>{title}</span>
        <div className="flex gap-1.5">
          {cats.map(c => <CatBadge key={c} cat={c} />)}
        </div>
      </button>
      {open && (
        <div className="px-5 py-5 space-y-4" style={{ backgroundColor: "var(--color-bg-base)", borderTop: "1px solid var(--color-bg-surface)" }}>
          {children}
        </div>
      )}
    </div>
  )
}

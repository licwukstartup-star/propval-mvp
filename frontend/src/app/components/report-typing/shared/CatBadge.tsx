import { CAT_COLORS } from "../constants"

export default function CatBadge({ cat }: { cat: string }) {
  const c = CAT_COLORS[cat] ?? CAT_COLORS.F
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {cat} — {c.label}
    </span>
  )
}

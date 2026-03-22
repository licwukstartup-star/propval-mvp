import { CAT_COLORS } from "../constants"

export default function CatBadge({ cat, onClick }: { cat: string; onClick?: () => void }) {
  const c = CAT_COLORS[cat] ?? CAT_COLORS.F
  const cls = "text-[11px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold" +
    (onClick ? " cursor-pointer hover:brightness-110 transition-all" : "")
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}
      style={{ backgroundColor: c.bg, color: c.text }}>
      {cat} — {c.label}
    </button>
  ) : (
    <span className={cls} style={{ backgroundColor: c.bg, color: c.text }}>
      {cat} — {c.label}
    </span>
  )
}

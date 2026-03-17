import CatBadge from "./CatBadge"

export default function Sub({ num, title, cats, children }: {
  num: string; title: string; cats?: string[]; children: React.ReactNode
}) {
  return (
    <div className="rounded-md p-4" style={{ backgroundColor: "var(--color-bg-panel)", border: "1px solid var(--color-bg-surface)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-mono" style={{ color: "var(--color-accent)" }}>{num}</span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>{title}</span>
        {cats && <div className="flex gap-1 ml-auto">{cats.map(c => <CatBadge key={c} cat={c} />)}</div>}
      </div>
      {children}
    </div>
  )
}

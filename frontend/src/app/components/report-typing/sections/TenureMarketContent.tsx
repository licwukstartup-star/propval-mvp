import { useCallback } from "react"
import type { ReportTypingState } from "../types"
import { SUB_TO_FIRM_FIELD } from "../constants"
import AutoField from "../shared/AutoField"
import AiBlock from "../shared/AiBlock"
import Placeholder from "../shared/Placeholder"
import Sub from "../shared/Sub"

export default function TenureMarketContent({ state }: { state: ReportTypingState }) {
  const { result: r, adoptedComparables, aiSections, aiLoading, aiEditing, generateAiSection, saveAiEdit, setAiEditing, openFirmSettingsAt, setShowFirmSettings } = state
  const handleCatClick = useCallback((cat: string, subNum: string) => {
    if (cat === "A") {
      const fieldKey = SUB_TO_FIRM_FIELD[subNum]
      if (fieldKey) openFirmSettingsAt(fieldKey)
      else setShowFirmSettings(true)
    }
  }, [openFirmSettingsAt, setShowFirmSettings])
  return (
    <>
      <Sub num="3.1" title="Tenure" cats={["C", "E"]}>
        <AutoField label="Tenure" value={r.tenure} />
        {r.tenure?.toLowerCase().includes("leasehold") && (
          <div className="mt-1 space-y-0.5">
            <AutoField label="Lease Commencement" value={r.lease_commencement} />
            <AutoField label="Lease Term" value={r.lease_term_years ? `${r.lease_term_years} years` : null} />
            <AutoField label="Lease Expiry" value={r.lease_expiry_date} />
          </div>
        )}
      </Sub>

      <Sub num="3.2" title="Tenancies" cats={["E"]}>
        <Placeholder text="Occupancy status dropdown + tenancy agreement upload (future)" />
      </Sub>

      <Sub num="3.3" title="General Market Comments" cats={["A", "D"]} onCatClick={c => handleCatClick(c, "3.3")}>
        <AiBlock sectionKey="market_commentary" label="AI Local Market Commentary"
          text={aiSections.market_commentary} loading={aiLoading.market_commentary} editing={aiEditing.market_commentary}
          onGenerate={generateAiSection} onSaveEdit={saveAiEdit} onSetEditing={setAiEditing} />
      </Sub>

      <Sub num="3.4" title="Transaction History" cats={["C"]}>
        {r.sales?.length > 0 ? (
          <div className="space-y-1">
            {r.sales.slice(0, 8).map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span style={{ color: "var(--color-text-secondary)" }}>{s.date}</span>
                <span style={{ color: "var(--color-text-primary)" }}>£{typeof s.price === "number" ? s.price.toLocaleString() : s.price}</span>
              </div>
            ))}
          </div>
        ) : (
          <Placeholder text="No transaction history found for this property" />
        )}
      </Sub>

      <Sub num="3.5" title="Comparable Evidence" cats={["E"]}>
        {adoptedComparables.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
              {adoptedComparables.length} comparable{adoptedComparables.length !== 1 ? "s" : ""} adopted
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-surface)" }}>
                    <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>Address</th>
                    <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>Price</th>
                    <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>Date</th>
                    <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>Type</th>
                    <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>Tenure</th>
                    <th className="text-right px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>Area</th>
                    <th className="text-right px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-secondary)" }}>£/sq ft</th>
                  </tr>
                </thead>
                <tbody>
                  {adoptedComparables.map((c: any, i: number) => {
                    const areaSqm = c.floor_area_sqm ? parseFloat(c.floor_area_sqm) : null
                    const areaSqft = areaSqm ? Math.round(areaSqm * 10.7639) : null
                    const priceSqft = areaSqft && c.price ? Math.round(c.price / areaSqft) : null
                    return (
                      <tr key={c.transaction_id || i} style={{ background: i % 2 === 1 ? "var(--color-bg-surface)" : "transparent", borderBottom: "1px solid var(--color-bg-surface)" }}>
                        <td className="px-2 py-1.5" style={{ color: "var(--color-text-primary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.address}</td>
                        <td className="px-2 py-1.5 font-medium" style={{ color: "var(--color-text-primary)" }}>£{typeof c.price === "number" ? c.price.toLocaleString() : c.price}</td>
                        <td className="px-2 py-1.5" style={{ color: "var(--color-text-secondary)" }}>{c.transaction_date ? new Date(c.transaction_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—"}</td>
                        <td className="px-2 py-1.5" style={{ color: "var(--color-text-secondary)" }}>{c.property_type || "—"}</td>
                        <td className="px-2 py-1.5" style={{ color: "var(--color-text-secondary)" }}>{c.tenure || "—"}</td>
                        <td className="px-2 py-1.5 text-right" style={{ color: "var(--color-text-secondary)" }}>{areaSqft ? `${areaSqft} sq ft` : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-medium" style={{ color: priceSqft ? "var(--color-accent)" : "var(--color-text-secondary)" }}>{priceSqft ? `£${priceSqft.toLocaleString()}` : "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <Placeholder text="No comparables adopted yet — use the comparable tabs to select evidence" />
        )}
      </Sub>

      <Sub num="3.6" title="Valuation Considerations" cats={["D"]}>
        <AiBlock sectionKey="valuation_considerations" label="AI Valuation Considerations"
          text={aiSections.valuation_considerations} loading={aiLoading.valuation_considerations} editing={aiEditing.valuation_considerations}
          onGenerate={generateAiSection} onSaveEdit={saveAiEdit} onSetEditing={setAiEditing} />
      </Sub>
    </>
  )
}

import type { ReportTypingState } from "../types"
import AutoField from "../shared/AutoField"
import AiBlock from "../shared/AiBlock"
import Placeholder from "../shared/Placeholder"
import Sub from "../shared/Sub"

export default function TenureMarketContent({ state }: { state: ReportTypingState }) {
  const { result: r, adoptedComparables, aiSections, aiLoading, aiEditing, generateAiSection, saveAiEdit, setAiEditing } = state
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

      <Sub num="3.3" title="General Market Comments" cats={["A", "D"]}>
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
          <p className="text-sm" style={{ color: "var(--color-status-success)" }}>{adoptedComparables.length} comparable(s) adopted — displayed from Adopted Comparables tab</p>
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

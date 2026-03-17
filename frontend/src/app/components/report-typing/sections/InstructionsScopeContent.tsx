import type { ReportTypingState } from "../types"
import AutoField from "../shared/AutoField"
import MetaField from "../shared/MetaField"
import TickField from "../shared/TickField"
import FirmText from "../shared/FirmText"
import Sub from "../shared/Sub"

export default function InstructionsScopeContent({ state }: { state: ReportTypingState }) {
  const { meta, updateMeta, valuer, updateValuer, firmTemplate, setShowFirmSettings } = state
  const openSettings = () => setShowFirmSettings(true)
  return (
    <>
      <Sub num="1.1" title="Instructions" cats={["A", "B"]}>
        <FirmText fieldKey="instructions" fallback="No instructions boilerplate set — configure in Firm Template settings" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
        <div className="mt-2">
          <MetaField label="Instruction Date" value={meta.instruction_date} onChange={v => updateMeta("instruction_date", v)} type="date" />
        </div>
      </Sub>
      <Sub num="1.2" title="Client" cats={["A", "B"]}>
        <AutoField label="Client" value={meta.client_name || "—"} />
        <AutoField label="Applicant" value={meta.applicant_name || "—"} />
      </Sub>
      <Sub num="1.3" title="Purpose of Valuation" cats={["A", "B"]}>
        <FirmText fieldKey="purpose" fallback="No purpose of valuation boilerplate set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
      </Sub>
      <Sub num="1.4–1.6" title="Dates & Standards" cats={["A", "B"]}>
        <div>
          <AutoField label="Valuation Date" value={meta.valuation_date ? new Date(meta.valuation_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"} />
          {!meta.valuation_date && (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-accent-pink)" }}>Set in Direct Comparables tab before searching</p>
          )}
        </div>
        <MetaField label="Inspection Date" value={meta.inspection_date} onChange={v => updateMeta("inspection_date", v)} type="date" />
        <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>Standards: RICS Red Book Global &amp; UK National Supplement</p>
      </Sub>
      <Sub num="1.7" title="Basis of Valuation" cats={["A", "E"]}>
        <div className="space-y-1.5">
          <TickField label="Market Value (MV)" checked={valuer.basis_market_value} onChange={v => updateValuer("basis_market_value", v)} />
          <TickField label="Market Rent (MR)" checked={valuer.basis_market_rent} onChange={v => updateValuer("basis_market_rent", v)} />
          <TickField label="MV — 90-day restricted realisation" checked={valuer.basis_mv_90day} onChange={v => updateValuer("basis_mv_90day", v)} />
          <TickField label="MV — 180-day restricted realisation" checked={valuer.basis_mv_180day} onChange={v => updateValuer("basis_mv_180day", v)} />
          <TickField label="Building Insurance Reinstatement Cost (BIRC)" checked={valuer.basis_birc} onChange={v => updateValuer("basis_birc", v)} />
        </div>
      </Sub>
      <Sub num="1.8" title="Conflict of Interest" cats={["A", "E"]}>
        <TickField label="Conflict of interest declared" checked={valuer.conflict_of_interest} onChange={v => updateValuer("conflict_of_interest", v)} />
        {valuer.conflict_of_interest && (
          <div className="mt-1.5">
            <MetaField label="Details" value={valuer.conflict_notes} onChange={v => updateValuer("conflict_notes", v)} />
          </div>
        )}
        {!valuer.conflict_of_interest && (
          <p className="text-xs mt-1" style={{ color: "var(--color-status-success)" }}>No conflict of interest. Standard declaration applies.</p>
        )}
      </Sub>
      <Sub num="1.9–1.11" title="Responsibility, Disclosure, PI Insurance" cats={["A"]}>
        <div className="space-y-2">
          <FirmText fieldKey="responsibility" fallback="No responsibility statement set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
          <FirmText fieldKey="disclosure" fallback="No disclosure statement set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
          <FirmText fieldKey="pi_insurance" fallback="No PI insurance details set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
        </div>
      </Sub>
      <Sub num="1.12" title="Expertise" cats={["A", "B"]}>
        <AutoField label="Preparer" value={meta.preparer_name || "—"} />
        <FirmText fieldKey="expertise" fallback="No expertise statement set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
      </Sub>
      <Sub num="1.13" title="Inspection" cats={["A", "B"]}>
        <AutoField label="Inspection Date" value={meta.inspection_date || "—"} />
        <FirmText fieldKey="inspection" fallback="No inspection boilerplate set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
      </Sub>
      <Sub num="1.14" title="Special Assumptions" cats={["E"]}>
        <div className="space-y-1.5">
          <TickField label="No deleterious or hazardous materials" checked={valuer.assumption_no_deleterious} onChange={v => updateValuer("assumption_no_deleterious", v)} />
          <TickField label="No contamination" checked={valuer.assumption_no_contamination} onChange={v => updateValuer("assumption_no_contamination", v)} />
          <TickField label="Good and marketable title" checked={valuer.assumption_good_title} onChange={v => updateValuer("assumption_good_title", v)} />
          <TickField label="Statutory compliance" checked={valuer.assumption_statutory_compliance} onChange={v => updateValuer("assumption_statutory_compliance", v)} />
          <TickField label="No encroachments" checked={valuer.assumption_no_encroachment} onChange={v => updateValuer("assumption_no_encroachment", v)} />
        </div>
        <div className="mt-2">
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Bespoke assumptions:</span>
          <textarea value={valuer.assumption_bespoke} onChange={e => updateValuer("assumption_bespoke", e.target.value)}
            rows={2} placeholder="Enter any additional special assumptions…"
            className="w-full mt-1 text-sm px-2.5 py-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none resize-y" />
        </div>
      </Sub>
    </>
  )
}

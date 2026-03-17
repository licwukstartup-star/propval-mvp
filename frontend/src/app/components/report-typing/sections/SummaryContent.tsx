import type { ReportTypingState } from "../types"
import AutoField from "../shared/AutoField"
import MetaField from "../shared/MetaField"
import Sub from "../shared/Sub"

export default function SummaryContent({ state }: { state: ReportTypingState }) {
  const { meta, updateMeta, result: r } = state
  return (
    <>
      <AutoField label="Property Address" value={r.address} />
      <AutoField label="Property Type" value={r.property_type} />
      <Sub num="" title="Applicant & Bank Reference" cats={["B"]}>
        <MetaField label="Applicant" value={meta.applicant_name} onChange={v => updateMeta("applicant_name", v)} />
        <MetaField label="Bank Ref" value={meta.bank_reference} onChange={v => updateMeta("bank_reference", v)} />
      </Sub>
      <Sub num="" title="Signatories" cats={["B"]}>
        <MetaField label="Preparer" value={meta.preparer_name} onChange={v => updateMeta("preparer_name", v)} />
        <MetaField label="Counter-signatory" value={meta.counter_signatory} onChange={v => updateMeta("counter_signatory", v)} />
      </Sub>
    </>
  )
}

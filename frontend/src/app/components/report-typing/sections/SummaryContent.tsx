import type { ReportTypingState } from "../types"
import AutoField from "../shared/AutoField"
import MetaField from "../shared/MetaField"
import SignatorySelect from "../shared/SignatorySelect"
import Sub from "../shared/Sub"

export default function SummaryContent({ state }: { state: ReportTypingState }) {
  const { meta, updateMeta, result: r, signatories, setShowSignatorySettings } = state
  return (
    <>
      <AutoField label="Property Address" value={r.address} />
      <AutoField label="Property Type" value={r.property_type} />
      <Sub num="" title="Applicant & Bank Reference" cats={["B"]}>
        <MetaField label="Applicant" value={meta.applicant_name} onChange={v => updateMeta("applicant_name", v)} />
        <MetaField label="Bank Ref" value={meta.bank_reference} onChange={v => updateMeta("bank_reference", v)} />
      </Sub>
      <Sub num="" title="Signatories" cats={["B"]}>
        <SignatorySelect
          label="Preparer"
          signatories={signatories}
          filter="prepare"
          value={meta.preparer_name}
          onChange={(name, quals) => { updateMeta("preparer_name", name); updateMeta("preparer_qualifications", quals) }}
          onOpenRegistry={() => setShowSignatorySettings(true)}
        />
        <SignatorySelect
          label="Counter-sign"
          signatories={signatories}
          filter="countersign"
          value={meta.counter_signatory}
          onChange={(name, quals) => { updateMeta("counter_signatory", name); updateMeta("counter_signatory_qualifications", quals) }}
          onOpenRegistry={() => setShowSignatorySettings(true)}
        />
      </Sub>
    </>
  )
}

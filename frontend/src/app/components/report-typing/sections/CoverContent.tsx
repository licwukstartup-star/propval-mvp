import type { ReportTypingState } from "../types"
import AutoField from "../shared/AutoField"
import MetaField from "../shared/MetaField"
import Sub from "../shared/Sub"

export default function CoverContent({ state }: { state: ReportTypingState }) {
  const { meta, updateMeta, firmTemplate, result: r } = state
  return (
    <>
      {firmTemplate.firm_name && <AutoField label="Firm" value={firmTemplate.firm_name} />}
      <AutoField label="Property Address" value={r.address} />
      <AutoField label="Postcode" value={r.postcode} />
      <Sub num="" title="Report Reference" cats={["B"]}>
        <MetaField label="Report Ref" value={meta.report_reference} onChange={v => updateMeta("report_reference", v)} />
      </Sub>
      <Sub num="" title="Date of Report" cats={["B"]}>
        <MetaField label="Report Date" value={meta.report_date} onChange={v => updateMeta("report_date", v)} type="date" />
      </Sub>
      <Sub num="" title="Client" cats={["B"]}>
        <MetaField label="Client Name" value={meta.client_name} onChange={v => updateMeta("client_name", v)} />
      </Sub>
    </>
  )
}

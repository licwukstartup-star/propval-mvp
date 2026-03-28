import { useMemo } from "react"
import type { ReportTypingState } from "../types"
import AutoField from "../shared/AutoField"
import MetaField from "../shared/MetaField"
import Sub from "../shared/Sub"

const DEFAULT_PURPOSE_OPTIONS = [
  "Secured Lending",
  "Help to Buy",
  "Right to Buy",
  "Shared Ownership",
  "Shared Equity",
  "Equity Release",
  "Capital Gains Tax (CGT)",
  "Probate / Inheritance Tax",
  "Matrimonial / Divorce",
  "Insurance Reinstatement",
  "Litigation",
  "Accounting / Financial Reporting",
  "Company Accounts",
  "Tax Planning",
  "Portfolio Valuation",
  "Transfer / Acquisition",
  "Lease Extension / Enfranchisement",
  "Private / Market Appraisal",
  "Development Appraisal",
]

export default function CoverContent({ state }: { state: ReportTypingState }) {
  const { meta, updateMeta, firmTemplate, result: r } = state

  const purposeOptions = useMemo(() => {
    if (firmTemplate.purpose_options) {
      try {
        const parsed = JSON.parse(firmTemplate.purpose_options)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[]
      } catch { /* fall through to defaults */ }
    }
    return DEFAULT_PURPOSE_OPTIONS
  }, [firmTemplate.purpose_options])

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
      <Sub num="" title="Purpose of Valuation" cats={["B"]}>
        <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--color-text-secondary)" }}>
          Purpose
        </label>
        <select
          value={meta.purpose_of_valuation}
          onChange={e => updateMeta("purpose_of_valuation", e.target.value)}
          className="w-full text-sm px-2.5 py-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%2399999a' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 10px center",
            paddingRight: "32px",
          }}
        >
          <option value="">— Select purpose —</option>
          {purposeOptions.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </Sub>
    </>
  )
}

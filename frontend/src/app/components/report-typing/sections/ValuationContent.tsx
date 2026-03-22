import { useCallback } from "react"
import type { ReportTypingState } from "../types"
import { SUB_TO_FIRM_FIELD } from "../constants"
import AutoField from "../shared/AutoField"
import MetaField from "../shared/MetaField"
import CurrencyField from "../shared/CurrencyField"
import FirmText from "../shared/FirmText"
import Sub from "../shared/Sub"

export default function ValuationContent({ state }: { state: ReportTypingState }) {
  const { meta, result: r, valuer, updateValuer, updateValuerBatch, numberToWords, firmTemplate, setShowFirmSettings, openFirmSettingsAt } = state
  const openSettings = () => setShowFirmSettings(true)
  const handleCatClick = useCallback((cat: string, subNum: string) => {
    if (cat === "A") {
      const fieldKey = SUB_TO_FIRM_FIELD[subNum]
      if (fieldKey) openFirmSettingsAt(fieldKey)
      else setShowFirmSettings(true)
    }
  }, [openFirmSettingsAt, setShowFirmSettings])
  return (
    <>
      <Sub num="4.1" title="Methodology" cats={["A"]} onCatClick={c => handleCatClick(c, "4.1")}>
        <FirmText fieldKey="methodology" fallback="No methodology statement set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
      </Sub>
      <Sub num="4.2" title="Market Rent" cats={["E"]}>
        {valuer.basis_market_rent ? (
          <div className="space-y-2">
            <CurrencyField label="Per Annum" value={valuer.market_rent_frequency === "pa" ? valuer.market_rent : (() => { const v = parseFloat(valuer.market_rent.replace(/,/g, "")); return isNaN(v) || v === 0 ? "" : String(Math.round(v * 12)) })()} onChange={v => {
              updateValuerBatch({ market_rent: v, market_rent_frequency: "pa" })
            }} suffix="pa" />
            <CurrencyField label="Per Month" value={valuer.market_rent_frequency === "pcm" ? valuer.market_rent : (() => { const v = parseFloat(valuer.market_rent.replace(/,/g, "")); return isNaN(v) || v === 0 ? "" : String(Math.round(v / 12)) })()} onChange={v => {
              updateValuerBatch({ market_rent: v, market_rent_frequency: "pcm" })
            }} suffix="pcm" />
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Market Rent not selected in Basis of Valuation (1.7)</p>
        )}
      </Sub>
      <Sub num="4.3" title="Market Value" cats={["E"]}>
        <CurrencyField label="Market Value" value={valuer.market_value} onChange={v => updateValuer("market_value", v)} />
        {valuer.market_value && parseFloat(valuer.market_value.replace(/,/g, "")) > 0 && (
          <p className="text-xs mt-1 italic" style={{ color: "var(--color-status-info)" }}>
            ({numberToWords(parseFloat(valuer.market_value.replace(/,/g, "")))} pounds)
          </p>
        )}
      </Sub>
      <Sub num="4.4" title="Suitable Security" cats={["E"]}>
        <div className="flex items-center gap-3">
          {([true, false] as const).map(v => (
            <button key={String(v)} onClick={() => updateValuer("suitable_security", v)}
              className={`text-xs px-3 py-0.5 rounded-full border transition-colors ${
                valuer.suitable_security === v
                  ? v ? "border-[var(--color-status-success)]/50 bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]" : "border-[var(--color-status-danger)]/50 bg-[var(--color-status-danger)]/15 text-[var(--color-status-danger)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
              }`}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
        <p className="text-xs mt-1" style={{ color: valuer.suitable_security ? "var(--color-status-success)" : "var(--color-status-danger)" }}>
          {valuer.suitable_security
            ? "In our opinion, the property provides suitable security for mortgage purposes."
            : "In our opinion, the property does not provide suitable security for mortgage purposes."}
        </p>
      </Sub>
      <Sub num="4.5" title="Reinstatement Costs (BIRC)" cats={["E"]}>
        <AutoField label="GIA" value={valuer.gia_sqm ? `${valuer.gia_sqm} sqm` : (r.floor_area_m2 ? `${r.floor_area_m2} sqm (EPC)` : null)} />
        <CurrencyField label="Rebuild Rate" value={valuer.birc_rate_psm} onChange={v => {
          const area = parseFloat(valuer.gia_sqm || String(r.floor_area_m2) || "0")
          const rate = parseFloat(v.replace(/,/g, "") || "0")
          const total = (area > 0 && rate > 0) ? String(Math.round(area * rate)) : (!v ? "" : valuer.birc_value)
          updateValuerBatch({ birc_rate_psm: v, birc_value: total })
        }} suffix="/sqm" />
        <CurrencyField label="BIRC Total" value={valuer.birc_value} onChange={v => {
          const area = parseFloat(valuer.gia_sqm || String(r.floor_area_m2) || "0")
          const total = parseFloat(v.replace(/,/g, "") || "0")
          const rate = (area > 0 && total > 0) ? String(Math.round(total / area)) : (!v ? "" : valuer.birc_rate_psm)
          updateValuerBatch({ birc_value: v, birc_rate_psm: rate })
        }} />
      </Sub>
      <Sub num="4.6" title="General Comments" cats={["A"]} onCatClick={c => handleCatClick(c, "4.6")}>
        <FirmText fieldKey="general_comments" fallback="No general comments boilerplate set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
      </Sub>
      <Sub num="4.7" title="Report Signatures" cats={["B", "F"]}>
        <AutoField label="Preparer" value={meta.preparer_name || "—"} />
        <AutoField label="Counter-signatory" value={meta.counter_signatory || "—"} />
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Signatures and qualifications auto-assembled at export.</p>
      </Sub>
    </>
  )
}

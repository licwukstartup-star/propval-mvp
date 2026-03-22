import { useCallback } from "react"
import type { ReportTypingState } from "../types"
import { SUB_TO_FIRM_FIELD } from "../constants"
import AutoField from "../shared/AutoField"
import TickField from "../shared/TickField"
import RiskBadge from "../shared/RiskBadge"
import AiBlock from "../shared/AiBlock"
import FirmText from "../shared/FirmText"
import Placeholder from "../shared/Placeholder"
import Sub from "../shared/Sub"

export default function PropertyContent({ state, page = 1 }: { state: ReportTypingState; page?: 1 | 2 }) {
  const { result: r, valuer, updateValuer, aiSections, aiLoading, aiEditing, generateAiSection, saveAiEdit, setAiEditing, firmTemplate, setShowFirmSettings, openFirmSettingsAt } = state
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
      {page === 1 && (
        <>
          <Sub num="2.1" title="Site — Title Number" cats={["C"]}>
            <Placeholder text="Land Registry title number — auto from API (future)" />
          </Sub>

          <Sub num="2.2" title="Location Description" cats={["C", "D"]}>
            <div className="space-y-1.5">
              <AutoField label="Local Authority" value={r.admin_district} />
              <AutoField label="Region" value={r.region} />
              <AutoField label="LSOA" value={r.lsoa} />
              <AutoField label="Coordinates" value={r.lat != null ? `${r.lat.toFixed(5)}, ${r.lon?.toFixed(5)}` : null} />
            </div>
            <AiBlock sectionKey="location_description" label="AI Location Description"
              text={aiSections.location_description} loading={aiLoading.location_description} editing={aiEditing.location_description}
              onGenerate={generateAiSection} onSaveEdit={saveAiEdit} onSetEditing={setAiEditing} />
          </Sub>

          <Sub num="2.3" title="Property Description" cats={["D", "E"]}>
            <div className="space-y-1.5">
              <AutoField label="Property Type" value={r.property_type} />
              <AutoField label="Built Form" value={r.built_form} />
              <AutoField label="Construction Era" value={r.construction_age_band} />
              <AutoField label="Heating" value={r.heating_type} />
            </div>
            <AiBlock sectionKey="subject_development" label="Subject Development"
              text={aiSections.subject_development} loading={aiLoading.subject_development} editing={aiEditing.subject_development}
              onGenerate={generateAiSection} onSaveEdit={saveAiEdit} onSetEditing={setAiEditing} />
            <AiBlock sectionKey="subject_building" label="Subject Building"
              text={aiSections.subject_building} loading={aiLoading.subject_building} editing={aiEditing.subject_building}
              onGenerate={generateAiSection} onSaveEdit={saveAiEdit} onSetEditing={setAiEditing} />
            <AiBlock sectionKey="subject_property" label="Subject Property"
              text={aiSections.subject_property} loading={aiLoading.subject_property} editing={aiEditing.subject_property}
              onGenerate={generateAiSection} onSaveEdit={saveAiEdit} onSetEditing={setAiEditing} />
          </Sub>
        </>
      )}
      {page === 2 && (
        <>
          <Sub num="2.4" title="Measurement" cats={["E"]}>
            <AutoField label="EPC Floor Area" value={r.floor_area_m2 ? `${r.floor_area_m2} sqm` : null} />
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs shrink-0 w-32" style={{ color: "var(--color-text-secondary)" }}>GIA (sqm):</span>
              <input type="text" value={valuer.gia_sqm} onChange={e => updateValuer("gia_sqm", e.target.value)}
                className="w-28 text-sm px-2.5 py-1.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none" placeholder="0" />
              {r.floor_area_m2 && !valuer.gia_adopted_epc && (
                <button onClick={() => { updateValuer("gia_sqm", String(r.floor_area_m2)); updateValuer("gia_adopted_epc", true) }}
                  className="text-xs px-2 py-0.5 rounded border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-btn-primary-bg)]/10 transition-colors">
                  Adopt EPC
                </button>
              )}
              {valuer.gia_adopted_epc && <span className="text-xs" style={{ color: "var(--color-status-success)" }}>Adopted from EPC</span>}
            </div>
            {valuer.gia_sqm && <AutoField label="GIA (sqft)" value={`${(parseFloat(valuer.gia_sqm) * 10.764).toFixed(0)} sqft`} />}
          </Sub>

          <Sub num="2.5" title="Site Area" cats={["C", "E"]}>
            {r.inspire_area_sqm != null && (
              <AutoField label="INSPIRE Title Area" value={`${r.inspire_area_sqm.toLocaleString("en-GB", { maximumFractionDigits: 0 })} m\u00B2 / ${Math.round(r.inspire_area_sqm * 10.764).toLocaleString("en-GB")} sqft`} />
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs shrink-0 w-32" style={{ color: "var(--color-text-secondary)" }}>Site Area (m²):</span>
              <input type="text" value={valuer.site_area_sqm} onChange={e => updateValuer("site_area_sqm", e.target.value)}
                className="w-28 text-sm px-2.5 py-1.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none" placeholder="0" />
              {r.inspire_area_sqm != null && (!valuer.site_area_sqm || valuer.site_area_sqm === "0") && (
                <button onClick={() => updateValuer("site_area_sqm", String(Math.round(r.inspire_area_sqm!)))}
                  className="text-xs px-2 py-0.5 rounded border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-btn-primary-bg)]/10 transition-colors">
                  Adopt INSPIRE
                </button>
              )}
            </div>
            {valuer.site_area_sqm && parseFloat(valuer.site_area_sqm) > 0 && (
              <div className="mt-1 space-y-0.5">
                <AutoField label="Site Area (sqft)" value={`${Math.round(parseFloat(valuer.site_area_sqm) * 10.764).toLocaleString("en-GB")} sqft`} />
                <AutoField label="Acres" value={(parseFloat(valuer.site_area_sqm) / 4047).toFixed(3)} />
                <AutoField label="Hectares" value={(parseFloat(valuer.site_area_sqm) / 10000).toFixed(4)} />
              </div>
            )}
          </Sub>

          <Sub num="2.7" title="Services" cats={["E"]}>
            <div className="grid grid-cols-2 gap-1.5">
              <TickField label="Mains gas" checked={valuer.service_gas} onChange={v => updateValuer("service_gas", v)} />
              <TickField label="Mains water" checked={valuer.service_water} onChange={v => updateValuer("service_water", v)} />
              <TickField label="Mains electricity" checked={valuer.service_electricity} onChange={v => updateValuer("service_electricity", v)} />
              <TickField label="Mains drainage" checked={valuer.service_drainage} onChange={v => updateValuer("service_drainage", v)} />
            </div>
          </Sub>

          <Sub num="2.8" title="Condition" cats={["D", "E"]}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs shrink-0" style={{ color: "var(--color-text-secondary)" }}>Overall:</span>
              {(["good", "fair", "poor"] as const).map(opt => (
                <button key={opt} onClick={() => updateValuer("condition_rating", opt)}
                  className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors capitalize ${
                    valuer.condition_rating === opt
                      ? opt === "good" ? "border-[var(--color-status-success)]/50 bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]"
                        : opt === "fair" ? "border-[var(--color-status-warning)]/50 bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]"
                        : "border-[var(--color-status-danger)]/50 bg-[var(--color-status-danger)]/15 text-[var(--color-status-danger)]"
                      : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]"
                  }`}>
                  {opt}
                </button>
              ))}
            </div>
            <textarea value={valuer.condition_notes} onChange={e => updateValuer("condition_notes", e.target.value)}
              rows={2} placeholder="Condition observations…"
              className="w-full text-sm px-2.5 py-2 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/50 focus:outline-none resize-y" />
          </Sub>

          <Sub num="2.9" title="Environmental Matters" cats={["A"]} onCatClick={c => handleCatClick(c, "2.9")}>
            <FirmText fieldKey="environmental" fallback="No environmental disclaimer set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
          </Sub>

          <Sub num="2.10" title="Brownfield" cats={["C"]}>
            <AutoField label="Brownfield" value={r.brownfield?.length > 0 ? `Yes — ${r.brownfield.length} site(s) nearby` : "No brownfield sites identified"} />
          </Sub>

          <Sub num="2.11" title="Coal Mining" cats={["C"]}>
            <AutoField label="Coalfield" value={r.coal_mining_in_coalfield ? "Within coalfield" : "Not in coalfield"} />
            <AutoField label="High Risk" value={r.coal_mining_high_risk ? "Yes — high risk area" : "No"} />
          </Sub>

          <Sub num="2.12" title="Radon" cats={["C"]}>
            <AutoField label="Radon Risk" value={r.radon_risk} />
          </Sub>

          <Sub num="2.13" title="Ground Conditions" cats={["C"]}>
            <AutoField label="Shrink-Swell" value={r.ground_shrink_swell} />
            <AutoField label="Landslides" value={r.ground_landslides} />
            <AutoField label="Compressible" value={r.ground_compressible} />
            <AutoField label="Collapsible" value={r.ground_collapsible} />
            <AutoField label="Running Sand" value={r.ground_running_sand} />
            <AutoField label="Soluble Rocks" value={r.ground_soluble_rocks} />
          </Sub>

          <Sub num="2.14" title="Asbestos" cats={["A"]} onCatClick={c => handleCatClick(c, "2.14")}>
            {r.construction_age_band && !r.construction_age_band.includes("200") && !r.construction_age_band.includes("201") && !r.construction_age_band.includes("202") ? (
              <p className="text-xs mb-1.5" style={{ color: "var(--color-status-warning)" }}>Pre-2000 construction — asbestos warning applies</p>
            ) : (
              <p className="text-xs mb-1.5" style={{ color: "var(--color-text-secondary)" }}>Post-2000 construction — standard disclaimers apply</p>
            )}
            <FirmText fieldKey="asbestos" fallback="No asbestos disclaimer set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
          </Sub>

          <Sub num="2.17" title="Flood Risk" cats={["C"]}>
            <div className="flex gap-6">
              <div><span className="text-xs text-[var(--color-text-secondary)]">Planning Zone: </span><RiskBadge risk={r.planning_flood_zone ?? "Zone 1"} /></div>
              <div><span className="text-xs text-[var(--color-text-secondary)]">Rivers &amp; Sea: </span><RiskBadge risk={r.rivers_sea_risk} /></div>
              <div><span className="text-xs text-[var(--color-text-secondary)]">Surface Water: </span><RiskBadge risk={r.surface_water_risk} /></div>
            </div>
          </Sub>

          <Sub num="2.18" title="Fire Risk & Cladding / EWS1" cats={["A", "E"]} onCatClick={c => handleCatClick(c, "2.18")}>
            <FirmText fieldKey="fire_risk" fallback="No fire risk / EWS1 boilerplate set" firmTemplate={firmTemplate} onOpenSettings={openSettings} />
          </Sub>

          <Sub num="2.19" title="Planning & Heritage" cats={["C"]}>
            <AutoField label="Listed Buildings (75m)" value={r.listed_buildings?.length > 0 ? `${r.listed_buildings.length} listed building(s) nearby` : "None identified"} />
            <AutoField label="Conservation Area" value={r.conservation_areas?.length > 0 ? `${r.conservation_areas.length} conservation area(s)` : "None identified"} />
            <AutoField label="AONB" value={r.aonb || "None identified"} />
            <AutoField label="SSSI" value={r.sssi?.length > 0 ? r.sssi.join(", ") : "None identified"} />
          </Sub>

          <Sub num="2.20" title="Energy Performance (EPC)" cats={["C"]}>
            <AutoField label="EPC Rating" value={r.energy_rating} />
            <AutoField label="EPC Score" value={r.energy_score?.toString()} />
            <AutoField label="Floor Area" value={r.floor_area_m2 ? `${r.floor_area_m2} sqm` : null} />
            <AutoField label="Habitable Rooms" value={r.num_rooms?.toString()} />
          </Sub>

          <Sub num="2.21" title="Council Tax" cats={["C"]}>
            <AutoField label="Local Authority" value={r.admin_district} />
            <AutoField label="Council Tax Band" value={r.council_tax_band ? `Band ${r.council_tax_band}` : null} />
          </Sub>
        </>
      )}
    </>
  )
}

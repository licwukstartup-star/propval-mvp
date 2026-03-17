"use client";
import { useState } from "react";
import type { ComparableCandidate } from "./ComparableSearch";

interface Props {
  onAdd: (comp: ComparableCandidate) => void;
  onClose: () => void;
  subjectPostcode?: string | null;
  subjectTenure?: string | null;
  subjectPropertyType?: string | null;
}

export default function ManualComparableForm({ onAdd, onClose, subjectPostcode, subjectTenure, subjectPropertyType }: Props) {
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState(subjectPostcode ?? "");
  const [price, setPrice] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [tenure, setTenure] = useState(subjectTenure ?? "");
  const [propertyType, setPropertyType] = useState(subjectPropertyType ?? "");
  const [houseSubType, setHouseSubType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [floorAreaSqm, setFloorAreaSqm] = useState("");
  const [epcRating, setEpcRating] = useState("");
  const [newBuild, setNewBuild] = useState(false);
  const [source, setSource] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = address.trim() && postcode.trim() && price && transactionDate && tenure;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!canSubmit) return;

    const pcTrimmed = postcode.trim().toUpperCase();
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(pcTrimmed)) {
      setFormError("Please enter a valid UK postcode (e.g. E14 9SJ).");
      return;
    }

    const outward = pcTrimmed.split(" ")[0] || pcTrimmed.slice(0, -3).trim();
    const priceNum = parseInt(price.replace(/,/g, ""), 10);
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError("Price must be a positive number.");
      return;
    }

    const now = new Date();
    const txDate = new Date(transactionDate);
    const monthsAgo = (now.getFullYear() - txDate.getFullYear()) * 12 + (now.getMonth() - txDate.getMonth());

    const comp: ComparableCandidate = {
      transaction_id: null,
      address: address.trim(),
      postcode: postcode.trim().toUpperCase(),
      outward_code: outward.toUpperCase(),
      saon: null,
      tenure: tenure || null,
      property_type: propertyType || null,
      house_sub_type: houseSubType || null,
      bedrooms: bedrooms ? parseInt(bedrooms, 10) : null,
      building_name: null,
      building_era: null,
      build_year: null,
      build_year_estimated: false,
      floor_area_sqm: floorAreaSqm ? parseFloat(floorAreaSqm) : null,
      price: priceNum,
      transaction_date: transactionDate,
      new_build: newBuild,
      transaction_category: null,
      geographic_tier: 0,
      tier_label: source.trim() ? `Manual — ${source.trim()}` : "Manual",
      spec_relaxations: [],
      time_window_months: 0,
      epc_matched: false,
      epc_rating: epcRating || null,
      epc_score: null,
      months_ago: monthsAgo,
      lease_remaining: null,
    };

    onAdd(comp);
    onClose();
  }

  const inputCls = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-colors";
  const labelCls = "block text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide mb-1";
  const selectCls = `${inputCls} appearance-none`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] shadow-2xl shadow-black/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-comp-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">✏️</span>
            <h3 id="manual-comp-title" className="font-orbitron font-bold text-sm tracking-widest text-[var(--color-accent)] uppercase">Add Manual Comparable</h3>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-xl leading-none">&times;</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Address */}
          <div>
            <label htmlFor="mc-address" className={labelCls}>Address <span className="text-[var(--color-accent-pink)]">*</span></label>
            <input id="mc-address" type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. Flat 4, 10 Marsh Wall" className={inputCls} autoFocus />
          </div>

          {/* Postcode + Price row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Postcode <span className="text-[var(--color-accent-pink)]">*</span></label>
              <input type="text" value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="E14 9SJ" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Price (£) <span className="text-[var(--color-accent-pink)]">*</span></label>
              <input type="text" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9,]/g, ""))} placeholder="450,000" className={inputCls} />
            </div>
          </div>

          {/* Date + Tenure row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Transaction Date <span className="text-[var(--color-accent-pink)]">*</span></label>
              <input type="date" value={transactionDate} onChange={e => setTransactionDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tenure <span className="text-[var(--color-accent-pink)]">*</span></label>
              <select value={tenure} onChange={e => setTenure(e.target.value)} className={selectCls}>
                <option value="">Select…</option>
                <option value="freehold">Freehold</option>
                <option value="leasehold">Leasehold</option>
              </select>
            </div>
          </div>

          {/* Property type + Sub-type row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Property Type</label>
              <select value={propertyType} onChange={e => setPropertyType(e.target.value)} className={selectCls}>
                <option value="">Select…</option>
                <option value="flat">Flat</option>
                <option value="house">House</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>House Sub-Type</label>
              <select value={houseSubType} onChange={e => setHouseSubType(e.target.value)} className={selectCls} disabled={propertyType !== "house"}>
                <option value="">Select…</option>
                <option value="detached">Detached</option>
                <option value="semi-detached">Semi-Detached</option>
                <option value="terraced">Terraced</option>
                <option value="end-terrace">End-Terrace</option>
              </select>
            </div>
          </div>

          {/* Bedrooms + Floor area row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Bedrooms</label>
              <input type="number" min={0} max={20} value={bedrooms} onChange={e => setBedrooms(e.target.value)} placeholder="2" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Floor Area (m²)</label>
              <input type="number" min={0} step="0.1" value={floorAreaSqm} onChange={e => setFloorAreaSqm(e.target.value)} placeholder="65" className={inputCls} />
            </div>
          </div>

          {/* EPC + New build row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>EPC Rating</label>
              <select value={epcRating} onChange={e => setEpcRating(e.target.value)} className={selectCls}>
                <option value="">Unknown</option>
                {["A", "B", "C", "D", "E", "F", "G"].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newBuild} onChange={e => setNewBuild(e.target.checked)} className="rounded border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30" />
                <span className="text-sm text-[var(--color-text-primary)]">New Build</span>
              </label>
            </div>
          </div>

          {/* Source */}
          <div>
            <label className={labelCls}>Source</label>
            <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. Agent particulars, Rightmove, personal knowledge" className={inputCls} />
            <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Optional — helps you remember where this comp came from</p>
          </div>

        </form>

        {/* Validation error */}
        {formError && (
          <div className="mx-6 mb-0 mt-1 rounded-lg px-4 py-2 text-xs font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--color-status-danger) 10%, transparent)", color: "var(--color-status-danger)", border: "1px solid color-mix(in srgb, var(--color-status-danger) 20%, transparent)" }}>
            {formError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-base)]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit as any}
            disabled={!canSubmit}
            className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
              canSubmit
                ? "bg-[var(--color-btn-primary-bg)] text-[var(--color-bg-base)] hover:bg-[var(--color-btn-primary-bg)]/90 shadow-lg shadow-[var(--color-accent)]/20"
                : "bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed"
            }`}
          >
            Add Comparable
          </button>
        </div>
      </div>
    </div>
  );
}

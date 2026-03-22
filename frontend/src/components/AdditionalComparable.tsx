"use client";
import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ComparableCandidate } from "./ComparableSearch";
import { API_BASE, FULL_POSTCODE_RE } from "@/lib/constants";

interface Props {
  onAdopt: (comp: ComparableCandidate) => void;
  adoptedIds: Set<string>;
  valuationDate: string;
}

interface EpcSummary {
  floor_area_sqm: number | null;
  bedrooms: number | null;
  epc_rating: string | null;
  epc_score: number | null;
  build_year: string | null;
  property_type: string | null;
  built_form: string | null;
  tenure: string | null;
}

interface LookupResult {
  postcode: string;
  address: string;
  transactions: ComparableCandidate[];
  epc_summary: EpcSummary | null;
  duration_ms: number;
}

// ── Editable form fields ──────────────────────────────────────────────────
interface FormFields {
  address: string;
  postcode: string;
  price: string;
  transactionDate: string;
  tenure: string;
  propertyType: string;
  houseSubType: string;
  bedrooms: string;
  floorAreaSqm: string;
  epcRating: string;
  newBuild: boolean;
}

function emptyForm(address: string, postcode: string): FormFields {
  return { address, postcode, price: "", transactionDate: "", tenure: "", propertyType: "", houseSubType: "", bedrooms: "", floorAreaSqm: "", epcRating: "", newBuild: false };
}

/** Map EPC property_type string (e.g. "House") to our select value */
function mapEpcPropertyType(pt: string | null): string {
  if (!pt) return "";
  const l = pt.toLowerCase();
  if (l.includes("flat") || l.includes("maisonette")) return "flat";
  if (l.includes("house") || l.includes("bungalow")) return "house";
  return "";
}

/** Map EPC built_form to house sub-type */
function mapEpcBuiltForm(bf: string | null): string {
  if (!bf) return "";
  const l = bf.toLowerCase();
  if (l.includes("detached") && !l.includes("semi")) return "detached";
  if (l.includes("semi")) return "semi-detached";
  if (l.includes("terrace") && l.includes("end")) return "end-terrace";
  if (l.includes("terrace")) return "terraced";
  return "";
}

/** Map EPC tenure string to our select value */
function mapEpcTenure(t: string | null): string {
  if (!t) return "";
  const l = t.toLowerCase();
  if (l.includes("freehold") || l === "owner-occupied") return "freehold";
  if (l.includes("leasehold") || l.includes("rental")) return "leasehold";
  return "";
}

export default function AdditionalComparable({ onAdopt, adoptedIds, valuationDate }: Props) {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ address: string; uprn: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionIdx, setSuggestionIdx] = useState(-1);
  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedPostcode, setSelectedPostcode] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Editable form state
  const [form, setForm] = useState<FormFields | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const setField = (field: keyof FormFields, value: string | boolean) =>
    setForm(prev => prev ? { ...prev, [field]: value } : prev);

  // ── Autocomplete ──────────────────────────────────────────────────────────
  const handleInputChange = useCallback((val: string) => {
    setQuery(val);
    setSuggestionIdx(-1);
    setSelectedAddress(null);
    setLookupResult(null);
    setLookupError(null);
    setForm(null);
    setAddedCount(0);

    const pcMatch = val.match(FULL_POSTCODE_RE);
    if (!pcMatch) { setSuggestions([]); setShowSuggestions(false); return; }

    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      setShowSuggestions(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/property/autocomplete?postcode=${encodeURIComponent(pcMatch[0])}`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.addresses ?? []);
        }
      } catch { /* ignore */ }
      finally { setSuggestionsLoading(false); }
    }, 400);
  }, [session?.access_token]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestionIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && suggestionIdx >= 0) { e.preventDefault(); pickAddress(suggestions[suggestionIdx]); }
    else if (e.key === "Escape") { setShowSuggestions(false); setSuggestionIdx(-1); }
  }

  // ── Pick address → lookup → pre-fill form ────────────────────────────────
  async function pickAddress(s: { address: string; uprn: string }) {
    setQuery(s.address);
    setShowSuggestions(false);
    setSuggestions([]);
    setSuggestionIdx(-1);
    setSelectedAddress(s.address);
    setAddedCount(0);

    const pcMatch = s.address.match(FULL_POSTCODE_RE) || query.match(FULL_POSTCODE_RE);
    const pc = pcMatch ? pcMatch[0].toUpperCase().replace(/\s+/g, " ") : null;
    const normPc = pc ? pc.replace(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i, "$1 $2").toUpperCase() : null;
    setSelectedPostcode(normPc);

    if (!normPc) { setLookupError("Could not extract postcode"); return; }

    setLookupLoading(true);
    setLookupError(null);
    try {
      const res = await fetch(`${API_BASE}/api/comparables/address-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ postcode: normPc, address: s.address, uprn: s.uprn || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }
      const data: LookupResult = await res.json();
      setLookupResult(data);

      // Pre-fill form from EPC + latest transaction
      const f = emptyForm(s.address, normPc);
      const epc = data.epc_summary;
      if (epc) {
        f.floorAreaSqm = epc.floor_area_sqm != null ? String(epc.floor_area_sqm) : "";
        f.bedrooms = epc.bedrooms != null ? String(epc.bedrooms) : "";
        f.epcRating = epc.epc_rating ?? "";
        f.propertyType = mapEpcPropertyType(epc.property_type);
        f.houseSubType = mapEpcBuiltForm(epc.built_form);
        f.tenure = mapEpcTenure(epc.tenure);
      }
      // If there are PPD transactions, pre-fill price + date from the latest
      if (data.transactions.length > 0) {
        const latest = data.transactions[0]; // sorted desc by date
        f.price = latest.price ? String(latest.price) : "";
        f.transactionDate = latest.transaction_date ?? "";
        f.newBuild = latest.new_build ?? false;
        // PPD can also fill tenure/type if EPC didn't
        if (!f.tenure && latest.tenure) f.tenure = latest.tenure;
        if (!f.propertyType && latest.property_type) f.propertyType = latest.property_type;
        if (!f.houseSubType && latest.house_sub_type) f.houseSubType = latest.house_sub_type;
        if (!f.bedrooms && latest.bedrooms != null) f.bedrooms = String(latest.bedrooms);
        if (!f.floorAreaSqm && latest.floor_area_sqm != null) f.floorAreaSqm = String(latest.floor_area_sqm);
        if (!f.epcRating && latest.epc_rating) f.epcRating = latest.epc_rating;
      }
      setForm(f);
    } catch (e: any) {
      setLookupError(e.message || "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  }

  // ── Pre-fill from a past transaction ──────────────────────────────────────
  function prefillFromTransaction(tx: ComparableCandidate) {
    setForm(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        price: tx.price ? String(tx.price) : prev.price,
        transactionDate: tx.transaction_date ?? prev.transactionDate,
        newBuild: tx.new_build ?? prev.newBuild,
        tenure: tx.tenure ?? prev.tenure,
        propertyType: tx.property_type ?? prev.propertyType,
        houseSubType: tx.house_sub_type ?? prev.houseSubType,
        bedrooms: tx.bedrooms != null ? String(tx.bedrooms) : prev.bedrooms,
        floorAreaSqm: tx.floor_area_sqm != null ? String(tx.floor_area_sqm) : prev.floorAreaSqm,
        epcRating: tx.epc_rating ?? prev.epcRating,
      };
    });
  }

  // ── Submit → build ComparableCandidate → adopt ────────────────────────────
  function handleAdd() {
    if (!form || !form.address.trim() || !form.postcode.trim() || !form.price || !form.transactionDate || !form.tenure) return;

    const outward = form.postcode.split(" ")[0] || form.postcode.slice(0, -3).trim();
    const priceNum = parseInt(form.price.replace(/,/g, ""), 10);
    if (isNaN(priceNum) || priceNum <= 0) return;

    const now = new Date();
    const txDate = new Date(form.transactionDate);
    const monthsAgo = (now.getFullYear() - txDate.getFullYear()) * 12 + (now.getMonth() - txDate.getMonth());

    const comp: ComparableCandidate = {
      transaction_id: null,
      address: form.address.trim(),
      postcode: form.postcode.trim().toUpperCase(),
      outward_code: outward.toUpperCase(),
      saon: null,
      tenure: form.tenure || null,
      property_type: form.propertyType || null,
      house_sub_type: form.houseSubType || null,
      bedrooms: form.bedrooms ? parseInt(form.bedrooms, 10) : null,
      building_name: null,
      building_era: null,
      build_year: null,
      build_year_estimated: false,
      floor_area_sqm: form.floorAreaSqm ? parseFloat(form.floorAreaSqm) : null,
      price: priceNum,
      transaction_date: form.transactionDate,
      new_build: form.newBuild,
      transaction_category: null,
      geographic_tier: 0,
      tier_label: "Additional",
      spec_relaxations: [],
      time_window_months: 0,
      epc_matched: !!(form.epcRating || form.floorAreaSqm || form.bedrooms),
      epc_rating: form.epcRating || null,
      epc_score: null,
      months_ago: monthsAgo,
      lease_remaining: null,
    };

    onAdopt(comp);
    setAddedCount(prev => prev + 1);
  }

  const canSubmit = form && form.address.trim() && form.postcode.trim() && form.price && form.transactionDate && form.tenure;

  const inputCls = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-colors";
  const labelCls = "block text-[10px] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide mb-1";
  const selectCls = `${inputCls} appearance-none`;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="rounded-xl border border-[var(--color-accent-pink)]/20 bg-[var(--color-accent-pink)]/5 px-4 py-3">
        <p className="text-xs text-[var(--color-text-primary)] leading-relaxed">
          <span className="font-semibold text-[var(--color-accent-pink)]">Additional Comparables</span> — Search for any property by postcode.
          Data from EPC and Land Registry will pre-fill automatically. Edit any field — especially useful for
          recent transactions not yet registered by HMLR (typical lag: 2–6 weeks).
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="Type a postcode to search (e.g. SW11 3TN)"
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-base)] px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/30 transition-colors"
        />
        {suggestionsLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
          </div>
        )}

        {/* Dropdown */}
        {(showSuggestions || suggestionsLoading) && (
          <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg shadow-black/50 max-h-80 overflow-y-auto">
            {suggestionsLoading && !suggestions.length && (
              <div className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">Loading addresses...</div>
            )}
            {!suggestionsLoading && suggestions.length === 0 && query.match(FULL_POSTCODE_RE) && (
              <div className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">No addresses found for this postcode</div>
            )}
            {suggestions.map((s, i) => (
              <div
                key={i}
                onMouseDown={e => { e.preventDefault(); pickAddress(s); }}
                onMouseEnter={() => setSuggestionIdx(i)}
                className={`px-4 py-2.5 text-sm cursor-pointer border-b border-[var(--color-border)]/30 transition-colors ${
                  i === suggestionIdx ? "text-[var(--color-accent)] bg-[var(--color-btn-primary-bg)]/8" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
                }`}
              >
                {s.address}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Loading */}
      {lookupLoading && (
        <div className="flex items-center justify-center py-12 gap-3">
          <div className="w-5 h-5 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
          <span className="text-sm text-[var(--color-text-secondary)]">Looking up {selectedAddress}...</span>
        </div>
      )}

      {/* Error */}
      {lookupError && (
        <div className="rounded-xl border border-[var(--color-status-danger)]/30 bg-[var(--color-status-danger)]/5 px-4 py-3 text-sm text-[var(--color-status-danger)]">
          {lookupError}
        </div>
      )}

      {/* ── Results: Editable form + past transactions ─────────────────────── */}
      {form && lookupResult && !lookupLoading && (
        <div className="space-y-4">

          {/* Past transactions — clickable to pre-fill */}
          {lookupResult.transactions.length > 0 && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]">
                <p className="text-xs font-orbitron font-bold tracking-[2px] text-[var(--color-accent)] uppercase">
                  HMLR Transactions ({lookupResult.transactions.length}) — click to pre-fill
                </p>
              </div>
              <div className="divide-y divide-[var(--color-border)]/40">
                {lookupResult.transactions.map((tx, i) => {
                  const txKey = tx.transaction_id ?? tx.address;
                  const isAlreadyAdopted = adoptedIds.has(txKey);
                  return (
                    <div
                      key={tx.transaction_id ?? i}
                      className="flex items-center gap-4 px-4 py-2.5 hover:bg-[var(--color-bg-surface)] transition-colors group"
                    >
                      <button
                        onClick={() => prefillFromTransaction(tx)}
                        className="flex-1 text-left flex items-center gap-4"
                        title="Pre-fill form with this transaction"
                      >
                        <span className="text-xs text-[var(--color-text-secondary)] tabular-nums w-24">{tx.transaction_date}</span>
                        <span className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                          {tx.price ? `£${tx.price.toLocaleString()}` : "—"}
                        </span>
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          {tx.tenure ?? ""} {tx.property_type ?? ""}
                        </span>
                        {tx.floor_area_sqm != null && (
                          <span className="text-xs text-[var(--color-text-secondary)]">{tx.floor_area_sqm} m²</span>
                        )}
                        {tx.epc_rating && (
                          <span className="text-xs text-[var(--color-text-secondary)]">EPC {tx.epc_rating}</span>
                        )}
                      </button>
                      {isAlreadyAdopted ? (
                        <span className="text-[10px] text-[var(--color-status-success)] font-semibold whitespace-nowrap">✓ adopted</span>
                      ) : (
                        <button
                          onClick={() => onAdopt(tx)}
                          className="px-3 py-1 text-[10px] font-semibold rounded-md bg-[var(--color-btn-primary-bg)] text-[var(--color-bg-base)] hover:bg-[var(--color-btn-primary-bg)]/80 transition-colors whitespace-nowrap"
                        >
                          Use This
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Editable form */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-base)] flex items-center justify-between">
              <p className="text-xs font-orbitron font-bold tracking-[2px] text-[var(--color-accent-pink)] uppercase">
                Comparable Details — edit as needed
              </p>
              {lookupResult.epc_summary && (
                <span className="text-[10px] text-[var(--color-status-success)]">EPC data pre-filled</span>
              )}
            </div>

            <div className="px-4 py-4 space-y-3">
              {/* Address (read-only) */}
              <div>
                <label className={labelCls}>Address</label>
                <input type="text" value={form.address} readOnly className={`${inputCls} opacity-60 cursor-not-allowed`} />
              </div>

              {/* Postcode + Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Postcode</label>
                  <input type="text" value={form.postcode} readOnly className={`${inputCls} opacity-60 cursor-not-allowed`} />
                </div>
                <div>
                  <label className={labelCls}>Price (£) <span className="text-[var(--color-accent-pink)]">*</span></label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.price}
                    onChange={e => setField("price", e.target.value.replace(/[^0-9,]/g, ""))}
                    placeholder="450,000"
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Date + Tenure */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Transaction Date <span className="text-[var(--color-accent-pink)]">*</span></label>
                  <input
                    type="date"
                    value={form.transactionDate}
                    onChange={e => setField("transactionDate", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Tenure <span className="text-[var(--color-accent-pink)]">*</span></label>
                  <select value={form.tenure} onChange={e => setField("tenure", e.target.value)} className={selectCls}>
                    <option value="">Select...</option>
                    <option value="freehold">Freehold</option>
                    <option value="leasehold">Leasehold</option>
                  </select>
                </div>
              </div>

              {/* Property type + Sub-type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Property Type</label>
                  <select value={form.propertyType} onChange={e => setField("propertyType", e.target.value)} className={selectCls}>
                    <option value="">Select...</option>
                    <option value="flat">Flat</option>
                    <option value="house">House</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>House Sub-Type</label>
                  <select value={form.houseSubType} onChange={e => setField("houseSubType", e.target.value)} className={selectCls} disabled={form.propertyType !== "house"}>
                    <option value="">Select...</option>
                    <option value="detached">Detached</option>
                    <option value="semi-detached">Semi-Detached</option>
                    <option value="terraced">Terraced</option>
                    <option value="end-terrace">End-Terrace</option>
                  </select>
                </div>
              </div>

              {/* Bedrooms + Floor area */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Bedrooms</label>
                  <input type="number" min={0} max={20} value={form.bedrooms} onChange={e => setField("bedrooms", e.target.value)} placeholder="2" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Floor Area (m²)</label>
                  <input type="number" min={0} step="0.1" value={form.floorAreaSqm} onChange={e => setField("floorAreaSqm", e.target.value)} placeholder="65" className={inputCls} />
                </div>
              </div>

              {/* EPC + New build */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>EPC Rating</label>
                  <select value={form.epcRating} onChange={e => setField("epcRating", e.target.value)} className={selectCls}>
                    <option value="">Unknown</option>
                    {["A", "B", "C", "D", "E", "F", "G"].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.newBuild}
                      onChange={e => setField("newBuild", e.target.checked)}
                      className="rounded border-[var(--color-border)] bg-[var(--color-bg-base)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">New Build</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-base)]">
              <div className="text-xs text-[var(--color-text-muted)]">
                {form.price && form.floorAreaSqm && parseFloat(form.floorAreaSqm) > 0 && parseInt(form.price.replace(/,/g, ""), 10) > 0
                  ? `£${Math.round(parseInt(form.price.replace(/,/g, ""), 10) / (parseFloat(form.floorAreaSqm) * 10.764)).toLocaleString()}/sqft`
                  : ""}
                {addedCount > 0 && (
                  <span className="ml-3 text-[var(--color-status-success)]">{addedCount} added</span>
                )}
              </div>
              <button
                onClick={handleAdd}
                disabled={!canSubmit}
                className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                  canSubmit
                    ? "bg-[var(--color-btn-primary-bg)] text-[var(--color-bg-base)] hover:bg-[var(--color-btn-primary-bg)]/90 shadow-lg shadow-[var(--color-accent)]/20"
                    : "bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed"
                }`}
              >
                Add to Adopted
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!lookupResult && !lookupLoading && !lookupError && !selectedAddress && (
        <div className="text-center py-16 text-[var(--color-text-secondary)]/70 space-y-2">
          <p className="text-4xl">🔎</p>
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">Search for any UK property</p>
          <p className="text-xs text-[var(--color-text-secondary)]/70">
            Enter a postcode above, select an address, then review and edit the details before adding.
          </p>
        </div>
      )}
    </div>
  );
}

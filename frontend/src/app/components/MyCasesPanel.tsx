"use client";

import React, { useState, useMemo } from "react";
import type { SavedCaseSummary } from "@/types/property";

interface MyCasesPanelProps {
  casesList: SavedCaseSummary[];
  casesLoading: boolean;
  currentCaseId: string | null;
  casesFilter: string;
  casesSort: string;
  casesSortDir: "asc" | "desc";
  onSetCasesFilter: (filter: string) => void;
  onSetCasesSort: (sort: string) => void;
  onSetCasesSortDir: (dir: "asc" | "desc") => void;
  onLoadCase: (c: SavedCaseSummary) => void;
  onDeleteCase: (id: string) => void;
  onClose: () => void;
}

/* ── Constants ────────────────────────────────────────────────────────── */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In Progress" },
  { key: "complete", label: "Complete" },
  { key: "issued", label: "Issued" },
  { key: "research", label: "Research" },
  { key: "full_valuation", label: "Full Valuation" },
];
const STATUS_FILTERS = ["in_progress", "complete", "issued"];
const TYPE_FILTERS = ["research", "full_valuation"];

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  full_valuation: { bg: "color-mix(in srgb, var(--color-status-info) 15%, transparent)", text: "var(--color-status-info)" },
  research: { bg: "color-mix(in srgb, var(--color-accent-purple) 15%, transparent)", text: "var(--color-accent-purple-text)" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  in_progress: { bg: "color-mix(in srgb, var(--color-status-warning) 15%, transparent)", text: "var(--color-status-warning)" },
  complete: { bg: "color-mix(in srgb, var(--color-status-success) 15%, transparent)", text: "var(--color-status-success)" },
  issued: { bg: "color-mix(in srgb, var(--color-accent) 15%, transparent)", text: "var(--color-accent)" },
  archived: { bg: "var(--color-bg-surface)", text: "var(--color-text-secondary)" },
};

const COLUMNS: { key: string; label: string; sortable: boolean; width: string }[] = [
  { key: "select", label: "", sortable: false, width: "w-10" },
  { key: "address", label: "Property", sortable: true, width: "flex-1 min-w-[200px]" },
  { key: "postcode", label: "Postcode", sortable: true, width: "w-24" },
  { key: "case_type", label: "Type", sortable: false, width: "w-28" },
  { key: "status", label: "Status", sortable: false, width: "w-28" },
  { key: "valuation_date", label: "Valuation Date", sortable: true, width: "w-32" },
  { key: "updated", label: "Last Updated", sortable: true, width: "w-36" },
  { key: "created", label: "Created", sortable: true, width: "w-36" },
  { key: "actions", label: "", sortable: false, width: "w-20" },
];

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = dt.toLocaleDateString("en-GB", { month: "short" });
  const yr = String(dt.getFullYear()).slice(-2);
  return `${day} ${mon} ${yr}`;
}
function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ── Sort arrow icon ──────────────────────────────────────────────────── */
function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="ml-0.5 opacity-0 group-hover:opacity-30 text-[9px]">&#9650;</span>;
  return <span className="ml-0.5 text-[9px] text-[var(--color-accent)]">{dir === "asc" ? "\u25B2" : "\u25BC"}</span>;
}

export default function MyCasesPanel({
  casesList,
  casesLoading,
  currentCaseId,
  casesFilter,
  casesSort,
  casesSortDir,
  onSetCasesFilter,
  onSetCasesSort,
  onSetCasesSortDir,
  onLoadCase,
  onDeleteCase,
  onClose,
}: MyCasesPanelProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  /* ── Filter + search + sort ─────────────────────────────────────────── */
  const filtered = useMemo(() => {
    let list = casesList.filter(c => {
      if (casesFilter === "all") return c.status !== "archived";
      if (STATUS_FILTERS.includes(casesFilter)) {
        const eff = c.status === "draft" ? "in_progress" : c.status;
        return eff === casesFilter;
      }
      if (TYPE_FILTERS.includes(casesFilter)) return c.case_type === casesFilter && c.status !== "archived";
      return true;
    });
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.display_name ?? c.title ?? "").toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q) ||
        (c.postcode ?? "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const dir = casesSortDir === "asc" ? 1 : -1;
      if (casesSort === "updated") return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      if (casesSort === "created") return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      if (casesSort === "valuation_date") {
        const da = a.valuation_date ? new Date(a.valuation_date).getTime() : 0;
        const db = b.valuation_date ? new Date(b.valuation_date).getTime() : 0;
        return dir * (da - db);
      }
      if (casesSort === "postcode") return dir * (a.postcode ?? "").localeCompare(b.postcode ?? "");
      if (casesSort === "address") return dir * (a.address ?? "").localeCompare(b.address ?? "");
      return 0;
    });
    return list;
  }, [casesList, casesFilter, casesSort, casesSortDir, search]);

  /* ── Selection helpers ──────────────────────────────────────────────── */
  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const someSelected = selected.size > 0;

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(c => c.id)));
    }
  }
  function handleBulkDelete() {
    selected.forEach(id => onDeleteCase(id));
    setSelected(new Set());
    setConfirmBulkDelete(false);
  }

  /* ── Column sort click ──────────────────────────────────────────────── */
  function handleSort(key: string) {
    if (casesSort === key) {
      onSetCasesSortDir(casesSortDir === "asc" ? "desc" : "asc");
    } else {
      onSetCasesSort(key);
      onSetCasesSortDir("desc");
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.75)" }} onClick={onClose}>
      <div
        className="flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{
          width: "calc(100vw - 80px)",
          height: "calc(100vh - 80px)",
          backgroundColor: "var(--color-bg-base)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 0 60px color-mix(in srgb, var(--color-accent) 10%, transparent), 0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="font-orbitron text-[var(--color-accent)] text-base tracking-[3px] uppercase">My Cases</h2>
              <p className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
                {filtered.length} case{filtered.length !== 1 ? "s" : ""}
                {casesFilter !== "all" || search ? " (filtered)" : ""} · {casesList.length} total
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-1.5 rounded-lg hover:bg-[var(--color-bg-surface)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Toolbar: search + filters + bulk actions ────────────────── */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border)] shrink-0 flex-wrap">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search address, postcode, name…"
              className="text-xs pl-8 pr-3 py-1.5 w-64 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50 focus:outline-none transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5">
            {FILTERS.map(f => {
              const isActive = casesFilter === f.key;
              const fc = TYPE_COLORS[f.key] ?? STATUS_COLORS[f.key];
              return (
                <button
                  key={f.key}
                  onClick={() => onSetCasesFilter(f.key)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
                    !isActive
                      ? "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                      : f.key === "all"
                        ? "border-[var(--color-accent)]/60 bg-[var(--color-btn-primary-bg)]/10 text-[var(--color-accent)]"
                        : ""
                  }`}
                  style={isActive && fc ? { borderColor: fc.text, backgroundColor: fc.bg, color: fc.text } : undefined}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bulk actions */}
          {someSelected && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--color-text-secondary)]">{selected.size} selected</span>
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="text-[10px] px-3 py-1 rounded-lg border border-[var(--color-status-danger)]/40 text-[var(--color-status-danger)] hover:bg-[var(--color-status-danger)]/10 transition-colors font-medium"
              >
                Delete Selected
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-[10px] px-2 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* ── Table ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            {/* Header */}
            <thead className="sticky top-0 z-10">
              <tr style={{ backgroundColor: "var(--color-bg-panel)" }}>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider ${col.width} ${col.sortable ? "cursor-pointer group select-none" : ""}`}
                    style={{ color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    {col.key === "select" ? (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
                      />
                    ) : (
                      <span className="flex items-center gap-0.5">
                        {col.label}
                        {col.sortable && <SortArrow active={casesSort === col.key} dir={casesSortDir} />}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {casesLoading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-16">
                    <div className="flex items-center justify-center gap-3">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                      <span className="text-xs text-[var(--color-text-secondary)]">Loading cases…</span>
                    </div>
                  </td>
                </tr>
              )}
              {!casesLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-16">
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {casesList.length === 0 ? "No saved cases yet." : "No cases match your search or filter."}
                    </p>
                  </td>
                </tr>
              )}
              {!casesLoading && filtered.map((c, i) => {
                const isActive = currentCaseId === c.id;
                const isSelected = selected.has(c.id);
                const effectiveStatus = c.status === "draft" ? "in_progress" : (c.status ?? "in_progress");
                const typeLabel = (c.case_type ?? "research").replace("_", " ");
                const sc = STATUS_COLORS[effectiveStatus] ?? STATUS_COLORS.in_progress;
                const rowBg = isActive
                  ? "color-mix(in srgb, var(--color-accent) 6%, transparent)"
                  : i % 2 === 0
                    ? "var(--color-bg-base)"
                    : "var(--color-bg-panel)";

                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:!bg-[var(--color-bg-surface)]"
                    style={{
                      backgroundColor: rowBg,
                      borderLeft: isActive ? "3px solid var(--color-accent)" : "3px solid transparent",
                    }}
                    onClick={() => onLoadCase(c)}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => { e.stopPropagation(); toggleSelect(c.id); }}
                        onClick={e => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
                      />
                    </td>

                    {/* Property (name + address) */}
                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{c.address || c.display_name || c.title}</p>
                      </div>
                    </td>

                    {/* Postcode */}
                    <td className="px-3 py-2.5 text-xs text-[var(--color-text-primary)]" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      {c.postcode ?? "—"}
                    </td>

                    {/* Type + Panel badge */}
                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] px-2 py-0.5 rounded capitalize"
                          style={{ backgroundColor: (TYPE_COLORS[c.case_type ?? "research"] ?? TYPE_COLORS.research).bg, color: (TYPE_COLORS[c.case_type ?? "research"] ?? TYPE_COLORS.research).text }}>
                          {typeLabel}
                        </span>
                        {c.instruction_source && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold"
                            style={{ backgroundColor: "color-mix(in srgb, var(--color-status-warning) 12%, transparent)", color: "var(--color-status-warning)" }}>
                            {c.instruction_source}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      <span className="text-[10px] px-2 py-0.5 rounded capitalize"
                        style={{ backgroundColor: sc.bg, color: sc.text }}>
                        {effectiveStatus.replace("_", " ")}
                      </span>
                    </td>

                    {/* Valuation Date */}
                    <td className="px-3 py-2.5 text-xs text-[var(--color-text-secondary)]" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      {fmtDate(c.valuation_date)}
                    </td>

                    {/* Updated */}
                    <td className="px-3 py-2.5 text-[10px] text-[var(--color-text-muted)]" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      {fmtDateTime(c.updated_at)}
                    </td>

                    {/* Created */}
                    <td className="px-3 py-2.5 text-[10px] text-[var(--color-text-muted)]" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      {fmtDateTime(c.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--color-bg-surface)" }}>
                      <div className="flex items-center gap-1">
                        {/* Delete */}
                        {confirmDeleteId === c.id ? (
                          <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => { onDeleteCase(c.id); setConfirmDeleteId(null); }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-status-danger)] text-white font-semibold"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(c.id); }}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-status-danger)] transition-colors p-0.5 rounded"
                            title="Delete case"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer status bar ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-[var(--color-border)] shrink-0" style={{ backgroundColor: "var(--color-bg-panel)" }}>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            Showing {filtered.length} of {casesList.length} cases
            {someSelected && <span className="ml-2">· {selected.size} selected</span>}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            Click a row to open · Esc to close
          </span>
        </div>
      </div>

      {/* ── Bulk delete confirmation dialog ───────────────────────────── */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={() => setConfirmBulkDelete(false)}>
          <div className="rounded-xl p-6 max-w-sm" style={{ backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-status-danger)" }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--color-status-danger)] mb-2">Delete {selected.size} case{selected.size !== 1 ? "s" : ""}?</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">This action cannot be undone. All selected cases and their data will be permanently deleted.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmBulkDelete(false)} className="text-xs px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors">
                Cancel
              </button>
              <button onClick={handleBulkDelete} className="text-xs px-4 py-1.5 rounded-lg bg-[var(--color-status-danger)] text-white font-semibold hover:opacity-90 transition-opacity">
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React from "react";
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
  const filters = [
    { key: "all", label: "All" },
    { key: "in_progress", label: "In Progress" },
    { key: "complete", label: "Complete" },
    { key: "issued", label: "Issued" },
    { key: "research", label: "Research" },
    { key: "full_valuation", label: "Full Valuation" },
  ];
  const statusFilters = ["in_progress", "complete", "issued"];
  const typeFilters = ["research", "full_valuation"];
  const filtered = casesList.filter(c => {
    if (casesFilter === "all") return c.status !== "archived";
    if (statusFilters.includes(casesFilter)) {
      const effectiveStatus = c.status === "draft" ? "in_progress" : c.status;
      return effectiveStatus === casesFilter;
    }
    if (typeFilters.includes(casesFilter)) return c.case_type === casesFilter && c.status !== "archived";
    return true;
  }).sort((a, b) => {
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
  const sortOptions = [
    { key: "updated", label: "Last Updated" },
    { key: "created", label: "Case Creation Date" },
    { key: "valuation_date", label: "Valuation Date" },
    { key: "postcode", label: "Postcode" },
    { key: "address", label: "Address" },
  ];
  const statusColors: Record<string, string> = {
    in_progress: "bg-[#FFB800]/20 text-[#FFB800]",
    complete: "bg-[#39FF14]/20 text-[#39FF14]",
    issued: "bg-[#00F0FF]/20 text-[#00F0FF]",
    archived: "bg-[#334155] text-[#94A3B8]",
  };

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end" onClick={onClose}>
      <div className="bg-[#0A0E1A] border-l border-[#334155] w-full max-w-md h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-[#334155]">
          <div>
            <h2 className="text-lg font-orbitron font-bold text-[#00F0FF]">My Cases</h2>
            <p className="text-[10px] text-[#94A3B8] mt-0.5">{filtered.length} case{filtered.length !== 1 ? "s" : ""}{casesFilter !== "all" ? ` (filtered)` : ""} · {casesList.length} total</p>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#E2E8F0] text-lg">&#x2715;</button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-5 pt-4 pb-2">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => onSetCasesFilter(f.key)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
                casesFilter === f.key
                  ? "border-[#00F0FF]/60 bg-[#00F0FF]/10 text-[#00F0FF]"
                  : "border-[#334155] text-[#94A3B8] hover:border-[#475569] hover:text-[#E2E8F0]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-5 pb-2">
          <span className="text-[10px] text-[#475569]">Sort:</span>
          <select
            value={casesSort}
            onChange={e => onSetCasesSort(e.target.value)}
            className="text-[10px] bg-[#1E293B] border border-[#334155] text-[#E2E8F0] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#00F0FF]"
          >
            {sortOptions.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button
            onClick={() => onSetCasesSortDir(casesSortDir === "asc" ? "desc" : "asc")}
            className="text-[10px] px-1.5 py-1 border border-[#334155] rounded text-[#94A3B8] hover:text-[#E2E8F0] hover:border-[#475569] transition-colors"
            title={casesSortDir === "asc" ? "Ascending" : "Descending"}
          >
            {casesSortDir === "asc" ? "A\u2192Z" : "Z\u2192A"}
          </button>
        </div>
        <div className="p-5 pt-2">
          {casesLoading && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-3 border-[#00F0FF] border-t-transparent" />
            </div>
          )}
          {!casesLoading && filtered.length === 0 && (
            <p className="text-sm text-[#94A3B8] text-center py-8">{casesList.length === 0 ? "No saved cases yet." : "No cases match this filter."}</p>
          )}
          {!casesLoading && filtered.map(c => {
            const typeLabel = (c.case_type ?? "research").replace("_", " ");
            return (
            <div
              key={c.id}
              className={`rounded-lg border p-4 mb-3 cursor-pointer transition-colors ${
                currentCaseId === c.id
                  ? "border-[#00F0FF]/60 bg-[#00F0FF]/5"
                  : "border-[#334155] bg-[#111827] hover:border-[#475569] hover:bg-[#1E293B]"
              }`}
              onClick={() => onLoadCase(c)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-[#E2E8F0] truncate">{c.display_name ?? c.title}</h3>
                  <p className="text-xs text-[#94A3B8] truncate mt-0.5">{c.address}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded capitalize bg-[#7B2FBE]/20 text-[#c084fc]">{typeLabel}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${statusColors[c.status] ?? statusColors.in_progress}`}>{(c.status === "draft" ? "in_progress" : (c.status ?? "in_progress")).replace("_", " ")}</span>
                  </div>
                  <p className="text-[10px] text-[#475569] mt-1">
                    Created: {new Date(c.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    <span className="mx-1.5">&middot;</span>
                    Updated: {new Date(c.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {c.postcode && <span className="ml-2">{c.postcode}</span>}
                  </p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteCase(c.id); }}
                  className="text-[#94A3B8] hover:text-[#FF3131] text-xs px-1.5 py-0.5 rounded transition-colors shrink-0"
                  title="Delete case"
                >
                  &#x2715;
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import React from "react";

interface SaveCaseDialogProps {
  result: { address?: string; uprn?: string | null } | null;
  saveCaseType: "research" | "full_valuation";
  onSaveCaseTypeChange: (type: "research" | "full_valuation") => void;
  onSave: () => void;
  onCancel: () => void;
  savingCase: boolean;
  pendingExitAfterSave: boolean;
  onResetHome: () => void;
}

export default function SaveCaseDialog({
  result,
  saveCaseType,
  onSaveCaseTypeChange,
  onSave,
  onCancel,
  savingCase,
  pendingExitAfterSave,
  onResetHome,
}: SaveCaseDialogProps) {
  const handleClose = () => {
    onCancel();
    if (pendingExitAfterSave) onResetHome();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border)] rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-orbitron font-bold text-[var(--color-accent)] mb-4">New Case</h2>
        <p className="text-sm text-[var(--color-text-primary)] mb-1 truncate">{result?.address}</p>
        {result?.uprn && <p className="text-xs text-[var(--color-text-secondary)] mb-4">UPRN: {result.uprn}</p>}
        {!result?.uprn && <p className="text-xs text-[var(--color-status-warning)] mb-4">No UPRN found — case will still be saved</p>}
        <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5">Case type</label>
        <div className="flex gap-2 mb-5">
          {([["research", "Research"], ["full_valuation", "Full Valuation"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => onSaveCaseTypeChange(val)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                saveCaseType === val
                  ? "border-[var(--color-accent)]/60 bg-[var(--color-btn-primary-bg)]/10 text-[var(--color-accent)] font-semibold"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors"
          >
            {pendingExitAfterSave ? "Don\u2019t Save" : "Cancel"}
          </button>
          <button
            onClick={onSave}
            disabled={savingCase}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-[var(--color-status-success)] text-[var(--color-bg-base)] hover:brightness-110 disabled:opacity-50 transition-colors"
          >
            {savingCase ? "Saving\u2026" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

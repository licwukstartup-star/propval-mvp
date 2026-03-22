"use client";

import React, { useState } from "react";

interface CaseTypePopupProps {
  address: string;
  onSelect: (caseType: "research" | "full_valuation") => Promise<void>;
}

export default function CaseTypePopup({ address, onSelect }: CaseTypePopupProps) {
  const [selecting, setSelecting] = useState(false);

  const handleSelect = async (caseType: "research" | "full_valuation") => {
    setSelecting(true);
    try {
      await onSelect(caseType);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div
        className="bg-[var(--color-bg-panel)] border border-[var(--color-border)] rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-orbitron font-bold text-[var(--color-accent)] mb-2">
          Select Case Type
        </h2>
        <p className="text-sm text-[var(--color-text-primary)] mb-1 truncate">{address}</p>
        <p className="text-xs text-[var(--color-text-secondary)] mb-5">
          Choose a case type to begin working on this property.
        </p>
        <div className="flex gap-3">
          {([
            ["research", "Research", "Quick property intelligence lookup — no formal valuation."],
            ["full_valuation", "Full Valuation", "RICS-compliant residential valuation report."],
          ] as const).map(([val, label, desc]) => (
            <button
              key={val}
              onClick={() => handleSelect(val)}
              disabled={selecting}
              className="flex-1 flex flex-col items-center gap-1.5 px-4 py-4 rounded-xl border-2 transition-all hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-btn-primary-bg)]/10 border-[var(--color-border)] disabled:opacity-50"
            >
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</span>
              <span className="text-[10px] text-[var(--color-text-secondary)] text-center leading-tight">{desc}</span>
            </button>
          ))}
        </div>
        {selecting && (
          <p className="text-xs text-[var(--color-text-secondary)] text-center mt-3 animate-pulse">
            Creating case…
          </p>
        )}
      </div>
    </div>
  );
}

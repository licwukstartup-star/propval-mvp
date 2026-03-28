"use client";

import React, { useState, useEffect } from "react";
import type { CardSizeKey } from "@/types/property";
import { SIZE_PRESETS } from "@/lib/styles";

interface PropCardProps {
  id: string;
  isCustomising: boolean;
  cardSizes: Record<string, CardSizeKey>;
  onSizeChange: (id: string, size: CardSizeKey) => void;
  children: React.ReactNode;
}

export default function PropCard({ id, isCustomising, cardSizes, onSizeChange, children }: PropCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [maxCols, setMaxCols] = useState(4);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handle = (e: MediaQueryListEvent | MediaQueryList) => setMaxCols(e.matches ? 4 : 2);
    handle(mq);
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);
  const size: CardSizeKey = (cardSizes[id] as CardSizeKey) ?? "1x1";
  const preset = SIZE_PRESETS.find(p => p.key === size) ?? SIZE_PRESETS[0];
  const cols = Math.min(preset.cols, maxCols);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const PW = 252;
    const PH = 92;
    let top = rect.top - PH - 8;
    let left = rect.right - PW;
    if (top < 8) top = rect.bottom + 8;
    if (top + PH > window.innerHeight - 8) top = window.innerHeight - PH - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - PW - 8));
    setMenuPos({ top, left });
    setShowMenu(true);
  };

  return (
    <div
      style={{
        gridColumn: `span ${cols}`,
        gridRow: `span ${preset.rows}`,
        position: "relative",
      }}
    >
      <div style={{
        height: "100%",
        animation: isCustomising ? "propCardJiggle 0.35s ease-in-out infinite alternate" : "none",
        transformOrigin: "center center",
      }}>
        {children}
      </div>

      {isCustomising && (
        <button
          onClick={openMenu}
          title="Resize card"
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "rgba(0,240,255,0.18)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(0,240,255,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 20,
            transition: "background 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,240,255,0.35)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,240,255,0.18)"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 10L10 2M10 2H5M10 2V7" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {showMenu && (
        <>
          <div onClick={() => setShowMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              zIndex: 1000,
              background: "rgba(17,24,39,0.97)",
              backdropFilter: "blur(20px)",
              borderRadius: 14,
              padding: 8,
              display: "flex",
              gap: 4,
              border: "1px solid var(--color-border)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
              animation: "propCardPopIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            {SIZE_PRESETS.map(p => {
              const isActive = p.key === size;
              return (
                <button
                  key={p.key}
                  onClick={() => { onSizeChange(id, p.key); setShowMenu(false); }}
                  style={{
                    border: "none",
                    background: isActive ? "rgba(0,240,255,0.15)" : "rgba(255,255,255,0.05)",
                    color: "white",
                    borderRadius: 10,
                    padding: "8px 10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                    outline: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                    minWidth: 52,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)"; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 8px)", gridTemplateRows: "repeat(2, 8px)", gap: 2 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const row = Math.floor(i / 4);
                      const col = i % 4;
                      const filled = col < p.cols && row < p.rows;
                      return (
                        <div key={i} style={{
                          width: 8, height: 8, borderRadius: 2,
                          background: filled
                            ? (isActive ? "rgba(0,240,255,0.9)" : "rgba(255,255,255,0.5)")
                            : "rgba(255,255,255,0.1)",
                        }} />
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, opacity: isActive ? 1 : 0.55, color: isActive ? "var(--color-accent)" : "white" }}>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

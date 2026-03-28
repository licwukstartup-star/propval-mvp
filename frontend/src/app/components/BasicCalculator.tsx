"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";

interface Props {
  onClose: () => void;
}

// ── Unit conversion definitions ────────────────────────────────
type UnitCategory = "linear" | "area";

interface UnitDef {
  label: string;
  toBase: number; // multiply by this to get base unit (metres or sq metres)
}

const UNITS: Record<UnitCategory, UnitDef[]> = {
  linear: [
    { label: "ft", toBase: 0.3048 },
    { label: "m", toBase: 1 },
    { label: "mi", toBase: 1609.344 },
    { label: "km", toBase: 1000 },
  ],
  area: [
    { label: "sq ft", toBase: 0.09290304 },
    { label: "sq m", toBase: 1 },
    { label: "acre", toBase: 4046.8564224 },
    { label: "ha", toBase: 10000 },
  ],
};

// ── Component ──────────────────────────────────────────────────
export default function BasicCalculator({ onClose }: Props) {
  const [mode, setMode] = useState<"calc" | "convert">("calc");

  // ── Calculator state ─────────────────────────────────────────
  const [display, setDisplay] = useState("0");
  const [operand1, setOperand1] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand2, setWaitingForOperand2] = useState(false);

  // ── Terminal history ───────────────────────────────────────
  type HistoryLine = { text: string; op?: string; isSep?: boolean; isResult?: boolean };
  const [history, setHistory] = useState<HistoryLine[]>([]);
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  // ── Converter state ──────────────────────────────────────────
  const [category, setCategory] = useState<UnitCategory>("area");
  const [fromUnit, setFromUnit] = useState(0);
  const [toUnit, setToUnit] = useState(1);
  const [convInput, setConvInput] = useState("1");

  const convResult = (() => {
    const val = parseFloat(convInput);
    if (isNaN(val)) return "";
    const units = UNITS[category];
    const base = val * units[fromUnit].toBase;
    const result = base / units[toUnit].toBase;
    return parseFloat(result.toPrecision(10)).toString();
  })();

  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // ── Drag logic ──────────────────────────────────────────────
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragging = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    dragging.current = true;
    const rect = ref.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!pos) setPos({ x: rect.left, y: rect.top });
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const onUp = () => { dragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  // Auto-scroll terminal to bottom
  useLayoutEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [history, display]);

  /** Format a number string with comma separators for display. */
  const fmtDisplay = (s: string) => {
    if (s === "Error" || s.includes("e")) return s;
    const parts = s.split(".");
    const intPart = parts[0].replace(/^-/, "");
    return (s.startsWith("-") ? "-" : "") + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (parts.length > 1 ? "." + parts[1] : "");
  };

  const MAX_DIGITS = 12;

  /** Count significant digits (ignoring sign and decimal point). */
  const digitCount = (s: string) => s.replace(/[-.]/, "").length;

  /** Format a computation result to fit within MAX_DIGITS.
   *  Like a real scientific calculator: use fixed notation if it fits,
   *  otherwise switch to scientific notation. */
  const formatResult = useCallback((n: number): string => {
    if (isNaN(n)) return "Error";
    if (!isFinite(n)) return "Error";
    // Try fixed representation
    const fixed = String(parseFloat(n.toPrecision(MAX_DIGITS)));
    if (digitCount(fixed) <= MAX_DIGITS) return fixed;
    // Too long — use scientific notation that fits in 12 chars
    for (let p = MAX_DIGITS; p >= 1; p--) {
      const sci = n.toExponential(p - 1);
      if (sci.length <= MAX_DIGITS + 1) return sci; // +1 for the 'e'
    }
    return n.toExponential(5);
  }, []);

  // ── Calculator logic ─────────────────────────────────────────
  const inputDigit = useCallback((d: string) => {
    if (waitingForOperand2) {
      setDisplay(d);
      setWaitingForOperand2(false);
    } else {
      setDisplay(prev => {
        if (prev === "0") return d;
        // Limit input to MAX_DIGITS (sign and dot don't count)
        if (digitCount(prev) >= MAX_DIGITS) return prev;
        return prev + d;
      });
    }
  }, [waitingForOperand2]);

  const inputDot = useCallback(() => {
    if (waitingForOperand2) { setDisplay("0."); setWaitingForOperand2(false); return; }
    if (!display.includes(".")) setDisplay(prev => prev + ".");
  }, [waitingForOperand2, display]);

  const clear = useCallback(() => {
    setDisplay("0"); setOperand1(null); setOperator(null); setWaitingForOperand2(false);
    setHistory([]); setPendingOp(null);
  }, []);

  // Escape: clear first, close second
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (display !== "0" || history.length > 0 || operand1 !== null) {
          clear();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, display, history, operand1, clear]);

  const toggleSign = useCallback(() => {
    setDisplay(prev => prev.startsWith("-") ? prev.slice(1) : prev === "0" ? "0" : "-" + prev);
  }, []);

  const percent = useCallback(() => {
    setDisplay(prev => formatResult(parseFloat(prev) / 100));
  }, [formatResult]);

  const calculate = useCallback((op1: number, op: string, op2: number): number => {
    switch (op) {
      case "+": return op1 + op2;
      case "-": return op1 - op2;
      case "×": return op1 * op2;
      case "÷": return op2 !== 0 ? op1 / op2 : NaN;
      default: return op2;
    }
  }, []);

  const handleOperator = useCallback((nextOp: string) => {
    const val = parseFloat(display);
    if (operand1 !== null && operator && !waitingForOperand2) {
      const result = calculate(operand1, operator, val);
      const resultStr = formatResult(result);
      setHistory(prev => [
        ...prev,
        { text: fmtDisplay(display), op: pendingOp ?? undefined },
        { isSep: true, text: "" },
        { text: fmtDisplay(resultStr), isResult: true },
      ]);
      setDisplay(resultStr); setOperand1(resultStr === "Error" ? null : result);
    } else {
      setHistory(prev => [
        ...prev,
        { text: fmtDisplay(display), op: pendingOp ?? undefined },
      ]);
      setOperand1(val);
    }
    setPendingOp(nextOp);
    setDisplay("0"); setOperator(nextOp); setWaitingForOperand2(true);
  }, [display, operand1, operator, waitingForOperand2, calculate, formatResult, pendingOp]);

  const handleEquals = useCallback(() => {
    if (operand1 === null || !operator) return;
    const val = parseFloat(display);
    const result = calculate(operand1, operator, val);
    const resultStr = formatResult(result);
    setHistory(prev => [
      ...prev,
      { text: fmtDisplay(display), op: pendingOp ?? undefined },
      { isSep: true, text: "" },
      { text: fmtDisplay(resultStr), isResult: true },
    ]);
    setPendingOp(null);
    setDisplay(resultStr); setOperand1(null); setOperator(null); setWaitingForOperand2(true);
  }, [display, operand1, operator, calculate, formatResult, pendingOp]);

  // Stable refs for keyboard handler — avoids re-registering listener on every render
  const fnRef = useRef({ inputDigit, inputDot, handleOperator, handleEquals, clear, percent, setDisplay });
  fnRef.current = { inputDigit, inputDot, handleOperator, handleEquals, clear, percent, setDisplay };

  // Keyboard support (calc mode only) — single stable listener
  useEffect(() => {
    if (mode !== "calc" || !focused) return;
    const handler = (e: KeyboardEvent) => {
      const fn = fnRef.current;
      let handled = true;
      if (e.key >= "0" && e.key <= "9") fn.inputDigit(e.key);
      else if (e.key === ".") fn.inputDot();
      else if (e.key === "+" || e.key === "-") fn.handleOperator(e.key);
      else if (e.key === "*") fn.handleOperator("×");
      else if (e.key === "/") fn.handleOperator("÷");
      else if (e.key === "Enter" || e.key === "=") fn.handleEquals();
      else if (e.key === "Backspace") fn.setDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : "0");
      else if (e.key === "c" || e.key === "C" || e.key === "Delete") fn.clear();
      else if (e.key === "%") fn.percent();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [mode, focused]);

  // ── Styles ───────────────────────────────────────────────────
  const btnBase = "flex items-center justify-center rounded-lg font-medium h-11 text-base select-none transition-transform duration-75 active:scale-[0.85] active:shadow-inner";
  const btnNum = `${btnBase} bg-[var(--color-bg-base)] hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]`;
  const btnOp = `${btnBase} bg-[var(--color-bg-base)] hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-lg`;
  const btnFn = `${btnBase} bg-[var(--color-border)] hover:bg-[var(--color-accent)]/10 active:bg-[var(--color-accent)]/30 text-[var(--color-text-secondary)]`;
  const btnEq = `${btnBase} bg-[var(--color-accent)] hover:brightness-110 active:brightness-75 active:scale-[0.85] text-[var(--color-bg-base)] font-bold text-lg`;

  const buttons = [
    { label: "C", cls: btnFn, action: clear },
    { label: "±", cls: btnFn, action: toggleSign },
    { label: "%", cls: btnFn, action: percent },
    { label: "÷", cls: btnOp, action: () => handleOperator("÷") },
    { label: "7", cls: btnNum, action: () => inputDigit("7") },
    { label: "8", cls: btnNum, action: () => inputDigit("8") },
    { label: "9", cls: btnNum, action: () => inputDigit("9") },
    { label: "×", cls: btnOp, action: () => handleOperator("×") },
    { label: "4", cls: btnNum, action: () => inputDigit("4") },
    { label: "5", cls: btnNum, action: () => inputDigit("5") },
    { label: "6", cls: btnNum, action: () => inputDigit("6") },
    { label: "-", cls: btnOp, action: () => handleOperator("-") },
    { label: "1", cls: btnNum, action: () => inputDigit("1") },
    { label: "2", cls: btnNum, action: () => inputDigit("2") },
    { label: "3", cls: btnNum, action: () => inputDigit("3") },
    { label: "+", cls: btnOp, action: () => handleOperator("+") },
    { label: "0", cls: btnNum, action: () => inputDigit("0"), span: 2 },
    { label: ".", cls: btnNum, action: inputDot },
    { label: "=", cls: btnEq, action: handleEquals },
  ];

  const selectCls = "rounded-lg px-2 py-1.5 text-xs border bg-[var(--color-bg-base)] text-[var(--color-text-primary)] border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]";

  return (
    <div
      ref={ref}
      tabIndex={-1}
      onMouseDown={() => setFocused(true)}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setFocused(false); }}
      className="rounded-xl border shadow-2xl p-3 z-50 outline-none"
      style={{
        background: "var(--color-bg-surface)",
        borderColor: focused ? "var(--color-accent)" : "var(--color-border)",
        width: 240,
        ...(pos ? { position: "fixed" as const, left: pos.x, top: pos.y } : {}),
      }}
    >
      {/* Header (drag handle) */}
      <div
        className="flex items-center justify-between mb-2 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onDragStart}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          {mode === "calc" ? "Calculator" : "Unit Convert"}
        </span>
        <div className="flex items-center gap-1">
          {/* Keyboard shortcut info */}
          <div className="relative group">
            <button
              className="flex items-center justify-center w-5 h-5 rounded transition-colors hover:bg-[var(--color-accent)]/10"
              style={{ color: "var(--color-text-secondary)" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
            <div className="absolute right-0 top-6 w-44 rounded-lg border p-2 text-[10px] leading-relaxed opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 shadow-lg"
              style={{ background: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              <div className="font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>Keyboard Shortcuts</div>
              <div><b>0-9 .</b> &nbsp;Input</div>
              <div><b>+ - * /</b> &nbsp;Operators</div>
              <div><b>Enter =</b> &nbsp;Equals</div>
              <div><b>Backspace</b> &nbsp;Delete digit</div>
              <div><b>C / Delete</b> &nbsp;Clear all</div>
              <div><b>Esc</b> &nbsp;Clear → Close</div>
              <div><b>%</b> &nbsp;Percent</div>
              <div className="mt-1 italic">Click calculator to capture keys</div>
            </div>
          </div>
          {/* Toggle mode */}
          <button
            onClick={() => setMode(prev => prev === "calc" ? "convert" : "calc")}
            className="flex items-center justify-center w-5 h-5 rounded transition-colors hover:bg-[var(--color-accent)]/10"
            style={{ color: mode === "convert" ? "var(--color-accent)" : "var(--color-text-secondary)" }}
            title={mode === "calc" ? "Switch to unit converter" : "Switch to calculator"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 3 7 9 1 9" /><path d="M21 21a9 9 0 0 0-15-6.7L1 9" />
              <polyline points="17 21 17 15 23 15" /><path d="M3 3a9 9 0 0 0 15 6.7L23 15" />
            </svg>
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-5 h-5 rounded transition-colors hover:bg-[var(--color-accent)]/10"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {mode === "calc" ? (
        <>
          {/* Terminal display */}
          <div
            ref={termRef}
            className="rounded-lg px-3 py-1.5 mb-3 font-mono text-sm overflow-y-auto flex flex-col justify-end"
            style={{ background: "var(--color-bg-base)", height: 154 }}
          >
            {history.map((line, i) => (
              <div
                key={i}
                className="leading-5 shrink-0 flex justify-between"
                style={{
                  color: line.isResult ? "var(--color-accent)" : "var(--color-text-secondary)",
                  fontSize: line.isSep ? 10 : undefined,
                }}
              >
                {line.isSep ? (
                  <div className="w-full text-center" style={{ color: "var(--color-accent)" }}>─────────────────</div>
                ) : (
                  <>
                    <span className="text-xs w-4 shrink-0" style={{ color: "var(--color-accent)" }}>{line.op || ""}</span>
                    <span>{line.text}</span>
                  </>
                )}
              </div>
            ))}
            {/* Current input line — always at bottom */}
            <div className="leading-5 flex justify-between text-base font-semibold shrink-0">
              <span className="text-xs w-4 shrink-0 self-center" style={{ color: "var(--color-accent)" }}>{pendingOp || ""}</span>
              <span style={{ color: "var(--color-text-primary)" }}>{fmtDisplay(display)}</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            {buttons.map((b) => (
              <button
                key={b.label}
                onClick={b.action}
                className={b.cls}
                style={b.span ? { gridColumn: `span ${b.span}` } : undefined}
              >
                {b.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        /* ── Unit Converter ─────────────────────────────────────── */
        <div className="flex flex-col gap-3">
          {/* Category toggle */}
          <div className="flex gap-1">
            {(["linear", "area"] as UnitCategory[]).map(cat => (
              <button
                key={cat}
                onClick={() => { setCategory(cat); setFromUnit(0); setToUnit(1); setConvInput("1"); }}
                className="flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: category === cat ? "var(--color-accent)" : "var(--color-bg-base)",
                  color: category === cat ? "var(--color-bg-base)" : "var(--color-text-secondary)",
                }}
              >
                {cat === "linear" ? "Linear" : "Area"}
              </button>
            ))}
          </div>

          {/* Input */}
          <div>
            <input
              type="text"
              inputMode="decimal"
              value={convInput}
              onChange={e => setConvInput(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-right font-mono text-lg border bg-[var(--color-bg-base)] text-[var(--color-text-primary)] border-[var(--color-border)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {/* From / swap / To */}
          <div className="flex items-center gap-2">
            <select value={fromUnit} onChange={e => setFromUnit(Number(e.target.value))} className={`${selectCls} flex-1`}>
              {UNITS[category].map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}
            </select>

            <button
              onClick={() => { setFromUnit(toUnit); setToUnit(fromUnit); setConvInput(convResult || "1"); }}
              className="flex items-center justify-center w-7 h-7 rounded-full transition-colors hover:bg-[var(--color-accent)]/10 shrink-0"
              style={{ color: "var(--color-accent)" }}
              title="Swap units"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" />
              </svg>
            </button>

            <select value={toUnit} onChange={e => setToUnit(Number(e.target.value))} className={`${selectCls} flex-1`}>
              {UNITS[category].map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}
            </select>
          </div>

          {/* Result */}
          <div
            className="rounded-lg px-3 py-2 text-right font-mono text-lg"
            style={{ background: "var(--color-bg-base)", color: "var(--color-accent)", minHeight: 44 }}
          >
            {convResult || "—"} <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{UNITS[category][toUnit].label}</span>
          </div>

          {/* Quick reference */}
          <div className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            {category === "area" ? (
              <>1 acre = 43,560 sq ft · 1 ha = 2.471 acres</>
            ) : (
              <>1 ft = 0.3048 m · 1 mi = 1.609 km</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

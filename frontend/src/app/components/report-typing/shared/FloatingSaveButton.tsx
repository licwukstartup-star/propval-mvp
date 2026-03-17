"use client"

interface FloatingSaveButtonProps {
  saving: boolean
  saveFlash: "ok" | "err" | null
  onSave: () => Promise<void>
}

export default function FloatingSaveButton({ saving, saveFlash, onSave }: FloatingSaveButtonProps) {
  const label = saving ? "Auto-saving…" : saveFlash === "ok" ? "Saved" : saveFlash === "err" ? "Save failed" : "Save Draft"

  return (
    <button
      onClick={onSave}
      disabled={saving}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3.5 py-2 rounded-lg shadow-lg transition-all duration-200"
      style={{
        background: saveFlash === "ok" ? "var(--color-status-success)" : saveFlash === "err" ? "var(--color-status-danger)" : "var(--color-accent)",
        color: "var(--color-bg-base)",
        fontWeight: 700,
        fontSize: "11px",
        boxShadow: `0 0 20px ${saveFlash === "ok" ? "color-mix(in srgb, var(--color-status-success) 27%, transparent)" : saveFlash === "err" ? "color-mix(in srgb, var(--color-status-danger) 27%, transparent)" : "color-mix(in srgb, var(--color-accent) 27%, transparent)"}, 0 4px 12px rgba(0,0,0,0.4)`,
        opacity: saving ? 0.7 : 1,
      }}
    >
      {saving ? (
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
      ) : saveFlash === "ok" ? (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      ) : saveFlash === "err" ? (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      ) : (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
      )}
      {label}
    </button>
  )
}

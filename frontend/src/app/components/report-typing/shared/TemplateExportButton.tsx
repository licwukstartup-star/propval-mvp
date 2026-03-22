"use client"

/**
 * TemplateExportButton — dropdown button for exporting with a saved template.
 *
 * Fetches user's templates, shows a picker, then calls the backend
 * /api/templates/generate-report endpoint to produce a .docx.
 *
 * Self-contained — can be dropped into any toolbar.
 */

import { useState, useCallback, useEffect, useRef } from "react"
import { API_BASE } from "@/lib/constants"
import type { ReportTypingState } from "../types"

interface TemplateOption {
  id: string
  name: string
  source: string
  is_default: boolean
}

interface TemplateExportButtonProps {
  state: ReportTypingState
  session: { access_token: string } | null
}

export default function TemplateExportButton({ state, session }: TemplateExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  // Fetch templates when dropdown opens
  const handleOpen = useCallback(async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (templates.length > 0) return // already loaded

    if (!session?.access_token) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${API_BASE}/api/templates`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) throw new Error("Failed to load templates")
      const data = await resp.json()
      setTemplates(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [open, templates.length, session?.access_token])

  // Export with selected template
  const handleExport = useCallback(async (templateId: string) => {
    if (!session?.access_token || exporting) return
    setExporting(templateId)
    setError(null)

    // Save current work first
    try { await state.handleSave() } catch { /* continue even if save fails */ }

    // Build content payload from current state
    const content = {
      metadata: state.meta,
      valuer_inputs: state.valuer,
      ai_sections: state.aiSections,
      comparables: state.adoptedComparables.map((c: any) => ({
        address: c.address,
        postcode: c.postcode,
        price: c.price,
        date: c.transaction_date,
        type: c.property_type,
        area: c.floor_area_sqm,
        price_per_sqm: c.floor_area_sqm ? Math.round(c.price / c.floor_area_sqm) : null,
      })),
      property: {
        address: state.result?.address || "",
        postcode: state.result?.postcode || "",
        property_type: state.result?.property_type || "",
        built_form: state.result?.built_form || "",
        construction_age_band: state.result?.construction_age_band || "",
        floor_area_m2: state.result?.floor_area_m2 || null,
        energy_rating: state.result?.energy_rating || "",
        energy_score: state.result?.energy_score || "",
        tenure: state.result?.tenure || "",
        council_tax_band: state.result?.council_tax_band || "",
        sales: state.result?.sales || [],
      },
      firm_template: state.firmTemplate || {},
    }

    try {
      const resp = await fetch(`${API_BASE}/api/templates/generate-report`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          template_id: templateId,
          content,
        }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.detail || `Export failed (${resp.status})`)
      }

      // Download the blob
      const blob = await resp.blob()
      const address = state.result?.address || "Report"
      const today = new Date().toISOString().slice(0, 10)
      const filename = `${address} - PropVal Report ${today}.docx`

      // Try native file picker, fallback to link download
      if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: filename,
            types: [{
              description: "Word Document",
              accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
            }],
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          setOpen(false)
          return
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            setExporting(null)
            return
          }
        }
      }

      // Fallback: create download link
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setOpen(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(null)
    }
  }, [session?.access_token, exporting, state])

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
        style={{
          borderColor: "color-mix(in srgb, var(--color-status-success, #16A34A) 27%, transparent)",
          color: "var(--color-status-success, #16A34A)",
          backgroundColor: open
            ? "color-mix(in srgb, var(--color-status-success, #16A34A) 12%, transparent)"
            : "color-mix(in srgb, var(--color-status-success, #16A34A) 7%, transparent)",
        }}
        title="Export using a saved template"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        Template
        <svg className={`w-2.5 h-2.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-xl border shadow-lg z-50 overflow-hidden"
          style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)" }}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-base)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
              Export with Template
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 text-[10px]" style={{ color: "var(--color-status-danger, #DC2626)" }}>
              {error}
            </div>
          )}

          {/* Loading */}
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
            </div>
          ) : templates.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>No templates found</p>
              <p className="text-[10px] mt-1" style={{ color: "var(--color-text-muted)" }}>
                Create one in the Templates tab first
              </p>
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleExport(t.id)}
                  disabled={exporting !== null}
                  className="w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors border-b last:border-b-0 disabled:opacity-50"
                  style={{ borderColor: "var(--color-border)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-base)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent" }}
                >
                  {/* Template icon */}
                  <svg className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>

                  {/* Template info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
                      {t.name}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                      {t.source === "system" ? "System" : t.source === "uploaded" ? "Imported" : "Custom"}
                      {t.is_default ? " · Default" : ""}
                    </p>
                  </div>

                  {/* Loading state for this template */}
                  {exporting === t.id ? (
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
                      style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
                  ) : (
                    <svg className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

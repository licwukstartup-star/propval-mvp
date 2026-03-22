"use client"

import { useState, useEffect, useCallback } from "react"
import DOMPurify from "dompurify"
import { API_BASE } from "@/lib/constants"

interface CopyItem {
  id: string
  case_id: string
  version: number
  label: string
  status: string
  created_by: string
  created_at: string
}

interface CopyPoolPanelProps {
  caseId: string
  session?: { access_token: string } | null
  onClose: () => void
  copyFlash?: "ok" | "err" | null
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft", color: "var(--color-text-secondary)", bg: "var(--color-bg-hover)" },
  ready_for_review: { label: "Ready", color: "#007AFF", bg: "color-mix(in srgb, #007AFF 12%, transparent)" },
  under_review: { label: "In Review", color: "#FF9500", bg: "color-mix(in srgb, #FF9500 12%, transparent)" },
  revision_requested: { label: "Changes Needed", color: "#FF3B30", bg: "color-mix(in srgb, #FF3B30 12%, transparent)" },
  approved: { label: "Approved", color: "#34C759", bg: "color-mix(in srgb, #34C759 12%, transparent)" },
  final: { label: "Final Report", color: "#1D1D1F", bg: "color-mix(in srgb, #34C759 20%, transparent)" },
}

export default function CopyPoolPanel({ caseId, session, onClose, copyFlash }: CopyPoolPanelProps) {
  const [copies, setCopies] = useState<CopyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchCopies = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/cases/${caseId}/copies`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error("Could not load report copies")
      const data = await res.json()
      setCopies(data.copies || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load report copies")
    } finally {
      setLoading(false)
    }
  }, [caseId, session])

  useEffect(() => { fetchCopies() }, [fetchCopies, copyFlash])

  const loadPreview = useCallback(async (copyId: string) => {
    if (!session?.access_token) return
    if (previewId === copyId) { setPreviewId(null); setPreviewHtml(null); return }
    setPreviewId(copyId)
    setPreviewLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/copies/${copyId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error("Failed to load copy")
      const data = await res.json()
      setPreviewHtml(data.editor_html || "")
    } catch {
      setPreviewHtml("<p>Failed to load preview</p>")
    } finally {
      setPreviewLoading(false)
    }
  }, [session, previewId])

  const deleteCopy = useCallback(async (copyId: string) => {
    if (!session?.access_token) return
    try {
      const res = await fetch(`${API_BASE}/api/copies/${copyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error("Failed to delete")
      setCopies(prev => prev.filter(c => c.id !== copyId))
      if (previewId === copyId) { setPreviewId(null); setPreviewHtml(null) }
      setDeleteConfirmId(null)
    } catch {
      setDeleteConfirmId(null)
    }
  }, [session, previewId])

  const downloadPdf = useCallback(async (copyId: string, label: string) => {
    if (!session?.access_token) return
    try {
      const res = await fetch(`${API_BASE}/api/copies/${copyId}/pdf`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error("PDF generation failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${label}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // PDF generation may not be available
    }
  }, [session])

  const updateStatus = useCallback(async (copyId: string, newStatus: string) => {
    if (!session?.access_token) return
    try {
      const res = await fetch(`${API_BASE}/api/copies/${copyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error("Failed to update")
      const updated = await res.json()
      setCopies(prev => prev.map(c => c.id === copyId ? { ...c, status: updated.status, label: updated.label } : c))
    } catch {
      // silently fail
    }
  }, [session])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="flex flex-col border-l overflow-hidden" style={{ width: 280, borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--color-text-primary)" }}>
          Report Copies
        </h3>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors" aria-label="Close copies panel">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" style={{ color: "var(--color-text-secondary)" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
            <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Loading copies...</p>
          </div>
        )}
        {error && (
          <div className="text-center py-4 space-y-2">
            <p className="text-xs" style={{ color: "var(--color-status-error)" }}>{error}</p>
            <button onClick={fetchCopies} className="text-[10px] px-2 py-0.5 rounded border transition-colors" style={{ borderColor: "var(--color-border)", color: "var(--color-accent)" }}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && copies.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1" style={{ color: "var(--color-text-secondary)" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>No saved versions yet</p>
            <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Click "Save Copy" in the toolbar to save your first draft</p>
          </div>
        )}
        {copies.map(copy => {
          const badge = STATUS_BADGE[copy.status] || STATUS_BADGE.draft
          const isExpanded = previewId === copy.id

          return (
            <div key={copy.id} className="rounded-lg border transition-all" style={{ borderColor: isExpanded ? "var(--color-accent)" : "var(--color-border)", backgroundColor: "var(--color-bg-surface)" }}>
              {/* Copy card header — clickable with chevron */}
              <button
                onClick={() => loadPreview(copy.id)}
                className="w-full text-left px-2.5 py-2.5 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {/* Chevron indicator */}
                  <svg
                    className="w-3 h-3 shrink-0 transition-transform"
                    style={{ color: "var(--color-text-secondary)", transform: isExpanded ? "rotate(90deg)" : "rotate(0)" }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-xs font-medium truncate flex-1" style={{ color: "var(--color-text-primary)" }}>
                    {copy.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0" title={copy.status.replace(/_/g, " ")} style={{ color: badge.color, backgroundColor: badge.bg }}>
                    {badge.label}
                  </span>
                </div>
                <div className="text-[10px] pl-[18px]" style={{ color: "var(--color-text-secondary)" }}>
                  v{copy.version} &middot; {formatDate(copy.created_at)}
                </div>
              </button>

              {/* Expanded: preview + actions */}
              {isExpanded && (
                <div className="px-2.5 pb-2.5 space-y-2">
                  {previewLoading ? (
                    <div className="flex items-center justify-center py-4 gap-2">
                      <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
                      <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Loading preview...</span>
                    </div>
                  ) : previewHtml ? (
                    <div
                      className="rounded border p-2 max-h-48 overflow-y-auto text-[10px] leading-relaxed"
                      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-hover)", color: "var(--color-text-primary)" }}
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml.slice(0, 4000) + (previewHtml.length > 4000 ? "<p style='color:#999;text-align:center'>... preview truncated ...</p>" : "")) }}
                    />
                  ) : null}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {copy.status === "draft" && (
                      <button
                        onClick={() => updateStatus(copy.id, "ready_for_review")}
                        className="text-[10px] px-2 py-1 rounded border transition-colors"
                        style={{ borderColor: "color-mix(in srgb, #007AFF 27%, transparent)", color: "#007AFF" }}
                      >
                        Mark Ready
                      </button>
                    )}
                    <button
                      onClick={() => downloadPdf(copy.id, copy.label)}
                      className="text-[10px] px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: "color-mix(in srgb, var(--color-accent) 27%, transparent)", color: "var(--color-accent)" }}
                    >
                      PDF
                    </button>
                    {copy.status === "draft" && (
                      <>
                        {deleteConfirmId === copy.id ? (
                          <div className="flex items-center gap-1 ml-auto">
                            <span className="text-[9px]" style={{ color: "var(--color-status-error)" }}>Delete?</span>
                            <button
                              onClick={() => deleteCopy(copy.id)}
                              className="text-[9px] px-1.5 py-0.5 rounded font-medium text-white transition-colors"
                              style={{ backgroundColor: "var(--color-status-error)" }}
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-[9px] px-1.5 py-0.5 rounded border transition-colors"
                              style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(copy.id)}
                            className="text-[10px] px-2 py-1 rounded border transition-colors ml-auto"
                            style={{ borderColor: "color-mix(in srgb, var(--color-status-error) 27%, transparent)", color: "var(--color-status-error)" }}
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t text-center" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
          {copies.length} {copies.length === 1 ? "version" : "versions"} saved
        </p>
      </div>
    </div>
  )
}

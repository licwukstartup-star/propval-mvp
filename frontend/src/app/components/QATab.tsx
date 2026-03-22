"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import DOMPurify from "dompurify"
import { API_BASE } from "@/lib/constants"

interface QATabProps {
  caseId?: string | null
  session?: { access_token: string } | null
  result?: any
  adoptedComparables?: any[]
}

interface CopyItem {
  id: string
  version: number
  label: string
  status: string
  created_at: string
}

interface QAFinding {
  severity: "error" | "warning" | "info"
  category: string
  location: string
  message: string
  suggestion: string
}

const SEVERITY_STYLE: Record<string, { color: string; bg: string }> = {
  error: { color: "#FF3B30", bg: "color-mix(in srgb, #FF3B30 10%, transparent)" },
  warning: { color: "#FF9500", bg: "color-mix(in srgb, #FF9500 10%, transparent)" },
  info: { color: "#007AFF", bg: "color-mix(in srgb, #007AFF 10%, transparent)" },
}

function SeverityIcon({ severity }: { severity: string }) {
  const cls = "w-4 h-4 shrink-0"
  switch (severity) {
    case "error":
      return <svg className={cls} style={{ color: "#FF3B30" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    case "warning":
      return <svg className={cls} style={{ color: "#FF9500" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
    default:
      return <svg className={cls} style={{ color: "#007AFF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  grammar: "Grammar",
  logic: "Logic",
  calculation: "Calculation",
  data_xref: "Data Cross-Ref",
  compliance: "RICS Compliance",
  contradiction: "Contradiction",
}

export default function QATab({ caseId, session, result, adoptedComparables }: QATabProps) {
  const [copies, setCopies] = useState<CopyItem[]>([])
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null)
  const [copyHtml, setCopyHtml] = useState<string | null>(null)
  const [findings, setFindings] = useState<QAFinding[]>([])
  const [loading, setLoading] = useState(false)
  const [qaRunning, setQaRunning] = useState(false)
  const [qaModel, setQaModel] = useState<string | null>(null)

  // Listen for deep link navigation events from notifications
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.copyId) setSelectedCopyId(detail.copyId)
    }
    window.addEventListener("propval-navigate-qa", handler)
    return () => window.removeEventListener("propval-navigate-qa", handler)
  }, [])

  // Fetch copies on mount
  useEffect(() => {
    if (!caseId || !session?.access_token) return
    const ac = new AbortController()
    fetch(`${API_BASE}/api/cases/${caseId}/copies`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: ac.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setCopies(d.copies || []))
      .catch(() => {})
    return () => ac.abort()
  }, [caseId, session])

  // Load selected copy HTML
  useEffect(() => {
    if (!selectedCopyId || !session?.access_token) { setCopyHtml(null); setFindings([]); setQaModel(null); return }
    const ac = new AbortController()
    setLoading(true)
    fetch(`${API_BASE}/api/copies/${selectedCopyId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: ac.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setCopyHtml(d.editor_html || ""))
      .catch(() => { if (!ac.signal.aborted) setCopyHtml("<p>Failed to load copy</p>") })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })

    // Also load latest QA results
    fetch(`${API_BASE}/api/qa/results/${selectedCopyId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: ac.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (d.qa_result) {
          setFindings(d.qa_result.findings || [])
          setQaModel(d.qa_result.model_used)
        } else {
          setFindings([])
          setQaModel(null)
        }
      })
      .catch(() => {})
    return () => ac.abort()
  }, [selectedCopyId, session])

  const runQA = useCallback(async () => {
    if (!selectedCopyId || !session?.access_token) return
    setQaRunning(true)
    setFindings([])
    try {
      // Build structured data from available props
      const structured: Record<string, unknown> = {}
      if (result) structured.property = result
      if (adoptedComparables?.length) {
        structured.comparables = adoptedComparables.map((c: any) => ({
          address: c.address || c.full_address,
          price: c.price || c.pricePaid,
          date: c.date || c.transactionDate,
          floor_area: c.floor_area || c.totalFloorArea,
          property_type: c.property_type || c.propertyType,
        }))
      }

      const res = await fetch(`${API_BASE}/api/qa/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ copy_id: selectedCopyId, structured_data: structured }),
      })
      if (!res.ok) throw new Error("QA failed")
      const data = await res.json()
      setFindings(data.findings || [])
      setQaModel(data.model_used)
    } catch {
      setFindings([{ severity: "error", category: "logic", location: "QA system", message: "Failed to run QA checks", suggestion: "Check your connection and try again" }])
    } finally {
      setQaRunning(false)
    }
  }, [selectedCopyId, session, result, adoptedComparables])

  const updateCopyStatus = useCallback(async (status: string) => {
    if (!selectedCopyId || !session?.access_token) return
    try {
      await fetch(`${API_BASE}/api/copies/${selectedCopyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status }),
      })
      setCopies(prev => prev.map(c => c.id === selectedCopyId ? { ...c, status } : c))
    } catch {}
  }, [selectedCopyId, session])

  // Review state — for both valuer (submit) and reviewer (approve/reject)
  const [activeReview, setActiveReview] = useState<{ id: string; status: string; requested_by: string; reviewer_id: string } | null>(null)
  const [reviewerAction, setReviewerAction] = useState<"approve" | "revision" | null>(null)
  const [reviewNotes, setReviewNotes] = useState("")
  const [actionLoading, setActionLoading] = useState(false)

  // Fetch active review for selected copy
  useEffect(() => {
    if (!selectedCopyId || !session?.access_token) { setActiveReview(null); return }
    // Check if there's a review request for this copy
    fetch(`${API_BASE}/api/reviews/mine`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const review = (d.reviews || []).find((r: any) => r.copy_id === selectedCopyId)
        setActiveReview(review || null)
      })
      .catch(() => setActiveReview(null))
  }, [selectedCopyId, session])

  const handleReviewAction = useCallback(async (action: "approve" | "revision") => {
    if (!activeReview || !session?.access_token) return
    setActionLoading(true)
    try {
      const endpoint = action === "approve"
        ? `${API_BASE}/api/reviews/${activeReview.id}/approve`
        : `${API_BASE}/api/reviews/${activeReview.id}/request-revision`
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ notes: reviewNotes || undefined }),
      })
      if (!res.ok) throw new Error("Action failed")
      // Refresh copies and review state
      setActiveReview(prev => prev ? { ...prev, status: action === "approve" ? "approved" : "revision_requested" } : null)
      setReviewerAction(null)
      setReviewNotes("")
      // Refresh copy list
      const copiesRes = await fetch(`${API_BASE}/api/cases/${caseId}/copies`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (copiesRes.ok) { const d = await copiesRes.json(); setCopies(d.copies || []) }
    } catch {}
    finally { setActionLoading(false) }
  }, [activeReview, session, reviewNotes, caseId])

  // Submit for review
  const [showReviewSubmit, setShowReviewSubmit] = useState(false)
  const [reviewers, setReviewers] = useState<{ user_id: string; full_name: string; role_title: string; role: string }[]>([])
  const [selectedReviewer, setSelectedReviewer] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!session?.access_token || !showReviewSubmit) return
    fetch(`${API_BASE}/api/reviews/eligible-reviewers`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setReviewers(d.reviewers || []))
      .catch(() => {})
  }, [session, showReviewSubmit])

  const submitForReview = useCallback(async () => {
    if (!selectedCopyId || !selectedReviewer || !session?.access_token) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ copy_id: selectedCopyId, reviewer_id: selectedReviewer }),
      })
      if (!res.ok) throw new Error("Failed to submit")
      setCopies(prev => prev.map(c => c.id === selectedCopyId ? { ...c, status: "under_review" } : c))
      setShowReviewSubmit(false)
    } catch {}
    finally { setSubmitting(false) }
  }, [selectedCopyId, selectedReviewer, session])

  // Counts
  const errorCount = findings.filter(f => f.severity === "error").length
  const warningCount = findings.filter(f => f.severity === "warning").length
  const infoCount = findings.filter(f => f.severity === "info").length

  if (!caseId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>No case selected</p>
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Save a case first, then create report copies to QA</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-[var(--color-accent)] text-sm tracking-[3px] uppercase">Quality Assurance</h2>
          <p className="text-xs text-[var(--color-text-secondary)]/70 mt-0.5">AI-assisted report review and compliance checking</p>
        </div>
      </div>

      {/* Copy selector */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg border" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)" }}>
        <label className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>Report Copy:</label>
        <select
          value={selectedCopyId || ""}
          onChange={e => setSelectedCopyId(e.target.value || null)}
          className="text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer flex-1"
          style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
        >
          <option value="">Select a copy...</option>
          {copies.map(c => (
            <option key={c.id} value={c.id}>
              {c.label} (v{c.version}) — {c.status.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        {selectedCopyId && (
          <button
            onClick={runQA}
            disabled={qaRunning}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)", color: "white", backgroundColor: "var(--color-accent)" }}
          >
            {qaRunning ? (
              <>
                <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} />
                Running...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Run QA
              </>
            )}
          </button>
        )}
      </div>

      {/* Split screen */}
      {selectedCopyId && (
        <div className="flex gap-3 rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", height: "calc(100vh - 230px)", minHeight: 400 }}>
          {/* LEFT: Report copy */}
          <div className="flex-1 flex flex-col border-r" style={{ borderColor: "var(--color-border)" }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)" }}>
              <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--color-text-primary)" }}>Report</span>
              {findings.length > 0 && (
                <div className="flex items-center gap-2">
                  {errorCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: "#FF3B30", backgroundColor: "color-mix(in srgb, #FF3B30 12%, transparent)" }}>{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
                  {warningCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: "#FF9500", backgroundColor: "color-mix(in srgb, #FF9500 12%, transparent)" }}>{warningCount} warning{warningCount !== 1 ? "s" : ""}</span>}
                  {infoCount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: "#007AFF", backgroundColor: "color-mix(in srgb, #007AFF 12%, transparent)" }}>{infoCount} info</span>}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#E8E8ED" }}>
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
                </div>
              ) : copyHtml ? (
                <div className="mx-auto my-3 bg-white shadow-md rounded" style={{ width: "min(210mm, calc(100% - 24px))", padding: "20mm", fontFamily: "Calibri, 'Segoe UI', sans-serif", fontSize: "11pt", lineHeight: 1.5, color: "#1D1D1F" }}>
                  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(copyHtml) }} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Select a copy to preview</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: QA Panel */}
          <div className="flex flex-col" style={{ width: 380, backgroundColor: "var(--color-bg-surface)" }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
              <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--color-text-primary)" }}>AI QA Findings</span>
              {qaModel && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-hover)" }}>{qaModel}</span>}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {qaRunning && (
                <div className="flex flex-col items-center justify-center py-12 space-y-3">
                  <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
                  <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>AI is reviewing your report...</p>
                  <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Checking grammar, logic, calculations, data, and compliance</p>
                </div>
              )}
              {!qaRunning && findings.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 space-y-2">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1" style={{ color: "var(--color-text-secondary)" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-xs font-medium" style={{ color: "var(--color-text-primary)" }}>No QA results yet</p>
                  <p className="text-[10px] text-center" style={{ color: "var(--color-text-secondary)" }}>Click "Run QA" to start AI quality assurance</p>
                </div>
              )}
              {!qaRunning && findings.map((f, i) => {
                const style = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.info
                return (
                  <div key={i} className="rounded-lg border p-2.5 space-y-1" style={{ borderColor: "var(--color-border)", backgroundColor: style.bg }}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5"><SeverityIcon severity={f.severity} /></span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ color: style.color, backgroundColor: "color-mix(in srgb, " + style.color + " 15%, transparent)" }}>
                            {f.severity.toUpperCase()}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-hover)" }}>
                            {CATEGORY_LABEL[f.category] || f.category}
                          </span>
                          {f.location && (
                            <span className="text-[9px] truncate" style={{ color: "var(--color-text-secondary)" }}>
                              {f.location}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-primary)" }}>{f.message}</p>
                        {f.suggestion && (
                          <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                            Suggestion: {f.suggestion}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Bottom actions — always show when a copy is selected */}
            {selectedCopyId && !qaRunning && (
              <div className="px-3 py-2 border-t space-y-1.5" style={{ borderColor: "var(--color-border)" }}>
                <p className="text-[9px] text-center" style={{ color: "var(--color-text-secondary)" }}>
                  {findings.length > 0 ? "Review findings and amend in Editor. When ready:" : "When your report is ready for review:"}
                </p>
                <div className="flex gap-2">
                  {!showReviewSubmit ? (
                    <>
                      <button
                        onClick={() => setShowReviewSubmit(true)}
                        className="flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors"
                        style={{ borderColor: "color-mix(in srgb, #34C759 40%, transparent)", color: "#34C759", backgroundColor: "color-mix(in srgb, #34C759 7%, transparent)" }}
                      >
                        Submit for Review
                      </button>
                      <button
                        onClick={runQA}
                        className="text-xs py-1.5 px-3 rounded-lg border transition-colors"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                      >
                        Re-run
                      </button>
                    </>
                  ) : (
                    <div className="w-full space-y-1.5">
                      <select
                        value={selectedReviewer || ""}
                        onChange={e => setSelectedReviewer(e.target.value || null)}
                        className="w-full text-xs px-2 py-1.5 rounded-lg border"
                        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}
                      >
                        <option value="">Select reviewer...</option>
                        {reviewers.map(r => (
                          <option key={r.user_id} value={r.user_id}>
                            {r.full_name || r.user_id.slice(0, 8)} — {r.role_title || r.role}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={submitForReview}
                          disabled={!selectedReviewer || submitting}
                          className="flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 text-white"
                          style={{ backgroundColor: "var(--color-accent)" }}
                        >
                          {submitting ? "Submitting..." : "Confirm & Submit"}
                        </button>
                        <button
                          onClick={() => setShowReviewSubmit(false)}
                          className="text-xs py-1.5 px-3 rounded-lg border transition-colors"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reviewer actions — shown when current user is the reviewer */}
            {activeReview && activeReview.status === "pending" && (
              <div className="px-3 py-2 border-t space-y-1.5" style={{ borderColor: "var(--color-border)" }}>
                <p className="text-[9px] font-medium text-center" style={{ color: "var(--color-text-primary)" }}>
                  You are the reviewer for this report
                </p>
                {!reviewerAction ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setReviewerAction("approve")}
                      className="flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors text-white"
                      style={{ backgroundColor: "#34C759" }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setReviewerAction("revision")}
                      className="flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors"
                      style={{ borderColor: "color-mix(in srgb, #FF9500 40%, transparent)", color: "#FF9500", backgroundColor: "color-mix(in srgb, #FF9500 7%, transparent)" }}
                    >
                      Request Revision
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
                      {reviewerAction === "approve" ? "Add approval notes (optional):" : "Describe what needs revision:"}
                    </p>
                    <textarea
                      value={reviewNotes}
                      onChange={e => setReviewNotes(e.target.value)}
                      placeholder={reviewerAction === "approve" ? "Optional notes..." : "What needs to change..."}
                      rows={2}
                      className="w-full text-xs px-2 py-1.5 rounded-lg border resize-none"
                      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)", color: "var(--color-text-primary)" }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReviewAction(reviewerAction)}
                        disabled={actionLoading || (reviewerAction === "revision" && !reviewNotes.trim())}
                        className="flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 text-white"
                        style={{ backgroundColor: reviewerAction === "approve" ? "#34C759" : "#FF9500" }}
                      >
                        {actionLoading ? "Processing..." : reviewerAction === "approve" ? "Confirm Approval" : "Send Revision Request"}
                      </button>
                      <button
                        onClick={() => { setReviewerAction(null); setReviewNotes("") }}
                        className="text-xs py-1.5 px-3 rounded-lg border transition-colors"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Review status indicator */}
            {activeReview && activeReview.status === "approved" && (
              <div className="px-3 py-2 border-t text-center" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex items-center justify-center gap-1.5">
                  <svg className="w-4 h-4" style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-medium" style={{ color: "#34C759" }}>Approved — Final Report created</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No copies state */}
      {!selectedCopyId && copies.length === 0 && (
        <div className="flex items-center justify-center rounded-lg border py-16" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)" }}>
          <div className="text-center space-y-2">
            <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1" style={{ color: "var(--color-text-secondary)" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>No report copies to QA</p>
            <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Go to Report Typing &rarr; Editor mode &rarr; click "Save Copy" to create a draft
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

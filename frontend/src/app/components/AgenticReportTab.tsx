"use client"

import { useState, useCallback } from "react"
import { API_BASE } from "@/lib/constants"

interface AgenticReportTabProps {
  caseId?: string | null
  session?: { access_token: string } | null
  result?: any
  adoptedComparables?: any[]
  semvOutput?: any
  marketContext?: any
  caseMetadata?: any
}

interface Narratives {
  location_description?: string
  development_description?: string
  building_description?: string
  property_summary?: string
  market_commentary?: string
  valuation_considerations?: string
}

interface VPS3Checklist {
  [key: string]: boolean
}

interface AgenticResult {
  narratives: Narratives
  populated_placeholders: Record<string, any>
  rics_self_audit: {
    vps3_checklist: VPS3Checklist
    notes: string
  }
  metadata: {
    provider: string
    model: string
    tokens_used: { input: number; output: number }
    generation_time_seconds: number
    cost: string
  }
  error?: string
}

const SECTION_TITLES: Record<string, string> = {
  location_description: "2.2 Location",
  development_description: "2.3 The Development",
  building_description: "2.3 The Building",
  property_summary: "2.3 The Property",
  market_commentary: "3.3 Market Commentary",
  valuation_considerations: "3.6 Valuation Considerations",
}

const SECTION_ORDER = [
  "location_description",
  "development_description",
  "building_description",
  "property_summary",
  "market_commentary",
  "valuation_considerations",
]

export default function AgenticReportTab({
  caseId, session, result, adoptedComparables, semvOutput, marketContext, caseMetadata,
}: AgenticReportTabProps) {
  const [agenticResult, setAgenticResult] = useState<AgenticResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateReport = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError(null)

    // Build case_data payload from available props
    const payload = {
      case: caseMetadata || {},
      subject_property: result || {},
      comparables: (adoptedComparables || []).map((c: any) => ({
        address: c.address,
        postcode: c.postcode,
        price: c.price,
        transaction_date: c.transaction_date,
        property_type: c.property_type,
        tenure: c.tenure,
        bedrooms: c.bedrooms,
        floor_area_sqm: c.floor_area_sqm,
        build_year: c.build_year,
        epc_rating: c.epc_rating,
        epc_score: c.epc_score,
        distance_m: c.distance_m,
        tier_label: c.tier_label,
        months_ago: c.months_ago,
        lease_remaining: c.lease_remaining,
      })),
      semv_output: semvOutput || {},
      market_context: marketContext || {},
    }

    try {
      const resp = await fetch(`${API_BASE}/api/agentic-report/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: "Unknown error" }))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }

      const data: AgenticResult = await resp.json()
      setAgenticResult(data)
    } catch (e: any) {
      setError(e.message || "Failed to generate report")
    } finally {
      setLoading(false)
    }
  }, [session, result, adoptedComparables, semvOutput, marketContext, caseMetadata])

  // No case state
  if (!result) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
            No property data loaded
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            Search for a property first, then generate an agentic report
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header + generate button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Agentic Report
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            AI generates the complete valuation report in one call — free tier
          </p>
        </div>
        <button
          onClick={generateReport}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: loading ? "var(--color-text-secondary)" : "#007AFF" }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating...
            </span>
          ) : agenticResult ? "Regenerate" : "Generate Report"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg text-sm" style={{
          backgroundColor: "color-mix(in srgb, #FF3B30 10%, transparent)",
          color: "#FF3B30",
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center space-y-3">
            <svg className="w-8 h-8 animate-spin mx-auto" style={{ color: "#007AFF" }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Agent is reasoning through the valuation...
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {agenticResult && !loading && (
        <>
          {/* Metadata bar */}
          <div className="flex flex-wrap gap-4 p-3 rounded-lg text-xs" style={{
            backgroundColor: "var(--color-bg-secondary)",
            color: "var(--color-text-secondary)",
          }}>
            <span>Provider: <strong style={{ color: "var(--color-text-primary)" }}>{agenticResult.metadata.provider}</strong></span>
            <span>Model: <strong style={{ color: "var(--color-text-primary)" }}>{agenticResult.metadata.model}</strong></span>
            <span>Time: <strong style={{ color: "var(--color-text-primary)" }}>{agenticResult.metadata.generation_time_seconds}s</strong></span>
            <span>Tokens: <strong style={{ color: "var(--color-text-primary)" }}>
              {agenticResult.metadata.tokens_used.input.toLocaleString()} in / {agenticResult.metadata.tokens_used.output.toLocaleString()} out
            </strong></span>
            <span>Cost: <strong style={{ color: "#34C759" }}>{agenticResult.metadata.cost}</strong></span>
          </div>

          {/* VPS 3 Audit Summary */}
          {agenticResult.rics_self_audit && (
            <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                  VPS 3 Self-Audit
                </span>
                {(() => {
                  const checklist = agenticResult.rics_self_audit.vps3_checklist || {}
                  const passed = Object.values(checklist).filter(Boolean).length
                  const total = Object.keys(checklist).length
                  const allPassed = passed === total
                  return (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                      backgroundColor: allPassed
                        ? "color-mix(in srgb, #34C759 15%, transparent)"
                        : "color-mix(in srgb, #FF9500 15%, transparent)",
                      color: allPassed ? "#34C759" : "#FF9500",
                    }}>
                      {passed}/{total} passed
                    </span>
                  )
                })()}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(agenticResult.rics_self_audit.vps3_checklist || {}).map(([key, ok]) => (
                  <span key={key} className="text-xs px-2 py-0.5 rounded" style={{
                    backgroundColor: ok
                      ? "color-mix(in srgb, #34C759 10%, transparent)"
                      : "color-mix(in srgb, #FF3B30 10%, transparent)",
                    color: ok ? "#34C759" : "#FF3B30",
                  }}>
                    {ok ? "\u2713" : "\u2717"} {key.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              {agenticResult.rics_self_audit.notes && (
                <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
                  {agenticResult.rics_self_audit.notes}
                </p>
              )}
            </div>
          )}

          {/* Narrative sections */}
          <div className="space-y-4">
            {SECTION_ORDER.map((key) => {
              const raw = agenticResult.narratives[key as keyof Narratives]
              if (!raw) return null
              const text = typeof raw === "string" ? raw : JSON.stringify(raw)
              const words = text.split(/\s+/).length
              return (
                <div key={key} className="rounded-lg overflow-hidden" style={{
                  border: "1px solid var(--color-border)",
                }}>
                  <div className="px-4 py-2 flex items-center justify-between" style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderBottom: "1px solid var(--color-border)",
                  }}>
                    <h3 className="text-sm font-semibold" style={{ color: "#007AFF" }}>
                      {SECTION_TITLES[key] || key}
                    </h3>
                    <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      {words} words
                    </span>
                  </div>
                  <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-line" style={{
                    color: "var(--color-text-primary)",
                  }}>
                    {text}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Populated placeholders */}
          {agenticResult.populated_placeholders && (
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              <div className="px-4 py-2" style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderBottom: "1px solid var(--color-border)",
              }}>
                <h3 className="text-sm font-semibold" style={{ color: "#007AFF" }}>
                  Populated Placeholders
                </h3>
              </div>
              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(agenticResult.populated_placeholders).map(([key, val]) => (
                  <div key={key}>
                    <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                      {key.replace(/_/g, " ")}
                    </p>
                    <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                      {typeof val === "boolean" ? (val ? "Yes" : "No") :
                       typeof val === "number" ? (val >= 1000 ? `\u00A3${val.toLocaleString()}` : String(val)) :
                       String(val)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

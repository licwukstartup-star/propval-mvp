"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { FirmTemplate } from "../FirmTemplateSettings"
import type { Signatory } from "./shared/SignatorySelect"
import type { ReportMetadata, ValuerInputs, AiSectionKey, ReportContentData, ReportTypingProps, ReportTypingState, TemplateSchema, PanelConfig, ActiveReminder } from "./types"
import { EMPTY_META, EMPTY_VALUER } from "./constants"
import { calculateAllCompletions } from "./completion"
import { evaluateReminders } from "./panelMerge"
import { API_BASE } from "@/lib/constants"

export default function useReportTypingState({
  result, adoptedComparables, session, caseId, reportContent, onReportContentChange, onSave, valuationDate: parentValuationDate, activePanelSlug: parentPanelSlug, onPanelChange: parentOnPanelChange,
}: ReportTypingProps): ReportTypingState {
  /* ── Core state ───────────────────────────────────────────────────────── */
  const [meta, setMeta] = useState<ReportMetadata>({ ...EMPTY_META, ...reportContent?.metadata })
  const metaRef = useRef(meta)
  metaRef.current = meta

  const [aiSections, setAiSections] = useState<Partial<Record<AiSectionKey, string>>>(reportContent?.ai_sections ?? {})
  const [aiLoading, setAiLoading] = useState<Record<AiSectionKey, boolean>>({ location_description: false, subject_development: false, subject_building: false, subject_property: false, market_commentary: false, valuation_considerations: false })
  const [aiEditing, setAiEditingState] = useState<Record<AiSectionKey, boolean>>({ location_description: false, subject_development: false, subject_building: false, subject_property: false, market_commentary: false, valuation_considerations: false })

  // Track original AI outputs for feedback capture (data flywheel)
  const aiOriginalsRef = useRef<Partial<Record<AiSectionKey, string>>>({})

  const [valuer, setValuer] = useState<ValuerInputs>({ ...EMPTY_VALUER, ...reportContent?.valuer_inputs })

  const [saving, setSaving] = useState(false)
  const [saveFlash, setSaveFlash] = useState<"ok" | "err" | null>(null)
  const dirtyRef = useRef(false)

  const [firmTemplate, setFirmTemplate] = useState<FirmTemplate>({})
  const [showFirmSettings, setShowFirmSettingsRaw] = useState(false)
  const [firmSettingsTarget, setFirmSettingsTarget] = useState<string | null>(null)

  const setShowFirmSettings = useCallback((show: boolean) => {
    setShowFirmSettingsRaw(show)
    if (!show) setFirmSettingsTarget(null)
  }, [])

  const openFirmSettingsAt = useCallback((fieldKey: string) => {
    setFirmSettingsTarget(fieldKey)
    setShowFirmSettingsRaw(true)
  }, [])

  const [signatories, setSignatories] = useState<Signatory[]>([])
  const [showSignatorySettings, setShowSignatorySettings] = useState(false)

  /* ── Template schema (ARTG) ─────────────────────────────────────────── */
  const [templateSchema, setTemplateSchema] = useState<TemplateSchema | null>(null)
  const [templateName, setTemplateName] = useState<string | null>(null)

  /* ── Panel state ─────────────────────────────────────────────────────── */
  const [activePanel, setActivePanelState] = useState<PanelConfig | null>(null)
  const [availablePanels, setAvailablePanels] = useState<PanelConfig[]>([])

  /* ── Load firm template + signatories + report template + panels on mount */
  useEffect(() => {
    if (!session?.access_token) return
    const h = { Authorization: `Bearer ${session.access_token}` }
    fetch(`${API_BASE}/api/firm-templates`, { headers: h })
      .then(r => r.json())
      .then(data => setFirmTemplate(data))
      .catch(err => console.error("Failed to load firm template:", err))
    fetch(`${API_BASE}/api/firm-signatories`, { headers: h })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSignatories(data) })
      .catch(err => console.error("Failed to load signatories:", err))
    // Load available panels
    fetch(`${API_BASE}/api/panels`, { headers: h })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailablePanels(data) })
      .catch(err => console.error("Failed to load panels:", err))
    // Load default report template (or case-specific if template_id is set)
    fetch(`${API_BASE}/api/templates`, { headers: h })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then((templates: any[]) => {
        if (!Array.isArray(templates) || templates.length === 0) return
        const defaultTpl = templates.find((t: any) => t.is_default) || templates.find((t: any) => t.source === "system") || templates[0]
        if (defaultTpl?.id) {
          fetch(`${API_BASE}/api/templates/${defaultTpl.id}`, { headers: h })
            .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
            .then(full => {
              if (full?.schema) {
                setTemplateSchema(full.schema as TemplateSchema)
                setTemplateName(full.name || null)
              }
            })
            .catch(err => {
              console.error("Failed to load template schema:", err)
              setTemplateName(null)  // clear badge if schema failed
            })
        }
      })
      .catch(err => {
        console.error("Failed to load templates:", err)
        setTemplateName(null)
      })
  }, [session])

  /* ── Sync from parent ONLY on genuine case load (not our own edits) ── */
  const selfUpdateRef = useRef(false)
  const origOnReportContentChange = onReportContentChange
  // Wrap onReportContentChange to tag self-originated updates
  const wrappedOnReportContentChange = useCallback((partial: Partial<ReportContentData>) => {
    selfUpdateRef.current = true
    origOnReportContentChange?.(partial)
  }, [origOnReportContentChange])

  useEffect(() => {
    // Skip if this change was triggered by our own edits
    if (selfUpdateRef.current) {
      selfUpdateRef.current = false
      return
    }
    if (reportContent?.metadata) setMeta({ ...EMPTY_META, ...reportContent.metadata })
    if (reportContent?.ai_sections) setAiSections(reportContent.ai_sections)
    if (reportContent?.valuer_inputs) setValuer({ ...EMPTY_VALUER, ...reportContent.valuer_inputs })
  }, [reportContent])

  /* ── Echo valuation date from Direct Comparables tab ──────────────────── */
  useEffect(() => {
    if (parentValuationDate && parentValuationDate !== meta.valuation_date) {
      setMeta(prev => {
        const next = { ...prev, valuation_date: parentValuationDate }
        notifyParent({ metadata: next })
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentValuationDate])

  /* ── Debounced parent notification ────────────────────────────────────── */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyParent = useCallback((partialUpdate: Partial<ReportContentData>) => {
    dirtyRef.current = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      wrappedOnReportContentChange?.(partialUpdate)
    }, 800)
  }, [wrappedOnReportContentChange])

  /* ── Field update helpers ─────────────────────────────────────────────── */
  const updateMeta = useCallback((field: keyof ReportMetadata, value: string) => {
    setMeta(prev => {
      const next = { ...prev, [field]: value }
      notifyParent({ metadata: next })
      return next
    })
  }, [notifyParent])

  const updateValuer = useCallback(<K extends keyof ValuerInputs>(field: K, value: ValuerInputs[K]) => {
    setValuer(prev => {
      const next = { ...prev, [field]: value }
      notifyParent({ valuer_inputs: next })
      return next
    })
  }, [notifyParent])

  const updateValuerBatch = useCallback((updates: Partial<ValuerInputs>) => {
    setValuer(prev => {
      const next = { ...prev, ...updates }
      notifyParent({ valuer_inputs: next })
      return next
    })
  }, [notifyParent])

  /* ── Ref for immediate save (declared early for use in AI callbacks) ── */
  const savingRef = useRef(false)
  savingRef.current = saving
  const handleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())

  /* ── AI generation ────────────────────────────────────────────────────── */
  const generateAiSection = useCallback(async (key: AiSectionKey) => {
    console.log("[AI] generateAiSection called with key:", key)
    if (!session?.access_token || !result) { console.log("[AI] Early return — missing session or result"); return }
    setAiLoading(prev => ({ ...prev, [key]: true }))
    try {
      const body: Record<string, unknown> = { ...result, requested_section: key }
      // For valuation considerations, include adopted comparables and valuer inputs
      if (key === "valuation_considerations") {
        body.adopted_comparables = adoptedComparables
        body.market_value = valuer.market_value
        body.gia_sqm = valuer.gia_sqm || result?.floor_area_m2
      }
      console.log("[AI] Fetching from:", `${API_BASE}/api/property/ai-narrative`)
      const res = await fetch(`${API_BASE}/api/property/ai-narrative`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      })
      console.log("[AI] Response status:", res.status)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      console.log("[AI] Response keys:", Object.keys(data), "text length:", (data[key] || "").length)
      const text = data[key] || ""
      // Store original AI output for feedback capture
      aiOriginalsRef.current = { ...aiOriginalsRef.current, [key]: text }
      setAiSections(prev => {
        const next = { ...prev, [key]: text }
        dirtyRef.current = true
        queueMicrotask(() => wrappedOnReportContentChange?.({ ai_sections: next }))
        return next
      })
      // Immediate save after AI generation
      setTimeout(() => handleSaveRef.current(), 100)
    } catch (err) {
      console.error(`AI generation failed for ${key}:`, err)
    } finally {
      setAiLoading(prev => ({ ...prev, [key]: false }))
    }
  }, [session, result, adoptedComparables, valuer, wrappedOnReportContentChange])

  const saveAiEdit = useCallback((key: AiSectionKey, text: string) => {
    // ── Data flywheel: capture AI vs valuer delta ──
    const original = aiOriginalsRef.current[key]
    if (original && original.trim() !== text.trim() && session?.access_token) {
      fetch(`${API_BASE}/api/feedback/narrative`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          case_id: caseId ?? null,
          section_key: key,
          ai_output: original,
          valuer_output: text,
          property_type: result?.property_type ?? null,
          borough: result?.borough ?? result?.district ?? null,
        }),
      }).catch(() => {})  // fire-and-forget
    }

    setAiSections(prev => {
      const next = { ...prev, [key]: text }
      dirtyRef.current = true
      queueMicrotask(() => wrappedOnReportContentChange?.({ ai_sections: next }))
      return next
    })
    setAiEditingState(prev => ({ ...prev, [key]: false }))
    // Immediate save after AI edit
    setTimeout(() => handleSaveRef.current(), 100)
  }, [wrappedOnReportContentChange, session, caseId, result])

  const setAiEditing = useCallback((key: AiSectionKey, editing: boolean) => {
    setAiEditingState(prev => ({ ...prev, [key]: editing }))
  }, [])

  /* ── Firm template ────────────────────────────────────────────────────── */
  const handleFirmSaved = useCallback((t: FirmTemplate) => {
    setFirmTemplate(t)
    setShowFirmSettings(false)
    setFirmSettingsTarget(null)
  }, [])

  /* ── Save handler ─────────────────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    setSaveFlash(null)
    try {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        wrappedOnReportContentChange?.({ metadata: metaRef.current, ai_sections: aiSections, valuer_inputs: valuer })
      }
      await new Promise(r => setTimeout(r, 50))
      await onSave()
      dirtyRef.current = false
      setSaveFlash("ok")
    } catch {
      setSaveFlash("err")
    } finally {
      setSaving(false)
      setTimeout(() => setSaveFlash(null), 2000)
    }
  }, [onSave, wrappedOnReportContentChange, aiSections, valuer])

  /* ── Auto-save every 10 seconds when dirty ───────────────────────────── */
  handleSaveRef.current = handleSave

  useEffect(() => {
    if (!onSave) return
    const interval = setInterval(() => {
      if (dirtyRef.current && !savingRef.current) {
        handleSaveRef.current()
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [onSave])

  /* ── Save on exit (beforeunload, visibilitychange, pagehide) ────────── */
  useEffect(() => {
    if (!onSave) return

    const flushAndSave = () => {
      if (!dirtyRef.current) return
      // Flush any pending debounced parent notification synchronously
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        wrappedOnReportContentChange?.({ metadata: metaRef.current, ai_sections: aiSections, valuer_inputs: valuer })
      }
      dirtyRef.current = false
      try {
        handleSaveRef.current()
      } catch { /* best effort */ }
    }

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        flushAndSave()
        e.preventDefault()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushAndSave()
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pagehide", flushAndSave)

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pagehide", flushAndSave)
    }
  }, [onSave, wrappedOnReportContentChange, aiSections, valuer])

  /* ── Number-to-words ──────────────────────────────────────────────────── */
  const numberToWords = useCallback((n: number): string => {
    if (isNaN(n) || n === 0) return ""
    const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    const convert = (num: number): string => {
      if (num < 20) return ones[num]
      if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? "-" + ones[num % 10] : "")
      if (num < 1000) return ones[Math.floor(num / 100)] + " hundred" + (num % 100 ? " and " + convert(num % 100) : "")
      if (num < 1_000_000) return convert(Math.floor(num / 1000)) + " thousand" + (num % 1000 ? " " + convert(num % 1000) : "")
      return convert(Math.floor(num / 1_000_000)) + " million" + (num % 1_000_000 ? " " + convert(num % 1_000_000) : "")
    }
    return convert(n)
  }, [])

  /* ── Completion calculation ───────────────────────────────────────────── */
  const { sections: sectionCompletion, overall: overallCompletion } = useMemo(
    () => calculateAllCompletions(meta, valuer, aiSections, firmTemplate, result),
    [meta, valuer, aiSections, firmTemplate, result]
  )

  /* ── Panel switcher ─────────────────────────────────────────────────── */
  const setActivePanel = useCallback((slug: string | null) => {
    parentOnPanelChange?.(slug)
    if (!slug) {
      setActivePanelState(null)
      return
    }
    // Find from available panels (already fetched)
    const found = availablePanels.find(p => p.slug === slug)
    if (found) {
      // Need full config — fetch if not already loaded
      if (found.config) {
        setActivePanelState(found)
      } else if (session?.access_token) {
        fetch(`${API_BASE}/api/panels/${slug}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
          .then(r => r.json())
          .then(data => setActivePanelState(data))
          .catch(err => console.error("Failed to load panel config:", err))
      }
    }
  }, [availablePanels, session?.access_token, parentOnPanelChange])

  // Auto-set panel from parent (e.g. when loading a case with panel_id)
  useEffect(() => {
    if (parentPanelSlug && availablePanels.length > 0 && activePanel?.slug !== parentPanelSlug) {
      const found = availablePanels.find(p => p.slug === parentPanelSlug)
      if (found) {
        if (found.config) {
          setActivePanelState(found)
        } else if (session?.access_token) {
          fetch(`${API_BASE}/api/panels/${parentPanelSlug}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
            .then(r => r.json())
            .then(data => setActivePanelState(data))
            .catch(() => {})
        }
      }
    } else if (!parentPanelSlug && activePanel) {
      setActivePanelState(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentPanelSlug, availablePanels])

  /* ── Panel reminders (evaluated from inline_reminders + current state) */
  const panelReminders: ActiveReminder[] = useMemo(() => {
    if (!activePanel?.config) return []
    return evaluateReminders(activePanel.config, {
      comparables_count: adoptedComparables?.length || 0,
      comparables_ranked: false, // TODO: detect from comp ordering metadata
      fields: {
        condition_notes: valuer.condition_notes || "",
        market_commentary: aiSections.market_commentary || "",
      },
    })
  }, [activePanel, adoptedComparables?.length, valuer.condition_notes, aiSections.market_commentary])

  return {
    meta, valuer, aiSections, aiLoading, aiEditing, firmTemplate, signatories, showSignatorySettings, saving, saveFlash, showFirmSettings, firmSettingsTarget, templateSchema, templateName,
    activePanel, availablePanels, panelReminders, setActivePanel,
    updateMeta, updateValuer, updateValuerBatch, generateAiSection, saveAiEdit, setAiEditing,
    setShowFirmSettings, openFirmSettingsAt, setShowSignatorySettings, setSignatories, handleFirmSaved, handleSave, numberToWords,
    sectionCompletion, overallCompletion,
    result, adoptedComparables, caseId, onSave,
  }
}

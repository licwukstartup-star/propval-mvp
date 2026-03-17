"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { FirmTemplate } from "../FirmTemplateSettings"
import type { ReportMetadata, ValuerInputs, AiSectionKey, ReportContentData, ReportTypingProps, ReportTypingState } from "./types"
import { EMPTY_META, EMPTY_VALUER } from "./constants"
import { calculateAllCompletions } from "./completion"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export default function useReportTypingState({
  result, adoptedComparables, session, reportContent, onReportContentChange, onSave, valuationDate: parentValuationDate,
}: ReportTypingProps): ReportTypingState {
  /* ── Core state ───────────────────────────────────────────────────────── */
  const [meta, setMeta] = useState<ReportMetadata>({ ...EMPTY_META, ...reportContent?.metadata })
  const metaRef = useRef(meta)
  metaRef.current = meta

  const [aiSections, setAiSections] = useState<Partial<Record<AiSectionKey, string>>>(reportContent?.ai_sections ?? {})
  const [aiLoading, setAiLoading] = useState<Record<AiSectionKey, boolean>>({ location_description: false, subject_development: false, subject_building: false, subject_property: false, market_commentary: false, valuation_considerations: false })
  const [aiEditing, setAiEditingState] = useState<Record<AiSectionKey, boolean>>({ location_description: false, subject_development: false, subject_building: false, subject_property: false, market_commentary: false, valuation_considerations: false })

  const [valuer, setValuer] = useState<ValuerInputs>({ ...EMPTY_VALUER, ...reportContent?.valuer_inputs })

  const [saving, setSaving] = useState(false)
  const [saveFlash, setSaveFlash] = useState<"ok" | "err" | null>(null)
  const dirtyRef = useRef(false)

  const [firmTemplate, setFirmTemplate] = useState<FirmTemplate>({})
  const [showFirmSettings, setShowFirmSettings] = useState(false)

  /* ── Load firm template on mount ──────────────────────────────────────── */
  useEffect(() => {
    if (!session?.access_token) return
    fetch(`${API_BASE}/api/firm-templates`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => setFirmTemplate(data))
      .catch(err => console.error("Failed to load firm template:", err))
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
      const body = { ...result, requested_section: key }
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
  }, [session, result, wrappedOnReportContentChange])

  const saveAiEdit = useCallback((key: AiSectionKey, text: string) => {
    setAiSections(prev => {
      const next = { ...prev, [key]: text }
      dirtyRef.current = true
      queueMicrotask(() => wrappedOnReportContentChange?.({ ai_sections: next }))
      return next
    })
    setAiEditingState(prev => ({ ...prev, [key]: false }))
    // Immediate save after AI edit
    setTimeout(() => handleSaveRef.current(), 100)
  }, [wrappedOnReportContentChange])

  const setAiEditing = useCallback((key: AiSectionKey, editing: boolean) => {
    setAiEditingState(prev => ({ ...prev, [key]: editing }))
  }, [])

  /* ── Firm template ────────────────────────────────────────────────────── */
  const handleFirmSaved = useCallback((t: FirmTemplate) => {
    setFirmTemplate(t)
    setShowFirmSettings(false)
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

  return {
    meta, valuer, aiSections, aiLoading, aiEditing, firmTemplate, saving, saveFlash, showFirmSettings,
    updateMeta, updateValuer, updateValuerBatch, generateAiSection, saveAiEdit, setAiEditing,
    setShowFirmSettings, handleFirmSaved, handleSave, numberToWords,
    sectionCompletion, overallCompletion,
    result, adoptedComparables, onSave,
  }
}

"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { EditorContent } from "@tiptap/react"
import type { ReportTypingState, AiSectionKey } from "../types"
import { useDocumentEditorState } from "../useDocumentEditorState"
import AiSidebar from "./AiSidebar"
import TemplateExportButton from "../shared/TemplateExportButton"
import CopyPoolPanel from "../CopyPoolPanel"
import { API_BASE } from "@/lib/constants"
import { PLACEHOLDER_REGISTRY, type PlaceholderDef } from "../extensions/placeholderRegistry"

// ── Vibe Valuation: suggestion fetching hook ────────────────────────────
function useInlineSuggestions(
  editor: ReturnType<typeof import("@tiptap/react").useEditor> | null,
  enabled: boolean,
  propertyData: Record<string, unknown>,
  comparables: Record<string, unknown>[],
  semvOutput: Record<string, unknown>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastTextRef = useRef("")

  // Fetch suggestion after typing pause
  const fetchSuggestion = useCallback(async () => {
    if (!editor || !enabled) return
    // Don't fetch if a suggestion is currently being displayed (e.g. during partial accept)
    const ext = editor.extensionManager.extensions.find(
      (x: any) => x.name === "inlineSuggestion"
    ) as any
    if (ext?.storage?.suggestion) return
    const { from } = editor.state.selection
    // Get text before cursor (up to 500 chars)
    const textBeforeFull = editor.state.doc.textBetween(0, from, "\n")
    const textBefore = textBeforeFull.slice(-500)
    // Skip if nothing meaningful to complete
    if (textBefore.trim().length < 10) return
    // Skip if text hasn't changed since last fetch
    if (textBefore === lastTextRef.current) return
    lastTextRef.current = textBefore

    // Get text after cursor (up to 200 chars)
    const docSize = editor.state.doc.content.size
    const docEnd = Math.min(from + 200, docSize > 0 ? docSize : from)
    const textAfter = from < docEnd ? editor.state.doc.textBetween(from, docEnd, "\n") : ""

    // Detect which section we're in (simple heuristic: last heading before cursor)
    let sectionKey = "general"
    const headingMatch = textBeforeFull.match(/(?:^|\n)([\d]+\.[\d]*\s+.{3,60})(?:\n|$)/g)
    if (headingMatch) {
      const lastHeading = headingMatch[headingMatch.length - 1].trim().toLowerCase()
      if (lastHeading.includes("location")) sectionKey = "location_description"
      else if (lastHeading.includes("development")) sectionKey = "subject_development"
      else if (lastHeading.includes("building")) sectionKey = "subject_building"
      else if (lastHeading.includes("property") || lastHeading.includes("description")) sectionKey = "subject_property"
      else if (lastHeading.includes("market")) sectionKey = "market_commentary"
      else if (lastHeading.includes("valuation")) sectionKey = "valuation_considerations"
      else if (lastHeading.includes("tenure")) sectionKey = "tenure"
      else if (lastHeading.includes("condition")) sectionKey = "condition"
      else if (lastHeading.includes("flood")) sectionKey = "flood_risk"
      else if (lastHeading.includes("energy") || lastHeading.includes("epc")) sectionKey = "energy_performance"
    }

    // Cancel any in-flight request
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const resp = await fetch(`${API_BASE}/api/ai-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_key: sectionKey,
          text_before: textBefore,
          text_after: textAfter,
          property_data: propertyData,
          comparables: comparables,
          semv_output: semvOutput,
        }),
        signal: ctrl.signal,
      })
      if (!resp.ok) return
      const data = await resp.json()
      if (data.suggestion && editor && !ctrl.signal.aborted) {
        editor.commands.setSuggestion(data.suggestion)
      }
    } catch {
      // Aborted or network error — ignore
    }
  }, [editor, enabled, propertyData, comparables, semvOutput])

  // Set up the debounced trigger on editor updates
  useEffect(() => {
    if (!editor || !enabled) return

    const handler = () => {
      // Clear previous timer
      if (timerRef.current) clearTimeout(timerRef.current)
      // Set new timer (1 second debounce)
      timerRef.current = setTimeout(fetchSuggestion, 1000)
    }

    editor.on("update", handler)
    return () => {
      editor.off("update", handler)
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [editor, enabled, fetchSuggestion])

  // Ctrl+Space to trigger immediately
  useEffect(() => {
    if (!editor || !enabled) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault()
        fetchSuggestion()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [editor, enabled, fetchSuggestion])

  // Log feedback when suggestion is accepted or dismissed
  // Uses capture phase to read storage BEFORE the extension's keyboard shortcut clears it
  useEffect(() => {
    if (!editor) return

    const logFeedback = (suggestion: string, action: string) => {
      if (!suggestion) return
      fetch(`${API_BASE}/api/ai-suggest/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_key: "inline",
          suggestion,
          action,
          valuer_edit: "",
          property_type: (propertyData as any)?.property_type || "",
          borough: (propertyData as any)?.admin_district || "",
        }),
      }).catch(() => {}) // fire-and-forget
    }

    const handleKey = (e: KeyboardEvent) => {
      // Read storage before the extension's handler clears it
      const ext = editor.extensionManager.extensions.find(
        (x: any) => x.name === "inlineSuggestion"
      ) as any
      const currentSuggestion = ext?.storage?.suggestion
      if (!currentSuggestion) return

      if (e.key === "Tab") {
        logFeedback(currentSuggestion, "accepted")
      } else if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey)) {
        logFeedback(currentSuggestion, "accepted_word")
      } else if (e.key === "Escape") {
        logFeedback(currentSuggestion, "dismissed")
      }
    }

    // Capture phase ensures we read storage before TipTap's handler clears it
    document.addEventListener("keydown", handleKey, true)
    return () => document.removeEventListener("keydown", handleKey, true)
  }, [editor, propertyData])
}

// ── Toolbar button component ──────────────────────────────────────────────

interface ToolbarBtnProps {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarBtn({ onClick, active, disabled, title, children }: ToolbarBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors ${active
        ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}

function ToolbarSep() {
  return <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--color-border)" }} />
}

// ── Category labels ──────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<PlaceholderDef["category"], string> = {
  B: "Case Metadata",
  C: "API Data",
  D: "AI Content",
  E: "Valuer Content",
  F: "Assembly",
}

// ── Placeholder dropdown ─────────────────────────────────────────────────

function PlaceholderDropdown({ editor }: { editor: ReturnType<typeof import("@tiptap/react").useEditor> }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Focus search when opened
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Group & filter placeholders
  const grouped = useMemo(() => {
    const all = Object.values(PLACEHOLDER_REGISTRY)
    const q = search.toLowerCase().trim()
    const filtered = q ? all.filter(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) : all
    const groups: Partial<Record<PlaceholderDef["category"], PlaceholderDef[]>> = {}
    for (const p of filtered) {
      ;(groups[p.category] ??= []).push(p)
    }
    return groups
  }, [search])

  const insert = (p: PlaceholderDef) => {
    if (!editor) return
    ;(editor.chain().focus() as any).insertPlaceholder({
      key: p.key,
      category: p.category,
      required: p.required,
      label: p.label,
    }).run()
    setOpen(false)
    setSearch("")
  }

  return (
    <div className="relative" ref={ref}>
      <ToolbarBtn onClick={() => setOpen(o => !o)} active={open} title="Insert Placeholder">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path strokeLinecap="round" d="M7 9.5h4M13 9.5h4M7 14h3M13 14h4" />
        </svg>
      </ToolbarBtn>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 rounded-lg border shadow-lg overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-surface)",
            borderColor: "var(--color-border)",
            width: 280,
          }}
        >
          {/* Search */}
          <div className="p-1.5 border-b" style={{ borderColor: "var(--color-border)" }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search placeholders..."
              className="w-full text-xs px-2 py-1 rounded border outline-none"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          {/* List */}
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            {(Object.keys(CATEGORY_LABELS) as PlaceholderDef["category"][]).map(cat => {
              const items = grouped[cat]
              if (!items?.length) return null
              return (
                <div key={cat}>
                  <div className="text-[9px] font-semibold uppercase tracking-wider px-3 py-1 sticky top-0"
                    style={{ color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-hover)" }}
                  >
                    {CATEGORY_LABELS[cat]}
                  </div>
                  {items.map(p => (
                    <button
                      key={p.key}
                      onClick={() => insert(p)}
                      className="w-full text-left px-3 py-1 text-xs hover:bg-[var(--color-bg-hover)] flex items-center gap-2 transition-colors"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      <span className="flex-1 truncate">{p.label}</span>
                      {p.required && (
                        <span className="text-[8px] px-1 rounded" style={{ color: "var(--color-status-error)", backgroundColor: "color-mix(in srgb, var(--color-status-error) 10%, transparent)" }}>REQ</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
            {Object.keys(grouped).length === 0 && (
              <div className="px-3 py-4 text-xs text-center" style={{ color: "var(--color-text-secondary)" }}>
                No placeholders found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main EditorView ───────────────────────────────────────────────────────

interface EditorViewProps {
  state: ReportTypingState
  session?: { access_token: string } | null
  caseId?: string | null
}

export default function EditorView({ state, session, caseId }: EditorViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [copyPoolOpen, setCopyPoolOpen] = useState(false)
  const [savingCopy, setSavingCopy] = useState(false)
  const [copyFlash, setCopyFlash] = useState<"ok" | "err" | null>(null)
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true)
  const { editor, insertTextAtSection, getContentHTML, getContentJSON, exportDocx, printDocument } = useDocumentEditorState(state, state.templateSchema)

  // Vibe Valuation: inline suggestions
  // state.result IS the property data (PropertyResult), state.adoptedComparables is the comps array
  useInlineSuggestions(
    editor,
    aiAssistEnabled,
    state.result || {},
    state.adoptedComparables || [],
    {},  // SEMV output not on ReportTypingState — will be wired when SEMV tab passes it through
  )

  const saveCopy = useCallback(async () => {
    if (!editor || !caseId || !session?.access_token) return
    setSavingCopy(true)
    setCopyFlash(null)
    try {
      const res = await fetch(`${API_BASE}/api/cases/${caseId}/copies`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          editor_html: getContentHTML(),
          editor_json: getContentJSON(),
          wizard_snapshot: {
            meta: state.meta,
            valuer: state.valuer,
            aiSections: state.aiSections,
          },
          panel_id: state.activePanel?.id || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to save copy")
      setCopyFlash("ok")
      setTimeout(() => setCopyFlash(null), 2000)
    } catch {
      setCopyFlash("err")
      setTimeout(() => setCopyFlash(null), 3000)
    } finally {
      setSavingCopy(false)
    }
  }, [editor, caseId, session, getContentHTML, getContentJSON, state.meta, state.valuer, state.aiSections])

  const handleAiInsert = useCallback((key: AiSectionKey, text: string) => {
    insertTextAtSection(key, text)
  }, [insertTextAtSection])

  // Vibe Valuation: chat sidebar helpers
  const handleInsertAtCursor = useCallback((text: string) => {
    if (!editor) return
    editor.chain().focus().command(({ tr }) => {
      tr.insertText(text)
      return true
    }).run()
  }, [editor])

  const handleReplaceSelection = useCallback((text: string) => {
    if (!editor) return
    editor.chain().focus().command(({ tr }) => {
      // Read selection from the transaction (post-focus), not stale editor state
      const { from, to } = tr.selection
      if (from !== to) {
        tr.insertText(text, from, to)
      } else {
        tr.insertText(text)
      }
      return true
    }).run()
  }, [editor])

  // Get current selection text and cursor section for chat context
  const selectedText = editor ? (() => {
    const { from, to } = editor.state.selection
    return from !== to ? editor.state.doc.textBetween(from, to, "\n") : ""
  })() : ""

  const cursorSection = editor ? (() => {
    const { from } = editor.state.selection
    const textBefore = editor.state.doc.textBetween(0, from, "\n")
    const headings = textBefore.match(/(?:^|\n)([\d]+\.[\d]*\s+.{3,60})(?:\n|$)/g)
    return headings ? headings[headings.length - 1].trim() : ""
  })() : ""

  const contextText = editor ? (() => {
    const { from } = editor.state.selection
    const start = Math.max(0, from - 300)
    const end = Math.min(editor.state.doc.content.size, from + 300)
    return editor.state.doc.textBetween(start, end, "\n")
  })() : ""

  if (!editor) {
    return (
      <div className="flex items-center justify-center h-96" style={{ backgroundColor: "var(--color-bg-surface)" }}>
        <div className="text-center space-y-3">
          <div className="w-8 h-8 mx-auto border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Loading editor...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-lg border overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        borderColor: "var(--color-border)",
        height: "calc(100vh - 120px)",
        minHeight: 500,
      }}
    >
      {/* ── Compact toolbar: formatting + export in one row ──────────────── */}
      <div className="flex items-center gap-0.5 px-2 py-0.5 border-b"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-surface)" }}
      >
        {/* Undo / Redo */}
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" /></svg>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Text formatting */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold (Ctrl+B)">
          <span className="font-bold text-sm">B</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic (Ctrl+I)">
          <span className="italic text-sm">I</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline (Ctrl+U)">
          <span className="underline text-sm">U</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough">
          <span className="line-through text-sm">S</span>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Headings */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">
          <span className="text-xs font-bold">H2</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">
          <span className="text-xs font-bold">H3</span>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} active={editor.isActive("heading", { level: 4 })} title="Heading 4">
          <span className="text-xs font-bold">H4</span>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Alignment */}
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Align Left">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h12M3 18h18" /></svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align Center">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M6 12h12M3 18h18" /></svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Align Right">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 12h12M3 18h18" /></svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign("justify").run()} active={editor.isActive({ textAlign: "justify" })} title="Justify">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" /></svg>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Lists */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet List">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered List">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Table */}
        <ToolbarBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert Table">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 3v18M14 3v18M3 3h18v18H3z" /></svg>
        </ToolbarBtn>

        {/* Horizontal rule */}
        <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Line">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18" /></svg>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Blockquote */}
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Blockquote">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10H5a1 1 0 01-1-1V6a1 1 0 011-1h3a1 1 0 011 1v5.5a3.5 3.5 0 01-3.5 3.5M18 10h-3a1 1 0 01-1-1V6a1 1 0 011-1h3a1 1 0 011 1v5.5a3.5 3.5 0 01-3.5 3.5" /></svg>
        </ToolbarBtn>

        <ToolbarSep />

        {/* Placeholder inserter */}
        <PlaceholderDropdown editor={editor} />

        {/* ── Right side: word count + export + AI ── */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] px-1.5" style={{ color: "var(--color-text-secondary)" }}>
            {editor.storage.characterCount.words()} words
          </span>
          <ToolbarSep />
          {/* Save Copy button */}
          {caseId && (
            <button onClick={saveCopy} disabled={savingCopy}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50"
              style={{
                borderColor: copyFlash === "ok" ? "var(--color-status-success)" : copyFlash === "err" ? "var(--color-status-error)" : "color-mix(in srgb, var(--color-accent) 27%, transparent)",
                color: copyFlash === "ok" ? "var(--color-status-success)" : copyFlash === "err" ? "var(--color-status-error)" : "var(--color-accent)",
                backgroundColor: copyFlash === "ok" ? "color-mix(in srgb, var(--color-status-success) 7%, transparent)" : copyFlash === "err" ? "color-mix(in srgb, var(--color-status-error) 7%, transparent)" : "color-mix(in srgb, var(--color-accent) 7%, transparent)",
              }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
              {savingCopy ? "Saving..." : copyFlash === "ok" ? "Saved!" : copyFlash === "err" ? "Error" : "Save Copy"}
            </button>
          )}
          {/* Copy Pool toggle */}
          {caseId && (
            <button onClick={() => setCopyPoolOpen(p => !p)}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={{
                borderColor: "color-mix(in srgb, var(--color-accent) 27%, transparent)",
                color: "var(--color-accent)",
                backgroundColor: copyPoolOpen ? "color-mix(in srgb, var(--color-accent) 13%, transparent)" : "color-mix(in srgb, var(--color-accent) 7%, transparent)",
              }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              Copies
            </button>
          )}
          <button onClick={exportDocx}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--color-accent) 27%, transparent)", color: "var(--color-accent)", backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)" }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            .docx
          </button>
          <TemplateExportButton state={state} session={session || null} />
          <button onClick={printDocument}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
          >PDF</button>
          {/* Vibe Valuation: AI Assist toggle */}
          <button onClick={() => setAiAssistEnabled(p => !p)}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: aiAssistEnabled
                ? "color-mix(in srgb, var(--color-status-success) 27%, transparent)"
                : "var(--color-border)",
              color: aiAssistEnabled ? "var(--color-status-success)" : "var(--color-text-secondary)",
              backgroundColor: aiAssistEnabled
                ? "color-mix(in srgb, var(--color-status-success) 7%, transparent)"
                : "transparent",
            }}
            title={aiAssistEnabled ? "AI Assist: ON (Ctrl+Space to trigger)" : "AI Assist: OFF"}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>
            {aiAssistEnabled ? "Assist ON" : "Assist OFF"}
          </button>
          <button onClick={() => setSidebarCollapsed(p => !p)}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: "color-mix(in srgb, var(--color-status-warning) 27%, transparent)",
              color: "var(--color-status-warning)",
              backgroundColor: sidebarCollapsed ? "transparent" : "color-mix(in srgb, var(--color-status-warning) 7%, transparent)",
            }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3" /></svg>
            AI
          </button>
        </div>
      </div>

      {/* ── Editor + Sidebar ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* A4 page container */}
        <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#E8E8ED" }}>
          <div className="propval-a4-page mx-auto my-2">
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Copy Pool Panel */}
        {caseId && copyPoolOpen && (
          <CopyPoolPanel
            caseId={caseId}
            session={session}
            onClose={() => setCopyPoolOpen(false)}
            copyFlash={copyFlash}
          />
        )}

        {/* AI Sidebar — Vibe Valuation chat + section generators */}
        <AiSidebar
          state={state}
          onInsert={handleAiInsert}
          onInsertAtCursor={handleInsertAtCursor}
          onReplaceSelection={handleReplaceSelection}
          selectedText={selectedText}
          cursorSection={cursorSection}
          contextText={contextText}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(p => !p)}
        />
      </div>

      {/* ── A4 page styles ──────────────────────────────────────────────── */}
      <style jsx global>{`
        /* A4 page container — fills available width, capped at A4 */
        .propval-a4-page {
          width: min(210mm, calc(100% - 24px));
          min-height: 297mm;
          padding: 20mm;
          background: #FFF1E0;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05);
          color: #1D1D1F;
          font-family: Calibri, 'Segoe UI', sans-serif;
          font-size: 11pt;
          line-height: 1.5;
        }

        /* Report page sections with visual separators */
        .propval-a4-page .report-page {
          padding-bottom: 24px;
          margin-bottom: 24px;
          border-bottom: 1px dashed #D2D2D7;
        }
        .propval-a4-page .report-page:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }

        /* Cover page */
        .propval-a4-page .cover-page {
          min-height: 250mm;
        }

        /* TipTap editor styles */
        .propval-tiptap-editor {
          outline: none;
          caret-color: #1C1C1E;
        }
        .propval-tiptap-editor:focus {
          outline: none;
        }
        .propval-a4-page .ProseMirror {
          caret-color: #1C1C1E;
          outline: none;
          cursor: text;
        }
        .propval-a4-page .ProseMirror *::selection {
          background: rgba(0, 122, 255, 0.25);
        }

        /* Headings */
        .propval-a4-page h1 { font-size: 22px; font-weight: 700; margin: 16px 0 8px; }
        .propval-a4-page h2 { font-size: 16px; font-weight: 700; margin: 20px 0 8px; color: #007AFF; }
        .propval-a4-page h3 { font-size: 12px; font-weight: 700; margin: 14px 0 4px; color: #1D1D1F; }
        .propval-a4-page h4 { font-size: 11px; font-weight: 700; margin: 10px 0 4px; color: #636366; }

        /* Paragraphs */
        .propval-a4-page p { margin: 4px 0; }

        /* Tables */
        .propval-a4-page table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
          font-size: 10pt;
        }
        .propval-a4-page th,
        .propval-a4-page td {
          border: 1px solid #E5E5EA;
          padding: 5px 8px;
          text-align: left;
        }
        .propval-a4-page th {
          background: #F2F2F7;
          font-weight: 600;
          color: #636366;
        }
        .propval-a4-page tr:nth-child(even) td {
          background: #F9F9FB;
        }

        /* Blockquote */
        .propval-a4-page blockquote {
          border-left: 3px solid #007AFF;
          padding-left: 12px;
          margin: 8px 0;
          color: #636366;
        }

        /* Horizontal rule */
        .propval-a4-page hr {
          border: none;
          border-top: 1px solid #E5E5EA;
          margin: 16px 0;
        }

        /* Lists */
        .propval-a4-page ul { list-style: disc; padding-left: 24px; margin: 4px 0; }
        .propval-a4-page ol { list-style: decimal; padding-left: 24px; margin: 4px 0; }
        .propval-a4-page li { margin: 2px 0; }

        /* Images */
        .propval-a4-page img {
          max-width: 100%;
          height: auto;
          margin: 8px 0;
        }

        /* Vibe Valuation: ghost text suggestion */
        .vibe-ghost-text {
          color: #9CA3AF;
          font-style: italic;
          opacity: 0.6;
          pointer-events: none;
          user-select: none;
        }

        /* Print styles */
        @media print {
          body * { visibility: hidden; }
          .propval-a4-page,
          .propval-a4-page * { visibility: visible; }
          .propval-a4-page {
            position: absolute;
            left: 0;
            top: 0;
            width: 210mm;
            box-shadow: none;
            margin: 0;
            padding: 20mm;
          }
          .propval-a4-page .report-page {
            break-after: page;
            border-bottom: none;
          }
        }
      `}</style>
    </div>
  )
}

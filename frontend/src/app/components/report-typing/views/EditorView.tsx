"use client"

import { useState, useCallback } from "react"
import { EditorContent } from "@tiptap/react"
import type { ReportTypingState, AiSectionKey } from "../types"
import { useDocumentEditorState } from "../useDocumentEditorState"
import AiSidebar from "./AiSidebar"

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

// ── Main EditorView ───────────────────────────────────────────────────────

interface EditorViewProps {
  state: ReportTypingState
}

export default function EditorView({ state }: EditorViewProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { editor, insertTextAtSection, exportDocx, printDocument } = useDocumentEditorState(state)

  const handleAiInsert = useCallback((key: AiSectionKey, text: string) => {
    insertTextAtSection(key, text)
  }, [insertTextAtSection])

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

        {/* ── Right side: word count + export + AI ── */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] px-1.5" style={{ color: "var(--color-text-secondary)" }}>
            {editor.storage.characterCount.words()} words
          </span>
          <ToolbarSep />
          <button onClick={exportDocx}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--color-accent) 27%, transparent)", color: "var(--color-accent)", backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)" }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            .docx
          </button>
          <button onClick={printDocument}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
          >PDF</button>
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

        {/* AI Sidebar */}
        <AiSidebar
          state={state}
          onInsert={handleAiInsert}
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
          background: white;
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
          caret-color: #FF00FF;
        }
        .propval-tiptap-editor:focus {
          outline: none;
        }
        .propval-a4-page .ProseMirror {
          caret-color: #FF00FF;
          outline: none;
          cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='20' viewBox='0 0 16 20'%3E%3Cpath d='M1 1l6 18 2-7 7-2L1 1z' fill='%23FF00FF' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E") 1 1, text;
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

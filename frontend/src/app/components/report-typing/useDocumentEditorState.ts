"use client"

import { useRef, useCallback, useEffect, useState } from "react"
import { useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import { Table } from "@tiptap/extension-table"
import { TableRow } from "@tiptap/extension-table-row"
import { TableCell } from "@tiptap/extension-table-cell"
import { TableHeader } from "@tiptap/extension-table-header"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import CharacterCount from "@tiptap/extension-character-count"
import { TextStyle } from "@tiptap/extension-text-style"
import { Color } from "@tiptap/extension-color"
import Highlight from "@tiptap/extension-highlight"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import { PlaceholderNode } from "./extensions/PlaceholderNode"
import { SectionBlock } from "./extensions/SectionBlock"
import { buildTemplateFromSchema } from "./template/buildTemplateFromSchema"
import { resolvePlaceholders } from "./template/resolvePlaceholders"
import type { TemplateSchema } from "./types"
import { saveAs } from "file-saver"
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  HeadingLevel,
  Footer,
  PageNumber,
  type IRunPropertiesOptions,
} from "docx"
import type { ReportTypingState, AiSectionKey } from "./types"
import { buildReportContent } from "./template/buildTemplate"

// ── HTML → docx conversion helpers ──────────────────────────────────────────

const HEADING_MAP: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
}

const ALIGN_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

type DocxChild = Paragraph | DocxTable

/** Extract inline text runs from an element, preserving bold/italic/underline/strikethrough */
function extractRuns(node: Node, inherited: Record<string, unknown> = {}): TextRun[] {
  const runs: TextRun[] = []

  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || ""
      if (text) runs.push(new TextRun({ text, ...inherited }))
      return
    }

    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName

    const style: Record<string, unknown> = { ...inherited }
    if (tag === "STRONG" || tag === "B") style.bold = true
    if (tag === "EM" || tag === "I") style.italics = true
    if (tag === "U") style.underline = { type: "single" }
    if (tag === "S" || tag === "DEL") style.strike = true
    if (tag === "SUB") style.subScript = true
    if (tag === "SUP") style.superScript = true
    if (tag === "BR") { runs.push(new TextRun({ break: 1 })); return }

    // Placeholder token — render as text (resolved value or label)
    if (tag === "SPAN" && el.getAttribute("data-placeholder-key")) {
      const text = el.textContent || el.getAttribute("data-label") || ""
      if (text) runs.push(new TextRun({ text, ...inherited }))
      return
    }

    // Recurse for nested inline formatting
    runs.push(...extractRuns(el, style))
  })

  return runs
}

/** Get text alignment from an element's style */
function getAlignment(el: HTMLElement): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const align = el.style?.textAlign || el.getAttribute("align") || ""
  return ALIGN_MAP[align.toLowerCase()]
}

/** Convert a <table> element to a docx Table */
function convertTable(tableEl: HTMLElement): DocxTable {
  const rows: DocxTableRow[] = []

  const trs = tableEl.querySelectorAll("tr")
  trs.forEach((tr) => {
    const cells: DocxTableCell[] = []
    tr.querySelectorAll("th, td").forEach((cell) => {
      const isHeader = cell.tagName === "TH"
      const runs = extractRuns(cell, isHeader ? { bold: true, size: 20, font: "Calibri" } : { size: 20, font: "Calibri" })
      cells.push(
        new DocxTableCell({
          children: [new Paragraph({ children: runs.length ? runs : [new TextRun("")] })],
          shading: isHeader
            ? { type: ShadingType.SOLID, color: "F2F2F7", fill: "F2F2F7" }
            : undefined,
        })
      )
    })
    if (cells.length > 0) {
      rows.push(new DocxTableRow({ children: cells }))
    }
  })

  return new DocxTable({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

/** Convert a list (UL/OL) to Paragraph array with bullet/number formatting */
function convertList(listEl: HTMLElement, ordered: boolean): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let idx = 0
  listEl.querySelectorAll(":scope > li").forEach((li) => {
    idx++
    const prefix = ordered ? `${idx}. ` : "\u2022 "
    const runs = extractRuns(li)
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: prefix, font: "Calibri", size: 22 }), ...runs],
        spacing: { after: 40 },
        indent: { left: 360 },
      })
    )
  })
  return paragraphs
}

/** Convert a NodeList of DOM nodes to docx Paragraph/Table children */
function convertNodes(nodes: NodeList): DocxChild[] {
  const children: DocxChild[] = []

  nodes.forEach((node) => {
    // Skip whitespace-only text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").trim()
      if (text) {
        children.push(new Paragraph({ children: [new TextRun({ text, font: "Calibri", size: 22 })] }))
      }
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName

    // Headings
    if (HEADING_MAP[tag]) {
      const level = HEADING_MAP[tag]
      const isH2 = tag === "H2"
      const runs = extractRuns(el, {
        bold: true,
        font: "Calibri",
        size: tag === "H1" ? 44 : tag === "H2" ? 32 : tag === "H3" ? 24 : 22,
        color: isH2 ? "007AFF" : "1D1D1F",
      })
      children.push(
        new Paragraph({
          heading: level,
          alignment: getAlignment(el),
          children: runs,
          spacing: { before: tag === "H1" ? 240 : 200, after: 80 },
        })
      )
      return
    }

    // Paragraphs
    if (tag === "P") {
      const runs = extractRuns(el, { font: "Calibri", size: 22 })
      children.push(
        new Paragraph({
          alignment: getAlignment(el),
          children: runs.length ? runs : [new TextRun("")],
          spacing: { after: 80 },
        })
      )
      return
    }

    // Lists
    if (tag === "UL") { children.push(...convertList(el, false)); return }
    if (tag === "OL") { children.push(...convertList(el, true)); return }

    // Tables
    if (tag === "TABLE") { children.push(convertTable(el)); return }

    // Horizontal rule
    if (tag === "HR") {
      children.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "E5E5EA" } },
          spacing: { before: 120, after: 120 },
        })
      )
      return
    }

    // Blockquote
    if (tag === "BLOCKQUOTE") {
      const innerParagraphs = convertNodes(el.childNodes)
      innerParagraphs.forEach((p) => {
        if (p instanceof Paragraph) {
          children.push(
            new Paragraph({
              ...p,
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 6, color: "007AFF" } },
            })
          )
        } else {
          children.push(p)
        }
      })
      return
    }

    // DIV / other containers — recurse
    if (el.childNodes.length > 0) {
      children.push(...convertNodes(el.childNodes))
    }
  })

  return children
}

/**
 * Hook managing the TipTap editor lifecycle:
 *  - Editor instance with all extensions
 *  - Loading content from saved state or freshly built template
 *  - Auto-save with dirty tracking
 *  - AI text injection at section markers
 *  - Export to .docx via existing docx library
 */
export function useDocumentEditorState(state: ReportTypingState, templateSchema?: TemplateSchema | null) {
  const [dirty, setDirty] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Ref to access current state without adding deps to effects
  const stateRef = useRef(state)
  stateRef.current = state

  /** Snapshot current state into template data shape */
  const getTemplateData = () => ({
    firmTemplate: stateRef.current.firmTemplate as any,
    meta: stateRef.current.meta,
    result: stateRef.current.result,
    aiSections: stateRef.current.aiSections,
    valuer: stateRef.current.valuer,
    adoptedComparables: stateRef.current.adoptedComparables,
  })

  // Build initial content — uses legacy path (template likely not loaded yet)
  const initialContent = useRef(buildReportContent(getTemplateData()))

  // Track the last-applied schema by reference to prevent redundant rebuilds
  const lastAppliedSchemaRef = useRef<TemplateSchema | null>(null)

  // Create the TipTap editor instance
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        underline: false,
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Table.configure({
        resizable: true,
        handleWidth: 5,
        cellMinWidth: 50,
      }),
      TableRow,
      TableCell,
      TableHeader,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: "Start typing...",
      }),
      CharacterCount,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Subscript,
      Superscript,
      PlaceholderNode.configure({
        previewMode: false,
        resolvedValues: {},
      }),
      SectionBlock,
    ],
    content: initialContent.current,
    editorProps: {
      attributes: {
        class: "propval-tiptap-editor",
        spellcheck: "true",
      },
    },
    immediatelyRender: false,
    onUpdate: () => {
      setDirty(true)
    },
  })

  // ── Rebuild editor when templateSchema arrives or changes ────────────────
  // Only triggers on schema reference change — NOT on every keystroke.
  useEffect(() => {
    if (!editor || !templateSchema) return
    if (templateSchema === lastAppliedSchemaRef.current) return
    lastAppliedSchemaRef.current = templateSchema
    const content = buildTemplateFromSchema(templateSchema, getTemplateData())
    // Defer to next microtask to avoid flushSync warning during React render
    setTimeout(() => {
      editor.commands.setContent(content)
      setDirty(false)
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, templateSchema])

  // ── Keep resolvedValues in sync via editor storage ─────────────────────
  // This runs on state changes (cheap operation — just updates a map).
  useEffect(() => {
    if (!editor) return
    const resolved = templateSchema ? resolvePlaceholders(getTemplateData()) : {}
    const storage = editor.storage as any
    if (!storage.placeholderToken) storage.placeholderToken = {}
    storage.placeholderToken.resolvedValues = resolved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, templateSchema, state.meta, state.result, state.aiSections, state.valuer, state.adoptedComparables])

  // ── Rebuild editor content when case/property changes ───────────────────
  const resultAddressRef = useRef(state.result?.address)
  useEffect(() => {
    if (!editor) return
    const currentAddr = state.result?.address
    if (currentAddr && currentAddr !== resultAddressRef.current) {
      resultAddressRef.current = currentAddr
      const d = getTemplateData()
      const newContent = templateSchema
        ? buildTemplateFromSchema(templateSchema, d)
        : buildReportContent(d)
      editor.commands.setContent(newContent)
      lastAppliedSchemaRef.current = templateSchema ?? null
      setDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, templateSchema, state.result?.address])

  // ── Auto-save every 15 seconds ──────────────────────────────────────────

  useEffect(() => {
    saveTimerRef.current = setInterval(() => {
      if (dirty && editor) {
        state.handleSave()
        setDirty(false)
      }
    }, 15000)

    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current)
    }
  }, [dirty, editor, state])

  // ── Insert AI text at a section marker ──────────────────────────────────

  const insertTextAtSection = useCallback((sectionKey: AiSectionKey, text: string) => {
    if (!editor || !text) return

    const sectionId = `ai-${sectionKey}`

    // Find the section marker node in the document
    let targetPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.attrs?.["data-section-id"] === sectionId) {
        targetPos = pos
        return false  // stop traversal
      }
      // Also search by text content for the placeholder marker
      if (node.isText && node.text?.includes(`[AI: ${sectionKey}]`)) {
        targetPos = pos
        return false
      }
    })

    if (targetPos !== null) {
      // Select the marker paragraph and replace with AI text
      const node = editor.state.doc.nodeAt(targetPos)
      if (node) {
        editor.chain()
          .focus()
          .setTextSelection({ from: targetPos, to: targetPos + node.nodeSize })
          .insertContent(text.split("\n\n").map(p => `<p>${p}</p>`).join(""))
          .run()
      }
    } else {
      // Fallback: append at current cursor position
      editor.chain()
        .focus()
        .insertContent(text.split("\n\n").map(p => `<p>${p}</p>`).join(""))
        .run()
    }

    setDirty(true)
  }, [editor])

  // ── Get editor content as JSON ──────────────────────────────────────────

  const getContentJSON = useCallback(() => {
    if (!editor) return null
    return editor.getJSON()
  }, [editor])

  // ── Get editor content as HTML ──────────────────────────────────────────

  const getContentHTML = useCallback(() => {
    if (!editor) return ""
    return editor.getHTML()
  }, [editor])

  // ── Export to .docx ─────────────────────────────────────────────────────

  const exportDocx = useCallback(async () => {
    if (!editor) return

    // Save first
    state.handleSave()

    const html = editor.getHTML()

    // Parse the editor HTML into docx elements
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    const children = convertNodes(doc.body.childNodes)

    const address = state.result?.address || "Report"

    const wordDoc = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: 22 },
            paragraph: { spacing: { after: 80 } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999", font: "Calibri" }),
                ],
              }),
            ],
          }),
        },
        children,
      }],
    })

    const blob = await Packer.toBlob(wordDoc)
    const today = new Date().toISOString().slice(0, 10)
    const filename = `${address} - PropVal Report ${today}.docx`

    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: "Word Document",
            accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
          }],
        })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        return
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
      }
    }

    saveAs(blob, filename)
  }, [editor, state])

  // ── Print / PDF ─────────────────────────────────────────────────────────

  const printDocument = useCallback(() => {
    window.print()
  }, [])

  // ── Rebuild from current state ──────────────────────────────────────────

  const rebuildFromState = useCallback(() => {
    if (!editor) return
    const d = getTemplateData()
    const content = templateSchema
      ? buildTemplateFromSchema(templateSchema, d)
      : buildReportContent(d)
    editor.commands.setContent(content)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, templateSchema])

  return {
    editor,
    dirty,
    insertTextAtSection,
    getContentJSON,
    getContentHTML,
    exportDocx,
    printDocument,
    rebuildFromState,
  }
}

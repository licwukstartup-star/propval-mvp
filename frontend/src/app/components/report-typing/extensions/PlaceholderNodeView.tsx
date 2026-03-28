"use client"

import { useState } from "react"
import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"

/**
 * React NodeView for PlaceholderNode.
 * Renders as a styled chip showing the placeholder label.
 * In preview mode, shows the resolved value instead.
 */
export function PlaceholderNodeView({ node, editor, extension, getPos }: NodeViewProps) {
  const { key, category, required, label } = node.attrs
  const [hovered, setHovered] = useState(false)
  const [confirmRequired, setConfirmRequired] = useState(false)

  // Read resolved values from editor storage (updated live) with fallback to extension options
  const opts = (extension?.options || {}) as { previewMode?: boolean; resolvedValues?: Record<string, string> }
  const storage = editor?.storage as any
  const storageValues = storage?.placeholderToken?.resolvedValues as Record<string, string> | undefined
  const resolvedValue = storageValues?.[key] ?? opts.resolvedValues?.[key]
  const isPreview = opts.previewMode ?? false
  const hasValue = resolvedValue !== undefined && resolvedValue !== ""

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!editor || typeof getPos !== "function") return
    const pos = getPos()
    if (pos == null) return

    if (required && !confirmRequired) {
      setConfirmRequired(true)
      setTimeout(() => setConfirmRequired(false), 3000)
      return
    }
    // Temporarily disable the required-placeholder filter by using a meta flag
    editor.view.dispatch(
      editor.state.tr
        .delete(pos, pos + node.nodeSize)
        .setMeta("allowRequiredDelete", true)
    )
    setConfirmRequired(false)
  }

  // In preview mode, show the resolved value as plain text
  if (isPreview && hasValue) {
    return (
      <NodeViewWrapper as="span" className="placeholder-resolved">
        {resolvedValue}
      </NodeViewWrapper>
    )
  }

  // Category colours
  const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
    A: { bg: "#F0F4FF", border: "#B0C4FF", text: "#3366CC" }, // firm boilerplate — blue
    B: { bg: "#F0F9FF", border: "#7DD3FC", text: "#0369A1" }, // metadata — sky
    C: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534" }, // API auto — green
    D: { bg: "#FFF7ED", border: "#FDBA74", text: "#9A3412" }, // AI generated — orange
    E: { bg: "#FDF2F8", border: "#F9A8D4", text: "#9D174D" }, // valuer input — pink
    F: { bg: "#F5F3FF", border: "#C4B5FD", text: "#5B21B6" }, // auto-assembly — purple
  }

  const colors = categoryColors[category] || categoryColors.B
  const borderColor = hasValue ? colors.border : "#FB923C" // orange border if unresolved

  return (
    <NodeViewWrapper
      as="span"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        padding: "1px 6px",
        borderRadius: "4px",
        border: `1px solid ${borderColor}`,
        backgroundColor: colors.bg,
        color: colors.text,
        fontSize: "0.85em",
        fontFamily: "Calibri, sans-serif",
        lineHeight: "1.4",
        whiteSpace: "nowrap",
        userSelect: "none",
        cursor: "default",
        position: "relative",
      }}
      data-placeholder-key={key}
      contentEditable={false}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmRequired(false) }}
    >
      {required && (
        <span style={{ fontSize: "0.75em", opacity: 0.6 }} title="Required — cannot be removed">
          🔒
        </span>
      )}
      <span>{label || key}</span>
      {!hasValue && (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "#FB923C",
            display: "inline-block",
            marginLeft: "2px",
          }}
          title="No value yet"
        />
      )}
      {/* Delete button — appears on hover */}
      {hovered && (
        <span
          onClick={handleDelete}
          title={confirmRequired ? "Click again to confirm removal" : "Remove placeholder"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            backgroundColor: confirmRequired ? "#FF3B30" : "rgba(0,0,0,0.15)",
            color: confirmRequired ? "#fff" : colors.text,
            fontSize: "10px",
            fontWeight: 700,
            lineHeight: 1,
            cursor: "pointer",
            marginLeft: "2px",
            flexShrink: 0,
          }}
        >
          {confirmRequired ? "!" : "\u00D7"}
        </span>
      )}
    </NodeViewWrapper>
  )
}

export default PlaceholderNodeView

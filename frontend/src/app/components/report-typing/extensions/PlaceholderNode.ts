import { Node, mergeAttributes } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { PlaceholderNodeView } from "./PlaceholderNodeView"

export interface PlaceholderNodeOptions {
  /** Whether to show resolved values instead of labels */
  previewMode: boolean
  /** Map of placeholder key → resolved value */
  resolvedValues: Record<string, string>
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    placeholderToken: {
      insertPlaceholder: (attrs: {
        key: string
        category: string
        required: boolean
        label: string
      }) => ReturnType
    }
  }
}

export const PlaceholderNode = Node.create<PlaceholderNodeOptions>({
  name: "placeholderToken",

  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      previewMode: false,
      resolvedValues: {},
    }
  },

  addStorage() {
    return {
      resolvedValues: {} as Record<string, string>,
    }
  },

  addAttributes() {
    return {
      key: { default: "" },
      category: { default: "B" },
      required: { default: false },
      label: { default: "" },
    }
  },

  parseHTML() {
    return [
      {
        tag: "span[data-placeholder-key]",
        getAttrs: (el) => {
          if (typeof el === "string") return false
          return {
            key: el.getAttribute("data-placeholder-key") || "",
            category: el.getAttribute("data-category") || "B",
            required: el.getAttribute("data-required") === "true",
            label: el.getAttribute("data-label") || el.textContent || "",
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({
        "data-placeholder-key": HTMLAttributes.key,
        "data-category": HTMLAttributes.category,
        "data-required": HTMLAttributes.required ? "true" : "false",
        "data-label": HTMLAttributes.label,
        class: "placeholder-token",
      }),
      HTMLAttributes.label || HTMLAttributes.key,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlaceholderNodeView)
  },

  addCommands() {
    return {
      insertPlaceholder:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    }
  },

  addKeyboardShortcuts() {
    /**
     * Check if the current selection would delete a required placeholder.
     * Handles:
     *  - NodeSelection directly on a required placeholder
     *  - Cursor adjacent to a required placeholder (backspace/delete)
     *  - Range selection spanning one or more required placeholders
     *  - Select-all (entire document contains required placeholders)
     */
    const selectionContainsRequiredPlaceholder = (direction?: "backspace" | "delete"): boolean => {
      const { selection, doc } = this.editor.state
      const { from, to, empty } = selection

      // Case 1: NodeSelection on a required placeholder
      const nodeSelection = selection as any
      if (nodeSelection.node?.type.name === "placeholderToken" && nodeSelection.node.attrs.required) {
        return true
      }

      // Case 2: Range selection — scan all nodes in the range
      if (!empty) {
        let found = false
        doc.nodesBetween(from, to, (node) => {
          if (node.type.name === "placeholderToken" && node.attrs.required) {
            found = true
            return false // stop traversal
          }
        })
        return found
      }

      // Case 3: Cursor (empty selection) — check adjacent nodes for backspace/delete
      if (direction === "backspace") {
        const nodeBefore = doc.nodeAt(from - 1)
        if (nodeBefore?.type.name === "placeholderToken" && nodeBefore.attrs.required) return true
      }
      if (direction === "delete") {
        const nodeAfter = doc.nodeAt(from)
        if (nodeAfter?.type.name === "placeholderToken" && nodeAfter.attrs.required) return true
      }

      return false
    }

    return {
      Backspace: () => {
        if (selectionContainsRequiredPlaceholder("backspace")) return true
        return false
      },
      Delete: () => {
        if (selectionContainsRequiredPlaceholder("delete")) return true
        return false
      },
      // Ctrl+X / Cmd+X — prevent cutting required placeholders
      "Mod-x": () => {
        if (selectionContainsRequiredPlaceholder()) return true
        return false
      },
      // Ctrl+A then Delete/Backspace is handled by the range check above.
      // But also intercept Ctrl+A followed by typing (which replaces selection):
      // This is handled by the ProseMirror filterTransaction below.
    }
  },

  /**
   * Transaction filter: prevents any transaction that would remove a
   * required placeholder node from the document. This catches all edge
   * cases that keyboard shortcuts alone cannot — paste-over, drag-drop
   * replacement, programmatic deletions, etc.
   */
  addProseMirrorPlugins() {
    const placeholderType = this.type

    return [
      new Plugin({
        filterTransaction(tr, state) {
          // Only check transactions that modify the document
          if (!tr.docChanged) return true

          // Allow explicit deletions from the remove button
          if (tr.getMeta("allowRequiredDelete")) return true

          // Collect all required placeholder keys in current doc
          const requiredBefore = new Set<string>()
          state.doc.descendants((node) => {
            if (node.type.name === placeholderType.name && node.attrs.required) {
              requiredBefore.add(node.attrs.key)
            }
          })

          // If there are no required placeholders, allow everything
          if (requiredBefore.size === 0) return true

          // Collect required placeholder keys in the new doc
          const requiredAfter = new Set<string>()
          tr.doc.descendants((node) => {
            if (node.type.name === placeholderType.name && node.attrs.required) {
              requiredAfter.add(node.attrs.key)
            }
          })

          // Block if any required placeholder was removed
          for (const key of requiredBefore) {
            if (!requiredAfter.has(key)) return false
          }

          return true
        },
      }),
    ]
  },
})

export default PlaceholderNode

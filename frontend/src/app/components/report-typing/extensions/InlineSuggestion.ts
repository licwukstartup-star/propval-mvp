/**
 * InlineSuggestion — TipTap extension for Vibe Valuation ghost text.
 *
 * Renders dimmed grey "ghost text" after the cursor, similar to GitHub Copilot.
 * - Tab = accept entire suggestion
 * - Ctrl+Right = accept next word
 * - Esc or any other key = dismiss
 *
 * The extension does NOT fetch suggestions itself — it exposes commands
 * that the parent component calls after receiving a suggestion from the backend.
 */

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

export interface InlineSuggestionOptions {
  /** Whether suggestions are enabled */
  enabled: boolean
}

export interface InlineSuggestionStorage {
  /** Current ghost text suggestion */
  suggestion: string
  /** Position where the suggestion should appear */
  anchorPos: number
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineSuggestion: {
      /** Set a ghost text suggestion at the current cursor position */
      setSuggestion: (text: string) => ReturnType
      /** Accept the full suggestion */
      acceptSuggestion: () => ReturnType
      /** Accept just the next word of the suggestion */
      acceptNextWord: () => ReturnType
      /** Dismiss the current suggestion */
      dismissSuggestion: () => ReturnType
    }
  }
}

const SUGGESTION_PLUGIN_KEY = new PluginKey("inlineSuggestion")

export const InlineSuggestion = Extension.create<InlineSuggestionOptions, InlineSuggestionStorage>({
  name: "inlineSuggestion",

  addOptions() {
    return {
      enabled: true,
    }
  },

  addStorage() {
    return {
      suggestion: "",
      anchorPos: 0,
    }
  },

  addCommands() {
    return {
      setSuggestion:
        (text: string) =>
        ({ editor }) => {
          if (!text || !this.options.enabled) return false
          const pos = editor.state.selection.from
          this.storage.suggestion = text
          this.storage.anchorPos = pos
          // Single dispatch to update decoration
          const tr = editor.view.state.tr.setMeta(SUGGESTION_PLUGIN_KEY, { suggestion: text, pos })
          editor.view.dispatch(tr)
          return true
        },

      acceptSuggestion:
        () =>
        ({ editor }) => {
          const { suggestion } = this.storage
          if (!suggestion) return false
          // Clear storage BEFORE inserting (insert triggers docChanged which would also clear)
          const textToInsert = suggestion
          this.storage.suggestion = ""
          this.storage.anchorPos = 0
          // Insert as plain text at current cursor position
          editor.chain().focus().command(({ tr }) => {
            tr.insertText(textToInsert)
            return true
          }).run()
          return true
        },

      acceptNextWord:
        () =>
        ({ editor }) => {
          const { suggestion } = this.storage
          if (!suggestion) return false
          // Extract next word (including leading/trailing whitespace)
          const match = suggestion.match(/^(\s*\S+\s?)/)
          if (!match) return false
          const word = match[1]
          const remaining = suggestion.slice(word.length)
          // Clear storage first
          this.storage.suggestion = ""
          this.storage.anchorPos = 0
          // Insert the word as plain text
          editor.chain().focus().command(({ tr }) => {
            tr.insertText(word)
            return true
          }).run()
          // If there's remaining text, set it as the new suggestion after cursor settles
          if (remaining) {
            // Use setTimeout to let the insert transaction complete first
            setTimeout(() => {
              const newPos = editor.state.selection.from
              this.storage.suggestion = remaining
              this.storage.anchorPos = newPos
              const updateTr = editor.view.state.tr.setMeta(SUGGESTION_PLUGIN_KEY, { suggestion: remaining, pos: newPos })
              editor.view.dispatch(updateTr)
            }, 0)
          }
          return true
        },

      dismissSuggestion:
        () =>
        ({ editor }) => {
          if (!this.storage.suggestion) return false
          this.storage.suggestion = ""
          this.storage.anchorPos = 0
          const tr = editor.view.state.tr.setMeta(SUGGESTION_PLUGIN_KEY, { suggestion: "", pos: 0 })
          editor.view.dispatch(tr)
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (this.storage.suggestion) {
          editor.commands.acceptSuggestion()
          return true // prevent default tab
        }
        return false // let normal tab work
      },
      "Mod-Right": ({ editor }) => {
        if (this.storage.suggestion) {
          editor.commands.acceptNextWord()
          return true
        }
        return false
      },
      Escape: ({ editor }) => {
        if (this.storage.suggestion) {
          editor.commands.dismissSuggestion()
          return true
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const extensionThis = this

    return [
      new Plugin({
        key: SUGGESTION_PLUGIN_KEY,

        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldDecos) {
            const meta = tr.getMeta(SUGGESTION_PLUGIN_KEY)
            if (meta !== undefined) {
              if (!meta.suggestion) return DecorationSet.empty
              // Create a widget decoration for the ghost text
              const widget = Decoration.widget(meta.pos, () => {
                const span = document.createElement("span")
                span.className = "vibe-ghost-text"
                span.textContent = meta.suggestion
                span.setAttribute("data-ghost", "true")
                return span
              }, { side: 1 })
              return DecorationSet.create(tr.doc, [widget])
            }
            // If doc changed (user typed), clear any existing suggestion and decorations
            if (tr.docChanged) {
              extensionThis.storage.suggestion = ""
              extensionThis.storage.anchorPos = 0
              return DecorationSet.empty
            }
            // Selection-only changes: keep existing decorations
            return oldDecos
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)
          },
          // Dismiss on any content-producing keypress that isn't our shortcuts
          handleKeyDown(_view, event) {
            if (!extensionThis.storage.suggestion) return false
            // Let Tab, Escape, Ctrl+Right through to keyboard shortcuts above
            if (event.key === "Tab" || event.key === "Escape") return false
            if (event.key === "ArrowRight" && (event.ctrlKey || event.metaKey)) return false
            // Any typing/deletion key: the docChanged handler in apply() will clear
            // No need to manually dispatch here — avoids double-dispatch issues
            return false
          },
        },
      }),
    ]
  },
})

import { Node, mergeAttributes } from "@tiptap/core"

export interface SectionBlockOptions {
  /** No options yet */
}

export const SectionBlock = Node.create<SectionBlockOptions>({
  name: "sectionBlock",

  group: "block",
  content: "block+",
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      sectionId: { default: "" },
      sectionType: { default: "" },
      sectionTitle: { default: "" },
    }
  },

  parseHTML() {
    return [
      {
        tag: "div[data-section-id]",
        getAttrs: (el) => {
          if (typeof el === "string") return false
          return {
            sectionId: el.getAttribute("data-section-id") || "",
            sectionType: el.getAttribute("data-section-type") || "",
            sectionTitle: el.getAttribute("data-section-title") || "",
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-section-id": HTMLAttributes.sectionId,
        "data-section-type": HTMLAttributes.sectionType,
        "data-section-title": HTMLAttributes.sectionTitle,
        class: "report-section",
      }),
      0,
    ]
  },
})

export default SectionBlock

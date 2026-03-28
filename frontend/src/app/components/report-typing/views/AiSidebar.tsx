"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import type { ReportTypingState, AiSectionKey } from "../types"
import { API_BASE } from "@/lib/constants"

// ── Types ────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

interface AiSidebarProps {
  state: ReportTypingState
  onInsert: (key: AiSectionKey, text: string) => void
  onInsertAtCursor?: (text: string) => void
  onReplaceSelection?: (text: string) => void
  selectedText?: string
  cursorSection?: string
  contextText?: string
  collapsed: boolean
  onToggle: () => void
}

// ── Quick action section definitions ─────────────────────────────────────

const AI_SECTIONS: { key: AiSectionKey; label: string; section: string }[] = [
  { key: "location_description", label: "Location Description", section: "2.2" },
  { key: "subject_development", label: "Subject Development", section: "2.3" },
  { key: "subject_building", label: "Subject Building", section: "2.3" },
  { key: "subject_property", label: "Subject Property", section: "2.3" },
  { key: "market_commentary", label: "Market Commentary", section: "3.3" },
  { key: "valuation_considerations", label: "Valuation Considerations", section: "3.6" },
]

// ── Component ────────────────────────────────────────────────────────────

export default function AiSidebar({
  state,
  onInsert,
  onInsertAtCursor,
  onReplaceSelection,
  selectedText,
  cursorSection,
  contextText,
  collapsed,
  onToggle,
}: AiSidebarProps) {
  const [activeTab, setActiveTab] = useState<"sections" | "chat">("chat")
  const [expandedKey, setExpandedKey] = useState<AiSectionKey | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Send chat message
  const sendMessage = useCallback(async () => {
    const instruction = chatInput.trim()
    if (!instruction || chatLoading) return

    // Add user message
    const userMsg: ChatMessage = { role: "user", content: instruction, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setChatInput("")
    setChatLoading(true)

    try {
      const resp = await fetch(`${API_BASE}/api/ai-suggest/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          selected_text: selectedText || "",
          cursor_section: cursorSection || "",
          context_text: contextText || "",
          property_data: state.result || {},
          comparables: state.adoptedComparables || [],
          chat_history: [...messages, userMsg].slice(-6).map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!resp.ok) throw new Error("Chat request failed")
      const data = await resp.json()

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.response || "No response generated.",
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Error: Could not generate response. Please try again.", timestamp: Date.now() },
      ])
    } finally {
      setChatLoading(false)
      inputRef.current?.focus()
    }
  }, [chatInput, chatLoading, selectedText, cursorSection, contextText, state, messages])

  // Handle Enter to send (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Collapsed state ────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-10 h-full border-l transition-colors"
        style={{
          backgroundColor: "var(--color-bg-surface)",
          borderColor: "var(--color-border)",
        }}
        title="Open AI Sidebar (Ctrl+Shift+A)"
      >
        <svg className="w-5 h-5 rotate-180" style={{ color: "var(--color-status-warning)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    )
  }

  // ── Expanded state ─────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col border-l"
      style={{
        width: 280,
        minWidth: 280,
        backgroundColor: "var(--color-bg-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" style={{ color: "var(--color-status-warning)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          {/* Tab buttons */}
          <button
            onClick={() => setActiveTab("chat")}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
            style={{
              color: activeTab === "chat" ? "var(--color-accent)" : "var(--color-text-secondary)",
              backgroundColor: activeTab === "chat" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
              fontWeight: activeTab === "chat" ? 600 : 400,
            }}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab("sections")}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
            style={{
              color: activeTab === "sections" ? "var(--color-accent)" : "var(--color-text-secondary)",
              backgroundColor: activeTab === "sections" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
              fontWeight: activeTab === "sections" ? 600 : 400,
            }}
          >
            Sections
          </button>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          title="Close sidebar"
        >
          <svg className="w-4 h-4" style={{ color: "var(--color-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Chat tab ─────────────────────────────────────────────────────── */}
      {activeTab === "chat" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Selected text indicator */}
          {selectedText && (
            <div className="px-2 py-1 border-b text-[10px]" style={{
              borderColor: "var(--color-border)",
              backgroundColor: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
              color: "var(--color-text-secondary)",
            }}>
              <span style={{ color: "var(--color-accent)" }}>Selected:</span>{" "}
              {selectedText.length > 60 ? selectedText.slice(0, 60) + "..." : selectedText}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
            {messages.length === 0 && (
              <div className="text-center py-6">
                <div className="text-[10px] space-y-2" style={{ color: "var(--color-text-secondary)" }}>
                  <p className="font-medium" style={{ color: "var(--color-text-primary)" }}>Vibe Valuation Chat</p>
                  <p>Ask me to help with your report:</p>
                  <div className="space-y-1 text-left px-2">
                    {[
                      '"describe the location"',
                      '"make this more formal"',
                      '"add the flood risk details"',
                      '"shorten this paragraph"',
                      '"draft valuation considerations"',
                    ].map((hint, i) => (
                      <button
                        key={i}
                        onClick={() => { setChatInput(hint.replace(/"/g, "")); inputRef.current?.focus() }}
                        className="block w-full text-left text-[10px] px-2 py-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[90%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed"
                  style={{
                    backgroundColor: msg.role === "user"
                      ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                      : "var(--color-bg-primary)",
                    color: "var(--color-text-primary)",
                    border: msg.role === "assistant" ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Insert/Replace buttons for assistant messages */}
                  {msg.role === "assistant" && msg.content && !msg.content.startsWith("Error:") && (
                    <div className="flex gap-1.5 mt-1.5 pt-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
                      {onInsertAtCursor && (
                        <button
                          onClick={() => onInsertAtCursor(msg.content)}
                          className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                          style={{ color: "var(--color-accent)" }}
                        >
                          Insert at cursor
                        </button>
                      )}
                      {onReplaceSelection && selectedText && (
                        <button
                          onClick={() => onReplaceSelection(msg.content)}
                          className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                          style={{ color: "var(--color-status-warning)" }}
                        >
                          Replace selection
                        </button>
                      )}
                      <button
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                        className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="rounded-lg px-2.5 py-1.5 text-[11px] animate-pulse"
                  style={{
                    backgroundColor: "var(--color-bg-primary)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  Thinking...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="px-2 py-1.5 border-t" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex gap-1.5">
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask AI to help..."
                rows={1}
                className="flex-1 text-[11px] px-2 py-1.5 rounded border resize-none outline-none"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-bg-primary)",
                  color: "var(--color-text-primary)",
                  maxHeight: 80,
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim() || chatLoading}
                className="flex items-center justify-center p-1.5 rounded transition-colors disabled:opacity-30"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                  color: "var(--color-accent)",
                }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
            <div className="text-[8px] mt-1" style={{ color: "var(--color-text-secondary)" }}>
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        </div>
      )}

      {/* ── Sections tab (original quick actions) ────────────────────────── */}
      {activeTab === "sections" && (
        <>
          <div className="flex-1 overflow-y-auto">
            {AI_SECTIONS.map(({ key, label, section }) => {
              const text = state.aiSections[key] || ""
              const isLoading = state.aiLoading[key]
              const isExpanded = expandedKey === key
              const hasText = text.length > 0
              const wordCount = hasText ? text.split(/\s+/).length : 0

              return (
                <div key={key} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  <button
                    className="w-full flex items-center justify-between px-2 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-mono px-1 py-0.5 rounded flex-shrink-0"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--color-status-warning) 13%, transparent)",
                          color: "var(--color-status-warning)",
                        }}
                      >{section}</span>
                      <span className="text-[11px] truncate" style={{ color: "var(--color-text-primary)" }}>{label}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isLoading ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded animate-pulse"
                          style={{ backgroundColor: "color-mix(in srgb, var(--color-status-warning) 13%, transparent)", color: "var(--color-status-warning)" }}
                        >Generating...</span>
                      ) : hasText ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: "color-mix(in srgb, var(--color-status-success) 13%, transparent)", color: "var(--color-status-success)" }}
                        >{wordCount}w</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: "color-mix(in srgb, var(--color-text-secondary) 13%, transparent)", color: "var(--color-text-secondary)" }}
                        >Empty</span>
                      )}
                      <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        style={{ color: "var(--color-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-2 pb-2">
                      {hasText && (
                        <div className="text-[11px] leading-relaxed mb-2 p-2 rounded max-h-40 overflow-y-auto"
                          style={{ color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-primary)" }}
                        >
                          {text.length > 500 ? text.slice(0, 500) + "..." : text}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => state.generateAiSection(key)}
                          disabled={isLoading}
                          className="flex-1 flex items-center justify-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
                          style={{
                            borderColor: "color-mix(in srgb, var(--color-status-warning) 27%, transparent)",
                            color: "var(--color-status-warning)",
                            backgroundColor: "color-mix(in srgb, var(--color-status-warning) 7%, transparent)",
                          }}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3" />
                          </svg>
                          {isLoading ? "Generating..." : hasText ? "Regenerate" : "Generate"}
                        </button>
                        {hasText && (
                          <button
                            onClick={() => onInsert(key, text)}
                            className="flex items-center justify-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors"
                            style={{
                              borderColor: "color-mix(in srgb, var(--color-accent) 27%, transparent)",
                              color: "var(--color-accent)",
                              backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
                            }}
                            title="Insert into document"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Insert
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="px-2 py-1.5 border-t text-[9px]" style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}>
            Generate AI text, then insert into document.
          </div>
        </>
      )}
    </div>
  )
}

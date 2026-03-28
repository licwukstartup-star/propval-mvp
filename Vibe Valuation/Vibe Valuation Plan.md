# Vibe Valuation — The IDE for Valuations

## Context

**The insight:** Programming went from terminal → IDE + AI copilot. Valuation is still stuck in the terminal era.

| Programmer today | Valuer today (terminal era) | Valuer in PropVal (IDE era) |
|---|---|---|
| VS Code = integrated workspace | Paper + Word + Excel in separate windows | Single PropVal workspace |
| Git = version history | No history, overwrite files | Immutable report copies + audit trail |
| GitHub Copilot = ghost text | Type everything manually | Inline suggestions from real property data |
| Claude Code = chat + commands | No AI at all | Conversational sidebar: "add flood risk here" |
| MCP = connected tools | Manual copy-paste between apps | Auto-enrichment from 19+ APIs |

**What this solves:** A valuer currently spends 2-4 hours per report manually typing text that is 80% derivable from data they already have. Vibe Valuation turns that into a 15-minute refinement loop — AI drafts from real data, valuer accepts/edits/refines.

---

## Report Anatomy — What the Valuer Actually Does

Analysis of real Grant Stanley RICS reports (house + flat) reveals:

| Report content | % of report | Source | Vibe Valuation role |
|---|---|---|---|
| Boilerplate (T&Cs, standards, disclaimers) | ~40% | Template | **Auto-fill from ARTG** |
| Data lookups (EPC, flood, council tax, transport) | ~15% | APIs | **Auto-populate from enrichment** |
| Location description | ~8% | Area data | **AI drafts, valuer reviews** |
| Market commentary | ~8% | RICS survey | **Auto-insert (copy-paste today)** |
| **Property description + photos** | **~12%** | **Inspection** | **Valuer inputs, AI assists phrasing** |
| **Comparables + valuation reasoning** | **~10%** | **Judgment** | **Valuer selects, AI drafts narrative** |
| **Value opinion + measurement** | **~7%** | **Judgment** | **Valuer decides, system records** |

**The valuer's irreplaceable contribution is ~25-30%.** Vibe Valuation automates the other 70-75%.

---

## Proven Patterns — Borrowed from Industry Leaders

### Pattern 1: Ghost Text Inline Suggestions (from GitHub Copilot)
- Dimmed ghost text appears at cursor after typing pause
- **Tab** = accept all, **Ctrl+Right** = accept next word, **Esc** = dismiss
- Next Edit Suggestions (NES) predict where to edit next, not just what to type
- **Borrow:** Same UX in TipTap — ghost text, Tab accept, partial accept per word/sentence

### Pattern 2: Ambient Capture → Structured Draft (from DAX Copilot + Nabla)
- Doctor talks to patient normally, AI listens and transcribes
- Generates structured clinical note in EHR format in <20 seconds
- Doctor reviews draft, edits, signs off — saves 5 min per encounter
- DAX embedded inside Epic EHR; Nabla as Chrome extension — neither is a separate app
- **Borrow (Phase 2):** Valuer speaks observations during inspection → AI generates Section 2.3 Property Description in RICS format

### Pattern 3: Playbook-Driven Workflow (from Harvey AI)
- Firm uploads commercial playbook (standard positions, fallbacks, preferred language)
- Harvey applies playbook to incoming contracts, generates redlines + comment bubbles
- Workflow Builder: no-code tool to design custom agents from firm's proprietary knowledge
- **Borrow:** ARTG template IS the playbook. Firm's report template defines structure, tone, boilerplate. PropVal applies it automatically. Already built — this validates ARTG architecture.

### Pattern 4: Inline Accept/Reject with Track Changes (from Spellbook)
- Suggestions appear as inline redlines inside Word — not a separate panel
- Lawyer accepts, rejects, or edits each suggestion clause by clause
- "Watches as you draft and redline, learns from your edits, adapts in real time"
- **Borrow:** Show AI suggestions as distinguishable insertions. Valuer accepts/rejects per paragraph. Every edit feeds `valuer_feedback` → system adapts to valuer's style over time.

### Pattern 5: Work Inside Existing Tools (universal)
- Spellbook → inside Word. DAX → inside Epic. Harvey → inside Word + M365. Copilot → inside VS Code.
- **No successful professional copilot is a standalone app.**
- **Borrow:** Vibe Valuation lives inside the TipTap editor. Not a separate tab. Not a popup. The editor IS the workspace.

### Pattern 6: Review-Not-Generate Principle (universal)
- AI generates draft. Professional reviews, edits, takes responsibility.
- DAX: "draft clinical note" → doctor signs. Spellbook: "suggested redlines" → lawyer accepts.
- **Borrow:** Vibe Valuation never auto-fills the report. Every AI suggestion requires explicit valuer acceptance. The valuer's signature is on the report — AI is a drafter, not a co-signer.

---

## The Differentiator Nobody Has

Every professional copilot works with **one type of context:**

| Tool | Context it knows |
|---|---|
| Harvey | The contract text |
| DAX/Nabla | The doctor-patient conversation |
| GitHub Copilot | The codebase |
| Spellbook | The contract + firm playbook |

**Vibe Valuation knows ALL of these simultaneously:**
- Property data (80+ fields from 19 APIs)
- Comparables (selected, analysed, with £/sqft)
- Valuation model output (SEMV distribution)
- Market data (HPI trends, RICS survey)
- Template (ARTG structure + firm boilerplate)
- What the valuer is currently typing
- What the valuer has already written in other sections

**No existing professional copilot has this depth of structured domain data feeding its suggestions.** The UX patterns are borrowed. The context richness is unique.

---

## Product Vision — Three Layers

### Layer 1: Inline Copilot (ghost text) — Phase 1
- Valuer types in the TipTap editor
- After ~1 second pause, AI suggests the next sentence as grey ghost text
- Suggestion is context-aware: knows which section, all property data, comps, SEMV
- **Tab** = accept all, **Ctrl+Right** = accept next word (partial accept, from Copilot)
- **Ctrl+Space** = explicitly request suggestion
- Pause-based mode toggleable
- Every accept/reject/edit feeds into `valuer_feedback` → training flywheel (from Spellbook)

### Layer 2: Conversational Sidebar (evolved AI Sidebar) — Phase 1
- Current sidebar transforms from "click Generate" into a chat interface (from Harvey Edit Mode)
- Valuer types: "make this more formal", "add the lease details", "shorter", "mention the conservation area"
- AI sees: cursor position, selected text, full property context, what's already written
- Responses insert/replace text in editor directly
- Keep existing section-generation as "quick actions" above chat

### Layer 3: Ambient Voice → Structured Draft — Phase 2
- Valuer speaks observations during/after inspection (from DAX/Nabla pattern)
- AI generates Section 2.3 Property Description + Accommodation Schedule in RICS format
- Valuer reviews, edits, signs off
- Hybrid mode: ambient + dictation + typing (from Nabla's flexibility)

---

## Why This Wins

1. **No competitor has this.** Proptech has AVMs and template generators — none have an inline copilot with structured domain context.
2. **Training flywheel.** 20 valuers × 400 reports/month = 8,000 feedback signals/month. System learns each valuer's style (from Spellbook).
3. **The 15-minute report becomes real.** ARTG (playbook, from Harvey) + Vibe Valuation (copilot) + auto-enrichment (APIs) = only 25% left for the valuer.
4. **Scales with the platform.** Same copilot for 20 or 1,000 valuers. More valuers = better suggestions.
5. **Proven patterns, unique context.** UX borrowed from $2B+ companies. Domain data depth is ours alone.

---

## Buildable Scope — Phase 1 MVP

### 1. TipTap Inline Suggestion Extension
- Custom TipTap extension rendering ghost text (dimmed, grey) after cursor
- Typing pause (~1s debounce) OR Ctrl+Space hotkey triggers suggestion
- **Tab** = accept all, **Ctrl+Right** = accept next word (partial accept)
- Esc or any other key = dismiss
- Toggle in toolbar: "AI Assist: ON/OFF"

**Key files:** `frontend/src/app/components/report-typing/extensions/` (new), `EditorView.tsx`

### 2. Context-Aware Suggestion Endpoint
- `POST /api/ai-suggest`
- Input: `{ section_key, text_before, text_after, property_data, comparables, semv_output }`
- Output: `{ suggestion: string }` (1-2 sentences)
- Existing AI fallback chain (Groq→Cerebras→Gemini)
- Prompt tuned per section type via `prompt_registry`

**Key files:** `backend/routers/suggestions.py` (new), `backend/services/ai_service.py`

### 3. Sidebar Chat Evolution
- Replace "Generate" buttons with text input + message history
- Valuer types instruction → AI generates/modifies text in context
- "Insert at cursor" / "Replace selection" buttons on each response
- Keep section-generation as "quick actions" above chat

**Key files:** `frontend/src/app/components/report-typing/views/AiSidebar.tsx`

### 4. Feedback Capture (Training Flywheel)
- Tab (accept): log `{ section_key, suggestion, action: "accepted" }`
- Dismiss: log `{ section_key, suggestion, action: "dismissed" }`
- Edit after accept: log `{ section_key, suggestion, valuer_edit, action: "edited" }`
- All → `valuer_feedback` table (already exists)

**Key files:** `useReportTypingState.ts`, feedback endpoint in `backend/routers/`

### What NOT to Build in Phase 1
- Voice/ambient input (Phase 2 — DAX/Nabla pattern)
- Per-firm style learning (Phase 2 — DAX configurable styles)
- Slash commands in editor (Phase 2)
- Fine-tuned model (use general LLM + good prompts first)

---

## Architecture Sketch

```
Valuer types in TipTap Editor
        │
        ▼ (1s pause or Ctrl+Space)
InlineSuggestion Extension
        │
        ▼ gathers context
{ section_key, text_before, text_after, property_data, comps, semv }
        │
        ▼ POST /api/ai-suggest
Backend: generate_suggestion()
        │ (Groq → Cerebras → Gemini fallback)
        ▼
Ghost text rendered after cursor (dimmed grey)
        │
    ┌───┼───────┐
  [Tab] [Ctrl+→] [Dismiss]
    │      │        │
 Accept  Accept   Ignore
   all    word
    │      │        │
    └──────┴────────┘
              ▼
    valuer_feedback table
    (training flywheel)
```

Sidebar chat flow:
```
Valuer types in chat: "add flood risk"
        │
        ▼
Backend: generate_chat_response()
  context = { selected_text, cursor_section, full_property_data, chat_history }
        │
        ▼
AI response shown in sidebar
        │
  [Insert at cursor] / [Replace selection]
        │
        ▼
Text inserted into TipTap editor
        │
        ▼
valuer_feedback table
```

---

## Verification / How to Test

1. **Ghost text:** Start typing in any section, pause → grey suggestion appears with property-specific data
2. **Tab accept:** Press Tab → suggestion becomes real text
3. **Partial accept:** Press Ctrl+Right → only next word accepted (from Copilot pattern)
4. **Toggle:** Turn off AI Assist → no suggestions on pause
5. **Chat sidebar:** Type "describe the location" → AI responds with real property data
6. **Insert:** Click "Insert at cursor" → text appears at correct editor position
7. **Feedback:** Check `valuer_feedback` table → accepted/dismissed/edited logged
8. **Performance:** Suggestion appears within 1-2 seconds of pause

---

## Competitive Positioning

> "Every valuation firm types the same 80% of every report from scratch. PropVal's Vibe Valuation is the first inline AI copilot for property valuation — it knows your property data, your comparables, your valuation, and your house style. The valuer's job shifts from typing to refining. That's how you go from 3-hour reports to 15-minute reports."

> "Harvey did this for lawyers. DAX did this for doctors. Vibe Valuation does this for valuers — with richer structured context than any of them."

ARTG gives you the skeleton. Vibe Valuation fills in the muscle.

---

## Research Sources

- **Harvey AI** — $2B+ legal AI: playbook-driven workflow, Word integration, redlining
- **Spellbook** — Contract AI inside Word: inline suggestions, learns from edits
- **DAX Copilot** (Microsoft/Nuance) — Ambient clinical AI: listen → structured note, 400+ health systems
- **Nabla** — Medical AI scribe: ambient + dictation hybrid, $70M raised
- **Clio** — #1 legal platform: AI across draft, manage, bill
- **GitHub Copilot** — Ghost text, Tab accept, partial accept, NES, 100M+ users

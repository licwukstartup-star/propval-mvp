# Vibe Valuation — User Guide

## What is Vibe Valuation?

Vibe Valuation is PropVal's built-in AI writing assistant for valuation reports. It works like GitHub Copilot for code — but for RICS-compliant property valuation reports. Instead of typing every sentence from scratch, you type a few words and the AI suggests the rest, using your actual property data, comparables, and valuation figures.

**Two tools, one editor:**

1. **Ghost Text** — grey suggestion text appears as you type. Press Tab to accept.
2. **AI Chat** — a conversational sidebar where you can ask the AI to draft, rephrase, or edit text.

Both tools know your property data. They never invent facts. You always have final control.

---

## Getting Started

### 1. Open the Report Editor

1. Search for a property by postcode
2. Select the address
3. Navigate to the **Report Typing** tab
4. Select **Editor** view

You will see the TipTap document editor with a toolbar at the top and the AI sidebar on the right.

### 2. Check AI Assist is ON

Look at the toolbar — you should see a button that says **"Assist ON"** with a sparkle icon. If it says "Assist OFF", click it to turn on ghost text suggestions.

When AI Assist is ON:
- The button shows green with "Assist ON"
- Ghost text will appear after you pause typing
- Ctrl+Space triggers a suggestion immediately

When AI Assist is OFF:
- The button shows grey with "Assist OFF"
- No ghost text appears
- The AI Chat sidebar still works independently

---

## Ghost Text (Inline Suggestions)

### How It Works

1. **Type normally** in any section of the report
2. **Pause for 1 second** — grey italic text appears after your cursor
3. The suggestion continues your sentence using real property data

### Keyboard Shortcuts

| Action | Shortcut | What happens |
|---|---|---|
| **Accept full suggestion** | `Tab` | The entire grey text becomes part of your report |
| **Accept next word** | `Ctrl + →` (Right Arrow) | Only the next word is accepted, rest stays as ghost text |
| **Dismiss suggestion** | `Esc` | Ghost text disappears |
| **Request suggestion now** | `Ctrl + Space` | Triggers a suggestion immediately without waiting 1 second |
| **Keep typing** | Any letter key | Ghost text disappears and your typing continues normally |

### Tips for Best Results

- **Write the start of a sentence** — the AI works best when it can see where you're heading. "The property is located in" gives better results than just "The".
- **Be in the right section** — the AI detects which report section you're in (Location, Property Description, Valuation, etc.) and adjusts its suggestions accordingly.
- **Use Ctrl+Space in empty sections** — if you've just started a new section and want a first sentence, press Ctrl+Space to request a suggestion.
- **Partial accept is powerful** — use Ctrl+Right Arrow to accept one word at a time. This lets you take the parts you like and then continue typing your own words.
- **Don't fight it** — if the suggestion isn't right, just keep typing. The ghost text disappears instantly and won't interfere.

### What the AI Knows

Ghost text suggestions are informed by:

- **Property address, postcode, and borough**
- **Property type, built form, and construction era**
- **Floor area, number of rooms, EPC rating**
- **Tenure, heating type, council tax band**
- **Flood risk levels** (rivers/sea and surface water)
- **Your adopted comparables** (addresses and prices)
- **SEMV valuation output** (mean, confidence interval)
- **What you've already written** in the current section

The AI never invents addresses, prices, measurements, or dates. If it doesn't have the data, it won't guess.

---

## AI Chat Sidebar

### Opening the Chat

1. Click the **"AI"** button at the right end of the toolbar
2. The sidebar opens — you'll see two tabs: **Chat** and **Sections**
3. **Chat** is the conversational assistant (default tab)
4. **Sections** contains the original section generators (Location, Market Commentary, etc.)

### How to Use the Chat

Type a natural language instruction in the text box at the bottom and press **Enter**.

**Example instructions:**

| What you type | What the AI does |
|---|---|
| "describe the location" | Drafts a location description paragraph using the property's postcode, borough, and nearby amenities |
| "add the flood risk details" | Writes flood risk text using the Environment Agency data for this property |
| "make this more formal" | Rephrases your selected text in formal RICS register |
| "shorten this paragraph" | Condenses the selected text while keeping key facts |
| "add the lease details" | Writes tenure text using the property's lease term, commencement, and expiry |
| "draft valuation considerations" | Writes a structured comparable analysis using your adopted comps |
| "rewrite without marketing language" | Removes subjective adjectives and makes the text factual |

### Working with Selected Text

1. **Select text** in the editor (highlight it with your mouse or Shift+Arrow keys)
2. The sidebar shows a blue **"Selected:"** indicator at the top with a preview of your selection
3. Type your instruction — the AI knows what you've selected
4. When the AI responds, you'll see two action buttons:
   - **"Insert at cursor"** — adds the text at your current cursor position
   - **"Replace selection"** — replaces your highlighted text with the AI's version
5. **"Copy"** — copies the response to your clipboard

### Chat Tips

- **Be specific** — "add flood risk" works better than "add some details"
- **Iterate** — you can follow up: "now make it shorter", "add the surface water risk too"
- **The chat remembers** — it keeps your last few messages as context, so follow-up requests understand what came before
- **Shift+Enter** for multi-line instructions
- **Click the suggestion hints** when the chat is empty — they pre-fill common instructions

### Sections Tab (Quick Actions)

Switch to the **Sections** tab for the original full-section generators:

1. Click a section (e.g., "2.2 Location Description")
2. Click **"Generate"** — the AI writes the full section text
3. Preview it in the expandable panel
4. Click **"Insert"** to place it into the document at the correct section
5. Edit in the document as needed

These are best for generating entire sections from scratch. The Chat tab is better for refining, rephrasing, or adding specific details.

---

## Workflow — Writing a Report with Vibe Valuation

Here's how an experienced valuer would use these tools to write a report efficiently:

### Step 1: Let the template do the heavy lifting

When you load a report template, PropVal automatically fills:
- All boilerplate sections (T&Cs, disclaimers, valuation standards)
- API-populated data (EPC, flood risk, council tax, transport links)
- Case metadata (dates, client name, reference numbers)

**You don't need to type any of this.** It's already in the document.

### Step 2: Generate narrative sections

Use the **Sections tab** to generate first drafts of:
- Location Description (Section 2.2)
- Market Commentary (Section 3.3)
- Valuation Considerations (Section 3.6)

Click Generate → review → Insert. Then edit the text in the document.

### Step 3: Type with ghost text assistance

For sections that need your professional input:
- **Property Description** — start typing what you observed during inspection. Ghost text will suggest continuations using the property data.
- **Condition** — type your observations. Ghost text completes with appropriate surveyor language.
- **Accommodation schedule** — type room names. Ghost text suggests descriptions based on property type and era.

Use **Tab** to accept good suggestions. Use **Ctrl+Right** to accept word-by-word. Keep typing to ignore.

### Step 4: Refine with the Chat

After your first pass:
- Select a paragraph → type "make this more concise" in the chat
- Notice you forgot flood risk details → type "add the flood risk" in the chat and click "Insert at cursor"
- A paragraph sounds too informal → select it, type "formal RICS register"
- Need to mention the conservation area → "add a note about the conservation area status"

### Step 5: Final review

The AI assists with drafting — the professional opinion is yours. Always:
- Review every AI-generated paragraph before accepting
- Verify facts against your inspection notes
- Ensure the value opinion and comparable analysis reflect your professional judgment
- Check that no AI-generated text contradicts your observations

---

## Important Notes

### The AI is a drafter, not a co-signer

Your name and RICS credentials go on the report. The AI helps you write faster, but every word is your responsibility. The AI will never:
- Provide a valuation figure
- Override your professional judgment
- Insert text without your explicit acceptance (Tab, Insert, or Replace)

### Data privacy

- Ghost text suggestions are generated using free-tier LLM providers (Groq, Cerebras, Gemini)
- Property data is sent to these providers to generate contextual suggestions
- No property data is stored by the LLM providers
- All AI interactions are logged internally for quality improvement

### Your feedback trains the system

Every time you:
- **Accept** a suggestion (Tab) — the system learns that was a good suggestion
- **Dismiss** a suggestion (Esc) — the system learns to avoid that type of suggestion
- **Accept then edit** — the system learns what you changed and why

Over time, suggestions become more aligned with your writing style and preferences.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| No ghost text appears | Check "Assist ON" button is green. Check you've typed at least 10 characters. |
| Ghost text appears but is irrelevant | Make sure a property is loaded (search and select an address first). The AI needs property data. |
| Suggestions are slow (>3 seconds) | This depends on the LLM provider's speed. Try Ctrl+Space to trigger manually. If consistently slow, the free-tier API may be rate-limited. |
| Tab key inserts a tab character instead of accepting | This happens if there's no ghost text showing. Tab only accepts when grey text is visible. |
| Chat returns "Error: Could not generate response" | The AI provider may be temporarily unavailable. Wait a moment and try again. |
| Chat doesn't know about my property | Make sure you've searched and selected a property before opening the editor. The chat uses the loaded property data. |
| "Replace selection" button doesn't appear | You need to have text selected (highlighted) in the editor. The button only shows when there's a selection. |

---

## Quick Reference Card

```
GHOST TEXT                          AI CHAT
─────────────────────               ─────────────────────
Tab         = Accept all            Enter       = Send message
Ctrl+→      = Accept word           Shift+Enter = New line
Esc         = Dismiss
Ctrl+Space  = Request now           "Insert at cursor"  = Add text
Any key     = Dismiss & type        "Replace selection" = Swap text
                                    "Copy"              = Clipboard

TOOLBAR
─────────────────────
[✦ Assist ON/OFF]    = Toggle ghost text
[⚗ AI]               = Toggle sidebar
```

---

*Vibe Valuation is part of PropVal by AllRange. For support, contact your firm administrator.*

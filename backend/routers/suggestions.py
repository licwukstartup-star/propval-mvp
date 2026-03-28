"""Vibe Valuation — inline suggestion endpoint for the TipTap editor.

Returns short (1-2 sentence) AI completions based on:
- Which report section the cursor is in
- The text before/after the cursor
- Full property data, comparables, and SEMV output

Designed for low latency (<2s) to feel like GitHub Copilot ghost text.
"""

import logging
from fastapi import APIRouter, Request
from pydantic import BaseModel

from routers.rate_limit import limiter
from services.ai_service import _call_gemini, _call_openai_compat, _GROQ_URL, _GROQ_MODEL, _CEREBRAS_URL, _CEREBRAS_MODEL
from services.ai_usage_logger import log_ai_usage
import os
import time

router = APIRouter(prefix="/api/ai-suggest", tags=["vibe-valuation"])
logger = logging.getLogger(__name__)


# ── Request / Response models ─────────────────────────────────────────────────

class SuggestionRequest(BaseModel):
    section_key: str  # e.g. "location_description", "property_description", "valuation_considerations"
    text_before: str  # text before cursor (last ~500 chars)
    text_after: str = ""  # text after cursor (next ~200 chars)
    property_data: dict = {}  # full PropertyResult
    comparables: list[dict] = []  # adopted comparables
    semv_output: dict = {}  # SEMV valuation output


class SuggestionResponse(BaseModel):
    suggestion: str
    provider: str = ""
    latency_ms: int = 0


# ── Section-aware system prompts ──────────────────────────────────────────────

_INLINE_SYSTEM_PROMPT = (
    "You are an AI writing assistant embedded in a property valuation report editor. "
    "A chartered surveyor is typing a report section and has paused. "
    "Your job: suggest the NEXT 1-2 sentences that naturally continue their text.\n\n"
    "RULES:\n"
    "- Continue the valuer's writing style and tone exactly.\n"
    "- Use ONLY facts from the property data provided. Never invent data.\n"
    "- Write in formal third-person English (e.g. 'The property is...', 'The subject dwelling comprises...').\n"
    "- Output ONLY the continuation text. No quotes, no labels, no explanation.\n"
    "- Keep it to 1-2 sentences maximum. Be concise.\n"
    "- If there is not enough context to suggest anything useful, return an empty string.\n"
    "- Do NOT repeat what the valuer has already written."
)

_SECTION_HINTS: dict[str, str] = {
    "location_description": "This section describes the property's location, neighbourhood character, transport links, amenities, and green spaces.",
    "subject_development": "This section describes the wider development or estate the property sits within.",
    "subject_building": "This section describes the specific building — construction, storeys, external finish, roof, windows.",
    "subject_property": "This section describes the individual dwelling — accommodation, rooms, condition, heating, EPC.",
    "market_commentary": "This section provides market commentary — HPI trends, transaction volumes, market sentiment.",
    "valuation_considerations": "This section analyses comparable evidence and justifies the adopted valuation rate.",
    "property_description": "This section describes the property's physical characteristics from inspection.",
    "accommodation": "This section lists the room-by-room accommodation schedule.",
    "condition": "This section assesses the property's condition and any defects observed.",
    "tenure": "This section describes the tenure, lease terms, and any encumbrances.",
    "flood_risk": "This section reports flood risk from Environment Agency data.",
    "energy_performance": "This section reports EPC rating and energy efficiency details.",
}


# ── Build context for the LLM ─────────────────────────────────────────────────

def _build_inline_prompt(req: SuggestionRequest) -> str:
    """Build a compact prompt with property context + cursor position."""
    lines: list[str] = []

    # Section context
    hint = _SECTION_HINTS.get(req.section_key, "")
    if hint:
        lines.append(f"REPORT SECTION: {req.section_key}")
        lines.append(f"SECTION PURPOSE: {hint}")
        lines.append("")

    # Key property facts (compact — not the full dump)
    d = req.property_data
    if d:
        lines.append("KEY PROPERTY FACTS:")
        if d.get("address"):
            lines.append(f"  Address: {d['address']}")
        if d.get("postcode"):
            lines.append(f"  Postcode: {d['postcode']}")
        if d.get("admin_district"):
            lines.append(f"  Borough: {d['admin_district']}")
        if d.get("property_type"):
            lines.append(f"  Type: {d['property_type']}")
        if d.get("built_form"):
            lines.append(f"  Form: {d['built_form']}")
        if d.get("construction_age_band"):
            lines.append(f"  Era: {d['construction_age_band']}")
        if d.get("floor_area_m2"):
            try:
                sqm = float(d["floor_area_m2"])
                lines.append(f"  Floor area: {sqm:.0f} sqm ({sqm * 10.764:.0f} sqft)")
            except (ValueError, TypeError):
                pass
        if d.get("num_rooms"):
            lines.append(f"  Rooms: {d['num_rooms']}")
        if d.get("energy_rating"):
            lines.append(f"  EPC: {d['energy_rating']}")
        if d.get("tenure"):
            lines.append(f"  Tenure: {d['tenure']}")
        if d.get("heating_type"):
            lines.append(f"  Heating: {d['heating_type']}")
        if d.get("council_tax_band"):
            lines.append(f"  Council tax: Band {d['council_tax_band']}")
        # Flood
        if d.get("rivers_sea_risk"):
            lines.append(f"  Flood (rivers/sea): {d['rivers_sea_risk']}")
        if d.get("surface_water_risk"):
            lines.append(f"  Flood (surface): {d['surface_water_risk']}")
        lines.append("")

    # Comparables (compact)
    if req.comparables:
        lines.append(f"COMPARABLES ({len(req.comparables)}):")
        for i, c in enumerate(req.comparables[:5], 1):
            addr = c.get("address", "?")
            price = c.get("price", "?")
            price_str = f"\u00a3{price:,.0f}" if isinstance(price, (int, float)) else str(price)
            lines.append(f"  {i}. {addr} \u2014 {price_str}")
        lines.append("")

    # SEMV output (compact)
    if req.semv_output:
        sv = req.semv_output
        try:
            if sv.get("mean") is not None:
                lines.append(f"SEMV VALUATION: mean \u00a3{float(sv['mean']):,.0f}")
            if sv.get("p5") is not None and sv.get("p95") is not None:
                lines.append(f"  90% CI: \u00a3{float(sv['p5']):,.0f} \u2013 \u00a3{float(sv['p95']):,.0f}")
        except (ValueError, TypeError):
            pass
        lines.append("")

    # The actual cursor context
    lines.append("---")
    lines.append("TEXT THE VALUER HAS WRITTEN SO FAR IN THIS SECTION:")
    lines.append(req.text_before[-500:] if len(req.text_before) > 500 else req.text_before)
    lines.append("")
    lines.append("CONTINUE FROM HERE (1-2 sentences):")

    return "\n".join(lines)


# ── Provider fallback chain (reuses ai_service internals) ─────────────────────

async def _generate_suggestion(prompt: str, system_prompt: str = "") -> tuple[str, str, int]:
    """Try Groq → Cerebras → Gemini. Returns (text, provider, latency_ms)."""
    if not system_prompt:
        system_prompt = _INLINE_SYSTEM_PROMPT

    providers: list[tuple[str, str, str, str, str]] = []  # (name, api_key, url, model, type)
    groq_key = os.getenv("GROQ_API_KEY", "")
    cerebras_key = os.getenv("CEREBRAS_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    if groq_key:
        providers.append(("groq", groq_key, _GROQ_URL, _GROQ_MODEL, "openai"))
    if cerebras_key:
        providers.append(("cerebras", cerebras_key, _CEREBRAS_URL, _CEREBRAS_MODEL, "openai"))
    if gemini_key:
        providers.append(("gemini", gemini_key, "", "", "gemini"))

    for name, api_key, url, model, ptype in providers:
        try:
            t0 = time.time()
            if ptype == "gemini":
                text, _, pt, ot = await _call_gemini(prompt, system_prompt, api_key)
            else:
                text, _, pt, ot = await _call_openai_compat(prompt, system_prompt, api_key, url, model)
            latency = int((time.time() - t0) * 1000)
            # Clean up — strip quotes, labels, etc.
            text = text.strip().strip('"').strip("'").strip()
            if text.lower().startswith("continuation:"):
                text = text[13:].strip()
            return text, name, latency
        except Exception as e:
            logger.warning("Suggestion provider %s failed: %s", name, e)
            continue

    return "", "none", 0


# ── Endpoint ──────────────────────────────────────────────────────────────────

class SuggestionFeedbackRequest(BaseModel):
    section_key: str
    suggestion: str
    action: str  # "accepted" | "accepted_word" | "dismissed" | "edited"
    valuer_edit: str = ""  # if action is "edited", what the valuer changed it to
    property_type: str = ""
    borough: str = ""


@router.post("/feedback")
@limiter.limit("120/minute")
async def submit_suggestion_feedback(body: SuggestionFeedbackRequest, request: Request):
    """Log inline suggestion accept/dismiss/edit for the training flywheel."""
    try:
        await log_ai_usage(
            endpoint="ai-suggest-feedback",
            model=body.action,
            input_text=body.suggestion[:300],
            output_text=body.valuer_edit[:300] if body.valuer_edit else "",
            success=body.action in ("accepted", "accepted_word", "edited"),
            latency_ms=0,
            section_key=body.section_key,
            property_type=body.property_type or None,
            borough=body.borough or None,
        )
    except Exception:
        pass
    return {"status": "ok"}


# ── Chat endpoint for conversational sidebar ──────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    instruction: str  # what the valuer wants: "add flood risk", "make more formal", etc.
    selected_text: str = ""  # currently selected text in editor (if any)
    cursor_section: str = ""  # which section the cursor is in
    context_text: str = ""  # surrounding text (paragraph/section around cursor)
    property_data: dict = {}
    comparables: list[dict] = []
    chat_history: list[ChatMessage] = []  # previous messages in this conversation

class ChatResponse(BaseModel):
    response: str
    provider: str = ""
    latency_ms: int = 0


_CHAT_SYSTEM_PROMPT = (
    "You are an AI assistant embedded in a property valuation report editor. "
    "A chartered surveyor is writing an RICS-compliant valuation report and has asked you for help.\n\n"
    "RULES:\n"
    "- Follow the valuer's instruction precisely.\n"
    "- Use ONLY facts from the property data provided. Never invent data.\n"
    "- Write in formal third-person English unless the valuer asks otherwise.\n"
    "- Output ONLY the requested text. No explanations, no labels, no markdown.\n"
    "- If asked to rephrase or edit, return the full revised text.\n"
    "- If asked to add something, return only the new text to add.\n"
    "- Keep the same register and tone as the surrounding report text."
)


def _build_chat_prompt(req: ChatRequest) -> str:
    """Build the user prompt for the chat endpoint."""
    lines: list[str] = []

    # Property context (compact)
    d = req.property_data
    if d:
        lines.append("PROPERTY:")
        for key in ["address", "postcode", "admin_district", "property_type", "built_form",
                     "construction_age_band", "floor_area_m2", "energy_rating", "tenure",
                     "num_rooms", "heating_type", "rivers_sea_risk", "surface_water_risk"]:
            if d.get(key):
                lines.append(f"  {key}: {d[key]}")
        lines.append("")

    # Comparables (compact)
    if req.comparables:
        lines.append(f"COMPARABLES ({len(req.comparables)}):")
        for i, c in enumerate(req.comparables[:5], 1):
            addr = c.get("address", "?")
            price = c.get("price", "?")
            price_str = f"\u00a3{price:,.0f}" if isinstance(price, (int, float)) else str(price)
            lines.append(f"  {i}. {addr} \u2014 {price_str}")
        lines.append("")

    # Current context (truncated to avoid blowing LLM context limits)
    if req.cursor_section:
        lines.append(f"CURRENT SECTION: {req.cursor_section}")
    if req.selected_text:
        sel = req.selected_text[:1000] + ("..." if len(req.selected_text) > 1000 else "")
        lines.append(f"SELECTED TEXT:\n{sel}\n")
    if req.context_text:
        ctx = req.context_text[:1000] + ("..." if len(req.context_text) > 1000 else "")
        lines.append(f"SURROUNDING TEXT:\n{ctx}\n")

    # Chat history
    if req.chat_history:
        lines.append("CONVERSATION SO FAR:")
        for msg in req.chat_history[-6:]:  # last 6 messages
            lines.append(f"  {msg.role.upper()}: {msg.content[:300]}")
        lines.append("")

    # The instruction
    lines.append(f"VALUER'S REQUEST: {req.instruction}")

    return "\n".join(lines)


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
async def chat_with_ai(req: ChatRequest, request: Request):
    """Conversational AI assistant for the report editor sidebar."""
    if not req.instruction.strip():
        return ChatResponse(response="")

    prompt = _build_chat_prompt(req)
    text, provider, latency_ms = await _generate_suggestion(prompt, _CHAT_SYSTEM_PROMPT)

    try:
        await log_ai_usage(
            endpoint="ai-suggest-chat",
            model=provider,
            input_text=req.instruction[:200],
            output_text=text[:200],
            success=bool(text),
            latency_ms=latency_ms,
            section_key=req.cursor_section or "chat",
            property_type=req.property_data.get("property_type"),
            borough=req.property_data.get("admin_district"),
        )
    except Exception:
        pass

    return ChatResponse(response=text, provider=provider, latency_ms=latency_ms)


@router.post("", response_model=SuggestionResponse)
@limiter.limit("30/minute")
async def get_suggestion(req: SuggestionRequest, request: Request):
    """Return an inline text suggestion for the valuer's current cursor position."""
    # Skip if nothing to complete
    if not req.text_before.strip():
        return SuggestionResponse(suggestion="")

    prompt = _build_inline_prompt(req)
    suggestion, provider, latency_ms = await _generate_suggestion(prompt)

    # Log for analytics (non-blocking)
    try:
        await log_ai_usage(
            endpoint="ai-suggest",
            model=provider,
            input_text=req.text_before[-200:],
            output_text=suggestion[:200],
            success=bool(suggestion),
            latency_ms=latency_ms,
            section_key=req.section_key,
            property_type=req.property_data.get("property_type"),
            borough=req.property_data.get("admin_district"),
        )
    except Exception:
        pass  # Never block the response for logging

    return SuggestionResponse(
        suggestion=suggestion,
        provider=provider,
        latency_ms=latency_ms,
    )

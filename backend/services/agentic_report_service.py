"""Agentic Report Service — AI-generated full valuation report.

Uses the same Groq -> Cerebras -> Gemini free-tier fallback chain as ai_service.
Optionally falls back to Anthropic (paid) with --anthropic flag.

The agent receives all case data (subject property, comparables, SEMV output,
firm sample report, RICS guidance) and produces a complete RICS-compliant
valuation report in a single call.
"""

import json
import logging
import os
import re
import time

import httpx

from .ai_usage_logger import log_ai_usage

logger = logging.getLogger(__name__)

# ── Provider config (same as ai_service.py) ─────────────────────────────────

_GROQ_MODEL = "llama-3.3-70b-versatile"
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

_CEREBRAS_MODEL = "llama-3.3-70b"
_CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"

_GEMINI_MODEL = "gemini-2.5-flash"
_GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:generateContent"

# ── Reference texts (loaded once) ───────────────────────────────────────────

_FIRM_SAMPLE: str | None = None
_RICS_GUIDANCE: str | None = None


def _load_reference_texts():
    """Load firm sample report and RICS guidance from Research/AgenticPropVal/."""
    global _FIRM_SAMPLE, _RICS_GUIDANCE
    if _FIRM_SAMPLE is not None:
        return

    from pathlib import Path
    base = Path(__file__).resolve().parent.parent.parent / "Research" / "AgenticPropVal"

    firm_path = base / "firm_sample_report.txt"
    rics_path = base / "rics_guidance.txt"

    _FIRM_SAMPLE = firm_path.read_text(encoding="utf-8") if firm_path.exists() else ""
    _RICS_GUIDANCE = rics_path.read_text(encoding="utf-8") if rics_path.exists() else ""

    if not _FIRM_SAMPLE:
        logger.warning("firm_sample_report.txt not found at %s", firm_path)
    if not _RICS_GUIDANCE:
        logger.warning("rics_guidance.txt not found at %s", rics_path)


# ── System prompt ────────────────────────────────────────────────────────────

def _build_system_prompt() -> str:
    _load_reference_texts()
    return f"""<role>
You are a senior MRICS Registered Valuer with 15+ years of UK residential
valuation experience. You produce RICS Red Book compliant valuation reports
for secured lending purposes. You write with precision, authority, and
professional rigour. You never fabricate data.
</role>

<methodology>
Follow this reasoning process for each report:

1. ABSORB — Read all enrichment data for the subject property.
2. ANALYSE COMPARABLES — Calculate price per sq ft for each. Rank by relevance.
3. CROSS-REFERENCE SEMV — Advisory only. Do NOT override the valuer's adopted figure.
4. FORM OPINION — Use the valuer's exact adopted Market Value figure.
5. WRITE EACH SECTION — Match the firm's established writing style.
6. SELF-AUDIT — Check output against VPS 3 mandatory content list.
</methodology>

<rics_compliance>
{_RICS_GUIDANCE}
</rics_compliance>

<firm_style_reference>
Match this writing style exactly: tone, register, sentence structure, vocabulary.

{_FIRM_SAMPLE}
</firm_style_reference>

<output_schema>
Return a single JSON object with this structure:

{{
  "narratives": {{
    "location_description": "2-3 paragraphs, 200-350 words",
    "development_description": "1-2 paragraphs, 100-200 words",
    "building_description": "1-2 paragraphs, 100-200 words",
    "property_summary": "1-2 paragraphs, 100-200 words",
    "market_commentary": "2-3 paragraphs, 200-350 words",
    "valuation_considerations": "5-6 paragraphs, 350-500 words, bullet-pointed"
  }},
  "populated_placeholders": {{
    "property_address": "full address",
    "market_value": 0,
    "market_value_words": "...",
    "market_rent": 0,
    "reinstatement_cost": 0,
    "adopted_psf": 0,
    "gia_sqft": 0,
    "gia_sqm": 0,
    "comp_count": 0,
    "suitable_security": true,
    "lease_unexpired": 0
  }},
  "rics_self_audit": {{
    "vps3_checklist": {{ 16 boolean items }},
    "notes": "any compliance observations"
  }}
}}

Return ONLY this JSON. No markdown, no explanation.
</output_schema>

<constraints>
- Use ONLY the data provided. Never fabricate facts.
- Market Value MUST match the valuer's adopted figure exactly.
- British English. £, sq ft, sq m conventions.
- Plain prose, no markdown.
- For valuation_considerations, start each paragraph with bullet (•).
</constraints>"""


# ── User message builder ─────────────────────────────────────────────────────

def _build_user_message(case_data: dict) -> str:
    """Format case data as structured text (not raw JSON)."""
    lines = []

    # Case metadata
    case = case_data.get("case", {})
    lines.append("=== CASE METADATA ===")
    for k in ["report_reference", "client_name", "applicant_name", "valuation_purpose",
              "valuation_basis", "report_type", "valuation_date", "inspection_date",
              "report_date", "preparer_name", "preparer_quals", "firm_name"]:
        if case.get(k):
            lines.append(f"{k.replace('_', ' ').title()}: {case[k]}")
    lines.append("")

    # Subject property
    prop = case_data.get("subject_property", {})
    lines.append("=== SUBJECT PROPERTY ===")
    lines.append(f"Address: {prop.get('address', 'Unknown')}")
    lines.append(f"Postcode: {prop.get('postcode', 'Unknown')}")

    for k, label in [("admin_district", "Local Authority"), ("property_type", "Property type"),
                      ("built_form", "Built form"), ("construction_age_band", "Construction era"),
                      ("energy_rating", "EPC rating"), ("tenure", "Tenure"),
                      ("lease_unexpired_years", "Lease unexpired"), ("council_tax_band", "Council tax")]:
        if prop.get(k):
            lines.append(f"{label}: {prop[k]}")

    sqm = prop.get("floor_area_m2")
    if sqm:
        lines.append(f"Floor area: {sqm} sq m ({float(sqm) * 10.7639:.0f} sq ft)")

    # Flood, environmental
    for k in ["rivers_sea_risk", "surface_water_risk", "planning_flood_zone", "radon_risk"]:
        if prop.get(k):
            lines.append(f"{k.replace('_', ' ').title()}: {prop[k]}")

    # Transport
    if prop.get("nearest_station"):
        lines.append(f"Nearest station: {prop['nearest_station']} ({prop.get('station_distance_m', '?')}m)")
    if prop.get("ptal_rating"):
        lines.append(f"PTAL: {prop['ptal_rating']}")

    # Sales history
    sales = prop.get("sales", [])
    if sales:
        lines.append("\nTransaction history:")
        for s in sales[:5]:
            lines.append(f"  - {s.get('date')}: £{s.get('price', 0):,}")
    lines.append("")

    # Valuer proforma
    proforma = prop.get("valuer_proforma", {})
    if proforma:
        lines.append("=== VALUER'S INSPECTION NOTES ===")
        for k in ["floor_level", "num_bedrooms", "num_bathrooms", "num_receptions",
                   "orientation", "outlook", "parking", "garden", "condition_overall",
                   "condition_notes", "gia_sqft", "gia_sqm"]:
            if proforma.get(k):
                lines.append(f"{k.replace('_', ' ').title()}: {proforma[k]}")
        lines.append("")

    # Valuation figures
    val = prop.get("valuer_valuation", {})
    if val:
        lines.append("=== VALUER'S ADOPTED FIGURES (USE THESE EXACTLY) ===")
        if val.get("market_value"):
            lines.append(f"Market Value: £{val['market_value']:,}")
        if val.get("adopted_psf"):
            lines.append(f"Adopted rate: £{val['adopted_psf']}/sq ft")
        if val.get("market_rent"):
            lines.append(f"Market rent: £{val['market_rent']:,} per annum")
        if val.get("reinstatement_cost"):
            lines.append(f"Reinstatement cost: £{val['reinstatement_cost']:,}")
        lines.append("")

    # Comparables
    comps = case_data.get("comparables", [])
    if comps:
        lines.append(f"=== COMPARABLE EVIDENCE ({len(comps)} transactions) ===")
        for i, c in enumerate(comps, 1):
            sqm_c = c.get("floor_area_sqm", 0)
            sqft_c = float(sqm_c) * 10.7639 if sqm_c else 0
            psf = c.get("price", 0) / sqft_c if sqft_c > 0 else 0
            lines.append(f"\nComp {i}: {c.get('address', 'Unknown')}")
            lines.append(f"  Price: £{c.get('price', 0):,}  |  Date: {c.get('transaction_date', '?')}")
            lines.append(f"  Type: {c.get('property_type', '?')}  |  Beds: {c.get('bedrooms', '?')}")
            if sqft_c > 0:
                lines.append(f"  Floor area: {sqm_c} sq m ({sqft_c:.0f} sq ft)  |  £/sq ft: £{psf:.0f}")
            lines.append(f"  EPC: {c.get('epc_rating', '?')}  |  Distance: {c.get('distance_m', '?')}m")
        lines.append("")

    # SEMV
    semv = case_data.get("semv_output", {})
    if semv:
        stats = semv.get("stats", {})
        lines.append("=== SEMV MODEL OUTPUT (advisory) ===")
        for k in ["mean", "median", "p5", "p95", "std"]:
            if stats.get(k):
                lines.append(f"{k}: £{stats[k]:,}")
        if semv.get("adopted_value_percentile"):
            lines.append(f"Adopted value percentile: {semv['adopted_value_percentile']}th")
        lines.append("")

    # Market context
    market = case_data.get("market_context", {})
    if market:
        lines.append("=== MARKET CONTEXT ===")
        for k in ["average_price", "hpi_12_month_pct", "transaction_volume",
                   "supply_demand", "days_on_market_avg"]:
            if market.get(k):
                val_str = f"£{market[k]:,}" if k == "average_price" else str(market[k])
                lines.append(f"{k.replace('_', ' ').title()}: {val_str}")
        lines.append("")

    lines.append("Produce all six narrative sections plus populated placeholders and RICS self-audit.")
    lines.append("Return a single JSON object as specified in the output schema.")

    return "\n".join(lines)


# ── JSON extraction ──────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict:
    """Extract JSON from model response, handling control chars and fences."""
    m = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)

    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in response")

    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                raw = text[start:i + 1]
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", raw)
                    return json.loads(cleaned)

    raise ValueError("Unbalanced braces in JSON response")


# ── Provider calls ───────────────────────────────────────────────────────────

async def _call_openai_compat(
    system_prompt: str, user_message: str, api_key: str, base_url: str, model: str
) -> tuple[str, str, int, int]:
    """Call OpenAI-compatible API. Returns (text, model, in_tokens, out_tokens)."""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.7,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "PropVal/1.0",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(base_url, json=body, headers=headers)

    if resp.status_code == 429:
        raise RuntimeError(f"{model} rate limited (429)")
    if resp.status_code != 200:
        raise RuntimeError(f"{model} HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    usage = data.get("usage") or {}
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"{model} returned no choices")
    text = (choices[0].get("message") or {}).get("content", "")
    if not text:
        raise RuntimeError(f"{model} returned empty content")

    return text, model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)


async def _call_gemini(
    system_prompt: str, user_message: str, api_key: str
) -> tuple[str, str, int, int]:
    """Call Gemini API. Returns (text, model, in_tokens, out_tokens)."""
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_message}]}],
        "generationConfig": {
            "maxOutputTokens": 65536,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            _GEMINI_URL, json=body,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        )

    if resp.status_code == 429:
        raise RuntimeError("Gemini rate limited (429)")
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    usage = data.get("usageMetadata") or {}
    text = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    if not text:
        raise RuntimeError("Gemini returned empty response")

    return text, _GEMINI_MODEL, usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0)


# ── Main entry point ─────────────────────────────────────────────────────────

async def generate_agentic_report(
    case_data: dict,
    *,
    user_id: str | None = None,
    user_email: str | None = None,
) -> dict:
    """Generate a complete agentic valuation report.

    Uses Groq -> Cerebras -> Gemini fallback chain (all free).

    Args:
        case_data: Dict with keys: case, subject_property, comparables,
                   semv_output, market_context.

    Returns:
        Dict with: narratives, populated_placeholders, rics_self_audit, metadata.
    """
    system_prompt = _build_system_prompt()
    user_message = _build_user_message(case_data)

    # Build provider chain
    providers = []
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        providers.append(("groq", _GROQ_MODEL, lambda: _call_openai_compat(
            system_prompt, user_message, groq_key, _GROQ_URL, _GROQ_MODEL)))

    cerebras_key = os.getenv("CEREBRAS_API_KEY")
    if cerebras_key:
        providers.append(("cerebras", _CEREBRAS_MODEL, lambda: _call_openai_compat(
            system_prompt, user_message, cerebras_key, _CEREBRAS_URL, _CEREBRAS_MODEL)))

    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        providers.append(("gemini", _GEMINI_MODEL, lambda: _call_gemini(
            system_prompt, user_message, gemini_key)))

    if not providers:
        return {"error": "No AI API keys configured", "narratives": {}, "metadata": {}}

    last_error = ""
    for provider_name, model_name, call_fn in providers:
        start = time.monotonic()
        try:
            text, model_used, in_tok, out_tok = await call_fn()
            latency_ms = int((time.monotonic() - start) * 1000)

            await log_ai_usage(
                user_id=user_id, user_email=user_email,
                endpoint="agentic-report", model=model_used,
                input_text=user_message[:500], output_text=text[:500],
                success=True, latency_ms=latency_ms,
                prompt_token_count=in_tok, candidates_token_count=out_tok,
            )

            if provider_name != "groq":
                logger.info("Agentic report served by: %s (%dms)", provider_name, latency_ms)

            result = _extract_json(text)
            result["metadata"] = {
                "provider": provider_name,
                "model": model_used,
                "tokens_used": {"input": in_tok, "output": out_tok},
                "generation_time_seconds": round(latency_ms / 1000, 1),
                "cost": "FREE",
            }
            return result

        except Exception as e:
            latency_ms = int((time.monotonic() - start) * 1000)
            last_error = str(e)
            logger.warning("Agentic report provider %s failed (%dms): %s", provider_name, latency_ms, e)
            await log_ai_usage(
                user_id=user_id, user_email=user_email,
                endpoint="agentic-report", model=provider_name,
                input_text="", output_text="",
                success=False, latency_ms=latency_ms,
                error_message=str(e)[:200],
            )
            continue

    return {"error": f"All providers failed: {last_error}", "narratives": {}, "metadata": {}}

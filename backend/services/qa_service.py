"""AI-powered QA checks for report copies.

Sends the report text + structured property data to an AI model and asks
for specific checks: grammar, logic, calculations, data cross-reference,
RICS compliance, and contradictions.

Uses the same Gemini → Groq → Cerebras fallback chain as ai_service.
"""

import json
import logging
import os
import re

import httpx

from .ai_usage_logger import log_ai_usage

logger = logging.getLogger(__name__)

# ── Provider config (reused from ai_service) ─────────────────────────────────

_GEMINI_MODEL = "gemini-2.5-flash"
_GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:generateContent"

_GROQ_MODEL = "llama-3.3-70b-versatile"
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

_CEREBRAS_MODEL = "llama-3.3-70b"
_CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"

# ── QA System prompt ─────────────────────────────────────────────────────────

_QA_SYSTEM_PROMPT = """You are a senior RICS Red Book compliance reviewer for UK residential valuations.

Your job is to quality-check a valuation report draft against the STRUCTURED DATA provided.
The structured data is the SOURCE OF TRUTH — if the report text contradicts it, the report is wrong.

Return your findings as a JSON array. Each finding must have:
- "severity": "error" | "warning" | "info"
- "category": "grammar" | "logic" | "calculation" | "data_xref" | "compliance" | "contradiction"
- "location": a brief hint of where in the report (section heading or first few words)
- "message": what's wrong (be specific)
- "suggestion": how to fix it (be actionable)

Check categories:
1. GRAMMAR: typos, grammatical errors, awkward phrasing, unprofessional language
2. LOGIC: contradictions between paragraphs, illogical conclusions, non-sequiturs
3. CALCULATION: £/sqft or £/sqm figures, area conversions, percentage calculations, arithmetic
4. DATA_XREF: does report text match structured data? Check addresses, prices, dates, areas, property type, tenure
5. COMPLIANCE: RICS Red Book requirements — basis of value stated, inspection date, valuation date, assumptions, caveats, signed by qualified surveyor
6. CONTRADICTION: report says X but structured data says Y

Be thorough but practical. Focus on issues that affect report quality and professional liability.
If you find no issues in a category, simply omit findings for that category.

IMPORTANT: Return ONLY the JSON array. No explanation, no markdown, no wrapper text."""


def _build_qa_prompt(report_text: str, structured_data: dict) -> str:
    """Build the user prompt with report text and all structured data."""
    parts = ["=== REPORT TEXT ===\n", report_text, "\n\n=== STRUCTURED DATA (source of truth) ===\n"]

    # Property basics
    if "property" in structured_data:
        p = structured_data["property"]
        parts.append(f"Address: {p.get('address', 'N/A')}\n")
        parts.append(f"Postcode: {p.get('postcode', 'N/A')}\n")
        parts.append(f"Property type: {p.get('property_type', 'N/A')}\n")
        parts.append(f"Built form: {p.get('built_form', 'N/A')}\n")
        parts.append(f"Tenure: {p.get('tenure', 'N/A')}\n")
        parts.append(f"Floor area (EPC): {p.get('total_floor_area', 'N/A')} sqm\n")
        parts.append(f"Construction era: {p.get('construction_age_band', 'N/A')}\n")
        parts.append(f"Energy rating: {p.get('current_energy_rating', 'N/A')}\n")
        parts.append(f"Bedrooms: {p.get('number_habitable_rooms', 'N/A')}\n")

    # Valuer inputs
    if "valuer" in structured_data:
        v = structured_data["valuer"]
        parts.append(f"\nAdopted GIA: {v.get('gia_sqm', 'N/A')} sqm\n")
        parts.append(f"Market Value: £{v.get('market_value', 'N/A')}\n")
        parts.append(f"Condition: {v.get('condition_rating', 'N/A')}\n")
        parts.append(f"Suitable security: {v.get('suitable_security', 'N/A')}\n")

    # Metadata
    if "meta" in structured_data:
        m = structured_data["meta"]
        parts.append(f"\nReport date: {m.get('report_date', 'N/A')}\n")
        parts.append(f"Inspection date: {m.get('inspection_date', 'N/A')}\n")
        parts.append(f"Valuation date: {m.get('valuation_date', 'N/A')}\n")
        parts.append(f"Client: {m.get('client_name', 'N/A')}\n")
        parts.append(f"Preparer: {m.get('preparer_name', 'N/A')}\n")

    # Adopted comparables
    comps = structured_data.get("comparables", [])
    if comps:
        parts.append(f"\nAdopted Comparables ({len(comps)}):\n")
        for i, comp in enumerate(comps[:10], 1):
            parts.append(f"  {i}. {comp.get('address', 'N/A')} — £{comp.get('price', 'N/A')} "
                        f"({comp.get('date', 'N/A')}), {comp.get('floor_area', 'N/A')} sqm, "
                        f"{comp.get('property_type', 'N/A')}\n")

    # SEMV results
    if "semv" in structured_data:
        s = structured_data["semv"]
        parts.append(f"\nSEMV Confidence: {s.get('percentile', 'N/A')}th percentile\n")
        parts.append(f"SEMV Distribution mean: £{s.get('mean', 'N/A')}\n")
        parts.append(f"SEMV Std deviation: £{s.get('std', 'N/A')}\n")

    return "".join(parts)


def _strip_html(html: str) -> str:
    """Remove HTML tags to get plain text for QA analysis."""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_json_array(text: str) -> list:
    """Extract a JSON array from possibly-wrapped model output."""
    text = text.strip()
    # Try direct parse first
    if text.startswith("["):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Try finding first [ to last ]
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass
    return [{"severity": "warning", "category": "logic", "location": "QA system", "message": "AI returned unparseable response", "suggestion": "Try running QA again"}]


# ── Provider calls ────────────────────────────────────────────────────────────

async def _qa_gemini(prompt: str, api_key: str) -> tuple[str, str]:
    body = {
        "system_instruction": {"parts": [{"text": _QA_SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": 8192,
            "temperature": 0.3,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(_GEMINI_URL, json=body, headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        })
    if resp.status_code != 200:
        raise Exception(f"Gemini {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    return text, _GEMINI_MODEL


async def _qa_openai_compat(prompt: str, api_key: str, url: str, model: str) -> tuple[str, str]:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _QA_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=body, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        })
    if resp.status_code != 200:
        raise Exception(f"{model} {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    text = data["choices"][0]["message"]["content"]
    return text, model


# ── Main QA function ─────────────────────────────────────────────────────────

async def run_qa_checks(
    editor_html: str,
    structured_data: dict,
    user_id: str | None = None,
    user_email: str | None = None,
    panel_qa_rules: list[str] | None = None,
) -> tuple[list[dict], str]:
    """Run AI QA checks on a report copy.

    Args:
        panel_qa_rules: Optional list of panel-specific QA rules to append
            to the system prompt (e.g. "Verify at least 5 comps").

    Returns (findings_list, model_used).
    """
    report_text = _strip_html(editor_html)
    # Limit input size to prevent excessive API costs
    if len(report_text) > 100_000:
        report_text = report_text[:100_000]
    if len(report_text) < 50:
        return [{"severity": "warning", "category": "logic", "location": "entire report",
                 "message": "Report appears to be empty or very short",
                 "suggestion": "Generate AI sections and fill in wizard fields before running QA"}], "none"

    prompt = _build_qa_prompt(report_text, structured_data)

    # Append panel-specific QA rules if provided
    if panel_qa_rules:
        prompt += "\n\n=== PANEL-SPECIFIC RULES (this report must also satisfy) ===\n"
        for rule in panel_qa_rules:
            prompt += f"- {rule}\n"
        prompt += "\nFor panel rule violations, include 'panel' in the category field (e.g. 'panel_compliance').\n"

    # Fallback chain: Gemini → Groq → Cerebras
    providers = []
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    cerebras_key = os.getenv("CEREBRAS_API_KEY")

    if gemini_key:
        providers.append(("gemini", gemini_key))
    if groq_key:
        providers.append(("groq", groq_key))
    if cerebras_key:
        providers.append(("cerebras", cerebras_key))

    if not providers:
        return [{"severity": "error", "category": "logic", "location": "QA system",
                 "message": "No AI API keys configured",
                 "suggestion": "Set GEMINI_API_KEY, GROQ_API_KEY, or CEREBRAS_API_KEY"}], "none"

    last_err = None
    for provider_name, api_key in providers:
        try:
            if provider_name == "gemini":
                raw_text, model = await _qa_gemini(prompt, api_key)
            elif provider_name == "groq":
                raw_text, model = await _qa_openai_compat(prompt, api_key, _GROQ_URL, _GROQ_MODEL)
            else:
                raw_text, model = await _qa_openai_compat(prompt, api_key, _CEREBRAS_URL, _CEREBRAS_MODEL)

            findings = _extract_json_array(raw_text)

            # Validate and normalize findings structure
            valid_severities = {"error", "warning", "info"}
            validated = []
            for f in findings:
                if not isinstance(f, dict):
                    continue
                validated.append({
                    "severity": f.get("severity", "info") if f.get("severity") in valid_severities else "info",
                    "category": str(f.get("category", "logic"))[:50],
                    "location": str(f.get("location", ""))[:200],
                    "message": str(f.get("message", ""))[:500],
                    "suggestion": str(f.get("suggestion", ""))[:500],
                })
            findings = validated

            # Log usage
            await log_ai_usage(
                user_id=user_id, user_email=user_email, model=model,
                input_text="", output_text="",
                endpoint="qa", address="QA check", postcode="",
                success=True, latency_ms=0,
            )

            logger.info("QA completed via %s: %d findings", model, len(findings))
            return findings, model

        except Exception as exc:
            last_err = exc
            logger.warning("QA provider %s failed: %s", provider_name, exc)
            continue

    logger.error("All QA providers failed. Last error: %s", last_err)
    return [{"severity": "error", "category": "logic", "location": "QA system",
             "message": "AI quality check is temporarily unavailable",
             "suggestion": "Please try again in a few minutes"}], "none"

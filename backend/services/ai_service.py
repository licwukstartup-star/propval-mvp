"""AI narrative generation via Google Gemini (free tier)."""

import logging
import os
import time

import httpx

from .ai_usage_logger import log_ai_usage

_GEMINI_MODEL = "gemini-2.5-flash"
_GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:generateContent"

_SYSTEM_PROMPT = (
    "You are a property data assistant. Summarise ONLY the data provided. "
    "Do NOT invent, assume, or hallucinate any facts not present in the data. "
    "Do NOT provide a valuation figure or opinion of value. "
    "Write in formal third-person English suitable for an RICS-compliant valuation report. "
    "Keep each paragraph to 2-3 sentences. Be precise and factual."
)

_EMPTY = {
    "location_summary": None,
    "property_overview": None,
    "market_context": None,
}


def _build_prompt(data: dict) -> str:
    """Build the user prompt from structured property data."""
    lines = ["Based on the following property data, generate three paragraphs:\n"]

    # Address & location
    lines.append(f"Address: {data.get('address', 'Unknown')}")
    lines.append(f"Postcode: {data.get('postcode', 'Unknown')}")
    if data.get("admin_district"):
        lines.append(f"Local Authority: {data['admin_district']}")
    if data.get("region"):
        lines.append(f"Region: {data['region']}")
    if data.get("lsoa"):
        lines.append(f"LSOA: {data['lsoa']}")

    # Planning & heritage
    if data.get("listed_buildings"):
        lines.append(f"Listed buildings within 75m: {len(data['listed_buildings'])}")
    if data.get("conservation_areas"):
        lines.append(f"Conservation areas nearby: {len(data['conservation_areas'])}")
    if data.get("planning_flood_zone"):
        lines.append(f"Planning flood zone: {data['planning_flood_zone']}")
    if data.get("green_belt"):
        lines.append("Property is within Green Belt")

    # EPC / property characteristics
    if data.get("property_type"):
        lines.append(f"Property type: {data['property_type']}")
    if data.get("built_form"):
        lines.append(f"Built form: {data['built_form']}")
    if data.get("construction_age_band"):
        lines.append(f"Construction era: {data['construction_age_band']}")
    if data.get("floor_area_m2"):
        lines.append(f"Floor area: {data['floor_area_m2']} sqm")
    if data.get("energy_rating"):
        lines.append(f"EPC rating: {data['energy_rating']}")
    if data.get("num_rooms"):
        lines.append(f"Habitable rooms: {data['num_rooms']}")
    if data.get("tenure"):
        lines.append(f"Tenure: {data['tenure']}")

    # Sales history
    sales = data.get("sales") or []
    if sales:
        lines.append(f"\nTransaction history ({len(sales)} sales):")
        for s in sales[:6]:
            lines.append(f"  - {s.get('date', '?')}: £{s.get('price', '?'):,}" if isinstance(s.get("price"), (int, float)) else f"  - {s.get('date', '?')}: £{s.get('price', '?')}")

    # HPI
    hpi = data.get("hpi")
    if hpi and isinstance(hpi, dict):
        lines.append(f"\nHouse Price Index ({hpi.get('local_authority', 'area')}):")
        lines.append(f"  Average price: £{hpi.get('avg_price', 0):,.0f}" if isinstance(hpi.get("avg_price"), (int, float)) else "  Average price: unavailable")
        if hpi.get("annual_change_pct") is not None:
            lines.append(f"  Annual change: {hpi['annual_change_pct']}%")

    # Flood risk
    if data.get("rivers_sea_risk"):
        lines.append(f"Rivers & sea flood risk: {data['rivers_sea_risk']}")
    if data.get("surface_water_risk"):
        lines.append(f"Surface water flood risk: {data['surface_water_risk']}")

    lines.append("\n---")

    section = data.get("requested_section")
    if section == "location_summary":
        lines.append("Generate exactly ONE paragraph with this heading:")
        lines.append("1. LOCATION & NEIGHBOURHOOD")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    elif section == "property_overview":
        lines.append("Generate exactly ONE paragraph with this heading:")
        lines.append("2. PROPERTY OVERVIEW")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    elif section == "market_context":
        lines.append("Generate exactly ONE paragraph with this heading:")
        lines.append("3. MARKET CONTEXT")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    elif section == "location_description":
        lines.append("Generate exactly ONE detailed paragraph (4-6 sentences) with this heading:")
        lines.append("LOCATION DESCRIPTION")
        lines.append("Describe the area character, neighbourhood, local amenities, transport links, and connectivity.")
        lines.append("This is for a formal RICS valuation report Section 2.2.")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    elif section == "building_description":
        lines.append("Generate exactly ONE detailed paragraph (4-6 sentences) with this heading:")
        lines.append("PROPERTY DESCRIPTION")
        lines.append("Describe the building type, construction, age, accommodation, heating, and general character.")
        lines.append("This is for a formal RICS valuation report Section 2.3.")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    elif section == "market_commentary":
        lines.append("Generate exactly ONE detailed paragraph (4-6 sentences) with this heading:")
        lines.append("MARKET COMMENTARY")
        lines.append("Describe local market conditions, price trends, supply/demand, and transaction volumes.")
        lines.append("This is for a formal RICS valuation report Section 3.3.")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    elif section == "valuation_considerations":
        lines.append("Generate exactly ONE detailed paragraph (4-6 sentences) with this heading:")
        lines.append("VALUATION CONSIDERATIONS")
        lines.append("Discuss factors affecting value: location, condition, comparable evidence, tenure, and any unusual features.")
        lines.append("This is for a formal RICS valuation report Section 3.6.")
        lines.append("Return ONLY the paragraph, preceded by its heading on a separate line.")
    else:
        lines.append("Generate exactly three paragraphs with these headings:")
        lines.append("1. LOCATION & NEIGHBOURHOOD")
        lines.append("2. PROPERTY OVERVIEW")
        lines.append("3. MARKET CONTEXT")
        lines.append("Return ONLY the three paragraphs, each preceded by its heading on a separate line.")

    return "\n".join(lines)


_REPORT_SECTIONS = {
    "location_description", "building_description",
    "market_commentary", "valuation_considerations",
}


def _parse_single_section(text: str) -> str:
    """Extract body text from a single-section AI response (strip heading line)."""
    lines = []
    past_heading = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        # Skip heading-like lines (all caps, numbered, short)
        if not past_heading and (stripped.isupper() or stripped[0].isdigit()) and len(stripped) < 80:
            past_heading = True
            continue
        # Also skip markdown heading markers
        if not past_heading and stripped.startswith("#"):
            past_heading = True
            continue
        past_heading = True
        lines.append(stripped)
    return " ".join(lines).strip()


def _parse_response(text: str) -> dict:
    """Parse Gemini response into three sections."""
    result = dict(_EMPTY)
    sections = {
        "location": "location_summary",
        "neighbourhood": "location_summary",
        "property": "property_overview",
        "market": "market_context",
    }

    current_key = None
    current_lines: list[str] = []

    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower().replace("*", "").replace("#", "").strip()
        matched = False
        for keyword, key in sections.items():
            if keyword in lower and len(lower) < 60:
                if current_key and current_lines:
                    result[current_key] = " ".join(current_lines).strip()
                current_key = key
                current_lines = []
                matched = True
                break
        if not matched and current_key:
            current_lines.append(stripped)

    if current_key and current_lines:
        result[current_key] = " ".join(current_lines).strip()

    return result


async def generate_property_narrative(
    property_data: dict,
    *,
    user_id: str | None = None,
    user_email: str | None = None,
) -> dict:
    """Call Gemini to generate AI-assisted narrative paragraphs."""
    api_key = os.getenv("GEMINI_API_KEY")
    address = property_data.get("address")
    postcode = property_data.get("postcode")
    start = time.monotonic()

    if not api_key:
        logging.warning("GEMINI_API_KEY not set — skipping AI narrative")
        await log_ai_usage(
            user_id=user_id, user_email=user_email, endpoint="ai-narrative",
            model=_GEMINI_MODEL, input_text="", output_text="",
            success=False, latency_ms=0, address=address, postcode=postcode,
            error_message="API key not configured",
        )
        return {k: "AI narrative unavailable — API key not configured" for k in _EMPTY}

    prompt = _build_prompt(property_data)

    body = {
        "system_instruction": {"parts": [{"text": _SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": prompt}]}],
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                _GEMINI_URL,
                params={"key": api_key},
                json=body,
                headers={"Content-Type": "application/json"},
            )
        latency_ms = int((time.monotonic() - start) * 1000)

        if resp.status_code != 200:
            logging.warning("Gemini API error %d: %s", resp.status_code, resp.text[:500])
            await log_ai_usage(
                user_id=user_id, user_email=user_email, endpoint="ai-narrative",
                model=_GEMINI_MODEL, input_text=prompt, output_text="",
                success=False, latency_ms=latency_ms, address=address, postcode=postcode,
                error_message=f"HTTP {resp.status_code}",
            )
            return {k: f"AI narrative unavailable — Gemini API error {resp.status_code}" for k in _EMPTY}

        data = resp.json()

        # Extract real token counts from Gemini response if available
        usage_meta = data.get("usageMetadata") or {}
        prompt_tokens = usage_meta.get("promptTokenCount")
        candidates_tokens = usage_meta.get("candidatesTokenCount")

        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )

        if not text:
            await log_ai_usage(
                user_id=user_id, user_email=user_email, endpoint="ai-narrative",
                model=_GEMINI_MODEL, input_text=prompt, output_text="",
                success=False, latency_ms=latency_ms, address=address, postcode=postcode,
                error_message="Empty response", prompt_token_count=prompt_tokens,
                candidates_token_count=candidates_tokens,
            )
            return {k: "AI narrative unavailable — empty response from Gemini" for k in _EMPTY}

        # Success — log usage
        await log_ai_usage(
            user_id=user_id, user_email=user_email, endpoint="ai-narrative",
            model=_GEMINI_MODEL, input_text=prompt, output_text=text,
            success=True, latency_ms=latency_ms, address=address, postcode=postcode,
            prompt_token_count=prompt_tokens, candidates_token_count=candidates_tokens,
        )

        parsed = _parse_response(text)

        # If a report-specific section was requested, return single text
        requested = property_data.get("requested_section")
        if requested and requested in _REPORT_SECTIONS:
            return {requested: _parse_single_section(text)}

        # If a basic narrative section was requested, only return that section
        if requested and requested in _EMPTY:
            return {k: (parsed[k] if k == requested else None) for k in _EMPTY}

        return parsed

    except httpx.TimeoutException:
        latency_ms = int((time.monotonic() - start) * 1000)
        logging.warning("Gemini API timeout")
        await log_ai_usage(
            user_id=user_id, user_email=user_email, endpoint="ai-narrative",
            model=_GEMINI_MODEL, input_text=prompt, output_text="",
            success=False, latency_ms=latency_ms, address=address, postcode=postcode,
            error_message="Timeout",
        )
        return {k: "AI narrative unavailable — request timed out" for k in _EMPTY}
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        logging.warning("Gemini API error: %s", exc)
        await log_ai_usage(
            user_id=user_id, user_email=user_email, endpoint="ai-narrative",
            model=_GEMINI_MODEL, input_text=prompt, output_text="",
            success=False, latency_ms=latency_ms, address=address, postcode=postcode,
            error_message=str(exc)[:200],
        )
        return {k: f"AI narrative unavailable — {exc}" for k in _EMPTY}

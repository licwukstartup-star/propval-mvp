"""AI narrative generation with provider fallback chain.

Priority: Groq (primary) → Cerebras (fallback) → Gemini (last resort).
All three use free tiers. Fallback triggers on rate-limit (429), timeout, or error.
"""

import logging
import os
import time

import httpx

from .ai_usage_logger import log_ai_usage

# ── Provider configuration ────────────────────────────────────────────────────

_GEMINI_MODEL = "gemini-2.5-flash"
_GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:generateContent"

_GROQ_MODEL = "llama-3.3-70b-versatile"
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

_CEREBRAS_MODEL = "llama-3.3-70b"
_CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"

# ── System prompts ────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "You are a chartered surveyor's assistant drafting sections for an RICS-compliant "
    "residential mortgage valuation report. "
    "STRICT RULES:\n"
    "- Use ONLY the data provided. Do NOT invent, assume, or hallucinate any facts.\n"
    "- Do NOT provide a valuation figure or opinion of value.\n"
    "- Write in formal third-person English (e.g. 'The property is…', 'The subject dwelling comprises…').\n"
    "- Be precise, factual, and concise. Avoid filler, repetition, and subjective adjectives.\n"
    "- Where data is missing, omit the topic silently — do NOT say 'data not available'.\n"
    "- Output plain text only. No markdown, no bullet points, no bold/italic formatting."
)

_SYSTEM_PROMPT_CUSTOM = (
    "You are a chartered surveyor's assistant drafting sections for an RICS-compliant "
    "residential mortgage valuation report. "
    "RULES:\n"
    "- PRIORITISE the structured property data provided below — treat it as authoritative.\n"
    "- You MAY supplement with your general knowledge of the area (transport links, "
    "local amenities, schools by name, parks, hospitals, shopping centres) to produce "
    "a rich, professional narrative. Clearly distinguish factual data from general context.\n"
    "- Do NOT invent specific figures, prices, distances, or dates that are not provided.\n"
    "- Do NOT provide a valuation figure or opinion of value.\n"
    "- Write in formal third-person English.\n"
    "- Follow the user's formatting, structure, and length instructions exactly.\n"
    "- Output plain text only. No markdown formatting."
)

_EMPTY = {
    "location_summary": None,
    "property_overview": None,
    "market_context": None,
}

_NO_PROMPT_MSG = "No AI prompt configured — set up your prompt in Firm Template Settings."

# Map section keys to their custom prompt field names in firm_templates
_PROMPT_FIELD_MAP: dict[str, str] = {
    "location_description": "ai_prompt_location",
    "subject_development": "ai_prompt_subject_development",
    "subject_building": "ai_prompt_subject_building",
    "subject_property": "ai_prompt_subject_property",
    "market_commentary": "ai_prompt_market",
    "valuation_considerations": "ai_prompt_valuation",
}

_REPORT_SECTIONS = {
    "location_description", "subject_development", "subject_building", "subject_property",
    "market_commentary", "valuation_considerations",
}


# ── Default prompts for sections that work without firm template config ───────

_DEFAULT_SECTION_PROMPTS: dict[str, str] = {
    "location_description": (
        "Write 2-3 paragraphs describing the location and neighbourhood. "
        "Cover the local authority area, character of the immediate locality, "
        "transport links, local amenities, schools, and any relevant designations "
        "(conservation area, flood zone, etc.). 200-350 words, formal third person."
    ),
    "subject_development": (
        "Write 1-2 paragraphs describing the wider development, estate, or scheme "
        "the property sits within. Cover the age, style, and layout of the development, "
        "communal areas, parking arrangements, and estate management if applicable. "
        "If the property is a standalone house not part of a development, state this briefly. "
        "100-200 words, formal third person."
    ),
    "subject_building": (
        "Write 1-2 paragraphs describing the specific building. Cover the building type, "
        "construction method and era, number of storeys, external wall finish, roof type, "
        "window type, and any notable building-specific features. "
        "100-200 words, formal third person."
    ),
    "subject_property": (
        "Write 1-2 paragraphs describing the individual dwelling or unit. Cover the "
        "accommodation layout, number of rooms, floor area, internal condition, "
        "heating system, EPC rating, and any property-specific features. "
        "100-200 words, formal third person."
    ),
    "market_commentary": (
        "Write 2-3 paragraphs providing market commentary. Cover HPI average price "
        "and trends, transaction history with capital growth analysis, current market "
        "direction, and supply/demand dynamics. 200-350 words, formal third person."
    ),
    "valuation_considerations": (
        "Write 2-4 paragraphs covering valuation considerations. Include positive "
        "value factors, adverse or risk factors, tenure and legal constraints, "
        "and a brief summary. 250-400 words, formal third person."
    ),
}

# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_prompt(data: dict, custom_prompts: dict[str, str] | None = None) -> tuple[str, bool]:
    """Build the user prompt from structured property data.

    Returns (prompt_text, uses_custom_prompt).
    """
    lines = ["PROPERTY DATA FOR REPORT DRAFTING:\n"]
    _used_custom = False

    # ── Address & location ────────────────────────────────────────────────
    lines.append(f"Address: {data.get('address', 'Unknown')}")
    lines.append(f"Postcode: {data.get('postcode', 'Unknown')}")
    if data.get("admin_district"):
        lines.append(f"Local Authority: {data['admin_district']}")
    if data.get("region"):
        lines.append(f"Region: {data['region']}")
    if data.get("lsoa"):
        lines.append(f"LSOA: {data['lsoa']}")

    # ── EPC / property characteristics ────────────────────────────────────
    if data.get("property_type"):
        lines.append(f"Property type: {data['property_type']}")
    if data.get("built_form"):
        lines.append(f"Built form: {data['built_form']}")
    if data.get("construction_age_band"):
        lines.append(f"Construction era: {data['construction_age_band']}")
    if data.get("floor_area_m2"):
        try:
            sqm = float(data["floor_area_m2"])
            lines.append(f"Floor area: {sqm:.0f} sqm ({sqm * 10.764:.0f} sqft)")
        except (ValueError, TypeError):
            lines.append(f"Floor area: {data['floor_area_m2']} sqm")
    if data.get("energy_rating"):
        score = f" ({data['energy_score']})" if data.get("energy_score") else ""
        lines.append(f"EPC rating: {data['energy_rating']}{score}")
    if data.get("num_rooms"):
        lines.append(f"Habitable rooms: {data['num_rooms']}")
    if data.get("heating_type"):
        lines.append(f"Heating: {data['heating_type']}")
    if data.get("tenure"):
        lines.append(f"Tenure: {data['tenure']}")
    if data.get("council_tax_band"):
        lines.append(f"Council tax band: {data['council_tax_band']}")

    # ── Lease details (if leasehold) ──────────────────────────────────────
    if data.get("lease_term_years"):
        lines.append(f"Original lease term: {data['lease_term_years']} years")
    if data.get("lease_commencement"):
        lines.append(f"Lease commencement: {data['lease_commencement']}")
    if data.get("lease_expiry_date"):
        lines.append(f"Lease expiry: {data['lease_expiry_date']}")

    # ── Sales history ─────────────────────────────────────────────────────
    sales = data.get("sales") or []
    if sales:
        lines.append(f"\nTransaction history ({len(sales)} sales):")
        for s in sales[:8]:
            price = s.get("price")
            date = s.get("date", "?")
            if isinstance(price, (int, float)):
                lines.append(f"  - {date}: £{price:,.0f}")
            else:
                lines.append(f"  - {date}: £{price}")

    # ── HPI ────────────────────────────────────────────────────────────────
    hpi = data.get("hpi")
    if hpi and isinstance(hpi, dict):
        la = hpi.get("local_authority", "area")
        lines.append(f"\nHouse Price Index ({la}):")
        if isinstance(hpi.get("avg_price"), (int, float)):
            lines.append(f"  Average price: £{hpi['avg_price']:,.0f}")
        if hpi.get("annual_change_pct") is not None:
            lines.append(f"  Annual change: {hpi['annual_change_pct']}%")
        if hpi.get("monthly_change_pct") is not None:
            lines.append(f"  Monthly change: {hpi['monthly_change_pct']}%")
        if hpi.get("sales_volume") is not None:
            lines.append(f"  Sales volume: {hpi['sales_volume']}")

    # ── Flood risk ─────────────────────────────────────────────────────────
    if data.get("planning_flood_zone"):
        lines.append(f"Planning flood zone: {data['planning_flood_zone']}")
    if data.get("rivers_sea_risk"):
        lines.append(f"Rivers & sea flood risk: {data['rivers_sea_risk']}")
    if data.get("surface_water_risk"):
        lines.append(f"Surface water flood risk: {data['surface_water_risk']}")

    # ── Ground stability ───────────────────────────────────────────────────
    ground_fields = [
        ("ground_shrink_swell", "Shrink-swell clay risk"),
        ("ground_landslides", "Landslide risk"),
        ("ground_compressible", "Compressible ground risk"),
        ("ground_collapsible", "Collapsible ground risk"),
        ("ground_running_sand", "Running sand risk"),
        ("ground_soluble_rocks", "Soluble rocks risk"),
    ]
    ground_lines = []
    for field, label in ground_fields:
        val = data.get(field)
        if val:
            ground_lines.append(f"  {label}: {val}")
    if ground_lines:
        lines.append("\nGround stability:")
        lines.extend(ground_lines)

    # ── Coal mining & radon ────────────────────────────────────────────────
    if data.get("coal_mining_in_coalfield"):
        lines.append(f"Coal mining: within coalfield" + (" — HIGH RISK AREA" if data.get("coal_mining_high_risk") else ""))
    if data.get("radon_risk"):
        lines.append(f"Radon risk: {data['radon_risk']}")

    # ── Heritage & planning designations ───────────────────────────────────
    if data.get("listed_buildings"):
        buildings = data["listed_buildings"]
        if not isinstance(buildings, list):
            buildings = []
        lines.append(f"Listed buildings within 75m: {len(buildings)}")
        for lb in buildings[:5]:
            if isinstance(lb, dict):
                grade = lb.get("grade", "")
                name = lb.get("name", "Unknown")
                lines.append(f"  - Grade {grade}: {name}")
    if data.get("conservation_areas"):
        areas = data["conservation_areas"]
        if not isinstance(areas, list):
            areas = []
        lines.append(f"Conservation areas: {len(areas)}")
        for ca in areas[:3]:
            if isinstance(ca, dict) and ca.get("name"):
                lines.append(f"  - {ca['name']}")
    if data.get("green_belt"):
        lines.append("Green Belt: Yes — property is within Green Belt")
    if data.get("aonb"):
        lines.append(f"AONB: {data['aonb']}")
    if data.get("sssi"):
        sssi = data["sssi"]
        if isinstance(sssi, list):
            lines.append(f"SSSI: {', '.join(sssi[:3])}")
        else:
            lines.append(f"SSSI: {sssi}")
    if data.get("ancient_woodland"):
        woods = data["ancient_woodland"]
        lines.append(f"Ancient woodland: {len(woods)} site(s) nearby")
    if data.get("brownfield"):
        bf = data["brownfield"]
        lines.append(f"Brownfield: {len(bf)} site(s) nearby")

    # ── Schools ────────────────────────────────────────────────────────────
    schools = data.get("nearby_schools") or []
    if schools:
        lines.append(f"\nNearby schools ({len(schools)}):")
        for sch in schools[:8]:
            if isinstance(sch, dict):
                name = sch.get("name", "Unknown")
                phase = sch.get("phase", "")
                ofsted = sch.get("ofsted_rating", "")
                dist = sch.get("distance_miles") or sch.get("distance_km")
                parts = [name]
                if phase:
                    parts.append(f"({phase})")
                if ofsted:
                    parts.append(f"— Ofsted: {ofsted}")
                if dist is not None:
                    parts.append(f"— {dist}mi" if sch.get("distance_miles") else f"— {dist}km")
                lines.append(f"  - {' '.join(parts)}")

    # ── Broadband & connectivity ───────────────────────────────────────────
    bb = data.get("broadband")
    if bb and isinstance(bb, dict):
        max_dl = bb.get("max_download")
        if max_dl is not None:
            lines.append(f"\nBroadband: max download {max_dl} Mbps")
            if bb.get("superfast_download"):
                lines.append(f"  Superfast available: {bb['superfast_download']} Mbps")
            if bb.get("ultrafast_download"):
                lines.append(f"  Ultrafast available: {bb['ultrafast_download']} Mbps")

    # ── IMD deprivation ────────────────────────────────────────────────────
    imd = data.get("imd")
    if imd and isinstance(imd, dict):
        overall = imd.get("overall_decile")
        if overall is not None:
            lines.append(f"\nIMD Deprivation (1=most deprived, 10=least):")
            lines.append(f"  Overall decile: {overall}")
            for dim in ["income", "employment", "education", "health", "crime", "housing", "environment"]:
                val = imd.get(f"{dim}_decile")
                if val is not None:
                    lines.append(f"  {dim.capitalize()}: decile {val}")

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
    elif section in _REPORT_SECTIONS:
        # Use custom prompt from firm template, or fall back to built-in defaults
        prompt_field = _PROMPT_FIELD_MAP.get(section, "")
        custom = (custom_prompts or {}).get(prompt_field, "").strip() if prompt_field else ""
        if custom:
            lines.append("Follow the instructions below exactly.")
            lines.append(custom)
            _used_custom = True
        elif section in _DEFAULT_SECTION_PROMPTS:
            lines.append(_DEFAULT_SECTION_PROMPTS[section])
        else:
            # No prompt configured — signal caller to skip AI call
            return "", False
    else:
        lines.append("Generate exactly three paragraphs with these headings:")
        lines.append("1. LOCATION & NEIGHBOURHOOD")
        lines.append("2. PROPERTY OVERVIEW")
        lines.append("3. MARKET CONTEXT")
        lines.append("Return ONLY the three paragraphs, each preceded by its heading on a separate line.")

    return "\n".join(lines), _used_custom


# ── Response parsers ──────────────────────────────────────────────────────────

def _parse_single_section(text: str) -> str:
    """Extract body text from a single-section AI response.

    Strips any leading heading line but preserves paragraph breaks
    (double newlines) so multi-paragraph output stays structured.
    """
    paragraphs: list[list[str]] = [[]]
    past_heading = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            # Empty line = paragraph break (only if we have content)
            if paragraphs[-1]:
                paragraphs.append([])
            continue
        # Skip heading-like lines (all caps, numbered, short) at the very start
        if not past_heading and (stripped.isupper() or stripped[0].isdigit()) and len(stripped) < 80:
            past_heading = True
            continue
        if not past_heading and stripped.startswith("#"):
            past_heading = True
            continue
        past_heading = True
        paragraphs[-1].append(stripped)
    # Join lines within each paragraph, then join paragraphs with double newline
    result = "\n\n".join(" ".join(p) for p in paragraphs if p)
    return result.strip()


def _parse_response(text: str) -> dict:
    """Parse AI response into three sections."""
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


# ── Provider call implementations ─────────────────────────────────────────────

async def _call_gemini(
    prompt: str, system_prompt: str, api_key: str
) -> tuple[str, str, int | None, int | None]:
    """Call Gemini API. Returns (text, model_name, prompt_tokens, output_tokens).

    Raises on any failure so the fallback chain can continue.
    """
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "maxOutputTokens": 65536,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            _GEMINI_URL,
            json=body,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
        )
    if resp.status_code == 429:
        raise RateLimitError(f"Gemini rate limited (429)")
    if resp.status_code != 200:
        raise ProviderError(f"Gemini HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
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
        raise ProviderError("Gemini returned empty response")

    return text, _GEMINI_MODEL, prompt_tokens, candidates_tokens


async def _call_openai_compat(
    prompt: str, system_prompt: str, api_key: str, base_url: str, model: str
) -> tuple[str, str, int | None, int | None]:
    """Call an OpenAI-compatible API (Groq, Cerebras).

    Returns (text, model_name, prompt_tokens, output_tokens).
    Raises on any failure so the fallback chain can continue.
    """
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "PropVal/1.0 (property-intelligence; contact@propval.co.uk)",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(base_url, json=body, headers=headers)

    if resp.status_code == 429:
        raise RateLimitError(f"{model} rate limited (429)")
    if resp.status_code != 200:
        raise ProviderError(f"{model} HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    usage = data.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens")
    output_tokens = usage.get("completion_tokens")

    choices = data.get("choices") or []
    if not choices:
        raise ProviderError(f"{model} returned no choices")
    text = (choices[0].get("message") or {}).get("content", "")
    if not text:
        raise ProviderError(f"{model} returned empty content")

    return text, model, prompt_tokens, output_tokens


class RateLimitError(Exception):
    """Provider returned 429 — try next provider."""


class ProviderError(Exception):
    """Provider returned an error — try next provider."""


# ── Main entry point with fallback chain ──────────────────────────────────────

async def generate_property_narrative(
    property_data: dict,
    *,
    user_id: str | None = None,
    user_email: str | None = None,
    custom_prompts: dict[str, str] | None = None,
) -> dict:
    """Generate AI narrative with automatic provider fallback.

    Chain: Groq → Cerebras → Gemini. Falls back on 429, timeout, or error.
    """
    address = property_data.get("address")
    postcode = property_data.get("postcode")

    # Build prompt
    try:
        prompt, is_custom = _build_prompt(property_data, custom_prompts=custom_prompts)
    except Exception as build_err:
        logging.exception("_build_prompt crashed: %s", build_err)
        return {k: "AI narrative unavailable — prompt build error" for k in _EMPTY}

    # No prompt configured for this section
    if not prompt:
        requested = property_data.get("requested_section")
        if requested and requested in _REPORT_SECTIONS:
            return {requested: _NO_PROMPT_MSG}
        return {k: _NO_PROMPT_MSG for k in _EMPTY}

    system_prompt = _SYSTEM_PROMPT_CUSTOM if is_custom else _SYSTEM_PROMPT

    # Build provider chain: Groq → Cerebras → Gemini
    # Groq has best RPM/RPD for free tier, Cerebras has largest daily pool,
    # Gemini is last resort (lowest RPD, thinking tokens consume output budget).
    providers: list[tuple[str, object]] = []

    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        providers.append(("groq", lambda p=prompt, s=system_prompt, k=groq_key: _call_openai_compat(p, s, k, _GROQ_URL, _GROQ_MODEL)))

    cerebras_key = os.getenv("CEREBRAS_API_KEY")
    if cerebras_key:
        providers.append(("cerebras", lambda p=prompt, s=system_prompt, k=cerebras_key: _call_openai_compat(p, s, k, _CEREBRAS_URL, _CEREBRAS_MODEL)))

    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        providers.append(("gemini", lambda p=prompt, s=system_prompt, k=gemini_key: _call_gemini(p, s, k)))

    if not providers:
        logging.warning("No AI API keys configured (GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY)")
        await log_ai_usage(
            user_id=user_id, user_email=user_email, endpoint="ai-narrative",
            model="none", input_text="", output_text="",
            success=False, latency_ms=0, address=address, postcode=postcode,
            error_message="No API keys configured",
        )
        return {k: "AI narrative unavailable — no API keys configured" for k in _EMPTY}

    # Try each provider in order
    last_error = ""
    for provider_name, call_fn in providers:
        start = time.monotonic()
        try:
            text, model_used, prompt_tokens, output_tokens = await call_fn()
            latency_ms = int((time.monotonic() - start) * 1000)

            # Log success
            await log_ai_usage(
                user_id=user_id, user_email=user_email, endpoint="ai-narrative",
                model=model_used, input_text=prompt, output_text=text,
                success=True, latency_ms=latency_ms, address=address, postcode=postcode,
                prompt_token_count=prompt_tokens, candidates_token_count=output_tokens,
            )

            if provider_name != "groq":
                logging.info("AI narrative served by fallback provider: %s (%dms)", provider_name, latency_ms)

            # Parse and return
            parsed = _parse_response(text)
            requested = property_data.get("requested_section")
            if requested and requested in _REPORT_SECTIONS:
                return {requested: _parse_single_section(text)}
            if requested and requested in _EMPTY:
                return {k: (parsed[k] if k == requested else None) for k in _EMPTY}
            return parsed

        except RateLimitError as e:
            latency_ms = int((time.monotonic() - start) * 1000)
            last_error = str(e)
            logging.warning("AI provider %s rate-limited, trying next fallback... (%s)", provider_name, e)
            await log_ai_usage(
                user_id=user_id, user_email=user_email, endpoint="ai-narrative",
                model=provider_name, input_text=prompt, output_text="",
                success=False, latency_ms=latency_ms, address=address, postcode=postcode,
                error_message=f"429 rate limit — falling back",
            )
            continue

        except httpx.TimeoutException:
            latency_ms = int((time.monotonic() - start) * 1000)
            last_error = f"{provider_name} timeout"
            logging.warning("AI provider %s timed out, trying next fallback...", provider_name)
            await log_ai_usage(
                user_id=user_id, user_email=user_email, endpoint="ai-narrative",
                model=provider_name, input_text=prompt, output_text="",
                success=False, latency_ms=latency_ms, address=address, postcode=postcode,
                error_message="Timeout — falling back",
            )
            continue

        except (ProviderError, Exception) as e:
            latency_ms = int((time.monotonic() - start) * 1000)
            last_error = str(e)
            logging.warning("AI provider %s failed: %s — trying next fallback...", provider_name, e)
            await log_ai_usage(
                user_id=user_id, user_email=user_email, endpoint="ai-narrative",
                model=provider_name, input_text=prompt, output_text="",
                success=False, latency_ms=latency_ms, address=address, postcode=postcode,
                error_message=str(e)[:200],
            )
            continue

    # All providers exhausted
    logging.error("All AI providers failed. Last error: %s", last_error)
    return {k: f"AI narrative unavailable — all providers failed ({last_error})" for k in _EMPTY}

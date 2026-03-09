"""AI usage tracking — logs every Gemini call to Supabase for admin metering."""

import logging
import os
from datetime import datetime, timezone

from supabase import create_client

_supabase = None


def _sb():
    global _supabase
    if _supabase is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return None
        _supabase = create_client(url, key)
    return _supabase


def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token."""
    return max(1, len(text) // 4)


async def log_ai_usage(
    *,
    user_id: str | None = None,
    user_email: str | None = None,
    endpoint: str = "ai-narrative",
    model: str = "gemini-2.5-flash",
    input_text: str = "",
    output_text: str = "",
    success: bool = True,
    latency_ms: int = 0,
    address: str | None = None,
    postcode: str | None = None,
    error_message: str | None = None,
    prompt_token_count: int | None = None,
    candidates_token_count: int | None = None,
) -> None:
    """Fire-and-forget insert into ai_usage_log. Never raises."""
    try:
        sb = _sb()
        if sb is None:
            return

        input_tokens = prompt_token_count if prompt_token_count is not None else estimate_tokens(input_text)
        output_tokens = candidates_token_count if candidates_token_count is not None else estimate_tokens(output_text)

        sb.table("ai_usage_log").insert({
            "user_id": user_id or "00000000-0000-0000-0000-000000000000",
            "user_email": user_email,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "endpoint": endpoint,
            "address": address,
            "postcode": postcode,
            "success": success,
            "error_message": error_message,
            "latency_ms": latency_ms,
        }).execute()
    except Exception as exc:
        logging.warning("ai_usage_log insert failed: %s", exc)

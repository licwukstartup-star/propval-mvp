"""Valuer Feedback Service — captures AI vs valuer deltas as training signal.

Every AI interaction (narrative, comp suggestion, SEMV adoption, QA override)
is silently logged so the data flywheel accumulates from day 1.

Uses service-role Supabase client (writes bypass RLS).
All methods are fire-and-forget — never raise, never block the user.
"""

import logging

from services.supabase_admin import get_service_client as _sb

logger = logging.getLogger(__name__)


async def log_narrative_feedback(
    *,
    user_id: str,
    firm_id: str | None = None,
    case_id: str | None = None,
    section_key: str,
    ai_output: str,
    valuer_output: str,
    property_type: str | None = None,
    borough: str | None = None,
    prompt_key: str | None = None,
    property_features: dict | None = None,
) -> None:
    """Log when a valuer edits AI-generated narrative text."""
    try:
        sb = _sb()
        if sb is None:
            return

        # Skip if outputs are identical (no edit = no signal)
        if ai_output.strip() == valuer_output.strip():
            return

        sb.table("valuer_feedback").insert({
            "user_id": user_id,
            "firm_id": firm_id,
            "case_id": case_id,
            "feedback_type": "narrative_edit",
            "section_key": section_key,
            "property_type": property_type,
            "borough": borough,
            "prompt_key": prompt_key,
            "ai_output": ai_output,
            "valuer_output": valuer_output,
            "property_features": property_features,
        }).execute()
    except Exception as exc:
        logger.warning("narrative feedback insert failed: %s", exc)


async def log_comp_selection_feedback(
    *,
    user_id: str,
    firm_id: str | None = None,
    case_id: str,
    suggested_snapshot_ids: list[str],
    adopted_snapshot_ids: list[str],
    property_type: str | None = None,
    borough: str | None = None,
    property_features: dict | None = None,
) -> None:
    """Log when valuer's adopted comps differ from engine suggestions."""
    try:
        sb = _sb()
        if sb is None:
            return

        sb.table("valuer_feedback").insert({
            "user_id": user_id,
            "firm_id": firm_id,
            "case_id": case_id,
            "feedback_type": "comp_selection",
            "property_type": property_type,
            "borough": borough,
            "ai_output": None,
            "valuer_output": None,
            "metadata": {
                "suggested_snapshot_ids": suggested_snapshot_ids,
                "adopted_snapshot_ids": adopted_snapshot_ids,
            },
            "property_features": property_features,
        }).execute()
    except Exception as exc:
        logger.warning("comp selection feedback insert failed: %s", exc)


async def log_value_adoption_feedback(
    *,
    user_id: str,
    firm_id: str | None = None,
    case_id: str,
    semv_median: float | None = None,
    semv_mode: float | None = None,
    semv_ci_low: float | None = None,
    semv_ci_high: float | None = None,
    adopted_value: float,
    property_type: str | None = None,
    borough: str | None = None,
    property_features: dict | None = None,
) -> None:
    """Log when valuer adopts a specific value from SEMV distribution."""
    try:
        sb = _sb()
        if sb is None:
            return

        sb.table("valuer_feedback").insert({
            "user_id": user_id,
            "firm_id": firm_id,
            "case_id": case_id,
            "feedback_type": "value_adoption",
            "property_type": property_type,
            "borough": borough,
            "ai_output": None,
            "valuer_output": str(adopted_value),
            "metadata": {
                "semv_median": semv_median,
                "semv_mode": semv_mode,
                "semv_ci_low": semv_ci_low,
                "semv_ci_high": semv_ci_high,
                "adopted_value": adopted_value,
            },
            "property_features": property_features,
        }).execute()
    except Exception as exc:
        logger.warning("value adoption feedback insert failed: %s", exc)


async def log_qa_override_feedback(
    *,
    user_id: str,
    firm_id: str | None = None,
    case_id: str,
    section_key: str | None = None,
    qa_finding: dict,
    valuer_decision: str,  # 'accepted' | 'dismissed' | 'edited'
    property_type: str | None = None,
    borough: str | None = None,
) -> None:
    """Log when valuer overrides or dismisses an AI QA finding."""
    try:
        sb = _sb()
        if sb is None:
            return

        sb.table("valuer_feedback").insert({
            "user_id": user_id,
            "firm_id": firm_id,
            "case_id": case_id,
            "feedback_type": "qa_override",
            "section_key": section_key,
            "property_type": property_type,
            "borough": borough,
            "ai_output": str(qa_finding),
            "valuer_output": valuer_decision,
            "metadata": {"qa_finding": qa_finding},
        }).execute()
    except Exception as exc:
        logger.warning("qa override feedback insert failed: %s", exc)

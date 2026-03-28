"""Feedback router — receives valuer feedback from the frontend.

Lightweight endpoints that capture AI vs valuer deltas for the data flywheel.
All writes are fire-and-forget (non-blocking to the user experience).
"""

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from .auth import get_current_user
from .rate_limit import limiter
from services.feedback_service import (
    log_narrative_feedback,
    log_value_adoption_feedback,
    log_qa_override_feedback,
)

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
logger = logging.getLogger(__name__)


# ── Request models ────────────────────────────────────────────────────────────

class NarrativeFeedbackRequest(BaseModel):
    case_id: str | None = None
    section_key: str
    ai_output: str
    valuer_output: str
    property_type: str | None = None
    borough: str | None = None
    prompt_key: str | None = None
    property_features: dict | None = None


class ValueAdoptionFeedbackRequest(BaseModel):
    case_id: str
    semv_median: float | None = None
    semv_mode: float | None = None
    semv_ci_low: float | None = None
    semv_ci_high: float | None = None
    adopted_value: float
    property_type: str | None = None
    borough: str | None = None
    property_features: dict | None = None


class QAOverrideFeedbackRequest(BaseModel):
    case_id: str
    section_key: str | None = None
    qa_finding: dict
    valuer_decision: str  # 'accepted' | 'dismissed' | 'edited'
    property_type: str | None = None
    borough: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/narrative")
@limiter.limit("120/minute")
async def submit_narrative_feedback(
    request: Request,
    body: NarrativeFeedbackRequest,
    user: dict = Depends(get_current_user),
):
    """Frontend submits when valuer finishes editing an AI-generated section."""
    await log_narrative_feedback(
        user_id=user["id"],
        firm_id=user.get("firm_id"),
        case_id=body.case_id,
        section_key=body.section_key,
        ai_output=body.ai_output,
        valuer_output=body.valuer_output,
        property_type=body.property_type,
        borough=body.borough,
        prompt_key=body.prompt_key,
        property_features=body.property_features,
    )
    return {"status": "ok"}


@router.post("/value-adoption")
@limiter.limit("30/minute")
async def submit_value_adoption_feedback(
    request: Request,
    body: ValueAdoptionFeedbackRequest,
    user: dict = Depends(get_current_user),
):
    """Frontend submits when valuer adopts a SEMV value."""
    await log_value_adoption_feedback(
        user_id=user["id"],
        firm_id=user.get("firm_id"),
        case_id=body.case_id,
        semv_median=body.semv_median,
        semv_mode=body.semv_mode,
        semv_ci_low=body.semv_ci_low,
        semv_ci_high=body.semv_ci_high,
        adopted_value=body.adopted_value,
        property_type=body.property_type,
        borough=body.borough,
        property_features=body.property_features,
    )
    return {"status": "ok"}


@router.post("/qa-override")
@limiter.limit("60/minute")
async def submit_qa_override_feedback(
    request: Request,
    body: QAOverrideFeedbackRequest,
    user: dict = Depends(get_current_user),
):
    """Frontend submits when valuer accepts or dismisses a QA finding."""
    await log_qa_override_feedback(
        user_id=user["id"],
        firm_id=user.get("firm_id"),
        case_id=body.case_id,
        section_key=body.section_key,
        qa_finding=body.qa_finding,
        valuer_decision=body.valuer_decision,
        property_type=body.property_type,
        borough=body.borough,
    )
    return {"status": "ok"}

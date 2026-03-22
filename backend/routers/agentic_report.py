"""Agentic Report router — generate a complete valuation report in one call.

POST /api/agentic-report/generate
  Body: full case data (subject_property, comparables, semv_output, etc.)
  Returns: narratives + placeholders + RICS self-audit
"""

import logging

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.agentic_report_service import generate_agentic_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agentic-report", tags=["agentic-report"])


class AgenticReportRequest(BaseModel):
    """Request body — all the data the agent needs."""
    case: dict = {}
    subject_property: dict = {}
    comparables: list[dict] = []
    semv_output: dict = {}
    market_context: dict = {}


@router.post("/generate")
async def generate_report(
    body: AgenticReportRequest,
    authorization: str = Header(None),
):
    """Generate a complete agentic valuation report.

    Accepts the full case data and returns AI-generated narratives,
    populated placeholders, and a RICS VPS 3 self-audit.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    case_data = body.model_dump()

    # Basic validation
    if not case_data.get("subject_property"):
        raise HTTPException(status_code=400, detail="subject_property is required")

    result = await generate_agentic_report(case_data)

    if result.get("error"):
        raise HTTPException(status_code=502, detail=result["error"])

    return result

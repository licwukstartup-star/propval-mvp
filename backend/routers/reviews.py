"""Review & Approval flow for report copies.

Enforces dual-signatory workflow:
  1. Valuer submits a "Ready to Review" copy → reviewer (Director)
  2. Reviewer can approve, request revision, or edit (forced new copy)
  3. Any edit by reviewer → new copy + notify original valuer
  4. Approval creates a Final Report copy and issues the case
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter
from .report_copies import _next_version, _insert_copy_with_retry

router = APIRouter(prefix="/api/reviews", tags=["reviews"])
logger = logging.getLogger(__name__)


class SubmitReviewRequest(BaseModel):
    copy_id: str
    reviewer_id: str


class ReviewActionRequest(BaseModel):
    notes: Optional[str] = None


class ReviewEditRequest(BaseModel):
    editor_html: str
    editor_json: Optional[dict] = None
    notes: Optional[str] = None


def _notify(sb, user_id: str, type_: str, title: str, body: str = "", link: str = ""):
    """Insert an in-app notification."""
    try:
        sb.table("notifications").insert({
            "user_id": user_id,
            "type": type_,
            "title": title,
            "body": body,
            "link": link,
        }).execute()
    except Exception as exc:
        logger.warning("Failed to create notification: %s", exc)


@router.get("/eligible-reviewers")
@limiter.limit("30/minute")
async def list_eligible_reviewers(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """List firm members who can review reports (excludes self)."""
    sb = get_user_supabase(user)

    # Get current user's firm
    my_membership = (
        sb.table("firm_members")
        .select("firm_id")
        .eq("user_id", user["id"])
        .limit(1)
        .execute()
    )
    if not my_membership.data:
        return {"reviewers": []}

    firm_id = my_membership.data[0]["firm_id"]

    # Get all firm members except self
    members = (
        sb.table("firm_members")
        .select("user_id, role")
        .eq("firm_id", firm_id)
        .neq("user_id", user["id"])
        .execute()
    )

    # Enrich with signatory info where available
    reviewers = []
    for m in (members.data or []):
        reviewer = {"user_id": m["user_id"], "role": m["role"], "full_name": "", "role_title": ""}
        # Try to get signatory details for display
        sig = (
            sb.table("firm_signatories")
            .select("full_name, role_title, can_countersign")
            .eq("surveyor_id", user["id"])
            .execute()
        )
        # Match by checking all signatories (Phase 1: small list)
        for s in (sig.data or []):
            if s.get("can_countersign"):
                reviewer["full_name"] = s["full_name"]
                reviewer["role_title"] = s.get("role_title", "")
                break
        reviewers.append(reviewer)

    return {"reviewers": reviewers}


@router.post("")
@limiter.limit("10/minute")
async def submit_for_review(
    request: Request,
    body: SubmitReviewRequest,
    user: dict = Depends(get_current_user),
):
    """Submit a report copy for review by a reviewer (e.g., Director)."""
    sb = get_user_supabase(user)

    # Verify copy exists and is ready
    copy_resp = sb.table("report_copies").select("id, status, case_id, label").eq("id", body.copy_id).execute()
    if not copy_resp.data:
        raise HTTPException(404, "Copy not found")

    copy = copy_resp.data[0]
    if copy["status"] not in ("draft", "ready_for_review"):
        raise HTTPException(400, f"Copy status is '{copy['status']}' — must be draft or ready_for_review to submit")

    # Validate reviewer_id is a different user (cannot self-review)
    if body.reviewer_id == user["id"]:
        raise HTTPException(400, "You cannot review your own report")

    # Update copy status
    sb.table("report_copies").update({"status": "under_review"}).eq("id", body.copy_id).execute()

    # Create review request
    row = {
        "copy_id": body.copy_id,
        "case_id": copy["case_id"],
        "requested_by": user["id"],
        "reviewer_id": body.reviewer_id,
        "status": "pending",
    }
    resp = sb.table("review_requests").insert(row).execute()
    if not resp.data:
        raise HTTPException(500, "Failed to create review request")

    # Log event
    sb.table("review_events").insert({
        "review_id": resp.data[0]["id"],
        "actor_id": user["id"],
        "action": "submitted",
        "detail": f"Submitted '{copy['label']}' for review",
    }).execute()

    # Notify reviewer
    _notify(sb, body.reviewer_id, "review_request",
            "Report submitted for review",
            f"{user.get('email', 'A valuer')} submitted '{copy['label']}' for your review",
            f"/qa?copy={body.copy_id}")

    logger.info("Review submitted: copy=%s reviewer=%s", body.copy_id, body.reviewer_id)
    return resp.data[0]


@router.get("/mine")
@limiter.limit("60/minute")
async def list_my_reviews(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """List reviews assigned to the current user (as reviewer)."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("review_requests")
        .select("id, copy_id, case_id, requested_by, reviewer_id, status, reviewer_notes, created_at, reviewed_at")
        .eq("reviewer_id", user["id"])
        .order("created_at", desc=True)
        .execute()
    )
    return {"reviews": resp.data}


@router.get("/{review_id}")
@limiter.limit("60/minute")
async def get_review(
    request: Request,
    review_id: str,
    user: dict = Depends(get_current_user),
):
    """Get review details with event history."""
    sb = get_user_supabase(user)
    review_resp = sb.table("review_requests").select("*").eq("id", review_id).execute()
    if not review_resp.data:
        raise HTTPException(404, "Review not found")

    events_resp = (
        sb.table("review_events")
        .select("id, actor_id, action, detail, new_copy_id, created_at")
        .eq("review_id", review_id)
        .order("created_at", desc=False)
        .execute()
    )

    return {"review": review_resp.data[0], "events": events_resp.data}


@router.patch("/{review_id}/approve")
@limiter.limit("10/minute")
async def approve_review(
    request: Request,
    review_id: str,
    body: ReviewActionRequest,
    user: dict = Depends(get_current_user),
):
    """Approve a review → creates Final Report copy and issues the case."""
    sb = get_user_supabase(user)

    review_resp = sb.table("review_requests").select("*").eq("id", review_id).execute()
    if not review_resp.data:
        raise HTTPException(404, "Review not found")

    review = review_resp.data[0]
    if review["reviewer_id"] != user["id"]:
        raise HTTPException(403, "Only the assigned reviewer can approve")
    if review["status"] not in ("pending", "in_review"):
        raise HTTPException(400, f"Cannot approve — status is '{review['status']}'")

    # Get the copy to create final version
    copy_resp = sb.table("report_copies").select("*").eq("id", review["copy_id"]).execute()
    if not copy_resp.data:
        raise HTTPException(404, "Associated copy not found")

    source_copy = copy_resp.data[0]

    # Create Final Report copy (with retry for version conflicts)
    next_version = _next_version(sb, review["case_id"])
    final_copy = {
        "case_id": review["case_id"],
        "version": next_version,
        "label": "Final Report",
        "status": "final",
        "editor_html": source_copy["editor_html"],
        "editor_json": source_copy.get("editor_json"),
        "wizard_snapshot": source_copy.get("wizard_snapshot"),
        "created_by": review["requested_by"],
    }
    final_data = _insert_copy_with_retry(sb, final_copy, review["case_id"])

    # Update review
    sb.table("review_requests").update({
        "status": "approved",
        "reviewer_notes": body.notes,
        "reviewed_at": datetime.utcnow().isoformat(),
    }).eq("id", review_id).execute()

    # Update source copy status
    sb.table("report_copies").update({"status": "approved"}).eq("id", review["copy_id"]).execute()

    # Update case status to issued
    sb.table("cases").update({
        "status": "issued",
        "finalised_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", review["case_id"]).execute()

    # Log event
    sb.table("review_events").insert({
        "review_id": review_id,
        "actor_id": user["id"],
        "action": "approved",
        "detail": body.notes or "Approved",
        "new_copy_id": final_data["id"],
    }).execute()

    # Notify valuer
    _notify(sb, review["requested_by"], "approval",
            "Report approved!",
            "Your report has been approved by the reviewer. Final Report created.",
            f"/qa?copy={final_data['id']}")

    logger.info("Review approved: review=%s final_copy=%s", review_id, final_data["id"])
    return {"status": "approved", "final_copy": final_data}


@router.patch("/{review_id}/request-revision")
@limiter.limit("10/minute")
async def request_revision(
    request: Request,
    review_id: str,
    body: ReviewActionRequest,
    user: dict = Depends(get_current_user),
):
    """Send the copy back to the valuer with revision notes."""
    sb = get_user_supabase(user)

    review_resp = sb.table("review_requests").select("*").eq("id", review_id).execute()
    if not review_resp.data:
        raise HTTPException(404, "Review not found")

    review = review_resp.data[0]
    if review["reviewer_id"] != user["id"]:
        raise HTTPException(403, "Only the assigned reviewer can request revision")
    if review["status"] in ("approved", "rejected"):
        raise HTTPException(400, f"Cannot request revision — review is already '{review['status']}'")

    sb.table("review_requests").update({
        "status": "revision_requested",
        "reviewer_notes": body.notes,
    }).eq("id", review_id).execute()

    sb.table("report_copies").update({"status": "revision_requested"}).eq("id", review["copy_id"]).execute()

    sb.table("review_events").insert({
        "review_id": review_id,
        "actor_id": user["id"],
        "action": "revision_requested",
        "detail": body.notes or "Revision requested",
    }).execute()

    _notify(sb, review["requested_by"], "revision_needed",
            "Revision requested",
            body.notes or "The reviewer has requested changes to your report.",
            f"/qa?copy={review['copy_id']}")

    return {"status": "revision_requested"}


@router.post("/{review_id}/edit")
@limiter.limit("10/minute")
async def reviewer_edit(
    request: Request,
    review_id: str,
    body: ReviewEditRequest,
    user: dict = Depends(get_current_user),
):
    """Reviewer edits the report → FORCED new copy + notify valuer.

    This enforces the audit trail: reviewer edits never modify the original copy.
    """
    sb = get_user_supabase(user)

    review_resp = sb.table("review_requests").select("*").eq("id", review_id).execute()
    if not review_resp.data:
        raise HTTPException(404, "Review not found")

    review = review_resp.data[0]
    if review["reviewer_id"] != user["id"]:
        raise HTTPException(403, "Only the assigned reviewer can edit")
    if review["status"] in ("approved", "rejected"):
        raise HTTPException(400, f"Cannot edit — review is already '{review['status']}'")

    # Get source copy for wizard_snapshot
    source = sb.table("report_copies").select("wizard_snapshot, case_id").eq("id", review["copy_id"]).execute()
    if not source.data:
        raise HTTPException(404, "Source copy not found")

    # Create new copy with reviewer's edits (retry for version conflicts)
    next_version = _next_version(sb, review["case_id"])
    new_copy = {
        "case_id": review["case_id"],
        "version": next_version,
        "label": f"Reviewer Edit v{next_version}",
        "status": "under_review",
        "editor_html": body.editor_html,
        "editor_json": body.editor_json,
        "wizard_snapshot": source.data[0].get("wizard_snapshot"),
        "created_by": user["id"],
    }
    new_copy_data = _insert_copy_with_retry(sb, new_copy, review["case_id"])

    # Update review to point to new copy
    sb.table("review_requests").update({
        "copy_id": new_copy_data["id"],
        "status": "in_review",
    }).eq("id", review_id).execute()

    # Log event
    sb.table("review_events").insert({
        "review_id": review_id,
        "actor_id": user["id"],
        "action": "edited",
        "detail": body.notes or "Reviewer made edits — new copy created",
        "new_copy_id": new_copy_data["id"],
    }).execute()

    # Notify valuer — mutual consent requirement
    _notify(sb, review["requested_by"], "edit_by_reviewer",
            "Reviewer edited your report",
            f"The reviewer made changes to your report. A new copy (v{next_version}) has been created. Please review the changes.",
            f"/qa?copy={new_copy_data['id']}")

    logger.info("Reviewer edit: review=%s new_copy=%s", review_id, new_copy_data["id"])
    return {"new_copy": new_copy_data}

"""In-app notification endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from .auth import get_current_user, get_user_supabase
from .rate_limit import limiter

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
logger = logging.getLogger(__name__)


@router.get("")
@limiter.limit("120/minute")
async def list_notifications(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """List notifications for the current user (unread first, then recent)."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("notifications")
        .select("id, type, title, body, link, is_read, created_at")
        .eq("user_id", user["id"])
        .order("is_read", desc=False)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return {"notifications": resp.data}


@router.get("/unread-count")
@limiter.limit("120/minute")
async def unread_count(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Get count of unread notifications."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("notifications")
        .select("id", count="exact")
        .eq("user_id", user["id"])
        .eq("is_read", False)
        .execute()
    )
    return {"count": resp.count or 0}


@router.patch("/{notification_id}/read")
@limiter.limit("60/minute")
async def mark_read(
    request: Request,
    notification_id: str,
    user: dict = Depends(get_current_user),
):
    """Mark a single notification as read."""
    sb = get_user_supabase(user)
    resp = (
        sb.table("notifications")
        .update({"is_read": True})
        .eq("id", notification_id)
        .eq("user_id", user["id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@router.patch("/read-all")
@limiter.limit("10/minute")
async def mark_all_read(
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Mark all notifications as read."""
    sb = get_user_supabase(user)
    sb.table("notifications").update({"is_read": True}).eq("user_id", user["id"]).eq("is_read", False).execute()
    return {"ok": True}

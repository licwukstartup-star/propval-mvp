import os

from fastapi import APIRouter, Depends, HTTPException
from supabase import create_client

from .auth import get_current_user, require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    """List all registered users. Admin only."""
    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=500, detail="Supabase admin credentials not configured")

    admin_client = create_client(supabase_url, service_role_key)
    response = admin_client.auth.admin.list_users()

    users = []
    for u in response:
        meta = u.user_metadata or {}
        users.append({
            "id": u.id,
            "email": u.email,
            "full_name": meta.get("full_name", ""),
            "role": meta.get("role", "customer"),
            "created_at": u.created_at.isoformat() if u.created_at else None,
        })

    return {"users": users}

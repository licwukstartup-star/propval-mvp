from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from .auth import get_current_user, require_admin
from .rate_limit import limiter
from services.supabase_admin import require_service_client

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _admin_sb():
    try:
        return require_service_client()
    except RuntimeError:
        raise HTTPException(status_code=500, detail="Supabase admin credentials not configured")


@router.get("/users")
@limiter.limit("30/minute")
async def list_users(request: Request, user: dict = Depends(require_admin)):
    """List all registered users. Admin only."""
    admin_client = _admin_sb()
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


@router.get("/ai-usage")
@limiter.limit("30/minute")
async def ai_usage_stats(request: Request, user: dict = Depends(require_admin)):
    """AI usage metering dashboard data. Admin only."""
    sb = _admin_sb()

    # Fetch all rows (at pilot scale <5k rows this is fine)
    result = sb.table("ai_usage_log").select("*").order("timestamp", desc=True).execute()
    rows = result.data or []

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)
    chart_start = today_start - timedelta(days=29)

    # Aggregations
    today_calls = 0
    week_calls = 0
    month_calls = 0
    total_input = 0
    total_output = 0
    total_latency = 0
    success_count = 0
    fail_count = 0

    per_user: dict[str, dict] = defaultdict(lambda: {
        "total_calls": 0, "total_tokens": 0, "last_used": None, "total_latency": 0,
        "success": 0, "fail": 0,
    })
    daily: dict[str, dict] = defaultdict(lambda: {"calls": 0, "tokens": 0, "success": 0, "fail": 0})

    for row in rows:
        ts_str = row.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = now

        inp = row.get("input_tokens", 0) or 0
        out = row.get("output_tokens", 0) or 0
        lat = row.get("latency_ms", 0) or 0
        ok = row.get("success", True)
        email = row.get("user_email") or "unknown"

        total_input += inp
        total_output += out
        total_latency += lat
        if ok:
            success_count += 1
        else:
            fail_count += 1

        if ts >= today_start:
            today_calls += 1
        if ts >= week_start:
            week_calls += 1
        if ts >= month_start:
            month_calls += 1

        # Per-user
        u = per_user[email]
        u["total_calls"] += 1
        u["total_tokens"] += inp + out
        u["total_latency"] += lat
        if ok:
            u["success"] += 1
        else:
            u["fail"] += 1
        if u["last_used"] is None or ts_str > u["last_used"]:
            u["last_used"] = ts_str

        # Daily chart (last 30 days)
        if ts >= chart_start:
            day_key = ts.strftime("%Y-%m-%d")
            d = daily[day_key]
            d["calls"] += 1
            d["tokens"] += inp + out
            if ok:
                d["success"] += 1
            else:
                d["fail"] += 1

    all_time = len(rows)
    avg_latency = int(total_latency / all_time) if all_time else 0

    # Build daily chart with all 30 days (fill gaps with zeros)
    daily_chart = []
    for i in range(30):
        d = (chart_start + timedelta(days=i)).strftime("%Y-%m-%d")
        entry = daily.get(d, {"calls": 0, "tokens": 0, "success": 0, "fail": 0})
        daily_chart.append({"date": d, **entry})

    # Per-user list
    per_user_list = []
    for email, stats in sorted(per_user.items(), key=lambda x: x[1]["total_calls"], reverse=True):
        per_user_list.append({
            "user_email": email,
            "total_calls": stats["total_calls"],
            "total_tokens": stats["total_tokens"],
            "last_used": stats["last_used"],
            "avg_latency_ms": int(stats["total_latency"] / stats["total_calls"]) if stats["total_calls"] else 0,
            "success": stats["success"],
            "fail": stats["fail"],
        })

    # Recent 50 calls
    recent = []
    for row in rows[:50]:
        recent.append({
            "timestamp": row.get("timestamp"),
            "user_email": row.get("user_email") or "unknown",
            "endpoint": row.get("endpoint", ""),
            "model": row.get("model", ""),
            "address": row.get("address"),
            "postcode": row.get("postcode"),
            "input_tokens": row.get("input_tokens", 0),
            "output_tokens": row.get("output_tokens", 0),
            "latency_ms": row.get("latency_ms", 0),
            "success": row.get("success", True),
            "error_message": row.get("error_message"),
        })

    return {
        "summary": {
            "today_calls": today_calls,
            "week_calls": week_calls,
            "month_calls": month_calls,
            "all_time_calls": all_time,
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_tokens": total_input + total_output,
            "avg_latency_ms": avg_latency,
            "success_count": success_count,
            "fail_count": fail_count,
            "success_rate": round(success_count / all_time * 100, 1) if all_time else 0,
        },
        "per_user": per_user_list,
        "daily_chart": daily_chart,
        "recent_calls": recent,
    }

import os
import time

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from supabase import create_client

security = HTTPBearer()

# Cache for JWKS keys — refresh every 6 hours
_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0
_JWKS_TTL = 21600  # 6 hours


def _get_jwks() -> dict:
    """Fetch and cache the JWKS from Supabase (TTL: 6h).

    If the fetch fails and we have a cached copy, return it with a warning.
    If no cached copy exists, raise — we cannot verify tokens without keys.
    """
    global _jwks_cache, _jwks_fetched_at
    if _jwks_cache is not None and (time.monotonic() - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache
    supabase_url = os.getenv("SUPABASE_URL", "")
    try:
        resp = httpx.get(f"{supabase_url}/auth/v1/.well-known/jwks.json", timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = time.monotonic()
        return _jwks_cache
    except Exception:
        if _jwks_cache is not None:
            return _jwks_cache
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch signing keys — authentication unavailable",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Verify the Supabase JWT and return user info."""
    token = credentials.credentials

    try:
        # Try HS256 first (Supabase default on free tier).
        # This avoids "algorithm confusion" (RFC 8725 §3.1) where an attacker
        # crafts alg=HS256 and signs with a leaked public key.
        # We never branch on the unverified header for HS256 — we just try it.
        jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
        payload = None

        if jwt_secret:
            try:
                payload = jwt.decode(
                    token, jwt_secret, algorithms=["HS256"], audience="authenticated",
                )
            except JWTError:
                pass  # not HS256 — try asymmetric below

        if payload is None:
            # Asymmetric verification — only now read the unverified header
            header = jwt.get_unverified_header(token)
            alg = header.get("alg")
            if alg not in ("ES256", "RS256"):
                raise JWTError(f"Unsupported algorithm: {alg}")
            jwks = _get_jwks()
            kid = header.get("kid")
            key = None
            for k in jwks.get("keys", []):
                if k.get("kid") == kid:
                    key = k
                    break
            if not key:
                raise JWTError("No matching key found in JWKS")
            payload = jwt.decode(
                token, key, algorithms=["ES256", "RS256"], audience="authenticated",
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_metadata = payload.get("user_metadata", {})
    role = user_metadata.get("role", "pending")

    # Block users who haven't been approved by an admin
    if role not in ("admin", "customer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending approval. Please contact the administrator.",
        )

    return {
        "id": payload.get("sub"),
        "email": payload.get("email"),
        "role": role,
        "access_token": token,
    }


def get_user_supabase(user: dict):
    """Return a Supabase client scoped to the user's session.

    Uses the anon key + the user's JWT so Row Level Security (RLS) is
    enforced server-side.  Use this for ALL user-scoped data (cases,
    firm_templates, etc.).  Reserve service-role clients for admin-only
    or system-level operations (property library, caches, news).

    Creates a fresh client per request to avoid token leakage between
    concurrent async requests sharing the same event loop.
    """
    url = os.getenv("SUPABASE_URL")
    anon_key = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon_key:
        raise HTTPException(500, "Supabase not configured")
    client = create_client(url, anon_key)
    client.postgrest.auth(user["access_token"])
    return client


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Require the current user to have the admin role."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user

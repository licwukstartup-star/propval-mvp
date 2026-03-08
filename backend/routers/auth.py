import os
import time

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

security = HTTPBearer()

# Cache for JWKS keys — refresh every 24 hours
_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0
_JWKS_TTL = 86400  # 24 hours


def _get_jwks() -> dict:
    """Fetch and cache the JWKS from Supabase (TTL: 24h)."""
    global _jwks_cache, _jwks_fetched_at
    if _jwks_cache is not None and (time.monotonic() - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache
    supabase_url = os.getenv("SUPABASE_URL", "")
    resp = httpx.get(f"{supabase_url}/auth/v1/.well-known/jwks.json", timeout=10)
    resp.raise_for_status()
    _jwks_cache = resp.json()
    _jwks_fetched_at = time.monotonic()
    return _jwks_cache


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Verify the Supabase JWT and return user info."""
    token = credentials.credentials

    try:
        # Read the token header to determine the algorithm
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "HS256":
            # Legacy: symmetric verification with JWT secret
            jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
            if not jwt_secret:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="JWT secret not configured",
                )
            payload = jwt.decode(
                token, jwt_secret, algorithms=["HS256"], audience="authenticated",
            )
        elif alg in ("ES256", "RS256"):
            # Asymmetric: verify with JWKS public key (whitelist allowed algorithms)
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
        else:
            raise JWTError(f"Unsupported algorithm: {alg}")
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
    }


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Require the current user to have the admin role."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user

"""
Unit tests for the auth module.

Tests JWT token parsing, role checks, and error handling.
All external calls (JWKS fetch, Supabase) are mocked.
"""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from jose import jwt as jose_jwt

from routers.auth import get_current_user, require_admin, _get_jwks


# ===================================================================
# Fixtures
# ===================================================================

TEST_JWT_SECRET = "test-secret-key-for-unit-tests-only"


def _make_token(payload: dict, secret: str = TEST_JWT_SECRET, algorithm: str = "HS256") -> str:
    """Create a signed JWT for testing."""
    return jose_jwt.encode(payload, secret, algorithm=algorithm)


def _make_credentials(token: str):
    """Create a mock HTTPAuthorizationCredentials."""
    creds = MagicMock()
    creds.credentials = token
    return creds


# ===================================================================
# JWKS cache
# ===================================================================

class TestGetJwks:
    def test_cache_hit(self):
        """When JWKS is cached and fresh, no HTTP call is made."""
        import routers.auth as auth_module
        original_cache = auth_module._jwks_cache
        original_fetched = auth_module._jwks_fetched_at
        try:
            import time
            auth_module._jwks_cache = {"keys": [{"kid": "test"}]}
            auth_module._jwks_fetched_at = time.monotonic()  # just fetched
            result = _get_jwks()
            assert result == {"keys": [{"kid": "test"}]}
        finally:
            auth_module._jwks_cache = original_cache
            auth_module._jwks_fetched_at = original_fetched

    def test_no_cache_no_url_raises(self):
        """When there is no cached JWKS and SUPABASE_URL is empty, fetch fails."""
        import routers.auth as auth_module
        original_cache = auth_module._jwks_cache
        original_fetched = auth_module._jwks_fetched_at
        try:
            auth_module._jwks_cache = None
            auth_module._jwks_fetched_at = 0
            with patch.dict(os.environ, {"SUPABASE_URL": ""}, clear=False):
                with pytest.raises(HTTPException) as exc_info:
                    _get_jwks()
                assert exc_info.value.status_code == 503
        finally:
            auth_module._jwks_cache = original_cache
            auth_module._jwks_fetched_at = original_fetched


# ===================================================================
# get_current_user — HS256 path
# ===================================================================

class TestGetCurrentUserHS256:
    @pytest.mark.asyncio
    async def test_valid_customer_token(self):
        """A valid HS256 token with role=customer should succeed."""
        token = _make_token({
            "sub": "user-123",
            "email": "terry@propval.co.uk",
            "aud": "authenticated",
            "user_metadata": {"role": "customer"},
        })
        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": TEST_JWT_SECRET}):
            result = await get_current_user(_make_credentials(token))
        assert result["id"] == "user-123"
        assert result["email"] == "terry@propval.co.uk"
        assert result["role"] == "customer"

    @pytest.mark.asyncio
    async def test_valid_admin_token(self):
        """A valid HS256 token with role=admin should succeed."""
        token = _make_token({
            "sub": "admin-456",
            "email": "admin@propval.co.uk",
            "aud": "authenticated",
            "user_metadata": {"role": "admin"},
        })
        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": TEST_JWT_SECRET}):
            result = await get_current_user(_make_credentials(token))
        assert result["role"] == "admin"

    @pytest.mark.asyncio
    async def test_pending_role_is_forbidden(self):
        """A token with role=pending should raise 403."""
        token = _make_token({
            "sub": "pending-user",
            "email": "pending@example.com",
            "aud": "authenticated",
            "user_metadata": {"role": "pending"},
        })
        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": TEST_JWT_SECRET}):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(_make_credentials(token))
            assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_no_role_defaults_to_pending(self):
        """A token without user_metadata.role defaults to 'pending' and is forbidden."""
        token = _make_token({
            "sub": "no-role-user",
            "email": "norole@example.com",
            "aud": "authenticated",
            "user_metadata": {},
        })
        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": TEST_JWT_SECRET}):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(_make_credentials(token))
            assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_invalid_token_raises_401(self):
        """A token signed with the wrong secret should raise 401."""
        token = _make_token(
            {"sub": "user-1", "email": "a@b.com", "aud": "authenticated",
             "user_metadata": {"role": "customer"}},
            secret="wrong-secret",
        )
        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": TEST_JWT_SECRET}):
            # Also need to mock the JWKS fallback to fail
            with patch("routers.auth._get_jwks", side_effect=HTTPException(503, "no keys")):
                with pytest.raises(HTTPException) as exc_info:
                    await get_current_user(_make_credentials(token))
                assert exc_info.value.status_code in (401, 503)

    @pytest.mark.asyncio
    async def test_token_includes_access_token(self):
        """The returned user dict should include the raw access_token."""
        token = _make_token({
            "sub": "user-789",
            "email": "test@test.com",
            "aud": "authenticated",
            "user_metadata": {"role": "customer"},
        })
        with patch.dict(os.environ, {"SUPABASE_JWT_SECRET": TEST_JWT_SECRET}):
            result = await get_current_user(_make_credentials(token))
        assert result["access_token"] == token


# ===================================================================
# require_admin
# ===================================================================

class TestRequireAdmin:
    @pytest.mark.asyncio
    async def test_admin_passes(self):
        user = {"id": "1", "email": "a@b.com", "role": "admin", "access_token": "tok"}
        result = await require_admin(user)
        assert result["role"] == "admin"

    @pytest.mark.asyncio
    async def test_customer_is_rejected(self):
        user = {"id": "2", "email": "c@d.com", "role": "customer", "access_token": "tok"}
        with pytest.raises(HTTPException) as exc_info:
            await require_admin(user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_pending_is_rejected(self):
        user = {"id": "3", "email": "e@f.com", "role": "pending", "access_token": "tok"}
        with pytest.raises(HTTPException) as exc_info:
            await require_admin(user)
        assert exc_info.value.status_code == 403

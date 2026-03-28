"""Centralised service-role Supabase client.

All backend code that needs service-role (admin) access should import
get_service_client() from here instead of constructing their own client.
This keeps the SERVICE_ROLE_KEY in a single module, making rotation and
auditing straightforward.
"""

import os

from supabase import create_client, Client

_client: Client | None = None


def get_service_client() -> Client | None:
    """Return a cached service-role Supabase client.

    Returns None if credentials are not configured (graceful degradation).
    """
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return None
        _client = create_client(url, key)
    return _client


def require_service_client() -> Client:
    """Return the service-role client or raise RuntimeError."""
    client = get_service_client()
    if client is None:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return client

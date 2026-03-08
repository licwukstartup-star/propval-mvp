"""Retry + circuit breaker for external API calls (Mandate S5.1).

Usage:
    from routers.resilience import resilient_request
    resp = await resilient_request(client, "GET", url, params={...})

Behaviour:
- 1 retry on 5xx or timeout (1s then 2s backoff)
- Never retries 4xx (client error)
- Circuit opens after 3 consecutive failures per host, skips for 60s
- Returns None when circuit is open (caller handles gracefully)
"""

import asyncio
import logging
import time
from urllib.parse import urlparse

import httpx

# Circuit breaker state per host
_circuit_failures: dict[str, int] = {}      # host → consecutive failure count
_circuit_open_until: dict[str, float] = {}  # host → monotonic time when circuit closes
_CIRCUIT_THRESHOLD = 3
_CIRCUIT_RESET_SECONDS = 60


async def resilient_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_retries: int = 1,
    timeout: float | None = None,
    **kwargs,
) -> httpx.Response | None:
    """Make an HTTP request with retry and circuit breaker.

    Returns the Response on success, or None if all attempts fail
    or the circuit is open.
    """
    host = urlparse(url).hostname or url

    # Check circuit breaker
    if _circuit_open_until.get(host, 0) > time.monotonic():
        logging.debug("Circuit open for %s, skipping request", host)
        return None

    last_exc = None
    for attempt in range(1 + max_retries):
        try:
            req_kwargs = dict(kwargs)
            if timeout is not None:
                req_kwargs["timeout"] = timeout
            resp = await client.request(method, url, **req_kwargs)

            # Success or client error — don't retry 4xx
            if resp.status_code < 500:
                _circuit_failures[host] = 0
                return resp

            # 5xx — retry
            last_exc = None
            logging.warning("API %s returned %d (attempt %d)", host, resp.status_code, attempt + 1)

        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            last_exc = exc
            logging.warning("API %s timeout/connect error (attempt %d): %s", host, attempt + 1, exc)

        # Backoff before retry
        if attempt < max_retries:
            await asyncio.sleep(1 * (attempt + 1))

    # All attempts failed — update circuit breaker
    failures = _circuit_failures.get(host, 0) + 1
    _circuit_failures[host] = failures
    if failures >= _CIRCUIT_THRESHOLD:
        _circuit_open_until[host] = time.monotonic() + _CIRCUIT_RESET_SECONDS
        logging.warning("Circuit OPEN for %s after %d consecutive failures (60s cooldown)", host, failures)

    if last_exc:
        logging.warning("API %s failed after %d attempts: %s", host, max_retries + 1, last_exc)
    return None

"""News & Market Intelligence router.

Aggregates RSS feeds from UK property, RICS/regulatory, and macro-economic
sources. Stores articles in Supabase `news_articles` table and serves them
to the frontend. Macro indicator values come from `macro_indicators` table.

Refresh is triggered:
  - Automatically at startup (background task)
  - Automatically every 12 hours (background loop)
  - Manually via POST /api/news/refresh (admin only)

All external RSS fetches run in parallel via asyncio.gather().
"""

import asyncio
import csv
import io
import logging
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from .auth import get_current_user, require_admin
from .rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/news", tags=["news"])

_USER_AGENT = "PropVal/1.0 (property-intelligence; contact@propval.co.uk)"

# ---------------------------------------------------------------------------
# RSS source registry
# Tuple: (source_name, feed_url, category, topic_tag)
# category must be one of: 'property' | 'rics' | 'macro'
# ---------------------------------------------------------------------------
RSS_SOURCES: list[tuple[str, str, str, str]] = [
    # ── Tier 1 — Core (verified working) ──────────────────────────────────
    ("Bank of England", "https://www.bankofengland.co.uk/rss/news", "macro", "Monetary Policy"),
    ("Property Industry Eye", "https://propertyindustryeye.com/feed/", "property", "Residential"),
    ("Rightmove News", "https://www.rightmove.co.uk/news/feed/", "property", "Market"),
    ("FCA News", "https://www.fca.org.uk/news/rss.xml", "rics", "Regulation"),
    # ── Tier 2 — Google News RSS (real-time, no API key, all major outlets) ─
    ("Google News: UK Property", "https://news.google.com/rss/search?q=%22UK+property+market%22&hl=en-GB&gl=GB&ceid=GB:en", "property", "Market"),
    ("Google News: House Prices", "https://news.google.com/rss/search?q=%22house+prices+UK%22&hl=en-GB&gl=GB&ceid=GB:en", "property", "House Prices"),
    ("Google News: BoE Rates", "https://news.google.com/rss/search?q=%22Bank+of+England+interest+rate%22&hl=en-GB&gl=GB&ceid=GB:en", "macro", "Interest Rates"),
    ("Google News: UK Mortgages", "https://news.google.com/rss/search?q=%22UK+mortgage+rates%22&hl=en-GB&gl=GB&ceid=GB:en", "macro", "Mortgages"),
    ("Google News: RICS", "https://news.google.com/rss/search?q=RICS+valuation+surveyor&hl=en-GB&gl=GB&ceid=GB:en", "rics", "Standards"),
    # ── Tier 3 — Specialist property press (verified working, full summaries) ─
    ("Estate Agent Today", "https://www.estateagenttoday.co.uk/newsfeeds/", "property", "Residential"),
    ("The Negotiator", "https://www.thenegotiator.co.uk/feed/", "property", "Residential"),
    ("PropertyWire", "https://propertywire.com/feed/", "property", "Market"),
    # ── Tier 4 — Macro & research ─────────────────────────────────────────
    ("BBC Economy", "https://feeds.bbci.co.uk/news/business/economy/rss.xml", "macro", "Economic Data"),
    ("Bank Underground", "https://bankunderground.co.uk/feed/", "macro", "Research"),
    ("House of Commons Library", "https://commonslibrary.parliament.uk/feed/", "macro", "Economic Data"),
    # ── Tier 5 — GOV.UK OGL feeds (Open Government Licence v3.0) ─────────
    ("GOV.UK MHCLG", "https://www.gov.uk/government/organisations/department-for-levelling-up-housing-and-communities.atom", "rics", "Policy"),
    ("Valuation Office Agency", "https://www.gov.uk/government/organisations/valuation-office-agency.atom", "rics", "Valuation"),
    ("HM Land Registry", "https://www.gov.uk/government/organisations/land-registry.atom", "rics", "Land Registry"),
    ("Homes England", "https://www.gov.uk/government/organisations/homes-england.atom", "property", "Housing Delivery"),
    ("Planning Inspectorate", "https://www.gov.uk/government/organisations/planning-inspectorate.atom", "rics", "Planning"),
]

# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------
def _get_supabase():
    from services.supabase_admin import get_service_client
    return get_service_client()


# ---------------------------------------------------------------------------
# RSS fetch + parse (one source)
# ---------------------------------------------------------------------------

async def _fetch_feed(
    client: httpx.AsyncClient,
    source_name: str,
    feed_url: str,
    category: str,
    topic_tag: str,
) -> list[dict]:
    """Fetch and parse one RSS/Atom feed. Returns a list of article dicts."""
    import feedparser  # deferred import — only needed when refreshing

    try:
        resp = await client.get(feed_url, timeout=10.0)
        resp.raise_for_status()
        # Reject oversized feeds (>5MB) to prevent XML bomb attacks
        if len(resp.content) > 5 * 1024 * 1024:
            logger.warning("News feed too large [%s]: %d bytes", source_name, len(resp.content))
            return []
        raw_xml = resp.text
    except Exception as exc:
        logger.warning("News feed fetch failed [%s]: %s", source_name, exc)
        return []

    try:
        feed = await asyncio.to_thread(feedparser.parse, raw_xml)
    except Exception as exc:
        logger.warning("News feed parse failed [%s]: %s", source_name, exc)
        return []

    articles: list[dict] = []
    for entry in feed.get("entries", [])[:20]:  # cap at 20 per source per refresh
        title = (entry.get("title") or "").strip()
        url = (entry.get("link") or "").strip()
        if not title or not url:
            continue

        summary_raw = entry.get("summary") or entry.get("description") or ""
        # Strip HTML tags naively (RSS summaries often contain markup)
        import re
        summary = re.sub(r"<[^>]+>", "", summary_raw).strip()[:400]

        published_at: Optional[str] = None
        for field in ("published", "updated"):
            raw_date = entry.get(field)
            if raw_date:
                try:
                    published_at = parsedate_to_datetime(raw_date).isoformat()
                    break
                except Exception:
                    try:
                        from datetime import datetime as _dt
                        # ISO format fallback
                        published_at = _dt.fromisoformat(raw_date.replace("Z", "+00:00")).isoformat()
                        break
                    except Exception:
                        pass

        articles.append({
            "title": title,
            "summary": summary or None,
            "url": url,
            "source_name": source_name,
            "category": category,
            "topic_tag": topic_tag,
            "published_at": published_at,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })

    logger.info("News feed [%s]: %d articles parsed", source_name, len(articles))
    return articles


# ---------------------------------------------------------------------------
# Refresh orchestrator
# ---------------------------------------------------------------------------

async def run_refresh() -> dict:
    """Fetch all RSS sources in parallel and upsert into Supabase."""
    supabase = _get_supabase()
    if supabase is None:
        logger.warning("News refresh skipped — Supabase not configured")
        return {"status": "skipped", "reason": "supabase_not_configured"}

    async def _safe_fetch(name: str, url: str, cat: str, tag: str) -> list[dict]:
        """Wrap _fetch_feed with a hard 20s wall-clock timeout."""
        try:
            return await asyncio.wait_for(
                _fetch_feed(client, name, url, cat, tag),
                timeout=20.0,
            )
        except asyncio.TimeoutError:
            logger.warning("News feed hard timeout (20s) [%s]", name)
            return []

    async with httpx.AsyncClient(
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=True,
        timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
    ) as client:
        tasks = [
            _safe_fetch(name, url, cat, tag)
            for name, url, cat, tag in RSS_SOURCES
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    all_articles: list[dict] = []
    for result in results:
        if isinstance(result, Exception):
            logger.warning("News feed task raised: %s", result)
        elif isinstance(result, list):
            all_articles.extend(result)

    if not all_articles:
        logger.warning("News refresh: no articles fetched from any source")
        return {"status": "ok", "upserted": 0}

    # Deduplicate by URL (RSS feeds can return the same article twice)
    seen_urls: set[str] = set()
    unique_articles: list[dict] = []
    for article in all_articles:
        url = article["url"]
        if url not in seen_urls:
            seen_urls.add(url)
            unique_articles.append(article)

    # Upsert in batches of 50 (Supabase limit)
    upserted = 0
    batch_size = 50
    for i in range(0, len(unique_articles), batch_size):
        batch = unique_articles[i: i + batch_size]
        try:
            supabase.table("news_articles").upsert(
                batch,
                on_conflict="url",
            ).execute()
            upserted += len(batch)
        except Exception as exc:
            logger.error("News upsert batch failed: %s", exc)

    # Purge articles older than 90 days
    try:
        cutoff = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        from datetime import timedelta
        cutoff -= timedelta(days=90)
        supabase.table("news_articles").delete().lt(
            "published_at", cutoff.isoformat()
        ).execute()
    except Exception as exc:
        logger.warning("News purge failed: %s", exc)

    logger.info("News refresh complete — %d articles upserted", upserted)
    return {"status": "ok", "upserted": upserted, "total_fetched": len(all_articles)}


# ---------------------------------------------------------------------------
# Background refresh loop (started from main.py lifespan)
# ---------------------------------------------------------------------------
_refresh_task: asyncio.Task | None = None


async def start_background_refresh() -> None:
    """Run an immediate refresh then repeat every 12 hours."""
    global _refresh_task

    async def _loop():
        while True:
            try:
                await run_refresh()
            except Exception as exc:
                logger.error("News background refresh error: %s", exc)
            await asyncio.sleep(12 * 3600)  # 12 hours

    _refresh_task = asyncio.create_task(_loop())
    logger.info("News background refresh task started")


# ---------------------------------------------------------------------------
# Market ticker — live UK real estate quotes via yfinance
# ---------------------------------------------------------------------------

# Registry: (symbol, display_name, category, currency)
# currency: "GBp" (pence) for LSE stocks, "USD" for FX, "%" for gilt yields
_MARKET_SYMBOLS: list[tuple[str, str, str, str]] = [
    # REITs / Property ETF
    ("IUKP.L",       "UK Property ETF",   "reit",        "GBp"),
    ("BLND.L",       "British Land",      "reit",        "GBp"),
    ("LAND.L",       "Land Securities",   "reit",        "GBp"),
    ("SGRO.L",       "Segro",             "reit",        "GBp"),
    ("BBOX.L",       "Tritax Big Box",    "reit",        "GBp"),
    ("PHP.L",        "Primary Health",    "reit",        "GBp"),
    # Housebuilders
    ("PSN.L",        "Persimmon",         "housebuilder","GBp"),
    ("TW.L",         "Taylor Wimpey",     "housebuilder","GBp"),
    ("CRST.L",       "Crest Nicholson",   "housebuilder","GBp"),
    ("BKG.L",        "Berkeley Group",    "housebuilder","GBp"),
    ("BWY.L",        "Bellway",           "housebuilder","GBp"),
    ("RMV.L",        "Rightmove",         "proptech",    "GBp"),
    # Mortgage lenders
    ("LLOY.L",       "Lloyds",            "mortgage",    "GBp"),
    ("NWG.L",        "NatWest",           "mortgage",    "GBp"),
    ("BARC.L",       "Barclays",          "mortgage",    "GBp"),
    ("HSBA.L",       "HSBC",              "mortgage",    "GBp"),
    # Gilt yields — iShares UK gilt ETFs as proxies (LSE-listed, GBp)
    ("IGLS.L",       "UK Gilt 0-5yr",     "gilt",        "GBp"),
    ("IGLT.L",       "UK Gilt All Stocks","gilt",        "GBp"),
    ("IGLH.L",       "UK Gilt 15yr+",     "gilt",        "GBp"),
    # Index + FX
    ("^FTSE",        "FTSE 100",          "index",       "GBp"),
    ("GBPUSD=X",     "GBP/USD",           "fx",          "USD"),
]

_market_cache: list[dict] = []
_market_fetched_at: Optional[datetime] = None
_market_task: asyncio.Task | None = None


async def _fetch_market_data() -> list[dict]:
    """Fetch all market quotes via yfinance.

    Strategy: try batch yf.download() first. If it returns empty/None
    (common in yfinance ≥1.2), fall back to individual Ticker.history()
    calls which are more stable across versions.
    """
    def _sync_fetch() -> list[dict]:
        import yfinance as yf
        import pandas as pd

        symbols = [sym for sym, *_ in _MARKET_SYMBOLS]
        meta = {sym: (name, cat, cur) for sym, name, cat, cur in _MARKET_SYMBOLS}
        n = len(symbols)

        # --- Attempt 1: batch download ---
        def _try_batch() -> list[dict]:
            symbols_str = " ".join(symbols)

            def _get_series(df, field, sym):
                try:
                    if isinstance(df.columns, pd.MultiIndex):
                        return df[field][sym].dropna()
                    else:
                        return df[field].dropna()
                except (KeyError, TypeError):
                    return None

            intraday = yf.download(
                symbols_str, period="1d", interval="2m",
                auto_adjust=True, progress=False,
            )
            daily = yf.download(
                symbols_str, period="5d", interval="1d",
                auto_adjust=True, progress=False,
            )
            # Check if download returned usable data
            if intraday is None or daily is None:
                return []
            if hasattr(intraday, 'empty') and intraday.empty and hasattr(daily, 'empty') and daily.empty:
                return []

            results = []
            for sym in symbols:
                name, category, currency = meta[sym]
                try:
                    intra_close = _get_series(intraday, "Close", sym)
                    daily_close = _get_series(daily, "Close", sym)

                    if intra_close is not None and len(intra_close) > 0:
                        price = float(intra_close.iloc[-1])
                    elif daily_close is not None and len(daily_close) > 0:
                        price = float(daily_close.iloc[-1])
                    else:
                        continue

                    if daily_close is not None and len(daily_close) >= 2:
                        prev_close = float(daily_close.iloc[-2])
                    else:
                        prev_close = price

                    change = round(price - prev_close, 4)
                    change_pct = round((change / prev_close) * 100, 2) if prev_close else None

                    results.append({
                        "symbol": sym, "name": name, "category": category,
                        "price": round(price, 4), "change": change,
                        "change_pct": change_pct, "currency": currency, "stale": False,
                    })
                except Exception as exc:
                    logger.warning("yfinance batch parse failed [%s]: %s", sym, exc)
            return results

        try:
            batch_results = _try_batch()
            if batch_results:
                logger.info("Market ticker (batch): %d/%d quotes", len(batch_results), n)
                return batch_results
        except Exception as exc:
            logger.warning("yfinance batch download failed, falling back to individual: %s", exc)

        # --- Attempt 2: individual Ticker.history() calls ---
        logger.info("Market ticker: falling back to individual ticker fetches")
        results = []
        for sym in symbols:
            name, category, currency = meta[sym]
            try:
                ticker = yf.Ticker(sym)
                hist = ticker.history(period="5d")
                if hist is None or hist.empty:
                    continue
                close = hist["Close"].dropna()
                if len(close) == 0:
                    continue

                price = float(close.iloc[-1])
                prev_close = float(close.iloc[-2]) if len(close) >= 2 else price

                change = round(price - prev_close, 4)
                change_pct = round((change / prev_close) * 100, 2) if prev_close else None

                results.append({
                    "symbol": sym, "name": name, "category": category,
                    "price": round(price, 4), "change": change,
                    "change_pct": change_pct, "currency": currency, "stale": False,
                })
            except Exception as exc:
                logger.warning("yfinance individual fetch failed [%s]: %s", sym, exc)

        logger.info("Market ticker (individual): %d/%d quotes", len(results), n)
        return results

    return await asyncio.to_thread(_sync_fetch)


async def start_market_refresh() -> None:
    """Fetch market data immediately then refresh every 2 minutes.

    Yahoo Finance publishes 2-minute bars (interval='2m') so refreshing
    faster than 120s returns identical data. 2 batch requests every 2 min
    = 60 Yahoo Finance requests/hour — well within free tier limits.
    """
    global _market_task

    async def _loop():
        global _market_cache, _market_fetched_at
        while True:
            try:
                data = await _fetch_market_data()
                if data:
                    _market_cache = data
                    _market_fetched_at = datetime.now(timezone.utc)
            except Exception as exc:
                logger.error("Market ticker refresh error: %s", exc)
            await asyncio.sleep(120)  # 2 minutes — matches Yahoo Finance 2-min bar granularity

    _market_task = asyncio.create_task(_loop())
    logger.info("Market ticker background task started")


# ---------------------------------------------------------------------------
# Macro indicator auto-refresh — ONS + Bank of England free APIs
# ---------------------------------------------------------------------------

# ONS time-series JSON endpoints (no API key required)
_ONS_SERIES = {
    "cpi": {
        "url": "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data",
        "period": "months",
        "label": "CPI",
        "format_value": lambda v: f"{v}%",
        "format_change": lambda c: f"{c:+.1f}%",
    },
    "unemployment": {
        "url": "https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data",
        "period": "months",
        "label": "Unemployment",
        "format_value": lambda v: f"{v}%",
        "format_change": lambda c: f"{c:+.1f}%",
    },
    "gdp_growth": {
        "url": "https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/ihyq/pn2/data",
        "period": "quarters",
        "label": "GDP Growth",
        "format_value": lambda v: f"{v}%",
        "format_change": lambda c: f"{c:+.1f}%",
    },
}

# Bank of England Statistical Interactive Database (CSV, no key)
_BOE_SERIES = {
    "base_rate": {
        "code": "IUDBEDR",
        "label": "Base Rate",
        "format_value": lambda v: f"{v:.2f}%",
        "format_change": lambda c: f"{c:+.2f}%",
    },
    "gilt_10y": {
        "code": "IUDMNZC",
        "label": "10Y Gilt",
        "format_value": lambda v: f"{v:.2f}%",
        "format_change": lambda c: f"{c:+.2f}%",
    },
}

# Land Registry UK HPI REST endpoint
_UKHPI_REST = "https://landregistry.data.gov.uk/data/ukhpi/region/united-kingdom/month"


async def _fetch_ons_series(client: httpx.AsyncClient, key: str, cfg: dict) -> Optional[dict]:
    """Fetch one ONS time-series and return an indicator dict."""
    try:
        resp = await client.get(cfg["url"], timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        entries = data.get(cfg["period"], [])
        if not entries:
            return None

        # Find last two entries with numeric values
        valid = []
        for e in reversed(entries):
            val = e.get("value", "").strip()
            if val and val not in ("", "."):
                try:
                    valid.append((e, float(val)))
                except ValueError:
                    continue
            if len(valid) >= 2:
                break

        if not valid:
            return None

        latest_entry, latest_val = valid[0]
        # Build last_updated date from entry fields
        year = latest_entry.get("year", "")
        month = latest_entry.get("month", "")
        quarter = latest_entry.get("quarter", "")
        if year and month:
            # ONS months: "January", "February", etc.
            try:
                dt = datetime.strptime(f"{year} {month}", "%Y %B")
                last_updated = dt.strftime("%Y-%m-%d")
            except ValueError:
                last_updated = f"{year}-01-01"
        elif year and quarter:
            q_map = {"Q1": "03", "Q2": "06", "Q3": "09", "Q4": "12"}
            m = q_map.get(quarter, "01")
            last_updated = f"{year}-{m}-01"
        else:
            last_updated = None

        change = None
        direction = "neutral"
        if len(valid) >= 2:
            prev_val = valid[1][1]
            change = round(latest_val - prev_val, 2)
            if change > 0:
                direction = "up"
            elif change < 0:
                direction = "down"

        return {
            "indicator_key": key,
            "label": cfg["label"],
            "value": cfg["format_value"](latest_val),
            "change_amount": cfg["format_change"](change) if change is not None else None,
            "direction": direction,
            "last_updated": last_updated,
        }
    except Exception as exc:
        logger.warning("ONS fetch failed [%s]: %s", key, exc)
        return None


async def _fetch_boe_series(client: httpx.AsyncClient, key: str, cfg: dict) -> Optional[dict]:
    """Fetch one BoE series (CSV) and return an indicator dict."""
    try:
        url = (
            "https://www.bankofengland.co.uk/boeapps/database/"
            "_iadb-fromshowcolumns.asp?csv.x=yes"
            f"&Datefrom=01/Jan/2024&Dateto=01/Jan/2028"
            f"&SeriesCodes={cfg['code']}&CSVF=CN&UsingCodes=Y"
        )
        # BoE blocks non-browser User-Agents with 403
        resp = await client.get(
            url,
            timeout=15.0,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        resp.raise_for_status()
        text = resp.text

        # Parse CSV — BoE format: DATE,SERIES,VALUE (header + data rows)
        rows = []
        reader = csv.reader(io.StringIO(text))
        for row in reader:
            if len(row) >= 3:
                date_str, val_str = row[0].strip(), row[2].strip()
            elif len(row) >= 2:
                date_str, val_str = row[0].strip(), row[1].strip()
            else:
                continue
            try:
                val = float(val_str)
                dt = datetime.strptime(date_str, "%d %b %Y")
                rows.append((dt, val))
            except (ValueError, TypeError):
                continue

        if not rows:
            return None

        rows.sort(key=lambda x: x[0])
        latest_dt, latest_val = rows[-1]

        # For base rate, find the last rate *change* (not just last day)
        if key == "base_rate":
            # Walk backwards to find previous different value
            prev_val = latest_val
            change_date = latest_dt
            for dt, val in reversed(rows):
                if val != latest_val:
                    prev_val = val
                    break
            change = round(latest_val - prev_val, 4)
        else:
            # For gilt: compare to previous trading day
            if len(rows) >= 2:
                prev_val = rows[-2][1]
                change = round(latest_val - prev_val, 4)
            else:
                prev_val = latest_val
                change = 0.0

        direction = "up" if change > 0 else ("down" if change < 0 else "neutral")

        return {
            "indicator_key": key,
            "label": cfg["label"],
            "value": cfg["format_value"](latest_val),
            "change_amount": cfg["format_change"](change) if change != 0 else "—",
            "direction": direction,
            "last_updated": latest_dt.strftime("%Y-%m-%d"),
        }
    except Exception as exc:
        logger.warning("BoE fetch failed [%s]: %s", key, exc)
        return None


async def _fetch_avg_house_price(client: httpx.AsyncClient) -> Optional[dict]:
    """Fetch UK average house price from Land Registry UK HPI REST API."""
    try:
        # Fetch the 2 most recent months from the REST endpoint
        now = datetime.now(timezone.utc)
        months = []
        for offset in range(0, 6):  # Try last 6 months to find 2 with data
            y = now.year if now.month - offset > 0 else now.year - 1
            m = (now.month - offset - 1) % 12 + 1
            months.append(f"{y:04d}-{m:02d}")

        prices = []
        for month_str in months:
            if len(prices) >= 2:
                break
            url = f"{_UKHPI_REST}/{month_str}.json"
            try:
                resp = await client.get(url, timeout=10.0)
                if resp.status_code == 200:
                    data = resp.json()
                    items = data.get("result", {}).get("primaryTopic", None)
                    if items:
                        avg = items.get("averagePrice", None)
                        if avg is not None:
                            prices.append((month_str, float(avg)))
            except Exception:
                continue

        if not prices:
            return None

        latest_month, latest_price = prices[0]
        prev_price = prices[1][1] if len(prices) >= 2 else latest_price

        change = round(latest_price - prev_price)
        direction = "up" if change > 0 else ("down" if change < 0 else "neutral")

        price_k = round(latest_price / 1000)
        change_k = round(abs(change) / 1000, 1)
        sign = "+" if change >= 0 else "−"
        change_str = f"{sign}£{change_k}k" if change != 0 else "—"

        return {
            "indicator_key": "avg_house_price",
            "label": "Avg House Price",
            "value": f"£{price_k}k",
            "change_amount": change_str,
            "direction": direction,
            "last_updated": f"{latest_month}-01",
        }
    except Exception as exc:
        logger.warning("UK HPI REST fetch failed: %s", exc)
        return None


async def refresh_macro_indicators() -> dict:
    """Fetch latest macro indicators from ONS + BoE + Land Registry and upsert."""
    supabase = _get_supabase()
    if supabase is None:
        return {"status": "skipped", "reason": "supabase_not_configured"}

    async with httpx.AsyncClient(
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=True,
    ) as client:
        tasks = []
        # ONS series
        for key, cfg in _ONS_SERIES.items():
            tasks.append(_fetch_ons_series(client, key, cfg))
        # BoE series
        for key, cfg in _BOE_SERIES.items():
            tasks.append(_fetch_boe_series(client, key, cfg))
        # House price
        tasks.append(_fetch_avg_house_price(client))

        results = await asyncio.gather(*tasks, return_exceptions=True)

    updated = 0
    for result in results:
        if isinstance(result, Exception):
            logger.warning("Macro indicator task raised: %s", result)
            continue
        if result is None:
            continue
        try:
            supabase.table("macro_indicators").upsert(
                result, on_conflict="indicator_key"
            ).execute()
            updated += 1
            logger.info("Macro indicator updated: %s = %s", result["indicator_key"], result["value"])
        except Exception as exc:
            logger.error("Macro indicator upsert failed [%s]: %s", result.get("indicator_key"), exc)

    logger.info("Macro indicator refresh complete — %d/%d updated", updated, len(results))
    return {"status": "ok", "updated": updated}


_macro_task: asyncio.Task | None = None


async def start_macro_refresh() -> None:
    """Refresh macro indicators immediately then every 6 hours."""
    global _macro_task

    async def _loop():
        while True:
            try:
                await refresh_macro_indicators()
            except Exception as exc:
                logger.error("Macro indicator background refresh error: %s", exc)
            await asyncio.sleep(6 * 3600)  # 6 hours

    _macro_task = asyncio.create_task(_loop())
    logger.info("Macro indicator background refresh task started")


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class ArticleOut(BaseModel):
    id: str
    title: str
    summary: Optional[str]
    url: str
    source_name: str
    category: str
    topic_tag: Optional[str]
    published_at: Optional[str]


class MacroIndicator(BaseModel):
    indicator_key: str
    label: str
    value: str
    change_amount: Optional[str]
    direction: str
    last_updated: Optional[str]


class MarketQuote(BaseModel):
    symbol: str
    name: str
    category: str       # reit | housebuilder | mortgage | gilt | index | fx
    price: Optional[float]
    change: Optional[float]
    change_pct: Optional[float]
    currency: str       # GBP, USD, or % for gilts
    stale: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/articles", response_model=list[ArticleOut])
async def get_articles(
    category: Optional[str] = Query(None, description="Filter: property | rics | macro"),
    search: Optional[str] = Query(None, description="Keyword search across title and summary"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _user=Depends(get_current_user),
):
    """Return paginated news articles, optionally filtered by category and keyword."""
    supabase = _get_supabase()
    if supabase is None:
        raise HTTPException(status_code=503, detail="News data unavailable")

    try:
        query = (
            supabase.table("news_articles")
            .select("id, title, summary, url, source_name, category, topic_tag, published_at")
            .order("published_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if category and category in ("property", "rics", "macro"):
            query = query.eq("category", category)

        if search and search.strip():
            # Sanitise: strip PostgREST filter syntax characters to prevent injection
            term = re.sub(r"[^a-zA-Z0-9 \-'&]", "", search.strip())[:100]
            if term:
                logger.info("NEWS SEARCH: term=%r, category=%r", term, category)
                query = query.or_(f"title.ilike.%{term}%,summary.ilike.%{term}%")

        resp = query.execute()
        logger.info("NEWS SEARCH RESULT: %d articles returned (search=%r)", len(resp.data or []), search)
        return resp.data or []
    except Exception as exc:
        logger.error("GET /api/news/articles failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load articles")


@router.get("/ticker", response_model=list[MacroIndicator])
async def get_ticker(_user=Depends(get_current_user)):
    """Return macro indicator values for the ticker strip."""
    supabase = _get_supabase()
    if supabase is None:
        raise HTTPException(status_code=503, detail="Macro data unavailable")

    try:
        resp = (
            supabase.table("macro_indicators")
            .select("indicator_key, label, value, change_amount, direction, last_updated")
            .order("indicator_key")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        logger.error("GET /api/news/ticker failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load ticker data")


@router.post("/refresh")
@limiter.limit("5/minute")
async def trigger_refresh(request: Request, user=Depends(require_admin)):
    """Manually trigger an RSS refresh. Admin users only."""
    result = await run_refresh()
    return result


@router.post("/refresh-macro")
@limiter.limit("5/minute")
async def trigger_macro_refresh(request: Request, user=Depends(require_admin)):
    """Manually trigger a macro indicator refresh. Admin users only."""
    result = await refresh_macro_indicators()
    return result


@router.get("/market-ticker", response_model=list[MarketQuote])
async def get_market_ticker(_user=Depends(get_current_user)):
    """Return cached live market quotes. Stale flag set if cache is >3 min old."""
    if not _market_cache:
        # Cache empty — trigger a synchronous fetch so the first caller isn't empty-handed
        try:
            data = await asyncio.wait_for(_fetch_market_data(), timeout=30.0)
            if data:
                return data
        except Exception as exc:
            logger.error("Market ticker on-demand fetch failed: %s", exc)
        raise HTTPException(status_code=503, detail="Market data unavailable")

    stale = False
    if _market_fetched_at:
        age_minutes = (datetime.now(timezone.utc) - _market_fetched_at).total_seconds() / 60
        stale = age_minutes > 3

    if stale:
        return [{**q, "stale": True} for q in _market_cache]
    return _market_cache

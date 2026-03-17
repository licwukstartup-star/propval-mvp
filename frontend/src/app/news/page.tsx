"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Article {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source_name: string;
  category: "property" | "rics" | "macro";
  topic_tag: string | null;
  published_at: string | null;
}

interface MacroIndicator {
  indicator_key: string;
  label: string;
  value: string;
  change_amount: string | null;
  direction: "up" | "down" | "neutral";
  last_updated: string | null;
}

interface MarketQuote {
  symbol: string;
  name: string;
  category: string; // reit | housebuilder | mortgage | gilt | index | fx | proptech
  price: number | null;
  change: number | null;
  change_pct: number | null;
  currency: string; // GBp | USD | %
  stale: boolean;
}

type CategoryFilter = "all" | "property" | "rics" | "macro";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const CATEGORY_CONFIG = {
  property: { label: "PROPERTY", colour: "var(--color-accent)", bg: "color-mix(in srgb, var(--color-accent) 9%, transparent)" },
  rics: { label: "RICS", colour: "#8b5cf6", bg: "#8b5cf618" },
  macro: { label: "MACRO", colour: "#ffaa00", bg: "#ffaa0018" },
} as const;

const FILTER_TABS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "property", label: "Property Market" },
  { key: "rics", label: "RICS / Regulatory" },
  { key: "macro", label: "Macro / Economic" },
];

// Market category colours
const MARKET_CAT_COLOUR: Record<string, string> = {
  reit:         "var(--color-accent)",
  housebuilder: "var(--color-status-success)",
  mortgage:     "var(--color-accent-pink)",
  gilt:         "var(--color-status-warning)",
  index:        "var(--color-accent-purple)",
  fx:           "#ff8800",
  proptech:     "var(--color-accent)",
};

function formatMarketPrice(price: number | null, currency: string): string {
  if (price === null) return "—";
  if (currency === "%") return `${price.toFixed(2)}%`;
  if (currency === "USD") return `$${price.toFixed(4)}`;
  // GBp (pence) — show as pence if < 100000, else as points for index
  if (price > 10000) return price.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  return `${price.toFixed(1)}p`;
}

function formatMarketChange(change: number | null, change_pct: number | null, currency: string): string {
  if (change === null || change_pct === null) return "";
  const sign = change >= 0 ? "+" : "";
  if (currency === "%") return `${sign}${change.toFixed(3)}%`;
  if (currency === "USD") return `${sign}${change.toFixed(4)} (${sign}${change_pct.toFixed(2)}%)`;
  // GBp
  const absChange = Math.abs(change);
  const unit = absChange > 100 ? "" : "p";
  return `${sign}${change.toFixed(absChange > 100 ? 0 : 1)}${unit} (${sign}${change_pct.toFixed(2)}%)`;
}

// ---------------------------------------------------------------------------
// Live market ticker (Bloomberg-style scrolling tape)
// ---------------------------------------------------------------------------

function LiveMarketTicker({ quotes }: { quotes: MarketQuote[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  if (quotes.length === 0) return null;

  // Build display items — duplicate for seamless loop
  const items = [...quotes, ...quotes];

  return (
    <div
      className="rounded-xl mb-3 overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-base)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 0 24px color-mix(in srgb, var(--color-accent) 3%, transparent)",
        position: "relative",
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Left / right fade masks */}
      <div
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 40, zIndex: 10,
          background: "linear-gradient(to right, var(--color-bg-base), transparent)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 40, zIndex: 10,
          background: "linear-gradient(to left, var(--color-bg-base), transparent)",
          pointerEvents: "none",
        }}
      />

      {/* Scrolling tape */}
      <div
        ref={containerRef}
        className="flex items-stretch"
        style={{
          animationName: "market-ticker-scroll",
          animationDuration: `${quotes.length * 4}s`,
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationPlayState: paused ? "paused" : "running",
          width: "max-content",
        }}
      >
        {items.map((q, idx) => {
          const colour = MARKET_CAT_COLOUR[q.category] ?? "var(--color-text-secondary)";
          const isPositive = (q.change ?? 0) > 0;
          const isNegative = (q.change ?? 0) < 0;
          const changeColour = isPositive ? "var(--color-status-success)" : isNegative ? "var(--color-status-danger)" : "var(--color-text-secondary)";
          const arrow = isPositive ? "▲" : isNegative ? "▼" : "—";
          const priceStr = formatMarketPrice(q.price, q.currency);
          const changeStr = formatMarketChange(q.change, q.change_pct, q.currency);

          return (
            <div
              key={`${q.symbol}-${idx}`}
              className="flex items-center gap-2 px-4 py-2.5 shrink-0"
              style={{ borderRight: "1px solid var(--color-border)" }}
            >
              {/* Category dot */}
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: colour }}
              />

              {/* Name */}
              <span
                className="text-xs font-semibold shrink-0"
                style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-mono)" }}
              >
                {q.name}
              </span>

              {/* Price */}
              <span
                className="text-xs font-bold shrink-0"
                style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}
              >
                {priceStr}
              </span>

              {/* Change */}
              {changeStr && (
                <span
                  className="text-xs font-medium shrink-0"
                  style={{ color: changeColour, fontFamily: "var(--font-mono)" }}
                >
                  {arrow} {changeStr}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Keyframe injection */}
      <style>{`
        @keyframes market-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function LiveTickerSkeleton() {
  return (
    <div
      className="rounded-xl mb-3 overflow-hidden animate-pulse"
      style={{ backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-border)", height: 44 }}
    >
      <div className="flex items-center gap-4 px-4 h-full">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-border)" }} />
            <div className="h-3 w-20 rounded" style={{ backgroundColor: "var(--color-border)" }} />
            <div className="h-3 w-12 rounded" style={{ backgroundColor: "var(--color-border)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static macro ticker strip item
// ---------------------------------------------------------------------------

function TickerItem({ indicator }: { indicator: MacroIndicator }) {
  const arrowColour =
    indicator.direction === "up" ? "var(--color-status-success)" :
    indicator.direction === "down" ? "var(--color-status-danger)" : "var(--color-text-secondary)";
  const arrowSymbol =
    indicator.direction === "up" ? "▲" :
    indicator.direction === "down" ? "▼" : "—";

  return (
    <div
      className="flex flex-col gap-0.5 px-5 py-2 shrink-0"
      style={{ borderRight: "1px solid var(--color-border)" }}
    >
      <span className="text-xs uppercase tracking-widest" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
        {indicator.label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-base font-bold" style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
          {indicator.value}
        </span>
        {indicator.change_amount && (
          <span className="text-xs font-semibold" style={{ color: arrowColour, fontFamily: "var(--font-mono)" }}>
            {arrowSymbol} {indicator.change_amount}
          </span>
        )}
      </div>
      {indicator.last_updated && (
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {new Date(indicator.last_updated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// News card
// ---------------------------------------------------------------------------

function NewsCard({ article }: { article: Article }) {
  const cat = CATEGORY_CONFIG[article.category];
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="block rounded-xl p-5 transition-all duration-200"
      style={{
        backgroundColor: "var(--color-bg-panel)",
        borderTop: `3px solid ${cat.colour}`,
        borderRight: `1px solid ${hovered ? cat.colour + "66" : "var(--color-border)"}`,
        borderBottom: `1px solid ${hovered ? cat.colour + "66" : "var(--color-border)"}`,
        borderLeft: `1px solid ${hovered ? cat.colour + "66" : "var(--color-border)"}`,
        boxShadow: hovered ? `0 0 12px ${cat.colour}22, 0 2px 16px #00000040` : "0 2px 8px #00000030",
        transform: hovered ? "translateY(-1px)" : "none",
        textDecoration: "none",
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded"
          style={{
            color: cat.colour,
            backgroundColor: cat.bg,
            border: `1px solid ${cat.colour}44`,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
          }}
        >
          {cat.label}
        </span>

        {article.topic_tag && (
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              color: "var(--color-text-secondary)",
              backgroundColor: "var(--color-border)",
              border: "1px solid var(--color-border)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {article.topic_tag}
          </span>
        )}

        <span className="ml-auto text-xs" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
          {relativeTime(article.published_at)}
        </span>
      </div>

      <h3
        className="text-sm font-semibold leading-snug mb-2 transition-colors duration-200"
        style={{ color: hovered ? cat.colour : "var(--color-text-primary)" }}
      >
        {article.title}
      </h3>

      {article.summary && (
        <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--color-text-secondary)" }}>
          {article.summary.length > 180 ? article.summary.slice(0, 180) + "…" : article.summary}
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: cat.colour }}
        />
        <span className="text-xs" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
          {article.source_name}
        </span>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function TickerSkeleton() {
  return (
    <div className="flex items-center gap-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-1 px-5 py-2 shrink-0 animate-pulse"
          style={{ borderRight: "1px solid var(--color-border)" }}
        >
          <div className="h-2 w-16 rounded" style={{ backgroundColor: "var(--color-border)" }} />
          <div className="h-4 w-12 rounded" style={{ backgroundColor: "var(--color-border)" }} />
          <div className="h-2 w-10 rounded" style={{ backgroundColor: "var(--color-border)" }} />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div
      className="rounded-xl p-5 animate-pulse"
      style={{ backgroundColor: "var(--color-bg-panel)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex gap-2 mb-3">
        <div className="h-5 w-16 rounded" style={{ backgroundColor: "var(--color-border)" }} />
        <div className="h-5 w-20 rounded" style={{ backgroundColor: "var(--color-border)" }} />
      </div>
      <div className="h-4 w-full rounded mb-1" style={{ backgroundColor: "var(--color-border)" }} />
      <div className="h-4 w-3/4 rounded mb-3" style={{ backgroundColor: "var(--color-border)" }} />
      <div className="h-3 w-full rounded mb-1" style={{ backgroundColor: "var(--color-border)" }} />
      <div className="h-3 w-2/3 rounded mb-3" style={{ backgroundColor: "var(--color-border)" }} />
      <div className="h-3 w-24 rounded" style={{ backgroundColor: "var(--color-border)" }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewsPage() {
  const { user, session } = useAuth();
  const router = useRouter();

  const [articles, setArticles] = useState<Article[]>([]);
  const [ticker, setTicker] = useState<MacroIndicator[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<MarketQuote[]>([]);
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [loadingTicker, setLoadingTicker] = useState(true);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect unauthenticated users
  useEffect(() => {
    if (user === null) router.push("/login");
  }, [user, router]);

  const authHeaders = useCallback((): HeadersInit => ({
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }), [session]);

  // Derive filtered articles from search input (client-side, instant)
  const searchLower = searchInput.trim().toLowerCase();
  const filteredArticles = searchLower
    ? articles.filter(a =>
        a.title.toLowerCase().includes(searchLower) ||
        (a.summary && a.summary.toLowerCase().includes(searchLower))
      )
    : articles;

  // Fetch static macro ticker on mount
  useEffect(() => {
    if (!session) return;
    fetch(`${API_BASE}/api/news/ticker`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setTicker)
      .catch(() => {/* non-critical */})
      .finally(() => setLoadingTicker(false));
  }, [session, authHeaders]);

  // Fetch live market quotes on mount + refresh every 15 minutes
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const fetchMarket = () => {
      fetch(`${API_BASE}/api/news/market-ticker`, { headers: authHeaders() })
        .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
        .then((data: MarketQuote[]) => {
          if (!cancelled) {
            // Only update state if prices changed — prevents animation restart on identical data
            setMarketQuotes(prev => {
              const changed =
                prev.length !== data.length ||
                data.some((q, i) => q.price !== prev[i]?.price || q.change_pct !== prev[i]?.change_pct);
              return changed ? data : prev;
            });
          }
        })
        .catch(() => {/* non-critical — ticker is decorative */})
        .finally(() => { if (!cancelled) setLoadingMarket(false); });
    };

    fetchMarket();
    const interval = setInterval(fetchMarket, 30 * 1000); // 30s — backend cache refreshes every 2 min
    return () => { cancelled = true; clearInterval(interval); };
  }, [session, authHeaders]);

  // Fetch articles when category filter changes
  useEffect(() => {
    if (!session) return;
    setLoadingArticles(true);
    setError(null);
    const params = new URLSearchParams({ limit: "100", offset: "0" });
    if (activeFilter !== "all") params.set("category", activeFilter);

    fetch(`${API_BASE}/api/news/articles?${params}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setArticles)
      .catch(() => setError("Could not load articles. The news feed may be refreshing — try again in a moment."))
      .finally(() => setLoadingArticles(false));
  }, [session, activeFilter, authHeaders]);

  if (!user) return null;

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        height: "calc(100vh - 53px)",
        background: "linear-gradient(180deg, var(--color-bg-base) 0%, var(--color-bg-base) 100%)",
        color: "var(--color-text-primary)",
      }}
    >
      {/* ════════════════════════════════════════════════════════
          FROZEN PANEL — header · live ticker · macro · filters
          ════════════════════════════════════════════════════════ */}
      <div
        className="shrink-0"
        style={{
          backgroundColor: "var(--color-bg-base)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 pt-7 pb-3">

          {/* ── Section header ── */}
          <div className="flex items-center gap-3 mb-4">
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: "var(--color-btn-primary-bg)" }}
              />
              <span
                className="relative inline-flex rounded-full h-2.5 w-2.5"
                style={{ backgroundColor: "var(--color-btn-primary-bg)" }}
              />
            </span>
            <h1
              className="text-sm font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--color-accent)", fontFamily: "var(--font-mono)" }}
            >
              Market Intelligence
            </h1>
            <span
              className="ml-auto text-xs px-2 py-0.5 rounded"
              style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", border: "1px solid var(--color-border)" }}
            >
              LIVE · ~15-min data delay
            </span>
          </div>

          {/* ── Live market ticker tape ── */}
          {loadingMarket ? (
            <LiveTickerSkeleton />
          ) : (
            <LiveMarketTicker quotes={marketQuotes} />
          )}

          {/* ── Macro indicators strip (auto-refreshed every 6h) ── */}
          <div
            className="rounded-xl mb-4 overflow-x-auto"
            style={{
              backgroundColor: "var(--color-bg-panel)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 0 20px color-mix(in srgb, var(--color-accent) 4%, transparent)",
            }}
          >
            {loadingTicker ? (
              <TickerSkeleton />
            ) : ticker.length > 0 ? (
              <div className="flex">
                {ticker.map(ind => <TickerItem key={ind.indicator_key} indicator={ind} />)}
              </div>
            ) : (
              <div className="px-5 py-3 text-xs" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                Macro indicators unavailable
              </div>
            )}
          </div>

          {/* ── Search bar + Filter tabs ── */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1 max-w-md">
              {/* Search icon */}
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search headlines…"
                className="w-full rounded-lg text-xs py-2 pl-9 pr-8 outline-none transition-all duration-200 focus:ring-1"
                style={{
                  backgroundColor: "var(--color-bg-panel)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                  fontFamily: "var(--font-mono)",
                  caretColor: "var(--color-accent)",
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--color-accent) 33%, transparent)";
                  e.currentTarget.style.boxShadow = "0 0 8px color-mix(in srgb, var(--color-accent) 13%, transparent)";
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = "var(--color-border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              {/* Clear button */}
              {searchInput && (
                <button
                  onClick={() => setSearchInput("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs leading-none"
                  style={{ color: "var(--color-text-muted)" }}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-1 flex-wrap">
            {FILTER_TABS.map(tab => {
              const isActive = activeFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveFilter(tab.key)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                  style={{
                    backgroundColor: isActive ? "color-mix(in srgb, var(--color-accent) 13%, transparent)" : "transparent",
                    color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                    border: `1px solid ${isActive ? "color-mix(in srgb, var(--color-accent) 33%, transparent)" : "var(--color-border)"}`,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.05em",
                  }}
                >
                  {tab.label}
                  {tab.key !== "all" && (
                    <span
                      className="ml-1.5 text-xs"
                      style={{
                        color: tab.key === "property" ? "color-mix(in srgb, var(--color-accent) 60%, transparent)" :
                               tab.key === "rics" ? "#8b5cf699" : "#ffaa0099",
                      }}
                    >
                      ●
                    </span>
                  )}
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          SCROLLABLE PANEL — news cards · attribution footer
          ════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 pt-6 pb-8">

          {/* ── Search result count ── */}
          {searchLower && !loadingArticles && !error && (
            <p
              className="text-xs mb-3"
              style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}
            >
              {filteredArticles.length === 0
                ? "0 results"
                : `${filteredArticles.length} result${filteredArticles.length === 1 ? "" : "s"} for "${searchInput.trim()}"`}
            </p>
          )}

          {/* ── News card grid ── */}
          {error ? (
            <div
              className="rounded-xl p-6 text-center"
              style={{ backgroundColor: "var(--color-bg-panel)", border: "1px solid color-mix(in srgb, var(--color-status-danger) 20%, transparent)" }}
            >
              <p className="text-sm" style={{ color: "var(--color-status-danger)" }}>{error}</p>
            </div>
          ) : loadingArticles ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 9 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : filteredArticles.length === 0 ? (
            <div
              className="rounded-xl p-10 text-center"
              style={{ backgroundColor: "var(--color-bg-panel)", border: "1px solid var(--color-border)" }}
            >
              {searchLower ? (
                <>
                  <p className="text-sm mb-1" style={{ color: "var(--color-accent)", fontFamily: "var(--font-mono)" }}>
                    No results for &ldquo;{searchInput.trim()}&rdquo;
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Try a different keyword or clear the search to see all articles.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm mb-1" style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                    No articles found
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    The feed refreshes twice daily. Check back later or trigger a manual refresh.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredArticles.map(article => <NewsCard key={article.id} article={article} />)}
            </div>
          )}

          {/* ── Source attribution footer ── */}
          <div
            className="mt-10 rounded-xl p-5"
            style={{ backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-3"
              style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}
            >
              News Sources — Auto-refreshed every 12 hours
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
              {[
                { name: "Bank of England", cat: "macro" as const },
                { name: "Property Industry Eye", cat: "property" as const },
                { name: "Rightmove News", cat: "property" as const },
                { name: "FCA News", cat: "rics" as const },
                { name: "Google News: UK Property", cat: "property" as const },
                { name: "Google News: House Prices", cat: "property" as const },
                { name: "Google News: BoE Rates", cat: "macro" as const },
                { name: "Google News: UK Mortgages", cat: "macro" as const },
                { name: "Google News: RICS", cat: "rics" as const },
                { name: "Estate Agent Today", cat: "property" as const },
                { name: "The Negotiator", cat: "property" as const },
                { name: "PropertyWire", cat: "property" as const },
                { name: "BBC Economy", cat: "macro" as const },
                { name: "Bank Underground", cat: "macro" as const },
                { name: "House of Commons Library", cat: "macro" as const },
                { name: "GOV.UK MHCLG", cat: "rics" as const },
                { name: "Valuation Office Agency", cat: "rics" as const },
                { name: "HM Land Registry", cat: "rics" as const },
                { name: "Homes England", cat: "property" as const },
                { name: "Planning Inspectorate", cat: "rics" as const },
              ].map(s => (
                <div key={s.name} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: CATEGORY_CONFIG[s.cat].colour }}
                  />
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{s.name}</span>
                </div>
              ))}
            </div>
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}
            >
              Market Data — via Yahoo Finance · ~15-min delay · LSE prices in pence · Data refreshes every 2 min
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {[
                { label: "REITs", colour: "var(--color-accent)" },
                { label: "Housebuilders", colour: "var(--color-status-success)" },
                { label: "Mortgage Lenders", colour: "var(--color-accent-pink)" },
                { label: "Gilt ETFs", colour: "var(--color-status-warning)" },
                { label: "FTSE 100 Index", colour: "var(--color-accent-purple)" },
                { label: "GBP/USD FX", colour: "#ff8800" },
              ].map(g => (
                <div key={g.label} className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.colour }} />
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{g.label}</span>
                </div>
              ))}
            </div>
            <p
              className="text-xs font-semibold uppercase tracking-widest mt-4 mb-2"
              style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}
            >
              Economic Indicators — ONS · Bank of England · HM Land Registry · Auto-refreshed every 6 hours
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
              {[
                { label: "CPI / Unemployment / GDP", colour: "#ffaa00" },
                { label: "Base Rate / 10Y Gilt", colour: "var(--color-accent)" },
                { label: "Avg House Price", colour: "var(--color-status-success)" },
              ].map(g => (
                <div key={g.label} className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.colour }} />
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{g.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-4" style={{ color: "var(--color-text-muted)" }}>
              GOV.UK sources (VOA, Land Registry, Homes England, Planning Inspectorate, MHCLG) contain public sector information licensed under the{" "}
              <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-muted)", textDecoration: "underline" }}>
                Open Government Licence v3.0
              </a>.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

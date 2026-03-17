# PropVal — News & Market Intelligence Page

> **Document type:** Combined spec — source selection + frontend design reference
> **Location in PropVal:** Dedicated page, positioned below the main search bar on the front page
> **Status:** Source selection in progress

---

## Part 1: Page Design

### Layout Overview

The page sits below the PropVal search bar ("Enter a UK postcode and select the address") and contains:

1. **Section divider** — "Market Intelligence" label with pulsing cyan dot
2. **Macro economic ticker strip** — horizontal row of key indicators with directional arrows
3. **Category filter tabs** — All / Property Market / RICS-Regulatory / Macro-Economic
4. **News card feed** — chronological, colour-coded by category
5. **Source attribution footer** — lists active sources + refresh cadence

### Design Language

| Element | Value |
|---------|-------|
| Background | Void Black `#0a0a0f` → Deep Void `#0d0d14` gradient |
| Panel BG | `#12121c` |
| Panel Border | `#1a1a2e` |
| Electric Cyan (primary accent) | `#00f0ff` |
| Magenta Pulse | `#ff00aa` |
| Void Purple | `#8b5cf6` |
| Text Primary | `#e0e0f0` |
| Text Secondary | `#8888aa` |
| Text Muted | `#555570` |
| Up indicator | `#00ff88` |
| Down indicator | `#ff4466` |
| Neutral/Warning | `#ffaa00` |
| Heading font | JetBrains Mono |
| Body font | IBM Plex Sans |
| Mono/data font | JetBrains Mono |

### Category Colour Coding

| Category | Colour | Badge Label |
|----------|--------|-------------|
| Property Market | Electric Cyan `#00f0ff` | PROPERTY |
| RICS / Regulatory | Void Purple `#8b5cf6` | RICS |
| Macro / Economic | Amber `#ffaa00` | MACRO |

### Macro Ticker Indicators

| Indicator | Example Value | Source |
|-----------|--------------|--------|
| Base Rate | 4.25% | Bank of England |
| CPI | 2.6% | ONS |
| Avg House Price | £298k | ONS / HMLR |
| GDP Growth | 0.3% | ONS |
| 10Y Gilt | 4.48% | Trading Economics / Investing.com |
| Unemployment | 4.1% | ONS |

Each indicator shows: label, value, directional arrow (▲/▼/—), change amount, and last-updated date.

### News Card Structure

Each card displays:
- Category badge (colour-coded)
- Topic tag (e.g. "Red Book", "Residential", "Interest Rates", "HPI")
- Relative timestamp (e.g. "4h ago", "Yesterday", "3d ago")
- Headline (title)
- Summary (1-2 sentences from RSS)
- Source name with colour dot

Cards link out to the original article. Hover state: subtle cyan border glow, title turns cyan, card lifts 1px.

### Prototype

The working React prototype is in `news-page.jsx` (cyberpunk design, static mock data). It renders all the above components and can be dropped into the Next.js app as a page component.

---

## Part 2: Free News Sources

### 2.1 UK Property Market News

| # | Source | RSS Feed URL | Content Focus | Free? | Notes |
|---|--------|-------------|---------------|-------|-------|
| 1 | **Property Week** | `propertyweek.com/rss-feeds` (multiple feeds by sector/region) | Commercial & residential deals, development, investment | Yes (RSS) | Industry standard. May paywall full articles but RSS headlines + summaries are free. Regional feeds available (e.g. `/regions/london`). |
| 2 | **Rightmove News** | `rightmove.co.uk/news/feed` | Housing market trends, buyer/seller advice, market data | Yes | UK's largest portal. Consumer-facing but includes useful market commentary. |
| 3 | **Property Industry Eye** | `propertyindustryeye.com/feed` | Breaking residential property news | Yes | Independent, unbiased reporting. Good for agency/market news. |
| 4 | **PropertyWire** | `propertywire.com/feed` | UK & global residential and commercial news | Yes | Covers both sectors. Good for investment angle. |
| 5 | **Savills Blog/Research** | `savills.co.uk` (RSS feeds page) | Research reports, market forecasts, sector analysis | Yes (RSS) | High-quality institutional research. Multiple feeds available. |
| 6 | **Knight Frank Blog** | `knightfrank.co.uk` (blog feed) | Prime market, rural, commercial insights | Yes | Strong on prime/PCL residential and rural. |
| 7 | **OnTheMarket Blog** | `onthemarket.com` (blog feed) | Buying, selling, renting advice + market insight | Yes | Consumer-facing. |
| 8 | **FT Property Sector** | `ft.com/property-sector?format=rss` | Property sector news and analysis | Partial | FT paywalls most content. RSS gives headline + snippet only. May not be worth including if users can't read articles. |
| 9 | **LandlordZONE** | `landlordzone.co.uk` (RSS) | Landlord/tenant law, letting market, regulation | Yes | Good for PRS/BTL angle. Strong on regulatory changes. |
| 10 | **PlanningResource** | `planningresource.co.uk/newsfeeds` | Planning policy, NPPF, housing land supply, appeals | Yes (RSS) | Excellent for planning/development context. Housing-specific feed available. |
| 11 | **Foxtons News** | `foxtons.co.uk` (feed) | London market updates | Yes | London-centric. |
| 12 | **Winkworth Blog** | `winkworth.co.uk` (feed) | Market commentary, area guides | Yes | Residential focus. |

### 2.2 RICS / Regulatory

| # | Source | RSS Feed URL | Content Focus | Free? | Notes |
|---|--------|-------------|---------------|-------|-------|
| 1 | **RICS News & Insights** | `rics.org/en/rss` or `rics.org/news-insights` | Standards updates, market surveys (UK Residential, Commercial), CPD, policy | Yes (RSS) | **Essential.** Publishes UK Residential Market Survey, Red Book updates, CPD framework changes. The single most relevant source for MRICS surveyors. |
| 2 | **RICS isurv News** | `isurv.com` (isurv news RSS + standards portal RSS) | Technical guidance, standards portal updates | Partial | isurv is subscription-based but the RSS news feed appears accessible. Two feeds: general news + standards portal. Worth testing access. |
| 3 | **GOV.UK — MHCLG** | `govwire.co.uk/rss/ministry-of-housing-communities-and-local-government` | Housing policy, planning reform, building safety | Yes | Covers NPPF changes, building regs, housing delivery. Via GovWire aggregator. |
| 4 | **GOV.UK — HM Land Registry** | `gov.uk/government/collections/uk-house-price-index-reports` (Atom feed) | UK HPI monthly releases | Yes | Official HPI data releases. Monthly cadence. |
| 5 | **UK Parliament — Housing & Planning** | `parliament.uk/business/news/housing-and-planning/` | Select committee reports, legislation, debates | Yes | Covers Housing Committee inquiries, Renters Reform, Leasehold Reform etc. |
| 6 | **London City Hall** | `london.gov.uk/rss-feeds` | London housing/planning publications, GLA policy | Yes | Multiple feeds: housing, planning, environment. London-specific. |
| 7 | **Bank Underground** | `bankunderground.co.uk` (RSS) | BoE staff blog — housing market, CRE, financial stability | Yes | High-quality analytical pieces. Posts on house prices, CRE ownership, mortgage markets. |

### 2.3 Macro / Economic Indicators

| # | Source | RSS Feed URL | Content Focus | Free? | Notes |
|---|--------|-------------|---------------|-------|-------|
| 1 | **Bank of England — News** | `bankofengland.co.uk/rss/news` | MPC decisions, speeches, financial stability reports | Yes | **Essential.** Base rate decisions, inflation reports, financial stability. |
| 2 | **Bank of England — Statistics** | `bankofengland.co.uk/news/statistics` | Statistical releases (money & credit, mortgage lending) | Yes | Mortgage approvals, lending data, money supply. Monthly. |
| 3 | **Bank of England — Publications** | `bankofengland.co.uk/news/publications` | Monetary Policy Reports, Financial Stability Reports | Yes | Quarterly big-picture publications. |
| 4 | **ONS — Inflation & Price Indices** | `ons.gov.uk/economy/inflationandpriceindices` (Atom) | CPI, CPIH, HPI, rental price index | Yes | Official UK inflation and house price data. HPI bulletin published monthly. |
| 5 | **ONS — Housing** | `ons.gov.uk/peoplepopulationandcommunity/housing` (Atom) | House prices, private rents, housing stock, affordability | Yes | Combined private rent & house price bulletin (monthly). Affordability ratios (annual). |
| 6 | **Trading Economics — UK** | `tradingeconomics.com/rss/` | RSS feeds for 20M indicators across 196 countries | Yes (RSS) | Free RSS feeds for UK economic indicators. API is paid but RSS is free. Good for automated macro ticker data. |
| 7 | **Investing.com UK** | `uk.investing.com/webmaster-tools/rss` | Markets, currencies, bonds, macro analysis | Yes (RSS) | Multiple feeds by asset class. Good for gilt yields, GBP, equities. |
| 8 | **House of Commons Library** | `commonslibrary.parliament.uk` (economic indicators briefings) | Monthly economic indicator summaries | Yes | Curated monthly summary covering HPI, base rate, CPI, GDP, unemployment. |
| 9 | **Marketaux** | `marketaux.com` | Finance/stock market news API (JSON) | Free tier | 100 requests/day free. Supplements RSS with structured financial news. |

---

## Part 3: Recommended Source Selection

### Tier 1 — Must Have

| Source | Category | Why |
|--------|----------|-----|
| RICS News & Insights | RICS/Regulatory | Core professional body. Market surveys, standards, CPD. |
| Bank of England — News | Macro | Base rate, monetary policy — direct impact on valuations. |
| ONS — Housing | Macro | Official HPI, rental index — primary valuation benchmarks. |
| Property Week | Property | Industry-standard trade press. |
| Rightmove News | Property | Market trends from UK's largest portal. |

### Tier 2 — High Value

| Source | Category | Why |
|--------|----------|-----|
| GOV.UK — MHCLG | RICS/Regulatory | NPPF changes, building safety, housing policy. |
| Bank Underground | Macro | BoE analytical pieces on housing/CRE. |
| Trading Economics UK RSS | Macro | Automated macro data for ticker strip. |
| PlanningResource | Property | Planning context for development valuations. |
| Property Industry Eye | Property | Fast-breaking residential news. |

### Tier 3 — Nice to Have

| Source | Category | Why |
|--------|----------|-----|
| Savills Research | Property | Institutional-grade market research. |
| LandlordZONE | Property | PRS regulatory changes. |
| House of Commons Library | Macro | Monthly curated economic summary. |
| Investing.com UK | Macro | Gilt yields, GBP data for ticker. |
| UK Parliament Housing | RICS/Regulatory | Legislation tracking. |

---

## Part 4: Technical Implementation Notes

| Item | Detail |
|------|--------|
| Backend | FastAPI + Python `feedparser` library |
| Database | Supabase table: `news_articles` (title, summary, url, source, category, tag, published_at) |
| Refresh | Twice daily (06:00, 18:00 UTC) via cron/scheduled task |
| Retention | Auto-delete articles older than 90 days |
| Storage impact | ~1-2KB per article. ~18,000 articles/year ≈ 20-30MB. Negligible. |
| Feed format | `feedparser` handles both RSS and Atom transparently |
| Macro ticker | Trading Economics RSS or ONS data for headline numbers. Cached separately. |
| Frontend | Next.js React component (`news-page.jsx`). Calls FastAPI endpoint. |
| Paywall note | Some sources (FT, isurv) may restrict full content. Test each feed URL before committing. |

---

## Decision Log

| Date | Decision | Notes |
|------|----------|-------|
| _TBD_ | _Selected sources from tiers_ | _Update after review_ |
| _TBD_ | _Refresh frequency confirmed_ | _Default: twice daily_ |
| _TBD_ | _Retention policy confirmed_ | _Default: 90 days_ |
| _TBD_ | _Macro ticker sources confirmed_ | _Default: Trading Economics RSS_ |

# CLAUDE.md — PropVal Project Brief

## Required Reading

Before starting ANY task, read the following project file:

- **`docs/PropVal_Claude_Code_Mandate_v1.0.md`** — Binding engineering standards, security policy, and performance requirements. All code must comply. No exceptions.

After reading, confirm: "I have read the mandate. Working on: [task description]."

---

## What Is PropVal?

PropVal is a SaaS platform for MRICS valuation surveyors. It automates property intelligence gathering and generates RICS-compliant residential valuation reports. The core workflow: a surveyor enters a postcode, selects an address, and the platform fetches data from 19+ free UK government APIs, assembles it into a structured property intelligence report, and stores everything against the property's UPRN for reuse.

PropVal is not a valuation tool — it is property intelligence infrastructure. Every interaction deposits data into a UPRN-anchored library that grows richer with every case.

---

## Current Stack

| Layer | Technology | Hosting | Local Dev |
|-------|-----------|---------|-----------|
| Frontend | Next.js (TypeScript + TailwindCSS) | Vercel | localhost:3000 |
| Backend | FastAPI (Python) | Render | localhost:8000 |
| Database | Supabase (PostgreSQL + PostGIS) | Supabase Cloud | Remote |
| Report Gen | Node.js + docx-js | Called from backend | Same |
| Version Control | Git + GitHub | — | — |

---

## Daily Dev Startup

Three terminals:

1. **Terminal 1 — Backend:** `cd backend && uvicorn main:app --reload --port 8000`
2. **Terminal 2 — Frontend:** `cd frontend && npm run dev`
3. **Terminal 3 — Claude Code:** Working terminal

---

## The UPRN Spine

UPRN (Unique Property Reference Number) is the universal anchor for ALL data in PropVal. Every API call, every database record, every cache entry must resolve to or associate with a UPRN. If UPRN resolution fails, the system degrades gracefully — it never blocks the user.

### Address Resolution Chain

```
User enters postcode
  → EPC API search (returns addresses with UPRNs)
  → Fuzzy match user's selected address to EPC result
    → CRITICAL: Prioritise flat/house numbers in matching
    → SAON = flat number (e.g., "Flat 4")
    → PAON = building number/name (e.g., "10 Marsh Wall")
  → Resolved UPRN becomes the key for all subsequent lookups
```

---

## Implemented Features

- Postcode search with EPC Open Data API integration
- Fuzzy address matching (prioritises flat/house numbers, SAON vs PAON)
- Land Registry sold price history (SPARQL)
- Flood risk section (Surface Water + Rivers & Sea via Environment Agency API)
- Property details from EPC (type, built form, construction era, floor area, energy rating, walls, roof, windows)
- Planning & heritage check (planning.data.gov.uk by UPRN, Historic England NHLE by coordinates with 75m buffer)
- iOS/macOS design language throughout

---

## API Integration Status

### Currently Integrated

| API | Query Method | Status |
|-----|-------------|--------|
| EPC Open Data | UPRN / address search | ✅ Working |
| Land Registry Price Paid | SPARQL | ✅ Working |
| Environment Agency Flood | lat/lon (WGS84) | ✅ Working |
| planning.data.gov.uk | `?q=UPRN` | ✅ Working |
| Historic England NHLE | BNG coords + 75m buffer | ✅ Working |
| postcodes.io | Postcode → LSOA, district, ward | ✅ Working |

### Next To Integrate (Priority Order)

| Priority | API | Query Method | Key Gotcha |
|----------|-----|-------------|------------|
| 1 | Ofcom Broadband/Mobile | Postcode (returns per-UPRN) | 50k req/month free. Cache 30 days. |
| 2 | IMD 2025 (ONS ArcGIS) | LSOA code from postcodes.io | October 2025 release. Supersedes IMD 2019. |
| 3 | DEFRA Noise Mapping | ArcGIS REST, needs BNG coords | EPSG:27700 conversion required. |
| 4 | Natural England SSSI/AONB | ArcGIS REST/WFS | BNG conversion may be needed. |
| 5 | BGS Geology | lat/lon (WGS84) | Subsidence risk, radon data. |
| 6 | NaPTAN Transport | Proximity search | PTAL proxy calculation. |
| 7 | Companies House | Company number | 600 req/5min. API key required. |
| 8 | FSA Hygiene Ratings | Postcode proximity | Neighbourhood amenity indicator. |
| 9 | HMLR UK HPI | SPARQL | Already partially done — enhance with trend charts. |

See `UK_Property_Free_API_Research_Feb2026.docx` for full API documentation and endpoint references.

---

## Coordinate Handling

- **Internal standard:** WGS84 (EPSG:4326) — all coordinates stored as lat/lon
- **BNG conversion needed for:** DEFRA noise, Natural England, some EA services
- **Conversion:** `pyproj.Transformer.from_crs(4326, 27700, always_xy=True)`
- **Precision:** 6 decimal places, truncated not rounded
- **Buffer zones:** Always label honestly ("within Xm") — never imply definitive containment from geocoded coordinates

---

## Report Architecture

The report generation pipeline:

```
FastAPI (Python) serialises all property data → JSON temp file
  → Node.js (docx-js) reads JSON, builds styled Word document
  → Returns .docx file path
  → FastAPI serves the file
```

See `PROPVAL_REPORT_ARCHITECTURE.md` for the full RICS-compliant report spec covering PS 1, PS 2, VPS 1–5, VPGA 2, UK VPGA 11, IVS 104.

### Design Language

| Element | Value |
|---------|-------|
| Font | Calibri (SF Pro proxy) |
| Primary colour | iOS Blue #007AFF |
| Section headings | All-caps, tracked letters, blue bottom rule |
| Label colour | #636366 (iOS secondary) |
| Value colour | #1C1C1E (iOS primary) |
| Risk high | Red #FF3B30 |
| Risk medium | Amber #FF9500 |
| Risk low | Green #34C759 |
| Row backgrounds | White / #F2F2F7 alternating |
| Borders | Bottom separator only #E5E5EA |

---

## Database Architecture (Three Tiers)

### Tier 1 — Property Library (UPRN Level)
Permanent, accumulating. Public data from APIs. Shared across all users (read). System-written only.

### Tier 2 — Case Records (Firm-Private)
Surveyor's working files. RLS-protected by `firm_id`. Includes case assignments, documents, comparables, valuation decisions.

### Tier 3 — Evidence Library (Anonymised Shared)
Normalised comparable evidence contributed by all surveyors. No personal identifiers. UPRN-anchored.

See `PropVal_Platform_Architecture_v1_0_Mar2026.docx` for full schema, RLS policies, case lifecycle, and firm hierarchy.

---

## Current Phase: Phase 1 — Foundation

Building for a single surveyor (Terry) and a single firm. Scope:

- Case types: Research and Full Valuation only
- Tier 1 property record with API enrichment pipeline
- Tier 2 case record with status flow: draft → in_progress → complete → issued
- System-generated case names, UPRN-anchored filing
- One report template (Full Valuation, Market Value)
- Supabase RLS foundation for future multi-tenancy

---

## Key Technical Patterns

### Parallel API Calls (Non-Negotiable)
```python
results = await asyncio.gather(
    fetch_epc_data(uprn),
    fetch_flood_risk(lat, lon),
    fetch_noise_data(lat, lon),
    fetch_broadband(postcode),
    return_exceptions=True
)
```

### Caching in property_enrichment Table
Every API response cached with `fetched_at` and `expires_at`. Check cache before calling external API. TTLs defined in the mandate.

### Graceful Degradation
If any API fails: return cached data (even stale) with `data_stale: true` flag, or return partial results with `degraded_sources` list. Never crash. Never block.

### Land Registry SAON/PAON
- Houses: query PAON field (e.g., "10 Marsh Wall")
- Flats: query SAON field (e.g., "Flat 4") AND PAON
- Getting this wrong silently returns zero results — a critical bug that was fixed in v9

---

## Known Issues / Active Debugging

- Flood risk section was being debugged at last session (Surface Water + Rivers & Sea endpoints)
- EPC construction-era field sometimes returns a bare dash character — handle as "Not recorded"

---

## Constraints

1. **ZERO COST** — MVP stage. All APIs must be free tier. No paid services.
2. **SPEED IS THE PRODUCT** — Page loads < 1.5s. Property enrichment < 5s parallel. Report gen < 8s.
3. **Solo founder** — Terry works evenings and weekends. Architecture must be simple to maintain.
4. **Pilot scale** — 20 valuers, ~400 reports/month. No need for distributed systems.

---

## File Structure Reference

```
propval-mvp/
├── CLAUDE.md                                    ← You are here
├── docs/
│   ├── PropVal_Claude_Code_Mandate_v1.0.md      ← Engineering standards (READ FIRST)
│   └── PROPVAL_REPORT_ARCHITECTURE.md           ← RICS report spec
├── backend/
│   ├── main.py                                  ← FastAPI app, CORS, startup
│   ├── routers/                                 ← Route handlers by domain
│   ├── services/                                ← Business logic, API clients
│   ├── tests/                                   ← Pytest test suite
│   ├── data/                                    ← INSPIRE polygons, reference DBs
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── app/                                 ← Next.js App Router pages + components
│       ├── components/                          ← Reusable UI components
│       ├── lib/                                 ← API utilities, constants, Supabase client
│       └── types/                               ← Shared TypeScript types
├── supabase/
│   └── migrations/                              ← Numbered SQL migration files
├── scripts/                                     ← Backup, import, build utilities
└── .gitignore
```

---

## Quick Reference — Common Commands

```bash
# Start backend
cd backend && uvicorn main:app --reload --port 8000

# Start frontend
cd frontend && npm run dev

# Run database migration
# (apply SQL migration files via Supabase CLI or dashboard)

# Check for secrets before committing
git diff --staged | grep -iE "(key|secret|password|token|api_key)"
```

---

*Last updated: March 2026. Update this file whenever the architecture, stack, or active work changes.*

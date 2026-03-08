# PROPVAL — CLAUDE CODE DEVELOPMENT MANDATE

## Binding Engineering Standards & Security Policy

**Version:** 1.0  
**Effective:** March 2026  
**Status:** ACTIVE — This document governs ALL Claude Code sessions for PropVal  
**Review Cycle:** Before every major feature build; updated as architecture evolves

---

## 0. HOW TO USE THIS DOCUMENT

This mandate is the single authoritative source of engineering standards for PropVal. Every Claude Code session MUST begin by confirming awareness of this document. If a proposed implementation conflicts with any rule below, the rule wins — raise the conflict explicitly rather than silently deviating.

The two overriding constraints on every decision:

1. **ZERO COST** — We are at MVP stage. No paid APIs, no paid services, no paid libraries. Every integration must use free tiers or open data. If a feature cannot be built without incurring cost, flag it and defer.
2. **SPEED IS THE PRODUCT** — PropVal sells on speed and smoothness. Every architectural decision, every API call, every database query must be evaluated against latency impact. A feature that is correct but slow is a failed feature.

---

## 1. ARCHITECTURE OVERVIEW

PropVal is a three-tier web application:

| Layer | Technology | Hosting | Local Dev |
|-------|-----------|---------|-----------|
| Frontend | Next.js (TypeScript + TailwindCSS) | Vercel | localhost:3000 |
| Backend | FastAPI (Python) | Render | localhost:8000 |
| Database | Supabase (PostgreSQL + PostGIS) | Supabase Cloud | Remote (no local DB) |
| Version Control | Git + GitHub | — | — |

### 1.1 Data Flow Principle

```
User Input (postcode/address)
  → Frontend (Next.js) validates and sends request
    → Backend (FastAPI) orchestrates API calls, transforms data
      → Supabase stores enriched property records
    → Backend returns structured JSON response
  → Frontend renders with iOS/macOS design language
```

### 1.2 The UPRN Spine

UPRN (Unique Property Reference Number) is the universal anchor for all data. Every API integration, every database record, every cache entry must resolve to or associate with a UPRN where possible. If a UPRN cannot be resolved, the system must gracefully degrade — never block the user.

---

## 2. SECURITY MANDATE — NON-NEGOTIABLE

Security is not a feature — it is a precondition. Every line of code must assume a hostile environment. PropVal will handle client data, valuation figures, and professional records that carry legal and regulatory weight. A breach is an existential risk.

### 2.1 Authentication & Authorisation

- **Supabase Auth** is the sole authentication provider. No custom auth implementations.
- **Row Level Security (RLS)** MUST be enabled on every table, no exceptions. Every new table starts fully locked. Access is granted via explicit RLS policies.
- **RLS policies must be tested** with multiple test user contexts before any migration is considered complete. Test: "Can User A see User B's data?" — the answer must always be no (except for shared Tier 1 property data and anonymised Tier 3 evidence).
- **JWT tokens** from Supabase Auth are the sole mechanism for API authentication. Never pass user IDs as request parameters for authorisation purposes — extract them from the verified JWT on the server side.
- **Service role keys** (Supabase) must NEVER appear in frontend code, environment variables accessible to the browser, or any client-side bundle. Service role keys are backend-only, loaded from server-side environment variables.

### 2.2 API Keys & Secrets Management

- **ALL secrets** (API keys, database URLs, service role keys) live in environment variables. Never hardcoded. Never committed to Git. Never logged.
- **`.env` files** are gitignored. The `.gitignore` must contain `.env*` — verify this is present before every session.
- **Render environment variables** for backend secrets. **Vercel environment variables** for frontend secrets (only `NEXT_PUBLIC_` prefixed variables are permitted in frontend code).
- **Before every commit**, run a mental check: "Does this diff contain any secret, key, password, or connection string?" If yes, stop and extract to environment variables.
- **Supabase anon key** is the ONLY key permitted in frontend code (it is designed to be public, gated by RLS). Even so, never expose the Supabase service_role key anywhere in the frontend.
- **Third-party API keys** (EPC, Ofcom, OS Data Hub, Companies House, Met Office) are stored as backend environment variables only. The frontend never calls third-party APIs directly — all external API calls are proxied through FastAPI.

### 2.3 Input Validation & Injection Prevention

- **Every user input** must be validated on both frontend (for UX) and backend (for security). Frontend validation is a convenience; backend validation is the law.
- **Postcodes**: Validate against UK postcode regex before any API call: `^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$` (case-insensitive).
- **UPRNs**: Validate as numeric, 12 digits max.
- **SQL injection**: Use parameterised queries exclusively. Supabase client libraries handle this natively — never construct raw SQL strings with user input. For any raw SQL (migrations, stored procedures), use `$1, $2` parameter placeholders.
- **XSS prevention**: React/Next.js escapes by default. Never use `dangerouslySetInnerHTML` unless content has been sanitised with a whitelist-based sanitiser. Prefer never using it.
- **Path traversal**: Never construct file paths from user input. Storage paths are system-generated from UPRNs and case IDs.
- **Rate limiting**: Implement rate limiting on all public-facing API endpoints. Use FastAPI middleware or Render's built-in rate limiting. Target: 60 requests/minute per IP for unauthenticated endpoints, 120/minute for authenticated.
- **CORS**: FastAPI CORS middleware must whitelist only the exact frontend origin(s). Never use `allow_origins=["*"]` in production. Development can use localhost origins.

### 2.4 Data Protection & GDPR

- **Personal data** (client names, contact details, instruction specifics) is Tier 2 data — firm-private, protected by RLS.
- **Tier 3 evidence library** must strip all personal identifiers before insertion. Only property-level data (address, price, date, type, area) enters the shared library.
- **Logging**: Never log personal data, API keys, or full request bodies containing sensitive fields. Log request metadata (endpoint, status code, duration, user_id) only.
- **Data retention**: Cases marked "issued" become immutable. Implement soft-delete (is_deleted flag) rather than hard-delete for audit compliance.

### 2.5 Dependency Security

- **Minimise dependencies.** Every npm/pip package is an attack surface. Before adding any dependency, ask: "Can this be achieved with the standard library or an existing dependency?"
- **Pin versions** in `requirements.txt` and `package.json`. No floating versions (`^`, `~`, `*`). Use exact versions.
- **Review changelogs** before upgrading any dependency.
- **No unvetted packages.** Only use packages with >1,000 GitHub stars or that are maintained by known organisations. When in doubt, flag it.

### 2.6 Git Hygiene & Code Protection

- **Never force-push to main.** All work happens on feature branches.
- **Branch naming**: `feature/description`, `fix/description`, `refactor/description`.
- **Commit messages**: Descriptive, imperative mood. Example: `Add flood risk section to property report endpoint`.
- **No secrets in Git history.** If a secret is accidentally committed, it must be rotated immediately — do not rely on rewriting Git history as the sole remediation.
- **`.gitignore` must include** at minimum: `.env*`, `node_modules/`, `__pycache__/`, `.next/`, `*.pyc`, `.DS_Store`, `venv/`, `.vscode/` (unless shared settings are intentional).

### 2.7 Supabase-Specific Security

- **RLS is the perimeter.** Assume the Supabase anon key is public (it is). All data access control happens through RLS policies, not application logic.
- **Migrations**: All schema changes go through Supabase migrations (SQL files), never through the dashboard in production. Migrations must be version-controlled.
- **PostGIS**: Spatial queries must use parameterised coordinates. Never interpolate lat/lon into raw SQL.
- **Storage (Supabase Storage)**: Bucket policies must mirror RLS. Private buckets for case documents. Public buckets only for genuinely public assets (e.g., UI assets).
- **Edge Functions**: If used, they execute with the user's JWT context. Never bypass RLS by using the service_role key in Edge Functions unless absolutely necessary, and document why.

---

## 3. PERFORMANCE MANDATE — SPEED IS THE PRODUCT

### 3.1 Response Time Budgets

| Operation | Target | Hard Ceiling |
|-----------|--------|-------------|
| Page load (initial) | < 1.5s | 3s |
| Postcode search → results | < 2s | 4s |
| Property data enrichment (all APIs) | < 5s (parallel) | 10s |
| Report generation | < 8s | 15s |
| Any single API call | < 1.5s | 3s (then timeout) |
| Database query | < 100ms | 500ms |

### 3.2 Parallel API Calls

Property enrichment requires calling multiple external APIs (EPC, Land Registry, Flood, Noise, Broadband, etc.). These MUST execute in parallel using `asyncio.gather()` in FastAPI, not sequentially. A sequential chain of 10 API calls at 1s each = 10s. Parallel = ~1.5s. This is non-negotiable.

```python
# CORRECT — parallel execution
results = await asyncio.gather(
    fetch_epc_data(uprn),
    fetch_flood_risk(lat, lon),
    fetch_noise_data(lat, lon),
    fetch_broadband(postcode),
    return_exceptions=True  # Don't let one failure kill all
)

# WRONG — sequential execution
epc = await fetch_epc_data(uprn)
flood = await fetch_flood_risk(lat, lon)  # waits for EPC to finish
```

### 3.3 Caching Strategy

- **API responses** should be cached in the `property_enrichment` table with `fetched_at` and `expires_at` timestamps. Before calling any external API, check if a valid cached response exists.
- **Cache TTLs** by data source:
  - EPC data: 90 days (changes only when new certificate lodged)
  - Land Registry transactions: 30 days (monthly updates)
  - Flood risk: 365 days (changes rarely)
  - Broadband/Ofcom: 180 days (annual update cycle)
  - Noise mapping: 365 days (5-year update cycle)
  - IMD deprivation: 365 days (updates every ~5 years)
  - Planning data: 30 days (changes frequently)
  - Schools: 180 days (annual cycle)
  - Historic England: 90 days (weekly updates but low change rate per property)
- **Frontend caching**: Use Next.js ISR (Incremental Static Regeneration) or SWR for data that doesn't change per-request. React Query or SWR for client-side data fetching with stale-while-revalidate semantics.
- **Never cache** user-specific data (cases, client details) in shared caches.

### 3.4 Database Performance

- **Indexes**: Every column used in a WHERE clause or JOIN must have an appropriate index. At minimum: `properties.postcode`, `properties.uprn`, `cases.firm_id`, `cases.uprn`, `cases.status`, `evidence_library.postcode`, `evidence_library.uprn`.
- **PostGIS spatial indexes**: Use GiST indexes on geometry columns for spatial queries.
- **Pagination**: All list endpoints must support cursor-based pagination. Never return unbounded result sets.
- **Select only needed columns**: Avoid `SELECT *`. Specify columns explicitly, especially on tables with JSONB columns (property_enrichment.data_payload can be large).
- **Connection pooling**: Use Supabase's built-in connection pooler (PgBouncer). Configure FastAPI to use the pooler URL, not the direct connection URL.

### 3.5 Frontend Performance

- **Code splitting**: Next.js handles this by default with dynamic imports. Use `next/dynamic` for heavy components not needed on initial render.
- **Image optimisation**: Use `next/image` for all images. Compress inspection photos before upload.
- **Bundle size**: Monitor with `next build` output. Flag any single page bundle exceeding 200KB gzipped.
- **Skeleton screens**: Show loading skeletons immediately while data fetches. Never show a blank screen or a single spinner for >500ms.
- **Optimistic UI**: Where safe (e.g., status updates), update the UI immediately and reconcile with the server response.

---

## 4. CODE QUALITY STANDARDS

### 4.1 Backend (Python / FastAPI)

- **Type hints** on all function signatures. Use `pydantic` models for request/response schemas.
- **Async by default.** All FastAPI route handlers and external API calls must be `async def`. Synchronous blocking calls in an async context will stall the event loop.
- **Error handling**: Every external API call must be wrapped in try/except with:
  - Specific exception types (not bare `except:`)
  - Meaningful error messages
  - Graceful degradation (if flood API fails, return the rest of the data with a flag indicating flood data is unavailable)
  - Timeout enforcement (`httpx` with `timeout=5.0` as default)
- **HTTP client**: Use `httpx.AsyncClient` with connection pooling (create once at startup, reuse). Never create a new client per request.
- **Logging**: Use Python's `logging` module with structured output. Log levels: DEBUG for development, INFO for production. Never print() in production code.
- **File structure**:
  ```
  backend/
    app/
      main.py           # FastAPI app, CORS, startup/shutdown
      config.py          # Settings from environment variables (pydantic BaseSettings)
      routers/           # Route handlers grouped by domain
      services/          # Business logic and external API clients
      models/            # Pydantic request/response models
      utils/             # Shared utilities (coordinate transforms, validators)
    requirements.txt     # Pinned dependencies
    .env                 # Local only, gitignored
  ```

### 4.2 Frontend (TypeScript / Next.js)

- **TypeScript strict mode** enabled. No `any` types without explicit justification in a comment.
- **Component structure**: Pages in `app/` (App Router). Reusable components in `components/`. API utilities in `lib/`.
- **State management**: React hooks (useState, useReducer, useContext) for local/shared state. No Redux unless complexity genuinely demands it (it won't at MVP).
- **Naming conventions**: PascalCase for components. camelCase for functions and variables. SCREAMING_SNAKE for environment constants.
- **Design language**: iOS/macOS-inspired. Calibri as SF Pro proxy. iOS blue (#007AFF) as primary action colour. Minimal borders. Semantic colour coding for risk indicators (red/amber/green). Clean whitespace. No visual clutter.
- **Accessibility**: All interactive elements must be keyboard-navigable. Use semantic HTML. Provide alt text for images. Colour must not be the sole indicator of meaning (combine with icons or text).

### 4.3 Shared Standards

- **DRY**: If logic appears in more than two places, extract it. But don't over-abstract — premature abstraction is worse than duplication.
- **Single Responsibility**: Each function does one thing. Each file handles one domain.
- **Comments**: Comment the WHY, not the WHAT. Code should be self-documenting for the what. Exceptions: complex regex patterns, non-obvious business rules, workarounds for API quirks.
- **TODO/FIXME**: Use `# TODO(terry):` or `// TODO(terry):` format with a name and brief explanation. These are searchable and trackable.
- **No dead code.** Remove commented-out code. Git preserves history.

---

## 5. API INTEGRATION STANDARDS

### 5.1 General Rules for All External APIs

- **All external API calls** happen in the FastAPI backend. The frontend NEVER calls a third-party API directly.
- **Timeout**: 5 seconds default. 10 seconds maximum for known slow endpoints (e.g., SPARQL queries). Configure per-client.
- **Retry**: Maximum 1 retry on transient failures (5xx, timeout). Use exponential backoff (1s then 2s). Never retry on 4xx (client error).
- **Circuit breaker pattern**: If an API fails 3 consecutive times, mark it as degraded and skip it for 60 seconds. Return cached data or a "temporarily unavailable" flag. Never let one failing API block the entire enrichment pipeline.
- **Response validation**: Validate API responses against expected schema before storing. Malformed responses should be logged and discarded, not stored.
- **User-Agent header**: Set a descriptive User-Agent on all outbound requests: `PropVal/1.0 (property-intelligence; contact@propval.co.uk)`.

### 5.2 Coordinate Handling

- **Internal standard**: WGS84 (EPSG:4326) — latitude/longitude. All coordinates stored in the database are WGS84.
- **BNG conversion**: Several DEFRA/Natural England ArcGIS services require EPSG:27700 (British National Grid). Use `pyproj` for conversion:
  ```python
  from pyproj import Transformer
  bng_transformer = Transformer.from_crs(4326, 27700, always_xy=True)
  easting, northing = bng_transformer.transform(longitude, latitude)
  ```
- **Coordinate precision**: Store to 6 decimal places (≈0.1m accuracy). Truncate, do not round, to avoid accumulating floating-point drift.
- **Buffer zones**: When querying spatial APIs by coordinate, use honest buffer distances. Label results as "within Xm" — never imply definitive containment when using geocoded coordinates.

### 5.3 API-Specific Notes

| API | Query Method | Key Gotchas |
|-----|-------------|-------------|
| EPC Open Data | UPRN or address search | Fuzzy match must prioritise flat/house numbers. Distinguish SAON (flat) vs PAON (building). |
| Land Registry Price Paid | SPARQL query | Query PAON for houses, SAON for flats — a wrong field silently returns zero results. |
| Environment Agency Flood | lat/lon coordinates | Use WGS84. Surface Water and Rivers & Sea are separate endpoints. |
| DEFRA Noise Mapping | ArcGIS REST, BNG coords | Requires EPSG:27700 conversion. Transitioning to OGC API-Features — test both. |
| Historic England NHLE | ArcGIS, coordinates + buffer | Use 75m buffer + BPN confidence scoring. |
| planning.data.gov.uk | `?q=UPRN` | Query by UPRN, NOT lat/lon. |
| postcodes.io | Postcode string | Returns metadata + LSOA code. NOT for coordinates (use OS Places or EPC for rooftop-level). |
| Ofcom Broadband | Postcode (returns per-UPRN) | 50,000 req/month free. Cache per postcode for 30 days. |
| IMD 2025 (ONS ArcGIS) | LSOA code | Chain: postcode → postcodes.io → LSOA → ONS ArcGIS. |
| BGS Geology | lat/lon coordinates | WGS84 accepted. Returns geology and superficial deposits. |

---

## 6. DATABASE CONVENTIONS

### 6.1 Naming

- **Tables**: lowercase, plural, snake_case. Example: `properties`, `case_documents`, `evidence_library`.
- **Columns**: lowercase, snake_case. Example: `floor_area_sqm`, `fetched_at`, `case_sequence`.
- **Primary keys**: `id` (UUID) for most tables. `uprn` (BIGINT) for `properties`.
- **Foreign keys**: `{referenced_table_singular}_id`. Example: `firm_id`, `case_id`.
- **Timestamps**: Always `TIMESTAMPTZ` (with timezone). Always default to `NOW()`. Include `created_at` and `updated_at` on every table.
- **Boolean columns**: Prefix with `is_` or `has_`. Example: `is_active`, `has_epc`.
- **JSONB columns**: Use for flexible API response storage (`data_payload`). Never for structured data that will be queried frequently — normalise instead.

### 6.2 Migrations

- All schema changes are SQL migration files, version-controlled in the repository.
- Migration files are numbered sequentially: `001_create_properties.sql`, `002_create_firms.sql`, etc.
- Every migration must be reversible. Include a comment block at the top with the rollback SQL.
- Never modify a migration that has been applied to production. Create a new migration instead.
- Test migrations against a Supabase branch or local PostgreSQL before applying to production.

### 6.3 RLS Policy Template

Every table must follow this pattern:

```sql
-- Enable RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Default deny (no policy = no access)
-- Then add explicit policies:

-- Example: firm-scoped read access
CREATE POLICY "Users can read own firm data"
  ON table_name FOR SELECT
  USING (firm_id = (
    SELECT firm_id FROM firm_members
    WHERE user_id = auth.uid() AND is_active = true
  ));
```

---

## 7. ERROR HANDLING & RESILIENCE

### 7.1 Graceful Degradation Hierarchy

When an external API fails, the system must not crash. Follow this hierarchy:

1. **Return cached data** if available (even if stale), with a `data_stale: true` flag and `fetched_at` timestamp.
2. **Return partial results** — if flood API fails but EPC succeeds, return the EPC data with flood marked as `unavailable`.
3. **Return a clear error message** — never a raw stack trace, never a generic "Something went wrong."

### 7.2 Error Response Schema

All API error responses follow a consistent structure:

```json
{
  "error": true,
  "code": "FLOOD_API_TIMEOUT",
  "message": "Flood risk data is temporarily unavailable. Cached data from 2026-01-15 is shown instead.",
  "data": { ... },
  "degraded_sources": ["flood_risk"]
}
```

### 7.3 Frontend Error Display

- **Never show raw error codes or stack traces to users.**
- Show friendly, actionable messages. Example: "Flood risk data couldn't be loaded right now — we'll try again automatically."
- Use semantic colour: amber for degraded data, red only for blocking errors.
- Provide a manual retry button for failed sections.

---

## 8. TESTING STRATEGY

### 8.1 MVP Testing Requirements

At MVP stage, full test coverage is not required. But the following are non-negotiable:

- **RLS policy tests**: Every table must have a test confirming cross-firm data isolation.
- **API integration tests**: Each external API integration must have a test using recorded (mocked) responses to verify parsing logic.
- **Input validation tests**: All user-facing inputs must have tests for valid input, invalid input, and edge cases (empty string, SQL injection attempts, XSS payloads).
- **Critical path smoke test**: Postcode search → property lookup → enrichment → report generation must work end-to-end.

### 8.2 What Can Be Deferred

- Unit tests for utility functions (nice to have, not blocking)
- Frontend component tests (manual testing acceptable at MVP)
- Performance/load tests (manual benchmarking sufficient)

---

## 9. DEPLOYMENT & ENVIRONMENT RULES

### 9.1 Environment Separation

| Environment | Frontend | Backend | Database |
|-------------|----------|---------|----------|
| Development | localhost:3000 | localhost:8000 | Supabase (dev project or branch) |
| Production | Vercel (propval.co.uk) | Render | Supabase (production project) |

### 9.2 Deployment Checklist

Before any production deployment:

1. All environment variables set on Vercel/Render (not relying on `.env` files)
2. `.gitignore` confirmed to exclude all secrets and local-only files
3. RLS policies verified on all tables
4. CORS configuration points to production frontend URL only
5. No `console.log` or `print()` statements with sensitive data
6. No hardcoded localhost URLs — all URLs from environment variables
7. Database migrations applied and tested

### 9.3 Render-Specific

- Use Render's environment variable management — never commit secrets
- Set health check endpoint: `/health` returning `{"status": "ok"}`
- Configure auto-deploy from `main` branch only
- Use Render's built-in SSL — never handle TLS termination in application code

### 9.4 Vercel-Specific

- Only `NEXT_PUBLIC_` prefixed environment variables are available in browser code
- Use Vercel's preview deployments for feature branches
- Configure production domain with proper DNS
- Enable Vercel Analytics for Core Web Vitals monitoring (free tier)

### 9.5 Backup & Disaster Recovery

PropVal must be recoverable from any single point of failure. All backup mechanisms must be **zero-cost** at MVP stage.

#### 9.5.1 Database Backups (Supabase)

- **Automatic backups**: Supabase Pro plan provides daily point-in-time recovery (PITR) with 7-day retention. **Free plan does NOT include project backups** — manual exports are the only protection.
- **Manual export schedule (CRITICAL on Free plan)**: Export critical tables (`cases`, `case_comparables`, `property_enrichment`) as CSV/JSON **every 2 days** via Supabase dashboard (Table Editor → Export) or `pg_dump`. Store exports in a secure, offline location (encrypted local drive or private cloud storage). This is the sole database backup mechanism on the Free plan — maximum acceptable data loss is 48 hours.
- **Upgrade trigger**: When PropVal holds real client data (post-MVP launch), upgrade to Supabase Pro for automated daily PITR. Until then, manual weekly exports are mandatory.
- **Migration replay**: All schema is version-controlled in `supabase/migrations/`. A fresh database can be rebuilt by replaying migrations sequentially.
- **Pre-migration backup**: Before applying any migration to production, take a manual backup via Supabase dashboard. Never apply migrations without a rollback plan.

#### 9.5.2 Code & Configuration Backups

- **Git + GitHub** is the primary code backup. All code, migrations, documentation, and configuration (excluding secrets) are version-controlled.
- **Branch protection**: `main` branch must never be force-pushed. All history is preserved.
- **Local clone**: Maintain at least one local clone on a separate machine or drive as a cold backup.

#### 9.5.3 Secrets & Environment Variables

- **Document all required environment variables** in a `env.example` file (committed to Git) listing variable names without values.
- **Secure backup of `.env`**: Store a copy of production `.env` values in a password manager (e.g., Bitwarden, 1Password) — never in Git, email, or plain text files.
- **Render/Vercel recovery**: Both platforms allow environment variable export. Document the full list of variables per platform so they can be re-entered if the project is redeployed.

#### 9.5.4 Recovery Time Objectives

| Scenario | Target Recovery Time | Method |
|----------|---------------------|--------|
| Code loss (repo deleted) | < 1 hour | Restore from GitHub or local clone |
| Database corruption | < 4 hours | Supabase PITR or manual export restore |
| Secret rotation (key compromised) | < 30 minutes | Regenerate in provider dashboard, update Render/Vercel env vars |
| Full platform failure (Render down) | < 2 hours | Redeploy to backup platform (Railway, Fly.io) using same Docker/requirements |
| Full platform failure (Vercel down) | < 2 hours | Deploy Next.js to Netlify or Cloudflare Pages |
| Supabase outage | Wait for resolution | No self-hosted fallback at MVP; Supabase SLA applies |

#### 9.5.5 Disaster Recovery Checklist

Run this quarterly (or before any production deployment):

1. [ ] Verify Supabase backup is enabled and last backup timestamp is recent
2. [ ] Confirm GitHub repository is accessible and `main` branch is up to date
3. [ ] Verify `.env` values are stored in password manager and match production
4. [ ] Confirm `env.example` lists all required variables
5. [ ] Test: can a fresh developer clone the repo, set env vars, and run both frontend + backend locally?
6. [ ] Verify all migrations can replay cleanly on an empty database

---

## 10. DESIGN LANGUAGE REFERENCE

All UI must follow the PropVal design system:

| Element | Specification |
|---------|--------------|
| Primary font | Calibri (SF Pro proxy) |
| Primary action colour | iOS Blue #007AFF |
| Background | White #FFFFFF or off-white #F9FAFB |
| Text primary | #1D1D1F |
| Text secondary | #6E6E73 |
| Risk — High | Red #FF3B30 |
| Risk — Medium | Amber #FF9500 |
| Risk — Low | Green #34C759 |
| Data unavailable | Grey #8E8E93 |
| Borders | Minimal. Use spacing and background colour to define sections. |
| Border radius | 12px for cards, 8px for inputs, 6px for tags |
| Spacing | 8px grid system. Padding: 16px standard, 24px for cards |

---

## 11. SESSION PROTOCOL FOR CLAUDE CODE

### 11.1 Session Start

Every Claude Code session must begin with:

1. Read `CLAUDE.md` for project brief and current state
2. Read this mandate for engineering standards
3. Confirm: "I have read the mandate. Working on: [description of task]"

### 11.2 Before Writing Code

1. **State the plan** — what will be built, which files will be touched, which APIs are involved
2. **Identify security implications** — does this touch auth? RLS? User input? Secrets?
3. **Identify performance implications** — does this add latency? Can it be parallelised? Does it need caching?
4. **Wait for approval** on the plan before writing code (unless the task is a simple bug fix)

### 11.3 Before Every Commit

Run through this checklist mentally:

- [ ] No secrets in the diff
- [ ] No `console.log` / `print()` with sensitive data
- [ ] All user inputs validated on the backend
- [ ] RLS policies cover any new tables
- [ ] Async/parallel where possible for external calls
- [ ] Error handling with graceful degradation
- [ ] Types defined (TypeScript strict, Python type hints)
- [ ] No dead code or commented-out blocks

### 11.4 When Uncertain

If uncertain about the correct approach:

1. State the options and trade-offs
2. Recommend the option that best satisfies: security first, then speed, then simplicity
3. Ask Terry for a decision — never silently pick the risky option

---

## 12. PROHIBITED PATTERNS

The following are explicitly forbidden across the entire codebase:

| Pattern | Why |
|---------|-----|
| `allow_origins=["*"]` in production CORS | Opens the API to any origin |
| Raw SQL string interpolation with user input | SQL injection vector |
| `dangerouslySetInnerHTML` without sanitisation | XSS vector |
| Hardcoded API keys or secrets | Credential exposure |
| `SELECT *` on tables with large JSONB columns | Performance and data leakage |
| Bare `except:` or `except Exception:` without logging | Swallows errors silently |
| `time.sleep()` in async FastAPI handlers | Blocks the event loop |
| Frontend direct calls to third-party APIs | Exposes keys, bypasses caching/validation |
| Force-push to main branch | Destroys Git history |
| Disabling RLS on any table | Removes data isolation |
| Storing personal data in Tier 3 evidence library | GDPR violation |
| Floating version ranges in dependencies | Non-reproducible builds |
| `localStorage` / `sessionStorage` for auth tokens | XSS-accessible; use httpOnly cookies or Supabase's built-in session management |

---

## 13. TECHNOLOGY DECISIONS LOG

Record all significant technology decisions here. Format: Date | Decision | Rationale.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02 | FastAPI over Django/Flask | Async-native, fastest Python framework, Pydantic built-in |
| 2026-02 | Next.js over plain React | SSR/ISR for performance, file-based routing, Vercel integration |
| 2026-02 | Supabase over Firebase | PostgreSQL + PostGIS, RLS, SPARQL-friendly, open source |
| 2026-02 | PostGIS for spatial queries | Flood, noise, heritage queries all coordinate-dependent |
| 2026-02 | docx-js (Node) for report gen | Better typographic control than python-docx |
| 2026-02 | EPC API for UPRN resolution | Free, avoids OS Places cost at MVP |
| 2026-02 | Nominatim as geocoding fallback | Free, avoids OS Places cost. OS Places is production target |
| 2026-03 | Markdown for this mandate | Native to Claude Code, version-controllable, renders in GitHub |

---

## 14. GLOSSARY

| Term | Definition |
|------|-----------|
| UPRN | Unique Property Reference Number — the 12-digit identifier for every addressable location in the UK |
| USRN | Unique Street Reference Number |
| TOID | Topographic Identifier (OS MasterMap) |
| BNG | British National Grid (EPSG:27700) |
| WGS84 | World Geodetic System 1984 (EPSG:4326) — standard lat/lon |
| SAON | Secondary Addressable Object Name (e.g., "Flat 4") |
| PAON | Primary Addressable Object Name (e.g., "10 Marsh Wall") |
| RLS | Row Level Security (Supabase/PostgreSQL) |
| LSOA | Lower Layer Super Output Area — census geography unit |
| IMD | Indices of Multiple Deprivation |
| MRICS | Member of the Royal Institution of Chartered Surveyors |
| Red Book | RICS Valuation — Global Standards (the "Red Book") |
| ToE | Terms of Engagement |
| GDV | Gross Development Value |
| PI | Professional Indemnity (insurance) |
| HPI | House Price Index |
| PTAL | Public Transport Accessibility Level |
| EPC | Energy Performance Certificate |

---

*This mandate is a living document. Update it as the architecture evolves, new APIs are integrated, or new security considerations emerge. Every Claude Code session should reference the current version.*

**— END OF MANDATE —**

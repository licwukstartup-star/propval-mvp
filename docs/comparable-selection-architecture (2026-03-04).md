# Comparable Selection Engine — Architecture & Specification

## 1. Overview

This module automates the comparable selection process for RICS-compliant residential valuations. It mimics the human valuer's workflow: apply strict fundamental filters first, then progressively relax geographic proximity until enough candidates are found. If geographic relaxation alone is insufficient, property specification filters are relaxed as a last resort.

The system **recommends** comparables. The valuer makes the final selection.

---

## 2. Concepts

### 2.1 Subject Property

The property being valued. All filters are derived from the subject's attributes.

### 2.2 Hard Deck Filters

Fundamental property characteristics that define the baseline comparability. These are always applied first and only relaxed after all geographic tiers have been exhausted.

### 2.3 Geographic Tiers

Progressive geographic expansion. Each tier widens the search area and has its own time window. Results are **cumulative** — each tier adds to the pool, it never replaces previous results.

### 2.4 Spec Relaxation Rounds

When all geographic tiers fail to return enough comparables, the hard deck filters are loosened one at a time, and the full geographic search is re-run.

### 2.5 Target Count (`n`)

The number of comparables the valuer wants. Default: 10. Configurable per case. The system stops expanding the search once the cumulative pool reaches or exceeds `n`.

---

## 3. Data Model

### 3.1 Subject Property Schema

```typescript
interface SubjectProperty {
  // Identity
  address: string;
  postcode: string;            // Full postcode, e.g. "SW12 8NX"
  outward_code: string;        // Derived, e.g. "SW12"
  inward_code: string;         // Derived, e.g. "8NX"
  uprn?: string;               // Unique Property Reference Number (if available)

  // Hard deck attributes
  tenure: "freehold" | "leasehold";
  property_type: "flat" | "house";
  house_sub_type?: "detached" | "semi-detached" | "terraced" | "end-terrace";
  bedrooms: number;            // 0 = studio

  // Flat-specific
  building_name?: string;      // e.g. "Winterfell House"
  development_name?: string;   // e.g. "Battersea Power Station"
  building_era?: "period" | "modern";  // Derived from build year; period < 2000, modern >= 2000
  build_year?: number;

  // House-specific
  street_name?: string;        // Derived from address for same-street matching

  // Location
  latitude?: number;
  longitude?: number;
}
```

### 3.2 Comparable Candidate Schema

```typescript
interface ComparableCandidate {
  // Source identity
  source: "land_registry" | "manual";
  transaction_id?: string;

  // Address
  address: string;
  postcode: string;
  outward_code: string;
  inward_code: string;
  uprn?: string;

  // Property attributes
  tenure: "freehold" | "leasehold";
  property_type: "flat" | "house";
  house_sub_type?: "detached" | "semi-detached" | "terraced" | "end-terrace";
  bedrooms?: number;
  building_name?: string;
  development_name?: string;
  building_era?: "period" | "modern";
  build_year?: number;
  street_name?: string;
  floor_area_sqm?: number;

  // Transaction
  price: number;
  transaction_date: string;    // ISO date
  new_build: boolean;
  transaction_category: "A" | "B";  // A = standard, B = additional/transfer

  // Metadata (added by engine)
  geographic_tier: number;     // 1-4, which tier found this comp
  tier_label: string;          // Human-readable, e.g. "Same building"
  spec_relaxation: string[];   // Which hard deck filters were relaxed, if any
  time_window_months: number;  // The time window that was applied
}
```

### 3.3 Search Result Envelope

```typescript
interface SearchResult {
  subject: SubjectProperty;
  target_count: number;
  comparables: ComparableCandidate[];  // Ordered by tier, then recency
  search_metadata: {
    tiers_searched: number;
    spec_relaxations_applied: string[];
    total_candidates_scanned: number;
    search_duration_ms: number;
    target_met: boolean;
  };
}
```

---

## 4. Hard Deck Filters (Filters 1–4)

These define the "apples to apples" baseline.

| # | Filter         | Applies To | Strict Rule                                       | Relaxed Rule                                           |
|---|----------------|------------|----------------------------------------------------|--------------------------------------------------------|
| 1 | Tenure         | All        | Exact match. Freehold ↔ Freehold. Leasehold ↔ Leasehold. | **Never relaxed.**                                     |
| 2 | Property Type  | All        | Exact match. Flat ↔ Flat. House sub-type ↔ same sub-type. | ±1 step in house hierarchy: detached ↔ semi-detached ↔ terraced. Flat ↔ flat (no cross to house). |
| 3 | Building Era   | Flats only | Period ↔ Period. Modern ↔ Modern. (Cutoff: year 2000) | **Never relaxed.** Not applicable to houses.           |
| 4 | Bedrooms       | All        | Exact match. Studio=0, 1-bed=1, etc.              | ±1 bedroom. Studio (0) can match 1-bed. 5-bed can match 4-bed or 6-bed. |

### 4.1 House Sub-Type Hierarchy

```
Detached > Semi-Detached > End-Terrace > Terraced
```

Relaxation permits movement of **one step** in either direction. Detached can relax to semi-detached but not to terraced. End-terrace is treated as interchangeable with terraced (zero-step distance) and one step from semi-detached.

### 4.2 Building Era Derivation

```python
def derive_building_era(build_year: int | None) -> str | None:
    if build_year is None:
        return None
    return "modern" if build_year >= 2000 else "period"
```

When `build_year` is unknown for a candidate, the system should attempt to infer era from the EPC data (construction-age-band field). If still unknown, the candidate is **included** (benefit of the doubt) but flagged for valuer review.

---

## 5. Geographic Tiers

### 5.1 Flat Tiers

| Tier | Scope                  | Time Window | Search Strategy                                                                                       |
|------|------------------------|-------------|-------------------------------------------------------------------------------------------------------|
| 1    | Same building          | 36 months   | Search by: (a) exact postcode + building name, AND (b) outward code + building name. Union both results. Dedup by transaction_id or address+date. |
| 2    | Same development       | 36 months   | Search by: (a) outward code + development name. If development_name is null, skip this tier.          |
| 3    | Same outward code      | 18 months   | Search by: outward code only. Excludes candidates already found in tiers 1–2.                         |
| 4    | Adjacent outward codes | 18 months   | Identify adjacent outward codes via GIS boundary data or centroid proximity. Search each. Excludes candidates already found in tiers 1–3. |

**Tier 1 implementation note:** The dual search (exact postcode AND outward+building name) runs unconditionally as a single step. This ensures all same-building comps are captured even when the building spans multiple postcodes. The results are merged and deduped before counting.

**Tier 2 implementation note:** A development may contain multiple buildings. The search uses `development_name` against the outward code. If the subject has no `development_name`, this tier is skipped and the system proceeds to tier 3.

### 5.2 House Tiers

| Tier | Scope                  | Time Window | Search Strategy                                                                                   |
|------|------------------------|-------------|---------------------------------------------------------------------------------------------------|
| 1    | Same street            | 36 months   | Match on `street_name` within the same outward code. Street name normalisation required (see §7). |
| 2    | Same postcode          | 18 months   | Match on full postcode. Excludes candidates already in tier 1.                                     |
| 3    | Same outward code      | 18 months   | Match on outward code. Excludes candidates already in tiers 1–2.                                   |
| 4    | Adjacent outward codes | 18 months   | Same as flat tier 4.                                                                               |

---

## 6. Search Orchestration — The Main Loop

```
FUNCTION select_comparables(subject, target_count=10):

    pool = []
    tiers = get_tiers(subject.property_type)  // flat tiers or house tiers

    // ── PHASE 1: Strict hard deck, progressive geography ──
    FOR EACH tier IN tiers:
        candidates = search(subject, tier, hard_deck_strict=True)
        candidates = deduplicate(pool, candidates)
        candidates = apply_hard_deck(subject, candidates, relaxations=[])
        tag_candidates(candidates, tier)
        pool += candidates
        IF len(pool) >= target_count:
            BREAK

    IF len(pool) >= target_count:
        RETURN pool

    // ── PHASE 2: Relax property type (filter 2), re-run all tiers ──
    FOR EACH tier IN tiers:
        candidates = search(subject, tier, hard_deck_strict=True)
        candidates = deduplicate(pool, candidates)
        candidates = apply_hard_deck(subject, candidates, relaxations=["type"])
        tag_candidates(candidates, tier, relaxations=["type"])
        pool += candidates
        IF len(pool) >= target_count:
            BREAK

    IF len(pool) >= target_count:
        RETURN pool

    // ── PHASE 3: Relax bedrooms (filter 4), type still relaxed, re-run all tiers ──
    FOR EACH tier IN tiers:
        candidates = search(subject, tier, hard_deck_strict=True)
        candidates = deduplicate(pool, candidates)
        candidates = apply_hard_deck(subject, candidates, relaxations=["type", "bedrooms"])
        tag_candidates(candidates, tier, relaxations=["type", "bedrooms"])
        pool += candidates
        IF len(pool) >= target_count:
            BREAK

    // ── Done ──
    RETURN pool
```

### 6.1 Key Behaviours

- **Cumulative pool**: Results from all tiers accumulate. Nothing is discarded.
- **Deduplication**: Before adding new candidates, check against existing pool by `transaction_id` or `(address, transaction_date, price)` composite key.
- **Tagging**: Every candidate carries metadata showing which tier found it and which relaxations were active. This feeds the UI transparency layer.
- **Early exit**: The loop breaks as soon as `pool.length >= target_count`. But the current tier always completes (don't stop mid-tier).
- **Phase 2 & 3 skip already-found**: Candidates already in the pool from earlier phases are not re-added.
- **Relaxation is cumulative**: Phase 3 retains the type relaxation from phase 2.

---

## 7. Implementation Notes

### 7.1 Street Name Normalisation

Land Registry data uses inconsistent street naming. Implement normalisation:

```python
def normalise_street(street: str) -> str:
    """Normalise street name for matching."""
    s = street.upper().strip()
    replacements = {
        "STREET": "ST", "ROAD": "RD", "AVENUE": "AVE",
        "DRIVE": "DR", "LANE": "LN", "CLOSE": "CL",
        "CRESCENT": "CRES", "GARDENS": "GDNS", "TERRACE": "TERR",
        "COURT": "CT", "PLACE": "PL", "GROVE": "GR",
        "SQUARE": "SQ", "PARK": "PK", "MOUNT": "MT",
        "RISE": "RI", "WAY": "WY", "WALK": "WK",
    }
    for full, abbr in replacements.items():
        s = s.replace(full, abbr)
    # Remove common noise
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s
```

### 7.2 Adjacent Outward Code Resolution

Two approaches, in order of preference:

1. **GIS boundary lookup**: Use ONS postcode district boundary polygons. For a given outward code, query all districts whose boundaries touch or are within a threshold distance (e.g., 500m buffer). Store as a pre-computed adjacency table.

2. **Centroid proximity fallback**: Use postcodes.io to get the centroid of each outward code. Find all outward codes whose centroids are within a configurable radius (e.g., 2km). Less precise but simpler.

```sql
-- Pre-computed adjacency table
CREATE TABLE outward_code_adjacency (
    outward_code TEXT NOT NULL,
    adjacent_code TEXT NOT NULL,
    distance_m FLOAT,
    PRIMARY KEY (outward_code, adjacent_code)
);
```

### 7.3 Building Name & Development Name Matching

Land Registry PAON (Primary Addressable Object Name) field often contains building names, but matching is unreliable due to inconsistencies. Strategy:

1. Extract building name from subject address or EPC data.
2. Normalise: uppercase, strip "THE", strip common suffixes ("HOUSE", "COURT", "TOWER", "POINT"), trim whitespace.
3. Use fuzzy matching (Levenshtein distance ≤ 2 or token-set similarity > 0.85) when comparing against Land Registry PAON values.
4. Development names are not present in Land Registry data. Source from EPC `building-reference` field or a manually curated development registry table.

### 7.4 Data Sources & Enrichment Pipeline

The search engine queries Land Registry Price Paid Data as the primary transaction source. However, Land Registry records lack several attributes needed for hard deck filtering (bedrooms, build year, floor area). These must be enriched from other sources.

```
Land Registry Price Paid   →  base transaction (price, date, address, tenure, type, new_build)
        ↓ join on address/UPRN
EPC Open Data              →  bedrooms, floor_area, build_year, building_era
        ↓ join on postcode
postcodes.io               →  outward_code, latitude, longitude
        ↓ optional
OS AddressBase             →  UPRN linkage, street name normalisation
```

**Critical enrichment gap**: If EPC data is unavailable for a candidate (not all properties have an EPC), bedrooms and build_year will be null. The system should:
- **Include** the candidate in results but flag it as "unverified spec".
- Let the valuer decide to accept or reject during manual review.

### 7.5 Time Window Application

Time windows are measured backwards from the **valuation date** (not today's date), as the valuer may be doing a retrospective valuation.

```python
def within_time_window(transaction_date: date, valuation_date: date, months: int) -> bool:
    cutoff = valuation_date - relativedelta(months=months)
    return transaction_date >= cutoff
```

---

## 8. Database Schema (Supabase)

### 8.1 Core Tables

```sql
-- Enriched transaction cache (Land Registry + EPC combined)
CREATE TABLE comparable_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id TEXT UNIQUE,       -- Land Registry transaction ID
    address TEXT NOT NULL,
    paon TEXT,                         -- Primary Addressable Object Name
    saon TEXT,                         -- Secondary Addressable Object Name
    street TEXT,
    street_normalised TEXT,            -- Output of normalise_street()
    postcode TEXT NOT NULL,
    outward_code TEXT NOT NULL,
    inward_code TEXT NOT NULL,
    uprn TEXT,

    -- Property attributes
    tenure TEXT NOT NULL CHECK (tenure IN ('freehold', 'leasehold')),
    property_type TEXT NOT NULL CHECK (property_type IN ('flat', 'house')),
    house_sub_type TEXT CHECK (house_sub_type IN ('detached', 'semi-detached', 'terraced', 'end-terrace')),
    bedrooms SMALLINT,                 -- NULL if unknown; 0 = studio
    floor_area_sqm NUMERIC,
    build_year SMALLINT,
    building_era TEXT CHECK (building_era IN ('period', 'modern')),
    building_name TEXT,
    building_name_normalised TEXT,
    development_name TEXT,

    -- Transaction
    price INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    new_build BOOLEAN DEFAULT FALSE,
    transaction_category TEXT CHECK (transaction_category IN ('A', 'B')),

    -- Metadata
    epc_matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the geographic tier queries
CREATE INDEX idx_comp_outward ON comparable_transactions(outward_code);
CREATE INDEX idx_comp_postcode ON comparable_transactions(postcode);
CREATE INDEX idx_comp_building ON comparable_transactions(outward_code, building_name_normalised);
CREATE INDEX idx_comp_development ON comparable_transactions(outward_code, development_name);
CREATE INDEX idx_comp_street ON comparable_transactions(outward_code, street_normalised);
CREATE INDEX idx_comp_date ON comparable_transactions(transaction_date DESC);

-- Composite index for hard deck filtering
CREATE INDEX idx_comp_hard_deck ON comparable_transactions(
    tenure, property_type, building_era, bedrooms
);

-- Adjacent outward codes (pre-computed)
CREATE TABLE outward_code_adjacency (
    outward_code TEXT NOT NULL,
    adjacent_code TEXT NOT NULL,
    distance_m FLOAT,
    PRIMARY KEY (outward_code, adjacent_code)
);

-- Valuer's selected comparables for a case
CREATE TABLE case_comparables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES cases(id),
    transaction_id UUID REFERENCES comparable_transactions(id),
    source TEXT NOT NULL CHECK (source IN ('system', 'manual')),
    selected BOOLEAN DEFAULT FALSE,     -- Valuer has confirmed this comp
    rejected BOOLEAN DEFAULT FALSE,     -- Valuer has explicitly rejected
    rejection_reason TEXT,
    geographic_tier SMALLINT,
    tier_label TEXT,
    spec_relaxations TEXT[],            -- e.g. ['type', 'bedrooms']
    valuer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 8.2 RLS Policies

```sql
-- Surveyors can only see comparables linked to their own cases
ALTER TABLE case_comparables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Surveyors see own case comparables"
    ON case_comparables FOR ALL
    USING (case_id IN (
        SELECT id FROM cases WHERE surveyor_id = auth.uid()
    ));

-- comparable_transactions is shared reference data, read-only for all authenticated users
ALTER TABLE comparable_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read transactions"
    ON comparable_transactions FOR SELECT
    USING (auth.role() = 'authenticated');
```

---

## 9. API Design

### 9.1 Endpoint

```
POST /api/comparables/search
```

### 9.2 Request Body

```json
{
  "case_id": "uuid",
  "subject": {
    "address": "Flat 5, Winterfell House, 12 Kings Road",
    "postcode": "SW12 8NX",
    "tenure": "leasehold",
    "property_type": "flat",
    "bedrooms": 2,
    "building_name": "Winterfell House",
    "development_name": "Kings Quarter",
    "build_year": 1985
  },
  "target_count": 10,
  "valuation_date": "2025-03-01"
}
```

### 9.3 Response Body

```json
{
  "subject": { "..." },
  "target_count": 10,
  "target_met": true,
  "comparables": [
    {
      "transaction_id": "...",
      "address": "Flat 12, Winterfell House, 12 Kings Road",
      "postcode": "SW12 8NX",
      "price": 525000,
      "transaction_date": "2024-11-15",
      "tenure": "leasehold",
      "property_type": "flat",
      "bedrooms": 2,
      "floor_area_sqm": 64.5,
      "building_era": "period",
      "geographic_tier": 1,
      "tier_label": "Same building",
      "spec_relaxations": [],
      "epc_matched": true
    }
  ],
  "search_metadata": {
    "tiers_searched": 3,
    "spec_relaxations_applied": [],
    "total_candidates_scanned": 847,
    "search_duration_ms": 1230
  }
}
```

---

## 10. UI Presentation (Guidance for Frontend)

### 10.1 Tiered Display

Present comparables grouped by tier, not as a flat list:

```
🏢 SAME BUILDING — Winterfell House (3 found)
   Flat 12 — 2 bed — £525,000 — Nov 2024
   Flat 3  — 2 bed — £510,000 — Jun 2024
   Flat 18 — 2 bed — £498,000 — Jan 2024

🏘️ SAME DEVELOPMENT — Kings Quarter (4 found)
   Flat 2, Stark Tower   — 2 bed — £540,000 — Sep 2024
   Flat 8, Lannister House — 2 bed — £515,000 — Jul 2024
   ...

📍 SAME OUTWARD CODE — SW12 (6 found)
   ...

📍 ADJACENT AREAS — SW11, SW17 (3 found)
   ...
```

### 10.2 Transparency Badges

Each comparable should display:
- **Match quality indicator**: Which tier it came from.
- **Relaxation warnings**: If type or bedrooms were relaxed, show clearly (e.g., "1-bed (subject is 2-bed)").
- **Data completeness**: If EPC data was missing, flag as "unverified spec".
- **Time distance**: Months since transaction.

### 10.3 Valuer Actions

For each comparable:
- **Select** → adds to the valuer's chosen comparables for the case.
- **Reject** → with optional reason (too dissimilar, known issues, etc.).
- **Add manual comp** → valuer enters details for a transaction the system didn't find.

---

## 11. File Structure

```
src/
  lib/
    comparables/
      types.ts              # TypeScript interfaces (§3)
      hard-deck.ts          # Hard deck filter logic (§4)
      tiers-flat.ts         # Flat geographic tier definitions (§5.1)
      tiers-house.ts        # House geographic tier definitions (§5.2)
      orchestrator.ts       # Main search loop (§6)
      normalisation.ts      # Street name, building name normalisation (§7.1, 7.3)
      adjacency.ts          # Outward code adjacency resolution (§7.2)
      enrichment.ts         # EPC/LR data joining logic (§7.4)
      time-window.ts        # Date calculations (§7.5)
    comparables/
      index.ts              # Public API: single entry point
  app/
    api/
      comparables/
        search/
          route.ts          # POST /api/comparables/search (§9)
  components/
    comparables/
      ComparableList.tsx     # Tiered display (§10.1)
      ComparableCard.tsx     # Individual comp with badges (§10.2)
      ComparableActions.tsx  # Select/reject/manual add (§10.3)
      ManualCompForm.tsx     # Manual entry form
supabase/
  migrations/
    xxx_comparable_transactions.sql   # Table creation (§8)
    xxx_outward_code_adjacency.sql    # Adjacency table
    xxx_case_comparables.sql          # Valuer selections
```

---

## 12. Implementation Priority

1. **Database tables & indexes** — Foundation for everything.
2. **Data ingestion pipeline** — Land Registry + EPC enrichment into `comparable_transactions`.
3. **Hard deck filter functions** — Pure logic, easily testable.
4. **Geographic tier search functions** — One per tier, querying Supabase.
5. **Search orchestrator** — The main loop that ties tiers together.
6. **API endpoint** — Thin wrapper around orchestrator.
7. **Frontend components** — Tiered list with select/reject actions.
8. **Adjacency table population** — Can use postcodes.io centroid data initially; upgrade to GIS boundaries later.
9. **Manual comp entry** — Allows valuer to add comps the system missed.

# PPD-EPC Address Matching — Implementation Reference

## ⚠️ IMPORTANT — ISOLATION RULES

**THIS IS A REFERENCE DOCUMENT ONLY. DO NOT build into PropVal yet.**

- Do NOT modify any files in the propval-mvp codebase
- Do NOT create branches, PRs, or commits in the propval-mvp repo
- If/when we decide to build this, it will be scoped as a separate task
- Save any experimental work to: `C:\Users\licww\Desktop\propval-mvp\Address matching experiment\`

## Context

PropVal needs to join two free UK government datasets to create enriched comparable records:

- **HMLR Price Paid Data (PPD):** sale price, date, property type, tenure, address (PAON, SAON, street, postcode). No floor area, no UPRN.
- **EPC Open Data (MHCLG):** floor area, habitable rooms, built form, construction age, energy rating, address (ADDRESS1, ADDRESS2, ADDRESS3, postcode). No sale price.

Joining them gives us **price + floor area = £/sqm** — the single most important metric for comparable analysis.

The problem: both datasets record addresses differently. There is no shared key (no UPRN, no title number). Matching must be done on address strings within the same postcode.

## Two Reference Implementations

### 1. Bin Chi (UCL, 2021)

- **Paper:** https://pmc.ncbi.nlm.nih.gov/articles/PMC10208353/
- **Code:** https://reshare.ukdataservice.ac.uk/854240/ (R + PostGIS)
- **Licence:** CC-BY-NC (non-commercial — we cannot use their code or pre-linked dataset commercially)
- **Match rate:** 93.15% for 2011–2019 (houses ~94%, flats ~89%)
- **Scale:** 24.8M PPD records, 18.6M EPC records, 5.7M linked output records
- **Approach:** 4-stage cascade, 251 matching rules, 282 derived address variables
- **Strengths:** Exhaustive edge-case coverage, rigorous statistical validation (K-S test, J-divergence), published methodology
- **Weaknesses:** R/PostGIS only, not designed for real-time use, NC licence

### 2. Centre for Net Zero (CNZ)

- **Repo:** https://github.com/centrefornetzero/epc-ppd-address-matching
- **Licence:** MIT (fully open for commercial use)
- **Approach:** Simple rule-based matching in Python, Parquet I/O, GNU Parallel for batch processing, Docker-ready
- **Strengths:** MIT licence, Python, production-oriented, clean architecture, partitioned by postcode for parallelism
- **Weaknesses:** Fewer matching rules (lower match rate than Bin Chi), no published match rate stats, relies on upstream dbt/BigQuery for data cleaning

## Synthesised Matching Strategy for PropVal

Take the best from both: Bin Chi's matching logic depth + CNZ's Python architecture and MIT-compatible approach.

### Core Principle

All matching happens **within a postcode partition**. Two records can only match if they share the same postcode. This massively reduces the search space.

### Address Field Mapping

| PPD Field | EPC Field | Notes |
|-----------|-----------|-------|
| `postcode` | `POSTCODE` | Exact match required — partition key |
| `SAON` | (embedded in ADDRESS1) | Flat/unit number. PPD has it as separate field; EPC buries it in ADDRESS1 |
| `PAON` | (embedded in ADDRESS1 or ADDRESS2) | Building number/name. PPD separates it; EPC may put it in ADDRESS1 or split across ADDRESS1+ADDRESS2 |
| `street` | ADDRESS2 or ADDRESS3 | Street name. Position varies in EPC depending on how assessor entered data |
| `locality` | ADDRESS3 or POST_TOWN | Sometimes present in PPD, always messy |

### Pre-Match Normalisation

Apply to ALL address strings from both datasets before any matching:

```python
import re

def normalise(s: str) -> str:
    """Normalise an address string for matching."""
    if not s:
        return ""
    s = s.upper().strip()
    # Remove punctuation that varies between datasets
    s = re.sub(r"['\.\-/,]", "", s)
    # Collapse multiple spaces
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def strip_all_spaces(s: str) -> str:
    """Remove ALL whitespace for the tightest comparison."""
    return re.sub(r"\s+", "", normalise(s))
```

### Label Normalisation

FLAT, APARTMENT, UNIT, and LOFT are used interchangeably across datasets:

```python
FLAT_SYNONYMS = {"APARTMENT", "APT", "UNIT", "LOFT"}

def normalise_flat_label(s: str) -> str:
    """Standardise flat/apartment/unit labels to 'FLAT'."""
    s = normalise(s)
    for synonym in FLAT_SYNONYMS:
        s = s.replace(synonym, "FLAT")
    return s
```

### Concatenation Strategy (from Bin Chi)

The key insight from Bin Chi: create multiple concatenated address strings from each dataset, then test equality between them. The PPD side concatenates SAON + PAON + Street in various ways; the EPC side concatenates ADDRESS1 + ADDRESS2 + ADDRESS3 in various ways.

**PPD concatenations (create all of these):**

```
ppd_full       = SAON + ", " + PAON + " " + Street     → strip spaces
ppd_full_nosep = SAON + " " + PAON + " " + Street      → strip spaces  
ppd_no_saon    = PAON + " " + Street                    → strip spaces
ppd_paon_loc   = PAON + " " + Street + " " + Locality   → strip spaces
```

**EPC concatenations (create all of these):**

```
epc_full     = ADDRESS                                   → strip spaces
epc_12       = ADDRESS1 + " " + ADDRESS2                 → strip spaces
epc_123      = ADDRESS1 + " " + ADDRESS2 + " " + ADDRESS3 → strip spaces
epc_13       = ADDRESS1 + " " + ADDRESS3                 → strip spaces
```

### Matching Cascade (4 tiers, ordered strictest → loosest)

Each tier removes matched records before passing unmatched to the next tier.

#### Tier 1 — Exact normalised match (~70% of matches)

```
Within same postcode:
  ppd_full == epc_full
  OR ppd_full == epc_12
  OR ppd_full == epc_123
```

After normalisation and space stripping. This catches all clean cases where both datasets recorded the address the same way.

#### Tier 2 — Punctuation + label normalised match (~15% of matches)

Same as Tier 1 but after additionally applying:
- FLAT/APARTMENT/UNIT/LOFT substitution
- Comma position doesn't matter (strip all commas)
- Hyphen removal (e.g. "FLAT 1-3" vs "FLAT 1 3")

```
Within same postcode:
  normalise_flat_label(ppd_full) == normalise_flat_label(epc_full)
  (and all other concatenation combinations)
```

#### Tier 3 — Component recombination (~8% of matches)

Handle cases where EPC assessor split the address differently from how PPD recorded it.

Key patterns to handle:

**PAON in different position:**
- PPD: SAON="FLAT 2", PAON="41", Street="TABERNACLE STREET"
- EPC: ADDRESS1="FLAT 2, 41 TABERNACLE STREET"
- Also: ADDRESS1="41", ADDRESS2="TABERNACLE STREET" (number in ADDRESS1, street in ADDRESS2)

**Building name split:**
- PPD: PAON="BURLEIGH COURT", Street="BELMONT ROAD"
- EPC: ADDRESS1="FLAT 10, BURLEIGH COURT", ADDRESS2="BELMONT ROAD"
- Need to extract building name from ADDRESS1 (after comma) and match to PAON

**Comma-split strategy (from Bin Chi):**
```python
def split_at_comma(s: str) -> tuple[str, str]:
    """Split address at first comma. Returns (before, after)."""
    if "," in s:
        parts = s.split(",", 1)
        return parts[0].strip(), parts[1].strip()
    return s.strip(), ""
```

Then match:
```
epc_addr1_before_comma + epc_addr2 == ppd_paon + ppd_street
epc_addr1_after_comma + epc_addr2 == ppd_saon + ppd_paon + ppd_street
```

#### Tier 4 — Number extraction + fuzzy (~2-5% of matches)

For the hardest cases:

**Extract house number from building name:**
```python
def extract_number(s: str) -> str | None:
    """Extract leading number from address string."""
    match = re.match(r"^(\d+[A-Z]?)\b", normalise(s))
    return match.group(1) if match else None
```

Match where the number from PPD PAON appears at the start of any EPC address field, AND the street name matches.

**"THE" prefix:**
- PPD: PAON="LODGE", EPC: ADDRESS1="THE LODGE"
- Try prepending "THE " to PAON

**"NO" removal:**
- EPC: ADDRESS1="NO 5 HIGH STREET"
- Strip "NO " or "NO." prefix

**Street name abbreviation:**
- "STREET" vs "ST", "ROAD" vs "RD", "AVENUE" vs "AVE", "LANE" vs "LN", "DRIVE" vs "DR", "COURT" vs "CT", "GARDENS" vs "GDNS", "PLACE" vs "PL", "TERRACE" vs "TCE", "CRESCENT" vs "CRES"

### Handling 1:N Matches (from Bin Chi)

One PPD transaction may match multiple EPC records (a property can have EPCs from different years). Resolution:

1. If only one EPC matches → use it
2. If multiple EPCs match:
   a. Filter out EPCs where `total_floor_area` is NULL or 0
   b. Pick the EPC with `inspection_date` closest to the PPD `transaction_date`
   c. This gives the most contemporaneous floor area measurement

```python
def resolve_multiple_epcs(epcs: list[dict], transaction_date: str) -> dict:
    """Pick the best EPC when multiple match the same transaction."""
    # Filter out EPCs with no usable floor area
    valid = [e for e in epcs if e.get("total_floor_area") and float(e["total_floor_area"]) > 0]
    if not valid:
        return epcs[0]  # fallback to first match
    if len(valid) == 1:
        return valid[0]
    # Pick closest inspection date to transaction date
    from datetime import datetime
    tx_date = datetime.strptime(transaction_date, "%Y-%m-%d")
    return min(valid, key=lambda e: abs(
        (datetime.strptime(e["inspection_date"], "%Y-%m-%d") - tx_date).days
    ))
```

### Data Cleaning Thresholds (from Bin Chi)

After matching, exclude records with implausible values:

| Check | Threshold | Reason |
|-------|-----------|--------|
| Floor area | < 9 sqm or > 974 sqm | Implausible dwelling size |
| £/sqm | < £200 or > £50,000 | Data entry error or non-standard transaction |
| Floor area per room | > 100 sqm/room | Likely wrong room count |
| Floor area per room | < 6.51 sqm/room | Below minimum habitable room size |
| Habitable rooms | > 20 | Likely data entry error |

### Architecture Notes (from CNZ)

- **Partition by postcode** before matching — dramatically reduces comparison space
- **Parquet format** for intermediate storage — columnar, fast, compressed
- **GNU Parallel** for batch processing — postcode partitions are embarrassingly parallel
- **Docker** for reproducibility
- **Separate IDs** — use MD5 hash of record as unique ID for join-back

### PropVal-Specific Considerations

For PropVal this will work differently from both reference implementations because we're doing **real-time matching** for individual comparables, not batch linkage of entire datasets.

**Batch pre-linkage approach (recommended for MVP):**
1. Download full PPD CSV + full EPC dataset monthly
2. Run batch matching offline (adapt CNZ parallel approach)
3. Store linked records in Supabase with: `ppd_transaction_id`, `epc_lmk_key`, `match_tier` (1-4), `price`, `floor_area`, `price_per_sqm`
4. At query time, just look up pre-linked records by postcode/address

**Real-time approach (future, for edge cases not in pre-linked data):**
1. Valuer enters/selects a comparable address
2. Query PPD via SPARQL for that address
3. Query EPC API for that address
4. Run matching logic client-side to link them
5. Present unified comp card with price + floor area

The batch approach is far simpler and more reliable. Real-time matching is a fallback for brand-new transactions not yet in the monthly batch.

### Match Rate Expectations

Based on Bin Chi's published results:

| Property Type | Expected Match Rate |
|--------------|-------------------|
| Detached | ~93% |
| Semi-Detached | ~95% |
| Terraced | ~94% |
| Flats/Maisonettes | ~89% |
| **Overall** | **~93%** |

Lower match rates in: City of London (71%), Isles of Scilly (77%), and prime central London boroughs (Camden, K&C, Westminster, H&F) at 80-90% — mostly due to complex addressing in mansion blocks and high-end conversions.

### Key Files to Reference

- **Bin Chi paper (full methodology):** https://pmc.ncbi.nlm.nih.gov/articles/PMC10208353/
- **Bin Chi appendix (all 282 variable definitions):** Table A in the paper above
- **CNZ Python repo (MIT):** https://github.com/centrefornetzero/epc-ppd-address-matching
- **EPC data download:** https://epc.opendatacommunities.org/
- **PPD data download:** https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads
- **GLA pre-linked £/sqm data (London, updated annually):** https://data.london.gov.uk/dataset/house-price-per-square-metre-in-england-and-wales

### Licensing Summary

| Resource | Licence | Commercial Use? |
|----------|---------|----------------|
| HMLR Price Paid Data | OGL | ✅ Yes |
| EPC Open Data | OGL (with address restrictions) | ✅ Yes (address data is Royal Mail copyright — can use but must attribute) |
| Bin Chi pre-linked dataset | CC-BY-NC | ❌ No |
| Bin Chi methodology/paper | CC-BY 4.0 | ✅ Yes (methodology can be reimplemented) |
| CNZ Python code | MIT | ✅ Yes |
| Our own linked dataset | Our own | ✅ Yes (derived from OGL sources using our own code) |

## Status

- **INSPIRE polygon centroid experiment:** CC is running this now. Results pending.
- **PPD-EPC matching:** Reference document only. No implementation decision yet.
- **Next step:** Review INSPIRE experiment results, then decide whether to proceed with PPD-EPC batch linkage as a separate experiment.

# PropVal — RICS Valuation Report Template Architecture

## Purpose

This document defines the architecture for PropVal's automated RICS-compliant valuation report. It serves as a specification for Claude Code to generate a `.docx` report template using `docx-js`. The report will be populated dynamically with property data and comparables sourced from PropVal's web application.

This is **not** a finished report. It is a template framework where placeholder fields (marked `{{FIELD_NAME}}`) are replaced at generation time with data from the PropVal API/database.

---

## 1. RICS Compliance Framework

### 1.1 Governing Standards

The report must comply with:

- **RICS Valuation – Global Standards (Red Book Global Standards)** effective 31 January 2025, incorporating the International Valuation Standards (IVS)
- **RICS Valuation – Global Standards: UK National Supplement** effective 31 January 2025
- **IVS 104 – Bases of Value** (Market Value, Market Rent definitions)
- **VPS 1 – Terms of Engagement** (scope, purpose, basis, assumptions)
- **VPS 2 – Inspections and Investigations** (extent of inspection, limitations)
- **VPS 3 – Valuation Reports** (minimum content requirements — see Section 3 below)
- **VPS 4 – Bases of Value, Assumptions and Special Assumptions**
- **VPS 5 – Valuation Approaches and Methods**
- **VPGA 2 – Valuation of Individual Trade Related Properties** (if applicable)
- **VPGA 8 – Valuation of Real Property Interests** (residential secured lending)
- **UK VPGA 11 – Valuation for Secured Lending** (UK-specific secured lending guidance)
- **RICS Professional Standard: Valuation of Residential Property** (UK, 1st Edition)
- **RICS Code of Measuring Practice, 6th Edition** (GIA/NIA measurement basis)

### 1.2 VPS 3 — Minimum Report Content (Mandatory)

Per VPS 3, every compliant valuation report **must** include:

1. Identification and status of the valuer (name, qualifications, firm, RICS registration)
2. Identification of the client and any other intended users
3. Purpose of the valuation
4. Identification of the asset(s) being valued
5. Basis(es) of value adopted (with definitions per IVS 104)
6. Valuation date
7. Extent of investigation (inspection type, date, limitations)
8. Nature and source of information relied upon
9. All assumptions and special assumptions made
10. Restrictions on use, distribution, or publication
11. Confirmation of compliance with IVS/Red Book
12. Valuation approach and reasoning
13. The valuation figure(s) — expressed in words and figures, in a specified currency
14. Date of the valuation report
15. Commentary on any material uncertainty (if applicable — PS 2)
16. Statement on the valuer's objectivity (conflict of interest declaration)

### 1.3 UK VPGA 11 — Secured Lending Requirements

For secured lending valuations, the report must additionally include:

- Confirmation the property is suitable security for lending purposes
- Commentary on saleability and marketability
- Reinstatement cost estimate for insurance purposes
- Identification of any factors that may affect value or saleability
- Environmental and flood risk commentary
- EWS1 / fire safety / cladding status (post-Grenfell requirement)
- Tenure details including unexpired lease term, ground rent, and review pattern
- Service charge obligations
- Tenancy details (if let) including rent, term, break clauses
- Transaction history of the subject property
- Sales comparable evidence with analysis
- Market commentary (national and local)

### 1.4 Definitions to Include (per IVS 104)

**Market Value:** The estimated amount for which an asset or liability should exchange on the valuation date between a willing buyer and a willing seller in an arm's length transaction, after proper marketing and where the parties had each acted knowledgeably, prudently and without compulsion.

**Market Rent:** The estimated amount for which an interest in real property should be leased on the valuation date between a willing lessor and a willing lessee on appropriate lease terms in an arm's length transaction, after proper marketing and where the parties had each acted knowledgeably, prudently and without compulsion.

---

## 2. Data Model — Placeholder Fields

All dynamic data is represented by `{{FIELD_NAME}}` placeholders. These map to PropVal's database/API output.

### 2.1 Instruction & Administration

| Field | Description | Source |
|-------|-------------|--------|
| `{{REPORT_REF}}` | Unique report reference number | PropVal auto-generated |
| `{{REPORT_DATE}}` | Date of report (DD MONTH YYYY) | User input |
| `{{VALUATION_DATE}}` | Date of valuation (DD MONTH YYYY) | User input |
| `{{INSPECTION_DATE}}` | Date of inspection (DD MONTH YYYY) | User input |
| `{{INSTRUCTION_DATE}}` | Date of client instruction | User input |
| `{{CLIENT_NAME}}` | Name of instructing client | User input |
| `{{CLIENT_ADDRESS}}` | Client postal address | User input |
| `{{APPLICANT_NAME}}` | Borrower / applicant name | User input |
| `{{BANK_REF}}` | Lender's reference number | User input |
| `{{PURPOSE}}` | Purpose of valuation | Default: "Secured lending purposes" |
| `{{VALUER_NAME}}` | Lead valuer full name + designations | User input |
| `{{VALUER_TITLE}}` | Valuer's job title | User input |
| `{{COUNTER_SIGNATORY_NAME}}` | Counter-signatory name + designations | User input |
| `{{COUNTER_SIGNATORY_TITLE}}` | Counter-signatory job title | User input |
| `{{FIRM_NAME}}` | Valuation firm name | User config |
| `{{FIRM_ADDRESS}}` | Firm registered address | User config |
| `{{FIRM_PHONE}}` | Firm phone number | User config |
| `{{FIRM_COMPANY_NUMBER}}` | Companies House number | User config |
| `{{FIRM_WEBSITE}}` | Firm website URL | User config |

### 2.2 Property Identification

| Field | Description | Source |
|-------|-------------|--------|
| `{{PROPERTY_ADDRESS}}` | Full property address | PropVal search result |
| `{{PROPERTY_ADDRESS_LINE1}}` | First line (e.g. "Flat 170, Compass House") | Parsed from address |
| `{{PROPERTY_ADDRESS_LINE2}}` | Street (e.g. "Smugglers Way") | Parsed from address |
| `{{PROPERTY_ADDRESS_LINE3}}` | Town/city | Parsed from address |
| `{{PROPERTY_POSTCODE}}` | Postcode | PropVal search result |
| `{{UPRN}}` | Unique Property Reference Number | OS Places API / EPC lookup |
| `{{TITLE_NUMBER}}` | HMLR title number(s) | User input / HMLR API |

### 2.3 Property Description (from PropVal + User Input)

| Field | Description | Source |
|-------|-------------|--------|
| `{{PROPERTY_TYPE}}` | e.g. "Flat", "House", "Maisonette" | EPC data / user input |
| `{{PROPERTY_SUBTYPE}}` | e.g. "Purpose-built", "Converted", "Period" | User input |
| `{{NUM_BEDROOMS}}` | Number of bedrooms | EPC data / user input |
| `{{FLOOR_LEVEL}}` | e.g. "2nd floor", "Ground floor" | User input |
| `{{BUILDING_NAME}}` | Name of building/development | Parsed from address |
| `{{DEVELOPMENT_NAME}}` | Wider development name (if applicable) | User input |
| `{{CONSTRUCTION_TYPE}}` | e.g. "Reinforced concrete frame" | User input |
| `{{EXTERNAL_FINISH}}` | e.g. "Facing brickwork and render" | User input |
| `{{ROOF_TYPE}}` | e.g. "Flat roof" | User input |
| `{{WINDOW_TYPE}}` | e.g. "Double-glazed aluminium-framed" | User input |
| `{{HEATING_TYPE}}` | e.g. "Gas central heating", "Electric radiators" | EPC data / user input |
| `{{BUILDING_AGE_APPROX}}` | Approximate year(s) of construction | User input |
| `{{NUM_STOREYS}}` | Total storeys in building | User input |
| `{{CONCIERGE}}` | Yes/No — concierge service | User input |
| `{{LIFT}}` | Yes/No — passenger lift | User input |
| `{{PARKING}}` | Parking description or "None" | User input |
| `{{COMMUNAL_FACILITIES}}` | e.g. "Gymnasium, swimming pool" | User input |
| `{{ACCOMMODATION_SCHEDULE}}` | JSON array of rooms with descriptions | User input |
| `{{CONDITION_SUMMARY}}` | e.g. "Good condition and decoration" | User input |
| `{{LIFE_EXPECTANCY}}` | e.g. "In excess of 25 years" | Default / user override |
| `{{ASPECT_VIEWS}}` | Description of outlook/views | User input |
| `{{BALCONY_TERRACE}}` | Balcony/terrace description or "None" | User input |
| `{{SPECIAL_FEATURES_NOTES}}` | Any material issues (construction noise, etc.) | User input |

### 2.4 Floor Area

| Field | Description | Source |
|-------|-------------|--------|
| `{{GIA_SQM}}` | Gross Internal Area in sq metres | EPC data / user input |
| `{{GIA_SQFT}}` | Gross Internal Area in sq feet | Calculated |
| `{{MEASUREMENT_BASIS}}` | "GIA" or "NIA" | Default: GIA |
| `{{SITE_AREA_ACRES}}` | Site area in acres (whole block for flats) | User input |
| `{{SITE_AREA_HECTARES}}` | Site area in hectares | Calculated |

### 2.5 Location & Transport (from PropVal APIs)

| Field | Description | Source |
|-------|-------------|--------|
| `{{LOCAL_AUTHORITY}}` | e.g. "London Borough of Wandsworth" | postcodes.io |
| `{{DISTANCE_CENTRAL_LONDON}}` | e.g. "4.0 miles southwest" | Calculated |
| `{{LOCALITY_DESCRIPTION}}` | Paragraph describing immediate area | AI-generated / user input |
| `{{TRANSPORT_DESCRIPTION}}` | Transport links paragraph | AI-generated from NaPTAN + user input |
| `{{AMENITIES_DESCRIPTION}}` | Shops, restaurants, amenities paragraph | AI-generated / user input |
| `{{OPEN_SPACES}}` | Parks and recreation paragraph | AI-generated / user input |
| `{{SCHOOLS_HEALTHCARE}}` | Schools and healthcare paragraph | DfE GIAS API / user input |
| `{{PTAL_RATING}}` | TfL PTAL rating (0–6b) | TfL API / user input |
| `{{NEAREST_STATION_1_NAME}}` | Name of nearest station | NaPTAN / user input |
| `{{NEAREST_STATION_1_DISTANCE}}` | Distance (metres or miles) | Calculated |
| `{{NEAREST_STATION_1_LINES}}` | Lines/services available | User input |
| `{{NEAREST_STATION_1_DESTINATIONS}}` | Key destinations and times | User input |
| `{{NEAREST_STATION_2_NAME}}` | Second nearest station (optional) | NaPTAN / user input |
| `{{NEAREST_STATION_2_DISTANCE}}` | Distance | Calculated |
| `{{NEAREST_STATION_2_LINES}}` | Lines/services | User input |
| `{{NEAREST_STATION_2_DESTINATIONS}}` | Key destinations and times | User input |

### 2.6 Environmental & Statutory (from PropVal APIs)

| Field | Description | Source |
|-------|-------------|--------|
| `{{FLOOD_ZONE_PLANNING}}` | e.g. "Flood Zone 1", "Flood Zone 3 with defences" | EA Flood API |
| `{{FLOOD_RISK_RIVERS_SEA}}` | Insurance risk level for rivers/sea | EA Flood API |
| `{{FLOOD_RISK_SURFACE_WATER}}` | Insurance risk level for surface water | EA Flood API |
| `{{FLOOD_DEFENCE_DESCRIPTION}}` | Description of flood defences (if any) | EA Flood API / user input |
| `{{GREEN_BELT}}` | "Yes" / "No" | Natural England API |
| `{{BROWNFIELD}}` | "Yes" / "No" | planning.data.gov.uk |
| `{{COAL_MINING}}` | Coal Authority status | Coal Authority website |
| `{{RADON_RISK}}` | e.g. "Less than 1%" | BGS / UK Radon |
| `{{GROUND_CONDITIONS}}` | Assumption text or specific commentary | BGS API / default |
| `{{ASBESTOS}}` | Assumption text | Default based on age |
| `{{JAPANESE_KNOTWEED}}` | Assumption text | Default |
| `{{CONTAMINATION}}` | Assumption text | Default |
| `{{EQUALITY_ACT}}` | Compliance assumption | Default |
| `{{LISTED_STATUS}}` | Listed building status or "Not listed" | NHLE API |
| `{{CONSERVATION_AREA}}` | "Yes" / "No" + name if applicable | planning.data.gov.uk |
| `{{AONB}}` | "Yes" / "No" | Natural England API |
| `{{PLANNING_APPLICATIONS}}` | Recent planning applications or "None found" | planning.data.gov.uk |

### 2.7 EPC Data (from EPC Open Data API)

| Field | Description | Source |
|-------|-------------|--------|
| `{{EPC_RATING}}` | e.g. "C (72)" | EPC API |
| `{{EPC_RATING_LETTER}}` | e.g. "C" | EPC API |
| `{{EPC_SCORE}}` | e.g. "72" | EPC API |
| `{{EPC_ISSUE_DATE}}` | Date of EPC certificate | EPC API |
| `{{EPC_EMISSIONS_RATE}}` | e.g. "28.0 kgCO2/m2 per year" | EPC API |
| `{{EPC_FLOOR_AREA}}` | Floor area per EPC | EPC API |
| `{{EPC_CERTIFICATE_NUMBER}}` | Certificate reference | EPC API |
| `{{EPC_VALID_UNTIL}}` | Expiry date | EPC API |

### 2.8 Council Tax

| Field | Description | Source |
|-------|-------------|--------|
| `{{COUNCIL_TAX_BAND}}` | e.g. "F" | VOA / user input |
| `{{COUNCIL_TAX_AUTHORITY}}` | Billing authority name | postcodes.io / user input |

### 2.9 Fire Safety / Cladding

| Field | Description | Source |
|-------|-------------|--------|
| `{{EWS1_STATUS}}` | "Provided — Option A1/A2/A3/B1/B2" or "Not provided" | User input |
| `{{EWS1_SIGNATORY}}` | Name and qualifications of EWS1 signatory | User input |
| `{{EWS1_DATE}}` | Date of EWS1 form | User input |
| `{{EWS1_COMMENTARY}}` | Standard reliance paragraph | Default text |
| `{{BUILDING_HEIGHT_18M}}` | Whether building exceeds 18m | User input |

### 2.10 Tenure

| Field | Description | Source |
|-------|-------------|--------|
| `{{TENURE_TYPE}}` | "Freehold" / "Leasehold" / "Share of Freehold" | HMLR API / user input |
| `{{LEASE_TERM_YEARS}}` | Original lease term (e.g. 999) | User input |
| `{{LEASE_START_DATE}}` | Lease commencement date | User input |
| `{{LEASE_UNEXPIRED_YEARS}}` | Calculated unexpired term | Calculated |
| `{{GROUND_RENT_AMOUNT}}` | Annual ground rent | User input |
| `{{GROUND_RENT_REVIEW_PATTERN}}` | e.g. "21-yearly upwards reviews linked to RPI" | User input |
| `{{GROUND_RENT_COMMENTARY}}` | Onerous ground rent risk commentary | Default / user override |
| `{{SERVICE_CHARGE_DESCRIPTION}}` | Standard lessee obligation text | Default |

### 2.11 Tenancy (if let)

| Field | Description | Source |
|-------|-------------|--------|
| `{{IS_LET}}` | Boolean — property currently let | User input |
| `{{TENANCY_TYPE}}` | e.g. "AST", "Company Let" | User input |
| `{{TENANCY_TERM}}` | e.g. "12 months", "60 months" | User input |
| `{{TENANCY_START_DATE}}` | Commencement date | User input |
| `{{TENANCY_END_DATE}}` | Expiry date | User input |
| `{{TENANCY_RENT_PCM}}` | Monthly rent (£) | User input |
| `{{TENANCY_RENT_PA}}` | Annual rent (£) | Calculated |
| `{{TENANCY_BREAK_CLAUSE}}` | Break clause details or "No break clause" | User input |
| `{{TENANCY_SPECIAL_NOTES}}` | e.g. serviced apartment use, subletting rights | User input |

### 2.12 Transaction History (from Land Registry)

| Field | Description | Source |
|-------|-------------|--------|
| `{{TRANSACTION_HISTORY}}` | JSON array: [{property, price, date}] | LR SPARQL / PropVal |

### 2.13 Sales Comparables (from PropVal)

| Field | Description | Source |
|-------|-------------|--------|
| `{{COMPARABLES}}` | JSON array of comparable objects (see schema below) | PropVal comparables engine |

**Comparable object schema:**
```json
{
  "address": "150 Compass House, Smugglers Way, London, SW18 1DB",
  "description": "2 bedroom Leasehold Flat on the 4th Floor...",
  "price": 520000,
  "size_sqft": 753,
  "price_psf": 690,
  "date": "Feb-25"
}
```

### 2.14 Valuation Considerations & Opinion

| Field | Description | Source |
|-------|-------------|--------|
| `{{VALUATION_CONSIDERATIONS}}` | Bullet points of valuation reasoning | User input / AI-assisted |
| `{{ADOPTED_RATE_PSF}}` | Adopted £ per sq ft rate | User input |
| `{{MARKET_VALUE}}` | Market Value figure (£) | User input |
| `{{MARKET_VALUE_WORDS}}` | Market Value in words | Auto-generated |
| `{{MARKET_RENT_PA}}` | Market Rent per annum (£) | User input |
| `{{MARKET_RENT_PA_WORDS}}` | Market Rent in words | Auto-generated |
| `{{MARKET_RENT_PCM}}` | Market Rent per calendar month (£) | Calculated |
| `{{SUITABLE_SECURITY}}` | "Yes" / "No" + commentary | User input |
| `{{REINSTATEMENT_COST}}` | Insurance reinstatement figure (£) | User input |
| `{{REINSTATEMENT_COST_WORDS}}` | Reinstatement in words | Auto-generated |
| `{{VALUATION_BASIS}}` | "Vacant possession" / "Subject to tenancy" | User input |

### 2.15 Market Commentary

| Field | Description | Source |
|-------|-------------|--------|
| `{{RICS_MARKET_SURVEY_TEXT}}` | Latest RICS UK Residential Market Survey extract | User input / web scrape |
| `{{RICS_SURVEY_MONTH_YEAR}}` | e.g. "December 2025" | User input |
| `{{RENTERS_RIGHTS_COMMENTARY}}` | Renters' Rights Act commentary | Default text (update as legislation progresses) |
| `{{LOCAL_MARKET_COMMENTARY}}` | Local area market observations | User input |

### 2.16 Broadband & Connectivity (from Ofcom API)

| Field | Description | Source |
|-------|-------------|--------|
| `{{BROADBAND_MAX_DOWNLOAD}}` | Max predicted download speed (Mbps) | Ofcom API |
| `{{BROADBAND_FIBRE_TYPE}}` | e.g. "FTTP available" | Ofcom API |
| `{{MOBILE_COVERAGE}}` | 4G/5G outdoor coverage summary | Ofcom API |

### 2.17 IMD / Socioeconomic (from ONS ArcGIS)

| Field | Description | Source |
|-------|-------------|--------|
| `{{IMD_DECILE}}` | IMD 2025 decile (1–10) | ONS ArcGIS |
| `{{IMD_RANK}}` | National rank out of 33,755 LSOAs | ONS ArcGIS |
| `{{LSOA_CODE}}` | LSOA code | postcodes.io |

### 2.18 Photographs

| Field | Description | Source |
|-------|-------------|--------|
| `{{PHOTOS}}` | JSON array: [{label, image_path}] | User upload |
| `{{EXTERIOR_PHOTO}}` | Cover page exterior photo | User upload |

---

## 3. Report Structure — Section-by-Section

### Cover Page (Section 0)

**Content:**
- Firm logo (top right)
- "REPORT ON VALUE" heading
- Exterior photograph `{{EXTERIOR_PHOTO}}`
- Property address block: `{{PROPERTY_ADDRESS_LINE1}}`, `{{PROPERTY_ADDRESS_LINE2}}`, `{{PROPERTY_ADDRESS_LINE3}}`, `{{PROPERTY_POSTCODE}}`
- "Our Reference" → `{{REPORT_REF}}`
- "Date of Report" → `{{REPORT_DATE}}`
- "On behalf of" → `{{CLIENT_NAME}}`
- Footer: firm name, addresses, company number, website, regulatory logos

**Page layout:** No header. Custom footer with firm details.

### Table of Contents (Section 0 continued)

**Content:**
1. Instructions, Scope of Enquiries & Investigations
2. The Property
3. Tenure and Market Commentary
4. Valuation

Appendices:
- Appendix I – Instruction (if applicable)
- Appendix II – Terms & Conditions and Valuation Methodology
- Appendix III – Ordnance Survey Map (if applicable)
- Appendix IV – Location Plans
- Appendix V – EWS1 Form (if applicable)
- Appendix VI – EPC Certificate

### Summary Page (Section 0 continued)

**Formatted as a two-column key-value table:**

| Label | Value |
|-------|-------|
| Property Address | `{{PROPERTY_ADDRESS}}` |
| Client Name | `{{CLIENT_NAME}}` |
| Client Address | `{{CLIENT_ADDRESS}}` |
| Applicant | `{{APPLICANT_NAME}}` |
| Bank Ref | `{{BANK_REF}}` |
| Valuation Firm | `{{FIRM_NAME}}` |
| Date of Report | `{{REPORT_DATE}}` |
| Date of Inspection | `{{INSPECTION_DATE}}` |
| Valuation Date | `{{VALUATION_DATE}}` |
| Name of Main Signatory | `{{VALUER_NAME}}` |
| Name of Counter Signatory | `{{COUNTER_SIGNATORY_NAME}}` |

---

### Section 1: Instructions, Scope of Enquiries & Investigations

This section satisfies **VPS 1** (Terms of Engagement) and **VPS 2** (Inspections and Investigations).

| Sub-section | Ref | Content |
|-------------|-----|---------|
| Instructions | 1.1 | Acknowledgement of instruction dated `{{INSTRUCTION_DATE}}`. Reference to Appendix I. |
| Client | 1.2 | Client identification: `{{CLIENT_NAME}}` for loan to `{{APPLICANT_NAME}}` (Bank Ref: `{{BANK_REF}}`). |
| Purpose of Valuation | 1.3 | Standard text: prepared for `{{CLIENT_NAME}}` to assess value for `{{PURPOSE}}`. **(VPS 3 requirement 3)** |
| Valuation Date | 1.4 | `{{VALUATION_DATE}}` **(VPS 3 requirement 6)** |
| Date of Inspection | 1.5 | `{{INSPECTION_DATE}}` **(VPS 2)** |
| Valuation Standards | 1.6 | Compliance statement referencing RICS Valuation – Global Standards effective 31 January 2025, the Red Book. Confirmation of no conflict of interest. **(VPS 3 requirement 11)** |
| Basis of Valuation | 1.7 | Market Value definition (IVS 104). Market Rent definition (IVS 104). **(VPS 3 requirement 5, VPS 4)** |
| Conflict of Interest | 1.8 | Declaration per PS 2. Previous valuation disclosure if applicable. **(VPS 3 requirement 16)** |
| Responsibility to Third Parties | 1.9 | Limitation of liability to named client only. |
| Disclosure & Publication | 1.10 | Standard restriction on publication/reproduction. **(VPS 3 requirement 10)** |
| Professional Indemnity Insurance | 1.11 | PII confirmation. Liability cap reference to T&Cs (Appendix II). |
| Expertise | 1.12 | Valuer identification: `{{VALUER_NAME}}` with relevant experience. External valuer confirmation. **(VPS 3 requirement 1)** |
| Inspection | 1.13 | Inspection type (internal and external) and date. **(VPS 2)** |
| Special Assumptions | 1.14 | `{{VALUATION_BASIS}}` — e.g. "Vacant possession" or "Subject to current tenancy". **(VPS 4)** |

---

### Section 2: The Property

This section satisfies **VPS 3** (property identification), **VPS 2** (investigation findings), and **UK VPGA 11** (secured lending property details).

| Sub-section | Ref | Content |
|-------------|-----|---------|
| Site | 2.1 | Title number(s): `{{TITLE_NUMBER}}`. Reference to OS Map in Appendix III. |
| Location | 2.2 | Local authority: `{{LOCAL_AUTHORITY}}`. Distance from central London: `{{DISTANCE_CENTRAL_LONDON}}`. Locality description: `{{LOCALITY_DESCRIPTION}}`. Transport: `{{TRANSPORT_DESCRIPTION}}`. Amenities: `{{AMENITIES_DESCRIPTION}}`. Open spaces: `{{OPEN_SPACES}}`. Schools/healthcare: `{{SCHOOLS_HEALTHCARE}}`. PTAL: `{{PTAL_RATING}}`. Nearest stations with distances, lines, and journey times. Location map insert. Reference to Appendix IV. |
| Description | 2.3 | Development overview: `{{DEVELOPMENT_NAME}}` description. Building description: `{{BUILDING_NAME}}`, construction, storeys, facilities. **Subject property**: `{{PROPERTY_TYPE}}`, `{{NUM_BEDROOMS}}` bed, `{{FLOOR_LEVEL}}`, flooring, views, balcony, heating, services. Accommodation schedule from `{{ACCOMMODATION_SCHEDULE}}`. Special notes: `{{SPECIAL_FEATURES_NOTES}}`. **Photographs** from `{{PHOTOS}}` — laid out in 2-column grid with captions. |
| Measurement | 2.4 | `{{MEASUREMENT_BASIS}}` per RICS Code of Measuring Practice 6th Edition. Table: `{{GIA_SQM}}` m² / `{{GIA_SQFT}}` ft². |
| Site Area | 2.5 | `{{SITE_AREA_ACRES}}` Acres (`{{SITE_AREA_HECTARES}}` Hectares). Note: for flats, refers to entire freehold block. |
| Photographs | 2.6 | Cross-reference to Description section. |
| Services | 2.7 | Mains water, electricity, drainage connected. |
| Condition | 2.8 | Standard assumption text re: uninspected parts, deleterious materials, untested services. Summary: `{{CONDITION_SUMMARY}}`. Life expectancy: `{{LIFE_EXPECTANCY}}`. |
| Environmental Matters | 2.9 | Standard assumption text re: contamination, Japanese Knotweed, environmental audit. |
| Green Belt | 2.10 | `{{GREEN_BELT}}` |
| Brownfield | 2.11 | `{{BROWNFIELD}}` |
| Coal Mining | 2.12 | `{{COAL_MINING}}` |
| Radon | 2.13 | `{{RADON_RISK}}` |
| Ground Conditions | 2.14 | `{{GROUND_CONDITIONS}}` |
| Asbestos | 2.15 | `{{ASBESTOS}}` |
| Equality Act | 2.16 | Standard compliance assumption. |
| Flood Risk | 2.17 | Planning zone: `{{FLOOD_ZONE_PLANNING}}`. Rivers & sea insurance risk: `{{FLOOD_RISK_RIVERS_SEA}}`. Surface water insurance risk: `{{FLOOD_RISK_SURFACE_WATER}}`. Flood defences: `{{FLOOD_DEFENCE_DESCRIPTION}}`. Flood zone map insert. |
| Fire Risk and Cladding | 2.18 | Post-Grenfell compliance assumption. EWS1 status: `{{EWS1_STATUS}}`. Standard reliance text. Reference to Appendix V. |
| Statutory and Planning Enquiries | 2.19 | Planning assumption text. Planning applications: `{{PLANNING_APPLICATIONS}}`. Listed status: `{{LISTED_STATUS}}`. Conservation area: `{{CONSERVATION_AREA}}`. AONB: `{{AONB}}`. |
| Energy Performance | 2.20 | MEES context paragraph. EPC table: property name, issue date (`{{EPC_ISSUE_DATE}}`), rating (`{{EPC_RATING}}`), emissions rate (`{{EPC_EMISSIONS_RATE}}`), floor area (`{{EPC_FLOOR_AREA}}`). Reference to Appendix VI. |
| Council Tax | 2.21 | Authority: `{{COUNCIL_TAX_AUTHORITY}}`. Band: `{{COUNCIL_TAX_BAND}}`. Chancel repair assumption. |
| Connectivity (Optional) | 2.22 | Broadband: `{{BROADBAND_MAX_DOWNLOAD}}` Mbps, `{{BROADBAND_FIBRE_TYPE}}`. Mobile: `{{MOBILE_COVERAGE}}`. *(New PropVal section — not in traditional reports but adds value)* |

---

### Section 3: Tenure and Market Commentary

This section satisfies **VPS 3** (nature and source of information), **VPS 5** (valuation approach), and **UK VPGA 11** (market/tenure commentary).

| Sub-section | Ref | Content |
|-------------|-----|---------|
| Tenure | 3.1 | `{{TENURE_TYPE}}`. Lease term: `{{LEASE_TERM_YEARS}}` years from `{{LEASE_START_DATE}}`. Ground rent: `{{GROUND_RENT_AMOUNT}}` pa, review: `{{GROUND_RENT_REVIEW_PATTERN}}`. Service charge standard text. Ground rent commentary: `{{GROUND_RENT_COMMENTARY}}`. |
| Tenancies | 3.2 | *(Conditional — only if `{{IS_LET}}` is true)* Tenancy type: `{{TENANCY_TYPE}}`, term: `{{TENANCY_TERM}}`, dates, rent: `{{TENANCY_RENT_PCM}}` pcm. Break clause: `{{TENANCY_BREAK_CLAUSE}}`. Special notes: `{{TENANCY_SPECIAL_NOTES}}`. Security of tenure assumption. |
| General Market Comments | 3.3 | RICS survey extract: `{{RICS_MARKET_SURVEY_TEXT}}` (attributed to `{{RICS_SURVEY_MONTH_YEAR}}` RICS UK Residential Market Survey). Renters' Rights commentary: `{{RENTERS_RIGHTS_COMMENTARY}}`. |
| Transaction History | 3.4 | Table from `{{TRANSACTION_HISTORY}}`: Property, Sold Price, Sold Date. |
| Residential Sales Comparables | 3.5 | Table from `{{COMPARABLES}}`: Property (address in bold italic), Description, Price (£), Size (sq ft), £ psf, Date. |
| Valuation Considerations | 3.6 | Bullet points from `{{VALUATION_CONSIDERATIONS}}`. Adopted rate: `{{ADOPTED_RATE_PSF}}` psf. **(VPS 5 — valuation approach and reasoning)** |

---

### Section 4: Valuation

This section satisfies **VPS 3** (valuation figure in words and figures) and **UK VPGA 11** (security suitability, reinstatement).

| Sub-section | Ref | Content |
|-------------|-----|---------|
| Methodology | 4.1 | Standard comparable method text. **(VPS 5)** |
| Market Rent | 4.2 | `{{MARKET_RENT_PA}}` (`{{MARKET_RENT_PA_WORDS}}`) per annum. Market Rent definition repeated. |
| Market Value | 4.3 | **`{{MARKET_VALUE}}`** (**`{{MARKET_VALUE_WORDS}}`**). Basis: `{{VALUATION_BASIS}}`. **(VPS 3 requirement 13)** |
| Suitable Security | 4.4 | `{{SUITABLE_SECURITY}}` commentary. **(UK VPGA 11)** |
| Reinstatement Costs | 4.5 | `{{REINSTATEMENT_COST}}` (`{{REINSTATEMENT_COST_WORDS}}`). Standard disclaimers re: demolition, professional fees, VAT, inflation, loss of rent. **(UK VPGA 11)** |
| General Comments | 4.6 | Confidentiality, third-party limitation, publication restriction. |
| Report Signatures | 4.7 | Prepared by: `{{VALUER_NAME}}`, `{{VALUER_TITLE}}`. Checked by: `{{COUNTER_SIGNATORY_NAME}}`, `{{COUNTER_SIGNATORY_TITLE}}`. RICS Registered Valuer logo placeholder. Firm name. Date: `{{REPORT_DATE}}`. |

---

### Appendices

| Appendix | Content |
|----------|---------|
| I – Instruction | Scanned/embedded instruction letter (optional — user upload) |
| II – Terms & Conditions | Standard firm T&Cs and Valuation Methodology. Include: General Terms (Section 1) and Assumptions/Methodology (Section 2) per Red Book PS 1 and VPS 1. |
| III – Ordnance Survey Map | OS map with site boundary edged red (user upload / OS Maps API) |
| IV – Location Plans | Wide-area and local-area maps (user upload / generated) |
| V – EWS1 Form | Scanned EWS1 form (user upload — conditional on building height/type) |
| VI – EPC Certificate | EPC certificate pages (user upload or link to gov.uk) |

---

## 4. Design Specification

### 4.1 Page Setup

- **Paper size:** A4 (11,906 x 16,838 DXA)
- **Margins:** Top 1440, Bottom 1440, Left 1440, Right 1440 (1 inch all round)
- **Content width:** 9,026 DXA
- **Orientation:** Portrait

### 4.2 Typography

| Element | Font | Size (pt) | Weight | Colour |
|---------|------|-----------|--------|--------|
| Body text | Arial | 11 | Regular | Black (#000000) |
| Section headings (H1) | Arial | 16 | Bold | Black |
| Sub-section headings (H2) | Arial | 12 | Bold | Black |
| Sub-sub headings (H3) | Arial | 11 | Bold | Black |
| Table header cells | Arial | 10 | Bold | Black on light grey (#D9D9D9) |
| Table body cells | Arial | 10 | Regular | Black |
| Cover page title | Arial | 24 | Bold | Black |
| Cover page property address | Arial | 16 | Bold | Red (#CC0000) or firm brand |
| Footer text | Arial | 8 | Regular | Grey (#666666) |
| Header text | Arial | 8 | Regular | Red (#CC0000) + Grey |

### 4.3 Header (all pages except cover)

- Left: "Valuation Report" (red, bold) + line break + `{{PROPERTY_ADDRESS}}` (grey, regular)
- Right: Firm logo

### 4.4 Footer (all pages)

- Left: Firm name + addresses + company number + website
- Right: "Page X of Y"
- Separator: thin horizontal rule above footer

### 4.5 Table Styling

- Borders: light grey (#CCCCCC), single, 1pt
- Header row: light grey fill (#D9D9D9)
- Cell padding: top/bottom 80 DXA, left/right 120 DXA
- Alternating row shading: optional light blue (#F2F7FB) for readability

### 4.6 Section Numbering

- Sections numbered 1–4
- Sub-sections numbered x.1, x.2, etc.
- Presented in a two-column layout: left column = label (bold), right column = content
- This matches the Grant Stanley format and is standard for RICS secured lending reports

### 4.7 Colour Palette (Configurable)

| Use | Default | Description |
|-----|---------|-------------|
| Primary accent | #CC0000 | Section headers, cover page, firm brand |
| Secondary accent | #333333 | Sub-headers |
| Table header fill | #D9D9D9 | Light grey |
| Flood Zone / EPC RAG colours | Various | Green/Amber/Red per risk level |
| Body text | #000000 | Black |
| Muted text | #666666 | Footer, annotations |

---

## 5. Implementation Notes for Claude Code

### 5.1 Technology

- **Generation:** Node.js with `docx-js` (`npm install -g docx`)
- **Template engine:** A JavaScript function that accepts a JSON data object matching the field schema above, and outputs a `.docx` buffer
- **Validation:** `python scripts/office/validate.py` after generation

### 5.2 Conditional Sections

The following sections are conditional:

- **Tenancies (3.2):** Only rendered if `{{IS_LET}}` is true
- **EWS1 (2.18 + Appendix V):** Only rendered if building is 18m+ or EWS1 has been provided
- **Connectivity (2.22):** Only rendered if Ofcom data is available
- **Appendix I (Instruction):** Only if instruction letter is uploaded
- **Appendix III (OS Map):** Only if map image is uploaded/generated
- **Second/third nearest stations:** Only if data provided

### 5.3 Data Flow

```
PropVal Web App
  |-- User enters postcode -> PropVal API searches
  |   |-- EPC Open Data API -> property details, EPC rating, floor area
  |   |-- Land Registry SPARQL -> transaction history, sold prices
  |   |-- postcodes.io -> LSOA, local authority, coordinates
  |   |-- OS Places API -> UPRN, rooftop coordinates
  |   |-- EA Flood API -> flood zones, risk levels
  |   |-- Ofcom API -> broadband/mobile coverage
  |   |-- NHLE API -> listed building status
  |   |-- Natural England API -> AONB, SSSI, Green Belt
  |   |-- planning.data.gov.uk -> conservation area, planning apps
  |   |-- ONS ArcGIS -> IMD 2025 decile
  |   |-- DfE GIAS -> nearby schools
  |   '-- NaPTAN -> nearest transport nodes
  |
  |-- User selects property -> property results page displays
  |-- User selects comparables from search results
  |-- User enters manual fields (tenure, tenancy, condition, etc.)
  |
  '-- User clicks "Generate Report"
      |-- PropVal backend serialises all data to JSON
      |-- Node.js report generator receives JSON
      |-- docx-js builds .docx from template architecture
      |-- Validate with scripts/office/validate.py
      '-- Return .docx to user for download
```

### 5.4 JSON Input Schema (Top-Level)

```json
{
  "admin": { },
  "property": { },
  "description": { },
  "floor_area": { },
  "location": { },
  "environmental": { },
  "epc": { },
  "council_tax": { },
  "fire_safety": { },
  "tenure": { },
  "tenancy": { },
  "transaction_history": [ ],
  "comparables": [ ],
  "valuation": { },
  "market_commentary": { },
  "connectivity": { },
  "imd": { },
  "photos": [ ],
  "firm_config": { }
}
```

### 5.5 Default Text Blocks

Many sub-sections use standardised assumption text that rarely changes. These should be stored as constants in the generator and only overridden when the user provides custom text. Examples:

- Environmental matters assumption (2.9)
- Condition assumption (2.8)
- Equality Act assumption (2.16)
- EWS1 reliance text (2.18)
- Publication restriction (1.10)
- Third-party limitation (1.9)
- Reinstatement disclaimer (4.5)
- Methodology text (4.1)
- Service charge obligation text (3.1)

---

## 6. Versioning

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | March 2026 | Initial architecture based on Grant Stanley report format analysis. Red Book Global Standards effective 31 January 2025. |

---

## 7. Future Enhancements

- **Auto-generation of location descriptions** using AI from PropVal's aggregated API data
- **Comparable evidence scoring** — automated weighting based on proximity, date, size similarity
- **HPI trend charts** embedded as images (from HMLR UK HPI SPARQL data)
- **Noise mapping data** (DEFRA) as an additional environmental section
- **BGS geology summary** for ground condition commentary
- **Schools proximity table** from DfE GIAS with distances
- **IMD domain breakdown table** from ONS ArcGIS
- **Digital signatures** for valuer sign-off
- **PDF export** as alternative to .docx

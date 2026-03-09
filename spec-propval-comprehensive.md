# PropVal MVP — Comprehensive Specification
# Account Hierarchy, Report Typing Tab & Content Automation
# Date: 9 March 2026

---

## 1. Multi-Tenant Firm Architecture

The platform is a B2B SaaS product. The tenant unit is the **firm**, not the individual user.

- **Firm** — the paying client (a chartered surveying practice). One subscription, one workspace. All firm-level settings, branding, templates, and data live under this entity.
- **Users** — individual accounts belonging to a firm. Every user belongs to exactly one firm.

---

## 2. User Roles & Permissions

### 2.1 Firm Admin (`firm_admin`)

Typically 1–5 per firm (directors, partners, compliance leads). Full authority over firm-level settings.

**Firm Branding & Report Template Control:**
- Upload and manage firm logo
- Configure report header template (firm name, office addresses, phone numbers, company registration number, website)
- Configure report footer template (firm details, page numbering format, disclaimer text)
- Set professional body logos/badges (e.g. RICS Registered Valuer badge)
- Manage approved report templates — control which sections appear, section ordering, approved boilerplate text (T&Cs, valuation methodology, conflict of interest declarations, PI insurance wording, third-party disclaimers, disclosure clauses, Equality Act assumptions, environmental disclaimers, fire risk/cladding standard wording, general comments)
- Set report numbering format/sequence (auto or manual mode)
- Set date display format for the firm
- Manage firm-wide default settings — default valuation bases, standard assumptions, approved comparable sources

**Client Register Management:**
- Maintain the client list (client name + client address pairs)
- Support multiple addresses per client (e.g. bank with multiple branches)
- Add, edit, deactivate clients

**Staff Register & Signature Authority:**
- Maintain the staff list — full name, qualifications (MRICS, FRICS, MSc, BSc Hons etc.), job title, RICS registration number, signature image
- Set signing authority flags per user: `can_sign_as_preparer` and `can_sign_as_countersignatory`
- These flags control who appears in the preparer and counter-signatory dropdowns during case setup

**User Management:**
- Invite new users, deactivate accounts, assign/change roles
- View all users within the firm

**Case Visibility:**
- View all cases across the firm
- Audit trail access — who created, edited, submitted, reviewed, issued each report

**Content Management:**
- Upload/paste latest RICS market survey commentary (residential, commercial) for auto-insertion
- Manage AI prompt templates for controlled AI-generated sections (location description, local market commentary, property description, valuation considerations)
- Manage common special assumption tick-box options
- Manage EWS1 decision tree and standard disclaimers
- Manage rebuild cost rate table for BIRC calculations

### 2.2 Senior Valuer (`senior_valuer`)

Experienced valuers who can counter-sign reports.

- Everything a `valuer` can do
- Counter-sign reports — act as checking/reviewing signatory
- View cases assigned to them for QA/review
- Reassign cases between valuers (within the firm)
- Cannot change firm-level settings, branding, or templates

### 2.3 Valuer (`valuer`)

The standard user — surveyor doing day-to-day valuation work.

- Create new cases
- Edit their own cases — input data, upload documents, add comparables, type report sections, use AI assistance
- View their own cases only (cannot see other valuers' cases unless shared/assigned)
- Generate reports using the firm's approved templates (branding and boilerplate auto-applied)
- Submit for QA — mark a report as ready for review
- Cannot change any firm settings, templates, branding, or report formatting
- Cannot view or manage other users

---

## 3. Signature Authority & Case Allocation

### 3.1 Signature Authority

Every valuation report carries two signatures: the **preparer** (wrote the report) and the **counter-signatory** (checked the report). Both carry personal professional liability.

- Firm admins control signing authority via boolean flags on each user profile
- `can_sign_as_preparer` — authority to sign as report preparer (main signatory)
- `can_sign_as_countersignatory` — authority to counter-sign/check reports
- The preparer dropdown at case setup only shows users with preparer authority
- The counter-signatory dropdown only shows users with counter-signatory authority
- Signature details (name, qualifications, job title, signature image) are pulled from profiles — never manually typed in reports

### 3.2 Case Lifecycle

```
Draft → In Progress → Submitted for QA → Under Review → Revision Required (loop back) → Approved → Issued
```

- **Draft** — case created, basic details entered
- **In Progress** — preparer actively working (data collection, enrichment, comparables, report typing)
- **Submitted for QA** — preparer marks report complete; counter-signatory must be assigned if not already
- **Under Review** — counter-signatory reviewing; case appears in their review queue
- **Revision Required** — counter-signatory flags issues; goes back to preparer with notes
- **Approved** — counter-signatory satisfied; both signatures locked onto the report
- **Issued** — final report generated with firm branding, both signatures, all appendices; becomes read-only; audit trail records everything

### 3.3 Signature Rendering

- Counter-signatory's signature only renders once they approve through QA workflow
- Until approval, the counter-signatory section shows "pending review"
- Prevents report being issued with a counter-signature before actual review
- If a user's qualifications or job title change, they update their profile once — all future reports reflect it automatically
- Historical issued reports retain the details as they were at time of issue

---

## 4. Report Content Categories

Every piece of content in a valuation report falls into one of seven categories:

### Category A — Firm Template (set once by admin, never touched by valuers)
Header, footer, logo, professional badges, T&Cs, valuation methodology, PI insurance wording, conflict of interest standard declaration, disclosure/publication clause, third-party responsibility clause, Equality Act assumption, basis of valuation definitions, environmental disclaimers, fire risk standard wording, general comments, reinstatement cost disclaimers.

### Category B — Case Metadata (entered/selected once, echoed everywhere)
Valuation date, inspection date, instruction date, date of report, client name, client address, applicant name, bank reference, property address, report reference number, preparer name/qualifications/title, counter-signatory name/qualifications/title, valuation purpose, report type, inspection type. Each entered or selected once — the system echoes it everywhere it appears. Zero repetition, zero typo risk.

### Category C — Auto-populated from APIs & Data Enrichment
Title number, local authority, borough, PTAL rating, flood risk zone, EPC rating/data, council tax band, radon risk, coal mining status, listed building status, conservation area status, green belt, brownfield, AONB, planning history (semi-auto search), nearest station/transport times, property coordinates, OS maps, location plans.

### Category D — AI-Assisted Professional Content (controlled AI generation)
Location description, subject development description, subject building description (from photos/brochure), local market commentary, valuation considerations (reverse-engineered from Section 4), subject property summary paragraph (from proforma data). All generated using firm-managed AI prompt templates with reference examples for style, tone, length, and factual accuracy control.

### Category E — Valuer-Only Professional Content
Accommodation schedule (via smart proforma), comparable evidence selection and analysis, final Market Value/Market Rent/BIRC figures, special assumptions (tick box + free text), condition observations, any bespoke professional commentary.

### Category F — Automated Assembly (zero professional skill required)
Photo insertion and captioning, table of contents generation, appendix assembly and ordering, cover page assembly, page numbering, OS map generation, location plan generation, comparable evidence table formatting, number-to-words conversion, date formatting.

### Category G — QA (massively reduced by above)
Counter-signatory reviews professional judgement only — comp selection, rationale, valuation figure. Typos eliminated by single-source data. Calculation errors eliminated by system computation. Contradictions eliminated by AI reading full report. Outdated data eliminated by live API feeds. QA reduced from 1-2 hours to 15-20 minutes of focused professional review.

---

## 5. Report Typing Tab — Page-by-Page Specification

### 5.1 Cover Page (Page 1)

| Element | Category | Source | Valuer Action |
|---|---|---|---|
| Firm logo | A | Firm settings | None |
| Report title | A | Firm template / report type selection | None |
| Subject property photo | F | Main elevation photo tagged in proforma | None (uploaded earlier) |
| Property address | C | Case data (already searched/acknowledged) | None |
| Report reference number | B | Auto-generated or manually entered (firm setting controls mode) | Confirm or enter |
| Date of report | B | Calendar date picker at case setup | One click |
| Client name | B | Dropdown from admin-managed client register | One click |
| Client address | B | Auto-populates when client selected (supports multiple branches) | None (or select branch) |
| Firm branding (footer area) | A | Firm settings | None |

**Valuer effort: ~30 seconds. Select client, pick dates, confirm reference.**

### 5.2 Table of Contents (Page 2)

Entirely system-generated. Based on which sections exist and which appendices are attached. Section structure defined by firm-level report template. Page numbers generated at final report output.

**Valuer effort: Zero.**

### 5.3 Summary Information Page (Page 3)

| Element | Category | Source | Valuer Action |
|---|---|---|---|
| Report type title (e.g. "Valuation Report for Secured Lending Purposes") | B | Valuation purpose selected at case setup | None (selected earlier) |
| Property address | C | Case data | None |
| Client name | B | Selected at cover page setup | None (echoed) |
| Client address | B | Auto-populated with client selection | None (echoed) |
| Applicant name | B | Entered at case setup | One text input |
| Bank reference | B | Entered at case setup | One text input |
| Valuation firm | A | Firm settings | None |
| Date of report | B | Calendar pick | None (echoed) |
| Date of inspection | B | Calendar pick | None (echoed) |
| Valuation date | B | Calendar pick | None (echoed) |
| Main signatory name + qualifications | B | Preparer profile (selected from dropdown) | None (selected earlier) |
| Counter-signatory name + qualifications | B | Counter-signatory profile (selected from dropdown) | None (selected earlier) |

**Valuer effort: Two text inputs (applicant, bank reference). Everything else echoed.**

### 5.4 Section 1: Instructions, Scope of Enquiries & Investigations (Pages 4-5)

| Sub-clause | Category | Source | Valuer Action |
|---|---|---|---|
| 1.1 Instructions — instruction date, appendix reference | A+B | Boilerplate + instruction date echoed | None |
| 1.2 Client — client name, applicant, bank ref | A+B | Boilerplate + case data echoed | None |
| 1.3 Purpose of Valuation — valuation purpose | A+B | Boilerplate adapts to purpose selected at case setup | None |
| 1.4 Valuation Date | B | Calendar pick echoed | None |
| 1.5 Date of Inspection | B | Calendar pick echoed | None |
| 1.6 Valuation Standards — Red Book reference | A | Firm boilerplate | None |
| 1.7 Basis of Valuation — MV, MR, MV 90-day, MV 180-day, BIRC etc. | A+E | Tick box selection; definitions are firm boilerplate per basis | Tick which bases apply |
| 1.8 Conflict of Interest — standard declaration + case-specific confirmations | A+E | Boilerplate + yes/no checklist (valued in last 24 months? any conflict?) | Confirm yes/no |
| 1.9 Responsibility to Third Parties | A | Firm boilerplate | None |
| 1.10 Disclosure & Publication | A | Firm boilerplate | None |
| 1.11 PI Insurance and Limitations on Liability | A | Firm boilerplate | None |
| 1.12 Expertise — valuer name, qualifications, experience | A+B | Boilerplate + preparer profile data | None |
| 1.13 Inspection — inspection type, date, valuer name | A+B | Boilerplate adapts to inspection type selected at case setup | None |
| 1.14 Special Assumptions | E | Tick box for common assumptions (admin-managed list, e.g. vacant possession) + free text for bespoke | Tick and/or type |

**Valuer effort: Tick basis of valuation boxes, confirm conflict of interest, set special assumptions. ~2 minutes.**

### 5.5 Section 2: The Property (Pages 6-16)

#### 2.1 Site — Title Number
| Element | Category | Source | Valuer Action |
|---|---|---|---|
| Title number | C | Land Registry data | Confirm |
| Appendix reference to OS map | A | Boilerplate | None |

#### 2.2 Location Description (Pages 6-7)
| Element | Category | Source | Valuer Action |
|---|---|---|---|
| Full location commentary | D | AI-generated using firm's prompt template + subject address | Quick verify/edit |
| Local authority, borough | C | Postcode lookup | None |
| Distance to central London | C | Calculated from coordinates | None |
| Area character, amenities, transport | C+D | API data + AI prose | Verify |
| PTAL rating + explanation | C+A | TfL API + boilerplate explanation | None |
| Road connectivity, distances | C | Calculated from coordinates | None |
| Nearest station, journey times | C | Transport APIs | None |
| Location map | C+F | Auto-generated from coordinates | None |

**AI generation flow:** Admin provides reference template for location descriptions. System feeds subject address into the AI with the template. AI researches and generates. Output saved to case. Valuer reviews and edits if needed. Regenerate option available (with overwrite warning).

**Valuer effort: Quick read and verify. ~1-2 minutes.**

#### 2.3 Property Description (Pages 8-12)

Three-part macro-to-micro approach:

**Part 1: Subject Development**
- Only applicable if property is within a named development (toggle: yes/no)
- If yes: AI generates from uploaded brochure + online research using firm template
- If no: section skipped entirely, report starts with Subject Building
- Valuer effort: verify only

**Part 2: Subject Building**
- AI generates from uploaded brochure + inspection photos (especially external photos)
- AI can read: building form, architectural style, materials, roof type, window types, entrance features, number of visible storeys, general condition
- Useful photos the valuer naturally takes during standard inspection protocol: front elevation, rear elevation, entrance/lobby, floor directory board (for flats), lift buttons (for flats)
- Valuer effort: upload photos (already taken), verify AI output

**Part 3: Subject Property — Smart Proforma**
- NOT AI-generated — structured proforma with smart dropdowns
- Step 1: Select floor levels (basement, lower ground, ground, first, second, loft etc.)
- Step 2: Add rooms per floor — room type dropdown (bedroom, living room, kitchen, bathroom, WC, utility, store, study, entrance, hallway, dressing room + free text option)
- Step 3: Smart quick-select descriptions per room type:
  - Kitchen: wall/base units, worktop material (stone/granite/laminate), appliances (gas stove, electric hob, induction, oven, dishwasher, fridge, washing machine)
  - Bathroom: panelled bath, shower cubicle, overhead/handheld shower, vanity, basin, WC, mirror
  - Bedroom: wardrobe, en-suite, fitted furniture
  - Tick what's present + free text for anything extra
- Step 4: Photo upload integrated into proforma — each room row has an upload slot. Photo inherits room name as caption automatically.
- Step 5: Additional fields — orientation (dropdown: N/NE/E/SE/S/SW/W/NW), outlook (quick-select + free text), flooring types, heating type, balcony/terrace
- Photos are uploaded and tagged in the proforma but displayed wherever the valuer or firm template dictates (inline, dedicated photo pages, or appendix)

**AI Summary Paragraph:** Once proforma is complete, AI reads the proforma data and generates a standardised summary paragraph (floor level, bedrooms, layout, finishes, orientation, outlook, services). Firm template controls style. Valuer reviews and edits.

**Valuer effort: Fill proforma from inspection notes, upload photos. ~15-20 minutes. No prose writing.**

#### 2.4 Measurement
| Element | Category | Source | Valuer Action |
|---|---|---|---|
| Measurement basis reference (RICS 6th Edition) | A | Boilerplate | None |
| GIA figure (sqm and sqft) | E | Valuer adopts from comparison | Select adopted figure |
| Unit conversion | F | Automatic | None |

**Measurement comparison tool:** System presents multiple size sources side by side:
- Measured GIA — from built-in spreadsheet-like measurement table (floor, room, length, width, area; auto-summing per floor and overall)
- EPC floor area — auto-populated from API
- Brochure/floor plan area — valuer input
- Previous valuation record GIA — pulled from platform's own database if firm has valued before

Valuer selects which figure to adopt. System flags significant discrepancies. Measurement table stored as audit evidence for QA.

#### 2.5 Site Area
Single number entry. Auto-converts between acres and hectares.

#### 2.6 Photographs Reference
Boilerplate sentence. Auto-generated.

#### 2.7 Services
Tick box: gas, water, electricity, drainage. System generates sentence from selections.

#### 2.8 Condition
- Standard disclaimers about no building survey etc. — Category A boilerplate
- General condition: dropdown (good / fair / poor)
- Specific observations: free text field
- Life expectancy: default "in excess of 25 years subject to reasonable maintenance" (market practice standard)
- AI drafts condition paragraph from dropdown selection + observations using firm template

#### 2.9–2.14 Environmental & Compliance Checks
All auto-populated from the platform's existing ESG/enrichment data tab:

| Check | Source | Valuer Action |
|---|---|---|
| 2.9 Environmental Matters | A (boilerplate disclaimers) | None |
| 2.10 Green Belt | C (planning data API) | None |
| 2.11 Brownfield | C (DEFRA/planning data) | None |
| 2.12 Coal Mining | C (Coal Authority data) | None |
| 2.13 Radon | C (UK Radon data) | None |
| 2.14 Ground Conditions | A (boilerplate assumption) | None |

Platform can auto-generate and attach additional maps (flood, noise, IMD, pollution) as appendices for a more comprehensive and professional report. Zero extra effort.

#### 2.15 Asbestos
Category A boilerplate. System includes/excludes asbestos warning based on building age (pre-2000 = include).

#### 2.16 Equality Act
Category A boilerplate. No valuer input.

#### 2.17 Flood Risk
Category C — full flood risk data from Environment Agency API (planning zone, river/sea risk, surface water risk, flood defence commentary). Already in enrichment data. Sentences adapt to actual risk level returned.

#### 2.18 Fire Risk and Cladding / EWS1
- Standard boilerplate about fire risk assessments and EWS1 — Category A
- **Interactive EWS1 decision tree** built into the platform — guides valuer through official criteria (building height, wall material, cladding type) to determine if EWS1 is required
- If EWS1 **not required**: standard sentence auto-populates with reasoning
- If EWS1 **required and available**: upload box for the form; AI reads and extracts rating/outcome; data feeds into report; form attached as appendix
- If EWS1 **required but not available**: valuer selects reason:
  - "Requested but not provided" — standard disclaimer inserted
  - "Not yet carried out" — different disclaimer inserted
  - Disclaimers are firm-level boilerplate managed by admin

#### 2.19 Statutory and Planning Enquiries
- Standard planning assumptions — Category A boilerplate
- **Planning history table** — semi-automatic:
  - System searches available sources (planning.data.gov.uk etc.) and returns batch of applications near the subject address
  - Valuer scans results and ticks which are relevant to the subject property
  - Selected rows auto-populate into the planning history table (property, reference, proposal, decision, date)
  - Manual add option for applications the system missed
- **Listed building status** — Category C, auto from Historic England
- **Conservation area** — Category C, auto from planning data
- **AONB** — Category C, auto from Natural England
- Solicitor verification reminder — Category A boilerplate

#### 2.20 Energy Performance (EPC)
- General EPC explanation and MEES reference — Category A boilerplate
- EPC data table (property, issue date, rating, emissions, floor area) — Category C, auto from EPC API
- EPC certificate attached as appendix — Category F

#### 2.21 Council Tax
- Local authority name — Category C, auto from postcode
- Council tax band — Category C, auto from VOA lookup
- Chancel repair assumption — Category A boilerplate

### 5.6 Section 3: Tenure and Market Commentary (Pages 17-20)

#### 3.1 Tenure
- Freehold or leasehold — selected at case setup
- Standard assumption paragraph — Category A boilerplate
- **If leasehold:** structured fields for key lease terms:
  - Lease length, commencement date, initial ground rent, review frequency, review mechanism (dropdown: fixed / RPI / doubling / market rent)
  - System constructs full tenure paragraph from these inputs + firm standard wording
  - If concerning review mechanism (e.g. doubling ground rent), system flags and suggests appropriate caveats
- **Tenancy details supported by AI:** valuer uploads tenancy agreement PDF or pastes email text. AI extracts: tenant name, tenancy type, start date, end date, rent, frequency, deposit, break clauses, special conditions. Populates structured tenancy record. System generates report paragraph from firm template.

#### 3.2 Tenancies
- Occupancy status: dropdown (owner-occupied / tenanted / vacant)
- If tenanted: has TA been provided? (yes/no). If yes, AI reads uploaded document.
- Links to special assumption if valued on vacant possession basis
- Surrounding wording — Category A boilerplate adapting to selections

#### 3.3 General Market Comments
Two components:

**RICS Market Survey (national/regional):**
- Dropdown selection: Residential / Commercial (future: Rural, Construction)
- Text managed by firm admin — updated when new surveys published
- One click to select, full commentary drops in

**Local Market Commentary:**
- AI-generated from controlled prompt
- Admin sets prompt template: "Research HPI movement for subject borough over past 12 months, rental index trends, transaction volumes, supply/demand indicators. Use official statistics (UK HPI, ONS rental index, HMRC transaction counts). Professional British English, RICS Red Book style."
- AI researches and writes bespoke commentary for the subject location
- Valuer verifies

#### 3.4 Transaction History
- Category C — system checks HMLR Price Paid Data for previous sales of subject address
- If found: auto-populate with dates and prices
- If none: standard "no transaction history" sentence
- Valuer confirms

#### 3.5 Residential Sales Comparables
**Display only in report typing tab.** The comparable evidence table renders whatever the valuer has adopted in the dedicated comparable tabs elsewhere in the platform.

Comparable input sources (in other tabs):
1. **LonRes CSV upload** — bulk import, parsed and formatted automatically
2. **Manual entry** — structured input for comps from valuer's own knowledge
3. Additional sources as the platform develops

The valuer does all comparable work in the comparable tabs. Section 3.5 reads from that data. Single source of truth — zero data carrying error.

No editing of comparables in the report typing tab. Changes made in comparable tabs auto-update the report.

#### 3.6 Valuation Considerations
**Fully AI-generated, reverse-engineered from the valuer's decision.**

Workflow:
1. Valuer works through comparable tabs, reviews evidence, uses adjustment tools, sees AI-suggested range
2. Valuer decides final Market Value — types it in Section 4
3. Valuer clicks "Generate Valuation Consideration"
4. AI reads the entire draft report (Sections 1–4) — subject property description, comparable evidence, adjustments, adopted rate, final Market Value
5. AI reverse-engineers the professional narrative connecting evidence to conclusion — why the adopted rate sits where it does, subject property strengths/weaknesses vs comps, market context
6. Output must be consistent with all facts in the report — no contradictions
7. Valuer reviews, edits if desired, saves

**Valuer effort: Click generate, review/edit. ~5 minutes.**

### 5.7 Section 4: Valuation (Pages 21-22)

| Sub-clause | Category | Source | Valuer Action |
|---|---|---|---|
| 4.1 Methodology | A | Firm boilerplate | None |
| 4.2 Market Rent | E | Valuer types the figure | Enter number |
| 4.3 Market Value | E | Valuer types the figure | Enter number |
| 4.4 Suitable Security | E | Yes/no toggle; standard sentence if yes | One click |
| 4.5 Reinstatement Costs (BIRC) | E (assisted) | System suggests: GIA × rebuild rate (from admin-managed cost table or BCIS data). Valuer confirms or adjusts. | Confirm or adjust number |
| 4.6 General Comments | A | Firm boilerplate | None |
| 4.7 Report Signatures | B+F | Auto-assembled from preparer/counter-signatory profiles + case date | None |

**Number formatting:** Valuer enters a number (e.g. 1600000). System formats as "£1,600,000 (One Million, Six Hundred Thousand Pounds)." Automatic number-to-words conversion. No mismatch risk.

**BIRC calculation assistance:** System knows GIA, property type, construction type, location, age. AI or lookup suggests appropriate rebuild rate. System calculates GIA × rate = suggested BIRC. Valuer reviews and adopts.

**Signature block:** Counter-signatory signature only renders after QA approval. Signature images, names, qualifications, job titles all pulled from profiles. RICS badge from firm settings. Date echoed from case data.

**Valuer effort: Enter 3 numbers (MR, MV, BIRC — BIRC may be pre-calculated). Confirm security suitability. ~2 minutes.**

### 5.8 Appendices (Pages 23-39)

All appendices are either uploaded documents or auto-generated content. The system assembles them in the correct order with correct numbering and headings.

| Appendix | Content | Source | Valuer Action |
|---|---|---|---|
| I — Instruction Letter | Client's instruction letter | Uploaded at case setup | None (uploaded earlier) |
| II — Terms & Conditions and Valuation Methodology | Firm's standard T&Cs | Firm template (admin managed) | None |
| III — Ordnance Survey Map | OS map with property boundary | Auto-generated from OS Data Hub API + coordinates | None |
| IV — Location Plans | Maps at different scales with property marked | Auto-generated from mapping APIs | None |
| V — EPC Certificate | Full EPC certificate | From EPC API or uploaded | None |
| Additional — Flood risk map | EA flood map for property location | Auto-generated from EA data | None |
| Additional — Noise map | DEFRA noise data | Auto-generated | None |
| Additional — IMD map | Index of Multiple Deprivation | Auto-generated | None |
| Additional — Comparable location map | Map showing subject + comps | Auto-generated from comp data | None |

The platform can auto-generate additional appendices beyond what firms currently include manually — making every report more comprehensive with zero extra effort.

**Valuer effort: Zero. Upload instruction letter at case setup. Everything else automatic.**

---

## 6. Report Template Inheritance

When a report is generated, the system applies content in layers:

**Layer 1 — Firm locked content (Category A)**
Logo, header, footer, professional badges, all boilerplate sections. Visible to valuer as read-only/locked in the report typing tab. Only firm admin can modify. Changes apply to all future reports.

**Layer 2 — Case metadata echoed (Category B)**
All dates, names, addresses, reference numbers. Entered once at case setup. Echoed everywhere automatically. Displayed in the report typing tab but not individually editable in each location — change at source, updates everywhere.

**Layer 3 — Auto-populated data (Category C)**
API enrichment results. Displayed for valuer review and confirmation. Editable if the valuer needs to override.

**Layer 4 — AI-generated content (Category D)**
Location description, development description, building description, local market commentary, valuation considerations, subject property summary. Generated using firm-managed prompt templates. Editable by valuer after generation.

**Layer 5 — Valuer-authored content (Category E)**
Proforma data, comparable selections, valuation figures, special assumptions, condition observations. This is the valuer's professional work.

**Layer 6 — Automated assembly (Category F)**
Photos, appendices, TOC, cover page, formatting, numbering. System handles entirely.

---

## 7. Time Saving Analysis

### Current Manual Process: 6-8 hours
- Data gathering and website lookups: ~2 hours
- Formatting, photo insertion, appendix assembly: ~1 hour
- Report writing including repetitive typing: ~2-3 hours
- QA checking for typos, calculation errors, contradictions, outdated data: ~1-2 hours

### With Platform: 1-2 hours
- Data gathering: **Automatic** (Category C)
- Formatting and assembly: **Automatic** (Categories A, F)
- Repetitive typing: **Eliminated** (Category B — enter once, echo everywhere)
- Report drafting: **AI-assisted** (Category D — verify and edit, not write from scratch)
- Valuer professional work: **~1-2 hours** (Categories D review + E — proforma, comparables, valuation judgement)
- QA: **~15-20 minutes** (typos eliminated, calculations automated, contradictions caught by AI, data current from APIs)

---

## 8. Supabase Schema

```
firms
├── id (uuid, PK)
├── name (text) — firm display name
├── slug (text, unique) — URL-friendly identifier
├── logo_url (text, nullable) — Supabase Storage path
├── header_config (jsonb) — header template settings
├── footer_config (jsonb) — footer template settings
├── report_config (jsonb) — approved boilerplate text, section ordering, numbering format, date format
├── professional_badges (jsonb) — array of badge image URLs
├── client_register (managed via separate table — see below)
├── ai_prompt_templates (jsonb) — firm's reference templates for AI generation per section
├── rics_market_commentary (jsonb) — latest survey texts keyed by type (residential, commercial)
├── special_assumptions_options (jsonb) — admin-managed tick-box options
├── rebuild_cost_rates (jsonb) — property type to cost rate mapping
├── ews1_disclaimers (jsonb) — standard disclaimer texts per scenario
├── created_at (timestamptz)
└── updated_at (timestamptz)

clients (firm's client register)
├── id (uuid, PK)
├── firm_id (uuid, FK → firms.id)
├── client_name (text)
├── addresses (jsonb) — array of address objects (supporting multiple branches)
├── is_active (boolean, default true)
├── created_at (timestamptz)
└── updated_at (timestamptz)

profiles (extends Supabase auth.users)
├── id (uuid, PK, references auth.users)
├── firm_id (uuid, FK → firms.id)
├── role (text, enum: 'firm_admin' | 'senior_valuer' | 'valuer')
├── full_name (text)
├── qualifications (text) — e.g. "MRICS", "MSc BSc (Hons) MRICS", "FRICS"
├── job_title (text) — e.g. "Associate Director", "Director", "Partner"
├── rics_registration_number (text, nullable)
├── signature_image_url (text, nullable) — Supabase Storage path
├── can_sign_as_preparer (boolean, default true)
├── can_sign_as_countersignatory (boolean, default false)
├── is_active (boolean, default true)
├── created_at (timestamptz)
└── updated_at (timestamptz)

cases
├── id (uuid, PK)
├── firm_id (uuid, FK → firms.id)
├── case_reference (text) — auto-generated or manual per firm setting
├── property_address (text)
├── client_id (uuid, FK → clients.id)
├── applicant_name (text, nullable)
├── bank_reference (text, nullable)
├── valuation_purpose (text) — secured lending, probate, CGT, etc.
├── inspection_type (text) — full internal/external, external only, desktop
├── valuation_date (date)
├── inspection_date (date)
├── instruction_date (date)
├── report_date (date)
├── created_by (uuid, FK → profiles.id)
├── preparer_id (uuid, FK → profiles.id)
├── countersignatory_id (uuid, FK → profiles.id, nullable)
├── status (text, enum: 'draft' | 'in_progress' | 'submitted_for_qa' | 'under_review' | 'revision_required' | 'approved' | 'issued')
├── submitted_at (timestamptz, nullable)
├── reviewed_at (timestamptz, nullable)
├── issued_at (timestamptz, nullable)
├── report_content (jsonb) — all section content stored as structured JSON
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

---

## 9. Row Level Security (RLS) Policies

- Users can only see data belonging to their own firm (`firm_id` match)
- Valuers can only see their own cases (`created_by` or `preparer_id` match)
- Senior valuers can see their own cases plus cases where they are assigned as `countersignatory_id`
- Firm admins can see all cases within the firm
- Firm settings (`firms` table) can only be modified by `firm_admin` role
- Client register can only be modified by `firm_admin` role
- User profiles: users can update their own non-restricted fields; `firm_admin` can update roles and signing authority flags
- No cross-firm data leakage under any circumstances

---

## 10. Auth Flow Updates

- On signup, user must be associated with a firm (create new firm or join existing via invite)
- JWT custom claims must include `firm_id` and `role`
- Middleware checks both authentication AND role-based authorisation
- FastAPI endpoints validate `firm_id` from JWT to enforce tenant isolation
- Role-based UI: admin panel only visible to `firm_admin`; navigation adapts per role

---

## 11. Future Considerations (document, don't implement at MVP)

- **Firm invite system** — admin generates invite link/code for new users
- **SSO/SAML** — enterprise single sign-on
- **Multi-office support** — office-level grouping within a firm
- **Custom role permissions** — configurable permissions per role
- **Billing per seat** — subscription scales with active users
- **Mobile app** — on-site proforma and photo capture
- **Paid planning data integration** — LandInsight, Nimbus Maps etc. for comprehensive planning history
- **BCIS integration** — live rebuild cost data for BIRC calculations
- **Report format and template management** — complex topic requiring dedicated specification (to be discussed separately)
- **Voice memo transcription** — valuer records inspection notes by voice, AI transcribes into proforma fields
- **Automated comparable sourcing** — system suggests comps before valuer searches

---

## 12. Core Product Principles

1. **Efficiency above all.** Save valuers time. Whatever admin can do, data search can do, AI can do — don't let the valuer do it.
2. **Enter once, echo everywhere.** No data repetition. Single source of truth eliminates typos and inconsistencies.
3. **AI assists, valuer decides.** AI generates drafts, suggests figures, writes narratives. The valuer has final say on everything.
4. **Controlled AI output.** Admin manages prompt templates with reference examples. AI output matches the firm's style, tone, and professional standards.
5. **Firm-level consistency.** Branding, formatting, boilerplate, and templates controlled by admin. Every report looks like it came from the same firm regardless of which valuer wrote it.
6. **Upload and auto-paste.** Documents, photos, appendices — upload once, system handles all formatting, positioning, sizing, ordering.
7. **Professional compliance built in.** EWS1 decision trees, Red Book guidance, special assumption prompts. The platform supports professional compliance, not just report production.
8. **QA by design.** Most QA issues are prevented at source — no typos from re-typing, no calculation errors, no contradictions, no outdated data. Counter-signatory focuses on professional judgement only.

---

*End of specification. Report format and template management to be specified in a separate document following dedicated discussion.*

# PROPVAL PLACEHOLDER REGISTRY v1.0

> Master reference for all template variables used in prompt engineering and report generation.
> 17 March 2026 | INTERNAL — FOR DEVELOPMENT USE

---

## How To Use This Document

- Every placeholder maps to a specific database field or computed value.
- When writing prompt templates, reference placeholders by their exact `{{name}}` as listed here.
- The code substitutes real values from the database before sending the prompt to the LLM.
- Categories A (firm template boilerplate) and G (QA process) do not contain placeholders.

**Quick Stats:** 123 unique placeholders across 5 categories.

---

## Category B — Case Metadata (24 placeholders)

Entered or selected once at case setup. The system echoes each value everywhere it appears in the report. Zero repetition, zero typo risk.

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{valuation_date}}` | cases.valuation_date | DATE | Cover, 1.1, 4.3, 4.7 | Echoed 5+ times |
| `{{inspection_date}}` | cases.inspection_date | DATE | 1.5, 2.1 | Date of site visit |
| `{{instruction_date}}` | cases.instruction_date | DATE | 1.1 | Date instruction received |
| `{{report_date}}` | cases.report_date | DATE | Cover, 4.7 | Date report issued |
| `{{report_reference}}` | cases.report_reference | TEXT | Cover, header | Firm's internal ref number |
| `{{client_name}}` | clients.name | TEXT | Cover, 1.2 | Instructing client/bank |
| `{{client_address}}` | clients.address | TEXT | 1.2 | Client postal address |
| `{{applicant_name}}` | cases.applicant_name | TEXT | Cover, 1.2 | Borrower/applicant |
| `{{bank_reference}}` | cases.bank_reference | TEXT | Cover, 1.2 | Lender's reference number |
| `{{property_address}}` | properties.full_address | TEXT | Cover, header, 2.1+ | Echoed on every page |
| `{{property_postcode}}` | properties.postcode | TEXT | Cover, 2.1 | Subject property postcode |
| `{{uprn}}` | properties.uprn | BIGINT | Internal | Universal Property Reference Number |
| `{{valuation_purpose}}` | cases.valuation_purpose | ENUM | Cover, 1.1, 1.3 | Dropdown on Cover page; options editable in Firm Template. e.g. Secured Lending, Probate, CGT |
| `{{valuation_basis}}` | cases.valuation_basis | ENUM | 1.3, 4.1 | e.g. Market Value, Market Rent |
| `{{report_type}}` | cases.report_type | ENUM | Cover, 1.1 | Links to report template |
| `{{inspection_type}}` | cases.inspection_type | ENUM | 1.5 | full / external / desktop |
| `{{preparer_name}}` | profiles.full_name | TEXT | 1.6, 4.7 | Valuer who conducted inspection |
| `{{preparer_quals}}` | profiles.qualifications | TEXT | 1.6, 4.7 | e.g. MRICS, FRICS |
| `{{preparer_title}}` | profiles.job_title | TEXT | 4.7 | e.g. Senior Surveyor |
| `{{countersig_name}}` | profiles.full_name | TEXT | 1.6, 4.7 | Counter-signatory / reviewer |
| `{{countersig_quals}}` | profiles.qualifications | TEXT | 1.6, 4.7 | Counter-signatory credentials |
| `{{countersig_title}}` | profiles.job_title | TEXT | 4.7 | Counter-signatory job title |
| `{{complexity}}` | cases.complexity | ENUM | Internal | routine / moderate / complex |
| `{{case_status}}` | cases.status | ENUM | Internal | draft / in_progress / review / issued |

---

## Category C — API Auto-populated (43 placeholders)

Fetched automatically from external APIs and the data enrichment pipeline. Presented for valuer review and confirmation. Editable if the valuer needs to override.

### EPC Register (DLUHC Open Data)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{epc_rating}}` | epc_certificates.current_energy_rating | CHAR | 2.9 | A to G |
| `{{epc_score}}` | epc_certificates.current_energy_efficiency | INT | 2.9 | 1–100 SAP score |
| `{{epc_potential}}` | epc_certificates.potential_energy_rating | CHAR | 2.9 | Potential rating |
| `{{epc_floor_area}}` | epc_certificates.total_floor_area | FLOAT | 2.3, 2.4 | EPC-recorded floor area (m²) |
| `{{epc_construction_age}}` | epc_certificates.construction_age_band | TEXT | 2.3 | e.g. 2007–2011 |
| `{{epc_walls}}` | epc_certificates.walls_description | TEXT | 2.3 | Wall type and insulation |
| `{{epc_roof}}` | epc_certificates.roof_description | TEXT | 2.3 | Roof type and insulation |
| `{{epc_heating}}` | epc_certificates.heating_description | TEXT | 2.3 | Main heating system |
| `{{epc_windows}}` | epc_certificates.windows_description | TEXT | 2.3 | Window type |
| `{{epc_hotwater}}` | epc_certificates.hot_water_description | TEXT | 2.3 | Hot water system |
| `{{epc_certificate_number}}` | epc_certificates.lmk_key | TEXT | Appendix V | EPC certificate ID |
| `{{epc_inspection_date}}` | epc_certificates.inspection_date | DATE | 2.9 | Date of EPC inspection |

### Land Registry / Title

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{title_number}}` | cases.title_number | TEXT | 2.1 | HMLR title register ref |
| `{{tenure}}` | properties.tenure | ENUM | 2.1, 3.1 | Freehold / Leasehold |
| `{{lease_start}}` | cases.lease_start_date | DATE | 3.1 | Lease commencement |
| `{{lease_term}}` | cases.lease_term_years | INT | 3.1 | Original lease length (years) |
| `{{lease_unexpired}}` | Calculated | INT | 3.1 | Remaining years at valuation date |
| `{{ground_rent}}` | cases.ground_rent | DECIMAL | 3.1 | Current ground rent (p.a.) |
| `{{service_charge}}` | cases.service_charge | DECIMAL | 3.1 | Current service charge (p.a.) |

### Location & Geography (postcodes.io, TfL, NaPTAN)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{local_authority}}` | postcodes_io.admin_district | TEXT | 2.2, header | London Borough / Council |
| `{{ward}}` | postcodes_io.ward | TEXT | Internal | Electoral ward |
| `{{region}}` | postcodes_io.region | TEXT | Internal | e.g. London |
| `{{latitude}}` | properties.latitude | FLOAT | Internal | WGS84 latitude |
| `{{longitude}}` | properties.longitude | FLOAT | Internal | WGS84 longitude |
| `{{ptal_rating}}` | tfl_api.ptal_score | TEXT | 2.2 | Public Transport Access Level (1–6b) |
| `{{nearest_station}}` | tfl_api / naptan | TEXT | 2.2 | Nearest rail/tube station name |
| `{{station_distance}}` | Calculated | TEXT | 2.2 | Distance to nearest station |

### Flood Risk (Environment Agency)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{flood_zone}}` | ea_flood.flood_zone | TEXT | 2.7 | Zone 1 / 2 / 3a / 3b |
| `{{flood_risk_level}}` | ea_flood.risk_level | TEXT | 2.7 | Very Low / Low / Medium / High |

### Environmental (Radon, Coal, Noise)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{radon_risk}}` | uk_radon.risk_level | TEXT | 2.7 | Risk band |
| `{{coal_mining}}` | coal_authority.status | TEXT | 2.7 | Affected / Not affected |
| `{{noise_level}}` | defra_noise.level | TEXT | 2.7 | Road/rail/air noise classification |

### Broadband (Ofcom)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{broadband_speed}}` | ofcom_broadband.avg_download | FLOAT | 2.2 | Average download speed (Mbps) |

### Planning & Designations (Historic England, GLA, PLD)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{listed_status}}` | historic_england.grade | TEXT | 2.8 | Not listed / Grade I/II*/II |
| `{{conservation_area}}` | gla_conservation_areas | BOOL/TEXT | 2.8 | In/out + area name |
| `{{brownfield}}` | gla_brownfield | BOOL | Internal | On brownfield register Y/N |
| `{{aonb}}` | natural_england | BOOL | 2.7 | In AONB Y/N |
| `{{council_tax_band}}` | voa_council_tax.band | CHAR | 2.1 | A to H |

### Deprivation (IMD 2025)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{imd_rank}}` | imd_2025.rank | INT | Internal | Index of Multiple Deprivation rank |
| `{{imd_decile}}` | imd_2025.decile | INT | 2.2 | IMD decile (1=most deprived) |

### Planning London Datahub (GLA)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{nearby_planning}}` | pld_applications_cache | JSON | 2.8 | Live/recent planning applications |
| `{{opportunity_area}}` | gla_opportunity_areas | TEXT | 2.2 | GLA Opportunity Area name |
| `{{site_allocation}}` | gla_site_allocations | BOOL | 2.8 | In site allocation Y/N |
| `{{housing_zone}}` | gla_housing_zones | BOOL | 2.8 | In housing zone Y/N |

---

## Category D — AI-Assisted Professional Content (8 placeholders)

Generated by the LLM using firm-managed prompt templates with reference examples for style, tone, and length. Each placeholder represents a block of AI-generated text that the valuer reviews and edits.

| Placeholder | Source | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{location_description}}` | AI + Cat C data | TEXT | 2.2 | Area character, amenities, transport, schools, green spaces |
| `{{development_description}}` | AI + photos/brochure | TEXT | 2.3 | External building/development description |
| `{{building_description}}` | AI + photos | TEXT | 2.3 | Construction, materials, style, floors |
| `{{property_summary}}` | AI + proforma data | TEXT | 2.3 | Flowing paragraph from accommodation proforma |
| `{{market_commentary}}` | AI + RICS data + news | TEXT | 3.3 | Local market overview, trends, supply/demand |
| `{{valuation_considerations}}` | AI + Sections 1–4 | TEXT | 3.6 | Reverse-engineered rationale from MV decision |
| `{{environmental_commentary}}` | AI + Cat C env data | TEXT | 2.7 | Summary of flood, radon, contamination, noise |
| `{{fire_risk_commentary}}` | AI + EWS1 data | TEXT | 2.7.1 | Cladding, fire risk, EWS1 status commentary |

### Prompt Template Pattern (for CC reference)

```
"You are an experienced RICS Registered Valuer. Using the following data:
{{property_address}}, {{local_authority}}, {{ptal_rating}}, {{nearest_station}},
{{flood_zone}}, {{imd_decile}}... and this reference template: [admin-managed example],
generate a location description. Write in professional British English, +/-100 words
of the template. Fact-check all claims. Do not fabricate."
```

---

## Category E — Valuer-Only Professional Content (33 placeholders)

Data entered by the valuer from their inspection notes and professional judgement. Covers the smart proforma fields, final valuation figures, and all comparable evidence data.

### Subject Property Proforma

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{num_floors}}` | case_proforma.num_floors | INT | 2.3 | Number of floors in subject |
| `{{floor_level}}` | case_proforma.floor_level | TEXT | 2.3 | Subject flat floor level |
| `{{num_bedrooms}}` | case_proforma.bedrooms | INT | 2.3, 2.4 | Habitable bedrooms |
| `{{num_bathrooms}}` | case_proforma.bathrooms | INT | 2.3 | Bathrooms + shower rooms |
| `{{num_receptions}}` | case_proforma.receptions | INT | 2.3 | Reception rooms |
| `{{accommodation_schedule}}` | case_proforma.rooms[] | JSON | 2.3 | Floor-by-floor room list from proforma |
| `{{orientation}}` | case_proforma.orientation | ENUM | 2.3 | N/NE/E/SE/S/SW/W/NW |
| `{{outlook}}` | case_proforma.outlook | TEXT | 2.3 | Views description |
| `{{parking}}` | case_proforma.parking | ENUM | 2.3 | none / on-street / allocated / garage |
| `{{garden}}` | case_proforma.garden | ENUM | 2.3 | none / communal / private / roof terrace / balcony |
| `{{condition_overall}}` | case_proforma.condition | ENUM | 2.6 | good / fair / poor |
| `{{condition_notes}}` | case_proforma.condition_notes | TEXT | 2.6 | Specific condition observations |
| `{{gia_sqft}}` | cases.gia_sqft | FLOAT | 2.4 | Gross Internal Area (sq ft) |
| `{{gia_sqm}}` | cases.gia_sqm | FLOAT | 2.4 | Gross Internal Area (m²) |
| `{{site_area}}` | cases.site_area_sqm | FLOAT | 2.4 | Site area for houses (m²) |
| `{{measurement_source}}` | cases.measurement_source | ENUM | 2.4 | surveyor / epc / plans |

### Valuation Figures

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{market_value}}` | cases.market_value | DECIMAL | 4.3 | Final MV opinion (£) |
| `{{market_value_words}}` | Calculated | TEXT | 4.3 | Auto: number to words |
| `{{market_rent}}` | cases.market_rent | DECIMAL | 4.2 | Annual market rent opinion (£) |
| `{{market_rent_words}}` | Calculated | TEXT | 4.2 | Auto: number to words |
| `{{reinstatement_cost}}` | cases.birc | DECIMAL | 4.5 | Building reinstatement cost (£) |
| `{{reinstatement_words}}` | Calculated | TEXT | 4.5 | Auto: number to words |
| `{{suitable_security}}` | cases.suitable_security | BOOL | 4.4 | Suitable for lending Y/N |
| `{{security_caveats}}` | cases.security_caveats | TEXT | 4.4 | Reasons if not suitable |
| `{{special_assumptions}}` | cases.special_assumptions | TEXT[] | 1.4 | Tick-box + free text |
| `{{adopted_psf}}` | cases.adopted_psf | DECIMAL | 3.6 | Valuer's adopted £/sq ft rate |

### Comparable Evidence (per comp — iterable)

| Placeholder | DB Table.Column | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{comp_count}}` | Calculated | INT | 3.5 | Number of adopted comparables |
| `{{comps_table}}` | case_comparables[] | JSON | 3.5 | Full comparable evidence table |
| `{{comp_address}}` | case_comparables.address | TEXT | 3.5 | Per-comp: address |
| `{{comp_price}}` | case_comparables.price | DECIMAL | 3.5 | Per-comp: sale price |
| `{{comp_date}}` | case_comparables.sale_date | DATE | 3.5 | Per-comp: transaction date |
| `{{comp_area}}` | case_comparables.floor_area | FLOAT | 3.5 | Per-comp: floor area (sq ft) |
| `{{comp_psf}}` | case_comparables.psf | DECIMAL | 3.5 | Per-comp: unadjusted £/sq ft |
| `{{comp_adj_psf}}` | case_comparables.adj_psf | DECIMAL | 3.5 | Per-comp: adjusted £/sq ft |
| `{{comp_time_adj}}` | case_comparables.time_adj | FLOAT | 3.5 | Per-comp: time adjustment % |
| `{{comp_size_adj}}` | case_comparables.size_adj | FLOAT | 3.5 | Per-comp: size adjustment % |
| `{{comp_floor_adj}}` | case_comparables.floor_adj | FLOAT | 3.5 | Per-comp: floor level adjustment % |
| `{{comp_notes}}` | case_comparables.notes | TEXT | 3.5 | Per-comp: valuer commentary |

---

## Category F — Automated Assembly (15 placeholders)

System-generated content requiring zero professional skill. Maps, photos, page numbers, date formatting, and document structure.

| Placeholder | Source | Type | Report Section(s) | Notes |
|---|---|---|---|---|
| `{{cover_page}}` | Assembly | HTML/DOCX | Cover | Composed from Cat A + B fields |
| `{{toc}}` | Assembly | HTML/DOCX | Page 2 | Auto-generated table of contents |
| `{{page_number}}` | Assembly | INT | Footer | Running page number |
| `{{total_pages}}` | Assembly | INT | Footer | Total page count |
| `{{photo_grid}}` | case_photos[] | IMAGE[] | 2.3 | Paired photos with auto-captions from proforma rooms |
| `{{os_map}}` | OS Data Hub API | IMAGE | Appendix III | Auto-generated boundary map |
| `{{location_plan}}` | Mapping API | IMAGE | Appendix IV | Multi-scale location plans |
| `{{comp_location_map}}` | Calculated | IMAGE | 3.5 / Appendix | Map showing subject + all comps |
| `{{epc_certificate}}` | EPC API / upload | PDF/IMAGE | Appendix V | Full EPC certificate document |
| `{{flood_map}}` | EA flood API | IMAGE | Appendix | Auto-generated flood risk map |
| `{{noise_map}}` | DEFRA noise API | IMAGE | Appendix | Auto-generated noise map |
| `{{imd_map}}` | IMD data | IMAGE | Appendix | Deprivation map for area |
| `{{number_to_words}}` | Utility function | TEXT | 4.2–4.5 | £1,600,000 → One Million Six Hundred Thousand Pounds |
| `{{date_format_long}}` | Utility function | TEXT | Throughout | 5 March 2026 |
| `{{date_format_short}}` | Utility function | TEXT | Header | 05/03/2026 |

---

## CC Implementation Notes

1. **String interpolation:** Use Jinja2 templates in FastAPI. Store prompt templates as `.jinja2` files in the codebase, versioned alongside the code.

2. **Iterables:** Comparable evidence placeholders (`{{comp_address}}`, `{{comp_price}}`, etc.) are per-comp. Use Jinja2 `{% for comp in comparables %}` syntax in prompt templates.

3. **Calculated fields:** `{{lease_unexpired}}`, `{{market_value_words}}`, `{{comp_psf}}` etc. are computed at render time, not stored. Build utility functions for number-to-words, date formatting, and lease calculation.

4. **Null handling:** Not all properties have all fields. Templates must gracefully handle missing data — e.g. houses don't have `{{floor_level}}`, freeholds don't have `{{lease_term}}`. Use Jinja2 `{% if %}` conditionals.

5. **Category D prompt templates:** Each AI-generated section should have its own versioned prompt template file. The admin manages the reference example; the system injects the data placeholders. The prompt template itself is also a placeholder-driven template.

6. **Escaping / prompt injection:** All placeholder values must be sanitised before injection into prompts. Strip any text that looks like prompt instructions from user-entered fields.

7. **Audit trail:** Log every prompt sent and every response received, linked to the case ID. This supports RICS compliance and PI insurance defence.

8. **Conditional sections:** Use `{% if tenure == 'leasehold' %}` to include lease-specific placeholders (ground rent, service charge, unexpired term) only when relevant. Same for `{% if property_type == 'flat' %}` for floor level, building description, etc.

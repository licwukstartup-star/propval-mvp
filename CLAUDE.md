# PropVal — Property Intelligence Platform

## What this is
A SaaS web app for MRICS valuation surveyors. A surveyor enters a UK property address and gets a comprehensive property intelligence report pulling data from multiple free government APIs.

## Architecture
- **Frontend**: Next.js + TypeScript + TailwindCSS (hosted on Vercel)
- **Backend**: Python FastAPI (hosted on Render)
- **Database**: Supabase (PostgreSQL + PostGIS + Auth)
- **Existing tool**: We have a working Python CLI tool (uprn_lookup_v10) that already integrates 13+ APIs. We are rebuilding this as a web application.

## Data pipeline
1. Surveyor enters address + postcode
2. Backend extracts postcode, queries EPC API, fuzzy-matches the property
3. UPRN comes from EPC records
4. Coordinates come from Nominatim (OpenStreetMap), fallback to postcodes.io centroid
5. All spatial APIs queried by lat/lon with appropriate buffer zones
6. Results assembled and returned to frontend

## APIs integrated (current)
- EPC Open Data (energy ratings, property characteristics) — API key required
- Land Registry Price Paid (SPARQL, no key)

## APIs to add (priority order)
1. Nominatim/postcodes.io (coordinates + admin metadata)
2. Environment Agency Flood Monitoring (flood risk)
3. Historic England NHLE (listed buildings, 75m buffer)
4. planning.data.gov.uk (conservation areas, planning constraints)
5. DEFRA Noise Mapping (road/rail noise dB levels)
6. Natural England (SSSI, AONB, Green Belt, Ancient Woodland)
7. IMD 2025 via ONS ArcGIS (deprivation data by LSOA)
8. BGS OpenGeoscience (geology, subsidence risk)
9. HMLR UK HPI (house price index trends via SPARQL)
10. Ofcom Broadband/Mobile (connectivity by UPRN)

## Key technical notes
- UPRN is the master key linking all property data
- NHLE queries use 75m buffer with BNG conversion
- planning.data.gov.uk: query using ?q=UPRN not lat/lon
- postcodes.io is for metadata only (LSOA, admin district), not coordinates
- Address parsing must handle SAON (flat/unit) vs PAON (building/house number) for Land Registry SPARQL
- .env file is in project root, backend loads it from one directory up

## Credentials
All in .env file (never commit to Git):
- SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- EPC_EMAIL, EPC_API_KEY
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

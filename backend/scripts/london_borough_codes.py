"""
London Borough → Outward Code mapping for systematic diagnostic testing.

Outward codes don't align perfectly with boroughs (some span boundaries),
but this gives a practical working mapping for borough-by-borough testing.

Source: Royal Mail PAF + local knowledge.
"""

BOROUGH_CODES: dict[str, list[str]] = {
    # ── Inner London ──────────────────────────────────────────────────────
    "Camden": ["NW1", "NW3", "NW5", "NW6", "WC1A", "WC1B", "WC1E", "WC1H", "WC1N", "WC1R", "WC1V", "WC1X", "N1C", "N6", "N7", "N19", "NW8"],
    "City of London": ["EC1A", "EC1M", "EC1N", "EC1R", "EC1V", "EC1Y", "EC2A", "EC2M", "EC2N", "EC2R", "EC2V", "EC2Y", "EC3A", "EC3M", "EC3N", "EC3R", "EC3V", "EC4A", "EC4M", "EC4N", "EC4R", "EC4V", "EC4Y"],
    "Greenwich": ["SE3", "SE7", "SE9", "SE10", "SE18", "DA16"],
    "Hackney": ["E2", "E5", "E8", "E9", "E15", "N1", "N4", "N16"],
    "Hammersmith and Fulham": ["W6", "W12", "W14", "SW6"],
    "Islington": ["N1", "N4", "N5", "N7", "N19", "EC1R", "EC1V"],
    "Kensington and Chelsea": ["SW1X", "SW3", "SW5", "SW7", "SW10", "W8", "W10", "W11", "W14"],
    "Lambeth": ["SE1", "SE5", "SE11", "SE21", "SE24", "SE27", "SW2", "SW4", "SW8", "SW9", "SW16"],
    "Lewisham": ["SE4", "SE6", "SE8", "SE12", "SE13", "SE14", "SE23", "SE26"],
    "Newham": ["E6", "E7", "E12", "E13", "E15", "E16"],
    "Southwark": ["SE1", "SE5", "SE15", "SE16", "SE17", "SE21", "SE22", "SE24"],
    "Tower Hamlets": ["E1", "E1W", "E2", "E3", "E14"],
    "Wandsworth": ["SW4", "SW8", "SW11", "SW12", "SW15", "SW17", "SW18"],
    "Westminster": ["SW1A", "SW1E", "SW1H", "SW1P", "SW1V", "SW1W", "SW1Y", "W1B", "W1C", "W1D", "W1F", "W1G", "W1H", "W1J", "W1K", "W1S", "W1T", "W1U", "W1W", "W2", "NW1", "NW8", "WC2A", "WC2B", "WC2E", "WC2H", "WC2N", "WC2R"],

    # ── Outer London ──────────────────────────────────────────────────────
    "Barking and Dagenham": ["IG11", "RM6", "RM7", "RM8", "RM9", "RM10"],
    "Barnet": ["N2", "N3", "N11", "N12", "N14", "N20", "NW4", "NW7", "NW9", "NW11", "EN4", "EN5"],
    "Bexley": ["DA5", "DA6", "DA7", "DA8", "DA14", "DA15", "DA16", "DA17", "DA18", "SE2", "SE9", "SE28"],
    "Brent": ["NW2", "NW6", "NW9", "NW10", "HA0", "HA1", "HA3", "HA9"],
    "Bromley": ["BR1", "BR2", "BR3", "BR4", "BR5", "BR6", "BR7", "SE6", "SE9", "SE12", "SE20"],
    "Croydon": ["CR0", "CR2", "CR5", "CR7", "CR8", "SE19", "SE25"],
    "Ealing": ["W3", "W5", "W7", "W13", "UB1", "UB2", "UB5", "UB6"],
    "Enfield": ["EN1", "EN2", "EN3", "EN4", "EN8", "N9", "N13", "N14", "N18", "N21"],
    "Haringey": ["N4", "N6", "N8", "N10", "N11", "N15", "N17", "N22"],
    "Harrow": ["HA1", "HA2", "HA3", "HA5", "HA7"],
    "Havering": ["RM1", "RM2", "RM3", "RM4", "RM5", "RM7", "RM11", "RM12", "RM13", "RM14"],
    "Hillingdon": ["UB3", "UB4", "UB5", "UB7", "UB8", "UB9", "UB10", "UB11", "HA4", "HA6"],
    "Hounslow": ["TW3", "TW4", "TW5", "TW7", "TW8", "TW13", "TW14", "W4"],
    "Kingston upon Thames": ["KT1", "KT2", "KT3", "KT5", "KT6", "KT9"],
    "Merton": ["SW19", "SW20", "CR4", "SM4"],
    "Redbridge": ["E11", "E18", "IG1", "IG2", "IG3", "IG4", "IG5", "IG6", "IG7", "IG8"],
    "Richmond upon Thames": ["TW1", "TW2", "TW9", "TW10", "TW11", "TW12", "SW13", "SW14"],
    "Sutton": ["SM1", "SM2", "SM3", "SM5", "SM6", "SM7"],
    "Waltham Forest": ["E4", "E10", "E11", "E17"],
}

# Deduplicated list of all London outward codes
ALL_LONDON_CODES = sorted(set(
    code for codes in BOROUGH_CODES.values() for code in codes
))

# Priority tiers for testing (based on residential valuation volume)
TIER_1_PRIORITY = [
    "Wandsworth", "Lambeth", "Southwark", "Tower Hamlets", "Newham",
    "Greenwich", "Lewisham", "Hackney",
]
TIER_2_PRIORITY = [
    "Camden", "Islington", "Hammersmith and Fulham", "Kensington and Chelsea",
    "Westminster", "Croydon", "Barnet", "Brent",
]
TIER_3_PRIORITY = [
    "Ealing", "Enfield", "Haringey", "Hounslow", "Merton", "Sutton",
    "Kingston upon Thames", "Richmond upon Thames", "Waltham Forest",
    "Redbridge", "Havering", "Barking and Dagenham", "Bexley", "Bromley",
    "Hillingdon", "Harrow", "City of London",
]

# Tier 3 split into ~1hr batches
TIER_3A_PRIORITY = [
    "Ealing", "Enfield", "Haringey", "Hounslow", "Merton", "Sutton",
]  # 44 codes, ~60 min

TIER_3B_PRIORITY = [
    "Kingston upon Thames", "Richmond upon Thames", "Waltham Forest",
    "Redbridge", "Havering", "Barking and Dagenham",
]  # 44 codes, ~60 min

TIER_3C_PRIORITY = [
    "Bexley", "Bromley", "Hillingdon", "Harrow", "City of London",
]  # 61 codes, ~80 min

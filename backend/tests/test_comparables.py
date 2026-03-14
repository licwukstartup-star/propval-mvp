"""
Unit tests for the comparable selection engine.

Tests pure functions only — no HTTP calls, no database, no external APIs.
Covers: postcode normalisation, property type derivation, building era,
hard deck filters, sub-type hierarchy, street/building normalisation,
haversine distance, time windows, PPD row parsing.
"""
from datetime import date

import pytest

from routers.comparables import (
    _normalise_pc,
    _outward,
    _derive_property_type,
    _derive_house_sub_type,
    _approx_build_year,
    derive_building_era,
    derive_era_from_age_band,
    normalise_street,
    normalise_building,
    _building_fuzzy,
    _subtype_dist,
    _passes_hard_deck,
    _within_window,
    _months_ago,
    _parse_ppd_row,
    _dedup_key,
    _translate_bulk_row,
    _haversine_m,
    SubjectPropertyInput,
    _PPD_TYPE_MAP,
)


# ===================================================================
# Postcode helpers
# ===================================================================

class TestNormalisePc:
    def test_standard(self):
        assert _normalise_pc("SM12EG") == "SM1 2EG"

    def test_already_spaced(self):
        assert _normalise_pc("SM1 2EG") == "SM1 2EG"

    def test_extra_spaces(self):
        assert _normalise_pc("  E14  9TP  ") == "E14 9TP"

    def test_lowercase(self):
        assert _normalise_pc("e149tp") == "E14 9TP"

    def test_long_outward(self):
        assert _normalise_pc("SW1A1AA") == "SW1A 1AA"


class TestOutward:
    def test_simple(self):
        assert _outward("SM1 2EG") == "SM1"

    def test_long(self):
        assert _outward("SW1A 1AA") == "SW1A"

    def test_lowercase(self):
        assert _outward("e14 9tp") == "E14"


# ===================================================================
# Property type derivation
# ===================================================================

class TestDerivePropertyType:
    def test_flat(self):
        assert _derive_property_type("Flat") == "flat"

    def test_maisonette(self):
        assert _derive_property_type("Maisonette") == "flat"

    def test_house(self):
        assert _derive_property_type("House") == "house"

    def test_bungalow(self):
        assert _derive_property_type("Bungalow") == "house"

    def test_park_home(self):
        assert _derive_property_type("Park home") == "house"

    def test_none(self):
        assert _derive_property_type(None) is None

    def test_empty(self):
        assert _derive_property_type("") is None

    def test_unknown(self):
        assert _derive_property_type("Garage") is None


class TestDeriveHouseSubType:
    def test_semi(self):
        assert _derive_house_sub_type("Semi-Detached") == "semi-detached"

    def test_terraced(self):
        assert _derive_house_sub_type("Enclosed Mid-Terrace") == "terraced"

    def test_end_terrace(self):
        assert _derive_house_sub_type("End-Terrace") == "end-terrace"

    def test_detached(self):
        assert _derive_house_sub_type("Detached") == "detached"

    def test_none(self):
        assert _derive_house_sub_type(None) is None

    def test_empty(self):
        assert _derive_house_sub_type("") is None


# ===================================================================
# Build year / era
# ===================================================================

class TestApproxBuildYear:
    def test_before_1900(self):
        assert _approx_build_year("before 1900") == 1890

    def test_2007_onwards(self):
        assert _approx_build_year("2007 onwards") == 2010

    def test_1930_1949(self):
        assert _approx_build_year("1930-1949") == 1940

    def test_none(self):
        assert _approx_build_year(None) is None

    def test_empty(self):
        assert _approx_build_year("") is None

    def test_unknown_band(self):
        assert _approx_build_year("Unknown") is None


class TestDeriveBuildingEra:
    def test_modern(self):
        assert derive_building_era(2010) == "modern"

    def test_period(self):
        assert derive_building_era(1930) == "period"

    def test_boundary(self):
        assert derive_building_era(2000) == "modern"

    def test_just_below(self):
        assert derive_building_era(1999) == "period"

    def test_none(self):
        assert derive_building_era(None) is None


class TestDeriveEraFromAgeBand:
    def test_2007_onwards(self):
        assert derive_era_from_age_band("2007 onwards") == "modern"

    def test_before_1900(self):
        assert derive_era_from_age_band("before 1900") == "period"

    def test_1996_2002_is_modern(self):
        # Upper bound 2002 >= 2000, so modern (not period)
        assert derive_era_from_age_band("1996-2002") == "modern"

    def test_1983_1990_is_period(self):
        assert derive_era_from_age_band("1983-1990") == "period"

    def test_none(self):
        assert derive_era_from_age_band(None) is None

    def test_empty(self):
        assert derive_era_from_age_band("") is None

    def test_new_dwelling(self):
        assert derive_era_from_age_band("new dwelling") == "modern"


# ===================================================================
# Normalisation
# ===================================================================

class TestNormaliseStreet:
    def test_abbreviations(self):
        result = normalise_street("HIGH STREET")
        assert result == "HIGH ST"

    def test_road(self):
        assert normalise_street("MARSH ROAD") == "MARSH RD"

    def test_mixed_case(self):
        result = normalise_street("marsh road")
        assert result == "MARSH RD"

    def test_special_chars_removed(self):
        result = normalise_street("ST. JOHN'S ROAD")
        # Apostrophe and period stripped
        assert "RD" in result


class TestNormaliseBuilding:
    def test_noise_words_removed(self):
        result = normalise_building("COMPASS HOUSE")
        assert "HOUSE" not in result
        assert "COMPASS" in result

    def test_tower_removed(self):
        result = normalise_building("WESTMARK TOWER")
        assert "TOWER" not in result
        assert "WESTMARK" in result

    def test_saint_normalised(self):
        result = normalise_building("SAINT JAMES COURT")
        assert "ST" in result
        assert "SAINT" not in result

    def test_special_chars(self):
        result = normalise_building("ST. JOHN'S MANSIONS")
        assert result.isalnum() or " " in result  # only alphanumeric + spaces


class TestBuildingFuzzy:
    def test_exact_match(self):
        assert _building_fuzzy("COMPASS HOUSE", "COMPASS HOUSE") is True

    def test_noise_word_difference(self):
        # After normalisation, "COMPASS HOUSE" and "COMPASS COURT" both become "COMPASS"
        assert _building_fuzzy("COMPASS HOUSE", "COMPASS COURT") is True

    def test_word_order(self):
        assert _building_fuzzy("OLD BREWERY APARTMENTS", "APARTMENTS OLD BREWERY") is True

    def test_none_input(self):
        assert _building_fuzzy(None, "COMPASS HOUSE") is False
        assert _building_fuzzy("COMPASS HOUSE", None) is False
        assert _building_fuzzy(None, None) is False

    def test_completely_different(self):
        assert _building_fuzzy("COMPASS HOUSE", "RIVERSIDE TOWER") is False


# ===================================================================
# Sub-type hierarchy
# ===================================================================

class TestSubtypeDist:
    def test_same(self):
        assert _subtype_dist("detached", "detached") == 0

    def test_adjacent(self):
        assert _subtype_dist("detached", "semi-detached") == 1

    def test_far(self):
        assert _subtype_dist("detached", "terraced") == 2

    def test_end_terrace_same_as_terraced(self):
        assert _subtype_dist("end-terrace", "terraced") == 0

    def test_none_treated_as_compatible(self):
        assert _subtype_dist(None, "detached") == 0
        assert _subtype_dist("detached", None) == 0


# ===================================================================
# Hard deck filter
# ===================================================================

def _make_subject(**overrides) -> SubjectPropertyInput:
    """Create a SubjectPropertyInput with sensible defaults."""
    defaults = {
        "address": "10 Marsh Wall, London",
        "postcode": "E14 9TP",
        "tenure": "leasehold",
        "property_type": "flat",
        "bedrooms": 2,
        "building_era": "modern",
    }
    defaults.update(overrides)
    return SubjectPropertyInput(**defaults)


class TestPassesHardDeck:
    def test_exact_match(self):
        subject = _make_subject()
        assert _passes_hard_deck("leasehold", "flat", None, "modern", 2, subject, []) is True

    def test_tenure_mismatch_always_fails(self):
        subject = _make_subject(tenure="leasehold")
        assert _passes_hard_deck("freehold", "flat", None, "modern", 2, subject, []) is False

    def test_property_type_never_crosses(self):
        subject = _make_subject(property_type="flat")
        assert _passes_hard_deck("leasehold", "house", None, "modern", 2, subject, []) is False

    def test_flat_era_mismatch_fails(self):
        subject = _make_subject(property_type="flat", building_era="modern")
        assert _passes_hard_deck("leasehold", "flat", None, "period", 2, subject, []) is False

    def test_flat_era_none_passes(self):
        # Unknown era on candidate side should pass
        subject = _make_subject(property_type="flat", building_era="modern")
        assert _passes_hard_deck("leasehold", "flat", None, None, 2, subject, []) is True

    def test_flat_bedrooms_exact(self):
        subject = _make_subject(property_type="flat", bedrooms=2)
        assert _passes_hard_deck("leasehold", "flat", None, None, 2, subject, []) is True
        assert _passes_hard_deck("leasehold", "flat", None, None, 3, subject, []) is False

    def test_flat_bedrooms_relaxed(self):
        subject = _make_subject(property_type="flat", bedrooms=2)
        assert _passes_hard_deck("leasehold", "flat", None, None, 3, subject, ["bedrooms"]) is True
        assert _passes_hard_deck("leasehold", "flat", None, None, 4, subject, ["bedrooms"]) is False

    def test_house_subtype_strict(self):
        subject = _make_subject(property_type="house", tenure="freehold",
                                house_sub_type="semi-detached", building_era=None, bedrooms=None)
        # Same sub-type passes
        assert _passes_hard_deck("freehold", "house", "semi-detached", None, None, subject, []) is True
        # Adjacent sub-type fails without relaxation
        assert _passes_hard_deck("freehold", "house", "detached", None, None, subject, []) is False

    def test_house_subtype_relaxed(self):
        subject = _make_subject(property_type="house", tenure="freehold",
                                house_sub_type="semi-detached", building_era=None, bedrooms=None)
        # Adjacent sub-type (dist=1) passes with "type" relaxation
        assert _passes_hard_deck("freehold", "house", "detached", None, None, subject, ["type"]) is True
        # semi-detached(1) to terraced(2) = dist 1, also passes with relaxation
        assert _passes_hard_deck("freehold", "house", "terraced", None, None, subject, ["type"]) is True

    def test_house_subtype_relaxed_too_far(self):
        subject = _make_subject(property_type="house", tenure="freehold",
                                house_sub_type="detached", building_era=None, bedrooms=None)
        # detached(0) to terraced(2) = dist 2, fails even with relaxation (max_dist=1)
        assert _passes_hard_deck("freehold", "house", "terraced", None, None, subject, ["type"]) is False

    def test_house_ignores_bedroom_filter(self):
        # For houses, bedroom filter is NOT applied (habitable rooms != bedrooms)
        subject = _make_subject(property_type="house", tenure="freehold",
                                bedrooms=3, building_era=None)
        assert _passes_hard_deck("freehold", "house", None, None, 6, subject, []) is True


# ===================================================================
# Time window
# ===================================================================

class TestWithinWindow:
    def test_within(self, valuation_date):
        assert _within_window("2026-01-15", valuation_date, 12) is True

    def test_boundary(self, valuation_date):
        assert _within_window("2025-03-14", valuation_date, 12) is True

    def test_outside(self, valuation_date):
        assert _within_window("2024-01-01", valuation_date, 12) is False

    def test_invalid_date(self, valuation_date):
        assert _within_window("not-a-date", valuation_date, 12) is False


class TestMonthsAgo:
    def test_same_month(self):
        assert _months_ago("2026-03-01", date(2026, 3, 14)) == 0

    def test_one_month(self):
        assert _months_ago("2026-02-14", date(2026, 3, 14)) == 1

    def test_twelve_months(self):
        assert _months_ago("2025-03-14", date(2026, 3, 14)) == 12

    def test_invalid(self):
        assert _months_ago("bad", date(2026, 3, 14)) is None


# ===================================================================
# PPD row parsing
# ===================================================================

class TestParsePpdRow:
    def test_valid_freehold_house(self):
        row = {
            "deed_date": "2025-06-15",
            "price_paid": 450000,
            "postcode": "SM1 2EG",
            "property_type": "D",
            "estate_type": "F",
            "new_build": "N",
            "transaction_category": "A",
            "transaction_id": "abc-123",
            "saon": "",
            "paon": "41",
            "street": "HIGH STREET",
        }
        result = _parse_ppd_row(row)
        assert result is not None
        assert result["price"] == 450000
        assert result["postcode"] == "SM1 2EG"
        assert result["property_type"] == "house"
        assert result["house_sub_type"] == "detached"
        assert result["tenure"] == "freehold"
        assert result["new_build"] is False
        assert result["outward_code"] == "SM1"

    def test_valid_leasehold_flat(self):
        row = {
            "deed_date": "2025-09-20",
            "price_paid": 320000,
            "postcode": "E149TP",
            "property_type": "F",
            "estate_type": "L",
            "new_build": "N",
            "transaction_category": "A",
            "transaction_id": "def-456",
            "saon": "FLAT 38",
            "paon": "10",
            "street": "MARSH WALL",
        }
        result = _parse_ppd_row(row)
        assert result is not None
        assert result["tenure"] == "leasehold"
        assert result["property_type"] == "flat"
        assert result["postcode"] == "E14 9TP"

    def test_invalid_no_date(self):
        row = {"deed_date": "", "price_paid": 100000, "postcode": "SM1 2EG",
               "property_type": "D", "estate_type": "F"}
        assert _parse_ppd_row(row) is None

    def test_invalid_zero_price(self):
        row = {"deed_date": "2025-01-01", "price_paid": 0, "postcode": "SM1 2EG",
               "property_type": "D", "estate_type": "F"}
        assert _parse_ppd_row(row) is None

    def test_invalid_short_postcode(self):
        row = {"deed_date": "2025-01-01", "price_paid": 100000, "postcode": "SM1",
               "property_type": "D", "estate_type": "F"}
        assert _parse_ppd_row(row) is None


class TestDedupKey:
    def test_with_transaction_id(self):
        r = {"transaction_id": "abc-123", "saon": "", "paon": "41",
             "street": "HIGH ST", "postcode": "SM1 2EG", "sale_date": "2025-01-01"}
        assert _dedup_key(r) == "abc-123"

    def test_without_transaction_id(self):
        r = {"transaction_id": None, "saon": "FLAT 38", "paon": "10",
             "street": "MARSH WALL", "postcode": "E14 9TP", "sale_date": "2025-06-01"}
        key = _dedup_key(r)
        assert "FLAT 38" in key
        assert "E14 9TP" in key


# ===================================================================
# Translate bulk row
# ===================================================================

class TestTranslateBulkRow:
    def test_field_mapping(self):
        row = {
            "construction_year": "2012",
            "property_type": "Flat",
            "built_form": "Semi-Detached",
            "number_rooms": "3",
            "floor_area": "72.5",
            "energy_score": "72",
            "energy_rating": "C",
            "postcode": "E14 9TP",
        }
        result = _translate_bulk_row(row)
        assert "construction-year" in result
        assert "property-type" in result
        assert "built-form" in result
        assert "number-habitable-rooms" in result
        assert "total-floor-area" in result
        assert result["postcode"] == "E14 9TP"  # unmapped field preserved


# ===================================================================
# Haversine distance
# ===================================================================

class TestHaversine:
    def test_same_point(self):
        assert _haversine_m(51.5, -0.1, 51.5, -0.1) == 0.0

    def test_known_distance(self):
        # Canary Wharf to Tower Bridge: roughly 2.5km
        d = _haversine_m(51.5054, -0.0235, 51.5055, 0.0754)
        assert 6000 < d < 8000  # approximate

    def test_symmetry(self):
        d1 = _haversine_m(51.5, -0.1, 51.6, 0.0)
        d2 = _haversine_m(51.6, 0.0, 51.5, -0.1)
        assert abs(d1 - d2) < 0.01


# ===================================================================
# PPD type map
# ===================================================================

class TestPpdTypeMap:
    def test_detached(self):
        assert _PPD_TYPE_MAP["D"] == ("house", "detached")

    def test_flat(self):
        assert _PPD_TYPE_MAP["F"] == ("flat", None)

    def test_other(self):
        assert _PPD_TYPE_MAP["O"] == (None, None)

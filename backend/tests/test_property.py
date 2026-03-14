"""
Unit tests for the property router's pure functions.

Tests: address parsing (SAON/PAON extraction), postcode utilities,
fuzzy matching, coordinate transforms, address building, street
normalisation, sale filtering helpers.
"""
import pytest

from routers.property import (
    extract_postcode,
    normalise_postcode,
    build_epc_address,
    house_number,
    is_saon,
    _normalise_street,
    _paon_match,
    _saon_num,
    parse_user_address_parts,
    parse_address_parts,
    _street_part,
    combined_score,
    _lr_label,
    _latlon_to_bng,
)


# ===================================================================
# Postcode utilities
# ===================================================================

class TestExtractPostcode:
    def test_standard(self):
        assert extract_postcode("10 Marsh Wall, London, E14 9TP") == "E14 9TP"

    def test_no_space(self):
        assert extract_postcode("10 Marsh Wall E149TP") == "E149TP"

    def test_no_postcode(self):
        assert extract_postcode("10 Marsh Wall, London") is None

    def test_short_postcode(self):
        assert extract_postcode("5 High St, Sutton, SM1 1JF") == "SM1 1JF"

    def test_long_outward(self):
        assert extract_postcode("1 Buckingham Palace, London, SW1A 1AA") == "SW1A 1AA"


class TestNormalisePostcode:
    def test_no_space(self):
        assert normalise_postcode("SM12EG") == "SM1 2EG"

    def test_already_spaced(self):
        assert normalise_postcode("SM1 2EG") == "SM1 2EG"

    def test_lowercase(self):
        assert normalise_postcode("sm12eg") == "SM1 2EG"

    def test_extra_whitespace(self):
        assert normalise_postcode("  E14  9TP  ") == "E14 9TP"

    def test_too_short(self):
        # Short postcodes returned as-is (uppercased)
        result = normalise_postcode("SM1")
        assert result == "SM1"

    def test_sw1a(self):
        assert normalise_postcode("SW1A1AA") == "SW1A 1AA"


# ===================================================================
# Address building
# ===================================================================

class TestBuildEpcAddress:
    def test_flat(self, sample_epc_row):
        result = build_epc_address(sample_epc_row)
        assert "FLAT 38" in result
        assert "10 MARSH WALL" in result
        assert "E14 9TP" in result

    def test_house(self, sample_epc_row_house):
        result = build_epc_address(sample_epc_row_house)
        assert "41" in result
        assert "HIGH STREET" in result

    def test_empty_fields(self):
        row = {"address1": "", "address2": "", "postcode": "SM1 2EG"}
        result = build_epc_address(row)
        assert "SM1 2EG" in result


# ===================================================================
# House number extraction
# ===================================================================

class TestHouseNumber:
    def test_leading_number(self):
        assert house_number("10 Marsh Wall") == "10"

    def test_flat_number(self):
        assert house_number("Flat 38B Compass House") == "38B"

    def test_number_with_letter(self):
        assert house_number("5A High Street") == "5A"

    def test_no_number(self):
        assert house_number("Compass House, Marsh Wall") is None


# ===================================================================
# SAON detection
# ===================================================================

class TestIsSaon:
    def test_flat(self):
        assert is_saon("Flat 38") is True

    def test_apartment(self):
        assert is_saon("Apartment 4908") is True

    def test_unit(self):
        assert is_saon("Unit 5B") is True

    def test_suite(self):
        assert is_saon("Suite 100") is True

    def test_house_number(self):
        assert is_saon("10 Marsh Wall") is False

    def test_building_name(self):
        assert is_saon("Compass House") is False


# ===================================================================
# Street normalisation
# ===================================================================

class TestNormaliseStreetProperty:
    def test_expand_abbreviations(self):
        result = _normalise_street("10 HIGH ST")
        assert "STREET" in result

    def test_strip_leading_number(self):
        result = _normalise_street("10 HIGH STREET")
        assert result.startswith("HIGH")

    def test_comma_prefix(self):
        result = _normalise_street(", CUTTER LANE")
        assert result == "CUTTER LANE"


# ===================================================================
# PAON matching
# ===================================================================

class TestPaonMatch:
    def test_exact(self):
        assert _paon_match("41", "41") is True

    def test_different(self):
        assert _paon_match("41", "42") is False

    def test_hyphen_range(self):
        assert _paon_match("101", "101 - 103") is True
        assert _paon_match("103", "101 - 103") is True

    def test_hyphen_no_spaces(self):
        assert _paon_match("101-103", "101 - 103") is True

    def test_comma_separated(self):
        assert _paon_match("1", "WESTMARK TOWER, 1") is True

    def test_building_plus_range(self):
        assert _paon_match("EYRE COURT 3-21", "EYRE COURT, 3 - 21") is True


# ===================================================================
# SAON number extraction
# ===================================================================

class TestSaonNum:
    def test_flat_number(self):
        assert _saon_num("FLAT 38") == "38"

    def test_flat_with_letter(self):
        assert _saon_num("FLAT 38B") == "38B"

    def test_apartment_alpha(self):
        assert _saon_num("APARTMENT A13") == "A13"

    def test_plain_number(self):
        assert _saon_num("105") == "105"

    def test_empty(self):
        assert _saon_num("") is None


# ===================================================================
# Parse user address parts
# ===================================================================

class TestParseUserAddressParts:
    def test_house_simple(self):
        result = parse_user_address_parts("5 Horse Shoe Green, Sutton, SM1 3LS", "SM1 3LS")
        assert result["saon"] is None
        assert result["paon"] == "5"
        assert result["street"] is not None
        assert "HORSE" in result["street"]

    def test_flat(self):
        result = parse_user_address_parts("Flat 3, 12 High Street, London, E1 1AA", "E1 1AA")
        assert result["saon"] == "FLAT 3"
        assert result["paon"] == "12"
        assert result["street"] is not None

    def test_empty(self):
        result = parse_user_address_parts("", "E1 1AA")
        assert result["saon"] is None


# ===================================================================
# Parse EPC address parts
# ===================================================================

class TestParseAddressParts:
    def test_flat_in_address1(self, sample_epc_row):
        result = parse_address_parts(sample_epc_row)
        assert result["saon"] == "FLAT 38"
        assert result["paon"] is not None

    def test_house(self, sample_epc_row_house):
        result = parse_address_parts(sample_epc_row_house)
        assert result["saon"] is None
        assert result["paon"] == "41"
        assert result["street"] == "HIGH STREET"

    def test_flat_with_building_name(self):
        row = {
            "address1": "FLAT 170 COMPASS HOUSE",
            "address2": "5 PARK STREET",
            "address3": "",
        }
        result = parse_address_parts(row)
        assert result["saon"] == "FLAT 170"
        assert result["paon"] == "COMPASS HOUSE"

    def test_range_paon(self):
        row = {
            "address1": "FLAT 1",
            "address2": "101 - 103 CLEVELAND STREET",
            "address3": "",
        }
        result = parse_address_parts(row)
        assert result["saon"] == "FLAT 1"
        assert "101" in result["paon"]


# ===================================================================
# Street part extraction
# ===================================================================

class TestStreetPart:
    def test_basic(self):
        result = _street_part("5 Horse Shoe Green, Sutton")
        assert "horse" in result
        assert "shoe" in result
        assert "green" in result

    def test_no_number(self):
        result = _street_part("Compass House, Marsh Wall")
        assert len(result) > 0


# ===================================================================
# Combined score
# ===================================================================

class TestCombinedScore:
    def test_exact_match(self):
        score = combined_score("10 Marsh Wall, London E14 9TP",
                               "10 Marsh Wall, London E14 9TP")
        assert score == 1.0

    def test_number_mismatch_returns_zero(self):
        score = combined_score("10 Marsh Wall", "11 Marsh Wall")
        assert score == 0.0

    def test_different_street_same_number(self):
        score = combined_score("10 Marsh Wall", "10 Completely Different Road")
        assert score == 0.0

    def test_similar_addresses(self):
        score = combined_score("10 Marsh Wall London", "10 MARSH WALL, LONDON")
        assert score > 0.7


# ===================================================================
# LR label extraction
# ===================================================================

class TestLrLabel:
    def test_freehold(self):
        assert _lr_label("http://landregistry.data.gov.uk/def/common/freehold") == "Freehold"

    def test_leasehold(self):
        assert _lr_label("http://landregistry.data.gov.uk/def/common/leasehold") == "Leasehold"

    def test_empty(self):
        assert _lr_label("") == ""


# ===================================================================
# Coordinate transforms
# ===================================================================

class TestLatLonToBng:
    def test_central_london(self):
        # Big Ben: approx 51.5007, -0.1246 → E530000, N179000 (roughly)
        e, n = _latlon_to_bng(51.5007, -0.1246)
        assert 529000 < e < 531000
        assert 178000 < n < 180500

    def test_canary_wharf(self):
        # Canary Wharf: approx 51.5054, -0.0235 → E538500, N180200 (roughly)
        e, n = _latlon_to_bng(51.5054, -0.0235)
        assert 537000 < e < 540000
        assert 179000 < n < 181500

    def test_returns_integers(self):
        e, n = _latlon_to_bng(51.5, -0.1)
        assert isinstance(e, int)
        assert isinstance(n, int)

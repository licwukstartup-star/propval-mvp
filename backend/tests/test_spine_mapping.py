"""
Layer 1: Unit tests for spine column mapping.
No Supabase calls — tests pure mapping logic.
"""
import pytest


# Import the mapping function from ppd_cache
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from routers.ppd_cache import _spine_to_ppd_format, _spine_rows


class TestSpineToPpdFormat:
    """Verify spine transactions rows map correctly to PPD cache format."""

    def _sample_spine_row(self, **overrides):
        base = {
            "transaction_id": "{TEST-1234-ABCD}",
            "price": 450000,
            "date_of_transfer": "2024-06-15",
            "postcode": "SW1A 1AA",
            "outward_code": "SW1A",
            "saon": "FLAT 3",
            "paon": "10",
            "street": "DOWNING STREET",
            "district": "CITY OF WESTMINSTER",
            "ppd_type": "F",
            "duration": "L",
            "old_new": "N",
            "ppd_category": "A",
            "uprn": "100023336956",
            "lmk_key": "LMK123",
            "epc_property_type": "Flat",
            "floor_area_sqm": 72.5,
            "energy_rating": "C",
            "energy_score": 68,
            "construction_age_band": "1930-1949",
            "age_best": 1939,
            "lat": 51.5034,
            "lon": -0.1276,
            "coord_source": "os_open_uprn",
        }
        base.update(overrides)
        return base

    def test_basic_mapping(self):
        row = self._sample_spine_row()
        mapped = _spine_to_ppd_format(row)

        assert mapped["transaction_id"] == "{TEST-1234-ABCD}"
        assert mapped["deed_date"] == "2024-06-15"
        assert mapped["price_paid"] == 450000
        assert mapped["postcode"] == "SW1A 1AA"
        assert mapped["outward_code"] == "SW1A"
        assert mapped["property_type"] == "F"
        assert mapped["estate_type"] == "L"
        assert mapped["new_build"] == "N"
        assert mapped["transaction_category"] == "A"
        assert mapped["saon"] == "FLAT 3"
        assert mapped["paon"] == "10"
        assert mapped["street"] == "DOWNING STREET"

    def test_uprn_preserved(self):
        row = self._sample_spine_row(uprn="200065424")
        mapped = _spine_to_ppd_format(row)
        assert mapped["uprn"] == "200065424"

    def test_epc_fields_preserved(self):
        row = self._sample_spine_row()
        mapped = _spine_to_ppd_format(row)
        assert mapped["lmk_key"] == "LMK123"
        assert mapped["epc_property_type"] == "Flat"
        assert mapped["floor_area_sqm"] == 72.5
        assert mapped["energy_rating"] == "C"
        assert mapped["energy_score"] == 68
        assert mapped["construction_age_band"] == "1930-1949"
        assert mapped["age_best"] == 1939

    def test_coordinates_preserved(self):
        row = self._sample_spine_row()
        mapped = _spine_to_ppd_format(row)
        assert mapped["lat"] == 51.5034
        assert mapped["lon"] == -0.1276
        assert mapped["coord_source"] == "os_open_uprn"

    def test_new_build_yes(self):
        row = self._sample_spine_row(old_new="Y")
        mapped = _spine_to_ppd_format(row)
        assert mapped["new_build"] == "Y"

    def test_new_build_no(self):
        row = self._sample_spine_row(old_new="N")
        mapped = _spine_to_ppd_format(row)
        assert mapped["new_build"] == "N"

    def test_new_build_none(self):
        row = self._sample_spine_row(old_new=None)
        mapped = _spine_to_ppd_format(row)
        assert mapped["new_build"] == "N"

    def test_null_fields_handled(self):
        row = self._sample_spine_row(
            saon=None, uprn=None, lmk_key=None,
            floor_area_sqm=None, energy_rating=None, lat=None, lon=None
        )
        mapped = _spine_to_ppd_format(row)
        assert mapped["saon"] is None
        assert mapped["uprn"] is None
        assert mapped["lmk_key"] is None
        assert mapped["floor_area_sqm"] is None
        assert mapped["lat"] is None

    def test_date_truncated_to_10_chars(self):
        row = self._sample_spine_row(date_of_transfer="2024-06-15T00:00:00")
        mapped = _spine_to_ppd_format(row)
        assert mapped["deed_date"] == "2024-06-15"

    def test_freehold_mapping(self):
        row = self._sample_spine_row(duration="F")
        mapped = _spine_to_ppd_format(row)
        assert mapped["estate_type"] == "F"

    def test_house_type_mapping(self):
        row = self._sample_spine_row(ppd_type="D")
        mapped = _spine_to_ppd_format(row)
        assert mapped["property_type"] == "D"


class TestSpineRows:
    """Test batch mapping of spine rows."""

    def test_empty_list(self):
        assert _spine_rows([]) == []

    def test_multiple_rows(self):
        rows = [
            {"transaction_id": "A", "price": 100, "date_of_transfer": "2024-01-01",
             "postcode": "SW1A 1AA", "outward_code": "SW1A", "saon": None, "paon": "1",
             "street": "HIGH ST", "district": "WESTMINSTER", "ppd_type": "D",
             "duration": "F", "old_new": "N", "ppd_category": "A", "uprn": "123",
             "lmk_key": None, "epc_property_type": None, "floor_area_sqm": None,
             "energy_rating": None, "energy_score": None, "construction_age_band": None,
             "age_best": None, "lat": None, "lon": None, "coord_source": None},
            {"transaction_id": "B", "price": 200, "date_of_transfer": "2024-02-01",
             "postcode": "E1 6AN", "outward_code": "E1", "saon": "FLAT 1", "paon": "5",
             "street": "BRICK LANE", "district": "TOWER HAMLETS", "ppd_type": "F",
             "duration": "L", "old_new": "N", "ppd_category": "A", "uprn": "456",
             "lmk_key": "LMK1", "epc_property_type": "Flat", "floor_area_sqm": 55.0,
             "energy_rating": "D", "energy_score": 60, "construction_age_band": "1900-1929",
             "age_best": 1910, "lat": 51.52, "lon": -0.07, "coord_source": "os_open_uprn"},
        ]
        mapped = _spine_rows(rows)
        assert len(mapped) == 2
        assert mapped[0]["transaction_id"] == "A"
        assert mapped[0]["deed_date"] == "2024-01-01"
        assert mapped[1]["transaction_id"] == "B"
        assert mapped[1]["price_paid"] == 200
        assert mapped[1]["estate_type"] == "L"

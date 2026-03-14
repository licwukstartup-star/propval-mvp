"""
Shared fixtures for PropVal backend tests.

All tests are pure unit tests — no database, no HTTP, no external APIs.
We patch environment variables and external dependencies at import time
where necessary.
"""
import os
import sys
from datetime import date
from unittest.mock import patch

import pytest

# Ensure the backend directory is on sys.path so `from routers.X import Y` works.
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_epc_row():
    """A realistic EPC row as returned by the EPC API."""
    return {
        "address1": "FLAT 38",
        "address2": "10 MARSH WALL",
        "address3": "",
        "posttown": "LONDON",
        "postcode": "E14 9TP",
        "property-type": "Flat",
        "built-form": "Enclosed Mid-Terrace",
        "construction-age-band": "2007 onwards",
        "construction-year": "2012",
        "number-habitable-rooms": "3",
        "total-floor-area": "72.5",
        "current-energy-rating": "C",
        "current-energy-efficiency": "72",
        "uprn": "100023456789",
    }


@pytest.fixture
def sample_epc_row_house():
    """A realistic EPC row for a house."""
    return {
        "address1": "41",
        "address2": "HIGH STREET",
        "address3": "",
        "posttown": "SUTTON",
        "postcode": "SM1 1JF",
        "property-type": "House",
        "built-form": "Semi-Detached",
        "construction-age-band": "1930-1949",
        "construction-year": "",
        "number-habitable-rooms": "5",
        "total-floor-area": "95.0",
        "current-energy-rating": "D",
        "current-energy-efficiency": "58",
        "uprn": "100023456790",
    }


@pytest.fixture
def valuation_date():
    """Standard valuation date for time-window tests."""
    return date(2026, 3, 14)

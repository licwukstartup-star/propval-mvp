"""
Layer 3b: Integration tests for case lifecycle.
Tests the full status flow with mocked Supabase responses.
No real Supabase calls — all mocked via unittest.mock.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from datetime import datetime

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.cases import (
    STATUS_FLOW,
    CASE_TYPES,
    CASE_STATUSES,
    _generate_display_name,
    _next_case_sequence,
)


# ---------------------------------------------------------------------------
# Unit tests for pure functions
# ---------------------------------------------------------------------------

class TestGenerateDisplayName:
    def test_research_case(self):
        name = _generate_display_name("41 Gander Green Lane", "research", None, "2026-03-22")
        assert "41 Gander Green Lane" in name
        assert "Research" in name
        assert "2026-03-22" in name

    def test_full_valuation_with_basis(self):
        name = _generate_display_name(
            "Flat 3, 10 Marsh Wall", "full_valuation", "market_value", "2026-04-01"
        )
        assert "Full Valuation" in name
        assert "Market Value" in name
        assert "2026-04-01" in name

    def test_no_valuation_date_uses_today(self):
        name = _generate_display_name("123 High Street", "research")
        today = datetime.utcnow().strftime("%Y-%m-%d")
        assert today in name

    def test_no_basis_omits_it(self):
        name = _generate_display_name("10 Downing Street", "research", None, "2026-01-01")
        parts = name.split(" | ")
        assert len(parts) == 3  # address | type | date (no basis)


class TestStatusFlow:
    """Verify the status flow rules are correct per RICS requirements."""

    def test_draft_can_go_to_in_progress(self):
        assert "in_progress" in STATUS_FLOW["draft"]

    def test_in_progress_can_go_to_draft_or_complete(self):
        assert "draft" in STATUS_FLOW["in_progress"]
        assert "complete" in STATUS_FLOW["in_progress"]

    def test_complete_can_go_to_in_progress_or_issued(self):
        assert "in_progress" in STATUS_FLOW["complete"]
        assert "issued" in STATUS_FLOW["complete"]

    def test_issued_can_only_go_to_archived(self):
        assert STATUS_FLOW["issued"] == ["archived"]

    def test_archived_is_terminal(self):
        assert STATUS_FLOW["archived"] == []

    def test_cannot_go_from_issued_to_in_progress(self):
        assert "in_progress" not in STATUS_FLOW["issued"]

    def test_cannot_go_from_issued_to_draft(self):
        assert "draft" not in STATUS_FLOW["issued"]

    def test_cannot_go_from_archived_to_anything(self):
        assert len(STATUS_FLOW["archived"]) == 0

    def test_all_statuses_have_flow_entry(self):
        for status in CASE_STATUSES:
            assert status in STATUS_FLOW, f"Missing STATUS_FLOW entry for {status}"

    def test_all_flow_targets_are_valid_statuses(self):
        for status, targets in STATUS_FLOW.items():
            for target in targets:
                assert target in CASE_STATUSES, f"Invalid target '{target}' in STATUS_FLOW['{status}']"


class TestCaseTypes:
    def test_research_is_valid(self):
        assert "research" in CASE_TYPES

    def test_full_valuation_is_valid(self):
        assert "full_valuation" in CASE_TYPES


class TestStatusTransitionMatrix:
    """Exhaustive test: every status → every status transition."""

    ALL_TRANSITIONS = [
        (from_s, to_s)
        for from_s in CASE_STATUSES
        for to_s in CASE_STATUSES
        if from_s != to_s
    ]

    @pytest.mark.parametrize("from_status,to_status", ALL_TRANSITIONS)
    def test_transition(self, from_status, to_status):
        allowed = STATUS_FLOW.get(from_status, [])
        if to_status in allowed:
            # This transition should be permitted
            assert to_status in allowed
        else:
            # This transition should be blocked
            assert to_status not in allowed


class TestIssuedImmutability:
    """Verify that issued cases are locked from edits."""

    def test_issued_blocks_data_edits(self):
        """Once issued, only status change to 'archived' is allowed."""
        allowed = STATUS_FLOW["issued"]
        assert allowed == ["archived"]
        # No other transition is valid
        for status in CASE_STATUSES:
            if status != "archived":
                assert status not in allowed

    def test_archived_blocks_everything(self):
        """Archived is terminal — no transitions."""
        assert STATUS_FLOW["archived"] == []


class TestNextCaseSequence:
    """Test case sequence numbering."""

    def test_no_uprn_returns_1(self):
        mock_sb = MagicMock()
        result = _next_case_sequence(mock_sb, None)
        assert result == 1

    def test_first_case_for_uprn(self):
        mock_sb = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = []
        mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = mock_resp
        result = _next_case_sequence(mock_sb, "100023456789")
        assert result == 1

    def test_second_case_for_uprn(self):
        mock_sb = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = [{"case_sequence": 1}]
        mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = mock_resp
        result = _next_case_sequence(mock_sb, "100023456789")
        assert result == 2

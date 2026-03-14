from unittest.mock import AsyncMock, MagicMock

import pytest

from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import (
    CallDisposition,
    OutreachRecord,
)
from leadforge.pipeline.sentiment_feedback import (
    _compute_multiplier,
    apply_sentiment_feedback,
)


class TestComputeMultiplier:
    """Test _compute_multiplier pure logic."""

    def test_positive_sentiment(self):
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_sentiment_score = 0.7
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1
        assert _compute_multiplier(outreach) == 1.15

    def test_negative_sentiment(self):
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_sentiment_score = -0.5
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1
        assert _compute_multiplier(outreach) == 0.75

    def test_neutral_sentiment(self):
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_sentiment_score = 0.1
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1
        assert _compute_multiplier(outreach) is None

    def test_no_answer_two_attempts(self):
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_disposition = CallDisposition.NO_ANSWER
        outreach.call_attempts = 2
        outreach.call_sentiment_score = None
        assert _compute_multiplier(outreach) == 0.90

    def test_voicemail_two_attempts(self):
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_disposition = CallDisposition.VOICEMAIL
        outreach.call_attempts = 3
        outreach.call_sentiment_score = None
        assert _compute_multiplier(outreach) == 0.90

    def test_no_answer_one_attempt_no_multiplier(self):
        """Single no-answer attempt should not trigger the 0.90 multiplier."""
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_disposition = CallDisposition.NO_ANSWER
        outreach.call_attempts = 1
        outreach.call_sentiment_score = None
        assert _compute_multiplier(outreach) is None

    def test_no_sentiment_score(self):
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_sentiment_score = None
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1
        assert _compute_multiplier(outreach) is None

    def test_boundary_positive(self):
        """Exactly 0.3 should be neutral (not positive)."""
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_sentiment_score = 0.3
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1
        assert _compute_multiplier(outreach) is None

    def test_boundary_negative(self):
        """Exactly -0.3 should be neutral (not negative)."""
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_sentiment_score = -0.3
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1
        assert _compute_multiplier(outreach) is None

    def test_no_answer_overrides_positive_sentiment(self):
        """No-answer with 2+ attempts takes priority even if sentiment is positive."""
        outreach = MagicMock(spec=OutreachRecord)
        outreach.call_disposition = CallDisposition.NO_ANSWER
        outreach.call_attempts = 2
        outreach.call_sentiment_score = 0.8
        assert _compute_multiplier(outreach) == 0.90


@pytest.mark.asyncio
class TestApplySentimentFeedback:
    async def test_applies_positive_multiplier(self):
        lead_score = MagicMock(spec=LeadScore)
        lead_score.composite_acquisition_score = 50.0
        lead_score.sentiment_adjustment = None

        outreach = MagicMock(spec=OutreachRecord)
        outreach.business_id = "test-uuid"
        outreach.call_sentiment_score = 0.7
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = lead_score

        session = AsyncMock()
        session.execute.return_value = mock_result

        result = await apply_sentiment_feedback(session, outreach)
        assert result == 1.15
        assert lead_score.composite_acquisition_score == pytest.approx(
            57.5
        )  # 50 * 1.15

    async def test_caps_at_100(self):
        lead_score = MagicMock(spec=LeadScore)
        lead_score.composite_acquisition_score = 95.0
        lead_score.sentiment_adjustment = None

        outreach = MagicMock(spec=OutreachRecord)
        outreach.business_id = "test-uuid"
        outreach.call_sentiment_score = 0.8
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = lead_score

        session = AsyncMock()
        session.execute.return_value = mock_result

        result = await apply_sentiment_feedback(session, outreach)
        assert result == 1.15
        assert lead_score.composite_acquisition_score == 100.0  # capped

    async def test_idempotent_skips_already_applied(self):
        lead_score = MagicMock(spec=LeadScore)
        lead_score.composite_acquisition_score = 57.5
        lead_score.sentiment_adjustment = 1.15  # Already applied

        outreach = MagicMock(spec=OutreachRecord)
        outreach.business_id = "test-uuid"
        outreach.call_sentiment_score = 0.7
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.call_attempts = 1

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = lead_score

        session = AsyncMock()
        session.execute.return_value = mock_result

        result = await apply_sentiment_feedback(session, outreach)
        assert result is None  # Skipped
        assert lead_score.composite_acquisition_score == 57.5  # Unchanged

    async def test_no_lead_score_returns_none(self):
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        session = AsyncMock()
        session.execute.return_value = mock_result

        outreach = MagicMock(spec=OutreachRecord)
        outreach.business_id = "test-uuid"

        result = await apply_sentiment_feedback(session, outreach)
        assert result is None

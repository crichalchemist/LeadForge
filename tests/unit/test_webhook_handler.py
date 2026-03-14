from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from leadforge.api.app import app


@pytest.fixture
def retell_call_ended_payload():
    """Retell call_ended webhook: nested under 'call', no call_analysis."""
    return {
        "event": "call_ended",
        "call": {
            "call_id": "call_abc123",
            "transcript": "Agent: Hello, I'm calling about marketing services. Owner: Sounds interesting.",
            "disconnection_reason": "agent_hangup",
            "call_status": "ended",
            "from_number": "+13125551000",
            "to_number": "+17735551234",
        },
    }


@pytest.fixture
def retell_call_analyzed_payload():
    """Retell call_analyzed webhook: includes call_analysis with sentiment."""
    return {
        "event": "call_analyzed",
        "call": {
            "call_id": "call_abc123",
            "call_analysis": {
                "call_successful": True,
                "customer_sentiment": "Positive",
            },
        },
    }


@pytest.fixture
def retell_voicemail_payload():
    """Retell call_ended webhook: voicemail reached."""
    return {
        "event": "call_ended",
        "call": {
            "call_id": "call_vm456",
            "transcript": "",
            "disconnection_reason": "voicemail_reached",
            "call_status": "ended",
        },
    }


@pytest.mark.asyncio
class TestCallCompleteWebhook:
    async def test_missing_call_id(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/webhooks/retell/call-complete",
                json={"event": "call_ended", "call": {}},
            )
            assert resp.status_code == 400

    async def test_unknown_call_id(self, retell_call_ended_payload):
        mock_outreach = None
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_outreach

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session.commit = AsyncMock()

        async def mock_get_db():
            yield mock_session

        app.dependency_overrides[
            __import__("leadforge.api.deps", fromlist=["get_db"]).get_db
        ] = mock_get_db

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/webhooks/retell/call-complete", json=retell_call_ended_payload
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "ignored"

        app.dependency_overrides.clear()

    async def test_call_ended_processing(self, retell_call_ended_payload):
        """call_ended sets transcript and disposition but not sentiment."""
        from leadforge.api.deps import get_db
        from leadforge.db.models.outreach_record import (
            CallDisposition,
            OutreachRecord,
            PipelineStage,
        )

        mock_outreach = MagicMock(spec=OutreachRecord)
        mock_outreach.id = "outreach-123"
        mock_outreach.call_transcript = None
        mock_outreach.call_disposition = None
        mock_outreach.call_sentiment_score = None
        mock_outreach.status = PipelineStage.CONTACTED

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_outreach

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session.commit = AsyncMock()

        async def mock_get_db():
            yield mock_session

        with patch(
            "leadforge.voice.webhook_handler._dispatch_sentiment_task"
        ) as mock_dispatch:
            app.dependency_overrides[get_db] = mock_get_db

            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/webhooks/retell/call-complete", json=retell_call_ended_payload
                )

            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
            assert mock_outreach.call_disposition == CallDisposition.ANSWERED
            assert mock_outreach.status == PipelineStage.CONTACTED
            assert mock_outreach.call_transcript is not None
            # Sentiment task dispatched because transcript is present
            mock_dispatch.assert_called_once_with("outreach-123")

        app.dependency_overrides.clear()

    async def test_call_analyzed_processing(self, retell_call_analyzed_payload):
        """call_analyzed sets sentiment and upgrades to ENGAGED."""
        from leadforge.api.deps import get_db
        from leadforge.db.models.outreach_record import (
            CallDisposition,
            OutreachRecord,
            PipelineStage,
        )

        mock_outreach = MagicMock(spec=OutreachRecord)
        mock_outreach.id = "outreach-789"
        mock_outreach.call_transcript = "Some transcript from earlier call_ended"
        mock_outreach.call_disposition = CallDisposition.ANSWERED
        mock_outreach.call_sentiment_score = None
        mock_outreach.status = PipelineStage.CONTACTED

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_outreach

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session.commit = AsyncMock()

        async def mock_get_db():
            yield mock_session

        with patch(
            "leadforge.voice.webhook_handler._dispatch_sentiment_task"
        ) as mock_dispatch:
            app.dependency_overrides[get_db] = mock_get_db

            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/webhooks/retell/call-complete", json=retell_call_analyzed_payload
                )

            assert resp.status_code == 200
            assert mock_outreach.call_sentiment_score == 0.7  # "Positive"
            assert mock_outreach.status == PipelineStage.ENGAGED
            # Sentiment task dispatched because transcript was already present
            mock_dispatch.assert_called_once_with("outreach-789")

        app.dependency_overrides.clear()

    async def test_voicemail_processing(self, retell_voicemail_payload):
        from leadforge.api.deps import get_db
        from leadforge.db.models.outreach_record import (
            CallDisposition,
            OutreachRecord,
            PipelineStage,
        )

        mock_outreach = MagicMock(spec=OutreachRecord)
        mock_outreach.id = "outreach-456"
        mock_outreach.call_transcript = None
        mock_outreach.call_disposition = None
        mock_outreach.status = PipelineStage.CONTACTED

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_outreach

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session.commit = AsyncMock()

        async def mock_get_db():
            yield mock_session

        with patch(
            "leadforge.voice.webhook_handler._dispatch_sentiment_task"
        ) as mock_dispatch:
            app.dependency_overrides[get_db] = mock_get_db

            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/webhooks/retell/call-complete", json=retell_voicemail_payload
                )

            assert resp.status_code == 200
            assert mock_outreach.call_disposition == CallDisposition.VOICEMAIL
            assert mock_outreach.status == PipelineStage.VOICEMAIL
            # No sentiment task — no transcript for voicemail
            mock_dispatch.assert_not_called()

        app.dependency_overrides.clear()


@pytest.mark.asyncio
class TestCallEventWebhook:
    async def test_call_event_returns_ok(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/webhooks/retell/call-event",
                json={"event": "call_started", "call": {"call_id": "c123"}},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
class TestHealthCheck:
    async def test_health_endpoint(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/health")
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"

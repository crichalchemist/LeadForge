import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from httpx import AsyncClient, ASGITransport
from leadforge.api.app import app


@pytest.fixture
def retell_call_complete_payload():
    return {
        "call_id": "call_abc123",
        "transcript": "Agent: Hello, I'm calling about marketing services. Owner: Sounds interesting.",
        "disconnection_reason": "agent_hangup",
        "call_analysis": {
            "call_successful": True,
            "customer_sentiment": "Positive",
        },
    }


@pytest.fixture
def retell_voicemail_payload():
    return {
        "call_id": "call_vm456",
        "transcript": "",
        "disconnection_reason": "voicemail_reached",
        "call_analysis": {
            "call_successful": False,
        },
    }


@pytest.mark.asyncio
class TestCallCompleteWebhook:

    async def test_missing_call_id(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/webhooks/retell/call-complete", json={})
            assert resp.status_code == 400

    async def test_unknown_call_id(self, retell_call_complete_payload):
        mock_outreach = None
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_outreach

        mock_session = AsyncMock()
        mock_session.execute.return_value = mock_result
        mock_session.commit = AsyncMock()

        async def mock_get_db():
            yield mock_session

        app.dependency_overrides[__import__('leadforge.api.deps', fromlist=['get_db']).get_db] = mock_get_db

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/webhooks/retell/call-complete", json=retell_call_complete_payload)
            assert resp.status_code == 200
            assert resp.json()["status"] == "ignored"

        app.dependency_overrides.clear()

    async def test_successful_call_processing(self, retell_call_complete_payload):
        from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage, CallDisposition
        from leadforge.api.deps import get_db

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

        with patch("leadforge.voice.webhook_handler._dispatch_sentiment_task") as mock_dispatch:
            app.dependency_overrides[get_db] = mock_get_db

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post("/webhooks/retell/call-complete", json=retell_call_complete_payload)

            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
            assert mock_outreach.call_disposition == CallDisposition.ANSWERED
            assert mock_outreach.status == PipelineStage.ENGAGED
            assert mock_outreach.call_sentiment_score == 0.7  # "Positive"
            mock_dispatch.assert_called_once_with("outreach-123")

        app.dependency_overrides.clear()

    async def test_voicemail_processing(self, retell_voicemail_payload):
        from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage, CallDisposition
        from leadforge.api.deps import get_db

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

        with patch("leadforge.voice.webhook_handler._dispatch_sentiment_task") as mock_dispatch:
            app.dependency_overrides[get_db] = mock_get_db

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post("/webhooks/retell/call-complete", json=retell_voicemail_payload)

            assert resp.status_code == 200
            assert mock_outreach.call_disposition == CallDisposition.VOICEMAIL
            assert mock_outreach.status == PipelineStage.VOICEMAIL

        app.dependency_overrides.clear()


@pytest.mark.asyncio
class TestCallEventWebhook:

    async def test_call_event_returns_ok(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/webhooks/retell/call-event", json={"event": "call_started", "call_id": "c123"})
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

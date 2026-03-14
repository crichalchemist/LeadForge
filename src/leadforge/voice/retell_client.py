import hmac
import hashlib
import structlog
import httpx
from leadforge.config import settings

logger = structlog.get_logger()

RETELL_BASE_URL = "https://api.retellai.com"


def verify_retell_signature(payload_bytes: bytes, signature: str, api_key: str) -> bool:
    """Verify x-retell-signature header using HMAC-SHA256."""
    expected = hmac.new(api_key.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


class RetellClient:
    """Client for Retell AI voice agent API (v2)."""

    def __init__(self):
        self.api_key = settings.RETELL_API_KEY
        self.from_number = settings.RETELL_FROM_NUMBER
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=RETELL_BASE_URL,
                timeout=30.0,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
        return self._client

    async def create_agent(
        self,
        agent_name: str,
        llm_id: str,
        voice_id: str = "11labs-Rachel",
        webhook_url: str | None = None,
    ) -> dict | None:
        """Create a Retell voice agent.

        Args:
            agent_name: Display name for the agent.
            llm_id: Retell LLM ID (created via dashboard or LLM API).
            voice_id: Voice identifier from Retell's voice library.
            webhook_url: Agent-level webhook URL override.
        """
        if not self.api_key:
            logger.warning("retell_api_key_not_set")
            return None
        try:
            client = await self._get_client()
            payload: dict = {
                "agent_name": agent_name,
                "voice_id": voice_id,
                "response_engine": {"type": "retell-llm", "llm_id": llm_id},
            }
            if webhook_url:
                payload["webhook_url"] = webhook_url
            response = await client.post("/create-agent", json=payload)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error("retell_create_agent_failed", error=str(e))
            return None

    async def initiate_call(
        self,
        agent_id: str,
        to_number: str,
        from_number: str | None = None,
        metadata: dict | None = None,
        dynamic_variables: dict | None = None,
    ) -> dict | None:
        """Initiate an outbound phone call via Retell v2 API.

        Args:
            agent_id: The Retell agent ID to use for the call.
            to_number: Recipient phone number in E.164 format.
            from_number: Caller number in E.164 (must be owned in Retell).
                         Falls back to settings.RETELL_FROM_NUMBER.
            metadata: Custom metadata dict (e.g. business_id, outreach_id).
            dynamic_variables: Variables injected into the Retell LLM prompt.
        """
        if not self.api_key:
            return None

        caller = from_number or self.from_number
        if not caller:
            logger.error("retell_no_from_number", msg="RETELL_FROM_NUMBER not configured")
            return None

        try:
            client = await self._get_client()
            payload: dict = {
                "from_number": caller,
                "to_number": to_number,
            }
            if agent_id:
                payload["override_agent_id"] = agent_id
            if metadata:
                payload["metadata"] = metadata
            if dynamic_variables:
                payload["retell_llm_dynamic_variables"] = dynamic_variables

            response = await client.post("/v2/create-phone-call", json=payload)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error("retell_initiate_call_failed", error=str(e), to_number=to_number)
            return None

    async def get_call(self, call_id: str) -> dict | None:
        """Get call details and transcript."""
        if not self.api_key:
            return None
        try:
            client = await self._get_client()
            response = await client.get(f"/v2/get-call/{call_id}")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error("retell_get_call_failed", error=str(e), call_id=call_id)
            return None

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

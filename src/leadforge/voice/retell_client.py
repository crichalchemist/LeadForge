import structlog
import httpx
from leadforge.config import settings

logger = structlog.get_logger()

RETELL_BASE_URL = "https://api.retellai.com"


class RetellClient:
    """Client for Retell AI voice agent API."""

    def __init__(self):
        self.api_key = getattr(settings, 'RETELL_API_KEY', '')
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=RETELL_BASE_URL,
                timeout=30.0,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
        return self._client

    async def create_agent(self, agent_name: str, system_prompt: str, voice_id: str = "11labs-Rachel") -> dict | None:
        """Create a Retell voice agent."""
        if not self.api_key:
            logger.warning("retell_api_key_not_set")
            return None
        try:
            client = await self._get_client()
            response = await client.post("/create-agent", json={
                "agent_name": agent_name,
                "voice_id": voice_id,
                "response_engine": {"type": "retell-llm", "llm_id": ""},
                "general_prompt": system_prompt,
            })
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error("retell_create_agent_failed", error=str(e))
            return None

    async def initiate_call(self, agent_id: str, to_number: str, from_number: str | None = None) -> dict | None:
        """Initiate an outbound call."""
        if not self.api_key:
            return None
        try:
            client = await self._get_client()
            payload = {
                "agent_id": agent_id,
                "customer_number": to_number,
            }
            if from_number:
                payload["from_number"] = from_number

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

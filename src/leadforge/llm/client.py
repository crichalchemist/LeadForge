import httpx
import structlog

from leadforge.config import settings

logger = structlog.get_logger()

VLLM_BASE_URL = settings.VLLM_BASE_URL


class VLLMClient:
    """OpenAI-compatible async client for local vLLM server."""

    def __init__(self, base_url: str | None = None):
        self.base_url = base_url or VLLM_BASE_URL
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=120.0,
            )
        return self._client

    async def complete(
        self, prompt: str, max_tokens: int = 500, temperature: float = 0.1
    ) -> str | None:
        """Generate a completion from the vLLM server."""
        try:
            client = await self._get_client()
            response = await client.post(
                "/chat/completions",
                json={
                    "model": settings.VLLM_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            data = response.json()
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
            return None
        except Exception as e:
            logger.warning("vllm_completion_failed", error=str(e))
            return None

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

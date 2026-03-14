import structlog
from anthropic import AsyncAnthropic

from leadforge.config import settings

logger = structlog.get_logger()

CLAUDE_MODEL = getattr(settings, "CLAUDE_MODEL", "claude-sonnet-4-5-20250514")


class ClaudeClient:
    """Async wrapper for Anthropic Claude API."""

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or getattr(settings, "ANTHROPIC_API_KEY", "")
        self._client: AsyncAnthropic | None = None

    def _get_client(self) -> AsyncAnthropic:
        if self._client is None:
            self._client = AsyncAnthropic(api_key=self.api_key)
        return self._client

    async def complete(
        self, prompt: str, max_tokens: int = 1000, temperature: float = 0.3
    ) -> str | None:
        """Generate completion via Claude API."""
        try:
            client = self._get_client()
            message = await client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
            )
            if message.content:
                return message.content[0].text
            return None
        except Exception as e:
            logger.warning("claude_completion_failed", error=str(e))
            return None

    async def close(self):
        if self._client:
            await self._client.close()
            self._client = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

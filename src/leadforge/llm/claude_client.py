import structlog
from anthropic import AsyncAnthropic

from leadforge.config import settings

logger = structlog.get_logger()


class ClaudeClient:
    """Async wrapper for Anthropic Claude API via Azure Foundry."""

    def __init__(self):
        self._client: AsyncAnthropic | None = None

    def _get_client(self) -> AsyncAnthropic:
        if self._client is None:
            resource = settings.ANTHROPIC_FOUNDRY_RESOURCE
            if resource:
                self._client = AsyncAnthropic(
                    base_url=f"https://{resource}.cognitiveservices.azure.com/anthropic/",
                    api_key=settings.ANTHROPIC_FOUNDRY_API_KEY,
                )
            else:
                # Fallback to standard Anthropic API if no Foundry resource
                self._client = AsyncAnthropic()
        return self._client

    async def complete(
        self, prompt: str, max_tokens: int = 1000, temperature: float = 0.3
    ) -> str | None:
        """Generate completion via Claude API."""
        try:
            client = self._get_client()
            message = await client.messages.create(
                model=settings.ANTHROPIC_DEFAULT_SONNET_MODEL,
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

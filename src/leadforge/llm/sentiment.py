import json
import re

import structlog

from leadforge.llm.claude_client import ClaudeClient

logger = structlog.get_logger()

_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL)


def _strip_fences(text: str) -> str:
    m = _FENCE_RE.search(text)
    return m.group(1).strip() if m else text.strip()

SENTIMENT_PROMPT = """Analyze this call transcript between a marketing agent and a small business owner.

Transcript:
{transcript}

Analyze and respond with ONLY a JSON object:
{{
    "sentiment_score": -1.0 to 1.0 (hostile=-1, dismissive=-0.5, neutral=0, curious=0.3, interested=0.6, enthusiastic=1.0),
    "sentiment_label": "hostile|dismissive|neutral|curious|interested|enthusiastic",
    "objections": ["list of objections raised"],
    "interest_signals": ["list of positive signals"],
    "purchase_intent": "none|low|medium|high",
    "recommended_action": "immediate|scheduled|deprioritize|disqualify",
    "summary": "1-2 sentence summary of the call outcome"
}}
"""


async def analyze_sentiment(
    transcript: str, client: ClaudeClient | None = None
) -> dict:
    """Analyze call transcript sentiment using Claude.

    Returns sentiment score (-1 to 1), label, objections, interest signals,
    purchase intent, recommended action, and summary.
    """
    if not transcript or not transcript.strip():
        return _empty_sentiment()

    prompt = SENTIMENT_PROMPT.format(transcript=transcript[:8000])

    own_client = client is None
    if own_client:
        client = ClaudeClient()

    try:
        response = await client.complete(prompt, max_tokens=500, temperature=0.1)
        if not response:
            return _empty_sentiment()

        result = json.loads(_strip_fences(response))
        # Clamp sentiment score
        score = result.get("sentiment_score", 0.0)
        result["sentiment_score"] = max(-1.0, min(1.0, score))
        return result
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("sentiment_analysis_failed", error=str(e))
        return _empty_sentiment()
    finally:
        if own_client:
            await client.close()


def _empty_sentiment() -> dict:
    """Return default sentiment when analysis is unavailable."""
    return {
        "sentiment_score": 0.0,
        "sentiment_label": "neutral",
        "objections": [],
        "interest_signals": [],
        "purchase_intent": "none",
        "recommended_action": "deprioritize",
        "summary": "Sentiment analysis unavailable",
    }

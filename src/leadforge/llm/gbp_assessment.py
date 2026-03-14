import json
import re

import structlog

from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.llm.claude_client import ClaudeClient

logger = structlog.get_logger()

_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL)


def _strip_fences(text: str) -> str:
    m = _FENCE_RE.search(text)
    return m.group(1).strip() if m else text.strip()

GBP_ASSESSMENT_PROMPT = """Assess the Google Business Profile completeness for this business.

Business data:
- Has GBP: {has_gbp}
- Review count: {review_count}
- Average rating: {rating}
- Has website linked: {has_website}
- Has phone: {has_phone}

Rate the GBP completeness from 0.0 to 1.0 and list missing elements.
Respond with ONLY a JSON object:
{{"completeness_score": 0.0-1.0, "missing_elements": ["list of missing items"], "recommendations": ["list of improvement suggestions"]}}
"""


async def assess_gbp(
    dp: DigitalPresence, has_phone: bool = False, client: ClaudeClient | None = None
) -> dict:
    """Assess Google Business Profile completeness using Claude."""
    prompt = GBP_ASSESSMENT_PROMPT.format(
        has_gbp=dp.has_google_business_profile,
        review_count=dp.google_review_count or 0,
        rating=dp.google_avg_rating or "N/A",
        has_website=dp.has_website,
        has_phone=has_phone,
    )

    own_client = client is None
    if own_client:
        client = ClaudeClient()

    try:
        response = await client.complete(prompt, max_tokens=500)
        if not response:
            return {
                "completeness_score": 0.0,
                "missing_elements": ["Assessment unavailable"],
                "recommendations": [],
            }

        return json.loads(_strip_fences(response))
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("gbp_assessment_failed", error=str(e))
        return {
            "completeness_score": 0.0,
            "missing_elements": ["Assessment failed"],
            "recommendations": [],
        }
    finally:
        if own_client:
            await client.close()

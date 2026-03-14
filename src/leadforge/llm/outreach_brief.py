import json

import structlog

from leadforge.db.models.business import Business
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.llm.claude_client import ClaudeClient

logger = structlog.get_logger()

OUTREACH_BRIEF_PROMPT = """Generate an outreach brief for calling this small business owner about digital marketing services.

Business: {name}
Type: {niche}
Location: {address}, Chicago, IL {zip_code}
Google rating: {rating} ({review_count} reviews)
Has website: {has_website}
Has social media: Facebook={has_fb}, Instagram={has_ig}
Digital deficit score: {deficit_score}/100 (higher = more digital gaps)
Competitive pressure: {pressure_score}/100
Price tier: {price_tier}

Generate a structured outreach brief. Respond with ONLY a JSON object:
{{
    "talking_points": ["3-5 specific, personalized talking points"],
    "observations": ["2-3 specific observations about their digital presence gaps"],
    "pitch_angle": "The primary angle for the pitch (1-2 sentences)",
    "opening_line": "A natural, specific opening line referencing their business",
    "voicemail_script": "15-second voicemail script",
    "objection_responses": {{"price": "response", "not_interested": "response", "already_have_agency": "response"}}
}}
"""


async def generate_outreach_brief(
    business: Business,
    dp: DigitalPresence | None,
    deficit_score: float = 0.0,
    pressure_score: float = 0.0,
    price_tier: int = 1,
    client: ClaudeClient | None = None,
) -> dict:
    """Generate an outreach brief for a business using Claude."""
    prompt = OUTREACH_BRIEF_PROMPT.format(
        name=business.name,
        niche=business.niche.value if business.niche else "unknown",
        address=business.address or "unknown",
        zip_code=business.zip_code,
        rating=dp.google_avg_rating if dp else "N/A",
        review_count=dp.google_review_count if dp else 0,
        has_website=dp.has_website if dp else False,
        has_fb=dp.has_facebook_page if dp else False,
        has_ig=dp.has_instagram if dp else False,
        deficit_score=deficit_score,
        pressure_score=pressure_score,
        price_tier=price_tier,
    )

    own_client = client is None
    if own_client:
        client = ClaudeClient()

    try:
        response = await client.complete(prompt, max_tokens=1000, temperature=0.5)
        if not response:
            return _fallback_brief(business)

        return json.loads(response.strip())
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("outreach_brief_failed", error=str(e), business=business.name)
        return _fallback_brief(business)
    finally:
        if own_client:
            await client.close()


def _fallback_brief(business: Business) -> dict:
    """Generate a minimal fallback brief when Claude is unavailable."""
    return {
        "talking_points": [
            f"We noticed {business.name} could benefit from increased online visibility"
        ],
        "observations": ["Limited digital presence compared to competitors"],
        "pitch_angle": "Help increase local visibility and customer discovery",
        "opening_line": f"Hi, I'm calling about {business.name}",
        "voicemail_script": f"Hi, this is a quick call about {business.name}. We help local businesses like yours get found online. Give us a call back.",
        "objection_responses": {
            "price": "We have flexible plans starting at $150/month",
            "not_interested": "I understand. Would it be okay to check back in a month?",
            "already_have_agency": "Great to hear you're investing in marketing. We specialize in hyper-local businesses.",
        },
    }

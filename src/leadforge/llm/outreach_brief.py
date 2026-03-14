import json
import re

import structlog

from leadforge.db.models.business import Business
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.llm.claude_client import ClaudeClient

logger = structlog.get_logger()

_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL)


def _strip_fences(text: str) -> str:
    m = _FENCE_RE.search(text)
    return m.group(1).strip() if m else text.strip()

OUTREACH_BRIEF_PROMPT = """Generate an outreach brief for calling this small \
business owner about digital marketing services.

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
    "objection_responses": {{
        "price": "response",
        "not_interested": "response",
        "already_have_agency": "response"
    }}
}}
"""

NOF_OUTREACH_BRIEF_PROMPT = """Generate an outreach brief for calling this \
small business owner about the City of Chicago's Neighborhood Opportunity Fund \
grant program.

Business: {name}
Type: {niche}
Location: {address}, Chicago, IL {zip_code}
Google rating: {rating} ({review_count} reviews)
Has website: {has_website}
Has social media: Facebook={has_fb}, Instagram={has_ig}
Digital deficit score: {deficit_score}/100 (higher = more digital gaps)
Competitive pressure: {pressure_score}/100
Price tier: {price_tier}

This business may qualify for up to $250,000 in grant funding through the NOF \
program. Frame this as a grant facilitation opportunity, not a marketing pitch.

Generate a structured outreach brief. Respond with ONLY a JSON object:
{{
    "talking_points": [
        "3-5 specific talking points about grant eligibility and benefits"
    ],
    "observations": ["2-3 observations about why they're a good fit for the grant"],
    "pitch_angle": "The primary angle for the grant opportunity pitch (1-2 sentences)",
    "opening_line": "A natural opening line about the grant opportunity",
    "voicemail_script": "15-second voicemail script about the grant program",
    "objection_responses": {{
        "too_complicated": "response",
        "dont_need_grants": "response",
        "already_applied": "response",
        "not_interested": "response"
    }}
}}
"""


async def generate_outreach_brief(
    business: Business,
    dp: DigitalPresence | None,
    deficit_score: float = 0.0,
    pressure_score: float = 0.0,
    price_tier: int = 1,
    client: ClaudeClient | None = None,
    nof_eligible: bool = False,
) -> dict:
    """Generate an outreach brief for a business using Claude.

    Args:
        business: Business model instance
        dp: Digital presence data (optional)
        deficit_score: Digital deficit score (0-100)
        pressure_score: Competitive pressure score (0-100)
        price_tier: Price tier (1-3)
        client: Optional pre-initialized ClaudeClient
        nof_eligible: If True, generates a grant-focused brief instead of
            marketing brief

    Returns:
        Dictionary containing talking_points, observations, pitch_angle, opening_line,
        voicemail_script, and objection_responses
    """
    template = NOF_OUTREACH_BRIEF_PROMPT if nof_eligible else OUTREACH_BRIEF_PROMPT

    prompt = template.format(
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
            return _fallback_brief(business, nof_eligible=nof_eligible)

        return json.loads(_strip_fences(response))
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("outreach_brief_failed", error=str(e), business=business.name)
        return _fallback_brief(business, nof_eligible=nof_eligible)
    finally:
        if own_client:
            await client.close()


def _fallback_brief(business: Business, nof_eligible: bool = False) -> dict:
    """Generate a minimal fallback brief when Claude is unavailable.

    Args:
        business: Business model instance
        nof_eligible: If True, generates grant-focused fallback; otherwise
            marketing fallback

    Returns:
        Dictionary with fallback talking points and scripts
    """
    if nof_eligible:
        return {
            "talking_points": [
                f"{business.name} may qualify for City of Chicago "
                "Neighborhood Opportunity Fund grants",
                "Grants can cover up to $250,000 for facade improvements, "
                "equipment, and expansion",
                "We help navigate the application process and digital requirements",
            ],
            "observations": [
                "Located on an eligible NOF corridor",
                "Strong candidate for grant funding based on location and "
                "business type",
            ],
            "pitch_angle": (
                "Help secure City grant funding to grow and improve your business"
            ),
            "opening_line": (
                f"Hi, I'm calling about a grant opportunity for {business.name}"
            ),
            "voicemail_script": (
                f"Hi, this is a call about {business.name}. The City has grant "
                "funding available for businesses on your corridor—up to $250,000. "
                "Give us a call to discuss eligibility."
            ),
            "objection_responses": {
                "too_complicated": (
                    "We handle the paperwork and guide you through every step. "
                    "It's simpler than you'd think."
                ),
                "dont_need_grants": (
                    "I understand. This is free money from the City to invest "
                    "in your business. No obligation to explore."
                ),
                "already_applied": (
                    "Great! We can help with future rounds or other funding "
                    "opportunities."
                ),
                "not_interested": (
                    "No problem. Can I follow up in a month with more details?"
                ),
            },
        }
    else:
        return {
            "talking_points": [
                f"We noticed {business.name} could benefit from increased "
                "online visibility"
            ],
            "observations": ["Limited digital presence compared to competitors"],
            "pitch_angle": "Help increase local visibility and customer discovery",
            "opening_line": f"Hi, I'm calling about {business.name}",
            "voicemail_script": (
                f"Hi, this is a quick call about {business.name}. We help local "
                "businesses like yours get found online. Give us a call back."
            ),
            "objection_responses": {
                "price": "We have flexible plans starting at $150/month",
                "not_interested": (
                    "I understand. Would it be okay to check back in a month?"
                ),
                "already_have_agency": (
                    "Great to hear you're investing in marketing. We specialize "
                    "in hyper-local businesses."
                ),
            },
        }

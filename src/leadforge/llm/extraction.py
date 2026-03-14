import json

import structlog

from leadforge.llm.client import VLLMClient

logger = structlog.get_logger()

EXTRACTION_PROMPT = """Extract business information from this website content.
Return ONLY a JSON object with these fields (use null if not found):

{{"email": "string or null", "owner_name": "string or null", "services": ["list of services"], "phone": "string or null"}}

Website content:
{content}
"""

REVENUE_PROMPT = """Estimate the monthly revenue for this business based on the available data.

Business type: {niche}
Location: Chicago, IL {zip_code}
Employees (estimated): {employees}
Google reviews: {review_count}
Google rating: {rating}
Years in operation: {years}

Respond with ONLY a JSON object:
{{"estimated_monthly_revenue": number, "confidence": "low/medium/high", "reasoning": "brief explanation"}}
"""

# Niche median monthly revenues (rough estimates for Chicago)
NICHE_MEDIAN_REVENUE: dict[str, float] = {
    "barbershops": 12000,
    "nail_salons": 15000,
    "beauty_shops": 18000,
    "tire_shops": 25000,
    "bars": 30000,
    "veterinarians": 45000,
    "towing": 20000,
    "lawn_services": 10000,
    "mobile_mechanics": 8000,
    "meat_markets": 20000,
    "smoke_shops": 15000,
    "beauty_supply": 18000,
    "septic_services": 22000,
    "used_auto_parts": 20000,
    "security_services": 35000,
}


async def extract_website_data(
    html_content: str, client: VLLMClient | None = None
) -> dict:
    """Extract structured business data from website HTML using LLM."""
    # Truncate HTML to avoid token limits
    truncated = html_content[:4000] if len(html_content) > 4000 else html_content

    prompt = EXTRACTION_PROMPT.format(content=truncated)

    own_client = client is None
    if own_client:
        client = VLLMClient()

    try:
        response = await client.complete(prompt, max_tokens=300)
        if not response:
            return {}

        return json.loads(response.strip())
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("website_extraction_failed", error=str(e))
        return {}
    finally:
        if own_client:
            await client.close()


async def estimate_revenue(
    niche: str,
    zip_code: str,
    employees: int | None = None,
    review_count: int | None = None,
    rating: float | None = None,
    years_in_operation: int | None = None,
    client: VLLMClient | None = None,
) -> float | None:
    """Estimate monthly revenue using LLM with niche baselines."""
    prompt = REVENUE_PROMPT.format(
        niche=niche,
        zip_code=zip_code,
        employees=employees or "unknown",
        review_count=review_count or "unknown",
        rating=rating or "unknown",
        years=years_in_operation or "unknown",
    )

    own_client = client is None
    if own_client:
        client = VLLMClient()

    try:
        response = await client.complete(prompt, max_tokens=200)
        if not response:
            # Fallback: use niche median
            return NICHE_MEDIAN_REVENUE.get(niche)

        result = json.loads(response.strip())
        return result.get("estimated_monthly_revenue")
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("revenue_estimation_failed", error=str(e))
        return NICHE_MEDIAN_REVENUE.get(niche)
    finally:
        if own_client:
            await client.close()

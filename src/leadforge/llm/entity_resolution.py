import json

import structlog

from leadforge.llm.client import VLLMClient

logger = structlog.get_logger()

ENTITY_RESOLUTION_PROMPT = """Compare these two business records and determine if they are the same business.

Business A:
- Name: {name_a}
- Address: {address_a}
- Zip: {zip_a}
- Phone: {phone_a}

Business B:
- Name: {name_b}
- Address: {address_b}
- Zip: {zip_b}
- Phone: {phone_b}

Respond with ONLY a JSON object:
{{"is_match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}}
"""

MERGE_THRESHOLD = 0.8


async def resolve_entities(
    record_a: dict, record_b: dict, client: VLLMClient | None = None
) -> dict:
    """Compare two business records using LLM and return match result.

    Returns: {"is_match": bool, "confidence": float, "reason": str}
    """
    prompt = ENTITY_RESOLUTION_PROMPT.format(
        name_a=record_a.get("name", ""),
        address_a=record_a.get("address", ""),
        zip_a=record_a.get("zip_code", ""),
        phone_a=record_a.get("phone", ""),
        name_b=record_b.get("name", ""),
        address_b=record_b.get("address", ""),
        zip_b=record_b.get("zip_code", ""),
        phone_b=record_b.get("phone", ""),
    )

    own_client = client is None
    if own_client:
        client = VLLMClient()

    try:
        response = await client.complete(prompt, max_tokens=200)
        if not response:
            return {"is_match": False, "confidence": 0.0, "reason": "LLM unavailable"}

        # Parse JSON response
        result = json.loads(response.strip())
        return {
            "is_match": result.get("is_match", False)
            and result.get("confidence", 0) >= MERGE_THRESHOLD,
            "confidence": result.get("confidence", 0.0),
            "reason": result.get("reason", ""),
        }
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning("entity_resolution_parse_failed", error=str(e))
        return {"is_match": False, "confidence": 0.0, "reason": f"Parse error: {e}"}
    finally:
        if own_client:
            await client.close()


def merge_records(primary: dict, secondary: dict) -> dict:
    """Merge two business records, preferring non-null values from primary."""
    merged = dict(primary)
    for key, value in secondary.items():
        if key not in merged or merged[key] is None:
            merged[key] = value
    return merged

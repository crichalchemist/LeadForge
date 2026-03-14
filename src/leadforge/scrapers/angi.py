import structlog

from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()


class AngiClient(BaseAPIClient):
    """Angi (Angie's List) business scraper."""

    def __init__(self):
        super().__init__(base_url="https://www.angi.com", timeout=30.0)

    async def search_business(self, name: str, zip_code: str) -> dict | None:
        """Search for a business on Angi. Returns business data or None."""
        try:
            client = await self._get_client()
            response = await client.get(
                "/search",
                params={"query": name, "zipCode": zip_code},
                headers={"Accept": "text/html"},
            )
            response.raise_for_status()
            text = response.text

            import json
            import re

            script_match = re.search(
                r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                text,
                re.DOTALL,
            )
            if script_match:
                try:
                    ld_json = json.loads(script_match.group(1))
                    return {
                        "angi_name": ld_json.get("name"),
                        "angi_rating": ld_json.get("aggregateRating", {}).get(
                            "ratingValue"
                        ),
                        "angi_review_count": ld_json.get("aggregateRating", {}).get(
                            "reviewCount"
                        ),
                    }
                except json.JSONDecodeError:
                    pass

            return None
        except Exception as e:
            logger.warning("angi_search_failed", error=str(e), name=name)
            return None

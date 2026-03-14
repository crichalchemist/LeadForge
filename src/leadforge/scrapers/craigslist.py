import structlog

from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()


class CraigslistClient(BaseAPIClient):
    """Craigslist Chicago services scraper."""

    def __init__(self):
        super().__init__(base_url="https://chicago.craigslist.org", timeout=30.0)

    async def search_services(self, name: str, category: str = "bbb") -> dict | None:
        """Search Craigslist services for a business. Returns listing data or None."""
        try:
            client = await self._get_client()
            response = await client.get(
                f"/search/{category}",
                params={"query": name},
            )
            response.raise_for_status()
            text = response.text

            # Count listings mentioning the business
            import re

            listings = re.findall(r'class="result-title[^"]*"[^>]*>([^<]+)', text)
            matching = [item for item in listings if name.lower() in item.lower()]

            return {
                "craigslist_listing_count": len(matching),
                "craigslist_has_presence": len(matching) > 0,
            }
        except Exception as e:
            logger.warning("craigslist_search_failed", error=str(e), name=name)
            return None

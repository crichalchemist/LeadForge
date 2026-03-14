import structlog

from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()


class NextdoorClient(BaseAPIClient):
    """Nextdoor business scraper with cookie-based authentication."""

    def __init__(self, cookies: dict | None = None):
        super().__init__(base_url="https://nextdoor.com", timeout=30.0)
        self.cookies = cookies or {}

    async def search_business(self, name: str, zip_code: str) -> dict | None:
        """Search for a business on Nextdoor. Returns recommendation data or None."""
        if not self.cookies:
            logger.warning(
                "nextdoor_no_cookies", msg="No cookies available, skipping Nextdoor"
            )
            return None

        try:
            client = await self._get_client()
            response = await client.get(
                "/api/search/",
                params={"query": name, "type": "business"},
                cookies=self.cookies,
            )
            response.raise_for_status()
            data = response.json()

            results = data.get("results", [])
            if not results:
                return None

            biz = results[0]
            return {
                "nextdoor_id": biz.get("id"),
                "nextdoor_recommendations": biz.get("recommendation_count", 0),
                "nextdoor_neighborhood": biz.get("neighborhood"),
                "nextdoor_rating": biz.get("rating"),
            }
        except Exception as e:
            logger.warning("nextdoor_search_failed", error=str(e), name=name)
            return None

import structlog
from leadforge.scrapers.base import BaseAPIClient
from leadforge.config import settings

logger = structlog.get_logger()

class YelpClient(BaseAPIClient):
    """Yelp Fusion API client."""

    def __init__(self):
        super().__init__(base_url="https://api.yelp.com/v3")

    async def search_business(self, name: str, location: str) -> dict | None:
        """Search for a business by name and location."""
        api_key = getattr(settings, 'YELP_API_KEY', '')
        if not api_key:
            logger.warning("yelp_api_key_not_set")
            return None

        try:
            client = await self._get_client()
            response = await client.get(
                "/businesses/search",
                params={"term": name, "location": location, "limit": 1},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            data = response.json()

            businesses = data.get("businesses", [])
            if not businesses:
                return None

            biz = businesses[0]
            return {
                "yelp_id": biz.get("id"),
                "yelp_review_count": biz.get("review_count", 0),
                "yelp_rating": biz.get("rating"),
                "yelp_price": biz.get("price"),
                "yelp_categories": [c.get("title") for c in biz.get("categories", [])],
            }
        except Exception as e:
            logger.warning("yelp_search_failed", error=str(e), name=name)
            return None

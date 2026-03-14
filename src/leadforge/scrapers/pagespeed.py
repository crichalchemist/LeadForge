import structlog

from leadforge.config import settings
from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()


class PageSpeedClient(BaseAPIClient):
    """Google PageSpeed Insights API client."""

    def __init__(self):
        super().__init__(base_url="https://www.googleapis.com", timeout=60.0)

    async def analyze(self, url: str) -> dict | None:
        """Analyze a URL for website quality. Returns quality metrics or None."""
        try:
            client = await self._get_client()
            params = {"url": url, "category": "performance", "strategy": "mobile"}
            api_key = getattr(settings, "GOOGLE_PLACES_API_KEY", "")
            if api_key:
                params["key"] = api_key

            response = await client.get(
                "/pagespeedonline/v5/runPagespeed", params=params
            )
            response.raise_for_status()
            data = response.json()

            lighthouse = data.get("lighthouseResult", {})
            categories = lighthouse.get("categories", {})
            performance = categories.get("performance", {})

            return {
                "website_quality_score": (performance.get("score", 0) or 0) * 100,
                "performance_score": (performance.get("score", 0) or 0) * 100,
                "first_contentful_paint": lighthouse.get("audits", {})
                .get("first-contentful-paint", {})
                .get("numericValue"),
            }
        except Exception as e:
            logger.warning("pagespeed_analysis_failed", error=str(e), url=url)
            return None

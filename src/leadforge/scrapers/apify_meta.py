import asyncio

import structlog

from leadforge.config import settings
from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()


class ApifyMetaClient(BaseAPIClient):
    """Apify REST API client for Meta platform scraping (Instagram, Facebook, Threads)."""

    ACTORS = {
        "instagram_profile": "apify/instagram-scraper",
        "instagram_location": "apify/instagram-scraper",
        "instagram_hashtag": "apify/instagram-scraper",
        "facebook_search": "apify/facebook-posts-scraper",
        "meta_ads": "apify/facebook-ads-library-scraper",
    }

    def __init__(self):
        super().__init__(base_url="https://api.apify.com/v2", timeout=120.0)
        self.api_token = getattr(settings, "APIFY_API_TOKEN", "")

    async def run_actor(self, actor_id: str, input_data: dict) -> list[dict] | None:
        """Run an Apify actor and wait for results."""
        if not self.api_token:
            logger.warning("apify_token_not_set")
            return None

        try:
            client = await self._get_client()

            # Start actor run
            response = await client.post(
                f"/acts/{actor_id}/runs",
                json=input_data,
                params={"token": self.api_token},
            )
            response.raise_for_status()
            run_data = response.json().get("data", {})
            run_id = run_data.get("id")

            if not run_id:
                return None

            # Poll for completion
            for _ in range(60):  # Max 5 minutes
                await asyncio.sleep(5)
                status_resp = await client.get(
                    f"/acts/{actor_id}/runs/{run_id}",
                    params={"token": self.api_token},
                )
                status_resp.raise_for_status()
                status = status_resp.json().get("data", {}).get("status")

                if status == "SUCCEEDED":
                    break
                elif status in ("FAILED", "ABORTED", "TIMED-OUT"):
                    logger.warning("apify_run_failed", actor=actor_id, status=status)
                    return None

            # Get results
            dataset_id = run_data.get("defaultDatasetId")
            if not dataset_id:
                return None

            items_resp = await client.get(
                f"/datasets/{dataset_id}/items",
                params={"token": self.api_token, "format": "json"},
            )
            items_resp.raise_for_status()
            return items_resp.json()

        except Exception as e:
            logger.warning("apify_actor_failed", error=str(e), actor=actor_id)
            return None

    async def get_instagram_profile(self, username: str) -> dict | None:
        """Get Instagram profile data for a business."""
        results = await self.run_actor(
            self.ACTORS["instagram_profile"],
            {
                "directUrls": [f"https://www.instagram.com/{username}/"],
                "resultsLimit": 1,
            },
        )
        if not results:
            return None

        profile = results[0]
        return {
            "has_instagram": True,
            "ig_follower_count": profile.get("followersCount", 0),
            "ig_post_frequency": None,  # Computed from post dates
            "ig_bio": profile.get("biography"),
        }

    async def get_instagram_location_tags(
        self, place_name: str, location_id: str | None = None
    ) -> dict | None:
        """Get Instagram posts tagged at a location."""
        if not location_id:
            return None

        results = await self.run_actor(
            self.ACTORS["instagram_location"],
            {
                "directUrls": [
                    f"https://www.instagram.com/explore/locations/{location_id}/"
                ],
                "resultsLimit": 50,
            },
        )

        return {
            "ig_location_tag_count": len(results) if results else 0,
        }

    async def get_instagram_hashtag_mentions(self, business_name: str) -> dict | None:
        """Get Instagram posts using business name as hashtag."""
        hashtag = business_name.lower().replace(" ", "").replace("'", "")
        results = await self.run_actor(
            self.ACTORS["instagram_hashtag"],
            {
                "directUrls": [f"https://www.instagram.com/explore/tags/{hashtag}/"],
                "resultsLimit": 50,
            },
        )

        return {
            "ig_hashtag_mention_count": len(results) if results else 0,
        }

    async def get_facebook_page_data(self, page_url: str) -> dict | None:
        """Get Facebook page data."""
        results = await self.run_actor(
            self.ACTORS["facebook_search"],
            {"startUrls": [{"url": page_url}], "resultsLimit": 20},
        )
        if not results:
            return {"has_facebook_page": False}

        return {
            "has_facebook_page": True,
            "fb_post_count": len(results),
            "fb_checkin_count": None,  # Needs separate actor
            "fb_ugc_tag_count": None,
        }

    async def get_meta_ads(self, business_name: str) -> dict | None:
        """Check Meta Ad Library for active ads."""
        results = await self.run_actor(
            self.ACTORS["meta_ads"],
            {"searchTerms": [business_name], "countryCode": "US"},
        )

        has_ads = bool(results and len(results) > 0)
        return {
            "has_meta_ads": has_ads,
            "meta_ads_count": len(results) if results else 0,
        }

import structlog

from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()


class ILSOSClient(BaseAPIClient):
    """Illinois Secretary of State business entity lookup."""

    def __init__(self):
        super().__init__(base_url="https://apps.ilsos.gov")

    async def lookup_business(self, business_name: str) -> dict | None:
        """Look up business registration. Returns incorporation info or None."""
        try:
            client = await self._get_client()
            response = await client.get(
                "/corporatellc/CorporateLlcController",
                params={"command": "searchByName", "searchValue": business_name},
            )
            response.raise_for_status()
            # Parse HTML response for business info
            # Phase 2 MVP: return structured data from response
            text = response.text

            # Simple extraction (Phase 2 will add proper HTML parsing with Scrapling)
            return {
                "entity_name": business_name,
                "entity_status": self._extract_field(text, "Status"),
                "incorporation_date": self._extract_field(
                    text, "Date of Incorporation"
                ),
                "registered_agent": self._extract_field(text, "Agent Name"),
            }
        except Exception as e:
            logger.warning("il_sos_lookup_failed", error=str(e), name=business_name)
            return None

    @staticmethod
    def _extract_field(html: str, field_name: str) -> str | None:
        """Simple field extraction from HTML. Returns None if not found."""
        import re

        pattern = rf"{field_name}\s*:?\s*</?\w+[^>]*>\s*([^<]+)"
        match = re.search(pattern, html, re.IGNORECASE)
        return match.group(1).strip() if match else None

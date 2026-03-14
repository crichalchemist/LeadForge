import structlog
from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()

class DFPRClient(BaseAPIClient):
    """Illinois DFPR professional license lookup."""

    def __init__(self):
        super().__init__(base_url="https://online-dfpr.micropact.com")

    async def lookup_license(self, license_number: str | None = None, last_name: str | None = None, license_type: str = "barber") -> dict | None:
        """Look up professional license status. Returns license info or None."""
        if not license_number and not last_name:
            return None

        try:
            client = await self._get_client()
            # DFPR has a search API endpoint
            params = {"licenseType": license_type}
            if license_number:
                params["licenseNumber"] = license_number
            if last_name:
                params["lastName"] = last_name

            response = await client.get("/api/lookup", params=params)
            response.raise_for_status()
            data = response.json()

            if not data:
                return None

            # Extract first result
            result = data[0] if isinstance(data, list) else data
            return {
                "license_number": result.get("licenseNumber"),
                "license_status": result.get("status", "unknown").lower(),
                "license_expiration": result.get("expirationDate"),
                "license_type": result.get("licenseType"),
                "name": result.get("name"),
            }
        except Exception as e:
            logger.warning("dfpr_lookup_failed", error=str(e), license_number=license_number)
            return None

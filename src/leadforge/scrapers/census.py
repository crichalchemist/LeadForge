import structlog

from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()

# ACS 5-year estimate variables
CENSUS_VARIABLES = {
    "B19013_001E": "median_household_income",
    "B01003_001E": "total_population",
    "B01001_001E": "total_population_alt",
}


class CensusClient(BaseAPIClient):
    """US Census Bureau ACS API client."""

    def __init__(self):
        super().__init__(base_url="https://api.census.gov")

    async def get_zip_demographics(self, zip_code: str) -> dict | None:
        """Get demographic data for a zip code from ACS 5-year estimates."""
        try:
            client = await self._get_client()
            variables = ",".join(CENSUS_VARIABLES.keys())

            response = await client.get(
                "/data/2022/acs/acs5",
                params={
                    "get": f"NAME,{variables}",
                    "for": f"zip code tabulation area:{zip_code}",
                },
            )
            response.raise_for_status()
            data = response.json()

            if len(data) < 2:
                return None

            headers = data[0]
            values = data[1]
            row = dict(zip(headers, values))

            median_income = self._safe_float(row.get("B19013_001E"))
            total_pop = self._safe_float(row.get("B01003_001E"))

            return {
                "median_household_income": median_income,
                "total_population": total_pop,
                # Population density requires land area, approximate with zip-level data
                "population_density": None,  # Computed separately if land area available
            }
        except Exception as e:
            logger.warning("census_lookup_failed", error=str(e), zip_code=zip_code)
            return None

    @staticmethod
    def _safe_float(val) -> float | None:
        """Convert to float, handling Census null markers (-666666666)."""
        if val is None:
            return None
        try:
            f = float(val)
            return None if f < -999999 else f
        except (ValueError, TypeError):
            return None

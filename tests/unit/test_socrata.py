import pytest
import respx
from httpx import Response

from leadforge.db.models.business import NicheType
from leadforge.scrapers.socrata import NICHE_MAPPING, SocrataClient


class TestSocrataClient:
    @pytest.fixture
    def mock_socrata(self, socrata_barbershop_response):
        with respx.mock:
            respx.get("https://data.cityofchicago.org/resource/r5kz-chrr.json").mock(
                return_value=Response(200, json=socrata_barbershop_response)
            )
            yield

    @pytest.mark.asyncio
    async def test_search_businesses_returns_results(
        self, mock_socrata, socrata_barbershop_response
    ):
        async with SocrataClient() as client:
            results = await client.search_businesses("60619", NicheType.BARBERSHOPS)
        assert len(results) == 2
        assert results[0]["doing_business_as_name"] == "John's Barbershop"

    @pytest.mark.asyncio
    async def test_search_businesses_with_limit(self, mock_socrata):
        async with SocrataClient() as client:
            results = await client.search_businesses(
                "60619", NicheType.BARBERSHOPS, limit=1
            )
        assert len(results) <= 1

    @pytest.mark.asyncio
    async def test_search_businesses_empty_result(self):
        with respx.mock:
            respx.get("https://data.cityofchicago.org/resource/r5kz-chrr.json").mock(
                return_value=Response(200, json=[])
            )
            async with SocrataClient() as client:
                results = await client.search_businesses("99999", NicheType.BARBERSHOPS)
            assert results == []

    def test_normalize_result(self, socrata_barbershop_response):
        client = SocrataClient()
        normalized = client.normalize_result(
            socrata_barbershop_response[0], NicheType.BARBERSHOPS
        )
        assert normalized["name"] == "John's Barbershop"
        assert normalized["zip_code"] == "60619"
        assert normalized["niche"] == NicheType.BARBERSHOPS
        assert (
            normalized["license_status"] == "expired"
        )  # AAI doesn't match "aal" or "active", so defaults to expired

    def test_niche_mapping_covers_all_niches(self):
        for niche in NicheType:
            assert niche in NICHE_MAPPING, f"Missing mapping for {niche.value}"

    def test_license_status_mapping(self):
        client = SocrataClient()
        assert client._map_license_status("AAL") == "active"
        assert client._map_license_status("ACTIVE") == "active"
        assert client._map_license_status("REV") == "revoked"
        assert client._map_license_status("REVOKED") == "revoked"
        assert client._map_license_status(None) == "unknown"
        assert (
            client._map_license_status("AAI") == "expired"
        )  # Doesn't match "aal" or "active", so defaults to expired
        assert client._map_license_status("EXPIRED") == "expired"

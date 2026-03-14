import pytest
import respx
from httpx import Response
from leadforge.scrapers.google_places import GooglePlacesClient


class TestGooglePlacesClient:

    @pytest.mark.asyncio
    async def test_find_place_returns_candidate(self, google_find_place_response):
        with respx.mock:
            respx.get("https://maps.googleapis.com/maps/api/place/findplacefromtext/json").mock(
                return_value=Response(200, json=google_find_place_response)
            )
            async with GooglePlacesClient() as client:
                result = await client.find_place("John's Barbershop", "123 E 75th St Chicago IL")
            assert result is not None
            assert result["place_id"] == "ChIJ_sample_place_id_123"

    @pytest.mark.asyncio
    async def test_find_place_no_results(self):
        with respx.mock:
            respx.get("https://maps.googleapis.com/maps/api/place/findplacefromtext/json").mock(
                return_value=Response(200, json={"candidates": [], "status": "ZERO_RESULTS"})
            )
            async with GooglePlacesClient() as client:
                result = await client.find_place("Nonexistent Business", "nowhere")
            assert result is None

    @pytest.mark.asyncio
    async def test_get_place_details(self, google_place_details_response):
        with respx.mock:
            respx.get("https://maps.googleapis.com/maps/api/place/details/json").mock(
                return_value=Response(200, json=google_place_details_response)
            )
            async with GooglePlacesClient() as client:
                result = await client.get_place_details("ChIJ_sample_place_id_123")
            assert result is not None
            assert result["name"] == "John's Barbershop"
            assert result["rating"] == 4.5

    def test_extract_enrichment(self, google_place_details_response):
        client = GooglePlacesClient()
        enrichment = client.extract_enrichment(google_place_details_response["result"])
        assert enrichment["google_place_id"] == "ChIJ_sample_place_id_123"
        assert enrichment["has_website"] is True
        assert enrichment["has_google_business_profile"] is True
        assert enrichment["google_review_count"] == 47
        assert enrichment["google_avg_rating"] == 4.5
        assert enrichment["latitude"] == 41.7580
        assert enrichment["longitude"] == -87.6055

from unittest.mock import AsyncMock, MagicMock

import pytest
import respx
from httpx import Response
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.db.models.business import NicheType
from leadforge.pipeline.discovery import run_discovery


class TestDiscoveryPipelineIntegration:
    """Integration tests for the discovery pipeline with mocked external APIs."""

    @pytest.mark.asyncio
    async def test_pipeline_end_to_end_mocked(
        self,
        socrata_barbershop_response,
        google_find_place_response,
        google_place_details_response,
    ):
        """Test full pipeline with mocked Socrata and Google APIs."""
        with respx.mock:
            # Mock Socrata
            respx.get("https://data.cityofchicago.org/resource/r5kz-chrr.json").mock(
                return_value=Response(200, json=socrata_barbershop_response)
            )
            # Mock Google Find Place - return different place_ids for each business
            find_place_responses = [
                Response(200, json=google_find_place_response),
                Response(
                    200,
                    json={
                        "candidates": [
                            {
                                "place_id": "ChIJ_sample_place_id_456",
                                "name": "Fresh Cuts Barbershop",
                                "formatted_address": "456 S Cottage Grove Ave, Chicago, IL 60619",
                                "geometry": {
                                    "location": {"lat": 41.7590, "lng": -87.6065}
                                },
                            }
                        ],
                        "status": "OK",
                    },
                ),
            ]
            find_route = respx.get(
                "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
            )
            find_route.side_effect = find_place_responses

            # Mock Google Place Details
            details_responses = [
                Response(200, json=google_place_details_response),
                Response(
                    200,
                    json={
                        "result": {
                            "place_id": "ChIJ_sample_place_id_456",
                            "name": "Fresh Cuts Barbershop",
                            "formatted_address": "456 S Cottage Grove Ave, Chicago, IL 60619",
                            "formatted_phone_number": "(773) 555-5678",
                            "rating": 4.2,
                            "user_ratings_total": 12,
                            "geometry": {"location": {"lat": 41.7590, "lng": -87.6065}},
                            "business_status": "OPERATIONAL",
                        },
                        "status": "OK",
                    },
                ),
            ]
            details_route = respx.get(
                "https://maps.googleapis.com/maps/api/place/details/json"
            )
            details_route.side_effect = details_responses

            # Use in-memory SQLite for test (no PostGIS, so skip geometry)
            # Since we can't use PostGIS in SQLite, we'll mock the session operations
            # Instead, test the pipeline logic with a mock session
            session = AsyncMock(spec=AsyncSession)

            # Mock the select query to return no existing businesses (no dupes)
            mock_result = MagicMock()
            mock_result.scalar_one_or_none.return_value = None
            session.execute = AsyncMock(return_value=mock_result)
            session.add = MagicMock()
            session.commit = AsyncMock()

            businesses = await run_discovery(
                session, "60619", NicheType.BARBERSHOPS, limit=2
            )

            # Verify businesses were created
            assert len(businesses) == 2
            assert businesses[0].name == "John's Barbershop"
            assert businesses[1].name == "Fresh Cuts Barbershop"

            # Verify session.add was called (Business + DigitalPresence + LeadScore per business = 6 total)
            assert session.add.call_count == 6
            assert session.commit.called

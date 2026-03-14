from unittest.mock import AsyncMock

import pytest

from leadforge.llm.entity_resolution import merge_records, resolve_entities


class TestEntityResolution:
    @pytest.mark.asyncio
    async def test_matching_records(self):
        mock_client = AsyncMock()
        mock_client.complete = AsyncMock(
            return_value='{"is_match": true, "confidence": 0.95, "reason": "Same name and address"}'
        )

        record_a = {
            "name": "John's Barbershop",
            "address": "123 Main St",
            "zip_code": "60619",
            "phone": "773-555-1234",
        }
        record_b = {
            "name": "Johns Barber Shop",
            "address": "123 Main Street",
            "zip_code": "60619",
            "phone": "773-555-1234",
        }

        result = await resolve_entities(record_a, record_b, client=mock_client)
        assert result["is_match"] is True
        assert result["confidence"] >= 0.8

    @pytest.mark.asyncio
    async def test_non_matching_records(self):
        mock_client = AsyncMock()
        mock_client.complete = AsyncMock(
            return_value='{"is_match": false, "confidence": 0.2, "reason": "Different businesses"}'
        )

        record_a = {
            "name": "John's Barbershop",
            "address": "123 Main St",
            "zip_code": "60619",
            "phone": "773-555-1234",
        }
        record_b = {
            "name": "Fresh Cuts Salon",
            "address": "456 Oak Ave",
            "zip_code": "60619",
            "phone": "773-555-9999",
        }

        result = await resolve_entities(record_a, record_b, client=mock_client)
        assert result["is_match"] is False

    @pytest.mark.asyncio
    async def test_llm_unavailable_returns_no_match(self):
        mock_client = AsyncMock()
        mock_client.complete = AsyncMock(return_value=None)

        result = await resolve_entities({}, {}, client=mock_client)
        assert result["is_match"] is False
        assert result["confidence"] == 0.0

    def test_merge_records_prefers_primary(self):
        primary = {"name": "John's Barbershop", "phone": "773-555-1234", "email": None}
        secondary = {
            "name": "Johns Barber Shop",
            "phone": "773-555-9999",
            "email": "john@barber.com",
        }

        merged = merge_records(primary, secondary)
        assert merged["name"] == "John's Barbershop"  # Primary wins
        assert merged["phone"] == "773-555-1234"  # Primary wins
        assert merged["email"] == "john@barber.com"  # Filled from secondary

    def test_merge_records_fills_none_values(self):
        primary = {"name": "Test", "website": None, "rating": None}
        secondary = {"website": "http://test.com", "rating": 4.5, "extra": "data"}

        merged = merge_records(primary, secondary)
        assert merged["website"] == "http://test.com"
        assert merged["rating"] == 4.5
        assert merged["extra"] == "data"

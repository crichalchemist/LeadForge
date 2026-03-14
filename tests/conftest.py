import os
from unittest.mock import MagicMock

import pytest

# Set test environment variables BEFORE any leadforge imports
os.environ["GOOGLE_PLACES_API_KEY"] = "test_key_123"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"

from leadforge.db.models.digital_presence import DigitalPresence


@pytest.fixture
def sample_digital_presence():
    """Create a DigitalPresence-like object for testing scoring."""
    dp = MagicMock(spec=DigitalPresence)
    dp.has_website = False
    dp.website_quality_score = None
    dp.has_ssl = None
    dp.has_google_business_profile = False
    dp.gbp_completeness_score = None
    dp.google_review_count = 0
    dp.google_avg_rating = None
    dp.review_velocity_30d = None
    dp.has_facebook_page = False
    dp.has_instagram = False
    dp.fb_last_post_days_ago = None
    dp.has_google_ads = False
    dp.has_meta_ads = False
    return dp


@pytest.fixture
def socrata_barbershop_response():
    """Sample Socrata API response for barbershops."""
    return [
        {
            "legal_name": "JOHNS BARBERSHOP INC",
            "doing_business_as_name": "John's Barbershop",
            "address": "123 E 75TH ST",
            "zip_code": "60619",
            "license_number": "2874631",
            "license_status": "AAI",
            "license_start_date": "2019-05-15T00:00:00.000",
            "business_activity": "Barber Shop",
        },
        {
            "legal_name": "FRESH CUTS LLC",
            "doing_business_as_name": "Fresh Cuts Barbershop",
            "address": "456 S COTTAGE GROVE AVE",
            "zip_code": "60619",
            "license_number": "2987654",
            "license_status": "AAI",
            "license_start_date": "2021-01-10T00:00:00.000",
            "business_activity": "Barber Shop",
        },
    ]


@pytest.fixture
def google_find_place_response():
    """Sample Google Places Find Place response."""
    return {
        "candidates": [
            {
                "place_id": "ChIJ_sample_place_id_123",
                "name": "John's Barbershop",
                "formatted_address": "123 E 75th St, Chicago, IL 60619",
                "geometry": {"location": {"lat": 41.7580, "lng": -87.6055}},
            }
        ],
        "status": "OK",
    }


@pytest.fixture
def google_place_details_response():
    """Sample Google Places Details response."""
    return {
        "result": {
            "place_id": "ChIJ_sample_place_id_123",
            "name": "John's Barbershop",
            "formatted_address": "123 E 75th St, Chicago, IL 60619",
            "formatted_phone_number": "(773) 555-1234",
            "website": "http://johnsbarbershop.com",
            "rating": 4.5,
            "user_ratings_total": 47,
            "geometry": {"location": {"lat": 41.7580, "lng": -87.6055}},
            "business_status": "OPERATIONAL",
        },
        "status": "OK",
    }

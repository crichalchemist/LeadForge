import pytest
from unittest.mock import MagicMock
from datetime import date, timedelta
from leadforge.scoring.viability import compute_viability
from leadforge.db.models.business import Business, LicenseStatus
from leadforge.db.models.digital_presence import DigitalPresence


class TestViabilityScoring:

    def _make_business(self, **kwargs) -> MagicMock:
        biz = MagicMock(spec=Business)
        defaults = {
            "incorporation_date": None,
            "license_status": None,
            "total_customer_ugc": 0,
            "nextdoor_recommendations": 0,
            "thumbtack_hires": 0,
            "employee_count_est": None,
        }
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(biz, k, v)
        return biz

    def _make_dp(self, **kwargs) -> MagicMock:
        dp = MagicMock(spec=DigitalPresence)
        defaults = {
            "google_review_count": 0,
            "google_avg_rating": None,
            "review_velocity_30d": None,
        }
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(dp, k, v)
        return dp

    def test_zero_viability_for_new_unknown_business(self):
        biz = self._make_business()
        dp = self._make_dp()
        assert compute_viability(biz, dp) == 0.0

    def test_three_years_operation_adds_20(self):
        biz = self._make_business(incorporation_date=date.today() - timedelta(days=4*365))
        dp = self._make_dp()
        assert compute_viability(biz, dp) >= 20.0

    def test_seven_years_adds_additional_10(self):
        biz = self._make_business(incorporation_date=date.today() - timedelta(days=8*365))
        dp = self._make_dp()
        assert compute_viability(biz, dp) >= 30.0

    def test_moderate_reviews_adds_15(self):
        biz = self._make_business()
        dp = self._make_dp(google_review_count=25)
        score = compute_viability(biz, dp)
        assert score >= 15.0

    def test_high_reviews_adds_20(self):
        biz = self._make_business()
        dp = self._make_dp(google_review_count=60)
        assert compute_viability(biz, dp) >= 20.0

    def test_high_rating_adds_15(self):
        biz = self._make_business()
        dp = self._make_dp(google_avg_rating=4.5)
        assert compute_viability(biz, dp) >= 15.0

    def test_active_license_adds_5(self):
        biz = self._make_business(license_status=LicenseStatus.ACTIVE)
        dp = self._make_dp()
        assert compute_viability(biz, dp) >= 5.0

    def test_ugc_moderate_adds_10(self):
        biz = self._make_business(total_customer_ugc=30)
        dp = self._make_dp()
        assert compute_viability(biz, dp) >= 10.0

    def test_score_capped_at_100(self):
        biz = self._make_business(
            incorporation_date=date.today() - timedelta(days=10*365),
            license_status=LicenseStatus.ACTIVE,
            total_customer_ugc=100,
            nextdoor_recommendations=10,
            thumbtack_hires=20,
            employee_count_est=5,
        )
        dp = self._make_dp(
            google_review_count=60,
            google_avg_rating=4.8,
            review_velocity_30d=5.0,
        )
        assert compute_viability(biz, dp) <= 100.0

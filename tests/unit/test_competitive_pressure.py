from unittest.mock import MagicMock

from leadforge.db.models.business import Business
from leadforge.db.models.competitive_context import CompetitiveContext
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.scoring.competitive_pressure import compute_competitive_pressure


class TestCompetitivePressureScoring:
    def _make_context(self, **kwargs) -> MagicMock:
        ctx = MagicMock(spec=CompetitiveContext)
        defaults = {
            "competitor_count": 0,
            "avg_digital_score": None,
            "competitor_ads_active_count": 0,
            "median_household_income": None,
            "population_density": None,
            "avg_rating": None,
        }
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(ctx, k, v)
        return ctx

    def _make_dp(self, **kwargs) -> MagicMock:
        dp = MagicMock(spec=DigitalPresence)
        defaults = {"google_review_count": 0, "google_avg_rating": None}
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(dp, k, v)
        return dp

    def test_no_context_returns_zero(self):
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, None, None) == 0.0

    def test_high_density_adds_20(self):
        ctx = self._make_context(competitor_count=8)
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, None, ctx) >= 20.0

    def test_very_high_density_adds_additional_10(self):
        ctx = self._make_context(competitor_count=15)
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, None, ctx) >= 30.0

    def test_competitor_ads_adds_15(self):
        ctx = self._make_context(competitor_ads_active_count=3)
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, None, ctx) >= 15.0

    def test_high_income_zip_adds_10(self):
        ctx = self._make_context(median_household_income=80000)
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, None, ctx) >= 10.0

    def test_high_density_population_adds_10(self):
        ctx = self._make_context(population_density=15000)
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, None, ctx) >= 10.0

    def test_score_capped_at_100(self):
        ctx = self._make_context(
            competitor_count=20,
            avg_digital_score=50,
            competitor_ads_active_count=5,
            median_household_income=100000,
            population_density=20000,
            avg_rating=4.8,
        )
        dp = self._make_dp(google_review_count=2, google_avg_rating=3.0)
        biz = MagicMock(spec=Business)
        assert compute_competitive_pressure(biz, dp, ctx) <= 100.0

import pytest
from unittest.mock import MagicMock, patch
from leadforge.scoring.composite import compute_composite_score, compute_price_tier
from leadforge.db.models.business import Business
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.db.models.competitive_context import CompetitiveContext


class TestCompositeScoring:

    def test_composite_is_weighted_sum(self):
        """Verify weights are applied correctly: 0.40 + 0.35 + 0.25."""
        with patch("leadforge.scoring.composite.compute_digital_deficit", return_value=50.0), \
             patch("leadforge.scoring.composite.compute_viability", return_value=60.0), \
             patch("leadforge.scoring.composite.compute_competitive_pressure", return_value=40.0):
            biz = MagicMock(spec=Business)
            biz.estimated_monthly_revenue = None
            biz.employee_count_est = 0
            dp = MagicMock(spec=DigitalPresence)
            ctx = MagicMock(spec=CompetitiveContext)

            result = compute_composite_score(biz, dp, ctx)
            expected = 50.0 * 0.40 + 60.0 * 0.35 + 40.0 * 0.25
            assert result["composite_acquisition_score"] == round(expected, 2)

    def test_composite_capped_at_100(self):
        with patch("leadforge.scoring.composite.compute_digital_deficit", return_value=100.0), \
             patch("leadforge.scoring.composite.compute_viability", return_value=100.0), \
             patch("leadforge.scoring.composite.compute_competitive_pressure", return_value=100.0):
            biz = MagicMock(spec=Business)
            biz.estimated_monthly_revenue = None
            biz.employee_count_est = 0
            dp = MagicMock(spec=DigitalPresence)
            ctx = MagicMock(spec=CompetitiveContext)

            result = compute_composite_score(biz, dp, ctx)
            assert result["composite_acquisition_score"] <= 100.0

    def test_returns_all_sub_scores(self):
        with patch("leadforge.scoring.composite.compute_digital_deficit", return_value=50.0), \
             patch("leadforge.scoring.composite.compute_viability", return_value=50.0), \
             patch("leadforge.scoring.composite.compute_competitive_pressure", return_value=50.0):
            biz = MagicMock(spec=Business)
            biz.estimated_monthly_revenue = None
            biz.employee_count_est = 0
            dp = MagicMock(spec=DigitalPresence)
            ctx = MagicMock(spec=CompetitiveContext)

            result = compute_composite_score(biz, dp, ctx)
            assert "digital_deficit_score" in result
            assert "viability_score" in result
            assert "competitive_pressure_score" in result
            assert "composite_acquisition_score" in result
            assert "price_tier" in result


class TestPriceTier:

    def test_tier_1_low_revenue(self):
        biz = MagicMock(spec=Business)
        biz.estimated_monthly_revenue = 10000
        biz.employee_count_est = 2
        assert compute_price_tier(biz, 20) == 1

    def test_tier_2_mid_range(self):
        biz = MagicMock(spec=Business)
        biz.estimated_monthly_revenue = 25000
        biz.employee_count_est = 5
        assert compute_price_tier(biz, 45) == 2

    def test_tier_3_high_revenue(self):
        biz = MagicMock(spec=Business)
        biz.estimated_monthly_revenue = 60000
        biz.employee_count_est = 10
        assert compute_price_tier(biz, 70) == 3

    def test_tier_3_high_pressure(self):
        biz = MagicMock(spec=Business)
        biz.estimated_monthly_revenue = 20000
        biz.employee_count_est = 3
        assert compute_price_tier(biz, 70) == 3

    def test_tier_1_few_employees(self):
        biz = MagicMock(spec=Business)
        biz.estimated_monthly_revenue = None
        biz.employee_count_est = 1
        assert compute_price_tier(biz, 40) == 1

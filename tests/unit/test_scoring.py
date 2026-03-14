from unittest.mock import MagicMock

from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.scoring.digital_deficit import compute_digital_deficit


class TestDigitalDeficitScoring:
    """Test digital deficit scoring against PRD rules."""

    def _make_dp(self, **kwargs) -> MagicMock:
        """Helper to create a mock DigitalPresence with defaults."""
        dp = MagicMock(spec=DigitalPresence)
        defaults = {
            "has_website": True,
            "website_quality_score": 80.0,
            "has_ssl": True,
            "has_google_business_profile": True,
            "gbp_completeness_score": 0.8,
            "google_review_count": 50,
            "google_avg_rating": 4.5,
            "review_velocity_30d": 2.0,
            "has_facebook_page": True,
            "has_instagram": True,
            "fb_last_post_days_ago": 10,
            "has_google_ads": True,
            "has_meta_ads": True,
        }
        defaults.update(kwargs)
        for k, v in defaults.items():
            setattr(dp, k, v)
        return dp

    def test_perfect_digital_presence_scores_zero(self):
        """Business with full digital presence should score 0."""
        dp = self._make_dp()
        assert compute_digital_deficit(dp) == 0.0

    def test_no_website_adds_30(self):
        dp = self._make_dp(has_website=False)
        score = compute_digital_deficit(dp)
        assert score >= 30.0

    def test_poor_website_quality_adds_20(self):
        dp = self._make_dp(website_quality_score=35.0)
        score = compute_digital_deficit(dp)
        assert score >= 20.0

    def test_no_ssl_adds_8(self):
        dp = self._make_dp(has_ssl=False)
        assert compute_digital_deficit(dp) >= 8.0

    def test_no_gbp_adds_15(self):
        dp = self._make_dp(has_google_business_profile=False)
        assert compute_digital_deficit(dp) >= 15.0

    def test_incomplete_gbp_adds_10(self):
        dp = self._make_dp(gbp_completeness_score=0.3)
        assert compute_digital_deficit(dp) >= 10.0

    def test_zero_reviews_adds_10(self):
        dp = self._make_dp(google_review_count=0)
        assert compute_digital_deficit(dp) >= 10.0

    def test_low_reviews_adds_5(self):
        dp = self._make_dp(google_review_count=5)
        assert compute_digital_deficit(dp) >= 5.0

    def test_no_social_media_adds_12(self):
        dp = self._make_dp(has_facebook_page=False, has_instagram=False)
        assert compute_digital_deficit(dp) >= 12.0

    def test_dormant_social_adds_8(self):
        dp = self._make_dp(fb_last_post_days_ago=120)
        assert compute_digital_deficit(dp) >= 8.0

    def test_no_paid_ads_adds_7(self):
        dp = self._make_dp(has_google_ads=False, has_meta_ads=False)
        assert compute_digital_deficit(dp) >= 7.0

    def test_maximum_deficit_worst_case(self):
        """Business with zero digital presence should get maximum score."""
        dp = self._make_dp(
            has_website=False,
            has_ssl=False,
            has_google_business_profile=False,
            google_review_count=0,
            has_facebook_page=False,
            has_instagram=False,
            fb_last_post_days_ago=None,
            has_google_ads=False,
            has_meta_ads=False,
        )
        score = compute_digital_deficit(dp)
        # no website (30) + no ssl (8) + no gbp (15) + zero reviews (10) + no social (12) + no ads (7) = 82
        assert score == 82.0

    def test_score_capped_at_100(self):
        """Score should never exceed 100."""
        dp = self._make_dp(
            has_website=False,
            website_quality_score=10.0,
            has_ssl=False,
            has_google_business_profile=False,
            gbp_completeness_score=0.1,
            google_review_count=0,
            has_facebook_page=False,
            has_instagram=False,
            fb_last_post_days_ago=200,
            has_google_ads=False,
            has_meta_ads=False,
        )
        score = compute_digital_deficit(dp)
        assert score <= 100.0

    def test_null_values_handled_gracefully(self):
        """None values should not cause errors."""
        dp = self._make_dp(
            has_website=False,
            website_quality_score=None,
            has_ssl=None,
            gbp_completeness_score=None,
            google_review_count=None,
            google_avg_rating=None,
            fb_last_post_days_ago=None,
        )
        score = compute_digital_deficit(dp)
        assert isinstance(score, float)
        assert 0.0 <= score <= 100.0

"""Tests for NOF grant eligibility scoring."""

from datetime import date, timedelta

from leadforge.db.models.business import LicenseStatus, NicheType
from leadforge.scoring.nof_eligibility import compute_nof_eligibility

PRIORITY_CORRIDOR = {
    "corridor_name": "Western Ave",
    "corridor_type": "priority",
    "is_priority": True,
}
ELIGIBLE_CORRIDOR = {
    "corridor_name": "63rd St",
    "corridor_type": "eligible",
    "is_priority": False,
}


def test_not_on_corridor_returns_zero():
    score = compute_nof_eligibility(
        corridor_info=None,
        niche=NicheType.BARBERSHOPS,
    )
    assert score == 0.0


def test_mobile_mechanics_returns_zero():
    score = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.MOBILE_MECHANICS,
    )
    assert score == 0.0


def test_revoked_license_returns_zero():
    score = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
        license_status=LicenseStatus.REVOKED,
    )
    assert score == 0.0


def test_priority_corridor_base_score():
    score = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
    )
    # Priority corridor (30) + eligible biz type (15) = 45
    assert score >= 45


def test_eligible_corridor_base_score():
    score = compute_nof_eligibility(
        corridor_info=ELIGIBLE_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
    )
    # Eligible corridor (20) + eligible biz type (15) = 35
    assert score >= 35


def test_full_score_with_all_signals():
    score = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
        license_status=LicenseStatus.ACTIVE,
        incorporation_date=date.today() - timedelta(days=365 * 5),
        digital_deficit_score=80.0,
        estimated_monthly_revenue=10000.0,
        employee_count_est=5,
        google_review_count=20,
        total_customer_ugc=15,
    )
    # 30 + 15 + 10 + 5 + 15 + 8 + 7 + 5 + 5 = 100
    assert score == 100.0


def test_incorporation_age_threshold():
    # Exactly 2 years — should NOT get the bonus (>2 required)
    exactly_two_years = date.today() - timedelta(days=int(2 * 365.25))
    score_at_two = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
        incorporation_date=exactly_two_years,
    )

    # 2 years + 1 day — should get the bonus
    over_two_years = date.today() - timedelta(days=int(2 * 365.25) + 2)
    score_over_two = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
        incorporation_date=over_two_years,
    )

    # Base is 45 (30+15); the 10-point bonus should only appear for >2 years
    assert score_at_two == 45
    assert score_over_two == 55


def test_score_capped_at_100():
    score = compute_nof_eligibility(
        corridor_info=PRIORITY_CORRIDOR,
        niche=NicheType.BARBERSHOPS,
        license_status=LicenseStatus.ACTIVE,
        incorporation_date=date.today() - timedelta(days=365 * 10),
        digital_deficit_score=99.0,
        estimated_monthly_revenue=50000.0,
        employee_count_est=50,
        google_review_count=500,
        total_customer_ugc=200,
    )
    assert score == 100.0

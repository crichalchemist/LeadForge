"""NOF Grant Eligibility Scoring.

Scores businesses for eligibility for the Neighborhood Opportunity Fund (NOF) grant
based on corridor location, business characteristics, and operational metrics.
"""

from datetime import date

import structlog

from leadforge.db.models.business import LicenseStatus, NicheType

logger = structlog.get_logger(__name__)


def compute_nof_eligibility(
    corridor_info: dict | None,
    niche: NicheType,
    license_status: LicenseStatus | None = None,
    incorporation_date: date | None = None,
    digital_deficit_score: float = 0.0,
    estimated_monthly_revenue: float | None = None,
    employee_count_est: int | None = None,
    google_review_count: int | None = None,
    total_customer_ugc: int | None = None,
) -> float:
    """Compute NOF grant eligibility score (0-100).

    Higher score = more eligible for NOF grant funding.

    Hard gates (return 0 immediately):
    - Not on any NOF corridor (corridor_info is None)
    - Mobile-only business (MOBILE_MECHANICS niche)
    - Revoked license

    Scoring rules (point-based, max ~120 points, capped at 100):
    - On Priority Corridor: +30
    - On Eligible Corridor: +20
    - Eligible business type (storefront): +15
    - Incorporation age >2yr: +10
    - Active license: +5
    - High digital deficit (>60): +15
    - Revenue >$5K/mo: +8
    - Employee count >2: +7
    - Google reviews >10: +5
    - Active social/UGC presence (>10): +5

    Args:
        corridor_info: Corridor eligibility dict with keys:
            - corridor_name (str)
            - corridor_type ("priority" or "eligible")
            - is_priority (bool)
            None if not on any corridor.
        niche: Business niche type.
        license_status: Business license status.
        incorporation_date: Date of business incorporation.
        digital_deficit_score: Digital deficit score (0-100).
        estimated_monthly_revenue: Estimated monthly revenue in dollars.
        employee_count_est: Estimated employee count.
        google_review_count: Number of Google reviews.
        total_customer_ugc: Total customer user-generated content count.

    Returns:
        Eligibility score from 0-100 (float).
    """
    score = 0.0

    # Hard gate: Not on any corridor
    if corridor_info is None:
        logger.info(
            "nof_eligibility_hard_gate", reason="not_on_corridor", niche=niche.value
        )
        return 0.0

    # Hard gate: Mobile-only businesses ineligible
    if niche == NicheType.MOBILE_MECHANICS:
        logger.info(
            "nof_eligibility_hard_gate",
            reason="mobile_only_business",
            niche=niche.value,
        )
        return 0.0

    # Hard gate: Revoked license
    if license_status == LicenseStatus.REVOKED:
        logger.info(
            "nof_eligibility_hard_gate", reason="revoked_license", niche=niche.value
        )
        return 0.0

    # Corridor scoring
    if corridor_info.get("is_priority"):
        score += 30
    else:
        # On eligible corridor (not priority)
        score += 20

    # Eligible business type (all NicheTypes are eligible except MOBILE_MECHANICS, which is already gated)
    score += 15

    # Incorporation age >2 years
    if incorporation_date is not None:
        today = date.today()
        age_years = (today - incorporation_date).days / 365.25
        if age_years > 2:
            score += 10

    # Active license
    if license_status == LicenseStatus.ACTIVE:
        score += 5

    # High digital deficit (proxy for property improvement need)
    if digital_deficit_score > 60:
        score += 15

    # Revenue >$5K/mo
    if estimated_monthly_revenue is not None and estimated_monthly_revenue > 5000:
        score += 8

    # Employee count >2
    if employee_count_est is not None and employee_count_est > 2:
        score += 7

    # Google reviews >10
    if google_review_count is not None and google_review_count > 10:
        score += 5

    # Active social/UGC presence
    if total_customer_ugc is not None and total_customer_ugc > 10:
        score += 5

    return min(score, 100.0)

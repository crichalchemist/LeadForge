from datetime import date
from leadforge.db.models.business import Business
from leadforge.db.models.digital_presence import DigitalPresence


def compute_viability(business: Business, dp: DigitalPresence | None = None) -> float:
    """Compute business viability score (0-100). PRD Section 3.2.

    Validates business is operational, stable, and capable of paying.
    """
    score = 0.0

    # In operation 3+ years: +20
    if business.incorporation_date:
        years = (date.today() - business.incorporation_date).days / 365.25
        if years >= 3:
            score += 20
        # Additional: 7+ years: +10
        if years >= 7:
            score += 10

    # Moderate review volume (10-50): +15
    review_count = dp.google_review_count if dp else 0
    if review_count and 10 <= review_count <= 50:
        score += 15
    # High review volume (50+): +20
    elif review_count and review_count > 50:
        score += 20

    # Rating above 4.0: +15
    rating = dp.google_avg_rating if dp else None
    if rating is not None and rating >= 4.0:
        score += 15
    # Rating 3.5-4.0: +8
    elif rating is not None and rating >= 3.5:
        score += 8

    # Positive review trajectory: +8
    velocity = dp.review_velocity_30d if dp else None
    if velocity is not None and velocity > 0:
        score += 8

    # Customer UGC: moderate (10-50 tags): +10
    ugc = business.total_customer_ugc or 0
    if 10 <= ugc <= 50:
        score += 10
    # Customer UGC: high (50+ tags): +15
    elif ugc > 50:
        score += 15

    # Active license: +5
    if business.license_status and business.license_status.value == "active":
        score += 5

    # Nextdoor recommendations > 5: +5
    if business.nextdoor_recommendations and business.nextdoor_recommendations > 5:
        score += 5

    # Thumbtack hires > 10: +5
    if business.thumbtack_hires and business.thumbtack_hires > 10:
        score += 5

    # Multiple employees estimated: +3
    if business.employee_count_est and business.employee_count_est >= 3:
        score += 3

    return min(score, 100.0)

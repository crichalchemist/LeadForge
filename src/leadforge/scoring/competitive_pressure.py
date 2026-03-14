from leadforge.db.models.business import Business
from leadforge.db.models.competitive_context import CompetitiveContext
from leadforge.db.models.digital_presence import DigitalPresence


def compute_competitive_pressure(
    business: Business,
    dp: DigitalPresence | None,
    context: CompetitiveContext | None,
) -> float:
    """Compute competitive pressure score (0-100). PRD Section 3.2.

    Higher score = more competitive environment = more urgency to act.
    """
    if context is None:
        return 0.0

    score = 0.0

    # High competitor density (>5): +20
    if context.competitor_count > 5:
        score += 20
    # Very high density (>10): additional +10
    if context.competitor_count > 10:
        score += 10

    # Competitors have stronger digital presence: +25
    if dp and context.avg_digital_score is not None:
        # Business digital deficit score — higher means WORSE digital presence
        # If this business's deficit > avg, competitors are doing better
        business_deficit = dp.google_review_count or 0  # Proxy for digital strength
        if (
            context.avg_digital_score is not None
            and business_deficit < context.avg_digital_score
        ):
            score += 25

    # Competitors running paid ads (>=2): +15
    if context.competitor_ads_active_count >= 2:
        score += 15

    # High-income zip code (>$65,000): +10
    if context.median_household_income and context.median_household_income > 65000:
        score += 10

    # High population density (>10,000/sq mi): +10
    if context.population_density and context.population_density > 10000:
        score += 10

    # Competitor avg rating higher: +10
    if dp and dp.google_avg_rating and context.avg_rating:
        if dp.google_avg_rating < context.avg_rating:
            score += 10

    return min(score, 100.0)

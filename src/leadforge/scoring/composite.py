from leadforge.db.models.business import Business
from leadforge.db.models.competitive_context import CompetitiveContext
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.scoring.competitive_pressure import compute_competitive_pressure
from leadforge.scoring.digital_deficit import compute_digital_deficit
from leadforge.scoring.viability import compute_viability

# PRD weights
WEIGHT_DEFICIT = 0.40
WEIGHT_VIABILITY = 0.35
WEIGHT_PRESSURE = 0.25


def compute_composite_score(
    business: Business,
    dp: DigitalPresence | None,
    context: CompetitiveContext | None,
) -> dict:
    """Compute the full composite acquisition score with all sub-scores.

    Returns dict with: digital_deficit_score, viability_score,
    competitive_pressure_score, composite_acquisition_score, price_tier
    """
    deficit = compute_digital_deficit(dp) if dp else 0.0
    viability = compute_viability(business, dp)
    pressure = compute_competitive_pressure(business, dp, context)

    composite = (
        deficit * WEIGHT_DEFICIT
        + viability * WEIGHT_VIABILITY
        + pressure * WEIGHT_PRESSURE
    )
    composite = min(composite, 100.0)

    price_tier = compute_price_tier(business, pressure)

    return {
        "digital_deficit_score": deficit,
        "viability_score": viability,
        "competitive_pressure_score": pressure,
        "composite_acquisition_score": round(composite, 2),
        "price_tier": price_tier,
    }


def compute_price_tier(business: Business, competitive_pressure: float) -> int:
    """Assign price tier (1, 2, or 3) based on PRD Section 3.3.

    Tier 1: $150-$500 — small, low competition
    Tier 2: $400-$1,200 — mid-range
    Tier 3: $900-$2,500 — larger, high competition
    """
    revenue = business.estimated_monthly_revenue
    employees = business.employee_count_est or 0

    # Tier 3: est_revenue > $50K OR competitive_pressure > 65 OR employees > 8
    if (revenue and revenue > 50000) or competitive_pressure > 65 or employees > 8:
        return 3

    # Tier 1: est_revenue < $15K OR employees < 3 OR competitive_pressure < 30
    if (
        (revenue is not None and revenue < 15000)
        or employees < 3
        or competitive_pressure < 30
    ):
        return 1

    # Default: Tier 2
    return 2

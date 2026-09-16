"""Generate differential-test vectors from the Python scoring functions.

Dates are emitted as day offsets, not absolute dates, so the fixture stays valid
whenever the TypeScript suite runs. Offsets near a threshold (2y, 3y, 7y) are
skipped so a UTC-vs-local "today" difference cannot flip a case.
"""

import json
import os
import random
from datetime import date, timedelta
from types import SimpleNamespace

from leadforge.db.models.business import LicenseStatus, NicheType
from leadforge.scoring.competitive_pressure import compute_competitive_pressure
from leadforge.scoring.composite import compute_composite_score
from leadforge.scoring.digital_deficit import compute_digital_deficit
from leadforge.scoring.nof_eligibility import compute_nof_eligibility
from leadforge.scoring.viability import compute_viability

random.seed(20260903)

BOUNDARIES = [int(2 * 365.25), int(3 * 365.25), int(7 * 365.25)]
NICHES = [n.value for n in NicheType]
STATUSES = [None, "active", "expired", "revoked", "unknown"]


def maybe(value, none_odds=0.25):
    return None if random.random() < none_odds else value


def safe_offset():
    while True:
        days = random.randint(0, 4000)
        if all(abs(days - b) > 5 for b in BOUNDARIES):
            return days


def make_case():
    dp_json = None
    if random.random() > 0.15:
        dp_json = {
            "has_website": random.randint(0, 1),
            "website_quality_score": maybe(round(random.uniform(0, 100), 1)),
            "has_ssl": maybe(random.randint(0, 1)),
            "has_google_business_profile": random.randint(0, 1),
            "gbp_completeness_score": maybe(round(random.uniform(0, 1), 2)),
            "google_review_count": maybe(random.randint(0, 200)),
            "google_avg_rating": maybe(round(random.uniform(1, 5), 1)),
            "review_velocity_30d": maybe(round(random.uniform(-2, 5), 1)),
            "has_facebook_page": random.randint(0, 1),
            "has_instagram": random.randint(0, 1),
            "fb_last_post_days_ago": maybe(random.randint(0, 400)),
            "has_google_ads": random.randint(0, 1),
            "has_meta_ads": random.randint(0, 1),
        }

    offset = maybe(safe_offset(), none_odds=0.3)
    biz_json = {
        "incorporation_days_ago": offset,
        "license_status": random.choice(STATUSES),
        "total_customer_ugc": maybe(random.randint(0, 100)),
        "nextdoor_recommendations": maybe(random.randint(0, 20)),
        "thumbtack_hires": maybe(random.randint(0, 30)),
        "employee_count_est": maybe(random.randint(0, 20)),
        "estimated_monthly_revenue": maybe(round(random.uniform(0, 80000), 2)),
    }

    ctx_json = None
    if random.random() > 0.2:
        ctx_json = {
            "competitor_count": random.randint(0, 25),
            "avg_digital_score": maybe(round(random.uniform(0, 100), 1)),
            "competitor_ads_active_count": random.randint(0, 6),
            "avg_rating": maybe(round(random.uniform(1, 5), 1)),
            "median_household_income": maybe(round(random.uniform(20000, 120000), 2)),
            "population_density": maybe(round(random.uniform(0, 25000), 1)),
        }

    corridor = random.choice([None, "priority", "eligible"])
    niche = random.choice(NICHES)

    # Python objects
    dp = SimpleNamespace(**dp_json) if dp_json else None
    raw_status = biz_json["license_status"]
    status = LicenseStatus(raw_status) if raw_status else None
    incorporated = date.today() - timedelta(days=offset) if offset is not None else None
    biz = SimpleNamespace(
        incorporation_date=incorporated,
        license_status=status,
        total_customer_ugc=biz_json["total_customer_ugc"],
        nextdoor_recommendations=biz_json["nextdoor_recommendations"],
        thumbtack_hires=biz_json["thumbtack_hires"],
        employee_count_est=biz_json["employee_count_est"],
        estimated_monthly_revenue=biz_json["estimated_monthly_revenue"],
    )
    ctx = SimpleNamespace(**ctx_json) if ctx_json else None

    composite = compute_composite_score(biz, dp, ctx)
    corridor_info = None
    if corridor:
        corridor_info = {
            "corridor_name": "X",
            "corridor_type": corridor,
            "is_priority": corridor == "priority",
        }
    nof = compute_nof_eligibility(
        corridor_info=corridor_info,
        niche=NicheType(niche),
        license_status=status,
        incorporation_date=biz.incorporation_date,
        digital_deficit_score=composite["digital_deficit_score"],
        estimated_monthly_revenue=biz_json["estimated_monthly_revenue"],
        employee_count_est=biz_json["employee_count_est"],
        google_review_count=dp_json["google_review_count"] if dp_json else None,
        total_customer_ugc=biz_json["total_customer_ugc"],
    )

    return {
        "dp": dp_json,
        "business": biz_json,
        "context": ctx_json,
        "corridor": corridor,
        "niche": niche,
        "expected": {
            **composite,
            "nof_eligibility_score": nof,
            "deficit_alone": compute_digital_deficit(dp) if dp else None,
            "viability_alone": compute_viability(biz, dp),
            "pressure_alone": compute_competitive_pressure(biz, dp, ctx),
        },
    }


cases = [make_case() for _ in range(150)]
out = "api/test/fixtures/scoring-vectors.json"
os.makedirs("api/test/fixtures", exist_ok=True)
with open(out, "w") as fh:
    json.dump(cases, fh, indent=1)
print(f"wrote {len(cases)} cases to {out}")

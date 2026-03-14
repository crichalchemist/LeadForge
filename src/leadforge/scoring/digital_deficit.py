from leadforge.db.models.digital_presence import DigitalPresence


def compute_digital_deficit(dp: DigitalPresence) -> float:
    """Compute digital deficit score (0-100) from DigitalPresence.

    Higher score = greater digital deficit = more likely to need services.
    Based on PRD Section 3.2 scoring rules.
    """
    score = 0.0

    # No website: +30
    if not dp.has_website:
        score += 30
    # Website exists but poor quality (< 40): +20
    elif dp.website_quality_score is not None and dp.website_quality_score < 40:
        score += 20

    # No SSL: +8
    if dp.has_ssl is not None and not dp.has_ssl:
        score += 8

    # No Google Business Profile: +15
    if not dp.has_google_business_profile:
        score += 15
    # GBP incomplete (< 0.5): +10
    elif dp.gbp_completeness_score is not None and dp.gbp_completeness_score < 0.5:
        score += 10

    # Zero Google reviews: +10
    if dp.google_review_count is not None and dp.google_review_count == 0:
        score += 10
    # Low review count (< 10): +5
    elif dp.google_review_count is not None and dp.google_review_count < 10:
        score += 5

    # No social media presence: +12
    if not dp.has_facebook_page and not dp.has_instagram:
        score += 12

    # Dormant social media (fb_last_post > 90 days): +8
    if dp.fb_last_post_days_ago is not None and dp.fb_last_post_days_ago > 90:
        score += 8

    # Not running any paid ads: +7
    if not dp.has_google_ads and not dp.has_meta_ads:
        score += 7

    return min(score, 100.0)

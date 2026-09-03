// Mirrors tests/unit/test_scoring.py, test_viability.py, test_competitive_pressure.py,
// test_composite.py and test_nof_eligibility.py.
import { describe, expect, it } from 'vitest';
import {
  computeCompetitivePressure,
  computeCompositeScore,
  computeDigitalDeficit,
  computeNofEligibility,
  computePriceTier,
  computeViability,
  WEIGHT_DEFICIT,
  WEIGHT_PRESSURE,
  WEIGHT_VIABILITY,
  type CompositeBusiness,
  type CompositePresence,
  type CorridorInfo,
  type DeficitPresence,
  type PressureContext,
  type PressurePresence,
  type ViabilityBusiness,
  type ViabilityPresence,
} from '../src/lib/scoring';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// =py test_scoring.TestDigitalDeficitScoring._make_dp
const makeDp = (overrides: Partial<DeficitPresence> = {}): DeficitPresence => ({
  has_website: 1,
  website_quality_score: 80.0,
  has_ssl: 1,
  has_google_business_profile: 1,
  gbp_completeness_score: 0.8,
  google_review_count: 50,
  has_facebook_page: 1,
  has_instagram: 1,
  fb_last_post_days_ago: 10,
  has_google_ads: 1,
  has_meta_ads: 1,
  ...overrides,
});

describe('TestDigitalDeficitScoring', () => {
  it('test_perfect_digital_presence_scores_zero', () => {
    expect(computeDigitalDeficit(makeDp())).toBe(0);
  });

  it('test_no_website_adds_30', () => {
    expect(computeDigitalDeficit(makeDp({ has_website: 0 }))).toBeGreaterThanOrEqual(30);
  });

  it('test_poor_website_quality_adds_20', () => {
    expect(computeDigitalDeficit(makeDp({ website_quality_score: 35.0 }))).toBeGreaterThanOrEqual(20);
  });

  it('test_no_ssl_adds_8', () => {
    expect(computeDigitalDeficit(makeDp({ has_ssl: 0 }))).toBeGreaterThanOrEqual(8);
  });

  it('test_no_gbp_adds_15', () => {
    expect(computeDigitalDeficit(makeDp({ has_google_business_profile: 0 }))).toBeGreaterThanOrEqual(15);
  });

  it('test_incomplete_gbp_adds_10', () => {
    expect(computeDigitalDeficit(makeDp({ gbp_completeness_score: 0.3 }))).toBeGreaterThanOrEqual(10);
  });

  it('test_zero_reviews_adds_10', () => {
    expect(computeDigitalDeficit(makeDp({ google_review_count: 0 }))).toBeGreaterThanOrEqual(10);
  });

  it('test_low_reviews_adds_5', () => {
    expect(computeDigitalDeficit(makeDp({ google_review_count: 5 }))).toBeGreaterThanOrEqual(5);
  });

  it('test_no_social_media_adds_12', () => {
    expect(computeDigitalDeficit(makeDp({ has_facebook_page: 0, has_instagram: 0 }))).toBeGreaterThanOrEqual(12);
  });

  it('test_dormant_social_adds_8', () => {
    expect(computeDigitalDeficit(makeDp({ fb_last_post_days_ago: 120 }))).toBeGreaterThanOrEqual(8);
  });

  it('test_no_paid_ads_adds_7', () => {
    expect(computeDigitalDeficit(makeDp({ has_google_ads: 0, has_meta_ads: 0 }))).toBeGreaterThanOrEqual(7);
  });

  it('test_maximum_deficit_worst_case', () => {
    // no website (30) + no ssl (8) + no gbp (15) + zero reviews (10) + no social (12) + no ads (7) = 82
    const score = computeDigitalDeficit(
      makeDp({
        has_website: 0,
        has_ssl: 0,
        has_google_business_profile: 0,
        google_review_count: 0,
        has_facebook_page: 0,
        has_instagram: 0,
        fb_last_post_days_ago: null,
        has_google_ads: 0,
        has_meta_ads: 0,
      }),
    );
    expect(score).toBe(82);
  });

  it('test_score_capped_at_100', () => {
    const score = computeDigitalDeficit(
      makeDp({
        has_website: 0,
        website_quality_score: 10.0,
        has_ssl: 0,
        has_google_business_profile: 0,
        gbp_completeness_score: 0.1,
        google_review_count: 0,
        has_facebook_page: 0,
        has_instagram: 0,
        fb_last_post_days_ago: 200,
        has_google_ads: 0,
        has_meta_ads: 0,
      }),
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it('test_null_values_handled_gracefully', () => {
    const score = computeDigitalDeficit(
      makeDp({
        has_website: 0,
        website_quality_score: null,
        has_ssl: null,
        gbp_completeness_score: null,
        google_review_count: null,
        fb_last_post_days_ago: null,
      }),
    );
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// =py test_viability.TestViabilityScoring._make_business / _make_dp
const makeBusiness = (overrides: Partial<ViabilityBusiness> = {}): ViabilityBusiness => ({
  incorporation_date: null,
  license_status: null,
  total_customer_ugc: 0,
  nextdoor_recommendations: 0,
  thumbtack_hires: 0,
  employee_count_est: null,
  ...overrides,
});

const makeViabilityDp = (overrides: Partial<ViabilityPresence> = {}): ViabilityPresence => ({
  google_review_count: 0,
  google_avg_rating: null,
  review_velocity_30d: null,
  ...overrides,
});

describe('TestViabilityScoring', () => {
  it('test_zero_viability_for_new_unknown_business', () => {
    expect(computeViability(makeBusiness(), makeViabilityDp())).toBe(0);
  });

  it('test_three_years_operation_adds_20', () => {
    const business = makeBusiness({ incorporation_date: daysAgo(4 * 365) });
    expect(computeViability(business, makeViabilityDp())).toBeGreaterThanOrEqual(20);
  });

  it('test_seven_years_adds_additional_10', () => {
    const business = makeBusiness({ incorporation_date: daysAgo(8 * 365) });
    expect(computeViability(business, makeViabilityDp())).toBeGreaterThanOrEqual(30);
  });

  it('test_moderate_reviews_adds_15', () => {
    expect(computeViability(makeBusiness(), makeViabilityDp({ google_review_count: 25 }))).toBeGreaterThanOrEqual(15);
  });

  it('test_high_reviews_adds_20', () => {
    expect(computeViability(makeBusiness(), makeViabilityDp({ google_review_count: 60 }))).toBeGreaterThanOrEqual(20);
  });

  it('test_high_rating_adds_15', () => {
    expect(computeViability(makeBusiness(), makeViabilityDp({ google_avg_rating: 4.5 }))).toBeGreaterThanOrEqual(15);
  });

  it('test_active_license_adds_5', () => {
    expect(computeViability(makeBusiness({ license_status: 'active' }), makeViabilityDp())).toBeGreaterThanOrEqual(5);
  });

  it('test_ugc_moderate_adds_10', () => {
    expect(computeViability(makeBusiness({ total_customer_ugc: 30 }), makeViabilityDp())).toBeGreaterThanOrEqual(10);
  });

  it('test_score_capped_at_100', () => {
    const business = makeBusiness({
      incorporation_date: daysAgo(10 * 365),
      license_status: 'active',
      total_customer_ugc: 100,
      nextdoor_recommendations: 10,
      thumbtack_hires: 20,
      employee_count_est: 5,
    });
    const dp = makeViabilityDp({ google_review_count: 60, google_avg_rating: 4.8, review_velocity_30d: 5.0 });
    expect(computeViability(business, dp)).toBeLessThanOrEqual(100);
  });
});

// =py test_competitive_pressure.TestCompetitivePressureScoring._make_context / _make_dp
const makeContext = (overrides: Partial<PressureContext> = {}): PressureContext => ({
  competitor_count: 0,
  avg_digital_score: null,
  competitor_ads_active_count: 0,
  median_household_income: null,
  population_density: null,
  avg_rating: null,
  ...overrides,
});

const makePressureDp = (overrides: Partial<PressurePresence> = {}): PressurePresence => ({
  google_review_count: 0,
  google_avg_rating: null,
  ...overrides,
});

describe('TestCompetitivePressureScoring', () => {
  it('test_no_context_returns_zero', () => {
    expect(computeCompetitivePressure(null, null)).toBe(0);
  });

  it('test_high_density_adds_20', () => {
    expect(computeCompetitivePressure(null, makeContext({ competitor_count: 8 }))).toBeGreaterThanOrEqual(20);
  });

  it('test_very_high_density_adds_additional_10', () => {
    expect(computeCompetitivePressure(null, makeContext({ competitor_count: 15 }))).toBeGreaterThanOrEqual(30);
  });

  it('test_competitor_ads_adds_15', () => {
    expect(computeCompetitivePressure(null, makeContext({ competitor_ads_active_count: 3 }))).toBeGreaterThanOrEqual(15);
  });

  it('test_high_income_zip_adds_10', () => {
    expect(computeCompetitivePressure(null, makeContext({ median_household_income: 80000 }))).toBeGreaterThanOrEqual(10);
  });

  it('test_high_density_population_adds_10', () => {
    expect(computeCompetitivePressure(null, makeContext({ population_density: 15000 }))).toBeGreaterThanOrEqual(10);
  });

  it('test_score_capped_at_100', () => {
    const context = makeContext({
      competitor_count: 20,
      avg_digital_score: 50,
      competitor_ads_active_count: 5,
      median_household_income: 100000,
      population_density: 20000,
      avg_rating: 4.8,
    });
    const dp = makePressureDp({ google_review_count: 2, google_avg_rating: 3.0 });
    expect(computeCompetitivePressure(dp, context)).toBeLessThanOrEqual(100);
  });
});

describe('TestCompositeScoring', () => {
  // Python patches the three sub-scorers; here the sub-scores are computed from the same inputs
  // and the weighting is asserted against them, which pins the same property without mocking.
  const business: CompositeBusiness = {
    ...makeBusiness({ incorporation_date: daysAgo(5 * 365), license_status: 'active' }),
    estimated_monthly_revenue: null,
  };
  const dp: CompositePresence = { ...makeDp({ has_website: 0, google_review_count: 20 }), google_avg_rating: 4.2, review_velocity_30d: 1.0 };
  const context = makeContext({ competitor_count: 8, competitor_ads_active_count: 2 });

  it('test_composite_is_weighted_sum', () => {
    const result = computeCompositeScore(business, dp, context);
    const expected =
      computeDigitalDeficit(dp) * WEIGHT_DEFICIT +
      computeViability(business, dp) * WEIGHT_VIABILITY +
      computeCompetitivePressure(dp, context) * WEIGHT_PRESSURE;
    expect(result.composite_acquisition_score).toBe(Math.round(expected * 100) / 100);
  });

  it('test_composite_capped_at_100', () => {
    expect(computeCompositeScore(business, dp, context).composite_acquisition_score).toBeLessThanOrEqual(100);
  });

  it('test_returns_all_sub_scores', () => {
    expect(Object.keys(computeCompositeScore(business, dp, context)).sort()).toEqual([
      'competitive_pressure_score',
      'composite_acquisition_score',
      'digital_deficit_score',
      'price_tier',
      'viability_score',
    ]);
  });

  it('scores a business with no digital presence row as zero deficit', () => {
    const result = computeCompositeScore(business, null, context);
    expect(result.digital_deficit_score).toBe(0);
  });
});

describe('TestPriceTier', () => {
  const tierBusiness = (estimated_monthly_revenue: number | null, employee_count_est: number | null) => ({
    estimated_monthly_revenue,
    employee_count_est,
  });

  it('test_tier_1_low_revenue', () => expect(computePriceTier(tierBusiness(10000, 2), 20)).toBe(1));
  it('test_tier_2_mid_range', () => expect(computePriceTier(tierBusiness(25000, 5), 45)).toBe(2));
  it('test_tier_3_high_revenue', () => expect(computePriceTier(tierBusiness(60000, 10), 70)).toBe(3));
  it('test_tier_3_high_pressure', () => expect(computePriceTier(tierBusiness(20000, 3), 70)).toBe(3));
  it('test_tier_1_few_employees', () => expect(computePriceTier(tierBusiness(null, 1), 40)).toBe(1));
});

// =py test_nof_eligibility
const PRIORITY_CORRIDOR: CorridorInfo = { corridor_name: 'Western Ave', corridor_type: 'priority', is_priority: true };
const ELIGIBLE_CORRIDOR: CorridorInfo = { corridor_name: '63rd St', corridor_type: 'eligible', is_priority: false };

describe('nof eligibility', () => {
  it('test_not_on_corridor_returns_zero', () => {
    expect(computeNofEligibility(null, 'barbershops')).toBe(0);
  });

  it('test_mobile_mechanics_returns_zero', () => {
    expect(computeNofEligibility(PRIORITY_CORRIDOR, 'mobile_mechanics')).toBe(0);
  });

  it('test_revoked_license_returns_zero', () => {
    expect(computeNofEligibility(PRIORITY_CORRIDOR, 'barbershops', { license_status: 'revoked' })).toBe(0);
  });

  it('test_priority_corridor_base_score', () => {
    // Priority corridor (30) + eligible biz type (15) = 45
    expect(computeNofEligibility(PRIORITY_CORRIDOR, 'barbershops')).toBeGreaterThanOrEqual(45);
  });

  it('test_eligible_corridor_base_score', () => {
    // Eligible corridor (20) + eligible biz type (15) = 35
    expect(computeNofEligibility(ELIGIBLE_CORRIDOR, 'barbershops')).toBeGreaterThanOrEqual(35);
  });

  it('test_full_score_with_all_signals', () => {
    // 30 + 15 + 10 + 5 + 15 + 8 + 7 + 5 + 5 = 100
    const score = computeNofEligibility(PRIORITY_CORRIDOR, 'barbershops', {
      license_status: 'active',
      incorporation_date: daysAgo(365 * 5),
      digital_deficit_score: 80.0,
      estimated_monthly_revenue: 10000.0,
      employee_count_est: 5,
      google_review_count: 20,
      total_customer_ugc: 15,
    });
    expect(score).toBe(100);
  });

  it('test_incorporation_age_threshold', () => {
    // Exactly 2 years earns no bonus (>2 required); two days past it does
    const atTwo = computeNofEligibility(PRIORITY_CORRIDOR, 'barbershops', {
      incorporation_date: daysAgo(Math.trunc(2 * 365.25)),
    });
    const overTwo = computeNofEligibility(PRIORITY_CORRIDOR, 'barbershops', {
      incorporation_date: daysAgo(Math.trunc(2 * 365.25) + 2),
    });
    expect(atTwo).toBe(45);
    expect(overTwo).toBe(55);
  });

  it('test_score_capped_at_100', () => {
    const score = computeNofEligibility(PRIORITY_CORRIDOR, 'barbershops', {
      license_status: 'active',
      incorporation_date: daysAgo(365 * 10),
      digital_deficit_score: 99.0,
      estimated_monthly_revenue: 50000.0,
      employee_count_est: 50,
      google_review_count: 500,
      total_customer_ugc: 200,
    });
    expect(score).toBe(100);
  });
});

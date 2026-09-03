// =py scoring/{digital_deficit,viability,competitive_pressure,composite,nof_eligibility}
// Pure functions, as in Python. Booleans arrive from D1 as 0/1 integers.
import type { BusinessRow, CompetitiveContextRow, DigitalPresenceRow } from '../types';

// PRD weights
export const WEIGHT_DEFICIT = 0.4;
export const WEIGHT_VIABILITY = 0.35;
export const WEIGHT_PRESSURE = 0.25;

const round2 = (n: number) => Math.round(n * 100) / 100;

// =py (date.today() - d).days / 365.25 — whole calendar days, so the >2y and >=3y thresholds
// land on the same side of the line they do in Python.
function yearsSince(dateText: string): number {
  const then = Date.parse(`${dateText.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return 0;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (today - then) / 86_400_000 / 365.25;
}

export type DeficitPresence = Pick<
  DigitalPresenceRow,
  | 'has_website'
  | 'website_quality_score'
  | 'has_ssl'
  | 'has_google_business_profile'
  | 'gbp_completeness_score'
  | 'google_review_count'
  | 'has_facebook_page'
  | 'has_instagram'
  | 'fb_last_post_days_ago'
  | 'has_google_ads'
  | 'has_meta_ads'
>;

// =py compute_digital_deficit — higher score = greater deficit = more likely to need services
export function computeDigitalDeficit(dp: DeficitPresence): number {
  let score = 0;

  // No website: +30
  if (!dp.has_website) score += 30;
  // Website exists but poor quality (< 40): +20
  else if (dp.website_quality_score !== null && dp.website_quality_score < 40) score += 20;

  // No SSL: +8
  if (dp.has_ssl !== null && !dp.has_ssl) score += 8;

  // No Google Business Profile: +15
  if (!dp.has_google_business_profile) score += 15;
  // GBP incomplete (< 0.5): +10
  else if (dp.gbp_completeness_score !== null && dp.gbp_completeness_score < 0.5) score += 10;

  // Zero Google reviews: +10
  if (dp.google_review_count !== null && dp.google_review_count === 0) score += 10;
  // Low review count (< 10): +5
  else if (dp.google_review_count !== null && dp.google_review_count < 10) score += 5;

  // No social media presence: +12
  if (!dp.has_facebook_page && !dp.has_instagram) score += 12;

  // Dormant social media (fb_last_post > 90 days): +8
  if (dp.fb_last_post_days_ago !== null && dp.fb_last_post_days_ago > 90) score += 8;

  // Not running any paid ads: +7
  if (!dp.has_google_ads && !dp.has_meta_ads) score += 7;

  return Math.min(score, 100);
}

export type ViabilityBusiness = Pick<
  BusinessRow,
  'incorporation_date' | 'license_status' | 'total_customer_ugc' | 'nextdoor_recommendations' | 'thumbtack_hires' | 'employee_count_est'
>;
export type ViabilityPresence = Pick<DigitalPresenceRow, 'google_review_count' | 'google_avg_rating' | 'review_velocity_30d'>;

// =py compute_viability — is the business operational, stable, and able to pay
export function computeViability(business: ViabilityBusiness, dp: ViabilityPresence | null = null): number {
  let score = 0;

  // In operation 3+ years: +20
  if (business.incorporation_date) {
    const years = yearsSince(business.incorporation_date);
    if (years >= 3) score += 20;
    // Additional: 7+ years: +10
    if (years >= 7) score += 10;
  }

  // Moderate review volume (10-50): +15
  const reviewCount = dp ? dp.google_review_count : 0;
  if (reviewCount && reviewCount >= 10 && reviewCount <= 50) score += 15;
  // High review volume (50+): +20
  else if (reviewCount && reviewCount > 50) score += 20;

  // Rating above 4.0: +15
  const rating = dp ? dp.google_avg_rating : null;
  if (rating !== null && rating >= 4.0) score += 15;
  // Rating 3.5-4.0: +8
  else if (rating !== null && rating >= 3.5) score += 8;

  // Positive review trajectory: +8
  const velocity = dp ? dp.review_velocity_30d : null;
  if (velocity !== null && velocity > 0) score += 8;

  // Customer UGC: moderate (10-50 tags): +10
  const ugc = business.total_customer_ugc ?? 0;
  if (ugc >= 10 && ugc <= 50) score += 10;
  // Customer UGC: high (50+ tags): +15
  else if (ugc > 50) score += 15;

  // Active license: +5
  if (business.license_status === 'active') score += 5;

  // Nextdoor recommendations > 5: +5
  if (business.nextdoor_recommendations && business.nextdoor_recommendations > 5) score += 5;

  // Thumbtack hires > 10: +5
  if (business.thumbtack_hires && business.thumbtack_hires > 10) score += 5;

  // Multiple employees estimated: +3
  if (business.employee_count_est && business.employee_count_est >= 3) score += 3;

  return Math.min(score, 100);
}

export type PressurePresence = Pick<DigitalPresenceRow, 'google_review_count' | 'google_avg_rating'>;
export type PressureContext = Pick<
  CompetitiveContextRow,
  'competitor_count' | 'avg_digital_score' | 'competitor_ads_active_count' | 'avg_rating' | 'median_household_income' | 'population_density'
>;

// =py compute_competitive_pressure — higher score = more competitive = more urgency to act.
// Python's signature also takes the business; its body never reads it, so the parameter is dropped here.
export function computeCompetitivePressure(dp: PressurePresence | null, context: PressureContext | null): number {
  if (context === null) return 0;

  let score = 0;

  // High competitor density (>5): +20
  if (context.competitor_count > 5) score += 20;
  // Very high density (>10): additional +10
  if (context.competitor_count > 10) score += 10;

  // Competitors have stronger digital presence: +25
  if (dp && context.avg_digital_score !== null) {
    // Python compares a review count against an average digital score. Its own comment calls the
    // count a "proxy for digital strength"; the units do not match, and nothing has ever run this.
    const businessDeficit = dp.google_review_count || 0;
    if (businessDeficit < context.avg_digital_score) score += 25;
  }

  // Competitors running paid ads (>=2): +15
  if (context.competitor_ads_active_count >= 2) score += 15;

  // High-income zip code (>$65,000): +10
  if (context.median_household_income && context.median_household_income > 65000) score += 10;

  // High population density (>10,000/sq mi): +10
  if (context.population_density && context.population_density > 10000) score += 10;

  // Competitor avg rating higher: +10
  if (dp && dp.google_avg_rating && context.avg_rating && dp.google_avg_rating < context.avg_rating) score += 10;

  return Math.min(score, 100);
}

export type CompositeBusiness = ViabilityBusiness & Pick<BusinessRow, 'estimated_monthly_revenue'>;
export type CompositePresence = DeficitPresence & ViabilityPresence & PressurePresence;

export interface CompositeScores {
  digital_deficit_score: number;
  viability_score: number;
  competitive_pressure_score: number;
  composite_acquisition_score: number;
  price_tier: number;
}

// =py compute_composite_score — only the composite is rounded, as in Python
export function computeCompositeScore(
  business: CompositeBusiness,
  dp: CompositePresence | null,
  context: PressureContext | null,
): CompositeScores {
  const deficit = dp ? computeDigitalDeficit(dp) : 0;
  const viability = computeViability(business, dp);
  const pressure = computeCompetitivePressure(dp, context);

  const composite = Math.min(deficit * WEIGHT_DEFICIT + viability * WEIGHT_VIABILITY + pressure * WEIGHT_PRESSURE, 100);

  return {
    digital_deficit_score: deficit,
    viability_score: viability,
    competitive_pressure_score: pressure,
    composite_acquisition_score: round2(composite),
    price_tier: computePriceTier(business, pressure),
  };
}

// =py compute_price_tier — PRD Section 3.3.
// Tier 1: $150-$500 (small, low competition); Tier 2: $400-$1,200; Tier 3: $900-$2,500 (larger, high competition)
export function computePriceTier(
  business: Pick<BusinessRow, 'estimated_monthly_revenue' | 'employee_count_est'>,
  competitivePressure: number,
): number {
  const revenue = business.estimated_monthly_revenue;
  const employees = business.employee_count_est ?? 0;

  // Tier 3: est_revenue > $50K OR competitive_pressure > 65 OR employees > 8
  if ((revenue && revenue > 50000) || competitivePressure > 65 || employees > 8) return 3;

  // Tier 1: est_revenue < $15K OR employees < 3 OR competitive_pressure < 30
  if ((revenue !== null && revenue < 15000) || employees < 3 || competitivePressure < 30) return 1;

  return 2;
}

export interface CorridorInfo {
  corridor_name: string;
  corridor_type: 'eligible' | 'priority';
  is_priority: boolean;
}

export interface NofInputs {
  license_status?: string | null;
  incorporation_date?: string | null;
  digital_deficit_score?: number;
  estimated_monthly_revenue?: number | null;
  employee_count_est?: number | null;
  google_review_count?: number | null;
  total_customer_ugc?: number | null;
}

// =py compute_nof_eligibility — higher score = more eligible for NOF grant funding.
// Hard gates: not on a corridor, mobile-only business, revoked licence.
export function computeNofEligibility(
  corridorInfo: CorridorInfo | null,
  niche: string,
  inputs: NofInputs = {},
): number {
  // Hard gate: Not on any corridor
  if (corridorInfo === null) {
    console.log('nof_eligibility_hard_gate', { reason: 'not_on_corridor', niche });
    return 0;
  }

  // Hard gate: Mobile-only businesses ineligible
  if (niche === 'mobile_mechanics') {
    console.log('nof_eligibility_hard_gate', { reason: 'mobile_only_business', niche });
    return 0;
  }

  // Hard gate: Revoked license
  if (inputs.license_status === 'revoked') {
    console.log('nof_eligibility_hard_gate', { reason: 'revoked_license', niche });
    return 0;
  }

  let score = 0;

  // Corridor scoring
  score += corridorInfo.is_priority ? 30 : 20;

  // Eligible business type (every niche except mobile_mechanics, already gated)
  score += 15;

  // Incorporation age >2 years
  if (inputs.incorporation_date != null && yearsSince(inputs.incorporation_date) > 2) score += 10;

  // Active license
  if (inputs.license_status === 'active') score += 5;

  // High digital deficit (proxy for property improvement need)
  if ((inputs.digital_deficit_score ?? 0) > 60) score += 15;

  // Revenue >$5K/mo
  if (inputs.estimated_monthly_revenue != null && inputs.estimated_monthly_revenue > 5000) score += 8;

  // Employee count >2
  if (inputs.employee_count_est != null && inputs.employee_count_est > 2) score += 7;

  // Google reviews >10
  if (inputs.google_review_count != null && inputs.google_review_count > 10) score += 5;

  // Active social/UGC presence
  if (inputs.total_customer_ugc != null && inputs.total_customer_ugc > 10) score += 5;

  return Math.min(score, 100);
}

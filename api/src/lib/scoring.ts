import { DigitalPresence } from '../types';

export interface ScoreInput {
  digitalPresence: DigitalPresence | null;
  competitiveAvgRating: number | null;
  competitiveReviewCount: number | null;
  businessDensity: number | null;
}

const WEIGHTS = {
  deficit: 0.40,
  viability: 0.35,
  competitive: 0.25,
} as const;

/**
 * Calculate digital deficit score (0-100).
 * Measures how much digital presence a business lacks.
 * Higher score = more deficit = better lead.
 */
function calcDigitalDeficitScore(dp: DigitalPresence | null): number {
  if (!dp) return 50; // No data = moderate deficit

  let score = 0;
  const maxScore = 100;

  // No website: +40 points deficit
  if (!dp.has_website) score += 40;

  // Low Google reviews: -20 if < 10 reviews
  if (dp.google_review_count !== null && dp.google_review_count < 10) score += 20;

  // No Google rating: -15
  if (
    dp.google_avg_rating === null ||
    dp.google_avg_rating === 0
  )
    score += 15;

  // Low website quality: -15
  if (dp.website_quality_score !== null && dp.website_quality_score < 3) score += 15;

  // No social media: -10
  if (!dp.facebook_url && !dp.instagram_url) score += 10;

  return Math.min(score, maxScore);
}

/**
 * Calculate viability score (0-100).
 * Measures how established and viable the business is.
 * Higher score = more viable = better lead.
 */
function calcViabilityScore(dp: DigitalPresence | null): number {
  if (!dp) return 30; // No data = low viability assumption

  let score = 0;
  const maxScore = 100;

  // Has website: +20
  if (dp.has_website) score += 20;

  // Google rating > 4: +20
  if (dp.google_avg_rating !== null && dp.google_avg_rating >= 4) score += 20;

  // Google rating > 3: +10 (cumulative)
  if (dp.google_avg_rating !== null && dp.google_avg_rating >= 3) score += 10;

  // High review count
  if (dp.google_review_count !== null) {
    if (dp.google_review_count >= 50) score += 20;
    else if (dp.google_review_count >= 10) score += 10;
  }

  // Social media presence
  if (dp.facebook_url || dp.instagram_url) score += 15;

  // Yelp presence
  if (dp.yelp_review_count !== null && dp.yelp_review_count > 0) score += 15;

  return Math.min(score, maxScore);
}

/**
 * Calculate competitive pressure score (0-100).
 * Measures how competitive the market is.
 * Higher score = more competition = better for outreach (they need help).
 */
function calcCompetitivePressureScore(
  avgRating: number | null,
  reviewCount: number | null,
  density: number | null
): number {
  let score = 0;
  const maxScore = 100;

  // High average rating in niche: competitors are doing well = pressure
  if (avgRating !== null && avgRating >= 4.5) score += 30;
  else if (avgRating !== null && avgRating >= 4.0) score += 20;
  else if (avgRating !== null && avgRating >= 3.5) score += 10;

  // Many reviews in market = competition is active
  if (reviewCount !== null && reviewCount >= 1000) score += 35;
  else if (reviewCount !== null && reviewCount >= 500) score += 25;
  else if (reviewCount !== null && reviewCount >= 100) score += 15;

  // High business density = saturated market
  if (density !== null && density >= 50) score += 35;
  else if (density !== null && density >= 20) score += 25;
  else if (density !== null && density >= 10) score += 15;

  return Math.min(score, maxScore);
}

/**
 * Calculate price tier (1-4) from composite score.
 * Tier 1: Premium (highest composite)
 * Tier 4: Economy (lowest composite)
 */
function calcPriceTier(compositeScore: number): number {
  if (compositeScore >= 75) return 1;
  if (compositeScore >= 55) return 2;
  if (compositeScore >= 35) return 3;
  return 4;
}

/**
 * Calculate the full scoring profile for a business.
 * Returns composite scores (0-100) and price tier.
 */
export function calculateScores(input: ScoreInput): {
  digital_deficit_score: number;
  viability_score: number;
  competitive_pressure_score: number;
  composite_acquisition_score: number;
  price_tier: number;
} {
  const deficit = calcDigitalDeficitScore(input.digitalPresence);
  const viability = calcViabilityScore(input.digitalPresence);
  const competitive = calcCompetitivePressureScore(
    input.competitiveAvgRating,
    input.competitiveReviewCount,
    input.businessDensity
  );

  const composite = Math.round(
    deficit * WEIGHTS.deficit +
    viability * WEIGHTS.viability +
    competitive * WEIGHTS.competitive
  );

  const tier = calcPriceTier(composite);

  return {
    digital_deficit_score: Math.round(deficit),
    viability_score: Math.round(viability),
    competitive_pressure_score: Math.round(competitive),
    composite_acquisition_score: composite,
    price_tier: tier,
  };
}

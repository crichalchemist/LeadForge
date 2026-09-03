// Differential test against the Python scoring package. The vectors in fixtures/scoring-vectors.json
// were produced by running the real functions in src/leadforge/scoring/ over 150 random inputs
// (generator: scratchpad/gen_scoring_vectors.py, seed 20260903). Python's own unit tests assert
// mostly with >=, which would pass for a drifted formula; these pin every branch exactly.
//
// Dates travel as day offsets, not absolute dates, so the fixture does not rot.
import { describe, expect, it } from 'vitest';
import {
  computeCompetitivePressure,
  computeCompositeScore,
  computeDigitalDeficit,
  computeNofEligibility,
  computeViability,
  type CompositeBusiness,
  type CompositePresence,
  type CorridorInfo,
  type PressureContext,
} from '../src/lib/scoring';
import vectors from './fixtures/scoring-vectors.json';

interface Vector {
  dp: Record<string, number | null> | null;
  business: Record<string, number | string | null>;
  context: Record<string, number | null> | null;
  corridor: 'priority' | 'eligible' | null;
  niche: string;
  expected: {
    digital_deficit_score: number;
    viability_score: number;
    competitive_pressure_score: number;
    composite_acquisition_score: number;
    price_tier: number;
    nof_eligibility_score: number;
    deficit_alone: number | null;
    viability_alone: number;
    pressure_alone: number;
  };
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe('parity with the Python scoring package', () => {
  const cases = vectors as unknown as Vector[];

  it('covers every scorer across 150 generated inputs', () => {
    expect(cases.length).toBe(150);
  });

  cases.forEach((vector, index) => {
    it(`case ${index} matches Python`, () => {
      const offset = vector.business.incorporation_days_ago as number | null;
      const business = {
        ...vector.business,
        incorporation_date: offset === null ? null : isoDaysAgo(offset),
      } as unknown as CompositeBusiness;
      const dp = vector.dp as unknown as CompositePresence | null;
      const context = vector.context as unknown as PressureContext | null;

      const result = computeCompositeScore(business, dp, context);
      expect(result.digital_deficit_score).toBeCloseTo(vector.expected.digital_deficit_score, 10);
      expect(result.viability_score).toBeCloseTo(vector.expected.viability_score, 10);
      expect(result.competitive_pressure_score).toBeCloseTo(vector.expected.competitive_pressure_score, 10);
      expect(result.composite_acquisition_score).toBeCloseTo(vector.expected.composite_acquisition_score, 10);
      expect(result.price_tier).toBe(vector.expected.price_tier);

      if (dp) expect(computeDigitalDeficit(dp)).toBeCloseTo(vector.expected.deficit_alone as number, 10);
      expect(computeViability(business, dp)).toBeCloseTo(vector.expected.viability_alone, 10);
      expect(computeCompetitivePressure(dp, context)).toBeCloseTo(vector.expected.pressure_alone, 10);

      const corridor: CorridorInfo | null = vector.corridor
        ? { corridor_name: 'X', corridor_type: vector.corridor, is_priority: vector.corridor === 'priority' }
        : null;
      const nof = computeNofEligibility(corridor, vector.niche, {
        license_status: vector.business.license_status as string | null,
        incorporation_date: business.incorporation_date,
        digital_deficit_score: result.digital_deficit_score,
        estimated_monthly_revenue: vector.business.estimated_monthly_revenue as number | null,
        employee_count_est: vector.business.employee_count_est as number | null,
        google_review_count: (vector.dp?.google_review_count ?? null) as number | null,
        total_customer_ugc: vector.business.total_customer_ugc as number | null,
      });
      expect(nof).toBeCloseTo(vector.expected.nof_eligibility_score, 10);
    });
  });
});

// Mirrors tests/unit/test_sentiment_feedback.py
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { applySentimentFeedback, computeMultiplier } from '../src/lib/sentiment-feedback';
import { createBusiness, createScore, resetDb } from './helpers';

const answered = (score: number | null, attempts = 1) => ({ call_sentiment_score: score, call_disposition: 'answered', call_attempts: attempts });
const unanswered = (disposition: string, attempts: number, score: number | null = null) => ({ call_sentiment_score: score, call_disposition: disposition, call_attempts: attempts });

describe('TestComputeMultiplier', () => {
  it('test_positive_sentiment', () => expect(computeMultiplier(answered(0.7))).toBe(1.15));
  it('test_negative_sentiment', () => expect(computeMultiplier(answered(-0.5))).toBe(0.75));
  it('test_neutral_sentiment', () => expect(computeMultiplier(answered(0.1))).toBeNull());
  it('test_no_answer_two_attempts', () => expect(computeMultiplier(unanswered('no_answer', 2))).toBe(0.9));
  it('test_voicemail_two_attempts', () => expect(computeMultiplier(unanswered('voicemail', 3))).toBe(0.9));
  it('test_no_answer_one_attempt_no_multiplier', () => expect(computeMultiplier(unanswered('no_answer', 1))).toBeNull());
  it('test_no_sentiment_score', () => expect(computeMultiplier(answered(null))).toBeNull());
  it('test_boundary_positive', () => expect(computeMultiplier(answered(0.3))).toBeNull());
  it('test_boundary_negative', () => expect(computeMultiplier(answered(-0.3))).toBeNull());
  it('test_no_answer_overrides_positive_sentiment', () => expect(computeMultiplier(unanswered('no_answer', 2, 0.8))).toBe(0.9));
});

async function scoreRow(id: string) {
  return env.DB.prepare('SELECT composite_acquisition_score, sentiment_adjustment FROM lead_scores WHERE id = ?').bind(id).first<any>();
}

describe('TestApplySentimentFeedback', () => {
  beforeEach(resetDb);

  it('test_applies_positive_multiplier', async () => {
    const businessId = await createBusiness();
    const scoreId = await createScore(businessId, { composite_acquisition_score: 50.0 });
    expect(await applySentimentFeedback(env.DB, { business_id: businessId, ...answered(0.7) })).toBe(1.15);
    const row = await scoreRow(scoreId);
    expect(row.composite_acquisition_score).toBeCloseTo(57.5);
    expect(row.sentiment_adjustment).toBe(1.15);
  });

  it('test_caps_at_100', async () => {
    const businessId = await createBusiness();
    const scoreId = await createScore(businessId, { composite_acquisition_score: 95.0 });
    expect(await applySentimentFeedback(env.DB, { business_id: businessId, ...answered(0.8) })).toBe(1.15);
    expect((await scoreRow(scoreId)).composite_acquisition_score).toBe(100.0);
  });

  it('test_idempotent_skips_already_applied', async () => {
    const businessId = await createBusiness();
    const scoreId = await createScore(businessId, { composite_acquisition_score: 57.5 });
    await env.DB.prepare('UPDATE lead_scores SET sentiment_adjustment = 1.15 WHERE id = ?').bind(scoreId).run();
    expect(await applySentimentFeedback(env.DB, { business_id: businessId, ...answered(0.7) })).toBeNull();
    expect((await scoreRow(scoreId)).composite_acquisition_score).toBe(57.5);
  });

  it('test_no_lead_score_returns_none', async () => {
    const businessId = await createBusiness();
    expect(await applySentimentFeedback(env.DB, { business_id: businessId, ...answered(0.7) })).toBeNull();
  });

  it('a latest score with no composite is left alone', async () => {
    const businessId = await createBusiness();
    const scoreId = await createScore(businessId, { composite_acquisition_score: null });
    expect(await applySentimentFeedback(env.DB, { business_id: businessId, ...answered(0.7) })).toBeNull();
    expect((await scoreRow(scoreId)).sentiment_adjustment).toBeNull();
  });

  it('adjusts only the latest score version', async () => {
    const businessId = await createBusiness();
    const v1 = await createScore(businessId, { score_version: 1, composite_acquisition_score: 40.0 });
    const v2 = await createScore(businessId, { score_version: 2, composite_acquisition_score: 50.0 });
    expect(await applySentimentFeedback(env.DB, { business_id: businessId, ...unanswered('voicemail', 2) })).toBe(0.9);
    expect((await scoreRow(v2)).composite_acquisition_score).toBeCloseTo(45.0);
    expect((await scoreRow(v1)).composite_acquisition_score).toBe(40.0);
    expect((await scoreRow(v1)).sentiment_adjustment).toBeNull();
  });
});

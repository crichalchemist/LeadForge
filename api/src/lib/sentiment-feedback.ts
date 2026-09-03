// =py pipeline/sentiment_feedback
import { nowIso } from '../db/serialize';
import type { LeadScoreRow, OutreachRecordRow } from '../types';

export type FeedbackOutreach = Pick<OutreachRecordRow, 'business_id' | 'call_sentiment_score' | 'call_disposition' | 'call_attempts'>;

// =py _compute_multiplier — PRD: positive (>0.3) x1.15, negative (<-0.3) x0.75, no answer after 2+ attempts x0.90
export function computeMultiplier(outreach: Omit<FeedbackOutreach, 'business_id'>): number | null {
  const unanswered = outreach.call_disposition === 'no_answer' || outreach.call_disposition === 'voicemail';
  if (unanswered && outreach.call_attempts >= 2) return 0.9;
  const sentiment = outreach.call_sentiment_score;
  if (sentiment === null) return null;
  if (sentiment > 0.3) return 1.15;
  if (sentiment < -0.3) return 0.75;
  return null;
}

// =py apply_sentiment_feedback — scales the latest lead score once per business (ADR 014); returns the multiplier applied
export async function applySentimentFeedback(db: D1Database, outreach: FeedbackOutreach): Promise<number | null> {
  const score = await db.prepare(
    'SELECT id, composite_acquisition_score, sentiment_adjustment FROM lead_scores WHERE business_id = ? ORDER BY score_version DESC LIMIT 1',
  ).bind(outreach.business_id).first<Pick<LeadScoreRow, 'id' | 'composite_acquisition_score' | 'sentiment_adjustment'>>();
  if (!score || score.composite_acquisition_score === null) {
    console.warn('no_lead_score_for_feedback', { business_id: outreach.business_id });
    return null;
  }
  if (score.sentiment_adjustment !== null) {
    console.log('sentiment_feedback_already_applied', { business_id: outreach.business_id });
    return null;
  }
  const multiplier = computeMultiplier(outreach);
  if (multiplier === null) return null;

  const newScore = Math.min(score.composite_acquisition_score * multiplier, 100.0);
  // Tighter than Python: Queues deliver at least once, so the write itself re-checks the guard
  // to keep a concurrent redelivery from compounding the multiplier.
  const res = await db.prepare(
    'UPDATE lead_scores SET composite_acquisition_score = ?, sentiment_adjustment = ?, updated_at = ? WHERE id = ? AND sentiment_adjustment IS NULL',
  ).bind(newScore, multiplier, nowIso(), score.id).run();
  if (!res.meta.changes) {
    console.log('sentiment_feedback_already_applied', { business_id: outreach.business_id });
    return null;
  }
  console.log('sentiment_feedback_applied', {
    business_id: outreach.business_id, old_score: score.composite_acquisition_score, new_score: newScore, multiplier,
  });
  return multiplier;
}

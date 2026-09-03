// =py tasks/sentiment_tasks
import { nowIso } from '../db/serialize';
import { qualityClient, type LlmClient } from '../lib/llm/client';
import { analyzeSentiment } from '../lib/llm/sentiment';
import { applySentimentFeedback, type FeedbackOutreach } from '../lib/sentiment-feedback';
import type { Bindings, OutreachRecordRow } from '../types';

/** Body of a SENTIMENT_QUEUE message; produced by routes/webhooks.ts after a call_ended with a transcript. */
export interface SentimentMessage { outreach_id: string }

type Row = FeedbackOutreach & Pick<OutreachRecordRow, 'id' | 'call_transcript'>;

// =py process_sentiment_task — analyze the transcript, then apply the score feedback (ADR 014).
// Python commits both writes together; here the sentiment score lands first, and a retry after a
// feedback failure recomputes it, which is harmless because the feedback step is idempotent.
export async function processSentiment(env: Bindings, outreachId: string, client: LlmClient = qualityClient(env.AI)): Promise<void> {
  const db = env.DB;
  const outreach = await db.prepare(
    'SELECT id, business_id, call_transcript, call_sentiment_score, call_disposition, call_attempts FROM outreach_records WHERE id = ?',
  ).bind(outreachId).first<Row>();
  if (!outreach) {
    console.warn('outreach_not_found', { outreach_id: outreachId });
    return;
  }

  if (outreach.call_transcript) {
    const result = await analyzeSentiment(outreach.call_transcript, client);
    outreach.call_sentiment_score = result.sentiment_score;
    await db.prepare('UPDATE outreach_records SET call_sentiment_score = ?, updated_at = ? WHERE id = ?')
      .bind(outreach.call_sentiment_score, nowIso(), outreach.id).run();
  }

  const multiplier = await applySentimentFeedback(db, outreach);
  console.log('sentiment_processed', { outreach_id: outreachId, sentiment: outreach.call_sentiment_score, multiplier });
}

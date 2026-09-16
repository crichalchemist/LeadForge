import { Hono } from 'hono';
import { nowIso } from '../db/serialize';
import type { AppEnv, OutreachRecordRow } from '../types';

const router = new Hono<AppEnv>();
const encoder = new TextEncoder();

// =py voice/retell_client.verify_retell_signature — HMAC-SHA256 hex over the raw body, keyed by the API key
async function verifySignature(rawBody: string, signature: string, apiKey: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

type Patch = Partial<Pick<OutreachRecordRow, 'call_transcript' | 'call_disposition' | 'status' | 'call_sentiment_score'>>;

// =py voice/webhook_handler._handle_call_ended
function handleCallEnded(call: Record<string, unknown>): Patch {
  const patch: Patch = {};
  const transcript = typeof call.transcript === 'string' ? call.transcript : '';
  if (transcript) patch.call_transcript = transcript;
  const reason = typeof call.disconnection_reason === 'string' ? call.disconnection_reason : '';
  if (reason === 'voicemail_reached') {
    patch.call_disposition = 'voicemail';
    patch.status = 'voicemail';
  } else if (['dial_failed', 'no_answer', 'busy'].includes(reason)) {
    patch.call_disposition = 'no_answer';
  } else if (transcript) {
    patch.call_disposition = 'answered';
    patch.status = 'contacted';
  }
  return patch;
}

// =py voice/webhook_handler._handle_call_analyzed
function handleCallAnalyzed(call: Record<string, unknown>): Patch {
  const analysis = (call.call_analysis ?? null) as Record<string, unknown> | null;
  if (!analysis) return {};
  const patch: Patch = {};
  if (analysis.call_successful === true) patch.status = 'engaged';
  const sentiment = analysis.customer_sentiment;
  if (typeof sentiment === 'string') {
    const map: Record<string, number> = { Negative: -0.7, Neutral: 0.0, Positive: 0.7 };
    patch.call_sentiment_score = map[sentiment] ?? 0.0;
  }
  return patch;
}

// =py voice/webhook_handler.handle_call_complete
router.post('/call-complete', async (c) => {
  const rawBody = await c.req.text();
  const apiKey = c.env.RETELL_API_KEY;
  const signature = c.req.header('x-retell-signature') ?? '';
  if (apiKey && signature && !(await verifySignature(rawBody, signature, apiKey))) {
    return c.json({ detail: 'Invalid webhook signature' }, 401);
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); } catch { return c.json({ detail: 'Invalid JSON' }, 400); }
  const event = typeof body.event === 'string' ? body.event : '';
  const call = (typeof body.call === 'object' && body.call !== null ? body.call : body) as Record<string, unknown>;
  const callId = typeof call.call_id === 'string' ? call.call_id : '';
  if (!callId) return c.json({ detail: 'Missing call_id' }, 400);

  const db = c.env.DB;
  const outreach = await db.prepare('SELECT id, call_transcript FROM outreach_records WHERE retell_call_id = ?').bind(callId)
    .first<Pick<OutreachRecordRow, 'id' | 'call_transcript'>>();
  if (!outreach) {
    console.warn('webhook_unknown_call', { call_id: callId, event });
    return c.json({ status: 'ignored', reason: 'unknown call_id' });
  }

  let patch: Patch;
  if (event === 'call_ended') patch = handleCallEnded(call);
  else if (event === 'call_analyzed') patch = handleCallAnalyzed(call);
  else patch = { ...handleCallEnded(call), ...('call_analysis' in call ? handleCallAnalyzed(call) : {}) };

  // Keys come only from the Patch type assigned in handleCallEnded/handleCallAnalyzed, never from the request body.
  const sets = Object.keys(patch).map((k) => `${k} = ?`);
  if (sets.length) {
    await db.prepare(`UPDATE outreach_records SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...Object.values(patch), nowIso(), outreach.id).run();
  }
  console.log('webhook_processed', { call_id: callId, event, disposition: patch.call_disposition ?? null });

  // ~ replaces Celery process_sentiment_task.delay(outreach_id)
  if (patch.call_transcript ?? outreach.call_transcript) {
    await c.env.SENTIMENT_QUEUE.send({ outreach_id: outreach.id });
  }
  return c.json({ status: 'ok', call_id: callId });
});

// =py voice/webhook_handler.handle_call_event
router.post('/call-event', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const call = (typeof body.call === 'object' && body.call !== null ? body.call : body) as Record<string, unknown>;
  console.log('retell_event', { event_type: body.event ?? null, call_id: call.call_id ?? null });
  return c.json({ status: 'ok' });
});

export default router;

// =py tasks/sentiment_tasks.process_sentiment_task and the Worker's queue() export
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index';
import { processSentiment } from '../src/tasks/sentiment';
import type { LlmClient } from '../src/lib/llm/client';
import type { Bindings } from '../src/types';
import { createBusiness, createOutreach, createScore, resetDb } from './helpers';

function fakeClient(reply: string | null): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, async complete(prompt) { prompts.push(prompt); return reply; } };
}

const positive = JSON.stringify({
  sentiment_score: 0.7, sentiment_label: 'interested', objections: [], interest_signals: ['asked for pricing'],
  purchase_intent: 'medium', recommended_action: 'scheduled', summary: 'Owner wants a follow-up.',
});
const transcript = 'Agent: Hi, calling about marketing services. Owner: Sounds interesting, send me pricing.';

async function outreachRow(id: string) {
  return env.DB.prepare('SELECT call_sentiment_score FROM outreach_records WHERE id = ?').bind(id).first<any>();
}
async function scoreRow(businessId: string) {
  return env.DB.prepare('SELECT composite_acquisition_score, sentiment_adjustment FROM lead_scores WHERE business_id = ?').bind(businessId).first<any>();
}
async function setCall(id: string, patch: { transcript?: string; disposition: string; attempts: number }) {
  await env.DB.prepare('UPDATE outreach_records SET call_transcript = ?, call_disposition = ?, call_attempts = ? WHERE id = ?')
    .bind(patch.transcript ?? null, patch.disposition, patch.attempts, id).run();
}

describe('processSentiment', () => {
  beforeEach(resetDb);

  it('scores the transcript and applies the multiplier to the latest lead score', async () => {
    const businessId = await createBusiness();
    await createScore(businessId, { composite_acquisition_score: 50.0 });
    const id = await createOutreach(businessId, { status: 'contacted' });
    await setCall(id, { transcript, disposition: 'answered', attempts: 1 });
    const client = fakeClient(positive);

    await processSentiment(env, id, client);

    expect(client.prompts).toHaveLength(1);
    expect(client.prompts[0]).toContain('send me pricing');
    expect((await outreachRow(id)).call_sentiment_score).toBe(0.7);
    const score = await scoreRow(businessId);
    expect(score.composite_acquisition_score).toBeCloseTo(57.5);
    expect(score.sentiment_adjustment).toBe(1.15);
  });

  it('skips the model without a transcript but still applies the no-answer multiplier', async () => {
    const businessId = await createBusiness();
    await createScore(businessId, { composite_acquisition_score: 50.0 });
    const id = await createOutreach(businessId, { status: 'voicemail' });
    await setCall(id, { disposition: 'no_answer', attempts: 2 });
    const client = fakeClient(positive);

    await processSentiment(env, id, client);

    expect(client.prompts).toHaveLength(0);
    expect((await outreachRow(id)).call_sentiment_score).toBeNull();
    const score = await scoreRow(businessId);
    expect(score.composite_acquisition_score).toBeCloseTo(45.0);
    expect(score.sentiment_adjustment).toBe(0.9);
  });

  it('records a neutral score and leaves the lead score alone when the model is unavailable', async () => {
    const businessId = await createBusiness();
    await createScore(businessId, { composite_acquisition_score: 50.0 });
    const id = await createOutreach(businessId, { status: 'contacted' });
    await setCall(id, { transcript, disposition: 'answered', attempts: 1 });

    await processSentiment(env, id, fakeClient(null));

    expect((await outreachRow(id)).call_sentiment_score).toBe(0);
    const score = await scoreRow(businessId);
    expect(score.composite_acquisition_score).toBe(50.0);
    expect(score.sentiment_adjustment).toBeNull();
  });

  it('a second run for the same call does not compound the adjustment', async () => {
    const businessId = await createBusiness();
    await createScore(businessId, { composite_acquisition_score: 50.0 });
    const id = await createOutreach(businessId, { status: 'contacted' });
    await setCall(id, { transcript, disposition: 'answered', attempts: 1 });

    await processSentiment(env, id, fakeClient(positive));
    await processSentiment(env, id, fakeClient(positive));

    const score = await scoreRow(businessId);
    expect(score.composite_acquisition_score).toBeCloseTo(57.5);
    expect(score.sentiment_adjustment).toBe(1.15);
  });

  it('an unknown outreach id is a no-op', async () => {
    const client = fakeClient(positive);
    await expect(processSentiment(env, crypto.randomUUID(), client)).resolves.toBeUndefined();
    expect(client.prompts).toHaveLength(0);
  });
});

type TestMessage = Message<unknown> & { acked: boolean; retried: boolean };
function message(body: unknown): TestMessage {
  const m = {
    id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body, acked: false, retried: false,
    ack() { m.acked = true; }, retry() { m.retried = true; },
  };
  return m;
}
function batch(queue: string, messages: TestMessage[]): MessageBatch<any> {
  return { queue, messages, metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, ackAll() {}, retryAll() {} };
}
const brokenDb = { ...env, DB: { prepare() { throw new Error('D1 unavailable'); } } } as unknown as Bindings;

describe('queue handler', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('processes a sentiment message through Workers AI and acks it', async () => {
    const businessId = await createBusiness();
    await createScore(businessId, { composite_acquisition_score: 50.0 });
    const id = await createOutreach(businessId, { status: 'contacted' });
    await setCall(id, { transcript, disposition: 'answered', attempts: 1 });
    const run = vi.spyOn(env.AI, 'run').mockResolvedValue({ response: positive } as any);

    const m = message({ outreach_id: id });
    await worker.queue!(batch('leadforge-sentiment', [m]), env);

    expect(run).toHaveBeenCalledTimes(1);
    expect(m.acked).toBe(true);
    expect(m.retried).toBe(false);
    expect((await scoreRow(businessId)).sentiment_adjustment).toBe(1.15);
  });

  it('retries a message whose processing throws', async () => {
    const m = message({ outreach_id: crypto.randomUUID() });
    await worker.queue!(batch('leadforge-sentiment', [m]), brokenDb);
    expect(m.retried).toBe(true);
    expect(m.acked).toBe(false);
  });

  it('acks a malformed message instead of retrying it forever', async () => {
    const m = message({ call_id: 'not-the-contract' });
    await worker.queue!(batch('leadforge-sentiment', [m]), brokenDb);
    expect(m.acked).toBe(true);
    expect(m.retried).toBe(false);
  });

  it('settles every message in a batch independently', async () => {
    const businessId = await createBusiness();
    await createScore(businessId, { composite_acquisition_score: 50.0 });
    const id = await createOutreach(businessId, { status: 'voicemail' });
    await setCall(id, { disposition: 'no_answer', attempts: 2 });
    const bad = message({});
    const good = message({ outreach_id: id });
    const missing = message({ outreach_id: crypto.randomUUID() });

    await worker.queue!(batch('leadforge-sentiment', [bad, good, missing]), env);

    expect([bad.acked, good.acked, missing.acked]).toEqual([true, true, true]);
    expect([bad.retried, good.retried, missing.retried]).toEqual([false, false, false]);
    expect((await scoreRow(businessId)).sentiment_adjustment).toBe(0.9);
  });

  it('rejects a batch from a queue with no consumer', async () => {
    await expect(worker.queue!(batch('leadforge-enrichment', [message({})]), env)).rejects.toThrow(/leadforge-enrichment/);
  });
});

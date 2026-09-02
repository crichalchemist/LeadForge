import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, createBusiness, createOutreach, resetDb } from './helpers';

const encoder = new TextEncoder();
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.RETELL_API_KEY!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const callEnded = {
  event: 'call_ended',
  call: { call_id: 'call_abc123', transcript: "Agent: Hello, I'm calling about marketing services. Owner: Sounds interesting.", disconnection_reason: 'agent_hangup', call_status: 'ended' },
};
const callAnalyzed = { event: 'call_analyzed', call: { call_id: 'call_abc123', call_analysis: { call_successful: true, customer_sentiment: 'Positive' } } };
const voicemail = { event: 'call_ended', call: { call_id: 'call_vm456', transcript: '', disconnection_reason: 'voicemail_reached', call_status: 'ended' } };

async function outreachRow(id: string) {
  return env.DB.prepare('SELECT status, call_disposition, call_transcript, call_sentiment_score FROM outreach_records WHERE id = ?').bind(id).first<any>();
}

let queued: unknown[];
beforeEach(async () => {
  await resetDb();
  queued = [];
  vi.spyOn(env.SENTIMENT_QUEUE, 'send').mockImplementation(async (msg: unknown) => { queued.push(msg); return {} as QueueSendResponse; });
});

describe('TestCallCompleteWebhook', () => {
  it('test_missing_call_id', async () => {
    const res = await api('POST', '/webhooks/retell/call-complete', { json: { event: 'call_ended', call: {} } });
    expect(res.status).toBe(400);
  });

  it('test_unknown_call_id', async () => {
    const res = await api('POST', '/webhooks/retell/call-complete', { json: callEnded });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ignored', reason: 'unknown call_id' });
  });

  it('test_call_ended_processing', async () => {
    const id = await createOutreach(await createBusiness(), { status: 'contacted', retell_call_id: 'call_abc123' });
    const res = await api('POST', '/webhooks/retell/call-complete', { json: callEnded });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', call_id: 'call_abc123' });
    const row = await outreachRow(id);
    expect(row.call_disposition).toBe('answered');
    expect(row.status).toBe('contacted');
    expect(row.call_transcript).toContain('Sounds interesting');
    expect(row.call_sentiment_score).toBeNull();
    expect(queued).toEqual([{ outreach_id: id }]);
  });

  it('test_call_analyzed_processing', async () => {
    const id = await createOutreach(await createBusiness(), { status: 'contacted', retell_call_id: 'call_abc123' });
    await env.DB.prepare("UPDATE outreach_records SET call_transcript = 'Some transcript from earlier call_ended', call_disposition = 'answered' WHERE id = ?").bind(id).run();
    const res = await api('POST', '/webhooks/retell/call-complete', { json: callAnalyzed });
    expect(res.status).toBe(200);
    const row = await outreachRow(id);
    expect(row.call_sentiment_score).toBe(0.7);
    expect(row.status).toBe('engaged');
    expect(queued).toEqual([{ outreach_id: id }]);
  });

  it('test_voicemail_processing', async () => {
    const id = await createOutreach(await createBusiness(), { status: 'contacted', retell_call_id: 'call_vm456' });
    const res = await api('POST', '/webhooks/retell/call-complete', { json: voicemail });
    expect(res.status).toBe(200);
    const row = await outreachRow(id);
    expect(row.call_disposition).toBe('voicemail');
    expect(row.status).toBe('voicemail');
    expect(queued).toEqual([]);
  });

  it('rejects a bad signature and accepts a good one', async () => {
    await createOutreach(await createBusiness(), { retell_call_id: 'call_abc123' });
    const body = JSON.stringify(callEnded);
    const bad = await api('POST', '/webhooks/retell/call-complete', { headers: { 'Content-Type': 'application/json', 'x-retell-signature': 'deadbeef' }, json: callEnded });
    expect(bad.status).toBe(401);
    const good = await api('POST', '/webhooks/retell/call-complete', { headers: { 'Content-Type': 'application/json', 'x-retell-signature': await sign(body) }, json: callEnded });
    expect(good.status).toBe(200);
  });
});

describe('TestCallEventWebhook', () => {
  it('test_call_event_returns_ok', async () => {
    const res = await api('POST', '/webhooks/retell/call-event', { json: { event: 'call_started', call: { call_id: 'c123' } } });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('ok');
  });
});

describe('TestHealthCheck', () => {
  it('test_health_endpoint', async () => {
    const res = await api('GET', '/health');
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('ok');
  });
});

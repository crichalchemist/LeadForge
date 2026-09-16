import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, resetDb, viewerUser } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestPipelineBoard', () => {
  it('test_empty_board', async () => {
    const res = await api('GET', '/pipeline/board', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.columns).toHaveLength(12);
    expect(data.columns[0]).toEqual({ stage: 'scored', count: 0, cards: [] });
  });

  it('test_board_with_data', async () => {
    const biz = await createBusiness();
    const outreachId = await createOutreach(biz);
    const data = await (await api('GET', '/pipeline/board', { token })).json() as any;
    const scored = data.columns.find((c: any) => c.stage === 'scored');
    expect(scored.count).toBe(1);
    expect(scored.cards).toHaveLength(1);
    expect(scored.cards[0]).toMatchObject({ outreach_id: outreachId, business_id: biz, business_name: 'Test Barbershop', zip_code: '60619', niche: 'barbershops', call_attempts: 0, last_contact: null });
  });

  it('caps preview cards at 10 but counts every record', async () => {
    const biz = await createBusiness();
    for (let i = 0; i < 12; i++) await createOutreach(biz);
    const data = await (await api('GET', '/pipeline/board', { token })).json() as any;
    const scored = data.columns.find((c: any) => c.stage === 'scored');
    expect(scored.count).toBe(12);
    expect(scored.cards).toHaveLength(10);
  });
});

describe('TestStageTransition', () => {
  it('test_valid_transition', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/pipeline/${id}/stage`, { token, json: { new_stage: 'queued' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', outreach_id: id, new_stage: 'queued' });
  });

  it('test_invalid_transition', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/pipeline/${id}/stage`, { token, json: { new_stage: 'won' } });
    expect(res.status).toBe(422);
    expect((await res.json() as any).detail).toContain('Cannot transition from scored to won');
  });

  it('test_invalid_stage_name', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/pipeline/${id}/stage`, { token, json: { new_stage: 'nonexistent' } });
    expect(res.status).toBe(400);
  });

  it('test_not_found', async () => {
    const res = await api('PATCH', `/pipeline/${crypto.randomUUID()}/stage`, { token, json: { new_stage: 'queued' } });
    expect(res.status).toBe(404);
  });

  it('rejects viewers', async () => {
    const id = await createOutreach(await createBusiness());
    const viewer = await accessToken(await viewerUser());
    expect((await api('PATCH', `/pipeline/${id}/stage`, { token: viewer, json: { new_stage: 'queued' } })).status).toBe(403);
  });
});

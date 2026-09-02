import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, resetDb, viewerUser } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestOutreachByBusiness', () => {
  it('test_empty_history', async () => {
    const biz = await createBusiness();
    const res = await api('GET', `/outreach/by-business/${biz}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
  });

  it('test_with_outreach', async () => {
    const biz = await createBusiness();
    await createOutreach(biz);
    const data = await (await api('GET', `/outreach/by-business/${biz}`, { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.items[0].status).toBe('scored');
    expect(data.items[0].meeting_scheduled).toBe(false);
  });
});

describe('TestGetOutreach', () => {
  it('test_get_detail', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('GET', `/outreach/${id}`, { token });
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('scored');
  });

  it('test_not_found', async () => {
    expect((await api('GET', `/outreach/${crypto.randomUUID()}`, { token })).status).toBe(404);
  });
});

describe('TestGetTranscript', () => {
  it('test_transcript', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('GET', `/outreach/${id}/transcript`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transcript: null, retell_call_id: null });
  });

  it('test_not_found', async () => {
    expect((await api('GET', `/outreach/${crypto.randomUUID()}/transcript`, { token })).status).toBe(404);
  });
});

describe('TestUpdateOutreach', () => {
  it('test_update_notes', async () => {
    const id = await createOutreach(await createBusiness());
    const res = await api('PATCH', `/outreach/${id}`, { token, json: { notes: 'Follow up next week', assigned_to: 'john@example.com' } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.notes).toBe('Follow up next week');
    expect(data.assigned_to).toBe('john@example.com');
  });

  it('rejects viewers', async () => {
    const id = await createOutreach(await createBusiness());
    const viewer = await accessToken(await viewerUser());
    const res = await api('PATCH', `/outreach/${id}`, { token: viewer, json: { notes: 'nope' } });
    expect(res.status).toBe(403);
  });
});

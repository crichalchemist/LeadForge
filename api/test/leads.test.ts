import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { accessToken, adminUser, api, createBusiness, createOutreach, createScore, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestRankedLeads', () => {
  it('test_ranked_empty', async () => {
    const res = await api('GET', '/leads/ranked', { token });
    expect(res.status).toBe(200);
    expect((await res.json() as any).total).toBe(0);
  });

  it('test_ranked_with_scores', async () => {
    const id = await createBusiness();
    await createScore(id);
    const data = await (await api('GET', '/leads/ranked', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.items[0].business_name).toBe('Test Barbershop');
    expect(data.items[0].composite_acquisition_score).toBeCloseTo(48.25);
    expect(data.items[0].pipeline_stage).toBeNull();
  });

  it('test_filter_by_min_score', async () => {
    const id = await createBusiness();
    await createScore(id);
    expect((await (await api('GET', '/leads/ranked?min_score=50', { token })).json() as any).total).toBe(0);
    expect((await (await api('GET', '/leads/ranked?min_score=40', { token })).json() as any).total).toBe(1);
  });

  it('test_filter_by_price_tier', async () => {
    const id = await createBusiness();
    await createScore(id);
    expect((await (await api('GET', '/leads/ranked?price_tier=2', { token })).json() as any).total).toBe(1);
    expect((await (await api('GET', '/leads/ranked?price_tier=1', { token })).json() as any).total).toBe(0);
  });

  it('ranks by the latest score version and reports the latest stage', async () => {
    const low = await createBusiness({ name: 'Low' });
    await createScore(low, { score_version: 1, composite_acquisition_score: 90 });
    await createScore(low, { score_version: 2, composite_acquisition_score: 10 });
    const high = await createBusiness({ name: 'High' });
    await createScore(high, { composite_acquisition_score: 50 });
    await createOutreach(high, { status: 'engaged' });
    const data = await (await api('GET', '/leads/ranked', { token })).json() as any;
    expect(data.items.map((i: any) => i.business_name)).toEqual(['High', 'Low']);
    expect(data.items[0].pipeline_stage).toBe('engaged');
  });

  it('pages through leads with equal composites without skipping or repeating any', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await createBusiness({ name: `Tied ${i}` });
      await createScore(id, { composite_acquisition_score: 50 });
      ids.push(id);
    }
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const data = (await (await api('GET', `/leads/ranked?page=${page}&page_size=2`, { token })).json()) as {
        items: { business_id: string }[];
      };
      seen.push(...data.items.map((i) => i.business_id));
    }
    expect(seen).toHaveLength(5);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('tells the list which scores are preliminary and which leads sit on an NOF corridor', async () => {
    const biz = await createBusiness({ name: 'Corridor' });
    await env.DB.prepare(
      "UPDATE businesses SET in_nof_corridor = 1, nof_corridor_name = 'Priority corridor 7', account_number = '478849', site_number = '1' WHERE id = ?"
    ).bind(biz).run();
    await createScore(biz, { score_version: 1, composite_acquisition_score: 64 });
    const data = (await (await api('GET', '/leads/ranked', { token })).json()) as { items: Record<string, unknown>[] };
    expect(data.items[0]).toMatchObject({
      score_version: 1, in_nof_corridor: true, nof_corridor_name: 'Priority corridor 7',
      account_number: '478849', site_number: '1',
    });
  });
});

describe('TestScoreHistory', () => {
  it('test_score_history', async () => {
    const id = await createBusiness();
    await createScore(id);
    const res = await api('GET', `/leads/${id}/score`, { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveLength(1);
    expect(data[0].score_version).toBe(1);
    expect(data[0].business_id).toBe(id);
  });

  it('test_no_scores', async () => {
    const id = await createBusiness();
    expect((await api('GET', `/leads/${id}/score`, { token })).status).toBe(404);
  });
});

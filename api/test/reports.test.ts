import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, createScore, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestFunnel', () => {
  it('test_empty_funnel', async () => {
    const res = await api('GET', '/reports/funnel', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.total).toBe(0);
    expect(data.stages).toHaveLength(12);
    expect(data.stages[0]).toEqual({ stage: 'scored', count: 0 });
  });

  it('test_funnel_with_data', async () => {
    await createOutreach(await createBusiness());
    const data = await (await api('GET', '/reports/funnel', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.stages.find((s: any) => s.stage === 'scored').count).toBe(1);
  });
});

describe('TestScoreDistribution', () => {
  it('test_empty_distribution', async () => {
    const res = await api('GET', '/reports/score-distribution', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.total).toBe(0);
    expect(data.mean).toBeNull();
    expect(data.buckets).toHaveLength(10);
  });

  it('test_with_scores', async () => {
    await createScore(await createBusiness());
    const data = await (await api('GET', '/reports/score-distribution', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.mean).toBe(48.25);
    expect(data.median).toBe(48.25);
    expect(data.buckets.find((b: any) => b.range_min === 40).count).toBe(1);
  });

  it('uses only the latest score version per business', async () => {
    const id = await createBusiness();
    await createScore(id, { score_version: 1, composite_acquisition_score: 10 });
    await createScore(id, { score_version: 2, composite_acquisition_score: 100 });
    const data = await (await api('GET', '/reports/score-distribution', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.buckets.find((b: any) => b.range_min === 90).count).toBe(1);
  });
});

describe('TestZipPerformance', () => {
  it('test_empty', async () => {
    const res = await api('GET', '/reports/zip-performance', { token });
    expect(res.status).toBe(200);
    expect((await res.json() as any).items).toEqual([]);
  });

  it('test_with_data', async () => {
    await createScore(await createBusiness());
    const data = await (await api('GET', '/reports/zip-performance', { token })).json() as any;
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ zip_code: '60619', total_leads: 1, avg_composite_score: 48.25, contacted_count: 0, engaged_count: 0, won_count: 0, conversion_rate: 0 });
  });

  it('counts contacted, engaged and won from the latest outreach status', async () => {
    const won = await createBusiness();
    await createOutreach(won, { status: 'queued' });
    await createOutreach(won, { status: 'won' });
    const contacted = await createBusiness({ name: 'B2' });
    await createOutreach(contacted, { status: 'voicemail' });
    await createBusiness({ name: 'B3' });
    const data = await (await api('GET', '/reports/zip-performance', { token })).json() as any;
    expect(data.items[0]).toMatchObject({ total_leads: 3, contacted_count: 2, engaged_count: 1, won_count: 1, conversion_rate: 33.3 });
  });
});

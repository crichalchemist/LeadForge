import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, createBusiness, createOutreach, createScore, resetDb } from './helpers';

let token: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); });

describe('TestListBusinesses', () => {
  it('test_list_empty', async () => {
    const res = await api('GET', '/businesses', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total: 0, items: [], page: 1, page_size: 20 });
  });

  it('test_list_returns_business', async () => {
    await createBusiness();
    const data = await (await api('GET', '/businesses', { token })).json() as any;
    expect(data.total).toBe(1);
    expect(data.items[0].name).toBe('Test Barbershop');
    expect(data.items[0].zip_code).toBe('60619');
    expect(data.items[0]).toMatchObject({ composite_acquisition_score: null, price_tier: null, pipeline_stage: null });
  });

  it('test_filter_by_zip', async () => {
    await createBusiness();
    expect((await (await api('GET', '/businesses?zip_code=99999', { token })).json() as any).total).toBe(0);
    expect((await (await api('GET', '/businesses?zip_code=60619', { token })).json() as any).total).toBe(1);
  });

  it('test_filter_by_niche', async () => {
    await createBusiness();
    expect((await (await api('GET', '/businesses?niche=barbershops', { token })).json() as any).total).toBe(1);
    expect((await (await api('GET', '/businesses?niche=nail_salons', { token })).json() as any).total).toBe(0);
    expect((await api('GET', '/businesses?niche=bogus', { token })).status).toBe(422);
  });

  it('test_search_by_name', async () => {
    await createBusiness();
    expect((await (await api('GET', '/businesses?search=barbershop', { token })).json() as any).total).toBe(1);
    expect((await (await api('GET', '/businesses?search=nonexistent', { token })).json() as any).total).toBe(0);
  });

  it('test_pagination', async () => {
    await createBusiness();
    await createBusiness({ name: 'Second Shop' });
    const data = await (await api('GET', '/businesses?page=1&page_size=1', { token })).json() as any;
    expect(data.items).toHaveLength(1);
    expect(data.page).toBe(1);
    expect(data.total).toBe(2);
  });

  it('test_requires_auth', async () => {
    await createBusiness();
    expect((await api('GET', '/businesses', { headers: { 'X-API-Key': 'wrong' } })).status).toBe(401);
  });

  it('flattens latest score and latest outreach stage onto list items', async () => {
    const id = await createBusiness();
    await createScore(id, { score_version: 1, composite_acquisition_score: 10, price_tier: 1 });
    await createScore(id, { score_version: 2, composite_acquisition_score: 48.25, price_tier: 2 });
    await createOutreach(id, { status: 'scored' });
    await createOutreach(id, { status: 'queued' });
    const data = await (await api('GET', '/businesses', { token })).json() as any;
    expect(data.items[0].composite_acquisition_score).toBe(48.25);
    expect(data.items[0].price_tier).toBe(2);
    expect(data.items[0].pipeline_stage).toBe('queued');
    expect((await (await api('GET', '/businesses?min_score=50', { token })).json() as any).total).toBe(0);
    expect((await (await api('GET', '/businesses?stage=queued', { token })).json() as any).total).toBe(1);
  });
});

describe('TestGetBusiness', () => {
  it('test_get_detail', async () => {
    const id = await createBusiness();
    const res = await api('GET', `/businesses/${id}`, { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toMatchObject({ name: 'Test Barbershop', zip_code: '60619', niche: 'barbershops', digital_presence: null, lead_scores: [], outreach_records: [] });
  });

  it('test_not_found', async () => {
    expect((await api('GET', `/businesses/${crypto.randomUUID()}`, { token })).status).toBe(404);
  });
});

describe('TestUpdateBusiness', () => {
  it('test_patch_fields', async () => {
    const id = await createBusiness();
    const res = await api('PATCH', `/businesses/${id}`, { token, json: { name: 'Updated Name', phone: '(312) 555-9999' } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.name).toBe('Updated Name');
    expect(data.phone).toBe('(312) 555-9999');
  });

  it('test_patch_not_found', async () => {
    expect((await api('PATCH', `/businesses/${crypto.randomUUID()}`, { token, json: { name: 'X' } })).status).toBe(404);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { accessToken, adminUser, api, createBusiness, resetDb, viewerUser } from './helpers';

let token: string;
let biz: string;
beforeEach(async () => { await resetDb(); token = await accessToken(await adminUser()); biz = await createBusiness(); });

async function createGrant(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api('POST', '/grants', { token, json: { business_id: biz, ...extra } });
  expect(res.status).toBe(201);
  return (await res.json() as any).id;
}

describe('grants', () => {
  it('test_create_grant', async () => {
    const res = await api('POST', '/grants/', { token, json: { business_id: biz } });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.business_id).toBe(biz);
    expect(data.status).toBe('eligibility_assessed');
    expect(data.financing_verified).toBe(false);
  });

  it('test_create_grant_invalid_business', async () => {
    expect((await api('POST', '/grants', { token, json: { business_id: crypto.randomUUID() } })).status).toBe(404);
  });

  it('test_list_grants', async () => {
    await createGrant(); await createGrant();
    const res = await api('GET', '/grants/', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });

  it('test_list_grants_filter_status', async () => {
    const first = await createGrant();
    await api('PATCH', `/grants/${first}/stage`, { token, json: { new_stage: 'intake' } });
    await createGrant();
    const data = await (await api('GET', '/grants?status=intake', { token })).json() as any;
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe('intake');
    expect((await api('GET', '/grants?status=bogus', { token })).status).toBe(400);
  });

  it('test_get_grant_detail', async () => {
    const id = await createGrant();
    const res = await api('GET', `/grants/${id}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, business_id: biz });
  });

  it('test_update_grant', async () => {
    const id = await createGrant();
    const res = await api('PATCH', `/grants/${id}`, { token, json: { total_project_cost: 200000.0, project_description: 'Storefront renovation' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ total_project_cost: 200000, project_description: 'Storefront renovation' });
  });

  it('test_stage_transition_valid', async () => {
    const id = await createGrant();
    const res = await api('PATCH', `/grants/${id}/stage`, { token, json: { new_stage: 'intake' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', grant_id: id, new_stage: 'intake' });
  });

  it('test_stage_transition_invalid', async () => {
    const id = await createGrant();
    expect((await api('PATCH', `/grants/${id}/stage`, { token, json: { new_stage: 'alumnus' } })).status).toBe(422);
    expect((await api('PATCH', `/grants/${id}/stage`, { token, json: { new_stage: 'bogus' } })).status).toBe(400);
  });

  it('test_get_grant_board', async () => {
    await createGrant();
    const res = await api('GET', '/grants/board', { token });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.columns).toHaveLength(13);
    expect(data.columns[0].stage).toBe('eligibility_assessed');
    expect(data.columns[0].count).toBe(1);
    expect(data.columns[0].cards).toHaveLength(1);
    expect(data.columns[0].cards[0]).toMatchObject({ business_id: biz, business_name: 'Test Barbershop', estimated_grant: null, days_in_stage: 0 });
  });

  it('test_get_grant_financials', async () => {
    const id = await createGrant({ total_project_cost: 200000.0 });
    const res = await api('GET', `/grants/financials/${id}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ base_grant: 150000, taf_eligible: 30000, owner_contribution: 50000 });
  });

  it('test_get_grant_documents', async () => {
    const id = await createGrant();
    const res = await api('GET', `/grants/${id}/documents`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect((await api('GET', `/grants/${crypto.randomUUID()}/documents`, { token })).status).toBe(404);
  });

  it('updates a document and scopes it to its grant', async () => {
    const id = await createGrant();
    const other = await createGrant();
    const docId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO grant_documents (id, grant_application_id, document_type, is_mandatory) VALUES (?, ?, 'gc_bid', 1)").bind(docId, id).run();
    const res = await api('PATCH', `/grants/${id}/documents/${docId}`, { token, json: { status: 'received', received_date: '2026-09-02' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: docId, status: 'received', received_date: '2026-09-02', is_mandatory: true });
    expect((await api('PATCH', `/grants/${other}/documents/${docId}`, { token, json: { status: 'approved' } })).status).toBe(404);
  });

  it('test_grant_auth_required', async () => {
    expect((await api('GET', '/grants/')).status).toBe(401);
  });

  it('rejects viewers', async () => {
    const viewer = await accessToken(await viewerUser());
    const res = await api('POST', '/grants', { token: viewer, json: { business_id: biz } });
    expect(res.status).toBe(403);
  });
});

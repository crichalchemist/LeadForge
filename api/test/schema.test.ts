import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';

describe('D1 migration', () => {
  it('creates every table the Python models define', async () => {
    const rows = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA') ORDER BY name"
    ).all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual([
      'businesses', 'competitive_contexts', 'digital_presences', 'google_matches', // Workers-only (ADR 031)
      'grant_applications', 'grant_documents', 'lead_scores', 'nof_corridors', 'outreach_records',
      'overture_matches', // Workers-only (Overture is not in the Python backend)
      'users',
    ]);
  });

  it('rejects an outreach status outside the pipeline enum', async () => {
    await env.DB.prepare("INSERT INTO businesses (id, name, zip_code, niche) VALUES ('b1', 'B', '60619', 'barbershops')").run();
    await expect(
      env.DB.prepare("INSERT INTO outreach_records (id, business_id, status) VALUES ('o1', 'b1', 'discovered')").run()
    ).rejects.toThrow();
  });

  it('keeps one score row per business per version', async () => {
    // Distinct business id from the previous test: this plugin isolates storage per test file, not per test.
    await env.DB.prepare("INSERT INTO businesses (id, name, zip_code, niche) VALUES ('b2', 'B', '60619', 'barbershops')").run();
    await env.DB.prepare("INSERT INTO lead_scores (id, business_id, score_version) VALUES ('s1', 'b2', 1)").run();
    await env.DB.prepare("INSERT INTO lead_scores (id, business_id, score_version) VALUES ('s2', 'b2', 2)").run();
    await expect(
      env.DB.prepare("INSERT INTO lead_scores (id, business_id, score_version) VALUES ('s3', 'b2', 2)").run()
    ).rejects.toThrow();
  });

  it('stores the licence name apart from the name the record displays', async () => {
    await env.DB.prepare(
      "INSERT INTO businesses (id, name, license_name, zip_code, niche) VALUES ('b3', 'Google Name', 'LICENCE NAME', '60619', 'barbershops')"
    ).run();
    const row = await env.DB.prepare("SELECT name, license_name FROM businesses WHERE id = 'b3'").first();
    expect(row).toEqual({ name: 'Google Name', license_name: 'LICENCE NAME' });
  });

  it('forgets a Google verdict together with its business', async () => {
    await env.DB.prepare("INSERT INTO businesses (id, name, zip_code, niche) VALUES ('b4', 'B', '60619', 'barbershops')").run();
    await env.DB.prepare(
      "INSERT INTO google_matches (business_id, status, looked_up_at) VALUES ('b4', 'no_candidate', '2026-09-26T00:00:00Z')"
    ).run();
    await env.DB.prepare("DELETE FROM businesses WHERE id = 'b4'").run();
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM google_matches WHERE business_id = 'b4'").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('rejects a Google verdict outside the five the pipeline records', async () => {
    await env.DB.prepare("INSERT INTO businesses (id, name, zip_code, niche) VALUES ('b5', 'B', '60619', 'barbershops')").run();
    await expect(
      env.DB.prepare(
        "INSERT INTO google_matches (business_id, status, looked_up_at) VALUES ('b5', 'maybe', '2026-09-26T00:00:00Z')"
      ).run()
    ).rejects.toThrow();
  });
});

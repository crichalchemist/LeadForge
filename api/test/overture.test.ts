import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './helpers';

beforeEach(async () => {
  await resetDb();
});

const insert = (account: string, site: string | null, matched = 1) =>
  env.DB.prepare(
    `INSERT INTO overture_matches (account_number, site_number, matched, built_at)
     VALUES (?, ?, ?, '2026-09-25T00:00:00Z')`,
  ).bind(account, site, matched).run();

describe('overture_matches', () => {
  it('stores one row per licence account', async () => {
    await insert('478849', '1');
    const row = await env.DB.prepare('SELECT account_number, matched FROM overture_matches').first();
    expect(row).toEqual({ account_number: '478849', matched: 1 });
  });

  it('rejects a second row for the same licence account', async () => {
    await insert('478849', '1');
    await expect(insert('478849', '1')).rejects.toThrow();
  });

  it('keeps a no-match row distinguishable from no row at all', async () => {
    // A coverage gap and a genuine no-match must not look the same: the first means the build has
    // not run for this business, the second means Overture has nothing for it.
    await insert('478849', '1', 0);
    const looked = await env.DB.prepare(
      'SELECT matched FROM overture_matches WHERE account_number = ?',
    ).bind('478849').first<{ matched: number }>();
    const never = await env.DB.prepare(
      'SELECT matched FROM overture_matches WHERE account_number = ?',
    ).bind('999999').first();
    expect(looked?.matched).toBe(0);
    expect(never).toBeNull();
  });
});

// The e2e database's contents. Every business is a fixture and says so in its name: the product never
// shows synthetic businesses, and nothing here can be mistaken for a real one (PRODUCT.md).
import { webcrypto } from 'node:crypto';

export const ADMIN = { email: 'e2e-admin@leadforge.test', password: 'e2e-password-not-a-secret' };

// The Worker's own format (api/src/lib/password.ts): pbkdf2$<iterations>$<salt b64url>$<hash b64url>.
async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 50000 }, key, 256);
  const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
  return `pbkdf2$50000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

export async function adminSql(email, password) {
  const id = webcrypto.randomUUID();
  return `INSERT INTO users (id, email, password_hash, full_name, role, is_active)
  VALUES (${quote(id)}, ${quote(email)}, ${quote(await hashPassword(password))}, 'Local Admin', 'admin', 1);\n`;
}

// e2e-queued is the one business seeded on the outreach line, so the captures show a started strip map
// without clicking Start outreach: the tests share this database, and core-loop.spec.ts starts outreach on
// the barbershop.
export async function seedSql() {
  return `${await adminSql(ADMIN.email, ADMIN.password)}
INSERT INTO businesses (id, name, license_name, zip_code, niche, phone, license_number, license_status,
    license_issue_date, account_number, site_number, in_nof_corridor, nof_corridor_name)
  VALUES
    ('e2e-barbershop', 'E2E Fixture Barbershop', 'E2E Fixture Barbershop', '60619', 'barbershops', '(773) 555-0100',
      'E2E-1', 'active', '2019-05-15', 'E2E-ACCT-1', '1', 1, 'Priority corridor 7'),
    ('e2e-salon', 'E2E Fixture Salon', 'E2E Fixture Salon', '60619', 'beauty_shops', NULL,
      'E2E-2', 'active', '2020-02-01', 'E2E-ACCT-2', '1', 0, NULL),
    ('e2e-tires', 'E2E Fixture Tire Shop', 'E2E Fixture Tire Shop', '60620', 'tire_shops', NULL,
      'E2E-3', 'active', '2018-07-09', 'E2E-ACCT-3', '1', 0, NULL),
    ('e2e-queued', 'E2E Fixture Veterinarian', 'E2E Fixture Veterinarian', '60619', 'veterinarians', '(773) 555-0104',
      'E2E-4', 'active', '2021-03-22', 'E2E-ACCT-4', '1', 1, 'Priority corridor 12');

INSERT INTO digital_presences (id, business_id, has_website, website_url, has_google_business_profile,
    google_review_count, google_avg_rating, has_facebook_page, has_instagram)
  VALUES
    ('e2e-dp-1', 'e2e-barbershop', 1, 'https://e2e-fixture-barbershop.test', 1, 12, 4.2, 1, 0),
    ('e2e-dp-2', 'e2e-salon', 0, NULL, 0, NULL, NULL, 0, 0),
    ('e2e-dp-3', 'e2e-tires', 0, NULL, 0, NULL, NULL, 0, 0),
    ('e2e-dp-4', 'e2e-queued', 0, NULL, 1, 5, 4.6, 0, 0);

INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score, composite_acquisition_score)
  VALUES
    ('e2e-ls-1', 'e2e-barbershop', 1, 7, 7),
    ('e2e-ls-2', 'e2e-salon', 1, NULL, NULL),
    ('e2e-ls-3', 'e2e-tires', 1, 64, 64),
    ('e2e-ls-4', 'e2e-queued', 1, 41, 41);

INSERT INTO google_matches (business_id, status, place_id, matched_name, score, distance_m, website, phone, looked_up_at)
  VALUES
    ('e2e-barbershop', 'matched', 'e2e-place-1', 'E2E Fixture Barbershop', 1, 12,
      'https://e2e-fixture-barbershop.test', '(773) 555-0100', '2026-09-26T00:00:00Z'),
    ('e2e-salon', 'unavailable', NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-26T00:00:00Z'),
    ('e2e-tires', 'rejected_name', 'e2e-place-3', 'E2E Fixture Unrelated Office', 0, 20, NULL, NULL, '2026-09-26T00:00:00Z'),
    ('e2e-queued', 'matched', 'e2e-place-4', 'E2E Fixture Veterinarian', 1, 35, NULL, '(773) 555-0104',
      '2026-09-26T00:00:00Z');

INSERT INTO outreach_records (id, business_id, status) VALUES ('e2e-or-4', 'e2e-queued', 'scored');

INSERT INTO overture_matches (account_number, site_number, matched, matched_name, score, distance_m, website,
    has_facebook, has_instagram, phone, built_at)
  VALUES ('E2E-ACCT-1', '1', 1, 'E2E Fixture Barbershop', 1, 6, 'https://e2e-fixture-barbershop.test', 1, 0, NULL,
    '2026-09-25T00:00:00Z');
`;
}

// `LEADFORGE_LOCAL_PASSWORD=… node e2e/seed.mjs admin you@example.com` prints the SQL for one local admin,
// for a click-through against the default local D1. The password comes from the environment so it never
// lands in shell history or a tracked file.
if (process.argv[2] === 'admin') {
  const [email] = process.argv.slice(3);
  const password = process.env.LEADFORGE_LOCAL_PASSWORD;
  if (!email || !password) {
    console.error('usage: LEADFORGE_LOCAL_PASSWORD=<password> node e2e/seed.mjs admin <email>');
    process.exit(2);
  }
  process.stdout.write(await adminSql(email, password));
}

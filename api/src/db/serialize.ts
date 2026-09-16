/** D1 stores booleans as 0/1. Convert the listed keys to JSON booleans; leave null alone. */
export function withBooleans<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of keys) {
    if (key in out && out[key] !== null && out[key] !== undefined) {
      out[key] = out[key] === 1 || out[key] === true;
    }
  }
  return out as T;
}

export const USER_BOOLS = ['is_active'] as const;
export const DIGITAL_PRESENCE_BOOLS = [
  'has_website', 'has_ssl', 'has_google_business_profile', 'has_facebook_page',
  'has_instagram', 'has_google_ads', 'has_meta_ads',
] as const;
export const OUTREACH_BOOLS = ['meeting_scheduled'] as const;
export const GRANT_BOOLS = ['financing_verified', 'is_priority_corridor', 'has_site_control'] as const;
export const DOCUMENT_BOOLS = ['is_mandatory'] as const;

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

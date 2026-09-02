import { describe, expect, it } from 'vitest';
import { api } from './helpers';

describe('CORS', () => {
  it('allows an origin in CORS_ORIGINS', async () => {
    const res = await api('GET', '/health', { headers: { Origin: 'http://localhost:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('does not allow an origin outside CORS_ORIGINS', async () => {
    const res = await api('GET', '/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

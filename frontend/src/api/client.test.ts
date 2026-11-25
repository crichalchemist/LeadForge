import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import api, { fetchProvenance, refreshToken, setAccessToken } from './client';

// axios hands every request to its adapter, so a fake adapter is the HTTP boundary: the server is
// replaced, and the client's own logic, interceptors included, runs for real.
const realAdapter = api.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = realAdapter;
  setAccessToken(null);
});

type Reply = { status: number; data?: unknown };

function serve(reply: (config: InternalAxiosRequestConfig) => Reply): InternalAxiosRequestConfig[] {
  const seen: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push(config);
    const { status, data } = reply(config);
    const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) throw new AxiosError(`status ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
    return response;
  };
  api.defaults.adapter = adapter;
  return seen;
}

describe('the session', () => {
  it('ends a failed refresh instead of hanging the first visit on the spinner', async () => {
    const seen = serve(() => ({ status: 401, data: { detail: 'No refresh token' } }));
    await expect(refreshToken()).rejects.toMatchObject({ response: { status: 401 } });
    expect(seen.map((c) => c.url)).toEqual(['/auth/refresh']);
  });

  it('refreshes an expired access token once and retries the request with the new one', async () => {
    setAccessToken('expired');
    const seen = serve((config) => {
      if (config.url === '/auth/refresh') return { status: 200, data: { access_token: 'fresh' } };
      return config.headers.Authorization === 'Bearer fresh' ? { status: 200, data: { facts: [] } } : { status: 401 };
    });
    await expect(fetchProvenance('b1')).resolves.toEqual({ facts: [] });
    expect(seen.map((c) => c.url)).toEqual(['/businesses/b1/provenance', '/auth/refresh', '/businesses/b1/provenance']);
  });
});

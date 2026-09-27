import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

/** A failed API call as axios reports it, for mocking a client function's rejection. */
export function httpError(status: number, data: unknown = {}): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null, {
    status, statusText: String(status), data, headers: {}, config,
  });
}

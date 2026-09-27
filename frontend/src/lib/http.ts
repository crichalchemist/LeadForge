import axios from 'axios';

/** The HTTP status of a failed API call, or null when the request never got an answer. */
export function statusOf(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}

// =py scrapers/base — BaseAPIClient is an httpx.AsyncClient plus a per-source timeout.
// On Workers `fetch` is global and pooled by the runtime, so all that survives the port is
// the timeout and httpx's raise_for_status.

export const DEFAULT_TIMEOUT_MS = 30_000;

// The URL carries API keys, so the message names the status only.
function assertOk(response: Response): void {
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  assertOk(response);
  return (await response.json()) as T;
}

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  assertOk(response);
  return await response.text();
}

// =py urlencode — URLSearchParams disagrees with Python's quote_plus on two characters, and a
// signed Google URL has to match the string Python would have signed byte for byte.
export function encodeParams(params: Record<string, string>): string {
  return new URLSearchParams(params).toString().replace(/%7E/g, '~').replace(/\*/g, '%2A');
}

const LD_JSON_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/;

// =py the re.search + json.loads block repeated in the Thumbtack and Angi clients
export function extractLdJson(html: string): Record<string, unknown> | null {
  const match = LD_JSON_RE.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// =py ld_json.get("aggregateRating", {}).get(...)
export function aggregateRating(ldJson: Record<string, unknown>): Record<string, unknown> {
  const rating = ldJson.aggregateRating;
  return rating && typeof rating === 'object' ? (rating as Record<string, unknown>) : {};
}

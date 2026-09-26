// Operator trigger for the discovery pipeline. Python has no HTTP route for this — it runs from the
// Typer CLI (`leadforge pipeline --zip --niche --limit`), and a Worker has no CLI, so this is the
// Workers stand-in. It is not part of the CRM contract and nothing in the frontend calls it.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { runDiscovery } from '../lib/discovery';
import { newPlacesHealth } from '../scrapers/google-places';
import { NICHES } from '../lib/stages';
import { jsonBody } from '../lib/validate';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

// Each business costs up to two Places subrequests on top of the Socrata page — Find Place, then
// Details only for a corroborated candidate (ADR 030) — and a Worker invocation is capped at 50
// subrequests on the free plan. 20 keeps the worst case at 41. Measured, the real cost is lower:
// 77 of 102 in-radius candidates corroborate, and a re-run of an already-stored business costs
// nothing at all, because dedup on the licence account happens before the first call.
const MAX_LIMIT = 20;

const runSchema = z.object({
  zip_code: z.string().min(5).max(10),
  niche: z.enum(NICHES),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(10),
});

router.post('/run', requireAuth, requireAdmin, jsonBody(runSchema), async (c) => {
  const { zip_code, niche, limit } = c.req.valid('json');
  // Without this tally a run that looked up nothing is indistinguishable from one where Chicago's
  // shops are simply absent from Google. Google answers a denied key, an exhausted quota and a
  // malformed request with HTTP 200 plus a `status` field, so nothing throws and the payload merely
  // lacks its results key — which would otherwise read as "no such business" for every shop.
  const places = newPlacesHealth();
  const businesses = await runDiscovery(c.env, zip_code, niche, limit, places);
  return c.json({ zip_code, niche, limit, discovered: businesses.length, places, businesses });
});

export default router;

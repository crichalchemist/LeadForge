// Operator trigger for the discovery pipeline. Python has no HTTP route for this — it runs from the
// Typer CLI (`leadforge pipeline --zip --niche --limit`), and a Worker has no CLI, so this is the
// Workers stand-in. It is not part of the CRM contract and nothing in the frontend calls it.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { runDiscovery } from '../lib/discovery';
import { newFoursquareHealth } from '../scrapers/foursquare';
import { NICHES } from '../lib/stages';
import { jsonBody } from '../lib/validate';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

// Each business costs one Foursquare subrequest on top of the Socrata page — its search response
// carries the fields Google needed a second details call for — and a Worker invocation is capped at
// 50 subrequests on the free plan. 20 keeps the worst case at 21.
const MAX_LIMIT = 20;

const runSchema = z.object({
  zip_code: z.string().min(5).max(10),
  niche: z.enum(NICHES),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(10),
});

router.post('/run', requireAuth, requireAdmin, jsonBody(runSchema), async (c) => {
  const { zip_code, niche, limit } = c.req.valid('json');
  // Without this tally a run that looked up nothing is indistinguishable from one where Chicago's
  // shops are simply absent from Foursquare. The client reads HTTP status itself rather than going
  // through fetchJson, whose throw would unwind past the tally and report a clean run that stored
  // nothing at all.
  const places = newFoursquareHealth();
  const businesses = await runDiscovery(c.env, zip_code, niche, limit, places);
  return c.json({ zip_code, niche, limit, discovered: businesses.length, places, businesses });
});

export default router;

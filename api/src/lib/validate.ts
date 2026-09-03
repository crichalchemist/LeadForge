import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';

// FastAPI answers 422 with a detail list on validation failure. Match the status; keep detail readable.
export function jsonBody<S extends ZodType>(schema: S) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ detail: result.error.issues }, 422);
  });
}

export function queryParams<S extends ZodType>(schema: S) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) return c.json({ detail: result.error.issues }, 422);
  });
}

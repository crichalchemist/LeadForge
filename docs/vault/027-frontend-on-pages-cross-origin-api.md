# ADR-027: Frontend on Cloudflare Pages, cross-origin to the Workers API

## Status

Accepted

## Date

2026-09-02

## Context

ADR-015 planned to serve the SPA from Nginx or a FastAPI static mount, on the same origin as the API. The Cloudflare migration (spec 2026-05-13, task 2.4) moves the frontend to Cloudflare Pages at `leadforge-frontend-80u.pages.dev` and the API to a Worker at `leadforge-api.crichalchemist.workers.dev`. Those are two different sites, so the refresh token cookie the API sets with `SameSite=Lax` would never be sent on the frontend's cross-site `POST /auth/refresh`, and every session would end when the 60 minute access token expired.

Two alternatives were considered: serving the built frontend from the Worker itself with Workers Static Assets (same origin, no cookie change, no CORS), or putting Pages and the Worker under two subdomains of one custom domain (same-site, so `Lax` cookies flow). Neither was chosen; there is no custom domain for LeadForge on the account, and Pages was the hosting target in the migration plan.

## Decision

- The frontend is deployed to Cloudflare Pages from `frontend/dist` with `wrangler pages deploy`. `frontend/wrangler.toml` names the project; `frontend/.env.production` bakes the API URL into the build through `VITE_API_BASE_URL`, which the axios client reads and falls back to `/api` for local dev against the Vite proxy.
- The refresh token cookie is `HttpOnly; Secure; SameSite=None`, set and cleared by `api/src/routes/auth.ts`. CORS on the Worker stays an exact-match allowlist with credentials; the production environment in `api/wrangler.jsonc` allows the Pages origin.

## Consequences

### Positive
- No change to the frontend's request flow; the axios client still sends credentials and retries on 401.
- Pages and the Worker deploy independently.

### Negative
- `SameSite=None` makes the refresh cookie a third-party cookie. Safari, and any browser with third-party cookie blocking on, drops it, so those users are logged out after 60 minutes. Chrome and Firefox send it.
- Pages preview deployments live at `<hash>.leadforge-frontend-80u.pages.dev`, which the exact-match allowlist rejects, so previews cannot log in unless their origin is added to `CORS_ORIGINS`.
- Changing the API URL requires a frontend rebuild, not just a config change, because Vite inlines `VITE_*` variables at build time.

### Revisit when
- A custom domain is available: moving both apps under it restores `SameSite=Lax` and removes the Safari problem.
- Or when the frontend can move into the Worker as static assets, which Cloudflare now recommends over Pages.

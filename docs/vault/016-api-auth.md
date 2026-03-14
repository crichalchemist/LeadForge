# ADR-016: API auth: API key for MVP, upgrade path to OAuth2/OIDC

## Status

Superseded by JWT-based authentication (see `docs/superpowers/specs/2026-03-14-auth-login-design.md`)

## Date

2026-03-14

## Context

The CRM dashboard and any future integrations need authenticated access to the FastAPI backend. Currently the tool is internal, used by a small team on a private network. However, the authentication layer must be designed so it can evolve if the tool is ever exposed externally or if user-level permissions become necessary.

Key constraints:

- Small internal team (fewer than 10 users)
- No external API consumers in the near term
- Speed of implementation matters for the MVP
- Must not paint ourselves into a corner for future OAuth2/OIDC adoption

## Decision

We will implement API key authentication for the MVP:

- Clients pass a key via the `X-API-Key` HTTP header
- API keys are stored as bcrypt hashes in the `api_keys` database table with associated metadata (owner, created_at, last_used_at, is_active)
- A FastAPI dependency (`get_current_key`) validates the key on every request and returns the key record
- All key management (create, revoke, rotate) happens via CLI commands, not through the API itself

To prepare for future OAuth2/OIDC adoption:

- Auth logic is isolated behind an `AuthBackend` abstract interface
- The FastAPI dependency resolves the active backend from configuration
- Switching to OAuth2/OIDC requires implementing a new backend and updating config, with no route changes

## Consequences

### Positive
- Simple to implement and test; no external identity provider needed for MVP
- API keys are familiar to the team and easy to manage for a small user base
- The abstract backend interface ensures a clean upgrade path without touching route handlers

### Negative
- API keys are shared secrets; if leaked, they grant full access until revoked
- No per-user identity or role-based access control in the MVP
- Key rotation requires manual CLI intervention

### Neutral
- All endpoints share a single authorization level (valid key or not); fine-grained permissions are deferred
- Logging captures which key was used, providing basic audit capability

## Alternatives Considered

1. **JWT with OAuth2/OIDC from day 1** — Full-featured auth with user identity, token expiry, and refresh flows. Rejected because it requires setting up an identity provider (e.g., Keycloak, Auth0), which is overengineered for an internal MVP with fewer than 10 users.

2. **No authentication** — Rely on network-level security (VPN, firewall). Rejected because it provides no audit trail, no way to revoke access for individual users, and creates a security gap if the network perimeter is ever misconfigured.

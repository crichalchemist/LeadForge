# LeadForge CRM Authentication & Login

**Date:** 2026-03-14
**Status:** Approved
**Scope:** JWT-based authentication with login page for the CRM dashboard

## Context

The LeadForge CRM dashboard currently uses a static `X-API-Key` header for API protection, with no login page or session management. The frontend sends a hardcoded key from `VITE_API_KEY` in every request. This design adds proper user authentication with a login flow, JWT tokens, role-based access, and CLI user management for a small internal team (2-5 people).

## Decision Summary

- **Auth mechanism:** JWT with access token (1hr) in memory + refresh token (30 days) in HTTP-only cookie
- **Roles:** Admin (full access) and Viewer (read-only)
- **User management:** CLI-only (`leadforge create-user`), no registration flow
- **Login page:** Split brand + form layout (dark left panel with branding, light right panel with form)

## Data Model

### `users` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | UUIDPrimaryKeyMixin |
| `email` | String(255), unique | Login identifier |
| `password_hash` | String(255) | bcrypt hash via passlib |
| `full_name` | String(255) | Display name |
| `role` | Enum(`admin`, `viewer`) | Controls write access |
| `is_active` | Boolean, default true | Soft-disable without deleting |
| `last_login_at` | DateTime, nullable | Updated on each login |
| `created_at` | DateTime | TimestampMixin |
| `updated_at` | DateTime | TimestampMixin |

No refresh token table. Refresh tokens are stateless JWTs with expiry. Revocation is handled by setting `is_active=false` on the user — their next refresh attempt fails.

### UserRole enum

```python
class UserRole(str, enum.Enum):
    ADMIN = "admin"
    VIEWER = "viewer"
```

## Backend Auth Flow

### New files

| File | Purpose |
|------|---------|
| `src/leadforge/db/models/user.py` | User model + UserRole enum |
| `src/leadforge/auth/__init__.py` | Package init |
| `src/leadforge/auth/security.py` | Password hashing (bcrypt), JWT creation/verification |
| `src/leadforge/api/routes/auth.py` | Login, refresh, logout, me endpoints |
| `src/leadforge/api/schemas/auth.py` | Pydantic request/response models for auth |

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | Public | `{email, password}` -> `{access_token, user}` + sets `refresh_token` HTTP-only cookie |
| POST | `/auth/refresh` | Cookie | Reads refresh cookie -> returns new `{access_token}` |
| POST | `/auth/logout` | Authenticated | Clears refresh cookie |
| GET | `/auth/me` | Authenticated | Returns current user profile |

### Auth dependencies

Replace existing `verify_api_key` with:

- **`get_current_user`** — Reads `Authorization: Bearer <access_token>`, decodes JWT, loads user from DB, checks `is_active`. Returns User object. Used on all protected routes.
- **`require_admin`** — Wraps `get_current_user`, checks `role == admin`. Used on write operations.

### Route protection

- All existing protected routes use `get_current_user` (any authenticated user can read)
- Write operations (PATCH, POST, DELETE) on businesses, pipeline transitions, outreach, grants use `require_admin`
- The old `X-API-Key` mechanism is removed entirely
- Webhooks and health check remain public

### JWT structure

**Access token payload:**
- `sub`: user UUID
- `role`: user role string
- `exp`: now + 60 minutes
- `type`: "access"

**Refresh token payload:**
- `sub`: user UUID
- `exp`: now + 30 days
- `type`: "refresh"

Both signed with `JWT_SECRET_KEY` using HS256.

### Config additions

| Setting | Default | Description |
|---------|---------|-------------|
| `JWT_SECRET_KEY` | (required) | Random 64-char hex secret |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 60 | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | 30 | Refresh token lifetime |

## Frontend Auth Flow

### New files

| File | Purpose |
|------|---------|
| `frontend/src/pages/Login.tsx` | Split brand + form login page |
| `frontend/src/hooks/useAuth.ts` | Auth context, state, token refresh |
| `frontend/src/components/auth/ProtectedRoute.tsx` | Route guard redirecting to /login |

### Auth state management (`useAuth.ts`)

- Access token stored in React state (memory only — not localStorage, XSS-safe)
- On app load, calls `/auth/refresh` to restore session from refresh cookie (survives page refresh)
- Exposes: `login()`, `logout()`, `user`, `isAuthenticated`, `isAdmin`
- Wrapped in `AuthProvider` context at app root

### Axios client changes (`client.ts`)

- Remove static `X-API-Key` header
- Request interceptor: attach `Authorization: Bearer <token>` from auth state
- Response interceptor: on 401, attempt `/auth/refresh` once, retry original request. If refresh fails, redirect to `/login`
- Add `withCredentials: true` for cookie support

### Routing changes (`App.tsx`)

- `/login` route renders `Login.tsx` outside `AppLayout` (no sidebar)
- All other routes wrapped in `ProtectedRoute` — redirects to `/login` if not authenticated
- After successful login, redirect to `/dashboard`

### Role-based UI

- Viewer: action buttons hidden (stage transitions, edit forms, outreach triggers) but all data visible
- Admin: full access
- `useAuth()` hook exposes `isAdmin` for conditional rendering

### AppLayout changes

- Bottom of sidebar shows logged-in user name/email + role badge (admin/viewer)
- Logout button

### Login page design

Split layout matching the existing dark sidebar aesthetic:
- **Left panel (dark):** LeadForge branding, tagline, optional live stats
- **Right panel (light):** Email + password form, "Sign In" button, error message area

## CLI User Management

### Command

```
leadforge create-user --email admin@example.com --name "Jane Doe" --role admin
```

- Prompts for password interactively (stays out of shell history)
- Validates email format, checks for duplicates
- Hashes password with bcrypt, inserts into `users` table
- Prints confirmation: `Created user admin@example.com (role: admin)`

No list-users, delete-user, or reset-password commands in this iteration.

## Dependencies

### Python (new)

- `python-jose[cryptography]` — JWT encode/decode
- `passlib[bcrypt]` — Password hashing
- `python-multipart` — FastAPI form parsing (if not already present)

### Frontend

No new dependencies.

### Alembic migration

- Creates `users` table
- Creates `userrole` enum type
- No data migration

## First-Run Workflow

1. `uv run alembic upgrade head`
2. `uv run leadforge create-user --email you@example.com --role admin`
3. Start API server, open frontend, see login page
4. Log in, land on dashboard

## Files Modified

| File | Change |
|------|--------|
| `src/leadforge/config.py` | Add JWT_SECRET_KEY, token lifetime settings |
| `src/leadforge/api/app.py` | Replace verify_api_key with get_current_user/require_admin, register auth router |
| `src/leadforge/api/deps.py` | Replace verify_api_key with get_current_user + require_admin dependencies |
| `src/leadforge/cli/main.py` | Add create-user command |
| `frontend/src/main.tsx` | Wrap app in AuthProvider |
| `frontend/src/App.tsx` | Add /login route, wrap others in ProtectedRoute |
| `frontend/src/api/client.ts` | Replace X-API-Key with Bearer token interceptors |
| `frontend/src/components/layout/AppLayout.tsx` | Add user info + logout to sidebar |

## Files Created

| File | Purpose |
|------|--------|
| `src/leadforge/db/models/user.py` | User model + UserRole enum |
| `src/leadforge/auth/__init__.py` | Package init |
| `src/leadforge/auth/security.py` | Password hashing, JWT creation/verification |
| `src/leadforge/api/routes/auth.py` | Auth endpoints |
| `src/leadforge/api/schemas/auth.py` | Auth Pydantic schemas |
| `migrations/versions/xxx_add_users_table.py` | Alembic migration |
| `frontend/src/pages/Login.tsx` | Login page component |
| `frontend/src/hooks/useAuth.ts` | Auth context + hook |
| `frontend/src/components/auth/ProtectedRoute.tsx` | Route guard |
| `tests/api/test_auth.py` | Auth endpoint tests |

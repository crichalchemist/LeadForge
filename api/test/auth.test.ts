import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import app from '../src/index';
import { accessToken, adminUser, api, createBusiness, createUser, refreshToken, resetDb, viewerUser } from './helpers';

beforeEach(resetDb);

describe('auth', () => {
  it('test_login_valid_credentials', async () => {
    await adminUser();
    const res = await api('POST', '/auth/login', { json: { email: 'admin@test.com', password: 'testpassword12' } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.access_token).toBeTypeOf('string');
    expect(data.token_type).toBe('bearer');
    expect(data.user.email).toBe('admin@test.com');
    expect(data.user.role).toBe('admin');
    expect(res.headers.get('set-cookie')).toContain('refresh_token=');
  });

  it('test_login_wrong_password', async () => {
    await adminUser();
    const res = await api('POST', '/auth/login', { json: { email: 'admin@test.com', password: 'wrongpassword1' } });
    expect(res.status).toBe(401);
    expect((await res.json() as any).detail).toBe('Invalid credentials');
  });

  it('test_login_nonexistent_email', async () => {
    const res = await api('POST', '/auth/login', { json: { email: 'nobody@test.com', password: 'testpassword12' } });
    expect(res.status).toBe(401);
    expect((await res.json() as any).detail).toBe('Invalid credentials');
  });

  it('test_login_deactivated_user', async () => {
    await createUser({ email: 'inactive@test.com', full_name: 'Inactive User', is_active: false });
    const res = await api('POST', '/auth/login', { json: { email: 'inactive@test.com', password: 'testpassword12' } });
    expect(res.status).toBe(401);
  });

  it('test_me_with_valid_token', async () => {
    const user = await adminUser();
    const res = await api('GET', '/auth/me', { token: await accessToken(user) });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.email).toBe('admin@test.com');
    expect(data.full_name).toBe('Test Admin');
    expect(data.role).toBe('admin');
    expect(data.is_active).toBe(true);
  });

  it('test_me_without_token', async () => {
    expect((await api('GET', '/auth/me')).status).toBe(401);
  });

  it('test_refresh_with_valid_cookie', async () => {
    const user = await adminUser();
    const res = await api('POST', '/auth/refresh', { headers: { Cookie: `refresh_token=${await refreshToken(user)}` } });
    expect(res.status).toBe(200);
    expect((await res.json() as any).access_token).toBeTypeOf('string');
  });

  it('test_refresh_without_cookie', async () => {
    expect((await api('POST', '/auth/refresh')).status).toBe(401);
  });

  it('test_refresh_rejects_access_token_in_cookie', async () => {
    const user = await adminUser();
    const res = await api('POST', '/auth/refresh', { headers: { Cookie: `refresh_token=${await accessToken(user)}` } });
    expect(res.status).toBe(401);
  });

  it('test_protected_get_accessible_by_viewer', async () => {
    const viewer = await viewerUser();
    await createBusiness();
    expect((await api('GET', '/businesses', { token: await accessToken(viewer) })).status).toBe(200);
  });

  it('test_protected_patch_rejected_for_viewer', async () => {
    const viewer = await viewerUser();
    const id = await createBusiness();
    const res = await api('PATCH', `/businesses/${id}`, { token: await accessToken(viewer), json: { name: 'Updated Name' } });
    expect(res.status).toBe(403);
  });

  it('test_protected_patch_accessible_by_admin', async () => {
    const admin = await adminUser();
    const id = await createBusiness();
    const res = await api('PATCH', `/businesses/${id}`, { token: await accessToken(admin), json: { name: 'Updated Name' } });
    expect(res.status).toBe(200);
  });

  it('test_logout_clears_cookie', async () => {
    const res = await api('POST', '/auth/logout');
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('ok');
    expect(res.headers.get('set-cookie')).toMatch(/refresh_token=;/);
  });

  it('test_deactivated_user_token_rejected', async () => {
    const user = await createUser({ email: 'deact@test.com', full_name: 'Deactivated User' });
    const token = await accessToken(user);
    await env.DB.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(user.id).run();
    expect((await api('GET', '/auth/me', { token })).status).toBe(401);
  });

  it('test_signup_requires_admin', async () => {
    const viewer = await viewerUser();
    const res = await api('POST', '/auth/signup', {
      token: await accessToken(viewer),
      json: { email: 'new@test.com', password: 'testpassword12', full_name: 'New', role: 'viewer' },
    });
    expect(res.status).toBe(403);
  });

  it('test_signup_creates_user_who_can_log_in', async () => {
    const admin = await adminUser();
    const res = await api('POST', '/auth/signup', {
      token: await accessToken(admin),
      json: { email: 'new@test.com', password: 'testpassword12', full_name: 'New User', role: 'viewer' },
    });
    expect(res.status).toBe(201);
    const login = await api('POST', '/auth/login', { json: { email: 'new@test.com', password: 'testpassword12' } });
    expect(login.status).toBe(200);
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    const res = await app.request(
      '/api/auth/login',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'x' }) },
      { ...env, JWT_SECRET: undefined }
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ detail: 'JWT_SECRET not configured' });
  });
});

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.auth.security import create_access_token, create_refresh_token, hash_password
from leadforge.db.models.user import User, UserRole


@pytest.mark.asyncio
async def test_login_valid_credentials(client: AsyncClient, admin_user: User):
    """Login with valid credentials returns access_token and user."""
    resp = await client.post(
        "/auth/login",
        json={"email": "admin@test.com", "password": "testpassword12"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "admin@test.com"
    assert data["user"]["role"] == "admin"
    # Check refresh cookie is set
    assert "refresh_token" in resp.cookies


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, admin_user: User):
    """Login with wrong password returns 401."""
    resp = await client.post(
        "/auth/login",
        json={"email": "admin@test.com", "password": "wrongpassword1"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_nonexistent_email(client: AsyncClient):
    """Login with nonexistent email returns 401 (no enumeration)."""
    resp = await client.post(
        "/auth/login",
        json={"email": "nobody@test.com", "password": "testpassword12"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_deactivated_user(client: AsyncClient, db_session: AsyncSession):
    """Login with deactivated user returns 401."""
    user = User(
        id=uuid.uuid4(),
        email="inactive@test.com",
        password_hash=hash_password("testpassword12"),
        full_name="Inactive User",
        role=UserRole.ADMIN,
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await client.post(
        "/auth/login",
        json={"email": "inactive@test.com", "password": "testpassword12"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_with_valid_token(client: AsyncClient, admin_user: User, auth_headers: dict):
    """GET /auth/me with valid token returns user profile."""
    resp = await client.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "admin@test.com"
    assert data["full_name"] == "Test Admin"
    assert data["role"] == "admin"


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient):
    """GET /auth/me without token returns 401."""
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_with_valid_cookie(client: AsyncClient, admin_user: User):
    """POST /auth/refresh with valid cookie returns new access_token."""
    refresh_tok = create_refresh_token(str(admin_user.id))
    resp = await client.post(
        "/auth/refresh",
        cookies={"refresh_token": refresh_tok},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_refresh_without_cookie(client: AsyncClient):
    """POST /auth/refresh without cookie returns 401."""
    resp = await client.post("/auth/refresh")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_protected_get_accessible_by_viewer(
    client: AsyncClient, viewer_user: User, viewer_headers: dict, sample_business
):
    """Protected GET route is accessible by viewer role."""
    resp = await client.get("/businesses", headers=viewer_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_protected_patch_rejected_for_viewer(
    client: AsyncClient, viewer_user: User, viewer_headers: dict, sample_business
):
    """Protected PATCH route is rejected for viewer role (403)."""
    resp = await client.patch(
        f"/businesses/{sample_business.id}",
        headers=viewer_headers,
        json={"name": "Updated Name"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_protected_patch_accessible_by_admin(
    client: AsyncClient, admin_user: User, auth_headers: dict, sample_business
):
    """Protected PATCH route is accessible by admin role."""
    resp = await client.patch(
        f"/businesses/{sample_business.id}",
        headers=auth_headers,
        json={"name": "Updated Name"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_logout_clears_cookie(client: AsyncClient):
    """POST /auth/logout returns 200."""
    resp = await client.post("/auth/logout")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_deactivated_user_token_rejected(
    client: AsyncClient, db_session: AsyncSession
):
    """Token for a deactivated user is rejected on request."""
    user = User(
        id=uuid.uuid4(),
        email="deact@test.com",
        password_hash=hash_password("testpassword12"),
        full_name="Deactivated User",
        role=UserRole.ADMIN,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    token = create_access_token(str(user.id), user.role.value)

    # Deactivate user
    user.is_active = False
    await db_session.commit()

    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401

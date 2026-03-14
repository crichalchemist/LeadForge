"""Tests for grant API routes."""

import uuid

import pytest


@pytest.mark.asyncio
async def test_create_grant(client, auth_headers, sample_business):
    resp = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["business_id"] == str(sample_business.id)
    assert data["status"] == "eligibility_assessed"


@pytest.mark.asyncio
async def test_create_grant_invalid_business(client, auth_headers):
    fake_id = str(uuid.uuid4())
    resp = await client.post(
        "/grants/",
        json={"business_id": fake_id},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_grants(client, auth_headers, sample_business):
    # Create 2 grants
    for _ in range(2):
        await client.post(
            "/grants/",
            json={"business_id": str(sample_business.id)},
            headers=auth_headers,
        )
    resp = await client.get("/grants/", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


@pytest.mark.asyncio
async def test_list_grants_filter_status(
    client, auth_headers, sample_business, db_session
):
    # Create a grant via API (starts as eligibility_assessed)
    resp1 = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    grant_id = resp1.json()["id"]

    # Transition the first grant to intake
    await client.patch(
        f"/grants/{grant_id}/stage",
        json={"new_stage": "intake"},
        headers=auth_headers,
    )

    # Create a second grant (stays at eligibility_assessed)
    await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )

    # Filter by intake
    resp = await client.get(
        "/grants/", params={"status": "intake"}, headers=auth_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["status"] == "intake"


@pytest.mark.asyncio
async def test_get_grant_detail(client, auth_headers, sample_business):
    create_resp = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    grant_id = create_resp.json()["id"]

    resp = await client.get(f"/grants/{grant_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == grant_id
    assert data["business_id"] == str(sample_business.id)


@pytest.mark.asyncio
async def test_update_grant(client, auth_headers, sample_business):
    create_resp = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    grant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/grants/{grant_id}",
        json={
            "total_project_cost": 200000.0,
            "project_description": "Storefront renovation",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_project_cost"] == 200000.0
    assert data["project_description"] == "Storefront renovation"


@pytest.mark.asyncio
async def test_stage_transition_valid(client, auth_headers, sample_business):
    create_resp = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    grant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/grants/{grant_id}/stage",
        json={"new_stage": "intake"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["new_stage"] == "intake"


@pytest.mark.asyncio
async def test_stage_transition_invalid(client, auth_headers, sample_business):
    create_resp = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    grant_id = create_resp.json()["id"]

    # eligibility_assessed -> alumnus is not allowed
    resp = await client.patch(
        f"/grants/{grant_id}/stage",
        json={"new_stage": "alumnus"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_grant_board(client, auth_headers, sample_business):
    # Create a grant so there's data
    await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )

    resp = await client.get("/grants/board", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "columns" in data
    # Should have columns for all stages
    assert len(data["columns"]) > 0
    # The eligibility_assessed column should have 1 card
    ea_col = next(
        (c for c in data["columns"] if c["stage"] == "eligibility_assessed"), None
    )
    assert ea_col is not None
    assert ea_col["count"] == 1
    assert len(ea_col["cards"]) == 1


@pytest.mark.asyncio
async def test_get_grant_financials(client, auth_headers, sample_business):
    create_resp = await client.post(
        "/grants/",
        json={
            "business_id": str(sample_business.id),
            "total_project_cost": 200000.0,
        },
        headers=auth_headers,
    )
    grant_id = create_resp.json()["id"]

    resp = await client.get(f"/grants/financials/{grant_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["base_grant"] == 150000.0
    assert data["taf_eligible"] == 30000.0
    assert data["owner_contribution"] == 50000.0


@pytest.mark.asyncio
async def test_get_grant_documents(client, auth_headers, sample_business):
    create_resp = await client.post(
        "/grants/",
        json={"business_id": str(sample_business.id)},
        headers=auth_headers,
    )
    grant_id = create_resp.json()["id"]

    resp = await client.get(f"/grants/{grant_id}/documents", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data == []


@pytest.mark.asyncio
async def test_grant_auth_required(client):
    # No auth headers → 401
    resp = await client.get("/grants/")
    assert resp.status_code == 401

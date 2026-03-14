import uuid


class TestListBusinesses:
    async def test_list_empty(self, client, auth_headers):
        resp = await client.get("/businesses", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    async def test_list_returns_business(self, client, auth_headers, sample_business):
        resp = await client.get("/businesses", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Test Barbershop"
        assert data["items"][0]["zip_code"] == "60619"

    async def test_filter_by_zip(self, client, auth_headers, sample_business):
        resp = await client.get("/businesses?zip_code=99999", headers=auth_headers)
        assert resp.json()["total"] == 0

        resp = await client.get("/businesses?zip_code=60619", headers=auth_headers)
        assert resp.json()["total"] == 1

    async def test_filter_by_niche(self, client, auth_headers, sample_business):
        resp = await client.get("/businesses?niche=barbershops", headers=auth_headers)
        assert resp.json()["total"] == 1

        resp = await client.get("/businesses?niche=nail_salons", headers=auth_headers)
        assert resp.json()["total"] == 0

    async def test_search_by_name(self, client, auth_headers, sample_business):
        resp = await client.get("/businesses?search=barbershop", headers=auth_headers)
        assert resp.json()["total"] == 1

        resp = await client.get("/businesses?search=nonexistent", headers=auth_headers)
        assert resp.json()["total"] == 0

    async def test_pagination(self, client, auth_headers, sample_business):
        resp = await client.get("/businesses?page=1&page_size=1", headers=auth_headers)
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["page"] == 1

    async def test_requires_auth(self, client, sample_business):
        resp = await client.get("/businesses", headers={"X-API-Key": "wrong"})
        assert resp.status_code == 401


class TestGetBusiness:
    async def test_get_detail(self, client, auth_headers, sample_business):
        resp = await client.get(
            f"/businesses/{sample_business.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Test Barbershop"
        assert data["zip_code"] == "60619"
        assert data["niche"] == "barbershops"

    async def test_not_found(self, client, auth_headers):
        resp = await client.get(f"/businesses/{uuid.uuid4()}", headers=auth_headers)
        assert resp.status_code == 404


class TestUpdateBusiness:
    async def test_patch_fields(self, client, auth_headers, sample_business):
        resp = await client.patch(
            f"/businesses/{sample_business.id}",
            json={"name": "Updated Name", "phone": "(312) 555-9999"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Updated Name"
        assert data["phone"] == "(312) 555-9999"

    async def test_patch_not_found(self, client, auth_headers):
        resp = await client.patch(
            f"/businesses/{uuid.uuid4()}",
            json={"name": "X"},
            headers=auth_headers,
        )
        assert resp.status_code == 404

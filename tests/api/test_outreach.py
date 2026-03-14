import uuid

import pytest


class TestOutreachByBusiness:
    async def test_empty_history(self, client, auth_headers, sample_business):
        resp = await client.get(f"/outreach/by-business/{sample_business.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0

    async def test_with_outreach(self, client, auth_headers, sample_outreach):
        resp = await client.get(
            f"/outreach/by-business/{sample_outreach.business_id}",
            headers=auth_headers,
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["status"] == "scored"


class TestGetOutreach:
    async def test_get_detail(self, client, auth_headers, sample_outreach):
        resp = await client.get(f"/outreach/{sample_outreach.id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "scored"

    async def test_not_found(self, client, auth_headers):
        resp = await client.get(f"/outreach/{uuid.uuid4()}", headers=auth_headers)
        assert resp.status_code == 404


class TestGetTranscript:
    async def test_transcript(self, client, auth_headers, sample_outreach):
        resp = await client.get(f"/outreach/{sample_outreach.id}/transcript", headers=auth_headers)
        assert resp.status_code == 200
        assert "transcript" in resp.json()

    async def test_not_found(self, client, auth_headers):
        resp = await client.get(f"/outreach/{uuid.uuid4()}/transcript", headers=auth_headers)
        assert resp.status_code == 404


class TestUpdateOutreach:
    async def test_update_notes(self, client, auth_headers, sample_outreach):
        resp = await client.patch(
            f"/outreach/{sample_outreach.id}",
            json={"notes": "Follow up next week", "assigned_to": "john@example.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["notes"] == "Follow up next week"
        assert data["assigned_to"] == "john@example.com"

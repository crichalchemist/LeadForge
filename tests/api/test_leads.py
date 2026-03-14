import uuid

import pytest


class TestRankedLeads:
    async def test_ranked_empty(self, client, auth_headers):
        resp = await client.get("/leads/ranked", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0

    async def test_ranked_with_scores(self, client, auth_headers, sample_business_with_score):
        biz, score = sample_business_with_score
        resp = await client.get("/leads/ranked", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["business_name"] == "Test Barbershop"
        assert data["items"][0]["composite_acquisition_score"] == pytest.approx(48.25)

    async def test_filter_by_min_score(self, client, auth_headers, sample_business_with_score):
        resp = await client.get("/leads/ranked?min_score=50", headers=auth_headers)
        assert resp.json()["total"] == 0

        resp = await client.get("/leads/ranked?min_score=40", headers=auth_headers)
        assert resp.json()["total"] == 1

    async def test_filter_by_price_tier(self, client, auth_headers, sample_business_with_score):
        resp = await client.get("/leads/ranked?price_tier=2", headers=auth_headers)
        assert resp.json()["total"] == 1

        resp = await client.get("/leads/ranked?price_tier=1", headers=auth_headers)
        assert resp.json()["total"] == 0


class TestScoreHistory:
    async def test_score_history(self, client, auth_headers, sample_business_with_score):
        biz, _ = sample_business_with_score
        resp = await client.get(f"/leads/{biz.id}/score", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["score_version"] == 1

    async def test_no_scores(self, client, auth_headers, sample_business):
        resp = await client.get(f"/leads/{sample_business.id}/score", headers=auth_headers)
        assert resp.status_code == 404

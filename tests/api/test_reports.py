class TestFunnel:
    async def test_empty_funnel(self, client, auth_headers):
        resp = await client.get("/reports/funnel", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert len(data["stages"]) == 12

    async def test_funnel_with_data(self, client, auth_headers, sample_outreach):
        resp = await client.get("/reports/funnel", headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1
        scored = next(s for s in data["stages"] if s["stage"] == "scored")
        assert scored["count"] == 1


class TestScoreDistribution:
    async def test_empty_distribution(self, client, auth_headers):
        resp = await client.get("/reports/score-distribution", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0

    async def test_with_scores(self, client, auth_headers, sample_business_with_score):
        resp = await client.get("/reports/score-distribution", headers=auth_headers)
        data = resp.json()
        assert data["total"] == 1
        assert data["mean"] is not None


class TestZipPerformance:
    async def test_empty(self, client, auth_headers):
        resp = await client.get("/reports/zip-performance", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["items"] == []

    async def test_with_data(self, client, auth_headers, sample_business_with_score):
        resp = await client.get("/reports/zip-performance", headers=auth_headers)
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["zip_code"] == "60619"
        assert data["items"][0]["total_leads"] == 1

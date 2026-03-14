import uuid


class TestPipelineBoard:
    async def test_empty_board(self, client, auth_headers):
        resp = await client.get("/pipeline/board", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["columns"]) == 12  # All PipelineStage values

    async def test_board_with_data(self, client, auth_headers, sample_outreach):
        resp = await client.get("/pipeline/board", headers=auth_headers)
        data = resp.json()
        scored_col = next(c for c in data["columns"] if c["stage"] == "scored")
        assert scored_col["count"] == 1
        assert len(scored_col["cards"]) == 1
        assert scored_col["cards"][0]["business_name"] == "Test Barbershop"


class TestStageTransition:
    async def test_valid_transition(self, client, auth_headers, sample_outreach):
        resp = await client.patch(
            f"/pipeline/{sample_outreach.id}/stage",
            json={"new_stage": "queued"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["new_stage"] == "queued"

    async def test_invalid_transition(self, client, auth_headers, sample_outreach):
        # scored -> won is not valid
        resp = await client.patch(
            f"/pipeline/{sample_outreach.id}/stage",
            json={"new_stage": "won"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_invalid_stage_name(self, client, auth_headers, sample_outreach):
        resp = await client.patch(
            f"/pipeline/{sample_outreach.id}/stage",
            json={"new_stage": "nonexistent"},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    async def test_not_found(self, client, auth_headers):
        resp = await client.patch(
            f"/pipeline/{uuid.uuid4()}/stage",
            json={"new_stage": "queued"},
            headers=auth_headers,
        )
        assert resp.status_code == 404

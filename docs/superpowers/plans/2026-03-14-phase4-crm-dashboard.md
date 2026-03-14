# Phase 4: CRM + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full FastAPI REST API, React+Tailwind CRM dashboard (dark terminal aesthetic per FDS v2.2), and fix backend gaps identified in the PRD v2.2 gap analysis — delivering a working pipeline board, lead detail, outreach view, reports, and scrape control.

**Architecture:** Backend-first: fix critical gaps (OpenRouter, config, API mismatches), then build FastAPI CRUD routes with Pydantic v2 schemas, then React SPA consuming those endpoints. The frontend follows FDS v2.2 exactly — 5 views (Pipeline, Leads, Outreach, Reports, Scrape Control), dark terminal aesthetic, JetBrains Mono + Space Grotesk, CSS custom properties for the color system.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / SQLAlchemy async / Celery Beat / React 18 / TypeScript / Vite / Tailwind CSS / @tanstack/react-query / @dnd-kit/core / recharts

**Reference documents:**
- FDS v2.2: `docs/specs/LeadForge_FDS_v2.2.docx`
- PRD v2.2: `docs/LeadForge_PRD_v2.2.docx`
- HTML prototype: `docs/specs/leadforge-crm-prototype.html`
- Gap analysis: see conversation context (10 gaps G1–G10 identified)

---

## Pre-Phase: Gap Fixes (G1–G3, G4, G9, G10)

These must land before Phase 4 API routes because they fix broken interfaces and missing infrastructure that the API will depend on.

---

### Task 1: OpenRouter Client + Config Overhaul (G1, G2)

Replace the direct Anthropic SDK usage with an OpenRouter client that routes to per-task models. OpenRouter uses the OpenAI-compatible chat completions API at `https://openrouter.ai/api/v1`.

**Files:**
- Create: `src/leadforge/llm/openrouter_client.py`
- Modify: `src/leadforge/config.py`
- Modify: `src/leadforge/llm/gbp_assessment.py`
- Modify: `src/leadforge/llm/sentiment.py`
- Modify: `src/leadforge/llm/outreach_brief.py`
- Delete: `src/leadforge/llm/claude_client.py` (replaced by openrouter_client)
- Test: `tests/unit/test_openrouter_client.py`

- [ ] **Step 1: Update `config.py` with all missing settings**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://leadforge:leadforge@localhost:5432/leadforge"
    REDIS_URL: str = "redis://localhost:6379/0"

    # Scraper API keys
    SOCRATA_APP_TOKEN: str = ""
    GOOGLE_PLACES_API_KEY: str = ""
    YELP_API_KEY: str = ""
    CENSUS_API_KEY: str = ""

    # OpenRouter (unified LLM gateway)
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # Per-task model routing (PRD v2.2 Section 4.2)
    OPENROUTER_BRIEF_MODEL: str = "anthropic/claude-sonnet-4-5"  # quality-critical, no downgrade
    OPENROUTER_GBP_MODEL: str = "deepseek/deepseek-chat-v3-0324"  # structured classification
    OPENROUTER_SENTIMENT_MODEL: str = "deepseek/deepseek-chat-v3-0324"  # pattern-heavy
    OPENROUTER_SENTIMENT_FALLBACK_MODEL: str = "google/gemini-2.5-pro-preview-05-06"

    # Local vLLM (entity resolution, extraction, revenue estimation)
    VLLM_BASE_URL: str = "http://localhost:8000/v1"
    VLLM_MODEL: str = "default"

    # Voice outreach
    RETELL_API_KEY: str = ""

    # Rate limiting
    SOCRATA_PAGE_SIZE: int = 1000
    GOOGLE_PLACES_MAX_CONCURRENT: int = 5


settings = Settings()
```

- [ ] **Step 2: Write failing test for OpenRouter client**

```python
# tests/unit/test_openrouter_client.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from leadforge.llm.openrouter_client import OpenRouterClient


class TestOpenRouterClient:

    @pytest.mark.asyncio
    async def test_complete_returns_content(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "test response"}}]
        }

        client = OpenRouterClient(api_key="test-key", base_url="http://fake")
        with patch.object(client, '_get_client') as mock_get:
            mock_http = AsyncMock()
            mock_http.post.return_value = mock_response
            mock_get.return_value = mock_http
            result = await client.complete("test prompt", model="test-model")
            assert result == "test response"
        await client.close()

    @pytest.mark.asyncio
    async def test_complete_returns_none_on_error(self):
        client = OpenRouterClient(api_key="test-key", base_url="http://fake")
        with patch.object(client, '_get_client') as mock_get:
            mock_http = AsyncMock()
            mock_http.post.side_effect = httpx.HTTPError("fail")
            mock_get.return_value = mock_http
            result = await client.complete("test", model="test-model")
            assert result is None
        await client.close()

    @pytest.mark.asyncio
    async def test_complete_with_empty_choices(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"choices": []}

        client = OpenRouterClient(api_key="test-key", base_url="http://fake")
        with patch.object(client, '_get_client') as mock_get:
            mock_http = AsyncMock()
            mock_http.post.return_value = mock_response
            mock_get.return_value = mock_http
            result = await client.complete("test", model="test-model")
            assert result is None
        await client.close()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run python -m pytest tests/unit/test_openrouter_client.py -v`
Expected: FAIL — `openrouter_client` module doesn't exist

- [ ] **Step 4: Create `openrouter_client.py`**

```python
# src/leadforge/llm/openrouter_client.py
import structlog
import httpx
from leadforge.config import settings

logger = structlog.get_logger()


class OpenRouterClient:
    """OpenAI-compatible client routed through OpenRouter.

    OpenRouter provides unified billing, automatic provider fallback,
    and per-task model selection via the same chat completions API.
    """

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or settings.OPENROUTER_API_KEY
        self.base_url = base_url or settings.OPENROUTER_BASE_URL
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=60.0,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "HTTP-Referer": "https://leadforge.internal",
                    "X-Title": "LeadForge",
                },
            )
        return self._client

    async def complete(
        self,
        prompt: str,
        model: str,
        max_tokens: int = 1000,
        temperature: float = 0.3,
    ) -> str | None:
        """Generate completion via OpenRouter (OpenAI-compatible)."""
        try:
            client = await self._get_client()
            response = await client.post(
                "/chat/completions",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            data = response.json()
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
            return None
        except Exception as e:
            logger.warning("openrouter_completion_failed", model=model, error=str(e))
            return None

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run python -m pytest tests/unit/test_openrouter_client.py -v`
Expected: 3 passed

- [ ] **Step 6: Migrate `gbp_assessment.py` to OpenRouter**

Replace `from leadforge.llm.claude_client import ClaudeClient` with `from leadforge.llm.openrouter_client import OpenRouterClient`. Change the function signature to accept `OpenRouterClient`, use `settings.OPENROUTER_GBP_MODEL` as the model.

```python
# src/leadforge/llm/gbp_assessment.py
import json
import structlog
from leadforge.llm.openrouter_client import OpenRouterClient
from leadforge.config import settings
from leadforge.db.models.digital_presence import DigitalPresence

logger = structlog.get_logger()

GBP_ASSESSMENT_PROMPT = """Assess the Google Business Profile completeness for this business.

Business data:
- Has GBP: {has_gbp}
- Review count: {review_count}
- Average rating: {rating}
- Has website linked: {has_website}
- Has phone: {has_phone}

Rate the GBP completeness from 0.0 to 1.0 and list missing elements.
Respond with ONLY a JSON object:
{{"completeness_score": 0.0-1.0, "missing_elements": ["list of missing items"], "recommendations": ["list of improvement suggestions"]}}
"""


async def assess_gbp(dp: DigitalPresence, has_phone: bool = False, client: OpenRouterClient | None = None) -> dict:
    """Assess Google Business Profile completeness via OpenRouter."""
    prompt = GBP_ASSESSMENT_PROMPT.format(
        has_gbp=dp.has_google_business_profile,
        review_count=dp.google_review_count or 0,
        rating=dp.google_avg_rating or "N/A",
        has_website=dp.has_website,
        has_phone=has_phone,
    )

    own_client = client is None
    if own_client:
        client = OpenRouterClient()

    try:
        response = await client.complete(
            prompt,
            model=settings.OPENROUTER_GBP_MODEL,
            max_tokens=500,
        )
        if not response:
            return {"completeness_score": 0.0, "missing_elements": ["Assessment unavailable"], "recommendations": []}

        return json.loads(response.strip())
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("gbp_assessment_failed", error=str(e))
        return {"completeness_score": 0.0, "missing_elements": ["Assessment failed"], "recommendations": []}
    finally:
        if own_client:
            await client.close()
```

- [ ] **Step 7: Migrate `sentiment.py` to OpenRouter**

Same pattern — replace ClaudeClient with OpenRouterClient, use `settings.OPENROUTER_SENTIMENT_MODEL`.

```python
# src/leadforge/llm/sentiment.py
import json
import structlog
from leadforge.llm.openrouter_client import OpenRouterClient
from leadforge.config import settings

logger = structlog.get_logger()

SENTIMENT_PROMPT = """Analyze this call transcript between a marketing agent and a small business owner.

Transcript:
{transcript}

Analyze and respond with ONLY a JSON object:
{{
    "sentiment_score": -1.0 to 1.0 (hostile=-1, dismissive=-0.5, neutral=0, curious=0.3, interested=0.6, enthusiastic=1.0),
    "sentiment_label": "hostile|dismissive|neutral|curious|interested|enthusiastic",
    "objections": ["list of objections raised"],
    "interest_signals": ["list of positive signals"],
    "purchase_intent": "none|low|medium|high",
    "recommended_action": "immediate|scheduled|deprioritize|disqualify",
    "summary": "1-2 sentence summary of the call outcome"
}}
"""


async def analyze_sentiment(transcript: str, client: OpenRouterClient | None = None) -> dict:
    """Analyze call transcript sentiment via OpenRouter."""
    if not transcript or not transcript.strip():
        return _empty_sentiment()

    prompt = SENTIMENT_PROMPT.format(transcript=transcript[:8000])

    own_client = client is None
    if own_client:
        client = OpenRouterClient()

    try:
        response = await client.complete(
            prompt,
            model=settings.OPENROUTER_SENTIMENT_MODEL,
            max_tokens=500,
            temperature=0.1,
        )
        if not response:
            return _empty_sentiment()

        result = json.loads(response.strip())
        score = result.get("sentiment_score", 0.0)
        result["sentiment_score"] = max(-1.0, min(1.0, score))
        return result
    except (json.JSONDecodeError, Exception) as e:
        logger.warning("sentiment_analysis_failed", error=str(e))
        return _empty_sentiment()
    finally:
        if own_client:
            await client.close()


def _empty_sentiment() -> dict:
    """Return default sentiment when analysis is unavailable."""
    return {
        "sentiment_score": 0.0,
        "sentiment_label": "neutral",
        "objections": [],
        "interest_signals": [],
        "purchase_intent": "none",
        "recommended_action": "deprioritize",
        "summary": "Sentiment analysis unavailable",
    }
```

- [ ] **Step 8: Migrate `outreach_brief.py` to OpenRouter**

Same pattern — use `settings.OPENROUTER_BRIEF_MODEL` (Claude Sonnet, quality-critical).

Replace `from leadforge.llm.claude_client import ClaudeClient` with `from leadforge.llm.openrouter_client import OpenRouterClient` and pass the model. Full file rewrite — same content as current but with OpenRouterClient and `settings.OPENROUTER_BRIEF_MODEL`.

- [ ] **Step 9: Delete `claude_client.py`**

```bash
rm src/leadforge/llm/claude_client.py
```

- [ ] **Step 10: Remove `anthropic` from dependencies, add `openai` (optional)**

In `pyproject.toml`, remove `"anthropic>=0.42.0"` from dependencies. The OpenRouter client uses raw `httpx` (already a dependency), no new packages needed.

- [ ] **Step 11: Update existing tests that reference ClaudeClient**

In `tests/unit/test_webhook_handler.py`, the webhook handler tests don't directly reference ClaudeClient. Check `tests/unit/test_sentiment_feedback.py` — no ClaudeClient references. Grep for any remaining `claude_client` imports across tests and fix.

- [ ] **Step 12: Run full test suite**

Run: `uv run python -m pytest tests/ -v`
Expected: All tests pass (some may need mock updates for OpenRouterClient)

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "Replace Anthropic SDK with OpenRouter routing layer (G1, G2)

- Add OpenRouterClient with per-task model routing
- Expand Settings with all API keys and model IDs
- Migrate gbp_assessment, sentiment, outreach_brief to OpenRouter
- Delete claude_client.py, remove anthropic dependency
- PRD v2.2: DeepSeek V3.2 for GBP/sentiment, Claude Sonnet for briefs"
```

---

### Task 2: Fix API Mismatches (G3, G4, G9, G10)

Fix the `create_agent` signature mismatch, competitive pressure digital comparison, call_manager brief context, and add score grade utility.

**Files:**
- Modify: `src/leadforge/voice/retell_client.py:26` (fix `create_agent` param names)
- Modify: `src/leadforge/scoring/competitive_pressure.py:28-33` (fix digital comparison)
- Modify: `src/leadforge/voice/call_manager.py:98-101` (pass full score context to brief)
- Create: `src/leadforge/scoring/grade.py` (score grade A/B/C utility)
- Test: `tests/unit/test_grade.py`

- [ ] **Step 1: Fix `retell_client.py` create_agent parameter names**

The callers pass `name=` and `prompt=`, but the method signature uses `agent_name` and `system_prompt`. Rename to match callers:

In `src/leadforge/voice/retell_client.py`, change line 26:
```python
# FROM:
async def create_agent(self, agent_name: str, system_prompt: str, voice_id: str = "11labs-Rachel") -> dict | None:
# TO:
async def create_agent(self, name: str, prompt: str, voice_id: str = "11labs-Rachel") -> dict | None:
```
And update the JSON body inside to use `name` and `prompt` instead of `agent_name` and `system_prompt`:
```python
response = await client.post("/create-agent", json={
    "agent_name": name,
    "voice_id": voice_id,
    "response_engine": {"type": "retell-llm", "llm_id": ""},
    "general_prompt": prompt,
})
```

- [ ] **Step 2: Fix competitive pressure digital comparison**

In `src/leadforge/scoring/competitive_pressure.py`, replace lines 28-33:
```python
# FROM:
if dp and context.avg_digital_score is not None:
    business_deficit = dp.google_review_count or 0
    if context.avg_digital_score is not None and business_deficit < context.avg_digital_score:
        score += 25

# TO:
if dp and context.avg_digital_score is not None:
    from leadforge.scoring.digital_deficit import compute_digital_deficit
    business_deficit = compute_digital_deficit(dp)
    if business_deficit < context.avg_digital_score:
        score += 25
```

Note: The PRD says "+25 if business digital score < zip_niche_avg". Since higher digital deficit = weaker digital presence, a business with a LOWER deficit than average actually has BETTER digital presence. We need the inverse: business with HIGHER deficit than average means competitors are stronger. Fix:

```python
if dp and context.avg_digital_score is not None:
    from leadforge.scoring.digital_deficit import compute_digital_deficit
    business_deficit = compute_digital_deficit(dp)
    # Higher deficit = weaker digital presence
    # If business deficit > zip avg, competitors are doing better digitally
    if business_deficit > context.avg_digital_score:
        score += 25
```

Wait — re-reading the PRD: "Competitors have stronger digital presence: business digital score < zip_niche_avg → +25". The "digital score" here is inverted from deficit — it's a strength metric. But we only have deficit. So: if business deficit > avg deficit, competitors are better. This is correct as written above.

- [ ] **Step 3: Fix `call_manager.py` to pass score context to outreach brief**

In `src/leadforge/voice/call_manager.py`, update `initiate_call` to fetch the lead score and pass context:

```python
# Around line 98-101, change:
brief = await generate_outreach_brief(business, dp)

# To:
from leadforge.db.models.lead_score import LeadScore
score_result = await session.execute(
    select(LeadScore)
    .where(LeadScore.business_id == business.id)
    .order_by(LeadScore.score_version.desc())
    .limit(1)
)
lead_score = score_result.scalar_one_or_none()
brief = await generate_outreach_brief(
    business, dp,
    deficit_score=lead_score.digital_deficit_score if lead_score else 0.0,
    pressure_score=lead_score.competitive_pressure_score if lead_score else 0.0,
    price_tier=lead_score.price_tier if lead_score else 1,
)
```

Also add the missing import at the top of the function or file: `from sqlalchemy import select`.

- [ ] **Step 4: Write test for score grade utility**

```python
# tests/unit/test_grade.py
import pytest
from leadforge.scoring.grade import score_to_grade


class TestScoreGrade:

    def test_grade_a(self):
        assert score_to_grade(80) == "A"
        assert score_to_grade(100) == "A"
        assert score_to_grade(92.5) == "A"

    def test_grade_b(self):
        assert score_to_grade(60) == "B"
        assert score_to_grade(79) == "B"
        assert score_to_grade(70.0) == "B"

    def test_grade_c(self):
        assert score_to_grade(40) == "C"
        assert score_to_grade(59) == "C"

    def test_below_threshold(self):
        assert score_to_grade(39) == "C"
        assert score_to_grade(0) == "C"

    def test_none_returns_c(self):
        assert score_to_grade(None) == "C"
```

- [ ] **Step 5: Create `scoring/grade.py`**

```python
# src/leadforge/scoring/grade.py
def score_to_grade(score: float | None) -> str:
    """Convert composite acquisition score to letter grade per FDS v2.2.

    A: 80-100, B: 60-79, C: 40-59 (and below).
    """
    if score is None or score < 60:
        return "C"
    if score < 80:
        return "B"
    return "A"
```

- [ ] **Step 6: Run all tests**

Run: `uv run python -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Fix API mismatches: retell params, digital comparison, brief context, score grade (G3,G4,G9,G10)"
```

---

## Chunk 1: API Schemas + Routes

### Task 3: Pydantic v2 API Schemas

**Files:**
- Create: `src/leadforge/api/schemas/__init__.py`
- Create: `src/leadforge/api/schemas/business.py`
- Create: `src/leadforge/api/schemas/lead_score.py`
- Create: `src/leadforge/api/schemas/outreach.py`
- Create: `src/leadforge/api/schemas/pipeline.py`
- Create: `src/leadforge/api/schemas/reports.py`
- Create: `src/leadforge/api/schemas/common.py`

- [ ] **Step 1: Create common schemas (pagination, filters)**

```python
# src/leadforge/api/schemas/common.py
from pydantic import BaseModel


class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 50


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    page_size: int
    total_pages: int
```

- [ ] **Step 2: Create business schemas**

```python
# src/leadforge/api/schemas/business.py
import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class DigitalPresenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    has_website: bool
    website_url: str | None
    website_quality_score: float | None
    has_ssl: bool | None
    has_google_business_profile: bool
    gbp_completeness_score: float | None
    google_review_count: int | None
    google_avg_rating: float | None
    has_facebook_page: bool
    has_instagram: bool
    fb_last_post_days_ago: int | None
    has_google_ads: bool
    has_meta_ads: bool
    yelp_review_count: int | None
    yelp_rating: float | None


class LeadScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    score_version: int
    digital_deficit_score: float | None
    viability_score: float | None
    competitive_pressure_score: float | None
    composite_acquisition_score: float | None
    price_tier: int | None
    sentiment_adjustment: float | None


class BusinessSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    address: str | None
    zip_code: str
    phone: str | None
    niche: str
    composite_score: float | None = None
    price_tier: int | None = None
    score_grade: str | None = None
    pipeline_stage: str | None = None


class BusinessDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime | None = None
    name: str
    address: str | None
    zip_code: str
    phone: str | None
    email: str | None
    owner_name: str | None
    niche: str
    license_number: str | None
    license_status: str | None
    google_place_id: str | None
    estimated_monthly_revenue: float | None
    employee_count_est: int | None
    total_customer_ugc: int | None
    digital_presence: DigitalPresenceOut | None = None
    latest_score: LeadScoreOut | None = None
    score_grade: str | None = None


class BusinessUpdate(BaseModel):
    phone: str | None = None
    email: str | None = None
    owner_name: str | None = None
    notes: str | None = None
```

- [ ] **Step 3: Create outreach schemas**

```python
# src/leadforge/api/schemas/outreach.py
import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class OutreachRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    business_id: uuid.UUID
    status: str
    retell_call_id: str | None
    first_contact_date: datetime | None
    last_contact_date: datetime | None
    contact_method: str | None
    call_sentiment_score: float | None
    call_disposition: str | None
    call_attempts: int
    meeting_scheduled: bool
    meeting_type: str | None
    meeting_datetime: datetime | None
    assigned_to: str | None
    notes: str | None
    proposal_amount: float | None
    contract_amount: float | None


class OutreachUpdate(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    notes: str | None = None
    meeting_scheduled: bool | None = None
    meeting_type: str | None = None
    meeting_datetime: datetime | None = None
    proposal_amount: float | None = None
    contract_amount: float | None = None
    lost_reason: str | None = None


class CallLogEntry(BaseModel):
    business_id: uuid.UUID
    business_name: str
    niche: str
    call_disposition: str | None
    call_sentiment_score: float | None
    call_attempts: int
    retell_call_id: str | None
    last_contact_date: datetime | None
```

- [ ] **Step 4: Create pipeline schemas**

```python
# src/leadforge/api/schemas/pipeline.py
from pydantic import BaseModel


class PipelineStageCount(BaseModel):
    stage: str
    count: int


class PipelineBoardResponse(BaseModel):
    stages: list[PipelineStageCount]
    total: int


class StageTransition(BaseModel):
    new_stage: str
```

- [ ] **Step 5: Create reports schemas**

```python
# src/leadforge/api/schemas/reports.py
from pydantic import BaseModel


class FunnelStage(BaseModel):
    stage: str
    count: int
    pct_of_total: float


class ScoreCalibrationPoint(BaseModel):
    composite_score: float
    outcome: int  # 1=won, 0=lost


class OutreachEfficiencyMetrics(BaseModel):
    total_calls: int
    answer_rate: float
    meeting_rate: float
    close_rate: float


class RevenueByTier(BaseModel):
    tier: int
    pipeline_value: float
    won_value: float
    count: int
```

- [ ] **Step 6: Create `__init__.py`**

```python
# src/leadforge/api/schemas/__init__.py
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add Pydantic v2 API schemas for all CRM entities"
```

---

### Task 4: Business + Lead API Routes

**Files:**
- Create: `src/leadforge/api/routes/__init__.py`
- Create: `src/leadforge/api/routes/businesses.py`
- Create: `src/leadforge/api/routes/leads.py`
- Create: `src/leadforge/api/routes/health.py`
- Modify: `src/leadforge/api/app.py` (mount all routers, add CORS, API key auth)
- Modify: `src/leadforge/api/deps.py` (add API key auth dependency)
- Test: `tests/api/test_businesses.py`
- Test: `tests/api/__init__.py`

- [ ] **Step 1: Add API key auth to `deps.py`**

```python
# src/leadforge/api/deps.py
from fastapi import Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from leadforge.db.session import async_session
from leadforge.config import settings


async def get_db() -> AsyncSession:
    """FastAPI dependency that provides a database session."""
    async with async_session() as session:
        yield session


async def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")) -> str:
    """Verify API key from header. Phase 4 MVP auth."""
    expected = getattr(settings, 'API_KEY', '')
    if not expected or x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key
```

Also add `API_KEY: str = ""` to `config.py` Settings class.

- [ ] **Step 2: Create health route**

```python
# src/leadforge/api/routes/health.py
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return {"status": "ok"}
```

- [ ] **Step 3: Create businesses route**

```python
# src/leadforge/api/routes/businesses.py
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.api.deps import get_db
from leadforge.api.schemas.business import BusinessSummary, BusinessDetail, BusinessUpdate
from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import OutreachRecord
from leadforge.scoring.grade import score_to_grade

router = APIRouter(prefix="/api/businesses", tags=["businesses"])


@router.get("", response_model=dict)
async def list_businesses(
    session: AsyncSession = Depends(get_db),
    zip_code: str | None = Query(None),
    niche: str | None = Query(None),
    min_score: float | None = Query(None),
    stage: str | None = Query(None),
    search: str | None = Query(None),
    sort_by: str = Query("score"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List businesses with filters, pagination, and sorting."""
    query = (
        select(Business, LeadScore, OutreachRecord)
        .outerjoin(LeadScore, Business.id == LeadScore.business_id)
        .outerjoin(OutreachRecord, Business.id == OutreachRecord.business_id)
    )

    # Filters
    if zip_code:
        query = query.where(Business.zip_code == zip_code)
    if niche:
        query = query.where(Business.niche == NicheType(niche))
    if min_score is not None:
        query = query.where(LeadScore.composite_acquisition_score >= min_score)
    if stage:
        query = query.where(OutreachRecord.status == stage)
    if search:
        query = query.where(Business.name.ilike(f"%{search}%"))

    # Count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar() or 0

    # Sort
    if sort_by == "score":
        query = query.order_by(LeadScore.composite_acquisition_score.desc().nullslast())
    elif sort_by == "name":
        query = query.order_by(Business.name)
    elif sort_by == "created":
        query = query.order_by(Business.created_at.desc())

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await session.execute(query)
    rows = result.all()

    items = []
    for business, score, outreach in rows:
        items.append(BusinessSummary(
            id=business.id,
            name=business.name,
            address=business.address,
            zip_code=business.zip_code,
            phone=business.phone,
            niche=business.niche.value,
            composite_score=score.composite_acquisition_score if score else None,
            price_tier=score.price_tier if score else None,
            score_grade=score_to_grade(score.composite_acquisition_score if score else None),
            pipeline_stage=outreach.status.value if outreach else "scored",
        ))

    return {
        "items": [item.model_dump() for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{business_id}", response_model=BusinessDetail)
async def get_business(
    business_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get full business detail with digital presence and latest score."""
    result = await session.execute(
        select(Business)
        .options(selectinload(Business.digital_presence))
        .options(selectinload(Business.lead_scores))
        .where(Business.id == business_id)
    )
    business = result.scalar_one_or_none()
    if not business:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Business not found")

    latest_score = max(business.lead_scores, key=lambda s: s.score_version, default=None)

    return BusinessDetail(
        id=business.id,
        created_at=business.created_at,
        name=business.name,
        address=business.address,
        zip_code=business.zip_code,
        phone=business.phone,
        email=business.email,
        owner_name=business.owner_name,
        niche=business.niche.value,
        license_number=business.license_number,
        license_status=business.license_status.value if business.license_status else None,
        google_place_id=business.google_place_id,
        estimated_monthly_revenue=business.estimated_monthly_revenue,
        employee_count_est=business.employee_count_est,
        total_customer_ugc=business.total_customer_ugc,
        digital_presence=business.digital_presence,
        latest_score=latest_score,
        score_grade=score_to_grade(latest_score.composite_acquisition_score if latest_score else None),
    )


@router.patch("/{business_id}")
async def update_business(
    business_id: uuid.UUID,
    update: BusinessUpdate,
    session: AsyncSession = Depends(get_db),
):
    """Update business fields."""
    result = await session.execute(
        select(Business).where(Business.id == business_id)
    )
    business = result.scalar_one_or_none()
    if not business:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Business not found")

    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(business, field, value)

    await session.commit()
    return {"status": "updated", "id": str(business_id)}
```

- [ ] **Step 4: Create leads route**

```python
# src/leadforge/api/routes/leads.py
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.api.deps import get_db
from leadforge.api.schemas.business import LeadScoreOut
from leadforge.db.models.business import Business
from leadforge.db.models.lead_score import LeadScore
from leadforge.scoring.grade import score_to_grade

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("/ranked")
async def get_ranked_leads(
    session: AsyncSession = Depends(get_db),
    zip_code: str | None = Query(None),
    niche: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    """Get leads ranked by composite acquisition score."""
    query = (
        select(Business, LeadScore)
        .join(LeadScore, Business.id == LeadScore.business_id)
        .order_by(LeadScore.composite_acquisition_score.desc().nullslast())
    )
    if zip_code:
        query = query.where(Business.zip_code == zip_code)
    if niche:
        from leadforge.db.models.business import NicheType
        query = query.where(Business.niche == NicheType(niche))

    query = query.limit(limit)
    result = await session.execute(query)

    leads = []
    for business, score in result.all():
        leads.append({
            "id": str(business.id),
            "name": business.name,
            "zip_code": business.zip_code,
            "niche": business.niche.value,
            "composite_score": score.composite_acquisition_score,
            "score_grade": score_to_grade(score.composite_acquisition_score),
            "price_tier": score.price_tier,
        })
    return {"leads": leads}


@router.get("/{business_id}/score-breakdown")
async def get_score_breakdown(
    business_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get detailed score breakdown for a business."""
    result = await session.execute(
        select(LeadScore)
        .where(LeadScore.business_id == business_id)
        .order_by(LeadScore.score_version.desc())
        .limit(1)
    )
    score = result.scalar_one_or_none()
    if not score:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No score found")

    return {
        "business_id": str(business_id),
        "score_version": score.score_version,
        "digital_deficit_score": score.digital_deficit_score,
        "viability_score": score.viability_score,
        "competitive_pressure_score": score.competitive_pressure_score,
        "composite_acquisition_score": score.composite_acquisition_score,
        "price_tier": score.price_tier,
        "score_grade": score_to_grade(score.composite_acquisition_score),
        "sentiment_adjustment": score.sentiment_adjustment,
    }
```

- [ ] **Step 5: Create `routes/__init__.py`**

```python
# src/leadforge/api/routes/__init__.py
```

- [ ] **Step 6: Update `app.py` — mount all routers, add CORS**

```python
# src/leadforge/api/app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from leadforge.api.routes.health import router as health_router
from leadforge.api.routes.businesses import router as businesses_router
from leadforge.api.routes.leads import router as leads_router
from leadforge.voice.webhook_handler import router as webhook_router

app = FastAPI(
    title="LeadForge API",
    description="Lead generation pipeline API",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(businesses_router)
app.include_router(leads_router)
app.include_router(webhook_router)
```

Note: Pipeline, outreach, and reports routes are added in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add business and lead API routes with CORS and auth"
```

---

### Task 5: Pipeline + Outreach + Reports API Routes

**Files:**
- Create: `src/leadforge/api/routes/pipeline.py`
- Create: `src/leadforge/api/routes/outreach.py`
- Create: `src/leadforge/api/routes/reports.py`
- Create: `src/leadforge/api/routes/scrape.py`
- Modify: `src/leadforge/api/app.py` (mount new routers)

- [ ] **Step 1: Create pipeline route**

```python
# src/leadforge/api/routes/pipeline.py
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.api.schemas.pipeline import StageTransition
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

# Valid stage transitions
VALID_TRANSITIONS = {
    PipelineStage.SCORED: [PipelineStage.QUEUED, PipelineStage.DISQUALIFIED],
    PipelineStage.QUEUED: [PipelineStage.CONTACTED, PipelineStage.DISQUALIFIED],
    PipelineStage.CONTACTED: [PipelineStage.ENGAGED, PipelineStage.VOICEMAIL, PipelineStage.DISQUALIFIED],
    PipelineStage.VOICEMAIL: [PipelineStage.CONTACTED, PipelineStage.DISQUALIFIED, PipelineStage.NURTURE],
    PipelineStage.ENGAGED: [PipelineStage.MEETING_SCHEDULED, PipelineStage.LOST, PipelineStage.NURTURE],
    PipelineStage.MEETING_SCHEDULED: [PipelineStage.PROPOSAL_SENT, PipelineStage.LOST, PipelineStage.NURTURE],
    PipelineStage.PROPOSAL_SENT: [PipelineStage.NEGOTIATING, PipelineStage.WON, PipelineStage.LOST],
    PipelineStage.NEGOTIATING: [PipelineStage.WON, PipelineStage.LOST],
    PipelineStage.NURTURE: [PipelineStage.QUEUED],
}


@router.get("/board")
async def get_pipeline_board(session: AsyncSession = Depends(get_db)):
    """Get pipeline board: counts and lead previews per stage."""
    result = await session.execute(
        select(OutreachRecord.status, func.count(OutreachRecord.id))
        .group_by(OutreachRecord.status)
    )
    stage_counts = {row[0].value: row[1] for row in result.all()}

    # Include all stages, even if 0
    stages = []
    for stage in PipelineStage:
        stages.append({"stage": stage.value, "count": stage_counts.get(stage.value, 0)})

    total = sum(s["count"] for s in stages)
    return {"stages": stages, "total": total}


@router.patch("/{outreach_id}/stage")
async def transition_stage(
    outreach_id: uuid.UUID,
    transition: StageTransition,
    session: AsyncSession = Depends(get_db),
):
    """Transition an outreach record to a new pipeline stage."""
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.id == outreach_id)
    )
    outreach = result.scalar_one_or_none()
    if not outreach:
        raise HTTPException(status_code=404, detail="Outreach record not found")

    try:
        new_stage = PipelineStage(transition.new_stage)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {transition.new_stage}")

    # Enforce valid transitions
    allowed = VALID_TRANSITIONS.get(outreach.status, [])
    if new_stage not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from {outreach.status.value} to {new_stage.value}",
        )

    outreach.status = new_stage
    await session.commit()
    return {"status": "transitioned", "new_stage": new_stage.value}
```

- [ ] **Step 2: Create outreach route**

```python
# src/leadforge/api/routes/outreach.py
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.api.deps import get_db
from leadforge.api.schemas.outreach import OutreachRecordOut, OutreachUpdate
from leadforge.db.models.outreach_record import OutreachRecord
from leadforge.db.models.business import Business

router = APIRouter(prefix="/api/outreach", tags=["outreach"])


@router.get("/by-business/{business_id}")
async def get_outreach_history(
    business_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get outreach history for a business."""
    result = await session.execute(
        select(OutreachRecord)
        .where(OutreachRecord.business_id == business_id)
        .order_by(OutreachRecord.created_at.desc())
    )
    records = result.scalars().all()
    return {"records": [OutreachRecordOut.model_validate(r).model_dump() for r in records]}


@router.get("/{outreach_id}/transcript")
async def get_transcript(
    outreach_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get call transcript for an outreach record."""
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.id == outreach_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Record not found")
    return {"transcript": record.call_transcript, "sentiment_score": record.call_sentiment_score}


@router.patch("/{outreach_id}")
async def update_outreach(
    outreach_id: uuid.UUID,
    update: OutreachUpdate,
    session: AsyncSession = Depends(get_db),
):
    """Update outreach record (notes, assignment, meeting, financials)."""
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.id == outreach_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Record not found")

    for field, value in update.model_dump(exclude_unset=True).items():
        if field == "status":
            from leadforge.db.models.outreach_record import PipelineStage
            setattr(record, field, PipelineStage(value))
        else:
            setattr(record, field, value)

    await session.commit()
    return {"status": "updated"}


@router.get("/call-log")
async def get_call_log(
    session: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
):
    """Get recent call log entries for the Outreach view."""
    result = await session.execute(
        select(OutreachRecord, Business)
        .join(Business, OutreachRecord.business_id == Business.id)
        .where(OutreachRecord.retell_call_id.isnot(None))
        .order_by(OutreachRecord.last_contact_date.desc().nullslast())
        .limit(limit)
    )
    entries = []
    for outreach, business in result.all():
        entries.append({
            "business_id": str(business.id),
            "business_name": business.name,
            "niche": business.niche.value,
            "call_disposition": outreach.call_disposition.value if outreach.call_disposition else None,
            "call_sentiment_score": outreach.call_sentiment_score,
            "call_attempts": outreach.call_attempts,
            "retell_call_id": outreach.retell_call_id,
            "last_contact_date": outreach.last_contact_date.isoformat() if outreach.last_contact_date else None,
        })
    return {"entries": entries}
```

- [ ] **Step 3: Create reports route**

```python
# src/leadforge/api/routes/reports.py
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage
from leadforge.db.models.lead_score import LeadScore

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/funnel")
async def get_funnel(session: AsyncSession = Depends(get_db)):
    """Pipeline funnel: lead count per stage with % of total."""
    result = await session.execute(
        select(OutreachRecord.status, func.count(OutreachRecord.id))
        .group_by(OutreachRecord.status)
    )
    counts = {row[0].value: row[1] for row in result.all()}
    total = sum(counts.values()) or 1

    stages = []
    for stage in PipelineStage:
        count = counts.get(stage.value, 0)
        stages.append({
            "stage": stage.value,
            "count": count,
            "pct_of_total": round(count / total * 100, 1),
        })
    return {"funnel": stages, "total": total}


@router.get("/score-calibration")
async def get_score_calibration(session: AsyncSession = Depends(get_db)):
    """Score calibration: scatter data of composite score vs outcome (won=1, lost=0)."""
    result = await session.execute(
        select(LeadScore.composite_acquisition_score, OutreachRecord.status)
        .join(OutreachRecord, LeadScore.business_id == OutreachRecord.business_id)
        .where(OutreachRecord.status.in_([PipelineStage.WON, PipelineStage.LOST]))
    )
    points = []
    for score, status in result.all():
        points.append({
            "composite_score": score,
            "outcome": 1 if status == PipelineStage.WON else 0,
        })
    return {"points": points}


@router.get("/outreach-efficiency")
async def get_outreach_efficiency(session: AsyncSession = Depends(get_db)):
    """Outreach efficiency metrics: calls, answer rate, meeting rate, close rate."""
    total_calls = (await session.execute(
        select(func.count(OutreachRecord.id)).where(OutreachRecord.retell_call_id.isnot(None))
    )).scalar() or 0

    answered = (await session.execute(
        select(func.count(OutreachRecord.id))
        .where(OutreachRecord.call_disposition == "answered")
    )).scalar() or 0

    meetings = (await session.execute(
        select(func.count(OutreachRecord.id))
        .where(OutreachRecord.meeting_scheduled == True)
    )).scalar() or 0

    won = (await session.execute(
        select(func.count(OutreachRecord.id))
        .where(OutreachRecord.status == PipelineStage.WON)
    )).scalar() or 0

    return {
        "total_calls": total_calls,
        "answer_rate": round(answered / total_calls * 100, 1) if total_calls else 0,
        "meeting_rate": round(meetings / answered * 100, 1) if answered else 0,
        "close_rate": round(won / total_calls * 100, 1) if total_calls else 0,
    }


@router.get("/revenue")
async def get_revenue(session: AsyncSession = Depends(get_db)):
    """Revenue by price tier: pipeline value and won value."""
    result = await session.execute(
        select(
            LeadScore.price_tier,
            func.sum(OutreachRecord.proposal_amount),
            func.sum(case(
                (OutreachRecord.status == PipelineStage.WON, OutreachRecord.contract_amount),
                else_=0,
            )),
            func.count(OutreachRecord.id),
        )
        .join(OutreachRecord, LeadScore.business_id == OutreachRecord.business_id)
        .group_by(LeadScore.price_tier)
    )
    tiers = []
    for tier, pipeline_val, won_val, count in result.all():
        tiers.append({
            "tier": tier,
            "pipeline_value": float(pipeline_val or 0),
            "won_value": float(won_val or 0),
            "count": count,
        })
    return {"tiers": tiers}
```

- [ ] **Step 4: Create scrape control route**

```python
# src/leadforge/api/routes/scrape.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db

router = APIRouter(prefix="/api/scrape", tags=["scrape"])


class ScrapeJobRequest(BaseModel):
    zip_codes: list[str]
    niches: list[str]
    limit: int | None = None


@router.post("/run")
async def trigger_scrape(
    request: ScrapeJobRequest,
    session: AsyncSession = Depends(get_db),
):
    """Trigger a scrape job via Celery. Returns job ID for polling."""
    from leadforge.tasks.enrichment_tasks import enrich_business_task
    # For each zip+niche combo, dispatch pipeline task
    from leadforge.tasks.celery_app import celery_app

    job_ids = []
    for zip_code in request.zip_codes:
        for niche in request.niches:
            # Use Celery send_task for the pipeline
            result = celery_app.send_task(
                "leadforge.tasks.enrichment_tasks.full_scoring_task",
                args=[zip_code, niche],
            )
            job_ids.append({"zip_code": zip_code, "niche": niche, "task_id": result.id})

    return {"jobs": job_ids}


@router.get("/status/{task_id}")
async def get_scrape_status(task_id: str):
    """Check status of a scrape job."""
    from leadforge.tasks.celery_app import celery_app
    result = celery_app.AsyncResult(task_id)
    return {
        "task_id": task_id,
        "status": result.status,
        "result": str(result.result) if result.ready() else None,
    }
```

- [ ] **Step 5: Update `app.py` to mount all routers**

```python
# src/leadforge/api/app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from leadforge.api.routes.health import router as health_router
from leadforge.api.routes.businesses import router as businesses_router
from leadforge.api.routes.leads import router as leads_router
from leadforge.api.routes.pipeline import router as pipeline_router
from leadforge.api.routes.outreach import router as outreach_router
from leadforge.api.routes.reports import router as reports_router
from leadforge.api.routes.scrape import router as scrape_router
from leadforge.voice.webhook_handler import router as webhook_router

app = FastAPI(
    title="LeadForge API",
    description="Lead generation pipeline API",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(businesses_router)
app.include_router(leads_router)
app.include_router(pipeline_router)
app.include_router(outreach_router)
app.include_router(reports_router)
app.include_router(scrape_router)
app.include_router(webhook_router)
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add pipeline, outreach, reports, and scrape API routes"
```

---

### Task 6: Celery Beat + 90-Day Recalibration

**Files:**
- Create: `src/leadforge/tasks/recalibration_tasks.py`
- Create: `src/leadforge/tasks/celery_beat_schedule.py`
- Modify: `src/leadforge/tasks/celery_app.py` (import beat schedule)
- Modify: `docker-compose.yml` (add celery-beat + vllm services)

- [ ] **Step 1: Create recalibration task**

Per PRD v2.2: pull Won/Lost outcomes, correlate sub-scores with close rates, generate report, apply if operator approves. Skip if < 50 terminal outcomes.

```python
# src/leadforge/tasks/recalibration_tasks.py
import asyncio
import structlog
from leadforge.tasks.celery_app import celery_app

logger = structlog.get_logger()


@celery_app.task(bind=True, max_retries=1)
def recalibration_task(self):
    """90-day recalibration: correlate scores with outcomes, generate report."""
    async def _run():
        from sqlalchemy import select, func
        from leadforge.db.session import async_session
        from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage
        from leadforge.db.models.lead_score import LeadScore

        async with async_session() as session:
            # Count terminal outcomes
            terminal_count = (await session.execute(
                select(func.count(OutreachRecord.id))
                .where(OutreachRecord.status.in_([PipelineStage.WON, PipelineStage.LOST]))
            )).scalar() or 0

            if terminal_count < 50:
                logger.info(
                    "recalibration_skipped_insufficient_data",
                    terminal_outcomes=terminal_count,
                    minimum_required=50,
                )
                return {"status": "skipped", "reason": "insufficient_data", "count": terminal_count}

            # Fetch score + outcome pairs
            result = await session.execute(
                select(
                    LeadScore.digital_deficit_score,
                    LeadScore.viability_score,
                    LeadScore.competitive_pressure_score,
                    LeadScore.composite_acquisition_score,
                    OutreachRecord.status,
                )
                .join(OutreachRecord, LeadScore.business_id == OutreachRecord.business_id)
                .where(OutreachRecord.status.in_([PipelineStage.WON, PipelineStage.LOST]))
            )
            rows = result.all()

            # Compute correlation: average sub-scores for Won vs Lost
            won_scores = {"deficit": [], "viability": [], "pressure": [], "composite": []}
            lost_scores = {"deficit": [], "viability": [], "pressure": [], "composite": []}

            for deficit, viability, pressure, composite, status in rows:
                target = won_scores if status == PipelineStage.WON else lost_scores
                if deficit is not None:
                    target["deficit"].append(deficit)
                if viability is not None:
                    target["viability"].append(viability)
                if pressure is not None:
                    target["pressure"].append(pressure)
                if composite is not None:
                    target["composite"].append(composite)

            def avg(lst):
                return sum(lst) / len(lst) if lst else 0

            report = {
                "status": "generated",
                "terminal_outcomes": terminal_count,
                "won_count": len(won_scores["composite"]),
                "lost_count": len(lost_scores["composite"]),
                "won_avg": {k: round(avg(v), 2) for k, v in won_scores.items()},
                "lost_avg": {k: round(avg(v), 2) for k, v in lost_scores.items()},
                "current_weights": {"deficit": 0.40, "viability": 0.35, "pressure": 0.25},
            }

            logger.info("recalibration_report_generated", **report)
            return report

    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error("recalibration_failed", error=str(exc))
        raise self.retry(exc=exc)
```

- [ ] **Step 2: Create Celery Beat schedule**

```python
# src/leadforge/tasks/celery_beat_schedule.py
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    "recalibrate-every-90-days": {
        "task": "leadforge.tasks.recalibration_tasks.recalibration_task",
        "schedule": crontab(day_of_month="1", month_of_year="1,4,7,10", hour=2, minute=0),
        "options": {"queue": "default"},
    },
}
```

- [ ] **Step 3: Update `celery_app.py` to load beat schedule**

Add to the `celery_app.conf.update(...)` block:
```python
from leadforge.tasks.celery_beat_schedule import CELERY_BEAT_SCHEDULE

# In celery_app.conf.update:
beat_schedule=CELERY_BEAT_SCHEDULE,
```

- [ ] **Step 4: Update `docker-compose.yml` — add celery-beat and vllm**

Add these services:

```yaml
  celery-beat:
    build: .
    command: celery -A leadforge.tasks.celery_app beat --loglevel=info
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - .env

  vllm:
    image: vllm/vllm-openai:latest
    command: --model Qwen/Qwen2.5-7B-Instruct --dtype float16 --device cpu
    ports:
      - "8001:8000"
    environment:
      - VLLM_CPU_ONLY=1
    deploy:
      resources:
        limits:
          memory: 16g
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add 90-day recalibration task, Celery Beat, vllm Docker service"
```

---

## Chunk 2: React Frontend

### Task 7: Frontend Scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css` (CSS custom properties from FDS v2.2)
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: Initialize frontend with Vite + React + TypeScript**

```bash
cd /home/crichalchemist/LeadForge
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install @tanstack/react-query react-router-dom recharts @dnd-kit/core @dnd-kit/sortable
npm install axios
```

- [ ] **Step 2: Create `frontend/src/index.css`**

All CSS custom properties from FDS v2.2 Section 1.3. Import Google Fonts for JetBrains Mono + Space Grotesk.

```css
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');

:root {
  --bg-deep: #0a0a0f;
  --bg-primary: #0f0f18;
  --bg-surface: #151521;
  --bg-elevated: #1a1a2e;
  --bg-hover: #22223a;
  --border-subtle: rgba(139, 92, 246, 0.12);
  --border-default: rgba(139, 92, 246, 0.25);
  --border-bright: rgba(139, 92, 246, 0.50);
  --purple: #8b5cf6;
  --purple-bright: #a78bfa;
  --purple-dim: #6d5acd;
  --purple-glow: rgba(139, 92, 246, 0.15);
  --blue: #3b82f6;
  --blue-bright: #60a5fa;
  --cyan: #22d3ee;
  --neon-green: #39ff14;
  --green: #4ade80;
  --yellow: #facc15;
  --neon-yellow: #ccff00;
  --danger: #ef4444;
  --warm: #f97316;
  --text-primary: #e4e4ef;
  --text-secondary: #9d9db8;
  --text-tertiary: #5e5e7e;
  --font-display: 'Space Grotesk', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
}
```

- [ ] **Step 3: Create API client**

```typescript
// frontend/src/api/client.ts
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

// Businesses
export const fetchBusinesses = (params: Record<string, any>) =>
  api.get('/api/businesses', { params }).then(r => r.data);

export const fetchBusiness = (id: string) =>
  api.get(`/api/businesses/${id}`).then(r => r.data);

// Leads
export const fetchRankedLeads = (params?: Record<string, any>) =>
  api.get('/api/leads/ranked', { params }).then(r => r.data);

export const fetchScoreBreakdown = (id: string) =>
  api.get(`/api/leads/${id}/score-breakdown`).then(r => r.data);

// Pipeline
export const fetchPipelineBoard = () =>
  api.get('/api/pipeline/board').then(r => r.data);

export const transitionStage = (outreachId: string, newStage: string) =>
  api.patch(`/api/pipeline/${outreachId}/stage`, { new_stage: newStage }).then(r => r.data);

// Outreach
export const fetchOutreachHistory = (businessId: string) =>
  api.get(`/api/outreach/by-business/${businessId}`).then(r => r.data);

export const fetchCallLog = (limit?: number) =>
  api.get('/api/outreach/call-log', { params: { limit } }).then(r => r.data);

export const fetchTranscript = (outreachId: string) =>
  api.get(`/api/outreach/${outreachId}/transcript`).then(r => r.data);

// Reports
export const fetchFunnel = () => api.get('/api/reports/funnel').then(r => r.data);
export const fetchScoreCalibration = () => api.get('/api/reports/score-calibration').then(r => r.data);
export const fetchOutreachEfficiency = () => api.get('/api/reports/outreach-efficiency').then(r => r.data);
export const fetchRevenue = () => api.get('/api/reports/revenue').then(r => r.data);

// Scrape
export const triggerScrape = (data: { zip_codes: string[]; niches: string[]; limit?: number }) =>
  api.post('/api/scrape/run', data).then(r => r.data);

export const fetchScrapeStatus = (taskId: string) =>
  api.get(`/api/scrape/status/${taskId}`).then(r => r.data);

export default api;
```

- [ ] **Step 4: Create `App.tsx` with router**

```tsx
// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from './components/layout/AppLayout';
import PipelinePage from './pages/Pipeline';
import LeadsPage from './pages/Leads';
import OutreachPage from './pages/Outreach';
import ReportsPage from './pages/Reports';
import ScrapePage from './pages/Scrape';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/pipeline" replace />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/outreach" element={<OutreachPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/scrape" element={<ScrapePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 5: Create `main.tsx`**

```tsx
// frontend/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Verify build**

```bash
cd frontend && npm run build
```
Expected: Builds without errors (pages are stubs at this point)

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "Scaffold React frontend: Vite + TypeScript + Tailwind + API client"
```

---

### Task 8: Layout + Sidebar + Topbar

**Files:**
- Create: `frontend/src/components/layout/AppLayout.tsx`
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/Topbar.tsx`

- [ ] **Step 1: Build components following FDS v2.2 Section 2.2**

Sidebar: 56px icon rail, active = purple glow. Topbar: 48px, title + breadcrumb + search. Layout: CSS grid matching prototype.

The AppLayout uses `<Outlet />` from react-router-dom. All components use CSS custom properties, not hardcoded colors.

- [ ] **Step 2: Create stub pages**

Create minimal placeholder components for each of the 5 pages: `frontend/src/pages/Pipeline.tsx`, `Leads.tsx`, `Outreach.tsx`, `Reports.tsx`, `Scrape.tsx`.

- [ ] **Step 3: Verify dev server**

```bash
cd frontend && npm run dev
```
Navigate to http://localhost:5173 — should see dark terminal layout with sidebar and topbar.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "Add AppLayout, Sidebar, Topbar with dark terminal aesthetic"
```

---

### Task 9: Pipeline Board (Kanban)

This is the primary view — the Kanban board from FDS v2.2 Section 3.1.

**Files:**
- Create: `frontend/src/components/pipeline/PipelineBoard.tsx`
- Create: `frontend/src/components/pipeline/KanbanColumn.tsx`
- Create: `frontend/src/components/pipeline/LeadCard.tsx`
- Create: `frontend/src/components/common/MetricCard.tsx`
- Create: `frontend/src/components/common/ScoreBadge.tsx`
- Create: `frontend/src/components/common/StatusBadge.tsx`
- Create: `frontend/src/components/common/SentimentBar.tsx`
- Create: `frontend/src/components/common/FilterBar.tsx`
- Modify: `frontend/src/pages/Pipeline.tsx`

- [ ] **Step 1: Build MetricCard, ScoreBadge, StatusBadge, SentimentBar**

These are leaf components matching FDS v2.2 Section 4.1. ScoreBadge: A=neon-green, B=yellow, C=warm. SentimentBar: 2px gradient bar.

- [ ] **Step 2: Build LeadCard**

Compact card: biz name (Space Grotesk 13px 500), niche (JetBrains Mono 10px uppercase), zip + score badge, tier dot + price range, sentiment bar (only after contact). Hover: border brightens, bg elevates, 1px Y translate.

- [ ] **Step 3: Build KanbanColumn**

Column with header (title + count badge), scrollable card area. Six primary columns: Scored, Queued, Contacted, Engaged, Meeting, Won.

- [ ] **Step 4: Build PipelineBoard with @dnd-kit**

Drag-and-drop between columns. On drop → call `transitionStage()` API with optimistic update. Card lifts with scale(1.02) on drag.

- [ ] **Step 5: Build FilterBar**

Filter buttons for zip, niche, tier, score threshold. Active filter highlighted in neon-green.

- [ ] **Step 6: Wire Pipeline page with metrics bar + board**

Six metric cards (total leads, contacted, meetings booked, won/month, avg sentiment, pipeline value). Fetches from API.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "Add Pipeline board: Kanban with drag-and-drop, metrics, filters"
```

---

### Task 10: Lead Detail Panel

420px slide-out from right per FDS v2.2 Section 3.2.

**Files:**
- Create: `frontend/src/components/leads/LeadDetailPanel.tsx`
- Create: `frontend/src/components/leads/ScoreBreakdown.tsx`
- Create: `frontend/src/components/leads/DigitalPresenceSection.tsx`
- Create: `frontend/src/components/leads/OutreachTimeline.tsx`
- Create: `frontend/src/components/leads/OutreachBrief.tsx`

- [ ] **Step 1: Build ScoreBreakdown**

Three horizontal progress bars: digital deficit (purple fill), viability (green fill), competitive pressure (yellow fill). Labels with numeric values. 400ms fill animation, 100ms stagger.

- [ ] **Step 2: Build DigitalPresenceSection, OutreachTimeline, OutreachBrief**

Key-value rows with semantic coloring (danger for missing, yellow for low, green for strong). Timeline with colored dots per event. Brief as blockquote with purple left border.

- [ ] **Step 3: Build LeadDetailPanel**

Slide-out overlay, 200ms ease-out animation. Sections: Header, Acquisition Score, Contact, Digital Presence, Competitive Context, Price Tier, Outreach Brief, Outreach Timeline. Click card → open panel. Click X or outside → close.

- [ ] **Step 4: Integrate with Pipeline and Leads pages**

Card click triggers detail panel. Panel fetches full business detail + score breakdown + outreach history.

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "Add Lead Detail panel: score breakdown, digital presence, timeline"
```

---

### Task 11: Leads Table + Outreach View + Reports + Scrape Control

**Files:**
- Create: `frontend/src/components/leads/LeadTable.tsx`
- Create: `frontend/src/components/outreach/OutreachQueue.tsx`
- Create: `frontend/src/components/outreach/CallLog.tsx`
- Create: `frontend/src/components/reports/FunnelChart.tsx`
- Create: `frontend/src/components/reports/ScoreCalibration.tsx`
- Create: `frontend/src/components/reports/OutreachEfficiency.tsx`
- Create: `frontend/src/components/reports/RevenueChart.tsx`
- Create: `frontend/src/components/scrape/ScrapeForm.tsx`
- Create: `frontend/src/components/scrape/JobHistory.tsx`
- Modify: remaining page files

- [ ] **Step 1: Build Leads page — sortable/filterable DataTable**

Columns: name, niche, zip, score, grade, tier, stage, last contact. Sort by clicking headers. Inline filters. Click row → detail panel.

- [ ] **Step 2: Build Outreach page — split layout (60/40)**

Left: outreach queue (leads queued for voice agent, sorted by score). Right: call log (recent calls with disposition, sentiment, duration, transcript link).

- [ ] **Step 3: Build Reports page — 2x2 grid of 4 report panels**

Using recharts:
- Pipeline Funnel: horizontal bar chart, color-coded per stage
- Score Calibration: scatter plot, score vs outcome (won=1/lost=0)
- Outreach Efficiency: 4 metric cards + line chart (rates over time)
- Revenue: stacked bar chart by tier per month + cumulative won line

- [ ] **Step 4: Build Scrape Control page**

Top: form with zip code input, niche dropdown multi-select, "Run Scrape" button. Active jobs list with progress. Bottom: job history table.

- [ ] **Step 5: Verify full build**

```bash
cd frontend && npm run build
```
Expected: Builds without errors

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "Add Leads table, Outreach view, Reports dashboards, Scrape control"
```

---

## Chunk 3: Production + ADRs

### Task 12: Docker Production + Frontend Serving

**Files:**
- Create: `frontend/nginx.conf`
- Create: `frontend/Dockerfile`
- Modify: `docker-compose.yml` (add frontend service)

- [ ] **Step 1: Create frontend Dockerfile**

Multi-stage: Node build → nginx serve.

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 2: Create nginx.conf**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://app:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /webhooks/ {
        proxy_pass http://app:8000;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Add frontend service to docker-compose.yml**

```yaml
  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - app
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add frontend Docker build with nginx proxy to API"
```

---

### Task 13: Tests for Phase 4 API Routes

**Files:**
- Create: `tests/api/__init__.py`
- Create: `tests/api/test_health.py`
- Create: `tests/api/test_pipeline.py`
- Create: `tests/api/test_reports.py`

- [ ] **Step 1: Write API route tests using httpx AsyncClient + FastAPI test client**

Test health endpoint, pipeline board, stage transitions (valid and invalid), reports endpoints. Mock DB sessions via `app.dependency_overrides`.

- [ ] **Step 2: Run full test suite**

```bash
uv run python -m pytest tests/ -v
```
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "Add Phase 4 API route tests"
```

---

### Task 14: ADRs 015–018

**Files:**
- Create: `docs/vault/015-frontend-stack.md`
- Create: `docs/vault/016-api-auth.md`
- Create: `docs/vault/017-recalibration.md`
- Create: `docs/vault/018-pipeline-transitions.md`
- Modify: `docs/vault/README.md` (add index entries)

- [ ] **Step 1: Write ADR-015: Frontend stack**

React + Vite + Tailwind, React Query for server state, @dnd-kit for DnD, recharts for charts. Dark terminal aesthetic per FDS v2.2.

- [ ] **Step 2: Write ADR-016: API auth**

API key for MVP, upgrade path to OAuth2/OIDC. Middleware approach.

- [ ] **Step 3: Write ADR-017: Recalibration**

90-day full re-enrichment, score versioning for audit trail. Operator approval flow. Skip if < 50 outcomes.

- [ ] **Step 4: Write ADR-018: Pipeline transitions**

Valid transition enforcement in backend, optimistic updates in frontend. Transition map.

- [ ] **Step 5: Update vault README index**

Add entries for 015–018.

- [ ] **Step 6: Commit**

```bash
git add docs/vault/
git commit -m "Add Phase 4 ADRs 015-018: frontend, auth, recalibration, transitions"
```

---

## Verification Checklist

After all tasks:

1. `uv run python -m pytest tests/ -v` — all tests pass
2. `cd frontend && npm run build` — builds without errors
3. `docker compose up -d` — all services start healthy
4. API: `curl http://localhost:8000/health` → `{"status":"ok"}`
5. API: `curl http://localhost:8000/api/pipeline/board` → stage counts
6. Frontend: navigate to http://localhost:3000 — pipeline board renders
7. Drag lead between stages → API call + board update
8. Click lead card → detail panel slides out with score breakdown
9. Reports page renders all 4 charts
10. Scrape control: trigger a job, see task ID returned

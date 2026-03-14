"""Live integration test: OpenRouter LLM routing + Retell voice call.

1. Calls OpenRouter to generate a conversational build-progress update
2. Creates a Retell LLM with that update as the system prompt
3. Creates a Retell agent backed by that LLM
4. Initiates an outbound call to deliver the update
"""

import asyncio
import json
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL_ID = os.getenv("OPENROUTER_MODEL_ID", "nvidia/nemotron-3-super-120b-a12b:free")
RETELL_API_KEY = os.getenv("RETELL_API_KEY", "")
RETELL_FROM_NUMBER = os.getenv("RETELL_FROM_NUMBER", "")

TO_NUMBER = "+17734307298"

# ── The raw build-progress facts (non-technical) ────────────────────
BUILD_UPDATE = """\
Here is the current status of the LeadForge project as of today:

- The core data pipeline is fully working end-to-end. It discovers real \
businesses from the City of Chicago's public database, pulls in Google \
reviews and ratings, and automatically scores each lead.
- All live API connections are tested and confirmed: Chicago business \
data, Google Places enrichment, and AI services through Azure.
- The database now supports the full Neighborhood Opportunity Fund grant \
tracking workflow, including corridor eligibility, application stages, \
and document checklists.
- 145 automated tests are passing across the entire codebase.
- The CRM dashboard frontend is built with React: pipeline board, lead \
detail pages, reports, and grant tracking views.
- Voice outreach is being connected right now — this phone call is \
actually the first live test of that system.
- Next steps are finishing the OpenRouter integration for smarter AI \
model routing, and loading the NOF corridor map data so we can score \
grant eligibility automatically.
- Overall the project is in solid shape and on track.\
"""


# ── Step 1: OpenRouter ──────────────────────────────────────────────

async def test_openrouter() -> str:
    """Hit OpenRouter to rewrite the build update in a warm, conversational tone."""
    print("\n=== Step 1: OpenRouter LLM Routing ===")
    print(f"  Model : {OPENROUTER_MODEL_ID}")

    if not OPENROUTER_API_KEY:
        print("  SKIP: OPENROUTER_API_KEY not set")
        return BUILD_UPDATE  # fall back to raw text

    prompt = (
        "You are a friendly project manager delivering a phone call update. "
        "Rewrite the following project status into a natural, conversational "
        "monologue that sounds warm and human — like you're catching someone up "
        "over the phone. Keep it under 45 seconds of speaking time (roughly "
        "120 words). Do NOT use bullet points or headers. Just speak naturally.\n\n"
        f"{BUILD_UPDATE}"
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENROUTER_MODEL_ID,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.7,
            },
        )
        if resp.status_code != 200:
            print(f"  ERROR {resp.status_code}: {resp.text[:300]}")
            print("  Falling back to raw update text.")
            return BUILD_UPDATE
        data = resp.json()

    message = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    print(f"  Status: OK")
    print(f"  Tokens: {usage.get('prompt_tokens', '?')} in / {usage.get('completion_tokens', '?')} out")
    print(f"  Response:\n    {message[:200]}...")
    return message


# ── Step 2: Retell – create LLM ────────────────────────────────────

async def create_retell_llm(update_text: str) -> str:
    """Create a Retell LLM with the build update as its system prompt."""
    print("\n=== Step 2: Create Retell LLM ===")

    system_prompt = (
        "You are calling to deliver a brief project status update about "
        "LeadForge, a software platform being built. Greet the person warmly, "
        "then deliver the update below in a conversational tone. After "
        "delivering the update, ask if they have any questions. If they say "
        "no or want to wrap up, thank them and say goodbye.\n\n"
        "If they ask who you are, say: 'I'm an AI assistant calling on behalf "
        "of the LeadForge development team.'\n\n"
        f"## The Update\n{update_text}"
    )

    async with httpx.AsyncClient(
        base_url="https://api.retellai.com",
        timeout=30.0,
        headers={"Authorization": f"Bearer {RETELL_API_KEY}"},
    ) as client:
        resp = await client.post(
            "/create-retell-llm",
            json={
                "general_prompt": system_prompt,
                "begin_message": (
                    "Hey! This is the LeadForge AI assistant calling with a "
                    "quick project update. Got a minute?"
                ),
            },
        )
        resp.raise_for_status()
        data = resp.json()

    llm_id = data["llm_id"]
    print(f"  LLM ID: {llm_id}")
    return llm_id


# ── Step 3: Retell – create Agent ───────────────────────────────────

async def create_retell_agent(llm_id: str) -> str:
    """Create a Retell voice agent backed by the LLM."""
    print("\n=== Step 3: Create Retell Agent ===")

    async with httpx.AsyncClient(
        base_url="https://api.retellai.com",
        timeout=30.0,
        headers={"Authorization": f"Bearer {RETELL_API_KEY}"},
    ) as client:
        resp = await client.post(
            "/create-agent",
            json={
                "agent_name": "LeadForge Build Update",
                "voice_id": "11labs-Adrian",
                "response_engine": {
                    "type": "retell-llm",
                    "llm_id": llm_id,
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()

    agent_id = data["agent_id"]
    print(f"  Agent ID: {agent_id}")
    print(f"  Voice   : 11labs-Adrian")
    return agent_id


# ── Step 4: Retell – initiate call ──────────────────────────────────

async def initiate_call(agent_id: str) -> dict:
    """Place the outbound call."""
    print("\n=== Step 4: Initiate Retell Call ===")
    print(f"  From: {RETELL_FROM_NUMBER}")
    print(f"  To  : {TO_NUMBER}")

    async with httpx.AsyncClient(
        base_url="https://api.retellai.com",
        timeout=30.0,
        headers={"Authorization": f"Bearer {RETELL_API_KEY}"},
    ) as client:
        resp = await client.post(
            "/v2/create-phone-call",
            json={
                "from_number": RETELL_FROM_NUMBER,
                "to_number": TO_NUMBER,
                "override_agent_id": agent_id,
                "metadata": {"purpose": "build_progress_update_test"},
            },
        )
        if resp.status_code != 201 and resp.status_code != 200:
            print(f"  ERROR {resp.status_code}: {resp.text[:500]}")
            # Try without override_agent_id, using agent_id directly
            print("  Retrying with agent_id instead of override_agent_id...")
            resp = await client.post(
                "/v2/create-phone-call",
                json={
                    "from_number": RETELL_FROM_NUMBER,
                    "to_number": TO_NUMBER,
                    "agent_id": agent_id,
                    "metadata": {"purpose": "build_progress_update_test"},
                },
            )
            if resp.status_code != 201 and resp.status_code != 200:
                print(f"  ERROR {resp.status_code}: {resp.text[:500]}")
                sys.exit(1)
        data = resp.json()

    call_id = data.get("call_id", "unknown")
    print(f"  Call ID : {call_id}")
    print(f"  Status  : {data.get('call_status', 'unknown')}")
    return data


# ── Main ────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  LeadForge — OpenRouter + Retell Integration Test")
    print("=" * 60)

    # Preflight
    missing = []
    if not OPENROUTER_API_KEY:
        missing.append("OPENROUTER_API_KEY")
    if not RETELL_API_KEY:
        missing.append("RETELL_API_KEY")
    if not RETELL_FROM_NUMBER:
        missing.append("RETELL_FROM_NUMBER")
    if missing:
        print(f"\n  WARNING: Missing env vars: {', '.join(missing)}")
        if "RETELL_API_KEY" in missing:
            print("  Cannot proceed without RETELL_API_KEY. Exiting.")
            sys.exit(1)

    # Step 1: Generate conversational update via OpenRouter
    update_text = await test_openrouter()

    # Step 2: Create Retell LLM with the update
    llm_id = await create_retell_llm(update_text)

    # Step 3: Create agent
    agent_id = await create_retell_agent(llm_id)

    # Step 4: Place the call
    call_data = initiate_call(agent_id)
    call_data = await call_data

    print("\n" + "=" * 60)
    print("  Call initiated! Check your phone.")
    print(f"  Call ID: {call_data.get('call_id')}")
    print(f"  Retrieve later: GET /v2/get-call/{call_data.get('call_id')}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())

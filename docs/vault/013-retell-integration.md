# ADR-013: Retell integration: webhook-driven async, idempotent handlers

**Status:** Accepted
**Date:** 2026-03-14

## Context

LeadForge Phase 3 requires programmatic voice calling capabilities to conduct outreach to qualified leads. We need a voice AI platform that can:
- Initiate outbound calls programmatically
- Conduct natural conversations following a brief/script
- Return transcripts and call metadata for analysis
- Handle call failures gracefully

Retell AI provides a voice agent SDK with REST API for agent creation and call initiation, plus webhook callbacks for asynchronous call event notifications.

## Decision

We will integrate Retell AI using a webhook-driven asynchronous architecture:

**Call Initiation:**
- Use Retell REST API to create voice agents and initiate calls
- Voice agent prompt is dynamically built from outreach brief + business context
- Call initiation triggered by Celery task `initiate_outreach_call.apply_async()`

**Call Results:**
- Receive call results via webhook endpoint `POST /webhooks/retell/call-complete`
- Webhook handler is idempotent — ignores unknown call IDs, processes each call exactly once
- After webhook processing, dispatch Celery task `analyze_call_sentiment.apply_async()` for LLM sentiment analysis
- Webhook returns 200 OK immediately after dispatching Celery task (fast response)

**Infrastructure:**
- FastAPI app serves webhook endpoints (expanded to full CRUD API in Phase 4)
- Webhook endpoint must be publicly accessible with HTTPS
- Store Retell API credentials in environment variables

## Consequences

### Positive
- Async webhook pattern decouples call execution from result processing — no long-running connections
- Idempotent handlers tolerate Retell's at-least-once delivery guarantee
- Celery sentiment analysis task keeps webhook response fast (< 100ms)
- Dynamic prompt generation allows personalized outreach at scale

### Negative
- Webhook endpoint must be publicly accessible — requires ngrok in dev, proper TLS in prod
- Retell vendor lock-in for voice capabilities — switching providers requires full rewrite
- At-least-once delivery means we must implement deduplication logic
- Public webhook endpoint is potential security risk (mitigated by signature validation)

## Alternatives Considered

- **Twilio:** More flexible and widely adopted, but requires building entire voice agent from scratch using TwiML/Functions — higher development cost
- **Bland.ai:** Similar to Retell (voice AI platform), but less mature product and smaller community
- **Manual calls:** Doesn't scale beyond 10-20 calls/day and defeats purpose of automated outreach

# ADR-019: Retell API v2 alignment — parameter names, webhook structure, signature verification

**Status:** Accepted
**Date:** 2026-03-14

## Context

A review of the Retell AI API documentation (https://docs.retellai.com/api-references/create-phone-call) revealed multiple discrepancies between our implementation and the actual v2 API contract. These would cause runtime failures (400 Bad Request) when making real calls.

## Issues Found

1. **`initiate_call` used `customer_number`** — the v2 API requires `to_number` (E.164). `customer_number` is not a valid field and would be silently ignored, causing a 400 for missing required `to_number`.

2. **`from_number` treated as optional** — the v2 `create-phone-call` endpoint requires both `from_number` and `to_number`. Our code made `from_number` optional with no fallback, meaning calls would always fail.

3. **`create_agent` passed `general_prompt` at top level** — the API configures agent behavior via `response_engine.llm_id` (referencing a Retell LLM created separately). `general_prompt` is not a valid field.

4. **Webhook handler expected flat payload** — Retell sends `{"event": "call_ended", "call": {...}}` but our handler read `call_id`, `transcript`, and `call_analysis` from the top level.

5. **Webhook handler conflated `call_ended` and `call_analyzed`** — these are separate events. `call_ended` has transcript and disconnection_reason but NO `call_analysis`. `call_analyzed` arrives later with sentiment and success flags.

6. **No webhook signature verification** — Retell sends `x-retell-signature` header for HMAC verification. Our handler accepted any POST, creating a security vulnerability.

7. **No `RETELL_API_KEY` or `RETELL_FROM_NUMBER` in config** — the client used `getattr(settings, 'RETELL_API_KEY', '')` instead of a proper settings field.

8. **No `metadata` on calls** — the API supports a `metadata` dict for passing `business_id` / `outreach_id` for traceability.

## Decision

Fix all issues to align with the Retell v2 API contract:

- **`retell_client.py`**: Use `to_number` + `from_number` (required), `override_agent_id`, `metadata`, and `retell_llm_dynamic_variables`. Fall back to `settings.RETELL_FROM_NUMBER`. Require `llm_id` for `create_agent`.
- **`webhook_handler.py`**: Parse nested `{"event": ..., "call": {...}}` structure. Handle `call_ended` and `call_analyzed` as separate events. Add `x-retell-signature` HMAC verification. Only dispatch sentiment task when transcript is present.
- **`config.py`**: Add `RETELL_API_KEY` and `RETELL_FROM_NUMBER` as proper settings fields.
- **`call_manager.py`**: Pass `metadata` with `business_id` and `outreach_id` on every call.

The `from_number` is a phone number purchased or imported via Retell's dashboard/API (`POST /create-phone-number` with `area_code` or specific E.164 number). It is stored as a deployment config value, not generated in code.

## Consequences

### Positive
- Calls will actually succeed against the real Retell API
- Webhook signature verification prevents spoofed events
- Metadata on calls enables end-to-end traceability without relying solely on DB lookups
- Separate event handling correctly models Retell's async analysis pipeline

### Negative
- Requires `RETELL_FROM_NUMBER` to be configured (must purchase a number in Retell first)
- Agent creation now requires a pre-created Retell LLM ID (can't pass prompt directly)

## Alternatives Considered

- **Use Retell Python SDK**: Would handle auth and serialization, but adds a dependency and we only use 3 endpoints. Raw httpx is simpler and gives us full control.

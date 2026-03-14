# ADR-018: Pipeline transitions: valid transition enforcement in backend, optimistic updates in frontend

## Status

Accepted

## Date

2026-03-14

## Context

The CRM pipeline board allows users to drag leads between stages (e.g., New, Contacted, Qualified, Proposal, Closed Won, Closed Lost). Not all transitions are valid business operations:

- A lead should not jump from "New" directly to "Closed Won"
- "Closed Won" and "Closed Lost" are terminal states with restricted re-entry
- Concurrent users could attempt conflicting moves

The drag-and-drop UI must feel responsive while the backend ensures data integrity. Conflicting requirements of speed (frontend) and correctness (backend) must be balanced.

## Decision

We will enforce valid transitions in the backend and use optimistic updates in the frontend:

**Backend:**
- A `VALID_TRANSITIONS` dictionary maps each `PipelineStage` enum value to its set of allowed next stages
- The `PATCH /api/leads/{id}/stage` endpoint validates the requested transition against the map before persisting
- Invalid transitions return `422 Unprocessable Entity` with a descriptive error message
- Stage changes are recorded in a `stage_history` audit table (lead_id, from_stage, to_stage, changed_by, changed_at)

**Frontend:**
- On drag-drop, the UI immediately moves the card to the target column (optimistic update)
- The mutation fires the PATCH request in the background via React Query
- On success, the cache is invalidated to sync with server state
- On error (invalid transition or conflict), the card snaps back to its original column and a toast notification explains the rejection

## Consequences

### Positive
- Data integrity is guaranteed by the backend regardless of client behavior
- The UI feels instant; users are not blocked waiting for network round-trips
- The audit table provides full history of pipeline progression for reporting
- The `VALID_TRANSITIONS` map is easy to understand, test, and modify

### Negative
- Optimistic updates add complexity to the frontend state management (rollback logic)
- Brief visual flicker on rollback if a user attempts an invalid transition
- The valid transitions map must be kept in sync between backend validation and any frontend hints (e.g., greying out invalid drop targets)

### Neutral
- The transition map is defined in code, not in the database; changes require a deploy but are versioned in source control
- React Query's mutation rollback pattern is well-documented and idiomatic

## Alternatives Considered

1. **Free-form transitions (no validation)** — Allow any stage-to-stage move. Rejected because it creates data integrity risks; leads could end up in nonsensical states, and reporting on pipeline velocity would be unreliable.

2. **Pessimistic updates (wait for server)** — Only move the card after the server confirms the transition. Rejected because it introduces visible lag on every drag-drop action, degrading the user experience on the most-used interaction in the CRM.

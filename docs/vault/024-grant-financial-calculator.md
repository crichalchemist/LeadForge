# ADR-024: Grant financial calculator: pure function modeling NOF grant math

## Status

Accepted

## Date

2026-03-14

## Context

NOF has specific financial formulas mandated by the City of Chicago DPD:

- **Base grant**: 75% of total project cost, capped at $250,000
- **TAF (Technical Assistance Fund)**: 20% of base grant, capped at $50,000
- **Owner financing requirement**: Owner must finance at least 50% of total project cost
- **Exterior work requirement**: For grants over $25,000, exterior work must be at least 10% of base grant

These calculations are needed in multiple contexts:
- API responses when showing grant details to users
- CRM detail view for grant officers to see financial breakdown
- Validation logic to ensure submitted project costs meet City requirements
- Reporting and analytics dashboards

The calculations are deterministic, stateless, and depend only on two inputs: total project cost and acquisition cost. They should be testable in isolation and reusable across API and frontend contexts.

## Decision

Implement a pure function `compute_grant_financials(total_project_cost: float, acquisition_cost: float = 0) -> GrantFinancials` that returns a dataclass with all computed fields:

```python
@dataclass
class GrantFinancials:
    total_project_cost: float
    acquisition_cost: float
    base_grant: float
    taf: float
    total_grant: float
    required_owner_financing: float
    exterior_work_requirement: float
    meets_owner_financing: bool
    meets_exterior_requirement: bool
```

Calculation logic:
- `base_grant = min(total_project_cost * 0.75, 250_000)`
- `taf = min(base_grant * 0.20, 50_000)`
- `total_grant = base_grant + taf`
- `required_owner_financing = total_project_cost * 0.50`
- `exterior_work_requirement = max(base_grant * 0.10, 0) if base_grant > 25_000 else 0`
- `meets_owner_financing = (total_project_cost - total_grant) >= required_owner_financing`
- `meets_exterior_requirement = True if base_grant <= 25_000 else (acquisition_cost >= exterior_work_requirement)`

All values rounded to 2 decimal places using `round(value, 2)`. Edge cases: if total_project_cost <= 0 or is None, return all zeros with False flags. Keep calculation logic separate from API/database layers (no ORM instantiation, no API endpoint logic inside function).

Expose via API endpoint:
```
GET /api/grants/financials/{id}
GET /api/grants/financials/simulate?total_project_cost=100000&acquisition_cost=15000
```

Store computed financials in GrantApplication.financial_summary as JSON (denormalized) for display purposes, but recompute on every detail fetch and validation to ensure freshness. Do not rely on stale stored values for business logic.

## Consequences

### Positive
- Pure function is fully testable in isolation with no mocking needed
- Reusable across API, frontend (via API), and internal business logic
- Deterministic: same inputs always produce same outputs
- Easy to debug: no stateful dependencies or database side effects
- Calculation logic is not duplicated (single source of truth)
- Easy to update City formulas: one function edit, all contexts auto-update

### Negative
- Requires API roundtrip for frontend to get calculations (200-500ms latency)
- If formula changes frequently, frontend will see stale values until page refreshes
- Dataclass must be serializable to JSON; adds schema maintenance burden
- Validation logic (meets_owner_financing, meets_exterior_requirement) may be insufficient for City compliance; requires human review

### Neutral
- Adds ~80 lines of code (function + dataclass + tests)
- Slightly slower than hardcoding values, but sub-millisecond (negligible)

## Alternatives Considered

1. **Store computed values in database** — Calculate once on GrantApplication creation, store in columns (base_grant, taf, total_grant, etc.). Rejected because calculations would go stale if project cost is updated after initial calculation. Recalculation is instant; storage adds staleness risk. Denormalized storage is only justified if calculations were expensive (they are not).

2. **Frontend-only calculation** — Compute financials in React component using JavaScript. Rejected because backend needs these values for validation (e.g., checking exterior work requirement before accepting application), reporting, and audit trails. Duplicating calculation in frontend + backend risks inconsistency.

3. **Spreadsheet-based calculation** — City provides Excel template; download and parse. Rejected because not maintainable; formula updates require manual re-entry, City may revise template without notice, and spreadsheet logic is hard to test automatically.

4. **Embed in GrantApplication model methods** — Add instance methods to GrantApplication ORM model. Rejected because couples calculation logic to ORM, makes testing harder (requires database and session), and prevents use outside of ORM context (e.g., in validation pipeline).

5. **GraphQL resolver** — Expose calculations via GraphQL query. Rejected because API is REST-based; adding GraphQL for a single calculation is premature complexity.

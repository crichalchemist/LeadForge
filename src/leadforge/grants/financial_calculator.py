from dataclasses import dataclass


@dataclass
class GrantFinancials:
    total_project_cost: float
    acquisition_cost: float
    base_grant: float
    taf_eligible: float  # Technical Assistance Fund
    owner_contribution: float
    owner_min_financing: float
    exterior_work_minimum: float


def compute_grant_financials(
    total_project_cost: float,
    acquisition_cost: float = 0.0,
) -> GrantFinancials:
    """Calculate NOF grant financials.

    NOF provides up to 75% of total project cost, max $250,000.
    TAF (Technical Assistance Fund) is up to 20% of base grant, max $50,000.
    Owner must finance at least 50% of total project cost.
    Exterior work must be at least 10% of base grant for grants >$25,000.

    Acquisition cost can be covered at up to 100% of appraised value,
    but is part of the total project cost.
    """
    # Handle invalid inputs
    if total_project_cost <= 0:
        return GrantFinancials(
            total_project_cost=0.0,
            acquisition_cost=0.0,
            base_grant=0.0,
            taf_eligible=0.0,
            owner_contribution=0.0,
            owner_min_financing=0.0,
            exterior_work_minimum=0.0,
        )

    # Calculate base grant: 75% of total project cost, max $250,000
    base_grant = round(min(total_project_cost * 0.75, 250_000.0), 2)

    # Calculate TAF eligibility: 20% of base grant, max $50,000
    taf_eligible = round(min(base_grant * 0.20, 50_000.0), 2)

    # Calculate owner contribution: total cost minus base grant
    owner_contribution = round(total_project_cost - base_grant, 2)

    # Calculate minimum owner financing: 50% of total project cost
    owner_min_financing = round(total_project_cost * 0.50, 2)

    # Calculate exterior work minimum: 10% of base grant if base grant > $25,000
    exterior_work_minimum = round(base_grant * 0.10, 2) if base_grant > 25_000 else 0.0

    return GrantFinancials(
        total_project_cost=round(total_project_cost, 2),
        acquisition_cost=round(acquisition_cost, 2),
        base_grant=base_grant,
        taf_eligible=taf_eligible,
        owner_contribution=owner_contribution,
        owner_min_financing=owner_min_financing,
        exterior_work_minimum=exterior_work_minimum,
    )

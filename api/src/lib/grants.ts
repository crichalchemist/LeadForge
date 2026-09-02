// =py grants/financial_calculator.compute_grant_financials
export interface GrantFinancials {
  total_project_cost: number;
  acquisition_cost: number;
  base_grant: number;
  taf_eligible: number;
  owner_contribution: number;
  owner_min_financing: number;
  exterior_work_minimum: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeGrantFinancials(totalProjectCost: number, acquisitionCost = 0): GrantFinancials {
  if (totalProjectCost <= 0) {
    return { total_project_cost: 0, acquisition_cost: 0, base_grant: 0, taf_eligible: 0, owner_contribution: 0, owner_min_financing: 0, exterior_work_minimum: 0 };
  }
  const base_grant = round2(Math.min(totalProjectCost * 0.75, 250_000));
  const taf_eligible = round2(Math.min(base_grant * 0.2, 50_000));
  return {
    total_project_cost: round2(totalProjectCost),
    acquisition_cost: round2(acquisitionCost),
    base_grant,
    taf_eligible,
    owner_contribution: round2(totalProjectCost - base_grant),
    owner_min_financing: round2(totalProjectCost * 0.5),
    exterior_work_minimum: base_grant > 25_000 ? round2(base_grant * 0.1) : 0,
  };
}

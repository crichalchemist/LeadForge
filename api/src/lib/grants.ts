export interface GrantFinancialInput {
  business_annual_revenue: number | null;
  employee_count: number | null;
  years_in_business: number;
  in_corridor: boolean;
  digital_deficit_score: number;
}

export interface GrantFinancialResult {
  estimated_baseline: number;
  corridor_bonus: number;
  digital_deficit_bonus: number;
  revenue_factor: number;
  total_estimated: number;
}

export function calculateGrantFunding(inputs: GrantFinancialInput): GrantFinancialResult {
  const BASELINE = 3000;
  const CORRIDOR_BONUS = 2000;
  const DEFICIT_BONUS_MAX = 1500;
  const REVENUE_MULTIPLIER_MAX = 2.0;
  const REVENUE_THRESHOLD = 500000;

  const estimated_baseline = BASELINE;
  const corridor_bonus = inputs.in_corridor ? CORRIDOR_BONUS : 0;
  const digital_deficit_bonus = Math.round((inputs.digital_deficit_score / 100) * DEFICIT_BONUS_MAX);

  let revenue_factor = 1.0;
  if (inputs.business_annual_revenue && inputs.business_annual_revenue > 0) {
    revenue_factor = Math.min(
      REVENUE_MULTIPLIER_MAX,
      1.0 + (inputs.business_annual_revenue / REVENUE_THRESHOLD)
    );
  }

  const total_estimated = Math.round(
    (estimated_baseline + corridor_bonus + digital_deficit_bonus) * revenue_factor
  );

  return {
    estimated_baseline,
    corridor_bonus,
    digital_deficit_bonus,
    revenue_factor: Math.round(revenue_factor * 100) / 100,
    total_estimated,
  };
}

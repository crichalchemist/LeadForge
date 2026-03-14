"""Tests for NOF grant financial calculator."""


from leadforge.grants.financial_calculator import compute_grant_financials


def test_standard_200k_project():
    f = compute_grant_financials(total_project_cost=200_000.0)
    assert f.base_grant == 150_000.0  # 75% of 200K
    assert f.taf_eligible == 30_000.0  # 20% of 150K
    assert f.owner_contribution == 50_000.0  # 200K - 150K
    assert f.owner_min_financing == 100_000.0  # 50% of 200K
    assert f.exterior_work_minimum == 15_000.0  # 10% of 150K (>25K)


def test_large_project_capped_at_250k():
    f = compute_grant_financials(total_project_cost=500_000.0)
    assert f.base_grant == 250_000.0  # capped at 250K
    assert f.taf_eligible == 50_000.0  # capped at 50K (20% of 250K = 50K)


def test_small_project_no_exterior():
    f = compute_grant_financials(total_project_cost=30_000.0)
    assert f.base_grant == 22_500.0  # 75% of 30K
    # base_grant 22.5K <= 25K, so no exterior minimum
    assert f.exterior_work_minimum == 0.0


def test_small_project_above_25k_exterior():
    f = compute_grant_financials(total_project_cost=40_000.0)
    assert f.base_grant == 30_000.0  # 75% of 40K
    assert f.exterior_work_minimum == 3_000.0  # 10% of 30K (>25K)


def test_zero_project_cost():
    f = compute_grant_financials(total_project_cost=0.0)
    assert f.base_grant == 0.0
    assert f.taf_eligible == 0.0
    assert f.owner_contribution == 0.0
    assert f.owner_min_financing == 0.0
    assert f.exterior_work_minimum == 0.0


def test_negative_project_cost():
    f = compute_grant_financials(total_project_cost=-50_000.0)
    assert f.base_grant == 0.0
    assert f.taf_eligible == 0.0
    assert f.owner_contribution == 0.0
    assert f.owner_min_financing == 0.0
    assert f.exterior_work_minimum == 0.0


def test_with_acquisition_cost():
    f = compute_grant_financials(
        total_project_cost=200_000.0, acquisition_cost=50_000.0
    )
    assert f.acquisition_cost == 50_000.0
    # Base grant calculation unchanged
    assert f.base_grant == 150_000.0


def test_rounding():
    # 33,333.33 * 0.75 = 24999.9975 → rounded to 25000.0
    f = compute_grant_financials(total_project_cost=33_333.33)
    assert f.base_grant == round(33_333.33 * 0.75, 2)
    assert f.taf_eligible == round(f.base_grant * 0.20, 2)
    assert f.owner_contribution == round(33_333.33 - f.base_grant, 2)
    assert f.owner_min_financing == round(33_333.33 * 0.50, 2)
    # All values have at most 2 decimal places
    for val in [
        f.base_grant,
        f.taf_eligible,
        f.owner_contribution,
        f.owner_min_financing,
        f.exterior_work_minimum,
    ]:
        assert val == round(val, 2)

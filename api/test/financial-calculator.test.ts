import { describe, expect, it } from 'vitest';
import { computeGrantFinancials } from '../src/lib/grants';

describe('computeGrantFinancials', () => {
  it('test_standard_200k_project', () => {
    const f = computeGrantFinancials(200_000);
    expect(f.base_grant).toBe(150_000);
    expect(f.taf_eligible).toBe(30_000);
    expect(f.owner_contribution).toBe(50_000);
    expect(f.owner_min_financing).toBe(100_000);
    expect(f.exterior_work_minimum).toBe(15_000);
  });
  it('test_large_project_capped_at_250k', () => {
    const f = computeGrantFinancials(500_000);
    expect(f.base_grant).toBe(250_000);
    expect(f.taf_eligible).toBe(50_000);
  });
  it('test_small_project_no_exterior', () => {
    const f = computeGrantFinancials(30_000);
    expect(f.base_grant).toBe(22_500);
    expect(f.exterior_work_minimum).toBe(0);
  });
  it('test_small_project_above_25k_exterior', () => {
    const f = computeGrantFinancials(40_000);
    expect(f.base_grant).toBe(30_000);
    expect(f.exterior_work_minimum).toBe(3_000);
  });
  it('test_zero_project_cost', () => {
    expect(computeGrantFinancials(0)).toEqual({ total_project_cost: 0, acquisition_cost: 0, base_grant: 0, taf_eligible: 0, owner_contribution: 0, owner_min_financing: 0, exterior_work_minimum: 0 });
  });
  it('test_negative_project_cost', () => {
    expect(computeGrantFinancials(-50_000).base_grant).toBe(0);
  });
  it('test_with_acquisition_cost', () => {
    const f = computeGrantFinancials(200_000, 50_000);
    expect(f.acquisition_cost).toBe(50_000);
    expect(f.base_grant).toBe(150_000);
  });
  it('test_rounding', () => {
    const f = computeGrantFinancials(33_333.33);
    expect(f.base_grant).toBe(Math.round(33_333.33 * 0.75 * 100) / 100);
    for (const v of [f.base_grant, f.taf_eligible, f.owner_contribution, f.owner_min_financing, f.exterior_work_minimum]) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
  });
});

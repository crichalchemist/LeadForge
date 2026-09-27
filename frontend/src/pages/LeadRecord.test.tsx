import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, VIEWER } from '../test/render';
import { httpError } from '../test/http';
import type { Business, Fact, FactKey, FactState, OutreachRecord, Provenance, Source, Transitions } from '../types';

vi.mock('../api/client', () => ({
  fetchBusiness: vi.fn(),
  fetchProvenance: vi.fn(),
  fetchTransitions: vi.fn(),
  startOutreach: vi.fn(),
  transitionStage: vi.fn(),
}));
import { fetchBusiness, fetchProvenance, fetchTransitions, startOutreach } from '../api/client';
import LeadRecord from './LeadRecord';

const SCORE = {
  id: 's1', score_version: 1, digital_deficit_score: 64, viability_score: null, competitive_pressure_score: null,
  composite_acquisition_score: 64, price_tier: null, sentiment_adjustment: null,
};
const BUSINESS: Business = {
  id: 'b1', name: 'Fixture Barbershop', address: '1 Fixture St', zip_code: '60619', phone: '(773) 555-0100', email: null,
  owner_name: null, niche: 'barbershops', license_number: '2874631', license_status: 'active',
  license_issue_date: '2019-05-15', incorporation_date: null, employee_count_est: null, estimated_monthly_revenue: null,
  google_place_id: 'ChIJ_fixture', thumbtack_hires: null, nextdoor_recommendations: null, total_customer_ugc: null,
  in_nof_corridor: true, nof_corridor_name: 'Priority corridor 7',
  created_at: '2026-09-26T00:00:00Z', updated_at: '2026-09-26T00:00:00Z',
  digital_presence: null, lead_scores: [SCORE], outreach_records: [],
};
const fact = (key: FactKey, value: Fact['value'], sources: Source[], state: FactState = 'found'): Fact => ({ key, value, sources, state });
const PROVENANCE: Provenance = {
  license: {
    license_name: 'Fixture Barbershop', account_number: '478849', site_number: '1', license_number: '2874631',
    license_status: 'active', license_issue_date: '2019-05-15',
  },
  google: {
    status: 'matched', place_id: 'ChIJ_fixture', matched_name: 'Fixture Barbershop', score: 1, distance_m: 11,
    website: 'http://fixture-barbershop.test', phone: '(773) 555-0100', looked_up_at: '2026-09-26T00:00:00Z',
  },
  overture: {
    matched: 1, matched_name: 'Fixture Barbershop', score: 1, distance_m: 5, website: 'http://fixture-barbershop.test',
    has_facebook: 0, has_instagram: 0, phone: null, built_at: '2026-09-25T00:00:00Z',
  },
  facts: [
    fact('name', 'Fixture Barbershop', ['license']),
    fact('license_status', 'active', ['license']),
    fact('website', 'http://fixture-barbershop.test', ['google', 'overture']),
    fact('phone', '(773) 555-0100', ['google']),
    fact('google_business_profile', true, ['google']),
    fact('rating', null, [], 'unknown'),
    fact('review_count', 47, ['google']),
    fact('facebook', false, [], 'none_found'),
    fact('instagram', false, [], 'none_found'),
  ],
};
const TRANSITIONS = { scored: ['queued', 'disqualified'] } as unknown as Transitions;

beforeEach(() => {
  vi.mocked(fetchBusiness).mockResolvedValue(BUSINESS);
  vi.mocked(fetchProvenance).mockResolvedValue(PROVENANCE);
  vi.mocked(fetchTransitions).mockResolvedValue(TRANSITIONS);
  vi.mocked(startOutreach).mockReset();
});

const open = (options: Parameters<typeof renderWithProviders>[1] = {}) =>
  renderWithProviders(<LeadRecord />, { route: '/leads/b1', path: '/leads/:id', ...options });

describe('the lead record', () => {
  it('shows which sources supplied each fact', async () => {
    open();
    const website = (await screen.findByText('Website')).parentElement!;
    expect(within(website).getByText('Google Places')).toBeTruthy();
    expect(within(website).getByText('Overture')).toBeTruthy();
    expect(within(website).queryByText('City licence')).toBeNull();
  });

  it('says none found where a source looked, and unknown where none could', async () => {
    open();
    const facebook = (await screen.findByText('Facebook')).parentElement!;
    expect(within(facebook).getByText('none found')).toBeTruthy();
    const rating = screen.getByText('Google rating').parentElement!;
    expect(within(rating).getByText('unknown')).toBeTruthy();
  });

  it('explains a missing composite instead of showing a number', async () => {
    vi.mocked(fetchBusiness).mockResolvedValue({
      ...BUSINESS, lead_scores: [{ ...SCORE, digital_deficit_score: null, composite_acquisition_score: null }],
    });
    vi.mocked(fetchProvenance).mockResolvedValue({ ...PROVENANCE, google: { ...PROVENANCE.google!, status: 'unavailable' } });
    open();
    expect(await screen.findByText('Places was unavailable during discovery')).toBeTruthy();
    const score = screen.getByRole('region', { name: 'Score' });
    expect(within(score).queryAllByText(/^\d+(\.\d+)?$/)).toHaveLength(0);
  });

  it('labels a version-1 composite as preliminary', async () => {
    open();
    const score = await screen.findByRole('region', { name: 'Score' });
    expect(await within(score).findByText('v1 · preliminary')).toBeTruthy();
  });

  it('puts the lead on the outreach line with Start outreach', async () => {
    vi.mocked(startOutreach).mockResolvedValue({} as OutreachRecord);
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Start outreach' }));
    expect(vi.mocked(startOutreach).mock.calls[0][0]).toBe('b1');
  });

  it('offers only the transfers the backend allows from the current station', async () => {
    vi.mocked(fetchBusiness).mockResolvedValue({ ...BUSINESS, outreach_records: [{ id: 'o1', status: 'scored' } as OutreachRecord] });
    open();
    const route = await screen.findByRole('region', { name: 'Route' });
    await within(route).findByRole('button', { name: 'Transfer to Queued' });
    expect(within(route).getAllByRole('button').map((b) => b.textContent)).toEqual(['Transfer to Queued', 'Transfer to Disqualified']);
  });

  it('shows a viewer the record without Start outreach or transfers', async () => {
    open({ user: VIEWER });
    await screen.findByRole('heading', { name: 'Fixture Barbershop' });
    expect(screen.queryByRole('button', { name: 'Start outreach' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Transfer to/ })).toHaveLength(0);
  });

  it('says the lead is not in the system when the id is unknown', async () => {
    vi.mocked(fetchBusiness).mockRejectedValue(httpError(404));
    open();
    expect(await screen.findByText('This lead isn’t in the system')).toBeTruthy();
  });

  it('shows the station after a duplicate start instead of failing silently', async () => {
    vi.mocked(startOutreach).mockRejectedValue(httpError(409, { outreach_id: 'o1' }));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Start outreach' }));
    expect(await screen.findByText('This lead was already on the outreach line; its station is shown above.')).toBeTruthy();
  });
});

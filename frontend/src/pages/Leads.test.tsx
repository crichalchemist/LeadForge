import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders, VIEWER } from '../test/render';
import { setMedia } from '../test/media';
import type { Business, Provenance, RankedLead, Transitions } from '../types';

vi.mock('../api/client', () => ({
  fetchRankedLeads: vi.fn(),
  fetchBusiness: vi.fn(),
  fetchProvenance: vi.fn(),
  fetchTransitions: vi.fn(),
  startOutreach: vi.fn(),
  transitionStage: vi.fn(),
}));
import { fetchBusiness, fetchProvenance, fetchRankedLeads, fetchTransitions } from '../api/client';
import Leads from './Leads';

const WIDE = '(min-width: 1200px)';
const LEAD: RankedLead = {
  business_id: 'b1', business_name: 'Fixture Barbershop', zip_code: '60619', niche: 'barbershops',
  composite_acquisition_score: 64, score_version: 1, price_tier: null, pipeline_stage: null,
  in_nof_corridor: false, nof_corridor_name: null, account_number: '478849', site_number: '1',
};
const listOf = (items: RankedLead[]) => ({ items, total: items.length, page: 1, page_size: 50 });

function Address() {
  const location = useLocation();
  return <output aria-label="address">{location.pathname + location.search}</output>;
}

beforeEach(() => {
  vi.mocked(fetchRankedLeads).mockReset().mockResolvedValue(listOf([LEAD]));
  vi.mocked(fetchBusiness).mockResolvedValue({
    id: 'b1', name: 'Fixture Barbershop', zip_code: '60619', niche: 'barbershops', in_nof_corridor: false,
    nof_corridor_name: null, lead_scores: [], outreach_records: [],
  } as unknown as Business);
  vi.mocked(fetchProvenance).mockResolvedValue({
    license: {
      license_name: null, account_number: null, site_number: null, license_number: null, license_status: null,
      license_issue_date: null,
    },
    google: null,
    overture: null,
    facts: [],
  } satisfies Provenance);
  vi.mocked(fetchTransitions).mockResolvedValue({} as Transitions);
});

describe('leads', () => {
  it('keeps the filters in the address, so a reload returns to them', async () => {
    renderWithProviders(<><Leads /><Address /></>, { route: '/leads?zip=60619', path: '/leads' });
    await screen.findByText('Fixture Barbershop');
    expect(vi.mocked(fetchRankedLeads).mock.calls[0][0]).toMatchObject({ zip_code: '60619', page: 1, page_size: 50 });
    await userEvent.selectOptions(screen.getByLabelText('Niche'), 'barbershops');
    expect(screen.getByLabelText('address').textContent).toBe('/leads?zip=60619&niche=barbershops');
  });

  it('teaches what a discovery run does when there are no leads yet', async () => {
    vi.mocked(fetchRankedLeads).mockResolvedValue(listOf([]));
    renderWithProviders(<Leads />, { route: '/leads', path: '/leads' });
    expect(await screen.findByText(/A discovery run looks up licensed businesses/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Plan a run/ })).toBeTruthy();
  });

  it('gives a viewer no Plan a run', async () => {
    renderWithProviders(<Leads />, { route: '/leads', path: '/leads', user: VIEWER });
    await screen.findByText('Fixture Barbershop');
    expect(screen.queryByRole('link', { name: /Plan a run/ })).toBeNull();
  });

  it('opens the record beside the list on a wide screen', async () => {
    setMedia(WIDE, true);
    renderWithProviders(<Leads />, { route: '/leads/b1', path: '/leads/:id' });
    expect(await screen.findByRole('heading', { name: 'Fixture Barbershop' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Ranked leads' })).toBeTruthy();
  });

  it('keeps one scarlet plate on the screen when a record is open', async () => {
    setMedia(WIDE, true);
    const { container } = renderWithProviders(<Leads />, { route: '/leads/b1', path: '/leads/:id' });
    await screen.findByRole('button', { name: 'Start outreach' });
    expect(container.querySelectorAll('[data-plate]')).toHaveLength(1);
  });

  it('replaces the list with the record on a narrow screen, with a way back to the same filters', async () => {
    setMedia(WIDE, false);
    renderWithProviders(<Leads />, { route: '/leads/b1?zip=60619', path: '/leads/:id' });
    const back = await screen.findByRole('link', { name: 'Back to leads' });
    expect(back.getAttribute('href')).toBe('/leads?zip=60619');
    expect(screen.queryByRole('list', { name: 'Ranked leads' })).toBeNull();
  });
});

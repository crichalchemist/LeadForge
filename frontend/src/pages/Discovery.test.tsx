import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, VIEWER } from '../test/render';
import { httpError } from '../test/http';
import type { DiscoveryRunResult } from '../types';

vi.mock('../api/client', () => ({ runDiscovery: vi.fn() }));
import { runDiscovery } from '../api/client';
import Discovery from './Discovery';

const REPORT: DiscoveryRunResult = {
  zip_code: '60619', niche: 'barbershops', limit: 10, discovered: 1, created: 1, skipped_known: 3, failed: 0,
  places: { unavailable: 0, last_status: null },
  businesses: [{ id: 'b1', name: 'Fixture Barbershop', zip_code: '60619', digital_deficit_score: 64, nof_corridor: 'Priority corridor 7' }],
};

// Vitest treats a value returned from beforeEach as a teardown callback and invokes it after the test;
// vi.fn().mockReset() returns the mock itself, which mockRejectedValue leaves callable, so an implicit
// return here would re-invoke the mock (and reject) after every test. The block body discards it.
beforeEach(() => {
  vi.mocked(runDiscovery).mockReset();
});

async function runWith(zip = '60619') {
  await userEvent.type(screen.getByLabelText('Zip code'), zip);
  await userEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
}

describe('discovery', () => {
  it('estimates twice the limit in Places calls before anything is spent', async () => {
    renderWithProviders(<Discovery />);
    const limit = screen.getByLabelText('Businesses to look up');
    await userEvent.clear(limit);
    await userEvent.type(limit, '7');
    expect(screen.getByText('Up to 14 Places calls')).toBeTruthy();
    expect(runDiscovery).not.toHaveBeenCalled();
  });

  it('reports businesses it already knew apart from the ones it created', async () => {
    vi.mocked(runDiscovery).mockResolvedValue(REPORT);
    renderWithProviders(<Discovery />);
    await runWith();
    const report = await screen.findByRole('region', { name: 'Service report' });
    expect(within(report).getByText('Created').nextElementSibling?.textContent).toBe('1');
    expect(within(report).getByText('Already known').nextElementSibling?.textContent).toBe('3');
    expect(within(report).getByRole('link', { name: 'Fixture Barbershop' }).getAttribute('href')).toBe('/leads/b1');
    expect(vi.mocked(runDiscovery).mock.calls[0][0]).toEqual({ zip_code: '60619', niche: 'barbershops', limit: 10 });
  });

  it('warns when Places left lookups unanswered', async () => {
    vi.mocked(runDiscovery).mockResolvedValue({ ...REPORT, places: { unavailable: 2, last_status: 'KEY_NOT_SET' } });
    renderWithProviders(<Discovery />);
    await runWith();
    expect(await screen.findByText('2 lookups went unanswered (KEY_NOT_SET); those businesses are stored unmeasured.')).toBeTruthy();
  });

  it('names the field the Worker rejected, and how to fix it', async () => {
    vi.mocked(runDiscovery).mockRejectedValue(httpError(422, { detail: [{ path: ['zip_code'], message: 'too short' }] }));
    renderWithProviders(<Discovery />);
    await runWith('606');
    expect(await screen.findByText('Enter a zip code of 5 to 10 characters, such as 60619.')).toBeTruthy();
    expect(screen.getByLabelText('Zip code').getAttribute('aria-invalid')).toBe('true');
  });

  it('still says something when the Worker rejects a field the form does not show', async () => {
    vi.mocked(runDiscovery).mockRejectedValue(httpError(422, { detail: [{ path: ['unexpected'], message: 'bad' }] }));
    renderWithProviders(<Discovery />);
    await runWith();
    expect((await screen.findByRole('alert')).textContent).toContain('The Worker refused these settings');
  });

  it('says a stopped run can be retried without paying twice for what it stored', async () => {
    vi.mocked(runDiscovery).mockRejectedValue(httpError(500));
    renderWithProviders(<Discovery />);
    await runWith();
    expect((await screen.findByRole('alert')).textContent).toContain('Businesses already stored are skipped next time');
  });

  it('gives a viewer no way to run discovery', () => {
    renderWithProviders(<Discovery />, { user: VIEWER });
    expect(screen.queryByRole('button', { name: 'Run discovery' })).toBeNull();
    expect(screen.getByText('Runs are admin-only.')).toBeTruthy();
  });
});

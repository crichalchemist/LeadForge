import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LeadScore, RankedLead } from '../types';
import { Select } from './Field';
import { Plate } from './Plate';
import { RouteRow } from './RouteRow';
import { ScoreSegments } from './ScoreSegments';
import { SourceBullets } from './SourceBullets';
import { TransferButton } from './TransferButton';

const LEAD: RankedLead = {
  business_id: 'b1', business_name: 'Fixture Barbershop', zip_code: '60619', niche: 'barbershops',
  composite_acquisition_score: 64, score_version: 1, price_tier: null, pipeline_stage: null,
  in_nof_corridor: false, nof_corridor_name: null, account_number: '478849', site_number: '1',
};

const SCORE: LeadScore = {
  id: 's1', score_version: 1, digital_deficit_score: 64, viability_score: null, competitive_pressure_score: null,
  composite_acquisition_score: 64, price_tier: null, sentiment_adjustment: null,
};

const renderRow = (lead: RankedLead) =>
  render(
    <MemoryRouter>
      <ol>
        <RouteRow lead={lead} rank={1} to="/leads/b1" />
      </ol>
    </MemoryRouter>,
  );

describe('source bullets', () => {
  it('lists sources in licence, Google, Overture order whatever order they arrive in', () => {
    const { container } = render(<SourceBullets sources={['overture', 'license', 'google']} />);
    const text = container.textContent ?? '';
    expect(text.indexOf('City licence')).toBeLessThan(text.indexOf('Google Places'));
    expect(text.indexOf('Google Places')).toBeLessThan(text.indexOf('Overture'));
  });
});

describe('route row', () => {
  it('never shows a number for a lead that was not measured', () => {
    renderRow({ ...LEAD, composite_acquisition_score: null });
    const link = screen.getByRole('link');
    expect(within(link).getByText('not measured')).toBeTruthy();
    const numbers = within(link).queryAllByText(/^\d+(\.\d+)?$/).map((node) => node.textContent);
    expect(numbers).toEqual(['1']); // the rank, and nothing else
  });

  it('labels a version-1 score as preliminary', () => {
    renderRow(LEAD);
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.getByText('v1 · preliminary')).toBeTruthy();
  });

  it('prints the label grid as niche, zip and account under the name, never calling the account a licence', () => {
    renderRow(LEAD);
    const labelGrid = screen.getByText('Fixture Barbershop').nextElementSibling!;
    expect(labelGrid.textContent).toBe('Barbershops · 60619 · Account 478849-1');
    expect(screen.getByRole('link').textContent).not.toMatch(/Licence/);
  });

  it('marks a corridor business with the interchange, in words', () => {
    renderRow({ ...LEAD, in_nof_corridor: true, nof_corridor_name: 'Priority corridor 7' });
    expect(screen.getByText('NOF corridor')).toBeTruthy();
  });

  it('keeps the full-width row on one line, the composite beside the name', () => {
    renderRow(LEAD);
    const nameColumn = screen.getByText('Fixture Barbershop').parentElement!;
    expect(within(nameColumn).queryByText('64')).toBeNull();
  });

  it('gives the name the whole column beside an open record, the composite moved under the label grid', () => {
    render(
      <MemoryRouter>
        <ol>
          <RouteRow lead={LEAD} rank={1} to="/leads/b1" selected besideRecord />
        </ol>
      </MemoryRouter>,
    );
    const nameColumn = screen.getByText('Fixture Barbershop').parentElement!;
    expect(within(nameColumn).getByText('64')).toBeTruthy();
    expect(within(nameColumn).getByText('v1 · preliminary')).toBeTruthy();
  });

  it('dims the other rows’ stations beside an open record, keeping their names at full contrast', () => {
    const { container } = render(
      <MemoryRouter>
        <ol>
          <RouteRow lead={LEAD} rank={1} to="/leads/b1" selected besideRecord />
          <RouteRow lead={{ ...LEAD, business_id: 'b2', business_name: 'Fixture Salon' }} rank={2} to="/leads/b2" besideRecord />
        </ol>
      </MemoryRouter>,
    );
    const station = (id: string) => container.querySelector(`[data-row="${id}"] [data-station]`)!.className;
    expect(station('b1')).toContain('bg-text');
    expect(station('b2')).toContain('bg-dim');
    expect(screen.getByText('Fixture Salon').className).toContain('text-text');
  });
});

describe('plates and secondary controls', () => {
  it('draws a disabled plate from the palette’s seam and secondary text, not a faded scarlet', () => {
    render(<Plate disabled>Running…</Plate>);
    const plate = screen.getByRole('button', { name: 'Running…' });
    expect(plate.className).toContain('disabled:bg-seam');
    expect(plate.className).toContain('disabled:text-dim');
    expect(plate.className).not.toContain('opacity');
  });

  it('draws a disabled transfer from the same palette roles', () => {
    render(<TransferButton to="Queued" disabled />);
    const button = screen.getByRole('button', { name: 'Transfer to Queued' });
    expect(button.className).toContain('disabled:bg-seam');
    expect(button.className).not.toContain('opacity');
  });
});

describe('select', () => {
  it('draws its own chevron in place of the browser’s arrow', () => {
    render(
      <label>
        Niche
        <Select defaultValue="">
          <option value="">All niches</option>
        </Select>
      </label>,
    );
    const select = screen.getByLabelText('Niche');
    expect(select.className).toContain('appearance-none');
    expect(select.parentElement!.querySelector('svg.lucide-chevron-down')).toBeTruthy();
  });
});

describe('score segments', () => {
  it('draws an unmeasured term as a named planned segment, never as zero', () => {
    render(<ScoreSegments score={SCORE} deficitSources={['google']} />);
    const viability = screen.getByText('Viability · 35%').closest('li')!;
    expect(within(viability).getByText('not measured')).toBeTruthy();
    expect(within(viability).queryByText('0')).toBeNull();
  });

  it('sizes each term by its weight in the composite', () => {
    render(<ScoreSegments score={SCORE} deficitSources={[]} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.style.flexGrow)).toEqual(['40', '35', '25']);
  });
});

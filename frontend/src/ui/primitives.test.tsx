import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LeadScore, RankedLead } from '../types';
import { RouteRow } from './RouteRow';
import { ScoreSegments } from './ScoreSegments';
import { SourceBullets } from './SourceBullets';

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

  it('prints the label grid as niche, zip and licence account under the name', () => {
    renderRow(LEAD);
    expect(screen.getByText('Barbershops · 60619 · Licence 478849-1')).toBeTruthy();
  });

  it('marks a corridor business with the interchange, in words', () => {
    renderRow({ ...LEAD, in_nof_corridor: true, nof_corridor_name: 'Priority corridor 7' });
    expect(screen.getByText('NOF corridor')).toBeTruthy();
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

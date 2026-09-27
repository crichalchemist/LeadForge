import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { STAGE_LABELS } from '../types';
import { MAIN_ROUTE, StripMap } from './StripMap';

const props = (over: Partial<ComponentProps<typeof StripMap>> = {}): ComponentProps<typeof StripMap> => ({
  stage: 'scored', allowed: ['queued', 'disqualified'], corridorName: null, canAct: true, busy: false,
  onStart: vi.fn(), onTransfer: vi.fn(), ...over,
});

describe('strip map', () => {
  it('offers a transfer only to the stations the backend allows', async () => {
    const onTransfer = vi.fn();
    render(<StripMap {...props({ onTransfer })} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Transfer to Queued', 'Transfer to Disqualified']);
    await userEvent.click(screen.getByRole('button', { name: 'Transfer to Queued' }));
    expect(onTransfer).toHaveBeenCalledWith('queued');
  });

  it('shows a lead that is not on the line as planned track, with Start outreach', async () => {
    const onStart = vi.fn();
    render(<StripMap {...props({ stage: null, allowed: [], onStart })} />);
    expect(screen.getByText('Not on the outreach line yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start outreach' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('draws an unstarted lead’s whole outreach route as planned stations, with none passed or current', () => {
    const { container } = render(<StripMap {...props({ stage: null, allowed: [] })} />);
    const line = screen.getByRole('list', { name: 'Outreach line, planned' });
    const stations = within(line).getAllByRole('listitem');
    expect(stations.map((li) => li.textContent)).toEqual(
      MAIN_ROUTE.map((stage) => `${STAGE_LABELS[stage]}, planned`),
    );
    expect(container.querySelector('.strip-map__planned-track line')?.getAttribute('stroke-dasharray')).toBe('6 4');
    // No trace: nothing is drawn as travelled or current for a lead that has not started.
    expect(container.querySelectorAll('.strip-map__station--passed, .strip-map__station--current')).toHaveLength(0);
    expect(container.querySelector('.strip-map__line')).toBeNull();
  });

  it('gives a viewer the planned route without Start outreach', () => {
    render(<StripMap {...props({ stage: null, allowed: [], canAct: false })} />);
    expect(screen.getByRole('list', { name: 'Outreach line, planned' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('draws a corridor lead’s grant line as planned track meeting the outreach line at the interchange', () => {
    const { container } = render(<StripMap {...props({ stage: null, allowed: [], corridorName: 'Priority corridor 7' })} />);
    const interchange = container.querySelector('.strip-map__interchange')!;
    expect(interchange.textContent).toContain('NOF corridor');
    expect(interchange.textContent).toContain('Grant line: not started · Priority corridor 7');
    expect(interchange.querySelector('.strip-map__ring')).toBeTruthy();
    const grantTrack = interchange.querySelector('line')!;
    expect(grantTrack.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(grantTrack.getAttribute('class')).toBe('stroke-line-grant');
    // The interchange sits on the planned outreach route, above its first station.
    const route = container.querySelector('.strip-map__planned')!;
    expect(route.contains(interchange)).toBe(true);
    expect(interchange.compareDocumentPosition(screen.getByText('Scored')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('dims the grant line while the lead rides the outreach line, so the traced route leads', () => {
    const { container } = render(<StripMap {...props({ corridorName: 'Priority corridor 7' })} />);
    const interchange = container.querySelector('.strip-map__interchange')!;
    expect(interchange.querySelector('line')!.getAttribute('class')).toBe('stroke-dim');
    expect(within(interchange as HTMLElement).getByText('NOF corridor').className).toContain('text-dim');
    expect(screen.getByRole('list', { name: 'Outreach line' })).toBeTruthy();
  });

  it('gives a viewer the route without any control', () => {
    render(<StripMap {...props({ stage: 'queued', canAct: false })} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('draws the grant interchange before the outreach line for a corridor business', () => {
    const { container } = render(<StripMap {...props({ corridorName: 'Priority corridor 7' })} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Grant line: not started · Priority corridor 7');
    expect(text.indexOf('Grant line')).toBeLessThan(text.indexOf('Scored'));
  });

  it('names the current station in words, not by color alone', () => {
    render(<StripMap {...props({ stage: 'queued', allowed: [] })} />);
    const station = screen.getByText('Queued').closest('li')!;
    expect(station.textContent).toContain('current');
  });

  it('draws a branch station off the main line without inventing where the lead came from', () => {
    const { container } = render(<StripMap {...props({ stage: 'lost', allowed: ['nurture'] })} />);
    expect(container.querySelectorAll('.strip-map__station--passed')).toHaveLength(0);
    const branch = screen.getByRole('list', { name: 'Off the main line' });
    expect(within(branch).getByText('Lost')).toBeTruthy();
  });
});

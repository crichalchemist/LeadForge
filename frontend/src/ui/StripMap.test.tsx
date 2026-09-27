import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { StripMap } from './StripMap';

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

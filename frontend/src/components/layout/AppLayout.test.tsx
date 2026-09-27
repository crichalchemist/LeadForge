import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import AppLayout from './AppLayout';

const shell = () => renderWithProviders(<AppLayout><p>screen content</p></AppLayout>, { route: '/leads' });

describe('the line rail', () => {
  it('rings the station the operator is on', () => {
    shell();
    expect(screen.getByRole('link', { name: /leads/i }).getAttribute('aria-current')).toBe('page');
  });

  it('draws Map as planned track, not a destination', () => {
    shell();
    expect(screen.queryByRole('link', { name: /map/i })).toBeNull();
    expect(screen.getByText(/planned, not built yet/)).toBeTruthy();
  });

  it('offers a way past the rail straight to the screen', () => {
    shell();
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main');
  });
});

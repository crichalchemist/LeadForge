import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMedia } from '../test/media';
import { ThemeToggle } from './ThemeToggle';

const DARK = '(prefers-color-scheme: dark)';

describe('theme toggle', () => {
  it('is a radio group that applies and keeps the operator’s pick', async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('radio', { name: 'Porcelain' }));
    expect(document.documentElement.dataset.theme).toBe('porcelain');
    expect(localStorage.getItem('leadforge.theme')).toBe('porcelain');
  });

  it('keeps following the operating system while System is picked', () => {
    setMedia(DARK, false);
    render(<ThemeToggle />);
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
    act(() => setMedia(DARK, true));
    expect(document.documentElement.dataset.theme).toBe('enamel');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMedia } from '../test/media';
import { THEME_STORAGE_KEY, applyTheme, readPreference, savePreference } from './theme';

const DARK = '(prefers-color-scheme: dark)';
const shown = () => document.documentElement.dataset.theme;

afterEach(() => vi.restoreAllMocks());

describe('theme selection', () => {
  it('follows the operating system until the operator picks a theme', () => {
    setMedia(DARK, true);
    applyTheme(readPreference());
    expect(shown()).toBe('enamel');
    setMedia(DARK, false);
    applyTheme(readPreference());
    expect(shown()).toBe('porcelain');
  });

  it('keeps the operator’s pick over the system setting, across a reload', () => {
    setMedia(DARK, true);
    savePreference('porcelain');
    expect(shown()).toBe('porcelain');
    expect(readPreference()).toBe('porcelain');
  });

  it('returns to following the system when System is picked again', () => {
    savePreference('enamel');
    setMedia(DARK, false);
    savePreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(shown()).toBe('porcelain');
  });

  it('falls back to System when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    setMedia(DARK, true);
    expect(readPreference()).toBe('system');
    applyTheme(readPreference());
    expect(shown()).toBe('enamel');
  });
});

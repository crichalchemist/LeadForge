// Theme choice (DESIGN.md, Colors). System, the default, follows the operating system; Enamel or Porcelain
// override it. The choice is a per-viewer convenience, so it lives in localStorage, and every access is
// guarded: a private window or blocked storage falls back to System instead of failing.
//
// index.html carries a pre-paint copy of resolveTheme(). Keep the two in step.
export type ThemePreference = 'system' | 'enamel' | 'porcelain';
export type Theme = 'enamel' | 'porcelain';

export const THEME_STORAGE_KEY = 'leadforge.theme';
const PREFERS_DARK = '(prefers-color-scheme: dark)';

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'enamel' || stored === 'porcelain' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return window.matchMedia(PREFERS_DARK).matches ? 'enamel' : 'porcelain';
}

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

export function savePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage refused: the pick still applies to this page view.
  }
  applyTheme(preference);
}

/** Calls onChange when the operating system switches between light and dark. Returns the unsubscribe. */
export function onSystemThemeChange(onChange: () => void): () => void {
  const query = window.matchMedia(PREFERS_DARK);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

import type { Page } from '@playwright/test';
import { ADMIN } from './seed.mjs';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/leads');
}

/** Sets the theme before the page's own scripts run, as a returning operator's saved pick would. */
export async function pickTheme(page: Page, theme: 'enamel' | 'porcelain'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('leadforge.theme', value), theme);
}

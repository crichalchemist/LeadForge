import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// The finish review reads these (.impeccable/review/, git-ignored): one batched capture at a desktop and a
// phone width, not a loop of screenshots.
test('shows the record beside the list on a desktop and alone with a way back on a phone', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/leads/e2e-barbershop');
  await expect(page.getByRole('heading', { name: 'E2E Fixture Barbershop', level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ranked leads' })).toBeVisible();
  await page.screenshot({ path: '../.impeccable/review/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'Back to leads' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ranked leads' })).toHaveCount(0);
  await page.screenshot({ path: '../.impeccable/review/mobile.png', fullPage: true });
});

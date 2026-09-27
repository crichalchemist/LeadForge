import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('an operator finds a lead, reads its sources, and moves it along the outreach line', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /E2E Fixture Barbershop/ }).click();

  const record = page.getByRole('article');
  await expect(record.getByRole('heading', { name: 'E2E Fixture Barbershop', level: 1 })).toBeVisible();

  // Google and Overture returned the same website, so both are credited.
  const website = record.locator('dt', { hasText: 'Website' }).locator('..');
  await expect(website.getByText('Google Places')).toBeAttached();
  await expect(website.getByText('Overture')).toBeAttached();

  await record.getByRole('button', { name: 'Start outreach' }).click();
  await record.getByRole('button', { name: 'Transfer to Queued' }).click();
  await expect(record.getByRole('list', { name: 'Outreach line' }).locator('li', { hasText: 'Queued' })).toContainText('current');
});

test('an unmeasured lead says why instead of showing a score', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /E2E Fixture Salon/ }).click();
  await expect(page.getByText('Places was unavailable during discovery')).toBeVisible();
});

test('the theme the operator picks survives a reload', async ({ page }) => {
  await signIn(page);
  await page.locator('label', { hasText: 'Porcelain' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'porcelain');
});

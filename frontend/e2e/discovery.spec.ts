import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('an operator sees the Places budget, runs discovery, and reads the service report', async ({ page }) => {
  // CI never calls Socrata or Google: the run itself is answered here, in the browser.
  await page.route('**/api/discovery/run', (route) =>
    route.fulfill({
      json: {
        zip_code: '60619', niche: 'barbershops', limit: 5, discovered: 1, created: 1, skipped_known: 2, failed: 0,
        places: { unavailable: 0, last_status: null },
        businesses: [
          { id: 'e2e-barbershop', name: 'E2E Fixture Barbershop', zip_code: '60619', digital_deficit_score: 7, nof_corridor: 'Priority corridor 7' },
        ],
      },
    }),
  );
  await signIn(page);
  await page.getByRole('link', { name: /Plan a run/ }).click();
  await page.getByLabel('Zip code').fill('60619');
  await page.getByLabel('Businesses to look up').fill('5');
  await expect(page.getByText('Up to 10 Places calls')).toBeVisible();

  await page.getByRole('button', { name: 'Run discovery' }).click();
  const report = page.getByRole('region', { name: 'Service report' });
  await expect(report.getByText('Already known')).toBeVisible();
  await report.getByRole('link', { name: 'E2E Fixture Barbershop' }).click();
  await expect(page).toHaveURL(/\/leads\/e2e-barbershop$/);
});

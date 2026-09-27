import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { pickTheme, signIn } from './helpers';

const SCREENS: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'Leads', path: '/leads', ready: (p) => p.getByRole('list', { name: 'Ranked leads' }).waitFor() },
  { name: 'the lead record', path: '/leads/e2e-barbershop', ready: (p) => p.getByRole('region', { name: 'Evidence' }).getByText('Website').waitFor() },
  { name: 'Discovery', path: '/discovery', ready: (p) => p.getByRole('button', { name: 'Run discovery' }).waitFor() },
];

for (const theme of ['enamel', 'porcelain'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await pickTheme(page, theme);
      await signIn(page);
    });

    for (const screen of SCREENS) {
      test(`${screen.name} meets WCAG 2.2 AA`, async ({ page }) => {
        await page.goto(screen.path);
        await screen.ready(page);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  });
}

test('an old station keeps the light surface it was written for, under enamel', async ({ page }) => {
  await pickTheme(page, 'enamel');
  await signIn(page);
  await page.goto('/dashboard');
  await expect(page.locator('[data-legacy-surface]')).toHaveCSS('background-color', 'rgb(249, 250, 251)');
});

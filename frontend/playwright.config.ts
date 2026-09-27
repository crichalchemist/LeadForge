import { defineConfig, devices } from '@playwright/test';

// The whole loop runs against the real Worker (wrangler dev --local, a fresh seeded D1 per run) behind the
// Vite dev server's /api proxy, exactly as local development does. The tests share one database, so they
// run one at a time. No retries: the database outlives a retry, so a core-loop test retried after "Start
// outreach" succeeded would fail on the missing button and replace the real error in the report.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node e2e/start-api.mjs', url: 'http://localhost:8787/api/health', timeout: 180_000, reuseExistingServer: false },
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', timeout: 60_000, reuseExistingServer: false },
  ],
});

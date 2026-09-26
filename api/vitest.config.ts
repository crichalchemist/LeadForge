import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
      return {
        // wrangler.jsonc declares an `ai` binding, and Workers AI has no local emulation, so the pool
        // defaults to opening a REMOTE PROXY SESSION for it against the real account. That needs
        // CLOUDFLARE_API_TOKEN, which a developer has cached from `wrangler login` and CI does not --
        // so the suite passed locally and failed on the first CI run with an auth error, not a test
        // failure. No test calls the service: queue.test.ts only does vi.spyOn(env.AI, 'run') with a
        // mocked result, so the binding needs to exist, not to work.
        remoteBindings: false,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: 'test-secret-key-for-unit-tests-only-0123456789abcdef',
            RETELL_API_KEY: 'test-retell-key',
            CORS_ORIGINS: 'http://localhost:5173',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
    include: ['test/**/*.test.ts'],
  },
});

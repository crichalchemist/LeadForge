import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
      return {
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

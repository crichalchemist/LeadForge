// Starts the Workers API for Playwright: a fresh local D1 under e2e/.state, migrated and seeded, then
// `wrangler dev --local`. --local because CI has no Cloudflare credentials: without it the `ai` binding
// opens a remote session and startup fails (measured 2026-09-26). The JWT secret is a throwaway passed
// with --var, never written to the tracked api/.dev.vars.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSql } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, '..', '..', 'api');
const state = join(here, '.state');

rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args, '--local', '--persist-to', state], { cwd: api, stdio: 'inherit' });

wrangler('d1', 'migrations', 'apply', 'leadforge-db');
const seedFile = join(state, 'seed.sql');
writeFileSync(seedFile, await seedSql());
wrangler('d1', 'execute', 'leadforge-db', '--file', seedFile);

const dev = spawn(
  'npx',
  ['wrangler', 'dev', '--local', '--port', '8787', '--persist-to', state, '--var', 'JWT_SECRET:e2e-only-not-a-secret'],
  { cwd: api, stdio: 'inherit' },
);
const stop = () => dev.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
dev.on('exit', (code) => process.exit(code ?? 0));

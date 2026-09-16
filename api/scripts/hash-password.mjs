#!/usr/bin/env node
// Prints a password hash in the same format as src/lib/password.ts, for bootstrapping the first admin:
//   node scripts/hash-password.mjs 'your-password'
//   npx wrangler d1 execute leadforge-db --remote --command "INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('<uuid>', 'you@example.com', '<hash>', 'Your Name', 'admin')"
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 50_000; // keep equal to src/lib/password.ts
const password = process.argv[2];
if (!password) { console.error('usage: hash-password.mjs <password>'); process.exit(1); }

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
console.log(`pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`);

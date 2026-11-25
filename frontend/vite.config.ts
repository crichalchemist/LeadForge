/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // `wrangler dev` serves the Workers API on 8787 and mounts every route under /api, so the prefix
      // is kept. The Python API mounted at the root and needed it stripped; it is no longer the target.
      '/api': { target: 'http://localhost:8787' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

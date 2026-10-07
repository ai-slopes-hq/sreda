import { defineConfig } from '@playwright/test';

// Drives the built Electron app (`pnpm build` first; `pnpm e2e` does both).
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.AUDIT_BASE_URL || 'http://localhost:5173',
    headless: true,
    trace: 'off',
  },
  reporter: [['list']],
});

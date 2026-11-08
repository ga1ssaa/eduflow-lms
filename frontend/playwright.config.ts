import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.EDUFLOW_E2E_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
});

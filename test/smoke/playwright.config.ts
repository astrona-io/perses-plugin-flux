import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'smoke.spec.ts',
  timeout: 90_000,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: '.state/results',
  use: {
    baseURL: `http://127.0.0.1:${process.env.SMOKE_PORT ?? '18095'}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
});

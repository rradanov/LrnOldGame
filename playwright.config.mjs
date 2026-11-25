import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/LrnOldGame/`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node tools/serve.mjs --port ${PORT} --test`,
    url: `http://localhost:${PORT}/LrnOldGame/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});

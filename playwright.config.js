import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5177', headless: true, trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'npm run dev -- --port 5177 --strictPort', url: 'http://127.0.0.1:5177/tests/browser/storage.html', reuseExistingServer: false },
});

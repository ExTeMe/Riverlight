import { defineConfig } from '@playwright/test';

const port = Number(process.env.RIVERLIGHT_EVIDENCE_PORT || 5198);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid evidence port');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/evidence',
  timeout: 180000,
  workers: 1,
  outputDir: 'test-results/dynamic-evidence',
  reporter: [['list']],
  use: {
    baseURL, headless: true,
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5,
    video: 'on', trace: 'on',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `${baseURL}/tests/browser/storage.html`, reuseExistingServer: false,
  },
});

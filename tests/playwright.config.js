// Playwright config for BST Flow.
//
//   npm run smoke   -> serves the repo locally (python -m http.server) and
//                      loads every page with Supabase + CDNs mocked. Offline.
//   npm run e2e     -> the full core loop against a deployed preview that
//                      uses the STAGING database. Needs E2E_BASE_URL etc.
//                      (see e2e/core-loop.spec.js for the env vars).
//
// In the Claude sandbox, browsers live in /opt/pw-browsers:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run smoke
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const SMOKE_PORT = Number(process.env.SMOKE_PORT || 4173);

module.exports = defineConfig({
  timeout: 60_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  projects: [
    {
      name: 'smoke',
      testDir: './smoke',
      use: { baseURL: `http://127.0.0.1:${SMOKE_PORT}` },
    },
    {
      name: 'e2e',
      testDir: './e2e',
      timeout: 180_000,
      use: { baseURL: process.env.E2E_BASE_URL, permissions: ['clipboard-read', 'clipboard-write'] },
    },
  ],
  // Only the smoke project needs a local server; it is cheap, so it always starts.
  webServer: {
    command: `python3 -m http.server ${SMOKE_PORT} --bind 127.0.0.1`,
    cwd: path.join(__dirname, '..'),
    url: `http://127.0.0.1:${SMOKE_PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
  },
});

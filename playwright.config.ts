import { defineConfig, devices } from '@playwright/test';
import { prepareWorkstation } from './tests/e2e/support/workstation';

// End-to-end tests are Peter's. The server must run on 127.0.0.1:4321 because the Host-header
// guard only admits that origin, so only one e2e server can run at a time.
//
// The server never reads the fixture in place: it runs on a disposable copy under
// `.local/peter/e2e/ws`, made fresh for every run (tests/e2e/support/workstation.ts), so the
// live specs can write into it. WATCHTOWER_E2E_ROOT overrides the copy (for example a copy you
// made yourself); specs that write refuse any root without the disposable marker.
//
// The config is evaluated again in every worker. The runner sets WATCHTOWER_E2E_ROOT before
// the workers start, so they inherit it and never re-copy the workstation mid-run.
if (!process.env.WATCHTOWER_E2E_ROOT) {
  process.env.WATCHTOWER_E2E_ROOT = prepareWorkstation();
}
const root = process.env.WATCHTOWER_E2E_ROOT;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // One server, one workstation: tests run one at a time. Specs that write (*.live.spec.ts)
  // restore what they changed and wait for the server to settle, so no spec sees another's writes.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://127.0.0.1:4321/api/snapshot',
    // Never reuse a server already on 4321 (for example a dev server on the real workstation):
    // Playwright fails instead, so e2e can only ever run against the disposable copy.
    reuseExistingServer: false,
    timeout: 180_000,
    env: { WATCHTOWER_ROOT: root },
  },
});

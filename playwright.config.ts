import { defineConfig, devices } from '@playwright/test';
import {
  E2E_HOST,
  E2E_LOG_DIR,
  E2E_PORT,
  prepareWorkstation,
} from './tests/e2e/support/workstation';

// End-to-end tests are Peter's.
//
// The e2e server runs on 127.0.0.1:4399, never 4321: the User may run the app there and
// Raphael the container. The Host guard admits 4399 through WATCHTOWER_ALLOWED_HOSTS.
// `reuseExistingServer: false` makes Playwright fail rather than test whatever already
// listens on the port.
//
// The server never reads the fixture in place: it runs on a disposable copy under
// `.local/peter/e2e/ws`, made fresh for every run (tests/e2e/support/workstation.ts), so the
// live specs can write into it. WATCHTOWER_E2E_ROOT overrides the copy (for example a copy you
// made yourself); specs that write refuse any root without the disposable marker. Its logs go
// to `.local/peter/e2e/logs`, never to the real limforia/logs.
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
    baseURL: `http://${E2E_HOST}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `http://${E2E_HOST}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    // Every variable the server reads is set here, so nothing from the shell leaks in.
    env: {
      NODE_ENV: 'production',
      PORT: String(E2E_PORT),
      HOST: '',
      WATCHTOWER_ROOT: root,
      WATCHTOWER_CONTAINER: '0',
      WATCHTOWER_TRUSTED_CLIENTS: '',
      WATCHTOWER_ALLOWED_HOSTS: `127.0.0.1:${E2E_PORT},localhost:${E2E_PORT}`,
      WATCHTOWER_POLL_MS: '',
      LOG_LEVEL: 'info',
      LOG_DIR: E2E_LOG_DIR,
    },
  },
});

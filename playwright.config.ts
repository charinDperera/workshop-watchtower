import { defineConfig, devices } from '@playwright/test';
import {
  E2E_HOST,
  E2E_LOG_DIR,
  E2E_PORT,
  GATEWAY_LOCAL_HOST,
  GATEWAY_LOG_DIR,
  GATEWAY_PORT,
  prepareWorkstation,
  PUBLIC_ORIGIN,
} from './tests/e2e/support/workstation';

// End-to-end tests are Peter's.
//
// The e2e server runs on 127.0.0.1:4399, never 4321: the User may run the app there and
// Raphael the container. The Host guard admits 4399 through WATCHTOWER_ALLOWED_HOSTS.
// `reuseExistingServer: false` makes Playwright fail rather than test whatever already
// listens on the port.
//
// A second server on 127.0.0.1:4398 runs on the same workstation as if behind the gateway
// (WATCHTOWER_PUBLIC_ORIGIN set; the main server has it unset). Only the HTTP-level
// public-origin spec talks to it.
//
// The servers never read the fixture in place: they run on a disposable copy under
// `.local/peter/e2e/ws`, made fresh for every run (tests/e2e/support/workstation.ts), so the
// live specs can write into it. WATCHTOWER_E2E_ROOT overrides the copy (for example a copy you
// made yourself); specs that write refuse any root without the disposable marker. Logs go to
// `.local/peter/e2e/logs` and `logs-gateway`, never to the real limforia/logs.
//
// The config is evaluated again in every worker. The runner sets WATCHTOWER_E2E_ROOT before
// the workers start, so they inherit it and never re-copy the workstation mid-run.
if (!process.env.WATCHTOWER_E2E_ROOT) {
  process.env.WATCHTOWER_E2E_ROOT = prepareWorkstation();
}
const root = process.env.WATCHTOWER_E2E_ROOT;

/** Every variable the server reads, set explicitly, so nothing from the shell leaks in. */
function serverEnv(o: { port: number; logDir: string; publicOrigin: string }) {
  return {
    NODE_ENV: 'production',
    PORT: String(o.port),
    HOST: '',
    WATCHTOWER_ROOT: root,
    WATCHTOWER_CONTAINER: '0',
    WATCHTOWER_TRUSTED_CLIENTS: '',
    WATCHTOWER_ALLOWED_HOSTS: `127.0.0.1:${o.port},localhost:${o.port}`,
    WATCHTOWER_POLL_MS: '',
    WATCHTOWER_PUBLIC_ORIGIN: o.publicOrigin,
    LOG_LEVEL: 'info',
    LOG_DIR: o.logDir,
  };
}

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
  webServer: [
    {
      command: 'pnpm build && pnpm start',
      url: `http://${E2E_HOST}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: serverEnv({ port: E2E_PORT, logDir: E2E_LOG_DIR, publicOrigin: '' }),
    },
    {
      // No build of its own: it must not rewrite dist/ while the first server builds. If
      // Playwright ever starts the two at once, this one fails to start (visible, not silent).
      command: 'pnpm start',
      url: `http://${GATEWAY_LOCAL_HOST}/api/health`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: serverEnv({ port: GATEWAY_PORT, logDir: GATEWAY_LOG_DIR, publicOrigin: PUBLIC_ORIGIN }),
    },
  ],
});

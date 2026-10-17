import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // Unit tests never write into the real limforia/logs: logs go to the app's ignored
    // .local folder, and the process-wide loggers are silent (tests that check log lines
    // build their own logger with a capture sink).
    env: {
      LOG_DIR: '.local/test-logs',
      LOG_LEVEL: 'silent',
    },
  },
});

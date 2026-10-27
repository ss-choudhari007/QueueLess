import { defineConfig } from 'vitest/config';
import { resolveTestDatabaseUrl } from './tests/testDb.js';

const { url } = resolveTestDatabaseUrl();

export default defineConfig({
  test: {
    globalSetup: './tests/globalSetup.js',
    environment: 'node',
    fileParallelism: false, // test files share one database schema
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_SECRET: 'test-only-secret-not-used-anywhere-else-0123456789abcdef',
      FRONTEND_URL: 'http://localhost:5173',
      RATE_LIMIT_ENABLED: 'false',
      WORKER_ENABLED: 'false',
      BCRYPT_ROUNDS: '4',
    },
  },
});

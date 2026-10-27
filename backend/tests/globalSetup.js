// Applies migrations to the isolated test schema once before the suite.
import { execSync } from 'node:child_process';
import { resolveTestDatabaseUrl } from './testDb.js';

export default function setup() {
  const { url, database } = resolveTestDatabaseUrl();
  console.log(`[tests] applying migrations to isolated database "${database}"`);
  execSync('npx prisma migrate deploy', {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, DATABASE_URL: url },
  });
}

// Resolves the isolated test database URL.
//
// Priority: TEST_DATABASE_URL, otherwise DATABASE_URL rewritten to
//   • the separate database "queueless_test" on the same server, so the
//     application database is never touched (raw SQL included)
//   • the direct (non-pooled) Neon host
// Tests refuse to run against any database whose name does not contain "test".
import 'dotenv/config';

export const TEST_DATABASE_FALLBACK = 'queueless_test';

export function resolveTestDatabaseUrl() {
  const source = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!source) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) in backend/.env to run tests.');
  const url = new URL(source);
  if (!process.env.TEST_DATABASE_URL) {
    url.hostname = url.hostname.replace('-pooler', '');
    url.pathname = `/${TEST_DATABASE_FALLBACK}`;
    url.searchParams.delete('schema');
  }
  const database = url.pathname.replace(/^\//, '');
  if (!/test/i.test(database)) {
    throw new Error(`Refusing to run tests against database "${database}". Use a database whose name contains "test".`);
  }
  url.searchParams.set('connection_limit', url.searchParams.get('connection_limit') || '20');
  return { url: url.toString(), database };
}

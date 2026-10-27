// Shared Prisma client — one connection pool for the whole process.
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

export const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One meaningful line of a database error (skips Prisma's generic
// "Invalid `prisma.x()` invocation" header). Never the connection string.
export function dbErrorSummary(error) {
  const lines = String(error?.message || error)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.find((l) => !l.startsWith('Invalid `')) || lines[0] || 'unknown error';
}

// Waits until the database answers, retrying with exponential backoff
// (1 s, 2 s, 4 s … capped at maxDelayMs). Neon databases that scaled to zero
// and brief network blips therefore do not crash the server. Prisma also
// reconnects on its own after later outages; requests made while the
// database is down get a 503 from the error handler.
export async function waitForDatabase(client = prisma, { maxDelayMs = 30_000, maxAttempts = Infinity, onRetry } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.$queryRaw`SELECT 1`;
      return attempt;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      const delay = Math.min(1000 * 2 ** (attempt - 1), maxDelayMs);
      onRetry?.({ attempt, delay, error });
      await sleep(delay);
    }
  }
}

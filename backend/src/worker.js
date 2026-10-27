// ─────────────────────────────────────────────────────────────
// Background processor. Runs at startup (catching deadlines that passed
// while the server was offline) and then every SWEEP_INTERVAL_MS.
// The database is the source of truth; every update re-checks state, so
// running several server instances at once is safe.
// ─────────────────────────────────────────────────────────────
import { closeFinishedDays, processDueNoShows } from './services/noShowService.js';

let timer = null;
let running = false;

export async function runSweep(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  try {
    const noShows = await processDueNoShows(now);
    const closed = await closeFinishedDays(now);
    if (noShows || closed) console.log(`[worker] no-shows marked: ${noShows}, waiting tokens closed: ${closed}`);
    return { noShows, closed };
  } catch (error) {
    console.error(`[worker] sweep failed: ${error.message}`);
    return { error: error.message };
  } finally {
    running = false;
  }
}

export function startWorker(intervalMs) {
  runSweep();
  timer = setInterval(runSweep, intervalMs);
  timer.unref?.();
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

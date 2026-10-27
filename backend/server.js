// ─────────────────────────────────────────────────────────────
// QueueLess — backend/server.js
//
// Entry point: validates configuration, starts the HTTP server and
// Socket.IO, waits for the database (retrying, never crashing on a slow or
// briefly unavailable database), then starts the background processor.
//
// Resilience:
//   • Missing/invalid configuration → clear message, exit (cannot run safely).
//   • Database unavailable → keep serving; /api/health and API calls return
//     503 until it is back; connection is retried with backoff.
//   • Port already in use → clear message, clean exit (port never changed).
//   • Unhandled promise rejection → logged, server keeps running.
//   • Uncaught exception → logged, graceful shutdown, exit(1) so the host
//     (Render/Railway/nodemon) restarts a clean process.
//   • SIGTERM/SIGINT (deploys) → graceful shutdown with a 10 s safety limit.
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import { assertConfig, config } from './src/config.js';
import { dbErrorSummary, prisma, waitForDatabase } from './src/db.js';
import { createApp } from './src/app.js';
import { createSocketServer } from './src/socket.js';
import { startWorker, stopWorker } from './src/worker.js';

function start() {
  try {
    assertConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error('   Copy backend/.env.example to backend/.env and fill in the values.');
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  let shuttingDown = false;

  const shutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${reason} — shutting down`);
    // Never hang a deploy: force exit if cleanup takes too long.
    setTimeout(() => process.exit(exitCode || 1), 10_000).unref();
    stopWorker();
    io.close();
    server.closeAllConnections?.();
    await prisma.$disconnect().catch(() => {});
    process.exit(exitCode);
  };

  // Fail clearly (instead of an unhandled 'error' event) when the port is taken
  // or not permitted. The port is never changed silently.
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${config.port} is already in use — is another QueueLess backend already running?`);
      console.error(`   Check: lsof -nP -iTCP:${config.port} -sTCP:LISTEN`);
      console.error('   Stop that process, or set a different PORT in backend/.env (and VITE_DEV_BACKEND for the frontend proxy).');
    } else if (error.code === 'EACCES') {
      console.error(`❌ Permission denied to listen on port ${config.port}. Use a port above 1024.`);
    } else {
      console.error(`❌ HTTP server error: ${error.message}`);
    }
    shutdown('Server could not start', 1);
  });

  server.listen(config.port, async () => {
    console.log(`✅ QueueLess API listening on http://localhost:${config.port}`);
    console.log(`   Health check   : http://localhost:${config.port}/api/health`);
    console.log(`   Environment    : ${config.nodeEnv}`);
    console.log(`   Allowed origins: ${config.frontendOrigins.join(', ')}`);

    await waitForDatabase(prisma, {
      onRetry: ({ attempt, delay, error }) =>
        console.error(
          `⚠️  Database not reachable (attempt ${attempt}): ${dbErrorSummary(error)} — retrying in ${delay / 1000}s. ` +
            'API requests return 503 until it is back. Check DATABASE_URL if this persists.'
        ),
    });
    if (shuttingDown) return;
    console.log('✅ Database connection verified');

    // Start the background processor only once this instance owns the port
    // and the database is reachable.
    if (config.workerEnabled) startWorker(config.sweepIntervalMs);
    console.log(`   No-show worker : ${config.workerEnabled ? `every ${config.sweepIntervalMs / 1000}s` : 'disabled'}`);
  });

  process.on('SIGINT', () => shutdown('SIGINT received'));
  process.on('SIGTERM', () => shutdown('SIGTERM received'));
  process.on('unhandledRejection', (reason) => {
    console.error('[process] Unhandled promise rejection (server keeps running):', reason?.stack || reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[process] Uncaught exception — restarting cleanly:', error?.stack || error);
    shutdown('Uncaught exception', 1);
  });
}

start();

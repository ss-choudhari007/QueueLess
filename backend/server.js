// ─────────────────────────────────────────────────────────────
// QueueLess — backend/server.js
//
// Entry point for the backend server.
//
// What this file does (Part 2, Step 2):
//   - Loads environment variables from .env
//   - Creates a shared Prisma database client
//   - Verifies database connectivity at startup (fails fast if DB is unreachable)
//   - Provides GET /api/health that reports both server and DB status
//   - Handles 404s with a consistent JSON error format
//
// What will be added in later parts:
//   - Authentication routes and middleware (Part 4)
//   - Queue routes, staff routes, owner routes (Parts 5–7)
//   - Socket.IO for real-time updates (Part 5)
// ─────────────────────────────────────────────────────────────

// ── 1. Load environment variables ────────────────────────────
// dotenv reads .env and populates process.env. Must be first.
import 'dotenv/config';

// ── 2. Imports ────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

// ── 3. Create shared Prisma client ────────────────────────────
// One PrismaClient instance is shared by the whole server.
// It manages a connection pool to the PostgreSQL database.
// Never create a new PrismaClient per request.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['warn', 'error']  // Log warnings and errors in development
    : ['error'],          // Log only errors in production
});

// ── 4. Read configuration ─────────────────────────────────────
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── 5. Create Express application ────────────────────────────
const app = express();

// ── 6. Middleware ─────────────────────────────────────────────

// CORS: allows the React frontend (on a different port) to call this API.
// credentials: true is required for HTTP-only cookies to be sent.
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);

// JSON body parser: parses JSON request bodies into req.body.
app.use(express.json());

// ── 7. Routes ─────────────────────────────────────────────────

// Health check endpoint — reports server AND database status.
// Calling this after startup tells you whether both layers are working.
// GET /api/health
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'unknown';
  try {
    // $queryRaw with a trivial query — confirms the DB is reachable.
    // No application data is read or written.
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'unreachable';
  }

  const isHealthy = dbStatus === 'connected';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    server: 'running',
    database: dbStatus,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ── 8. 404 handler ────────────────────────────────────────────
// Any request that didn't match a route above lands here.
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'This route does not exist on the QueueLess API.',
    },
  });
});

// ── 9. Startup: verify DB connectivity, then start server ─────
async function startServer() {
  // Attempt a real database ping before accepting traffic.
  // This catches misconfigured DATABASE_URL immediately at startup.
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection: verified (Neon PostgreSQL)');
  } catch (err) {
    // Print only the error message — never the connection string.
    console.error('❌ Database connection failed:', err.message);
    console.error('   Check DATABASE_URL in backend/.env');
    console.error('   The server will NOT start without a working database connection.');
    await prisma.$disconnect();
    process.exit(1); // Exit with error — fail fast so problems are visible immediately
  }

  app.listen(PORT, () => {
    console.log(`✅ QueueLess backend is running on http://localhost:${PORT}`);
    console.log(`   Health check : http://localhost:${PORT}/api/health`);
    console.log(`   Environment  : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Frontend URL : ${FRONTEND_URL}`);
    console.log('─────────────────────────────────────────────────');
    console.log('   Auth         : Not implemented (Part 4)');
  });
}

startServer();

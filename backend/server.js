// ─────────────────────────────────────────────────────────────
// QueueLess — backend/server.js
//
// This is the entry point for the backend server.
// It starts an Express HTTP server on the configured port.
//
// What this file does right now (Part 2, Step 1):
//   - Loads environment variables from the .env file
//   - Creates an Express application
//   - Configures CORS so the React frontend can call this server
//   - Provides a GET /api/health endpoint for verifying the server is up
//   - Starts listening for requests on the configured PORT
//
// What will be added in later parts:
//   - Database connection (Part 2 Step 2)
//   - Authentication routes and middleware (Part 4)
//   - Queue routes, staff routes, owner routes (Parts 5–7)
//   - Socket.IO for real-time updates (Part 5)
// ─────────────────────────────────────────────────────────────

// ── 1. Load environment variables ────────────────────────────
// dotenv reads the .env file and makes its values available via
// process.env. This must be the very first thing we do.
import 'dotenv/config';

// ── 2. Import packages ────────────────────────────────────────
import express from 'express';
import cors from 'cors';

// ── 3. Read configuration from environment variables ─────────
// If PORT is not set in .env, fall back to 4000.
const PORT = process.env.PORT || 4000;

// The URL of the frontend. Requests from this origin are allowed.
// In development this is typically http://localhost:5173 (Vite).
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── 4. Create the Express application ────────────────────────
const app = express();

// ── 5. Configure middleware ────────────────────────────────────
// Middleware is code that runs on every request before your route
// handlers run.

// CORS (Cross-Origin Resource Sharing):
// Browsers block requests from one website (the React frontend at
// localhost:5173) to a different website (this server at localhost:4000)
// unless the server explicitly allows it. This middleware does that.
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true, // Required for cookies to be sent cross-origin
  })
);

// JSON body parser:
// When the frontend sends JSON data in a request body (e.g., on login),
// this middleware parses it and makes it available as req.body.
app.use(express.json());

// ── 6. Routes ─────────────────────────────────────────────────

// Health check endpoint
// This is a simple endpoint that the frontend (and developers) can call
// to confirm the server is running and accepting requests.
//
// Example: GET http://localhost:4000/api/health
// Response: { "status": "ok", "message": "...", "timestamp": "..." }
//
// IMPORTANT: This endpoint does NOT check the database.
// It only confirms the server process itself is alive.
// Database connectivity will be verified separately in Part 2 Step 2.
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'QueueLess backend is running. Database is not yet connected.',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ── 7. 404 handler ────────────────────────────────────────────
// If a request reaches here, no route above matched it.
// Return a clear error instead of Express's default HTML error page.
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'This route does not exist on the QueueLess API.',
    },
  });
});

// ── 8. Start the server ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ QueueLess backend is running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend URL: ${FRONTEND_URL}`);
  console.log('─────────────────────────────────────────────────');
  console.log('   Database    : Not connected (Part 2 Step 2)');
  console.log('   Auth        : Not implemented (Part 4)');
});

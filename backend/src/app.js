// ─────────────────────────────────────────────────────────────
// Express application factory (no network listener — see server.js).
// ─────────────────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './db.js';
import { config } from './config.js';
import { notFound } from './lib/errors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter, csrfProtection, isAllowedOrigin } from './middleware/security.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { customerRouter } from './routes/customer.js';
import { staffRouter } from './routes/staff.js';
import { ownerRouter } from './routes/owner.js';
import { invitesRouter } from './routes/invites.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Health check — reports server and database status. No secrets.
  app.get('/api/health', async (_req, res) => {
    let database = 'connected';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unreachable';
    }
    const healthy = database === 'connected';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      server: 'running',
      database,
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', apiLimiter, csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api', publicRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api/staff/orgs/:orgId', staffRouter);
  app.use('/api/owner', ownerRouter);
  app.use('/api/invites', invitesRouter);

  app.use((_req, _res, next) => next(notFound('This route does not exist on the QueueLess API.')));
  app.use(errorHandler);
  return app;
}

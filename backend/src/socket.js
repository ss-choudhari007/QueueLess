// ─────────────────────────────────────────────────────────────
// Socket.IO server.
//
// Authentication: the handshake carries the same HttpOnly ql_access cookie
// as REST requests. A valid session joins the private room user:<id>.
// Anonymous sockets are allowed but may only watch public service rooms.
// An expired access token is rejected with "SESSION_EXPIRED" so the client
// can refresh its session and reconnect.
//
// Authorization: every room subscription is checked on the server.
//   org:join       → requires owner or staff membership (getOrgAccess)
//   service:watch  → any active public service (no personal data is sent)
// ─────────────────────────────────────────────────────────────
import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { prisma } from './db.js';
import { config } from './config.js';
import { isAllowedOrigin } from './middleware/security.js';
import { COOKIES, resolveSession } from './services/authService.js';
import { getOrgAccess, isUuid } from './services/accessService.js';
import { attachIo } from './realtime.js';

const reply = (ack, payload) => typeof ack === 'function' && ack(payload);

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.frontendOrigins, credentials: true },
    // Blocks cross-site WebSocket hijacking: browsers always send Origin.
    allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin)),
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const token = cookies[COOKIES.access];
      socket.data.user = null;
      if (!token) return next();
      const session = await resolveSession(token);
      if (session?.expired) return next(new Error('SESSION_EXPIRED'));
      if (!session) return next(new Error('NOT_AUTHENTICATED'));
      socket.data.user = session.user;
      socket.data.sessionId = session.sessionId;
      next();
    } catch {
      next(new Error('SERVICE_UNAVAILABLE'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.emit('session', { authenticated: Boolean(user), userId: user?.id ?? null });

    socket.on('org:join', async ({ orgId } = {}, ack) => {
      try {
        if (!user) return reply(ack, { ok: false, error: 'NOT_AUTHENTICATED' });
        const access = await getOrgAccess(user, orgId);
        if (!access) return reply(ack, { ok: false, error: access === undefined ? 'NOT_FOUND' : 'FORBIDDEN' });
        socket.join(`org:${orgId}`);
        reply(ack, { ok: true });
      } catch {
        reply(ack, { ok: false, error: 'SERVICE_UNAVAILABLE' });
      }
    });

    socket.on('org:leave', ({ orgId } = {}, ack) => {
      if (isUuid(orgId)) socket.leave(`org:${orgId}`);
      reply(ack, { ok: true });
    });

    socket.on('service:watch', async ({ serviceId } = {}, ack) => {
      try {
        if (!isUuid(serviceId)) return reply(ack, { ok: false, error: 'NOT_FOUND' });
        const service = await prisma.service.findFirst({
          where: { id: serviceId, isActive: true, organization: { isActive: true } },
          select: { id: true },
        });
        if (!service) return reply(ack, { ok: false, error: 'NOT_FOUND' });
        socket.join(`service:${serviceId}`);
        reply(ack, { ok: true });
      } catch {
        reply(ack, { ok: false, error: 'SERVICE_UNAVAILABLE' });
      }
    });

    socket.on('service:unwatch', ({ serviceId } = {}, ack) => {
      if (isUuid(serviceId)) socket.leave(`service:${serviceId}`);
      reply(ack, { ok: true });
    });
  });

  attachIo(io);
  return io;
}

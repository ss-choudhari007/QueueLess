// ─────────────────────────────────────────────────────────────
// Thin emitter used by services. Socket.IO is attached by server.js; in
// tests without a socket server these calls are no-ops.
//
// Rooms:
//   user:<userId>        — private events for one account (token updates,
//                          call notifications, arrival prompts)
//   org:<orgId>          — authorized staff/owners of one organization
//   service:<serviceId>  — public, anonymous queue-change pings (no
//                          personal data), used by customers and browse pages
// ─────────────────────────────────────────────────────────────
import { EVENTS } from './lib/constants.js';

let io = null;

export function attachIo(instance) {
  io = instance;
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToOrg(orgId, event, payload) {
  io?.to(`org:${orgId}`).emit(event, payload);
}

// Announces that a service queue changed. Staff receive the token id and
// status; the public service room receives only the service id and reason.
export function queueChanged({ orgId, serviceId, reason, tokenId = null, status = null }) {
  const at = new Date().toISOString();
  emitToOrg(orgId, EVENTS.QUEUE_UPDATED, { orgId, serviceId, reason, tokenId, status, at });
  io?.to(`service:${serviceId}`).emit(EVENTS.QUEUE_UPDATED, { serviceId, reason, at });
}

export function removeUserFromOrgRoom(userId, orgId) {
  io?.in(`user:${userId}`).socketsLeave(`org:${orgId}`);
}

// Disconnects sockets of a revoked session (or every session of a user).
export async function disconnectSessions(userId, sessionId = null) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const socket of sockets) {
    if (!sessionId || socket.data.sessionId === sessionId) socket.disconnect(true);
  }
}

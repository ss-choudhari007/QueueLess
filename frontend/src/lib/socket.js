// ─────────────────────────────────────────────────────────────
// Single shared Socket.IO connection. Authenticated by the same HttpOnly
// cookie as the API. Real-time events are hints: screens always refetch
// state from the API after (re)connecting, so missed events never matter.
// ─────────────────────────────────────────────────────────────
import { io } from 'socket.io-client';
import { API_BASE, refreshSession } from './api.js';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(API_BASE || undefined, {
      withCredentials: true,
      autoConnect: false,
      reconnectionDelayMax: 8000,
    });
    socket.on('connect_error', async (error) => {
      if (error.message === 'SESSION_EXPIRED') {
        try {
          await refreshSession();
          socket.connect();
        } catch {
          // Session is over; the auth context will route to sign-in.
        }
      }
    });
  }
  return socket;
}

// Reconnect so the server re-reads the session cookie (after login/logout).
export function restartSocket() {
  const s = getSocket();
  s.disconnect();
  s.connect();
}

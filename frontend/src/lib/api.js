// ─────────────────────────────────────────────────────────────
// API client.
//  • Sends cookies (credentials: 'include'); tokens are HttpOnly cookies
//    and are never readable or stored by JavaScript.
//  • Adds the CSRF header to every state-changing request.
//  • On 401, refreshes the session once (single-flight) and retries.
// ─────────────────────────────────────────────────────────────

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get fields() {
    return this.details?.fields || {};
  }
}

let csrfToken = null;
let csrfPromise = null;
let refreshPromise = null;

async function getCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise || force) {
    csrfPromise = fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' })
      .then((r) => r.json())
      .then((body) => {
        csrfToken = body.data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

const NO_REFRESH = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = request('/api/auth/refresh', { method: 'POST', retry: false }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body, query, retry = true, signal } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = await getCsrf();

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach QueueLess right now. Check your connection and try again.');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.ok) return payload?.data;

  const err = payload?.error || {};
  if (res.status === 403 && err.code === 'CSRF_INVALID' && retry) {
    await getCsrf(true);
    return request(path, { method, body, query, retry: false, signal });
  }
  if (res.status === 401 && retry && !NO_REFRESH.includes(path)) {
    try {
      await refreshSession();
      return request(path, { method, body, query, retry: false, signal });
    } catch {
      window.dispatchEvent(new CustomEvent('ql:session-ended'));
    }
  }
  throw new ApiError(
    res.status,
    err.code || 'UNKNOWN_ERROR',
    err.message || (res.status >= 500 ? 'The server had a problem. Please try again.' : 'Request failed.'),
    err.details
  );
}

export const api = {
  get: (path, query, opts) => request(path, { query, ...opts }),
  post: (path, body, opts) => request(path, { method: 'POST', body: body ?? {}, ...opts }),
  put: (path, body) => request(path, { method: 'PUT', body: body ?? {} }),
  patch: (path, body) => request(path, { method: 'PATCH', body: body ?? {} }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

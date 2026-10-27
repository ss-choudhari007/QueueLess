// ─────────────────────────────────────────────────────────────
// Authentication and authorization middleware.
//
// Order of checks (docs/PROJECT_SPEC.md §7):
//   1. authenticated?            → 401
//   2. required account role?    → 403
//   3. organization permission?  → 403
//   4. resource belongs to org?  → 404 (checked inside services)
//   5. valid state transition?   → 409 (checked inside services)
// ─────────────────────────────────────────────────────────────
import { AppError, forbidden, notAuthenticated, notFound } from '../lib/errors.js';
import { COOKIES, resolveSession } from '../services/authService.js';
import { getOrgAccess } from '../services/accessService.js';

export async function requireAuth(req, _res, next) {
  const result = await resolveSession(req.cookies?.[COOKIES.access]);
  if (!result) throw notAuthenticated();
  if (result.expired) throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  req.user = result.user;
  req.sessionId = result.sessionId;
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

// level: 'staff' (any member or owner), 'supervisor' (supervisor or owner), 'owner'
export const requireOrgAccess =
  (level = 'staff') =>
  async (req, _res, next) => {
    const access = await getOrgAccess(req.user, req.params.orgId);
    if (!access) {
      // Distinguish "no such org" only for users who could plausibly access it.
      throw access === undefined ? notFound('Organization not found.') : forbidden('You do not have access to this organization.');
    }
    const allowed =
      level === 'staff' ||
      (level === 'supervisor' && access.canSupervise) ||
      (level === 'owner' && access.isOwner);
    if (!allowed) throw forbidden('Your role in this organization does not allow this action.');
    req.orgAccess = access;
    next();
  };

// ─────────────────────────────────────────────────────────────
// Application errors with stable machine-readable codes.
// The full list of codes is documented in docs/API_CONTRACT.md §3.
// ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const notAuthenticated = (message = 'Please sign in to continue.') =>
  new AppError(401, 'NOT_AUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested resource was not found.') =>
  new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

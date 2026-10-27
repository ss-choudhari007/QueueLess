// ─────────────────────────────────────────────────────────────
// Central error handler. Converts every error into the documented JSON
// shape. Stack traces and internal messages are never sent to clients.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { dbErrorSummary } from '../db.js';

const DB_UNAVAILABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON.' };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' };
  }
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    (err instanceof Prisma.PrismaClientKnownRequestError && DB_UNAVAILABLE_CODES.has(err.code))
  ) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Please try again shortly.',
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return { status: 409, code: 'CONFLICT', message: 'This record conflicts with an existing one.' };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    return { status: 404, code: 'NOT_FOUND', message: 'The requested resource was not found.' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' };
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const response = toErrorResponse(err);
  if (response.status >= 500) {
    // Log the error name/message only — never request bodies, cookies or secrets.
    console.error(`[error] ${req.method} ${req.path} → ${response.code}: ${err?.name}: ${dbErrorSummary(err)}`);
  }
  const body = { success: false, error: { code: response.code, message: response.message } };
  if (response.details) body.error.details = response.details;
  res.status(response.status).json(body);
}

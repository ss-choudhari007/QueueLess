import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { dbErrorSummary, prisma, waitForDatabase } from '../src/db.js';
import { toErrorResponse } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/lib/errors.js';
import { isServiceDayOver, openState, serviceDateString } from '../src/lib/time.js';
import { estimateMinutes } from '../src/services/queueView.js';
import { Client, app } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

describe('health and errors', () => {
  it('reports a healthy server and database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
  });

  it('reports 503 when the database is unreachable', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.database).toBe('unreachable');
  });

  it('maps database outages to 503 without leaking internals', () => {
    const err = new Prisma.PrismaClientInitializationError("Can't reach database server at secret-host:5432", '5.22.0');
    const res = toErrorResponse(err);
    expect(res.status).toBe(503);
    expect(res.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.message).not.toContain('secret-host');
  });

  it('hides unexpected error messages behind INTERNAL_ERROR', () => {
    expect(toErrorResponse(new Error('stack details'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(toErrorResponse(new AppError(409, 'X', 'msg'))).toMatchObject({ status: 409, code: 'X' });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('rejects malformed JSON with 400', async () => {
    const client = await new Client().init();
    const res = await client.agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', client.csrf)
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not allow CORS from unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('serves public organization search on an empty database', async () => {
    const res = await request(app).get('/api/orgs?search=anything&openNow=true');
    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toEqual([]);
  });
});

describe('database startup resilience', () => {
  it('retries until the database answers instead of failing', async () => {
    let calls = 0;
    const flaky = { $queryRaw: async () => (++calls < 3 ? Promise.reject(new Error('Invalid `prisma.$queryRaw()` invocation:\n\nCan\'t reach database server\nsecret details')) : [1]) };
    const retries = [];
    const attempts = await waitForDatabase(flaky, { maxDelayMs: 5, onRetry: (r) => retries.push(r) });
    expect(attempts).toBe(3);
    expect(retries.map((r) => r.attempt)).toEqual([1, 2]);
    expect(dbErrorSummary(retries[0].error)).toBe("Can't reach database server");
  });

  it('gives up only when a maximum is explicitly set', async () => {
    const down = { $queryRaw: async () => Promise.reject(new Error('down')) };
    await expect(waitForDatabase(down, { maxDelayMs: 1, maxAttempts: 2 })).rejects.toThrow('down');
  });
});

describe('time and estimate helpers', () => {
  const hours = Array.from({ length: 7 }, (_, d) => ({ closed: d === 0, open: '09:00', close: '17:00' }));

  it('computes the service date in the organization timezone', () => {
    const instant = new Date('2026-10-27T20:00:00Z'); // 01:30 next day in India
    expect(serviceDateString(instant, 'Asia/Kolkata')).toBe('2026-10-28');
    expect(serviceDateString(instant, 'America/New_York')).toBe('2026-10-27');
  });

  it('knows when an organization is open', () => {
    // Tuesday 2026-10-27 10:00 IST = 04:30Z
    expect(openState(hours, 'Asia/Kolkata', new Date('2026-10-27T04:30:00Z')).isOpen).toBe(true);
    expect(openState(hours, 'Asia/Kolkata', new Date('2026-10-27T12:00:00Z')).reason).toBe('CLOSED_FOR_DAY');
    expect(openState(hours, 'Asia/Kolkata', new Date('2026-10-27T02:00:00Z')).reason).toBe('NOT_YET_OPEN');
    // Sunday
    expect(openState(hours, 'Asia/Kolkata', new Date('2026-10-25T06:00:00Z')).reason).toBe('CLOSED_TODAY');
  });

  it('detects the end of a service day', () => {
    const at = new Date('2026-10-27T12:00:00Z'); // 17:30 IST
    expect(isServiceDayOver('2026-10-27', hours, 'Asia/Kolkata', at)).toBe(true);
    expect(isServiceDayOver('2026-10-27', hours, 'Asia/Kolkata', new Date('2026-10-27T05:00:00Z'))).toBe(false);
    expect(isServiceDayOver('2026-10-26', hours, 'Asia/Kolkata', new Date('2026-10-27T05:00:00Z'))).toBe(true);
  });

  it('estimates waiting time from people ahead and service in progress', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    expect(estimateMinutes({ waitingAhead: 3, active: [], avg: 10, now })).toBe(30);
    expect(
      estimateMinutes({
        waitingAhead: 2,
        active: [
          { status: 'SERVING', servingAt: new Date(now - 4 * 60000) }, // 6 min left
          { status: 'CALLED', servingAt: null },
        ],
        avg: 10,
        now,
      })
    ).toBe(36);
  });
});

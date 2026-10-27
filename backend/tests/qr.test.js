import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { join, loggedIn, resetDb, setupOrg, staffUrl } from './helpers.js';

beforeEach(resetDb);

// A called token with a fresh QR credential.
async function calledWithQr() {
  const ctx = await setupOrg();
  const customer = await loggedIn();
  const token = (await join(customer, ctx.service)).body.data.token;
  await ctx.staff.post(staffUrl(ctx.org, `/services/${ctx.service.id}/call-next`));
  const qr = (await customer.post(`/api/customer/tokens/${token.id}/qr`)).body.data.qr;
  return { ...ctx, customer, token, qr };
}

const verify = (staff, org, body) => staff.post(staffUrl(org, '/arrival/verify'), body);

describe('QR arrival verification', () => {
  it('a scan only requests confirmation; the customer must confirm explicitly', async () => {
    const { staff, org, customer, token, qr } = await calledWithQr();
    expect(qr.payload).toMatch(/^QL1\./);
    const scan = await verify(staff, org, { payload: qr.payload });
    expect(scan.status).toBe(200);
    expect(scan.body.data.token.arrivalRequestedAt).not.toBeNull();
    expect(scan.body.data.token.arrivalConfirmedAt).toBeNull();
    expect(scan.body.data.token.status).toBe('CALLED');
    // Staff cannot start service on the scan alone.
    expect((await staff.post(staffUrl(org, `/tokens/${token.id}/start`))).body.error.code).toBe('ARRIVAL_NOT_CONFIRMED');
    const confirm = await customer.post(`/api/customer/tokens/${token.id}/confirm-arrival`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.token.arrivalConfirmedAt).not.toBeNull();
    const start = await staff.post(staffUrl(org, `/tokens/${token.id}/start`));
    expect(start.body.data.token.status).toBe('SERVING');
    const done = await staff.post(staffUrl(org, `/tokens/${token.id}/complete`));
    expect(done.body.data.token.status).toBe('COMPLETED');
  });

  it('stores only hashes of QR secrets and manual codes', async () => {
    const { qr } = await calledWithQr();
    const secret = qr.payload.split('.')[2];
    const row = await prisma.qrCredential.findFirst();
    expect(row.secretHash).not.toContain(secret);
    expect(row.codeHash).not.toContain(qr.manualCode);
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it('rejects malformed and tampered payloads', async () => {
    const { staff, org, qr } = await calledWithQr();
    expect((await verify(staff, org, { payload: 'hello-world-not-a-code' })).body.error.code).toBe('QR_INVALID');
    const tampered = `${qr.payload.slice(0, -4)}AAAA`;
    expect((await verify(staff, org, { payload: tampered })).body.error.code).toBe('QR_INVALID');
  });

  it('rejects expired credentials', async () => {
    const { staff, org, qr } = await calledWithQr();
    await prisma.qrCredential.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(staff, org, { payload: qr.payload });
    expect(res.body.error.code).toBe('QR_EXPIRED');
  });

  it('rejects a replayed credential', async () => {
    const { staff, org, qr } = await calledWithQr();
    expect((await verify(staff, org, { payload: qr.payload })).status).toBe(200);
    const replay = await verify(staff, org, { payload: qr.payload });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('QR_ALREADY_USED');
  });

  it('only one of two simultaneous scans succeeds', async () => {
    const { staff, org, qr } = await calledWithQr();
    const results = await Promise.all([verify(staff, org, { payload: qr.payload }), verify(staff, org, { payload: qr.payload })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('staff of another organization cannot validate the code', async () => {
    const { qr } = await calledWithQr();
    const other = await setupOrg();
    const res = await verify(other.staff, other.org, { payload: qr.payload });
    expect(res.body.error.code).toBe('QR_INVALID');
    expect((await prisma.qrCredential.findFirst()).usedAt).toBeNull();
  });

  it('does not check in tokens that have not been called', async () => {
    const ctx = await setupOrg();
    const customer = await loggedIn();
    const token = (await join(customer, ctx.service)).body.data.token;
    const qr = (await customer.post(`/api/customer/tokens/${token.id}/qr`)).body.data.qr;
    const res = await verify(ctx.staff, ctx.org, { payload: qr.payload });
    expect(res.body.error.code).toBe('TOKEN_NOT_CALLED');
    // The credential was not consumed by the rejected scan.
    expect((await prisma.qrCredential.findFirst()).usedAt).toBeNull();
  });

  it('a different customer cannot confirm, and confirmation requires a scan first', async () => {
    const { customer, token, staff, org, qr } = await calledWithQr();
    const early = await customer.post(`/api/customer/tokens/${token.id}/confirm-arrival`);
    expect(early.body.error.code).toBe('ARRIVAL_NOT_REQUESTED');
    await verify(staff, org, { payload: qr.payload });
    const intruder = await loggedIn();
    expect((await intruder.post(`/api/customer/tokens/${token.id}/confirm-arrival`)).status).toBe(404);
    expect((await staff.post(`/api/customer/tokens/${token.id}/confirm-arrival`)).status).toBe(403);
    const entry = await prisma.queueEntry.findUnique({ where: { id: token.id } });
    expect(entry.arrivalConfirmedAt).toBeNull();
  });

  it('supports the manual code fallback and revokes after repeated wrong guesses', async () => {
    const { staff, org, token, qr } = await calledWithQr();
    for (let i = 0; i < 5; i += 1) {
      const wrong = await verify(staff, org, { tokenId: token.id, code: 'ZZZZZZ' === qr.manualCode ? 'YYYYYY' : 'ZZZZZZ' });
      expect(wrong.body.error.code).toBe('QR_INVALID');
    }
    const afterLockout = await verify(staff, org, { tokenId: token.id, code: qr.manualCode });
    expect(afterLockout.body.error.code).toBe('QR_INVALID');

    const fresh = await setupOrg();
    const customer = await loggedIn();
    const t = (await join(customer, fresh.service)).body.data.token;
    await fresh.staff.post(staffUrl(fresh.org, `/services/${fresh.service.id}/call-next`));
    const code = (await customer.post(`/api/customer/tokens/${t.id}/qr`)).body.data.qr.manualCode;
    const ok = await verify(fresh.staff, fresh.org, { tokenId: t.id, code: code.toLowerCase() });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token.arrivalRequestedAt).not.toBeNull();
  });
});

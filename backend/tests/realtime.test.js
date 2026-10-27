import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import { createSocketServer } from '../src/socket.js';
import { app, join, loggedIn, resetDb, setupOrg, staffUrl } from './helpers.js';

let server;
let io;
let url;
const sockets = [];

beforeAll(async () => {
  server = http.createServer(app);
  io = createSocketServer(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  while (sockets.length) sockets.pop().disconnect();
  await resetDb();
});

function socketFor(client, { origin = 'http://localhost:5173' } = {}) {
  const socket = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { ...(client ? { Cookie: client.cookieHeader() } : {}), Origin: origin },
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('session', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const nextEvent = (socket, event, ms = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
const noEvent = (socket, event, ms = 800) =>
  new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected ${event}`));
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, ms);
  });

describe('socket authentication and room authorization', () => {
  it('rejects connections from unknown origins', async () => {
    await expect(socketFor(null, { origin: 'https://evil.example' })).rejects.toBeTruthy();
  });

  it('only authorized staff can join an organization room', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const staffA = await socketFor(a.staff);
    expect(await emitAck(staffA, 'org:join', { orgId: a.org.id })).toEqual({ ok: true });
    expect(await emitAck(staffA, 'org:join', { orgId: b.org.id })).toEqual({ ok: false, error: 'FORBIDDEN' });
    const customer = await socketFor(await loggedIn());
    expect(await emitAck(customer, 'org:join', { orgId: a.org.id })).toEqual({ ok: false, error: 'FORBIDDEN' });
    const anonymous = await socketFor(null);
    expect(await emitAck(anonymous, 'org:join', { orgId: a.org.id })).toEqual({ ok: false, error: 'NOT_AUTHENTICATED' });
    expect(await emitAck(anonymous, 'service:watch', { serviceId: a.service.id })).toEqual({ ok: true });
  });
});

describe('event delivery', () => {
  it('delivers the call notification only to the token owner', async () => {
    const ctx = await setupOrg();
    const alice = await loggedIn();
    const bob = await loggedIn();
    await join(alice, ctx.service);
    await join(bob, ctx.service);
    const aliceSocket = await socketFor(alice);
    const bobSocket = await socketFor(bob);
    const called = nextEvent(aliceSocket, 'token:called');
    const silent = noEvent(bobSocket, 'token:called');
    await ctx.staff.post(staffUrl(ctx.org, `/services/${ctx.service.id}/call-next`));
    expect(await called).toMatchObject({ displayNumber: 'A-001' });
    expect(await silent).toBe(true);
  });

  it('sends queue updates to the organization room and anonymous pings to service watchers', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const staffA = await socketFor(a.staff);
    const staffB = await socketFor(b.staff);
    await emitAck(staffA, 'org:join', { orgId: a.org.id });
    await emitAck(staffB, 'org:join', { orgId: b.org.id });
    const watcher = await socketFor(null);
    await emitAck(watcher, 'service:watch', { serviceId: a.service.id });

    const forA = nextEvent(staffA, 'queue:updated');
    const forWatcher = nextEvent(watcher, 'queue:updated');
    const notForB = noEvent(staffB, 'queue:updated');
    await join(await loggedIn(), a.service);
    expect(await forA).toMatchObject({ orgId: a.org.id, reason: 'joined', status: 'WAITING' });
    const ping = await forWatcher;
    expect(ping).toEqual({ serviceId: a.service.id, reason: 'joined', at: expect.any(String) });
    expect(await notForB).toBe(true);
  });

  it('sends the arrival prompt to the right customer and confirmation to staff', async () => {
    const ctx = await setupOrg();
    const customer = await loggedIn();
    const token = (await join(customer, ctx.service)).body.data.token;
    await ctx.staff.post(staffUrl(ctx.org, `/services/${ctx.service.id}/call-next`));
    const qr = (await customer.post(`/api/customer/tokens/${token.id}/qr`)).body.data.qr;
    const customerSocket = await socketFor(customer);
    const staffSocket = await socketFor(ctx.staff);
    await emitAck(staffSocket, 'org:join', { orgId: ctx.org.id });

    const prompt = nextEvent(customerSocket, 'arrival:requested');
    await ctx.staff.post(staffUrl(ctx.org, '/arrival/verify'), { payload: qr.payload });
    expect(await prompt).toMatchObject({ tokenId: token.id });

    const confirmed = nextEvent(staffSocket, 'arrival:confirmed');
    await customer.post(`/api/customer/tokens/${token.id}/confirm-arrival`);
    expect(await confirmed).toMatchObject({ tokenId: token.id, displayNumber: 'A-001' });
  });

  it('after reconnecting, REST returns the latest state including missed changes', async () => {
    const ctx = await setupOrg();
    const customer = await loggedIn();
    const token = (await join(customer, ctx.service)).body.data.token;
    const first = await socketFor(customer);
    first.disconnect();
    await ctx.staff.post(staffUrl(ctx.org, `/services/${ctx.service.id}/call-next`));
    const again = await socketFor(customer);
    expect(again.connected).toBe(true);
    const state = await customer.get(`/api/customer/tokens/${token.id}`);
    expect(state.body.data.token.status).toBe('CALLED');
  });

  it('logout disconnects that session’s sockets', async () => {
    const customer = await loggedIn();
    const socket = await socketFor(customer);
    const closed = nextEvent(socket, 'disconnect');
    await customer.post('/api/auth/logout');
    expect(await closed).toBeTruthy();
  });
});

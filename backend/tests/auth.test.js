import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { Client, PASSWORD, app, createUser, loggedIn, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('registration', () => {
  it('creates a customer account, hashes the password and signs the user in', async () => {
    const client = await new Client().init();
    const res = await client.post('/api/auth/register', {
      name: 'Priya Sharma',
      email: '  Priya@Example.com ',
      password: 'SecurePass1',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ name: 'Priya Sharma', email: 'priya@example.com', role: 'CUSTOMER' });
    const cookies = res.headers['set-cookie'].join(';');
    expect(cookies).toMatch(/ql_access=.*HttpOnly/);
    expect(cookies).toMatch(/ql_refresh=.*HttpOnly/);
    const stored = await prisma.user.findUnique({ where: { email: 'priya@example.com' } });
    expect(stored.passwordHash).not.toContain('SecurePass1');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('priya@example.com');
  });

  it('allows registering an owner account but never a staff account', async () => {
    const client = await new Client().init();
    const owner = await client.post('/api/auth/register', { name: 'Olivia', email: 'o@x.io', password: 'Password1', accountType: 'OWNER' });
    expect(owner.status).toBe(201);
    expect(owner.body.data.user.role).toBe('OWNER');
    const staff = await (await new Client().init()).post('/api/auth/register', {
      name: 'Sam',
      email: 's@x.io',
      password: 'Password1',
      accountType: 'STAFF',
    });
    expect(staff.status).toBe(400);
  });

  it.each([
    [{ name: 'A', email: 'a@x.io', password: 'Password1' }, 'name'],
    [{ name: 'Alice', email: 'not-an-email', password: 'Password1' }, 'email'],
    [{ name: 'Alice', email: 'a@x.io', password: 'short1' }, 'password'],
    [{ name: 'Alice', email: 'a@x.io', password: 'nonumbers' }, 'password'],
  ])('rejects invalid input %#', async (body, field) => {
    const client = await new Client().init();
    const res = await client.post('/api/auth/register', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toHaveProperty(field);
  });

  it('rejects a duplicate email', async () => {
    await createUser('CUSTOMER', { email: 'dup@x.io' });
    const client = await new Client().init();
    const res = await client.post('/api/auth/register', { name: 'Dup', email: 'dup@x.io', password: 'Password1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });
});

describe('login', () => {
  it('returns the same error for an unknown email and a wrong password', async () => {
    const user = await createUser();
    const client = await new Client().init();
    const wrong = await client.post('/api/auth/login', { email: user.email, password: 'WrongPass9' });
    const unknown = await client.post('/api/auth/login', { email: 'nobody@x.io', password: 'WrongPass9' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('signs in with valid credentials', async () => {
    const user = await createUser();
    const client = await new Client().init();
    const res = await client.post('/api/auth/login', { email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
  });
});

describe('sessions', () => {
  it('rejects protected endpoints without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NOT_AUTHENTICATED');
  });

  it('rejects a forged access token', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'ql_access=eyJhbGciOiJIUzI1NiJ9.e30.forged');
    expect(res.status).toBe(401);
  });

  it('logout revokes the session so the old access cookie stops working', async () => {
    const client = await loggedIn();
    const stolenCookie = client.cookieHeader();
    const out = await client.post('/api/auth/logout');
    expect(out.status).toBe(200);
    const replay = await request(app).get('/api/auth/me').set('Cookie', stolenCookie);
    expect(replay.status).toBe(401);
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', `${stolenCookie}; ql_csrf=${client.csrf}`).set('X-CSRF-Token', client.csrf);
    expect(refresh.status).toBe(401);
  });

  it('logout-all revokes every session of the user', async () => {
    const first = await loggedIn();
    const second = await new Client().init();
    await second.login(first.dbUser.email);
    await first.post('/api/auth/logout-all');
    expect((await second.get('/api/auth/me')).status).toBe(401);
  });

  it('refresh issues a new access token from a valid refresh cookie', async () => {
    const client = await loggedIn();
    const res = await client.post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].join(';')).toMatch(/ql_access=/);
  });
});

describe('CSRF and roles', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@x.io', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a CSRF header that does not match the cookie', async () => {
    const client = await new Client().init();
    const res = await client.agent.post('/api/auth/login').set('X-CSRF-Token', 'x'.repeat(43)).send({});
    expect(res.status).toBe(403);
  });

  it('enforces account roles on the server', async () => {
    const customer = await loggedIn('CUSTOMER');
    expect((await customer.get('/api/owner/orgs')).status).toBe(403);
    const staff = await loggedIn('STAFF');
    expect((await staff.post('/api/customer/tokens', { serviceId: crypto.randomUUID() })).status).toBe(403);
    expect((await staff.post('/api/owner/orgs', { name: 'Mine', category: 'Clinic' })).status).toBe(403);
    const owner = await loggedIn('OWNER');
    expect((await owner.get('/api/customer/tokens/active')).status).toBe(403);
  });
});

// Shared test helpers: database reset, HTTP client with CSRF, factories.
import request from 'supertest';
import { prisma } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/authService.js';

export const app = createApp();
export const PASSWORD = 'Password123';
export const ALWAYS_OPEN = Array.from({ length: 7 }, () => ({ closed: false, open: '00:00', close: '23:59' }));

const TABLES = [
  'audit_logs',
  'customer_restrictions',
  'qr_credentials',
  'queue_entries',
  'daily_counters',
  'staff_invites',
  'staff_memberships',
  'services',
  'queue_settings',
  'organizations',
  'refresh_tokens',
  'users',
];

// Truncates the isolated test database. Refuses to run anywhere else.
export async function resetDb() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (!/test/i.test(db)) throw new Error(`Refusing to truncate database "${db}"`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}`;

// HTTP client that keeps cookies and sends the CSRF header automatically.
export class Client {
  constructor() {
    this.agent = request.agent(app);
    this.csrf = null;
    this.cookies = [];
  }
  async init() {
    const res = await this.agent.get('/api/auth/csrf');
    this.csrf = res.body.data.csrfToken;
    return this;
  }
  get(url) {
    return this.agent.get(url);
  }
  send(method, url, body) {
    return this.agent[method](url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  post(url, body) {
    return this.send('post', url, body);
  }
  put(url, body) {
    return this.send('put', url, body);
  }
  patch(url, body) {
    return this.send('patch', url, body);
  }
  delete(url, body) {
    return this.send('delete', url, body);
  }
  async login(email, password = PASSWORD) {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.cookies = res.headers['set-cookie'];
    this.user = res.body.data.user;
    return this;
  }
  // Cookie header (e.g. for Socket.IO clients).
  cookieHeader() {
    return this.cookies.map((c) => c.split(';')[0]).join('; ');
  }
}

export async function createUser(role = 'CUSTOMER', overrides = {}) {
  return prisma.user.create({
    data: {
      name: overrides.name || `${role.toLowerCase()} ${unique()}`,
      email: overrides.email || `${role.toLowerCase()}-${unique()}@test.local`,
      passwordHash: await hashPassword(PASSWORD),
      role,
    },
  });
}

export async function loggedIn(role = 'CUSTOMER', overrides) {
  const user = await createUser(role, overrides);
  const client = await new Client().init();
  await client.login(user.email);
  client.dbUser = user;
  return client;
}

export async function createOrg(owner, { services = ['General'], settings = {}, ...org } = {}) {
  return prisma.organization.create({
    data: {
      name: org.name || `Org ${unique()}`,
      slug: `org-${unique()}`,
      category: 'Clinic',
      timezone: org.timezone || 'Asia/Kolkata',
      ownerId: owner.id,
      isActive: org.isActive ?? true,
      settings: { create: { weeklyHours: ALWAYS_OPEN, ...settings } },
      services: {
        create: services.map((name, i) => ({ name, tokenPrefix: String.fromCharCode(65 + i), avgDurationMinutes: 10 })),
      },
    },
    include: { services: { orderBy: { tokenPrefix: 'asc' } }, settings: true },
  });
}

export async function addStaff(user, org, role = 'STAFF') {
  return prisma.staffMembership.create({ data: { userId: user.id, organizationId: org.id, role } });
}

// Owner + staff + one organization with services, all logged in.
export async function setupOrg(options = {}) {
  const owner = await loggedIn('OWNER');
  const org = await createOrg(owner.dbUser, options);
  const staff = await loggedIn('STAFF');
  await addStaff(staff.dbUser, org, options.staffRole || 'STAFF');
  return { owner, staff, org, service: org.services[0] };
}

export const staffUrl = (org, path) => `/api/staff/orgs/${org.id}${path}`;

export async function join(customer, service) {
  return customer.post('/api/customer/tokens', { serviceId: service.id });
}

// ─────────────────────────────────────────────────────────────
// QueueLess — development demo data.
//
//   npm run db:seed
//
// Safety:
//   • Refuses to run when NODE_ENV=production.
//   • Refuses to run on a database that contains any non-demo account, so it
//     cannot add known-password accounts to a real (production) database.
//   • Never deletes or overwrites anything: if the demo owner account already
//     exists the script stops without changes.
//   • Demo accounts use the password in SEED_DEMO_PASSWORD (default
//     "Demo@12345") and the reserved ".demo" email domain.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { addDays, dateStringToDb, serviceDateString } from '../src/lib/time.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo@12345';
const DOMAIN = 'queueless.demo';

const hours = (open, close, sunday = { closed: false, open, close }) =>
  Array.from({ length: 7 }, (_, d) => (d === 0 ? sunday : { closed: false, open, close }));

const ORGS = [
  {
    key: 'clinic',
    owner: 'owner',
    name: 'CityCare Clinic',
    slug: 'citycare-clinic',
    category: 'Clinic',
    city: 'Pune',
    address: '12 MG Road, Camp, Pune 411001',
    phone: '+91 20 4000 1200',
    email: 'frontdesk@citycare.example',
    description: 'Family clinic offering general consultations, diagnostics and vaccinations.',
    weeklyHours: hours('07:00', '22:00'),
    services: [
      { name: 'General Consultation', tokenPrefix: 'GC', avgDurationMinutes: 10, description: 'Walk-in consultation with the duty doctor.' },
      { name: 'Blood Test', tokenPrefix: 'BT', avgDurationMinutes: 5, description: 'Sample collection for lab tests.' },
      { name: 'Vaccination', tokenPrefix: 'VX', avgDurationMinutes: 8, description: 'Routine and travel vaccinations.' },
    ],
  },
  {
    key: 'hospital',
    owner: 'owner',
    name: 'Sunrise Hospital OPD',
    slug: 'sunrise-hospital-opd',
    category: 'Hospital',
    city: 'Pune',
    address: 'Baner Road, Pune 411045',
    phone: '+91 20 4000 9900',
    description: 'Round-the-clock outpatient registration and pharmacy counter.',
    weeklyHours: hours('00:00', '23:59'),
    services: [
      { name: 'OPD Registration', tokenPrefix: 'OP', avgDurationMinutes: 4, description: 'Register for any outpatient department.' },
      { name: 'Pharmacy', tokenPrefix: 'PH', avgDurationMinutes: 3, description: 'Collect prescribed medicines.' },
    ],
  },
  {
    key: 'salon',
    owner: 'owner',
    name: 'StyleHub Salon',
    slug: 'stylehub-salon',
    category: 'Salon',
    city: 'Mumbai',
    address: 'Linking Road, Bandra West, Mumbai 400050',
    phone: '+91 22 4000 5500',
    description: 'Unisex salon — haircuts, grooming and styling without the wait.',
    weeklyHours: hours('10:00', '21:00', { closed: true, open: '10:00', close: '21:00' }),
    services: [
      { name: 'Haircut', tokenPrefix: 'HC', avgDurationMinutes: 20 },
      { name: 'Beard Trim', tokenPrefix: 'BD', avgDurationMinutes: 10 },
    ],
  },
  {
    key: 'college',
    owner: 'owner2',
    name: 'Govt. College Admissions Office',
    slug: 'govt-college-admissions',
    category: 'College office',
    city: 'Nagpur',
    address: 'Civil Lines, Nagpur 440001',
    description: 'Admission document verification and fee payment counters.',
    weeklyHours: hours('09:30', '17:30', { closed: true, open: '09:30', close: '17:30' }),
    services: [
      { name: 'Document Verification', tokenPrefix: 'DV', avgDurationMinutes: 7 },
      { name: 'Fee Payment', tokenPrefix: 'FP', avgDurationMinutes: 5 },
    ],
  },
];

const CUSTOMER_NAMES = ['Aarav Mehta', 'Diya Kapoor', 'Kabir Singh', 'Ananya Rao', 'Vihaan Joshi', 'Isha Nair', 'Rohan Das', 'Meera Iyer'];

let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  console.log(`Target database: ${target.hostname}${target.pathname} (credentials hidden)`);
  const realAccounts = await prisma.user.count({ where: { NOT: { email: { endsWith: `@${DOMAIN}` } } } });
  if (realAccounts > 0) {
    console.error(`Refusing to seed: this database has ${realAccounts} non-demo account(s). Demo data is for empty development databases only.`);
    process.exitCode = 1;
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email: `owner@${DOMAIN}` } });
  if (existing) {
    console.log('Demo data already present — nothing changed.');
    return;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = (name, local, role) =>
    prisma.user.create({ data: { name, email: `${local}@${DOMAIN}`, passwordHash, role } });

  const owners = { owner: await user('Olivia Owner', 'owner', 'OWNER'), owner2: await user('Omar Owner', 'owner2', 'OWNER') };
  const staff = await user('Sam Staff', 'staff', 'STAFF');
  const supervisor = await user('Sara Supervisor', 'supervisor', 'STAFF');
  const salonStaff = await user('Sonia Stylist', 'salonstaff', 'STAFF');
  const customer = await user('Priya Customer', 'customer', 'CUSTOMER');
  const others = [];
  for (const [i, name] of CUSTOMER_NAMES.entries()) others.push(await user(name, `customer${i + 1}`, 'CUSTOMER'));

  const orgs = {};
  for (const o of ORGS) {
    orgs[o.key] = await prisma.organization.create({
      data: {
        name: o.name,
        slug: o.slug,
        category: o.category,
        city: o.city,
        address: o.address,
        phone: o.phone ?? null,
        email: o.email ?? null,
        description: o.description,
        timezone: 'Asia/Kolkata',
        ownerId: owners[o.owner].id,
        settings: { create: { weeklyHours: o.weeklyHours } },
        services: { create: o.services },
      },
      include: { services: true },
    });
  }

  await prisma.staffMembership.createMany({
    data: [
      { userId: staff.id, organizationId: orgs.clinic.id, role: 'STAFF' },
      { userId: staff.id, organizationId: orgs.hospital.id, role: 'STAFF' },
      { userId: supervisor.id, organizationId: orgs.clinic.id, role: 'SUPERVISOR' },
      { userId: salonStaff.id, organizationId: orgs.salon.id, role: 'SUPERVISOR' },
    ],
  });

  // ── History for analytics: the last 14 days ─────────────────
  const tz = 'Asia/Kolkata';
  const today = serviceDateString(new Date(), tz);
  const noShowsByCustomer = new Map();
  let historyCount = 0;
  for (const org of [orgs.clinic, orgs.hospital, orgs.salon]) {
    for (const service of org.services) {
      for (let back = 14; back >= 1; back -= 1) {
        const day = addDays(today, -back);
        const count = 4 + Math.floor(rand() * 9);
        const rows = [];
        let clock = new Date(`${day}T04:00:00Z`).getTime(); // 09:30 IST
        for (let n = 1; n <= count; n += 1) {
          const holder = pick(others);
          clock += (3 + rand() * 12) * 60_000;
          const createdAt = new Date(clock);
          const calledAt = new Date(clock + (5 + rand() * 25) * 60_000);
          const roll = rand();
          const row = {
            organizationId: org.id,
            serviceId: service.id,
            userId: holder.id,
            tokenNumber: n,
            serviceDate: dateStringToDb(day),
            createdAt,
          };
          const counted = noShowsByCustomer.get(holder.id) || 0;
          if (roll < 0.1) {
            rows.push({ ...row, status: 'CANCELLED', cancelledAt: new Date(clock + 4 * 60_000), cancellationReason: 'CUSTOMER' });
          } else if (roll < 0.16 && counted < 2) {
            noShowsByCustomer.set(holder.id, counted + 1);
            rows.push({
              ...row,
              status: 'NO_SHOW',
              calledAt,
              noShowDeadline: new Date(calledAt.getTime() + 5 * 60_000),
              noShowAt: new Date(calledAt.getTime() + 5.5 * 60_000),
            });
          } else {
            const servingAt = new Date(calledAt.getTime() + (1 + rand() * 3) * 60_000);
            const duration = service.avgDurationMinutes * (0.6 + rand() * 0.8);
            rows.push({
              ...row,
              status: 'COMPLETED',
              calledAt,
              noShowDeadline: new Date(calledAt.getTime() + 5 * 60_000),
              arrivalRequestedAt: servingAt,
              arrivalConfirmedAt: servingAt,
              servingAt,
              completedAt: new Date(servingAt.getTime() + duration * 60_000),
            });
          }
        }
        await prisma.queueEntry.createMany({ data: rows });
        await prisma.dailyCounter.create({
          data: { organizationId: org.id, serviceId: service.id, serviceDate: dateStringToDb(day), currentCount: count },
        });
        historyCount += count;
      }
    }
  }

  // ── Today: a live queue at the clinic's General Consultation ──
  const gc = orgs.clinic.services.find((s) => s.tokenPrefix === 'GC');
  const waiting = others.slice(0, 5);
  await prisma.queueEntry.createMany({
    data: waiting.map((holder, i) => ({
      organizationId: orgs.clinic.id,
      serviceId: gc.id,
      userId: holder.id,
      tokenNumber: i + 1,
      serviceDate: dateStringToDb(today),
      status: 'WAITING',
    })),
  });
  await prisma.dailyCounter.create({
    data: { organizationId: orgs.clinic.id, serviceId: gc.id, serviceDate: dateStringToDb(today), currentCount: waiting.length },
  });

  console.log(`Seeded ${ORGS.length} organizations, ${2 + 3 + 1 + CUSTOMER_NAMES.length} demo accounts, ${historyCount} historical tokens and ${waiting.length} waiting tokens today.`);
  console.log(`Demo accounts use the @${DOMAIN} domain (password from SEED_DEMO_PASSWORD, default shown in README).`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

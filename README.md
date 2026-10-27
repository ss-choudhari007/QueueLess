# QueueLess

**QueueLess** is a multi-organization digital queue platform for places where people normally stand in line: clinics, hospitals, salons, college offices, document-verification counters and service centers.

> **Status:** functional and verified locally against Neon PostgreSQL. 86 automated backend tests pass, and the production build was smoke-tested locally. **Not deployed yet:** deployment needs your own Vercel/Render accounts (see [Deployment](#deployment)).

## The problem

At a clinic reception, a college admissions office or a document-verification counter, people often wait 30–90 minutes in a physical line. They cannot leave without losing their place, they have no idea how long the wait will be, and crowded waiting areas are uncomfortable (and, in clinics, a health risk). Staff juggle paper token slips, shout numbers, and cannot tell who actually turned up. Owners have no data about how long people wait or how often they do not show up.

## Who it is for

| User | Need |
|---|---|
| **Customers** (patients, students, salon clients, citizens) | Hold a place in line without standing in it, see a realistic wait, and come back in time |
| **Staff** at the counter | Call people in a fair order, verify that the right person has arrived, and keep the line moving when someone does not come |
| **Owners / managers** | Configure services and hours, control capacity, manage staff, and understand demand |

## The solution

- **Customers** join a queue from their phone, follow their position and an estimated wait live, get an in-app call notification, and check in at the counter with a QR code plus an explicit "I'm here" confirmation.
- **Staff** run the queue from a live console: call next, scan QR codes (or type a manual code), start and complete service, and handle no-shows fairly with a 5-minute grace period.
- **Owners** set up organizations, services, opening hours, queue rules and staff, and review analytics built from real queue data.

**Why it is useful**
- Customers' time is freed: they can wait anywhere and arrive when called.
- Counters stay orderly: token numbers are guaranteed unique and calls happen strictly in order, even with simultaneous clicks.
- Fairness: arrival is verified at the counter (QR scan + the customer's own confirmation), no-shows are handled automatically after a grace period, and repeat no-shows are restricted per organization.
- One platform serves many independent organizations, each fully isolated from the others.

## Contents

1. [Features](#features)
2. [Architecture](#architecture) · [Design decisions](#key-design-decisions)
3. [Prerequisites](#prerequisites)
4. [Setup](#setup)
5. [Running locally](#running-locally)
6. [Demo accounts](#demo-accounts)
7. [Tests and builds](#tests-and-builds)
8. [API and real-time overview](#api-and-real-time-overview)
9. [Deployment](#deployment)
10. [Security notes](#security-notes)
11. [Known limitations](#known-limitations)
12. [Project structure](#project-structure)

---

## Features

| Area | What works |
|---|---|
| Accounts | Register as a customer or an organization owner. Staff join through single-use invitation links. Sign out on one device or everywhere. |
| Discovery | Search organizations by text, category, city and "open now". The organization page shows hours, contact details and live per-service status (waiting, now serving, estimate, availability). |
| Joining | Concurrency-safe token numbers per organization, service and date in the organization's timezone. Enforces daily limits, opening hours, pause, inactive services, duplicate tokens and restrictions. |
| Customer token | Live people-ahead count, estimated wait (clearly labelled as an estimate), now-serving, timeline, dynamic QR code with manual code, cancellation while waiting, history. |
| Arrival | Staff scan (camera) or enter the code. The customer receives a prompt and must tap **I'm here**. Only then can service start. |
| Staff console | Per-service tabs and counts, call next, counter cards with grace countdown and arrival state, start/complete, no-show after the deadline, pause/resume, revert call, excuse no-show, activity log (supervisors). |
| No-show policy | 5-minute grace period by default. Automatic processing every 30 s, persisted in the database. Three unexcused no-shows in 30 days → 72-hour restriction at that organization only. Audited corrections. |
| Owner | Several organizations per owner. Profile, timezone, public listing, weekly hours, token limit, grace period, QR lifetime, services CRUD with activate/deactivate, staff invitations and roles, restrictions, analytics with charts and filters. |
| Real time | Socket.IO with cookie authentication and server-side room authorization. Clients refetch REST state after every reconnect. |

## Architecture

```
frontend/ (React 19 + Vite + Tailwind CSS 4 + React Router)
   │  fetch (cookies + CSRF header)        Socket.IO client (cookies)
   ▼                                        ▼
backend/ (Node.js + Express 5 + Socket.IO, ES modules)
   │  routes → middleware (auth, org access, CSRF, rate limit, zod) → services
   │  background processor: no-show deadlines + end of service day
   ▼
PostgreSQL on Neon  (Prisma ORM, migrations in backend/prisma/migrations)
```

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, Tailwind CSS 4, React Router 7, socket.io-client, qrcode.react, html5-qrcode, Recharts, lucide-react |
| Backend | Node.js ≥ 20, Express 5, Socket.IO 4, Prisma 5.22, zod, bcryptjs, jsonwebtoken, helmet, express-rate-limit |
| Database | PostgreSQL (Neon) |
| Tests | Vitest + Supertest + socket.io-client, against an isolated test database |

### Key design decisions

| Decision | Why |
|---|---|
| **PostgreSQL + Prisma** (not a document store) | Queue numbering and state changes need transactions, row locks and unique constraints. Prisma gives versioned migrations and a typed query API from plain JavaScript. |
| **Atomic counter row per organization, service and day** (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) | Concurrent joins are serialized by the database itself. A rolled-back join never consumes a number. In-memory counters would break on restarts and multiple instances. |
| **Conditional `UPDATE … WHERE status = <expected>`** for every transition; `FOR UPDATE SKIP LOCKED` for call-next | Two staff clicking at the same time, or a customer confirming exactly as the no-show deadline passes, can never both succeed. |
| **Deadlines stored in the database + periodic processor** | No-show rules survive restarts and deployments; timers in memory would not. |
| **HttpOnly cookie sessions, a DB-backed session check and a CSRF token** | No tokens are exposed to JavaScript (XSS-resistant), logout is immediate, and cross-site request forgery is blocked. |
| **Server-side organization checks on every route and socket room** | Tenant isolation must not depend on hidden buttons. Foreign IDs return 404. |
| **QR = short-lived, single-use, hashed credential + explicit customer confirmation** | A screenshot cannot be replayed, a scan alone cannot check someone in, and nobody can confirm arrival on another person's behalf. |
| **Socket.IO events as hints, REST as the source of truth** | Clients refetch state after every event and reconnect, so a missed event never shows wrong data. |
| **Per-organization IANA timezone** | Organizations in different regions get correct service dates, opening hours and analytics. |
| **Separate frontend (static) and backend (persistent Node)** | The UI can be hosted on any CDN; Socket.IO needs a long-running server. |

## Prerequisites

- Node.js 20 or newer (developed with Node 24) and npm.
- A Neon PostgreSQL database (or any PostgreSQL 13+).
- For tests: a second database whose name contains `test` (see [Tests](#tests-and-builds)).

## Setup

```bash
git clone https://github.com/ss-choudhari007/QueueLess.git
```

```bash
cd QueueLess/backend && npm install
```

```bash
cd ../frontend && npm install
```

### Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in values there. Never commit `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string (`postgresql://…?sslmode=require`) |
| `JWT_SECRET` | yes | Random secret of 32+ characters. Generate it with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `FRONTEND_URL` | yes | Allowed frontend origin(s), comma-separated (`http://localhost:5173` locally) |
| `NODE_ENV` | yes | `development` or `production` |
| `PORT` | no | Defaults to 4000 |
| `APP_URL` | no | Public frontend URL for invitation links (defaults to the first `FRONTEND_URL`) |
| `TEST_DATABASE_URL` | no | Test database. Its name must contain `test` |
| `COOKIE_SAMESITE`, `COOKIE_SECURE`, `COOKIE_DOMAIN`, `TRUST_PROXY` | no | Cookie and proxy overrides (see the example file) |
| `SWEEP_INTERVAL_MS`, `WORKER_ENABLED`, `RATE_LIMIT_ENABLED` | no | Background processor and rate limits |
| `SEED_DEMO_PASSWORD` | no | Password for the development demo accounts |

The frontend needs **no** environment variables locally. For production, set only `VITE_API_URL` (the public backend URL). See `frontend/.env.example`. Never put database URLs or secrets in `VITE_*` variables, because they are embedded in the public bundle.

### Database

Apply migrations. This is safe and does not reset data:

```bash
cd backend && npm run db:migrate:deploy
```

Optional: load demo data. It is development-only, refuses `NODE_ENV=production`, and never overwrites existing data:

```bash
npm run db:seed
```

The seed also refuses any database that already contains non-demo accounts, so it cannot add known-password accounts to a real database. To remove only the demo data later, first preview it (dry run), then confirm:

```bash
npm run db:unseed
```

```bash
npm run db:unseed -- --confirm
```

## Running locally

Run two terminals.

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

Open http://localhost:5173. Vite proxies `/api` and `/socket.io` to `http://localhost:4000`, so cookies are same-origin. Health check: http://localhost:4000/api/health.

## Demo accounts

Created by `npm run db:seed`, for **development only**. The password is `Demo@12345` unless `SEED_DEMO_PASSWORD` was set when seeding.

| Email | Role | Notes |
|---|---|---|
| `customer@queueless.demo` | Customer | No tokens yet; join any queue |
| `customer1@queueless.demo` … `customer8@queueless.demo` | Customers | Hold today's waiting tokens and history |
| `owner@queueless.demo` | Owner | CityCare Clinic, Sunrise Hospital OPD, StyleHub Salon |
| `owner2@queueless.demo` | Owner | Govt. College Admissions Office |
| `staff@queueless.demo` | Staff | CityCare Clinic and Sunrise Hospital OPD |
| `supervisor@queueless.demo` | Supervisor | CityCare Clinic |
| `salonstaff@queueless.demo` | Supervisor | StyleHub Salon |

Sunrise Hospital OPD is open 24/7, so it always accepts tokens during a demo. The other organizations follow realistic hours in Asia/Kolkata.

## Tests and builds

### One-time: create the test database

Tests never touch your application database. By default they use a database named `queueless_test` on the same Neon server, connecting directly rather than through the pooler, and they refuse to run against any database whose name lacks `test`. Create it once with the Neon SQL editor (`CREATE DATABASE queueless_test;`) or the Neon console, or set `TEST_DATABASE_URL`. Migrations are applied to it automatically before each run.

```bash
cd backend && npm test
```

```bash
cd backend && npx prisma validate
```

```bash
cd frontend && npm run build
```

The suite (86 tests) covers authentication and sessions, CSRF, roles, tenant isolation, concurrent numbering, duplicate prevention, date scoping, limits, call-next races, status transitions, cancellation, QR validity, expiry and replay, the scan-without-confirmation rule, manual codes, grace periods, the confirmation/no-show race, the rolling 30-day count, organization-specific restrictions, corrections with audit, end-of-day closing, socket authentication and room authorization, private event delivery, reconnection, health and error handling, owner workflows, invitations and analytics.

### What is tested automatically vs. manually

| Behaviour | Automated test | Manually verified in the browser |
|---|---|---|
| Registration, login, logout, logout-everywhere, refresh, forged tokens | ✅ `auth.test.js` | ✅ customer and owner sign-up, validation messages |
| CSRF, roles, CORS, JSON 404, malformed JSON, DB outage → 503 | ✅ `auth.test.js`, `platform.test.js` | — |
| Tenant isolation (staff, owners, customers; foreign IDs) | ✅ `tenancy.test.js` | ✅ staff opening another org's console sees "No access" |
| Concurrent numbering, duplicates, limits, date scope, closed/paused/inactive | ✅ `queue.test.js` | ✅ joined queues and received correct numbers |
| Call-next race, transitions, pause permissions, revert call, cancellation | ✅ `queue.test.js` | ✅ call, start, complete, cancel |
| QR validity, expiry, replay, cross-org, manual code lockout, scan ≠ arrival | ✅ `qr.test.js` | ✅ code verified → customer prompt → "I'm here" |
| Grace deadline, confirm vs. no-show race, 30-day count, 72 h restriction, excuse + audit, day close | ✅ `noshow.test.js` | ✅ worker auto-marked 5 overdue tokens |
| Socket auth, room authorization, private delivery, reconnect, logout disconnect | ✅ `realtime.test.js` | ✅ live "It's your turn" update without reload |
| Owner org/services/settings/invites/analytics; partial updates keep other fields | ✅ `owner.test.js` | ✅ create org, add service, invite → staff account created, analytics charts |
| Production build with `NODE_ENV=production` API (Secure HttpOnly cookies, helmet headers, sockets) | — | ✅ local smoke test with `vite preview` |
| Camera QR scanning on a phone | — | ⚠️ not verified (no camera in the test environment); manual code path verified |
| Safari / iOS | — | ⚠️ not verified; see the cookie note in Deployment |

## API and real-time overview

The full reference is in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md). Business rules are in [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md).

| Prefix | Who | Examples |
|---|---|---|
| `/api/auth` | everyone | `csrf`, `register`, `login`, `refresh`, `logout`, `logout-all`, `me` |
| `/api/orgs`, `/api/services/:id/status` | public | search, organization detail with live queue status |
| `/api/customer` | customers | join, active, history, token, cancel, qr, confirm-arrival, restrictions |
| `/api/staff/orgs/:orgId` | staff/owner of that org | queue, call-next, pause, arrival/verify, start, complete, no-show, revert-call, excuse-no-show, audit |
| `/api/owner` | owners | organizations, settings, services, staff & invites, analytics, restrictions |
| `/api/invites` | invitees | lookup, accept-new, accept |

Socket.IO events: `queue:updated`, `token:updated`, `token:called`, `arrival:requested`, `arrival:confirmed`. Rooms are authorized on the server: `org:join` for staff and `service:watch` for public pings.

## Deployment

> **Step-by-step guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** — frontend on Vercel, backend on Render (Vercel cannot host the always-on Socket.IO server and no-show processor), database on Neon.

The app is deployment-ready but **not deployed**. These steps need your accounts.

**Database (Neon)**
1. Prefer a separate Neon branch or database for production. Do **not** run `db:seed` there, or run `db:unseed` first.
2. Run `npm run db:migrate:deploy` against it. The Render build below does this automatically.

**Backend (Render, Railway or any host with persistent Node processes; Socket.IO needs WebSockets)**
- Render: `render.yaml` at the repository root is a ready blueprint (root `backend`, build `npm ci && npx prisma migrate deploy`, start `node server.js`, health `/api/health`).
- Set `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (random), `FRONTEND_URL=https://<your-frontend>` and `APP_URL=https://<your-frontend>`.
- In production, cookies default to `SameSite=None; Secure`, so the separately hosted frontend can authenticate, protected by the CSRF token and the CORS allow-list. `TRUST_PROXY` defaults to 1.
- Run a single instance, or set `WORKER_ENABLED=false` on extra instances. Multiple processors are still safe, just redundant. Socket.IO across several instances would need a Redis adapter, which is not included.

**Frontend (Vercel, Netlify or any static host)**
- Root directory `frontend`, build `npm run build`, output `dist`.
- Environment: `VITE_API_URL=https://<your-backend>` (no trailing slash).
- `frontend/vercel.json` already rewrites all routes to `index.html` for client-side routing.

**Important: keep the frontend and API on the same *site* for Safari and iOS.**
If the frontend is on `*.vercel.app` and the API on `*.onrender.com`, the session cookies are third-party cookies. Chrome currently accepts them (`SameSite=None; Secure`), but Safari and all iOS browsers block them, so sign-in would not stick there. Use one of these:
1. *(Recommended)* A custom domain for both, e.g. `app.example.com` (frontend) and `api.example.com` (backend). Set `VITE_API_URL=https://api.example.com` and `COOKIE_SAMESITE=lax`.
2. Proxy the API through the frontend host. Leave `VITE_API_URL` empty and add rewrites **before** the SPA rule in `frontend/vercel.json`: `{ "source": "/api/:path*", "destination": "https://<backend>/api/:path*" }` and `{ "source": "/socket.io/:path*", "destination": "https://<backend>/socket.io/:path*" }`. Then set `FRONTEND_URL` to the Vercel URL and `COOKIE_SAMESITE=lax`. Socket.IO will use HTTP long-polling through the proxy, because Vercel rewrites do not carry WebSockets.

## Security notes

- Passwords are hashed with bcrypt (cost 12). Login errors do not reveal whether an email exists.
- Sessions use HttpOnly cookies only, with no tokens in `localStorage`. Every request re-validates the session, so logout is immediate and also disconnects sockets.
- CSRF uses a double-submit token, a CORS allow-list and Socket.IO origin checks.
- Organization access is checked on the server for every staff/owner route and socket room. Foreign IDs return 404.
- Input is validated with zod. Errors return safe messages, and database outages return 503.
- Auth, invitation and QR endpoints are rate-limited.
- QR secrets, manual codes, refresh tokens and invitation tokens are stored only as hashes, and QR secrets are never logged.
- An audit log records queue-state changes, corrections and administrative changes.
- No hidden admin accounts or authentication bypasses. Demo accounts exist only when you run the development seed.

## Known limitations

- Notifications are in-app only (no SMS, email or push), so customers need the page open, or must reopen it, to see prompts. Pending prompts are restored from the API on reconnect.
- The waiting estimate assumes one counter per service.
- Camera scanning requires HTTPS or `localhost` and a browser that allows camera access. The manual code is the fallback.
- One backend instance is assumed for Socket.IO broadcasts. Several instances would need the Socket.IO Redis adapter.
- Invitation links must be shared manually; there is no email service.
- Hosting the frontend and backend on unrelated domains breaks sign-in in Safari/iOS (third-party cookies). Use a same-site setup; see [Deployment](#deployment).
- There is no automated browser end-to-end suite. The UI was verified manually (see `docs/HANDOFF.md`).

## Project structure

```
backend/
  server.js                 entry: config check, DB check, HTTP + Socket.IO + worker
  src/app.js                Express app (security middleware, routes, errors)
  src/socket.js             Socket.IO auth and room authorization
  src/worker.js             periodic no-show / end-of-day processor
  src/routes/               auth, public, customer, staff, owner, invites
  src/services/             queue, QR, no-show policy, orgs, staff, analytics, audit, access
  src/middleware/           auth/org access, CSRF + rate limits, error handler
  src/lib/                  validation, time zones, crypto, constants, errors
  prisma/                   schema, migrations, seed/unseed
  tests/                    Vitest suites + isolated test DB setup
frontend/
  src/pages/public|customer|staff|owner
  src/components/ui|layout  shared design system
  src/lib/api.js|socket.js  API client (CSRF, refresh) and socket
docs/                       PROJECT_SPEC, API_CONTRACT, HANDOFF
render.yaml                 Render blueprint for the API
```

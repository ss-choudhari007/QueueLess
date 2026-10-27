# QueueLess — Handoff Document

**Version**: 2.0
**Last updated**: 2026-10-27
**Current phase**: Full-stack application implemented and verified locally. Not committed, not deployed.

> Read this first when you return to the project. It records what exists, what was verified and what is left.

---

## 1. Status at a glance

| Area | Status |
|---|---|
| Database schema + migrations | ✅ `20261026102918_init` + `20261027090000_core_workflows` applied to Neon (`neondb`) |
| Backend API (auth, public, customer, staff, owner, invites) | ✅ Implemented |
| Socket.IO (cookie auth, authorized rooms) | ✅ Implemented |
| Background processor (no-shows, end of day) | ✅ Runs at startup and every 30 s |
| Frontend (all public, customer, staff, owner screens) | ✅ Implemented, production build passes |
| Automated backend tests | ✅ 86 tests (isolated `queueless_test` database) — see §3 for the latest run |
| Demo seed data | ✅ Seeded into the development database (`@queueless.demo` accounts) |
| Documentation | ✅ README, PROJECT_SPEC, API_CONTRACT, this file |
| Git commit / push | ❌ Not done (waiting for your approval) |
| Deployment | ❌ Not done (needs your Vercel/Render accounts) |

## 2. What changed in this phase

**Database** (`backend/prisma/schema.prisma`, new migration `20261027090000_core_workflows`)
- Upper-case canonical enums: `TokenStatus` (`WAITING`…`NO_SHOW`), `UserRole`, `CancellationReason`. New `MembershipRole` (`STAFF`, `SUPERVISOR`).
- New tables: `staff_memberships`, `staff_invites`, `qr_credentials`, `customer_restrictions`, `audit_logs`.
- Organizations gained `slug`, `category`, `city`, `email`, `timezone` and `isActive`. One owner may own several organizations.
- Queue settings use `weeklyHours` (7 days), `noShowGracePeriodMinutes` (default 5) and `qrTtlSeconds`.
- `queue_entries` uses `serviceDate` plus arrival/cancellation timestamps and `noShowExcused`. The QR columns moved to `qr_credentials`.
- Partial unique index: one active token per customer, service and date.
- The migration aborts if the restructured tables contain data. They were empty when it was applied (verified before applying).

**Backend** (`backend/src/…`): see README "Project structure". Express was upgraded to v5 (native async errors). New dependencies: helmet, cookie-parser, express-rate-limit, zod, bcryptjs, jsonwebtoken, socket.io. Dev dependencies: vitest, supertest, socket.io-client.

**Frontend** (`frontend/`): new React 19 + Vite + Tailwind 4 app with shared UI components, an API client (CSRF + refresh), a socket client, and all screens.

**Local environment**: `backend/.env` previously had an empty `JWT_SECRET`. A random value was generated and written there (never printed). No other `.env` values were changed.

**Test database**: a separate database `queueless_test` was created on the same Neon project for automated tests. Tests refuse to run against any database whose name lacks `test`.

## 3. Verification performed (actual results)

| Check | Result |
|---|---|
| `npx prisma validate` / `prisma migrate deploy` | ✅ valid; all migrations applied |
| `npm test` (backend) | ✅ all passing (auth, platform, queue, tenancy, qr, noshow, realtime, owner) |
| `npm run build` (frontend) | ✅ builds; charts and scanner are code-split and load on demand |
| Server start + `/api/health` | ✅ `200 {"database":"connected"}` |
| Browser walkthrough (built-in browser, desktop + 375 px mobile) | ✅ see below |

Manual browser walkthrough on 2026-10-27:
1. Landing page and organization search rendered with seeded data.
2. Signed in as `customer@queueless.demo` and joined CityCare → General Consultation: received **GC-006**, 5 ahead, ~50 min estimate, QR and manual code shown.
3. Staff (separate session) called next 6 times. The customer page switched live to "It's your turn" with a 5:00 countdown, without reloading.
4. Staff verified the customer's manual code. The customer's browser showed the **Confirm your arrival** dialog, and the token stayed unconfirmed until "I'm here" was clicked. Replaying the code was rejected.
5. Staff console in the browser showed "Arrival confirmed". Start service → Complete worked, and the token moved to "Finished today".
6. The other 5 called tokens were automatically marked `NO_SHOW` by the worker about 20 s after their deadlines.
7. Owner: organization list, analytics (stats + charts), services, hours, and staff invitation link creation all worked.
8. Mobile (375 px): staff console has no horizontal overflow.

Release audit (2026-10-27, second pass):
- Browser-verified additional workflows: owner sign-up → create organization → add service; staff invitation → new staff account → console; customer sign-up → search → join → cancel → history; cross-organization console shows "No access".
- Production smoke test: `vite build` + `vite preview` against the API running with `NODE_ENV=production` (proxy, same-site setup): sign-in, join, live socket and cancel all work; cookies are `HttpOnly; Secure; SameSite=Lax`; helmet headers present; no console errors.
- Fixed: zod upgraded to 4.6.7 (npm audit high advisory) with update schemas restructured so partial PATCHes never reset fields (new regression test); the timezone dropdown displayed "Africa/Abidjan" for organizations stored as "Asia/Kolkata"; the seed now refuses databases containing non-demo accounts; unseed is a dry run unless `-- --confirm` is passed.

Issues found and fixed during the first verification: forged JWTs caused a 500 (now 401); the post-login redirect ignored `?next=`; the staff console now defaults to the busiest service; badges no longer wrap; the spent QR is hidden after a scan; the tab title updates after confirmation.

## 4. How to run

See README → Setup / Running locally / Tests. Short version:

```bash
cd backend && npm install && npm run db:migrate:deploy && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

## 5. Demo checklist (suggested order)

1. Landing page → **Find a queue** → filter by city "Pune" → open **CityCare Clinic** (or **Sunrise Hospital OPD**, open 24/7).
2. Sign in as `customer@queueless.demo` (`Demo@12345`) → **Join queue** → show the token page (people ahead, estimate, QR, manual code).
3. In a second browser or a private window (cookies are per browser), sign in as `staff@queueless.demo` → Queue console → choose the same organization and service.
4. Staff: **Call next** until the customer's token is called. The customer's page updates live with the countdown.
5. Staff: **Scan QR** with the phone camera, or **Enter code** with the 6-character code. The customer gets the **I'm here** prompt. Show that **Start service** stays disabled until the customer confirms.
6. Customer taps **I'm here** → staff **Start service** → **Complete**. The customer sees "Service completed" and the token appears in **History**.
7. Show the grace period: call another token and wait 5 minutes, or explain the countdown. It becomes a no-show automatically.
8. Sign in as `supervisor@queueless.demo` → excuse a no-show with a reason → open the **Activity log**.
9. Sign in as `owner@queueless.demo` → CityCare → Overview checklist, **Services** (add/deactivate), **Hours & queue**, **Staff** (create an invitation link), **Analytics** (7/30/90 days, service filter), **Restrictions**.
10. Security talking points: open `/staff/<another org id>` as staff → "No access"; customers cannot open other tokens; sign out everywhere.

## 6. Environment variables you must set

Backend (`backend/.env`): `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV` (all already present locally). Optional: see `backend/.env.example`.
Frontend: none locally. In production `VITE_API_URL` only, or leave it empty when proxying `/api`.

## 7. Known limitations / next steps

1. **Deploy** following README → Deployment (not done — requires your accounts; deployment is therefore unverified). Use a same-site setup (custom domain, or the Vercel `/api` proxy) so Safari/iOS keep the session cookies. Use a separate Neon branch for production and do not seed it.
2. Optional: a browser end-to-end suite (Playwright) to automate the manual walkthrough above.
3. Optional: email delivery for staff invitations (links are currently copied manually).
4. Optional: Socket.IO Redis adapter if the backend is scaled to several instances.
5. Optional: web push or SMS notifications. Notifications are currently in-app only.

## 8. Approved decisions (cumulative)

| # | Decision |
|---|---|
| D-1 | Folders: `frontend/` and `backend/` in one repository |
| D-2 | English for code and docs |
| D-3 | `.env`, `node_modules`, `dist` and secrets are gitignored |
| D-4 | No platform-admin role |
| D-5 | HttpOnly cookie sessions (15 min JWT + 7-day DB refresh token), no `localStorage` |
| D-6 | Canonical upper-case statuses (`SERVING` for in-service) |
| D-7 | Five-minute default grace; 3 no-shows / 30 days → 72 h restriction per organization |
| D-8 | Arrival requires staff QR/code validation **and** explicit customer confirmation |
| D-9 | Staff are invited by single-use link; owners may own several organizations; staff may work for several |
| D-10 | Tests run against a separate database whose name must contain `test` |

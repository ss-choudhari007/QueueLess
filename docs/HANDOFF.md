# QueueLess — Handoff Document

**Version**: 1.3
**Last updated**: 2026-10-26
**Current phase**: Part 2 Complete ✅ — Ready for Part 3 (Frontend Scaffold)

> Read this file first whenever you return to the project. It tells you exactly where things stand and what to do next.

---

## 1. Current Status

| Item | Status |
|---|---|
| Git repository | ✅ Initialized |
| `.gitignore` | ✅ Updated — Prisma path corrected, migration policy documented |
| `README.md` | ✅ Updated |
| `docs/PROJECT_SPEC.md` | ✅ Complete (Part 1) |
| `docs/API_CONTRACT.md` | ✅ Complete (Part 1) |
| `docs/HANDOFF.md` | ✅ Up to date (this file) |
| Part 1 Git commit | ✅ `ba662a4` |
| Part 2 Step 1 Git commit | ✅ `2eac38b` |
| Part 2 Step 2 Git commit | ❌ Not yet created — see Section 7 |
| `backend/package.json` | ✅ Prisma scripts added |
| `backend/server.js` | ✅ Updated — PrismaClient, startup DB check, health reports DB status |
| `backend/.env.example` | ✅ Updated DATABASE_URL guidance |
| `backend/.env` | ✅ DATABASE_URL set — gitignored, verified non-empty |
| `backend/prisma/schema.prisma` | ✅ Audited and corrected — 3 enums, 7 models |
| `backend/prisma/migrations/` | ✅ `20261026102918_init` applied to Neon |
| Prisma 5.22.0 installed | ✅ Both `prisma` and `@prisma/client` at 5.22.0 |
| `prisma format` | ✅ Passed |
| `prisma validate` | ✅ Passed |
| `prisma generate` | ✅ Passed — client in `node_modules/@prisma/client` |
| `DATABASE_URL` configured | ✅ Set in `backend/.env` — Neon host verified |
| Neon TCP connectivity | ✅ Confirmed |
| Initial migration applied | ✅ `20261026102918_init` — all 7 tables created |
| Tables in Neon (`neondb`) | ✅ `users`, `organizations`, `services`, `queue_entries`, `daily_counters`, `refresh_tokens`, `queue_settings` |
| Startup DB connectivity check | ✅ Server refuses to start if DB is unreachable |
| `GET /api/health` | ✅ Returns `database: "connected"` and HTTP 200 when DB is up |
| 404 handler | ✅ Returns JSON with `NOT_FOUND` code |
| Authentication | ❌ Not implemented — Part 4 |
| Frontend | ❌ Not started — Part 3 |
| Deployment | ❌ Not started — Part 9 |

---

## 2. What Was Completed

### Part 1 — Architecture Planning and Documentation (2026-10-25)
Committed as `ba662a4`.

### Part 2, Step 1 — Minimal Express Backend (2026-10-26)
Committed as `2eac38b`. Express server confirmed running. `GET /api/health` returns HTTP 200.

### Part 2, Step 2 — Prisma, Schema, Migration, Startup Check (2026-10-26)

**Not yet committed** — see Section 7 for exact commands.

#### Prisma Installation
- Both `prisma` and `@prisma/client` pinned to exactly `5.22.0` via `--save-exact`.
- Node.js v24.14.0 is fully supported by Prisma v5.

#### Schema Design
`backend/prisma/schema.prisma` — 3 enums, 7 models:

**Enums**:
- `UserRole`: `customer`, `staff`, `owner`
- `TokenStatus`: `waiting`, `called`, `serving`, `completed`, `cancelled`, `no_show`
- `CancellationReason`: `customer`, `queue_closed` *(added in schema audit — prevents invalid string values)*

**Models**:

| Model | Table | Key constraints |
|---|---|---|
| `User` | `users` | `email @unique`; nullable `organizationId` for staff/owner |
| `Organization` | `organizations` | `ownerId @unique` — one org per owner |
| `Service` | `services` | `@@index([organizationId])` |
| `QueueEntry` | `queue_entries` | `@@unique([organizationId, serviceId, date, tokenNumber])` — duplicate token safety; `noShowAt` timestamp added in audit |
| `DailyCounter` | `daily_counters` | `@@unique([organizationId, serviceId, date])` — one counter per org/service/day |
| `RefreshToken` | `refresh_tokens` | `tokenHash @unique` — raw token never stored |
| `QueueSettings` | `queue_settings` | `organizationId @unique` — 1-to-1 with Organization |

#### Schema Audit Corrections
| Finding | Fix |
|---|---|
| `cancellationReason String?` allowed any value | Changed to `CancellationReason` enum (exactly `customer`, `queue_closed`) |
| No timestamp when no-show recorded | Added `noShowAt DateTime? @db.Timestamptz` |
| `waiting → no_show` in spec diagram | Confirmed spec error: background job only targets `status='called'`. Schema is correct. |
| Staff invitation pending state | Deferred — added as Open Decision OD-8 |

#### Validation Results (all commands run and confirmed)
| Command | Result |
|---|---|
| `prisma format` | ✅ Formatted in 15ms |
| `prisma validate` | ✅ "The schema is valid 🚀" |
| `prisma generate` | ✅ "Generated Prisma Client (v5.22.0) in 44ms" |

#### Migration
- Applied: `20261026102918_init`
- Database: `neondb` at Neon (ap-southeast-1)
- Tables created: `users`, `organizations`, `services`, `queue_entries`, `daily_counters`, `refresh_tokens`, `queue_settings`
- Verified via `information_schema.tables` query — all 7 tables confirmed

#### Server Updates (`backend/server.js`)
- Added shared `PrismaClient` export (one instance for whole server)
- `startServer()` async function — pings DB with `SELECT 1` before `app.listen()`
- Server exits with code 1 if DB is unreachable (fail fast)
- `GET /api/health` now queries `SELECT 1` and returns `database: "connected"` or `"unreachable"`
- HTTP 200 when healthy, HTTP 503 when DB is down

#### Smoke Tests (actual results)
| Test | Result |
|---|---|
| Server startup with valid DB | ✅ "Database connection: verified (Neon PostgreSQL)" |
| `GET /api/health` | ✅ `{"status":"ok","database":"connected"}` |
| `GET /api/nonexistent` | ✅ `{"success":false,"error":{"code":"NOT_FOUND",...}}` |
| `git diff --check` | ✅ PASSED |
| `backend/.env` protected | ✅ `.gitignore:10:.env` |
| `backend/node_modules` protected | ✅ `.gitignore:22` |

---

## 3. Schema Design Notes

### Token number safety (Section 4.1)
Generated by atomic `UPDATE daily_counters SET current_count = current_count + 1 WHERE ... RETURNING current_count`. The `@@unique` on `QueueEntry` is a DB-level safety net. Both together prevent duplicates under concurrent load.

### No-show deadline (Section 4.5)
`noShowDeadline` persisted in DB at the moment a token is `called`. Background job (Part 8): `WHERE status = 'called' AND no_show_deadline < NOW()`. Survives server restarts.

### QR verification (Section 4.7)
- `qrSecret` (`@db.Uuid`): random UUID generated when token is `called`
- `qrExpiresAt`: 5 minutes after `calledAt`
- `qrUsed`: `true` after staff scans — one-time use
- Customer must separately confirm — scan alone does not confirm arrival

### Organization isolation
Every model with org-sensitive data carries `organizationId`. The server must filter by `organizationId` on every protected query (enforced at application layer — Part 5+).

---

## 4. Approved Decisions

| # | Decision |
|---|---|
| D-1 | Folders: `frontend/` and `backend/` |
| D-2 | Language: English for all code and docs |
| D-3 | Git: `.gitignore` excludes `.env`, `node_modules`, `dist`, secrets |
| D-4 | No platform-admin role in initial implementation |
| D-5 | Auth: HTTP-only cookies. JWT 15 min + random refresh 7 days. No `localStorage`. |
| D-6 | Token uniqueness: atomic `DailyCounter` increment + DB `@@unique` safety net |
| D-7 | QR: short-lived (5 min), single-use `qrSecret`. Customer must confirm; scan alone does not confirm. |
| D-8 | No-show: `noShowDeadline` persisted in DB. Background job on startup + every 1 min. |
| D-9 | Daily reset: `date` column isolates days. `waiting` tokens auto-cancelled at close. |
| D-10 | EWT: `position × avgDurationMinutes` (fixed, not live average) |
| D-11 | Stack: React + Vite + Tailwind + JS / Node + Express + JS / Neon PostgreSQL / Prisma 5 / Socket.IO |
| D-12 | No TypeScript unless explicitly approved |
| D-13 | Prisma version: 5.22.0 (stable GA, pinned) |

---

## 5. Open Decisions

| ID | Question | Must decide before |
|---|---|---|
| OD-1 | What happens to a `serving` token at queue close time? | Part 8 |
| OD-2 | What happens to a `called` token at queue close time? | Part 8 |
| OD-3 | Can a customer rejoin the same service after cancelling on the same day? | Part 5 |
| OD-4 | Use live rolling average for EWT instead of fixed value? | Part 5 |
| OD-5 | What exactly does "pause queue" mean — blocks joins, stops calling, or both? | Part 6 |
| OD-6 | Can a customer hold more than one active token for the same service/day? | Part 5 |
| OD-7 | What if the customer's app is not open when their token is called? | Part 6 |
| OD-8 | Staff invitation: what if the invited email has no account yet? Store pending invite? | Part 6 |

---

## 6. Git History

```
2eac38b  Complete Part 2 Step 1: Express backend setup
ba662a4  Part 1: Project specification, API contract, and documentation
```

### Pending (unstaged) — Part 2, Step 2

**Modified:**
- `.gitignore` — corrected Prisma path, documented migration policy
- `README.md` — Prisma setup commands, phase tracker
- `backend/.env.example` — improved DATABASE_URL guidance
- `backend/package.json` — Prisma scripts added
- `backend/package-lock.json` — updated by npm
- `backend/server.js` — PrismaClient, startup check, health reports DB status
- `docs/HANDOFF.md` — this file

**New (untracked):**
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261026102918_init/migration.sql`
- `backend/prisma/migrations/migration_lock.toml`

**Protected (must NOT be staged):**
- `backend/.env` ✅ gitignored

---

## 7. Git Checkpoint — Commands to Run Yourself

```bash
cd /Users/shreyashchoudhari/Desktop/Queueless

# Step 1: Confirm .env is protected
git check-ignore -v backend/.env
# Expected: .gitignore:10:.env   backend/.env

# Step 2: Stage files individually — never use git add .
git add .gitignore
git add README.md
git add backend/.env.example
git add backend/package.json
git add backend/package-lock.json
git add backend/server.js
git add backend/prisma/schema.prisma
git add backend/prisma/migrations/
git add docs/HANDOFF.md

# Step 3: Review what's staged
git status
git diff --staged

# Step 4: Commit
git commit -m "Part 2 Step 2: Prisma schema, migration, and startup DB check

- Add backend/prisma/schema.prisma (3 enums, 7 models, all constraints)
  - Schema audited: added CancellationReason enum, noShowAt timestamp
- Install prisma@5.22.0 and @prisma/client@5.22.0 (pinned)
- Apply initial migration: 20261026102918_init (neondb, Neon PostgreSQL)
  - Tables: users, organizations, services, queue_entries,
            daily_counters, refresh_tokens, queue_settings
- Update server.js: PrismaClient, startup fail-fast DB connectivity check
- Update GET /api/health to report database: connected/unreachable
- Add Prisma npm scripts to package.json
- Fix .gitignore: remove stale Prisma path, document migration policy
- Update README.md and docs/HANDOFF.md with verified results

All tests pass: prisma validate, prisma generate, startup check,
health endpoint (database: connected), 404 handler."

# Step 5 (optional): Push to GitHub
git push origin main
```

> ⚠️ **Do not use `git add .`** — always add files individually to prevent accidentally staging `.env`.

---

## 8. The Next Step — Part 3: Frontend Scaffold

**Part 3: React + Vite Frontend**

- Create `frontend/` using Vite + React + JavaScript
- Add Tailwind CSS for styling
- Set up React Router for page navigation
- Create placeholder pages: Home, Browse Organizations, Queue Status, Login
- Configure `frontend/.env.example` with `VITE_API_URL`
- Verify the frontend can reach `GET /api/health` and display the result

When ready, tell me to continue with Part 3.

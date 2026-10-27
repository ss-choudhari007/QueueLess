# QueueLess — Project Specification

**Version**: 2.0 (implemented)
**Last updated**: 2026-10-27
**Status**: Describes the behaviour implemented in `backend/` and `frontend/`. All previously open decisions are resolved in §9.

---

## 1. What the application does

QueueLess lets people join a physical service queue digitally instead of standing in line. Organizations (clinics, hospitals, salons, college offices, service centers, …) register, configure services, opening hours and staff, and run their queues from a live console. Customers join from their phone, follow their position and estimated wait in real time, are notified when called, and check in at the counter with a QR code plus an explicit in-app confirmation.

---

## 2. Roles and permissions

| Account role | How it is created | Scope |
|---|---|---|
| `CUSTOMER` | Self-registration | Their own tokens, history and restrictions |
| `OWNER` | Self-registration ("I run an organization") | Organizations they own (an owner may own several) |
| `STAFF` | Only through an invitation link created by an owner | Organizations where they hold a membership (may be several) |

Within one organization a staff membership has a role:

| Membership role | Can |
|---|---|
| `STAFF` | View the queue, call next, verify arrival (QR / manual code), start and complete service, mark no-shows after the deadline |
| `SUPERVISOR` | Everything above, plus pause/resume queues, revert an accidental call, excuse a no-show, view the activity (audit) log |
| Owner of the organization | Everything a supervisor can, plus organization profile, services, hours & queue settings, staff management, analytics and restrictions |

There is **no platform-admin role**, no hidden administrator account and no authentication shortcut.

### 2.1 Tenant isolation rules (enforced on the server)

1. Every staff/owner route resolves access with `getOrgAccess(user, orgId)` (owner of the org, or membership) before any business logic.
2. Every query in those routes filters by the authorized `organizationId`. A token, service, invite or membership id that belongs to another organization returns **404**, so ids cannot be probed or manipulated.
3. Customer routes filter by `userId`; another customer's token returns **404**.
4. Socket.IO room joins are authorized on the server with the same function. Public service rooms receive only anonymous pings.
5. Frontend route guards exist only for convenience.

---

## 3. Features by role

**Customer** — register / sign in / sign out (this device or everywhere) · browse and search organizations (text, category, city, open now) · organization page with hours, contact and live per-service queue status · join a queue · live token page (people ahead, estimated wait, now serving, timeline) · dynamic QR code with a 6-character manual fallback code · in-app call notification and arrival prompt on any page · cancel while waiting · history with status filter · restriction notices.

**Staff** — organization picker · per-service queue console with live counts · call next · counter cards with grace countdown and arrival state · camera QR scanner (html5-qrcode) with manual code entry fallback · start / complete service · mark no-show after the deadline · supervisors: pause/resume, revert call, excuse no-show, activity log.

**Owner** — create organizations (several allowed) · edit profile, timezone and public listing · weekly opening hours · daily token limit, grace period, QR lifetime · create / edit / activate / deactivate services (prefix, average duration, per-service limit) · invite staff and supervisors by link, change roles, remove staff · analytics with date range and service filters (charts and tables) · view and lift restrictions · setup checklist.

---

## 4. Business rules

### 4.1 Token numbering

- Scope: `(organizationId, serviceId, serviceDate)` where `serviceDate` is the calendar date **in the organization's timezone** at the moment of joining. Numbers start at 1 for every service each day and are shown with the service prefix (`GC-007`).
- Allocation happens inside one database transaction:
  1. Re-check that the customer has no active token for this service and date, and holds fewer than 5 active tokens overall.
  2. `INSERT INTO daily_counters … ON CONFLICT (organizationId, serviceId, serviceDate) DO UPDATE SET currentCount = currentCount + 1 RETURNING currentCount`. The row lock serializes concurrent joins.
  3. Reject with `QUEUE_FULL` if the number exceeds the limit (`service.maxDailyTokens` or the organization default, 100).
  4. Insert the queue entry.
  If any step fails the transaction rolls back, so the counter is never consumed without a token.
- Safety nets: `UNIQUE (organizationId, serviceId, serviceDate, tokenNumber)` and a partial unique index allowing only one `WAITING/CALLED/SERVING` token per `(userId, serviceId, serviceDate)`.
- Joining requires: organization active, service active, service not paused, organization open now (weekly hours), customer not restricted at this organization.
- Tested: 15 concurrent joins produce exactly 1…15; 6 concurrent joins by one customer produce exactly one token.

### 4.2 Position and waiting estimate

- **People ahead** of a WAITING token = WAITING tokens with a smaller number + tokens currently CALLED or SERVING in the same service and date.
- **Average service time** = mean of the last 20 services completed today for that service when at least 3 exist (`estimateBasis: "recent"`), otherwise the owner's `avgDurationMinutes` (`"configured"`), clamped to 1–240 minutes.
- **Estimate** = `waitingAhead × avg + avg for each CALLED token + max(avg − elapsed, 0) for each SERVING token`, rounded up.
- It assumes one counter per service, so it may overestimate when several staff serve one service in parallel. The UI always labels it as an estimate, never a guarantee. Estimates are recomputed on every request and pushed via queue update events.

### 4.3 Status transitions

```
WAITING ──call next──▶ CALLED ──staff scan + customer confirm──▶ (arrival confirmed)
   │                     │  │                                         │
   │                     │  └──deadline passed, not confirmed──▶ NO_SHOW
   │                     └──supervisor "revert call"──▶ WAITING       ▼
   ├──customer cancels──▶ CANCELLED (CUSTOMER)                  start service
   └──service day ends──▶ CANCELLED (QUEUE_CLOSED)                   ▼
                                                     SERVING ──complete──▶ COMPLETED
```

- Every transition is one conditional `UPDATE … WHERE id = ? AND organizationId = ? AND status = <from> [AND extra conditions]`. If no row matches, the server re-reads the token and returns the precise `409`. Concurrent duplicates therefore cannot both succeed.
- Call next uses `SELECT … ORDER BY tokenNumber LIMIT 1 FOR UPDATE SKIP LOCKED` inside the update, so simultaneous calls never pick the same token.
- `COMPLETED`, `CANCELLED` and `NO_SHOW` are terminal. The only correction on a terminal state is excusing a no-show (it stays `NO_SHOW` with `noShowExcused = true`).
- All important timestamps (`calledAt`, `noShowDeadline`, `arrivalRequestedAt`, `arrivalConfirmedAt`, `servingAt`, `completedAt`, `cancelledAt`, `noShowAt`) come from the server clock.

### 4.4 Cancellation

- A customer may cancel only while `WAITING` ("advance cancellation"). It never counts as a no-show.
- After cancelling, the customer may join the same service again the same day and receives a new number at the back of the line.
- Staff and owners cannot cancel customer tokens; an accidental call is fixed with "revert call".

### 4.5 No-show policy

1. Calling a token stores `noShowDeadline = calledAt + grace`. The grace period is configurable per organization (1–30 minutes); the **policy default is 5 minutes**.
2. A token may become `NO_SHOW` only if it is still `CALLED`, `arrivalConfirmedAt` is null and the deadline has passed. This is rechecked inside the `UPDATE`, so a customer confirmation and the no-show processor can never both win. This is tested with racing requests.
3. The background processor runs at startup and every 30 s (`SWEEP_INTERVAL_MS`). Staff may also mark a no-show manually, but only after the deadline.
4. **Counted no-shows** = tokens with status `NO_SHOW`, `noShowExcused = false` and `noShowAt` within the last 30 days, at **one organization**. Cancellations are never counted.
5. When a recorded no-show brings the count to **3 or more**, a `CustomerRestriction` is created for that organization only, from that moment for **72 hours**. A further counted no-show while restricted extends the end to (that no-show + 72 h). Other organizations are unaffected.
6. **Corrections**: a supervisor or owner can excuse a no-show with a reason. If the count then drops below 3, active restrictions at that organization are lifted immediately. Owners can also lift a restriction early with a reason. Every correction is written to the audit log with actor and reason.
7. Everything is stored in PostgreSQL, so the policy survives restarts and deployments, and several server instances can run safely.

### 4.6 End of the service day

When an organization's closing time passes (or the next service date begins), the processor moves that day's `WAITING` tokens to `CANCELLED` with reason `QUEUE_CLOSED`. `CALLED` tokens keep their grace deadline. `SERVING` tokens are left for staff to complete. Historical tokens are never deleted.

### 4.7 QR arrival verification

1. While a token is `WAITING` or `CALLED` (before a scan), the customer app requests a credential: 32 random bytes (QR payload `QL1.<tokenId>.<secret>`) plus a 6-character manual code from an unambiguous alphabet. Only HMAC-SHA256 hashes are stored. Credentials are bound to the token and organization, expire after `qrTtlSeconds` (default 120 s), and the app refreshes them automatically. They are separate from session credentials.
2. Staff scan the QR with the camera, or select the called token and type the manual code. The server checks, in order: credential exists for this organization, not used, not revoked, not expired; token is `CALLED`, not already confirmed, deadline not passed. Five wrong manual codes revoke that token's open credentials.
3. On success the credential is consumed atomically (`UPDATE … WHERE usedAt IS NULL`), so replay and double scans fail, and `arrivalRequestedAt` is set. The customer's own sockets receive `arrival:requested`.
4. **The scan does not confirm arrival.** The customer must tap "I'm here" in their authenticated app before the deadline. Only then is `arrivalConfirmedAt` set, and only then can staff start service.
5. Raw QR secrets and codes are never logged.

### 4.8 Pausing

A paused service keeps its existing tokens. It blocks new joins (`QUEUE_PAUSED`) and blocks call-next. Called and serving customers can still be checked in, started and completed. Pause is per service and is audited.

---

## 5. Authentication and security

- **Passwords**: bcrypt (cost 12 in production). Registration enforces 8–128 characters with a letter and a number. Login returns the same error for unknown emails and wrong passwords and always runs a bcrypt comparison.
- **Sessions**: access JWT (15 min, HS256, claims `sub`, `role`, `sid`) and refresh token (256-bit random, 7 days, SHA-256 stored), both in HttpOnly cookies. Every request validates the session row, so logout and "sign out everywhere" take effect immediately and also disconnect sockets. No tokens are ever placed in `localStorage`.
- **Cookies**: `Secure` in production. SameSite is `strict` in development (same origin through the Vite proxy) and `none` in production, because frontend and backend are usually on different sites. It is configurable.
- **CSRF**: double-submit token (`GET /api/auth/csrf` → `X-CSRF-Token` header on all unsafe requests), plus a CORS allow-list and custom-header preflight. Socket.IO rejects disallowed origins (cross-site WebSocket hijacking).
- **Input validation**: zod schemas on every body and query, with lower-cased emails, trimmed strings and validated timezones.
- **Rate limiting**: auth and invitation endpoints 20 / 15 min per IP; QR issue and verify 30 / min; API overall 300 / min.
- **Headers**: helmet, `Cache-Control: no-store` on API responses.
- **Errors**: a central handler returns `{ code, message }` only. Stack traces and database messages are never sent. A database outage returns `503`.
- **Audit log**: queue-state changes, corrections, settings, services, staff and restriction changes, with actor, timestamp and details.
- **Invitations**: single use, 7-day expiry, SHA-256 stored. The link carries the token in the URL fragment so it never reaches server logs.

---

## 6. Data model (Prisma, PostgreSQL)

| Model / table | Purpose |
|---|---|
| `User` / `users` | Accounts (`role`: CUSTOMER, STAFF, OWNER) |
| `RefreshToken` / `refresh_tokens` | Sessions (hash, expiry, revokedAt) |
| `Organization` / `organizations` | Tenants: profile, category, city, timezone, isActive, owner |
| `QueueSettings` / `queue_settings` | Daily limit, grace minutes, QR TTL, weekly hours (JSON, 7 entries) |
| `Service` / `services` | Name, prefix, average duration, optional limit, active, paused |
| `StaffMembership` / `staff_memberships` | User ↔ organization with `STAFF` or `SUPERVISOR` |
| `StaffInvite` / `staff_invites` | Hashed single-use invitations |
| `QueueEntry` / `queue_entries` | Tokens and their lifecycle timestamps |
| `DailyCounter` / `daily_counters` | Atomic numbering per organization, service and date |
| `QrCredential` / `qr_credentials` | Hashed, expiring, single-use arrival credentials |
| `CustomerRestriction` / `customer_restrictions` | Per-organization joining restrictions |
| `AuditLog` / `audit_logs` | Append-only change history |

Migrations: `20261026102918_init` (initial) and `20261027090000_core_workflows`. The second migration refuses to run on non-empty tables, so it can never silently drop data, and it adds the partial unique index.

---

## 7. Real-time design

Socket.IO shares the cookie session. Rooms are `user:<id>` (private), `org:<id>` (authorized staff) and `service:<id>` (public pings). Events: `queue:updated`, `token:updated`, `token:called`, `arrival:requested`, `arrival:confirmed`. Clients refetch REST state on every (re)connect and after events, so REST is always the source of truth. Full reference: `docs/API_CONTRACT.md` §9.

---

## 8. Out of scope

SMS, email or push notifications (in-app only) · native mobile apps · payments · appointments or time slots · platform administration · multi-language UI · offline mode · carrying waitlists over to the next day.

---

## 9. Resolved decisions

| # | Question | Decision |
|---|---|---|
| OD-1 | `SERVING` tokens at closing time | Left alone; staff complete them |
| OD-2 | `CALLED` tokens at closing time | Keep their grace deadline; the no-show rule applies normally |
| OD-3 | Rejoin after cancelling | Allowed; new number at the back of the line |
| OD-4 | Live average for estimates | Yes: mean of today's last 20 completed services when ≥ 3 exist, else the configured duration |
| OD-5 | Meaning of "pause" | Per service; blocks new joins and call-next; existing tokens continue |
| OD-6 | Several active tokens for one service/day | No (database-enforced). At most 5 active tokens per customer overall |
| OD-7 | QR when the customer app is closed | The QR is fetched on demand when the token page opens. The arrival prompt is re-derived from the API on every (re)connect, so it is never lost |
| OD-8 | Staff invitation pending state | `StaffInvite` with hashed single-use token, 7-day expiry, revocable |
| — | Grace period default | 5 minutes (configurable 1–30), per the no-show policy |
| — | Timezones | Per organization (IANA). Service dates, opening hours and analytics use it |
| — | Staff in several organizations / owners with several organizations | Supported |

# QueueLess — Project Specification

**Version**: 1.0 (Part 1 — Planning Phase)  
**Last updated**: 2026-10-25  
**Status**: Draft — approved by project owner before implementation begins

---

## Table of Contents

1. [What the Application Does](#1-what-the-application-does)
2. [User Roles and Permissions](#2-user-roles-and-permissions)
3. [Feature List by Role](#3-feature-list-by-role)
4. [Business Rules](#4-business-rules)
   - 4.1 [Token Allocation and Uniqueness](#41-token-allocation-and-uniqueness)
   - 4.2 [Queue Position and Estimated Wait Time](#42-queue-position-and-estimated-wait-time)
   - 4.3 [Token Status Transitions](#43-token-status-transitions)
   - 4.4 [Cancellation Rules](#44-cancellation-rules)
   - 4.5 [No-Show Enforcement](#45-no-show-enforcement)
   - 4.6 [Daily Queue Reset](#46-daily-queue-reset)
   - 4.7 [QR Verification Flow](#47-qr-verification-flow)
5. [Authentication and Session Design](#5-authentication-and-session-design)
6. [Data Model Overview](#6-data-model-overview)
7. [Organization-Level Permission Boundaries](#7-organization-level-permission-boundaries)
8. [Out of Scope](#8-out-of-scope)
9. [Open Decisions](#9-open-decisions)

---

## 1. What the Application Does

QueueLess lets people join a physical service queue digitally — from their phone — instead of waiting in line. Organizations (clinics, salons, college offices) register on the platform, configure their services, and manage the daily queue from a staff dashboard. Customers join from anywhere, see their position update in real time, and are notified when it is their turn.

---

## 2. User Roles and Permissions

QueueLess has three roles. A user account belongs to exactly one role.

| Role | Who they are | Scope |
|---|---|---|
| **customer** | Anyone who creates a personal account | Their own tokens and history only |
| **staff** | An employee assigned to an organization by an owner | One specific organization |
| **owner** | The person who created and manages an organization | Their own organization only |

> **Note — Platform Admin role**: A platform-wide administrator role (for approving new organizations, managing the platform itself) is **not part of this implementation**. It is acknowledged but deferred entirely. No admin-only routes, UI, or database fields will be built.

### Permission boundaries

- A **customer** can see publicly listed organizations and their services. They can only read, modify, or cancel their own tokens.
- A **staff** member can only view and act on the queue of the organization they belong to. They cannot access any other organization's data.
- An **owner** can only manage the organization they created. They cannot access another owner's organization.
- No user of any role can read, modify, or delete data belonging to a different organization. The server enforces this on every protected request.

---

## 3. Feature List by Role

### 3.1 Customer

| Feature | Description |
|---|---|
| Register | Create an account with name, email, and password |
| Login / Logout | Authenticate securely |
| Browse organizations | View a list of all active organizations and their services |
| Join a queue | Select an organization and a service, receive a token number for today |
| View token status | See current position, estimated wait time, and token status |
| View QR code | Display a dynamic QR code to present to staff upon arrival |
| Confirm arrival | After staff scans the QR code, tap a confirmation button in the app |
| Cancel token | Cancel their own token while it is still in `waiting` status |
| View history | See past tokens (completed, cancelled, no-show) |

### 3.2 Staff

| Feature | Description |
|---|---|
| Login / Logout | Authenticate as a staff member |
| View waiting queue | See ordered list of all `waiting` tokens for their organization's service |
| Call next customer | Advance the next `waiting` token to `called` status |
| Scan QR code | Scan the customer's QR code to trigger an arrival confirmation request |
| Complete service | Mark a `serving` token as `completed` |
| Mark no-show | Manually mark a `called` token as `no_show` before the grace period expires |
| Pause / Resume queue | Temporarily stop new tokens from being issued (exact behavior: see Open Decisions) |

### 3.3 Owner

| Feature | Description |
|---|---|
| Login / Logout | Authenticate as an owner |
| Create organization | Register a new organization on the platform |
| Edit organization | Update name, description, address, phone |
| Manage services | Create, edit, and deactivate services (name, description, average duration) |
| Manage staff | Invite staff by email, remove staff |
| Configure queue settings | Set daily token limit, queue open/close times, no-show grace period |
| View statistics | See daily token counts, average wait times, no-show rates (future phase) |

---

## 4. Business Rules

This section defines the exact rules that govern how the queue works. These rules must be implemented on the **server side** and cannot be bypassed by the frontend.

---

### 4.1 Token Allocation and Uniqueness

**What is a token?** A token is a numbered spot in a queue for a specific organization, service, and calendar date. Token number 1 is first in line; token number 2 is second, and so on.

**Uniqueness rule**: Within the same `(organization_id, service_id, date)` triple, every token number must be unique. No two customers can ever receive the same number for the same service on the same day.

**Concurrency-safe design**: The server must use the following approach to guarantee uniqueness even if many customers click "Join" simultaneously:

1. The database holds a `daily_counters` table with one row per `(organization_id, service_id, date)`.
2. The row stores `current_count` — the highest token number issued so far.
3. When a customer joins, the server runs a single atomic SQL statement:
   ```sql
   UPDATE daily_counters
   SET current_count = current_count + 1
   WHERE organization_id = $1 AND service_id = $2 AND date = $3
   RETURNING current_count;
   ```
   If no row exists yet, the server first inserts one with `current_count = 0`, then runs the update.
4. The returned value becomes the new token's number.
5. A `UNIQUE` database constraint on `(organization_id, service_id, date, token_number)` in the `queue_entries` table acts as a safety net. If two requests somehow get the same number, the second insert will fail and the server will return an error.

**Daily token limit**: Each organization can configure a maximum number of tokens per service per day (`max_daily_tokens`). The server must refuse new joins once this limit is reached. The default limit is **100 tokens per service per day**. This default is stored in the configuration and can be changed by the owner.

---

### 4.2 Queue Position and Estimated Wait Time

**Queue position**: A customer's position is the count of tokens that are ahead of them in the same `(organization_id, service_id, date)` group and have a status of `waiting` or `called`, with a token number smaller than the customer's own token number.

```
position = COUNT of tokens WHERE:
  - organization_id = same
  - service_id = same
  - date = today
  - token_number < this token's number
  - status IN ('waiting', 'called')
```

A position of `0` means "you are next" (no one with a smaller number is still waiting or being called).

**Estimated wait time (EWT)**: EWT is calculated as:
```
EWT (minutes) = queue_position × service.avg_duration_minutes
```

The `avg_duration_minutes` is the value set by the owner in the service configuration. It is a simple fixed estimate, not a live average, in the initial implementation.

> **Open Decision**: Whether to replace the fixed estimate with a live rolling average of today's actual service durations is deferred to a later phase. This is noted in Section 9.

---

### 4.3 Token Status Transitions

Every token moves through a defined lifecycle. The server must reject any transition not listed here.

```
          ┌──────────────────┐
          │     waiting      │ ← Token is created here
          └────────┬─────────┘
                   │ Staff taps "Call Next"
                   ▼
          ┌──────────────────┐
          │      called      │ ← Customer is notified, grace period starts
          └────────┬─────────┘
                   │ Staff scans QR + Customer confirms arrival
                   ▼
          ┌──────────────────┐
          │     serving      │ ← Service is in progress
          └────────┬─────────┘
                   │ Staff taps "Complete"
                   ▼
          ┌──────────────────┐
          │    completed     │ ← Terminal state
          └──────────────────┘

Additional transitions from waiting or called:
  waiting  ──→  cancelled   (customer cancels; see Section 4.4)
  waiting  ──→  no_show     (no-show deadline passes; see Section 4.5)
  called   ──→  no_show     (grace period expires; see Section 4.5)
  called   ──→  no_show     (staff manually marks no-show)
```

All terminal states (`completed`, `cancelled`, `no_show`) cannot be changed further.

---

### 4.4 Cancellation Rules

- A customer may cancel their own token only while it is in `waiting` status.
- Once a token reaches `called`, `serving`, `completed`, or `no_show`, the customer **cannot cancel it**.
- Cancellation is performed by the customer through the app (DELETE request to the API).
- Staff and owners cannot cancel a customer's token on their behalf in the current implementation.

> **Open Decision**: Whether a customer who cancels can rejoin the same service on the same day is not yet decided. See Section 9.

---

### 4.5 No-Show Enforcement

**What is a no-show?** A customer who was called but did not arrive and confirm within the grace period.

**Grace period**: The number of minutes a customer has to arrive after being called. This is configured per organization (`no_show_grace_period_minutes`). The default is **10 minutes**.

**How the deadline is stored**: When a token is moved to `called` status, the server immediately calculates and stores the deadline in the database:
```
no_show_deadline = called_at + no_show_grace_period_minutes
```
This deadline is stored in the `queue_entries` table as a timestamp. This means it survives server restarts.

**How no-shows are enforced**: The server runs a periodic background job (every 1 minute by default) that queries:
```sql
SELECT * FROM queue_entries
WHERE status = 'called'
  AND no_show_deadline < NOW();
```
Any matching tokens are updated to `no_show` status. This job runs at server startup to catch any deadlines that passed while the server was offline.

**Manual no-show**: Staff can also manually mark a `called` token as `no_show` before the deadline expires (e.g., if the customer explicitly says they are leaving).

**Consequence of no-show**: The customer's token becomes a `no_show` terminal state. The queue automatically moves on. The customer remains able to browse and join queues in the future (no permanent ban in the current implementation).

---

### 4.6 Daily Queue Reset

**What is the queue date?** Every token has a `date` field that stores the calendar date (e.g., `2026-10-25`). Tokens from different days are completely separate. There is no manual "reset" button — the queue naturally starts fresh each new calendar day.

**How the counter resets**: The `daily_counters` table creates a new row for each `(organization_id, service_id, date)`. Yesterday's row is simply never updated again. Tomorrow gets a new row starting from `current_count = 0`.

**Unfinished tokens at queue close**: When the organization's `queue_close_time` passes:
- All tokens in `waiting` status for that day are automatically moved to `cancelled` with cancellation reason `queue_closed`.
- This is performed by the same background job described in Section 4.5 (it checks both no-show deadlines and queue close times).

> **Open Decision**: What happens to a token in `serving` status at queue close time? The server cannot safely interrupt an active service. See Section 9.

> **Open Decision**: What happens to a token in `called` status at queue close time? See Section 9.

**Historical data**: Past tokens (from previous days) are kept in the database permanently. Customers can view them in their history. They are not deleted.

---

### 4.7 QR Verification Flow

The QR code is how the system confirms that a customer physically arrived at the location.

**Key rule**: Staff scanning the QR code alone does **not** confirm arrival. The customer must also tap a confirmation button in their app. Both steps together confirm arrival.

**How the QR code works**:

1. When a customer's token reaches `called` status, the server generates a `qr_secret` — a random, unguessable string (UUID v4).
2. The `qr_secret` is stored in the database alongside an expiry timestamp (`qr_expires_at = called_at + 5 minutes`).
3. A flag `qr_used` is set to `false`.
4. The customer's app displays a QR code that encodes the token ID and the `qr_secret`.
5. Staff scan the QR code using a scanner in the app.
6. The server validates:
   - Does this token ID exist?
   - Does the `qr_secret` match the stored value?
   - Is `qr_expires_at` in the future? (not expired)
   - Is `qr_used` still `false`? (not already scanned)
   - Is the token's status `called`?
7. If all checks pass, the server marks `qr_used = true` (one-time use) and sends a **real-time Socket.IO event** to the customer's browser/app: `"arrival:confirmation_requested"`.
8. The customer sees a prompt: **"Your arrival is being verified. Tap 'I'm Here' to confirm."**
9. The customer taps the button, which sends a confirmation request to the server.
10. The server validates the request (same customer, same token, correct status) and moves the token to `serving` status. A `serving_at` timestamp is recorded.

**Why expiry?** The QR code expires after 5 minutes to prevent a customer from sharing their QR code with someone else.

**Why one-time use?** Once scanned, the `qr_secret` cannot be used again. This prevents replay attacks (saving and re-submitting the same QR code data).

**What if the QR code expires?** The server generates a new `qr_secret` and extends the expiry (implementation detail to be decided in the relevant phase). The customer's app will update automatically via Socket.IO.

---

## 5. Authentication and Session Design

> ⚠️ Authentication will be **implemented in Part 4**, not in the current phase. This section documents the agreed design so implementation follows the correct pattern.

### 5.1 Overview

Authentication uses **two tokens stored in HTTP-only cookies**:

- **Access token** — a signed JWT (JSON Web Token) that proves who you are. Short-lived.
- **Refresh token** — an opaque random string stored in the database. Long-lived. Used only to get a new access token.

Neither token is stored in `localStorage` or accessible to JavaScript running in the browser. This protects against a common attack called XSS (Cross-Site Scripting).

### 5.2 Cookie Settings

Both cookies must be set with these attributes:

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | `true` | JavaScript in the browser cannot read the cookie |
| `Secure` | `true` | Cookie is only sent over HTTPS (set to `false` in local development only) |
| `SameSite` | `Strict` | Cookie is never sent on cross-site requests; prevents CSRF |
| `Path` | `/` | Cookie applies to all routes |

### 5.3 Access Token (JWT)

- **Contents**: `userId`, `role`, `orgId` (null for customers), `iat` (issued at), `exp` (expires at).
- **Expiry**: 15 minutes.
- **Cookie name**: `ql_access` (short for QueueLess access).
- The server validates this token on every protected request.

### 5.4 Refresh Token

- **Contents**: A random 256-bit value (crypto-random, not guessable).
- **Stored in**: The database (in a `refresh_tokens` table with `user_id`, `token_hash`, `expires_at`, `revoked`).
- **Expiry**: 7 days.
- **Cookie name**: `ql_refresh`.
- Only used to call `POST /api/auth/refresh` to get a new access token.

### 5.5 Session Lifecycle

```
1. User submits login form
2. Server checks email + password (bcrypt comparison)
3. Server issues:
   - Access token (15 min JWT) → set as ql_access cookie
   - Refresh token (random) → stored in DB + set as ql_refresh cookie
4. User makes a protected request:
   - Browser automatically sends ql_access cookie
   - Server validates JWT signature and expiry
5. Access token expires after 15 minutes:
   - Frontend detects 401 response
   - Frontend calls POST /api/auth/refresh
   - Server reads ql_refresh cookie, validates against DB
   - Server issues new ql_access cookie
6. User logs out:
   - Frontend calls POST /api/auth/logout
   - Server marks refresh token as revoked in DB
   - Server clears both cookies (sets them to empty + expired)
7. Server restart:
   - Access tokens are validated by JWT signature — no server state needed
   - Refresh tokens are validated against the DB — state is persisted
```

### 5.6 CSRF Protection

Because both cookies use `SameSite: Strict`, the browser will not send them on any cross-site request. This is strong protection against Cross-Site Request Forgery (CSRF). No additional CSRF token pattern is required for the initial implementation. If the API ever needs to support cross-origin requests (e.g., a mobile app), this decision must be revisited.

### 5.7 Token Revocation

- Access tokens cannot be individually revoked before they expire. This is acceptable because they last only 15 minutes.
- Refresh tokens can be revoked immediately by setting the `revoked` flag in the database.
- On logout, the server revokes the refresh token immediately.

---

## 6. Data Model Overview

> The exact Prisma schema will be written in Part 2. This section describes the tables and their purpose in plain language.

### Tables

| Table | Purpose |
|---|---|
| `users` | All user accounts: customers, staff, and owners |
| `organizations` | Businesses/clinics/offices registered on the platform |
| `services` | Services offered by each organization (e.g., "Haircut", "General Consultation") |
| `staff_members` | Links a user (staff role) to an organization |
| `queue_entries` | One row per token issued — the core of the system |
| `daily_counters` | Per-organization, per-service, per-date counter for token number generation |
| `refresh_tokens` | Server-side storage for refresh tokens (for revocation) |
| `queue_settings` | Per-organization configuration (capacity, hours, grace period) |

### Key relationships

- One `organization` has many `services`.
- One `organization` has many `staff_members`.
- One `user` (owner role) owns at most one `organization` (in the initial implementation).
- One `service` has many `queue_entries`.
- One `user` (customer) has many `queue_entries` (their token history).

### Important fields in `queue_entries`

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Unique identifier |
| `organization_id` | UUID (FK) | Which organization |
| `service_id` | UUID (FK) | Which service |
| `user_id` | UUID (FK) | Which customer |
| `token_number` | Integer | Position in queue (1, 2, 3…) |
| `date` | Date | Calendar date (e.g., 2026-10-25) |
| `status` | Enum | `waiting`, `called`, `serving`, `completed`, `cancelled`, `no_show` |
| `qr_secret` | String (nullable) | Random one-time value for QR verification |
| `qr_expires_at` | Timestamp (nullable) | When the QR secret expires |
| `qr_used` | Boolean | Whether the QR has already been scanned |
| `called_at` | Timestamp (nullable) | When staff called this token |
| `no_show_deadline` | Timestamp (nullable) | Deadline for arriving after being called |
| `serving_at` | Timestamp (nullable) | When service started |
| `completed_at` | Timestamp (nullable) | When service finished |
| `cancellation_reason` | String (nullable) | `customer`, `queue_closed` |
| `created_at` | Timestamp | When the token was issued |

---

## 7. Organization-Level Permission Boundaries

Every server route that reads or modifies queue data must enforce these checks in order:

1. **Is the user authenticated?** (valid access token cookie) — if not, return `401 Unauthorized`.
2. **Does the user have the required role?** (e.g., staff or owner) — if not, return `403 Forbidden`.
3. **Does the resource belong to the user's organization?** — if not, return `403 Forbidden`.
4. **Is the requested action allowed for this token's current status?** — if not, return `409 Conflict`.

These checks are implemented as Express middleware functions applied to protected routes. No business logic runs before these checks pass.

---

## 8. Out of Scope

The following features are explicitly **not part of this implementation**:

- SMS or email notifications
- Mobile native apps (iOS/Android)
- Payment processing
- Multi-organization staff membership (one staff = one org)
- Platform admin tools
- Analytics beyond basic daily statistics
- Multi-language / internationalization
- Offline support
- Appointments (time-slot booking) — QueueLess uses live queue numbers only
- Waitlist carry-over from one day to the next

---

## 9. Open Decisions

The following questions need to be answered before the relevant phase is implemented. They are listed here so they are not forgotten and not silently invented.

| # | Question | Impacts | When to decide |
|---|---|---|---|
| OD-1 | What happens to a token in `serving` status when the queue close time passes? | Daily reset logic (Section 4.6) | Before Part 8 |
| OD-2 | What happens to a token in `called` status when the queue close time passes? | Daily reset logic (Section 4.6) | Before Part 8 |
| OD-3 | Can a customer rejoin the same service on the same day after cancelling? | Cancellation rules (Section 4.4) | Before Part 5 |
| OD-4 | Should EWT use a live rolling average of actual durations instead of the fixed configured value? | Queue position display (Section 4.2) | Before Part 5 |
| OD-5 | What exactly does "pause queue" mean for staff? Does it block new joins, stop calling, or both? | Staff features (Section 3.2) | Before Part 6 |
| OD-6 | Can a customer have more than one active token for the same service on the same day? | Token allocation (Section 4.1) | Before Part 5 |
| OD-7 | What happens to the QR code if the customer's token moves to `called` but their app is not open? | QR flow (Section 4.7) | Before Part 6 |

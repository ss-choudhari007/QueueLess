# QueueLess — API Contract

**Version**: 2.0 (implemented)
**Last updated**: 2026-10-27
**Status**: Matches the code in `backend/src/routes/*` and `backend/src/socket.js`. Every endpoint listed here exists and is covered by the automated tests in `backend/tests/` unless noted.

---

## 1. Conventions

| Item | Rule |
|---|---|
| Base URL | Development: `http://localhost:5173/api` (Vite proxies to `http://localhost:4000/api`). Production: `https://<backend-host>/api` |
| Bodies | JSON (`Content-Type: application/json`, max 100 kB) |
| IDs | UUID strings |
| Timestamps | ISO 8601 UTC strings, e.g. `2026-10-27T05:29:40.100Z` |
| Calendar dates | `YYYY-MM-DD` in the **organization's timezone** (`serviceDate`) |
| Token statuses | `WAITING`, `CALLED`, `SERVING`, `COMPLETED`, `CANCELLED`, `NO_SHOW` (upper-case everywhere; the UI converts them to labels) |
| Roles | Account role `CUSTOMER`, `STAFF`, `OWNER`; per-organization staff role `STAFF` or `SUPERVISOR` |

Success responses:

```json
{ "success": true, "data": { "...": "..." } }
```

Error responses:

```json
{ "success": false, "error": { "code": "QUEUE_FULL", "message": "Today’s queue for this service is full.", "details": {} } }
```

`details` is optional. Validation errors include `details.fields`, a map of field path → message.

### 1.1 Status codes

`200` OK · `201` Created · `400` validation · `401` not signed in / session expired · `403` forbidden (role, organization or CSRF) · `404` not found (including IDs that belong to another organization) · `409` state conflict · `410` invitation no longer valid · `413` body too large · `429` rate limited · `500` unexpected · `503` database unavailable.

### 1.2 Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid input (see `details.fields`) |
| `NOT_AUTHENTICATED` | 401 | No valid session |
| `SESSION_EXPIRED` | 401 | Access token expired / session ended — call `/auth/refresh` |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (same response for unknown emails) |
| `FORBIDDEN` | 403 | Role or organization permission missing |
| `CSRF_INVALID` | 403 | Missing or wrong `X-CSRF-Token` header |
| `CUSTOMER_RESTRICTED` | 403 | Customer is restricted at this organization (`details.endsAt`) |
| `NOT_FOUND` | 404 | Resource does not exist or is outside your scope |
| `EMAIL_IN_USE` | 409 | Registration email already used |
| `ALREADY_IN_QUEUE` | 409 | Active token already exists for this service today (`details.tokenId` when known) |
| `TOO_MANY_ACTIVE_TOKENS` | 409 | Customer already holds 5 active tokens |
| `QUEUE_FULL` | 409 | Daily limit reached |
| `QUEUE_CLOSED` | 409 | Outside opening hours |
| `QUEUE_PAUSED` | 409 | Service paused (blocks joining and call-next) |
| `SERVICE_UNAVAILABLE` | 409 | Service or organization inactive |
| `QUEUE_EMPTY` | 409 | Nobody waiting to call |
| `INVALID_STATUS_TRANSITION` | 409 | Action not allowed in the token's current status |
| `ARRIVAL_NOT_REQUESTED` | 409 | Customer tried to confirm before staff scanned the QR |
| `ARRIVAL_NOT_CONFIRMED` | 409 | Staff tried to start service before the customer confirmed |
| `ARRIVAL_ALREADY_CONFIRMED` | 409 | Arrival already confirmed |
| `GRACE_PERIOD_ACTIVE` | 409 | Manual no-show attempted before the deadline (`details.noShowDeadline`) |
| `GRACE_PERIOD_EXPIRED` | 409 | Arrival attempted after the deadline |
| `TOKEN_NOT_CALLED` | 409 | QR scanned for a token that is not `CALLED` |
| `QR_INVALID` / `QR_EXPIRED` / `QR_ALREADY_USED` / `QR_REVOKED` | 409 | QR credential rejected |
| `QR_NOT_AVAILABLE` | 409 | QR requested for a token that is not waiting/called |
| `DUPLICATE_SERVICE` | 409 | Service name already used in the organization |
| `ALREADY_MEMBER` / `EMAIL_NOT_ELIGIBLE` / `ACCOUNT_EXISTS` | 409 | Invitation conflicts |
| `RESTRICTION_NOT_ACTIVE` | 409 | Restriction already lifted/expired |
| `INVITE_INVALID` | 410 | Invitation unknown, expired, revoked or used |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected error (no internals are exposed) |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable (same code, different status from the 409 above) |

---

## 2. Authentication, sessions and CSRF

| Cookie | Content | Lifetime | Flags |
|---|---|---|---|
| `ql_access` | JWT `{ sub, role, sid }` (HS256) | 15 min | HttpOnly, Secure (prod), SameSite (see below), Path=/ |
| `ql_refresh` | 256-bit random token (only its SHA-256 is stored) | 7 days | same |
| `ql_csrf` | random token for double-submit CSRF | 7 days | same |

- `sid` is the id of the session row. **Every authenticated request checks that the session is not revoked or expired**, so logout takes effect immediately even though the JWT has not expired.
- SameSite defaults: `strict` in development (same origin through the Vite proxy) and `none` + `Secure` in production (frontend and backend on different sites). Override with `COOKIE_SAMESITE` / `COOKIE_SECURE`.
- **CSRF**: call `GET /api/auth/csrf` once; send the returned token as `X-CSRF-Token` on every `POST`/`PUT`/`PATCH`/`DELETE`. Mismatch → `403 CSRF_INVALID` (the frontend refetches the token and retries once).
- **Refresh flow**: on any `401`, the frontend calls `POST /api/auth/refresh` once and retries the request; if refresh fails the user is signed out.
- Rate limits (per IP, disabled in tests): auth and invitation endpoints 20 / 15 min; QR issue and QR verify 30 / min; whole API 300 / min.

| Method & path | Auth | Body | Result |
|---|---|---|---|
| `GET /api/auth/csrf` | – | – | `{ csrfToken }` and `ql_csrf` cookie |
| `POST /api/auth/register` | – | `{ name, email, password, accountType: "CUSTOMER" \| "OWNER" }` | `201 { user }` + session cookies. Password: 8–128 chars with a letter and a number. Staff accounts are only created through invitations. |
| `POST /api/auth/login` | – | `{ email, password }` | `{ user }` + session cookies |
| `POST /api/auth/refresh` | refresh cookie | – | `{ user }` + new `ql_access` |
| `POST /api/auth/logout` | refresh cookie | – | Revokes this session, disconnects its sockets, clears cookies |
| `POST /api/auth/logout-all` | session | – | Revokes every session of the user |
| `GET /api/auth/me` | session | – | `{ user }` |

`user` profile shape:

```json
{
  "id": "uuid", "name": "Priya Sharma", "email": "priya@example.com", "role": "CUSTOMER",
  "createdAt": "…",
  "organizations": [{ "id": "uuid", "name": "CityCare Clinic", "slug": "citycare-clinic", "access": "OWNER | STAFF | SUPERVISOR" }]
}
```

---

## 3. Public discovery (no authentication, no personal data)

### `GET /api/orgs`
Query: `search` (name, description, city or service name), `category`, `city`, `openNow=true`, `page` (default 1), `pageSize` (1–50, default 12).

```json
{
  "organizations": [{
    "id": "uuid", "name": "CityCare Clinic", "slug": "citycare-clinic", "category": "Clinic",
    "description": "…", "address": "…", "city": "Pune", "phone": "…", "email": "…",
    "timezone": "Asia/Kolkata", "weeklyHours": [{ "closed": false, "open": "07:00", "close": "22:00" }],
    "isOpenNow": true, "todayHours": { "closed": false, "open": "07:00", "close": "22:00" },
    "services": ["Blood Test", "General Consultation"], "serviceCount": 2, "waitingNow": 5
  }],
  "pagination": { "page": 1, "pageSize": 12, "total": 4, "totalPages": 1 },
  "filters": { "categories": ["Clinic", "…"], "cities": ["Mumbai", "Pune"] }
}
```

### `GET /api/orgs/:idOrSlug`
`{ organization, services: [service + queue] }` where each service has:

```json
{
  "id": "uuid", "name": "General Consultation", "description": "…", "tokenPrefix": "GC",
  "avgDurationMinutes": 10, "isActive": true, "isPaused": false,
  "queue": {
    "serviceDate": "2026-10-27", "waitingCount": 5, "nowServing": ["GC-001"],
    "estimatedWaitMinutes": 50, "estimateBasis": "configured | recent", "averageServiceMinutes": 10,
    "issuedToday": 6, "dailyLimit": 100, "isFull": false, "isPaused": false,
    "canJoin": true, "unavailableCode": null, "unavailableMessage": null
  }
}
```

### `GET /api/services/:serviceId/status`
`{ service, queue }` — same shapes as above.

---

## 4. Customer — `/api/customer` (role `CUSTOMER`)

Every query is scoped to the signed-in customer; another customer's token id returns `404`.

| Method & path | Body | Result / notes |
|---|---|---|
| `POST /tokens` | `{ serviceId }` | `201 { token }`. Errors: `SERVICE_UNAVAILABLE`, `QUEUE_PAUSED`, `QUEUE_CLOSED`, `QUEUE_FULL`, `ALREADY_IN_QUEUE`, `TOO_MANY_ACTIVE_TOKENS`, `CUSTOMER_RESTRICTED` |
| `GET /tokens/active` | – | `{ tokens: [token] }` (WAITING, CALLED, SERVING) |
| `GET /tokens/history` | query `status`, `page`, `pageSize` | `{ tokens, pagination }`, newest first |
| `GET /tokens/:tokenId` | – | `{ token }` |
| `POST /tokens/:tokenId/cancel` | – | `{ token }`. Only from `WAITING`; never counts as a no-show |
| `POST /tokens/:tokenId/qr` | – | `{ qr: { payload, manualCode, expiresAt, ttlSeconds } }`. Issues a fresh credential (WAITING or CALLED, before check-in) |
| `POST /tokens/:tokenId/confirm-arrival` | – | `{ token }`. Requires `CALLED`, a prior successful staff scan, and the grace deadline not passed |
| `GET /restrictions` | – | `{ restrictions: [{ id, organization, endsAt, reason }] }` (active only) |

Customer `token` shape:

```json
{
  "id": "uuid", "displayNumber": "GC-006", "tokenNumber": 6, "status": "CALLED", "serviceDate": "2026-10-27",
  "createdAt": "…", "calledAt": "…", "noShowDeadline": "…", "arrivalRequestedAt": null, "arrivalConfirmedAt": null,
  "servingAt": null, "completedAt": null, "cancelledAt": null, "cancellationReason": null,
  "noShowAt": null, "noShowExcused": false, "canCancel": false,
  "service": { "id": "uuid", "name": "General Consultation", "avgDurationMinutes": 10 },
  "organization": { "id": "uuid", "name": "CityCare Clinic", "slug": "citycare-clinic", "address": "…", "timezone": "Asia/Kolkata" },
  "queue": { "peopleAhead": 0, "estimatedWaitMinutes": 0, "estimateBasis": "configured", "nowServing": ["GC-006"], "isPaused": false }
}
```

`queue` is `null` for finished tokens. `peopleAhead` counts WAITING tokens with a lower number plus tokens currently CALLED/SERVING.

---

## 5. Staff — `/api/staff/orgs/:orgId` (role `STAFF` with a membership, or the `OWNER` of the organization)

Organization access is checked first on every route (`403` otherwise). Token and service ids must belong to `:orgId` (`404` otherwise).

| Method & path | Who | Body | Result / notes |
|---|---|---|---|
| `GET /queue` | staff | query `serviceId` (optional; defaults to the busiest service) | `{ organization, serviceDate, graceMinutes, access, services[], queue }` — `queue` has `service`, `status`, `waiting[]`, `called[]`, `serving[]`, `recent[]` |
| `POST /services/:serviceId/call-next` | staff | – | `{ token }` — lowest WAITING number becomes CALLED; deadline = now + grace. `QUEUE_EMPTY`, `QUEUE_PAUSED` |
| `POST /services/:serviceId/pause` | supervisor/owner | `{ paused: boolean }` | `{ service: { id, isPaused, pausedAt } }` |
| `POST /arrival/verify` | staff | `{ payload }` **or** `{ tokenId, code }` | `{ token }` with `arrivalRequestedAt` set. Does **not** confirm arrival |
| `POST /tokens/:tokenId/start` | staff | – | CALLED → SERVING; requires customer confirmation |
| `POST /tokens/:tokenId/complete` | staff | – | SERVING → COMPLETED |
| `POST /tokens/:tokenId/no-show` | staff | – | CALLED → NO_SHOW, only after the deadline and without confirmation (`GRACE_PERIOD_ACTIVE` otherwise) |
| `POST /tokens/:tokenId/revert-call` | supervisor/owner | `{ reason }` | CALLED → WAITING (called by mistake); audited |
| `POST /tokens/:tokenId/excuse-no-show` | supervisor/owner | `{ reason }` | `{ token, countedNoShows, restrictionsLifted }`; audited |
| `GET /audit` | supervisor/owner | query `limit` (≤ 200) | `{ entries: [{ id, action, entityType, entityId, details, actor, createdAt }] }` |

Staff `token` shape: `id, displayNumber, tokenNumber, status, serviceId, serviceName, customerName, createdAt, calledAt, noShowDeadline, arrivalRequestedAt, arrivalConfirmedAt, servingAt, completedAt, cancelledAt, cancellationReason, noShowAt, noShowExcused`. Staff never receive customer emails.

---

## 6. Owner — `/api/owner` (role `OWNER`; `/orgs/:orgId/*` requires owning that organization)

| Method & path | Body | Result |
|---|---|---|
| `GET /orgs` | – | `{ organizations: [ownerOrg + serviceCount + staffCount] }` |
| `POST /orgs` | `{ name, category, description?, address?, city?, phone?, email?, timezone? }` | `201 { organization }` with default settings |
| `GET /orgs/:orgId` | – | `{ organization }` incl. `settings` |
| `PATCH /orgs/:orgId` | any create field + `isActive` | `{ organization }` |
| `PUT /orgs/:orgId/settings` | `{ maxDailyTokens? (1–1000), noShowGracePeriodMinutes? (1–30), qrTtlSeconds? (30–600), weeklyHours? }` | `{ organization }` |
| `GET /orgs/:orgId/services` | – | `{ services }` incl. inactive |
| `POST /orgs/:orgId/services` | `{ name, description?, tokenPrefix? (1–4 letters), avgDurationMinutes? (1–240), maxDailyTokens? }` | `201 { service }` |
| `PATCH /orgs/:orgId/services/:serviceId` | any of the above + `isActive` | `{ service }` |
| `GET /orgs/:orgId/staff` | – | `{ members: [{ id, role, createdAt, user }], invites: [...] }` |
| `POST /orgs/:orgId/invites` | `{ email, role: "STAFF" \| "SUPERVISOR" }` | `201 { invite, inviteUrl, hasExistingAccount }` — `inviteUrl` is shown once |
| `DELETE /orgs/:orgId/invites/:inviteId` | – | revoke |
| `PATCH /orgs/:orgId/staff/:membershipId` | `{ role }` | `{ membership }` |
| `DELETE /orgs/:orgId/staff/:membershipId` | – | removes access (also removes the user's sockets from the org room) |
| `GET /orgs/:orgId/analytics` | query `from`, `to` (YYYY-MM-DD, ≤ 92 days, default last 7 days), `serviceId` | `{ range, totals, daily[], byService[], hourly[] }` |
| `GET /orgs/:orgId/restrictions` | – | `{ restrictions }` |
| `POST /orgs/:orgId/restrictions/:restrictionId/lift` | `{ reason }` | `{ restriction }` |

`weeklyHours` is an array of exactly 7 entries (index 0 = Sunday): `{ "closed": false, "open": "09:00", "close": "17:00" }`; `close` must be after `open`.

Analytics `totals`: `issued, completed, cancelled, cancelledByCustomer, noShow, noShowExcused, active, averageWaitMinutes (join→call), averageServiceMinutes (start→complete), completionRate, noShowRate` (rates are % of finished tokens; `null` when there is no data).

---

## 7. Staff invitations — `/api/invites`

The invite link is `https://<frontend>/invite#<token>`. The token sits in the URL fragment (never sent to servers) and is posted in request bodies.

| Method & path | Auth | Body | Result |
|---|---|---|---|
| `POST /lookup` | – | `{ token }` | `{ invite: { organization, email, role, expiresAt, hasAccount } }` or `410` |
| `POST /accept-new` | – | `{ token, name, password }` | `201 { user }` — creates a STAFF account for the invited email and signs in |
| `POST /accept` | session (STAFF with the invited email) | `{ token }` | `{ organization, role, user }` |

---

## 8. Health

`GET /api/health` → `200 { status: "ok", server: "running", database: "connected", environment, timestamp }` or `503` with `database: "unreachable"`.

---

## 9. Socket.IO

Connect to the API origin with `withCredentials: true`. The handshake reads the same `ql_access` cookie. Connections from origins not in `FRONTEND_URL` are refused.

- No cookie → anonymous socket (may only watch public service rooms).
- Expired access token → `connect_error` with message `SESSION_EXPIRED` (refresh, then reconnect).
- Revoked/invalid session → `connect_error` `NOT_AUTHENTICATED`.
- On connect the server emits `session` `{ authenticated, userId }`.

**Events are hints. After every (re)connect, clients refetch state from the REST API**; a missed event never leaves the UI wrong.

### Rooms

| Room | Joined by | Receives |
|---|---|---|
| `user:<userId>` | automatically, for authenticated sockets | private events for that account only |
| `org:<orgId>` | `org:join` — server checks owner/membership | staff queue events |
| `service:<serviceId>` | `service:watch` — any active public service | anonymous change pings (no personal data) |

### Client → server (all accept an acknowledgement callback)

| Event | Payload | Ack |
|---|---|---|
| `org:join` | `{ orgId }` | `{ ok: true }` or `{ ok: false, error: "NOT_AUTHENTICATED" \| "FORBIDDEN" \| "NOT_FOUND" }` |
| `org:leave` | `{ orgId }` | `{ ok: true }` |
| `service:watch` | `{ serviceId }` | `{ ok: true }` or `{ ok: false, error: "NOT_FOUND" }` |
| `service:unwatch` | `{ serviceId }` | `{ ok: true }` |

### Server → client

| Event | Room | Payload |
|---|---|---|
| `queue:updated` | `org:<orgId>` | `{ orgId, serviceId, reason, tokenId, status, at }` |
| `queue:updated` | `service:<serviceId>` | `{ serviceId, reason, at }` |
| `token:updated` | `user:<userId>` | `{ token }` (customer token shape) |
| `token:called` | `user:<userId>` | `{ tokenId, displayNumber, serviceName, organizationName, noShowDeadline }` |
| `arrival:requested` | `user:<userId>` | `{ tokenId, serviceName, requestedAt, deadline }` — show the “I’m here” prompt |
| `arrival:confirmed` | `org:<orgId>` | `{ tokenId, serviceId, displayNumber, confirmedAt }` |

`reason` values: `joined`, `called`, `arrival_requested`, `arrival_confirmed`, `serving`, `completed`, `cancelled`, `no_show`, `waiting` (call reverted), `corrected`, `paused`, `resumed`, `queue_closed`, `service_updated`.

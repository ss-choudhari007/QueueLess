# QueueLess — API Contract

**Version**: 1.0 (Part 1 — Planning Phase)  
**Last updated**: 2026-10-25  
**Status**: Draft — endpoints are defined but not yet implemented

> This document describes every way the frontend and backend communicate.
> If this document and the code ever disagree, this document is the source of truth
> and the code must be updated.

---

## Table of Contents

1. [General Conventions](#1-general-conventions)
2. [Authentication Scheme](#2-authentication-scheme)
3. [Error Format](#3-error-format)
4. [REST API Endpoints](#4-rest-api-endpoints)
   - 4.1 [Authentication](#41-authentication)
   - 4.2 [Organizations](#42-organizations)
   - 4.3 [Services](#43-services)
   - 4.4 [Queue (Customer)](#44-queue-customer)
   - 4.5 [Staff Queue Management](#45-staff-queue-management)
   - 4.6 [Owner Management](#46-owner-management)
5. [Socket.IO Events](#5-socketio-events)
6. [Data Type Reference](#6-data-type-reference)

---

## 1. General Conventions

### Base URL

- **Development**: `http://localhost:4000/api`
- **Production**: `https://<your-backend-domain>/api` (to be set in Part 9)

All REST endpoints are prefixed with `/api`.

### Request Format

- All request bodies are sent as **JSON**: `Content-Type: application/json`
- Dates are always **ISO 8601 strings** in UTC: `"2026-10-25T14:30:00.000Z"`
- Calendar dates (no time) are **YYYY-MM-DD strings**: `"2026-10-25"`
- All IDs are **UUID strings**: `"a1b2c3d4-e5f6-..."`

### Response Format

All responses return JSON. Successful responses have this shape:

```json
{
  "success": true,
  "data": { ... }
}
```

Failed responses use the [Error Format](#3-error-format) described in Section 3.

### HTTP Status Codes Used

| Code | Meaning |
|---|---|
| `200` | Success (read/update operation) |
| `201` | Created (new resource created) |
| `400` | Bad Request (missing or invalid input) |
| `401` | Unauthorized (not logged in or session expired) |
| `403` | Forbidden (logged in but not allowed to do this) |
| `404` | Not Found (resource does not exist) |
| `409` | Conflict (action not allowed in current state, e.g., wrong status) |
| `429` | Too Many Requests (rate limit hit) |
| `500` | Internal Server Error (unexpected server failure) |

---

## 2. Authentication Scheme

> Full implementation details are in `PROJECT_SPEC.md` Section 5.

Authentication uses **two HTTP-only cookies** that the browser sends automatically on every request. The frontend does not need to attach any header manually.

| Cookie | Contents | Expiry | Purpose |
|---|---|---|---|
| `ql_access` | Signed JWT | 15 minutes | Proves who you are on every request |
| `ql_refresh` | Random string | 7 days | Used only to get a new access token |

**Cookies are set/cleared by the server** — the frontend never reads or writes them directly.

### Protected routes

Routes marked with 🔒 require a valid `ql_access` cookie.  
Routes marked with 🔒👤 require authentication AND a specific role.  
Public routes have no marker.

### Access token expiry flow

When the server returns `401` on a protected request:
1. The frontend calls `POST /api/auth/refresh` (which uses the `ql_refresh` cookie).
2. If refresh succeeds, the server issues a new `ql_access` cookie.
3. The frontend retries the original request.
4. If refresh also returns `401` (refresh token expired/revoked), the frontend redirects to `/login`.

---

## 3. Error Format

All error responses follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation of what went wrong."
  }
}
```

### Error Codes Reference

| Code | HTTP Status | When it appears |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing or invalid fields in the request body |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `SESSION_EXPIRED` | 401 | Access token has expired |
| `NOT_AUTHENTICATED` | 401 | No valid access token cookie present |
| `FORBIDDEN` | 403 | Authenticated but not allowed to perform this action |
| `NOT_FOUND` | 404 | The requested resource does not exist |
| `QUEUE_FULL` | 409 | Daily token limit reached for this service |
| `INVALID_STATUS_TRANSITION` | 409 | Action not allowed in the token's current status |
| `QR_EXPIRED` | 409 | The QR secret has expired |
| `QR_ALREADY_USED` | 409 | The QR code was already scanned |
| `ALREADY_IN_QUEUE` | 409 | Customer already has an active token for this service today |
| `RATE_LIMITED` | 429 | Too many requests from this IP |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 4. REST API Endpoints

---

### 4.1 Authentication

#### `POST /api/auth/register`
Create a new customer account.

**Auth**: Public

**Request body**:
```json
{
  "name": "Priya Sharma",
  "email": "priya@example.com",
  "password": "SecurePass123!"
}
```

**Password rules**: Minimum 8 characters. Exact complexity rules to be defined in Part 4.

**Success `201`**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "role": "customer"
    }
  }
}
```
Sets `ql_access` and `ql_refresh` cookies. User is immediately logged in after registration.

**Errors**: `VALIDATION_ERROR` (missing fields, invalid email, weak password), `409` if email already registered.

---

#### `POST /api/auth/login`
Log in with email and password.

**Auth**: Public

**Request body**:
```json
{
  "email": "priya@example.com",
  "password": "SecurePass123!"
}
```

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "role": "customer",
      "orgId": null
    }
  }
}
```
Sets `ql_access` and `ql_refresh` cookies.  
`orgId` is `null` for customers. For staff and owners it contains their organization's UUID.

**Errors**: `INVALID_CREDENTIALS`

---

#### `POST /api/auth/logout`
🔒 Log out the current user.

**Auth**: Authenticated (any role)

**Request body**: None

**Success `200`**:
```json
{
  "success": true,
  "data": { "message": "Logged out successfully." }
}
```
Clears `ql_access` and `ql_refresh` cookies. Revokes the refresh token in the database.

---

#### `POST /api/auth/refresh`
Exchange a valid refresh token for a new access token.

**Auth**: Public (uses `ql_refresh` cookie — does not need `ql_access`)

**Request body**: None

**Success `200`**:
```json
{
  "success": true,
  "data": { "message": "Token refreshed." }
}
```
Sets a new `ql_access` cookie. The `ql_refresh` cookie is not changed.

**Errors**: `SESSION_EXPIRED` if refresh token is expired or revoked, `NOT_AUTHENTICATED` if no refresh cookie.

---

#### `GET /api/auth/me`
🔒 Get the currently logged-in user's profile.

**Auth**: Any authenticated role

**Request body**: None

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "role": "customer",
      "orgId": null
    }
  }
}
```

---

### 4.2 Organizations

#### `GET /api/orgs`
List all active organizations. Used by customers on the browse page.

**Auth**: Public

**Query parameters**: None in the initial implementation. Filtering/search may be added later.

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "organizations": [
      {
        "id": "uuid",
        "name": "City Dental Clinic",
        "description": "General dental care",
        "address": "12 MG Road, Pune",
        "phone": "+91-9876543210"
      }
    ]
  }
}
```

---

#### `GET /api/orgs/:orgId`
Get a single organization and its active services.

**Auth**: Public

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "uuid",
      "name": "City Dental Clinic",
      "description": "General dental care",
      "address": "12 MG Road, Pune",
      "phone": "+91-9876543210"
    },
    "services": [
      {
        "id": "uuid",
        "name": "General Checkup",
        "description": "15-minute dental checkup",
        "avgDurationMinutes": 15
      }
    ]
  }
}
```

**Errors**: `NOT_FOUND`

---

#### `POST /api/orgs`
🔒👤 (owner) Create a new organization.

**Auth**: `owner` role

**Request body**:
```json
{
  "name": "City Dental Clinic",
  "description": "General dental care",
  "address": "12 MG Road, Pune",
  "phone": "+91-9876543210"
}
```

**Success `201`**:
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "uuid",
      "name": "City Dental Clinic"
    }
  }
}
```

> **Note**: An owner can only own one organization in the initial implementation. If they already have one, this returns `403`.

---

#### `PUT /api/orgs/:orgId`
🔒👤 (owner) Update organization details.

**Auth**: `owner` role. Must be the owner of this specific organization.

**Request body** (all fields optional — only include what you want to change):
```json
{
  "name": "Updated Clinic Name",
  "description": "New description",
  "address": "New address",
  "phone": "+91-9999999999"
}
```

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "organization": { "id": "uuid", "name": "Updated Clinic Name" }
  }
}
```

**Errors**: `NOT_FOUND`, `FORBIDDEN`

---

### 4.3 Services

#### `POST /api/orgs/:orgId/services`
🔒👤 (owner) Create a new service for the organization.

**Auth**: `owner` role. Must own this organization.

**Request body**:
```json
{
  "name": "General Checkup",
  "description": "15-minute dental checkup",
  "avgDurationMinutes": 15
}
```

**Success `201`**:
```json
{
  "success": true,
  "data": {
    "service": {
      "id": "uuid",
      "name": "General Checkup",
      "avgDurationMinutes": 15,
      "isActive": true
    }
  }
}
```

---

#### `PUT /api/orgs/:orgId/services/:serviceId`
🔒👤 (owner) Update a service.

**Auth**: `owner` role. Must own this organization.

**Request body** (all optional):
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "avgDurationMinutes": 20,
  "isActive": false
}
```

Setting `isActive: false` deactivates the service. Customers can no longer join a deactivated service.

**Success `200`**: Returns updated service object.

---

### 4.4 Queue (Customer)

#### `POST /api/queue/join`
🔒👤 (customer) Join a queue for a service today.

**Auth**: `customer` role

**Request body**:
```json
{
  "serviceId": "uuid"
}
```

The `date` is always today's date on the server. The customer does not provide it.

**Success `201`**:
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid",
      "tokenNumber": 7,
      "status": "waiting",
      "date": "2026-10-25",
      "queuePosition": 6,
      "estimatedWaitMinutes": 90,
      "service": {
        "id": "uuid",
        "name": "General Checkup"
      },
      "organization": {
        "id": "uuid",
        "name": "City Dental Clinic"
      }
    }
  }
}
```

**Errors**:
- `QUEUE_FULL` — daily token limit reached
- `ALREADY_IN_QUEUE` — customer already has an active token for this service today (see Open Decision OD-6 in PROJECT_SPEC.md)
- `NOT_FOUND` — service does not exist or is inactive
- `VALIDATION_ERROR` — missing serviceId

---

#### `GET /api/queue/my-tokens`
🔒👤 (customer) Get all of today's active tokens for the logged-in customer.

**Auth**: `customer` role

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "id": "uuid",
        "tokenNumber": 7,
        "status": "waiting",
        "queuePosition": 3,
        "estimatedWaitMinutes": 45,
        "service": { "id": "uuid", "name": "General Checkup" },
        "organization": { "id": "uuid", "name": "City Dental Clinic" }
      }
    ]
  }
}
```

---

#### `GET /api/queue/tokens/:tokenId`
🔒👤 (customer) Get full details for a single token, including QR data if `called`.

**Auth**: `customer` role. Must be the owner of this token.

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid",
      "tokenNumber": 7,
      "status": "called",
      "queuePosition": 0,
      "estimatedWaitMinutes": 0,
      "qrPayload": "eyJ0b2tlbklkIjoiLi4uIiwicXJTZWNyZXQiOiIuLi4ifQ==",
      "qrExpiresAt": "2026-10-25T10:35:00.000Z",
      "calledAt": "2026-10-25T10:30:00.000Z",
      "service": { "id": "uuid", "name": "General Checkup" },
      "organization": { "id": "uuid", "name": "City Dental Clinic" }
    }
  }
}
```

`qrPayload` is a base64-encoded JSON string containing `{ tokenId, qrSecret }`. It is only present when `status = "called"`. The frontend renders this as a QR code image.

**Errors**: `NOT_FOUND`, `FORBIDDEN`

---

#### `DELETE /api/queue/tokens/:tokenId`
🔒👤 (customer) Cancel a token.

**Auth**: `customer` role. Must own this token.

**Request body**: None

**Success `200`**:
```json
{
  "success": true,
  "data": { "message": "Token cancelled successfully." }
}
```

**Errors**:
- `NOT_FOUND`
- `FORBIDDEN`
- `INVALID_STATUS_TRANSITION` — token is not in `waiting` status

---

#### `GET /api/queue/history`
🔒👤 (customer) Get the customer's token history (all dates, all statuses).

**Auth**: `customer` role

**Query parameters**:
- `page` (optional, default `1`)
- `limit` (optional, default `20`, max `100`)

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "id": "uuid",
        "tokenNumber": 7,
        "date": "2026-10-25",
        "status": "completed",
        "service": { "name": "General Checkup" },
        "organization": { "name": "City Dental Clinic" }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42
    }
  }
}
```

---

#### `POST /api/queue/tokens/:tokenId/confirm-arrival`
🔒👤 (customer) Confirm arrival after staff scans the QR code.

**Auth**: `customer` role. Must own this token.

**Request body**: None

This endpoint is called when the customer taps the "I'm Here" button after receiving the `arrival:confirmation_requested` Socket.IO event.

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid",
      "status": "serving",
      "servingAt": "2026-10-25T10:32:00.000Z"
    }
  }
}
```

**Errors**:
- `INVALID_STATUS_TRANSITION` — token is not in `called` status, or QR was not yet scanned
- `NOT_FOUND`, `FORBIDDEN`

---

### 4.5 Staff Queue Management

All staff endpoints require the user to have the `staff` role and belong to the relevant organization.

#### `GET /api/staff/queue`
🔒👤 (staff) Get the current waiting queue for the staff member's organization.

**Auth**: `staff` role

**Query parameters**:
- `serviceId` (optional) — filter by a specific service

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "queue": [
      {
        "id": "uuid",
        "tokenNumber": 5,
        "status": "waiting",
        "customerName": "Priya Sharma",
        "service": { "id": "uuid", "name": "General Checkup" },
        "createdAt": "2026-10-25T09:00:00.000Z"
      }
    ],
    "date": "2026-10-25",
    "totalWaiting": 3,
    "totalCalled": 1
  }
}
```

---

#### `POST /api/staff/next`
🔒👤 (staff) Call the next customer in line.

**Auth**: `staff` role

**Request body**:
```json
{
  "serviceId": "uuid"
}
```

Moves the `waiting` token with the smallest `token_number` for this service to `called` status. Generates a `qr_secret`, sets `qr_expires_at`, sets `called_at`, and sets `no_show_deadline`.

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid",
      "tokenNumber": 5,
      "status": "called",
      "calledAt": "2026-10-25T10:30:00.000Z",
      "noShowDeadline": "2026-10-25T10:40:00.000Z",
      "customerName": "Priya Sharma"
    }
  }
}
```

Also emits Socket.IO event `queue:token_called` (see Section 5).

**Errors**: `NOT_FOUND` if no waiting tokens exist for this service.

---

#### `POST /api/staff/scan`
🔒👤 (staff) Validate a customer's QR code.

**Auth**: `staff` role

**Request body**:
```json
{
  "tokenId": "uuid",
  "qrSecret": "the-secret-from-the-qr-code"
}
```

The staff app decodes the QR code image and sends the extracted `tokenId` and `qrSecret`.

**Success `200`**:
```json
{
  "success": true,
  "data": { "message": "QR validated. Awaiting customer confirmation." }
}
```

Also emits Socket.IO event `arrival:confirmation_requested` to the customer (see Section 5).  
Marks `qr_used = true` in the database.

**Errors**:
- `NOT_FOUND` — token does not exist or does not belong to staff's organization
- `QR_EXPIRED`
- `QR_ALREADY_USED`
- `INVALID_STATUS_TRANSITION` — token is not in `called` status

---

#### `POST /api/staff/complete`
🔒👤 (staff) Mark a token as completed.

**Auth**: `staff` role

**Request body**:
```json
{
  "tokenId": "uuid"
}
```

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid",
      "status": "completed",
      "completedAt": "2026-10-25T10:45:00.000Z"
    }
  }
}
```

**Errors**: `INVALID_STATUS_TRANSITION` — token is not in `serving` status.

---

#### `POST /api/staff/no-show`
🔒👤 (staff) Manually mark a called token as no-show.

**Auth**: `staff` role

**Request body**:
```json
{
  "tokenId": "uuid"
}
```

**Success `200`**:
```json
{
  "success": true,
  "data": {
    "token": {
      "id": "uuid",
      "status": "no_show"
    }
  }
}
```

**Errors**: `INVALID_STATUS_TRANSITION` — token is not in `called` status.

---

### 4.6 Owner Management

#### `GET /api/owner/org`
🔒👤 (owner) Get the owner's organization details and settings.

**Auth**: `owner` role

**Success `200`**: Returns organization details plus `queueSettings`.

---

#### `PUT /api/owner/settings`
🔒👤 (owner) Update queue settings for the organization.

**Auth**: `owner` role

**Request body** (all optional — only include what you want to change):
```json
{
  "maxDailyTokens": 150,
  "noShowGracePeriodMinutes": 10,
  "queueOpenTime": "09:00",
  "queueCloseTime": "18:00"
}
```

Time values are 24-hour `HH:MM` strings. The server interprets them in the organization's local timezone. *(Timezone support is an open decision — see note below.)*

> **Note**: Organization timezone handling is not fully designed yet. For the initial implementation, all times are assumed to be in IST (UTC+5:30). This will be revisited before Part 8.

**Success `200`**: Returns updated settings.

---

#### `POST /api/owner/staff`
🔒👤 (owner) Invite a user to become staff for this organization.

**Auth**: `owner` role

**Request body**:
```json
{
  "email": "staff@example.com"
}
```

The user must already have an account. Their role is changed to `staff` and they are linked to this organization.

> **Note**: The exact flow (email invitation vs. direct assignment) is not decided yet. For the initial implementation, the user must already exist and is directly assigned. Email invitation is deferred.

**Success `200`**:
```json
{
  "success": true,
  "data": { "message": "Staff member added." }
}
```

**Errors**: `NOT_FOUND` (email not registered), `409` (already staff somewhere).

---

#### `DELETE /api/owner/staff/:userId`
🔒👤 (owner) Remove a staff member from the organization.

**Auth**: `owner` role

**Success `200`**: Confirms removal.

---

## 5. Socket.IO Events

Socket.IO provides real-time updates — like a live notification system. When something changes on the server (a token is called, a QR is scanned), the server immediately pushes an update to all relevant connected clients without them needing to refresh the page.

### Connection and Authentication

The frontend connects to the Socket.IO server at the same URL as the backend (e.g., `http://localhost:4000`).

Authentication is handled by sending the access token cookie automatically (since it is an HTTP-only cookie, the browser includes it in the connection handshake). The server validates the cookie on connection; unauthorized connections are rejected.

### Rooms

Clients are placed into **rooms** (named groups) so updates only go to relevant clients:

| Room name | Who joins | What they receive |
|---|---|---|
| `token:<tokenId>` | The customer who owns the token | Updates about their specific token |
| `org:<orgId>` | All staff of this organization | Queue-wide updates |

### Events Reference

#### Server → Customer (emitted by server, received by frontend)

---

**`queue:position_updated`**
Sent to `token:<tokenId>` room when the queue position changes (e.g., the token ahead was completed).

```json
{
  "tokenId": "uuid",
  "queuePosition": 2,
  "estimatedWaitMinutes": 30
}
```

---

**`queue:token_called`**
Sent to `token:<tokenId>` room when the token's status changes to `called`.

```json
{
  "tokenId": "uuid",
  "tokenNumber": 5,
  "qrPayload": "base64-encoded-string",
  "qrExpiresAt": "2026-10-25T10:35:00.000Z",
  "noShowDeadline": "2026-10-25T10:40:00.000Z"
}
```

The frontend should display the QR code immediately and start a countdown timer.

---

**`arrival:confirmation_requested`**
Sent to `token:<tokenId>` room after staff scans the QR code successfully.

```json
{
  "tokenId": "uuid"
}
```

The frontend shows a prompt: "Your arrival is being verified. Tap 'I'm Here' to confirm."

---

**`queue:token_status_changed`**
Sent to `token:<tokenId>` room whenever the token status changes.

```json
{
  "tokenId": "uuid",
  "newStatus": "serving",
  "timestamp": "2026-10-25T10:32:00.000Z"
}
```

---

**`queue:qr_expired`**
Sent to `token:<tokenId>` room if the QR code expires before being scanned.

```json
{
  "tokenId": "uuid",
  "newQrPayload": "updated-base64-string",
  "newQrExpiresAt": "2026-10-25T10:40:00.000Z"
}
```

The frontend should update the displayed QR code.

---

#### Server → Staff (emitted by server, received by staff frontend)

---

**`queue:updated`**
Sent to `org:<orgId>` room whenever the queue changes (new join, status change, no-show).

```json
{
  "orgId": "uuid",
  "changeType": "new_join | status_change | no_show | cancelled",
  "tokenId": "uuid"
}
```

The staff frontend should refetch the queue list (`GET /api/staff/queue`) when this event is received.

---

#### Client → Server (sent by frontend, handled by server)

---

**`client:join_token_room`**
The customer's frontend sends this after connecting, to subscribe to their token's updates.

```json
{
  "tokenId": "uuid"
}
```

---

**`client:join_org_room`**
The staff frontend sends this after connecting, to subscribe to their organization's updates.

```json
{
  "orgId": "uuid"
}
```

---

## 6. Data Type Reference

These are the TypeScript-style types for reference. (The project uses JavaScript, but these types describe the exact shape of API responses.)

```
TokenStatus = "waiting" | "called" | "serving" | "completed" | "cancelled" | "no_show"

UserRole = "customer" | "staff" | "owner"

Token = {
  id: string (UUID)
  tokenNumber: number
  status: TokenStatus
  date: string (YYYY-MM-DD)
  queuePosition: number
  estimatedWaitMinutes: number
  qrPayload?: string (only when status = "called")
  qrExpiresAt?: string (ISO 8601, only when status = "called")
  calledAt?: string (ISO 8601)
  noShowDeadline?: string (ISO 8601)
  servingAt?: string (ISO 8601)
  completedAt?: string (ISO 8601)
  service: { id: string, name: string }
  organization: { id: string, name: string }
}

User = {
  id: string (UUID)
  name: string
  email: string
  role: UserRole
  orgId: string | null
}
```

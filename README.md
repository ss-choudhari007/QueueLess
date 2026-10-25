# QueueLess

**A digital queue management system for clinics, salons, and college offices.**

Customers join an organization's queue from their phone, receive a numbered token, track their position in real time, and get notified when it is their turn. Staff manage the queue from a dashboard. Organization owners configure their services and settings.

---

## Project Status

> **Phase**: Part 1 — Documentation and Architecture Planning  
> **No code has been written yet.** Setup instructions below will be filled in as each phase is completed.

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS + JavaScript | User interface in the browser |
| Backend | Node.js + Express + JavaScript | Server, business logic, API |
| Database | PostgreSQL hosted on Neon | Persistent data storage |
| ORM | Prisma | Safe, readable database access from Node.js |
| Real-time | Socket.IO | Instant queue updates without page refresh |
| Auth | HTTP-only cookies + JWT | Secure, browser-safe authentication |

---

## Repository Structure

```
QueueLess/
├── README.md               ← You are here
├── .gitignore              ← Files Git will never track (secrets, build output)
├── docs/
│   ├── PROJECT_SPEC.md     ← What the application must do (rules + roles)
│   ├── API_CONTRACT.md     ← How the frontend and backend communicate
│   └── HANDOFF.md          ← Progress log, decisions, and next step
├── frontend/               ← React application (set up in Part 2)
└── backend/                ← Node.js + Express server (set up in Part 2)
```

---

## Prerequisites

> These tools must be installed on your computer before you can run the project.
> Installation instructions will be linked here when setup begins.

- [ ] Node.js v20 or later (`node --version` to check)
- [ ] npm v10 or later (`npm --version` to check)
- [ ] Git (`git --version` to check)
- [ ] A Neon account (free tier) for the PostgreSQL database

---

## Setup Instructions

> ⚠️ This section will be filled in during Part 2 (Backend Setup) and Part 3 (Frontend Setup).

### 1. Clone the repository

```bash
git clone <repository-url>
cd Queueless
```

### 2. Set up the backend

```bash
# Instructions coming in Part 2
```

### 3. Set up the frontend

```bash
# Instructions coming in Part 3
```

### 4. Environment variables

You will be given a file called `.env.example` in the `backend/` folder.
Copy it and fill in your own values:

```bash
cp backend/.env.example backend/.env
# Then open backend/.env and fill in your Neon database URL and other secrets
```

> ⚠️ **Never share or commit the `.env` file.** It is listed in `.gitignore` and will not be tracked by Git.

---

## Running the Application Locally

> ⚠️ Instructions coming in Parts 2 and 3.

```bash
# Start the backend server
cd backend
npm run dev

# In a separate terminal window, start the frontend
cd frontend
npm run dev
```

---

## Documentation

All planning documents live in the `docs/` folder:

- [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) — Full specification: roles, rules, data model
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — Every API endpoint and Socket.IO event
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — Current progress, decisions made, next step

---

## Security Notes

- Authentication tokens are stored in **HTTP-only cookies** — they cannot be read by JavaScript in the browser, which protects against common attacks.
- **Never store secrets** (database passwords, API keys, JWT secret) in the frontend code or in any file that gets committed to Git.
- The `.gitignore` file already excludes `.env` files. Double-check with `git status` before every commit.

---

## Contributing / Working on This Project

This is a step-by-step educational project. Work is organized in phases:

| Phase | Description | Status |
|---|---|---|
| Part 1 | Architecture, documentation, Git setup | ✅ Complete |
| Part 2 | Backend scaffold, database schema, Prisma | 🔜 Next |
| Part 3 | Frontend scaffold, routing, Tailwind setup | — |
| Part 4 | Authentication (register, login, logout) | — |
| Part 5 | Queue join, token, and real-time updates | — |
| Part 6 | Staff dashboard and QR verification flow | — |
| Part 7 | Owner dashboard and settings | — |
| Part 8 | No-show enforcement and daily reset | — |
| Part 9 | Testing, hardening, and deployment | — |

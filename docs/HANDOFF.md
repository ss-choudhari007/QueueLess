# QueueLess — Handoff Document

**Version**: 1.0  
**Last updated**: 2026-10-25  
**Current phase**: Part 1 — Architecture Planning and Documentation ✅ COMPLETE

> This document is always kept up to date. If you come back to this project after any break,
> read this file first. It tells you exactly where things stand and what to do next.

---

## 1. Current Status

| Item | Status |
|---|---|
| Git repository | ✅ Initialized |
| `.gitignore` | ✅ Created and verified |
| `README.md` | ✅ Created and verified |
| `docs/PROJECT_SPEC.md` | ✅ Created and verified |
| `docs/API_CONTRACT.md` | ✅ Created and verified |
| `docs/HANDOFF.md` | ✅ Created and verified |
| Initial Git commit | ✅ Created (see Section 4) |
| Frontend code | ❌ Not started — planned for Part 3 |
| Backend code | ❌ Not started — planned for Part 2 |
| Database schema | ❌ Not started — planned for Part 2 |
| Dependencies installed | ❌ None installed yet |
| Neon / database connected | ❌ Not configured yet |
| Authentication implemented | ❌ Planned for Part 4 |
| Deployment | ❌ Planned for Part 9 |

---

## 2. What Was Completed in Part 1

### Actions taken

1. Inspected the workspace — confirmed it was completely empty with no Git history.
2. Ran `git init` to initialize a Git repository.
3. Created `.gitignore` to prevent secrets, `node_modules`, and build output from being committed.
4. Created `README.md` with project overview, tech stack, and a phase tracker.
5. Created `docs/PROJECT_SPEC.md` — the full specification including all business rules.
6. Created `docs/API_CONTRACT.md` — every API endpoint and Socket.IO event.
7. Created `docs/HANDOFF.md` — this file.
8. Inspected Git status and staged files before committing.
9. Created the initial Git commit with only the agreed files.

### Verified

All five files were confirmed to exist and are non-empty (verified with `ls -lh` and `wc -l`).  
The `.env` file is not tracked by Git (confirmed via `.gitignore`).  
`node_modules/` is not tracked by Git (confirmed via `.gitignore`).

---

## 3. Approved Decisions (recorded for future reference)

These decisions were approved by the project owner before any files were created.

| # | Decision | Details |
|---|---|---|
| D-1 | Folder names | `frontend/` and `backend/` (not `client/` and `server/`) |
| D-2 | Language | English for all code comments and documentation |
| D-3 | Version control | Git initialized; `.gitignore` excludes `.env`, `node_modules`, `dist`, secrets |
| D-4 | Platform admin | No platform-admin role in the initial implementation |
| D-5 | Authentication | HTTP-only cookies (JWT access token 15 min + random refresh token 7 days). No `localStorage`. See PROJECT_SPEC.md Section 5 |
| D-6 | Token uniqueness | Concurrency-safe via atomic `UPDATE daily_counters SET count = count + 1 RETURNING count` + unique DB constraint. See PROJECT_SPEC.md Section 4.1 |
| D-7 | QR verification | Short-lived (5 min), single-use `qr_secret` in DB. Staff scan does NOT confirm arrival — customer must confirm in-app. See PROJECT_SPEC.md Section 4.7 |
| D-8 | No-show enforcement | Deadlines persisted in DB (`no_show_deadline` column). Background job runs on startup + every 1 minute. No in-memory-only timers. See PROJECT_SPEC.md Section 4.5 |
| D-9 | Daily reset | Tokens filtered by `date` column (YYYY-MM-DD). Counter starts fresh per date. `waiting` tokens auto-cancelled at queue close. See PROJECT_SPEC.md Section 4.6 |
| D-10 | Estimated wait time | `queue_position × service.avg_duration_minutes` using fixed configured value (not live average) in the initial implementation |
| D-11 | Technology | React + Vite + Tailwind CSS + JavaScript (frontend); Node.js + Express + JavaScript (backend); PostgreSQL on Neon; Prisma ORM; Socket.IO |
| D-12 | No TypeScript | JavaScript only unless explicitly approved by the project owner |

---

## 4. Git History

### Initial commit

```
commit: Part 1 — Project specification, API contract, and documentation
files:  .gitignore, README.md, docs/PROJECT_SPEC.md, docs/API_CONTRACT.md, docs/HANDOFF.md
```

### Before every future commit

Run these commands and check the output carefully before committing:

```bash
# 1. See what files have changed
git status

# 2. See the exact lines that changed (optional but recommended)
git diff

# 3. Confirm no .env or secret files are staged
#    If you see .env in the output of git status, do NOT commit.
```

---

## 5. Open Decisions (unanswered questions)

These must be resolved before the relevant phase begins. They are fully listed in `docs/PROJECT_SPEC.md` Section 9.

| ID | Question | Must decide before |
|---|---|---|
| OD-1 | What happens to a `serving` token at queue close time? | Part 8 |
| OD-2 | What happens to a `called` token at queue close time? | Part 8 |
| OD-3 | Can a customer rejoin the same queue after cancelling on the same day? | Part 5 |
| OD-4 | Use live rolling average for EWT instead of fixed configured value? | Part 5 |
| OD-5 | What exactly does "pause queue" mean for staff? | Part 6 |
| OD-6 | Can a customer have more than one active token for the same service/day? | Part 5 |
| OD-7 | What happens if the customer's app is not open when their token is called? | Part 6 |

---

## 6. Known Issues / Notes

- None at this stage. Part 1 is documentation only.

---

## 7. How to Verify Part 1 Yourself

You do not need technical knowledge to verify that Part 1 is complete. Open a terminal, go to your project folder, and run these commands:

```bash
# Go to your project folder
cd /Users/shreyashchoudhari/Desktop/Queueless

# List all files (including hidden ones like .gitignore)
ls -la

# Check that the docs folder has all three documents
ls -lh docs/

# Check git log to see the initial commit
git log --oneline

# Confirm .env is NOT tracked
git ls-files | grep ".env"
# (This should print nothing — good!)
```

---

## 8. The Next Step (Part 2)

> Do not begin Part 2 until the project owner explicitly approves.

**Part 2: Backend Scaffold and Database Schema**

1. Initialize the Node.js + Express project inside `backend/`.
2. Install minimum required packages: `express`, `prisma`, `@prisma/client`, `dotenv`, `cors`, `cookie-parser`, `socket.io`.
3. Create `backend/.env.example` (template with no real secrets).
4. Connect Prisma to the Neon PostgreSQL database.
5. Write `backend/src/prisma/schema.prisma` based on the data model in `PROJECT_SPEC.md` Section 6.
6. Run `prisma migrate dev` to create the tables in the database.
7. Verify the tables exist in the Neon console.
8. Create a minimal Express server (`backend/server.js`) that starts and responds to `GET /api/health`.
9. Update `README.md` with backend setup instructions.
10. Update this `HANDOFF.md` with the result.

**Before starting Part 2**, the project owner must:
- Create a free Neon account and a new PostgreSQL database.
- Have the `DATABASE_URL` connection string ready to paste into `backend/.env`.
- Confirm they want to proceed.

# Deploying QueueLess (Vercel + Render + Neon)

## Why two hosts?

| Part | Host | Why |
|---|---|---|
| Frontend (React, static files) | **Vercel** | Static sites are what Vercel does best. |
| Backend (Express + Socket.IO + no-show worker) | **Render** (free web service) | The backend must run continuously: live updates keep sockets open, and the no-show processor runs every 30 s. Vercel only runs short-lived serverless functions, so it cannot host this part. |
| Database | **Neon** (already set up) | — |

Vercel forwards `/api/*` and `/socket.io/*` to Render. To the browser, everything comes from your Vercel domain, so the login cookies are first-party and work in Chrome, Safari and on iPhones.

Total time: about 20 minutes. You need GitHub, Render and Vercel accounts (free tiers are enough).

---

## Step 0 — Push the code to GitHub

Both hosts deploy from your GitHub repository, so commit and push the project first.

## Step 1 — Backend on Render

1. Go to https://dashboard.render.com → **New → Blueprint** → choose the `QueueLess` repository. Render reads `render.yaml` from the repository root.
2. When asked for values:
   - `DATABASE_URL`: your Neon connection string (Neon console → Connection details). Paste it only into Render, never into a file.
   - `FRONTEND_URL` and `APP_URL`: enter a temporary value such as `https://example.com`. You will replace them in Step 3.
   - `JWT_SECRET` is generated automatically.
3. Click **Apply**. The build installs dependencies and runs `prisma migrate deploy`, which only applies missing migrations and never resets data.
4. When it shows **Live**, open `https://<your-service>.onrender.com/api/health`. You should see `"status":"ok","database":"connected"`.

## Step 2 — Frontend on Vercel

1. Edit `frontend/vercel.json` so it contains the following, replacing `YOUR-SERVICE` with your Render service name. The `/api` and `/socket.io` rules must come **before** the catch-all:

   ```json
   {
     "rewrites": [
       { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" },
       { "source": "/socket.io/:path*", "destination": "https://YOUR-SERVICE.onrender.com/socket.io/:path*" },
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```
   Commit and push.
2. Go to https://vercel.com/new → import the repository.
   - **Root Directory**: `frontend`
   - Framework preset: **Vite** (build `npm run build`, output `dist`, both auto-detected)
   - Environment variables: **none**. Leave `VITE_API_URL` unset so the app uses the forwarding above.
3. Deploy, then note your URL, e.g. `https://queueless.vercel.app`.

## Step 3 — Connect them

1. In Render → your service → **Environment**, set `FRONTEND_URL` and `APP_URL` to your exact Vercel URL (no trailing slash) and save. Render redeploys automatically.
2. Open your Vercel URL → **Find a queue** → sign in → join a queue. Test once on a phone too.

## Demo data

Your Neon database already contains the demo organizations and `@queueless.demo` accounts from development, so the deployed site shows them immediately. That is convenient for a submission. Before real-world use, remove them with `npm run db:unseed -- --confirm` and change any shared passwords.

## Things to know about free tiers

- **Render free instances sleep after ~15 minutes without traffic.** The first request afterwards can take up to a minute while it wakes, and the app may briefly show "Cannot reach QueueLess". **Before a demo or grading, open `https://<your-service>.onrender.com/api/health` once** and wait for `ok`. Overdue no-shows are processed as soon as it wakes, because deadlines are stored in the database.
- **Neon free databases also scale to zero.** The backend now waits and retries instead of crashing, and API calls return a clean "temporarily unavailable" message until the database answers.
- **Live updates** travel over HTTP long-polling through Vercel's forwarding, because Vercel rewrites do not carry WebSockets. They still feel instant for this app.

## If something goes wrong

| Symptom | Check |
|---|---|
| `/api/health` shows `"database":"unreachable"` | `DATABASE_URL` in Render (copy it again from Neon). The server keeps retrying; Render logs show `Database not reachable … retrying`. |
| Sign-in works but you are immediately signed out | `FRONTEND_URL` must exactly match the Vercel URL, and `COOKIE_SAMESITE=lax`. |
| "Cannot reach QueueLess" on first visit | The Render instance is waking up; wait about a minute and retry. |
| Pages return 404 on refresh | The catch-all rule must be the last rewrite in `vercel.json`. |
| Render build fails at `prisma migrate deploy` | `DATABASE_URL` is wrong or Neon is unreachable; check Render's build log. |

## What makes the backend resilient

- A slow or unavailable database never crashes the server. It starts, serves `503` responses, and reconnects with backoff (1 s → 30 s).
- An unhandled promise rejection is logged and the server keeps running.
- An unexpected exception triggers a graceful shutdown, and Render restarts a clean process automatically.
- Deploys stop the server gracefully (10 s limit), so no-show state is never lost; it lives in PostgreSQL.
- In the browser, an unexpected error on one screen shows a recovery page instead of a blank app.

# CampusFlow

> Watches everything a student gets buried in — college emails, portal notices,
> deadlines, exam dates — figures out what matters to **that** student, prioritizes
> it, and pushes it into their **Google Calendar** so the calendar itself notifies
> them. Push-first. Not a chatbot, not another to-do app.

Built for **HackOn with Amazon — Season 6.0** (AI for Campus, Community & Everyday Life).

---

## The pipeline

```
FETCH ─▶ REGISTER ─▶ CONNECT ─▶ EXTRACT ─▶ MATCH ─▶ PRIORITIZE ─▶ SYNC ─▶ NOTIFY
(portal/   (profile)  (Google    (Bedrock   (per      (score +      (Google   (Google
 email)               Calendar)   Claude)    student)  ladder)       Calendar)  fires it)
```

The architecture is identical regardless of where raw data comes from.

## Tech stack

| Layer        | Choice                                                            |
|--------------|-------------------------------------------------------------------|
| Frontend     | React + Vite + Tailwind CSS v4, react-router, axios               |
| Backend      | Node.js + Express (modular folders), zod validation               |
| Database     | MongoDB via Mongoose                                              |
| LLM          | Amazon Bedrock (Claude Haiku) — backend-only key                 |
| Calendar     | Google Calendar API v3 (`googleapis`), OAuth2 + refresh token     |
| Secrets      | `.env` files via `dotenv` (never in the frontend)                 |

JavaScript across the **entire** stack. No Python. No Kafka/Redis/microservices
in the MVP (see the scaling path in the build spec).

> **Runs fully offline for the demo.** With blank Bedrock + Google values the app
> still works end-to-end: extraction falls back to a rule-based engine and calendar
> sync runs in **simulation mode**. You only *need* a MongoDB connection string.

---

## Quick start

### 0. Prerequisites
- Node 18+ (uses built-in `fetch`)
- A MongoDB you can reach — local `mongod`, or a free **MongoDB Atlas** cluster.

### 1. Backend

**No MongoDB installed? Use zero-setup in-memory mode** (no install, no Atlas signup;
data resets on each restart — fine for a demo session):
```bash
cd backend
npm install
npm run dev:mem             # boots the app on its own in-memory MongoDB
```

Or, with a real MongoDB (local `mongod` or Atlas):
```bash
cd backend
npm install
cp .env.example .env        # then fill in MONGODB_URI (others optional)
npm run dev                 # http://localhost:4000
```
Visit http://localhost:4000/health to confirm it's up. It reports whether
extraction is using **Bedrock** or the **rule-based fallback**, and whether
Google Calendar is **configured** or in **simulation**.

### 2. Frontend
```bash
cd frontend
npm install
# .env already points VITE_API_BASE_URL at http://localhost:4000
npm run dev                 # http://localhost:5173
```

### 3. Try it
1. **Register** (short form; enrichment is optional/skippable).
2. **Profile → Connect Google account** — auto-imports college emails (and syncs Calendar).
   College emails (from the configured sender) are read, classified by Gemini, and stored.
3. **Assistant** — ask about exams, deadlines, fees, placements, or "make me a study plan".
4. **Today** shows your events ranked by priority, with attendance warning,
   reminder ladders, and Eisenhower behavior — **Confirm & sync** or **Sync all**.

---

## Tests (no external services needed)

Both spin up an in-memory MongoDB automatically:

```bash
cd backend
npm run smoke       # pipeline unit-ish e2e: extract → match → prioritize → sync
npm run test:http   # full HTTP flow against the real Express app
```

---

## Enabling the real integrations

### Amazon Bedrock (extraction & classification)
In `backend/.env`:
```
AWS_REGION=ap-south-1
BEDROCK_API_KEY=<your bedrock api key>        # backend only — never the frontend
BEDROCK_MODEL_ID=<claude model id from the AWS console, e.g. a Haiku id>
```
The backend prompts Claude for **strict JSON**, parses defensively, and validates
with zod before anything touches the DB. Leave these blank to use the fallback.

### Google Calendar (delivery)
1. Google Cloud project → enable **Calendar API** → configure OAuth consent →
   add your demo account as a **test user**.
2. In `backend/.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
   ```
3. The backend requests **offline access**, stores the **refresh token** on the
   Student, and writes events with `reminders.overrides` = the importance ladder.
   Re-syncs are **idempotent** (update by `gcal_event_id`, never duplicate).

---

## Prioritization (the "smart")

**Importance** is fixed (consequence of missing it); **urgency** rises with the clock.
Importance decides the reminder ladder; urgency reorders automatically.

| Importance | Reminder ladder (written as Google Calendar overrides) |
|------------|--------------------------------------------------------|
| `critical` | 1 week · 3 days · 1 day · 3 hours · 1 hour  *(5 = Google max)* |
| `high`     | 2 days · 1 day · 2 hours                                |
| `med`      | 1 day · 1 hour                                          |
| `low`      | 1 hour                                                  |

`priority = importance_weight × urgency_factor` (critical=4 … low=1; urgency ∝ 1/hours-left).

---

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | service + capability probe |
| POST | `/auth/register` · `/auth/login` · GET `/auth/me` | auth (JWT) |
| GET/PUT | `/profile` | flexible JSON profile (+ derived `current_year`) |
| GET | `/auth/google/connect` · `/auth/google/callback` | OAuth + refresh token |
| GET | `/portal/{attendance,notices,deadlines,exams,all}` | mock college API |
| POST | `/gmail/{watch,stop}` · GET `/gmail/status` · POST `/gmail/pubsub` | Gmail Pub/Sub email capture |
| GET | `/college-info` · POST `/college-info/{ingest,upload}` | classified per-student digest |
| POST | `/chat/ask` · GET/DELETE `/chat/history` | digest-grounded chatbot |
| GET | `/events` · PUT `/events/:id` | control center (sorted, confirm/edit/dismiss) |
| GET | `/calendar/status` · POST `/calendar/sync` | idempotent calendar sync |

## Data models (`backend/src/models`)
`Student` (essentials + flexible `profile` sub-doc + `gcal` token), `RawItem`
(`content_hash` dedupe), `Event` (structured + `audience` + `importance`),
`StudentEvent` (per-student `priority_score`, `reminder_ladder`, `gcal_event_id`
idempotency, sync state).

## Repo layout
```
backend/   Express API — auth, profile, portal, ingestion, extraction,
           matching, scheduling, calendar, pipeline, models
frontend/  React + Vite control center — register, connect, inbox, today, profile
```

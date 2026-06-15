---
marp: true
theme: uncover
class: invert
paginate: true
title: CampusFlow — HackOn with Amazon S6.0
---

<!--
Slide deck for CampusFlow. Renders as slides with Marp (VS Code "Marp for VS Code"
extension or `marp presentation.md --pptx`), reveal.js, or any Markdown viewer.
Each `---` starts a new slide.
-->

# CampusFlow

### A personalized campus advisor

Turns the chaos of college **email, portals, PDFs and deadlines** into one
**ranked, on-time action list**.

`Capture → Extract → Prioritize → Deliver`

**HackOn with Amazon — Season 6.0** · AI for Campus, Community & Everyday Life

---

## The problem

Students miss things **not because they're careless** — because the signal is **scattered**.

| Source | Pain |
|---|---|
| Dozens of email threads | College mail buried under everything else |
| Portal notices | Attendance, exams, fees behind a separate login |
| PDF / image timetables | Hall tickets & schedules trapped in attachments |
| WhatsApp forwards | Critical updates with zero structure |

> The urgent fee deadline looks **exactly** like the club newsletter →
> missed deadlines, attendance shortfalls, skipped placement drives.

---

## Our solution — one pipeline, every source

- 📥 **Automatic capture** — Gmail push (Pub/Sub) in real time; paste text or upload PDF / image / Word / Excel, read natively
- 🧠 **AI categorization** — an LLM reads each email *and its attachments* into a per-student digest (9 categories)
- 🎯 **Personalized priority** — ranks every item by deadline urgency × category weight × the student's goals & focus subjects
- 📋 **My Tasks dashboard** — one ranked view + confirm / edit / dismiss / sync control center
- 📅 **Calendar sync** — dated items pushed to Google Calendar with reminders the moment they're captured (idempotent)
- 💬 **AI assistant + voice** — chatbot grounded in the student's own digest, plus hands-free voice (Deepgram)

---

## Architecture — microservices, not a monolith

Independent services behind an API gateway — each **deployable & scalable on its own**.

```text
                          ┌────────────────────┐
         clients ───────▶ │  API Gateway +Auth │  JWT · routing · CORS
                          └─────────┬──────────┘
   ┌──────────────┬────────────────┼────────────────┬──────────────┐
   ▼              ▼                 ▼                ▼              ▼
 Ingestion   LLM / Categorize  Prioritization     Chat          Voice
  Service        Service          Service        Service        Service
 (capture)    (provider-agnostic) (scoring)     (grounded)     (STT/TTS)
   └──────────────┴────────┬───────┴────────────────┴──────────────┘
                           ▼
              MongoDB  ◀──▶  Job / event queue (ScheduledJob)
                           ▲
        ┌──────────────────┴───────────────────┐
   Scheduler + Worker fleet             Calendar Sync Service
   (distributed jobs)                   (Google Calendar)
```

- **One capability per service** — deploy & version each independently.
- **Scale per service** — burst Ingestion & LLM under load without touching Auth.
- **Loose coupling** — services coordinate through MongoDB + the job/event queue, not in-process calls.
- **Resilient** — any service degrades on its own (rule-based LLM, simulated calendar) without taking the system down.

---

## The services

| Service | Responsibility | Interface |
|---|---|---|
| **API Gateway + Auth** | Routing, JWT, profile, CORS | `/auth` · `/profile` |
| **Ingestion** | Gmail Pub/Sub webhook · uploads · paste · portal connector | `/gmail` · `/college-info/ingest` · `/college-info/upload` · `/portal` |
| **LLM / Categorization** | Pluggable LLM extracts email + attachments into the digest | internal · rule-based fallback |
| **Prioritization** | Deterministic scoring + expiry of digest items | `/college-info/tasks` |
| **Digest** | Per-student `CollegeInfo` store of record | `/college-info` |
| **Chat** | Chatbot grounded in the student's own digest | `/chat` |
| **Voice** | Streaming speech-to-text + text-to-speech | `/voice` · WS `/voice/stream` |
| **Calendar Sync** | Idempotent Google Calendar sync | `/calendar` · `/events` |
| **Scheduler + Workers** | Distributed jobs — atomic leases, due index | background fleet |

> **Shared backbone:** MongoDB (state) + `ScheduledJob` queue (async work). Stateless services scale horizontally; the worker fleet scales independently.

---

## Where the data comes from

Multi-source ingestion — **including the college portal & databases**.

| Source | How |
|---|---|
| **Gmail (real-time)** | Pub/Sub push → `/gmail/pubsub`; allow-listed senders; reads body + PDF/image attachments; watch auto-renews before its 7-day expiry |
| **College portal API** | `/portal/{attendance,notices,deadlines,exams,all}` — a pluggable connector for a real college API/scrape; whole-college data fanned out to matching students |
| **Uploads & paste** | PDF · image · Word (mammoth) · Excel (xlsx) · zip (adm-zip) via `/college-info/upload` |
| **MongoDB (database)** | Mongoose models: `Student`, `CollegeInfo`, `ScheduledJob`, `ChatMessage`, `Event` — local · Atlas · in-memory |

> All four normalize into the **same per-student `CollegeInfo` document** — so prioritization & chat never care about the origin.

---

## Scaling the core: we removed cron

We deliberately **do not** use OS `cron` / `node-cron`. We built a
**MongoDB-native distributed job scheduler**.

| ✕ cron / node-cron | ✓ Our scheduler |
|---|---|
| Single point of failure | Runs on **any number of nodes** |
| Scans **every** user every tick — O(all) | **Indexed due-query** — O(due) only |
| 2 nodes ⇒ duplicate work | **Atomic lease** — none double-processes |
| No retries / no crash recovery | **Backoff + DLQ + self-healing reclaim** |
| Hourly for everyone | **Per-student, fires exactly on time** |

*No Redis, no broker — just MongoDB.*

---

## How it scales

**Per-entity precision, not polling everyone** — `server/src/jobs/scheduler.js`

- Each job stores its own `next_run_at` and computes the next one after it runs.
- `digest_expiry` fires *exactly* when a student's soonest deadline dies — once, on time.
- `gmail_watch_renew` fires 24h before the Gmail watch expires → capture stays automatic forever.
- New recurring job = register one handler in `jobs/registry.js`.

**Deployment topology**

```
API replicas ×N            Worker pods ×M
(INLINE_JOBS=false)        (npm run worker)
        \                    /
         ▼                  ▼
        MongoDB · ScheduledJob
        atomic leases · due index
```

Add load → add worker pods. Tunable: `JOB_POLL_MS · JOB_BATCH · JOB_CONCURRENCY · JOB_LEASE_MS · JOB_MAX_ATTEMPTS`.

---

## The AI layer — grounded, never guessing

| Stage | What |
|---|---|
| **Categorize** | A **pluggable LLM** (provider-agnostic) reads email + attachments → structured JSON into 9 categories (rule-based fallback) |
| **Prioritize** | Deterministic scoring engine (not the LLM) — explainable, fast, recomputed live each request |
| **Chat** | Answers strictly from the student's **own** `CollegeInfo` digest → grounded & personal |
| **Voice** | Deepgram streaming STT + Aura TTS; markdown flattened so it never reads symbols aloud |

> **Split by design:** the LLM *extracts & explains*, deterministic code *decides & ranks* — auditable, cheap, resilient to model outages.

---

## Tech stack

| Layer | Choice |
|---|---|
| **Frontend** | React + Vite + Tailwind v4 · react-router · axios · react-markdown |
| **Backend** | Node.js + Express (modular) · zod · `ws` (live voice) · morgan · multer |
| **Database** | MongoDB + Mongoose — local · Atlas · in-memory (mongodb-memory-server) |
| **Jobs / scaling** | Custom MongoDB-native distributed scheduler — atomic leases, due index, worker fleet |
| **LLM service** | Pluggable LLM provider (provider-agnostic) — categorize + chat, rule-based fallback |
| **Event extraction** | Optional model-backed extractor — rule-based fallback |
| **Voice** | Deepgram — streaming STT + Aura TTS |
| **Calendar** | Google Calendar API v3 (googleapis), OAuth2 + refresh token, idempotent |
| **Email capture** | Gmail API + Pub/Sub push, exposed via ngrok |
| **Attachments** | PDF · image · Word (mammoth) · Excel (xlsx) · zip (adm-zip) |
| **Auth** | JWT (jsonwebtoken) + password hashing |

---

## Why CampusFlow stands out

- ✅ **Real problem, real data** — live Gmail + portal + uploads + DB, not a toy dataset
- 📈 **Scales horizontally** — distributed Mongo scheduler replaces cron; add worker pods, never duplicate work
- 🧠 **Grounded AI** — a pluggable LLM categorizes & chats over the student's own digest; deterministic scoring decides
- ⚡ **Runs with zero keys** — in-memory DB, rule-based fallback, simulated calendar → judges run it instantly

### Built to demo today, engineered to scale tomorrow

`CampusFlow · Capture → Extract → Prioritize → Deliver · HackOn with Amazon S6.0`

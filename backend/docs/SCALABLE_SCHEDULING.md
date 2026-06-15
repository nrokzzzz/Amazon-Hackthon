# Scalable Per‑User Scheduling & Job Processing

Refactoring CampusFlow's `setInterval`/cron full‑scan jobs into a horizontally
scalable, fault‑tolerant system that processes **only due users** and scales to
10M+ users.

> TL;DR recommendation
> 1. **Delete the scheduler you can** — the hourly expiry job should be replaced
>    by a **MongoDB TTL index** (Tier 0). The cheapest job is the one that doesn't run.
> 2. For work that genuinely must run **per user every hour**, use a
>    **`next_run_at` due‑index + a claim‑and‑enqueue scanner + BullMQ (Redis)
>    workers**. Never `find({})`.
> 3. If you want zero scheduler ops and you're already on AWS (you use Bedrock),
>    **EventBridge Scheduler → SQS → workers** is the managed alternative.

> ### ✅ What is implemented in this repo (`src/jobs/`)
> Because CampusFlow runs **MongoDB but no Redis**, and the per‑user work is light
> (prune array items / renew a watch), the build uses the **MongoDB‑native variant**
> of §6 — the same `next_run_at` due‑index + atomic claim‑with‑lease, but the
> handler runs **inline in the worker** instead of via a Redis queue. Zero new
> infra, horizontally safe, no full scans. BullMQ (§7) / EventBridge (§8) remain
> the documented upgrade path for when a broker, cross‑service fan‑out, or
> heavier/slower jobs justify it.
>
> | Piece | File |
> |-------|------|
> | Due‑indexed job model | `src/models/ScheduledJob.js` |
> | Claim‑lease‑run engine + retry/backoff + reclaim | `src/jobs/scheduler.js` |
> | Handlers (idempotent, event‑driven reschedule) | `src/jobs/handlers/*.js` |
> | Lifecycle hooks (create jobs, no scan) | `src/digest/store.js`, `src/gmail/watch.js` |
> | Standalone worker / one‑time backfill | `src/jobs/worker.js`, `src/scripts/backfill-jobs.js` |
> | End‑to‑end test (`npm run test:jobs`) | `src/scripts/jobtest.js` |

---

## 1. Current architecture & bottlenecks

```
                 ┌──────────────── every API replica ────────────────┐
  start() ──────▶│ startPriorityScheduler()  setInterval(1h)         │
                 │   └─ CollegeInfo.find({})  ← FULL COLLECTION SCAN  │
                 │ startWatchScheduler()     setInterval(12h)         │
                 │   └─ Student.find({...})   ← FULL COLLECTION SCAN  │
                 └────────────────────────────────────────────────────┘
```

| # | Problem | Why it fails at scale |
|---|---------|-----------------------|
| 1 | `CollegeInfo.find({})` loads **all** docs each tick | At 10M docs this is GBs of RAM + a full index/collection scan every hour. |
| 2 | Sequential `doc.save()` in a `for` loop | 10M serial round‑trips can't finish within the hour. |
| 3 | Scheduler runs **inside every replica** | Scale to 20 pods → 20 concurrent full scans, 20× DB load, duplicated work, race conditions. |
| 4 | Work coupled to the web process | A scan spike starves HTTP request latency (shared event loop + DB pool). |
| 5 | No retries / isolation / backpressure | One slow/failing user can stall the whole pass; a crash loses the whole run. |
| 6 | Fixed 1h wall‑clock tick | All users processed in one burst → thundering herd on DB and downstream APIs. |

**Root cause:** the unit of work is "the whole collection on a timer" instead of
"one user when that user is due."

---

## 2. Target architecture

Three independently deployable roles. The web tier never schedules.

```
            ┌─────────────┐     enqueue      ┌──────────────────┐
   HTTP ───▶│   api (N)   │                  │  Redis + BullMQ  │
            │  Express    │                  │   queue: jobs    │
            └─────────────┘                  │   + DLQ          │
                                             └────────┬─────────┘
   ┌──────────────────────┐  claim due       ▲        │ pull
   │   scheduler (1..S)    │  indexed query   │        ▼
   │  scan next_run_at ≤now│──────────────────┘   ┌─────────────┐
   │  lease + enqueue      │                       │ worker (W)  │  HPA on
   │  reschedule (+1h)     │◀──────────────────────│ process()   │  queue depth
   └──────────┬───────────┘    set next_run_at     └─────┬───────┘
              │                                          │ idempotent
              ▼                                          ▼
        ┌───────────────────────── MongoDB ─────────────────────────┐
        │  scheduled_jobs  { user_id, type, next_run_at, status,     │
        │                    locked_until, attempts, shard }         │
        │  index: { status:1, next_run_at:1 }   (the due index)      │
        └────────────────────────────────────────────────────────────┘
```

- **api** — Express only. No timers. Mounts a job when a user is created.
- **scheduler** — small, stateless. Every few seconds runs **one indexed range
  query** for due jobs, atomically leases a batch, pushes them to the queue, and
  sets each job's `next_run_at = now + 1h`. Touches only due rows, never the
  whole collection.
- **worker** — pulls from BullMQ, runs the idempotent handler (e.g. expire a
  single student's past tasks), with retries/backoff/DLQ. Scaled by queue depth.

---

## 3. Which queue/scheduler? (decision matrix)

| Option | Native per‑user schedule | Throughput | Retries / DLQ | Rate limit | Ops burden | Best when |
|--------|--------------------------|-----------|---------------|-----------|------------|-----------|
| **Redis + BullMQ** ✅ | No (use due‑index scanner) | Very high (10k+/s) | Built‑in (`attempts`, `backoff`, failed set) | Built‑in (`limiter`, groups) | You run Redis (HA) | Self‑hosted, cost‑sensitive, full control |
| **AWS SQS** | No (still need scanner) | Effectively unlimited | Native DLQ (redrive) | Via worker concurrency | Low (managed) | Want managed queue, AWS‑native |
| **EventBridge Scheduler** | **Yes** — 1 schedule/user, fires hourly | Managed | Via target (SQS/Lambda) DLQ | Target concurrency | Low; no scanner at all | Want to delete the scanner entirely |
| **Kafka** ❌ | No (it's a log, not a scheduler) | Extreme stream throughput | Manual (no per‑msg retry) | Manual | High | Event streaming/fan‑out, **not** cron |

**Recommendation:** **BullMQ + Redis** as the default — richest job semantics
(delays, retries, backoff, rate limiting, dead‑letter), cheapest to run, and the
due‑index scanner avoids the "millions of repeatable jobs" anti‑pattern. Choose
**EventBridge Scheduler → SQS** if you'd rather pay AWS to own scheduling and
delete the scanner. **Kafka is the wrong tool** for "run X per user per hour."

> ⚠️ Anti‑pattern: BullMQ *repeatable jobs* (`repeat: { every }`) are great for a
> handful of crons, but **one repeatable job per user × 10M is not viable** —
> each lives in Redis as its own schedule. Use the DB `next_run_at` index instead
> and enqueue **one‑off** jobs.

---

## 4. Tier 0 — eliminate the job entirely (do this first)

Your expiry work just drops tasks whose time has passed, and scoring is **already
recomputed on every request** ([priorityScheduler.js:6](../src/digest/priorityScheduler.js)).
So expiry is housekeeping, not business logic. Two ways to remove the cron:

**A. MongoDB TTL index (best).** TTL can't target array elements, so promote
items out of the embedded `CollegeInfo` arrays into their own collection:

```ts
// models/Task.ts
const taskSchema = new Schema({
  user_id:   { type: ObjectId, ref: 'Student', index: true },
  category:  String,
  title:     String,
  datetime:  Date,
  // Mongo deletes the doc automatically ~60s after this instant:
  expires_at:{ type: Date, index: { expireAfterSeconds: 0 } },
});
```

MongoDB's background TTL monitor deletes expired docs for you — **no scanner, no
cron, O(0) app work.** Set `expires_at` to end‑of‑day when you ingest a task.

**B. Lazy expiry.** Keep filtering expired items on read (you already do) and
skip deletion entirely, or compact opportunistically when a user next loads. Zero
scheduled work; storage grows slightly until touched.

> If every recurring job in your system is housekeeping like this, you may not
> need a scheduler at all. The rest of this doc is for work that genuinely must
> fire per user on a cadence (digests, reminders, re‑sync, re‑scoring pushes…).

---

## 5. Schema & the "due index"

```ts
// models/ScheduledJob.ts
import { Schema, model, Types } from 'mongoose';

const scheduledJobSchema = new Schema({
  user_id:      { type: Types.ObjectId, ref: 'Student', required: true },
  type:         { type: String, required: true },          // 'hourly_maintenance'
  status:       { type: String, default: 'idle' },         // idle|queued|running
  next_run_at:  { type: Date, required: true },            // when it's due
  locked_until: { type: Date, default: null },             // lease (crash recovery)
  attempts:     { type: Number, default: 0 },
  interval_ms:  { type: Number, default: 3_600_000 },      // 1h
  shard:        { type: Number, default: 0 },              // 0..N-1 partition
  last_run_at:  Date,
  last_error:   String,
}, { timestamps: true });

// One schedule per (user, type).
scheduledJobSchema.index({ user_id: 1, type: 1 }, { unique: true });

// THE DUE INDEX — the scanner's query rides this; it only visits due rows.
scheduledJobSchema.index({ status: 1, shard: 1, next_run_at: 1 });

export const ScheduledJob = model('ScheduledJob', scheduledJobSchema);
```

**Why this is not a scan:** the scanner queries `status:'idle', next_run_at:{$lte:now}`.
The compound index `{status, shard, next_run_at}` lets MongoDB seek straight to
the due range and return only those documents (typically a few thousand), not the
10M idle‑future rows. Cost is O(due), not O(total).

---

## 6. The claim‑and‑enqueue scheduler (atomic, multi‑instance safe)

```ts
// scheduler/scanner.ts
import { ScheduledJob } from '../models/ScheduledJob';
import { jobQueue } from '../queue/jobQueue';

const BATCH = 500;
const LEASE_MS = 60_000;

export async function tick(shard: number, now = new Date()) {
  // Claim due jobs one at a time, atomically — only ONE scheduler wins each row,
  // so you can run many schedulers (or many replicas) safely.
  for (let i = 0; i < BATCH; i++) {
    const job = await ScheduledJob.findOneAndUpdate(
      { status: 'idle', shard, next_run_at: { $lte: now } },
      {
        $set: {
          status: 'queued',
          locked_until: new Date(now.getTime() + LEASE_MS),
          // Reschedule immediately so a crash before enqueue still re‑fires later.
          next_run_at: new Date(now.getTime() + 3_600_000),
        },
        $inc: { attempts: 1 },
      },
      { sort: { next_run_at: 1 }, new: true }
    ).lean();

    if (!job) break;                       // nothing due — stop early
    await jobQueue.add(job.type, { jobId: String(job._id), userId: String(job.user_id) }, {
      jobId: `${job._id}:${+job.next_run_at}`,   // idempotency key (dedupe)
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1000,
      removeOnFail: false,                  // keep failures for the DLQ mover
    });
  }
}

// Recover jobs whose worker died mid‑flight (lease expired).
export async function reclaim(now = new Date()) {
  await ScheduledJob.updateMany(
    { status: { $in: ['queued', 'running'] }, locked_until: { $lt: now } },
    { $set: { status: 'idle' } }
  );
}
```

```ts
// scheduler/index.ts — runs as its own process/pod
import { connectDB } from '../config/db';
import { tick, reclaim } from './scanner';

const SHARD = Number(process.env.SHARD ?? 0);       // this scheduler owns one shard
const SHARDS = Number(process.env.SHARDS ?? 1);

async function main() {
  await connectDB();
  setInterval(() => tick(SHARD).catch(console.error), 2_000);     // poll every 2s
  setInterval(() => reclaim().catch(console.error), 30_000);      // crash recovery
}
main();
```

**Sharding** lets you run S scheduler pods without coordination: pod *k* only
scans `shard === k`. Assign `shard = hash(user_id) % SHARDS` at job creation.
(Single‑shard is fine up to ~1M users; shard beyond that.)

**Jitter** to avoid the top‑of‑the‑hour herd: when rescheduling set
`next_run_at = now + interval_ms + random(0..interval_ms*0.1)` so load spreads.

---

## 7. Worker, retries, DLQ, rate limiting

```ts
// queue/jobQueue.ts
import { Queue } from 'bullmq';
export const connection = { host: process.env.REDIS_HOST, port: 6379 };
export const jobQueue = new Queue('jobs', { connection });
export const deadQueue = new Queue('jobs:dead', { connection });
```

```ts
// worker/index.ts — runs as its own process/pod, scale horizontally
import { Worker } from 'bullmq';
import { connection, deadQueue } from '../queue/jobQueue';
import { ScheduledJob } from '../models/ScheduledJob';
import { runMaintenance } from './handlers/maintenance';

const worker = new Worker('jobs', async (job) => {
  const { jobId, userId } = job.data;
  await ScheduledJob.updateOne({ _id: jobId }, { $set: { status: 'running' } });

  await runMaintenance(userId);            // ← idempotent unit of work (one user)

  await ScheduledJob.updateOne({ _id: jobId }, {
    $set: { status: 'idle', last_run_at: new Date(), last_error: null, locked_until: null },
  });
}, {
  connection,
  concurrency: Number(process.env.CONCURRENCY ?? 20),
  // Token‑bucket rate limit to protect downstream APIs (Gmail, Bedrock, Mongo):
  limiter: { max: 500, duration: 1000 },   // ≤500 jobs/sec per worker
});

// Dead‑letter: after all retries are exhausted, park it for inspection/replay.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await deadQueue.add('dead', { ...job.data, failedReason: err.message });
    await ScheduledJob.updateOne({ _id: job.data.jobId },
      { $set: { status: 'idle', last_error: err.message } });
  }
});
```

```ts
// worker/handlers/maintenance.ts — make it safe to run more than once
import { CollegeInfo } from '../../models/CollegeInfo';
import { expireDigest } from '../../digest/priority.js';

export async function runMaintenance(userId: string) {
  const doc = await CollegeInfo.findOne({ student_id: userId });
  if (!doc) return;
  if (expireDigest(doc, new Date()) > 0) await doc.save();   // re‑running is a no‑op
}
```

- **Retries:** `attempts: 5` + exponential `backoff` (2s, 4s, 8s…).
- **Idempotency:** `jobId = ${_id}:${runtime}` dedupes double‑enqueues;
  `expireDigest` is naturally idempotent.
- **DLQ:** exhausted jobs go to `jobs:dead` (replayable). With SQS this is a
  native redrive policy instead.
- **Rate limiting:** BullMQ `limiter` caps throughput per worker; use **groups**
  to cap per external dependency (e.g. Gmail API quota).

---

## 8. Managed alternative — EventBridge Scheduler → SQS

Deletes the scanner. On user create, create one recurring schedule:

```ts
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
const sched = new SchedulerClient({});
await sched.send(new CreateScheduleCommand({
  Name: `user-${userId}-maintenance`,
  ScheduleExpression: 'rate(1 hour)',
  FlexibleTimeWindow: { Mode: 'FLEXIBLE', MaximumWindowInMinutes: 15 }, // auto‑jitter
  Target: { Arn: QUEUE_ARN, RoleArn: ROLE_ARN, Input: JSON.stringify({ userId }) },
}));
```

EventBridge fires each schedule → SQS → the same BullMQ‑style worker reads SQS.
Trade‑off: simplest ops, but AWS‑coupled and per‑schedule cost at 10M (see §11).

---

## 9. How it scales

| Users (jobs/hr) | Avg rate | Redis | Schedulers | Workers | MongoDB |
|-----------------|----------|-------|-----------|---------|---------|
| **100k** | ~28/s | 1 small (managed) | 1 (single shard) | 1–2 pods, conc 20 | single replica set; due index |
| **1M** | ~278/s | 1 with replica | 1–2 (2 shards) | 3–5 pods (HPA) | replica set; ensure index in RAM |
| **10M** | ~2,778/s | Redis Cluster / large | 4–8 (sharded) | 10–30 pods (HPA/KEDA) | shard on `user_id`; due index per shard |

The due query stays O(due‑per‑tick) at every tier because it never reads
future/idle rows. Workers scale out linearly; Redis and Mongo are the limits, and
both shard. Spreading via jitter keeps the per‑second rate near the average, not a
once‑an‑hour spike.

---

## 10. Deployment (Docker / Kubernetes)

```
api      Deployment  ─ HPA on CPU/RPS              (Express, no schedulers)
scheduler Deployment ─ replicas = SHARDS, env SHARD via StatefulSet ordinal
worker    Deployment ─ KEDA ScaledObject on Redis queue length
redis     managed (ElastiCache / Upstash / Redis Cloud) or HA StatefulSet
mongo     managed (Atlas) — sharded at 10M tier
```

```yaml
# worker autoscaling on queue depth (KEDA)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: worker-scaler }
spec:
  scaleTargetRef: { name: worker }
  minReplicaCount: 2
  maxReplicaCount: 50
  triggers:
    - type: redis
      metadata: { address: redis:6379, listName: "bull:jobs:wait", listLength: "2000" }
```

Key rule: **remove `startPriorityScheduler()` / `startWatchScheduler()` from the
api process** — schedulers live only in the `scheduler` deployment.

---

## 11. Monitoring, logging, recovery

- **Dashboards:** Bull Board / Arena for queue depth, active, failed, DLQ.
- **Metrics (Prometheus → Grafana):** queue depth, enqueue & completion rate,
  failure rate, **scheduler lag** = `now − min(next_run_at over idle due)` (the
  single best health signal — if lag grows, you're behind), worker concurrency,
  Redis memory.
- **Alerts:** DLQ size > 0 (page), scheduler lag > 5 min, completion rate < enqueue
  rate for N minutes, Redis memory > 80%.
- **Logging:** structured (pino) with `job_id` + `user_id` correlation IDs;
  OpenTelemetry traces enqueue → process.
- **Recovery:** leases (`locked_until`) auto‑reclaim crashed jobs; workers are
  idempotent (at‑least‑once is safe); DLQ holds poison jobs for replay; scheduler
  and workers are stateless and restart cleanly.

---

## 12. Trade‑offs & cost (order‑of‑magnitude, 10M users/hr)

| Stack | Monthly infra (rough) | Pros | Cons |
|-------|----------------------|------|------|
| BullMQ + Redis (self/managed) | Redis ~$100–500 + worker compute | Cheapest, richest features, full control | You operate Redis HA |
| SQS + workers | ~240M msgs/day ≈ $0.40/M → ~$2.9k + compute | Fully managed, infinite scale, native DLQ | Need scanner; per‑request cost |
| EventBridge Scheduler → SQS | Schedules + ~$1/M invocations → higher | No scanner to run/operate | Most expensive at 10M; AWS lock‑in |

General trade‑offs: **at‑least‑once** delivery (must be idempotent), eventual
(not exact‑second) execution with jitter, and added moving parts (Redis/queue) vs.
the simplicity you're replacing.

---

## 13. Migration from `setInterval` → queue

1. **Add infra:** `bullmq`, `ioredis`; provision Redis.
2. **Schema:** add `ScheduledJob` + indexes. One‑time backfill: for each existing
   user insert a job with **jittered** `next_run_at` (spread across the hour).
3. **Extract the unit of work:** move the body of `expireDigest`‑per‑user into
   `worker/handlers/maintenance.ts`; make it idempotent (it already is).
4. **Build processes:** `scheduler/` and `worker/` entrypoints + Dockerfiles.
5. **Hook creation:** when a Student is created, insert its `ScheduledJob`
   (replace nothing in the request path otherwise).
6. **Shadow run:** deploy scheduler+worker alongside the old `setInterval`; log,
   compare, don't act — or run on a 1% shard first.
7. **Cut over:** delete `startPriorityScheduler()` / `startWatchScheduler()` from
   `server.js`; ensure the api deployment sets `SCHEDULER_ENABLED=false`.
8. **Tier 0 where possible:** migrate expiry to a **TTL index** and drop that job
   from the scheduler entirely.
9. **Decommission** node‑cron/`setInterval`; turn on KEDA autoscaling.

---

## 14. Folder structure

```
backend/src/
  api/            # Express app & routes (NO schedulers)
  config/         # db.ts, redis.ts, env.ts
  models/
    ScheduledJob.ts
    Task.ts                     # (Tier 0) tasks w/ TTL expires_at
  queue/
    jobQueue.ts                 # BullMQ queues (jobs, jobs:dead)
  scheduler/
    index.ts                    # process entrypoint (sharded)
    scanner.ts                  # tick() claim+enqueue, reclaim()
  worker/
    index.ts                    # BullMQ Worker entrypoint
    handlers/
      maintenance.ts            # idempotent per‑user work
  scripts/
    backfill-jobs.ts            # one‑time: create ScheduledJob per user
deploy/
  Dockerfile.api  Dockerfile.scheduler  Dockerfile.worker
  k8s/ (api, scheduler, worker, keda-scaledobject.yaml)
```

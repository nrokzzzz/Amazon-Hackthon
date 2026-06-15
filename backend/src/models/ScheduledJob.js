import mongoose from 'mongoose';

// A single recurring unit of work for ONE entity (e.g. one student), due at
// `next_run_at`. The scheduler claims due jobs with an indexed range query and an
// atomic lease — so it processes only what's due, never the whole collection, and
// many scheduler/worker instances can run safely in parallel.
const scheduledJobSchema = new mongoose.Schema(
  {
    // What to do. Maps to a handler in jobs/registry.js.
    type: { type: String, required: true }, // 'digest_expiry' | 'gmail_watch_renew'
    // The entity this job acts on (here: the Student _id).
    ref_id: { type: mongoose.Schema.Types.ObjectId, required: true },

    status: { type: String, enum: ['idle', 'running'], default: 'idle' },
    next_run_at: { type: Date, required: true }, // when it's due (the due index)
    interval_ms: { type: Number, default: 3_600_000 }, // default cadence if a handler doesn't pick one

    locked_until: { type: Date, default: null }, // lease expiry — reclaims crashed runs
    attempts: { type: Number, default: 0 }, // consecutive failures (drives backoff)
    last_run_at: { type: Date, default: null },
    last_error: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// One schedule per (entity, type) — upserts can't create duplicates.
scheduledJobSchema.index({ type: 1, ref_id: 1 }, { unique: true });

// THE DUE INDEX. The scanner queries { status:'idle', next_run_at:{$lte:now} }
// sorted by next_run_at — this index lets Mongo seek straight to the due rows and
// return only those, so cost is O(due) not O(all users).
scheduledJobSchema.index({ status: 1, next_run_at: 1 });

export const ScheduledJob = mongoose.model('ScheduledJob', scheduledJobSchema);

import mongoose from 'mongoose';

// The per-student join: a matched Event with this student's priority + ladder
// + Google Calendar sync state. This is what the control center renders.
const studentEventSchema = new mongoose.Schema(
  {
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },

    priority_score: { type: Number, default: 0 },
    reminder_ladder: { type: [Number], default: [] }, // minutes-before list (cap 5)

    // Student control-center decisions (Feature 10)
    state: {
      type: String,
      enum: ['pending', 'confirmed', 'dismissed'],
      default: 'pending',
      index: true,
    },

    // Idempotent sync state
    gcal_event_id: { type: String }, // presence => update instead of insert
    sync_status: {
      type: String,
      enum: ['unsynced', 'synced', 'failed'],
      default: 'unsynced',
      index: true,
    },
    sync_error: String,
    last_synced: Date,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// One StudentEvent per (student, event).
studentEventSchema.index({ student_id: 1, event_id: 1 }, { unique: true });

export const StudentEvent = mongoose.model('StudentEvent', studentEventSchema);

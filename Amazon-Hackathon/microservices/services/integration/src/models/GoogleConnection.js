import mongoose from 'mongoose';

// One Google connection per app user. Keyed by the gateway-forwarded userId
// (x-user-id) — this REPLACES the monolith's Student.gcal / Student.gmail
// sub-docs. The integration service never loads a Student; it owns everything
// here in the campusflow_integration database.
const googleConnectionSchema = new mongoose.Schema(
  {
    // App user id forwarded by the gateway as the 'x-user-id' header.
    userId: { type: String, required: true, unique: true, index: true },

    // The connected Google account email (used to match Pub/Sub notifications).
    googleEmail: { type: String, lowercase: true, trim: true, index: true },

    // OAuth refresh token — stored backend-only, never leaked to clients.
    refresh_token: { type: String },

    // Target calendar (almost always the user's primary).
    calendar_id: { type: String, default: 'primary' },

    // Gmail push (Pub/Sub) watch state. Shares the OAuth refresh token above.
    gmail: {
      watching: { type: Boolean, default: false },
      history_id: { type: String }, // last Gmail historyId we processed
      watch_expiration: { type: Number }, // ms epoch; watch must be renewed before this
    },

    // Map of stable digest-item-key -> created Google Calendar eventId, so we
    // upsert (insert once, update thereafter) instead of duplicating events.
    gcal_events: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// Never leak the refresh token to clients.
googleConnectionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.refresh_token;
    return ret;
  },
});

export const GoogleConnection = mongoose.model('GoogleConnection', googleConnectionSchema);

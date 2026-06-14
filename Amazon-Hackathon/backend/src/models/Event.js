import mongoose from 'mongoose';

// A structured Event produced by extraction. This is the GENERIC, college-wide
// representation — matching (Feature 7) decides which students it applies to.
const eventSchema = new mongoose.Schema(
  {
    raw_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RawItem', index: true },

    title: { type: String, required: true },
    description: String,
    type: {
      type: String,
      // exam | exam_fee | assignment | lab | project | registration |
      // class | workshop | placement | attendance | notice | event
      default: 'notice',
    },
    course: String, // e.g. "DBMS", "CN"
    datetime: { type: Date }, // when the event/deadline occurs

    // Who is this for? Used by the matching layer. Indexed for query-based match.
    audience: {
      branch: { type: String, default: 'all', index: true }, // "CSE" | "all"
      year: { type: mongoose.Schema.Types.Mixed, default: 'all', index: true }, // Number | "all"
      section: { type: String, default: 'all' }, // "A" | "all"
    },

    importance: {
      type: String,
      enum: ['critical', 'high', 'med', 'low'],
      default: 'low',
      index: true,
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export const Event = mongoose.model('Event', eventSchema);

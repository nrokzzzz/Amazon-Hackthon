import mongoose from 'mongoose';
import crypto from 'crypto';

const rawItemSchema = new mongoose.Schema(
  {
    // Owner of this raw item. Items can be student-specific (pasted email) or
    // global (college portal notice meant for everyone).
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', index: true },

    source: { type: String, required: true }, // "portal" | "email" | "notice" | "upload"
    raw_text: { type: String, required: true },
    content_hash: { type: String, required: true, index: true }, // dedupe key
    status: {
      type: String,
      enum: ['pending', 'done', 'failed'],
      default: 'pending',
      index: true,
    },
    error: String,
  },
  { timestamps: { createdAt: 'fetched_at', updatedAt: 'updated_at' } }
);

// Never re-process the same notice for the same owner.
rawItemSchema.index({ student_id: 1, content_hash: 1 }, { unique: true });

export function hashContent(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

export const RawItem = mongoose.model('RawItem', rawItemSchema);

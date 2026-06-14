import mongoose from 'mongoose';

// One turn in a student's chat with the CampusFlow Assistant. We store both the
// user's question and the assistant's answer as separate rows (ordered by _id /
// created_at) so the UI can paginate history on scroll-up.
const chatMessageSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    engine: { type: String }, // 'gemini' | 'fallback' (assistant rows only)
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// Fast "latest messages for this student, oldest-first window" queries.
chatMessageSchema.index({ student_id: 1, _id: 1 });

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

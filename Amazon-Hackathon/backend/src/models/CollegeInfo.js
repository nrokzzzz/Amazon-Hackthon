import mongoose from 'mongoose';
import { CATEGORIES } from '../digest/categories.js';

// One item inside a category bucket. strict:false so the LLM can attach
// category-specific structured fields under `details` (venue, company, route_no,
// bus_time, course code, etc.) without us pre-declaring every possible key.
const itemSchema = new mongoose.Schema(
  {
    category: { type: String }, // redundant copy of the bucket name (eases cross-category queries)
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    datetime: { type: Date }, // primary date / deadline for this item, if any

    importance: {
      type: String,
      enum: ['critical', 'high', 'med', 'low'],
      default: 'med',
    },
    action_required: { type: Boolean, default: false }, // does the student must DO something (pay/submit/register)?
    link: { type: String, default: '' }, // registration / payment / JD url
    amount: { type: String, default: '' }, // fee amount, e.g. "₹1200" (string: formats vary)
    location: { type: String, default: '' }, // venue / hall / room / stop

    // Category-specific structured fields the LLM fills (subject, company, route_no…).
    details: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Provenance — where this item came from (handy for the chatbot + audit).
    source: { type: String, default: 'gmail' }, // gmail | paste | upload | manual
    source_subject: { type: String, default: '' },
    source_email_id: { type: String, default: '' },

    content_hash: { type: String, index: true }, // dedupe within a category
    received_at: { type: Date, default: Date.now },
  },
  { _id: true, strict: false, timestamps: false }
);

// Build one array field per category, e.g. exam_timetable: [itemSchema].
const categoryFields = Object.fromEntries(
  CATEGORIES.map((c) => [c, { type: [itemSchema], default: [] }])
);

// One document per student. The chatbot serializes this whole doc into the LLM
// context to answer the student's questions about their college info.
const collegeInfoSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      unique: true,
      index: true,
    },
    ...categoryFields,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export const CollegeInfo = mongoose.model('CollegeInfo', collegeInfoSchema);

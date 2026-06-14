import mongoose from 'mongoose';

// TIER 2 enrichment profile is stored as a flexible sub-document so new
// attributes can be added later with NO migration.
const profileSchema = new mongoose.Schema(
  {
    study_times: [String], // preferred times to study, e.g. ["evening", "21:00-23:00"]
    focus_subjects: [String], // subjects to improve / find hard -> more prep + earlier reminders
    strengths: [String], // deprioritize prep
    goals: [String], // placement / GATE / higher-studies / target company
    areas_of_interest: [String],
    hobbies: [String],
    prefs: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false, strict: false } // strict:false -> accept arbitrary future keys
);

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    // TIER 1 essentials (power the core pipeline)
    branch: { type: String, required: true }, // e.g. "CSE", "ECE"
    roll_no: { type: String, required: true },
    passout_year: { type: Number, required: true },
    section: { type: String }, // optional; section or semester

    profile: { type: profileSchema, default: () => ({}) },

    // NOTE: gcal + gmail sub-documents have moved to the integration service.
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// current_year is DERIVED from passout_year + today (not stored authoritatively).
// Typical Indian B.Tech = 4 years. Academic year flips in July.
studentSchema.methods.currentYear = function (now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed; July = 6
  // Academic year start: if before July, we're still in the previous intake's year.
  const academicStartYear = month >= 6 ? year : year - 1;
  // passout_year is the year they graduate (end of 4th year).
  const startYear = this.passout_year - 4; // year they joined
  const yearsElapsed = academicStartYear - startYear + 1;
  return Math.min(Math.max(yearsElapsed, 1), 4);
};

studentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
  virtuals: true,
});

// Add derived current_year to JSON output.
studentSchema.virtual('current_year').get(function () {
  return this.currentYear();
});

export const Student = mongoose.model('Student', studentSchema);

// The structured buckets we sort every college email into. These are the field
// names on the CollegeInfo document AND the categories the LLM must choose from.
export const CATEGORIES = [
  'class_timetable', // regular class schedule / timetable / lecture reschedules
  'exam_timetable', // exam dates, hall tickets, exam schedule (NOT the fee)
  'assignment_deadlines', // assignments, lab submissions, project due dates
  'fees', // exam fee, supplementary fee, tuition, fine — anything to PAY
  'attendance', // attendance reports, shortage / debarment / condonation
  'placement_prep', // placement drives, JD, company info, prep / training
  'hostel_notices', // hostel / mess / warden / room allotment notices
  'transport', // bus routes, timings, transport fee, route changes
  'club_events', // student clubs, fests, cultural/technical events, hackathons
  'general', // catch-all: NSS, blood donation, FYI notices, anything else
];

// Human-readable hints used in both the LLM prompt and the rule-based fallback.
export const CATEGORY_HINTS = {
  class_timetable: 'class timetable, lecture slots, class reschedule/cancellation',
  exam_timetable: 'exam schedule, hall ticket, mid/end semester exam dates & venues',
  assignment_deadlines: 'assignment, lab record/submission, project, due date',
  fees: 'exam fee, supplementary fee, re-exam fee, tuition/hostel fee, fine — amount to be PAID by a last date',
  attendance: 'attendance percentage, shortage warning, debarment, condonation',
  placement_prep: 'placement drive, recruiting company, job description (JD), pre-placement talk, aptitude/training prep',
  hostel_notices: 'hostel, mess menu, warden notice, room allotment',
  transport: 'college bus, route, transport timing, shuttle, stop',
  club_events: 'student club activity, fest, cultural/technical event, workshop, seminar, hackathon',
  general: 'NSS, blood donation camp, FYI/awareness notices, anything that fits no other category',
};

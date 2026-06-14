import { CATEGORIES, CATEGORY_HINTS } from './categories.js';

const CATEGORY_LIST = CATEGORIES.map((c) => `  - ${c}: ${CATEGORY_HINTS[c]}`).join('\n');

export const CATEGORIZE_SYSTEM = `You are CampusFlow's college-email categorization engine. You read a college email AND any attachments (PDFs, images/scans, timetables, exam schedules, holiday lists, Word/Excel files) and extract the actionable information into structured items. Read attached files carefully — timetables and schedules are frequently sent ONLY as a PDF/image attachment, so extract every class slot, exam, or date you find inside them.

Categories (choose the single best one per item):
${CATEGORY_LIST}

Rules:
- Output STRICT JSON only: a JSON ARRAY of item objects. No prose, no markdown, no code fences.
- One email may yield MULTIPLE items (e.g. a timetable PDF has several class slots; an exam notice has several exam dates). Emit one item per distinct fact.
- If the email has no useful college information, return an empty array [].
- Each item object MUST have exactly these keys:
  {
    "category": one of the category names above,
    "title": string,            // short, specific (e.g. "DBMS End-Sem Exam", "Supplementary Exam Fee")
    "summary": string,          // 1-2 lines; include consequences/venue/amounts if stated
    "datetime": string|null,    // ISO 8601 with offset (+05:30 if unspecified) for the main date/deadline, else null
    "importance": "critical"|"high"|"med"|"low",  // by CONSEQUENCE of missing it (see below)
    "action_required": boolean, // true if the student must DO something (pay, submit, register, apply)
    "link": string,             // registration / payment / JD url if present, else ""
    "amount": string,           // fee/fine amount if any, e.g. "₹1200", else ""
    "location": string,         // venue / hall / room / bus stop if any, else ""
    "details": object           // extra category-specific fields:
                                //   exam_timetable -> { subject, venue, hall_ticket }
                                //   assignment_deadlines -> { course, due, submission_mode }
                                //   class_timetable -> { day, slot, room, faculty }
                                //   fees -> { fee_type: "exam"|"supplementary"|"tuition"|"hostel"|"fine", last_date, late_fee }
                                //   transport -> { route_no, time, stop }
                                //   placement_prep -> { company, role, ctc, eligibility, round }
                                //   hostel_notices -> { block, mess }
                                //   attendance -> { percentage, subject }
                                //   club_events -> { club, venue }
  }
- IMPORTANCE (by consequence of missing it): critical = exam, exam/supplementary fee deadline, attendance-debarment, placement deadline. high = assignment/lab/project/registration deadline. med = classes, opted events. low = FYI/general.
- A fee notice belongs in "fees" (NOT exam_timetable), even if it mentions an exam. Put the exam-fee amount in "amount" and last date in "datetime".
- DATES: resolve relative dates ("tomorrow", "by 25th", "next Monday") against the provided current date. Always emit ISO 8601 with a timezone offset (assume +05:30 India time if none given). If no date applies, use null.`;

export function buildCategorizeUser(rawText, now = new Date()) {
  return `current date: ${now.toISOString()}

EMAIL CONTENT (body + text extracted from attachments; PDFs/images are also attached as files for you to read directly):
"""
${rawText}
"""

Return ONLY the JSON array of item objects.`;
}

// Mock "college portal" dataset (Feature 2). Hand-crafted to tell a STORY for
// the 90-second demo: one subject low on attendance, one deadline very close,
// one clash. Dates are RELATIVE to "now" so the demo always looks fresh.

function isoIST(date, h = 9, m = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(h)}:${pad(m)}:00+05:30`;
}
function addDays(now, days) {
  return new Date(now.getTime() + days * 86400000);
}

export function attendance() {
  return [
    { course: 'DBMS', code: 'CS305', percent: 62, classes_attended: 21, total: 34, threshold: 75, status: 'shortage' },
    { course: 'Computer Networks', code: 'CS306', percent: 78, classes_attended: 27, total: 35, threshold: 75, status: 'ok' },
    { course: 'Operating Systems', code: 'CS307', percent: 71, classes_attended: 24, total: 34, threshold: 75, status: 'watch' },
    { course: 'Theory of Computation', code: 'CS308', percent: 88, classes_attended: 30, total: 34, threshold: 75, status: 'ok' },
  ];
}

// Returns notice-like text blocks the extraction engine will structure.
export function notices(now = new Date()) {
  return [
    {
      id: 'NOT-2041',
      source: 'portal',
      text: `MANDATORY: End-Semester Examination fee payment. Last date to pay the exam fee is ${isoIST(addDays(now, 2)).slice(0, 10)}. Students who fail to pay by the last date will be debarred from writing the end-semester examinations. Applies to all branches, all years.`,
    },
    {
      id: 'NOT-2042',
      source: 'portal',
      text: `Attendance shortage warning — CSE 3rd year, Section A. Your attendance in DBMS (CS305) has dropped to 62%, below the mandatory 75%. You must attend the next 3 DBMS classes to avoid being debarred from the exam.`,
    },
    {
      id: 'NOT-2043',
      source: 'portal',
      text: `DBMS Mini-Project final review for CSE 3rd year is scheduled on ${isoIST(addDays(now, 5), 10, 0).slice(0, 10)} at 10:00 AM in Lab 4. All teams must submit the project report and demo. Late submissions will not be evaluated.`,
    },
    {
      id: 'NOT-2044',
      source: 'portal',
      text: `Campus placement drive: TechCorp will conduct an on-campus recruitment drive for all CSE and IT final-year and pre-final-year students on ${isoIST(addDays(now, 5), 9, 30).slice(0, 10)} at 9:30 AM. Registration on the placement portal closes ${isoIST(addDays(now, 3)).slice(0, 10)}. CTC up to 12 LPA.`,
    },
    {
      id: 'NOT-2045',
      source: 'portal',
      text: `Reminder: Operating Systems assignment-3 submission due ${isoIST(addDays(now, 1), 23, 59).slice(0, 10)} 11:59 PM via the LMS. For CSE 3rd year only.`,
    },
    {
      id: 'NOT-2046',
      source: 'portal',
      text: `Optional: The Robotics Club is hosting an Arduino workshop on ${isoIST(addDays(now, 8), 16, 0).slice(0, 10)} at 4:00 PM in the Innovation Lab. Open to all interested students. FYI.`,
    },
  ];
}

export function deadlines(now = new Date()) {
  return [
    { title: 'OS Assignment-3', course: 'Operating Systems', due: isoIST(addDays(now, 1), 23, 59), type: 'assignment' },
    { title: 'Exam fee payment', course: '—', due: isoIST(addDays(now, 2)), type: 'exam_fee' },
    { title: 'Placement registration (TechCorp)', course: '—', due: isoIST(addDays(now, 3)), type: 'registration' },
    { title: 'DBMS Mini-Project review', course: 'DBMS', due: isoIST(addDays(now, 5), 10, 0), type: 'project' },
  ];
}

export function exams(now = new Date()) {
  return [
    { course: 'DBMS', code: 'CS305', date: isoIST(addDays(now, 14), 9, 30), type: 'exam' },
    { course: 'Computer Networks', code: 'CS306', date: isoIST(addDays(now, 16), 9, 30), type: 'exam' },
    { course: 'Operating Systems', code: 'CS307', date: isoIST(addDays(now, 18), 9, 30), type: 'exam' },
  ];
}

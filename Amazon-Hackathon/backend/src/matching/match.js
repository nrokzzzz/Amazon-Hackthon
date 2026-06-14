// Matching / personalization layer (Feature 7).
// Rule: event.audience.branch in {student.branch, "all"}
//       AND year matches derived current_year (or audience.year == "all")
//       AND (section matches OR audience.section unset/"all").

function norm(v) {
  return String(v ?? '').trim().toLowerCase();
}

export function matchesStudent(event, student, now = new Date()) {
  const aud = event.audience || {};

  // Branch
  const branchOk = norm(aud.branch) === 'all' || norm(aud.branch) === norm(student.branch);
  if (!branchOk) return false;

  // Year (derived)
  const studentYear = student.currentYear ? student.currentYear(now) : student.current_year;
  const yearOk =
    aud.year === 'all' ||
    norm(aud.year) === 'all' ||
    Number(aud.year) === Number(studentYear);
  if (!yearOk) return false;

  // Section (optional on both sides)
  const sectionOk =
    !aud.section ||
    norm(aud.section) === 'all' ||
    !student.section ||
    norm(aud.section) === norm(student.section);
  if (!sectionOk) return false;

  return true;
}

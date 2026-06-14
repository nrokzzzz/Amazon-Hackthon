// Rule-based categorizer used when Gemini isn't configured, so the whole
// feature (categorize -> store -> chatbot) is demoable offline. Same output
// contract as the LLM path: an array of { category, title, summary, datetime, details }.

const CATEGORY_RULES = [
  // Fees first so "exam fee" / "supplementary fee" beat the exam_timetable rule.
  { category: 'fees', re: /\bfees?\b|supplementary\s*fee|re[-\s]?exam\s*fee|tuition|fine\b|dues\b|last\s*date.*(?:pay|fee)|pay(?:ment)?\b/i },
  { category: 'exam_timetable', re: /\bexam\b|hall\s*ticket|mid[-\s]?sem|end[-\s]?sem|semester\s*exam|examination/i },
  { category: 'assignment_deadlines', re: /assignment|submission|lab\s*record|project\s*review|due\s*date|submit\b/i },
  { category: 'attendance', re: /attendance|debar|shortage|condonation|below\s*\d+%/i },
  { category: 'placement_prep', re: /placement|recruit|drive|pre[-\s]?placement|company|interview|aptitude|ctc|package/i },
  { category: 'transport', re: /\bbus\b|transport|shuttle|route\s*no|pick[-\s]?up|drop\b/i },
  { category: 'hostel_notices', re: /hostel|mess\b|warden|room\s*allot|block\s*[a-z]\b/i },
  { category: 'club_events', re: /\bclub\b|fest\b|hackathon|workshop|seminar|webinar|cultural|tech(?:nical)?\s*event|meetup/i },
  { category: 'class_timetable', re: /time\s*table|timetable|class\s*schedule|lecture|reschedul|class\s*cancel/i },
];

function classify(text) {
  for (const r of CATEGORY_RULES) if (r.re.test(text)) return r.category;
  return 'general';
}

// dd/mm/yyyy, yyyy-mm-dd, "25th March" -> ISO with +05:30, else null.
function detectDate(text, now) {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T09:00:00+05:30`;
  const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (dmy) {
    const d = String(dmy[1]).padStart(2, '0');
    const mo = String(dmy[2]).padStart(2, '0');
    const y = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${y}-${mo}-${d}T09:00:00+05:30`;
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mm = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?(${months.join('|')})[a-z]*`, 'i'));
  if (mm) {
    const day = String(mm[1]).padStart(2, '0');
    const monIdx = months.indexOf(mm[2].toLowerCase().slice(0, 3));
    const yearMatch = text.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
    return `${year}-${String(monIdx + 1).padStart(2, '0')}-${day}T09:00:00+05:30`;
  }
  return null;
}

function firstLine(text) {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || text.trim();
  return line.length > 90 ? line.slice(0, 87) + '…' : line;
}

export function fallbackCategorize(rawText, now = new Date()) {
  const blocks = rawText
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const chunks = blocks.length ? blocks : [rawText];

  return chunks.map((chunk) => ({
    category: classify(chunk),
    title: firstLine(chunk),
    summary: chunk.length > 240 ? chunk.slice(0, 237) + '…' : chunk,
    datetime: detectDate(chunk, now),
    details: {},
  }));
}

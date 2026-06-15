// Rule-based fallback extractor. Runs when Bedrock is not configured so the
// ENTIRE pipeline (extract -> match -> prioritize -> sync) is demoable offline.
// Same output contract as the LLM path: an array of extracted-event objects.

const TYPE_RULES = [
  { type: 'exam_fee', importance: 'critical', re: /exam\s*fee|examination\s*fee|fee\s*(payment|deadline|last date)/i },
  { type: 'attendance', importance: 'critical', re: /attendance|debar|shortage|below\s*\d+%/i },
  { type: 'placement', importance: 'critical', re: /placement|recruit|drive|interview|company|ctc|package/i },
  { type: 'exam', importance: 'critical', re: /\bexam\b|mid[-\s]?sem|end[-\s]?sem|semester examination|viva/i },
  { type: 'assignment', importance: 'high', re: /assignment|submission|submit/i },
  // Match lab *work*, not the word "Lab" as a room name (e.g. "Innovation Lab").
  { type: 'lab', importance: 'high', re: /lab\s*(submission|record|report|assignment|manual|exam|test)|practical/i },
  { type: 'project', importance: 'high', re: /project|review|presentation|capstone/i },
  { type: 'registration', importance: 'high', re: /registration|register|enroll|course\s*selection|elective/i },
  { type: 'workshop', importance: 'med', re: /workshop|seminar|webinar|hackathon|bootcamp/i },
  { type: 'class', importance: 'med', re: /\bclass\b|lecture|tutorial/i },
  { type: 'event', importance: 'med', re: /fest|event|celebration|club|meetup/i },
];

const CRITICAL_LANG = /mandatory|last date|will be debarred|debar|fine|penalty|compulsory|failing which/i;
const OPTIONAL_LANG = /\boptional\b|\bfyi\b|if interested|open to all|voluntary/i;

const BRANCHES = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AIML', 'AIDS'];

function detectType(text) {
  for (const r of TYPE_RULES) if (r.re.test(text)) return { type: r.type, importance: r.importance };
  return { type: 'notice', importance: 'low' };
}

function detectBranch(text) {
  const upper = text.toUpperCase();
  for (const b of BRANCHES) {
    if (new RegExp(`\\b${b}\\b`).test(upper)) return b;
  }
  if (/computer\s*science/i.test(text)) return 'CSE';
  if (/electronics/i.test(text)) return 'ECE';
  return 'all';
}

function detectYear(text) {
  const m = text.match(/\b([1-4])(?:st|nd|rd|th)?\s*[- ]?\s*year\b/i);
  if (m) return Number(m[1]);
  const sem = text.match(/\bsem(?:ester)?\s*([1-8])\b/i);
  if (sem) return Math.ceil(Number(sem[1]) / 2);
  return 'all';
}

function detectSection(text) {
  const m = text.match(/\bsec(?:tion)?\s*[-:]?\s*([A-D])\b/i);
  return m ? m[1].toUpperCase() : 'all';
}

function detectCourse(text) {
  const known = ['DBMS', 'CN', 'OS', 'DAA', 'TOC', 'COA', 'OOPS', 'DSA', 'AI', 'ML', 'CD'];
  const upper = text.toUpperCase();
  for (const c of known) if (new RegExp(`\\b${c}\\b`).test(upper)) return c;
  return '';
}

// Parse the most plausible future-ish datetime out of free text.
function detectDatetime(text, now) {
  // ISO / yyyy-mm-dd
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (iso) {
    const [, y, mo, d, h = '09', mi = '00'] = iso;
    return isoIST(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  }

  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (dmy) {
    let [, d, mo, y] = dmy;
    y = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    return isoIST(y, Number(mo) - 1, Number(d), 9, 0);
  }

  // "25th March", "March 25", "Mar 25 2026"
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?(${months.join('|')})[a-z]*\\b`, 'i');
  let mm = text.match(monthRe);
  if (!mm) {
    const monthFirst = new RegExp(`\\b(${months.join('|')})[a-z]*\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
    const mf = text.match(monthFirst);
    if (mf) mm = [mf[0], mf[2], mf[1]];
  }
  if (mm) {
    const day = Number(mm[1]);
    const monIdx = months.indexOf(mm[2].toLowerCase().slice(0, 3));
    const yearMatch = text.match(/\b(20\d{2})\b/);
    let year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
    // If the date already passed this year, assume next year.
    const candidate = new Date(year, monIdx, day);
    if (!yearMatch && candidate < now) year += 1;
    const hour = detectHour(text);
    return isoIST(year, monIdx, day, hour.h, hour.m);
  }

  // relative: today / tomorrow / "in N days"
  if (/\btomorrow\b/i.test(text)) return relIST(now, 1, text);
  if (/\btoday\b/i.test(text)) return relIST(now, 0, text);
  const inDays = text.match(/\bin\s*(\d+)\s*days?\b/i);
  if (inDays) return relIST(now, Number(inDays[1]), text);

  return null;
}

function detectHour(text) {
  const t = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (t) {
    let h = Number(t[1]) % 12;
    if (/pm/i.test(t[3])) h += 12;
    return { h, m: t[2] ? Number(t[2]) : 0 };
  }
  return { h: 9, m: 0 };
}

// Build an ISO string with +05:30 (India) offset from local Y/M/D/H/Min.
function isoIST(y, mo, d, h, mi) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+05:30`;
}

function relIST(now, addDays, text) {
  const base = new Date(now.getTime() + addDays * 86400000);
  const hour = detectHour(text);
  return isoIST(base.getFullYear(), base.getMonth(), base.getDate(), hour.h, hour.m);
}

function firstLine(text) {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || text.trim();
  return line.length > 90 ? line.slice(0, 87) + '…' : line;
}

export function fallbackExtract(rawText, now = new Date()) {
  // Split on blank lines so one paste with several notices yields several events.
  const blocks = rawText
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const chunks = blocks.length ? blocks : [rawText];

  return chunks.map((chunk) => {
    const { type, importance: baseImp } = detectType(chunk);
    let importance = baseImp;
    // Escalate to critical if the language signals severe consequence.
    if (CRITICAL_LANG.test(chunk)) importance = 'critical';
    // Downgrade clearly optional/FYI items (unless they carry a hard consequence).
    else if (OPTIONAL_LANG.test(chunk)) importance = 'low';
    return {
      title: firstLine(chunk),
      description: chunk.length > 240 ? chunk.slice(0, 237) + '…' : chunk,
      type,
      course: detectCourse(chunk),
      datetime: detectDatetime(chunk, now),
      audience: {
        branch: detectBranch(chunk),
        year: detectYear(chunk),
        section: detectSection(chunk),
      },
      importance,
    };
  });
}

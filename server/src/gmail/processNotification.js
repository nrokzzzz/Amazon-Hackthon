import { config } from '../config/env.js';
import { Student } from '../models/Student.js';
import { RawItem, hashContent } from '../models/RawItem.js';
import { processRawItem } from '../pipeline/processItem.js';
import { gmailForStudent } from './gmailClient.js';
import { collectAttachments } from './attachments.js';
import { categorizeAndStore } from '../digest/store.js';

// ---- helpers -------------------------------------------------------------

// Gmail uses base64url (no padding) for body data.
function decodeB64Url(data) {
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function headerValue(headers = [], name) {
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

// Pull a bare email address out of a "From" header like: Name <a@b.com>.
function parseAddress(from) {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

// Walk the MIME tree and return the best text we can (prefer text/plain).
function extractBody(payload) {
  if (!payload) return '';
  const plain = [];
  const html = [];

  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    const data = part.body?.data;
    if (data) {
      if (mime === 'text/plain') plain.push(decodeB64Url(data));
      else if (mime === 'text/html') html.push(decodeB64Url(data));
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);

  if (plain.length) return plain.join('\n');
  if (html.length) {
    // Crude HTML -> text so the extractor gets readable content.
    return html
      .join('\n')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+\n/g, '\n')
      .trim();
  }
  return '';
}

const ALLOWED = () => config.gmail.allowedSenders || [];

function isAllowedSender(fromAddr) {
  return ALLOWED().includes(fromAddr);
}

// Ingest one piece of email text for a student (deduped by content hash),
// then run it through the existing extract -> match -> prioritize pipeline.
async function ingestEmailText(student, text, now = new Date()) {
  const clean = String(text || '').trim();
  if (!clean) return { skipped: true, reason: 'empty' };

  const content_hash = hashContent(clean);
  const existing = await RawItem.findOne({ student_id: student._id, content_hash });
  if (existing) return { skipped: true, reason: 'duplicate' };

  const item = await RawItem.create({
    student_id: student._id,
    source: 'email',
    raw_text: clean,
    content_hash,
    status: 'pending',
  });
  const result = await processRawItem(item, now);
  return { skipped: false, raw_item_id: item._id, ...result };
}

// ---- main ----------------------------------------------------------------

// Entry point for a decoded Pub/Sub notification: { emailAddress, historyId }.
// Resolves the student by their connected Google account, then reads the new
// history. Only mail FROM an allowed sender is ingested.
export async function handlePubSubNotification({ emailAddress, historyId }) {
  if (!emailAddress) return { ok: false, reason: 'no_email_address' };

  const student = await Student.findOne({ 'gcal.email': String(emailAddress).toLowerCase() });
  if (!student) return { ok: false, reason: 'no_matching_student', emailAddress };

  return processHistory(student, String(historyId));
}

// Read Gmail history since the student's last processed historyId, fetch each
// newly added message, filter by sender, and ingest matches.
export async function processHistory(student, newHistoryId) {
  const gmail = gmailForStudent(student);
  const startHistoryId = student.gmail?.history_id;

  // First notification ever (or watch reset): we have no baseline to diff
  // against, so just record the cursor and wait for the next change.
  if (!startHistoryId) {
    student.gmail = student.gmail || {};
    student.gmail.history_id = newHistoryId;
    await student.save();
    return { ok: true, ingested: 0, reason: 'baseline_set' };
  }

  // Collect all newly-added message ids across history pages.
  const messageIds = new Set();
  let pageToken;
  try {
    do {
      const { data } = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
        pageToken,
      });
      for (const h of data.history || []) {
        for (const added of h.messagesAdded || []) {
          if (added.message?.id) messageIds.add(added.message.id);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    // A 404 means startHistoryId is too old/expired — reset the cursor.
    if (err?.code === 404 || err?.response?.status === 404) {
      student.gmail = student.gmail || {};
      student.gmail.history_id = newHistoryId;
      await student.save();
      return { ok: true, ingested: 0, reason: 'history_expired_reset' };
    }
    throw err;
  }

  let ingested = 0;
  let skipped = 0;
  let categorized = 0;
  let calendarEvents = 0;
  const results = [];

  for (const id of messageIds) {
    try {
      const { data: msg } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const headers = msg.payload?.headers || [];
      const fromAddr = parseAddress(headerValue(headers, 'From'));

      // Only ingest mail FROM an allowed (college) sender.
      if (!isAllowedSender(fromAddr)) {
        skipped++;
        continue;
      }

      const subject = headerValue(headers, 'Subject');
      const body = extractBody(msg.payload) || msg.snippet || '';

      // Read ALL attachments (timetables, exam schedules, holiday lists):
      //  - PDFs & images go to Gemini as native files (it reads/OCRs them)
      //  - docx / xlsx / csv / txt / html are extracted to text here
      const { files, text: attachText, names } = await collectAttachments(gmail, id, msg.payload).catch(() => ({
        files: [],
        text: '',
        names: [],
      }));

      const text = [
        subject ? `Subject: ${subject}` : '',
        body,
        attachText,
      ]
        .filter(Boolean)
        .join('\n\n');

      // (1) Structured digest — the new categorize-into-CollegeInfo feature.
      let digest = {};
      try {
        digest = await categorizeAndStore(student, { text, files, source: 'gmail', subject, emailId: id });
        categorized += digest.added || 0;
        calendarEvents += digest.calendar_events || 0;
      } catch (err) {
        digest = { error: String(err?.message || err) };
      }

      // (2) Calendar events — existing pipeline, kept alongside (best-effort).
      let events = {};
      try {
        events = await ingestEmailText(student, text);
        if (events.skipped) skipped++;
        else ingested++;
      } catch (err) {
        events = { error: String(err?.message || err) };
      }

      results.push({ id, from: fromAddr, attachments: names, digest, events });
    } catch (err) {
      results.push({ id, error: String(err?.message || err) });
    }
  }

  // Advance the cursor so the next notification only sees newer mail.
  student.gmail = student.gmail || {};
  student.gmail.history_id = newHistoryId;
  await student.save();

  return { ok: true, ingested, categorized, calendarEvents, skipped, considered: messageIds.size, results };
}

import { config } from '../config/env.js';
import { GoogleConnection } from '../models/GoogleConnection.js';
import { gmailForConnection } from '../google/googleClient.js';
import { collectAttachments } from './attachments.js';
import { produce, TOPIC_EMAIL_RECEIVED } from '../kafka/kafka.js';

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
    // Crude HTML -> text so downstream gets readable content.
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

// ---- main ----------------------------------------------------------------

// Entry point for a decoded Pub/Sub notification: { emailAddress, historyId }.
// Resolves the connection by the connected Google account, then reads the new
// history. Only mail FROM an allowed sender is produced downstream.
export async function handlePubSubNotification({ emailAddress, historyId }) {
  if (!emailAddress) return { ok: false, reason: 'no_email_address' };

  const conn = await GoogleConnection.findOne({ googleEmail: String(emailAddress).toLowerCase() });
  if (!conn) return { ok: false, reason: 'no_matching_connection', emailAddress };
  if (!conn.refresh_token) return { ok: false, reason: 'not_connected', emailAddress };

  return processHistory(conn, String(historyId));
}

// Read Gmail history since the connection's last processed historyId, fetch each
// newly added message, filter by sender, and PRODUCE an email.received message.
export async function processHistory(conn, newHistoryId) {
  const gmail = gmailForConnection(conn);
  const startHistoryId = conn.gmail?.history_id;

  // First notification ever (or watch reset): we have no baseline to diff
  // against, so just record the cursor and wait for the next change.
  if (!startHistoryId) {
    conn.gmail = conn.gmail || {};
    conn.gmail.history_id = newHistoryId;
    await conn.save();
    return { ok: true, produced: 0, reason: 'baseline_set' };
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
      conn.gmail = conn.gmail || {};
      conn.gmail.history_id = newHistoryId;
      await conn.save();
      return { ok: true, produced: 0, reason: 'history_expired_reset' };
    }
    throw err;
  }

  let produced = 0;
  let skipped = 0;
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

      // Only produce mail FROM an allowed (college) sender.
      if (!isAllowedSender(fromAddr)) {
        skipped++;
        continue;
      }

      const subject = headerValue(headers, 'Subject');
      const body = extractBody(msg.payload) || msg.snippet || '';

      // Read ALL attachments (timetables, exam schedules, holiday lists):
      //  - PDFs & images -> native base64 files (the categorizer reads/OCRs them)
      //  - docx / xlsx / csv / txt / html / pptx -> extracted to text here
      const { files, text: attachText, names } = await collectAttachments(gmail, id, msg.payload).catch(() => ({
        files: [],
        text: '',
        names: [],
      }));

      const text = [subject ? `Subject: ${subject}` : '', body, attachText]
        .filter(Boolean)
        .join('\n\n');

      // PRODUCE one email.received message. Categorization happens downstream.
      const message = {
        userId: conn.userId,
        googleEmail: conn.googleEmail,
        messageId: id,
        subject,
        from: fromAddr,
        text,
        files, // [{ filename, mimeType, data(base64) }]
        receivedAt: new Date().toISOString(),
      };
      const ok = await produce(TOPIC_EMAIL_RECEIVED, message, conn.userId);
      if (ok) {
        produced++;
        console.log(
          `[gmail] produced email.received userId=${conn.userId} messageId=${id} from=${fromAddr} files=${files.length} subject="${subject}"`
        );
      } else {
        console.error(`[gmail] failed to produce email.received for messageId=${id}`);
      }
      results.push({ id, from: fromAddr, attachments: names, produced: ok });
    } catch (err) {
      results.push({ id, error: String(err?.message || err) });
    }
  }

  // Advance the cursor so the next notification only sees newer mail.
  conn.gmail = conn.gmail || {};
  conn.gmail.history_id = newHistoryId;
  await conn.save();

  return { ok: true, produced, skipped, considered: messageIds.size, results };
}

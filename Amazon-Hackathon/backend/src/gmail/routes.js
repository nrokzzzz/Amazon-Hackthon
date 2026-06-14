import express from 'express';
import { config, isGmailConfigured, isGoogleConfigured } from '../config/env.js';
import { requireAuth } from '../auth/jwt.js';
import { startWatch, stopWatch } from './watch.js';
import { handlePubSubNotification } from './processNotification.js';

export const gmailRouter = express.Router();

// POST /gmail/watch — start watching the logged-in student's inbox.
// Requires the student to have connected Google (with gmail.readonly scope).
gmailRouter.post('/watch', requireAuth, async (req, res) => {
  if (!isGmailConfigured()) {
    return res.status(503).json({
      error: 'gmail_not_configured',
      message: 'Set GOOGLE_CLIENT_ID/SECRET and GMAIL_PUBSUB_TOPIC in backend/.env.',
    });
  }
  if (!req.student.gcal?.refresh_token) {
    return res.status(400).json({
      error: 'google_not_connected',
      message: 'Connect Google Calendar first (and re-consent to grant Gmail access).',
    });
  }
  try {
    const data = await startWatch(req.student);
    res.json({ ok: true, history_id: data.historyId, expiration: data.expiration });
  } catch (err) {
    const detail = googleErr(err);
    console.error('[gmail] watch failed:', detail);
    res.status(500).json({ error: 'watch_failed', message: detail });
  }
});

// Pull the human-readable message out of a googleapis error.
function googleErr(err) {
  return (
    err?.response?.data?.error?.message ||
    err?.errors?.[0]?.message ||
    err?.message ||
    String(err)
  );
}

// POST /gmail/stop — stop watching.
gmailRouter.post('/stop', requireAuth, async (req, res) => {
  try {
    await stopWatch(req.student);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'stop_failed', message: String(err?.message || err) });
  }
});

// GET /gmail/status — watch state for the UI.
gmailRouter.get('/status', requireAuth, (req, res) => {
  res.json({
    google_configured: isGoogleConfigured(), // can we run the OAuth connect flow?
    gmail_configured: isGmailConfigured(), // is Pub/Sub push set up?
    configured: isGmailConfigured(), // backward-compat alias
    connected: Boolean(req.student.gcal?.refresh_token), // Google account linked?
    email: req.student.gcal?.email || null,
    calendar_connected: Boolean(req.student.gcal?.connected),
    watching: Boolean(req.student.gmail?.watching), // Gmail push active?
    expiration: req.student.gmail?.watch_expiration || null,
    allowed_senders: config.gmail.allowedSenders,
  });
});

// POST /gmail/pubsub — Google Cloud Pub/Sub push endpoint (PUBLIC, no auth).
// Secured by a shared token in the query string (?token=...) that must match
// GMAIL_PUBSUB_TOKEN. The body is the standard Pub/Sub push envelope:
//   { message: { data: <base64 JSON>, messageId, ... }, subscription }
// The decoded data is { emailAddress, historyId }.
gmailRouter.post('/pubsub', async (req, res) => {
  // Verify the shared secret if one is configured.
  if (config.gmail.pubsubToken && req.query.token !== config.gmail.pubsubToken) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  // ACK fast. Pub/Sub retries on non-2xx, so we always 204 once the envelope is
  // well-formed and do the work after responding (or before — it's quick).
  const data = req.body?.message?.data;
  if (!data) return res.status(204).end();

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
  } catch {
    return res.status(204).end(); // malformed — drop it, don't make Pub/Sub retry forever
  }

  // Respond immediately, then process. Errors are logged, not retried, to avoid
  // duplicate ingestion storms (ingestion is deduped by content hash anyway).
  res.status(204).end();
  try {
    const result = await handlePubSubNotification(payload);
    if (result?.categorized || result?.ingested) {
      console.log(
        `[gmail] ${payload.emailAddress}: +${result.categorized || 0} digest item(s), ` +
          `${result.ingested || 0} event email(s)`
      );
    }
  } catch (err) {
    console.error('[gmail] pubsub processing error:', err?.message || err);
  }
});

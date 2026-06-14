import express from 'express';
import jwt from 'jsonwebtoken';
import { config, isGoogleConfigured, isGmailConfigured } from './config/env.js';
import { GoogleConnection } from './models/GoogleConnection.js';
import { getAuthUrl, makeOAuthClient } from './google/googleClient.js';
import { startWatch, stopWatch } from './gmail/watch.js';
import { handlePubSubNotification } from './gmail/processNotification.js';

export const router = express.Router();

// Identity middleware for authed routes: the gateway forwards 'x-user-id'.
function requireUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  req.userId = String(userId);
  next();
}

// ---- OAuth ---------------------------------------------------------------

// GET /auth/google/connect — returns the consent URL (frontend redirects to it).
// We pass an app JWT (carrying the userId) as OAuth `state` to identify the user
// on callback.
router.get('/auth/google/connect', requireUser, (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({
      error: 'google_not_configured',
      message:
        'Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable Google Calendar + Gmail sync.',
    });
  }
  const state = jwt.sign({ sub: req.userId }, config.jwtSecret, { expiresIn: '15m' });
  res.json({ url: getAuthUrl(state) });
});

// GET /auth/google/callback — PUBLIC. Google redirects here with ?code & ?state.
// Exchange the code, store the refresh token, then bounce back to the frontend.
router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirect = (status) => res.redirect(`${config.frontendUrl}/profile?gcal=${status}`);

  if (error || !code || !state) return redirect('error');
  try {
    const payload = jwt.verify(String(state), config.jwtSecret);
    const userId = String(payload.sub);

    const client = makeOAuthClient();
    const { tokens } = await client.getToken(String(code));

    // Fetch the connected Google account email (used to match Pub/Sub pushes).
    let email;
    try {
      client.setCredentials(tokens);
      const oauth2 = (await import('googleapis')).google.oauth2({ version: 'v2', auth: client });
      const me = await oauth2.userinfo.get();
      email = me.data.email;
    } catch {
      /* non-fatal */
    }

    const update = {
      userId,
      googleEmail: email ? String(email).toLowerCase() : undefined,
      calendar_id: 'primary',
    };
    if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;

    const conn = await GoogleConnection.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Auto-start the Gmail watch so college emails start flowing immediately
    // after connect (best-effort — the user can retry from Profile).
    if (isGmailConfigured() && conn.refresh_token) {
      try {
        await startWatch(conn);
      } catch (err) {
        console.error('[gmail] auto-watch failed after connect:', err?.message || err);
      }
    }

    return redirect('connected');
  } catch {
    return redirect('error');
  }
});

// POST /auth/google/disconnect — stop the Gmail watch and forget the Google
// connection for this user.
router.post('/auth/google/disconnect', requireUser, async (req, res) => {
  const conn = await GoogleConnection.findOne({ userId: req.userId });
  if (!conn) return res.json({ ok: true });

  try {
    if (conn.gmail?.watching && conn.refresh_token) await stopWatch(conn);
  } catch (err) {
    console.error('[gmail] stopWatch on disconnect failed:', err?.message || err);
  }
  conn.refresh_token = undefined;
  conn.gmail = conn.gmail || {};
  conn.gmail.watching = false;
  conn.gmail.history_id = undefined;
  conn.gmail.watch_expiration = undefined;
  await conn.save();
  res.json({ ok: true });
});

// ---- Gmail status + watch -------------------------------------------------

// GET /gmail/status — connection + watch state for the UI.
router.get('/gmail/status', requireUser, async (req, res) => {
  const conn = await GoogleConnection.findOne({ userId: req.userId });
  res.json({
    google_configured: isGoogleConfigured(),
    gmail_configured: isGmailConfigured(),
    connected: Boolean(conn?.refresh_token),
    email: conn?.googleEmail || null,
    calendar_connected: Boolean(conn?.refresh_token),
    watching: Boolean(conn?.gmail?.watching),
    expiration: conn?.gmail?.watch_expiration || null,
    allowed_senders: config.gmail.allowedSenders,
  });
});

// POST /gmail/watch — start (or restart) the Gmail watch.
router.post('/gmail/watch', requireUser, async (req, res) => {
  const conn = await GoogleConnection.findOne({ userId: req.userId });
  if (!conn || !conn.refresh_token) {
    return res.status(400).json({ error: 'not_connected', message: 'Connect Google first.' });
  }
  try {
    const data = await startWatch(conn);
    res.json({ ok: true, history_id: String(data.historyId), expiration: Number(data.expiration) });
  } catch (err) {
    const message = err?.errors?.[0]?.message || err?.response?.data?.error || err?.message || String(err);
    console.error('[gmail] watch failed:', message);
    res.status(500).json({ error: 'watch_failed', message: String(message) });
  }
});

// POST /gmail/stop — stop the Gmail watch.
router.post('/gmail/stop', requireUser, async (req, res) => {
  const conn = await GoogleConnection.findOne({ userId: req.userId });
  if (!conn || !conn.refresh_token) {
    return res.status(400).json({ error: 'not_connected' });
  }
  try {
    await stopWatch(conn);
    res.json({ ok: true });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[gmail] stop failed:', message);
    res.status(500).json({ error: 'stop_failed', message: String(message) });
  }
});

// POST /gmail/pubsub — PUBLIC webhook. Secured by ?token=. Gmail (via Pub/Sub)
// posts an envelope: { message: { data: base64(JSON { emailAddress, historyId }) } }.
// We RESPOND 204 immediately, then process asynchronously.
router.post('/gmail/pubsub', (req, res) => {
  if (config.gmail.pubsubToken) {
    const token = req.query.token;
    if (token !== config.gmail.pubsubToken) {
      return res.status(401).json({ error: 'bad_token' });
    }
  }

  // Decode the Pub/Sub envelope.
  let decoded = null;
  try {
    const data = req.body?.message?.data;
    if (data) {
      const json = Buffer.from(data, 'base64').toString('utf-8');
      decoded = JSON.parse(json); // { emailAddress, historyId }
    }
  } catch (err) {
    console.error('[gmail] pubsub: failed to decode envelope:', err?.message || err);
  }

  // Ack immediately so Pub/Sub doesn't retry while we work.
  res.status(204).end();

  if (!decoded?.emailAddress) return;

  // Process out-of-band; never throw into the request lifecycle.
  handlePubSubNotification(decoded)
    .then((r) => {
      if (r && r.ok && r.produced) {
        console.log(`[gmail] pubsub processed: produced=${r.produced} considered=${r.considered}`);
      }
    })
    .catch((err) => console.error('[gmail] pubsub processing error:', err?.message || err));
});

// ---- Calendar -------------------------------------------------------------

// GET /calendar/status — connection state for the UI.
router.get('/calendar/status', requireUser, async (req, res) => {
  const conn = await GoogleConnection.findOne({ userId: req.userId });
  res.json({
    configured: isGoogleConfigured(),
    connected: Boolean(conn?.refresh_token),
    email: conn?.googleEmail || null,
  });
});

// POST /calendar/sync — best-effort re-push. Calendar events are auto-upserted by
// the digest.updated consumer; there is nothing to re-pull here, so we report the
// number of tracked events. Kept present and simple.
router.post('/calendar/sync', requireUser, async (req, res) => {
  const conn = await GoogleConnection.findOne({ userId: req.userId });
  if (!conn || !conn.refresh_token) {
    return res.json({ ok: true, connected: false, tracked: 0 });
  }
  const tracked = Object.keys(conn.gcal_events || {}).length;
  res.json({ ok: true, connected: true, tracked });
});

import express from 'express';
import jwt from 'jsonwebtoken';
import { config, isGoogleConfigured, isGmailConfigured } from '../config/env.js';
import { Student } from '../models/Student.js';
import { requireAuth } from '../auth/jwt.js';
import { getAuthUrl, makeOAuthClient } from './googleClient.js';
import { syncAllForStudent } from './sync.js';
import { backfillDigestCalendar } from './digestCalendar.js';
import { startWatch, stopWatch } from '../gmail/watch.js';

export const calendarRouter = express.Router();

// NOTE: this router is mounted at root ('/') so paths are absolute.

// GET /auth/google/connect — returns the consent URL (frontend redirects to it).
// We pass the app JWT as OAuth `state` to identify the student on callback.
calendarRouter.get('/auth/google/connect', requireAuth, (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({
      error: 'google_not_configured',
      message: 'Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env to enable Calendar sync.',
    });
  }
  const state = jwt.sign({ sub: String(req.student._id) }, config.jwtSecret, { expiresIn: '15m' });
  res.json({ url: getAuthUrl(state) });
});

// GET /auth/google/callback — Google redirects here with ?code & ?state.
// Exchange the code, store the refresh token, then bounce back to the frontend.
calendarRouter.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const redirect = (status) => res.redirect(`${config.frontendUrl}/profile?gcal=${status}`);

  if (error || !code || !state) return redirect('error');
  try {
    const payload = jwt.verify(String(state), config.jwtSecret);
    const student = await Student.findById(payload.sub);
    if (!student) return redirect('error');

    const client = makeOAuthClient();
    const { tokens } = await client.getToken(String(code));

    // Fetch the connected Google account email (nice for the UI).
    let email;
    try {
      client.setCredentials(tokens);
      const oauth2 = (await import('googleapis')).google.oauth2({ version: 'v2', auth: client });
      const me = await oauth2.userinfo.get();
      email = me.data.email;
    } catch { /* non-fatal */ }

    student.gcal.connected = true;
    if (tokens.refresh_token) student.gcal.refresh_token = tokens.refresh_token;
    student.gcal.email = email;
    student.gcal.calendar_id = 'primary';
    await student.save();

    // Auto-start the Gmail watch so college emails start flowing immediately
    // after the student connects (best-effort — they can retry from Profile).
    if (isGmailConfigured()) {
      try {
        await startWatch(student);
      } catch (err) {
        console.error('[gmail] auto-watch failed after connect:', err?.message || err);
      }
    }

    // Backfill the calendar with any dated items captured before connecting, so
    // everything lands on Google Calendar automatically (best-effort).
    try {
      const r = await backfillDigestCalendar(student);
      if (r.created) console.log(`[calendar] backfilled ${r.created} event(s) on connect for ${student.email}`);
    } catch (err) {
      console.error('[calendar] backfill after connect failed:', err?.message || err);
    }

    return redirect('connected');
  } catch {
    return redirect('error');
  }
});

// POST /auth/google/disconnect — stop the Gmail watch and forget the Google
// connection for this student.
calendarRouter.post('/auth/google/disconnect', requireAuth, async (req, res) => {
  const student = req.student;
  try {
    if (student.gmail?.watching) await stopWatch(student);
  } catch (err) {
    console.error('[gmail] stopWatch on disconnect failed:', err?.message || err);
  }
  student.gcal.connected = false;
  student.gcal.refresh_token = undefined;
  student.gcal.email = undefined;
  if (student.gmail) {
    student.gmail.watching = false;
    student.gmail.history_id = undefined;
    student.gmail.watch_expiration = undefined;
  }
  await student.save();
  res.json({ ok: true });
});

// POST /calendar/sync — push this student's matched/prioritized events to GCal.
calendarRouter.post('/calendar/sync', requireAuth, async (req, res) => {
  try {
    const summary = await syncAllForStudent(req.student);
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: 'sync_failed', message: String(err?.message || err) });
  }
});

// GET /calendar/status — connection state for the UI.
calendarRouter.get('/calendar/status', requireAuth, (req, res) => {
  res.json({
    configured: isGoogleConfigured(),
    connected: Boolean(req.student.gcal?.connected),
    email: req.student.gcal?.email || null,
  });
});

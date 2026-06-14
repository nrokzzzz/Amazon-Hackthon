// HTTP-level integration test: boots the real Express app against an in-memory
// MongoDB and exercises the full request flow a browser would make.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;
const PORT = 4111;
const BASE = `http://localhost:${PORT}`;

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form; // FormData
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('✓ ' + msg);
}

async function main() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('campusflow');
  process.env.JWT_SECRET = 'http-secret';
  process.env.PORT = String(PORT);
  delete process.env.BEDROCK_API_KEY;
  delete process.env.BEDROCK_MODEL_ID;

  const { connectDB } = await import('../config/db.js');
  const { app } = await import('../server.js');
  await connectDB();
  const server = app.listen(PORT);
  await new Promise((r) => server.on('listening', r));

  // health
  const health = await req('GET', '/health');
  assert(health.status === 200 && health.data.ok, 'GET /health ok');
  assert(health.data.extraction.startsWith('fallback'), 'health reports fallback extraction');

  // register
  const reg = await req('POST', '/auth/register', {
    body: {
      name: 'Asha R', email: 'asha@example.com', password: 'secret123',
      branch: 'CSE', roll_no: '21CS045', passout_year: 2027, section: 'A',
      profile: { focus_subjects: ['DBMS'], goals: ['placement'] },
    },
  });
  assert(reg.status === 201 && reg.data.token, 'POST /auth/register returns token');
  assert(reg.data.student.current_year >= 1, 'register derives current_year');
  const token = reg.data.token;

  // duplicate email rejected
  const dup = await req('POST', '/auth/register', {
    body: { name: 'x', email: 'asha@example.com', password: 'secret123', branch: 'CSE', roll_no: 'y', passout_year: 2027 },
  });
  assert(dup.status === 409, 'duplicate email rejected (409)');

  // me (auth required)
  const noauth = await req('GET', '/auth/me');
  assert(noauth.status === 401, 'GET /auth/me without token => 401');
  const me = await req('GET', '/auth/me', { token });
  assert(me.status === 200 && me.data.student.email === 'asha@example.com', 'GET /auth/me with token');

  // portal mock
  const portal = await req('GET', '/portal/all');
  assert(portal.status === 200 && portal.data.notices.length > 0, 'GET /portal/all returns notices');

  // ingest portal -> pipeline
  const ingest = await req('POST', '/ingest/portal', { token });
  assert(ingest.status === 200 && ingest.data.totals.matches > 0, 'POST /ingest/portal matched events');

  // re-ingest is idempotent (all duplicates)
  const ingest2 = await req('POST', '/ingest/portal', { token });
  assert(ingest2.data.totals.skipped > 0 && ingest2.data.totals.ingested === 0, 're-ingest skips duplicates');

  // events sorted by priority desc
  const events = await req('GET', '/events', { token });
  assert(events.status === 200 && events.data.events.length > 0, 'GET /events returns items');
  const scores = events.data.events.map((e) => e.priority_score);
  assert(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'events sorted by priority desc');
  const crit = events.data.events.find((e) => e.importance === 'critical');
  assert(crit && crit.reminder_ladder.length === 5, 'critical event has 5-rung ladder');

  // paste ingestion
  const paste = await req('POST', '/ingest/paste', {
    token,
    body: { text: 'OS lab record submission is due tomorrow 5pm for CSE 3rd year. Mandatory.', source: 'email' },
  });
  assert(paste.status === 200 && paste.data.events >= 1, 'POST /ingest/paste extracts an event');

  // control-center edit: confirm + resync (simulation)
  const first = (await req('GET', '/events', { token })).data.events[0];
  const upd = await req('PUT', `/events/${first.id}`, { token, body: { state: 'confirmed', resync: true } });
  assert(upd.status === 200 && upd.data.event.state === 'confirmed', 'PUT /events confirms');
  assert(upd.data.synced && upd.data.synced.ok, 'confirm triggers (simulated) sync');

  // calendar status + sync all
  const cal = await req('GET', '/calendar/status', { token });
  assert(cal.status === 200 && cal.data.configured === false, 'calendar status: not configured (simulation)');
  const sync = await req('POST', '/calendar/sync', { token });
  assert(sync.status === 200 && sync.data.synced > 0 && sync.data.simulated, 'POST /calendar/sync (simulation) succeeds');

  // profile update
  const prof = await req('PUT', '/profile', { token, body: { profile: { goals: ['GATE', 'placement'] } } });
  assert(prof.status === 200 && prof.data.student.profile.goals.includes('GATE'), 'PUT /profile merges enrichment');

  console.log('\nALL HTTP INTEGRATION CHECKS PASSED ✅');
  server.close();
}

main()
  .then(async () => { await mongoose.disconnect(); if (mongod) await mongod.stop(); process.exit(0); })
  .catch(async (err) => {
    console.error('\nHTTP TEST FAILED ❌\n', err);
    try { await mongoose.disconnect(); if (mongod) await mongod.stop(); } catch {}
    process.exit(1);
  });

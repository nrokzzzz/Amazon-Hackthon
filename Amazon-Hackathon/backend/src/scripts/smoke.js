// End-to-end smoke test of the CampusFlow backend pipeline using an in-memory
// MongoDB. Verifies: register -> ingest portal -> extract (fallback) -> match
// -> prioritize -> list (sorted) -> sync (simulation). Run: node src/scripts/smoke.js
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod;

async function main() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('campusflow');
  process.env.JWT_SECRET = 'smoke-secret';
  // Ensure offline mode (no Bedrock/Google).
  delete process.env.BEDROCK_API_KEY;
  delete process.env.BEDROCK_MODEL_ID;

  // Import AFTER env is set so config picks up the in-memory URI.
  const { connectDB } = await import('../config/db.js');
  const { Student } = await import('../models/Student.js');
  const { hashPassword } = await import('../auth/password.js');
  const { notices } = await import('../portal/data.js');
  const { RawItem, hashContent } = await import('../models/RawItem.js');
  const { processRawItem } = await import('../pipeline/processItem.js');
  const { StudentEvent } = await import('../models/StudentEvent.js');
  const { priorityScore } = await import('../scheduling/priority.js');
  const { syncAllForStudent } = await import('../calendar/sync.js');

  await connectDB();

  // 1. Register a CSE 3rd-year student.
  const student = await Student.create({
    name: 'Asha R',
    email: 'asha@example.com',
    passwordHash: hashPassword('secret123'),
    branch: 'CSE',
    roll_no: '21CS045',
    passout_year: 2027, // joined 2023 -> 3rd year in 2025/2026
    section: 'A',
    profile: { focus_subjects: ['DBMS'], goals: ['placement'] },
  });
  assert(student.currentYear() >= 1 && student.currentYear() <= 4, 'current_year derived in range');
  console.log(`✓ registered ${student.name} (derived current_year=${student.currentYear()})`);

  // 2. Ingest the mock portal notices through the full pipeline.
  let totalEvents = 0;
  for (const n of notices()) {
    const item = await RawItem.create({
      student_id: student._id,
      source: 'portal',
      raw_text: n.text,
      content_hash: hashContent(n.text),
      status: 'pending',
    });
    const r = await processRawItem(item);
    totalEvents += r.events;
  }
  console.log(`✓ ingested ${notices().length} portal notices -> ${totalEvents} events extracted (engine: fallback)`);

  // 3. Dedupe check — re-ingesting the same text must be rejected by unique index.
  let duped = false;
  try {
    const t = notices()[0].text;
    await RawItem.create({ student_id: student._id, source: 'portal', raw_text: t, content_hash: hashContent(t), status: 'pending' });
  } catch {
    duped = true;
  }
  assert(duped, 'content_hash dedupe prevents reprocessing the same notice');
  console.log('✓ content_hash dedupe works');

  // 4. List matched events sorted by priority.
  const ses = await StudentEvent.find({ student_id: student._id }).populate('event_id');
  assert(ses.length > 0, 'student has matched events');
  const sorted = ses
    .filter((s) => s.event_id)
    .map((s) => ({
      title: s.event_id.title.slice(0, 48),
      importance: s.event_id.importance,
      score: priorityScore(s.event_id.importance, s.event_id.datetime),
      ladder: s.reminder_ladder.length,
    }))
    .sort((a, b) => b.score - a.score);

  console.log(`✓ ${sorted.length} events matched to student. Top by priority:`);
  for (const e of sorted.slice(0, 6)) {
    console.log(`   [${e.importance.padEnd(8)}] score=${String(e.score).padStart(6)} rungs=${e.ladder}  ${e.title}`);
  }

  // 5. Critical events must use a 5-rung ladder; verify cap.
  const critical = sorted.find((e) => e.importance === 'critical');
  assert(critical && critical.ladder === 5, 'critical ladder has exactly 5 rungs');
  assert(sorted.every((e) => e.ladder <= 5), 'no ladder exceeds Google max of 5');
  console.log('✓ reminder ladders correct (critical=5, none exceed 5)');

  // 6. Matching guard — an ECE student should NOT get the CSE-only DBMS notice.
  const ece = await Student.create({
    name: 'Ravi K', email: 'ravi@example.com', passwordHash: hashPassword('x'),
    branch: 'ECE', roll_no: '21EC010', passout_year: 2027, section: 'B',
  });
  // Re-run matching against the existing events by reprocessing one CSE notice's events.
  const { matchesStudent } = await import('../matching/match.js');
  const { Event } = await import('../models/Event.js');
  const cseOnly = await Event.findOne({ 'audience.branch': 'CSE' });
  if (cseOnly) {
    assert(!matchesStudent(cseOnly, ece), 'ECE student does NOT match a CSE-only event');
    console.log('✓ personalization guard: ECE student excluded from CSE-only notice');
  }

  // 7. Calendar sync in simulation mode.
  const summary = await syncAllForStudent(student);
  assert(summary.synced > 0 && summary.simulated, 'simulated sync succeeded');
  console.log(`✓ calendar sync (simulation): ${summary.synced}/${summary.total} synced`);

  console.log('\nALL SMOKE CHECKS PASSED ✅');
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nSMOKE TEST FAILED ❌\n', err);
    try { await mongoose.disconnect(); if (mongod) await mongod.stop(); } catch {}
    process.exit(1);
  });

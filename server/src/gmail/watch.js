import { config } from '../config/env.js';
import { gmailForStudent } from './gmailClient.js';
import { setJobNextRun, removeJob } from '../jobs/schedule.js';

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // renew 24h before expiry

// Register a Gmail watch so Google publishes a notification to our Pub/Sub topic
// whenever this student's INBOX changes. Stores the baseline historyId so the
// first push knows where to start reading from. Watches expire after ~7 days and
// must be renewed by calling this again.
export async function startWatch(student) {
  if (!config.gmail.pubsubTopic) {
    throw new Error('GMAIL_PUBSUB_TOPIC is not set');
  }
  if (!student.gcal?.refresh_token) {
    throw new Error('student has not connected Google (no refresh token)');
  }

  const gmail = gmailForStudent(student);
  const { data } = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: config.gmail.pubsubTopic,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    },
  });

  student.gmail = student.gmail || {};
  student.gmail.watching = true;
  student.gmail.history_id = String(data.historyId);
  student.gmail.watch_expiration = Number(data.expiration);
  await student.save();

  // Schedule the auto-renewal to fire 24h before this watch expires (event-driven,
  // per-student — no 12h full scan of every connected student).
  try {
    const exp = Number(data.expiration || 0);
    const due = exp ? new Date(exp - RENEW_BEFORE_MS) : new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    await setJobNextRun('gmail_watch_renew', student._id, due);
  } catch (err) {
    console.error('[jobs] failed to schedule gmail_watch_renew:', err?.message || err);
  }

  return data; // { historyId, expiration }
}

// Stop receiving push notifications for this student.
export async function stopWatch(student) {
  const gmail = gmailForStudent(student);
  await gmail.users.stop({ userId: 'me' });
  student.gmail = student.gmail || {};
  student.gmail.watching = false;
  await student.save();

  // Stop the auto-renewal job — nothing to keep alive anymore.
  try {
    await removeJob('gmail_watch_renew', student._id);
  } catch (err) {
    console.error('[jobs] failed to remove gmail_watch_renew:', err?.message || err);
  }
}

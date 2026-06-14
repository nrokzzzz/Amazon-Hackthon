import { config } from '../config/env.js';
import { gmailForConnection } from '../google/googleClient.js';

// Register a Gmail watch so Google publishes a notification to our Pub/Sub topic
// whenever this connection's INBOX changes. Stores the baseline historyId so the
// first push knows where to start reading from. Watches expire after ~7 days and
// must be renewed by calling this again.
export async function startWatch(conn) {
  if (!config.gmail.pubsubTopic) {
    throw new Error('GMAIL_PUBSUB_TOPIC is not set');
  }
  if (!conn.refresh_token) {
    throw new Error('connection has not connected Google (no refresh token)');
  }

  const gmail = gmailForConnection(conn);
  const { data } = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: config.gmail.pubsubTopic,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    },
  });

  conn.gmail = conn.gmail || {};
  conn.gmail.watching = true;
  conn.gmail.history_id = String(data.historyId);
  conn.gmail.watch_expiration = Number(data.expiration);
  await conn.save();

  return data; // { historyId, expiration }
}

// Stop receiving push notifications for this connection.
export async function stopWatch(conn) {
  const gmail = gmailForConnection(conn);
  await gmail.users.stop({ userId: 'me' });
  conn.gmail = conn.gmail || {};
  conn.gmail.watching = false;
  await conn.save();
}

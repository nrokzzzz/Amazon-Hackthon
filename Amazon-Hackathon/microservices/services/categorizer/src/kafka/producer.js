import { kafka, TOPIC_DIGEST_UPDATED } from './client.js';

// Single shared producer. Connected once in the background (with a retry loop in
// index.js); publishes 'digest.updated' whenever new digest items are stored.
const producer = kafka.producer();
let connected = false;

export async function connectProducer() {
  await producer.connect();
  connected = true;
  console.log('[categorizer] kafka producer connected');
}

// Publish the items just added to a student's digest. The integration service
// consumes this to mirror dated items into Google Calendar; the frontend can
// also react to it. Never throws into the caller — a failed publish is logged.
export async function publishDigestUpdated(userId, items, updatedAt = new Date()) {
  if (!items?.length) return;
  if (!connected) {
    console.warn('[categorizer] producer not connected — skipping digest.updated');
    return;
  }
  try {
    await producer.send({
      topic: TOPIC_DIGEST_UPDATED,
      messages: [
        {
          key: String(userId),
          value: JSON.stringify({ userId: String(userId), items, updatedAt: new Date(updatedAt).toISOString() }),
        },
      ],
    });
  } catch (err) {
    console.error('[categorizer] digest.updated publish error:', err?.message || err);
  }
}

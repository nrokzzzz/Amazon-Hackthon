import { kafka, TOPIC_EMAIL_RECEIVED } from './client.js';
import { categorizeAndStore } from '../digest/store.js';
import { publishDigestUpdated } from './producer.js';

// Consumes 'email.received' (produced by the integration service's Gmail webhook):
//   { userId, googleEmail, messageId, subject, from, text,
//     files:[{filename,mimeType,data}], receivedAt }
// For each email we categorize + store into the student's CollegeInfo, then —
// if anything new was added — publish 'digest.updated' with the added items so
// the integration service can mirror dated ones to Google Calendar.
const consumer = kafka.consumer({ groupId: 'categorizer-group' });

async function handleEmail(payload) {
  const { userId, messageId, subject, text, files } = payload || {};
  if (!userId) {
    console.warn('[categorizer] email.received without userId — skipping');
    return;
  }

  const result = await categorizeAndStore(userId, {
    text: text || '',
    files: Array.isArray(files) ? files : [],
    source: 'gmail',
    subject: subject || '',
    emailId: messageId || '',
  });

  if (result.added > 0) {
    await publishDigestUpdated(userId, result.items);
    console.log(`[categorizer] ${userId}: +${result.added} items`);
  }
}

export async function startConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC_EMAIL_RECEIVED, fromBeginning: false });
  console.log('[categorizer] kafka consumer subscribed to', TOPIC_EMAIL_RECEIVED);

  await consumer.run({
    eachMessage: async ({ message }) => {
      let payload;
      try {
        payload = JSON.parse(message.value?.toString() || '{}');
      } catch (err) {
        console.error('[categorizer] bad email.received JSON:', err?.message || err);
        return;
      }
      try {
        await handleEmail(payload);
      } catch (err) {
        // Swallow so one poison message doesn't crash the consumer loop.
        console.error('[categorizer] email.received handler error:', err?.message || err);
      }
    },
  });
}

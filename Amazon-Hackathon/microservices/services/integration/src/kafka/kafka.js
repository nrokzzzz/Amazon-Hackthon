import { Kafka } from 'kafkajs';
import { config } from '../config/env.js';

// Topics this service touches.
export const TOPIC_EMAIL_RECEIVED = 'email.received';
export const TOPIC_DIGEST_UPDATED = 'digest.updated';

const kafka = new Kafka({
  clientId: 'integration',
  brokers: config.kafkaBrokers,
  // Keep retries short; our own boot loop handles the "Kafka not up yet" case.
  retry: { retries: 3 },
});

let producer = null;
let producerReady = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Connect the producer with a retry loop — Kafka may boot AFTER this service.
// Never throws: on repeated failure it logs and gives up (producing becomes a
// best-effort no-op until a later attempt succeeds via the background init).
export async function initProducer(attempts = 20, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const p = kafka.producer();
      await p.connect();
      producer = p;
      producerReady = true;
      console.log('[kafka] producer connected');
      return;
    } catch (err) {
      console.error(`[kafka] producer connect attempt ${i}/${attempts} failed:`, err?.message || err);
      await sleep(delayMs);
    }
  }
  console.error('[kafka] producer failed to connect after all attempts (will keep service alive)');
}

// Produce a JSON message. Best-effort: logs and swallows errors so a transient
// Kafka outage never crashes request/notification handling.
export async function produce(topic, value, key) {
  if (!producer || !producerReady) {
    console.error(`[kafka] producer not ready — dropping message to ${topic}`);
    return false;
  }
  try {
    await producer.send({
      topic,
      messages: [{ key: key ? String(key) : undefined, value: JSON.stringify(value) }],
    });
    return true;
  } catch (err) {
    console.error(`[kafka] produce to ${topic} failed:`, err?.message || err);
    return false;
  }
}

// Start the 'digest.updated' consumer with a retry loop. `onMessage(value)` is
// invoked per decoded message; its errors are caught so the consumer never dies.
export async function initConsumer(onMessage, attempts = 20, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const consumer = kafka.consumer({ groupId: 'integration-group' });
      await consumer.connect();
      await consumer.subscribe({ topic: TOPIC_DIGEST_UPDATED, fromBeginning: false });
      await consumer.run({
        eachMessage: async ({ message }) => {
          let value;
          try {
            value = JSON.parse(message.value?.toString() || '{}');
          } catch (err) {
            console.error('[kafka] digest.updated: bad JSON, skipping:', err?.message || err);
            return;
          }
          try {
            await onMessage(value);
          } catch (err) {
            console.error('[kafka] digest.updated handler error:', err?.message || err);
          }
        },
      });
      console.log('[kafka] consumer subscribed to digest.updated');
      return;
    } catch (err) {
      console.error(`[kafka] consumer connect attempt ${i}/${attempts} failed:`, err?.message || err);
      await sleep(delayMs);
    }
  }
  console.error('[kafka] consumer failed to connect after all attempts (will keep service alive)');
}

import { Kafka, logLevel } from 'kafkajs';
import { config } from '../config/env.js';

// Shared Kafka client for the categorizer. brokers come from KAFKA_BROKERS
// (comma-separated), defaulting to the docker-network 'kafka:9092'.
export const kafka = new Kafka({
  clientId: 'categorizer',
  brokers: config.kafkaBrokers,
  logLevel: logLevel.NOTHING,
  retry: { retries: 8 },
});

export const TOPIC_EMAIL_RECEIVED = 'email.received';
export const TOPIC_DIGEST_UPDATED = 'digest.updated';

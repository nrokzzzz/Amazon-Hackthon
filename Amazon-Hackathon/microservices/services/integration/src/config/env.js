// Central config for the integration service. Mirrors the monolith's env shape
// (backend/src/config/env.js) but scoped to what this connector needs.
//
// NOTE: no dotenv here — in the microservices deployment env vars are injected
// by the orchestrator (docker-compose / k8s). dotenv is loaded best-effort below
// so the service is still runnable locally from a .env file.
try {
  const dotenv = await import('dotenv');
  dotenv.default.config();
} catch {
  /* dotenv not installed — env comes from the environment */
}

export const config = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',

  // This service owns the campusflow_integration database.
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusflow_integration',

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',

  kafkaBrokers: (process.env.KAFKA_BROKERS || 'kafka:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/auth/google/callback',
  },

  // Gmail push notifications via Google Cloud Pub/Sub.
  gmail: {
    // projects/<gcp-project-id>/topics/<topic-id>
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC || '',
    // Shared secret appended to the Pub/Sub push URL (?token=...).
    pubsubToken: process.env.GMAIL_PUBSUB_TOKEN || '',
    // Only emails FROM these addresses are produced downstream. Comma-separated.
    allowedSenders: (process.env.GMAIL_ALLOWED_SENDERS || 'nagurok1234@gmail.com')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

// Google OAuth configured => Calendar + Gmail OAuth available.
export const isGoogleConfigured = () =>
  Boolean(config.google.clientId && config.google.clientSecret);

// Gmail push needs Google OAuth configured AND a Pub/Sub topic to publish to.
export const isGmailConfigured = () =>
  Boolean(isGoogleConfigured() && config.gmail.pubsubTopic);

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load backend/.env by an ABSOLUTE path (relative to this file) so it's found no
// matter which directory the server is started from — `dotenv.config()` alone is
// cwd-relative and silently falls back to defaults (e.g. localhost Mongo) when
// launched from elsewhere. NOTE: we intentionally do NOT use `override`, so vars
// set programmatically before import win — e.g. the `--mem` tunnel script injects
// an in-memory MONGODB_URI that must take precedence over the .env value.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
dotenv.config({ path: envPath });

// Central config object. Secrets live ONLY here on the backend — never in the frontend.
export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Read the connection string from the environment (.env or a programmatically
  // injected var, e.g. the `--mem` script's in-memory URI). Falls back to a local
  // mongod for convenience. NEVER commit real credentials here.
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusflow',
  // The DB name to use. Atlas SRV strings often omit it (…mongodb.net/?…), which
  // would otherwise dump everything into the default `test` database — so we pin
  // it here (overridable via MONGODB_DB).
  mongoDbName: process.env.MONGODB_DB || 'campusflow',
  // Optional public DNS resolvers (comma-separated) for the mongodb+srv SRV
  // lookup. Set MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 when the local/ISP/VPN
  // resolver refuses SRV queries (error: querySrv ECONNREFUSED). No OS change.
  dnsServers: (process.env.MONGODB_DNS_SERVERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    bedrockApiKey: process.env.BEDROCK_API_KEY || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bedrockModelId: process.env.BEDROCK_MODEL_ID || '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      'http://localhost:4000/auth/google/callback',
  },

  // Google Gemini (Generative Language API) — powers email categorization + chatbot.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },

  // Deepgram — voice assistant: speech-to-text (mic) + text-to-speech (replies).
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || '',
    sttModel: process.env.DEEPGRAM_STT_MODEL || 'nova-2',
    ttsModel: process.env.DEEPGRAM_TTS_MODEL || 'aura-asteria-en',
  },

  // Gmail push notifications via Google Cloud Pub/Sub.
  gmail: {
    // Full Pub/Sub topic name Gmail should publish to:
    //   projects/<gcp-project-id>/topics/<topic-id>
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC || '',
    // Shared secret appended to the Pub/Sub push URL (?token=...) so only Google
    // can hit our webhook. e.g. https://host/gmail/pubsub?token=<this>
    pubsubToken: process.env.GMAIL_PUBSUB_TOKEN || '',
    // Only emails FROM these addresses are ingested. Comma-separated.
    allowedSenders: (process.env.GMAIL_ALLOWED_SENDERS || 'nagurok1234@gmail.com')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

// Helpers so feature modules can degrade gracefully when keys are absent
// (lets the whole pipeline be demoed offline without AWS/Google credentials).
export const isBedrockConfigured = () =>
  Boolean(config.aws.bedrockModelId && (config.aws.bedrockApiKey || config.aws.accessKeyId));

export const isGoogleConfigured = () =>
  Boolean(config.google.clientId && config.google.clientSecret);

// Gmail push needs Google OAuth configured AND a Pub/Sub topic to publish to.
export const isGmailConfigured = () =>
  Boolean(isGoogleConfigured() && config.gmail.pubsubTopic);

// Gemini powers the LLM categorizer + chatbot. Blank key => rule-based fallback.
export const isGeminiConfigured = () => Boolean(config.gemini.apiKey);

// Deepgram powers the voice assistant (STT + TTS). Blank key => voice disabled.
export const isDeepgramConfigured = () => Boolean(config.deepgram.apiKey);

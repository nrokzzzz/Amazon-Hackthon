// Central config for the categorizer service. Mirrors the monolith's env shape
// (backend/src/config/env.js) but scoped to what this service needs.
//
// dotenv is loaded best-effort so the service is still runnable locally from a
// .env file; in the microservices deployment env vars are injected by the
// orchestrator (docker-compose / k8s).
try {
  const dotenv = await import('dotenv');
  dotenv.default.config();
} catch {
  /* dotenv not installed — env comes from the environment */
}

export const config = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',

  // This service owns the campusflow_categorizer database.
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusflow_categorizer',

  kafkaBrokers: (process.env.KAFKA_BROKERS || 'kafka:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean),

  // Auth/profile service — for fetching a student's enrichment profile used by
  // the prioritization engine. Service-to-service, no token required.
  authUrl: process.env.AUTH_URL || 'http://auth:8080',

  // Google Gemini (Generative Language API) — powers email categorization.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  },
};

// Gemini powers the LLM categorizer. Blank key => rule-based fallback so the
// whole pipeline (categorize -> store -> chatbot) is demoable offline.
export const isGeminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

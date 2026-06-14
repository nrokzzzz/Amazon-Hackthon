// Central config for the chat service. In the microservices deployment env vars
// are injected by the orchestrator (docker-compose / k8s); dotenv is loaded
// best-effort below so the service is still runnable locally from a .env file.
try {
  const dotenv = await import('dotenv');
  dotenv.default.config();
} catch {
  /* dotenv not installed — env comes from the environment */
}

export const config = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',

  // This service owns the campusflow_chat database.
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusflow_chat',

  // Google Gemini (Generative Language API) — powers the chatbot.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  },

  // Internal service URLs (docker-network defaults, overridable via env).
  categorizerUrl: process.env.CATEGORIZER_URL || 'http://categorizer:8080',
  authUrl: process.env.AUTH_URL || 'http://auth:8080',
};

// Gemini powers the chatbot. Blank key => rule-based keyword fallback.
export const isGeminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

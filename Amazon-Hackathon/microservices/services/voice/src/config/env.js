// Central config for the voice service. In the microservices deployment env vars
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

  // Deepgram — voice assistant: speech-to-text (mic) + text-to-speech (replies).
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || '',
    sttModel: process.env.DEEPGRAM_STT_MODEL || 'nova-2',
    ttsModel: process.env.DEEPGRAM_TTS_MODEL || 'aura-asteria-en',
  },
};

// Deepgram powers the voice assistant (STT + TTS). Blank key => voice disabled.
export const isDeepgramConfigured = () => Boolean(process.env.DEEPGRAM_API_KEY);

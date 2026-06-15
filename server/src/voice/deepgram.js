import { config, isDeepgramConfigured } from '../config/env.js';

const BASE = 'https://api.deepgram.com/v1';

// Speech-to-text: raw audio bytes -> transcript string.
// `contentType` is the recording's MIME type (e.g. audio/webm;codecs=opus).
export async function transcribe(buffer, contentType = 'audio/webm') {
  if (!isDeepgramConfigured()) throw new Error('deepgram_not_configured');

  const params = new URLSearchParams({
    model: config.deepgram.sttModel,

    smart_format: 'true',
    punctuate: 'true',
  });
  const res = await fetch(`${BASE}/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.deepgram.apiKey}`,
      'Content-Type': contentType,
    },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`deepgram_stt_${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
}

// Text-to-speech: text -> MP3 audio Buffer (Deepgram Aura voice).
export async function synthesize(text) {
  if (!isDeepgramConfigured()) throw new Error('deepgram_not_configured');

  const params = new URLSearchParams({ model: config.deepgram.ttsModel, encoding: 'mp3' });
  const res = await fetch(`${BASE}/speak?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.deepgram.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`deepgram_tts_${res.status}: ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

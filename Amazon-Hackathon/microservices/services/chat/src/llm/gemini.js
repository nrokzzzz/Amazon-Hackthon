import { config, isGeminiConfigured } from '../config/env.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Low-level call to Gemini's generateContent. Returns the assistant text.
//   system  : system instruction string (optional)
//   user    : the user prompt string
//   files   : [{ mimeType, data }] where data is STANDARD base64 (e.g. a PDF) —
//             Gemini reads these natively, so PDF attachments need no parsing lib.
//   json    : when true, ask Gemini for application/json output
export async function geminiGenerate({ system, user, files = [], json = false, maxTokens = 2048 }) {
  if (!isGeminiConfigured()) throw new Error('gemini_not_configured');

  const parts = [{ text: user }];
  for (const f of files) {
    if (f?.data) parts.push({ inlineData: { mimeType: f.mimeType || 'application/pdf', data: f.data } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `${BASE}/${config.gemini.model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`gemini_http_${res.status}`);
        await sleep(2 ** attempt * 500);
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`gemini_http_${res.status}: ${t.slice(0, 300)}`);
      }
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text)
        .filter(Boolean)
        .join('');
      return text;
    } catch (err) {
      lastErr = err;
      // Network blip — retry; otherwise rethrow.
      if (attempt === 2) throw err;
      await sleep(2 ** attempt * 500);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config, isDeepgramConfigured } from '../config/env.js';

// Live (streaming) speech-to-text. The browser opens a WebSocket to us and
// streams raw PCM16 mic audio; we proxy it to Deepgram's live endpoint (keeping
// the API key server-side) and relay interim + final transcripts back in
// real time, so the UI can fill the input box as the user speaks.
//
// Browser  --(PCM16 frames)-->  /voice/stream  --(proxy)-->  Deepgram live
//          <--(transcript JSON)--               <--(Results)--
export function attachVoiceStream(server) {
  if (!isDeepgramConfigured()) return; // no live STT without a key

  const wss = new WebSocketServer({ server, path: '/voice/stream' });

  wss.on('connection', (client, req) => {
    // Authenticate via ?token=<app JWT> (browsers can't set WS headers).
    try {
      const url = new URL(req.url, 'http://localhost');
      jwt.verify(url.searchParams.get('token') || '', config.jwtSecret);
    } catch {
      client.close(1008, 'unauthorized');
      return;
    }

    const params = new URLSearchParams({
      model: config.deepgram.sttModel,
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
    });
    const dg = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${config.deepgram.apiKey}` },
    });

    let dgOpen = false;
    const queue = []; // audio that arrives before Deepgram is ready

    dg.on('open', () => {
      dgOpen = true;
      for (const b of queue) dg.send(b);
      queue.length = 0;
    });
    dg.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Results') {
          const text = msg.channel?.alternatives?.[0]?.transcript || '';
          if (text && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'transcript', text, is_final: Boolean(msg.is_final) }));
          }
        }
      } catch {
        /* ignore non-JSON keepalives */
      }
    });
    dg.on('error', () => { try { client.close(); } catch { /* ignore */ } });
    dg.on('close', () => { try { client.close(); } catch { /* ignore */ } });

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        if (dgOpen) dg.send(data);
        else queue.push(data);
        return;
      }
      // text control message, e.g. {"type":"stop"}
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop' && dgOpen) dg.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        /* ignore */
      }
    });
    client.on('close', () => {
      try {
        if (dgOpen) dg.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        /* ignore */
      }
      try { dg.close(); } catch { /* ignore */ }
    });
  });

  console.log('[voice] live transcription WebSocket ready at /voice/stream');
}

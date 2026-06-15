import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Briefcase,
  Bus,
  ClipboardList,
  CreditCard,
  FileText,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const PAGE = 20;

const SUGGESTIONS = [
  { icon: BookOpen, text: 'Make me a study plan for my exams' },
  { icon: ClipboardList, text: 'When is my next exam?' },
  { icon: FileText, text: 'Any assignment deadlines this week?' },
  { icon: Briefcase, text: 'Tell me about upcoming placement drives' },
  { icon: CreditCard, text: 'Any fees I need to pay?' },
  { icon: Bus, text: 'Did the bus timings change?' },
];

// Sparkle avatar for the assistant.
function AssistantAvatar() {
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-sm text-[#101820] shadow-lg shadow-indigo-500/20">
      <Sparkles className="h-4 w-4 text-[#101820]" />
    </div>
  );
}

// Big animated orb shown in hands-free voice mode; color/animation reflects state.
function VoiceOrb({ state }) {
  const color =
    state === 'listening'
      ? 'from-sky-400 to-indigo-500'
      : state === 'thinking'
      ? 'from-amber-400 to-orange-500'
      : state === 'speaking'
      ? 'from-emerald-400 to-teal-500'
      : 'from-slate-500 to-slate-600';
  const animate = state === 'listening' || state === 'speaking';
  return (
    <div className="relative grid place-items-center">
      <div className={`absolute h-44 w-44 rounded-full bg-gradient-to-br ${color} opacity-25 ${animate ? 'animate-ping' : ''}`} />
      <div
        className={`grid h-32 w-32 place-items-center rounded-full bg-gradient-to-br ${color} text-5xl shadow-2xl ${animate ? 'animate-pulse' : ''}`}
      >
        {state === 'thinking' ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : state === 'speaking' ? (
          <Volume2 className="h-5 w-5" />
        ) : (
          <Mic className="h-5 w-5" />
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

// Tailwind-styled markdown for assistant replies — Gemini returns **bold**,
// lists, links, tables, etc., which would otherwise show as raw symbols.
const MD_COMPONENTS = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200 light:text-indigo-600"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) =>
    /\blanguage-/.test(className || '') ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-white/10 px-1 py-0.5 text-[0.85em] light:bg-slate-900/10">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-[13px] last:mb-0 light:bg-slate-900/[0.06]">{children}</pre>
  ),
  h1: ({ children }) => <h1 className="mb-2 mt-1 text-lg font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-1 text-base font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1 font-semibold">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-white/20 pl-3 text-slate-300 light:border-slate-900/20 light:text-slate-600">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-white/10 light:border-slate-900/10" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-white/10 px-2 py-1 text-left font-semibold light:border-slate-900/10">{children}</th>,
  td: ({ children }) => <td className="border border-white/10 px-2 py-1 light:border-slate-900/10">{children}</td>,
};

function Markdown({ children }) {
  return (
    <div className="break-words text-[15px] leading-relaxed text-slate-100 light:text-slate-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Message({ role, content }) {
  // User: subtle right-aligned bubble. Assistant: clean flowing text with the
  // sparkle avatar (Claude-style — no bubble, no user avatar).
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-white/10 light:bg-slate-900/[0.06] px-4 py-2.5 text-[15px] text-slate-100 light:text-slate-800">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-4">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}

let localSeq = 0;
const nextLocalId = () => `local-${Date.now()}-${localSeq++}`;

export default function Chat() {
  const { student } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [ready, setReady] = useState(false); // initial history fetched

  // Voice (Deepgram): mic recording (STT) + spoken replies (TTS)
  const [voiceOn, setVoiceOn] = useState(false); // is Deepgram configured?
  const [speakReplies, setSpeakReplies] = useState(false); // speak the assistant's answers?
  const [recording, setRecording] = useState(false);
  // Hands-free conversation mode
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState('idle'); // idle | listening | thinking | speaking
  const [voiceErr, setVoiceErr] = useState(''); // surfaced voice failure (so it isn't silent)

  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const audioRef = useRef(null); // currently-playing TTS audio
  // Live dictation (streaming STT) refs
  const wsRef = useRef(null);
  const micCtxRef = useRef(null);
  const procRef = useRef(null);
  const micStreamRef = useRef(null);
  const dictationPrefixRef = useRef(''); // box text to keep in front of dictation
  const committedRef = useRef(''); // finalized words spoken since (re)base
  const segInterimRef = useRef(''); // current in-progress (interim) segment text
  const ignoreSegRef = useRef(false); // drop the rest of a segment after a manual edit/clear
  // Refs for the hands-free loop (avoid stale-closure issues in async loops)
  const voiceModeRef = useRef(false);
  const recStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);
  const abortRecRef = useRef(null);
  // How to position the scroll after the next render:
  //  'bottom'   -> jump to newest (send/receive, first load)
  //  'preserve' -> keep the user's view fixed (prepending older messages)
  const scrollMode = useRef('bottom');
  const prevScrollHeight = useRef(0);

  // Load the most recent page of history on mount.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/chat/history', { params: { limit: PAGE } });
        scrollMode.current = 'bottom';
        setMessages(data.messages || []);
        setCursor(data.nextCursor);
        setHasMore(Boolean(data.hasMore));
      } catch {
        /* empty history / offline — start fresh */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Is the voice assistant available (Deepgram key set on the server)?
  useEffect(() => {
    api
      .get('/voice/status')
      .then(({ data }) => setVoiceOn(Boolean(data.configured)))
      .catch(() => {});
  }, []);

  // Apply the scroll position synchronously after messages change.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrollMode.current === 'bottom') {
      el.scrollTop = el.scrollHeight;
    } else if (scrollMode.current === 'preserve') {
      // Keep the previously-visible message in place after prepending older ones.
      el.scrollTop = el.scrollHeight - prevScrollHeight.current;
    }
    scrollMode.current = 'none';
  }, [messages]);

  // Keep the typing indicator in view.
  useEffect(() => {
    if (busy) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [busy]);

  // Auto-grow the composer textarea.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function loadOlder() {
    if (loadingOlder || !hasMore || !cursor) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    prevScrollHeight.current = el ? el.scrollHeight : 0;
    try {
      const { data } = await api.get('/chat/history', { params: { before: cursor, limit: PAGE } });
      scrollMode.current = 'preserve';
      setMessages((m) => [...(data.messages || []), ...m]);
      setCursor(data.nextCursor);
      setHasMore(Boolean(data.hasMore));
    } catch {
      /* ignore */
    } finally {
      setLoadingOlder(false);
    }
  }

  function onScroll(e) {
    if (e.currentTarget.scrollTop < 60 && hasMore && !loadingOlder) loadOlder();
  }

  // Speak text via the backend Deepgram TTS proxy.
  async function speak(text) {
    if (!text) return;
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      const res = await api.post('/voice/speak', { text: text.slice(0, 1900) }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      setVoiceErr('Could not play the spoken reply — the voice service is unavailable (check the Deepgram API key).');
    }
  }

  // LIVE dictation: stream mic audio to the backend (-> Deepgram live) over a
  // WebSocket and fill the input box in real time as the user speaks. Tap the
  // mic to start, tap again to stop. The text stays in the box (not auto-sent).
  async function startRecording() {
    const token = getToken();
    if (!token) return;
    setVoiceErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ sampleRate: 16000 }); // 16 kHz to match Deepgram
      micCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      const mute = ctx.createGain();
      mute.gain.value = 0; // process audio without echoing it to the speakers

      // Derive the WS origin from the API base so live dictation works wherever
      // the API does — e.g. over ngrok/https it becomes wss://. VITE_WS_BASE_URL
      // still overrides if you need a custom host.
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
      const wsBase = import.meta.env.VITE_WS_BASE_URL || apiBase.replace(/^http/i, 'ws');
      // Pass the context's ACTUAL sample rate so the backend tells Deepgram the
      // truth (browsers often ignore the requested 16 kHz and record at 48 kHz).
      const ws = new WebSocket(
        `${wsBase}/voice/stream?token=${encodeURIComponent(token)}&rate=${ctx.sampleRate}`
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      ws.onerror = () => setVoiceErr('Live dictation failed — the voice service is unavailable (check the Deepgram API key).');

      // Text already in the box stays as a prefix; finals accumulate after it.
      dictationPrefixRef.current = input.trim() ? `${input.trim()} ` : '';
      committedRef.current = '';
      segInterimRef.current = '';
      ignoreSegRef.current = false;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type !== 'transcript') return;

          // After a manual clear/edit, drop the remainder of the segment that was
          // already in progress, so old words don't get re-appended.
          if (ignoreSegRef.current) {
            if (msg.is_final) {
              ignoreSegRef.current = false;
              segInterimRef.current = '';
            }
            return;
          }

          if (msg.is_final) {
            if (msg.text) committedRef.current += (committedRef.current ? ' ' : '') + msg.text;
            segInterimRef.current = '';
            setInput((dictationPrefixRef.current + committedRef.current).trim());
          } else {
            segInterimRef.current = msg.text;
            const sep = committedRef.current && msg.text ? ' ' : '';
            setInput(`${dictationPrefixRef.current}${committedRef.current}${sep}${msg.text}`.trim());
          }
        } catch {
          /* ignore */
        }
      };

      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(i16.buffer);
      };

      source.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      setRecording(true);
    } catch {
      setRecording(false);
      window.alert('Microphone access is needed for voice. Please allow it and try again.');
    }
  }

  function stopRecording() {
    setRecording(false);
    try {
      procRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      micCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'stop' }));
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    procRef.current = null;
    micCtxRef.current = null;
    micStreamRef.current = null;
    wsRef.current = null;
    taRef.current?.focus();
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  // Post a question, append both turns to the transcript, return the answer text.
  async function ask(question) {
    scrollMode.current = 'bottom';
    setMessages((m) => [...m, { _localId: nextLocalId(), role: 'user', content: question }]);
    setBusy(true);
    try {
      const { data } = await api.post('/chat/ask', { question });
      scrollMode.current = 'bottom';
      setMessages((m) => [
        ...m,
        { _id: data.message_id, _localId: nextLocalId(), role: 'assistant', content: data.answer || '…', engine: data.engine },
      ]);
      return data.answer || '';
    } catch {
      scrollMode.current = 'bottom';
      setMessages((m) => [
        ...m,
        { _localId: nextLocalId(), role: 'assistant', content: "Sorry — I couldn't reach the assistant. Please try again.", engine: 'error' },
      ]);
      return '';
    } finally {
      setBusy(false);
    }
  }

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;
    setInput('');
    // If still dictating, reset the dictation baseline so the next words start clean.
    if (recording) {
      dictationPrefixRef.current = '';
      committedRef.current = '';
      if (segInterimRef.current) ignoreSegRef.current = true;
    }
    const answer = await ask(question);
    taRef.current?.focus();
    // In hands-free mode the loop handles speaking; here we honor the 🔊 toggle.
    if (speakReplies && voiceOn && !voiceModeRef.current) speak(answer);
  }

  // ---- Hands-free conversation mode --------------------------------------
  function transcribeBlob(blob) {
    const fd = new FormData();
    fd.append('audio', blob, 'speech.webm');
    return api
      .post('/voice/transcribe', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then(({ data }) => (data.transcript || '').trim())
      .catch(() => {
        setVoiceErr('Could not transcribe your speech — the voice service is unavailable (check the Deepgram API key).');
        return '';
      });
  }

  // Play TTS for `text`; resolves when playback ends (or is stopped).
  function speakAndWait(text) {
    return new Promise((resolve) => {
      if (!text) return resolve();
      api
        .post('/voice/speak', { text: text.slice(0, 1900) }, { responseType: 'blob' })
        .then((res) => {
          const url = URL.createObjectURL(res.data);
          const audio = new Audio(url);
          audioRef.current = audio;
          const done = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.onpause = done; // stopVoiceMode pauses -> unblock the loop
          return audio.play();
        })
        .catch(() => {
          setVoiceErr('Could not play the spoken reply — the voice service is unavailable (check the Deepgram API key).');
          resolve();
        });
    });
  }

  // Record until the speaker goes quiet (voice-activity detection).
  // Resolves with an audio Blob, or null if no speech was detected.
  function listenWithSilenceDetection() {
    return new Promise((resolve) => {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          recStreamRef.current = stream;
          const mr = new MediaRecorder(stream);
          const chunks = [];
          mr.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data);
          };

          const AC = window.AudioContext || window.webkitAudioContext;
          const ctx = new AC();
          audioCtxRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);

          const SILENCE_MS = 1300; // quiet after speech -> stop
          const NOSPEECH_MS = 8000; // never spoke -> give up this turn
          const MAX_MS = 15000; // hard cap
          const THRESH = 0.025; // RMS speech threshold
          let spoke = false;
          let stopped = false;
          const t0 = performance.now();
          let lastVoice = t0;

          mr.onstop = () => {
            cancelAnimationFrame(rafRef.current);
            try { ctx.close(); } catch { /* ignore */ }
            stream.getTracks().forEach((t) => t.stop());
            recStreamRef.current = null;
            resolve(spoke ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null);
          };
          const finish = () => {
            if (stopped) return;
            stopped = true;
            if (mr.state !== 'inactive') mr.stop();
          };
          abortRecRef.current = finish;

          const tick = () => {
            if (stopped) return;
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / buf.length);
            const now = performance.now();
            if (rms > THRESH) {
              spoke = true;
              lastVoice = now;
            }
            if (now - t0 > MAX_MS) return finish();
            if (spoke && now - lastVoice > SILENCE_MS) return finish();
            if (!spoke && now - t0 > NOSPEECH_MS) return finish();
            rafRef.current = requestAnimationFrame(tick);
          };
          mr.start();
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch(() => resolve(null));
    });
  }

  async function runVoiceLoop() {
    while (voiceModeRef.current) {
      setVoiceState('listening');
      const blob = await listenWithSilenceDetection();
      if (!voiceModeRef.current) break;
      if (!blob) continue; // no speech — listen again
      setVoiceState('thinking');
      const text = await transcribeBlob(blob);
      if (!voiceModeRef.current) break;
      if (!text) continue;
      const answer = await ask(text);
      if (!voiceModeRef.current) break;
      setVoiceState('speaking');
      await speakAndWait(answer);
    }
    setVoiceState('idle');
  }

  function startVoiceMode() {
    if (!voiceOn || voiceMode) return;
    setVoiceErr('');
    voiceModeRef.current = true;
    setVoiceMode(true);
    runVoiceLoop();
  }

  function stopVoiceMode() {
    voiceModeRef.current = false;
    setVoiceMode(false);
    setVoiceState('idle');
    try { abortRecRef.current?.(); } catch { /* ignore */ }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }

  // Stop everything if the user navigates away mid-conversation/dictation.
  useEffect(
    () => () => {
      voiceModeRef.current = false;
      try { abortRecRef.current?.(); } catch { /* ignore */ }
      if (audioRef.current) audioRef.current.pause();
      try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { micCtxRef.current?.close(); } catch { /* ignore */ }
      try { wsRef.current?.close(); } catch { /* ignore */ }
    },
    []
  );

  // User typed/cleared the box. If dictation is live, rebase on the new value so
  // only words spoken AFTER this edit get appended (fixes: clear -> old text returns).
  function handleInputChange(e) {
    const v = e.target.value;
    setInput(v);
    if (recording) {
      dictationPrefixRef.current = v ? (v.endsWith(' ') ? v : `${v} `) : '';
      committedRef.current = '';
      if (segInterimRef.current) ignoreSegRef.current = true; // discard the segment in progress
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function clearChat() {
    if (!messages.length || !window.confirm('Clear this conversation?')) return;
    try {
      await api.delete('/chat/history');
    } catch {
      /* ignore */
    }
    setMessages([]);
    setCursor(null);
    setHasMore(false);
  }

  const empty = ready && messages.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 light:border-slate-900/10 px-6 py-4">
        <AssistantAvatar />
        <div>
          <div className="text-sm font-semibold">CampusFlow Assistant</div>
          <div className="text-xs text-slate-500">Ask about your exams, deadlines, placements & more</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {voiceOn && (
            <button
              onClick={startVoiceMode}
              title="Talk with the assistant (hands-free)"
              className="rounded-lg px-3 py-1.5 text-sm text-indigo-200 transition hover:bg-indigo-500/15"
            >
              <span className="inline-flex items-center gap-1.5">
                <Mic className="h-4 w-4" />
                Talk
              </span>
            </button>
          )}
          {voiceOn && (
            <button
              onClick={() => setSpeakReplies((v) => !v)}
              title={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
              className={`rounded-lg px-2.5 py-1.5 text-sm transition ${
                speakReplies ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 light:text-slate-500 hover:bg-white/5 light:hover:bg-slate-900/[0.04]'
              }`}
            >
              {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-400 light:text-slate-500 transition hover:bg-white/5 light:hover:bg-slate-900/[0.04] hover:text-slate-200 light:hover:text-slate-800"
            >
              Clear chat
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-2xl text-[#101820] shadow-xl shadow-indigo-500/30">
              <Sparkles className="h-4 w-4 text-[#101820]" />
            </div>
            <h1 className="text-2xl font-bold">How can I help, {student?.name?.split(' ')[0] || 'there'}?</h1>
            <p className="mt-2 text-sm text-slate-400 light:text-slate-500">
              I answer from the college emails &amp; notices in your account.
            </p>
            <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  onClick={() => send(s.text)}
                  className="flex items-center gap-3 rounded-xl border border-white/10 light:border-slate-900/10 bg-white/[0.03] light:bg-white light:shadow-sm px-4 py-3 text-left text-sm text-slate-200 light:text-slate-800 transition hover:border-indigo-400/40 hover:bg-white/[0.06] light:hover:bg-slate-900/[0.06]"
                >
                  <s.icon className="h-4 w-4" />
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
            {loadingOlder && (
              <div className="flex justify-center py-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
                  Loading earlier messages…
                </span>
              </div>
            )}
            {!hasMore && !loadingOlder && messages.length > PAGE && (
              <div className="py-1 text-center text-[11px] text-slate-600">Beginning of conversation</div>
            )}
            {messages.map((m, i) => (
              <Message key={m._id || m._localId || i} {...m} />
            ))}
            {busy && (
              <div className="flex gap-4">
                <AssistantAvatar />
                <div className="rounded-2xl rounded-tl-sm bg-white/[0.04] light:bg-white light:shadow-sm px-4 py-2.5">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="relative shrink-0 px-6 pb-4 pt-2">
        {/* soft fade so messages scroll under the composer (Claude-style) */}
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-[#101820] light:from-white to-transparent" />
        <div className="mx-auto max-w-3xl">
          {voiceErr && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 light:text-red-700">
              <span>{voiceErr}</span>
              <button onClick={() => setVoiceErr('')} className="shrink-0 font-medium opacity-70 transition hover:opacity-100" aria-label="Dismiss">
                Dismiss
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-3xl border border-white/10 light:border-slate-900/10 bg-white/[0.05] light:bg-slate-900/[0.04] px-3 py-2 shadow-lg shadow-black/20 focus-within:border-indigo-400/60">
            {voiceOn && (
              <button
                onClick={toggleRecording}
                disabled={busy}
                title={recording ? 'Stop dictation' : 'Dictate (live speech-to-text)'}
                aria-label={recording ? 'Stop dictation' : 'Start dictation'}
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-base transition disabled:opacity-50 ${
                  recording ? 'animate-pulse bg-red-500 text-white' : 'bg-white/10 light:bg-slate-900/[0.06] text-slate-300 light:text-slate-600 hover:bg-white/20'
                }`}
              >
                {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              placeholder={recording ? 'Listening… speak now, tap stop to end' : 'Message CampusFlow Assistant…'}
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 light:text-slate-800 outline-none placeholder:text-slate-500"
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500 text-[#101820] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-600">
            {voiceOn ? 'Enter to send · Shift+Enter for newline · use the mic to speak' : 'Enter to send · Shift+Enter for a new line'}
          </p>
        </div>
      </div>

      {/* Hands-free conversation overlay */}
      {voiceMode && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-[#101820]/95 light:bg-white/95 backdrop-blur-sm">
          <VoiceOrb state={voiceState} />
          <div className="text-center">
            <div className="text-xl font-semibold text-slate-100 light:text-slate-800">
              {voiceState === 'listening'
                ? 'Listening…'
                : voiceState === 'thinking'
                ? 'Thinking…'
                : voiceState === 'speaking'
                ? 'Speaking…'
                : 'Connecting…'}
            </div>
            <div className="mt-2 text-sm text-slate-500">Talk naturally — just pause when you're done</div>
          </div>
          <button
            onClick={stopVoiceMode}
            className="rounded-full bg-red-500 px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-red-400"
          >
            End conversation
          </button>
        </div>
      )}
    </div>
  );
}

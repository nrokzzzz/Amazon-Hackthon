import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';

const PAGE = 20;

const SUGGESTIONS = [
  { icon: '📝', text: 'When is my next exam?' },
  { icon: '📄', text: 'Any assignment deadlines this week?' },
  { icon: '💼', text: 'Tell me about upcoming placement drives' },
  { icon: '🚌', text: 'Did the bus timings change?' },
  { icon: '🏠', text: 'Any hostel or mess notices?' },
  { icon: '📅', text: "What's on my class timetable tomorrow?" },
];

// Sparkle avatar for the assistant.
function AssistantAvatar() {
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-sm text-white shadow-lg shadow-indigo-500/20">
      ✦
    </div>
  );
}

function UserAvatar({ name }) {
  const initials = (name || 'You')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-slate-200">
      {initials}
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

function Message({ role, content, engine, name }) {
  const isUser = role === 'user';
  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      {isUser ? <UserAvatar name={name} /> : <AssistantAvatar />}
      <div className={`min-w-0 flex-1 ${isUser ? 'flex justify-end' : ''}`}>
        <div
          className={
            isUser
              ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-500/90 px-4 py-2.5 text-sm text-white'
              : 'max-w-[85%] rounded-2xl rounded-tl-sm bg-white/[0.04] px-4 py-2.5 text-sm leading-relaxed text-slate-100'
          }
        >
          <div className="whitespace-pre-wrap break-words">{content}</div>
          {!isUser && engine && (
            <div className="mt-1.5 text-[10px] uppercase tracking-wide text-slate-500">
              {engine === 'gemini' ? '✨ Gemini' : 'rule-based'}
            </div>
          )}
        </div>
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

  const scrollRef = useRef(null);
  const taRef = useRef(null);
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

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || busy) return;

    setInput('');
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
    } catch {
      scrollMode.current = 'bottom';
      setMessages((m) => [
        ...m,
        {
          _localId: nextLocalId(),
          role: 'assistant',
          content: "Sorry — I couldn't reach the assistant. Please try again.",
          engine: 'error',
        },
      ]);
    } finally {
      setBusy(false);
      taRef.current?.focus();
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
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-4">
        <AssistantAvatar />
        <div>
          <div className="text-sm font-semibold">CampusFlow Assistant</div>
          <div className="text-xs text-slate-500">Ask about your exams, deadlines, placements & more</div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 text-2xl text-white shadow-xl shadow-indigo-500/30">
              ✦
            </div>
            <h1 className="text-2xl font-bold">How can I help, {student?.name?.split(' ')[0] || 'there'}?</h1>
            <p className="mt-2 text-sm text-slate-400">
              I answer from the college emails &amp; notices in your account.
            </p>
            <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  onClick={() => send(s.text)}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-slate-200 transition hover:border-indigo-400/40 hover:bg-white/[0.06]"
                >
                  <span>{s.icon}</span>
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
              <Message key={m._id || m._localId || i} {...m} name={student?.name} />
            ))}
            {busy && (
              <div className="flex gap-4">
                <AssistantAvatar />
                <div className="rounded-2xl rounded-tl-sm bg-white/[0.04] px-4 py-2.5">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 focus-within:border-indigo-400/60">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message CampusFlow Assistant…"
              className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
            <button
              onClick={() => send()}
              disabled={busy || !input.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500 text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              ↑
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-600">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

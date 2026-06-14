import http from 'http';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

// Internal service URLs (overridable via env, with docker-network defaults).
const AUTH_URL = process.env.AUTH_URL || 'http://auth:8080';
const INTEGRATION_URL = process.env.INTEGRATION_URL || 'http://integration:8080';
const CATEGORIZER_URL = process.env.CATEGORIZER_URL || 'http://categorizer:8080';
const CHAT_URL = process.env.CHAT_URL || 'http://chat:8080';
const VOICE_URL = process.env.VOICE_URL || 'http://voice:8080';

const app = express();

// CORS must run before the proxies so preflight OPTIONS get a 204 here.
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
);
app.use(morgan('tiny'));

// NOTE: do NOT add express.json() here — proxied request bodies must stream
// through untouched. We only need JSON parsing for the local legacy stubs,
// which carry no body, so we skip the body parser entirely.

// ---- Health ---------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true, service: 'gateway' }));

// ---- Public routes (no token required) ------------------------------------
// These paths/methods bypass JWT verification and proxy straight through.
function isPublic(req) {
  const { method, path } = req;
  if (method === 'OPTIONS') return true; // preflight handled by cors()
  if (method === 'POST' && path === '/auth/register') return true;
  if (method === 'POST' && path === '/auth/login') return true;
  if (method === 'GET' && path === '/auth/google/callback') return true;
  if (method === 'POST' && path === '/gmail/pubsub') return true;
  if (method === 'GET' && path === '/health') return true;
  return false;
}

// ---- JWT verification middleware ------------------------------------------
// Runs before the proxies. Public routes are skipped. Authed routes must carry
// a valid Bearer token; on success we stash sub/email for header injection.
app.use((req, res, next) => {
  if (isPublic(req)) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const payload = jwt.verify(token, JWT_SECRET); // HS256, { sub, email }
    req.userId = payload.sub;
    req.userEmail = payload.email;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthenticated' });
  }
});

// ---- Legacy stubs (authed, handled locally so the old frontend doesn't error)
app.get('/events', (_req, res) => res.json({ events: [] }));
app.get('/portal/attendance', (_req, res) => res.json({ attendance: [] }));

// ---- Proxy helpers --------------------------------------------------------
// Inject identity headers for downstream services on every proxied request.
function injectIdentity(proxyReq, req) {
  if (req.userId) proxyReq.setHeader('x-user-id', req.userId);
  if (req.userEmail) proxyReq.setHeader('x-user-email', req.userEmail);
}

function proxy(target, { ws = false } = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws,
    on: {
      proxyReq: injectIdentity,
    },
  });
}

// WebSocket proxy for /voice/stream — needs ws:true and upgrade wiring below.
const voiceProxy = proxy(VOICE_URL, { ws: true });

// ---- Proxy mounts (longest-prefix first) ----------------------------------
// /auth/google MUST be matched before /auth.
app.use('/auth/google', proxy(INTEGRATION_URL));
app.use('/auth', proxy(AUTH_URL));
app.use('/profile', proxy(AUTH_URL));
app.use('/gmail', proxy(INTEGRATION_URL));
app.use('/calendar', proxy(INTEGRATION_URL));
app.use('/college-info', proxy(CATEGORIZER_URL));
app.use('/chat', proxy(CHAT_URL));
app.use('/voice', voiceProxy);

// ---- HTTP server + WebSocket upgrade handling -----------------------------
const server = http.createServer(app);

// Wire WS upgrades for the voice service. We verify the JWT here too, since the
// upgrade request never passes through the express middleware chain.
server.on('upgrade', (req, socket, head) => {
  if (!req.url || !req.url.startsWith('/voice')) {
    socket.destroy();
    return;
  }

  // Token can come via Authorization header or ?token= query (browsers can't set
  // headers on WebSocket handshakes, so the query form is the practical path).
  let token = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) token = header.slice(7);
  if (!token) {
    try {
      const u = new URL(req.url, 'http://localhost');
      token = u.searchParams.get('token');
    } catch {
      token = null;
    }
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Inject identity onto the upgrade request so injectIdentity can forward it.
    req.userId = payload.sub;
    req.userEmail = payload.email;
    req.headers['x-user-id'] = payload.sub;
    if (payload.email) req.headers['x-user-email'] = payload.email;
  } catch {
    socket.destroy();
    return;
  }

  voiceProxy.upgrade(req, socket, head);
});

server.listen(PORT, () => {
  console.log(`gateway listening on :${PORT}`);
});

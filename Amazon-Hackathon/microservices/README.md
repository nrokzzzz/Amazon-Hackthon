# CampusFlow — Microservices

The monolith (`../backend`) split into independent services that communicate over
**Kafka** (async, durable safety queue) and internal HTTP. The monolith is left
intact as a fallback.

## Architecture

```
                                  ┌──────── Kafka (safety queue) ────────┐
Gmail Pub/Sub ─▶ integration ──produce─▶ [email.received] ──consume─▶ categorizer
  (ACK 204 fast, durable)          ▲                                  (Gemini → CollegeInfo)
                                   │                                        │ produce
Browser ─▶ gateway (JWT) ─┬─▶ auth │                       [digest.updated] ┘
   :4000                  ├─▶ integration ◀──consume────────────┘
                          ├─▶ categorizer ──▶ /college-info, /tasks
                          ├─▶ chat ──HTTP──▶ categorizer (/internal/context) + auth (/internal/profile)
                          └─▶ voice (Deepgram STT/TTS + WS)
```

| Service | Port (host) | DB | Kafka | Responsibility |
|---|---|---|---|---|
| **gateway** | 4000 | — | — | Single entry; verifies JWT, injects `x-user-id`, proxies (incl. WS) |
| **auth** | 4001 | `campusflow_auth` | — | Register/login/profile; signs JWTs; `/internal/profile` |
| **integration** | 4002 | `campusflow_integration` | produce `email.received`, consume `digest.updated` | Google OAuth, Gmail watch + webhook, Calendar auto-sync |
| **categorizer** | 4003 | `campusflow_digest` | consume `email.received`, produce `digest.updated` | Gemini classify → store digest, prioritize, hourly expiry |
| **chat** | 4004 | `campusflow_chat` | — | Assistant grounded in digest + profile (pulled via HTTP) |
| **voice** | 4005 | — | — | Deepgram speech-to-text / text-to-speech + `/voice/stream` WS |

**Kafka topics**
- `email.received` — `{ userId, googleEmail, messageId, subject, from, text, files[], receivedAt }`
- `digest.updated` — `{ userId, items[], updatedAt }`

The `email.received` topic is the **safety queue**: the Gmail webhook ACKs Google
instantly and the email is durably queued, so if Gemini is rate-limited or down,
nothing is lost — it's processed when the categorizer recovers.

## Run

```bash
cd microservices
cp .env.example .env     # (already filled from the monolith for this project)
docker compose up --build
```

- Public API: **http://localhost:4000** (gateway). Point the frontend
  (`VITE_API_BASE_URL`) and your ngrok tunnel at this.
- Health: `curl http://localhost:4000/health` and each service on 4001–4005.

Identity flows from the gateway: it verifies the `Authorization: Bearer` JWT and
forwards `x-user-id` / `x-user-email`; services trust those headers (internal
network) and never re-verify.

## Gmail webhook via ngrok

```bash
ngrok http 4000
```
Set the Pub/Sub push endpoint to
`https://<ngrok>/gmail/pubsub?token=<GMAIL_PUBSUB_TOKEN>` and the OAuth redirect /
`GOOGLE_REDIRECT_URI` to match if connecting through the tunnel.

## Notes
- Topics auto-create on first use (`KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE=true`).
- Each service tolerates a late-booting Kafka (capped retry loop; never crashes).
- `/events` and `/portal/attendance` are legacy and stubbed empty by the gateway;
  the prioritized digest (`/college-info/tasks`) is the replacement.

# Enterprise scale guide (thousands → 100k weekend)

This document captures how SandFest is built to operate at festival scale after the 2026-07 enterprise hardening pass.

## Target load

| Surface | Pattern | Scale strategy |
|---------|---------|----------------|
| Public web | Static CDN | Vite `dist/` on CDN; SW offline shell |
| Public GET APIs | Cacheable JSON | `Cache-Control` + edge TTL (15–120s) |
| Passport stamps / votes | Hot writes | Atomic file mutex **or** Postgres tables |
| Admin mutations | Low volume | Role JWT, audit trail, rate limited |
| Payments | Durable writes | Postgres orders + Stripe webhooks |

## Data plane

### File mode (single node / dev)

- `lib/safe-json-store.mjs` — per-path mutex + atomic temp rename
- Safe for **one** API process handling concurrent requests
- **Not** multi-instance safe (two pods can still race)

### Postgres mode (enterprise / multi-instance)

Set `SANDFEST_DATABASE_URL`. Schema (`lib/db/schema.sql`) adds:

- `platform_documents` — fleet, revenue, booths, consent, volunteers, hunt definition
- `hunt_completions` — unique `(hunt_id, checkpoint_id, attendee_ref)`
- `peoples_choice_votes` — unique `(event_id, attendee_ref)`

Access via `lib/platform-data.mjs` (used by the admin API).

Schema creation is guarded by a database advisory lock so simultaneous pod
starts cannot race on `CREATE TABLE IF NOT EXISTS`. Platform document updates
take a transaction advisory lock per document before `SELECT ... FOR UPDATE`,
which also protects the first insert when no row exists yet. This prevents
simultaneous vendor, sponsor, outreach, worker, or camera writes from replacing
one another during a cold database start.

Pool defaults: `max=40`, connect timeout 5s (override with env).

## Security controls (event day)

| Control | Setting / location |
|---------|-------------------|
| Body size cap | `SANDFEST_MAX_BODY_BYTES` (default 256 KiB) |
| Public write rate | `SANDFEST_PUBLIC_WRITE_RATE_LIMIT` (default 60/min/IP) for stamp + vote |
| Public read rate | `SANDFEST_PUBLIC_RATE_LIMIT` (default 1200/min/IP) |
| Admin rate | `SANDFEST_ADMIN_RATE_LIMIT` (default 120/min/IP) |
| HTML escape | `lib/html-escape.mjs` used in web renders for untrusted fields |
| Admin token in UI | Empty by default (no baked-in dev token) |
| Production auth | `SANDFEST_AUTH_MODE=jwt` + JWKS (see `lib/auth.mjs`) |

## Recommended production topology

```
CDN (static web)
   │
   ▼
Load balancer (HTTPS)
   │
   ├─ N × Node API pods  (SANDFEST_DATABASE_URL set, JWT auth)
   │
   └─ Postgres (primary)
          optional Redis later for rate-limit share across pods
```

For a **single VPS** event weekend (thousands concurrent, not 100k API RPS):

1. One Node process + Postgres on same host is enough if public GETs are CDN-cached.
2. Put Vite build on Cloudflare/Netlify/Pages.
3. Point API to `api.heyelab.com/sandfest` with TLS.

## Capacity notes

- **100k visitors** mostly hit static assets + cached schedule/map — not the write path.
- Hot writes are passport stamps + votes; expect bursts of tens/sec not thousands/sec if QR density is normal.
- Fleet/admin is <100 concurrent staff — fine on one primary.

## Verification

```bash
npm run test:platform
npm run test:platform:api
npm run test:postgres
npm run build
```

`npm run test:postgres` provisions a disposable database and exercises schema
startup from four processes, concurrent first writes, concurrent public partner
intake, outreach sequencing, passport and voting uniqueness, signed camera
metrics, the durable worker queue, and audit persistence. CI runs the same suite
against Postgres 17.

## Enterprise controls (this tranche)

| Control | How |
|---------|-----|
| Shared rate limits | `REDIS_URL` (ioredis) or Upstash REST; else memory |
| Async SMS | Alert publish enqueues `sms.alert_fanout`; run `npm run worker` |
| Ops bundle split | `npm run build:public` and `npm run build:admin` produce mutually exclusive deploy artifacts; CI asserts each bundle is absent from the other surface |
| Ticket-linked votes | Optional `ticketRef`; enforce with `SANDFEST_REQUIRE_TICKET_VOTE=true` |
| XSS | `escapeHtml` / `escapeAttr` on admin cards, votes, booths, fleet, sculptors |
| CI | `.github/workflows/ci.yml` — tests, build, load-test, Swift parse |

## Remaining (external launch dependencies)

- Full ticket registry validation against Eventeny/Stripe (needs logins)
- CDN WAF policy in front of public write endpoints

Production readiness now fails closed unless the API has a reachable shared Redis or Upstash rate-limit backend. QuickBooks invoices use the durable reviewed job queue; provider activation still requires approved sandbox OAuth and item IDs.

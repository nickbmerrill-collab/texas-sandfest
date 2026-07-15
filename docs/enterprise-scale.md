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
npm run build
```

## Still out of scope (next enterprise tranche)

- Shared rate-limit store (Redis) across pods
- Horizontal queue for SMS fan-out and QuickBooks sync
- Full visitor/admin bundle split
- Ticket-linked vote identity (anti multi-device stuffing)
- Full XSS audit of every `innerHTML` call site

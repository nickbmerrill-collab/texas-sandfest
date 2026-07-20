# Scale and Reliability Plan

Texas SandFest needs to serve a crowd measured in tens of thousands on site and over 100,000 total visitors. The platform should be designed so public reads stay fast under crowd spikes while payment, fulfillment, and admin writes stay durable.

> **2026-07 enterprise hardening:** see also [`docs/enterprise-scale.md`](enterprise-scale.md) for Postgres tables (`platform_documents`, `hunt_completions`, `peoples_choice_votes`), atomic file mutexes, body limits, and public-write rate limits.

## Traffic Assumptions

- 100,000+ event visitors across the weekend.
- Highest mobile usage during arrival windows, lunch, weather changes, music schedule checks, and parking/gate confusion.
- Most traffic is read-heavy: schedule, maps, tickets, policies, parking, ferry, sponsor info, Ask Sandy answers.
- Payment traffic is lower volume but high value and must be durable.
- Admin traffic is low volume but privileged and must be protected.

## Production Serving Model

### Public Frontend

- Serve the public web app as static assets through CDN/edge cache.
- Cache images aggressively.
- Keep the hero/media payload local and optimized.
- Avoid making every page view depend on origin API availability.
- Ship a service worker and app manifest so the public guide, core static data, and media manifest can reopen offline.

Current offline shell:

- `public/manifest.webmanifest`
- `public/sw.js`
- cached static data under `/data/*`
- a strict allowlist of three public data files: projected bootstrap, fail-closed ticket catalog, and publication-gated sculptor roster
- cache-first local media/assets
- network status and install controls in the top bar

### Public APIs

Public APIs should be cacheable and safe to serve from the edge:

- `GET /api/public/bootstrap`
- `GET /api/public/alert`
- `GET /api/public/tickets`
- `GET /api/public/sponsors`
- `POST /api/public/concierge` (rate-limited, `no-store`; answers may cite the cacheable public projections)
- public FAQ/policy/search payloads when added

The public bootstrap and media catalog are projections, not internal processed documents. Build checks and `npm run deployment:verify` reject staff schedule categories, operational zone status, private workflow collections, board-runtime metadata in production, unapproved bootstrap fields, local filesystem paths, and internal media-fetch details.

Recommended cache profile:

- `s-maxage=60-300`
- `stale-while-revalidate=300`
- versioned payloads for event-day changes
- emergency alert endpoint with a shorter 15-second TTL
- concierge requests and responses are never edge-cached because question text may contain personal details

### Emergency Alerts

Guests need fast public messaging during weather, parking, gate, ferry, medical, or safety changes.

Current prototype route:

- `GET /api/public/alert`: public-safe active alert payload, cached for 15 seconds.
- `GET /api/admin/alert`: admin alert state.
- `PATCH /api/admin/alert`: publish or clear the active public alert.

Production rules:

- Keep the alert payload tiny and edge-cacheable.
- Publish alerts through admin auth only.
- Send the same reviewed alert state to web, iOS, push notification jobs, and Port A Local Co.
- Keep an inactive alert record in the app bootstrap so offline iOS and web shells have a stable schema.
- Add audit history and role checks before launch.
- Keep a clear/expired state so stale emergency messages cannot linger.

### Transaction APIs

Payment and fulfillment writes must not rely on local files in production.

Use:

- Postgres for orders, fulfillment records, sponsor packages, audit logs, admin mutations.
- Queue or durable workflow for webhook fulfillment and QuickBooks sync.
- Stripe Checkout for payment capture.
- Idempotency keys by Checkout Session ID and Stripe event ID.

### Admin APIs

Admin APIs should be uncached and protected:

- real identity provider
- role-based access
- audit events for every mutation
- no secrets in browser payloads
- rate limits by account and IP
- request IDs on every response for support/debugging
- security headers on API JSON responses

Current prototype writes local audit JSON records for alert, ticket, sponsor, and fulfillment mutations and exposes recent entries at `GET /api/admin/audit`.

Stripe webhook handling now mirrors the production idempotency rule locally: repeated event IDs are acknowledged without reprocessing, and successful checkout fulfillment is guarded by Checkout Session ID.

The prototype also has a local role model through `SANDFEST_ADMIN_ROLE`. Route handlers enforce permissions for alert publishing, ticket changes, sponsor changes, fulfillment updates, and audit reads. Production should replace this with real identity-provider claims and per-user roles.

The local API also has in-memory rate limits for public, admin, and checkout routes. Production should move enforcement to Vercel Firewall/API gateway plus per-user/account quotas.

Config writes capture snapshots before mutation. The admin API exposes `GET /api/admin/snapshots` and a rollback endpoint for privileged restores. Production should make rollback a reviewed action with database transaction boundaries.

## Capacity Targets

Initial production targets:

| Layer | Target |
| --- | --- |
| Static frontend | CDN-served, origin-independent |
| Public reads | p95 under 250 ms at API edge |
| Checkout create | p95 under 800 ms before Stripe redirect |
| Webhook ACK | under 500 ms, then async fulfillment |
| Admin config saves | p95 under 750 ms |
| Error rate | below 0.5% for public reads |
| Admin/API abuse | 429 with `Retry-After` and request ID |

## Failure Modes

| Failure | Expected behavior |
| --- | --- |
| API origin down | public app keeps cached guide, schedule, map, policies |
| Cell signal drops | installed web app reopens cached app shell and static event data |
| Stripe unavailable | checkout returns clear retry state, no duplicate local fulfillment |
| Partner intake response lost | retry with the same idempotency key returns the original application and portal without duplicate tasks or messages |
| Partner message queue or worker stops | the worker reconstructs deterministic work; a post-handoff crash becomes an explicit provider-verification item that blocks retry, dismissal, replacement drafts, and sequence progress until staff documents sent or not-sent evidence. |
| Incident dispatch queue or worker stops | the worker recreates a missing deterministic job; a stable Brevo key prevents duplicate email, and a post-handoff crash stops in explicit provider-verification state. Retry and dismissal remain locked until staff either record the provider message ID as delivered or document provider-confirmed non-delivery; both decisions are audited. |
| Webhook repeated | idempotent event handling by Stripe event ID |
| Webhook delayed | order remains paid-pending-fulfillment until event arrives |
| QuickBooks down | payment/fulfillment continues, finance sync retries later |
| Admin misconfiguration | audit log and rollback to previous config version |
| Database data loss | restore paid Postgres PITR into an isolated instance, verify with `npm run recovery:verify`, then deliberately repoint services |
| Private upload loss | restore a daily encrypted disk snapshot at an isolated path and run `npm run recovery:verify:assets` against restored Postgres before production cutover |

## Storage Modes

Local development defaults to atomic JSON documents and a filesystem queue for inspectable test data. Production mode supports Postgres row locking, append-only audit/event tables, platform documents, and the durable job queue exercised by `npm run test:postgres`. A launch deployment must set `SANDFEST_DATABASE_URL`, run with Postgres storage, and keep API and worker processes on the same database; file mode is not a production data plane for 100,000 visitors.

Background work uses fenced leases rather than permanent `running` flags. A worker crash returns the job to the queue after `SANDFEST_JOB_LEASE_MS`; a stale worker's completion token is rejected after ownership changes. Partner messages and reviewed incident dispatches use a durable outbox invariant: every queue cycle has a deterministic job identity, every provider attempt retains one private UUID idempotency key, and only the active delivery claim can record the result. The worker reconstructs missing delivery work from persisted queued state. A crash after provider submission becomes an explicit unknown outcome for staff verification instead of an automatic resend. Exhausted crash recovery is reflected in the owning sponsor message, QuickBooks invoice, or incident dispatch so staff do not see a false queued state. Queue health is part of `/ready` and the authenticated operations console: unhandled terminal failures block production readiness, while handled historical failures remain visible without keeping the service red.

The production Blueprint uses paid managed Postgres with PITR and an encrypted persistent disk with daily snapshots. Recovery is treated as unproven until isolated restores of both data planes succeed. `/ready` requires recent timestamps for both drills; database structure and counts are verified read-only with `npm run recovery:verify`, while `npm run recovery:verify:assets` proves every Postgres-referenced upload by size and SHA-256 and emits a deterministic aggregate manifest hash.

## Load Testing

Start local API:

```bash
SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me npm run api:dev
```

Run a local read-path test:

```bash
npm run api:load-test -- http://127.0.0.1:8788 1000 50
```

For staging, run the same script against the Heyelab API subdomain:

```bash
npm run api:load-test -- https://sandfest-api.heyelab.com 5000 100
```

Do not load test the production Stripe checkout create endpoint without a planned test window and Stripe sandbox keys.

## Event-Day Runbook

Before gates open:

- Confirm CDN cache warm for static assets.
- Confirm service worker registration and offline reload for the public guide.
- Hit `/health` and `/ready`.
- Confirm `/api/admin/deployment` has zero blocking errors.
- Confirm static and API bootstrap privacy checks pass, then confirm ticket, sponsor, map, and FAQ payloads are healthy.
- Confirm Stripe dashboard, webhook endpoint, and admin transaction monitor.
- Confirm fallback public message for checkout unavailable.
- Confirm emergency alert publish/clear through `/api/admin/alert` and public visibility through `/api/public/alert`.

During peak windows:

- Monitor p95 latency, error rate, checkout failures, webhook backlog, and fulfillment queue.
- Capture `x-request-id` from failed API responses.
- Keep public reads cached.
- Avoid publishing large image/data changes during peak arrival.
- Route urgent alerts through a short-TTL emergency alert payload.

After event:

- Export orders, fulfillment, refunds, Stripe fees, and sponsor payments.
- Reconcile into QuickBooks.
- Archive audit logs and analytics for 2027 planning.

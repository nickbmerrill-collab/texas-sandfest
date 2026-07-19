# Heyelab Backend Deployment

This backend should run as the configurable admin and API layer for SandFest while the public website and iOS app consume stable public endpoints.

## Target Hostnames

Use Heyelab-controlled subdomains:

- Public/API base: `https://sandfest-api.heyelab.com`
- Admin console: `https://sandfest-admin.heyelab.com`
- Stripe webhook: `https://sandfest-api.heyelab.com/api/stripe/webhook`
- QuickBooks OAuth callback: `https://sandfest-api.heyelab.com/api/integrations/quickbooks/callback`

If Heyelab uses a different root domain, keep the same shape:

```text
sandfest-api.<heyelab-domain>
sandfest-admin.<heyelab-domain>
```

## Pre-board deployment boundary

The initial Render deployment carries the production data plane and the core
vendor, sponsor, finance, key-date, document, and work-board workflows. It does
not contact post-board providers. Outreach discovery, QuickBooks sync, camera
ingest, Stripe checkout, transactional email, SMS, NWS weather, and TxDOT ferry
refresh all default to disabled. Their credentials and camera approval evidence
are deliberately absent from `render.yaml`, so Blueprint creation does not ask
an operator to invent or transmit values for capabilities that are not ready.

With those integrations disabled, vendor and sponsor submissions still create
reviewable applications, tasks, milestones, finance records, brand workspaces,
and message drafts. Payments can be recorded and reconciled manually, while
outbound delivery and provider sync remain unavailable. `/health` may pass once
the process and Postgres are healthy; `/ready` remains red for every required
launch capability that has not completed acceptance. Do not describe that state
as production-ready.

The only initial operator-supplied Blueprint values are the registered admin
OIDC client ID and the private Turnstile secret used to protect real public
intake. Add each deferred provider's variables in Render only when its enablement
checklist is complete, then change the matching `*_ENABLED` flag to `true`.

## Current Local API

Run:

```bash
npm run api:dev
```

Default local base:

```text
http://127.0.0.1:8788
```

Routes:

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | Runtime health check |
| `GET` | `/ready` | Public | Readiness check for source payloads and writable order storage |
| `GET` | `/api/public/alert` | Public | Short-TTL active public alert payload |
| `GET` | `/api/public/bootstrap` | Public | Shared app bootstrap payload |
| `GET` | `/api/public/tickets` | Public | Current ticket catalog |
| `GET` | `/api/public/sponsors` | Public | Active sponsor packages |
| `POST` | `/api/public/concierge` | Public, rate-limited | Source-cited Ask Sandy answer over governed public data; question text is not persisted |
| `POST` | `/api/public/vendor-applications` | Public + optional `Idempotency-Key` | Create one vendor workflow and replay it safely on network retry |
| `POST` | `/api/public/sponsor-inquiries` | Public + optional `Idempotency-Key` | Create one sponsor workflow using a server-authoritative active tier |
| `POST` | `/api/public/partner-status` | Capability token | Return a privacy-minimized application, payment, invoice, and milestone status |
| `GET` | `/api/public/island-conditions` | Public | Governed stored conditions, with NWS and TxDOT refresh only when explicitly enabled |
| `POST` | `/api/ingest/cameras/:id/observations` | HMAC signature | Ingest bounded, idempotent, metrics-only local camera observations |
| `POST` | `/api/stripe/create-checkout-session` | Public | Validate cart and create a Stripe Checkout Session when configured |
| `POST` | `/api/stripe/webhook` | Stripe signature | Record Stripe events and queue fulfillment |
| `POST` | `/api/webhooks/brevo` | Brevo bearer token | Record transactional delivery events and suppress terminal outreach recipients |
| `GET` | `/api/admin/config` | Bearer token | Admin configuration payload |
| `GET` | `/api/admin/session` | Bearer token | Current admin actor, role, and permissions |
| `GET` | `/api/admin/deployment` | Bearer token | Environment, secret, CORS, Stripe, and deployment readiness checks |
| `GET` | `/api/admin/alert` | Bearer token | Current emergency alert configuration |
| `PATCH` | `/api/admin/alert` | Bearer token | Publish or clear the public emergency alert |
| `GET` | `/api/admin/orders` | Bearer token | Recent pending checkout attempts |
| `GET` | `/api/admin/payment-events` | Bearer token | Recent Stripe webhook/payment events |
| `GET` | `/api/admin/fulfillment` | Bearer token | Recent ticket, VIP, raffle, and sponsor fulfillment records |
| `GET` | `/api/admin/audit` | Bearer token | Recent admin mutation audit records |
| `GET` | `/api/admin/snapshots` | Bearer token | Recent mutable config snapshots |
| `POST` | `/api/admin/snapshots/:file/restore` | Bearer token | Restore a captured alert, ticket catalog, or admin config snapshot |
| `PATCH` | `/api/admin/fulfillment/:id` | Bearer token | Update fulfillment status |
| `PATCH` | `/api/admin/tickets/:id` | Bearer token | Update ticket pricing, Stripe IDs, review gates, and limits |
| `PATCH` | `/api/admin/sponsor-packages/:id` | Bearer token | Update sponsor pricing, benefits, Stripe IDs, and QuickBooks mapping |
| `GET` | `/api/admin/partners` | Bearer token | Applications, invoices, payments, dates, follow-ups, tasks, vendor readiness, and provider readiness |
| `GET` | `/api/admin/integrations/quickbooks` | `partners:read` | Secret-free accounting connection and sync readiness |
| `POST` | `/api/admin/integrations/quickbooks/authorize` | `finance:write` | Create a one-time Intuit authorization request |
| `POST` | `/api/admin/integrations/quickbooks/disconnect` | `finance:write` | Remove the encrypted SandFest credential after explicit confirmation |
| `GET` | `/api/integrations/quickbooks/callback` | One-time OAuth state | Complete or cancel Intuit authorization without exposing credentials |
| `GET` | `/api/admin/documents` | `documents:read` | List the annual private document review queue and integrity summary |
| `POST` | `/api/admin/documents/upload` | `documents:write` | Validate and store one private operational source file with checksum deduplication |
| `GET` | `/api/admin/documents/:id/content` | `documents:read` | Download one checksum-verified private document |
| `PATCH` | `/api/admin/documents/:id` | `documents:write` | Assign ownership and advance the review lifecycle |
| `PATCH` | `/api/admin/partners/applications/:id` | Bearer token | Assign and advance an application |
| `POST` | `/api/admin/partners/applications/:id/portal-access` | `partners:write` | Rotate access and return a replacement private portal link |
| `POST` | `/api/admin/partners/applications/:id/payments` | `finance:write` | Record and reconcile a partner payment |
| `POST` | `/api/admin/partners/payments/:id/reverse` | `finance:write` | Void or record a provider-completed refund with a required reason |
| `POST` | `/api/admin/partners/applications/:id/invoices` | `finance:write` | Create a draft from the server-authoritative approved amount |
| `POST` | `/api/admin/partners/invoices/:id/review` | `finance:write` | Approve or void an unsynced invoice |
| `POST` | `/api/admin/partners/invoices/:id/sync` | `finance:write` | Queue an approved invoice for idempotent QuickBooks sync |
| `POST` | `/api/admin/partners/tasks` | `partners:write` | Delegate a validated staff, volunteer, team, or unassigned task |
| `PATCH` | `/api/admin/partners/tasks/:id` | `partners:write` | Reassign, prioritize, reschedule, block, start, complete, cancel, or reopen a task |
| `POST` | `/api/admin/staff-directory/import` | `staff:write` | Preview or atomically commit a verified annual staff and notification-routing directory |
| `POST` | `/api/admin/partners/applications/:id/milestones` | `partners:write` | Add an assigned partner key date with a validated reminder lead time |
| `PATCH` | `/api/admin/partners/milestones/:id` | `partners:write` | Reassign, reschedule, complete, cancel, or reopen a partner key date |
| `POST` | `/api/admin/partners/followups/:id/review` | Bearer token | Approve or dismiss a generated message draft |
| `POST` | `/api/admin/partners/followups/:id/send` | Bearer token | Queue an approved message when transactional email is ready |
| `POST` | `/api/admin/partners/invoices/:id/reconcile` | `finance:write` | Queue a versioned, read-only QuickBooks invoice balance refresh |
| `GET` | `/api/admin/outreach` | Bearer token | Business outreach pipeline with city, state, ZIP, radius, fit, and delivery state |
| `POST` | `/api/admin/outreach/prospects/import` | `outreach:write` | Preview or transactionally commit a duplicate-safe CSV business list |
| `GET` | `/api/admin/island-conditions` | Bearer token | Detailed eight-source conditions workspace |
| `PATCH` | `/api/admin/island-conditions/cameras/:id` | `conditions:write` | Configure source identity, public reference URL, state, and freshness threshold |
| `POST` | `/api/admin/island-conditions/cameras/:id/observations` | Bearer token | Ingest derived camera metrics without storing footage |

Admin calls use:

```http
Authorization: Bearer <token>
```

The token is interpreted in one of two modes:

### Bearer-token mode (default, dev)

```bash
SANDFEST_AUTH_MODE=bearer-token   # implicit when SANDFEST_AUTH_JWKS_URL is unset
SANDFEST_ADMIN_API_TOKEN=<long-random-secret>
SANDFEST_ADMIN_ROLE=super_admin
SANDFEST_ADMIN_ACTOR_ID=local-admin
```

Uses timing-safe equality against `SANDFEST_ADMIN_API_TOKEN`. Role and actor come from env. Production deployment checks flag this mode as a blocking error — it is for local dev only.

### JWT mode (production — Heyelab IdP)

Production uses Heyelab's own identity provider at `auth.heyelab.com`. The full contract Heyelab's IdP must satisfy is in [`heyelab-auth-contract.md`](./heyelab-auth-contract.md). Production env config:

```bash
SANDFEST_AUTH_MODE=jwt
SANDFEST_AUTH_JWKS_URL=https://auth.heyelab.com/.well-known/jwks.json
SANDFEST_AUTH_ISSUER=https://auth.heyelab.com/
SANDFEST_AUTH_AUDIENCE=https://sandfest-api.heyelab.com
SANDFEST_AUTH_ROLE_CLAIM=sandfest_role
SANDFEST_AUTH_ACTOR_CLAIM=sub
```

The API verifies the bearer token against Heyelab's JWKS (`jose`-backed, with built-in JWKS caching), then enforces issuer + audience pinning. The role is read from the `sandfest_role` claim (string with one of the 6 role names, or array — highest-privilege match wins). The actor id used in audit records is read from `sub` by default.

The static admin service is a public OIDC SPA client. Its Render build requires `VITE_SANDFEST_AUTH_MODE=oidc`, the IdP issuer and registered client ID, exact redirect and post-logout URIs, API audience, and `VITE_SANDFEST_API_BASE_URL`. The browser uses Authorization Code + PKCE and keeps its user session in `sessionStorage`; no OAuth client secret belongs in any `VITE_` variable. See the auth contract for the complete registration values.

Until Heyelab's IdP is live, `/ready` returns 503 and `GET /api/admin/deployment` will surface `authJwks`/`authIssuer` failures. That is the intended state — admin access is gated on Heyelab IdP availability.

### Supported roles

| Role | Intent |
| --- | --- |
| `super_admin` | Full local access |
| `ops_admin` | Operations, documents, staff and volunteer routing, partner workflows, conditions, fulfillment, automation failure acknowledgment, and audit |
| `ticketing_admin` | Ticket config, orders, payment events, fulfillment reads, audit |
| `sponsor_admin` | Sponsor package config, orders, fulfillment reads, audit |
| `finance_admin` | Finance reads plus partner payment posting/reversal and reviewed invoice create, approve, void, and sync |
| `viewer` | Read-only admin visibility |

## Admin Configuration Surface

Admins need screens for:

- Ticket products: active state, price label, amount in cents, quantity limits, Stripe Price ID, sale window, review-gated state.
- VIP: day-specific wristbands, capacity, will-call instructions, hospitality notes, parking-pass exclusions.
- Sponsorships: tier amount, benefits, active state, approval rules, Stripe Payment Link or Price ID, QuickBooks Item ID.
- Checkout settings: Stripe enabled, Apple Pay enabled, success/cancel URLs, webhook health, sandbox/live mode.
- Transaction monitor: pending checkout attempts, webhook events, fulfillment queue status, and local record paths.
- Audit trail: alert, ticket, sponsor, and fulfillment mutations with before/after records.
- Config snapshots: automatic pre-change snapshots and controlled rollback for alert, ticket catalog, and sponsor/admin config.
- Role and permission display: current admin role plus disabled controls for missing permissions.
- Deployment readiness display: environment, warning count, and blocking configuration errors.
- Emergency alerts: publish or clear weather, gate, parking, safety, and schedule disruption messages.
- Compliance gates: raffle disabled until reviewed, ticket terms approved, refund policy approved, filming notice approved, service-animals-only policy included.

The current frontend includes a working admin configuration console at `/#admin-config`. In local development:

1. Start the backend with `SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me npm run api:dev`.
2. Open the frontend preview.
3. Go to `/#admin-config`.
4. Load config from `http://127.0.0.1:8788`.
5. Edit ticket or sponsor records and save through the admin API.
6. Run `npm run public:sync` and rebuild static assets when a file-backed config change should be reflected in the static public catalog.

## Data Ownership

The admin backend owns mutable configuration. In file-storage mode (default for local dev) it lives on disk:

- `data/config/admin-config.json`
- `data/config/emergency-alert.json`
- `data/processed/ticket-products.json`
- `data/processed/orders/pending/*.json`
- `data/processed/orders/payment-events/*.json`
- `data/processed/orders/fulfillment/*.json`
- `data/processed/admin-audit/*.json`
- `data/processed/config-snapshots/*.json`
- `data/processed/incoming-documents.json` (metadata only)
- `SANDFEST_INCOMING_DOCUMENT_DIR` (private document bytes)

In Postgres mode (production), the same records live in tables defined by `lib/db/schema.sql`:

- `config_documents` — mutable singletons keyed by `admin-config`, `emergency-alert`, `ticket-products`, `app-bootstrap` (covers `ticket_products`, `sponsor_packages`, `checkout_settings`, and `emergency_alerts` in one document store)
- `orders` — pending and created Stripe checkout attempts
- `payment_events` — Stripe webhook events, idempotent on `id`
- `fulfillment_records` — wristband / VIP / sponsor / raffle items
- `admin_audit_events` — append-only mutation log
- `config_snapshots` — pre-mutation snapshots for rollback

Partner invoice state and QuickBooks sync proof live in the `partner-operations` platform document, which uses row locking in Postgres mode. Private document metadata and extracted text chunks live in the `incoming-documents` platform document; the database never contains the source file bytes. Queue attempts live in `platform_jobs`; admin approvals and queue actions live in `admin_audit_events`.

## Postgres Bring-up

Set `SANDFEST_DATABASE_URL` in the deploy environment:

```bash
SANDFEST_DATABASE_URL=postgres://user:pass@host:5432/sandfest
# Optional: 'no-verify' for self-signed TLS, 'false' to disable TLS
SANDFEST_DATABASE_SSL=no-verify
SANDFEST_DATABASE_POOL_MAX=10
npm run api:dev
```

On boot the API:

1. Connects to Postgres and runs `lib/db/schema.sql` idempotently (`CREATE TABLE IF NOT EXISTS …`).
2. Seeds `config_documents` from any existing JSON files under `data/config/` and `data/processed/` if the corresponding row is missing — this lets you flip the env var on a running deploy without losing tickets or sponsor config.
3. Reports `storage: postgres` from `GET /health` and `checks.storage: postgres` from `GET /ready`.

The Render Blueprint also starts `sandfest-worker` against the same Postgres database. It writes a heartbeat into `platform_documents`; production `/ready` returns `503` when that heartbeat is missing or stale, preventing a deploy with an inert automation queue from being reported ready.

### Background job recovery

Every worker claim has a random capability token, worker identity, and bounded lease. The default is five minutes through `SANDFEST_JOB_LEASE_MS=300000`; configure the same value on API and worker. A second worker cannot claim an active job. Once a lease expires, the next claim transaction recovers the job before selecting work. Completion is fenced by the claim token, so a late process cannot mark a job complete after another worker has taken ownership.

If an expired claim used the final attempt, the job enters the failed queue. The worker reconciles failed partner email, QuickBooks invoice, and incident-dispatch jobs back to their owning workflow, replacing a misleading `queued` status with a visible terminal failure. `GET /api/admin/jobs` reports pending, running, failed, unhandled, expired, and due counts without exposing lease capabilities; the operations console shows the same health signal. A handled historical failure remains available for audit but no longer makes the queue red. Production `/ready` fails on expired claims or unhandled terminal failures, and the production deployment profile fails closed unless storage is Postgres.

### Backup and restore readiness

Production requires recoverable Postgres and every private sponsor, vendor, and incoming-document upload, plus recent proof that both the database and upload disk can be restored. The Render Blueprint uses paid Postgres, whose managed PITR window is at least three days, and an encrypted persistent disk with daily snapshots retained for at least seven days. The application does not infer provider state from a successful database connection. Instead, `/ready` requires explicit recovery policy plus two successful drill timestamps no older than 90 days:

```bash
SANDFEST_BACKUP_PROVIDER=render-managed
SANDFEST_DATABASE_RECOVERY_WINDOW_DAYS=3
SANDFEST_ASSET_SNAPSHOT_RETENTION_DAYS=7
SANDFEST_DATABASE_RESTORE_DRILL_AT=2026-07-16T12:00:00.000Z
SANDFEST_ASSET_RESTORE_DRILL_AT=2026-07-16T13:00:00.000Z
SANDFEST_RESTORE_DRILL_MAX_AGE_DAYS=90
```

Restore Postgres into an isolated database, never the active source, then run:

```bash
SANDFEST_RECOVERY_DATABASE_URL='postgresql://...' npm run recovery:verify
```

The database verifier opens a read-only transaction, checks all required tables and seeded config documents, and reports row counts without returning records or credentials. Restore the private upload-disk snapshot at a different path in disposable staging, then prove every Postgres-referenced upload:

```bash
SANDFEST_RECOVERY_DATABASE_URL='postgresql://...' \
SANDFEST_RECOVERY_ASSET_DIR='/var/data/restored-partner-assets' \
SANDFEST_RECOVERY_ASSET_MIN_FILES=1 \
npm run recovery:verify:assets
```

The asset verifier refuses the active database and `SANDFEST_PARTNER_ASSET_DIR`, rejects symlinks and paths outside the restored root, and checks every uploaded sponsor logo, vendor document, and incoming source file against its recorded byte count and SHA-256. Its aggregate JSON includes category counts, verified bytes, and a deterministic manifest checksum without returning partner contacts or file contents. Record `SANDFEST_ASSET_RESTORE_DRILL_AT` only after `referenced` equals `verified`. See Render's [Postgres recovery](https://render.com/docs/postgresql-backups) and [persistent disk snapshot](https://render.com/docs/disks) documentation.

Neither restore timestamp belongs in the initial Blueprint. Add the exact
successful timestamps to the API environment only after the two isolated drills
above pass; a placeholder date would turn missing evidence into a misleading
readiness claim.

Without `SANDFEST_DATABASE_URL`, the API runs in file-storage mode and writes under `data/` exactly as before.

## Checkout Safety

The checkout endpoint is intentionally strict:

- Product IDs and quantities are validated server-side.
- Inactive products are rejected.
- Review-gated products are rejected.
- Products with placeholder Stripe Price IDs are rejected.
- If product config is valid but Stripe keys are not enabled, the API stores the validated attempt and returns `stripe_not_configured`.
- When `STRIPE_TICKETING_ENABLED=true` and `STRIPE_SECRET_KEY` is present, the API creates a Stripe Checkout Session and returns the hosted URL.

Webhook events are written to `data/processed/orders/payment-events/`. If `STRIPE_WEBHOOK_SECRET` is configured, invalid signatures are rejected.

Webhook writes are idempotent in the local prototype. Stripe event IDs map to stable local files, replayed events return `duplicate: true`, and successful checkout fulfillment is also guarded by Checkout Session ID so a second success event cannot issue duplicate wristband or will-call records.

Completed checkout webhooks create fulfillment records with statuses:

- `queued`
- `needs_review`
- `ready`
- `issued`
- `checked_in`
- `refunded`
- `voided`

## Partner Email Safety

Public vendor and sponsor submissions create reviewable acknowledgment drafts; they never send directly from the request path. Each open milestone has its own validated zero-to-thirty-day lead time. The worker creates versioned, idempotent drafts when that milestone enters its upcoming window, on its due date, and once per overdue week. It will not stack another phase while a same-schedule draft is pending, ready, approved, queued, or failed. Rescheduling or reopening increments the schedule version; rescheduling, completion, or cancellation dismisses active stale drafts. Review and queue operations recheck the current milestone and schedule version before allowing delivery. Finance-owned payment milestones add a ledger check: a fully paid application cannot generate a payment reminder even if legacy data still marks the date open.

Staff must approve each draft through the partner workspace. Queueing is rejected unless `TRANSACTIONAL_EMAIL_ENABLED=true`, `BREVO_API_KEY` is present, and `BREVO_SENDER_EMAIL` is a valid verified sender. Production readiness additionally requires a 32+ character `BREVO_WEBHOOK_TOKEN` and the HTTPS `SANDFEST_API_PUBLIC_BASE_URL` used to construct the callback URL.

Vendor workflow decisions use the same review-first queue. Requested operating-profile changes, document corrections or expiration, and new or revised booth/load-in assignments create a deterministic draft tied to the exact profile revision, document ID, or schedule version. Repeating the same decision is idempotent. A changed decision resets approval, a queued stale notice is dismissed before replacement, and vendor resubmission or assignment confirmation dismisses every unsent notice for that resolved workflow. No vendor workflow action sends email directly.

The worker re-checks the original application consent and recipient before calling Brevo's transactional email API. Follow-ups retain approval actor/time, queue time, delivery attempts, last error, provider message ID, accepted time, and the bounded delivery-event history. Failed jobs retry through the durable queue and become terminally failed after their configured attempt limit.

Configure a Brevo transactional webhook at `https://sandfest-api.heyelab.com/api/webhooks/brevo` using bearer authentication with the value of `BREVO_WEBHOOK_TOKEN`. Subscribe to sent/request, delivered, opened, unique opened, click, soft bounce, deferred, hard bounce, invalid, blocked, error, spam/complaint, and unsubscribed events. Brevo may send one event or a batch of up to 100. Events are correlated by the provider message ID, deduplicated, and held briefly for reconciliation if they arrive before the worker persists send acceptance. Hard bounce, invalid, blocked, complaint, and provider unsubscribe outcomes set sponsor prospects to `do_not_contact` and dismiss every unsent sequence message. Webhook audits contain counts only, not recipient addresses, payload bodies, or credentials.

Sponsor outreach additionally includes a fragment-safe recipient preference link and `List-Unsubscribe` header. The public confirmation endpoint HMAC-verifies the current prospect ID, email, and creation record, exposes no contact address, atomically suppresses the prospect, and dismisses every unsent campaign message. Configure `SANDFEST_OUTREACH_PREFERENCES_SECRET` on both API and worker to use a dedicated 32+ character HMAC root; otherwise the partner portal secret is reused with domain separation.

## Work Assignment Safety

The partner workspace includes a cross-team work board for SandFest staff, volunteers, and operating teams. Volunteer assignments are resolved against the current VolunteerLocal-shaped mirror. Staff assignments are resolved against the private annual `staff-directory` document, and team assignments are limited to seven configured operating teams whose notification owner is explicit. The browser may select only returned IDs; free-form staff identities and request-body recipient addresses are ignored or rejected. Assignment directories expose display identity, role, availability, and `emailAvailable`/`notificationReady` state without returning volunteer or staff addresses or phone numbers.

Invalid due dates and unknown assignment types are rejected. Every create and update records the actor, assignment, priority, status transition, and lifecycle timestamps in both the partner activity stream and the admin audit log. The task-board summary reports active, overdue, due-today, blocked, unassigned, completed, and per-owner workload counts without relying on client-side calculation.

Production readiness gates use the same governed work board. The API reconciles them once at startup and every 15 minutes by default: each failing check has one team-owned task, warnings are high priority with a 14-day deadline, blockers are urgent with a three-day deadline, passing checks complete active tasks, and regressions reopen the original task. Replays do not rewrite unchanged tasks. Automatic changes use the `deployment-readiness` system actor and aggregate-only audit evidence; the authenticated `Sync work board` command remains available for an immediate operator reconciliation. `SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS` accepts 0 or a whole number from 60000 through 86400000. Production `/ready` fails when automation is disabled, until startup reconciliation succeeds, and after any later automatic failure; development keeps this automation off unless explicitly enabled.

The worker creates one versioned assignment notice for an active task assigned to a governed volunteer, active staff member, or routed team and, once overdue, at most one reminder per overdue week. It re-resolves the current private address before approval and again before provider delivery. Reassignment or reopening increments the assignment and schedule versions; due-date changes increment the schedule version; completion or cancellation dismisses all active notices. A newly assigned overdue task waits 24 hours before an overdue reminder so assignment and escalation do not arrive together. Admin APIs and task exports expose notification state and a privacy-safe label, never the recipient address.

Production staff routing is fail-closed. The directory and every staff row must match `SANDFEST_EVENT_ID`; all active staff need valid email; all seven teams need one active owner; `verifiedAt` must be within 90 days; and the source must be `connecteam`, `manual_verified`, `oidc`, or `hr_import`. Seed, rollover, and board-demo sources cannot satisfy production. An operations administrator can choose a JSON or CSV file in the staff work board, attest its annual scope and source, preview the privacy-minimized result, and commit only while the exact file and current directory still match the preview. The API stores bounded aggregate import provenance and audit evidence without staff names or addresses. The CLI equivalent is `npm run import:staff -- /secure/staff-directory.json --source=manual_verified [--commit]`. Production commits require `SANDFEST_DATABASE_URL`, and an annual mismatch requires `npm run event:rollover` first.

## Partner Intake Bot Safety

Public vendor and sponsor intake is protected by Cloudflare Turnstile in production. The visitor bundle renders separate `vendor_application` and `sponsor_inquiry` widgets. The API sends each token to Cloudflare Siteverify and accepts it only when verification succeeds and both the returned action and hostname match the configured allowlist. The secret is never present in the browser; `VITE_SANDFEST_TURNSTILE_SITE_KEY` is the public widget identifier only.

Public event dates, hours, location, and contact facts are published through the authenticated Event guide editor. Every publish records the staff actor, official HTTPS source, source-check timestamp, snapshot, and audit event. `SANDFEST_EVENT_GUIDE_SOURCE_MAX_AGE_DAYS` defaults to 90; production `/ready` fails closed when the guide is unpublished, past, invalid, or sourced from an older review.

The production visitor artifact also fails closed for the sculptor roster and Live Beach scene. `public/data/sculptors.json` may expose records only when `meta.publicationStatus` is `published`, `meta.eventId` matches `SANDFEST_EVENT_ID`, the source is an authoritative HTTPS source, review and publication timestamps are present, a reviewer is recorded, and every sculptor, entry, and map reference is internally valid. Fictional roster and Live Beach scenarios live under `src/board-demo`, load only in local development, and are regression-tested to stay out of both production bundles and public data files. Until reviewed event-day content and current privacy-safe metrics are available, production renders explicit publication-pending and monitoring-standby states.

Live Island Conditions refresh is separately gated by
`SANDFEST_ISLAND_CONDITIONS_LIVE_FEEDS_ENABLED=true`. Until that post-board
acceptance step, public and admin endpoints serve only the stored governed
snapshot and make no NWS or TxDOT request. Synthetic conditions remain confined
to the isolated local board runtime.

`SANDFEST_EVENT_ID` is the annual namespace for new operational records and must use `texas-sandfest-YYYY`. It must match both the published guide and every active operational document. Production readiness fails closed on any mismatch. Use `npm run event:rollover` in maintenance mode to archive the prior season and reset season-specific state; the API and worker intentionally refuse partner mutations while their document is assigned to another event. The archive includes Postgres passport and voting append rows, which remain stored as historical evidence and are isolated from current reads by hunt and event ID.

Turnstile tokens expire after five minutes and are single-use. The API derives Siteverify's UUID retry key from the browser application retry key plus the challenge token, so a transport replay can receive the original verification result while a different submission cannot reuse it. Provider errors fail closed with `503`; invalid, expired, wrong-action, and wrong-host challenges fail before any application, task, milestone, draft, or queue job is created.

Create one production widget in Cloudflare, restrict it to every hostname in `SANDFEST_TURNSTILE_HOSTNAMES`, and configure:

```bash
# GitHub Actions repository variable used by the public Vite build
VITE_SANDFEST_TURNSTILE_SITE_KEY=<public-site-key>

# Render API secret/configuration
SANDFEST_TURNSTILE_ENABLED=true
SANDFEST_TURNSTILE_SECRET_KEY=<private-secret-key>
SANDFEST_TURNSTILE_HOSTNAMES=www.texassandfest.org,texassandfest.org,sandfest.heyelab.com,nickbmerrill-collab.github.io
SANDFEST_TURNSTILE_TIMEOUT_MS=8000
```

The production public build rejects a missing site key and Cloudflare's documented test keys. The API's `/ready` response remains red until server verification is configured. Keep the hostname list synchronized with the Cloudflare widget and remove the GitHub Pages hostname after the canonical-domain cutover. See Cloudflare's [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) and [client rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/) documentation.

The production visitor artifact also carries a CSP meta policy. Brand fonts are bundled locally; scripts and frames may load only from the site itself and `https://challenges.cloudflare.com`, as required by Cloudflare's [Turnstile CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/). Dynamic map and meter positioning uses a style-attribute-only allowance, while inline and evaluated scripts remain prohibited. Meta CSP cannot enforce `frame-ancestors`, so the canonical public hostname still requires edge response headers before launch; verify that customer-visible header surface separately from the local build.

## Partner Portal Safety

The website generates one high-entropy `Idempotency-Key` for each vendor or sponsor submission and keeps it across failed network attempts. The API stores only SHA-256 hashes of the key and canonical request, under the same file mutex or Postgres row lock used for the application write. Replaying the same key and body returns `200`, `duplicate: true`, the original reference, and the same current portal capability without creating another task, milestone set, message draft, or worker job. Reusing a key with changed details returns `409`; malformed keys return `400`. Clients that omit the header retain the legacy create behavior.

Application ID and six-digit public-reference allocations also run inside that serialized write. A generated ID or type-scoped reference collision is retried up to a fixed bound before the request fails with a retryable `503`; no partial application, task, date, finance record, or message is written. Portal verification checks the capability against every matching legacy reference, so a historical collision remains recoverable without changing either partner's reference or rotating their access.

Vendor and sponsor intake returns a high-entropy HMAC capability link. The reference and token live after `#partner-status` in the URL fragment, so browsers do not send them in the initial page request or referrer header. The frontend posts the pair to `/api/public/partner-status`, stores it only in session storage for the current tab, and removes the token from the visible URL after successful access.

The public response includes organization, application status, approved financial totals, invoice state, and public milestones. It excludes contact details, staff ownership, internal tasks, provider IDs, QuickBooks IDs, access metadata, and message delivery records. Invalid references and invalid tokens share one generic `404` response. Staff can rotate access through the partner workspace; the new application access ID/version changes the HMAC input and invalidates every older link. Rotation refreshes unsent draft links, clears approval when an approved body changes, and dismisses queued stale-link delivery so it cannot be sent without a new review.

Production fails closed unless both values are configured:

```bash
SANDFEST_PARTNER_PORTAL_SECRET=<32-or-more-random-characters>
SANDFEST_PUBLIC_SITE_URL=https://sandfest.heyelab.com
SANDFEST_PARTNER_STATUS_RATE_LIMIT=30
```

The API and worker must receive the same secret. `render.yaml` generates it on the API and binds the worker to that exact environment value; other deployments must provide an equivalent shared-secret mechanism. The worker uses it only to place a valid portal URL into reviewable acknowledgment and milestone-reminder drafts; tokens are not written to audit records or returned by partner-list APIs.

## Sponsor Brand And Fulfillment Safety

Sponsor package changes pass through a governed catalog before persistence. IDs, names, whole-cent USD amounts, public labels, benefits, boolean state, and optional Stripe Price IDs are normalized and validated; a change cannot remove the last active tier. Invalid edits return `400` without changing Postgres or the local document. The production readiness profile and live deployment verifier require a valid catalog, while public package responses contain only display, pricing, approval, and benefit fields and never expose Stripe or QuickBooks mappings.

Every sponsor tier benefit is copied into the sponsor's durable fulfillment checklist when the inquiry is accepted. Package changes later do not silently rewrite an existing agreement. Sponsors can submit a display profile, colors, usage requirements, social links, and either private files or HTTPS asset references. Profile and asset approvals are independent, and requested changes require a visible review note.

Private uploads accept only content-validated PNG, JPEG, WebP, and PDF files. The default limit is 10 MB, filenames are sanitized, files are written with private permissions, browser responses use `no-store` and `nosniff`, and download endpoints require either the current partner capability or an authenticated `partners:read` session. Storage keys and checksums are never returned by the public portal.

Vendor applications also create a category-specific compliance checklist that is frozen at intake. Universal requirements include the agreement, W-9, and certificate of insurance; food, retail, service, and nonprofit categories add their own permits or operating evidence. Vendors submit an operating profile and one current file or HTTPS reference per requirement. Staff review the profile and every requirement independently, with notes required for changes, waivers, and expiration decisions.

Staff publish booth, access-gate, load-in/load-out, pass, and wristband assignments. The vendor must explicitly confirm a complete schedule, and any schedule change clears that confirmation. A vendor is reported ready only when the operating profile is approved, every required item is approved or waived, and the current assignment is vendor-confirmed; there is no manual readiness override.

Production fails closed unless the upload directory is explicitly configured on persistent private storage:

```bash
SANDFEST_PARTNER_ASSET_DIR=/var/data/sandfest-partner-assets
SANDFEST_PARTNER_ASSET_MAX_BYTES=10485760
```

The Render blueprint attaches that directory to a 10 GB persistent disk. Because Render disks bind a service to one instance, a future horizontally scaled API should replace this adapter with private object storage while preserving the same metadata and authorization contract.

Staff track benefit owner, due date, lifecycle, proof URL or note, and partner review. A benefit cannot move to `published` or `complete` without proof. Any proof revision increments its version and automatically resets prior partner approval to pending, preventing stale sign-off from being treated as current.

## Private Document Intake Safety

The operations workspace accepts staff-only board packets, provider exports, finance files, runbooks, and communications. Content is validated independently of the filename, size is capped at 20 MB by default, filenames are sanitized, and bytes are written with private permissions. Each annual metadata record stores a SHA-256 checksum, byte count, domain, owner team, review deadline, review status, and bounded notes. Re-uploading identical bytes returns the original record instead of creating another copy.

Each accepted file also creates exactly one `incoming_document` task in the delegated work board. New files default to an Operations owner and a server-calculated three-day deadline unless staff selects another route or date. Review state is authoritative for the task lifecycle: received maps to open, in-review to in-progress, changes requested to blocked/high priority, approved to done, and archived to cancelled. Reassigning or rescheduling the document updates the same task, increments its routing versions, and invalidates stale notices. A checksum replay repairs missing task routing without creating a second file or task.

`documents:write` is limited to operations and super administrators. Finance administrators receive read access for controlled review and download. API responses never expose storage keys or private chunks, downloads use `no-store` and `nosniff`, and every upload, review, extraction source read, extraction retry, integrity failure, and download is audited without retaining file content or text previews.

PDF, DOCX, XLSX, and PPTX uploads enqueue versioned extraction jobs. The worker disables OCR, macros, attachments, and embedded execution; it stores bounded text and structural chunks only after verifying the source byte count and SHA-256. Empty text becomes `needs_review`, failures remain visible, and staff can explicitly retry as a new extraction version.

Production fails closed unless the intake directory is an explicit private persistent path beneath the shared upload disk:

```bash
SANDFEST_INCOMING_DOCUMENT_DIR=/var/data/sandfest-partner-assets/incoming-documents
SANDFEST_INCOMING_DOCUMENT_MAX_BYTES=20971520
SANDFEST_DOCUMENT_EXTRACTION_SECRET=<32-or-more-random-characters>
```

The API owns the persistent disk. A separately deployed worker must not mount or assume access to that directory. Give the worker the same `SANDFEST_DOCUMENT_EXTRACTION_SECRET` and set `SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL` to the HTTPS API base. The worker fetches only the exact queued event/checksum/version through the bearer-protected internal source route and verifies the bytes again before parsing. `render.yaml` generates and binds the shared secret automatically.

The `incoming-documents` platform record rolls over with the annual event namespace. A new season resets the queue; the archived prior-season digest remains part of rollover evidence.

## QuickBooks Invoice Safety

Only `finance_admin` and `super_admin` can create, approve, void, or queue partner invoices, refresh a synced QuickBooks invoice, or record and reverse partner payments. Draft amounts come from the approved application, and sponsor amounts originate from the active server-side tier. Payment references are idempotent per application and method, successful payments allocate atomically to the active invoice, and reversals require a reason and audit entry. Creating an invoice synchronizes its due date into the application's finance-owned `Payment due` milestone. Reaching the approved amount completes that milestone and dismisses active unsent reminders; a refund or reversal that restores a balance reopens only an automation-completed milestone and increments its schedule version. Staff-completed and cancelled milestones remain untouched. A recorded refund documents an action completed at the payment provider; it does not itself move money. The receivables board keeps SandFest's local balance separate from the last reported QuickBooks balance and surfaces aging, unapplied credit, overdue invoices, sync failures, stale refreshes, and amount or balance mismatches. QuickBooks refresh is read-only: it records provider truth and never creates a local payment, so finance must match the real external transaction before the ledgers can agree.

QuickBooks writes are disabled unless `QB_INVOICE_SYNC_ENABLED=true` and OAuth/realm credentials are complete. Finance connects through the operations console and the deployed callback at `/api/integrations/quickbooks/callback`; the callback accepts one unexpired, one-time state and returns a static no-store page. The refresh token is encrypted with `QB_TOKEN_ENCRYPTION_KEY` using AES-256-GCM and stored in the Postgres `quickbooks-credentials` platform document. The API and worker must share the same stable encryption key. The worker persists Intuit's rotated refresh token before continuing to customer, invoice, or reconciliation calls. Status and audit payloads never expose realm IDs, tokens, encryption material, or ciphertext. `QB_REALM_ID` and `QB_REFRESH_TOKEN` are migration fallbacks only.

The worker uses a stable QuickBooks `requestid` for each customer and invoice write, records provider IDs and errors, and never sends an invoice email automatically. Disconnecting in SandFest removes the encrypted local credential but does not revoke the provider grant; finance must also revoke the app in Intuit when access is terminated.

## Camera Metric Safety

Camera hosts retain stream credentials, frames, and inference locally. The API accepts only HMAC-signed metric JSON when `CAMERA_INGEST_ENABLED=true`. Production requires camera-bound credentials in `CAMERA_INGEST_KEYS`; each key can submit only for its assigned camera, and overlapping keys support rotation. The shared `CAMERA_INGEST_SECRET` fallback is development-only. A separate `CAMERA_MODEL_*` attestation binds the reviewed detector name, version, license decision, approver, decision record, and timestamp to the exact SHA-256 deployed on each host. Production readiness fails until both ingestion and model approval are ready, and signed metrics are rejected when their model identity does not match that approval. The API also checks clock skew, configured source identity, event IDs, metric ranges, and observation age. Duplicate event IDs return the original observation, stale sources publish `unknown`, and the public payload omits source IDs, model details, notes, and internal processing metadata. See `docs/camera-metric-ingestion.md` and `docs/camera-edge-agent.md`.

## Scale Profile

For 100,000+ visitors, public reads must be served through CDN/edge caching and separated from admin/payment writes.

- The public frontend includes a web app manifest and service worker for offline reopening of the guide shell and static event data.
- Public `GET` routes now emit cache headers for edge caching.
- The public alert endpoint emits a 15-second cache profile for fast event-day changes.
- Admin routes and write routes emit `no-store`.
- API responses include request IDs and security headers.
- Local in-memory rate limits protect public, admin, and checkout routes during development.
- `/ready` exists for deployment health checks.
- Admin mutations now write local audit JSON records.
- Alert, ticket, and sponsor config writes now capture restoreable snapshots before mutation.
- Local JSON files are development-only; production needs Postgres plus durable background jobs for payment events, fulfillment, and QuickBooks sync.

See `docs/scale-and-reliability.md`.

## Deployment Diagnostics

`GET /health` includes a compact deployment summary. `GET /ready` includes the full deployment profile and returns `503` when strict production checks fail. `GET /api/admin/deployment` exposes the same profile to the admin console.

Set `SANDFEST_ENV=production` when deploying to Heyelab. In production, these checks are blocking:

- `SANDFEST_AUTH_MODE=jwt` with a HTTPS `SANDFEST_AUTH_JWKS_URL` and an `SANDFEST_AUTH_ISSUER` — bearer-token mode is not allowed in production.
- The static admin build must use OIDC with a registered SPA client and HTTPS issuer, redirect, logout, and API URLs. The production build fails before publishing when these values are absent.
- `SANDFEST_API_PUBLIC_BASE_URL` and `SANDFEST_ADMIN_BASE_URL` must be HTTPS.
- `SANDFEST_PARTNER_PORTAL_SECRET` must be at least 32 characters and `SANDFEST_PUBLIC_SITE_URL` must be HTTPS.
- `SANDFEST_PARTNER_ASSET_DIR` must point to persistent private storage for sponsor assets and vendor compliance documents.
- `SANDFEST_INCOMING_DOCUMENT_DIR` must point to persistent private storage for staff-only operational source files.
- `SANDFEST_DOCUMENT_EXTRACTION_SECRET` must be at least 32 characters on the API and worker; a separate production worker also requires an HTTPS `SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL`.
- Recovery policy must confirm at least three days of database PITR and seven days of asset snapshots; isolated database and exhaustive asset verification drills must both be no older than `SANDFEST_RESTORE_DRILL_MAX_AGE_DAYS`.
- CORS must include the Texas SandFest origins and admin base URL.
- If Stripe ticketing is enabled, Stripe secret, webhook secret, success URL, and cancel URL must be production-safe.
- If Stripe partner payments are enabled, the shared Stripe secret and webhook secret, partner success/cancel HTTPS URLs, and official Stripe API origin must all pass readiness. Partner webhooks also enforce the configured timestamp tolerance.
- Required camera ingestion must have all eight camera-bound keys plus a reviewed `CAMERA_MODEL_*` approval bound to the deployed model SHA-256.

Rate-limit knobs:

```bash
SANDFEST_RATE_LIMIT_WINDOW_MS=60000
SANDFEST_PUBLIC_RATE_LIMIT=600
SANDFEST_ADMIN_RATE_LIMIT=120
SANDFEST_CHECKOUT_RATE_LIMIT=30
SANDFEST_PARTNER_STATUS_RATE_LIMIT=30
```

Production also requires a shared limiter. The Render Blueprint provisions a private paid Key Value service, exposes its internal `connectionString` to the API as `REDIS_URL`, disables persistence for the short-lived counters, and uses `noeviction` so capacity pressure cannot silently erase active limits. The Blueprint contract test rejects a public or per-process-only production topology.

In production, pair these app-level limits with Vercel Firewall or the chosen API gateway so abusive traffic can be blocked before it reaches origin.

## Security Rules

- Public APIs return only public-safe fields.
- Admin APIs require bearer-token auth locally and a real identity provider in production.
- Finance and checkout settings require elevated admin roles.
- Route handlers enforce prototype permissions before mutations.
- Snapshot restores require rollback permission and write a rollback audit record.
- Background-job responses expose workflow status rather than payloads or raw provider errors. Only operations administrators can acknowledge an unresolved terminal failure, and every acknowledgment requires a resolution note and audit record.
- Responses include `x-request-id`, `x-content-type-options`, `referrer-policy`, and `permissions-policy`.
- Client-supplied request IDs are accepted only when they match the bounded trace-ID format; invalid values are replaced server-side.
- Audit records never retain bearer-token fragments and recursively redact capability tokens, OAuth tokens, API keys, signatures, passwords, and secrets.
- Production `500` responses return a generic message plus the request ID; the internal error is written only to the service log for correlation.
- Public, admin, and checkout routes have local rate-limit buckets.
- Never expose `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, QuickBooks secrets, or refresh tokens to the browser.
- Do not allow the frontend or iOS app to set trusted prices.
- Every admin mutation should produce an audit event before production launch.

## Deployment Checklist

1. Point `api.<heyelab-domain>` to the backend service.
2. Point `sandfest-admin.<heyelab-domain>` to the admin UI.
3. Register the admin SPA client and exact redirect/logout URIs at the IdP.
4. Set API and static-build environment variables from `.env.example` and `docs/heyelab-auth-contract.md`.
5. Configure CORS for Texas SandFest, Heyelab admin, and the IdP discovery/token endpoints.
6. Preview and commit the verified current-event staff directory; confirm all seven team routes are ready.
7. Connect Stripe sandbox keys and webhook signing secret.
8. Connect QuickBooks sandbox credentials.
9. Run health check: `GET /health` and readiness check: `GET /ready`.
10. Verify public reads: `/api/public/tickets`, `/api/public/sponsors`, and a source-cited `POST /api/public/concierge` response with `cache-control: no-store`.
11. Sign in through `sandfest-admin.heyelab.com`, confirm `/api/admin/session`, and load the operations workspace.
12. Patch one sandbox ticket price and confirm the public endpoint reflects the change.
13. Upload, review, and checksum-download one disposable private document; confirm it is included in the isolated asset-recovery manifest.

## Future Production Stack

Recommended stack:

- Next.js or Vercel Functions for admin UI and API routes.
- Postgres for config, orders, sponsor packages, audit logs, and payment events.
- Stripe Checkout for GA/VIP and Payment Links or invoices for sponsor flows.
- QuickBooks Online integration for accounting mirror/sync.
- Role-based auth for super admin, finance admin, ticketing admin, sponsor admin, and read-only board users.

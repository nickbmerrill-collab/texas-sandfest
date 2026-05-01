# Heyelab Backend Deployment

This backend should run as the configurable admin and API layer for SandFest while the public website and iOS app consume stable public endpoints.

## Target Hostnames

Use Heyelab-controlled subdomains:

- Public/API base: `https://api.heyelab.com/sandfest`
- Admin console: `https://sandfest-admin.heyelab.com`
- Stripe webhook: `https://api.heyelab.com/sandfest/api/stripe/webhook`
- QuickBooks OAuth callback: `https://api.heyelab.com/sandfest/api/integrations/quickbooks/callback`

If Heyelab uses a different root domain, keep the same shape:

```text
api.<heyelab-domain>/sandfest
sandfest-admin.<heyelab-domain>
```

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
| `POST` | `/api/stripe/create-checkout-session` | Public | Validate cart and create a Stripe Checkout Session when configured |
| `POST` | `/api/stripe/webhook` | Stripe signature | Record Stripe events and queue fulfillment |
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

Admin calls use:

```http
Authorization: Bearer <SANDFEST_ADMIN_API_TOKEN>
```

Local role is controlled by:

```bash
SANDFEST_ADMIN_ROLE=super_admin
SANDFEST_ADMIN_ACTOR_ID=local-admin
```

Supported prototype roles:

| Role | Intent |
| --- | --- |
| `super_admin` | Full local access |
| `ops_admin` | Alerts, orders, payment events, fulfillment, audit |
| `ticketing_admin` | Ticket config, orders, payment events, fulfillment reads, audit |
| `sponsor_admin` | Sponsor package config, orders, fulfillment reads, audit |
| `finance_admin` | Orders, payment events, fulfillment reads, audit |
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

The admin backend owns mutable configuration:

- `data/config/admin-config.json`
- `data/config/emergency-alert.json`
- `data/processed/ticket-products.json`
- `data/processed/orders/pending/*.json`
- `data/processed/orders/payment-events/*.json`
- `data/processed/orders/fulfillment/*.json`
- `data/processed/admin-audit/*.json`
- `data/processed/config-snapshots/*.json`

The production version should move these records into a database with audit history:

- `ticket_products`
- `sponsor_packages`
- `checkout_settings`
- `admin_audit_events`
- `config_snapshots`
- `emergency_alerts`
- `payment_provider_events`
- `quickbooks_sync_events`

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

- `SANDFEST_ADMIN_API_TOKEN` must be a long non-placeholder secret.
- `SANDFEST_ADMIN_ACTOR_ID` must identify the deployed actor/provider.
- `SANDFEST_API_PUBLIC_BASE_URL` and `SANDFEST_ADMIN_BASE_URL` must be HTTPS.
- CORS must include the Texas SandFest origins and admin base URL.
- If Stripe ticketing is enabled, Stripe secret, webhook secret, success URL, and cancel URL must be production-safe.

Rate-limit knobs:

```bash
SANDFEST_RATE_LIMIT_WINDOW_MS=60000
SANDFEST_PUBLIC_RATE_LIMIT=600
SANDFEST_ADMIN_RATE_LIMIT=120
SANDFEST_CHECKOUT_RATE_LIMIT=30
```

In production, pair these app-level limits with Vercel Firewall or the chosen API gateway so abusive traffic can be blocked before it reaches origin.

## Security Rules

- Public APIs return only public-safe fields.
- Admin APIs require bearer-token auth locally and a real identity provider in production.
- Finance and checkout settings require elevated admin roles.
- Route handlers enforce prototype permissions before mutations.
- Snapshot restores require rollback permission and write a rollback audit record.
- Responses include `x-request-id`, `x-content-type-options`, `referrer-policy`, and `permissions-policy`.
- Public, admin, and checkout routes have local rate-limit buckets.
- Never expose `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, QuickBooks secrets, or refresh tokens to the browser.
- Do not allow the frontend or iOS app to set trusted prices.
- Every admin mutation should produce an audit event before production launch.

## Deployment Checklist

1. Point `api.<heyelab-domain>` to the backend service.
2. Point `sandfest-admin.<heyelab-domain>` to the admin UI.
3. Set environment variables from `.env.example`.
4. Configure CORS for Texas SandFest, Heyelab admin, and local dev origins.
5. Connect Stripe sandbox keys and webhook signing secret.
6. Connect QuickBooks sandbox credentials.
7. Run health check: `GET /health`.
8. Verify public reads: `/api/public/tickets`, `/api/public/sponsors`.
9. Verify admin token access: `/api/admin/config`.
10. Patch one sandbox ticket price and confirm the public endpoint reflects the change.

## Future Production Stack

Recommended stack:

- Next.js or Vercel Functions for admin UI and API routes.
- Postgres for config, orders, sponsor packages, audit logs, and payment events.
- Stripe Checkout for GA/VIP and Payment Links or invoices for sponsor flows.
- QuickBooks Online integration for accounting mirror/sync.
- Role-based auth for super admin, finance admin, ticketing admin, sponsor admin, and read-only board users.

# Texas SandFest AI Platform

Standalone prototype for turning Texas SandFest into a unified AI-powered visitor and operations platform.

## Current build

- Public visitor experience with current event facts.
- "Ask Sandy" concierge prototype with local knowledge routing.
- Beach operations dashboard for crowd zones, run-of-show, and dispatch signals.
- Sponsor, vendor, volunteer, and visitor module framing.
- Ground-up production roadmap for content, AI, ops, and partner portals.
- Native iOS and Port A Local Co integration plans.
- Stripe-ready ticket ordering scaffold with Apple Pay, VIP, sponsor, and review-gated raffle planning.
- Configurable admin API scaffold for Heyelab-hosted ticket and sponsorship settings.
- Event-day emergency alert API and admin publishing controls.
- Unified revenue ledger (`lib/revenue.mjs`) with a role-guarded `GET /api/admin/revenue` dashboard endpoint that normalizes Stripe/Eventeny/Square/manual revenue by category and source and tracks fees + bank reconciliation. Seeded from `data/processed/revenue-ledger.json` until live payment feeds are wired.
- Fleet/asset checkout (`lib/fleet.mjs`) for golf carts, UTVs, generators, and equipment: role-guarded admin API (`fleet:read` / `fleet:write`), web ops panel, and iOS Admin → Fleet tab with QR check-out/in (`tsf:asset:<id>`). Seeded from `data/processed/fleet.json`.
- Installable/offline-capable public web shell for spotty event-day connectivity.

## Commands

```bash
npm install
npm run dev
npm run scrape:public
npm run media:download
npm run incoming:scan
npm run public:sync
npm run extract:documents
npm run ios:seed
npm run vault:build
npm run api:dev
npm run api:load-test
npm run qb:status
```

The app runs with Vite and serves from `src/main.js` and `src/styles.css`.

The public shell also includes `public/manifest.webmanifest` and `public/sw.js` so the built site can be installed and reopened with cached event data.

Public crawl output lives in `data/processed/`, with raw evidence snapshots in `data/raw/`.

## Planning docs

- `docs/ultimate-festival-platform.md` — master blueprint: build-vs-buy per module, phased roadmap, budgets
- `docs/research/` — eight cited research briefs (volunteer, sponsor/vendor+mapping, sculptor/wayfinding, fleet, RFID/cashless/ticketing, connectivity, gamification, marketing/comms)
- `docs/incoming-access-intake.md` — runbook for incoming documents and logins/credentials
- `docs/architecture.md`
- `docs/ios-app-plan.md`
- `docs/app-data-contract.md`
- `docs/frontend-media.md`
- `docs/incoming-ingestion.md`
- `docs/stitch-handoff.md`
- `docs/port-a-local-co-integration.md`
- `docs/stripe-ticketing.md`
- `docs/heyelab-backend-deployment.md`
- `docs/heyelab-auth-contract.md`
- `docs/scale-and-reliability.md`
- `data/schemas/platform-objects.json`

## Heyelab admin API

The local configurable backend runs on `http://127.0.0.1:8788`.

```bash
SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me npm run api:dev
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8788/ready
curl -I http://127.0.0.1:8788/api/public/alert
curl http://127.0.0.1:8788/api/public/alert
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/session
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/deployment
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/revenue
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/fleet
curl -X POST -H "Authorization: Bearer dev-admin-token-change-me" -H "content-type: application/json" --data '{"payload":"tsf:asset:cart-02"}' http://127.0.0.1:8788/api/admin/fleet/resolve-qr
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/config
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/audit
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/snapshots
curl -X PATCH -H "Authorization: Bearer dev-admin-token-change-me" -H "content-type: application/json" --data '{"active":true,"severity":"watch","title":"North Gate update","message":"Use the south entrance for shorter lines.","audience":["public"],"expiresAt":null}' http://127.0.0.1:8788/api/admin/alert
curl -X POST -H "content-type: application/json" --data '{"items":[{"productId":"general-admission-3-day","quantity":1}]}' http://127.0.0.1:8788/api/stripe/create-checkout-session
npm run api:load-test -- http://127.0.0.1:8788 1000 50
```

Target deployment shape:

- `https://api.heyelab.com/sandfest` for public and admin APIs.
- `https://sandfest-admin.heyelab.com` for the admin UI.

See `docs/heyelab-backend-deployment.md`.

Local admin roles are controlled with `SANDFEST_ADMIN_ROLE`. Supported prototype values are `super_admin`, `ops_admin`, `ticketing_admin`, `sponsor_admin`, `finance_admin`, and `viewer`.

Local rate limits are controlled with `SANDFEST_PUBLIC_RATE_LIMIT`, `SANDFEST_ADMIN_RATE_LIMIT`, `SANDFEST_CHECKOUT_RATE_LIMIT`, and `SANDFEST_RATE_LIMIT_WINDOW_MS`.

Checkout attempts and webhook events are stored locally under `data/processed/orders/`, admin mutations are stored under `data/processed/admin-audit/`, and pre-change config snapshots are stored under `data/processed/config-snapshots/`, until this moves to a production database.

## iOS

```bash
cd ios
xcodegen generate
xcodebuild -project TexasSandFest.xcodeproj -scheme TexasSandFest -configuration Debug -destination 'generic/platform=iOS Simulator' build
```

The initial native SwiftUI scaffold lives under `ios/TexasSandFest/`. It now has a Customer/Admin mode switch. Customer mode covers Today, Schedule, Beach, Sculptors, Ask Sandy, and Tickets. Admin mode covers Command, Incidents, Partners, Finance, and Setup.

The **Sculptors** tab (`SculptorsView.swift`) mirrors the web build: an artist roster with division filters and detail sheets, a compact corridor map with tappable pins, and the **Sculpture Passport** — collect a stamp per sculpture (tap, or scan the on-beach QR via the existing `QRScannerView`), tracked per-user in `PassportStore` (UserDefaults, mirrors `FavoritesStore`). New Swift files are picked up by `xcodegen generate`; the file is also wired into the committed `project.pbxproj` so it builds without regenerating.

The native app reads from `ios/TexasSandFest/Resources/sandfest-seed.json` through `AppDataStore`, so incoming data can be normalized once and shared by customer and admin screens. Update `data/processed/app-bootstrap.json`, then run `npm run ios:seed`.

## Obsidian vault

The local vault lives at `Texas SandFest Vault/`.

Run `npm run vault:build` after a public scrape, document extraction, or internal data drop. New incoming files should land in:

- `data/incoming/eventeny/`
- `data/incoming/docs/`
- `data/incoming/ops/`
- `data/incoming/finance/`
- `data/incoming/comms/`
- `data/incoming/quickbooks/`

## QuickBooks

QuickBooks is scaffolded for plug-in access once credentials arrive.

```bash
cp .env.example .env
npm run qb:status
npm run qb:callback
npm run qb:auth-url
```

See `docs/quickbooks-integration.md` for the OAuth and sync plan. Keep all QuickBooks credentials and token files out of git.

## Source facts used

- Official Texas SandFest site: dates, location, mission, public contact channels, sponsor tier language.
- Eventeny ticketing page: 2026 dates, ticket categories, ticketing/application host.
- Texas SandFest FAQ/volunteer pages: volunteer registration deadline framing and core visitor workflows.

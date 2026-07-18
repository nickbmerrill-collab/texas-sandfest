# Texas SandFest AI Platform

Standalone prototype for turning Texas SandFest into a unified AI-powered visitor and operations platform.

## Current build

- Public visitor experience with current event facts.
- "Ask Sandy" concierge prototype with local knowledge routing.
- Beach operations dashboard for crowd zones, run-of-show, and dispatch signals.
- Sponsor, vendor, volunteer, and visitor module framing.
- Ground-up production roadmap for content, AI, ops, and partner portals.
- Native iOS and Port A Local Co integration plans.
- Configuration-gated Stripe ticket checkout with provider-private public catalogs, server-authoritative prices and quantities, browser/server idempotency, signed webhook reconciliation, deterministic wristband/will-call fulfillment, and full/partial refund states. Static builds fail closed until the API confirms the current catalog and Stripe integration are ready; sponsor packages remain invoice/review based and the raffle remains review-gated.
- Configurable admin API scaffold for Heyelab-hosted ticket and sponsorship settings.
- Event-day emergency alert API and admin publishing controls.
- Unified current-event revenue ledger (`lib/revenue.mjs`) with a role-guarded `GET /api/admin/revenue` dashboard endpoint that merges audited site-native sponsor/vendor receipts and reversals with explicitly event-scoped Stripe/Eventeny/Square imports, deduplicates provider references, excludes stale or unscoped event data, and tracks fees plus bank reconciliation. Finance can load provider settlement CSVs through a preview-gated `POST /api/admin/revenue/import` workflow (`lib/revenue-import.mjs`): exact cents, refund/void signs, event/provider scope, duplicate references, invalid rows, atomic commits, replay protection, import history, and audit evidence are enforced server-side.
- Fleet/asset checkout (`lib/fleet.mjs`) for golf carts, UTVs, generators, and equipment: role-guarded admin API (`fleet:read` / `fleet:write`), web ops panel, and iOS Admin → Fleet tab with QR check-out/in (`tsf:asset:<id>`). Seeded from `data/processed/fleet.json`.
- Volunteer coverage mirror (`lib/volunteers.mjs`): VolunteerLocal-shaped roster/shifts/hours → ops fill-vs-needed by zone, understaffed shift list, hour totals. `GET /api/admin/volunteers` (`volunteers:read`). Seeded from `data/processed/volunteer-mirror.json`.
- Governed staff and team routing (`lib/staff-directory.mjs`): active staff are selected from a private annual directory, every operating team resolves to one accountable notification owner, and admin responses expose only display identity and delivery readiness. `npm run import:staff -- path/to/staff.json --source=manual_verified` previews a JSON or CSV import; add `--commit` only after all seven routes pass. Production rejects seed/demo sources, event mismatches, active staff without email, missing routes, and verification older than 90 days.
- Private document intake (`lib/incoming-documents.mjs`): operations staff can upload board packets, provider exports, finance files, runbooks, and communications into an annual review queue with domain, accountable team, server-owned review deadline, text/CSV/JSON previews, checksum deduplication, review and archive states, and audited checksum-verified downloads. Every accepted file is synchronized into the delegated work board; owner, due-date, changes-requested, approval, reopening, and archive changes update the same task so staff routing and bounded assignment/overdue notices apply without duplicate work. File bytes remain on a private persistent mount; Postgres stores governed metadata only, API responses never expose storage paths, and production readiness requires `SANDFEST_INCOMING_DOCUMENT_DIR`.
- Consent-safe Twilio alert delivery (`lib/consent.mjs`, `lib/sms.mjs`, `lib/sms-operations.mjs`): separate unchecked marketing/safety channels, explicit operator send confirmation, one retry-safe job per consent record, immediate pre-send consent revalidation, signed delivery and STOP/START/HELP callbacks, privacy-minimized campaign evidence, and queued-message cancellation when an alert is cleared. `sms_safety` remains a production readiness blocker until the real sender and callbacks are configured and capacity-tested; see `docs/sms-safety.md`.
- Sculpture Passport backend (`lib/passport.mjs`): public stamp API + progress + admin stats; web/iOS offline-first clients sync stamps when the API is reachable. QR: `tsf:cp:<id>` / `tsf:entry:<entryId>` / `TSF-CP-000N`.
- People's Choice voting (`lib/voting.mjs`) + public booth/vendor map (`lib/booths.mjs`). Eventeny booth assignments now use a role-guarded preview/commit workflow in the Booth workspace (`lib/booth-import.mjs`, `POST /api/admin/booths/import`): current-event validation, exact mirror-version binding, atomic file/Postgres reconciliation, concurrent replay protection, bounded import history, and aggregate-only audits. Blank publication and compliance fields fail private and incomplete; absent local records are preserved. See `docs/eventeny-booth-import.md`.
- Public vendor and sponsor intake with production-enforced Cloudflare Turnstile verification, server-validated sponsorship tiers and category-compatible vendor offerings, generated references, linked review tasks, key dates, finance-guarded payment allocation/reversal, receivables aging and reconciliation, and review-first acknowledgment drafts (`lib/partner-ops.mjs`, `lib/vendor-offerings.mjs`, `lib/turnstile.mjs`). Vendor prices and QuickBooks item mappings come from the staff-managed offering catalog; browser-supplied amounts are ignored, and approved invoices inherit the captured fee without manual re-entry. Invoice creation synchronizes the finance-owned payment key date; full payment completes it and dismisses active reminders, while a refund or reversal reopens only a date previously completed by payment automation. Browser submissions carry a stable retry key so a reconnect, double submission, or gateway replay returns the original application and private portal instead of duplicating downstream work. Every intake also receives a rotatable HMAC capability link for a privacy-minimized self-service view of application, invoice, payment, milestone, brand, and benefit-delivery status (`lib/partner-portal.mjs`). After finance approves an invoice, the portal can create one trusted Stripe Checkout Session for its current balance; signed webhooks post the payment into receivables, suppress ticket fulfillment, reject amount/currency mismatches, and restore balances for partial or full refunds (`lib/stripe-partner-payments.mjs`). Sponsor tiers seed durable fulfillment checklists; sponsors can submit reviewable brand assets and sign off on delivery proof. Approved sponsor applications with approved brand profiles automatically join the visitor-site showcase; only approved self-hosted PNG, JPEG, or WebP logo uploads are public, while external assets, PDFs, contacts, application identifiers, review records, and storage metadata remain private (`lib/sponsor-showcase.mjs`). Vendor categories seed frozen compliance checklists; vendors can submit an operating profile and private evidence, then confirm staff-published booth and load-in assignments. Staff readiness is derived from approved profile, cleared requirements, and vendor-confirmed scheduling.
- Partner operations workspace for application status, accounting, task delegation, editable key dates, draft follow-ups, and geographically scored outreach prospects. Staff can preview and commit Eventeny vendor/sponsor application exports through a contact-attested, event-scoped, catalog-priced, idempotent workflow; imported provider statuses remain provenance while every local application enters review as `submitted`, and Eventeny imports skip the duplicate acknowledgment draft. Exact replays add nothing, changed records with the same Eventeny ID are held for manual review, and aggregate-only audits retain the batch, file name, and counts. See `docs/eventeny-partner-import.md`. The work board supports roster-backed volunteer assignment, governed staff/team ownership, priority and due-date controls, blocked/in-progress/completed lifecycles, overdue and workload summaries, and privacy-minimized assignment directories. Assigned volunteers, active directory staff, and teams with a current notification owner receive one versioned assignment notice and bounded weekly-overdue reminders through the retry-safe worker; reassignment, rescheduling, completion, cancellation, or a directory identity change invalidates stale delivery. Staff can add, assign, reschedule, complete, cancel, or reopen partner milestones with per-date reminder lead times; schedule changes invalidate stale drafts. Finance can refresh an already-synced QuickBooks invoice through a versioned worker job; reported total, balance, provider timestamp, and refresh proof are mirrored without creating a local payment, while stale, failed, amount, and balance differences become visible reconciliation exceptions. Role-guarded, audited downloads export partner records, receivables, payments, delegated work with notification state, and outreach as spreadsheet-safe CSV plus key dates as an Outlook/Google Calendar-compatible `.ics` file; recipient addresses, capability tokens, and intake hashes are excluded. Vendor profile changes, compliance corrections, and booth/load-in publications automatically create deduplicated message drafts; remediation, confirmation, or another revision dismisses stale unsent notices. Known-partner acknowledgments, milestone reminders, vendor corrections, and governed task notices can be placed in explicitly enabled transactional automation after consent or directory-recipient revalidation; incident dispatch remains review-first. Sponsor outreach defaults to per-message review or can use an explicitly approved campaign sequence with provider readiness, one-to-100 daily caps, retry-safe jobs, pause-to-review behavior, and recipient/targeting revalidation before delivery. Outreach also supports signed-preview regional business discovery, preview-gated CSV imports, reusable campaigns, industry/city/state/ZIP/radius/fit segmentation, editable business and contact research, one-to-four-step personalized sequences, documented contact basis, stale-geofence invalidation, and immediate suppression of every unsent message. OpenStreetMap discovery can fail over across three explicitly reviewed HTTPS Overpass instances for transient provider failures; successful previews report the serving hostname and attempt count without weakening the signed import gate. Staff can issue a package-specific, expiring sponsor invitation from a qualified prospect; the recipient explicitly submits the public sponsor form before the prospect is atomically linked to branding, fulfillment, key dates, finance, tasks, and its private portal. Discovered candidates preserve source attribution and remain ineligible until staff verifies the contact. Recipient-specific HMAC preference links and `List-Unsubscribe` headers provide a privacy-minimized public opt-out that atomically cancels pending outreach and is revalidated before provider delivery. Imports skip existing prospects and never overwrite staff edits.
- Isolated 2027 board runtime (`npm run board:runtime`) for exercising the real visitor, document intake, partner, finance, task, outreach, engagement, and island-conditions workflows against visibly labeled synthetic data without mutating repository history. Loopback-only `npm run board:cameras` drives all eight condition lanes through the real signed health and metrics API; transient API outages retry the same stable cycle, re-verify the isolated runtime, and restore all eight sources automatically. `npm run board:mailbox` captures reserved-domain email, and `npm run board:sms` accepts only fictional `555-01xx` numbers, returning SDK-signed delivery and STOP/START callbacks without contacting an external provider. See `docs/board-runtime.md`.
- Policy-gated transactional email delivery (`lib/email.mjs`, `lib/brevo-webhook.mjs`): Brevo stays disabled until a verified sender, API key, and authenticated delivery webhook are configured; the worker generates versioned, idempotent milestone and governed volunteer/staff/team task drafts without piling up while an earlier draft is actionable. Review-first is the default. Administrators may enable the bounded transactional policy documented in `docs/partner-message-automation.md`, while outreach staff may separately approve a bounded campaign sequence documented in `docs/sponsor-outreach-automation.md`; deterministic queue keys prevent repeat scheduling. Operational dispatch still requires staff approval. Delivery acceptance, delivery, opens, clicks, deferrals, bounces, blocks, complaints, and unsubscribes are recorded idempotently; terminal recipient events suppress the prospect and cancel every unsent outreach message.
- Crash-recoverable background work (`lib/job-queue.mjs`): Postgres and local development claims use fenced five-minute leases, stale claims return to the queue, late workers cannot complete a newer claim, final expired delivery jobs reconcile their sponsor, invoice, or incident workflow to a visible failed state, and queue health is visible in `/ready`, `/api/admin/jobs`, and the operations console. Production readiness rejects file storage.
- Actionable launch control (`GET /api/admin/deployment`): every server-computed readiness check carries a stable ID, operator label, and operational group. The admin console defaults to errors and warnings, can expand all checks, and keeps platform, access, program-data, revenue, partner, communications, and field-operation gates tied to the current environment instead of a client-side checklist.
- Island Conditions combines live National Weather Service forecasts and alerts with TxDOT ferry references and an eight-camera traffic/crowd/line grid (`lib/island-conditions.mjs`). The NWS adapter selects the current valid hourly period, immediately refreshes an expired persisted period, and withholds stale temperature details from public responses. The visitor view respects the one-minute public cache and refreshes on a jittered 60-75 second cadence; manual refresh is explicit, while staff see upstream observation, attempt, freshness, and failure status. Fresh ferry-camera metrics generate a labeled wait estimate, while reviewed operator data takes precedence. The local Python edge agent uses YOLO + ByteTrack to derive anonymous counts, flow, queue, occupancy, and wait metrics without sending frames off the camera host (`camera_agent/edge_agent.py`). It posts HMAC-signed, idempotent observations and health through `lib/camera-ingest.mjs`; observations expire to unknown when stale, public payloads omit source/model internals, and footage is not stored. Automatic device selection prefers CUDA, then Apple MPS, then CPU. Each production camera service refuses to start without its scoped stream/secret environment, an artifact-bound model license approval, and the cached model's approved checksum; failed opens and reads use bounded reconnect backoff and rate-bounded error heartbeats. A separate local-compute acceptance keeps all eight model instances resident and verifies the complete inference cycle against the configured sample-rate budget using generated pixels. Elevated condition and pipeline-health signals open deduplicated, owned incidents; recovery moves them to monitoring, while resolution and public notices remain human-controlled. Incident Command can dispatch teams, staff, or roster-backed volunteers, track acknowledgment through on-scene closeout, and prepare reviewed operational email without exposing recipient addresses in API responses. Closing an incident cancels active dispatches and unsent notifications. See `docs/camera-edge-agent.md` for installation and calibration.
- Full suite: `npm run test:platform` (libs), `npm run test:platform:api` (live file-mode smoke), and `npm run test:postgres` (isolated production data-plane acceptance).
- Recovery drill: restore Postgres and the private upload-disk snapshot into isolated targets. Run `npm run recovery:verify` for the database proof, then set `SANDFEST_RECOVERY_ASSET_DIR` and run `npm run recovery:verify:assets` to prove every restored sponsor, vendor, and incoming-document upload by size and SHA-256 before recording either drill timestamp.
- Board deck: `docs/presentations/SandFest-Board-Platform-Briefing.pptx`.
- Enterprise scale path: atomic/mutex JSON or Postgres (`lib/platform-data.mjs`), body size caps, public-write rate limits, HTML escaping, empty admin token field. See `docs/enterprise-scale.md`.
- Shared rate limits via Redis/Upstash (`lib/rate-limit.mjs`), async SMS worker (`npm run worker`), ticket-linked voting, and separately built visitor/admin deployment artifacts.
- CI: `.github/workflows/ci.yml` (tests, API smoke, build, load-test, Swift parse).
- Installable/offline-capable public web shell for spotty event-day connectivity.

## Commands

```bash
npm install
npm run dev
npm run scrape:public
npm run media:download
npm run incoming:scan
npm run public:sync
npm run ready
npm run extract:documents
npm run ios:seed
npm run vault:build
npm run api:dev
npm run api:load-test
npm run test:platform
npm run test:platform:api
npm run test:postgres
npm run test:camera-agent
npm run test:camera-model-approval
npm run test:camera-agent:runtime
npm run test:camera-agent:fleet-runtime
npm run camera:model:verify
npm run camera:agent:validate
npm run build:surfaces
npm run ready:production
npm run deployment:verify
npm run worker
npm run worker:once
npm run import:booths -- path/to/eventeny-booths.csv
npm run import:volunteers
npm run qb:status
```

Preview-gated VolunteerLocal roster, shift, and hour reconciliation is available in the Staffing workspace. The CLI fallback uses the same atomic contract:

```bash
npm run import:volunteers -- roster.csv --shifts=shifts.csv --hours=hours.csv
# Re-run unchanged files with the printed hash:
npm run import:volunteers -- roster.csv --shifts=shifts.csv --hours=hours.csv --commit --preview-hash=<hash>
```

See `docs/volunteerlocal-import.md` for accepted headers and reconciliation rules.

Preview-gated Eventeny booth reconciliation is available in the Booth map workspace. The CLI fallback uses the same transaction and replay contract:

```bash
npm run import:booths -- path/to/eventeny-booths.csv
# Re-run the unchanged file only after reviewing the preview:
npm run import:booths -- path/to/eventeny-booths.csv --commit --preview-hash=<hash> --current-event-confirmed
```

See `docs/eventeny-booth-import.md` for accepted headers, privacy defaults, and assignment rules.

For a board-demo readiness pass, run `npm run ready`. It refreshes the public
JSON payloads, runs the pure platform suite, and builds the combined local
artifact without production source maps unless `SOURCE_MAPS=true` is set.

For a production data-plane pass, run `npm run ready:production` while a local
Postgres server is available. The Postgres suite creates a uniquely named test
database, launches the real API and worker, verifies concurrent intake and
durable workflows, and drops that database without changing demo data. Set
`SANDFEST_POSTGRES_TEST_ADMIN_URL` when the admin database is not available at
`postgresql:///postgres?sslmode=disable`.

After both production artifacts are built, `npm run deployment:verify` checks
the canonical public, API, and admin hostnames against those exact artifacts.
It fails closed on stale bundles, unresolved or non-HTTPS targets, missing edge
headers, a non-production API, red capability gates, CORS drift, unavailable
ticket/vendor/sponsor contracts, or an incomplete Island Conditions fleet.
Override `SANDFEST_LIVE_PUBLIC_URL` only when validating the temporary Pages
hostname before canonical DNS is ready.

`npm run video:board` captures the running local demo and renders a narrated
1080p board presentation using local Chrome, macOS speech, and ffmpeg. See
`docs/board-demo-video.md` for the server setup and output files.

Enterprise ops console: open `/admin.html` after `npm run dev`. Production uses
`npm run build:public` for the visitor-only `dist-public/` artifact and
`npm run build:admin` for the full operations `dist-admin/` artifact. The admin
entry includes partner lifecycle, finance, tasks, outreach, and Island
Conditions while skipping public data files and visitor runtime work. The local
dev server keeps the Visitor / Operations presentation switch; production
visitor builds lock public mode and do not render that switch.

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
- `docs/sms-safety.md`
- `docs/heyelab-backend-deployment.md`
- `docs/heyelab-auth-contract.md`
- `docs/scale-and-reliability.md`
- `docs/camera-edge-agent.md`
- `docs/camera-metric-ingestion.md`
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
# Preview, then repeat with mode=commit and the returned previewHash. The route
# requires revenue:write (finance_admin or super_admin).
curl -X POST -H "Authorization: Bearer dev-admin-token-change-me" -H "content-type: application/json" --data '{"mode":"preview","source":"eventeny","fileName":"settlement.csv","csv":"transaction_id,date,category,gross_amount,fee_amount,net_amount\nsettlement-1,2026-07-16,vendor_fee,250.00,7.50,242.50"}' http://127.0.0.1:8788/api/admin/revenue/import
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/fleet
curl -X POST -H "Authorization: Bearer dev-admin-token-change-me" -H "content-type: application/json" --data '{"payload":"tsf:asset:cart-02"}' http://127.0.0.1:8788/api/admin/fleet/resolve-qr
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/volunteers
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/volunteers/coverage
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/consent
curl http://127.0.0.1:8788/api/public/passport
curl http://127.0.0.1:8788/api/public/island-conditions
curl http://127.0.0.1:8788/api/public/vendors
curl -X POST -H "content-type: application/json" --data '{"organizationName":"Demo Vendor","contactName":"Taylor Rivera","contactEmail":"taylor@example.com","category":"artisan","vendorOfferingId":"marketplace-booth","consentToContact":true}' http://127.0.0.1:8788/api/public/vendor-applications
curl -X POST -H "content-type: application/json" --data '{"organizationName":"Demo Sponsor","contactName":"Jordan Rivera","contactEmail":"jordan@example.com","packageId":"marlin","consentToContact":true}' http://127.0.0.1:8788/api/public/sponsor-inquiries
# POST the reference + portalAccess.token returned by an intake. The token is
# carried in the browser URL fragment and is never sent in an initial page request.
curl -X POST -H "content-type: application/json" --data '{"reference":"TSF-V-000000","token":"tsfp_replace-me"}' http://127.0.0.1:8788/api/public/partner-status
curl -X POST -H "content-type: application/json" --data '{"attendeeRef":"device_demo","payload":"tsf:cp:cp_ent_tidal_guardian","method":"qr_scan"}' http://127.0.0.1:8788/api/public/passport/stamp
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/passport
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/config
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/partners
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/outreach
curl -X POST -H "Authorization: Bearer dev-admin-token-change-me" -H "content-type: application/json" --data '{"location":"Port Aransas, TX 78373","radiusMiles":25,"limit":20,"categories":["lodging","food_beverage","financial","retail"]}' http://127.0.0.1:8788/api/admin/outreach/discovery/preview
curl -X POST -H "Authorization: Bearer dev-admin-token-change-me" -H "content-type: application/json" --data '{"name":"Coastal hospitality","targeting":{"industries":["hospitality"],"cities":["Port Aransas"],"states":["TX"],"minFitScore":60},"sequence":[{"delayDays":0,"subjectTemplate":"A SandFest partnership for {{organization}}","bodyTemplate":"Hello {{contactName}},\n\nMay we share the 2026 sponsor program?"}]}' http://127.0.0.1:8788/api/admin/outreach/campaigns
curl -H "Authorization: Bearer dev-admin-token-change-me" http://127.0.0.1:8788/api/admin/island-conditions
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

Local rate limits are controlled with `SANDFEST_PUBLIC_RATE_LIMIT`, `SANDFEST_ADMIN_RATE_LIMIT`, `SANDFEST_CHECKOUT_RATE_LIMIT`, `SANDFEST_PARTNER_STATUS_RATE_LIMIT`, and `SANDFEST_RATE_LIMIT_WINDOW_MS`.

Production partner links require `SANDFEST_PARTNER_PORTAL_SECRET` (32+ random characters) and an HTTPS `SANDFEST_PUBLIC_SITE_URL`. The Render Blueprint generates the capability secret once and binds the worker to the API-owned value so acknowledgment and reminder links remain verifiable; non-Render deployments must preserve the same invariant. Rotating access from the partner workspace invalidates the previous link immediately. Private sponsor and vendor document uploads additionally require `SANDFEST_PARTNER_ASSET_DIR` on a persistent, non-public mount; `render.yaml` provisions a 10 GB API disk at `/var/data/sandfest-partner-assets`, private paid Postgres, and a private managed Key Value limiter. `npm run test:render-blueprint` verifies those deployment contracts locally.

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

Run `npm run vault:build` after a public scrape, document extraction, or internal data drop. Staff can use the private **Documents** workspace for governed uploads and review. The repository drop folders remain available for bulk local staging:

- `data/incoming/eventeny/`
- `data/incoming/docs/`
- `data/incoming/ops/`
- `data/incoming/finance/`
- `data/incoming/comms/`
- `data/incoming/quickbooks/`

## QuickBooks

QuickBooks includes a review-gated sponsor/vendor invoice ledger and durable worker sync. It remains off until sandbox OAuth credentials, Item mappings, and `QB_INVOICE_SYNC_ENABLED=true` are configured.

```bash
cp .env.example .env
npm run qb:status
npm run qb:callback
npm run qb:auth-url
```

See `docs/quickbooks-integration.md` for the OAuth and invoice workflow. Keep all QuickBooks credentials and token files out of git.

## Sponsor outreach

The operations console includes a sponsor outreach workspace that defaults to per-message review and can explicitly approve a bounded campaign sequence. Staff can discover regional businesses through a signed preview, import selected candidates with source attribution, complete contact research, import CSV lists, qualify prospects, document the contact basis, build segmented multi-step campaigns, and choose individual review or a daily-capped automated sequence before Brevo delivery. Production uses the bounded OpenStreetMap adapter and treats discovery health as a required launch capability; discovery itself never creates a prospect or sends a message. A qualified prospect can receive an expiring package invitation that prefills the public sponsor form; only the recipient's explicit submission converts it into the sponsor application, branding checklist, deliverables, milestones, finance record, task, acknowledgment draft, and private portal. See `docs/sponsor-outreach-automation.md` for provider policy, import contracts, workflow, suppression rules, invitation handoff, and the API contract.

## Source facts used

- Official Texas SandFest site: dates, location, mission, public contact channels, sponsor tier language.
- Eventeny ticketing page: 2026 dates, ticket categories, ticketing/application host.
- Texas SandFest FAQ/volunteer pages: volunteer registration deadline framing and core visitor workflows.

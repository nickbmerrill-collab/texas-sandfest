# Texas SandFest AI Platform

Unified visitor and operations platform for Texas SandFest, with production-gated public, staff, partner, finance, communications, and field-operation workflows.

## Current build

- Public visitor experience with current event facts.
- Source-cited "Ask Sandy" concierge backed by governed public event, ticket, sponsor, vendor, accessibility, parking/shuttle, weather, ferry, and crowd data.
- Beach operations dashboard for crowd zones, run-of-show, and dispatch signals.
- Sponsor, vendor, volunteer, and visitor module framing.
- Ground-up production roadmap for content, AI, ops, and partner portals.
- Signed native iOS app with simulator coverage and physical-device installation proof, plus the Port A Local Co integration plan.
- Configuration-gated Stripe ticket checkout with provider-private public catalogs, server-authoritative prices and quantities, browser/server idempotency, signed webhook reconciliation, deterministic wristband/will-call fulfillment, and full/partial refund states. Static builds fail closed until the API confirms the current catalog and Stripe integration are ready; sponsor packages remain invoice/review based and the raffle remains review-gated. The isolated board runtime exercises the same order, reconciliation, fulfillment, refund, and revenue projections through a loopback-only payment sandbox with visibly synthetic prices and no external charge.
- Configurable admin API scaffold for Heyelab-hosted ticket and sponsorship settings.
- Server-authoritative public partner readiness (`lib/public-partner-server-readiness.mjs`): sponsor applications, vendor applications, and private-link recovery stay disabled until a no-store current-event API contract confirms the backend capability required for each action. Malformed, stale, unavailable, or privacy-expanding responses fail closed, while sponsor programs and approved branding remain visible and the capability-based status lookup remains usable.
- Event-day emergency alert API and admin publishing controls.
- Unified current-event revenue ledger (`lib/revenue.mjs`) with a role-guarded `GET /api/admin/revenue` dashboard endpoint that merges audited site-native sponsor/vendor receipts and reversals with explicitly event-scoped Stripe/Eventeny/Square imports, deduplicates provider references, excludes stale or unscoped event data, and tracks fees plus bank reconciliation. Finance can load provider settlement CSVs through a preview-gated `POST /api/admin/revenue/import` workflow (`lib/revenue-import.mjs`): exact cents, refund/void signs, event/provider scope, duplicate references, invalid rows, atomic commits, replay protection, import history, and audit evidence are enforced server-side.
- Operational budget control (`lib/budget-control.mjs`) gives finance-owned annual allocations, accountable teams, submitted/approved/rejected/paid/voided expense states, noted allocation changes, explicit over-budget overrides, payment-method/reference evidence, current-event summaries, and privacy-minimized audit history through `GET /api/admin/budget`. Finance can download separate spreadsheet-safe allocation and expense-register CSVs from the Operations export menu; both are role-gated, current-event scoped, and audited. File and Postgres writes use the same transactional document path. QuickBooks remains the eventual accounting ledger; marking an expense paid records operational evidence and never moves money at a provider.
- Privacy-safe board impact reporting (`lib/board-impact.mjs`) aggregates current-event revenue, partner funds, budget, volunteer hours and coverage, sponsor/vendor delivery, visitor engagement, outreach, and attention signals without exposing contacts or underlying workflow records. `GET /api/admin/impact` and the audited board-impact CSV require the dedicated read-only `impact:read` capability for operations, finance, and board viewers, preserve source freshness, and use the same live operational summaries as the workspace.
- Fleet/asset checkout (`lib/fleet.mjs`) for golf carts, UTVs, generators, and equipment: role-guarded admin API (`fleet:read` / `fleet:write`), web ops panel, and iOS Admin → Fleet tab with QR check-out/in (`tsf:asset:<id>`). Seeded from `data/processed/fleet.json`.
- Volunteer coverage mirror (`lib/volunteers.mjs`): VolunteerLocal-shaped roster/shifts/hours → ops fill-vs-needed by zone, understaffed shift list, hour totals. `GET /api/admin/volunteers` (`volunteers:read`). Seeded from `data/processed/volunteer-mirror.json`.
- Governed volunteer handoff: the event guide owns the reviewed official volunteer page, registration state, optional scheduling-provider URL, and source timestamp. The visitor site and Ask Sandy expose current guidance, but a staged or prior-season provider URL is withheld unless staff explicitly publishes registration as open. VolunteerLocal remains the recruitment, shift-selection, and scheduling system of record; SandFest mirrors its roster, shifts, attendance, and hours for operations.
- Governed staff and team routing (`lib/staff-directory.mjs`, `lib/staff-directory-import.mjs`): active staff are selected from a private annual directory, every operating team resolves to one accountable notification owner, and admin responses expose only display identity and delivery readiness. Operations administrators can preview and atomically commit an approved JSON or CSV replacement beside the staff work board through `POST /api/admin/staff-directory/import` (`staff:write`); the preview hash binds the exact file, verified source, current event, and current directory, concurrent replays converge once, and audits retain aggregate provenance without names or addresses. The equivalent CLI is `npm run import:staff -- path/to/staff.json --source=manual_verified [--commit]`. Production requires Postgres and rejects seed/demo sources, annual mismatches, duplicate identities or routes, active staff without email, missing routes, and verification older than 90 days.
- Private document intake (`lib/incoming-documents.mjs`): operations staff can upload board packets, provider exports, finance files, runbooks, and communications into an annual review queue with domain, accountable team, server-owned review deadline, text/CSV/JSON previews, checksum deduplication, review and archive states, and audited checksum-verified downloads. Every accepted file is synchronized into the delegated work board; owner, due-date, changes-requested, approval, reopening, and archive changes update the same task so staff routing and bounded assignment/overdue notices apply without duplicate work. File bytes remain on a private persistent mount; Postgres stores governed metadata only, API responses never expose storage paths, and production readiness requires `SANDFEST_INCOMING_DOCUMENT_DIR`.
- Consent-safe Twilio alert delivery (`lib/consent.mjs`, `lib/sms.mjs`, `lib/sms-operations.mjs`): separate unchecked marketing/safety channels, explicit operator send confirmation, one retry-safe job per consent record, immediate pre-send consent revalidation, signed delivery and STOP/START/HELP callbacks, privacy-minimized campaign evidence, and queued-message cancellation when an alert is cleared. `sms_safety` remains a production readiness blocker until the real sender and callbacks are configured and capacity-tested; see `docs/sms-safety.md`.
- Guest Services case desk (`lib/guest-services.mjs`): visitors can submit lost-item, accessibility, ticketing, separated-party, vendor, or general help requests through a Turnstile-protected, retry-safe form and reopen only their privacy-minimized status with a session-scoped HMAC capability. The visitor form stays disabled until a no-store API readiness contract confirms the current event, approved public categories, bot verification, and capability issuance; production readiness and live deployment verification reject an unavailable or privacy-expanding contract. Operations receives a current-event queue with urgency, response-team routing, private contact details, internal notes, and optional visitor-visible updates. Capability hashes and intake retry hashes never enter admin responses, public status, or audit records; event rollover clears the annual case ledger, while the isolated board runtime seeds three fictional cases and exercises a complete visitor-to-staff-to-visitor handoff.
- Policy-gated ticket checkout (`lib/ticket-catalog.mjs`): Operations staff manage one current-event ticket policy covering ticket terms, refunds, filming/photography, and service animals. Saving a draft immediately removes checkout availability; approval records the actor and timestamp, and the public API exposes only the approved version, digest, acknowledgement, and notice summaries. Checkout remains disabled until the customer accepts that exact version and digest. The server revalidates it, binds it into the retry fingerprint, stores acceptance evidence on the order, and attaches the version and digest to Stripe metadata before creating a session. The local board sandbox exercises the same contract with visibly synthetic policies and no external charge.
- Governed sculptor roster publication (`lib/sculptor-roster.mjs`): staff preview and publish a reviewed current-event CSV from the Operations workspace. One atomic revision powers the public roster, corridor map, Sculpture Passport checkpoints, and People's Choice ballot; source age, event scope, coordinates, references, reviewer identity, and the preview hash fail closed. A publication hold closes all four public experiences together without deleting review history. See `docs/sculptor-roster-publication.md`.
- Sculpture Passport backend (`lib/passport.mjs`): public stamp API + progress + admin stats; web/iOS offline-first clients sync stamps when the API is reachable. QR: `tsf:cp:<id>` / `tsf:entry:<entryId>` / `TSF-CP-000N`.
- People's Choice voting (`lib/voting.mjs`) + public booth/vendor map (`lib/booths.mjs`). Eventeny booth assignments now use a role-guarded preview/commit workflow in the Booth workspace (`lib/booth-import.mjs`, `POST /api/admin/booths/import`): current-event validation, exact mirror-version binding, atomic file/Postgres reconciliation, concurrent replay protection, bounded import history, and aggregate-only audits. Blank publication and compliance fields fail private and incomplete; absent local records are preserved. See `docs/eventeny-booth-import.md`.
- Public vendor and sponsor intake with production-enforced Cloudflare Turnstile verification, server-validated sponsorship tiers and category-compatible vendor offerings, generated references, linked review tasks, key dates, finance-guarded payment allocation/reversal, receivables aging and reconciliation, and review-first acknowledgment drafts (`lib/partner-ops.mjs`, `lib/sponsor-packages.mjs`, `lib/vendor-offerings.mjs`, `lib/partner-catalog-publication.mjs`, `lib/turnstile.mjs`). Sponsor and vendor prices plus QuickBooks item mappings come from staff-managed catalogs; browser-supplied amounts are ignored, and approved invoices inherit the captured amount without manual re-entry. Each public catalog must be explicitly published against the current event, a recently reviewed official HTTPS source, and a SHA-256 digest of the exact public terms. A public-field edit automatically returns that program to pending, while a private Stripe or QuickBooks mapping edit preserves publication when the visitor projection is unchanged. Held, stale, mismatched, or unreachable catalogs render honest pending states, are withheld from Ask Sandy and invitations, and reject intake before bot verification; no sponsor pricing or vendor fee fallback is embedded in the production visitor bundle. The isolated board runtime publishes only its clearly labeled synthetic catalogs under the same digest contract. A consented vendor interest receives one versioned notice when its matching catalog offering changes to application mode; the notice opens the ordinary public form with only category and offering selected, leaves identity and consent blank, and never converts the interest into a financial obligation. Manual ledger entries require a receipt or transaction reference, so an exact operator retry deduplicates against the same application and payment method while changed payment details fail as a conflict. Catalog edits reject malformed pricing, missing sponsor benefits, unsupported vendor coverage, placeholder Stripe IDs, and removal of the last active sponsor tier. Public catalog responses omit Stripe and QuickBooks mappings. Invoice creation synchronizes the finance-owned payment key date; full payment completes it and dismisses active reminders, while a refund or reversal reopens only a date previously completed by payment automation. Browser submissions carry a stable retry key so a reconnect, double submission, or gateway replay returns the original application and private portal instead of duplicating downstream work. Every intake also receives a rotatable HMAC capability link for a privacy-minimized self-service view of application, invoice, payment, milestone, brand, and benefit-delivery status (`lib/partner-portal.mjs`). The same private portal lets a partner pause future application emails immediately or re-enroll against the current notice; opt-out dismisses every unsent message, preserves sent and provider-in-flight evidence, and never deletes the application. A partner who loses that link can request the current capability using the original reference and contact email; production requires Turnstile, exact matches are cooldown-bound and sent through the durable transactional queue, and matches and misses return the same no-store public confirmation. After finance approves an invoice, the portal can create one trusted Stripe Checkout Session for its current balance; signed webhooks post the payment into receivables, suppress ticket fulfillment, reject amount/currency mismatches, and restore balances for partial or full refunds (`lib/stripe-partner-payments.mjs`). Sponsor tiers seed durable fulfillment checklists; sponsors can build a live brand preview with synchronized color swatches, submit reviewable brand assets, and sign off on delivery proof. Approved sponsor applications with approved brand profiles automatically join a responsive featured-partner band ahead of the public package catalog; only approved self-hosted PNG, JPEG, or WebP logo uploads are public, while external assets, PDFs, contacts, application identifiers, review records, and storage metadata remain private (`lib/sponsor-showcase.mjs`). Vendor categories seed frozen compliance checklists; vendors can submit an operating profile and private evidence, then confirm staff-published booth and load-in assignments. Staff readiness is derived from approved profile, cleared requirements, and vendor-confirmed scheduling.
- Partner operations workspace for application status, accounting, task delegation, editable key dates, draft follow-ups, and geographically scored outreach prospects. Approval and non-approval decisions create versioned private-portal notices: approvals can enter consent-checked transactional automation, while non-approvals always require staff review; reopening or reversing a decision invalidates stale unsent drafts. A staff-only recent workflow feed groups same-batch intake, finance, key-date, messaging, task, branding, vendor, and outreach events into readable updates while withholding raw activity and entity identifiers. Staff can preview and commit Eventeny vendor/sponsor application exports through a contact-attested, event-scoped, catalog-priced, idempotent workflow; imported provider statuses remain provenance while every local application enters review as `submitted`, and Eventeny imports skip the duplicate acknowledgment draft. Exact replays add nothing, changed records with the same Eventeny ID are held for manual review, and aggregate-only audits retain the batch, file name, and counts. See `docs/eventeny-partner-import.md`. The work board supports roster-backed volunteer assignment, governed staff/team ownership, priority and due-date controls, blocked/in-progress/completed lifecycles, overdue and workload summaries, and privacy-minimized assignment directories. Assigned volunteers, active directory staff, and teams with a current notification owner receive one versioned assignment notice and bounded weekly-overdue reminders through the retry-safe worker; Operations can reissue the current secure assignment notice through an audited, idempotent control without changing ownership or invalidating the existing task link. Reassignment, rescheduling, completion, cancellation, or a directory identity change invalidates stale delivery. Staff can add, assign, reschedule, complete, cancel, or reopen partner milestones with per-date reminder lead times; schedule changes invalidate stale drafts. Untouched initial intake-review reminders wait until an application is at least 24 hours old, keeping the immediate acknowledgment separate from the first automated follow-up; a deliberate staff reschedule overrides that grace, and payment, overdue, custom-date, and task notices retain their timing. Finance can refresh an already-synced QuickBooks invoice through a versioned worker job; reported total, balance, provider timestamp, and refresh proof are mirrored without creating a local payment, while stale, failed, amount, and balance differences become visible reconciliation exceptions. Role-guarded, audited downloads export partner records, receivables, payments, annual allocations, expense approvals and payment evidence, delegated work with notification state, and outreach as spreadsheet-safe CSV plus key dates as an Outlook/Google Calendar-compatible `.ics` file; recipient addresses, capability tokens, and intake hashes are excluded. Vendor profile changes, compliance corrections, and booth/load-in publications automatically create deduplicated message drafts; remediation, confirmation, or another revision dismisses stale unsent notices. Sponsor profile feedback, asset corrections, and proof-ready deliverables use the same versioned automation, with private portal links and send-time state checks; resubmission, approval, replacement, sign-off, or proof revision invalidates stale notices. Known-partner acknowledgments, approval decisions, milestone reminders, sponsor branding reviews, vendor corrections, and governed task notices can be placed in explicitly enabled transactional automation after consent or directory-recipient revalidation; incident dispatch remains review-first. Sponsor outreach defaults to per-message review or can use an explicitly approved campaign sequence with provider readiness, one-to-100 daily caps, retry-safe jobs, pause-to-review behavior, and recipient/targeting revalidation before delivery. Before a draft can be saved in the operations UI, a mutation-free server preflight applies those same qualification rules, reports aggregate exclusion evidence and the exact qualified businesses without recipient addresses, and renders a personalized opening-message sample; activation and delivery still revalidate every recipient. Outreach also supports signed-preview regional business discovery, preview-gated CSV imports, reusable campaigns, industry/city/state/ZIP/radius/fit segmentation, editable business and contact research, one-to-four-step personalized sequences, documented contact basis, stale-geofence invalidation, and immediate suppression of every unsent message. OpenStreetMap discovery can fail over across three explicitly reviewed HTTPS Overpass instances for transient provider failures; successful previews report the serving hostname and attempt count without weakening the signed import gate. Staff can issue a package-specific, expiring sponsor invitation from a qualified prospect; the recipient explicitly submits the public sponsor form before the prospect is atomically linked to branding, fulfillment, key dates, finance, tasks, and its private portal. Discovered candidates preserve source attribution and remain ineligible until staff verifies the contact. Recipient-specific HMAC preference links and `List-Unsubscribe` headers provide a privacy-minimized public opt-out that atomically cancels pending outreach and is revalidated before provider delivery. Imports skip existing prospects and never overwrite staff edits.
- Outreach conversion is browser-complete: staff can issue, open, or copy a package-specific sponsor invitation from a qualified prospect without making clipboard permission a workflow dependency. The recipient sees a locked, prefilled public sponsor form; consented submission atomically links the prospect to branding, fulfillment, key dates, finance, delegated work, and a private portal.
- Campaign accountability is aggregate-only: each campaign reports unique businesses enrolled, reached, delivered, opened, clicked, and converted into sponsor applications. Delivery stages are cumulative from durable provider evidence, application conversion requires a reached prospect plus a durable sponsor-application link, and no recipient address is included in the metric payload.
- One-command board stack (`npm run board:demo`) for exercising the real visitor, ticket purchase/refund/accounting, budget allocation and expense approval, document intake, partner, finance, key-date, messaging, staff/volunteer/team delegation, sponsor fulfillment, completed/blocked vendor, outreach, engagement, and island-conditions workflows against visibly labeled synthetic data without mutating repository history. Its supervisor requires clean `main` at local `origin/main`, records a privacy-minimized source fingerprint, selects safe loopback ports, automatically upgrades a recognized stale synthetic runtime before startup, starts the isolated web/API/worker/provider/camera services, proves both consent-backed transactional and explicitly approved campaign delivery through the local mailbox, requires a 12-of-12 source and service preflight including the governed sculptor publication, preempts an in-flight readiness check when an operator requests a reset, restarts a failed component with bounded backoff, and shuts everything down through `npm run board:stop`. Unknown or unmarked runtime directories still fail closed. `npm run board:rehearse` then opens the exact active Visitor and Operations links in local Chromium, while `npm run board:rehearse:webkit` repeats the read-only rendering checks in Safari-compatible WebKit. Both fail before navigation if the commit, branch, or worktree changed and reject missing workflow UI, local delivery evidence, budget/payment/key-date tracking, local ticket readiness, three-way delegation, sponsor/vendor fulfillment, geofenced outreach, private document extraction, broken sponsor branding, incomplete camera rendering, a missing first-viewport Live Beach cue, browser errors, desktop overflow, or 320px/768px pointer-target, label-clipping, and overflow regressions without mutating the synthetic records. `npm run board:prove:signups` separately submits one synthetic vendor and sponsor through the visible site, requires both automatic acknowledgments to reach authenticated local delivery and render in Operations, and replaces the stack back to the five-application baseline even when an assertion fails. The ticket sandbox makes no external payment call, budget payment references are synthetic evidence only, the email sandbox accepts reserved example domains, the SMS sandbox accepts only fictional `555-01xx` numbers, all eight camera lanes carry privacy-minimized synthetic metrics, and the local weather/ferry snapshot stays presentation-ready without NWS or TxDOT network access. See `docs/board-runtime.md`.
- Active-stack workflow proofs are reset-safe and presentation-specific. `npm run board:certify` runs all ten journeys plus Chromium and WebKit acceptance in sequence, requires each proof to restore 12-of-12 readiness, pins the active source to clean `main` at local `origin/main`, and writes an aggregate-only certificate to `.sandfest-runtime/board-capability-certification.json` without contacts, private links, record IDs, notes, references, or uploaded filenames. `npm run board:prove:guest-services` submits a protected visitor request, proves retry and private-access behavior, routes and resolves it through Operations, withholds internal notes from private visitor status and audit records, and restores the exact three-case baseline. `npm run board:prove:vendor` submits a public marketplace application, exercises private profile and compliance corrections, byte-verifies the uploaded evidence, delivers three automated notices into the loopback mailbox, approves the complete packet, publishes and confirms a booth assignment, verifies ready status and privacy-safe audits, and restores the exact vendor baseline. `npm run board:prove:outreach` discovers a regional business, preserves its research gate, qualifies and assigns it, issues a tier-specific invitation, builds one exact geofenced campaign, requires authenticated local delivery, proves recipient-controlled suppression, and restores the exact outreach baseline. `npm run board:prove:sponsor` converts a targeted invitation through the public sponsor form, submits branding through the private portal, approves it in Operations, byte-verifies the newly public logo, checks privacy-safe lifecycle audits, and restores the exact outreach and sponsor baseline. `npm run board:prove:tickets` accepts the current ticket policies, completes a local purchase, proves fulfillment and revenue in Operations, issues a full refund, verifies the accounting reversal and privacy-safe audit, and restores the empty ticket-order baseline. `npm run board:prove:operations` proves accounting, receivables, delegation, key dates, authenticated local automation, five reconciled finance/calendar exports, and reference-safe audits through the visible Operations UI. `npm run board:prove:delegation` requires a notification-ready volunteer, authenticated assignment delivery, private mobile acknowledgement, start, blocker, and completion updates, note-safe audits, and an exact task reset. `npm run board:prove:incident` posts a signed synthetic camera threshold, approves and renders a privacy-safe visitor notice, dispatches the Traffic team through reviewed authenticated local email, tracks the responder through closeout, proves automatic recovery and manual resolution, checks contact-safe audits, and restores the empty incident baseline. `npm run board:prove:documents` uploads a checksum-distinct board packet, waits for private extraction, advances its synchronized task through review and approval, byte-verifies the governed download, checks privacy-safe audit evidence, and restores the exact four-document baseline.
- The Operations first screen summarizes applications, receivables, message review, assignments, key dates, sponsor fulfillment, vendor readiness, and sponsor outreach from the same API records, with direct links into each working queue.
- Policy-gated transactional email delivery (`lib/email.mjs`, `lib/brevo-webhook.mjs`): Brevo stays disabled until a verified sender, API key, and authenticated delivery webhook are configured; the worker generates versioned, idempotent milestone and governed volunteer/staff/team task drafts without piling up while an earlier draft is actionable. Review-first is the default. Administrators may enable the bounded transactional policy documented in `docs/partner-message-automation.md`, while outreach staff may separately approve a bounded campaign sequence documented in `docs/sponsor-outreach-automation.md`; deterministic queue keys prevent repeat scheduling. Operational dispatch still requires staff approval. Delivery acceptance, delivery, opens, clicks, deferrals, bounces, blocks, complaints, and unsubscribes are recorded idempotently; terminal recipient events suppress the prospect and cancel every unsent outreach message. A provider handoff with no trustworthy result becomes an explicit verification item in Operations, blocking retry, dismissal, replacement drafts, and dependent sequence steps until staff records either the provider message ID or documented non-delivery.
- Crash-recoverable background work (`lib/job-queue.mjs`): Postgres and local development claims use fenced five-minute leases, stale claims return to the queue, late workers cannot complete a newer claim, final expired delivery jobs reconcile their sponsor, invoice, or incident workflow to a visible failed state, and queue health is visible in `/ready`, `/api/admin/jobs`, and the operations console. Operations groups repeated successful runs into workflow-level completion digests while keeping every active or failed job actionable; unhandled failures are returned ahead of the bounded recent-history window so newer successes cannot hide them. Production readiness rejects file storage.
- Actionable launch control (`GET /api/admin/deployment`): every server-computed readiness check carries a stable ID, operator label, and operational group. The admin console defaults to errors and warnings, can expand all checks, and keeps platform, access, program-data, revenue, partner, communications, and field-operation gates tied to the current environment instead of a client-side checklist.
- Fail-closed public data projection (`lib/public-bootstrap.mjs`, `lib/public-media-manifest.mjs`): the static offline bootstrap and `GET /api/public/bootstrap` expose only governed event-guide facts, public schedule entries, privacy-minimized map zones, and public alerts. The media catalog exposes only browser-safe asset metadata. Staff schedules, sponsor/vendor workflow, volunteer coverage, finance signals, publishing identity, local paths, upstream fetch details, and ingestion manifests remain private; artifact and live-deployment verification reject regressions.
- Governed public concierge (`lib/public-concierge.mjs`, `POST /api/public/concierge`): questions are bounded to 280 characters, rate-limited, never persisted or echoed in unsupported answers, and routed deterministically to the same privacy-safe payloads displayed by the visitor site. Every response carries one to four public citations, returns `cache-control: no-store`, derives accessibility and bounded parking/shuttle guidance only from approved public zones, withholds unmodeled permit, lot, schedule, and route claims, withholds stale weather/ferry/camera claims, converts provider setup labels to visitor-safe pending language, escalates unsupported topics, and directs urgent medical, missing-person, or security questions to immediate human help. Production deployment verification fails if this contract is unavailable or leaks private fields.
- Island Conditions combines live National Weather Service forecasts and alerts with TxDOT ferry references and an eight-camera traffic/crowd/line grid (`lib/island-conditions.mjs`). The NWS adapter selects the current valid hourly period, immediately refreshes an expired persisted period, and withholds stale temperature details from public responses. The visitor view respects the one-minute public cache and refreshes on a jittered 60-75 second cadence; manual refresh is explicit, while staff see upstream observation, attempt, freshness, and failure status. Fresh ferry-camera metrics generate a labeled wait estimate, while reviewed operator data takes precedence. The local Python edge agent uses YOLO + ByteTrack to derive anonymous counts, flow, queue, occupancy, and wait metrics without sending frames off the camera host (`camera_agent/edge_agent.py`). It posts HMAC-signed, idempotent observations and health through `lib/camera-ingest.mjs`; observations expire to unknown when stale, public payloads omit source/model internals, and footage is not stored. Automatic device selection prefers CUDA, then Apple MPS, then CPU. Each production camera service refuses to start without its scoped stream/secret environment, an artifact-bound model license approval, and the cached model's approved checksum; failed opens and reads use bounded reconnect backoff and rate-bounded error heartbeats. A separate local-compute acceptance keeps all eight model instances resident and verifies the complete inference cycle against the configured sample-rate budget using generated pixels. Elevated condition and pipeline-health signals open deduplicated, owned incidents; recovery moves them to monitoring, while resolution and public notices remain human-controlled. Manually opened incidents require a browser-stable replay key, so an accepted response lost in transit returns the original command record without a second incident or audit; changed reuse fails as a conflict. Incident Command can dispatch teams, staff, or roster-backed volunteers, track acknowledgment through on-scene closeout, and prepare reviewed operational email without exposing recipient addresses in API responses. Closing an incident cancels active dispatches and unsent notifications. See `docs/camera-edge-agent.md` for installation and calibration.
- Full suite: `npm run test:platform` (libs), `npm run test:platform:api` (live file-mode smoke), `npm run test:browser` (Chromium public and staff workflow acceptance), `npm run test:browser:webkit` (Safari-compatible acceptance), and `npm run test:postgres` (isolated production data-plane acceptance). The browser gates include Axe WCAG A/AA scans of the visitor experience, vendor intake, private partner status, Ask Sandy, the operations workspace, and the mobile partner surface; `npm run test:accessibility` runs that focused Chromium acceptance by itself.
- Production delivery budgets: `npm run build:surfaces` fails when public or admin JavaScript/CSS crosses its gzip ceiling, public HTML or self-hosted fonts outgrow their delivery/offline-cache limits, a required responsive hero variant is missing or oversized, or offscreen galleries and sponsor media stop using native lazy loading. Keep the limits in `scripts/test-static-surfaces.mjs` tied to measured release performance rather than raising them to accommodate accidental bundle growth.
- Recovery drill: restore Postgres and the private upload-disk snapshot into isolated targets. Run `npm run recovery:verify` for the database proof, then set `SANDFEST_RECOVERY_ASSET_DIR` and run `npm run recovery:verify:assets` to prove every restored sponsor, vendor, and incoming-document upload by size and SHA-256 before recording either drill timestamp.
- Board deck: `docs/presentations/SandFest-Board-Platform-Briefing.pptx`.
- Enterprise scale path: atomic/mutex JSON or Postgres (`lib/platform-data.mjs`), body size caps, public-write rate limits, HTML escaping, empty admin token field. See `docs/enterprise-scale.md`.
- Shared rate limits via Redis/Upstash (`lib/rate-limit.mjs`), async SMS worker (`npm run worker`), ticket-linked voting, and separately built visitor/admin deployment artifacts.
- CI: `.github/workflows/ci.yml` (tests, API smoke, build, load-test, Swift parse). A verification-only manual dispatch can prove the exact current `main` commit when GitHub misses a merge-triggered run, but it cannot satisfy the push-gated Pages release workflow.
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
npm run test:accessibility
npm run test:postgres
npm run test:camera-agent
npm run test:camera-model-approval
npm run test:camera-agent:runtime
npm run test:camera-agent:fleet-runtime
npm run test:camera-fleet-qualification
npm run ready:camera-edge
npm run camera:model:verify
npm run camera:agent:validate
npm run build:surfaces
npm run ready:production
npm run board:rehearse
npm run board:certify
npm run board:prove:signups
npm run board:prove:guest-services
npm run board:prove:vendor
npm run board:prove:outreach
npm run board:prove:sponsor
npm run board:prove:tickets
npm run board:prove:operations
npm run board:prove:delegation
npm run board:prove:incident
npm run board:prove:documents
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

After both production artifacts are built, run `npm run deployment:verify` with
the real `SANDFEST_APPLE_APP_ID_PREFIX`. It checks the canonical public, API,
and admin hostnames against those exact artifacts.
It fails closed on stale bundles, unresolved or non-HTTPS targets, missing edge
headers, a non-production API, red capability gates, CORS drift, unavailable
ticket/vendor/sponsor contracts, an invalid or redirected iOS site-association
file, or an incomplete Island Conditions fleet.
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
curl -X POST -H "content-type: application/json" --data '{"question":"What is the current ferry wait?"}' http://127.0.0.1:8788/api/public/concierge
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

- `https://sandfest-api.heyelab.com` for public and admin APIs.
- `https://sandfest-admin.heyelab.com` for the admin UI.

See `docs/heyelab-backend-deployment.md`.

Local admin roles are controlled with `SANDFEST_ADMIN_ROLE`. Supported prototype values are `super_admin`, `ops_admin`, `ticketing_admin`, `sponsor_admin`, `finance_admin`, and `viewer`.

Local rate limits are controlled with `SANDFEST_PUBLIC_RATE_LIMIT`, `SANDFEST_ADMIN_RATE_LIMIT`, `SANDFEST_CHECKOUT_RATE_LIMIT`, `SANDFEST_PARTNER_STATUS_RATE_LIMIT`, and `SANDFEST_RATE_LIMIT_WINDOW_MS`.

Production partner links require `SANDFEST_PARTNER_PORTAL_SECRET` (32+ random characters) and an HTTPS `SANDFEST_PUBLIC_SITE_URL`. The Render Blueprint generates the capability secret once and binds the worker to the API-owned value so acknowledgment and reminder links remain verifiable; non-Render deployments must preserve the same invariant. Rotating access from the partner workspace invalidates the previous link immediately. Staff, volunteer, and team assignment notices use the same protected public origin and include a private fragment link bound to the current assignee and assignment version. The assignee can acknowledge, start, report a blocker, or complete the work without an Operations login; each update is reflected on the work board, while reassignment immediately revokes older links and clears the previous acknowledgement. `SANDFEST_TASK_PORTAL_SECRET` may provide a separate 32+ character HMAC root and otherwise reuses the generated partner secret with domain separation. Private sponsor and vendor document uploads additionally require `SANDFEST_PARTNER_ASSET_DIR` on a persistent, non-public mount; `render.yaml` provisions a 10 GB API disk at `/var/data/sandfest-partner-assets`, private paid Postgres, and a private managed Key Value limiter. `npm run test:render-blueprint` verifies those deployment contracts locally.

Checkout attempts and webhook events are stored locally under `data/processed/orders/`, admin mutations are stored under `data/processed/admin-audit/`, and pre-change config snapshots are stored under `data/processed/config-snapshots/`, until this moves to a production database.

## iOS

```bash
npm run test:ios-xcode
npm run test:ios-device
npm run test:ios-device-install
npm run board:ios
```

The Xcode gate selects an available iPhone simulator, runs the native XCTest target, and compiles an optimized simulator build with Swift warnings treated as errors. It uses `/Applications/Xcode.app/Contents/Developer` when the shell's global developer selector still points at standalone Command Line Tools. The committed project can be regenerated with `cd ios && xcodegen generate` when XcodeGen is installed.

`npm run board:ios` requires the supervised board stack on clean `main`, selects
and boots an available iPhone simulator, compiles the optimized app, installs it,
launches the explicitly labeled Admin board mode against the exact loopback API,
and verifies both the running app process and a nonblank simulator capture. Use
`npm run board:ios -- --mode=visitor` for the public app. The command leaves the
app open in Simulator and stores its latest capture under the ignored
`.sandfest-runtime/board-ios/` directory.

The device-signing gate is a local release check. It uses the committed Apple
development team with Xcode automatic signing, allows Xcode to refresh the
development certificate and profile from the signed-in account, builds the
Release configuration for iOS hardware, and verifies the resulting app
signature. It does not upload an archive or submit anything to TestFlight.
The install variant selects an available paired iOS device with Developer Mode
enabled, refreshes device registration, installs the signed app, and launches
it. Set `SANDFEST_IOS_DEVICE_ID` only when selecting among multiple devices.

The initial native SwiftUI scaffold lives under `ios/TexasSandFest/`. It now has a Customer/Admin mode switch. Customer mode covers Today, Schedule, Beach, Sculptors, Ask Sandy, and Tickets. Admin mode covers Command, Incidents, Partners, Finance, and Setup.

Public web and iOS navigation share one allowlisted deep-link contract for
Today, Tickets, Schedule, Island Conditions, Sculptors, and Sandy. Canonical
`https://sandfest.heyelab.com` paths retain useful browser fallbacks, including
an exact public schedule target and a safe, unsubmitted Sandy question. The iOS
target commits the Associated Domains entitlement, and production public builds
generate `/.well-known/apple-app-site-association` only when
`SANDFEST_APPLE_APP_ID_PREFIX` is a valid 10-character Apple Application
Identifier Prefix. The live deployment verifier requires the exact app identity,
allowlisted routes, JSON content type, HTTPS origin, and no redirect.

Simulator builds and tests do not require an Apple signing identity. TestFlight
and device acceptance still require the current Apple Developer Program License
Agreement to be accepted, a valid distribution certificate/profile, the real
Application Identifier Prefix, and a signed app installed from Apple tooling.

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

QuickBooks includes a review-gated sponsor/vendor invoice ledger and durable worker sync. Finance connects from the operations console through a one-time OAuth callback; rotating refresh tokens are AES-256-GCM encrypted in Postgres and never returned to the browser. It remains off until sandbox OAuth, Item mappings, and `QB_INVOICE_SYNC_ENABLED=true` are approved.

```bash
cp .env.example .env
npm run qb:status
```

See `docs/quickbooks-integration.md` for the production OAuth, migration helper, token-rotation, and invoice workflow. Keep all QuickBooks credentials and token files out of git.

## Sponsor outreach

The operations console includes a sponsor outreach workspace that defaults to per-message review and can explicitly approve a bounded campaign sequence. Staff can discover regional businesses through a signed preview, import selected candidates with source attribution, complete contact research, import CSV lists, qualify prospects, document the contact basis, build segmented multi-step campaigns, and choose individual review or a daily-capped automated sequence before Brevo delivery. Production uses the bounded OpenStreetMap adapter and treats discovery health as a required launch capability; discovery itself never creates a prospect or sends a message. A qualified prospect can receive an expiring package invitation that prefills the public sponsor form; only the recipient's explicit submission converts it into the sponsor application, branding checklist, deliverables, milestones, finance record, task, acknowledgment draft, and private portal. See `docs/sponsor-outreach-automation.md` for provider policy, import contracts, workflow, suppression rules, invitation handoff, and the API contract.

## Source facts used

- Official Texas SandFest site: dates, location, mission, public contact channels, sponsor tier language.
- Eventeny ticketing page: 2026 dates, ticket categories, ticketing/application host.
- Texas SandFest FAQ/volunteer pages: volunteer registration deadline framing and core visitor workflows.

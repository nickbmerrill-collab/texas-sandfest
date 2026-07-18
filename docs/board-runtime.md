# Isolated 2027 Board Runtime

This runtime is a local, synthetic data plane for demonstrating real site workflows without retagging or erasing repository history. It is not a production deployment and does not prove provider credentials, DNS, recovery drills, or live cutover.

## Generate

```bash
npm run board:runtime
```

The command rebuilds `.sandfest-runtime/board-2027` from governed source data. It uses the same archive-first annual rollover rules as production, then adds clearly fictional 2027 records for:

- current-event Stripe, Eventeny, Square, and site-native partner revenue, with three visibly synthetic settlement-import receipts and older event imports excluded by the API;

- vendor and sponsor applications, including category-compatible vendor offerings whose captured fees flow directly into receivables and invoice drafts;
- partial sponsor payment and receivables tracking, with one invoice-authoritative payment date shared by the finance ledger, key-date calendar, and follow-up engine;
- sponsor brand profile, logo review, and package deliverables;
- vendor onboarding with one approved, compliance-cleared, partner-confirmed booth assignment beside one intentionally blocked application;
- key dates, review-first acknowledgments, and direct volunteer, staff, and team tasks that exercise each private assignment-notification route;
- geofenced sponsor outreach with an accountable owner, next action, due timestamp, and urgency-sorted follow-up queue;
- staff-issued sponsor invitations that convert a qualified prospect into the real public sponsor application, brand center, fulfillment plan, key dates, task, finance record, and private portal only after recipient consent;
- three private source documents in received, review, and approved states, with staff-only text previews and checksum-verified downloads;
- volunteer coverage, fleet checkout, voting, and Sculpture Passport activity;
- eight synthetic camera metric lanes plus visibly synthetic weather and ferry snapshots. Optional signed playback continuously exercises source activation, heartbeat, anonymous metric ingestion, freshness, and public/admin condition rendering through the real API contract. Real NWS and TxDOT checks remain a separate post-presentation/live-tool lane.

The generated public bootstrap labels both visitor and operations surfaces as a board demonstration. Every email uses a reserved example domain, the seeded safety subscriber uses a fictional `555-01xx` number, automation begins in `review_first`, and generation performs no external provider calls. Site-native receivables, payments, reversals, aging, and exports remain interactive; QuickBooks stays visibly not connected because the board runtime never carries accounting credentials.

## Run

Start the complete presentation stack in one terminal:

```bash
npm run board:demo
```

The supervisor prepares or reuses the isolated runtime, selects unused loopback
ports without stopping another local service, starts the web, API, worker,
email, SMS, and eight-camera playback processes, and prints the exact Visitor
and Operations links only after the same nine readiness checks pass. Keep this
terminal open during the presentation. `npm run board:check` automatically
discovers the active session even when the preferred ports were occupied. The
presentation stack does not call NWS or TxDOT: its weather and ferry cards are
continuously refreshed from a visibly labeled local simulation, so weak venue
internet cannot block startup or make the conditions panel stale.

Before a rehearsal or the board meeting, run the read-only browser acceptance
against that exact active session:

```bash
npm run board:rehearse
```

The command first repeats the nine service and data checks, then opens the
session's credential-free Visitor and Operations links in local headless
Chromium. It rejects remote or mismatched URLs and verifies the rendered signup
catalogs, approved sponsor branding, eight-camera conditions grid, command
signals, partner/task/document queues, deferred live-accounting label, browser
errors, and desktop overflow without submitting a form or changing demo data.

Use the reset icon in the Operations header when you want to discard
demonstration changes and restore the synthetic starting state. After
confirmation, the supervisor stops every local component, replaces the runtime,
starts fresh services, waits for a new 9-of-9 generation, and reloads Operations.
The control appears only when an authenticated board session is connected
directly to its loopback supervisor; ordinary development and production APIs
return no reset capability.

The terminal fallback performs the same intentional reset:

```bash
npm run board:stop
npm run board:demo -- --reset
npm run board:rehearse
```

The credential-free session record lives at
`.sandfest-runtime/board-demo-session.json`. The supervisor restarts a failed
component with bounded backoff and returns to ready only after another 9-of-9
preflight. It stops instead of looping forever when a component repeatedly
fails. Stripe ticketing, sponsor checkout, and QuickBooks sync are explicitly
disabled in this synthetic stack even if the parent shell contains provider
credentials.

### Manual fallback

For component-level debugging, start the isolated providers and API manually:

```bash
npm run board:mailbox
npm run board:sms
npm run board:api
```

The mailbox is a loopback-only Brevo-compatible sandbox. It accepts exactly one reserved `example.com` or `.example` recipient, rejects attachments, never contacts a mail provider, and posts an authenticated `delivered` event back through the real Brevo webhook route. Start it before enabling message automation.

The SMS service is a loopback-only Twilio-compatible sandbox. It accepts only the fictional North American `555-0100` through `555-0199` range, rejects production mode and non-loopback callbacks, and stores no destination or body in its health response. Outbound acceptance travels through the real worker, and delivery plus STOP/START/HELP return through SDK-signed Twilio webhook requests. Start it before the API and worker.

Start the site on a separate terminal:

```bash
npm run board:web -- --port 5175
```

If `5175` is occupied, choose another loopback port. Start the web process on
that port, then give the API and every worker the same public origin in their
respective terminals:

```bash
npm run board:web -- --port 5176
SANDFEST_BOARD_PUBLIC_SITE_URL=http://127.0.0.1:5176 npm run board:api
SANDFEST_BOARD_PUBLIC_SITE_URL=http://127.0.0.1:5176 npm run board:worker:watch
```

The API health response exposes this public URL without any capability tokens,
and `board:check` rejects a web/API origin mismatch. This keeps copied sponsor
invitations, outreach preferences, and private partner links on the board site
that actually passed preflight.

The dedicated board web command injects the fixed synthetic credential only
into the Vite development process and only accepts an exact loopback API host.
Opening the admin entry or switching the combined site to **Operations** loads
the workspace automatically. Ordinary `npm run dev` sessions keep manual token
entry, and production builds compile the board credential path out entirely.

Start eight-camera metric playback in another terminal:

```bash
npm run board:cameras
```

Playback is loopback-only and refuses to start unless the API identifies itself as `board_demo`. It arms all eight synthetic sources through the admin API, posts HMAC-signed heartbeats and metrics every five seconds, and never reads or stores video. The visitor Island Conditions view refreshes automatically every 15 seconds while the page is visible. `npm run board:cameras:once` runs one deterministic cycle for verification.

Open these deterministic presentation links. The visitor URL pins the public
audience even if the same browser previously viewed Operations mode.

- Visitor: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor`
- Sponsor and vendor signup: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor#sponsors`
- Island Conditions: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor#island-conditions`
- Operations: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806`
- Document intake: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806#admin-documents`
- Partner operations: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806#admin-partners`

The operations console uses the local-only token `board-demo-local-admin-token-change-me`. This fixed credential is scoped to the development command above, auto-loads the synthetic workspace, is rejected by production readiness, and must never be used in a deployed environment.

Begin the operations walkthrough at the Festival command summary. Its eight
signals use the same partner API payload as the detailed queues and link
directly to application intake, receivables, message review, assignments, key
dates, sponsor fulfillment, vendor readiness, and sponsor outreach. Attention
states remain visible in the summary instead of being hidden for the demo.

In the board-only runtime, each application card includes **Open demo portal**
beside its status controls. The action rotates the application's audited private
access, opens the prepared sponsor brand center or vendor onboarding workspace
against the active loopback API, removes the capability token from browser
history, and invalidates the previous link. Production builds do not expose this
shortcut; staff can still use **Copy new portal link** for the governed handoff.

The document queue contains three private synthetic source files. Each has an accountable team, review deadline, and synchronized work-board task: received files are open, in-review files are in progress, requested changes block the task, approval completes it, and archive cancels it. Changing the owner or deadline updates the same task and invalidates stale unsent task notices. Uploading the board briefing PPTX queues a checksum-bound worker job; the portal then exposes its extraction status, bounded staff-only preview, and explicit retry control without publishing the source or extracted text.

After loading the partner workspace, use the export menu beside the workspace controls to download the synthetic partner directory, receivables, payment ledger, delegated tasks, outreach pipeline, or key-date calendar. The task export includes notification status and timing without volunteer or staff email addresses. The workspace shows all seven synthetic team routes as ready, but the `board_demo` directory source is deliberately ineligible for production. The outreach export includes owner, next action, and next-action due timestamp. CSV files are neutralized against spreadsheet formulas, calendar files are importable by Outlook and Google Calendar, and every download is recorded in the admin audit log.

The revenue workspace shows the three generated provider batches in Recent settlement imports. Its finance-only import form accepts an Eventeny, Square, Stripe, or manual CSV, previews exact gross/fee/net values and row exceptions without writing, and enables commit only after the preview hash is current. Committed batches are event-scoped, audited, and replay-safe.

Process queued acknowledgments and scheduled reminders without sending them:

```bash
npm run board:worker
```

For continuous partner automation during a demonstration, use `npm run board:worker:watch`. In Partner Operations, change **Transactional partner messages** from review-first to automatic. Only consented applicant acknowledgments, key-date reminders, vendor workflow notices, and governed volunteer/staff/team assignment or overdue notices become eligible. Sponsor prospect outreach and incident dispatch remain review-gated. Provider acceptance, message IDs, authenticated delivery events, and automation policy proof are written to the isolated partner ledger while every recipient remains synthetic.

To demonstrate safety SMS, load **Consent & SMS**, publish a public alert with **Send safety SMS to currently opted-in recipients** checked, then run `npm run board:worker`. The single synthetic campaign advances from queued to delivered through the local signed callback. The operator console exposes only counts and campaign state.

Exercise the same signed preference path without a phone:

```bash
curl -u 'AC00000000000000000000000000000001:board-demo-local-twilio-auth-token-change-me' --data-urlencode 'From=+13615550188' --data-urlencode 'Body=STOP' http://127.0.0.1:8808/simulate/inbound
curl -u 'AC00000000000000000000000000000001:board-demo-local-twilio-auth-token-change-me' --data-urlencode 'From=+13615550188' --data-urlencode 'Body=START' http://127.0.0.1:8808/simulate/inbound
```

Reload **Consent & SMS** after each command. STOP removes the synthetic subscriber from the safety audience, START restores it, and neither command contacts a carrier.

The board API and worker pin every generated public capability link to the documented `127.0.0.1:5175` site, whose development fallback points to the board API on `127.0.0.1:8806`. Copied sponsor invitations, outreach preference links, and private partner links therefore work in a clean browser without relying on previously saved API settings.

## Verify

Check the exact services that are currently running before opening the board
presentation:

```bash
npm run board:check
```

This fails closed when the configured board URL is serving an ordinary
`npm run dev` session, its origin differs from the API's generated public-link
origin, the isolated API or worker is unavailable, either provider sandbox is
missing, the seeded finance, key-date, messaging, staff/volunteer/team delegation,
sponsor fulfillment, vendor, outreach, document, or branding workflow is incomplete,
the visibly synthetic weather or ferry snapshot is stale, or fewer than eight
camera playback pipelines are live. The report
prints recovery commands but never prints the injected admin credential,
recipient details, or message content. Use
`npm run --silent board:check -- --json` for a machine-readable preflight
artifact without npm's command banner.

Continuous camera playback survives transient loopback network failures, API
rate limits, and API 5xx responses. It retries the same cycle with bounded
exponential backoff, re-verifies that the API still identifies the isolated
`board_demo` runtime, and re-applies the idempotent eight-source configuration
before publishing again. Authentication failures, invalid camera credentials,
missing source definitions, and a non-demo runtime remain fatal. Optional
operator tuning is available through
`SANDFEST_BOARD_CAMERA_REQUEST_TIMEOUT_MS`,
`SANDFEST_BOARD_CAMERA_RETRY_BASE_MS`, and
`SANDFEST_BOARD_CAMERA_RETRY_MAX_MS`; defaults are 5, 1, and 30 seconds.

```bash
npm run test:board-runtime
```

The integration gate creates a temporary runtime, starts the real API plus local email and SMS providers, proves an explicit safety campaign with signed delivery and STOP/START callbacks, verifies finance/task/outreach/calendar exports, proves the current private staff directory and all seven team routes, converts the seeded prospect through a signed sponsor invitation, submits an additional vendor and sponsor, runs the worker, proves one delivered privacy-safe notice per assigned task, proves the standby camera state, drives all eight lanes through signed playback, verifies the live privacy-minimized camera state, and confirms the repository partner ledger is byte-for-byte unchanged.

Run the real-browser acceptance separately after installing Playwright's local
Chromium runtime once:

```bash
npx playwright install chromium
npm run test:browser
```

This lane starts a fresh temporary board API and web server on random loopback
ports. It submits vendor and sponsor applications through the rendered public
forms, opens both prepared private partner portals through the board-only
launcher, verifies trusted amounts in the staff accounting view, delegates a
roster-backed volunteer task, adds a partner key
date, scores a geolocated outreach target, verifies approved sponsor branding
and package deliverables, enables bounded transactional automation, observes an
authenticated delivered event through the local email sandbox, imports a
source-attributed regional business candidate, activates a geofenced campaign,
observes its bounded automated delivery, loads all eight Island Conditions
lanes, and checks the critical public and operations views at a mobile viewport.
CI installs an isolated Chromium runtime, retains screenshots and traces only on
failure, and runs this acceptance inside `ready:production`.

After the board presentation, verify the external Island Conditions sources
before commissioning the live-tool lane:

```bash
npm run test:live-feeds
```

This network-dependent smoke proves that the NWS response contains a currently
valid hourly period and that the TxDOT feed still returns both ferry directions.
It is intentionally not part of CI or `ready:production`, because an agency
outage must not make repository verification nondeterministic.

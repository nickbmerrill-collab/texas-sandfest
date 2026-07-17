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
- vendor onboarding and compliance requirements;
- key dates, review-first acknowledgments, and governed volunteer/staff/team tasks that exercise private assignment notification;
- geofenced sponsor outreach with an accountable owner, next action, due timestamp, and urgency-sorted follow-up queue;
- staff-issued sponsor invitations that convert a qualified prospect into the real public sponsor application, brand center, fulfillment plan, key dates, task, finance record, and private portal only after recipient consent;
- volunteer coverage, fleet checkout, voting, and Sculpture Passport activity;
- eight synthetic camera metric lanes, with NWS weather and TxDOT ferry refreshes kept separate. Optional signed playback continuously exercises source activation, heartbeat, anonymous metric ingestion, freshness, and public/admin condition rendering through the real API contract.

The generated public bootstrap labels both visitor and operations surfaces as a board demonstration. Every email uses a reserved example domain, the seeded safety subscriber uses a fictional `555-01xx` number, automation begins in `review_first`, and generation performs no external provider calls. Site-native receivables, payments, reversals, aging, and exports remain interactive; QuickBooks stays visibly not connected because the board runtime never carries accounting credentials.

## Run

Start the isolated API:

```bash
npm run board:mailbox
npm run board:sms
npm run board:api
```

The mailbox is a loopback-only Brevo-compatible sandbox. It accepts exactly one reserved `example.com` or `.example` recipient, rejects attachments, never contacts a mail provider, and posts an authenticated `delivered` event back through the real Brevo webhook route. Start it before enabling message automation.

The SMS service is a loopback-only Twilio-compatible sandbox. It accepts only the fictional North American `555-0100` through `555-0199` range, rejects production mode and non-loopback callbacks, and stores no destination or body in its health response. Outbound acceptance travels through the real worker, and delivery plus STOP/START/HELP return through SDK-signed Twilio webhook requests. Start it before the API and worker.

Start the site on a separate terminal:

```bash
npm run dev -- --port 5175
```

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
- Partner operations: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806#admin-partners`

The operations console uses the local-only token `board-demo-local-admin-token-change-me`. This fixed credential is scoped to the development command above, is rejected by production readiness, and must never be used in a deployed environment.

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

```bash
npm run test:board-runtime
```

The integration gate creates a temporary runtime, starts the real API plus local email and SMS providers, proves an explicit safety campaign with signed delivery and STOP/START callbacks, verifies finance/task/outreach/calendar exports, proves the current private staff directory and all seven team routes, converts the seeded prospect through a signed sponsor invitation, submits an additional vendor and sponsor, runs the worker, proves one delivered privacy-safe notice per assigned task, proves the standby camera state, drives all eight lanes through signed playback, verifies the live privacy-minimized camera state, and confirms the repository partner ledger is byte-for-byte unchanged.

Immediately before a demonstration, verify the external Island Conditions
sources separately:

```bash
npm run test:live-feeds
```

This network-dependent smoke proves that the NWS response contains a currently
valid hourly period and that the TxDOT feed still returns both ferry directions.
It is intentionally not part of CI or `ready:production`, because an agency
outage must not make repository verification nondeterministic.

# Isolated 2027 Board Runtime

This runtime is a local, synthetic data plane for demonstrating real site workflows without retagging or erasing repository history. It is not a production deployment and does not prove provider credentials, DNS, recovery drills, or live cutover.

## Generate

```bash
npm run board:runtime
```

The command rebuilds `.sandfest-runtime/board-2027` from governed source data. It uses the same archive-first annual rollover rules as production, then adds clearly fictional 2027 records for:

- current-event Stripe, Eventeny, Square, and site-native partner revenue, with three visibly synthetic settlement-import receipts and older event imports excluded by the API;
- four visibly priced GA/VIP board products whose loopback-only checkout creates a private order, deterministic payment evidence, wristband fulfillment, finance receipt, and full-refund reversal without contacting Stripe;
- vendor and sponsor applications, including a consented vendor interest whose matching application-mode catalog opening produces one local opening notice and a privacy-safe public-form handoff;
- partial sponsor payment and receivables tracking, with one invoice-authoritative payment date shared by the finance ledger, key-date calendar, and follow-up engine, plus a locally delivered payment confirmation;
- a signed, loopback-only partner invoice checkout that records the approved balance through the real payment, receivables, audit, and key-date reconciliation contracts without contacting Stripe;
- sponsor brand profile, logo review, and package deliverables;
- vendor onboarding with one approved, compliance-cleared, partner-confirmed booth assignment beside one intentionally blocked application;
- key dates with a due-soon sponsor creative approval and automatic loopback reminder, consent-backed acknowledgments, and direct volunteer, staff, and team tasks that exercise each private assignment-notification route;
- geofenced sponsor outreach with accountable owners, next actions, due timestamps, an approved local-automation sequence, and a separate review-first draft that remains in the staff approval queue;
- staff-issued sponsor invitations that convert a qualified prospect into the real public sponsor application, brand center, fulfillment plan, key dates, task, finance record, and private portal only after recipient consent;
- four private source documents in received, review, and approved states, with staff-only text previews and checksum-verified downloads;
- volunteer coverage, fleet checkout, voting, and Sculpture Passport activity;
- eight synthetic camera metric lanes plus visibly synthetic weather and ferry snapshots. Optional signed playback continuously exercises source activation, heartbeat, anonymous metric ingestion, freshness, and public/admin condition rendering through the real API contract. Real NWS and TxDOT checks remain a separate post-presentation/live-tool lane.

The generated public bootstrap labels both visitor and operations surfaces as a board demonstration. Every ticket price is marked as demo-only, every email uses a reserved example domain, the seeded safety subscriber uses a fictional `555-01xx` number, and generation performs no external provider calls. The standalone `board:runtime` command begins in `review_first`. The supervised `board:demo` stack prepares a presentation-specific local-automation seed: consent-backed partner notices, a vendor application-opening handoff, a sponsor payment confirmation, a due-soon sponsor creative reminder, and one explicitly approved geofenced campaign run through the loopback mailbox and authenticated webhook before readiness turns green, while a second campaign keeps its opening message in explicit staff review. One visibly synthetic provider handoff also begins with an ambiguous outcome and remains locked for staff reconciliation, demonstrating duplicate-send protection without contacting a provider. Site-native ticket and partner receipts, payments, reversals, aging, and exports remain interactive; QuickBooks stays visibly not connected because the board runtime never carries accounting credentials.

## Run

Start the complete presentation stack from a clean local `main` that matches
`origin/main` in one terminal:

```bash
npm run board:demo
```

The supervisor records the commit, branch, clean/dirty state, and a SHA-256 of
Git's status output without storing changed paths. Startup refuses dirty source,
a non-`main` branch, or a commit different from local `origin/main`.
`board:check` and `board:rehearse` recompute that fingerprint and fail before
presentation navigation if the checkout changes while the stack is running.

The supervisor prepares or reuses the isolated runtime, selects unused loopback
ports without stopping another local service, starts the web, API, worker,
email, SMS, and eight-camera playback processes, and prints the exact Visitor
and Operations links only after the same 12 readiness checks pass. That gate
requires sandbox-shaped provider acceptance plus authenticated, durable delivery
events for transactional and campaign-approved messages, not merely a configured
worker. A normal supervisor restart can therefore reuse those audited delivery
events even though the loopback mailbox process begins with fresh in-memory
counters; a newly prepared runtime must still traverse the mailbox and callback
path before it can become ready. Keep this
terminal open during the presentation. `npm run board:check` automatically
discovers the active session even when the preferred ports were occupied and
prints its validated Visitor and Operations links after readiness passes. The
presentation stack does not call NWS or TxDOT: its weather and ferry cards are
continuously refreshed from a visibly labeled local simulation, so weak venue
internet cannot block startup or make the conditions panel stale.

On the presentation Mac, use the checkout-owned launchd service instead of
depending on an open terminal:

```bash
npm run board:service:start
npm run board:service:status
```

`board:service:start` is idempotent. It registers
`com.heyelab.sandfest.board`, runs the same clean-main `board:demo -- --reset`
entrypoint, waits for a ready supervisor, and prints the validated links. The
job command contains no board credentials; output is written to
`.sandfest-runtime/board-demo-supervisor.log`. Use
`npm run board:service:restart` after a verified main-branch update and
`npm run board:service:stop` at the end of the presentation. Every service
operation verifies that the launchd label names this exact checkout and refuses
to control an unrelated job. `npm run board:stop` performs the same ownership
check and boots out the keepalive before stopping the supervisor, so a stale
source cannot immediately respawn behind an apparently successful stop.

Every prepared runtime carries an explicit compatibility schema. On startup,
the supervisor automatically rebuilds a recognized synthetic runtime when its
schema, event, or presentation message mode is stale, before any services are
started. This makes a normal `npm run board:demo` safe after site upgrades
without requiring an operator to diagnose a one-minute readiness timeout.
Unknown markers and unmarked directories still fail closed and are never
overwritten automatically.

Each supervised start and reset also claims a new runtime ownership epoch before
its child services begin. File-backed platform access validates that epoch on
every process boundary, so an orphaned manual worker or API from an older local
session cannot keep writing applications, messages, tasks, or finance records
after the supervisor takes control. A stale worker exits cleanly when it sees
the new owner. The ownership identifier is local fencing metadata, not a service
credential, and is never added to the credential-free session handoff.

Before a rehearsal or the board meeting, run the read-only browser acceptance
against that exact active session:

```bash
npm run board:rehearse
```

The command first repeats the 12 source, service, and data checks, then opens the
session's credential-free Visitor and Operations links in local headless
Chromium. It rejects remote or mismatched URLs and verifies the rendered signup
catalogs, local ticket-payment readiness, approved sponsor branding, eight-camera conditions grid, all eight command
signals and their mouse/keyboard workspace navigation, budget, payment, and key-date tracking, delivered local automation, a review-first outreach draft, staff,
volunteer, and team assignments, sponsor/vendor fulfillment, geofenced
outreach with an invitation-ready prospect, private document extraction,
deferred live-accounting label, browser
errors, desktop overflow, and the exact active Visitor and Operations layouts at
320px, 768px, and 1024px without submitting a form or changing demo data. The
responsive gate rejects horizontal overflow, clipped Operations navigation or readiness
labels, and any visible control or choice target below 24px. At both the
board-laptop and narrow-phone viewports, it also requires the Live Beach header
to remain visibly cued below the hero so the next interactive capability is
apparent before scrolling.

To prove that the visible signup controls mutate the exact supervised stack,
then return it to its prepared state, run:

```bash
npm run board:prove:signups
```

This command requires the same clean, ready, exact-loopback session as the
read-only rehearsal. It uses the visible demo presets, confirms that consent is
still unchecked, deliberately grants consent, submits one synthetic vendor and
one synthetic sponsor through the public forms, opens each private status view,
requires both automatic acknowledgments to reach authenticated loopback Brevo
delivery with signed callbacks, and verifies the two delivered message records
and both application references in Operations. It then asks the supervisor to
replace every service and restore the five-application baseline, even if a
workflow assertion fails. Do not run this state-mutating proof during the live
walkthrough; run it during rehearsal and wait for its final 12/12 reset result.

To prove the complete visitor-to-staff Guest Services journey, run:

```bash
npm run board:prove:guest-services
```

The proof submits an accessibility request through the visible visitor form,
requires the browser retry key to return the original reference and private
capability, and confirms an invalid capability cannot open the request. Guest
Services then routes the case at high priority, publishes an in-progress update,
retains a separate internal note, and resolves the case with final arrival
guidance. The visitor's private status must show all three public updates while
withholding contact details, request details, retry hashes, and both staff-only
notes. The proof requires two privacy-minimized staff audit records and then
restores the exact three-case baseline at 12/12 readiness.

To prove the complete vendor onboarding and readiness journey, run:

```bash
npm run board:prove:vendor
```

The proof submits a marketplace application through the visible public form,
completes its operating profile, and uploads the five private compliance files.
Operations deliberately requests one profile correction and one compliance
correction; both notices must reach the loopback mailbox before the vendor
resubmits. Staff approve the revised profile and complete packet, publish booth
and load-in details, and the vendor confirms the assignment in the private
portal. The rehearsal byte-verifies every active private document, confirms the
vendor reaches ready status, checks privacy-minimized lifecycle audits, and
restores the exact prepared vendor baseline at 12/12 readiness. No external
message, payment, or provider call is made.

To prove regional sponsor discovery and outreach delivery, run:

```bash
npm run board:prove:outreach
```

This proof starts in the visible regional business discovery form and requires
the fixture provider to return the expected synthetic Port Aransas candidate.
The imported business remains identified and invitation-ineligible until staff
verify its decision maker, business email, contact basis, owner, and next action.
Operations then issues a Tarpon invitation, previews an exact one-business,
two-mile campaign without exposing the recipient address, and explicitly
approves its one-message-per-day sequence. The message must reach authenticated
loopback Brevo delivery with both invitation and preference links. An invalid
preference capability is denied, the valid capability is concealed from the
browser address, and the recipient opt-out is durable and replay-safe. Seven
lifecycle audits must omit recipient addresses and private capabilities. The
supervisor finally restores the exact two-prospect, two-campaign, one delivered
message baseline at 12/12 readiness. No external discovery or email provider is
called.

To prove the targeted sponsor conversion and branding journey, run:

```bash
npm run board:prove:sponsor
```

The proof uses the prepared, geographically scored Coastal Bend Community Bank
prospect in the visible outreach workspace. Staff issue a package-specific,
expiring invitation and open it through the ordinary Operations control. The
recipient sees a locked organization, email, and package, grants contact consent,
and creates the sponsor application through the public form. The same private
portal submits a live brand preview and uploaded PNG logo; Operations approves
the application, profile, and asset. The proof then requires a second public
sponsor card, byte-identical logo delivery, and governed invitation, application,
profile, and asset audit records without capability or storage-path exposure.
Finally, it restores the exact five-application, two-prospect, one-featured-sponsor
baseline at 12/12 readiness. Run it during rehearsal and wait for the reset.

To prove the public ticket and accounting lifecycle, run:

```bash
npm run board:prove:tickets
```

The proof selects two three-day wristbands in the visible visitor site, requires
acceptance of all four current demonstration policies, and confirms that the
optional marketing and safety consent boxes stay unchecked. It completes the
signed loopback payment, then requires the paid order, payment event, two queued
fulfillment records, and ticket revenue to render in Operations. Finance issues
the full refund through the ordinary Operations control; the proof requires both
fulfillment records to reverse, the refund and net revenue to reconcile, ticket
count to return to baseline, and the audit record to omit buyer contact, retry
hashes, provider identifiers, and fulfillment IDs. Finally, it restores the
empty ticket-order baseline at 12/12 readiness. Run it during rehearsal and wait
for the reset; no external charge or Stripe call is made.

To prove the operating workflows behind the board dashboard, run:

```bash
npm run board:prove:operations
```

This second state-mutating rehearsal creates a budget allocation, submits and
pays an expense, records the remaining synthetic sponsor receivable, delegates
a volunteer task, and creates a due-soon sponsor key date through the visible
Operations UI. It then requires authenticated local delivery of the payment
confirmation, task notice, and automatic key-date reminder; downloads and parses
the budget, expense, payment, receivables, and calendar files; and proves that
the lifecycle audit retains financial state without storing payee or accounting
references. It then asks the supervisor to replace every service and restore the
exact accounting, partner, task, key-date, and message baseline at 12/12
readiness. Run it only during rehearsal and wait for the final reset result.

To prove the complete staff-to-volunteer delegation journey, run:

```bash
npm run board:prove:delegation
```

The proof creates a high-priority volunteer assignment through the visible
Operations work board and requires the selected roster member to show
notification readiness without exposing an email address. The versioned task
notice must reach authenticated local delivery and contain the private mobile
task link. An invalid capability is denied, the valid link is concealed from
the browser address after opening, and the volunteer acknowledges, starts,
reports a required blocker, and completes the assignment. Operations must show
the blocker and completion while four capability-attributed audits omit the
private link and note text. The supervisor then restores the exact 11-task,
10-active-task, ten-assignment-notice baseline at 12/12 readiness.

To prove the synthetic camera-to-Incident Command response journey, run:

```bash
npm run board:prove:incident
```

The proof posts an HMAC-signed critical North Gate metric through the same
privacy-minimized ingest route used by edge agents and requires an exact retry
to return the original observation. Operations assigns the alert to Traffic,
approves its public impact, and the visitor Island Conditions view must render
only the title, summary, severity, and update time. Staff create a routed team
dispatch, review its generated email, deliver it through the authenticated
loopback Brevo sandbox, and track acknowledgement, travel, on-scene response,
and completed closeout. Three signed recovery signals must move the incident to
monitoring before a noted manual resolution removes the visitor notice. Eleven
incident and dispatch audits must omit recipient and delivery ownership values.
The ordinary operator form uses the same recovery posture: a lost accepted
response retains one retry key and returns the original incident, while changed
details with that key are rejected and the key itself is never stored or audited.
The supervisor then restores zero incidents, dispatches, and public notices at
12/12 readiness. No footage is read or stored and no live provider is called.

To prove the private document-ingestion workflow against the active stack, run:

```bash
npm run board:prove:documents
```

The proof uploads a checksum-distinct copy of the board briefing through the
visible Operations form, assigns it to the Production team, waits for private
PPTX extraction, and verifies the bounded staff-only preview. It advances the
synchronized review task from open to in progress to done, downloads the source
through the governed control and verifies identical SHA-256 bytes. It requires
a completed extraction automation record plus privacy-safe upload, review, and
download audit evidence. It then asks the supervisor to replace every service
and restore the exact four-document,
ten-open-task, 21-completed-job baseline at 12/12 readiness. Run it during
rehearsal and wait for the final reset before the live walkthrough.

To certify the complete operating-platform story in one pre-presentation run,
use:

```bash
npm run board:certify
```

The certification pins the active supervisor to clean `main` at local
`origin/main`, starts at 12/12 readiness, and runs all ten public, private, and
Operations journeys in sequence: vendor/sponsor signup, Guest Services, vendor
onboarding, regional outreach, sponsor branding, ticketing, finance/key dates,
volunteer delegation, camera incident response, and document ingestion. Every
journey must return its synthetic records to the prepared baseline and pass a
fresh 12/12 preflight before the next begins. A single failure stops the run and
names the capability that needs attention; the failing proof still gets its
normal restoration opportunity and the certification records final readiness.
After the stateful journeys, the command also requires the same read-only 14/14
responsive and browser-health contract in both Chromium and WebKit.

The successful machine-readable certificate is written to
`.sandfest-runtime/board-capability-certification.json`. It contains the pinned
source revision, durations, aggregate journey evidence, cross-browser results,
and reset readiness, but no contacts, private capabilities, record IDs, notes,
payment references, uploaded filenames, document contents, or provider
credentials. `npm run board:certify -- --json` prints the same report for
another local tool. `--only=signups,operations --skip-browsers` provides a
focused diagnostic run but is labeled focused and is not a full certificate.
The certificate proves the isolated board platform only; it explicitly does not
claim external messages, charges, live feeds, managed recovery, or public
production publishing.

For Safari-compatible rendering proof against the same active, read-only
session, install Playwright WebKit once and run:

```bash
npx playwright install webkit
npm run board:rehearse:webkit
```

To rehearse the native companion against the same supervised session, run:

```bash
npm run board:ios
```

The command refuses a stale, changed, remote, or non-loopback board session. It
selects and boots an available iPhone simulator, builds and installs the Release
app, opens the synthetic Admin mode with the local board session, proves that the
app process remains active, and captures a nonblank screen under
`.sandfest-runtime/board-ios/admin.png`. Pass `--mode=visitor` to rehearse the
public native experience instead.

Use the reset icon in the Operations header when you want to discard
demonstration changes and restore the synthetic starting state. After
confirmation, the supervisor stops every local component, replaces the runtime,
starts fresh services, waits for a new 12-of-12 generation, and reloads Operations.
Visitor tabs recognize that new generation on reload, discard stale private
portal capabilities, and reset browser-only Passport and voting state before
rendering, so a prior walkthrough cannot leave an invalid-link alert in the
prepared presentation.
The control appears only when an authenticated board session is connected
directly to its loopback supervisor; ordinary development and production APIs
return no reset capability. A reset requested while startup or component
recovery is still checking readiness preempts that check and restores the
baseline immediately instead of waiting behind a failing timeout.

The terminal fallback performs the same intentional reset:

```bash
npm run board:stop
npm run board:demo -- --reset
npm run board:rehearse
```

The credential-free session record lives at
`.sandfest-runtime/board-demo-session.json`. The supervisor restarts a failed
component with bounded backoff and returns to ready only after another 12-of-12
preflight. It stops instead of looping forever when a component repeatedly
fails. External Stripe ticketing, sponsor checkout, and QuickBooks sync are
explicitly disabled in this synthetic stack even if the parent shell contains
provider credentials. Ticket and partner-invoice checkout instead use signed,
short-lived, loopback-only board tokens. Completion and refund endpoints refuse
non-board, non-loopback, or production requests and are not a substitute for
Stripe test-mode acceptance.

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

For the manual fallback on its default ports, use these links. The visitor URL
pins the public audience even if the same browser previously viewed Operations
mode. The supervised `npm run board:demo` stack may select different free ports;
its startup output or `npm run board:check` is authoritative for that session.

- Visitor: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor`
- Ticket checkout: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor#tickets`
- Sponsor and vendor signup: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor#sponsors`
- Island Conditions: `http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806&mode=visitor#island-conditions`
- Operations: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806`
- Budget control: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806#admin-budget`
- Document intake: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806#admin-documents`
- Partner operations: `http://127.0.0.1:5175/admin.html?apiBase=http://127.0.0.1:8806#admin-partners`

The Visitor Live Beach footer opens the exact Operations URL in a new tab and preserves the supervisor-selected API base, so the handoff remains authenticated and reload-stable without losing the visitor walkthrough.

The operations console uses the local-only token `board-demo-local-admin-token-change-me`. This fixed credential is scoped to the development command above, auto-loads the synthetic workspace, is rejected by production readiness, and must never be used in a deployed environment.

Begin the operations walkthrough at the Festival command summary. Its eight
signals use the same partner API payload as the detailed queues and link
directly to application intake, receivables, message review, assignments, key
dates, sponsor fulfillment, vendor readiness, and sponsor outreach. Attention
states remain visible in the summary instead of being hidden for the demo.
The recent partner workflow activity feed directly below the partner totals
groups same-batch lifecycle events and resolves readable organization or task
names. It demonstrates intake, finance, key-date, messaging, work-board,
branding, vendor, and outreach automation in one staff-only history without
rendering raw activity, application, follow-up, or capability identifiers.
Accounting includes six synthetic annual allocations and seven synthetic
expenses across submitted, approved, paid, and rejected states. Finance can
add or revise an allocation with a required change note, submit an expense,
approve or reject it, record an explicit over-budget exception, and attach
payment evidence. The Operations export menu downloads the current allocation
summary and full expense register as audited, spreadsheet-safe CSV files. These
actions update or read only the isolated runtime; they do not contact QuickBooks,
Ramp, a bank, or any other payment provider.
Sponsor outreach and Island conditions occupy separate full-width workspace
rows. The board rehearsal checks that source health and all eight camera controls
cannot be compressed beside or visually overlap prospect editing at the desktop
presentation viewport.

On the sponsor and vendor signup cards, **Use demo sponsor** and **Use demo
vendor** fill reserved synthetic contact details while leaving contact consent
unchecked. Review the selected tier or offering, check consent deliberately,
and submit through the normal public intake path. These controls require the
isolated loopback board session and do not render in an ordinary or production
visitor session.

For the visitor ticket walkthrough, add a GA or VIP demo product and choose
**Open demo checkout**. The inline panel repeats the synthetic price and states
that no external charge will occur. Completing payment creates the same private
order, reconciliation event, and deterministic fulfillment records used by the
production workflow. Operations loads those records automatically; use the
board-only **Refund demo order** action to prove that the order, fulfillment,
audit trail, ticket revenue reversal, and sold count reconcile together.

In the board-only runtime, each application card includes **Open demo portal**
beside its status controls. The action rotates the application's audited private
access, opens the prepared sponsor brand center or vendor onboarding workspace
against the active loopback API, removes the capability token from browser
history, and invalidates the previous link. Production builds do not expose this
shortcut; staff can still use **Copy new portal link** for the governed handoff.
An approved invoice with an open balance exposes **Pay in local sandbox** in the
private portal. The partner reviews the exact approved balance and explicitly
completes the demonstration payment. The same invoice balance, payment ledger,
receivables summary, audit trail, and payment key date reconcile immediately;
the signed flow never opens Stripe or sends an external charge. Staff can use
the existing governed reversal action to reopen the balance and key date.
The production browser gate also creates a new artisan vendor through the public
form, pauses and re-enables application email in the authenticated portal,
submits its operating profile and five category-specific compliance
records, approves the same record in operations, publishes booth A-27 and its
load-in window, confirms the assignment in the private portal, and verifies the
dashboard recomputes that vendor as ready. The assignment notice is drafted
automatically and becomes stale when the vendor confirms, proving the follow-up
lifecycle without sending an external message.
The same gate carries one new Tarpon sponsor through a private logo upload,
profile and asset approval, benefit proof publication, sponsor sign-off, staff
completion, and the featured public sponsor showcase ahead of package selection. Its $5,000 invoice, payment,
reversal, and reopened key date stay attached to that record, so branding,
fulfillment, and finance are verified as one lifecycle instead of separate seed
examples.
Custom sponsor deliverables use the same retry-safe staff creation contract as
delegated tasks and key dates. Browser acceptance deliberately drops one
successful response, retries with the retained key, and verifies that only one
fulfillment item, one activity entry, and one audit record exist.
It also delegates one new due-dated task to a governed volunteer, waits for the
loopback mailbox and authenticated delivery webhook to prove the assignment
notice, advances the same task through in-progress and done states, and verifies
the recorded lifecycle timestamps. The worker must retain exactly one delivered
assignment notice and no active overdue escalation after completion. Weekly
overdue reminders remain enabled for tasks that stay open, in progress, or
blocked; the 24-hour assignment grace period prevents an immediate double send.
The fresh sponsor's custom artwork key date is placed inside its configured
lead window, delivered once through the same local transactional lifecycle, and
then completed in Operations with an audited completion timestamp. The browser
gate rejects duplicate reminders or any still-active reminder after that date
is closed, while overdue dates continue to advance on the documented weekly
cadence when staff leave them open.

The seeded Island Harbor Hotel prospect is already qualified, geolocated, and
assigned. Choose a sponsor package and use **Issue invitation**, then **Open
invitation** to demonstrate the locked public prefill and consent step. The
submission opens the real private brand center and changes the same outreach
card to the linked sponsor reference while creating fulfillment, key dates,
finance, and delegated work. Clipboard permission is optional; **Copy link**
remains available for the real recipient handoff.

The document queue contains four private synthetic source files, including the extracted board briefing. Each has an accountable team, review deadline, and synchronized work-board task: received files are open, in-review files are in progress, requested changes block the task, approval completes it, and archive cancels it. Changing the owner or deadline updates the same task and invalidates stale unsent task notices. Uploading another PPTX queues a checksum-bound worker job; the portal then exposes its extraction status, bounded staff-only preview, and explicit retry control without publishing the source or extracted text.

After loading the partner workspace, use the export menu beside the workspace controls to download the synthetic partner directory, receivables, payment ledger, delegated tasks, outreach pipeline, or key-date calendar. The task export includes notification status and timing without volunteer or staff email addresses. The workspace shows all seven synthetic team routes as ready, but the `board_demo` directory source is deliberately ineligible for production. The outreach export includes owner, next action, and next-action due timestamp. CSV files are neutralized against spreadsheet formulas, calendar files are importable by Outlook and Google Calendar, and every download is recorded in the admin audit log.

Systems renders recent background work as a compact workflow digest alongside the transaction and audit monitor. Repeated successful runs are grouped by owning workflow with a count and latest completion, while queued, running, and failed jobs remain individual records. Unhandled terminal failures are always included ahead of recent success history, even when newer jobs would otherwise push them outside the requested history window. The view exposes no payloads, recipient details, raw provider errors, worker identities, or storage paths. An unresolved terminal failure links Operations to the owning document, message, accounting, safety, or incident workspace for its real retry action. After staff resolve the workflow, an operations administrator can acknowledge the queue incident only with a written resolution note; the acknowledgment is conflict-safe and audited.

The revenue workspace shows the three generated provider batches in Recent settlement imports. Its finance-only import form accepts an Eventeny, Square, Stripe, or manual CSV, previews exact gross/fee/net values and row exceptions without writing, and enables commit only after the preview hash is current. Committed batches are event-scoped, audited, and replay-safe.
The browser acceptance gate also uploads one new Square merchandise settlement
through that form, verifies the preview is non-mutating, commits the reconciled
row into the unified accounting dashboard, and confirms its file provenance and
exact gross, fee, and net impact. Uploading the same file again must identify
the exact prior settlement, add no ledger entries, and leave commit disabled,
proving batch replay safety through the staff UI. Changed files containing a
known transaction continue to report row-level duplicates separately.

With the manual component fallback, process queued acknowledgments and scheduled reminders without sending them:

```bash
npm run board:worker
```

The supervised `board:demo` command already runs `board:worker:watch`, enables bounded transactional automation, and activates one synthetic, daily-capped outreach sequence. Only consented applicant acknowledgments, vendor application-opening notices, key-date reminders, sponsor brand correction and proof-review notices, vendor workflow notices, and governed volunteer/staff/team assignment or overdue notices become transactionally eligible; the outreach message is separately authorized by its campaign approval. Other sponsor prospect outreach and incident dispatch remain review-gated. Provider acceptance, message IDs, authenticated delivery events, and automation policy proof are written to the isolated partner ledger while every recipient remains synthetic. If an incident or partner email stops after provider submission, Operations locks retry and dismissal until staff either record a provider message ID as delivered or add a verification note confirming non-delivery; the latter reopens the governed queue action. The supervised Message drafts queue opens with one synthetic provider check: **Record delivered** requires a loopback provider message ID and verification note, while **Confirm not delivered** requires the note and then exposes Retry. Presentation reset restores this locked baseline. The seeded sponsor proof notice carries a valid private portal capability for the selected loopback web origin and contains no proof URL or internal owner data. The vendor opening notice preselects only the current category and offering and requires a fresh public application. The manual component fallback starts review-first and must be enabled from Partner Operations when that behavior is desired.

To demonstrate safety SMS, load **Consent & SMS** and use **Simulate STOP** or **Simulate START** to move the reserved synthetic attendee through the authenticated loopback provider and signed Twilio-compatible preference webhook. The attendee address remains private; Operations shows only the active consent count, state, and aggregate callback proof. Then publish a public alert with **Send safety SMS to currently opted-in recipients** checked. The supervised worker advances the synthetic campaign from queued to delivered through the local signed callback. With the manual component fallback, run `npm run board:worker` after publishing.

Exercise the same signed preference path without a phone:

```bash
curl -u 'AC00000000000000000000000000000001:board-demo-local-twilio-auth-token-change-me' --data-urlencode 'From=+13615550188' --data-urlencode 'Body=STOP' http://127.0.0.1:8808/simulate/inbound
curl -u 'AC00000000000000000000000000000001:board-demo-local-twilio-auth-token-change-me' --data-urlencode 'From=+13615550188' --data-urlencode 'Body=START' http://127.0.0.1:8808/simulate/inbound
```

Reload **Consent & SMS** after each command. STOP removes the synthetic subscriber from the safety audience, START restores it, and neither command contacts a carrier.

The supervisor pins every generated public capability link to its selected
loopback web origin and gives the API and worker that same origin. The manual
fallback defaults to `127.0.0.1:5175` with its API on `127.0.0.1:8806`.
Copied sponsor invitations, outreach preference links, and private partner
links therefore work in a clean browser without relying on previously saved
API settings.

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
the loopback mailbox lacks both transactional and campaign-approved delivery proof,
the visibly synthetic weather or ferry snapshot is stale, or fewer than eight
camera playback pipelines are live. After every check passes, the report prints
the exact active Visitor and Operations links selected by the supervisor. It
prints recovery commands on failure but never prints the injected admin credential,
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

Run both real-browser acceptance lanes after installing Playwright's local
Chromium and WebKit runtimes once:

```bash
npx playwright install chromium webkit
npm run test:browser
npm run test:browser:webkit
```

This lane starts a fresh temporary board API and web server on random loopback
ports. It submits vendor and sponsor applications through the rendered public
forms, opens both prepared private partner portals through the board-only
launcher, verifies trusted amounts in the staff accounting view, delegates a
roster-backed volunteer task, adds a partner key
date, scores a geolocated outreach target, issues and opens its package-specific
invitation, submits the locked public sponsor application, verifies the linked
operations conversion, verifies approved sponsor branding and package
deliverables, enables bounded transactional automation, observes sponsor proof-review and other
authenticated delivered event through the local email sandbox, imports a
source-attributed regional business candidate, activates a geofenced campaign,
observes its bounded automated delivery, loads all eight Island Conditions
lanes, and checks the critical public and operations views at a mobile viewport.
CI runs Chromium and Safari-compatible WebKit acceptance in separate jobs,
retains screenshots and traces only on failure, and `ready:production` includes
both engines.

After the board presentation, verify the external Island Conditions sources
before commissioning the live-tool lane:

```bash
npm run test:live-feeds
```

This network-dependent smoke proves that the NWS response contains a currently
valid hourly period and that the TxDOT feed still returns both ferry directions.
It is intentionally not part of CI or `ready:production`, because an agency
outage must not make repository verification nondeterministic.

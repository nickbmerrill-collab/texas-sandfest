# Partner message automation

## Policy boundary

Partner messaging defaults to `review_first`. An administrator with `partners:write` may enable `transactional_auto` only when Brevo sending and the authenticated Brevo delivery webhook are both ready. The worker rechecks that combined readiness on every tick; losing either capability pauses new automatic approvals and sends without changing the saved policy.

Automatic approval is limited to messages for an existing vendor or sponsor application that already granted contact consent:

- Application received acknowledgments
- Payment received confirmations
- Payment refund and void adjustments
- Upcoming, due, and overdue milestone reminders
- Vendor application-opening notices for matching consented interests
- Sponsor brand profile and asset correction requests
- Sponsor deliverable proof-ready notices
- Vendor profile correction requests
- Vendor requirement correction requests
- Vendor assignment ready notices
- Vendor assignment cancellation notices

It also covers assignment and bounded weekly-overdue notices for active tasks assigned to a volunteer in the current roster mirror, an active staff member in the governed staff directory, or a team with a current notification owner. The worker resolves the current private address on the server immediately before approval and delivery. Unassigned tasks do not generate notices.

Sponsor prospect outreach and incident dispatch messages are never eligible. They continue through staff review and explicit queueing.

## User-initiated portal recovery

`POST /api/public/partner-portal-recovery` is a separate transactional path and does not depend on `transactional_auto`. It is allowed only when the partner portal and transactional email provider are ready. Production also requires a valid Cloudflare Turnstile challenge for action `partner_access_recovery`.

The server normalizes the submitted application reference and email, then requires an exact match to the current consented application contact. A match creates an approved `portal_access_recovery` follow-up containing the current HMAC capability URL, queues it through the same crash-recoverable worker, and revalidates consent and the stored recipient before provider submission. Repeated requests for the same application and portal-access version reuse the existing message for 15 minutes. A portal rotation naturally permits a new message for the new capability.

Matches, invalid inputs, unknown references, wrong emails, and cooldown replays all return the same `202` response with `Cache-Control: no-store`. The public response contains no match flag, application identity, recipient, follow-up ID, job ID, or portal token. Only a successful match creates a privacy-minimized staff activity record. Queue failures remain visible to operators as failed follow-ups while the public response stays generic.

## Partner message preferences

An authenticated private partner portal exposes the current application-email permission without returning a contact address, notice text, or capability token. `POST /api/public/partner-contact-preferences` revalidates the HMAC capability inside the same atomic document mutation and requires the displayed preference version. A stale tab receives `409`; an exact replay returns the current state without adding activity or audit records.

Opting out increments the preference version and dismisses application messages in `pending`, `draft_ready`, `approved`, `queued`, or `failed` state, plus `sending` claims that have not begun provider submission. It clears approvals and job ownership before another worker attempt, while preserving started provider handoffs, sent messages, delivery events, payments, dates, and the submitted application. Every delivery path still rechecks the stored permission immediately before provider submission.

Re-enrollment captures the current server-owned contact notice and increments the preference version again. Previously dismissed messages are not resurrected; a later valid application event can create a new versioned message. Audit and partner activity records contain only the application ID, allowed state, preference version, and dismissed count. A partner who pauses email must retain the private link or contact staff to restore access because portal-recovery email is also consent-gated.

## Delivery lifecycle

1. Intake or an operations change creates a pending message with a stable workflow key.
2. The worker prepares the subject, body, and current partner portal URL.
3. In automatic mode, the worker revalidates the message kind, consent or roster-backed recipient, current recipient, open milestone or task version, current sponsor brand review or proof version, and complete content.
4. Eligible drafts are approved under policy `partner_transactional_v1` and receive an audited approval record.
5. The worker creates a deterministic queue job from the policy, follow-up ID, and approval timestamp. Repeated ticks return the same job instead of creating another delivery.
6. The partner record is moved to `queued` with the queue job ID before the provider call.
7. Brevo acceptance, message ID, attempts, failures, and authenticated webhook events are recorded in the partner ledger.

Recipient identity and consent are checked again immediately before delivery. A changed email, inactive or missing directory owner, withdrawn consent, completed milestone, rescheduled milestone, or changed payment state blocks the send. Provider failures use the durable worker retry policy and terminal failures remain visible for staff action.

Vendor opening notices are derived from the current staff-managed offering catalog. The worker matches the interest's offering and category, requires the offering to be active in `application` mode, and versions the notice against its current name, public fee label, amount, and eligible categories. Closing or materially changing the offering dismisses stale unsent notices; delivered history is retained. The link contains only the offering and category and opens the normal public form, where the vendor must enter current identity details, review the current fee, grant current consent, and submit a new application.

Sponsor brand feedback uses one workflow key per profile or asset kind. A profile resubmission, replacement asset, staff approval, or later review dismisses any unstarted correction notice. Publishing or revising deliverable proof creates one notice for the current proof version without copying the proof URL, internal owner, or staff metadata into the message; sponsor approval or a change request closes the active notice. Approval and delivery both fail closed when the referenced profile, asset, deliverable, proof version, or recipient is no longer current.

Payment notices are derived from the current site-native ledger rather than from a browser request or provider payload. A successful payment creates one versioned confirmation with the recorded amount and current invoice balance. A partial refund, full refund, or void creates a separate adjustment notice. Provider references, bank or check identifiers, and staff-only reversal reasons are never included in message content. Repeated worker ticks converge on the same payment-state version; a later ledger adjustment invalidates an unsent receipt before approval or provider submission while preserving already delivered history. The adjustment then reports the current balance through the same consent, automation, queue, and delivery-proof gates.

Only payments recorded or adjusted under the current notice policy are eligible. Existing ledger history is not backfilled when this automation is deployed.

The first application-review reminder is intentionally staggered from intake. Upcoming `interest_review`, `application_review`, and `opportunity_qualification` milestones on their untouched intake schedule wait until the application is at least 24 hours old before a reminder is generated, so a new partner does not receive a milestone email in the same delivery cycle as the acknowledgment. A staff reschedule increments the schedule version and overrides that grace. Due or overdue milestones, payment reminders, custom staff-created dates, task notices, and the acknowledgment itself keep their existing timing.

Task notices use independent assignment, notice, and schedule versions. A new or changed governed volunteer, staff, or team assignment generates one assignment notice; an active overdue task can generate at most one notice per overdue week, and a fresh assignment notice suppresses an immediate overdue notice for 24 hours. Operations can use `Send notice` or `Resend notice` on an active assigned task after the previous notice reaches a terminal state. The action revalidates the governed recipient, accepts one durable retry key, creates a new notice version without changing the assignment, rejects another request while delivery is pending, and records an aggregate audit event. Every prepared assignment and overdue notice includes a private `#task-status` capability bound to the task, current assignee, and assignment version. The public task view posts that capability to the API, removes it from the visible URL before the request, and retains it only in tab-scoped session storage. Assignees can acknowledge, start, report a blocker with a required note, or mark the task complete; Operations sees the acknowledgement and latest update on the work board. Reassignment revokes every older link and resets acknowledgement, while due-date changes, completion, cancellation, reopening, and directory recipient changes invalidate or dismiss stale drafts as appropriate. Task recipient addresses, capability tokens, and notice retry keys stay private in server-side records; audits omit tokens, keys, and note bodies, admin responses expose only recipient availability and a display label, and task exports include notification state without an address. Production may set `SANDFEST_TASK_PORTAL_SECRET` as a separate 32+ character HMAC root; otherwise the shared partner portal secret is reused with domain separation on both the API and worker.

## Staff directory gate

The `staff-directory` platform document is annual operational data. Production accepts only `connecteam`, `manual_verified`, `oidc`, or `hr_import` provenance, requires a verification timestamp no older than 90 days, requires every active staff record to have an email, and requires one active notification owner for each of the seven operating teams. The event ID on the directory and every staff row must match `SANDFEST_EVENT_ID`. The repository seed and `board_demo` source are useful for local presentation work but intentionally fail production readiness.

An operations administrator can preview and commit the board-approved JSON or CSV directory beside the staff work board. `POST /api/admin/staff-directory/import` requires `staff:write`, binds the exact file and current private directory into a one-time preview hash, replaces the directory atomically, converges concurrent replays, and writes aggregate-only import and audit evidence. Responses contain display identity and routing readiness but never an email address.

The equivalent CLI is:

```bash
npm run import:staff -- /secure/staff-directory.json --source=manual_verified
npm run import:staff -- /secure/staff-directory.json --source=manual_verified --commit
```

CSV imports accept `id`, `event_id`, `name`, `email`, `status`, `roles`, `teams`, and `notification_teams`; list values may be separated by pipes, semicolons, or commas. Duplicate staff IDs, email identities, or team routes fail the full replacement. Production commits require Postgres and refuse file storage. A mismatched annual directory may be previewed, but commit remains disabled until the archive-first event rollover is complete.

Payment reminders use the invoice due date as their schedule. When successful payments reach the approved application amount, payment reconciliation completes the finance-owned `Payment due` milestone, dismisses any active unsent reminder, and allows the worker to create the payment confirmation. A refund or reversal that restores a balance reopens only a milestone previously completed by `automation:payment_reconciliation`, increments its schedule version, and creates a current-balance adjustment notice while leaving manually completed or cancelled milestones unchanged. Reminder generation also checks the current ledger balance, so a legacy open milestone cannot produce a payment reminder for a fully paid account.

## Administration

The Partner Operations workspace shows the current policy, provider/tracking readiness, eligible draft count, automatic approval count, and automatic queue count. Enabling automatic delivery requires an explicit confirmation. The policy endpoint is:

```http
PATCH /api/admin/partners/automation
Authorization: Bearer <admin access token>
Content-Type: application/json

{"mode":"transactional_auto"}
```

Use `{"mode":"review_first"}` to stop new automatic approvals. Unqueued automation-approved drafts return to `draft_ready`; already queued work retains its delivery proof and may finish. Each policy change writes both partner activity and an admin audit event.

The standalone `npm run board:runtime` seed defaults to `review_first`. The guarded `npm run board:demo` supervisor instead selects `local_automation`, which maps to `transactional_auto` only inside the recognized synthetic runtime with loopback provider endpoints, reserved example-domain recipients, and the persistent Demo label. User-requested portal recovery remains independent of that broad policy. `npm run board:mailbox`, `npm run board:api`, and `npm run board:worker:watch` configure a loopback-only Brevo-compatible sandbox that rejects attachments and returns delivery through the authenticated webhook route. This proves the delivery lifecycle without external email. Production enablement still requires real Brevo credentials and the same sender/webhook configuration in both the API and worker environments.

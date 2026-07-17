# Partner message automation

## Policy boundary

Partner messaging defaults to `review_first`. An administrator with `partners:write` may enable `transactional_auto` only when Brevo sending and the authenticated Brevo delivery webhook are both ready. The worker rechecks that combined readiness on every tick; losing either capability pauses new automatic approvals and sends without changing the saved policy.

Automatic approval is limited to messages for an existing vendor or sponsor application that already granted contact consent:

- Application received acknowledgments
- Upcoming, due, and overdue milestone reminders
- Vendor profile correction requests
- Vendor requirement correction requests
- Vendor assignment ready notices
- Vendor assignment cancellation notices

It also covers assignment and bounded weekly-overdue notices for active tasks assigned to a volunteer in the current roster mirror, an active staff member in the governed staff directory, or a team with a current notification owner. The worker resolves the current private address on the server immediately before approval and delivery. Unassigned tasks do not generate notices.

Sponsor prospect outreach and incident dispatch messages are never eligible. They continue through staff review and explicit queueing.

## Delivery lifecycle

1. Intake or an operations change creates a pending message with a stable workflow key.
2. The worker prepares the subject, body, and current partner portal URL.
3. In automatic mode, the worker revalidates the message kind, consent or roster-backed recipient, current recipient, open milestone or task version, and complete content.
4. Eligible drafts are approved under policy `partner_transactional_v1` and receive an audited approval record.
5. The worker creates a deterministic queue job from the policy, follow-up ID, and approval timestamp. Repeated ticks return the same job instead of creating another delivery.
6. The partner record is moved to `queued` with the queue job ID before the provider call.
7. Brevo acceptance, message ID, attempts, failures, and authenticated webhook events are recorded in the partner ledger.

Recipient identity and consent are checked again immediately before delivery. A changed email, inactive or missing directory owner, withdrawn consent, completed milestone, or rescheduled milestone blocks the send. Provider failures use the durable worker retry policy and terminal failures remain visible for staff action.

Task notices use independent assignment and schedule versions. A new or changed governed volunteer, staff, or team assignment generates one assignment notice; an active overdue task can generate at most one notice per overdue week, and a fresh assignment notice suppresses an immediate overdue notice for 24 hours. Reassignment, due-date changes, completion, cancellation, reopening, and directory recipient changes invalidate or dismiss stale drafts as appropriate. Task recipient addresses stay private in the server-side follow-up record; admin responses expose only recipient availability and a display label, and task exports include notification state without an address.

## Staff directory gate

The `staff-directory` platform document is annual operational data. Production accepts only `connecteam`, `manual_verified`, `oidc`, or `hr_import` provenance, requires a verification timestamp no older than 90 days, requires every active staff record to have an email, and requires one active notification owner for each of the seven operating teams. The event ID on the directory and every staff row must match `SANDFEST_EVENT_ID`. The repository seed and `board_demo` source are useful for local presentation work but intentionally fail production readiness.

Preview a board-approved JSON or CSV roster before committing it:

```bash
npm run import:staff -- /secure/staff-directory.json --source=manual_verified
npm run import:staff -- /secure/staff-directory.json --source=manual_verified --commit
```

CSV imports accept `id`, `name`, `email`, `status`, `roles`, `teams`, and `notification_teams`; list values may be separated by pipes, semicolons, or commas. Preview output omits addresses. Production commits require Postgres and refuse file storage. Complete the archive-first event rollover before importing a new annual directory.

Payment reminders use the invoice due date as their schedule. When successful payments reach the approved application amount, payment reconciliation completes the finance-owned `Payment due` milestone and dismisses any active unsent reminder. A refund or reversal that restores a balance reopens only a milestone previously completed by `automation:payment_reconciliation`, increments its schedule version, and leaves manually completed or cancelled milestones unchanged. Reminder generation also checks the current ledger balance, so a legacy open milestone cannot produce a payment reminder for a fully paid account.

## Administration

The Partner Operations workspace shows the current policy, provider/tracking readiness, eligible draft count, automatic approval count, and automatic queue count. Enabling automatic delivery requires an explicit confirmation. The policy endpoint is:

```http
PATCH /api/admin/partners/automation
Authorization: Bearer <admin access token>
Content-Type: application/json

{"mode":"transactional_auto"}
```

Use `{"mode":"review_first"}` to stop new automatic approvals. Unqueued automation-approved drafts return to `draft_ready`; already queued work retains its delivery proof and may finish. Each policy change writes both partner activity and an admin audit event.

The board demo remains in `review_first` until an operator deliberately enables automatic mode. `npm run board:mailbox`, `npm run board:api`, and `npm run board:worker:watch` configure a loopback-only Brevo-compatible sandbox that accepts reserved example-domain recipients, rejects attachments, and returns delivery through the authenticated webhook route. This proves the delivery lifecycle without external email. Production enablement still requires real Brevo credentials and the same sender/webhook configuration in both the API and worker environments.

# Safety SMS Operations

Texas SandFest safety SMS is an operator-confirmed extension of the public alert workflow. It does not send marketing messages and publishing an alert alone never initiates a text.

## Board Demonstration Sandbox

`npm run board:sms` starts a Twilio-compatible service on `127.0.0.1:8808`. It refuses production mode, accepts only fictional `555-01xx` destinations, requires the configured synthetic account credentials, and rejects any non-loopback status callback. The board API and worker use the normal SMS configuration and therefore exercise the same consent lookup, private job, provider submission, signed status callback, aggregate delivery ledger, and signed STOP/START/HELP routes used by production.

The sandbox is presentation evidence, not Twilio acceptance. It makes no carrier request and does not prove sender registration, throughput, external HTTPS routing, or launch-volume capacity. See [`board-runtime.md`](board-runtime.md) for the exact startup and preference-simulation commands.

## Production Contract

- `smsSafety`, `smsMarketing`, and email marketing remain separate consent channels.
- The API queues only private consent-record identifiers. Phone numbers never enter the job payload, delivery ledger, audit record, or admin response.
- The worker reloads the consent record and verifies its hashed destination immediately before each provider request.
- A message is submitted at most once. A network-ambiguous outcome becomes `delivery_unknown` for provider reconciliation instead of an automatic retry.
- The Twilio status callback binds the local message identifier to the stored Message SID and records monotonic accepted, sent, delivered, failed, or undelivered evidence.
- STOP/START/HELP updates only the inbound number's configured consent channel. The application returns empty TwiML because Twilio Advanced Opt-Out supplies the confirmation.
- Clearing an alert suppresses every queued message in its campaign. Already submitted messages cannot be recalled.

Twilio signs form webhooks in `X-Twilio-Signature`; the implementation validates that signature against the configured public callback URL using the official SDK. See [Twilio request validation](https://www.twilio.com/docs/usage/security), [outbound status callbacks](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks), and [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).

## Twilio Configuration

Configure a safety-specific Messaging Service or sender. Do not share the safety inbound number with promotional SMS unless the resulting channel behavior has been reviewed and approved.

```text
Status callback:  https://api.heyelab.com/sandfest/api/webhooks/twilio/status
Safety inbound:   https://api.heyelab.com/sandfest/api/webhooks/twilio/inbound/smsSafety
Marketing inbound:https://api.heyelab.com/sandfest/api/webhooks/twilio/inbound/smsMarketing
```

Set the same account, auth token, sender, callback URLs, and `SMS_ENABLED` value on the API and worker. Production rejects non-HTTPS callbacks and any API origin other than `https://api.twilio.com`. Prefer `TWILIO_MESSAGING_SERVICE_SID`; `TWILIO_FROM_NUMBER` is the fallback.

## Launch Acceptance

1. Leave `SMS_ENABLED=false` while sender registration, Advanced Opt-Out, and callback URLs are configured.
2. Use test recipients with explicit `smsSafety` consent. Publish an alert without selecting SMS and verify no job is created.
3. Select safety SMS, publish once, and verify the campaign total equals the current eligible count and jobs expose no destination.
4. Run the worker and verify one Twilio Message SID per eligible record. Confirm status callbacks advance delivery state and a forged signature receives HTTP 401.
5. Send STOP, HELP, and START to the safety number. Confirm safety consent changes only for STOP/START, HELP leaves consent unchanged, and duplicate callbacks are idempotent.
6. Publish another test campaign, clear it before the worker runs, and verify zero new provider submissions.
7. Rehearse the approved launch volume, observe provider throughput and callback backlog, and retain delivery logs as described by [Twilio's outbound logging guidance](https://www.twilio.com/docs/messaging/guides/outbound-message-logging).
8. Increase `SANDFEST_SMS_MAX_RECIPIENTS` only to the tested operating limit. The current implementation deliberately caps a campaign at 5,000; a larger festival-wide blast requires a dedicated capacity review and storage/queue load acceptance.
9. Set `SMS_ENABLED=true` only after the preceding checks pass. `/ready` must then show `sms` green.

## Incident Handling

- `failed` or `undelivered`: review Twilio error code and sender compliance before another operator-approved campaign.
- `delivery_unknown`: reconcile in Twilio by campaign time and recipient hash; do not replay automatically.
- unexpected STOP volume: pause new sends, confirm the configured inbound channel and Advanced Opt-Out settings, then inspect aggregate preference events.
- callback authentication failures: keep sending disabled until public URL/proxy reconstruction and the Twilio auth token match.

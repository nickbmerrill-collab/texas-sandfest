# Sponsor outreach automation

## Operating model

Sponsor outreach defaults to review-first and remains separate from transactional partner automation. Each campaign may either require individual message review or use an explicitly approved sequence with a one-to-100-message daily limit. A staff member with `outreach:write` approves and activates an automated sequence once; the worker may then approve and queue only eligible messages belonging to that active campaign. Review-first messages still require a staff member with `partners:write` to review and queue each message. Brevo remains gated by `TRANSACTIONAL_EMAIL_ENABLED=true`, a verified sender, a valid API key, and an authenticated delivery webhook in production; an approved sequence cannot activate until both sending and delivery tracking are ready.

## Prospect controls

Every prospect has a scored geography/industry fit, pipeline status, business email, documented contact basis, accountable owner, next action, and optional follow-up timestamp. The outreach workspace sorts active prospects by urgency and reports overdue, due-today, unassigned, and unscheduled work separately. Terminal and suppressed prospects leave the active follow-up queue without erasing their schedule history. Staff can record a five-digit ZIP or ZIP+4 and an optional latitude/longitude pair. Coordinates can be entered manually, imported, or selected from the reviewed business-discovery workflow; the application does not silently change a prospect location.

## Sponsor invitation handoff

Once a prospect is qualified and has a verified decision maker, business email, and contact basis, outreach staff can choose an active sponsorship package and issue a 30-day sponsor invitation. The signed capability binds the prospect, package, email identity, expiration, and invitation version. It lives in the URL fragment, is concealed after the public page opens, and can be copied again without rotating it. Replacing or revoking an invitation invalidates the previous link; queued outreach blocks either action so a message cannot be sent with a capability that staff just invalidated.

Issuing or replacing an invitation appends the current link to eligible unsent sponsor-outreach drafts and returns previously approved drafts to review. The worker also regenerates the current invitation immediately before it prepares a due campaign draft. On its next pass, it may reapprove the message only when the prospect still belongs to an active, explicitly approved sequence.

Opening the link prefills and locks the invited business, email, and package while leaving the contact, description, and explicit contact consent visible to the recipient. Staff do not fabricate an application on the prospect's behalf. A valid public submission atomically creates the sponsor application, brand profile, package deliverables, key dates, review task, acknowledgment draft, expected package amount, and private partner portal. The prospect becomes `won`, stores the application link, and every remaining unsent outreach message is dismissed. Concurrent or repeated submissions converge on the same application. Reopening a used invitation recovers the resulting private portal instead of creating another application.

## Regional business discovery

Authorized outreach staff can search by U.S. place name or an explicit coordinate pair, select a radius from 0.5 to 50 miles, choose one or more fixed business categories, and request up to 50 candidates. The production adapter uses Nominatim for one bounded place lookup and Overpass for the selected category/radius query. It preserves each OpenStreetMap object link, fetch timestamp, and ODbL attribution on the resulting prospect.

Discovery is preview-only until staff selects candidates and commits the signed preview. Preview capabilities are HMAC-signed, expire after 15 minutes, and bind the provider, query, and complete candidate records. A changed, expired, or tampered capability is rejected. Import is atomic, skips existing prospects, retains provider provenance, and records aggregate-only audit data.

Every discovered business enters as `identified` with no contact basis, even when OpenStreetMap lists an email address. Discovery never creates a campaign draft or sends a message. Staff must verify the website, decision maker, business email, next action, contact basis, and readiness before the prospect can match a campaign. The admin workspace exposes those research fields directly on the prospect record.

The `fixture` adapter contains visibly synthetic `.example.com` businesses for automated checks and board demonstrations. It is rejected when `SANDFEST_ENV=production`. Production should use `openstreetmap` with an identifying `OUTREACH_DISCOVERY_USER_AGENT`, an operator address in `OUTREACH_DISCOVERY_CONTACT`, and a separate 32+ character signing secret or the partner-portal secret fallback.

The adapter follows the public [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): one request per second per process, an identifying client header, bounded single-result lookups, and a 24-hour geocode cache. The interface is search-on-submit and does not provide autocomplete or bulk/systematic place scraping. OpenStreetMap results retain [copyright and ODbL attribution](https://www.openstreetmap.org/copyright). Up to three explicitly configured HTTPS Overpass instances are tried in order only after a timeout, rate limit, network failure, or transient 5xx response; query, payload, and validation failures do not fan out. Successful previews report the serving hostname and attempt count, while exhausted searches return a bounded hostname-only failure trail to staff. For sustained production volume, configure reviewed hosted endpoints rather than depending on best-effort public instances.

## Business-list import

The operations workspace accepts a pasted or selected CSV with up to 500 business rows. The importer uses a standards-based CSV parser, including quoted commas, escaped quotes, and multiline fields. Staff select default state, readiness, contact basis, and community-fit values; row values override those defaults when present.

Supported canonical headers are `organization_name`, `website`, `industry`, `city`, `state`, `postal_code`, `latitude`, `longitude`, `contact_name`, `contact_email`, `community_fit`, `contact_basis`, `status`, `tags`, `owner_id`, `next_action`, and `next_action_at`. Common aliases such as `business_name`, `company`, `zip`, `email`, `lat`, `lng`, `assigned_to`, and `follow_up_date` are accepted. Follow-up timestamps must be valid date-time values and are normalized to UTC before persistence.

Every import must be previewed before it can be committed. The preview reports valid, duplicate, and invalid rows and returns a hash over the CSV plus import defaults. A commit with changed content or defaults is rejected. Valid rows are written in one partner-ledger transaction, invalid rows are reported, existing prospects are skipped, and no import overwrites an existing prospect. Imported prospects retain the batch ID and source row for audit and troubleshooting. Audit records store only the batch summary, not the source CSV or contact details.

Campaign eligibility requires all configured filters to match:

- Pipeline status is `qualified`, `contact_ready`, `contacted`, or `engaged`.
- Contact email and contact basis are present.
- The prospect is not suppressed or marked `do_not_contact`.
- Campaign industry, city, state, ZIP, and minimum-fit filters match.
- When a geofence is configured, the prospect has a coordinate pair within the campaign radius.

Campaigns accept a center latitude, center longitude, and radius greater than zero and no more than 500 miles. Distance uses a deterministic great-circle calculation. A partial coordinate pair, malformed ZIP, partial campaign geofence, or out-of-range value is rejected. Correcting a prospect's location recalculates fit immediately.

Supported contact-basis values are `inbound_request`, `existing_relationship`, `event_partner`, `business_relevance`, and `referral`. These are operating records, not a substitute for organization-specific legal review.

Suppressing a prospect requires a reason and immediately dismisses every unsent campaign message, including queued work. The worker validates suppression, contact basis, and recipient identity again immediately before provider delivery.

Every generated outreach draft includes a recipient-specific preference link. Its HMAC capability lives after `#outreach-preferences` in the URL fragment, so it is not sent in the initial page request or ordinary referrer headers. The public page posts the capability to the API only after load, reveals the business name and current outreach state without revealing the email address, and requires an explicit confirmation before suppression. Repeating the confirmation is idempotent.

The worker regenerates and validates the current preference link immediately before provider delivery, appends it to older drafts that predate this feature, and adds a `List-Unsubscribe` header. Public unsubscribe uses the same atomic partner ledger update as staff suppression, cancels every unsent message, records a privacy-minimized audit event, and is rechecked by the worker before any provider call.

Changing a prospect's location, qualification, contact basis, or email dismisses any unsent draft that no longer matches its campaign. Approval and queueing independently re-run current targeting, so a stale radius match cannot be restored by editing a stored draft.

## Campaign lifecycle

1. Create a `draft` campaign with one to four sequence steps, a delivery mode, and a daily send limit.
2. Set targeting by industry, city, state, ZIP, optional center/radius, and minimum fit score.
3. Activate the campaign. Activation fails when no eligible prospects match; approved-sequence activation also fails until email delivery and authenticated callbacks are ready.
4. Generate due drafts manually or allow the background worker to generate them.
5. In review-first mode, review each `draft_ready` message and approve or dismiss it. In approved-sequence mode, the worker approves only the current campaign's eligible drafts within its daily limit.
6. Queue approved messages for Brevo delivery. The daily limit counts every queued, in-flight, delivered, or provider-failed campaign message for the day, including messages a staff member queues manually. Retry-safe job keys bind the campaign policy, message, and approval timestamp, while a stable Brevo idempotency key protects immediate provider retries. A provider duplicate response is held for manual delivery verification instead of being retried after the provider TTL.
7. After delivery is proven, the next sequence step becomes eligible when its delay expires.
8. Pause, complete, or archive the campaign when appropriate. Pausing returns approved or queued automated messages to review and clears their jobs. The worker atomically claims a queued message, then revalidates the persisted recipient, suppression, targeting, and campaign state in the same locked operation that starts provider delivery. A pause or opt-out that commits first cancels the send; once the provider operation wins, the delivery remains visible as in flight. Failed deliveries remain failed, lose their automation approval, and require an explicit staff retry after reactivation. Completing or archiving dismisses all unsent, unclaimed campaign messages.

Generation is idempotent by campaign, prospect, and sequence step. Repeated worker ticks or API calls cannot create a duplicate step. Before every automated approval and provider call, current campaign status, targeting, contact basis, recipient identity, suppression, invitation version, and preference capability are revalidated.

## Template fields

Plain-text subject and body templates support:

- `{{organization}}`
- `{{contactName}}`
- `{{city}}`
- `{{state}}`
- `{{industry}}`

Unknown template fields are rejected when the campaign is created.

## API

- `GET /api/admin/outreach`
- `POST /api/admin/outreach/discovery/preview`
- `POST /api/admin/outreach/discovery/import` (`previewToken` plus selected `sourceRef` values)
- `POST /api/admin/outreach/prospects`
- `POST /api/admin/outreach/prospects/import` (`mode=preview` then `mode=commit` with `previewHash`)
- `PATCH /api/admin/outreach/prospects/:id`
- `POST /api/admin/outreach/prospects/:id/sponsor-invitation` (`action=issue|copy|revoke`; `packageId` is required for issue)
- `POST /api/admin/outreach/campaigns`
- `POST /api/admin/outreach/campaigns/:id/activate`
- `POST /api/admin/outreach/campaigns/:id/pause`
- `POST /api/admin/outreach/campaigns/:id/complete`
- `POST /api/admin/outreach/campaigns/:id/archive`
- `POST /api/admin/outreach/campaigns/:id/generate`
- `POST /api/public/outreach-preferences`
- `POST /api/public/outreach-preferences/unsubscribe`
- `POST /api/public/sponsor-invitation`
- `POST /api/public/sponsor-inquiries` (`sponsorInvitationToken` completes the consent-preserving conversion)

Message approval and delivery use the shared partner endpoints:

- `POST /api/admin/partners/followups/:id/review`
- `POST /api/admin/partners/followups/:id/send`

All mutations create admin audit records. Provider message IDs, attempts, failures, accepted timestamps, and bounded delivery-event histories remain in the partner operations ledger. Brevo hard bounce, invalid, blocked, spam/complaint, and unsubscribe events automatically suppress the prospect and dismiss every unsent message; webhook audits retain aggregate counts only.

Production uses `SANDFEST_PUBLIC_SITE_URL` plus `SANDFEST_OUTREACH_PREFERENCES_SECRET`. When the outreach-specific secret is empty, the existing 32+ character `SANDFEST_PARTNER_PORTAL_SECRET` is reused with a domain-separated signature. If the override is configured, the API and worker must receive the same value.

Sponsor invitations use `SANDFEST_SPONSOR_INVITATION_SECRET` and the same public site URL. The invitation secret also falls back to the partner-portal secret with domain-separated token framing. Configure the same 32+ character value on the API and worker when using the override. Production rejects non-HTTPS public URLs; invitation tokens expire after 30 days and cannot be issued for suppressed, incomplete, or already converted prospects.

Business discovery uses `OUTREACH_DISCOVERY_ENABLED`, `OUTREACH_DISCOVERY_PROVIDER`, `OUTREACH_DISCOVERY_SECRET`, `OUTREACH_DISCOVERY_USER_AGENT`, `OUTREACH_DISCOVERY_CONTACT`, `OUTREACH_DISCOVERY_NOMINATIM_URL`, `OUTREACH_DISCOVERY_OVERPASS_URLS`, and `OUTREACH_DISCOVERY_TIMEOUT_MS`. `OUTREACH_DISCOVERY_OVERPASS_URL` remains compatible for one endpoint. The production Blueprint enables the review-first OpenStreetMap adapter with `info@texassandfest.org` as the operator identity, configures three reviewed public instances, and requires `outreach_discovery` in the launch capability policy. Set a separate random 32+ character signing secret in Render, verify one bounded Port Aransas query during deployment acceptance, and move to contracted or self-hosted Nominatim/Overpass endpoints before sustained or high-volume discovery.

Run `npm run test:outreach-discovery:live` from the production API service shell after configuration. The acceptance command performs one bounded, read-only Port Aransas search and fails unless every returned candidate has a valid OpenStreetMap object link, license attribution, fetch timestamp, and in-radius distance. It does not call the import endpoint or mutate the outreach ledger.

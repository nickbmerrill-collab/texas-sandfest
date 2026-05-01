# Texas SandFest Platform Architecture

## Goal

Build Texas SandFest as a shared operating platform, not a one-off website. The same canonical data and workflow layer should power:

- Public web experience.
- Native iOS app.
- Staff/volunteer operations console.
- Sponsor, vendor, media, and nonprofit portals.
- Future Port A Local Co integration.

## Product Surfaces

### Public Web

Primary audience: guests, sponsors, vendors, media, volunteers, and local partners before the event.

Core jobs:

- Browse schedule, music, sculptors, activities, tickets, policies, accessibility, parking, shuttles, maps, and FAQs.
- Ask the AI concierge source-cited questions.
- Route to Eventeny or SandFest-owned forms for transactions.
- Buy GA/VIP tickets through Stripe Checkout or Apple Pay once live ticketing is approved.
- Promote sponsors and local partners.

### Native iOS App

Primary audience: on-site guests, staff, volunteers, and captains.

Core jobs:

- Offline-friendly schedule, maps, FAQs, accessibility routes, and policy answers.
- Push alerts for weather, traffic, gate queues, schedule changes, and safety notices.
- Volunteer check-in, reassignment, shift reminders, and captain contact.
- Incident capture for lost party, medical assist, ADA request, sanitation, vendor issue, security, and maintenance.
- AI concierge with cached approved answers and escalation to staff.

### Operations Console

Primary audience: event leadership, operations, volunteer coordinators, sponsor/vendor managers, and city partners.

Core jobs:

- Live beach zone status.
- Gate, shuttle, ADA, and crowd monitoring.
- Incident triage and assignment.
- Volunteer coverage.
- Sponsor deliverable tracking.
- Vendor approval/load-in/inspection status.
- Knowledge-base approvals and source ownership.

### Heyelab Admin Backend

Primary audience: SandFest admins and Heyelab operators.

Core jobs:

- Configure ticket pricing, Stripe Price IDs, VIP capacity, sale windows, and review gates.
- Configure sponsor package pricing, benefits, QuickBooks items, and payment links.
- Serve public app APIs from `api.<heyelab-domain>/sandfest`.
- Serve admin configuration UI from `sandfest-admin.<heyelab-domain>`.
- Keep public app data separate from finance/admin-only records.

### Port A Local Co

Primary audience: Port Aransas visitors before, during, and after SandFest.

Core jobs:

- Event discovery and trip planning.
- Local lodging, dining, shopping, ferry, parking, beach permit, and activity context.
- Offers and partner placements tied to verified local businesses.
- Year-round retention after SandFest.

## System Boundaries

### Canonical SandFest API

The API owns structured records:

- Event.
- Schedule item.
- Venue zone.
- Map marker.
- Policy.
- FAQ answer.
- Ticket type.
- Sponsor tier.
- Sponsor deliverable.
- Vendor application.
- Volunteer role.
- Shift.
- Incident.
- Organization/contact.
- Document/source.

For 100,000+ event visitors, public API reads must be CDN/edge-cacheable and must not depend on admin write paths. Payment, webhook, fulfillment, and QuickBooks writes must use durable storage and idempotent processing before launch.

### Eventeny

Use Eventeny for transactional functions where it is already in place:

- Tickets.
- Sponsor applications.
- Vendor applications.
- Possibly artist/applicant workflows.

Do not let Eventeny be the only source of operational truth. Mirror Eventeny identifiers/status into the SandFest platform and enrich with SandFest-specific assignments, owners, documents, and deadlines.

### Stripe

Use Stripe for SandFest-owned checkout when approved:

- General admission and VIP ticket checkout.
- Apple Pay through Stripe Checkout or native iOS payments.
- Sponsor deposits, Payment Links, or invoice payment flows after sponsor review.
- Refund, chargeback, and payout event capture for finance reconciliation.

Do not allow the browser or iOS app to choose trusted prices. The backend must validate product IDs, quantities, eligibility, and review-gated products before creating Checkout Sessions or PaymentIntents.

### Content Management

Every AI-answerable fact needs:

- Source.
- Owner.
- Last reviewed date.
- Effective date.
- Expiration date.
- Audience.
- Risk level.
- Escalation contact.

## First Data Domains

| Domain | Owned Records | Why It Matters |
| --- | --- | --- |
| Visitor | tickets, FAQs, maps, parking, ferry, accessibility, policies | Reduces guest confusion and staff interruption |
| Programming | schedule, music, kids, sculptor demos, awards | Powers web, app, alerts, and signage |
| Operations | zones, shifts, incidents, gates, shuttle status, weather | Makes live event decisions visible and assignable |
| Partners | sponsors, vendors, media, nonprofits | Converts loose relationships into accountable workflows |
| Commerce | ticket types, raffle, merchandise, sponsor packages, vendor fees | Reconciles revenue and deliverables |
| Destination | Port A Local Co listings, offers, lodging, dining, attractions | Turns SandFest traffic into local economic value |

## AI Rules

- AI can answer only from approved source records.
- AI answers cite source records and last-reviewed dates.
- AI escalates high-risk categories: medical, safety, legal/policy dispute, lost child/person, payments, accessibility accommodation conflict, media credentials, sponsor contract issue.
- AI logs unresolved question themes for content cleanup.
- AI should be available on web, iOS, SMS, and staff console through the same backend.

## Recommended Build Order

1. Canonical data model and ingestion pipeline.
2. Public content cleanup and source ownership.
3. AI concierge with source citations.
4. Operations console for zones, incidents, volunteers, and alerts.
5. Native iOS app backed by the same API.
6. Sponsor/vendor/volunteer lifecycle portals.
7. Port A Local Co integration.

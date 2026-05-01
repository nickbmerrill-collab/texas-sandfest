# Port A Local Co Integration Plan

## Objective

Make Texas SandFest a flagship event module inside Port A Local Co without copying messy page content or leaking internal operations data into the consumer destination app.

## Integration Boundary

Port A Local Co should consume curated SandFest API records:

- Event profile.
- Public schedule.
- Public map zones.
- Public policies.
- Ticket links.
- Sponsor/local partner placements.
- Parking, ferry, shuttle, beach permit guidance.
- Things to do before/after SandFest.
- Dining, lodging, shopping, and attraction recommendations tied to verified local listings.

It should not own:

- Volunteer private details.
- Sponsor invoices/contracts.
- Vendor internal approval documents.
- Incident logs.
- Staff assignments.
- Internal radio/ops plans.

## Shared Objects

| Object | SandFest Source | Port A Local Co Use |
| --- | --- | --- |
| Event | SandFest canonical event record | Destination event page |
| Schedule item | SandFest schedule | Trip itinerary, reminders |
| Venue zone | SandFest map | Visitor navigation |
| Policy | SandFest content OS | Guest guidance |
| Sponsor | Sponsor CRM public fields | Partner visibility |
| Local listing | Port A Local Co | Lodging, dining, shopping, things to do |
| Offer | Port A Local Co commerce | Event-adjacent local promotions |

## API Contract Direction

Use versioned public endpoints:

- `GET /api/public/events/texas-sandfest-2026`
- `GET /api/public/events/texas-sandfest-2026/schedule`
- `GET /api/public/events/texas-sandfest-2026/map`
- `GET /api/public/events/texas-sandfest-2026/policies`
- `GET /api/public/events/texas-sandfest-2026/partners`
- `GET /api/public/events/texas-sandfest-2026/local-guide`

Every response should include:

- `id`
- `updatedAt`
- `effectiveFrom`
- `effectiveUntil`
- `sourceId`
- `publicVisibility`

## Experience Ideas

- SandFest trip planner inside Port A Local Co.
- "Before you go" checklist for ferry, parking, wristbands, beach permit, accessibility, and pet policy.
- Local restaurant/lodging recommendations around shuttle/parking zones.
- Sponsor and local business trails.
- Push or SMS reminders for favorited schedule items.
- Post-event gallery and "come back to Port A" retention flow.

## Risks To Avoid

- Do not scrape SandFest pages into Port A Local Co directly.
- Do not let Port A Local Co display stale policy/ticket data without timestamps.
- Do not mix staff/incident data with public destination data.
- Do not duplicate sponsor records across systems without a stable shared ID.

## First Integration Milestone

Expose a read-only SandFest event module that Port A Local Co can render as a destination guide:

- Event overview.
- Dates and location.
- Public schedule.
- Parking/shuttle/ferry guidance.
- Public map.
- Tickets CTA.
- Local guide recommendations.
- Sponsor/local partner placements.

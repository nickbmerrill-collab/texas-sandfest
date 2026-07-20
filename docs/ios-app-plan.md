# Texas SandFest iOS App Plan

## Strategy

Build native SwiftUI, backed by the same SandFest API and canonical content model as the web platform.

The app should not be a web wrapper. Beach conditions make the native app valuable: unstable cell coverage, heat, glare, crowd movement, quick staff actions, and push notifications.

## App Modes

### Guest Mode

- Today view.
- Schedule by day and category.
- Offline map with beach markers, gates, restrooms, ADA routes, Guest Relations, Lost & Found, medical, music stage, vendors, food, and sponsor zones.
- AI concierge.
- Tickets/Eventeny handoff.
- Push alerts.
- Favorites and reminders.
- Accessibility help request.

### Admin Mode

Admin mode is staff-only and should eventually require role-based login.

- Command dashboard.
- Zone and volunteer coverage.
- Incident queue.
- Sponsor and vendor readiness.
- Finance and QuickBooks sync status.
- Integration setup and data pipeline health.

### Volunteer Mode

- Shift check-in.
- Assigned role and captain.
- Zone map.
- Reassignment notices.
- Missed shift/substitute workflow.
- Food voucher/wristband status.
- Quick incident/report button.

### Staff Mode

- Incident capture.
- Crowd/gate status.
- Volunteer roster by zone.
- ADA request queue.
- Vendor issue queue.
- Broadcast alerts.
- Offline draft queue when connectivity drops.

## First Release Scope

1. Static event guide cache:
   Schedule, maps, FAQs, policies, sponsor list, and accessibility info.

2. Ask Sandy:
   Source-cited AI concierge endpoint with cached fallback answers.

3. Alerts:
   Push notifications for weather, gate queues, schedule changes, parking/shuttle changes, and safety notices.

4. Volunteer basics:
   Check-in, shift card, captain contact, role instructions, and no-show/escalation flag.

5. Staff incident capture:
   Incident type, zone, marker, severity, notes, photo attachment, assigned owner, and sync status.

## Technical Shape

- SwiftUI app.
- Shared API client package.
- Local cache using SwiftData or SQLite.
- Push notifications via APNs.
- Public deep links for Today, exact schedule items, beach conditions,
  sculptors, Sandy, and tickets. Zone-specific and incident links remain
  disabled until their target data and native staff authorization are real.
- Background sync for content and unresolved incidents.
- TestFlight distribution for stakeholder review.

## API Requirements

- `GET /api/mobile/bootstrap`
- `GET /api/events/current`
- `GET /api/schedule?eventId=...`
- `GET /api/map-zones?eventId=...`
- `GET /api/policies?audience=guest`
- `POST /api/ai/ask`
- `POST /api/volunteers/check-in`
- `POST /api/incidents`
- `GET /api/public/alert`
- `POST /api/device-token`

## Offline Requirements

- App opens to cached guide if offline.
- AI shows cached canonical answers for common FAQs if live endpoint fails.
- Staff incident drafts queue locally until sync succeeds.
- Maps and key policies are cached before event week.
- Alerts display last known effective status with timestamp.
- Customer Today and Admin Command screens surface the active public alert from the same schema used by web.
- The bundled seed includes an inactive alert record so alert rendering works before API access is available.

## TestFlight Milestones

1. Internal Alpha:
   Guest guide, static map, schedule, AI prototype.

2. Ops Alpha:
   Volunteer shift cards and incident drafts.

3. Event Rehearsal:
   Push alerts, live sync, role-based access, staged beach-zone test.

4. Public Release Candidate:
   Guest mode polished, staff mode permissioned, analytics enabled.

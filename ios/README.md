# Texas SandFest iOS

Native SwiftUI app scaffold for the Texas SandFest platform.

## Generate project

```bash
cd ios
xcodegen generate
open TexasSandFest.xcodeproj
```

From the repository root, `npm run test:ios-xcode` selects an available iPhone simulator, runs the XCTest suite, and verifies an optimized simulator build with Swift warnings treated as errors. The committed project includes the test target, so XcodeGen is only needed after changing `project.yml`.

## Current screens

- Customer mode
  - Today
  - Schedule
  - Beach, with Live Beach and Sculptors views
  - Ask Sandy
  - Tickets
- Admin mode
  - Command
  - Incidents
  - Partners
  - Finance
  - Setup

## Build direction

The app should consume the same canonical SandFest API as the web platform. Guest mode gets the offline event guide, AI concierge, map, schedule, and alerts. Volunteer/staff mode gets check-in, captain instructions, zone status, and offline incident drafts.

## Public data refresh

`AppDataStore` loads the bundled seed immediately, then requests
`GET /api/public/bootstrap` when the app root appears. A validated response
updates only the public guide, schedule, zone metadata, and alert. The app
stores that privacy-minimized response in Application Support and restores it
on the next offline launch.

The cache is bound to the exact API origin and bundled event ID. A localhost
board response, a different annual event, malformed collections, duplicate
IDs, or an unexpected runtime mode is rejected rather than mixed into the app.
The richer sample schedule remains enabled only when the server explicitly
labels itself as `board_demo`; production uses the governed public schedule.

Staff-only sponsor, vendor, volunteer, finance, and zone-status collections are
not written into the public cache. They remain bundled demonstration data until
the native staff surface has an authenticated session and consumes the
role-governed app bootstrap.

## Ask Sandy

The native concierge posts bounded questions to `POST /api/public/concierge`
and renders the same source-cited, no-store response used by the visitor site.
Responses are rejected unless they contain a valid confidence value and one to
four safe internal or HTTPS sources. Network or validation failures retain the
offline guide and show the current event contact instead of generating a local
answer.

Today shortcuts route to Sandy, Tickets, a prefilled accessibility request, or
the server's emergency-escalation guidance. Beach and Sculptors share one
segmented hub so Sandy and Tickets remain direct tabs instead of falling under
iOS's automatic More navigation.

For deterministic simulator acceptance, launch with an API base and a question:

```bash
xcrun simctl launch booted com.portalcodex.texassandfest \
  -apiBase http://127.0.0.1:8806 \
  -conciergePrompt "What accessibility services are available?"
```

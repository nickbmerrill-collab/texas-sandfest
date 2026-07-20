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
  - Beach Map
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

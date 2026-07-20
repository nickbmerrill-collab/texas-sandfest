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

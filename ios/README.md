# Texas SandFest iOS

Native SwiftUI app scaffold for the Texas SandFest platform.

## Generate project

```bash
cd ios
xcodegen generate
open TexasSandFest.xcodeproj
```

From the repository root, `npm run test:ios-xcode` selects an available iPhone simulator, runs the XCTest suite, and verifies an optimized simulator build with Swift warnings treated as errors. The committed project includes the test target, so XcodeGen is only needed after changing `project.yml`.

`npm run test:ios-device` performs the separate local signing gate. Xcode uses
the committed development team and the signed-in Apple account to refresh
automatic provisioning, builds a Release app for iOS hardware, and verifies
the resulting signature. The command does not upload or submit the app.
`npm run test:ios-device-install` extends that proof by discovering an available
paired iOS device with Developer Mode enabled, registering it when necessary,
installing the signed app, and launching it. `SANDFEST_IOS_DEVICE_ID` can select
a specific CoreDevice identifier or hardware UDID when more than one qualifies.

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

The mode switch is intentionally available only when a validated public
bootstrap identifies the API as `board_demo` and that API is running on a
loopback origin. A normal, failed, or remote refresh leaves the app in Customer
mode. The `-startMode admin` simulator argument selects the board screen only
after that runtime check; it cannot grant access by itself.

Admin starts with bundled synthetic demonstration collections. In a supervised
loopback board session, the app replaces sponsor, vendor, volunteer, finance,
delegated-work, and Fleet data with authenticated snapshots from the same board
API used by the web operations workspace. Native production Admin remains
disabled until OIDC sign-in and role enforcement are wired.

The Partners tab opens the shared Work Board for authenticated board sessions.
Staff can create, reassign, prioritize, schedule, advance, complete, or cancel
governed staff, volunteer, and team tasks, and can prepare the same secure
assignment notice used by the web operations workspace. Every change is applied
only from an accepted API response and then refreshed from the shared ledger;
offline or unauthenticated requests never create local task state.

## Public deep links

The app registers the `sandfest:` URL scheme for public customer navigation.
Links can open Today, Tickets, Sandy, Live Beach, Sculptors, or a validated
schedule item. Opening a public link always returns the app to Customer mode;
Admin and incident destinations are rejected until native staff authentication
exists. Sandy questions are prefilled but never submitted automatically.

```text
sandfest://today
sandfest://schedule/sat-headliner
sandfest://tickets
sandfest://sandy?question=Where%20is%20ADA%20parking%3F
sandfest://island-conditions
sandfest://sculptors
```

The same parser accepts canonical `https://sandfest.heyelab.com` paths as
Universal Links. The target commits the `applinks:sandfest.heyelab.com`
Associated Domains entitlement, and the production web build generates the
matching extensionless `/.well-known/apple-app-site-association` file from the
shared allowlist. The live verifier rejects redirects, a non-JSON response, a
different app identity, extra routes, or an artifact that differs from the
deployed response. Canonical paths also retain browser fallbacks when the app is
not installed; Sandy questions are only prefilled and exact schedule links fall
back to the public schedule when their item is unavailable.

Set `SANDFEST_APPLE_APP_ID_PREFIX` to the signed app's 10-character Apple
Application Identifier Prefix before a production public build. This value can
differ from the Team ID and must be read from the Apple developer account for
the registered app. Device and TestFlight acceptance additionally require the
current Apple Developer Program License Agreement, a valid distribution
certificate and profile, the AASA file live over HTTPS without a redirect, and
a signed installed build. The custom `sandfest:` scheme works independently for
local and simulator acceptance.

## Build direction

The app consumes the same canonical SandFest API as the web platform. Guest
mode gets the offline event guide, AI concierge, map, schedule, and alerts. The
board Admin mode gets authenticated operations snapshots, shared Fleet state,
and server-authoritative incident command. Durable offline staff mutation sync
remains a production requirement after native OIDC and conflict handling exist.

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

Staff-only sponsor, vendor, volunteer, finance, and delegated-work collections
are never written into the public cache. The native app requests the
privacy-minimized, role-governed `GET /api/admin/app-bootstrap` snapshot only
after a loopback API proves it is the supervised `board_demo` runtime and a
local bearer token was supplied at launch. A missing, rejected, or malformed
snapshot leaves the bundled admin demonstration data in place. Remote and
production API origins remain visitor-only until native OIDC is implemented.

Fleet follows the same loopback-only board session boundary. Reads use
`GET /api/admin/fleet`; checkout and check-in changes use their role-governed
admin endpoints and update the screen only from the server response. Failed or
unauthenticated mutations never fall back to local state, so the device cannot
show a checkout that the shared fleet ledger did not record.

Incidents also use the authenticated board API as the only source of truth.
The native command screen reads the shared Island Conditions incident ledger,
creates operator incidents, records status and resolution changes, and creates
team dispatch assignments with optional email drafts. It does not expose a send
action, and failed or unauthenticated requests never create local incident or
dispatch state.

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

To open the explicitly labeled synthetic Admin demo, use the supervised local
board API and request the mode at launch:

```bash
xcrun simctl launch booted com.portalcodex.texassandfest \
  -apiBase http://127.0.0.1:8806 \
  -boardAdminToken board-demo-local-admin-token-change-me \
  -startMode admin
```

For deterministic deep-link acceptance at launch:

```bash
xcrun simctl launch booted com.portalcodex.texassandfest \
  -apiBase http://127.0.0.1:8806 \
  -deepLink sandfest://schedule/sat-headliner
```

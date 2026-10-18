# App privacy audit for version 1.0

Current native behavior reviewed before answering the App Store privacy
questionnaire:

- No advertising SDK, analytics SDK, or cross-app tracking SDK is linked.
- No visitor account or sign-in is required.
- The app stores favorites, reminders, ticket references, and approved public
  event content on the device.
- Ask Sandy sends the question the visitor chooses to submit to the public
  concierge service. The client requires a source-linked response and does not
  create a local profile.
- Ticket QR scanning is user initiated and uses the camera permission. The
  scanned ticket reference is stored locally for the visitor's use.
- Public content refreshes request event guide, alert, schedule, zone, and
  sculptor information from the configured SandFest API.
- Production staff/admin access is disabled. The loopback-only synthetic board
  mode is not a production access path.

The application and public API do not persist Ask Sandy question text. The
production visitor topology now serves the public experience and privacy policy
from `www.heyelab.com`, with the read-only visitor API at
`sandfest-api.heyelab.com` backed by the checked-in Cloudflare Worker. The live
Worker version has no storage bindings, and the concierge handler parses the
question, returns the governed answer synchronously, and writes no question
body to application storage or custom logs.

Cloudflare invocation logging is enabled for operational diagnosis. The Worker
does not configure a third-party log destination; the public policy therefore
conservatively discloses limited technical request metadata and caps routine
provider retention at 30 days. Cloudflare Workers Logs currently has a stricter
documented maximum of 7 days, so that deployment remains within the published
policy. Recheck the active Worker settings and any external log drain before a
future privacy-response update.

App Store Connect publication was verified on August 14, 2026. The public
product-page disclosure is `Data Not Linked to You` for one `Other Data` type,
used only for `App Functionality`. Advertising, marketing, analytics,
personalization, tracking, and other-purpose selections are not enabled.

The signed build `1.0.0 (3)` now includes `PrivacyInfo.xcprivacy` at the app
bundle root. It declares `NSPrivacyAccessedAPICategoryUserDefaults` with reason
`CA92.1` because favorites, reminders, passport state, and imported ticket
references use app-only preferences. Its collected-data entry mirrors the
published `Other Data` / `App Functionality` / not-linked / not-tracking
response. The archive gate validates those exact fields before accepting a
candidate.

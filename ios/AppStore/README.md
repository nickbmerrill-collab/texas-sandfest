# Texas SandFest App Store release lane

The submitted binary is `com.portalcodex.texassandfest` version `1.0.0` build
`1`, for Apple team `J2459M36QV`. Apple accepted follow-up build `2` at 4:33 PM Central on August
14, 2026, and finished processing it as **Ready to Submit** by 4:38 PM, but it
is not attached to the active review. Build `2` has a freshly verified signed archive, 32 passing native tests, the five-tab
Apple accessibility audit, adaptive staff layouts, the latest visitor-site
performance regression results, and a live simulator regression for the Ask
Sandy shortcut request lifecycle.

The local working tree is now build `3`. It is not uploaded or attached to
review. Its locally exported App Store IPA, 32 native tests, and five-tab Apple
accessibility audits pass on both iPhone 17 Pro and iPad Pro 13-inch simulators.
The exported IPA—not merely the development-signed intermediate archive—was
verified with production push, `get-task-allow=false`, and both www and legacy
Universal Link entitlements. Build `3`
also strengthens visitor text contrast, makes the UI audit work with iPadOS 26
floating tabs, and removes the deprecated full-screen-only iPad declaration
while explicitly supporting all four iPad orientations.
The release smoke lane also proves that a production `-startMode admin` request
cannot expose staff controls and that the bundled guide remains navigable across
all five visitor tabs when the API is deliberately unreachable.
The complete `ready:ios-app-store` command set passed again at 7:01 PM Central
on August 14, 2026, including the signed device build and a fresh build `3`
archive whose root privacy manifest matches the published App Store response.
It now also includes the deterministic offline iPhone/iPad audits and the AX3,
Increase Contrast, and Reduce Motion common-task evidence lanes.
Every component of that gate passed again by 8:56 PM after the www deep-link
hardening, including iPhone/iPad Bold Text, Reduce Transparency, Differentiate
Without Color, offline smoke, device signing, and a locally exported App Store
IPA. The palette gate now independently enforces at least 4.5:1 contrast for
every iOS 26 exact-label sampler exception.

App Store Connect currently shows version `1.0` as **Waiting for Review** with
build `1.0.0 (1)`. Submission `cdbaad8e-75a7-4cd3-be37-4c88b10797d2` was sent
by Nick Merrill on August 14, 2026 at 1:07 PM Central. The version is configured
to release automatically after App Review approval; the setting was saved and
verified again after a full App Store Connect page reload at 8:08 PM Central.
The review state was reverified live at 2:56 PM, 4:31 PM, 5:05 PM, 5:41 PM,
6:10 PM, 7:02 PM, 8:03 PM, 8:09 PM, and 8:56 PM Central; Apple shows no reviewer message
or action required. Further review-history audits at 8:16 PM and 8:20 PM
confirmed the same active state and no rejection or reviewer action. The latest live
release-configuration audit at 8:08 PM
confirmed that the app is public, free,
available in 175 countries or regions, and configured for the App Store software
tax category. Apple Silicon Mac and Apple Vision Pro availability are enabled.
Build `2` remains detached and **Ready to Submit** with a validated binary,
symbols, an explicit no-non-exempt-encryption declaration, and saved TestFlight
testing guidance for the Ask Sandy shortcut fix and visitor accessibility paths.
App Store Connect still lists only builds `1` and `2`; local build `3` has not
been uploaded.
The approved App Privacy responses are published. App Store Connect shows
`Data Not Linked to You` for one `Other Data` category used for app
functionality, with the policy URL on `www.heyelab.com`. This disclosure was
reverified live at 8:12 PM Central. App Accessibility still shows **Get
Started**, so no incomplete accessibility feature claim is published.

The submitted build `1.0.0 (1)` was reverified in App Store Connect at 8:16 PM
Central as a **Validated** 2.14 MB binary with symbols, arm64 support, production
push entitlement, and no non-exempt encryption. It supports iPhone and iPad with
minimum iOS 18.0. The listing remains Travel / Entertainment with a 13+ global
rating. The sole non-`None` frequency answer is **Infrequent** for alcohol,
tobacco, or drug references; that answer is supported by the bundled visitor
guidance about outside alcohol and the South Entrance beer-tent description, so
the read-only audit left the questionnaire unchanged.

Public App Store URLs:

- Support: `https://www.heyelab.com/texas-sandfest/support`
- Privacy: `https://www.heyelab.com/texas-sandfest/privacy`

## Automated gates

Run these from the repository root:

```bash
npm run test:ios-xcode
npm run test:ios-accessibility
npm run test:ios-accessibility:ipad
npm run test:ios-accessibility-labels
npm run test:ios-accessibility-labels:ipad
npm run test:ios-smoke
npm run test:ios-smoke:ipad
npm run test:ios-device
npm run test:ios-archive
npm run ios:app-store-screenshots
```

Run the complete signed-candidate gate with:

```bash
npm run ready:ios-app-store
```

The accessibility gates launch the visitor experience on iPhone and iPad
simulators and run Apple's audit across Today, Schedule, Beach, Sandy, and Tickets. On
iOS 26 it narrowly filters Apple's acknowledged standard-SwiftUI Dynamic Type
false positives and Liquid Glass contrast sampling at the system tab bar; text
clipping, contrast elsewhere, labels, actions, traits, and hit targets remain
failures.

The Accessibility Nutrition Label evidence gates exercise the full production
common-task inventory at AX3 text size with Increase Contrast and the actual
Reduce Motion system preference enabled. They currently pass on iPhone 17 Pro
and iPad Pro 13-inch simulators. This is evidence-in-progress, not a published
support claim: proficient manual VoiceOver, Bold Text, Reduce Transparency,
grayscale, Apple silicon Mac, and Apple Vision Pro checks remain outstanding.
See `ios/AppStore/accessibility-evidence.md`.

The smoke gates prove on iPhone and iPad simulators that a production launch
request for Admin still remains visitor-only, then take the bundled offline
guide through all five primary tabs with the public API deliberately
unreachable.

The archive gate creates and validates a temporary signed archive. It does not
upload or submit anything. It also requires `PrivacyInfo.xcprivacy` at the app
bundle root, verifies the app-only `UserDefaults` reason `CA92.1`, and checks
that the bundled collected-data declaration matches the published non-linked
Other Data app-functionality label.

After explicit confirmation, a new unique build may be uploaded with:

```bash
SANDFEST_CONFIRM_APP_STORE_UPLOAD=YES \
SANDFEST_CONFIRM_APP_STORE_VERSION=<candidate-version> \
SANDFEST_CONFIRM_APP_STORE_BUILD=<candidate-build> \
npm run ios:app-store-upload
```

The upload command archives the configured candidate, verifies its bundle,
version, build, and export-compliance identity against the explicit confirmation
values, and sends it to App Store Connect. It refuses to re-upload the submitted
`1.0.0 (1)` binary. Uploading a build never adds it to App Review or submits
review.

## Remaining publication gates

- The signed Application Identifier Prefix is `J2459M36QV`. The matching AASA
  document is live at `https://sandfest.heyelab.com/.well-known/apple-app-site-association`
  and was verified on 2026-08-14 as HTTP 200, `application/json`, and byte-for-byte
  identical to the checked-in release contract. Apple's association CDN also
  returns HTTP 200 with that exact document.
- A live browser audit found that the advertised legacy root routes such as
  `/tickets` return 404 while the owned
  `https://www.heyelab.com/texas-sandfest/app/...` routes return the visitor app.
  Build `3` now accepts the real www subpath, retains build `1`'s legacy links,
  and signs both associated domains. Do not deploy the expanded AASA contract or
  attach build `3` until a new candidate is explicitly approved; the submitted
  build remains unchanged.
- Do not cancel or replace the active review without explicit confirmation.
- Digital Services Act account information still shows **Complete Compliance
  Requirements** in App Store Connect. The live compliance dialog offers exactly **I'm a trader under the
  DSA** or **I'm not a trader under the DSA or I don't plan to distribute in the
  EU**. The Account Holder must make that legal classification; do not infer or
  publish it from the codebase. Apple states this choice is required to make the
  app available in the European Union. The dialog was closed without a selection.
- The Free Apps Agreement is active for all countries or regions through March
  23, 2027. The Paid Apps Agreement remains unsigned, and this release has no
  paid app price, in-app purchase, or subscription.
- Accessibility Nutrition Labels are not yet configured. Automated AX3,
  Increase Contrast, Reduce Motion, and offline common-task evidence now passes
  on iPhone and iPad, but `supportedClaims` remains empty and the questionnaire
  remains unchanged until the documented manual device evidence is complete.
- If Apple approves version `1.0`, App Store Connect is configured to release it
  automatically. Verify the public product page and country availability after
  Apple changes the submission state; do not treat approval alone as release proof.

The production app remains visitor-only until native OIDC and staff roles are
implemented. The synthetic board Admin mode is not a production access path.

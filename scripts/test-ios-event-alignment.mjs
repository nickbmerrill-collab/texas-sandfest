import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENTS,
  SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENT,
  SANDFEST_IOS_BUNDLE_ID,
  canonicalPublicWebRoute,
  normalizeAppleApplicationIdentifierPrefix,
  sandfestAppleApplicationIdentifier,
  sandfestAppleAppSiteAssociation,
  sandfestAppleAppSiteAssociationSafety
} from "../lib/public-deep-links.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

function readPlistJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const result = spawnSync("plutil", ["-convert", "json", "-o", "-", absolutePath], {
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `Could not parse ${relativePath} with plutil: ${result.stderr || result.stdout || "unknown error"}`
  );
  return JSON.parse(result.stdout);
}

const canonical = JSON.parse(await read("data/processed/app-bootstrap.json"));
const iosSeed = JSON.parse(await read("ios/TexasSandFest/Resources/sandfest-seed.json"));
const entitlements = await read("ios/TexasSandFest/TexasSandFest.entitlements");
const project = parseYaml(await read("ios/project.yml"));
const xcodeProject = await read("ios/TexasSandFest.xcodeproj/project.pbxproj");
const privacyManifest = readPlistJson("ios/TexasSandFest/Resources/PrivacyInfo.xcprivacy");
const appDataStore = await read("ios/TexasSandFest/AppDataStore.swift");
const rootView = await read("ios/TexasSandFest/RootView.swift");
const sandFestTheme = await read("ios/TexasSandFest/SandFestTheme.swift");
const nativeIncidents = await read("ios/TexasSandFest/OpsView.swift");
const nativeTasks = await read("ios/TexasSandFest/TaskBoardView.swift");
const releaseFacts = JSON.parse(await read("ios/AppStore/metadata/release-facts.json"));
const accessibilityEvidence = await read("ios/AppStore/accessibility-evidence.md");
const uploadScript = await read("scripts/upload-ios-app-store.mjs");
const archiveScript = await read("scripts/test-ios-archive.mjs");
const accessibilityRunner = await read("scripts/test-ios-accessibility.mjs");
const packageJson = JSON.parse(await read("package.json"));

function swiftThemeRGB(name) {
  const match = sandFestTheme.match(new RegExp(`static let ${name}\\s*=\\s*Color\\(red: ([0-9.]+), green: ([0-9.]+), blue: ([0-9.]+)\\)`));
  assert.ok(match, `Could not read the ${name} RGB token from SandFestTheme.swift.`);
  return match.slice(1).map(Number);
}

function relativeLuminance([red, green, blue]) {
  const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return (0.2126 * linear(red)) + (0.7152 * linear(green)) + (0.0722 * linear(blue));
}

function contrastRatio(left, right) {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const approvedTicketOptions = canonical.ticketOptions.filter((option) => {
  const reviewText = [option?.price, option?.detail].filter(Boolean).join(" ");
  return !/\b(?:tbd|review[- ]gated)\b/i.test(reviewText);
});
const expectedIOSSeed = { ...canonical, ticketOptions: approvedTicketOptions };

assert.deepEqual(
  iosSeed,
  expectedIOSSeed,
  "The bundled iOS seed must match the sanitized production payload. Run npm run ios:seed."
);
assert.ok(
  iosSeed.ticketOptions.every((option) => !/\b(?:tbd|review[- ]gated)\b/i.test([option?.price, option?.detail].filter(Boolean).join(" "))),
  "The bundled iOS seed must not expose placeholder or approval-gated ticket products."
);
const white = [1, 1, 1];
const foam = swiftThemeRGB("sandFestFoam");
for (const token of ["sandFestCoral", "sandFestGulf", "sandFestDeep", "sandFestSecondary", "lbNavy"]) {
  const foreground = swiftThemeRGB(token);
  assert.ok(contrastRatio(foreground, white) >= 4.5, `${token} must retain at least 4.5:1 contrast on white.`);
  assert.ok(contrastRatio(foreground, foam) >= 4.5, `${token} must retain at least 4.5:1 contrast on the visitor foam background.`);
}
assert.ok(contrastRatio(white, swiftThemeRGB("sandFestGulf")) >= 4.5, "White quick-action labels must retain at least 4.5:1 contrast on SandFest Gulf.");

assert.match(canonical.guide.startDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(canonical.guide.endDate, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(canonical.guide.timeZone, "The canonical guide must publish an event time zone.");
assert.deepEqual(canonical.schedule, [], "The canonical seed must not expose detailed 2027 programming before publication.");
assert.ok(canonical.guidance.length >= 6, "The canonical seed must include reviewed visitor guidance.");
assert.ok(canonical.guidance.every(item => item.sourceUrl.startsWith("https://www.texassandfest.org/") && item.ownerTeam && item.escalationContact), "Canonical visitor guidance must preserve source and ownership governance.");
assert.equal(appDataStore.includes("loaded.schedule.count < 10"), false, "The iOS app must not fill a governed public schedule with sample programming.");
assert.match(appDataStore, /guidance: publicPayload\.guidance \?\? bundled\.guidance/, "The iOS app must preserve validated public guidance across refreshes.");
assert.match(appDataStore, /runtime\?\.mode == "board_demo"/, "Sample iOS programming must require explicit board runtime metadata.");
assert.match(appDataStore, /async let sculptorRefresh: Void = refreshPublicSculptors/, "Native refresh must not serialize the sculptor request behind staff operations.");
assert.match(appDataStore, /async let operationsRefresh: Void = refreshBoardOperations/, "Native staff refresh must run independent operations data in parallel.");
assert.match(rootView, /AdminToolsView\(\)[\s\S]*Label\("Tools", systemImage: "wrench\.and\.screwdriver"\)/, "Staff navigation must expose one predictable Tools destination instead of overflowing the tab bar.");
assert.equal(rootView.includes('.tabItem { Label("Finance"'), false, "Finance must not create a sixth staff tab.");
assert.equal(rootView.includes('.tabItem { Label("Setup"'), false, "Setup must not create a sixth staff tab.");
assert.match(appDataStore, /struct NativeCreationReplayState/, "Native creation workflows must share stable replay identity state.");
assert.match(nativeIncidents, /forHTTPHeaderField: "Idempotency-Key"/, "Native incident creation must send its stable replay identity.");
assert.match(nativeIncidents, /creationReplay\.key\(for: fingerprint\)/, "Native incident creation must retain its replay identity until submitted details change.");
assert.match(nativeTasks, /forHTTPHeaderField: "Idempotency-Key"/, "Native task creation must send its stable replay identity.");
assert.match(nativeTasks, /allowedStatuses: \[200, 201\]/, "Native task creation must accept both first-create and replay responses.");
assert.match(nativeTasks, /creationReplay\.key\(for: submission\.creationFingerprint\)/, "Native task creation must rotate replay identity only when submitted details change.");
assert.equal(releaseFacts.appStoreState, "Waiting for Review", "The checked-in App Store handoff must match Apple's submitted state.");
assert.equal(releaseFacts.submissionConfirmed, true, "The checked-in App Store handoff must not describe the active review as a draft.");
assert.match(releaseFacts.submissionId, /^[0-9a-f-]{36}$/i, "The active App Review submission must retain its portal identifier.");
assert.equal(String(project.settings?.CURRENT_PROJECT_VERSION), releaseFacts.workingCandidate?.build, "XcodeGen must identify the recorded working candidate.");
assert.ok(Number(releaseFacts.nextCandidate?.build) > Number(releaseFacts.build), "The uploaded follow-up candidate must advance beyond the submitted build number.");
assert.equal(releaseFacts.nextCandidate?.attachedToReview, false, "The next candidate must stay detached while version 1.0 is under review.");
assert.equal(releaseFacts.nextCandidate?.uploadedToAppStoreConnect, true, "The next candidate must record its accepted App Store Connect upload.");
assert.equal(releaseFacts.nextCandidate?.uploadBlockedByActiveReview, false, "An active review must not be misreported as blocking a detached build upload.");
assert.ok(["uploaded_processing", "processed"].includes(releaseFacts.nextCandidate?.status), "The uploaded next candidate must retain an explicit processing state.");
assert.ok(Number(releaseFacts.workingCandidate?.build) > Number(releaseFacts.nextCandidate?.build), "The working candidate must advance beyond the uploaded follow-up build.");
assert.equal(releaseFacts.workingCandidate?.uploadedToAppStoreConnect, false, "The working candidate must not claim an upload before Apple accepts it.");
assert.equal(releaseFacts.workingCandidate?.attachedToReview, false, "The working candidate must remain detached from the active review.");
assert.equal(releaseFacts.workingCandidate?.uploadApproved, false, "The working candidate must require a fresh explicit upload approval.");
assert.equal(releaseFacts.workingCandidate?.signedArchiveVerified, true, "The working candidate must retain signed archive evidence.");
assert.equal(xcodeProject.includes(`CURRENT_PROJECT_VERSION = ${releaseFacts.workingCandidate?.build};`), true, "The committed Xcode project must match the working candidate build.");
assert.deepEqual(
  project.targets?.TexasSandFest?.resources,
  ["TexasSandFest/Resources"],
  "XcodeGen must copy the app resource directory containing PrivacyInfo.xcprivacy."
);
assert.equal(
  [...xcodeProject.matchAll(/PrivacyInfo\.xcprivacy in Resources/g)].length,
  2,
  "The committed Xcode project must define and embed PrivacyInfo.xcprivacy exactly once."
);
assert.match(
  xcodeProject,
  /path = PrivacyInfo\.xcprivacy;/,
  "The committed Xcode project must retain the privacy manifest file reference."
);
const userDefaultsPrivacyDeclaration = privacyManifest.NSPrivacyAccessedAPITypes?.find(item => (
  item.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults"
));
assert.deepEqual(
  userDefaultsPrivacyDeclaration?.NSPrivacyAccessedAPITypeReasons,
  ["CA92.1"],
  "The source privacy manifest must declare the app-only UserDefaults reason CA92.1."
);
const otherDataPrivacyDeclaration = privacyManifest.NSPrivacyCollectedDataTypes?.find(item => (
  item.NSPrivacyCollectedDataType === "NSPrivacyCollectedDataTypeOtherDataTypes"
));
assert.equal(privacyManifest.NSPrivacyTracking, false, "The source privacy manifest must not claim tracking.");
assert.deepEqual(privacyManifest.NSPrivacyTrackingDomains, [], "The source privacy manifest must not declare tracking domains.");
assert.equal(otherDataPrivacyDeclaration?.NSPrivacyCollectedDataTypeLinked, false, "Other Data must remain unlinked to identity.");
assert.equal(otherDataPrivacyDeclaration?.NSPrivacyCollectedDataTypeTracking, false, "Other Data must not be used for tracking.");
assert.deepEqual(
  otherDataPrivacyDeclaration?.NSPrivacyCollectedDataTypePurposes,
  ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  "Other Data must remain limited to app functionality."
);
assert.equal(releaseFacts.appPrivacy?.published, true, "The App Store privacy response must remain recorded as published.");
assert.deepEqual(releaseFacts.appPrivacy?.dataTypes, ["Other Data"], "The portal disclosure must match the manifest data type.");
assert.deepEqual(releaseFacts.appPrivacy?.purposes, ["App Functionality"], "The portal disclosure must match the manifest purpose.");
assert.equal(releaseFacts.appPrivacy?.linkedToIdentity, false, "The portal disclosure must keep Other Data unlinked.");
assert.equal(releaseFacts.appPrivacy?.tracking, false, "The portal disclosure must not claim tracking.");
assert.deepEqual(
  [releaseFacts.appInformation?.primaryCategory, releaseFacts.appInformation?.secondaryCategory],
  ["Travel", "Entertainment"],
  "The release handoff must preserve the verified App Store categories."
);
assert.equal(releaseFacts.ageRating?.global, "13+", "The release handoff must preserve Apple's calculated global age rating.");
assert.equal(releaseFacts.ageRating?.questionnaire?.alcoholTobaccoOrDrugReferences, "Infrequent", "The age-rating handoff must retain the truthful alcohol-reference response.");
assert.equal(releaseFacts.ageRating?.portalQuestionnaireLeftUnchanged, true, "A read-only age-rating audit must not imply that the questionnaire was edited.");
assert.ok(
  iosSeed.guidance.some(item => /outside alcohol/i.test(item.answer || "")),
  "The bundled visitor guidance must retain evidence supporting the infrequent alcohol-reference rating."
);
assert.ok(
  iosSeed.zones.some(item => /beer tent/i.test(item.summary || "")),
  "The bundled venue guidance must retain evidence supporting the infrequent alcohol-reference rating."
);
assert.equal(releaseFacts.submittedBuildMetadata?.binaryState, "Validated", "The submitted App Store binary must retain its verified binary state.");
assert.equal(releaseFacts.submittedBuildMetadata?.includesSymbols, true, "The submitted App Store binary must retain its verified symbols evidence.");
assert.equal(releaseFacts.submittedBuildMetadata?.usesNonExemptEncryption, false, "The submitted App Store binary must retain its verified encryption declaration.");
assert.deepEqual(releaseFacts.submittedBuildMetadata?.deviceFamily, ["iPhone", "iPad"], "The submitted binary must retain its verified device families.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.portalAction, "Get Started", "The handoff must retain the untouched App Accessibility portal state.");
assert.equal(releaseFacts.digitalServicesAct?.status, "notConfigured", "The handoff must not imply that an Account Holder DSA decision was made.");
assert.equal(releaseFacts.digitalServicesAct?.selectionMade, false, "The DSA dialog must remain unselected until the Account Holder decides.");
assert.deepEqual(releaseFacts.digitalServicesAct?.portalChoices, [
  "I'm a trader under the DSA",
  "I'm not a trader under the DSA or I don't plan to distribute in the EU"
], "The handoff must preserve the exact legal choices shown by Apple.");
assert.equal(releaseFacts.appStoreAgreements?.freeApps?.status, "Active", "A free App Store release requires the active Free Apps Agreement evidence.");
assert.equal(releaseFacts.appStoreAgreements?.paidApps?.currentReleaseUsesPaidFeatures, false, "The release handoff must not imply that paid functionality is configured.");
assert.equal(releaseFacts.releaseMethod, "automatic_after_approval", "The release handoff must match the saved automatic App Store release setting.");
assert.equal(releaseFacts.releaseConfiguration?.automaticReleaseAfterReview, true, "Approved build 1 must remain configured for automatic release.");
assert.equal(releaseFacts.releaseConfiguration?.manualReleaseRequired, false, "The handoff must not retain a stale manual-release blocker.");
assert.equal(releaseFacts.workingCandidate?.privacyManifest?.embeddedAtAppBundleRoot, true, "The working candidate must retain archive-level manifest evidence.");
assert.equal(releaseFacts.workingCandidate?.privacyManifest?.archiveGatePassed, true, "The working candidate must retain a passing privacy archive gate.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.status, "evidence_in_progress", "Accessibility label work must remain evidence-only until every common task is proven.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.published, false, "Accessibility Nutrition Labels must not claim publication before portal proof exists.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.portalQuestionnaireLeftUnchanged, true, "The accessibility questionnaire must remain unchanged while evidence is incomplete.");
assert.deepEqual(releaseFacts.accessibilityNutritionLabels?.supportedClaims, [], "No accessibility feature may be claimed before the remaining manual device checks pass.");
assert.match(accessibilityEvidence, /supportedClaims`: `\[\]`/, "The evidence handoff must explicitly publish no current accessibility claims.");
assert.match(accessibilityEvidence, /Proficient manual VoiceOver testing/, "The evidence handoff must preserve the manual VoiceOver blocker.");
assert.match(accessibilityEvidence, /Bold Text enabled through the simulator's real accessibility preference/, "The evidence handoff must record automated Bold Text coverage.");
assert.match(accessibilityEvidence, /Grayscale testing on physical hardware/, "The evidence handoff must preserve the manual grayscale blocker where the simulator cannot expose Color Filters.");
assert.match(accessibilityRunner, /accessibility-extra-large/, "The nutrition-label lane must test AX3 Larger Text.");
assert.match(accessibilityRunner, /increase_contrast[\s\S]*enabled/, "The nutrition-label lane must enable Increase Contrast.");
assert.match(accessibilityRunner, /ReduceMotionEnabled[\s\S]*true/, "The nutrition-label lane must enable the real simulator Reduce Motion preference.");
assert.match(accessibilityRunner, /EnhancedTextLegibilityEnabled/, "The display-setting lane must enable the real Bold Text preference.");
assert.match(accessibilityRunner, /EnhancedBackgroundContrastEnabled/, "The display-setting lane must enable the real Reduce Transparency preference.");
assert.match(accessibilityRunner, /DifferentiateWithoutColor/, "The display-setting lane must enable the real no-color preference.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.automatedEvidence?.boldTextEnvironmentVerified, true, "The release handoff must retain passing Bold Text evidence.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.automatedEvidence?.reduceTransparencyEnvironmentVerified, true, "The release handoff must retain passing Reduce Transparency evidence.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.automatedEvidence?.differentiateWithoutColorEnvironmentVerified, true, "The release handoff must retain passing Differentiate Without Color evidence.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.manualEvidenceOutstanding?.includes("bold_text_and_reduce_transparency"), false, "Passing automated display-setting evidence must clear its prior manual blocker.");
assert.equal(releaseFacts.accessibilityNutritionLabels?.manualEvidenceOutstanding?.includes("grayscale_without_color_alone"), true, "Grayscale must remain explicit manual evidence while the simulator cannot activate Color Filters.");
assert.match(packageJson.scripts?.["ready:ios-app-store"] || "", /test:ios-accessibility-labels/, "The signed-candidate gate must include the iPhone accessibility-label evidence lane.");
assert.match(packageJson.scripts?.["ready:ios-app-store"] || "", /test:ios-accessibility-labels:ipad/, "The signed-candidate gate must include the iPad accessibility-label evidence lane.");
assert.match(packageJson.scripts?.["ready:ios-app-store"] || "", /test:ios-accessibility-display/, "The signed-candidate gate must include the iPhone accessibility display-setting lane.");
assert.match(packageJson.scripts?.["ready:ios-app-store"] || "", /test:ios-accessibility-display:ipad/, "The signed-candidate gate must include the iPad accessibility display-setting lane.");
assert.match(packageJson.scripts?.["build:surfaces"] || "", /test:admin-artifact/, "The production surface gate must execute the compiled admin artifact smoke test.");
assert.equal(releaseFacts.webProductionReadiness?.compiledAdminArtifactSmokePassed, true, "The release handoff must retain compiled admin artifact evidence.");
assert.equal(releaseFacts.webProductionReadiness?.adminModuleEvaluationDeadlockRegressionCovered, true, "The release handoff must retain the admin module-evaluation regression result.");
assert.equal(releaseFacts.webProductionReadiness?.publishedToLiveSite, false, "Local production-artifact evidence must not be misreported as a live website deployment.");
assert.match(uploadScript, /SANDFEST_CONFIRM_APP_STORE_VERSION/, "App Store uploads must confirm the exact candidate version.");
assert.match(uploadScript, /SANDFEST_CONFIRM_APP_STORE_BUILD/, "App Store uploads must confirm the exact candidate build.");
assert.match(uploadScript, /Refusing to re-upload submitted build/, "App Store uploads must fail closed for the active submitted binary.");
assert.match(archiveScript, /applinks:www\.heyelab\.com/, "The signed archive gate must verify the canonical www associated domain.");
assert.match(archiveScript, /applinks:sandfest\.heyelab\.com/, "The signed archive gate must preserve the build-1-compatible associated domain.");
assert.match(archiveScript, /signedEntitlements\["aps-environment"\] !== "production"/, "The signed archive gate must verify production push identity.");

const timeline = await read("ios/TexasSandFest/LiveTimeline.swift");
const schedule = await read("ios/TexasSandFest/ScheduleView.swift");
const liveBeach = await read("ios/TexasSandFest/LiveBeachView.swift");
const tickets = await read("ios/TexasSandFest/TicketsView.swift");
const concierge = await read("ios/TexasSandFest/ConciergeView.swift");
const lineup = await read("ios/TexasSandFest/LineupView.swift");
const ticketStore = await read("ios/TexasSandFest/UserTicketsStore.swift");
const models = await read("ios/TexasSandFest/Models.swift");
const dateSensitiveSource = [timeline, schedule, tickets, ticketStore, models].join("\n");

for (const retiredLiteral of [
  "texas-sandfest-2026",
  "April 17-19, 2026",
  "Apr 17-19",
  "Apr 17–19",
  "TEXAS SANDFEST 2026",
  "comps.year = 2026",
  "fest.year = 2026"
]) {
  assert.equal(
    dateSensitiveSource.includes(retiredLiteral),
    false,
    `iOS event logic still contains retired literal: ${retiredLiteral}`
  );
}

assert.match(timeline, /localDate\(guide\.startDate/);
assert.match(timeline, /localDate\(guide\.endDate/);
assert.match(schedule, /LiveTimeline\.date\(for: item, guide: dataStore\.payload\.guide\)/);
assert.ok(
  schedule.includes(String.raw`.accessibilityLabel(isStarred ? "Remove \(item.title) from My Schedule" : "Add \(item.title) to My Schedule")`),
  "Schedule favorites must expose a meaningful VoiceOver action."
);
assert.match(liveBeach, /@Environment\(\\\.accessibilityReduceMotion\)/, "Live Beach must observe the system Reduce Motion preference.");
assert.match(liveBeach, /paused: reduceMotion/, "Live Beach timelines must stop continuous motion when Reduce Motion is enabled.");
for (const [label, source] of [["Concierge", concierge], ["Schedule", schedule], ["Lineup", lineup]]) {
  assert.match(source, /@Environment\(\\\.accessibilityReduceMotion\)/, `${label} must observe the system Reduce Motion preference.`);
}
assert.match(schedule, /updateWithOptionalAnimation/, "Schedule state changes must route through the Reduce Motion-aware animation helper.");
assert.match(tickets, /\.fullScreenCover\(isPresented: \$scannerVisible\)/, "Ticket QR scanning must use an accessible full-screen camera presentation on iPad.");

const verificationPrefix = "ABCDE12345";
const verificationApplicationIdentifier = sandfestAppleApplicationIdentifier(verificationPrefix);
const association = sandfestAppleAppSiteAssociation(verificationPrefix);
assert.equal(normalizeAppleApplicationIdentifierPrefix(" abcde12345 "), verificationPrefix);
assert.equal(verificationApplicationIdentifier, `${verificationPrefix}.${SANDFEST_IOS_BUNDLE_ID}`);
assert.throws(() => normalizeAppleApplicationIdentifierPrefix("TEAM-ID"), /10-character/);
assert.deepEqual(sandfestAppleAppSiteAssociationSafety(association, verificationApplicationIdentifier), { ready: true, errors: [] });
assert.equal(entitlements.includes(`<string>${SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENT}</string>`), true);
for (const entitlement of SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENTS) {
  assert.equal(entitlements.includes(`<string>${entitlement}</string>`), true, `The app must sign the verified associated domain ${entitlement}.`);
}
assert.deepEqual(
  project.targets?.TexasSandFest?.entitlements?.properties?.["com.apple.developer.associated-domains"],
  SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENTS
);
const developmentTeam = String(project.settings?.DEVELOPMENT_TEAM || "").trim();
assert.match(developmentTeam, /^[A-Z0-9]{10}$/, "XcodeGen must declare a valid Apple development team.");
assert.equal(
  xcodeProject.includes(`DEVELOPMENT_TEAM = ${developmentTeam};`),
  true,
  "The committed Xcode project must use the XcodeGen development team."
);

assert.deepEqual(canonicalPublicWebRoute("/tickets"), {
  hash: "#tickets"
});
assert.deepEqual(canonicalPublicWebRoute("/texas-sandfest/schedule/fri-gates", { basePath: "/texas-sandfest/" }), {
  hash: "#schedule-fri-gates",
  scheduleItemID: "fri-gates"
});
assert.deepEqual(canonicalPublicWebRoute("/texas-sandfest/app/tickets", { basePath: "/texas-sandfest/app/" }), {
  hash: "#tickets"
});
assert.deepEqual(canonicalPublicWebRoute("/sandy", { search: "?question=Where%20is%20ADA%20parking%3F" }), {
  hash: "#concierge",
  question: "Where is ADA parking?"
});
assert.deepEqual(canonicalPublicWebRoute("/sculptors"), {
  hash: "#sculptors-showcase"
});
assert.equal(sandfestAppleAppSiteAssociationSafety({
  ...association,
  applinks: { ...association.applinks, apps: [] }
}, verificationApplicationIdentifier).ready, false);
assert.equal(canonicalPublicWebRoute("/admin"), null);
assert.equal(canonicalPublicWebRoute("/schedule/private/item"), null);
assert.equal(canonicalPublicWebRoute("/schedule/fri-gates%2Fprivate"), null);

console.log(`iOS event and Universal Link alignment: ${canonical.guide.id} · ${canonical.guide.dateRange} · ${verificationApplicationIdentifier}`);

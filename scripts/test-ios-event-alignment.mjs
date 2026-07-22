import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
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

const canonical = JSON.parse(await read("data/processed/app-bootstrap.json"));
const iosSeed = JSON.parse(await read("ios/TexasSandFest/Resources/sandfest-seed.json"));
const entitlements = await read("ios/TexasSandFest/TexasSandFest.entitlements");
const project = parseYaml(await read("ios/project.yml"));
const xcodeProject = await read("ios/TexasSandFest.xcodeproj/project.pbxproj");
const appDataStore = await read("ios/TexasSandFest/AppDataStore.swift");

assert.deepEqual(
  iosSeed,
  canonical,
  "The bundled iOS seed must exactly match data/processed/app-bootstrap.json. Run npm run ios:seed."
);

assert.match(canonical.guide.startDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(canonical.guide.endDate, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(canonical.guide.timeZone, "The canonical guide must publish an event time zone.");
assert.deepEqual(canonical.schedule, [], "The canonical seed must not expose detailed 2027 programming before publication.");
assert.ok(canonical.guidance.length >= 6, "The canonical seed must include reviewed visitor guidance.");
assert.ok(canonical.guidance.every(item => item.sourceUrl.startsWith("https://www.texassandfest.org/") && item.ownerTeam && item.escalationContact), "Canonical visitor guidance must preserve source and ownership governance.");
assert.equal(appDataStore.includes("loaded.schedule.count < 10"), false, "The iOS app must not fill a governed public schedule with sample programming.");
assert.match(appDataStore, /guidance: publicPayload\.guidance \?\? bundled\.guidance/, "The iOS app must preserve validated public guidance across refreshes.");
assert.match(appDataStore, /runtime\?\.mode == "board_demo"/, "Sample iOS programming must require explicit board runtime metadata.");

const timeline = await read("ios/TexasSandFest/LiveTimeline.swift");
const schedule = await read("ios/TexasSandFest/ScheduleView.swift");
const tickets = await read("ios/TexasSandFest/TicketsView.swift");
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

const verificationPrefix = "ABCDE12345";
const verificationApplicationIdentifier = sandfestAppleApplicationIdentifier(verificationPrefix);
const association = sandfestAppleAppSiteAssociation(verificationPrefix);
assert.equal(normalizeAppleApplicationIdentifierPrefix(" abcde12345 "), verificationPrefix);
assert.equal(verificationApplicationIdentifier, `${verificationPrefix}.${SANDFEST_IOS_BUNDLE_ID}`);
assert.throws(() => normalizeAppleApplicationIdentifierPrefix("TEAM-ID"), /10-character/);
assert.deepEqual(sandfestAppleAppSiteAssociationSafety(association, verificationApplicationIdentifier), { ready: true, errors: [] });
assert.equal(entitlements.includes(`<string>${SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENT}</string>`), true);
assert.deepEqual(
  project.targets?.TexasSandFest?.entitlements?.properties?.["com.apple.developer.associated-domains"],
  [SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENT]
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

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

assert.deepEqual(
  iosSeed,
  canonical,
  "The bundled iOS seed must exactly match data/processed/app-bootstrap.json. Run npm run ios:seed."
);

assert.match(canonical.guide.startDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(canonical.guide.endDate, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(canonical.guide.timeZone, "The canonical guide must publish an event time zone.");

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

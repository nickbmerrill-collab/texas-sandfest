#!/usr/bin/env node
import {
  discoverOutreachBusinesses,
  outreachDiscoveryConfig
} from "../lib/outreach-discovery.mjs";

const location = String(process.env.OUTREACH_DISCOVERY_TEST_LOCATION || "Port Aransas, TX 78373").trim();
const radiusMiles = Number(process.env.OUTREACH_DISCOVERY_TEST_RADIUS_MILES || 3);
const limit = Number(process.env.OUTREACH_DISCOVERY_TEST_LIMIT || 5);
const categories = String(process.env.OUTREACH_DISCOVERY_TEST_CATEGORIES || "lodging")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const config = outreachDiscoveryConfig(process.env, { production: true });
if (!config.ready) throw new Error(`Live outreach discovery is not ready: ${config.reason}`);
if (config.provider !== "openstreetmap") throw new Error("Live outreach discovery acceptance requires the OpenStreetMap provider.");

const result = await discoverOutreachBusinesses({
  location,
  radiusMiles,
  limit,
  categories
}, { config });

if (!result.ok || !result.candidates?.length) {
  throw new Error("Live outreach discovery returned no source-attributed candidates.");
}
if (!result.provider?.endpointHost || !Number.isInteger(result.provider.attemptCount) || result.provider.attemptCount < 1) {
  throw new Error("Live outreach discovery did not report its bounded provider attempt.");
}

const invalid = result.candidates.find(candidate => {
  const sourceUrl = String(candidate.sourceUrl || "");
  return !/^(node|way|relation)\/\d+$/.test(String(candidate.sourceRef || ""))
    || !sourceUrl.startsWith("https://www.openstreetmap.org/")
    || !String(candidate.sourceLicense || "").includes("OpenStreetMap")
    || !Number.isFinite(new Date(candidate.sourceFetchedAt).getTime())
    || !Number.isFinite(candidate.distanceMiles)
    || candidate.distanceMiles > radiusMiles + 0.2;
});
if (invalid) throw new Error(`Live outreach discovery returned invalid provenance for ${invalid.organizationName || invalid.sourceRef}.`);

console.log(JSON.stringify({
  ok: true,
  provider: config.provider,
  endpointHost: result.provider.endpointHost,
  attemptCount: result.provider.attemptCount,
  failedEndpointHosts: result.provider.failedEndpointHosts,
  readOnly: true,
  resolvedLocation: result.query.resolvedLocation,
  radiusMiles: result.query.radiusMiles,
  categories: result.query.categories,
  candidateCount: result.candidates.length,
  candidates: result.candidates.map(candidate => ({
    organizationName: candidate.organizationName,
    distanceMiles: candidate.distanceMiles,
    website: candidate.website || null,
    sourceUrl: candidate.sourceUrl,
    sourceFetchedAt: candidate.sourceFetchedAt
  }))
}, null, 2));

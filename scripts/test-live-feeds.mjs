#!/usr/bin/env node

import {
  fetchPortAransasFerryStatus,
  fetchPortAransasWeather
} from "../lib/island-conditions.mjs";

const checkedAt = new Date();
const allowedFerryStates = new Set(["live", "partial", "service_interruption", "unavailable"]);
let failed = false;

const [weatherResult, ferryResult] = await Promise.allSettled([
  fetchPortAransasWeather({ now: checkedAt.toISOString() }),
  fetchPortAransasFerryStatus({ now: checkedAt.toISOString() })
]);

console.log("\n=== Live Island Conditions sources ===\n");

if (weatherResult.status === "rejected") {
  failed = true;
  console.error(`FAIL NWS: ${weatherResult.reason?.message || weatherResult.reason}`);
} else {
  const weather = weatherResult.value;
  const validUntilMs = new Date(weather.validUntil).getTime();
  const current = weather.status === "live" && Number.isFinite(validUntilMs) && validUntilMs > checkedAt.getTime();
  failed ||= !current;
  console.log(`${current ? "PASS" : "FAIL"} NWS: ${weather.temperatureF ?? "--"} F, ${weather.shortForecast || weather.status}, valid until ${weather.validUntil || "missing"}`);
}

if (ferryResult.status === "rejected") {
  failed = true;
  console.error(`FAIL TxDOT: ${ferryResult.reason?.message || ferryResult.reason}`);
} else {
  const ferry = ferryResult.value;
  const connected = allowedFerryStates.has(ferry.status)
    && Boolean(ferry.checkedAt)
    && Array.isArray(ferry.directions)
    && ferry.directions.length === 2;
  failed ||= !connected;
  console.log(`${connected ? "PASS" : "FAIL"} TxDOT: ${ferry.status}, max wait ${ferry.estimatedWaitMinutes ?? "unavailable"} min`);
  for (const direction of ferry.directions || []) {
    console.log(`  ${direction.label}: ${direction.status}, ${direction.estimatedWaitMinutes ?? "unavailable"} min`);
  }
}

if (failed) {
  console.error("\nLive source smoke failed. Island Conditions must not be presented as current until the source recovers.\n");
  process.exitCode = 1;
} else {
  console.log("\nLive source smoke passed.\n");
}

#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  deploymentVerificationConfig,
  verifyProductionApi
} from "../lib/deployment-verifier.mjs";
import {
  READ_ONLY_LAUNCH_ENV,
  readOnlyLaunchSetting
} from "../lib/read-only-launch-policy.mjs";
import {
  READ_ONLY_SKIPPED_CHECKS,
  verifyReadOnlyLaunch
} from "../lib/read-only-launch-verifier.mjs";

const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF"
]);

function turnstileSiteKeyFailure(value) {
  const siteKey = String(value || "").trim();
  if (!siteKey) return "VITE_SANDFEST_TURNSTILE_SITE_KEY is required for Vercel production releases.";
  if (siteKey.length < 20 || !/^[A-Za-z0-9_-]+$/.test(siteKey)) {
    return "VITE_SANDFEST_TURNSTILE_SITE_KEY is not a valid Turnstile site key.";
  }
  if (TURNSTILE_TEST_SITE_KEYS.has(siteKey)) {
    return "Vercel production releases reject Cloudflare Turnstile test site keys.";
  }
  return null;
}

function repositoryVercelConfig() {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../vercel.json", import.meta.url)), "utf8"));
}

// Opt-in read-only public launch (SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE=read_only). It verifies
// only what the read-only public bridge claims and fails closed on everything else. The full
// production gate below is unchanged and remains the default.
async function verifyReadOnlyRelease({ env, fetchImpl, vercelConfig }) {
  const apiUrl = env.SANDFEST_LIVE_API_URL || "https://sandfest-api.heyelab.com/";
  const api = await verifyReadOnlyLaunch({
    apiUrl,
    expectedEventId: env.SANDFEST_LIVE_EXPECTED_EVENT_ID || undefined,
    vercelConfig: vercelConfig || repositoryVercelConfig(),
    fetchImpl
  });
  const failures = api.ok ? [] : [`Read-only launch contract failed ${api.summary.failed} check(s).`];
  return {
    ok: failures.length === 0,
    skipped: false,
    mode: "read_only",
    failures,
    config: { publicUrl: env.SANDFEST_LIVE_PUBLIC_URL || "https://sandfest.heyelab.com/", apiUrl },
    api,
    skippedChecks: READ_ONLY_SKIPPED_CHECKS
  };
}

export async function verifyVercelRelease({
  env = process.env,
  fetchImpl = globalThis.fetch,
  vercelConfig
} = {}) {
  if (env.VERCEL !== "1") {
    return { ok: true, skipped: true, reason: "outside Vercel" };
  }
  if (String(env.VERCEL_ENV || "").trim().toLowerCase() !== "production") {
    return { ok: true, skipped: true, reason: "non-production Vercel deployment" };
  }

  const launchMode = readOnlyLaunchSetting(env);
  if (launchMode.error) {
    return { ok: false, skipped: false, failures: [launchMode.error], config: null, api: null };
  }
  if (launchMode.enabled) return verifyReadOnlyRelease({ env, fetchImpl, vercelConfig });

  const failures = [];
  const turnstileFailure = turnstileSiteKeyFailure(env.VITE_SANDFEST_TURNSTILE_SITE_KEY);
  if (turnstileFailure) failures.push(turnstileFailure);

  const config = deploymentVerificationConfig({
    ...env,
    SANDFEST_LIVE_PUBLIC_URL: env.SANDFEST_LIVE_PUBLIC_URL || "https://sandfest.heyelab.com/",
    SANDFEST_LIVE_API_URL: env.SANDFEST_LIVE_API_URL || "https://sandfest-api.heyelab.com/",
    SANDFEST_LIVE_ADMIN_URL: env.SANDFEST_LIVE_ADMIN_URL || "https://sandfest-admin.heyelab.com/"
  });
  if (!config.ready) failures.push(config.reason);

  if (failures.length) {
    return { ok: false, skipped: false, failures, config, api: null };
  }

  const api = await verifyProductionApi({ config, fetchImpl });
  if (!api.ok) failures.push(`Production API contract failed ${api.summary.failed} check(s).`);
  return { ok: failures.length === 0, skipped: false, failures, config, api };
}

function announceReadOnlyLaunch(result) {
  const log = result.ok ? console.warn : console.error;
  log("");
  log("==================================================================");
  log(` READ-ONLY PUBLIC LAUNCH (${READ_ONLY_LAUNCH_ENV}=read_only)`);
  log(" This is NOT a full production release. The visitor site is published");
  log(" against the read-only bridge: no checkout, intake, staff, or admin.");
  log(" Full-mode checks SKIPPED in this mode:");
  for (const item of result.skippedChecks) log(`   - ${item}`);
  log(" Exit this mode (unset the variable) once the full backend is live.");
  log("==================================================================");
  log("");
}

async function main() {
  const result = await verifyVercelRelease();
  if (result.skipped) {
    console.log(`Vercel production release gate skipped for ${result.reason}.`);
    return;
  }
  if (result.mode === "read_only") announceReadOnlyLaunch(result);

  if (!result.ok) {
    console.error("Refusing to publish the canonical Texas SandFest site:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    for (const check of result.api?.checks || []) {
      if (!check.ok) console.error(`- ${check.id}: ${check.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  if (result.mode === "read_only") {
    console.warn(`Vercel READ-ONLY launch gate passed for ${result.config.publicUrl} (${result.api.summary.passed}/${result.api.summary.total} bridge checks).`);
    return;
  }
  console.log(`Vercel production release gate passed for ${result.config.publicUrl}.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) await main();

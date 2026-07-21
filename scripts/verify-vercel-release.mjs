#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  deploymentVerificationConfig,
  verifyProductionApi
} from "../lib/deployment-verifier.mjs";

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

export async function verifyVercelRelease({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (env.VERCEL !== "1") {
    return { ok: true, skipped: true, reason: "outside Vercel" };
  }
  if (String(env.VERCEL_ENV || "").trim().toLowerCase() !== "production") {
    return { ok: true, skipped: true, reason: "non-production Vercel deployment" };
  }

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

async function main() {
  const result = await verifyVercelRelease();
  if (result.skipped) {
    console.log(`Vercel production release gate skipped for ${result.reason}.`);
    return;
  }

  if (!result.ok) {
    console.error("Refusing to publish the canonical Texas SandFest site:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    for (const check of result.api?.checks || []) {
      if (!check.ok) console.error(`- ${check.id}: ${check.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Vercel production release gate passed for ${result.config.publicUrl}.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) await main();

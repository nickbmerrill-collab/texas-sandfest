#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deploymentVerificationConfig,
  verifyLiveDeployment
} from "../lib/deployment-verifier.mjs";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.resolve(root, process.env.SANDFEST_DEPLOY_VERIFY_PUBLIC_DIR || "dist-public");
const adminDir = path.resolve(root, process.env.SANDFEST_DEPLOY_VERIFY_ADMIN_DIR || "dist-admin");
const config = deploymentVerificationConfig(process.env);

if (!config.ready) {
  console.error(`Deployment verification is not configured: ${config.reason}`);
  process.exit(1);
}

let artifacts;
try {
  artifacts = {
    publicHtml: await readFile(path.join(publicDir, "index.html"), "utf8"),
    publicWorker: await readFile(path.join(publicDir, "sw.js"), "utf8"),
    adminHtml: await readFile(path.join(adminDir, "index.html"), "utf8")
  };
} catch (error) {
  console.error(`Deployment verification requires current public and admin builds: ${error.message}`);
  console.error("Run npm run build:surfaces before verifying the live deployment.");
  process.exit(1);
}

const result = await verifyLiveDeployment({ config, artifacts });
console.log("\n=== Texas SandFest live deployment acceptance ===\n");
for (const check of result.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.surface.padEnd(10)} ${check.id} - ${check.detail}`);
}
console.log(`\nDeployment acceptance: ${result.summary.passed} passed, ${result.summary.failed} failed.`);
console.log(`Public: ${result.targets.publicUrl}`);
console.log(`API: ${result.targets.apiUrl}`);
console.log(`Admin: ${result.targets.adminUrl}\n`);

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

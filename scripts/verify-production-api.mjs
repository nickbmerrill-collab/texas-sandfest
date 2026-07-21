#!/usr/bin/env node

import {
  deploymentVerificationConfig,
  verifyProductionApi
} from "../lib/deployment-verifier.mjs";

const config = deploymentVerificationConfig(process.env);
if (!config.ready) {
  console.error(`Production API verification is not configured: ${config.reason}`);
  process.exit(1);
}

const result = await verifyProductionApi({ config });
console.log("\n=== Texas SandFest production API release gate ===\n");
for (const check of result.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id} - ${check.detail}`);
}
console.log(`\nProduction API gate: ${result.summary.passed} passed, ${result.summary.failed} failed.`);
console.log(`API: ${result.targets.apiUrl}\n`);

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

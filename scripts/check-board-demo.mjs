#!/usr/bin/env node

import { boardDemoCheckEndpoints, evaluateBoardDemoReadiness } from "../lib/board-demo-readiness.mjs";

let endpoints;
try {
  endpoints = boardDemoCheckEndpoints(process.env);
} catch (error) {
  console.error(`[FAIL] Board demo preflight configuration: ${error.message}`);
  process.exit(1);
}
const { webUrl, webOrigin, apiBase, emailBase, smsBase } = endpoints;
const adminToken = process.env.SANDFEST_BOARD_ADMIN_TOKEN || "board-demo-local-admin-token-change-me";
const configuredTimeoutMs = Number(process.env.SANDFEST_BOARD_CHECK_TIMEOUT_MS || 5000);
const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(1000, configuredTimeoutMs) : 5000;
const jsonOutput = process.argv.includes("--json");

async function request(url, { json = true, headers = {} } = {}) {
  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    const body = json ? await response.json().catch(() => null) : await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error.message };
  }
}

const authorization = { authorization: `Bearer ${adminToken}` };
const [web, health, ready, bootstrap, emailSandbox, smsSandbox, conditions, partners] = await Promise.all([
  request(webUrl, { json: false }),
  request(`${apiBase}/health`),
  request(`${apiBase}/ready`),
  request(`${apiBase}/api/public/bootstrap`),
  request(`${emailBase}/health`),
  request(`${smsBase}/health`),
  request(`${apiBase}/api/public/island-conditions`),
  request(`${apiBase}/api/admin/partners`, { headers: authorization })
]);

const report = {
  checkedAt: new Date().toISOString(),
  ...evaluateBoardDemoReadiness({
    web: { ok: web.ok, status: web.status, html: web.body },
    webOrigin,
    health: health.body,
    ready: ready.body,
    bootstrap: bootstrap.body,
    emailSandbox: emailSandbox.body,
    smsSandbox: smsSandbox.body,
    conditions: conditions.body,
    partners: partners.body
  })
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Board demo readiness: ${report.passed}/${report.total} checks passed.`);
  for (const item of report.checks) {
    console.log(`${item.ok ? "[PASS]" : "[FAIL]"} ${item.label}: ${item.detail}`);
    if (!item.ok && item.action) console.log(`       ${item.action}`);
  }
}

process.exitCode = report.ok ? 0 : 1;

#!/usr/bin/env node

import {
  boardDemoCheckEndpoints,
  boardDemoPresentationLinks,
  evaluateBoardDemoReadiness
} from "../lib/board-demo-readiness.mjs";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  assessBoardDemoSourceRevision,
  boardDemoEnvironmentFromSession,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  boardDemoSourceRevision,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const session = await readBoardDemoSession(sessionFile);
const checkEnvironment = await boardDemoEnvironmentFromSession(process.env, { root: ROOT });

let endpoints;
try {
  endpoints = boardDemoCheckEndpoints(checkEnvironment);
} catch (error) {
  console.error(`[FAIL] Board demo preflight configuration: ${error.message}`);
  process.exit(1);
}
const { webUrl, webOrigin, apiBase, emailBase, smsBase } = endpoints;
const links = boardDemoPresentationLinks(checkEnvironment);
const adminToken = checkEnvironment.SANDFEST_BOARD_ADMIN_TOKEN || "board-demo-local-admin-token-change-me";
const configuredTimeoutMs = Number(checkEnvironment.SANDFEST_BOARD_CHECK_TIMEOUT_MS || 5000);
const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(1000, configuredTimeoutMs) : 5000;
const jsonOutput = process.argv.includes("--json");

async function sourceRevisionCheck() {
  if (!session || !boardDemoSessionProcessAlive(session)) {
    return {
      id: "source_revision",
      label: "Presentation source",
      ok: false,
      detail: "No active board supervisor session pins the presentation source.",
      action: "Start the clean main stack with npm run board:demo."
    };
  }
  if (session.schemaVersion !== BOARD_DEMO_SESSION_SCHEMA_VERSION) {
    return {
      id: "source_revision",
      label: "Presentation source",
      ok: false,
      detail: `The session schema is ${session.schemaVersion ?? "missing"}; expected ${BOARD_DEMO_SESSION_SCHEMA_VERSION}.`,
      action: "Restart the board stack from clean main."
    };
  }
  try {
    const assessment = assessBoardDemoSourceRevision(session.source, await boardDemoSourceRevision(ROOT));
    return {
      id: "source_revision",
      label: "Presentation source",
      ok: assessment.ok,
      detail: assessment.detail,
      action: assessment.ok ? null : "Commit or discard source changes, update main, and restart the board stack."
    };
  } catch (error) {
    return {
      id: "source_revision",
      label: "Presentation source",
      ok: false,
      detail: error.message,
      action: "Restore Git access and restart the board stack."
    };
  }
}

async function request(url, { json = true, headers = {}, readBody = true } = {}) {
  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    const body = readBody ? (json ? await response.json().catch(() => null) : await response.text()) : null;
    return { ok: response.ok, status: response.status, body, contentType: response.headers.get("content-type") || "" };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error.message };
  }
}

const authorization = { authorization: `Bearer ${adminToken}` };
const [web, health, ready, bootstrap, tickets, emailSandbox, smsSandbox, conditions, partners, documents, sponsors] = await Promise.all([
  request(webUrl, { json: false }),
  request(`${apiBase}/health`),
  request(`${apiBase}/ready`),
  request(`${apiBase}/api/public/bootstrap`),
  request(`${apiBase}/api/public/tickets`),
  request(`${emailBase}/health`),
  request(`${smsBase}/health`),
  request(`${apiBase}/api/public/island-conditions`),
  request(`${apiBase}/api/admin/partners`, { headers: authorization }),
  request(`${apiBase}/api/admin/documents`, { headers: authorization }),
  request(`${apiBase}/api/public/sponsors`)
]);
const boardSponsor = sponsors.body?.sponsors?.find(item => item?.displayName === "Gulf Shore Credit Union");
const sponsorLogoPath = String(boardSponsor?.logo?.path || "");
const sponsorLogo = sponsorLogoPath.startsWith("/api/public/sponsor-showcase/assets/")
  ? await request(`${apiBase}${sponsorLogoPath}`, { json: false, readBody: false })
  : { ok: false, status: 0, body: null, contentType: "" };

const readiness = evaluateBoardDemoReadiness({
    web: { ok: web.ok, status: web.status, html: web.body },
    webOrigin,
    health: health.body,
    ready: ready.body,
    bootstrap: bootstrap.body,
    tickets: tickets.body,
    emailSandbox: emailSandbox.body,
    smsSandbox: smsSandbox.body,
    conditions: conditions.body,
    partners: partners.body,
    documents: documents.body,
    sponsors: sponsors.body,
    sponsorLogo
  });
const checks = [await sourceRevisionCheck(), ...readiness.checks];
const passed = checks.filter(item => item.ok).length;
const ok = passed === checks.length;
const report = {
  checkedAt: new Date().toISOString(),
  ok,
  passed,
  total: checks.length,
  links: ok ? links : { visitor: null, operations: null },
  checks
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Board demo readiness: ${report.passed}/${report.total} checks passed.`);
  for (const item of report.checks) {
    console.log(`${item.ok ? "[PASS]" : "[FAIL]"} ${item.label}: ${item.detail}`);
    if (!item.ok && item.action) console.log(`       ${item.action}`);
  }
  if (report.ok) {
    console.log(`Visitor:    ${report.links.visitor}`);
    console.log(`Operations: ${report.links.operations}`);
  }
}

process.exitCode = report.ok ? 0 : 1;

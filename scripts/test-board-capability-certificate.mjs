#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_CAPABILITY_BROWSER_CHECKS,
  BOARD_CAPABILITY_CERTIFICATE_SCHEMA_VERSION,
  BOARD_CAPABILITY_DEFERRED_GATES,
  BOARD_CAPABILITY_JOURNEYS,
  boardCapabilityCoverage,
  certifyBoardBrowserReport,
  certifyBoardCapabilityJourney,
  certifyBoardReadinessReport,
  evaluateBoardCapabilityCertificate
} from "../lib/board-capability-certificate.mjs";
import { presenterSummary } from "../src/admin-board-capability-proof.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}: ${error.message}`);
    process.exitCode = 1;
  }
}

const reset = { preflight: "12/12" };
const reports = {
  signups: {
    ok: true,
    runId: "private-run",
    submissions: [{ applicationId: "private-1" }, { applicationId: "private-2" }],
    automation: { delivered: 2, provider: "brevo", sandboxAuthenticated: true, acceptedMessages: 2, deliveryCallbacks: 2, callbackFailures: 0 },
    operations: { applicationCount: 7, deliveredAcknowledgments: 2 },
    reset
  },
  guest_services: {
    ok: true,
    request: { category: "accessibility", priority: "high", assignedTeam: "guest-services", replayed: true, invalidCapabilityDenied: true },
    resolution: { resolved: true, publicUpdates: 3, internalUpdates: 2 },
    audit: { records: 2 },
    reset
  },
  vendor: {
    ok: true,
    application: { status: "approved" },
    profile: { status: "approved", revision: 2 },
    compliance: { approved: 5, required: 5, verifiedBytes: 4096 },
    assignment: { status: "confirmed", partnerConfirmed: true },
    notices: { delivered: 3 },
    readiness: { status: "ready" },
    audit: { records: 10 },
    reset
  },
  sponsor: {
    ok: true,
    invitation: { packageId: "tarpon", token: "private-token" },
    application: { type: "sponsor", outreachConversion: true },
    review: { applicationStatus: "approved", profileStatus: "approved", assetStatus: "approved" },
    showcase: { sponsorCount: 2, logoBytes: 2048 },
    audit: { records: 5 },
    reset
  },
  outreach: {
    ok: true,
    discovery: { provider: "fixture", researchRequired: true },
    qualification: { status: "contact_ready", nextActionScheduled: true },
    campaign: { matched: 1, radiusMiles: 2, dailySendLimit: 1 },
    delivery: { deliveryStatus: "delivered", sandboxAuthenticated: true, recipient: "private@example.com" },
    preference: { status: "unsubscribed", replayed: true },
    audit: { records: 7 },
    reset
  },
  tickets: {
    ok: true,
    purchase: { status: "paid", quantity: 2, amountCents: 6000, fulfillmentCount: 2 },
    refund: { status: "refunded", refundedAmountCents: 6000, fulfillmentRefunded: 2 },
    audit: { records: 1 },
    reset
  },
  operations: {
    ok: true,
    accounting: { expenseStatus: "paid", externalRef: "private-reference" },
    payment: { amountCents: 500_000 },
    delegation: { assigneeType: "volunteer" },
    keyDate: { status: "open" },
    deliveries: { delivered: 3 },
    exports: { files: 5, calendarEvents: 17 },
    audit: { records: 11, exports: 5 },
    reset
  },
  delegation: {
    ok: true,
    delegation: { assigneeType: "volunteer", priority: "high" },
    delivery: { deliveryStatus: "delivered", sandboxAuthenticated: true, privateAccessDelivered: true },
    portal: { acknowledged: true, started: true, blocked: true, completed: true, replayed: true, updates: 4, token: "private-token" },
    audit: { records: 4 },
    reset
  },
  incident: {
    ok: true,
    camera: { cameraId: "north-gate", severity: "critical", replayed: true },
    notice: { visible: true, privateProjection: true },
    dispatch: { assigneeType: "team", assigneeName: "Traffic and parking", status: "completed" },
    delivery: { provider: "brevo", sandboxAuthenticated: true, recipientConcealed: true },
    recovery: { status: "monitoring", automatic: true },
    resolution: { status: "resolved" },
    audit: { records: 11, private: true },
    reset
  },
  documents: {
    ok: true,
    document: {
      fileName: "private-board-file.pptx",
      reviewTaskStatus: "done",
      extractionJobStatus: "done",
      extractedCharacterCount: 5500,
      extractedChunkCount: 4,
      checksumSha256: "a".repeat(64)
    },
    audit: { records: 4 },
    reset
  }
};

const certificateSource = {
  branch: "main",
  commit: "a".repeat(40),
  originMainCommit: "a".repeat(40),
  matchesOriginMain: true,
  dirty: false
};
const certificateLinks = {
  visitor: "http://127.0.0.1:5175/?apiBase=http%3A%2F%2F127.0.0.1%3A8806&mode=visitor",
  operations: "http://127.0.0.1:5175/admin.html?apiBase=http%3A%2F%2F127.0.0.1%3A8806"
};

function fullCertificate(overrides = {}) {
  const startedAt = "2026-07-23T12:00:00.000Z";
  const completedAt = "2026-07-23T12:03:20.000Z";
  return {
    schemaVersion: BOARD_CAPABILITY_CERTIFICATE_SCHEMA_VERSION,
    kind: "sandfest_board_capability_certificate",
    mode: "synthetic_board_demo",
    scope: "full",
    ok: true,
    startedAt,
    completedAt,
    durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    source: { ...certificateSource },
    links: { ...certificateLinks },
    readiness: {
      before: "12/12",
      after: "12/12",
      baselineRestored: true
    },
    selectedJourneys: BOARD_CAPABILITY_JOURNEYS.map(item => item.id),
    journeys: BOARD_CAPABILITY_JOURNEYS.map(item => ({
      ...certifyBoardCapabilityJourney(item.id, reports[item.id]),
      durationMs: 10_000
    })),
    browsers: ["chromium", "webkit"].map(engine => ({
      engine,
      ok: true,
      passed: BOARD_CAPABILITY_BROWSER_CHECKS,
      total: BOARD_CAPABILITY_BROWSER_CHECKS,
      responsive: true,
      browserErrors: 0,
      durationMs: 2_000
    })),
    certifiedCapabilities: [
      "source_and_service_readiness",
      ...boardCapabilityCoverage(),
      "responsive_cross_browser_web"
    ],
    deferredProductionGates: [...BOARD_CAPABILITY_DEFERRED_GATES],
    failure: null,
    ...overrides
  };
}

console.log("\n=== Board capability certificate contract ===\n");

check("manifest contains ten unique reset-safe journeys", () => {
  assert.equal(BOARD_CAPABILITY_JOURNEYS.length, 10);
  assert.equal(new Set(BOARD_CAPABILITY_JOURNEYS.map(item => item.id)).size, 10);
  for (const item of BOARD_CAPABILITY_JOURNEYS) {
    assert.match(item.script, /^scripts\/prove-board-.+\.mjs$/);
    assert.match(item.command, /^npm run board:prove:/);
    assert.ok(item.timeoutMs >= 120_000);
    assert.ok(item.capabilities.length >= 3);
  }
});

check("manifest covers every requested board capability family", () => {
  const coverage = new Set(boardCapabilityCoverage());
  for (const capability of [
    "vendor_signup",
    "sponsor_signup",
    "automatic_acknowledgments",
    "vendor_profile",
    "sponsor_branding",
    "geofenced_outreach",
    "payment_tracking",
    "key_dates",
    "task_delegation",
    "camera_metrics",
    "public_conditions_notice",
    "private_upload"
  ]) assert.ok(coverage.has(capability), capability);
});

for (const journey of BOARD_CAPABILITY_JOURNEYS) {
  check(`${journey.id} produces aggregate-only certified evidence`, () => {
    const result = certifyBoardCapabilityJourney(journey.id, reports[journey.id]);
    assert.equal(result.ok, true);
    assert.equal(result.reset, "12/12");
    const serialized = JSON.stringify(result);
    for (const privateValue of ["private-run", "private-1", "private-2", "private-token", "private@example.com", "private-reference", "private-board-file.pptx"]) {
      assert.equal(serialized.includes(privateValue), false, privateValue);
    }
  });
}

check("journey validation fails closed without exact baseline restoration", () => {
  assert.throws(() => certifyBoardCapabilityJourney("signups", {
    ...reports.signups,
    reset: { preflight: "11/12" }
  }), /12\/12 readiness/);
});

check("readiness accepts exact loopback presentation links", () => {
  const result = certifyBoardReadinessReport({
    ok: true,
    passed: 12,
    total: 12,
    checkedAt: "2026-07-22T00:00:00.000Z",
    links: {
      visitor: "http://127.0.0.1:5175/?mode=visitor",
      operations: "http://127.0.0.1:5175/admin.html"
    }
  });
  assert.equal(result.readiness, "12/12");
});

check("readiness rejects remote presentation links", () => {
  assert.throws(() => certifyBoardReadinessReport({
    ok: true,
    passed: 12,
    total: 12,
    links: {
      visitor: "https://example.com/",
      operations: "http://127.0.0.1:5175/admin.html"
    }
  }), /loopback/);
});

check("browser evidence requires the requested engine and 14/14", () => {
  assert.deepEqual(certifyBoardBrowserReport({
    ok: true,
    passed: 14,
    total: 14,
    browserEngine: "webkit"
  }, "webkit"), {
    engine: "webkit",
    ok: true,
    passed: 14,
    total: 14,
    responsive: true,
    browserErrors: 0
  });
  assert.throws(() => certifyBoardBrowserReport({
    ok: true,
    passed: 13,
    total: 14,
    browserEngine: "chromium"
  }, "chromium"), /14\/14/);
});

check("certificate names account-owned live production gates", () => {
  assert.deepEqual(BOARD_CAPABILITY_DEFERRED_GATES, [
    "live_payment_and_accounting_providers",
    "live_email_and_sms_providers",
    "live_weather_and_ferry_feeds",
    "live_webcam_edge_agents",
    "production_identity_and_bot_protection",
    "public_dns_and_recovery_cutover"
  ]);
});

check("presentation gate accepts a recent full certificate from the active source", () => {
  const result = evaluateBoardCapabilityCertificate(fullCertificate(), {
    source: certificateSource,
    links: certificateLinks,
    now: "2026-07-23T13:00:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.journeyCount, 10);
  assert.deepEqual(result.browsers.map(item => item.engine), ["chromium", "webkit"]);
});

check("presentation gate rejects source and active-link drift", () => {
  const result = evaluateBoardCapabilityCertificate(fullCertificate(), {
    source: { ...certificateSource, commit: "b".repeat(40), originMainCommit: "b".repeat(40) },
    links: { ...certificateLinks, operations: "http://127.0.0.1:5199/admin.html" },
    now: "2026-07-23T13:00:00.000Z"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes("active source revision")));
  assert.ok(result.errors.some(error => error.includes("active presentation links")));
});

check("presentation gate rejects stale and future-dated certificates", () => {
  const stale = evaluateBoardCapabilityCertificate(fullCertificate(), {
    source: certificateSource,
    links: certificateLinks,
    now: "2026-08-01T13:00:00.000Z"
  });
  assert.ok(stale.errors.some(error => error.includes("freshness window")));

  const future = evaluateBoardCapabilityCertificate(fullCertificate({
    startedAt: "2026-07-24T12:00:00.000Z",
    completedAt: "2026-07-24T12:03:20.000Z"
  }), {
    source: certificateSource,
    links: certificateLinks,
    now: "2026-07-23T13:00:00.000Z"
  });
  assert.ok(future.errors.some(error => error.includes("in the future")));
});

check("Operations proof panel presenter summary translates certified evidence", () => {
  const certificate = fullCertificate();
  const summary = presenterSummary({
    ok: true,
    journeyCount: certificate.journeys.length,
    requiredJourneyCount: BOARD_CAPABILITY_JOURNEYS.length,
    browsers: certificate.browsers,
    source: certificate.source,
    certifiedCapabilities: certificate.certifiedCapabilities,
    deferredProductionGates: certificate.deferredProductionGates
  }, value => String(value || "").replaceAll("_", " "));
  assert.match(summary, /10\/10 certified journeys/);
  assert.match(summary, /chromium 14\/14/);
  assert.match(summary, /webkit 14\/14/);
  assert.match(summary, /40 certified capabilities/);
  assert.match(summary, /6 live-provider gates held for post-board activation/);
  assert.match(summary, /main@aaaaaaaa/);
});

check("presentation gate rejects focused, incomplete, or deferral-changing evidence", () => {
  const certificate = fullCertificate();
  const result = evaluateBoardCapabilityCertificate({
    ...certificate,
    scope: "focused",
    selectedJourneys: certificate.selectedJourneys.slice(0, -1),
    journeys: certificate.journeys.slice(0, -1).map((item, index) => index === 0 ? { ...item, evidence: null } : item),
    browsers: certificate.browsers.map((item, index) => index === 0 ? { ...item, passed: 13 } : item),
    deferredProductionGates: certificate.deferredProductionGates.slice(0, -1)
  }, {
    source: certificateSource,
    links: certificateLinks,
    now: "2026-07-23T13:00:00.000Z"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes("full-scope")));
  assert.ok(result.errors.some(error => error.includes("every required journey")));
  assert.ok(result.errors.some(error => error.includes("journey evidence")));
  assert.ok(result.errors.some(error => error.includes("Chromium and WebKit")));
  assert.ok(result.errors.some(error => error.includes("post-board production deferrals")));

  const truncatedEvidence = evaluateBoardCapabilityCertificate({
    ...certificate,
    journeys: certificate.journeys.map((item, index) => index === 0 ? { ...item, evidence: null } : item)
  }, {
    source: certificateSource,
    links: certificateLinks,
    now: "2026-07-23T13:00:00.000Z"
  });
  assert.ok(truncatedEvidence.errors.some(error => error.includes("journey evidence")));
});

check("board:present maps to the strict persistent-service presentation gate", () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["board:present"], "node scripts/board-service.mjs present");
  const result = spawnSync(process.execPath, ["scripts/board-service.mjs", "unknown"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /status\|present/);
});

check("certification CLI exposes focused and full-run controls", () => {
  const result = spawnSync(process.execPath, ["scripts/certify-board-capabilities.mjs", "--help"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--only=id,id/);
  assert.match(result.stdout, /--skip-browsers/);
  assert.match(result.stdout, /Journey IDs: signups/);
});

if (!process.exitCode) console.log(`\nBoard capability certificate: ${passed}/${passed} checks passed.\n`);

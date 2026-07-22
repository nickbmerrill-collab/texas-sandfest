#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_CAPABILITY_DEFERRED_GATES,
  BOARD_CAPABILITY_JOURNEYS,
  boardCapabilityCoverage,
  certifyBoardBrowserReport,
  certifyBoardCapabilityJourney,
  certifyBoardReadinessReport
} from "../lib/board-capability-certificate.mjs";

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

#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  PRODUCTION_CAMERA_IDS,
  cameraFleetEvidenceDigest,
  verifyCameraFleetQualification
} from "../lib/camera-fleet-qualification.mjs";

const NOW = new Date("2026-07-18T10:00:00.000Z");

function fixture(overrides = {}) {
  const report = {
    reportVersion: 1,
    qualification: "eight-camera-generated-frame-runtime",
    checkedAt: "2026-07-18T09:59:00.000Z",
    ok: true,
    privacy: "generated pixels only; no frame or crop written",
    agentVersion: "2026.07.1",
    python: "3.12.13",
    opencv: "4.13.0",
    lap: "0.5.13",
    torch: "2.13.0",
    ultralytics: "8.4.98",
    configSha256: "a".repeat(64),
    cameraCount: 8,
    cameraIds: [...PRODUCTION_CAMERA_IDS],
    missingCameraIds: [],
    unexpectedCameraIds: [],
    modelInstances: 8,
    distinctModelInstances: 8,
    model: "yolo11n.pt",
    modelVersion: "yolo11n-coco",
    modelSha256: "b".repeat(64),
    modelBytes: 5613764,
    device: "mps:0",
    mpsAvailable: true,
    targetSampleFpsPerCamera: 3,
    cycleBudgetMs: 333,
    cycleMedianMs: 44,
    cycleMaxMs: 48,
    cycleBudgetMet: true,
    cycles: 3,
    perCamera: Object.fromEntries(PRODUCTION_CAMERA_IDS.map(id => [id, { medianInferenceMs: 5, maxInferenceMs: 7 }])),
    failureReasons: [],
    ...overrides
  };
  report.evidenceSha256 = cameraFleetEvidenceDigest(report);
  return report;
}

const valid = fixture();
assert.equal(verifyCameraFleetQualification(valid, {
  now: NOW,
  expectedConfigSha256: "a".repeat(64),
  expectedModelSha256: "b".repeat(64)
}).ready, true);

const tampered = fixture();
tampered.cycleMaxMs = 49;
assert.match(verifyCameraFleetQualification(tampered, { now: NOW }).reasons.join("; "), /checksum/);

const missing = fixture({ cameraIds: PRODUCTION_CAMERA_IDS.slice(0, -1), cameraCount: 7, modelInstances: 7, distinctModelInstances: 7 });
assert.match(verifyCameraFleetQualification(missing, { now: NOW }).reasons.join("; "), /canonical eight-camera fleet/);

const stale = fixture({ checkedAt: "2026-07-16T09:59:00.000Z" });
assert.match(verifyCameraFleetQualification(stale, { now: NOW }).reasons.join("; "), /older than 24 hours/);

const unsafe = fixture({ streamUrl: "rtsp://camera-user:password@10.0.0.1/live" });
assert.match(verifyCameraFleetQualification(unsafe, { now: NOW }).reasons.join("; "), /unsafe evidence fields/);

const malformed = fixture({ modelVersion: "", perCamera: {} });
assert.match(verifyCameraFleetQualification(malformed, { now: NOW }).reasons.join("; "), /per-camera timing evidence is incomplete/);
assert.match(verifyCameraFleetQualification(malformed, { now: NOW }).reasons.join("; "), /modelVersion is missing/);

console.log("Camera fleet qualification report tests passed (6 checks).");

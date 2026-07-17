#!/usr/bin/env node

import {
  cameraModelApproval,
  verifyCameraModelPayload
} from "../lib/camera-model-approval.mjs";

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ok ${label}`);
  } else {
    failed += 1;
    console.error(`  not ok ${label}`);
  }
}

const approvedEnvironment = {
  CAMERA_MODEL_APPROVAL_STATUS: "approved",
  CAMERA_MODEL_NAME: "reviewed-detector.onnx",
  CAMERA_MODEL_VERSION: "detector-coco-2026.07",
  CAMERA_MODEL_SHA256: "a".repeat(64),
  CAMERA_MODEL_LICENSE_REFERENCE: "LICENSE-REVIEW-2026-07",
  CAMERA_MODEL_APPROVED_BY: "SandFest technology committee",
  CAMERA_MODEL_APPROVED_AT: "2026-07-17T12:00:00Z",
  CAMERA_MODEL_DECISION_REFERENCE: "CAMERA-MODEL-2026-001"
};
const nowMs = Date.parse("2026-07-17T13:00:00Z");

console.log("\n=== Camera model approval gate ===\n");

const missing = cameraModelApproval({}, { nowMs });
check("missing approval fails closed", !missing.ready && missing.errors.length === 8);

const approved = cameraModelApproval(approvedEnvironment, { nowMs });
check("complete artifact-bound approval passes", approved.ready
  && approved.sha256 === "a".repeat(64)
  && approved.approvedAt === "2026-07-17T12:00:00.000Z");

const placeholder = cameraModelApproval({
  ...approvedEnvironment,
  CAMERA_MODEL_LICENSE_REFERENCE: "pending"
}, { nowMs });
check("placeholder license review fails closed", !placeholder.ready
  && placeholder.reason.includes("CAMERA_MODEL_LICENSE_REFERENCE"));

const future = cameraModelApproval({
  ...approvedEnvironment,
  CAMERA_MODEL_APPROVED_AT: "2026-07-18T12:00:00Z"
}, { nowMs });
check("future approval timestamp fails closed", !future.ready
  && future.reason.includes("cannot be in the future"));

const mutableArtifact = cameraModelApproval({
  ...approvedEnvironment,
  CAMERA_MODEL_SHA256: "latest"
}, { nowMs });
check("non-immutable model identity fails closed", !mutableArtifact.ready
  && mutableArtifact.reason.includes("64-character SHA-256"));

const matchingPayload = verifyCameraModelPayload({
  modelName: approved.modelName,
  modelVersion: approved.modelVersion,
  modelSha256: approved.sha256
}, approved);
check("signed metric model identity matches exact approved bytes", matchingPayload.verified);

const mismatchedPayload = verifyCameraModelPayload({
  modelName: approved.modelName,
  modelVersion: approved.modelVersion,
  modelSha256: "b".repeat(64)
}, approved);
check("signed metric from different model bytes fails closed", !mismatchedPayload.verified
  && mismatchedPayload.reason === "camera_model_checksum_mismatch");

console.log(`\nCamera model approval total: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;

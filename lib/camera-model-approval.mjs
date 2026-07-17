const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const APPROVAL_STATUS = "approved";
const PLACEHOLDER_PATTERN = /^(?:pending|unknown|unreviewed|none|n\/a|replace(?:-with)?|todo)/i;

function text(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function approvedText(value, label, errors, max = 300) {
  const normalized = text(value, max);
  if (!normalized || PLACEHOLDER_PATTERN.test(normalized)) {
    errors.push(`${label} must contain the reviewed production value.`);
  }
  return normalized;
}

function approvalTimestamp(value, errors, nowMs) {
  const normalized = text(value, 80);
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) {
    errors.push("CAMERA_MODEL_APPROVED_AT must be an ISO-8601 timestamp.");
    return { value: normalized, timestamp: null };
  }
  if (timestamp > nowMs + 5 * 60_000) {
    errors.push("CAMERA_MODEL_APPROVED_AT cannot be in the future.");
  }
  return { value: new Date(timestamp).toISOString(), timestamp };
}

export function cameraModelApproval(env = process.env, options = {}) {
  const errors = [];
  const status = text(env.CAMERA_MODEL_APPROVAL_STATUS, 30).toLowerCase();
  if (status !== APPROVAL_STATUS) {
    errors.push("CAMERA_MODEL_APPROVAL_STATUS must be approved.");
  }
  const modelName = approvedText(env.CAMERA_MODEL_NAME, "CAMERA_MODEL_NAME", errors, 120);
  const modelVersion = approvedText(env.CAMERA_MODEL_VERSION, "CAMERA_MODEL_VERSION", errors, 120);
  const sha256 = text(env.CAMERA_MODEL_SHA256, 64).toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) {
    errors.push("CAMERA_MODEL_SHA256 must be the approved model artifact's 64-character SHA-256.");
  }
  const licenseReference = approvedText(
    env.CAMERA_MODEL_LICENSE_REFERENCE,
    "CAMERA_MODEL_LICENSE_REFERENCE",
    errors
  );
  const approvedBy = approvedText(env.CAMERA_MODEL_APPROVED_BY, "CAMERA_MODEL_APPROVED_BY", errors, 160);
  const decisionReference = approvedText(
    env.CAMERA_MODEL_DECISION_REFERENCE,
    "CAMERA_MODEL_DECISION_REFERENCE",
    errors
  );
  const approvedAt = approvalTimestamp(
    env.CAMERA_MODEL_APPROVED_AT,
    errors,
    Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  );
  const ready = errors.length === 0;
  return {
    ready,
    status,
    modelName,
    modelVersion,
    sha256,
    licenseReference,
    approvedBy,
    approvedAt: approvedAt.value,
    decisionReference,
    reason: ready
      ? null
      : `Camera model deployment approval is incomplete: ${errors.join(" ")}`,
    errors
  };
}

export function verifyCameraModelPayload(payload, approval) {
  if (!approval?.ready) {
    return { verified: false, reason: "camera_model_approval_not_ready" };
  }
  const modelName = text(payload?.modelName, 120);
  const modelVersion = text(payload?.modelVersion, 120);
  const sha256 = text(payload?.modelSha256, 64).toLowerCase();
  if (!modelName || !modelVersion || !SHA256_PATTERN.test(sha256)) {
    return { verified: false, reason: "camera_model_identity_missing" };
  }
  if (modelName !== approval.modelName || modelVersion !== approval.modelVersion) {
    return { verified: false, reason: "camera_model_identity_mismatch" };
  }
  if (sha256 !== approval.sha256) {
    return { verified: false, reason: "camera_model_checksum_mismatch" };
  }
  return { verified: true, reason: "ok", modelName, modelVersion, sha256 };
}

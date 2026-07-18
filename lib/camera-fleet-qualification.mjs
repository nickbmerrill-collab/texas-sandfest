import { createHash } from "node:crypto";

export const PRODUCTION_CAMERA_IDS = Object.freeze([
  "ferry-loading",
  "ferry-stacking",
  "harbor-island-entrance",
  "harbor-island-stacking",
  "north-gate",
  "south-gate",
  "food-court",
  "competition-corridor"
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const QUALIFICATION = "eight-camera-generated-frame-runtime";
const PRIVACY_STATEMENT = "generated pixels only; no frame or crop written";
const UNSAFE_KEY_PATTERN = /(credential|frame|image|password|path|secret|source|stream|token|uri|url|video)/i;
const UNSAFE_VALUE_PATTERN = /(?:rtsp|rtsps|https?):\/\/|(?:^|\s)\/(?:Users|home|private|var)\//i;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalValue(value[key])])
  );
}

function withoutEvidenceDigest(report) {
  const copy = structuredClone(report);
  delete copy.evidenceSha256;
  return copy;
}

function unsafeEvidenceFields(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => unsafeEvidenceFields(entry, `${prefix}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" && UNSAFE_VALUE_PATTERN.test(value) ? [prefix || "value"] : [];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    return [
      ...(UNSAFE_KEY_PATTERN.test(key) ? [field] : []),
      ...unsafeEvidenceFields(entry, field)
    ];
  });
}

export function cameraFleetEvidenceDigest(report) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(withoutEvidenceDigest(report))))
    .digest("hex");
}

export function verifyCameraFleetQualification(report, {
  now = new Date(),
  maxAgeHours = 24,
  expectedConfigSha256,
  expectedModelSha256
} = {}) {
  const reasons = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { ready: false, reasons: ["qualification report must be a JSON object"] };
  }

  if (report.reportVersion !== 1) reasons.push("unsupported report version");
  if (report.qualification !== QUALIFICATION) reasons.push("unexpected qualification type");
  if (report.privacy !== PRIVACY_STATEMENT) reasons.push("privacy boundary is not attested");
  if (report.ok !== true) reasons.push("runtime qualification did not pass");
  if (!Array.isArray(report.failureReasons) || report.failureReasons.length !== 0) {
    reasons.push("runtime qualification reports failures");
  }

  const cameraIds = Array.isArray(report.cameraIds) ? report.cameraIds : [];
  const expectedIds = new Set(PRODUCTION_CAMERA_IDS);
  const actualIds = new Set(cameraIds);
  const exactFleet = cameraIds.length === PRODUCTION_CAMERA_IDS.length
    && actualIds.size === expectedIds.size
    && PRODUCTION_CAMERA_IDS.every(cameraId => actualIds.has(cameraId));
  if (!exactFleet || report.cameraCount !== PRODUCTION_CAMERA_IDS.length) {
    reasons.push("report does not cover the canonical eight-camera fleet");
  }
  if (!Array.isArray(report.missingCameraIds) || report.missingCameraIds.length !== 0
    || !Array.isArray(report.unexpectedCameraIds) || report.unexpectedCameraIds.length !== 0) {
    reasons.push("report contains missing or unexpected camera lanes");
  }
  if (report.modelInstances !== PRODUCTION_CAMERA_IDS.length
    || report.distinctModelInstances !== PRODUCTION_CAMERA_IDS.length) {
    reasons.push("each camera lane must own a distinct model instance");
  }

  const perCameraIds = report.perCamera && typeof report.perCamera === "object" && !Array.isArray(report.perCamera)
    ? Object.keys(report.perCamera)
    : [];
  const completePerCameraTiming = perCameraIds.length === PRODUCTION_CAMERA_IDS.length
    && PRODUCTION_CAMERA_IDS.every(cameraId => {
      const timing = report.perCamera?.[cameraId];
      return timing
        && Number.isFinite(timing.medianInferenceMs)
        && timing.medianInferenceMs >= 0
        && Number.isFinite(timing.maxInferenceMs)
        && timing.maxInferenceMs >= timing.medianInferenceMs;
    });
  if (!completePerCameraTiming) reasons.push("per-camera timing evidence is incomplete");

  for (const field of ["agentVersion", "python", "opencv", "lap", "torch", "ultralytics", "model", "modelVersion", "device"]) {
    if (typeof report[field] !== "string" || report[field].trim() === "") {
      reasons.push(`${field} is missing from runtime evidence`);
    }
  }
  if (!Number.isSafeInteger(report.modelBytes) || report.modelBytes <= 0) {
    reasons.push("model byte count is invalid");
  }
  if (!Number.isSafeInteger(report.cycles) || report.cycles < 2) {
    reasons.push("runtime cycle count is invalid");
  }
  if (!Number.isFinite(report.targetSampleFpsPerCamera) || report.targetSampleFpsPerCamera <= 0) {
    reasons.push("target sample rate is invalid");
  }

  if (!Number.isFinite(report.cycleBudgetMs) || !Number.isFinite(report.cycleMaxMs)
    || !Number.isFinite(report.cycleMedianMs) || report.cycleMedianMs < 0
    || report.cycleMaxMs < report.cycleMedianMs
    || report.cycleBudgetMet !== true || report.cycleMaxMs > report.cycleBudgetMs) {
    reasons.push("complete fleet cycle exceeded its inference budget");
  }
  if (!SHA256_PATTERN.test(String(report.configSha256 || ""))) {
    reasons.push("config checksum is invalid");
  } else if (expectedConfigSha256 !== undefined && report.configSha256 !== expectedConfigSha256) {
    reasons.push("report was generated for a different camera config");
  }
  if (!SHA256_PATTERN.test(String(report.modelSha256 || ""))) {
    reasons.push("model checksum is invalid");
  } else if (expectedModelSha256 !== undefined && report.modelSha256 !== expectedModelSha256) {
    reasons.push("report was generated with different model bytes");
  }
  if (!SHA256_PATTERN.test(String(report.evidenceSha256 || ""))
    || report.evidenceSha256 !== cameraFleetEvidenceDigest(report)) {
    reasons.push("evidence checksum does not match report contents");
  }

  const checkedAt = Date.parse(String(report.checkedAt || ""));
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const maximumAgeMs = Number(maxAgeHours) * 60 * 60 * 1000;
  if (!Number.isFinite(checkedAt)) {
    reasons.push("qualification timestamp is invalid");
  } else if (checkedAt > nowMs + 5 * 60 * 1000) {
    reasons.push("qualification timestamp is in the future");
  } else if (!Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0 || nowMs - checkedAt > maximumAgeMs) {
    reasons.push(`qualification is older than ${maxAgeHours} hours`);
  }

  const unsafeFields = unsafeEvidenceFields(report);
  if (unsafeFields.length > 0) reasons.push(`report contains unsafe evidence fields: ${unsafeFields.join(", ")}`);

  return {
    ready: reasons.length === 0,
    reasons,
    checkedAt: report.checkedAt || null,
    cameraCount: report.cameraCount || 0,
    device: report.device || null,
    cycleMaxMs: report.cycleMaxMs ?? null,
    cycleBudgetMs: report.cycleBudgetMs ?? null,
    modelSha256: report.modelSha256 || null,
    configSha256: report.configSha256 || null,
    evidenceSha256: report.evidenceSha256 || null
  };
}

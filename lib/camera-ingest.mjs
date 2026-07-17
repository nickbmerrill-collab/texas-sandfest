import { createHmac, timingSafeEqual } from "node:crypto";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const MAX_CREDENTIALS = 64;
const DEFAULT_PRODUCTION_CAMERA_IDS = [
  "ferry-loading",
  "ferry-stacking",
  "harbor-island-entrance",
  "harbor-island-stacking",
  "north-gate",
  "south-gate",
  "food-court",
  "competition-corridor"
];

function parseCredentialSet(raw) {
  const source = String(raw || "").trim();
  if (!source) return { configured: false, credentials: [], errors: [] };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { configured: true, credentials: [], errors: ["CAMERA_INGEST_KEYS must be valid JSON."] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { configured: true, credentials: [], errors: ["CAMERA_INGEST_KEYS must be a JSON object keyed by credential ID."] };
  }
  const entries = Object.entries(parsed);
  if (entries.length > MAX_CREDENTIALS) {
    return { configured: true, credentials: [], errors: [`CAMERA_INGEST_KEYS supports at most ${MAX_CREDENTIALS} credentials.`] };
  }
  const credentials = [];
  const errors = [];
  for (const [keyId, value] of entries) {
    if (!ID_PATTERN.test(keyId)) {
      errors.push("Camera credential IDs must use letters, numbers, dots, underscores, or hyphens.");
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Camera credential ${keyId} must be an object.`);
      continue;
    }
    if (value.enabled === false || value.disabled === true) continue;
    const cameraId = String(value.cameraId || "").trim();
    const secret = String(value.secret || "");
    if (!ID_PATTERN.test(cameraId)) {
      errors.push(`Camera credential ${keyId} requires a valid cameraId.`);
      continue;
    }
    if (secret.length < 32) {
      errors.push(`Camera credential ${keyId} requires a secret of at least 32 characters.`);
      continue;
    }
    credentials.push({ keyId, cameraId, secret });
  }
  if (!errors.length && !credentials.length) errors.push("CAMERA_INGEST_KEYS has no active credentials.");
  return { configured: true, credentials, errors };
}

function credentialCameraIds(credentials) {
  return [...new Set(credentials.map(item => item.cameraId))].sort();
}

function rotatingCameraIds(credentials) {
  const counts = new Map();
  for (const credential of credentials) counts.set(credential.cameraId, (counts.get(credential.cameraId) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([cameraId]) => cameraId).sort();
}

function requiredCameraIds(raw, production) {
  const source = String(raw || "").trim();
  const values = source
    ? source.split(",").map(value => value.trim()).filter(Boolean)
    : production ? DEFAULT_PRODUCTION_CAMERA_IDS : [];
  const ids = [...new Set(values)];
  const errors = ids.some(id => !ID_PATTERN.test(id))
    ? ["CAMERA_INGEST_REQUIRED_CAMERA_IDS contains an invalid camera ID."]
    : [];
  return { ids: errors.length ? [] : ids, errors };
}

export function cameraIngestConfig(env = process.env) {
  const enabled = env.CAMERA_INGEST_ENABLED === "true";
  const production = env.SANDFEST_ENV === "production" || env.NODE_ENV === "production";
  const secret = String(env.CAMERA_INGEST_SECRET || "");
  const credentialSet = parseCredentialSet(env.CAMERA_INGEST_KEYS);
  const requiredSet = requiredCameraIds(env.CAMERA_INGEST_REQUIRED_CAMERA_IDS, production);
  const credentialErrors = [...credentialSet.errors, ...requiredSet.errors];
  const boundCameraIds = credentialCameraIds(credentialSet.credentials);
  const missingCameraIds = requiredSet.ids.filter(cameraId => !boundCameraIds.includes(cameraId));
  const maxSkewSeconds = Math.max(30, Math.min(900, Number(env.CAMERA_INGEST_MAX_SKEW_SECONDS || 300)));
  const perCameraConfigured = credentialSet.configured && credentialErrors.length === 0 && credentialSet.credentials.length > 0;
  const perCameraReady = perCameraConfigured && missingCameraIds.length === 0;
  const sharedDevelopmentReady = !credentialSet.configured && !production && secret.length >= 32;
  const ready = enabled && (perCameraReady || sharedDevelopmentReady);
  const mode = perCameraConfigured ? "per-camera" : sharedDevelopmentReady ? "shared-development" : enabled ? "unconfigured" : "disabled";
  let reason = null;
  if (!enabled) {
    reason = "Camera metric ingestion is disabled.";
  } else if (credentialErrors.length) {
    reason = credentialErrors[0];
  } else if (perCameraConfigured && missingCameraIds.length) {
    reason = `Camera ingest credentials are missing for: ${missingCameraIds.join(", ")}.`;
  } else if (production && !credentialSet.configured) {
    reason = "Production camera ingestion requires CAMERA_INGEST_KEYS with per-camera credentials.";
  } else if (secret.length < 32 && !credentialSet.configured) {
    reason = "CAMERA_INGEST_SECRET must be at least 32 characters for development, or configure CAMERA_INGEST_KEYS.";
  } else if (!ready) {
    reason = "Camera ingest credentials are not ready.";
  }
  return {
    enabled,
    ready,
    production,
    mode,
    secret,
    credentials: credentialSet.credentials,
    credentialErrors,
    requiredCameraIds: requiredSet.ids,
    missingCameraIds,
    maxSkewSeconds,
    reason
  };
}

export function cameraCredentialReadiness(configInput, cameraId) {
  const config = configInput ?? cameraIngestConfig();
  const normalizedCameraId = String(cameraId || "").trim();
  if (!config.ready) return { ready: false, mode: config.mode, keyCount: 0, reason: config.reason };
  if (config.mode === "shared-development") {
    return { ready: true, mode: config.mode, keyCount: 1, reason: null };
  }
  const keyCount = config.credentials.filter(item => item.cameraId === normalizedCameraId).length;
  return {
    ready: keyCount > 0,
    mode: config.mode,
    keyCount,
    reason: keyCount > 0 ? null : `No active camera ingest credential is bound to ${normalizedCameraId || "this camera"}.`
  };
}

export function publicCameraIngestReadiness(config = cameraIngestConfig()) {
  const boundCameraIds = credentialCameraIds(config.credentials || []);
  return {
    enabled: config.enabled,
    ready: config.ready,
    mode: config.mode,
    maxSkewSeconds: config.maxSkewSeconds,
    credentialCount: config.credentials?.length || (config.mode === "shared-development" ? 1 : 0),
    cameraCount: boundCameraIds.length,
    boundCameraIds,
    rotatingCameraIds: rotatingCameraIds(config.credentials || []),
    requiredCameraCount: config.requiredCameraIds?.length || 0,
    missingCameraIds: config.missingCameraIds || [],
    reason: config.reason
  };
}

export function signCameraPayload(rawBody, timestamp, secret, options = {}) {
  const keyId = String(options.keyId || "").trim();
  const canonical = keyId
    ? `camera:v1:${keyId}:${timestamp}:${rawBody}`
    : `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifyCameraIngestSignature({ rawBody, timestamp, signature, keyId, cameraId }, options = {}) {
  const config = options.config ?? cameraIngestConfig(options.env);
  if (!config.ready) return { verified: false, reason: "ingest_not_ready" };
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return { verified: false, reason: "invalid_timestamp" };
  const nowMs = options.nowMs ?? Date.now();
  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > config.maxSkewSeconds) return { verified: false, reason: "timestamp_outside_window" };

  let credential;
  if (config.mode === "per-camera") {
    const normalizedKeyId = String(keyId || "").trim();
    if (!normalizedKeyId) return { verified: false, reason: "missing_key_id" };
    credential = config.credentials.find(item => item.keyId === normalizedKeyId);
    if (!credential) return { verified: false, reason: "unknown_key_id" };
    if (credential.cameraId !== String(cameraId || "").trim()) {
      return { verified: false, reason: "credential_camera_mismatch" };
    }
  } else {
    credential = { keyId: null, cameraId: String(cameraId || "").trim() || null, secret: config.secret };
  }

  const received = String(signature || "").replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(received)) return { verified: false, reason: "invalid_signature" };
  const expected = signCameraPayload(rawBody, String(timestamp), credential.secret, { keyId: credential.keyId });
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  const verified = expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  return {
    verified,
    reason: verified ? "ok" : "signature_mismatch",
    ageSeconds: Math.round(ageSeconds),
    mode: config.mode,
    keyId: verified ? credential.keyId : null,
    cameraId: verified ? credential.cameraId : null
  };
}

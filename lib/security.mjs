import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REDACTED = "[REDACTED]";

function normalizedKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function sensitiveAuditKey(key) {
  const normalized = normalizedKey(key);
  if (!normalized) return false;
  if (["authorization", "cookie", "setcookie", "apikey", "signature", "rawbody", "filecontent", "contentbase64"].includes(normalized)) return true;
  return normalized === "token"
    || normalized.endsWith("accesstoken")
    || normalized.endsWith("refreshtoken")
    || normalized.endsWith("password")
    || normalized.endsWith("secret");
}

export function normalizeRequestId(value, { idFactory = randomUUID } = {}) {
  const candidate = Array.isArray(value) ? "" : String(value || "").trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `req_${idFactory()}`;
}

export function redactAuditValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map(item => redactAuditValue(item, seen));
    seen.delete(value);
    return output;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = sensitiveAuditKey(key) ? REDACTED : redactAuditValue(item, seen);
  }
  seen.delete(value);
  return output;
}

export function safeErrorResponse(error, { production = false } = {}) {
  if (error?.statusCode === 413) {
    return { status: 413, message: String(error.message || "Request body is too large.") };
  }
  return {
    status: 500,
    message: production ? "Internal server error." : String(error?.message || "Internal server error.")
  };
}

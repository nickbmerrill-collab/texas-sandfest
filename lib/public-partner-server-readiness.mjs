import { DEFAULT_EVENT_ID } from "./event-context.mjs";

function text(value, max = 100) {
  return String(value ?? "").trim().slice(0, max);
}

export function publicPartnerServerReadiness({
  eventId = DEFAULT_EVENT_ID,
  intakeAvailable = false,
  recoveryAvailable = false
} = {}) {
  const intakeReady = intakeAvailable === true;
  return {
    eventId: text(eventId) || DEFAULT_EVENT_ID,
    intakeAvailable: intakeReady,
    recoveryAvailable: intakeReady && recoveryAvailable === true
  };
}

export function publicPartnerServerReadinessSafety(input, { eventId = DEFAULT_EVENT_ID } = {}) {
  const errors = [];
  const allowedKeys = new Set(["eventId", "intakeAvailable", "recoveryAvailable"]);
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const unexpectedKeys = Object.keys(source).filter(key => !allowedKeys.has(key));
  if (unexpectedKeys.length) errors.push(`Unexpected partner readiness fields: ${unexpectedKeys.join(", ")}.`);
  if (source.eventId !== eventId) errors.push(`Partner readiness must match ${eventId}.`);
  if (typeof source.intakeAvailable !== "boolean") errors.push("Partner intake availability must be explicit.");
  if (typeof source.recoveryAvailable !== "boolean") errors.push("Partner recovery availability must be explicit.");
  if (source.recoveryAvailable === true && source.intakeAvailable !== true) {
    errors.push("Partner recovery cannot be available while partner intake is unavailable.");
  }
  return { ready: errors.length === 0, errors: [...new Set(errors)] };
}

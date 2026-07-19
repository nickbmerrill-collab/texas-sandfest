import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withJsonFileLock } from "./safe-json-store.mjs";

export const RUNTIME_OWNERSHIP_ERROR_CODE = "SANDFEST_RUNTIME_OWNERSHIP_MISMATCH";
const runtimeOwnershipContext = new AsyncLocalStorage();

export function normalizeRuntimeOwnerId(value) {
  const ownerId = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{16,128}$/.test(ownerId) ? ownerId : "";
}

export function resolveRuntimeRoot(codeRoot, env = process.env) {
  const base = path.resolve(codeRoot);
  const configured = String(env.SANDFEST_RUNTIME_ROOT || "").trim();
  return configured ? path.resolve(base, configured) : base;
}

export function runtimeRootProfile(codeRoot, runtimeRoot) {
  const code = path.resolve(codeRoot);
  const runtime = path.resolve(runtimeRoot);
  return {
    isolated: code !== runtime,
    mode: code === runtime ? "repository" : "isolated"
  };
}

function ownershipConfigured(env) {
  const configuredRoot = String(env.SANDFEST_RUNTIME_ROOT || "").trim();
  const configuredOwnerId = normalizeRuntimeOwnerId(env.SANDFEST_RUNTIME_OWNER_ID);
  return { configured: Boolean(configuredRoot || configuredOwnerId), configuredOwnerId };
}

function assertRuntimeOwnershipMarker(marker, configuredOwnerId) {
  const rawOwnerId = String(marker?.runtimeOwnerId || "").trim();
  const ownerId = marker?.kind === "synthetic-board-demonstration"
    ? normalizeRuntimeOwnerId(rawOwnerId)
    : "";
  if (rawOwnerId && !ownerId) throw new Error("Runtime ownership marker contains an invalid owner ID.");
  if (!ownerId) return { required: false };
  if (configuredOwnerId !== ownerId) {
    const error = new Error("This process no longer owns the supervised board runtime. Stop it and use the active board-demo session.");
    error.code = RUNTIME_OWNERSHIP_ERROR_CODE;
    throw error;
  }
  return { required: true };
}

async function readRuntimeMarker(runtimeRoot) {
  try {
    return JSON.parse(await readFile(path.join(path.resolve(runtimeRoot), "board-runtime.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Runtime ownership marker is invalid: ${error.message}`);
  }
}

export async function assertRuntimeOwnership(runtimeRoot, env = process.env) {
  const ownership = ownershipConfigured(env);
  if (!ownership.configured) return { required: false };
  return assertRuntimeOwnershipMarker(await readRuntimeMarker(runtimeRoot), ownership.configuredOwnerId);
}

export async function withRuntimeOwnership(runtimeRoot, operation, env = process.env) {
  const ownership = ownershipConfigured(env);
  if (!ownership.configured) return operation();
  const resolvedRoot = path.resolve(runtimeRoot);
  const activeOwnership = runtimeOwnershipContext.getStore();
  if (activeOwnership?.runtimeRoot === resolvedRoot && activeOwnership.ownerId === ownership.configuredOwnerId) {
    return operation();
  }
  const markerPath = path.join(resolvedRoot, "board-runtime.json");
  const marker = await readRuntimeMarker(runtimeRoot);
  assertRuntimeOwnershipMarker(marker, ownership.configuredOwnerId);
  if (marker?.kind !== "synthetic-board-demonstration") return operation();
  return withJsonFileLock(markerPath, async () => {
    assertRuntimeOwnershipMarker(await readRuntimeMarker(runtimeRoot), ownership.configuredOwnerId);
    return runtimeOwnershipContext.run({
      runtimeRoot: resolvedRoot,
      ownerId: ownership.configuredOwnerId
    }, operation);
  });
}

// Atomic JSON document store with per-key mutexes.
//
// Enterprise single-node file mode: prevents lost updates under concurrent
// checkouts/stamps/votes. Production multi-instance should set
// SANDFEST_DATABASE_URL so platform-data.mjs uses Postgres instead.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const chains = new Map();

function withKeyLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const next = prev.catch(() => {}).then(() => gate);
  chains.set(key, next);
  return prev.catch(() => {}).then(fn).finally(() => {
    release();
    if (chains.get(key) === next) chains.delete(key);
  });
}

async function atomicWriteJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJsonFileAtomic(filePath, data) {
  return withKeyLock(filePath, () => atomicWriteJson(filePath, data));
}

/** Read-modify-write under a per-path mutex. `mutator` receives current data and returns next. */
export async function updateJsonFile(filePath, mutator, { fallback = null } = {}) {
  return withKeyLock(filePath, async () => {
    const current = await readJsonFile(filePath, fallback);
    const next = await mutator(current);
    if (next !== undefined) {
      await atomicWriteJson(filePath, next);
    }
    return next;
  });
}

export function createMemoryRateLimiter({ windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    check(key, limit) {
      const now = Date.now();
      const current = buckets.get(key);
      const bucket = current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);
      const remaining = Math.max(0, limit - bucket.count);
      const allowed = bucket.count <= limit;
      return {
        allowed,
        remaining,
        resetAt: bucket.resetAt,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    },
    // Periodic prune to avoid unbounded map growth under rotating IPs.
    prune() {
      const now = Date.now();
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
    }
  };
}

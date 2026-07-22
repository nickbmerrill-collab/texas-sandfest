// Atomic JSON document store with per-key and interprocess locks.
//
// Single-node file mode: prevents lost updates across the API and worker
// processes. Production multi-instance should set
// SANDFEST_DATABASE_URL so platform-data.mjs uses Postgres instead.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const chains = new Map();
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 15_000;
const OWNER_WRITE_GRACE_MS = 250;
const MAX_LOCK_AGE_MS = 60_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

async function staleLock(lockPath) {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const owner = await readLockOwner(lockPath);
  if (owner?.pid) return !processIsAlive(Number(owner.pid)) || Date.now() - lockStat.mtimeMs > MAX_LOCK_AGE_MS;
  return Date.now() - lockStat.mtimeMs > OWNER_WRITE_GRACE_MS;
}

async function discardStaleLock(lockPath, token) {
  const stalePath = `${lockPath}.stale.${token}`;
  try {
    await rename(lockPath, stalePath);
    await rm(stalePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (["ENOENT", "EEXIST", "ENOTEMPTY"].includes(error?.code)) return false;
    throw error;
  }
}

async function acquireFileLock(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  const token = `${process.pid}.${startedAt}.${Math.random().toString(36).slice(2)}`;
  while (true) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() }), "utf8");
      } catch (error) {
        // A contender can reap an ownerless lock while this process is paused
        // between mkdir and writeFile. The shared path may already belong to a
        // newer contender, so retry without removing it.
        if (error?.code === "ENOENT") {
          await sleep(LOCK_RETRY_MS);
          continue;
        }
        const owner = await readLockOwner(lockPath);
        if (owner?.token === token) await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        const owner = await readLockOwner(lockPath);
        if (owner?.token === token) await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await staleLock(lockPath) && await discardStaleLock(lockPath, token)) continue;
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for the local data lock for ${path.basename(filePath)}.`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function withFileLock(filePath, fn) {
  const release = await acquireFileLock(filePath);
  try {
    return await fn();
  } finally {
    await release();
  }
}

export function withJsonFileLock(filePath, fn) {
  return withKeyLock(filePath, () => withFileLock(filePath, fn));
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
  return withJsonFileLock(filePath, () => atomicWriteJson(filePath, data));
}

/** Read-modify-write under a per-path mutex. `mutator` receives current data and returns next. */
export async function updateJsonFile(filePath, mutator, { fallback = null } = {}) {
  return withJsonFileLock(filePath, async () => {
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

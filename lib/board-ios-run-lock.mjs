import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_RETRY_MS = 250;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000;
const OWNER_WRITE_GRACE_MS = 1_000;
const WAIT_NOTICE_INTERVAL_MS = 30_000;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

async function lockIsStale(lockPath) {
  const owner = await readOwner(lockPath);
  if (owner?.pid) return !processIsAlive(Number(owner.pid));

  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs > OWNER_WRITE_GRACE_MS;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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

export async function acquireBoardIOSRunLock(lockPath, {
  retryMs = DEFAULT_RETRY_MS,
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  onWait = () => {}
} = {}) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  const token = `${process.pid}.${startedAt}.${Math.random().toString(36).slice(2)}`;
  let nextNoticeAt = startedAt;

  while (true) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({
          pid: process.pid,
          token,
          acquiredAt: new Date().toISOString()
        }, null, 2)}\n`, "utf8");
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }

      return async () => {
        const owner = await readOwner(lockPath);
        if (owner?.token === token) await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath) && await discardStaleLock(lockPath, token)) continue;

      const now = Date.now();
      const owner = await readOwner(lockPath);
      if (now >= nextNoticeAt) {
        onWait(owner);
        nextNoticeAt = now + WAIT_NOTICE_INTERVAL_MS;
      }
      if (now - startedAt >= waitTimeoutMs) {
        const ownerLabel = owner?.pid ? ` owned by PID ${owner.pid}` : "";
        throw new Error(`Timed out waiting for the active iOS board rehearsal${ownerLabel}.`);
      }
      await delay(retryMs);
    }
  }
}

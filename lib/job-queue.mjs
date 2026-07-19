// Durable async job queue for partner email, SMS, QuickBooks, and dispatch work.
// File mode: data/processed/job-queue/*.json
// Postgres mode: platform_jobs table (schema.sql)

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { assertRuntimeOwnership, withRuntimeOwnership } from "./runtime-root.mjs";

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MIN_LEASE_MS = 10_000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function usePostgres() {
  return Boolean(process.env.SANDFEST_DATABASE_URL);
}

function queueDir(root) {
  const configured = String(process.env.SANDFEST_JOB_QUEUE_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.join(root, "data", "processed", "job-queue");
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function leaseDuration(value) {
  return boundedInteger(value ?? process.env.SANDFEST_JOB_LEASE_MS, DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS);
}

function workerIdentity(value) {
  return String(value || process.env.SANDFEST_WORKER_ID || `${hostname()}:${process.pid}`).trim().slice(0, 200);
}

function instant(value = Date.now()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid queue timestamp.");
  return date;
}

function leaseExpiry(lockedAt, leaseMs) {
  const timestamp = Date.parse(lockedAt || "");
  return Number.isFinite(timestamp) ? new Date(timestamp + leaseMs).toISOString() : null;
}

function publicJob(job, leaseMs = leaseDuration()) {
  if (!job) return null;
  const { leaseToken: _leaseToken, lease_token: _leaseTokenRow, ...safe } = job;
  return {
    ...safe,
    leaseExpiresAt: safe.status === "running" ? leaseExpiry(safe.lockedAt, leaseMs) : null
  };
}

function rowToJob(row, { includeLeaseToken = false, leaseMs = leaseDuration() } = {}) {
  const job = {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    payload: row.payload,
    lastError: row.last_error,
    runAfter: row.run_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    failureHandledAt: row.failure_handled_at
  };
  if (includeLeaseToken) job.leaseToken = row.lease_token;
  return includeLeaseToken ? job : publicJob(job, leaseMs);
}

function staleLease(job, now, leaseMs) {
  if (job.status !== "running") return false;
  const lockedAt = Date.parse(job.lockedAt || job.updatedAt || job.createdAt || "");
  return !Number.isFinite(lockedAt) || lockedAt + leaseMs <= now.getTime();
}

function recoveryError() {
  return "Worker lease expired before completion; job recovered automatically.";
}

function idempotentJobId(type, key) {
  const value = String(key || "").trim().slice(0, 500);
  if (!value) return null;
  const digest = createHash("sha256").update(`${type}\0${value}`).digest("hex");
  return `job_${digest.slice(0, 40)}`;
}

async function existingFileJob(dir, jobId) {
  const candidates = [`${jobId}.json`, `running-${jobId}.json`];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(path.join(dir, candidate), "utf8"));
    } catch {
      // The job may be moving between queued and running names; check the next state.
    }
  }
  return null;
}

function resetRecoveredJob(job, now) {
  const failed = Number(job.attempts || 0) >= Number(job.maxAttempts || 5);
  return {
    ...job,
    status: failed ? "failed" : "queued",
    lastError: recoveryError(),
    runAfter: failed ? job.runAfter : now.toISOString(),
    updatedAt: now.toISOString(),
    lockedBy: null,
    lockedAt: null,
    leaseToken: null,
    failureHandledAt: null
  };
}

async function recoverStalePostgresJobs(pool, now, leaseMs) {
  const cutoff = new Date(now.getTime() - leaseMs).toISOString();
  const { rowCount } = await pool.query(
    `UPDATE platform_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         last_error = $2,
         run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE $1 END,
         locked_by = NULL,
         locked_at = NULL,
         lease_token = NULL,
         failure_handled_at = NULL,
         updated_at = $1
     WHERE status = 'running' AND COALESCE(locked_at, updated_at) <= $3`,
    [now.toISOString(), recoveryError(), cutoff]
  );
  return rowCount;
}

async function recoverStaleFileJobs(dir, now, leaseMs) {
  const files = (await readdir(dir)).filter(file => file.startsWith("running-") && file.endsWith(".json"));
  let recovered = 0;
  for (const file of files) {
    const runningPath = path.join(dir, file);
    let job;
    try {
      job = JSON.parse(await readFile(runningPath, "utf8"));
    } catch {
      continue;
    }
    if (!staleLease({ ...job, status: "running" }, now, leaseMs)) continue;
    const recoveryPath = path.join(dir, `recovering-${randomUUID()}-${file}`);
    try {
      await rename(runningPath, recoveryPath);
    } catch {
      continue;
    }
    const next = resetRecoveredJob(job, now);
    const target = path.join(dir, `${next.id}.json`);
    await writeFile(target, `${JSON.stringify(next, null, 2)}\n`);
    await unlink(recoveryPath).catch(() => {});
    recovered += 1;
  }
  return recovered;
}

export function jobQueueConfig(options = {}) {
  const leaseMs = leaseDuration(options.leaseMs);
  return {
    leaseMs,
    workerId: workerIdentity(options.workerId)
  };
}

export async function enqueueJob(root, {
  type,
  payload = {},
  maxAttempts = 5,
  runAfter = null,
  idempotencyKey = null
} = {}) {
  await assertRuntimeOwnership(root);
  if (!type) throw new Error("job type is required");
  const now = new Date().toISOString();
  const deterministicId = idempotentJobId(type, idempotencyKey);
  const job = {
    id: deterministicId || `job_${randomUUID()}`,
    type,
    payload,
    status: "queued",
    attempts: 0,
    maxAttempts: boundedInteger(maxAttempts, 5, 1, 25),
    createdAt: now,
    updatedAt: now,
    lastError: null,
    runAfter: runAfter ? instant(runAfter).toISOString() : now,
    lockedBy: null,
    lockedAt: null,
    leaseToken: null,
    failureHandledAt: null
  };

  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const inserted = await pool.query(
      `INSERT INTO platform_jobs
       (id, type, status, attempts, max_attempts, payload, run_after, created_at, updated_at, locked_by, locked_at, lease_token, failure_handled_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NULL, NULL, NULL, NULL)
       ON CONFLICT (id) DO NOTHING`,
      [
        job.id, job.type, job.status, job.attempts, job.maxAttempts,
        JSON.stringify(job.payload), job.runAfter, job.createdAt, job.updatedAt
      ]
    );
    if (inserted.rowCount === 1 || !deterministicId) return publicJob(job);
    const existing = await pool.query(
      `SELECT id, type, status, attempts, max_attempts, payload, last_error, run_after,
              created_at, updated_at, locked_by, locked_at, lease_token, failure_handled_at
       FROM platform_jobs WHERE id = $1`,
      [job.id]
    );
    if (!existing.rowCount) throw new Error("Idempotent job could not be recovered after enqueue conflict.");
    return rowToJob(existing.rows[0]);
  }

  return withRuntimeOwnership(root, async () => {
    const dir = queueDir(root);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${job.id}.json`);
    if (deterministicId) {
      const existing = await existingFileJob(dir, job.id);
      if (existing) return publicJob(existing);
      try {
        await writeFile(file, `${JSON.stringify(job, null, 2)}\n`, { flag: "wx" });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const raced = await existingFileJob(dir, job.id);
        if (!raced) throw new Error("Idempotent job could not be recovered after enqueue conflict.");
        return publicJob(raced);
      }
    } else {
      await writeFile(file, `${JSON.stringify(job, null, 2)}\n`);
    }
    return publicJob(job);
  });
}

export async function claimNextJobs(root, { limit = 10, types = null, workerId = null, leaseMs = null, now = Date.now() } = {}) {
  await assertRuntimeOwnership(root);
  const claimTime = instant(now);
  const config = jobQueueConfig({ workerId, leaseMs });
  const claimLimit = boundedInteger(limit, 10, 1, 500);
  const typeFilter = Array.isArray(types) ? types.map(String).filter(Boolean) : null;

  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await recoverStalePostgresJobs(client, claimTime, config.leaseMs);
      const params = [claimTime.toISOString(), claimLimit];
      let typeClause = "";
      if (typeFilter?.length) {
        typeClause = " AND type = ANY($3)";
        params.push(typeFilter);
      }
      const { rows } = await client.query(
        `SELECT id, type, status, attempts, max_attempts, payload, last_error, run_after,
                created_at, updated_at, locked_by, locked_at, lease_token, failure_handled_at
         FROM platform_jobs
         WHERE status = 'queued' AND run_after <= $1${typeClause}
         ORDER BY run_after ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        params
      );
      const jobs = [];
      for (const row of rows) {
        const leaseToken = randomUUID();
        const updated = await client.query(
          `UPDATE platform_jobs
           SET status = 'running', attempts = attempts + 1, locked_by = $2,
               locked_at = $3, lease_token = $4, updated_at = $3
           WHERE id = $1
           RETURNING id, type, status, attempts, max_attempts, payload, last_error, run_after,
                     created_at, updated_at, locked_by, locked_at, lease_token, failure_handled_at`,
          [row.id, config.workerId, claimTime.toISOString(), leaseToken]
        );
        jobs.push(rowToJob(updated.rows[0], { includeLeaseToken: true, leaseMs: config.leaseMs }));
      }
      await client.query("COMMIT");
      return jobs;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return withRuntimeOwnership(root, async () => {
    const dir = queueDir(root);
    await mkdir(dir, { recursive: true });
    await recoverStaleFileJobs(dir, claimTime, config.leaseMs);
    const files = (await readdir(dir))
      .filter(file => file.endsWith(".json") && !file.startsWith("running-") && !file.startsWith("recovering-"))
      .sort();
    const claimed = [];
    for (const file of files) {
      if (claimed.length >= claimLimit) break;
      const full = path.join(dir, file);
      let job;
      try {
        job = JSON.parse(await readFile(full, "utf8"));
      } catch {
        continue;
      }
      if (job.status !== "queued") continue;
      if (typeFilter?.length && !typeFilter.includes(job.type)) continue;
      if (job.runAfter && Date.parse(job.runAfter) > claimTime.getTime()) continue;
      const runningPath = path.join(dir, `running-${job.id}.json`);
      try {
        await rename(full, runningPath);
      } catch {
        continue;
      }
      job.status = "running";
      job.attempts = Number(job.attempts || 0) + 1;
      job.updatedAt = claimTime.toISOString();
      job.lockedBy = config.workerId;
      job.lockedAt = claimTime.toISOString();
      job.leaseToken = randomUUID();
      await writeFile(runningPath, `${JSON.stringify(job, null, 2)}\n`);
      claimed.push(job);
    }
    return claimed;
  });
}

export async function completeJob(root, job, { error = null, now = Date.now(), terminalHandled = false } = {}) {
  await assertRuntimeOwnership(root);
  if (!job?.id || !job?.leaseToken) return { ok: false, reason: "claim_missing" };
  const completedAt = instant(now);
  const failed = Number(job.attempts || 1) >= Number(job.maxAttempts || 5);
  const retryAt = new Date(completedAt.getTime() + Math.min(300_000, 2 ** Number(job.attempts || 1) * 1000)).toISOString();

  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const result = error
      ? await pool.query(
        `UPDATE platform_jobs
         SET status = $3, last_error = $4, run_after = $5, updated_at = $6,
             locked_by = NULL, locked_at = NULL, lease_token = NULL,
             failure_handled_at = CASE WHEN $3 = 'failed' AND $7 THEN $6 ELSE NULL END
         WHERE id = $1 AND status = 'running' AND lease_token = $2`,
        [job.id, job.leaseToken, failed ? "failed" : "queued", String(error).slice(0, 1000), failed ? job.runAfter : retryAt, completedAt.toISOString(), terminalHandled]
      )
      : await pool.query(
        `UPDATE platform_jobs
         SET status = 'done', last_error = NULL, updated_at = $3,
             locked_by = NULL, locked_at = NULL, lease_token = NULL
         WHERE id = $1 AND status = 'running' AND lease_token = $2`,
        [job.id, job.leaseToken, completedAt.toISOString()]
      );
    return result.rowCount === 1
      ? { ok: true, status: error ? (failed ? "failed" : "queued") : "done" }
      : { ok: false, reason: "claim_lost" };
  }

  return withRuntimeOwnership(root, async () => {
    const dir = queueDir(root);
    const runningPath = path.join(dir, `running-${job.id}.json`);
    let current;
    try {
      current = JSON.parse(await readFile(runningPath, "utf8"));
    } catch {
      return { ok: false, reason: "claim_lost" };
    }
    if (current.status !== "running" || current.leaseToken !== job.leaseToken) {
      return { ok: false, reason: "claim_lost" };
    }
    if (error) {
      current.status = failed ? "failed" : "queued";
      current.lastError = String(error).slice(0, 1000);
      current.runAfter = failed ? current.runAfter : retryAt;
      current.updatedAt = completedAt.toISOString();
      current.lockedBy = null;
      current.lockedAt = null;
      current.leaseToken = null;
      current.failureHandledAt = failed && terminalHandled ? completedAt.toISOString() : null;
      const out = path.join(dir, `${job.id}.json`);
      await writeFile(out, `${JSON.stringify(current, null, 2)}\n`);
      await unlink(runningPath).catch(() => {});
      return { ok: true, status: current.status };
    }
    current.status = "done";
    current.lastError = null;
    current.updatedAt = completedAt.toISOString();
    current.lockedBy = null;
    current.lockedAt = null;
    current.leaseToken = null;
    await writeFile(path.join(dir, `${job.id}.json`), `${JSON.stringify(current, null, 2)}\n`);
    await unlink(runningPath).catch(() => {});
    return { ok: true, status: "done" };
  });
}

function summarizeQueueJobs(jobs, { now = Date.now(), leaseMs = leaseDuration() } = {}) {
  const at = instant(now);
  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  let staleRunning = 0;
  let dueQueued = 0;
  let unhandledFailed = 0;
  let oldestDueAt = null;
  for (const job of jobs) {
    if (Object.hasOwn(counts, job.status)) counts[job.status] += 1;
    if (staleLease(job, at, leaseMs)) staleRunning += 1;
    if (job.status === "failed" && !job.failureHandledAt) unhandledFailed += 1;
    if (job.status === "queued" && Date.parse(job.runAfter || "") <= at.getTime()) {
      dueQueued += 1;
      if (!oldestDueAt || Date.parse(job.runAfter) < Date.parse(oldestDueAt)) oldestDueAt = job.runAfter;
    }
  }
  return {
    total: jobs.length,
    ...counts,
    pending: counts.queued + counts.running,
    dueQueued,
    staleRunning,
    unhandledFailed,
    oldestDueAt,
    operational: staleRunning === 0 && unhandledFailed === 0,
    needsAttention: staleRunning > 0 || unhandledFailed > 0
  };
}

export async function getQueueHealth(root, options = {}) {
  await assertRuntimeOwnership(root);
  const at = instant(options.now ?? Date.now());
  const leaseMs = leaseDuration(options.leaseMs);
  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const cutoff = new Date(at.getTime() - leaseMs).toISOString();
    const { rows } = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'queued')::int AS queued,
         count(*) FILTER (WHERE status = 'running')::int AS running,
         count(*) FILTER (WHERE status = 'done')::int AS done,
         count(*) FILTER (WHERE status = 'failed')::int AS failed,
         count(*) FILTER (WHERE status = 'failed' AND failure_handled_at IS NULL)::int AS unhandled_failed,
         count(*) FILTER (WHERE status = 'queued' AND run_after <= $1)::int AS due_queued,
         count(*) FILTER (WHERE status = 'running' AND COALESCE(locked_at, updated_at) <= $2)::int AS stale_running,
         min(run_after) FILTER (WHERE status = 'queued' AND run_after <= $1) AS oldest_due_at
       FROM platform_jobs`,
      [at.toISOString(), cutoff]
    );
    const row = rows[0];
    return {
      total: row.total,
      queued: row.queued,
      running: row.running,
      done: row.done,
      failed: row.failed,
      unhandledFailed: row.unhandled_failed,
      pending: row.queued + row.running,
      dueQueued: row.due_queued,
      staleRunning: row.stale_running,
      oldestDueAt: row.oldest_due_at,
      operational: row.stale_running === 0 && row.unhandled_failed === 0,
      needsAttention: row.stale_running > 0 || row.unhandled_failed > 0,
      leaseMs
    };
  }
  const jobs = await listJobs(root, { limit: 100_000, leaseMs });
  return { ...summarizeQueueJobs(jobs, { now: at, leaseMs }), leaseMs };
}

export async function listJobs(root, { limit = 50, leaseMs = null, statuses = null, unhandledOnly = false } = {}) {
  await assertRuntimeOwnership(root);
  const jobLimit = boundedInteger(limit, 50, 1, 100_000);
  const duration = leaseDuration(leaseMs);
  const statusFilter = Array.isArray(statuses) ? statuses.map(String).filter(Boolean) : null;
  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const params = [jobLimit];
    const clauses = [];
    if (statusFilter?.length) {
      params.push(statusFilter);
      clauses.push(`status = ANY($${params.length})`);
    }
    if (unhandledOnly) clauses.push("failure_handled_at IS NULL");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, type, status, attempts, max_attempts, payload, last_error, run_after,
              created_at, updated_at, locked_by, locked_at, lease_token, failure_handled_at
       FROM platform_jobs ${where} ORDER BY created_at DESC LIMIT $1`,
      params
    );
    return rows.map(row => rowToJob(row, { leaseMs: duration }));
  }
  const dir = queueDir(root);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir))
    .filter(file => file.endsWith(".json") && !file.startsWith("recovering-"))
    .sort()
    .reverse();
  const jobs = [];
  for (const file of files) {
    if (jobs.length >= jobLimit) break;
    try {
      const job = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      if (statusFilter?.length && !statusFilter.includes(job.status)) continue;
      if (unhandledOnly && job.failureHandledAt) continue;
      jobs.push(publicJob(job, duration));
    } catch {
      // Skip malformed local records; readiness still verifies directory access.
    }
  }
  return jobs;
}

export async function markTerminalJobHandled(root, jobId, { now = Date.now() } = {}) {
  await assertRuntimeOwnership(root);
  if (!jobId) return { ok: false, reason: "job_missing" };
  const handledAt = instant(now).toISOString();
  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const result = await pool.query(
      `UPDATE platform_jobs SET failure_handled_at = $2, updated_at = $2
       WHERE id = $1 AND status = 'failed' AND failure_handled_at IS NULL`,
      [jobId, handledAt]
    );
    return result.rowCount === 1 ? { ok: true, handledAt } : { ok: false, reason: "not_unhandled_failure" };
  }
  return withRuntimeOwnership(root, async () => {
    const file = path.join(queueDir(root), `${jobId}.json`);
    let job;
    try {
      job = JSON.parse(await readFile(file, "utf8"));
    } catch {
      return { ok: false, reason: "job_missing" };
    }
    if (job.status !== "failed" || job.failureHandledAt) return { ok: false, reason: "not_unhandled_failure" };
    job.failureHandledAt = handledAt;
    job.updatedAt = handledAt;
    await writeFile(file, `${JSON.stringify(job, null, 2)}\n`);
    return { ok: true, handledAt };
  });
}

// Durable async job queue for SMS fan-out, QuickBooks sync, etc.
// File mode: data/processed/job-queue/*.json
// Postgres mode: platform_jobs table (schema.sql)

import { mkdir, readdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function usePostgres() {
  return Boolean(process.env.SANDFEST_DATABASE_URL);
}

function queueDir(root) {
  return path.join(root, "data", "processed", "job-queue");
}

export async function enqueueJob(root, { type, payload = {}, maxAttempts = 5 } = {}) {
  if (!type) throw new Error("job type is required");
  const job = {
    id: `job_${randomUUID()}`,
    type,
    payload,
    status: "queued",
    attempts: 0,
    maxAttempts,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null,
    runAfter: new Date().toISOString()
  };

  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    await pool.query(
      `INSERT INTO platform_jobs (id, type, status, attempts, max_attempts, payload, run_after, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        job.id, job.type, job.status, job.attempts, job.maxAttempts,
        JSON.stringify(job.payload), job.runAfter, job.createdAt, job.updatedAt
      ]
    );
    return job;
  }

  const dir = queueDir(root);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${job.id}.json`);
  await writeFile(file, `${JSON.stringify(job, null, 2)}\n`);
  return job;
}

export async function claimNextJobs(root, { limit = 10, types = null } = {}) {
  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const params = [new Date().toISOString(), limit];
      let typeClause = "";
      if (Array.isArray(types) && types.length) {
        typeClause = ` AND type = ANY($3)`;
        params.push(types);
      }
      const { rows } = await client.query(
        `SELECT id, type, status, attempts, max_attempts, payload, last_error, run_after, created_at, updated_at
         FROM platform_jobs
         WHERE status = 'queued' AND run_after <= $1${typeClause}
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        params
      );
      const jobs = [];
      for (const row of rows) {
        await client.query(
          `UPDATE platform_jobs SET status = 'running', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
          [row.id]
        );
        jobs.push({
          id: row.id,
          type: row.type,
          status: "running",
          attempts: row.attempts + 1,
          maxAttempts: row.max_attempts,
          payload: row.payload,
          lastError: row.last_error,
          runAfter: row.run_after,
          createdAt: row.created_at,
          updatedAt: new Date().toISOString()
        });
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

  const dir = queueDir(root);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort();
  const claimed = [];
  for (const file of files) {
    if (claimed.length >= limit) break;
    const full = path.join(dir, file);
    let job;
    try {
      job = JSON.parse(await readFile(full, "utf8"));
    } catch {
      continue;
    }
    if (job.status !== "queued") continue;
    if (types && !types.includes(job.type)) continue;
    if (job.runAfter && Date.parse(job.runAfter) > Date.now()) continue;
    job.status = "running";
    job.attempts = (job.attempts || 0) + 1;
    job.updatedAt = new Date().toISOString();
    const runningPath = path.join(dir, `running-${file}`);
    await writeFile(full, `${JSON.stringify(job, null, 2)}\n`);
    await rename(full, runningPath).catch(() => {});
    claimed.push(job);
  }
  return claimed;
}

export async function completeJob(root, job, { error = null } = {}) {
  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    if (error) {
      const failed = (job.attempts || 1) >= (job.maxAttempts || 5);
      const runAfter = new Date(Date.now() + Math.min(300_000, 2 ** (job.attempts || 1) * 1000)).toISOString();
      await pool.query(
        `UPDATE platform_jobs
         SET status = $2, last_error = $3, run_after = $4, updated_at = now()
         WHERE id = $1`,
        [job.id, failed ? "failed" : "queued", String(error).slice(0, 1000), failed ? job.runAfter : runAfter]
      );
    } else {
      await pool.query(
        `UPDATE platform_jobs SET status = 'done', last_error = null, updated_at = now() WHERE id = $1`,
        [job.id]
      );
    }
    return;
  }

  const dir = queueDir(root);
  const candidates = [
    path.join(dir, `running-${job.id}.json`),
    path.join(dir, `${job.id}.json`)
  ];
  for (const file of candidates) {
    try {
      const current = JSON.parse(await readFile(file, "utf8"));
      if (error) {
        const failed = (current.attempts || 1) >= (current.maxAttempts || 5);
        current.status = failed ? "failed" : "queued";
        current.lastError = String(error).slice(0, 1000);
        current.runAfter = failed
          ? current.runAfter
          : new Date(Date.now() + Math.min(300_000, 2 ** (current.attempts || 1) * 1000)).toISOString();
        current.updatedAt = new Date().toISOString();
        const out = path.join(dir, `${job.id}.json`);
        await writeFile(out, `${JSON.stringify(current, null, 2)}\n`);
        if (file !== out) await unlink(file).catch(() => {});
      } else {
        await unlink(file).catch(() => {});
      }
      return;
    } catch {
      // try next path
    }
  }
}

export async function listJobs(root, { limit = 50 } = {}) {
  if (usePostgres()) {
    const { getPool, ensureSchema } = await import("./db/pool.mjs");
    await ensureSchema();
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, type, status, attempts, max_attempts, payload, last_error, run_after, created_at, updated_at
       FROM platform_jobs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      payload: row.payload,
      lastError: row.last_error,
      runAfter: row.run_after,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  const dir = queueDir(root);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit);
  const jobs = [];
  for (const file of files) {
    try {
      jobs.push(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    } catch {
      // skip
    }
  }
  return jobs;
}

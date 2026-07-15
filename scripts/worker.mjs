#!/usr/bin/env node
// Background worker for enterprise async jobs (SMS fan-out, QuickBooks hooks).
// Usage:
//   node scripts/worker.mjs
//   SANDFEST_WORKER_ONCE=true node scripts/worker.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../lib/load-env.mjs";
import { claimNextJobs, completeJob } from "../lib/job-queue.mjs";
import { sendAlertSms, smsConfigFromEnv } from "../lib/sms.mjs";

await loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLL_MS = Number(process.env.SANDFEST_WORKER_POLL_MS || 2000);
const ONCE = process.env.SANDFEST_WORKER_ONCE === "true";
const BATCH = Number(process.env.SANDFEST_WORKER_BATCH || 10);

async function handleJob(job) {
  switch (job.type) {
  case "sms.alert_fanout": {
    const phones = (job.payload.recipientPhones || []).map(p => ({ phone: p }));
    const result = await sendAlertSms(job.payload.alert || {}, phones, {
      limit: job.payload.limit || 500,
      config: smsConfigFromEnv()
    });
    if (result.failed > 0 && result.sent === 0 && !result.reason) {
      throw new Error(`SMS fan-out failed for all ${result.failed} recipients`);
    }
    console.log(`[worker] sms.alert_fanout job=${job.id} sent=${result.sent} failed=${result.failed} skipped=${result.skipped} reason=${result.reason || "ok"}`);
    return result;
  }
  case "quickbooks.sync_stub": {
    // Placeholder until QB credentials arrive — marks job done so pipeline is testable.
    console.log(`[worker] quickbooks.sync_stub job=${job.id} payload keys=${Object.keys(job.payload || {}).join(",")}`);
    return { ok: true, stub: true };
  }
  default:
    throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function tick() {
  const jobs = await claimNextJobs(ROOT, { limit: BATCH });
  for (const job of jobs) {
    try {
      await handleJob(job);
      await completeJob(ROOT, job);
    } catch (error) {
      console.error(`[worker] job ${job.id} error:`, error.message);
      await completeJob(ROOT, job, { error: error.message });
    }
  }
  return jobs.length;
}

console.log(`[worker] started root=${ROOT} poll=${POLL_MS}ms once=${ONCE}`);

if (ONCE) {
  const n = await tick();
  console.log(`[worker] processed ${n} job(s)`);
  process.exit(0);
}

let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

while (!stopped) {
  try {
    await tick();
  } catch (error) {
    console.error("[worker] tick failed:", error.message);
  }
  await new Promise(r => setTimeout(r, POLL_MS));
}

console.log("[worker] stopped");

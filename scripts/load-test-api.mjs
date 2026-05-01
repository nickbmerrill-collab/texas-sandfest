#!/usr/bin/env node

const baseUrl = (process.argv[2] || process.env.SANDFEST_API_BASE_URL || "http://127.0.0.1:8788").replace(/\/+$/, "");
const total = Number(process.env.SANDFEST_LOAD_TOTAL || process.argv[3] || 1000);
const concurrency = Number(process.env.SANDFEST_LOAD_CONCURRENCY || process.argv[4] || 50);
const paths = [
  "/health",
  "/ready",
  "/api/public/alert",
  "/api/public/bootstrap",
  "/api/public/tickets",
  "/api/public/sponsors"
];

const results = {
  total,
  concurrency,
  baseUrl,
  startedAt: new Date().toISOString(),
  ok: 0,
  failed: 0,
  statuses: {},
  latencies: []
};

let next = 0;

async function hit(index) {
  const path = paths[index % paths.length];
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`);
    const elapsed = performance.now() - started;
    results.latencies.push(elapsed);
    results.statuses[response.status] = (results.statuses[response.status] ?? 0) + 1;
    if (response.ok) results.ok += 1;
    else results.failed += 1;
    await response.arrayBuffer();
  } catch {
    results.failed += 1;
    results.latencies.push(performance.now() - started);
  }
}

async function worker() {
  while (next < total) {
    const index = next;
    next += 1;
    await hit(index);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

results.finishedAt = new Date().toISOString();
results.latencies.sort((a, b) => a - b);
results.p50 = percentile(50);
results.p95 = percentile(95);
results.p99 = percentile(99);
results.max = results.latencies.at(-1) ?? 0;

console.log(JSON.stringify({
  ...results,
  latencies: undefined
}, null, 2));

if (results.failed > 0) process.exitCode = 1;

function percentile(value) {
  if (results.latencies.length === 0) return 0;
  const index = Math.ceil((value / 100) * results.latencies.length) - 1;
  return Math.round(results.latencies[Math.max(0, index)] * 100) / 100;
}

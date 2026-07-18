#!/usr/bin/env node

import {
  runBoardCameraPlayback
} from "../lib/board-camera-playback.mjs";

const args = process.argv.slice(2);
const once = args.includes("--once") || process.env.SANDFEST_BOARD_CAMERA_ONCE === "true";
const intervalArg = args.find(arg => arg.startsWith("--interval="))?.split("=")[1];
const intervalMs = Math.max(2_000, Math.min(60_000, Number(intervalArg || process.env.SANDFEST_BOARD_CAMERA_INTERVAL_MS || 5_000)));
const apiBase = process.env.SANDFEST_API_BASE || "http://127.0.0.1:8806";
const adminToken = process.env.SANDFEST_ADMIN_API_TOKEN || "";
const ingestSecret = process.env.CAMERA_INGEST_SECRET || "";
const runId = String(process.env.SANDFEST_BOARD_CAMERA_RUN_ID || Date.now().toString(36));
const retryBaseMs = Number(process.env.SANDFEST_BOARD_CAMERA_RETRY_BASE_MS || 1_000);
const retryMaxMs = Number(process.env.SANDFEST_BOARD_CAMERA_RETRY_MAX_MS || 30_000);
const timeoutMs = Number(process.env.SANDFEST_BOARD_CAMERA_REQUEST_TIMEOUT_MS || 5_000);
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

try {
  await runBoardCameraPlayback({
    apiBase,
    adminToken,
    ingestSecret,
    runId,
    intervalMs,
    retryBaseMs,
    retryMaxMs,
    timeoutMs,
    once,
    shouldStop: () => stopping,
    onVerified({ target, recovered }) {
      console.log(`[board-cameras] ${recovered ? "reconnected to" : "verified"} ${target.runtime.label}`);
    },
    onTick(result) {
      const levels = result.observations.reduce((counts, item) => {
        const level = item.level || "unknown";
        counts[level] = (counts[level] || 0) + 1;
        return counts;
      }, {});
      console.log(`[board-cameras] cycle=${result.cycle} cameras=${result.cameras} heartbeats=${result.heartbeats} levels=${JSON.stringify(levels)} observedAt=${result.observedAt}`);
    },
    onRetry({ error, delayMs, consecutiveFailures, cycle }) {
      console.warn(`[board-cameras] transient API failure cycle=${cycle} attempt=${consecutiveFailures}; retrying in ${delayMs}ms: ${error.message}`);
    }
  });
  console.log(`[board-cameras] ${once ? "single cycle complete" : "stopped"}`);
} catch (error) {
  console.error(`[board-cameras] ${error.message}`);
  process.exitCode = 1;
}

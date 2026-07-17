#!/usr/bin/env node

import {
  runBoardCameraPlaybackTick,
  verifyBoardCameraPlaybackTarget
} from "../lib/board-camera-playback.mjs";

const args = process.argv.slice(2);
const once = args.includes("--once") || process.env.SANDFEST_BOARD_CAMERA_ONCE === "true";
const intervalArg = args.find(arg => arg.startsWith("--interval="))?.split("=")[1];
const intervalMs = Math.max(2_000, Math.min(60_000, Number(intervalArg || process.env.SANDFEST_BOARD_CAMERA_INTERVAL_MS || 5_000)));
const heartbeatEvery = Math.max(1, Math.round(15_000 / intervalMs));
const apiBase = process.env.SANDFEST_API_BASE || "http://127.0.0.1:8806";
const adminToken = process.env.SANDFEST_ADMIN_API_TOKEN || "";
const ingestSecret = process.env.CAMERA_INGEST_SECRET || "";
const runId = String(process.env.SANDFEST_BOARD_CAMERA_RUN_ID || Date.now().toString(36));
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

try {
  const target = await verifyBoardCameraPlaybackTarget({ apiBase });
  console.log(`[board-cameras] verified ${target.runtime.label}`);
  let cycle = 0;
  while (!stopping) {
    const result = await runBoardCameraPlaybackTick({
      apiBase: target.apiBase,
      adminToken,
      ingestSecret,
      runId,
      cycle,
      configure: cycle === 0,
      heartbeat: cycle % heartbeatEvery === 0,
      intervalSeconds: intervalMs / 1000,
      verifyTarget: false
    });
    const levels = result.observations.reduce((counts, item) => {
      const level = item.level || "unknown";
      counts[level] = (counts[level] || 0) + 1;
      return counts;
    }, {});
    console.log(`[board-cameras] cycle=${cycle} cameras=${result.cameras} heartbeats=${result.heartbeats} levels=${JSON.stringify(levels)} observedAt=${result.observedAt}`);
    cycle += 1;
    if (once) break;
    await sleep(intervalMs);
  }
  console.log(`[board-cameras] ${once ? "single cycle complete" : "stopped"}`);
} catch (error) {
  console.error(`[board-cameras] ${error.message}`);
  process.exitCode = 1;
}

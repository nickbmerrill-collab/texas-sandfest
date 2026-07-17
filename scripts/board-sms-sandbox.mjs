#!/usr/bin/env node

import { boardSmsSandboxConfig, startBoardSmsSandbox } from "../lib/board-sms-sandbox.mjs";

const config = boardSmsSandboxConfig();
let sandbox;

try {
  sandbox = await startBoardSmsSandbox({ config });
  console.log(`[board-sms] listening on ${sandbox.url} · reserved 555-01xx recipients only · signed callbacks to the board API`);
  const stop = async () => {
    await sandbox.close();
    console.log("[board-sms] stopped");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error(`[board-sms] ${error.message}`);
  process.exitCode = 1;
}

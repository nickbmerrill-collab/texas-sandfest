#!/usr/bin/env node

import { boardEmailSandboxConfig, startBoardEmailSandbox } from "../lib/board-email-sandbox.mjs";

const config = boardEmailSandboxConfig();
let sandbox;

try {
  sandbox = await startBoardEmailSandbox({ config });
  console.log(`[board-mail] listening on ${sandbox.url} · reserved example-domain recipients only · delivery webhook ${config.webhookUrl}`);
  const stop = async () => {
    await sandbox.close();
    console.log("[board-mail] stopped");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  console.error(`[board-mail] ${error.message}`);
  process.exitCode = 1;
}

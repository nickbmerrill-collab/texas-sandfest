#!/usr/bin/env node

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  boardDemoSessionPath,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";
import { createBoardLaunchdController } from "../lib/board-launchd-service.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const sessionIndex = args.findIndex(argument => argument === "--session-file");
const inlineSession = args.find(argument => argument.startsWith("--session-file="))?.split("=", 2)[1];
const sessionValue = inlineSession || (sessionIndex >= 0 ? args[sessionIndex + 1] : null);
if (sessionIndex >= 0 && !sessionValue) {
  console.error("[board-stop] --session-file requires a value.");
  process.exit(1);
}
const unknown = args.filter((argument, index) => {
  if (argument.startsWith("--session-file=")) return false;
  if (argument === "--session-file" || index === sessionIndex + 1) return false;
  return true;
});
if (unknown.length) {
  console.error(`[board-stop] Unknown option: ${unknown[0]}`);
  process.exit(1);
}

const sessionFile = sessionValue
  ? path.resolve(ROOT, sessionValue)
  : boardDemoSessionPath(process.env, { root: ROOT });

if (!sessionValue && process.platform === "darwin") {
  const launchd = createBoardLaunchdController({ root: ROOT });
  const service = await launchd.inspect();
  if ((service.installed || service.configured) && !service.owned) {
    console.error(`[board-stop] Refusing to stop ${service.label}; it is not owned by this checkout.`);
    process.exit(1);
  }
  if (service.installed) {
    await launchd.stop();
    console.log(`[board-stop] LaunchAgent ${service.label} unloaded; persistent configuration retained at ${service.plistPath}.`);
  }
}

const session = await readBoardDemoSession(sessionFile);
if (!session) {
  console.log(`[board-stop] No board demo session exists at ${sessionFile}.`);
  process.exit(0);
}
const pid = Number(session.pid);
if (!Number.isInteger(pid) || pid < 1) {
  console.error("[board-stop] The board demo session does not contain a valid supervisor PID.");
  process.exit(1);
}

let command = "";
try {
  ({ stdout: command } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]));
} catch (error) {
  if (Number(error?.code) === 1) {
    console.log(`[board-stop] Board demo PID ${pid} is no longer running (session status: ${session.status}).`);
    process.exit(0);
  }
  throw error;
}
if (!command.includes("scripts/board-demo.mjs")) {
  console.error(`[board-stop] Refusing to signal PID ${pid}; it is not the board demo supervisor.`);
  process.exit(1);
}

process.kill(pid, "SIGTERM");
const deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 100));
  const current = await readBoardDemoSession(sessionFile);
  if (["stopped", "error"].includes(current?.status)) {
    console.log(`[board-stop] Board demo supervisor ${pid} stopped (${current.status}).`);
    process.exit(current.status === "error" ? 1 : 0);
  }
  try {
    process.kill(pid, 0);
  } catch {
    console.log(`[board-stop] Board demo supervisor ${pid} stopped.`);
    process.exit(0);
  }
}

console.error(`[board-stop] Timed out waiting for board demo supervisor ${pid} to stop.`);
process.exit(1);

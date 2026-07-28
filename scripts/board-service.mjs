#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  BOARD_CAPABILITY_CERTIFICATE_MAX_AGE_MS,
  evaluateBoardCapabilityCertificate
} from "../lib/board-capability-certificate.mjs";
import {
  BOARD_LAUNCHD_LABEL,
  boardLaunchdPresentationSafety,
  boardLaunchdStartSafety,
  createBoardLaunchdController
} from "../lib/board-launchd-service.mjs";
import {
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "status";
const unknown = process.argv.slice(3);
const commands = new Set(["start", "restart", "status", "present", "stop", "uninstall"]);
const certificateFile = path.join(ROOT, ".sandfest-runtime", "board-capability-certification.json");

if (!commands.has(command) || unknown.length) {
  console.error("Usage: node scripts/board-service.mjs <start|restart|status|present|stop|uninstall>");
  process.exit(1);
}
if (process.platform !== "darwin") {
  console.error("[board-service] The persistent board service is available only on macOS.");
  process.exit(1);
}

const controller = createBoardLaunchdController({ root: ROOT });
const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });

async function readinessReport() {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(ROOT, "scripts", "check-board-demo.mjs"),
      "--json"
    ], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 20_000
    });
    return JSON.parse(stdout);
  } catch (error) {
    try {
      return JSON.parse(String(error?.stdout || ""));
    } catch {
      return null;
    }
  }
}

async function waitForReady({ previousPid = null, requireReplacement = false } = {}) {
  const deadline = Date.now() + 120_000;
  let lastDetail = "The launchd job has not published a ready session.";
  while (Date.now() < deadline) {
    const session = await readBoardDemoSession(sessionFile);
    if (session?.status === "error") {
      throw new Error(`The board supervisor entered an error state: ${session.lastError || "unknown error"}`);
    }
    const replacementReady = !requireReplacement || Number(session?.pid) !== Number(previousPid);
    if (replacementReady && session?.status === "ready" && boardDemoSessionProcessAlive(session)) {
      const report = await readinessReport();
      if (report?.ok) return { session, report };
      lastDetail = report?.checks?.find(item => !item.ok)?.detail || lastDetail;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for the persistent board service: ${lastDetail}`);
}

async function certificationStatus({ session, report }) {
  let certificate = null;
  try {
    certificate = JSON.parse(await readFile(certificateFile, "utf8"));
  } catch {
    certificate = null;
  }
  return evaluateBoardCapabilityCertificate(certificate, {
    source: session.source,
    links: report.links,
    maxAgeMs: BOARD_CAPABILITY_CERTIFICATE_MAX_AGE_MS
  });
}

function formatCertificationAge(ageMs) {
  if (!Number.isFinite(ageMs)) return "unknown age";
  const hours = ageMs / (60 * 60 * 1_000);
  return hours < 1 ? `${Math.max(0, Math.round(ageMs / 60_000))}m old` : `${Math.round(hours)}h old`;
}

async function printReady({ session, report, service }) {
  console.log(`[board-service] ${BOARD_LAUNCHD_LABEL} is ready (supervisor ${session.pid}).`);
  console.log(`[board-service] Source: ${session.source?.branch}@${String(session.source?.commit || "").slice(0, 8)}`);
  console.log(`[board-service] LaunchAgent: ${service.persistent ? service.plistPath : "session scoped"}`);
  const certification = await certificationStatus({ session, report });
  if (certification.ok) {
    const browsers = certification.browsers.map(item => `${item.engine} ${item.passed}/${item.total}`).join(" · ");
    console.log(`[board-service] Certification: current · ${certification.journeyCount}/10 journeys · ${browsers} · ${formatCertificationAge(certification.ageMs)}`);
  } else {
    console.log(`[board-service] Certification: not current · ${certification.errors[0]}`);
    console.log("[board-service] Action: npm run board:certify");
  }
  console.log(`[board-service] Visitor: ${report.links.visitor}`);
  console.log(`[board-service] Operations: ${report.links.operations}`);
  console.log(`[board-service] Log: ${path.join(ROOT, ".sandfest-runtime", "board-demo-supervisor.log")}`);
  return certification;
}

async function main() {
  if (command === "uninstall") {
    const result = await controller.uninstall();
    const session = await readBoardDemoSession(sessionFile);
    if (boardDemoSessionProcessAlive(session)) {
      await execFileAsync(process.execPath, [
        path.join(ROOT, "scripts", "stop-board-demo.mjs")
      ], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 45_000
      });
    }
    console.log(`[board-service] ${result.action.replaceAll("_", " ")}.`);
    return;
  }

  if (command === "stop") {
    const { stdout = "", stderr = "" } = await execFileAsync(process.execPath, [
      path.join(ROOT, "scripts", "stop-board-demo.mjs")
    ], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 45_000
    });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return;
  }

  const initialState = await controller.inspect();
  if ((initialState.installed || initialState.configured) && !initialState.owned) {
    throw new Error(`Refusing to control ${BOARD_LAUNCHD_LABEL}; it belongs to another checkout.`);
  }

  if (command === "status" || command === "present") {
    if (!initialState.installed) {
      throw new Error(initialState.configured
        ? `${BOARD_LAUNCHD_LABEL} is installed at ${initialState.plistPath} but is not running.`
        : `${BOARD_LAUNCHD_LABEL} is not installed.`);
    }
    const session = await readBoardDemoSession(sessionFile);
    const report = await readinessReport();
    if (!session || !boardDemoSessionProcessAlive(session) || !report?.ok) {
      throw new Error(`${BOARD_LAUNCHD_LABEL} is installed but the board stack is not ready.`);
    }
    const certification = await printReady({ session, report, service: initialState });
    if (command === "present") {
      const serviceSafety = boardLaunchdPresentationSafety(initialState);
      if (!serviceSafety.ok) throw new Error(serviceSafety.reason);
      if (!certification.ok) {
        throw new Error("Presentation readiness requires a current full board certificate. Run npm run board:certify.");
      }
      console.log("[board-service] Presentation gate: passed.");
    }
    return;
  }

  const previousSession = await readBoardDemoSession(sessionFile);
  const startSafety = boardLaunchdStartSafety({
    serviceInstalled: initialState.installed,
    supervisorAlive: boardDemoSessionProcessAlive(previousSession)
  });
  if (!startSafety.ok) throw new Error(startSafety.reason);
  const result = command === "restart"
    ? await controller.restart()
    : await controller.start();
  const ready = await waitForReady({
    previousPid: previousSession?.pid,
    requireReplacement: result.action !== "already_running"
  });
  const service = await controller.inspect();
  if (!service.persistent) throw new Error("The board service started without a persistent LaunchAgent.");
  console.log(`[board-service] ${result.action.replaceAll("_", " ")}.`);
  await printReady({ ...ready, service });
}

try {
  await main();
} catch (error) {
  console.error(`[board-service] ${error.message}`);
  process.exitCode = 1;
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  assessBoardIOSScreenshot,
  boardIOSLaunchArguments,
  boardIOSProcessIsActive,
  exactBoardIOSAPIBase,
  normalizeBoardIOSMode,
  parseBoardIOSLaunch,
  parseBoardIOSUserDomain,
  selectBoardIOSSimulator
} from "../lib/board-ios-rehearsal.mjs";
import {
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_IDENTIFIER = "com.portalcodex.texassandfest";
const ADMIN_TOKEN = "board-demo-local-admin-token-change-me";
const runtimeRoot = path.join(ROOT, ".sandfest-runtime", "board-ios");
const derivedDataPath = path.join(runtimeRoot, "DerivedData");

function argumentValue(prefix) {
  return process.argv.find(argument => argument.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
}

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:ios -- [--mode=admin|visitor] [--no-open]");
  console.log("Requires the supervised board stack on clean main and an installed iPhone simulator.");
  process.exit(0);
}

if (process.platform !== "darwin") {
  console.error("The iOS board rehearsal requires macOS and Xcode.");
  process.exit(1);
}

const mode = normalizeBoardIOSMode(argumentValue("--mode"));
const selectedDeveloperDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout?.trim();
const developerDir = process.env.DEVELOPER_DIR
  || (selectedDeveloperDir && !selectedDeveloperDir.endsWith("/CommandLineTools")
    ? selectedDeveloperDir
    : "/Applications/Xcode.app/Contents/Developer");
const env = { ...process.env, DEVELOPER_DIR: developerDir };

function run(command, args, { capture = false, label = command } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  }
  return capture ? String(result.stdout || "").trim() : "";
}

console.log("\n=== Board source and service preflight ===");
run(process.execPath, ["scripts/check-board-demo.mjs"], { label: "Board preflight" });

const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });
const session = await readBoardDemoSession(sessionFile);
if (!session || session.status !== "ready" || !boardDemoSessionProcessAlive(session)) {
  throw new Error("The supervised board session is not ready.");
}
const apiBase = exactBoardIOSAPIBase(session.endpoints?.apiBase);

console.log("\n=== Discover iPhone simulator ===");
const simulatorJSON = run("xcrun", ["simctl", "list", "devices", "available", "--json"], {
  capture: true,
  label: "Simulator discovery"
});
const simulatorGroups = Object.values(JSON.parse(simulatorJSON).devices || {});
const simulator = selectBoardIOSSimulator(simulatorGroups.flat(), process.env.SANDFEST_IOS_SIMULATOR_ID);
if (!simulator) throw new Error("No available iPhone simulator was found.");
console.log(`${simulator.name} · ${simulator.udid}${simulator.state === "Booted" ? " · already booted" : ""}`);

if (simulator.state === "Shutdown") run("xcrun", ["simctl", "boot", simulator.udid], { label: "Simulator boot" });
run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], { label: "Simulator readiness" });

await mkdir(runtimeRoot, { recursive: true });
console.log("\n=== Build optimized iOS board app ===");
run("xcodebuild", [
  "-quiet",
  "-project", "ios/TexasSandFest.xcodeproj",
  "-scheme", "TexasSandFest",
  "-configuration", "Release",
  "-destination", `platform=iOS Simulator,id=${simulator.udid}`,
  "-derivedDataPath", derivedDataPath,
  "CODE_SIGNING_ALLOWED=NO",
  "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
  "build"
], { label: "Optimized simulator build" });

run(process.execPath, ["scripts/check-board-demo.mjs"], {
  capture: true,
  label: "Final board preflight"
});

const appPath = path.join(derivedDataPath, "Build", "Products", "Release-iphonesimulator", "TexasSandFest.app");
console.log("\n=== Install and launch live board mode ===");
run("xcrun", ["simctl", "install", simulator.udid, appPath], { label: "Simulator install" });
const launchOutput = run("xcrun", [
  "simctl", "launch", "--terminate-running-process", simulator.udid, BUNDLE_IDENTIFIER,
  ...boardIOSLaunchArguments({ apiBase, mode, adminToken: ADMIN_TOKEN })
], { capture: true, label: "Simulator launch" });
const appPID = parseBoardIOSLaunch(launchOutput, BUNDLE_IDENTIFIER);
await delay(1_500);

const simulatorSystemDomain = run("xcrun", ["simctl", "spawn", simulator.udid, "launchctl", "print", "system"], {
  capture: true,
  label: "Simulator launch-domain lookup"
});
const simulatorUserDomain = parseBoardIOSUserDomain(simulatorSystemDomain);
const processState = run("xcrun", ["simctl", "spawn", simulator.udid, "launchctl", "print", simulatorUserDomain], {
  capture: true,
  label: "Simulator process check"
});
if (!boardIOSProcessIsActive(processState, BUNDLE_IDENTIFIER, appPID)) {
  throw new Error("The Texas SandFest app exited before the board screen could be verified.");
}

const screenshotPath = path.join(runtimeRoot, `${mode}.png`);
run("xcrun", ["simctl", "io", simulator.udid, "screenshot", screenshotPath], { label: "Simulator screenshot" });
const screenshot = sharp(screenshotPath);
const [metadata, statistics] = await Promise.all([screenshot.metadata(), screenshot.stats()]);
const screenshotAssessment = assessBoardIOSScreenshot(metadata, statistics.channels);
if (!screenshotAssessment.ok) {
  throw new Error(`The iOS board capture is not presentation-ready: ${screenshotAssessment.reasons.join(", ")}.`);
}

if (!process.argv.includes("--no-open")) run("open", ["-a", "Simulator"], { label: "Simulator display" });

console.log("\nBoard iOS rehearsal passed.");
console.log(`Mode:       ${mode}`);
console.log(`Simulator:  ${simulator.name}`);
console.log(`API:        ${apiBase}`);
console.log(`Process:    ${appPID}`);
console.log(`Screenshot: ${screenshotPath}`);

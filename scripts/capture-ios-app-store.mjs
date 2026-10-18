#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

if (process.platform !== "darwin") {
  console.error("App Store screenshot capture requires macOS and Xcode.");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DERIVED_DATA = path.join(tmpdir(), `texas-sandfest-app-store-${process.pid}`);
const BUNDLE_IDENTIFIER = "com.portalcodex.texassandfest";
const selectedDeveloperDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout?.trim();
const developerDir = process.env.DEVELOPER_DIR
  || (selectedDeveloperDir && !selectedDeveloperDir.endsWith("/CommandLineTools")
    ? selectedDeveloperDir
    : "/Applications/Xcode.app/Contents/Developer");
const env = { ...process.env, DEVELOPER_DIR: developerDir };

const scenes = [
  { file: "01-today.png", deepLink: "sandfest://today" },
  { file: "02-live-beach.png", deepLink: "sandfest://island-conditions" },
  { file: "03-sculptors.png", deepLink: "sandfest://sculptors" },
  { file: "04-ask-sandy.png", deepLink: "sandfest://sandy" },
  { file: "05-tickets.png", deepLink: "sandfest://tickets" },
  { file: "06-schedule.png", deepLink: "sandfest://schedule" }
];

const deviceProfiles = [
  {
    name: "iPhone 17 Pro Max",
    output: path.join(ROOT, "ios", "AppStore", "screenshots", "iphone-6.5"),
    captureWidth: 1320,
    captureHeight: 2868,
    width: 1284,
    height: 2778,
    label: "App Store 6.5-inch iPhone"
  },
  {
    name: "iPad Pro 13-inch (M5)",
    output: path.join(ROOT, "ios", "AppStore", "screenshots", "ipad-13"),
    width: 2064,
    height: 2752,
    label: "App Store 13-inch iPad"
  }
];

function run(command, args, label, { capture = false } = {}) {
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
  return String(result.stdout || "").trim();
}

try {
  const simulatorData = JSON.parse(run(
    "xcrun",
    ["simctl", "list", "devices", "available", "--json"],
    "Simulator discovery",
    { capture: true }
  ));
  const simulators = Object.values(simulatorData.devices || {}).flat();
  const targets = deviceProfiles.map(profile => {
    const simulator = simulators.find(device => device.isAvailable && device.name === profile.name);
    if (!simulator) throw new Error(`The ${profile.name} simulator is not installed.`);
    return { ...profile, simulator };
  });

  console.log("\n=== Build App Store screenshot app ===");
  run("xcodebuild", [
    "-quiet",
    "-project", "ios/TexasSandFest.xcodeproj",
    "-scheme", "TexasSandFest",
    "-configuration", "Release",
    "-destination", "generic/platform=iOS Simulator",
    "-derivedDataPath", DERIVED_DATA,
    "CODE_SIGNING_ALLOWED=NO",
    "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
    "build"
  ], "Optimized screenshot build");

  const appPath = path.join(DERIVED_DATA, "Build", "Products", "Release-iphonesimulator", "TexasSandFest.app");

  for (const target of targets) {
    const { simulator } = target;
    console.log(`\n=== Prepare ${simulator.name} ===`);
    if (simulator.state === "Shutdown") run("xcrun", ["simctl", "boot", simulator.udid], "Simulator boot");
    run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], "Simulator readiness");
    run("xcrun", ["simctl", "status_bar", simulator.udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4"], "Stable status bar");
    await rm(target.output, { recursive: true, force: true });
    await mkdir(target.output, { recursive: true });
    run("xcrun", ["simctl", "install", simulator.udid, appPath], "Simulator install");

    for (const scene of scenes) {
      run("xcrun", [
        "simctl", "launch", "--terminate-running-process", simulator.udid, BUNDLE_IDENTIFIER,
        "-deepLink", scene.deepLink, "-appStoreScreenshot"
      ], `Launch ${scene.file}`, { capture: true });
      await delay(1_800);
      const screenshotPath = path.join(target.output, scene.file);
      run("xcrun", ["simctl", "io", simulator.udid, "screenshot", screenshotPath], `Capture ${scene.file}`);
      const captured = sharp(screenshotPath);
      const capturedMetadata = await captured.metadata();
      if (target.captureWidth && (capturedMetadata.width !== target.captureWidth || capturedMetadata.height !== target.captureHeight)) {
        throw new Error(`${scene.file} capture is ${capturedMetadata.width}x${capturedMetadata.height}; expected ${target.captureWidth}x${target.captureHeight}.`);
      }
      if (target.captureWidth && (target.width !== target.captureWidth || target.height !== target.captureHeight)) {
        const convertedPath = `${screenshotPath}.converted.png`;
        await sharp(screenshotPath).resize(target.width, target.height, { fit: "cover", position: "centre" }).png().toFile(convertedPath);
        await rename(convertedPath, screenshotPath);
      }
      const image = sharp(screenshotPath);
      const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
      if (metadata.format !== "png" || metadata.width !== target.width || metadata.height !== target.height) {
        throw new Error(`${scene.file} is ${metadata.width}x${metadata.height}; expected ${target.label} size ${target.width}x${target.height}.`);
      }
      if (stats.channels.slice(0, 3).some(channel => channel.stdev < 8)) {
        throw new Error(`${scene.file} appears blank or visually uniform.`);
      }
    }
    console.log(`${scenes.length} verified PNG files at ${target.output}`);
  }

  console.log(`\nApp Store screenshots: ${scenes.length * targets.length} verified PNG files across ${targets.length} device classes.`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(DERIVED_DATA, { recursive: true, force: true });
}

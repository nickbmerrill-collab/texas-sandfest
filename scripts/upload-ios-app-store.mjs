#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("App Store upload requires macOS and Xcode.");
  process.exit(1);
}
if (process.env.SANDFEST_CONFIRM_APP_STORE_UPLOAD !== "YES") {
  console.error("Refusing to upload without SANDFEST_CONFIRM_APP_STORE_UPLOAD=YES.");
  process.exit(2);
}
const confirmedVersion = String(process.env.SANDFEST_CONFIRM_APP_STORE_VERSION || "").trim();
const confirmedBuild = String(process.env.SANDFEST_CONFIRM_APP_STORE_BUILD || "").trim();
if (!/^\d+(?:\.\d+){1,2}$/.test(confirmedVersion) || !/^\d+(?:\.\d+){0,2}$/.test(confirmedBuild)) {
  console.error("Refusing to upload without explicit SANDFEST_CONFIRM_APP_STORE_VERSION and SANDFEST_CONFIRM_APP_STORE_BUILD values.");
  process.exit(2);
}

const releaseFactsPath = path.join(process.cwd(), "ios/AppStore/metadata/release-facts.json");
const releaseFacts = JSON.parse(readFileSync(releaseFactsPath, "utf8"));
if (
  releaseFacts.submissionConfirmed === true
  && String(releaseFacts.version) === confirmedVersion
  && String(releaseFacts.build) === confirmedBuild
) {
  console.error(`Refusing to re-upload submitted build ${confirmedVersion} (${confirmedBuild}).`);
  process.exit(2);
}

const selectedDeveloperDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout?.trim();
const developerDir = process.env.DEVELOPER_DIR
  || (selectedDeveloperDir && !selectedDeveloperDir.endsWith("/CommandLineTools")
    ? selectedDeveloperDir
    : "/Applications/Xcode.app/Contents/Developer");
const env = { ...process.env, DEVELOPER_DIR: developerDir };
const archivePath = path.join(tmpdir(), `TexasSandFest-upload-${process.pid}.xcarchive`);
const exportPath = path.join(tmpdir(), `TexasSandFest-export-${process.pid}`);
const appPath = path.join(archivePath, "Products/Applications/TexasSandFest.app");

function run(args, label, { capture = false } = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync("xcodebuild", args, {
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`;
    if (capture) process.stderr.write(output);
    if (output.includes("PLA Update available")) {
      throw new Error("Apple upload is blocked until the latest Developer Program License Agreement is accepted.");
    }
    throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  }
  return result.stdout || "";
}

try {
  run([
    "-quiet",
    "-project", "ios/TexasSandFest.xcodeproj",
    "-scheme", "TexasSandFest",
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-archivePath", archivePath,
    "-allowProvisioningUpdates",
    "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
    "archive"
  ], "Create signed App Store archive", { capture: true });

  if (!existsSync(appPath)) throw new Error(`Archive did not contain ${appPath}.`);
  const infoPath = path.join(appPath, "Info.plist");
  const bundle = spawnSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPath], { encoding: "utf8" }).stdout?.trim();
  const version = spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPath], { encoding: "utf8" }).stdout?.trim();
  const build = spawnSync("plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", infoPath], { encoding: "utf8" }).stdout?.trim();
  const encryption = spawnSync("plutil", ["-extract", "ITSAppUsesNonExemptEncryption", "raw", "-o", "-", infoPath], { encoding: "utf8" }).stdout?.trim();
  if (bundle !== "com.portalcodex.texassandfest" || version !== confirmedVersion || build !== confirmedBuild || encryption !== "false") {
    throw new Error(`Unexpected upload identity: ${bundle || "missing"} ${version || "missing"} (${build || "missing"}), encryption=${encryption || "missing"}.`);
  }

  run([
    "-exportArchive",
    "-archivePath", archivePath,
    "-exportPath", exportPath,
    "-exportOptionsPlist", "ios/AppStore/ExportOptions.plist",
    "-allowProvisioningUpdates"
  ], `Upload ${bundle} ${version} (${build}) to App Store Connect`);

  console.log(`\nApp Store upload accepted for processing: ${bundle} ${version} (${build}).`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(archivePath, { recursive: true, force: true });
  rmSync(exportPath, { recursive: true, force: true });
}

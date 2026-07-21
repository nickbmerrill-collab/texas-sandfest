import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("The signed iOS device gate requires macOS and Xcode.");
  process.exit(1);
}

const selectedDeveloperDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout?.trim();
const developerDir = process.env.DEVELOPER_DIR
  || (selectedDeveloperDir && !selectedDeveloperDir.endsWith("/CommandLineTools")
    ? selectedDeveloperDir
    : "/Applications/Xcode.app/Contents/Developer");
const env = { ...process.env, DEVELOPER_DIR: developerDir };
const project = "ios/TexasSandFest.xcodeproj";
const scheme = "TexasSandFest";
const derivedDataPath = path.join(tmpdir(), `texas-sandfest-device-${process.pid}`);
const appPath = path.join(derivedDataPath, "Build/Products/Release-iphoneos/TexasSandFest.app");

function run(command, args, label, { capture = false } = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`;
    if (capture) process.stderr.write(output);
    if (output.includes("PLA Update available")) {
      throw new Error("Apple automatic signing is blocked until the latest Apple Developer Program License Agreement is accepted.");
    }
    throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  }
  return result.stdout || "";
}

try {
  const settings = run("xcodebuild", [
    "-project", project,
    "-scheme", scheme,
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-showBuildSettings"
  ], "Resolve iOS release signing settings", { capture: true });
  const team = settings.match(/^\s*DEVELOPMENT_TEAM = ([A-Z0-9]{10})\s*$/m)?.[1];
  if (!team) throw new Error("The TexasSandFest target does not resolve a 10-character Apple development team.");

  run("xcodebuild", [
    "-quiet",
    "-project", project,
    "-scheme", scheme,
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-derivedDataPath", derivedDataPath,
    "-allowProvisioningUpdates",
    "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
    "build"
  ], `Signed Release device build (${team})`, { capture: true });

  if (!existsSync(appPath)) throw new Error(`Signed app was not created at ${appPath}.`);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Verify signed app bundle");
  console.log("\nXcode device readiness: signed Release build and signature verification passed.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(derivedDataPath, { recursive: true, force: true });
}

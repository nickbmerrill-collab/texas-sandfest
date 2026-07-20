import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("The Xcode test gate requires macOS.");
  process.exit(1);
}

const selectedDeveloperDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout?.trim();
const developerDir = process.env.DEVELOPER_DIR
  || (selectedDeveloperDir && !selectedDeveloperDir.endsWith("/CommandLineTools")
    ? selectedDeveloperDir
    : "/Applications/Xcode.app/Contents/Developer");
const env = { ...process.env, DEVELOPER_DIR: developerDir };
const devicesResult = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
  env,
  encoding: "utf8"
});
if (devicesResult.status !== 0) {
  process.stderr.write(devicesResult.stderr || "Unable to list iOS simulators.\n");
  process.exit(devicesResult.status || 1);
}

const deviceGroups = Object.values(JSON.parse(devicesResult.stdout).devices || {});
const devices = deviceGroups.flat().filter(device => device.isAvailable && device.deviceTypeIdentifier?.includes("iPhone"));
const device = devices.find(item => item.state === "Booted") || devices.find(item => item.name?.includes("Pro")) || devices[0];
if (!device) {
  console.error("No available iPhone simulator was found.");
  process.exit(1);
}

const derivedDataPath = path.join(tmpdir(), `texas-sandfest-xcode-${process.pid}`);
const common = [
  "-project", "ios/TexasSandFest.xcodeproj",
  "-scheme", "TexasSandFest",
  "-destination", `platform=iOS Simulator,id=${device.udid}`,
  "-derivedDataPath", derivedDataPath,
  "CODE_SIGNING_ALLOWED=NO",
  "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES"
];

function run(label, args) {
  console.log(`\n=== ${label} (${device.name}) ===`);
  const result = spawnSync("xcodebuild", ["-quiet", ...common, ...args], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status || 1}.`);
}

try {
  run("Xcode Debug unit tests", ["-configuration", "Debug", "test"]);
  run("Xcode optimized simulator build", ["-configuration", "Release", "build"]);
  console.log("\nXcode readiness: tests and optimized simulator build passed.");
} finally {
  rmSync(derivedDataPath, { recursive: true, force: true });
}

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
const bundleIdentifier = "com.portalcodex.texassandfest";
const installOnDevice = process.argv.includes("--install");
const derivedDataPath = path.join(tmpdir(), `texas-sandfest-device-${process.pid}`);
const deviceListPath = path.join(tmpdir(), `texas-sandfest-devices-${process.pid}.json`);
const appPath = path.join(derivedDataPath, "Build/Products/Release-iphoneos/TexasSandFest.app");
const profilePath = path.join(appPath, "embedded.mobileprovision");

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

function plistValue(plist, keyPath) {
  const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", "-"], {
    env,
    encoding: "utf8",
    input: plist
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Signed provisioning profile is missing ${keyPath}.`);
  return result.stdout.trim();
}

function discoverInstallDevice() {
  run("xcrun", ["devicectl", "list", "devices", "--json-output", deviceListPath], "Discover paired iOS hardware", { capture: true });
  const devices = JSON.parse(readFileSync(deviceListPath, "utf8")).result?.devices || [];
  const requestedIdentifier = String(process.env.SANDFEST_IOS_DEVICE_ID || "").trim();
  const eligible = devices
    .filter(device => device?.hardwareProperties?.platform === "iOS"
      && device?.hardwareProperties?.reality === "physical"
      && device?.hardwareProperties?.udid
      && device?.connectionProperties?.pairingState === "paired"
      && device?.connectionProperties?.transportType
      && device?.deviceProperties?.developerModeStatus === "enabled")
    .sort((left, right) => Date.parse(right.connectionProperties?.lastConnectionDate || 0) - Date.parse(left.connectionProperties?.lastConnectionDate || 0));
  const device = requestedIdentifier
    ? eligible.find(item => item.identifier === requestedIdentifier || item.hardwareProperties.udid === requestedIdentifier)
    : eligible[0];
  if (!device) {
    throw new Error(requestedIdentifier
      ? "SANDFEST_IOS_DEVICE_ID does not identify an available paired iOS device with Developer Mode enabled."
      : "No available paired iOS device with Developer Mode enabled was found.");
  }
  return device;
}

try {
  const device = installOnDevice ? discoverInstallDevice() : null;
  const destination = device
    ? `platform=iOS,id=${device.hardwareProperties.udid}`
    : "generic/platform=iOS";
  const settings = run("xcodebuild", [
    "-project", project,
    "-scheme", scheme,
    "-configuration", "Release",
    "-destination", destination,
    "-showBuildSettings"
  ], "Resolve iOS release signing settings", { capture: true });
  const team = settings.match(/^\s*DEVELOPMENT_TEAM = ([A-Z0-9]{10})\s*$/m)?.[1];
  if (!team) throw new Error("The TexasSandFest target does not resolve a 10-character Apple development team.");

  run("xcodebuild", [
    "-quiet",
    "-project", project,
    "-scheme", scheme,
    "-configuration", "Release",
    "-destination", destination,
    "-derivedDataPath", derivedDataPath,
    "-allowProvisioningUpdates",
    ...(device ? ["-allowProvisioningDeviceRegistration"] : []),
    "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
    "build"
  ], `Signed Release device build (${team})`, { capture: true });

  if (!existsSync(appPath)) throw new Error(`Signed app was not created at ${appPath}.`);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Verify signed app bundle");
  if (!existsSync(profilePath)) throw new Error("Signed app does not contain an embedded provisioning profile.");

  const profile = run("security", ["cms", "-D", "-i", profilePath], "Verify embedded provisioning identity", { capture: true });
  const prefix = plistValue(profile, "ApplicationIdentifierPrefix.0");
  const profileTeam = plistValue(profile, "TeamIdentifier.0");
  const applicationIdentifier = plistValue(profile, "Entitlements.application-identifier");
  const expiration = plistValue(profile, "ExpirationDate");
  const configuredPrefix = String(process.env.SANDFEST_APPLE_APP_ID_PREFIX || "").trim();
  if (!/^[A-Z0-9]{10}$/.test(prefix)) throw new Error("Embedded provisioning profile has an invalid App ID prefix.");
  if (profileTeam !== team) throw new Error("Embedded provisioning profile does not match the Xcode development team.");
  if (applicationIdentifier !== `${prefix}.${bundleIdentifier}`) {
    throw new Error("Embedded provisioning profile does not match the Texas SandFest bundle identifier.");
  }
  if (configuredPrefix && configuredPrefix !== prefix) {
    throw new Error("SANDFEST_APPLE_APP_ID_PREFIX does not match the signed app's embedded provisioning profile.");
  }
  if (!Number.isFinite(Date.parse(expiration)) || Date.parse(expiration) <= Date.now()) {
    throw new Error("Embedded provisioning profile is expired or has an invalid expiration date.");
  }

  console.log(`\nSigned identity: ${applicationIdentifier}; profile expires ${expiration}`);
  if (device) {
    const deviceName = device.hardwareProperties.marketingName || device.deviceProperties.name || "paired iOS device";
    run("xcrun", ["devicectl", "device", "install", "app", "--device", device.identifier, appPath], `Install on ${deviceName}`);
    run("xcrun", ["devicectl", "device", "process", "launch", "--device", device.identifier, "--terminate-existing", bundleIdentifier], `Launch on ${deviceName}`);
    console.log(`Hardware acceptance: ${deviceName} installed and launched ${bundleIdentifier}.`);
  }
  console.log("Xcode device readiness: signed Release build, signature, and provisioning identity passed.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(derivedDataPath, { recursive: true, force: true });
  rmSync(deviceListPath, { force: true });
}

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("The iOS accessibility audit requires macOS.");
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
const requestedFamily = String(process.env.SANDFEST_IOS_ACCESSIBILITY_DEVICE_FAMILY || "iPhone").trim();
if (!["iPhone", "iPad"].includes(requestedFamily)) {
  console.error("SANDFEST_IOS_ACCESSIBILITY_DEVICE_FAMILY must be iPhone or iPad.");
  process.exit(1);
}
const requestedDeviceName = String(process.env.SANDFEST_IOS_ACCESSIBILITY_DEVICE_NAME || "").trim();
const testMode = String(process.env.SANDFEST_IOS_UI_TEST_MODE || "accessibility").trim();
if (!["accessibility", "smoke", "nutrition-labels", "display-settings"].includes(testMode)) {
  console.error("SANDFEST_IOS_UI_TEST_MODE must be accessibility, smoke, nutrition-labels, or display-settings.");
  process.exit(1);
}
const devices = deviceGroups.flat().filter(device => (
  device.isAvailable && device.deviceTypeIdentifier?.includes(requestedFamily)
));
const device = (requestedDeviceName ? devices.find(item => item.name === requestedDeviceName) : null)
  || devices.find(item => item.state === "Booted")
  || devices.find(item => item.name?.includes("Pro"))
  || devices[0];
if (!device) {
  console.error(`No available ${requestedFamily} simulator was found.`);
  process.exit(1);
}

const derivedDataPath = path.join(tmpdir(), `texas-sandfest-accessibility-${process.pid}`);
const resultBundlePath = path.join(tmpdir(), `texas-sandfest-accessibility-${process.pid}.xcresult`);
const testSelections = testMode === "smoke"
  ? [
      "TexasSandFestUITests/TexasSandFestAccessibilityTests/testProductionBoundaryRejectsAdminLaunchAndKeepsOfflineGuide",
      "TexasSandFestUITests/TexasSandFestAccessibilityTests/testVisitorCommonTasksRemainNavigableOffline"
    ]
  : testMode === "nutrition-labels"
    ? ["TexasSandFestUITests/TexasSandFestAccessibilityTests/testAccessibilityNutritionLabelCommonTasks"]
  : testMode === "display-settings"
    ? ["TexasSandFestUITests/TexasSandFestAccessibilityTests/testAccessibilityDisplaySettingsCommonTasks"]
  : ["TexasSandFestUITests/TexasSandFestAccessibilityTests/testVisitorPrimaryNavigationAccessibility"];
const args = [
  "-quiet",
  "-project", "ios/TexasSandFest.xcodeproj",
  "-scheme", "TexasSandFest",
  "-destination", `platform=iOS Simulator,id=${device.udid}`,
  "-derivedDataPath", derivedDataPath,
  "-resultBundlePath", resultBundlePath,
  "-configuration", "Debug",
  "-parallel-testing-enabled", "NO",
  "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
  ...testSelections.flatMap(selection => [`-only-testing:${selection}`]),
  "test"
];

function runSimctl(args, label) {
  const result = spawnSync("xcrun", ["simctl", ...args], { env, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || "unknown simctl error"}`);
  }
  return String(result.stdout || "").trim();
}

function ensureSimulatorBooted() {
  if (device.state !== "Booted") {
    runSimctl(["boot", device.udid], `Booting ${device.name}`);
  }
  runSimctl(["bootstatus", device.udid, "-b"], `Waiting for ${device.name}`);
}

function readAccessibilityPreference(key) {
  const result = spawnSync(
    "xcrun",
    ["simctl", "spawn", device.udid, "defaults", "read", "com.apple.Accessibility", key],
    { env, encoding: "utf8" }
  );
  if (result.error) throw result.error;
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function writeAccessibilityPreference(key, value) {
  runSimctl(
    ["spawn", device.udid, "defaults", "write", "com.apple.Accessibility", key, "-bool", value ? "true" : "false"],
    `${value ? "Enabling" : "Disabling"} ${key}`
  );
}

function restoreAccessibilityPreference(key, originalValue) {
  if (originalValue === null) {
    runSimctl(
      ["spawn", device.udid, "defaults", "delete", "com.apple.Accessibility", key],
      `Removing temporary ${key} preference`
    );
    return;
  }
  runSimctl(
    ["spawn", device.udid, "defaults", "write", "com.apple.Accessibility", key, "-int", originalValue],
    `Restoring simulator ${key} preference`
  );
}

function restartSimulatorShell(label) {
  // The simulator runtime does not consistently ship `killall`. A bounded
  // shutdown/boot cycle makes the Settings domain changes deterministic across
  // both iPhone and iPad images.
  runSimctl(["shutdown", device.udid], `Shutting down ${device.name} while ${label}`);
  runSimctl(["boot", device.udid], `Booting ${device.name} while ${label}`);
  runSimctl(["bootstatus", device.udid, "-b"], `Waiting for ${device.name} after ${label}`);
}

let restoreSimulatorSettings = null;
if (testMode === "nutrition-labels") {
  ensureSimulatorBooted();
  const originalContentSize = runSimctl(
    ["ui", device.udid, "content_size"],
    "Reading simulator content size"
  );
  const originalIncreaseContrast = runSimctl(
    ["ui", device.udid, "increase_contrast"],
    "Reading simulator contrast setting"
  );
  const originalReduceMotion = readAccessibilityPreference("ReduceMotionEnabled");
  if ([originalContentSize, originalIncreaseContrast].some(value => ["unknown", "unsupported", ""].includes(value))) {
    throw new Error("The selected simulator cannot provide the required Larger Text and Increase Contrast settings.");
  }

  runSimctl(
    ["ui", device.udid, "content_size", "accessibility-extra-large"],
    "Enabling AX3 Larger Text"
  );
  runSimctl(
    ["ui", device.udid, "increase_contrast", "enabled"],
    "Enabling Increase Contrast"
  );
  runSimctl(
    ["spawn", device.udid, "defaults", "write", "com.apple.Accessibility", "ReduceMotionEnabled", "-bool", "true"],
    "Enabling Reduce Motion"
  );
  restoreSimulatorSettings = () => {
    runSimctl(
      ["ui", device.udid, "content_size", originalContentSize],
      "Restoring simulator content size"
    );
    runSimctl(
      ["ui", device.udid, "increase_contrast", originalIncreaseContrast],
      "Restoring simulator contrast setting"
    );
    restoreAccessibilityPreference("ReduceMotionEnabled", originalReduceMotion);
  };
}

if (testMode === "display-settings") {
  ensureSimulatorBooted();
  // iOS Simulator does not expose these three toggles through `simctl ui`.
  // Preserve each domain value exactly, enable the Settings-backed preference,
  // and restart SpringBoard so SwiftUI receives the same environment values as
  // it would after a person changes the controls in Settings.
  const preferenceKeys = [
    "EnhancedTextLegibilityEnabled",
    "EnhancedBackgroundContrastEnabled",
    "DifferentiateWithoutColor"
  ];
  const originalPreferences = new Map(
    preferenceKeys.map(key => [key, readAccessibilityPreference(key)])
  );
  for (const key of preferenceKeys) {
    writeAccessibilityPreference(key, true);
  }
  restartSimulatorShell("applying accessibility display settings");
  restoreSimulatorSettings = () => {
    for (const key of preferenceKeys) {
      restoreAccessibilityPreference(key, originalPreferences.get(key));
    }
    restartSimulatorShell("restoring accessibility display settings");
  };
}

try {
  const label = testMode === "smoke"
    ? "visitor release smoke tests"
    : testMode === "nutrition-labels"
      ? "Accessibility Nutrition Label common-task audit at AX3 with Increase Contrast and Reduce Motion"
      : testMode === "display-settings"
        ? "accessibility display-setting common-task audit with Bold Text, Reduce Transparency, and Differentiate Without Color"
      : "visitor accessibility audit";
  console.log(`Running the ${label} on ${device.name} (${requestedFamily})...`);
  const result = spawnSync("xcodebuild", args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Detailed Xcode results were preserved at ${resultBundlePath}.`);
    throw new Error(`iOS ${testMode} test failed with exit code ${result.status || 1}.`);
  }
  if (testMode === "smoke") {
    console.log(`${requestedFamily} release smoke readiness: offline navigation and the visitor-only production boundary passed.`);
  } else if (testMode === "nutrition-labels") {
    console.log(`${requestedFamily} accessibility-label evidence: current visitor common tasks passed at AX3 with Increase Contrast and the app's Reduce Motion branches active.`);
  } else if (testMode === "display-settings") {
    console.log(`${requestedFamily} accessibility display-setting evidence: current visitor common tasks passed with Bold Text, Reduce Transparency, and Differentiate Without Color active.`);
  } else {
    console.log(`${requestedFamily} accessibility readiness: all primary visitor tabs passed Apple's audit.`);
  }
  rmSync(resultBundlePath, { recursive: true, force: true });
} finally {
  restoreSimulatorSettings?.();
  rmSync(derivedDataPath, { recursive: true, force: true });
}

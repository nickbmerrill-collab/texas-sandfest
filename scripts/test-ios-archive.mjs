import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("The iOS archive gate requires macOS and Xcode.");
  process.exit(1);
}

const selectedDeveloperDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout?.trim();
const developerDir = process.env.DEVELOPER_DIR
  || (selectedDeveloperDir && !selectedDeveloperDir.endsWith("/CommandLineTools")
    ? selectedDeveloperDir
    : "/Applications/Xcode.app/Contents/Developer");
const env = { ...process.env, DEVELOPER_DIR: developerDir };
const archivePath = path.join(tmpdir(), `TexasSandFest-${process.pid}.xcarchive`);
const archivedAppPath = path.join(archivePath, "Products/Applications/TexasSandFest.app");
const exportPath = path.join(tmpdir(), `TexasSandFest-export-${process.pid}`);
const unpackPath = path.join(tmpdir(), `TexasSandFest-unpacked-${process.pid}`);

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
      throw new Error("Apple archive signing is blocked until the latest Developer Program License Agreement is accepted.");
    }
    throw new Error(`${label} failed with exit code ${result.status || 1}.`);
  }
  return result.stdout || "";
}

function readSignedEntitlements(targetAppPath) {
  const result = spawnSync("codesign", ["-d", "--entitlements", ":-", targetAppPath], {
    env,
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Reading signed archive entitlements failed: ${output || "unknown codesign error"}`);
  const start = output.indexOf("<?xml");
  const end = output.lastIndexOf("</plist>");
  if (start < 0 || end < start) throw new Error("Signed archive entitlements did not contain an XML property list.");
  const plist = output.slice(start, end + "</plist>".length);
  const parsed = spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], {
    env,
    encoding: "utf8",
    input: plist
  });
  if (parsed.error) throw parsed.error;
  if (parsed.status !== 0) throw new Error(`Signed archive entitlements were not a valid property list: ${parsed.stderr || parsed.stdout || "unknown plutil error"}`);
  return JSON.parse(parsed.stdout);
}

try {
  run("xcodebuild", [
    "-quiet",
    "-project", "ios/TexasSandFest.xcodeproj",
    "-scheme", "TexasSandFest",
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-archivePath", archivePath,
    "-allowProvisioningUpdates",
    "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES",
    "archive"
  ], "Create signed Texas SandFest archive", { capture: true });

  if (!existsSync(archivedAppPath)) throw new Error(`Archive did not contain the expected app at ${archivedAppPath}.`);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", archivedAppPath], "Verify archived app signature");

  run("xcodebuild", [
    "-quiet",
    "-exportArchive",
    "-archivePath", archivePath,
    "-exportPath", exportPath,
    "-exportOptionsPlist", "ios/AppStore/ExportOptionsLocal.plist",
    "-allowProvisioningUpdates"
  ], "Export locally signed App Store IPA", { capture: true });
  const ipaName = readdirSync(exportPath).find(name => name.endsWith(".ipa"));
  if (!ipaName) throw new Error("App Store export did not produce an IPA.");
  run("ditto", ["-x", "-k", path.join(exportPath, ipaName), unpackPath], "Unpack exported App Store IPA");
  const appPath = path.join(unpackPath, "Payload", "TexasSandFest.app");
  if (!existsSync(appPath)) throw new Error(`Exported IPA did not contain the expected app at ${appPath}.`);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], "Verify exported App Store app signature");

  const signedEntitlements = readSignedEntitlements(appPath);
  const associatedDomains = signedEntitlements["com.apple.developer.associated-domains"];
  if (JSON.stringify(associatedDomains) !== JSON.stringify([
    "applinks:www.heyelab.com",
    "applinks:sandfest.heyelab.com"
  ])) {
    throw new Error(`Signed archive has unexpected associated domains: ${JSON.stringify(associatedDomains || null)}.`);
  }
  if (
    signedEntitlements["application-identifier"] !== "J2459M36QV.com.portalcodex.texassandfest"
    || signedEntitlements["com.apple.developer.team-identifier"] !== "J2459M36QV"
    || signedEntitlements["aps-environment"] !== "production"
    || signedEntitlements["get-task-allow"] !== false
  ) {
    throw new Error(`Signed archive entitlements do not match the distribution identity and production boundary: ${JSON.stringify({
      applicationIdentifier: signedEntitlements["application-identifier"],
      teamIdentifier: signedEntitlements["com.apple.developer.team-identifier"],
      pushEnvironment: signedEntitlements["aps-environment"],
      getTaskAllow: signedEntitlements["get-task-allow"]
    })}.`);
  }
  console.log("Signed entitlement readiness: www + legacy Universal Links and production push identity passed.");

  const info = path.join(appPath, "Info.plist");
  const privacyManifestPath = path.join(appPath, "PrivacyInfo.xcprivacy");
  const version = run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", info], "Read release version", { capture: true }).trim();
  const build = run("plutil", ["-extract", "CFBundleVersion", "raw", "-o", "-", info], "Read release build", { capture: true }).trim();
  const bundle = run("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", info], "Read bundle identifier", { capture: true }).trim();
  if (!/^\d+(?:\.\d+){1,2}$/.test(version)) throw new Error(`Archive has invalid marketing version ${version}.`);
  if (!/^\d+(?:\.\d+){0,2}$/.test(build)) throw new Error(`Archive has invalid build number ${build}.`);
  if (bundle !== "com.portalcodex.texassandfest") throw new Error(`Archive has unexpected bundle identifier ${bundle}.`);
  if (!existsSync(privacyManifestPath)) {
    throw new Error("Archive does not contain PrivacyInfo.xcprivacy at the app-bundle root.");
  }

  const privacyManifest = JSON.parse(run(
    "plutil",
    ["-convert", "json", "-o", "-", privacyManifestPath],
    "Read privacy manifest",
    { capture: true }
  ));
  const userDefaultsDeclaration = privacyManifest.NSPrivacyAccessedAPITypes?.find(item => (
    item.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults"
  ));
  if (!userDefaultsDeclaration?.NSPrivacyAccessedAPITypeReasons?.includes("CA92.1")) {
    throw new Error("Privacy manifest does not declare the app-only UserDefaults reason CA92.1.");
  }
  const otherDataDeclaration = privacyManifest.NSPrivacyCollectedDataTypes?.find(item => (
    item.NSPrivacyCollectedDataType === "NSPrivacyCollectedDataTypeOtherDataTypes"
  ));
  if (
    privacyManifest.NSPrivacyTracking !== false
    || (privacyManifest.NSPrivacyTrackingDomains || []).length !== 0
    || otherDataDeclaration?.NSPrivacyCollectedDataTypeLinked !== false
    || otherDataDeclaration?.NSPrivacyCollectedDataTypeTracking !== false
    || !otherDataDeclaration?.NSPrivacyCollectedDataTypePurposes?.includes("NSPrivacyCollectedDataTypePurposeAppFunctionality")
  ) {
    throw new Error("Privacy manifest does not match the published non-linked Other Data app-functionality disclosure.");
  }

  console.log(`\nArchive readiness: ${bundle} version ${version} (${build}) is signed and structurally valid.`);
  console.log("Privacy readiness: bundled manifest matches the published disclosure and required-reason API use.");
  console.log("This gate prepares an archive but does not upload or submit it to App Store Connect.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(archivePath, { recursive: true, force: true });
  rmSync(exportPath, { recursive: true, force: true });
  rmSync(unpackPath, { recursive: true, force: true });
}

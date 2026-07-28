#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BOARD_LAUNCHD_LABEL,
  assessBoardLaunchdOwnership,
  boardLaunchAgentPath,
  boardLaunchAgentPlist,
  boardLaunchdCommand,
  boardLaunchdPresentationSafety,
  boardLaunchdStartSafety,
  boardLaunchdTarget,
  createBoardLaunchdController,
  launchctlServiceMissing,
  shellQuote
} from "../lib/board-launchd-service.mjs";

let checks = 0;
function check(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok ${label}`);
}

const root = "/Users/presenter/Texas SandFest";
const npmPath = "/opt/homebrew/bin/npm";
const logPath = `${root}/.sandfest-runtime/board demo.log`;
const command = boardLaunchdCommand({ root, npmPath, logPath });
const plist = boardLaunchAgentPlist({ root, npmPath, logPath });

check("launchd target is scoped to the current GUI user", boardLaunchdTarget({ uid: 501 }) === `gui/501/${BOARD_LAUNCHD_LABEL}`);
check("shell quoting preserves apostrophes without opening interpolation", shellQuote("board's demo") === "'board'\"'\"'s demo'");
check("launch command uses absolute paths and the reset-safe board entrypoint",
  command.includes(`mkdir -p '${root}/.sandfest-runtime'`)
  && command.includes(`cd '${root}'`)
  && command.includes(`exec '${npmPath}' run board:demo -- --reset`)
  && command.includes(`>> '${logPath}' 2>&1`));
check("LaunchAgent persists at login with keepalive and bounded restart",
  plist.includes("<key>RunAtLoad</key>")
  && plist.includes("<key>KeepAlive</key>")
  && plist.includes("<key>ThrottleInterval</key>")
  && plist.includes("<integer>5</integer>"));
check("LaunchAgent pins checkout, log, and guarded board entrypoint",
  plist.includes(`<string>${root}</string>`)
  && plist.includes(`<string>${logPath}</string>`)
  && plist.includes("run board:demo -- --reset"));
check("launch configuration does not embed board credentials",
  !`${command}\n${plist}`.includes("ADMIN_TOKEN")
  && !`${command}\n${plist}`.includes("BREVO")
  && !`${command}\n${plist}`.includes("TWILIO"));
assert.throws(
  () => boardLaunchdCommand({ root: "", npmPath, logPath }),
  /board checkout is required/i
);
checks += 1;
console.log("  ok missing launch paths fail closed");
assert.throws(
  () => boardLaunchdCommand({ root: "relative/checkout", npmPath, logPath }),
  /board checkout must be absolute/i
);
checks += 1;
console.log("  ok relative launch paths fail closed");

const submittedPrint = `
gui/501/${BOARD_LAUNCHD_LABEL} = {
  path = (submitted by launchctl[100])
  arguments = {
    /bin/zsh
    -lc
    cd ${root} && exec ${npmPath} run board:demo -- --reset
  }
}`;
check("ownership accepts the exact checkout and board command",
  assessBoardLaunchdOwnership(submittedPrint, { root }).owned);
const escapedRoot = `${root} & Board`;
check("ownership accepts an XML-escaped checkout in a persistent plist",
  assessBoardLaunchdOwnership(boardLaunchAgentPlist({
    root: escapedRoot,
    npmPath,
    logPath: `${escapedRoot}/.sandfest-runtime/board.log`
  }), { root: escapedRoot }).owned);
check("ownership rejects another checkout",
  !assessBoardLaunchdOwnership(submittedPrint, { root: "/Users/presenter/other" }).owned);
check("ownership rejects an unrelated command under the same label",
  !assessBoardLaunchdOwnership(`gui/501/${BOARD_LAUNCHD_LABEL} = { arguments = { sleep 60 } }`, { root }).owned);

const missingError = Object.assign(new Error("launchctl print failed"), {
  code: 113,
  stderr: "Could not find service"
});
check("missing launchd jobs are distinguished from control failures", launchctlServiceMissing(missingError));
check("service installation refuses to race a foreground supervisor",
  !boardLaunchdStartSafety({ serviceInstalled: false, supervisorAlive: true }).ok);
check("an installed service can restart its own supervisor",
  boardLaunchdStartSafety({ serviceInstalled: true, supervisorAlive: true }).ok);
check("presentation requires an owned persistent LaunchAgent",
  boardLaunchdPresentationSafety({
    supported: true,
    installed: true,
    configured: true,
    persistent: true,
    owned: true
  }).ok);
check("presentation rejects a session-scoped launchd job",
  !boardLaunchdPresentationSafety({
    supported: true,
    installed: true,
    configured: false,
    persistent: false,
    owned: true
  }).ok);
check("presentation rejects a foreign persistent configuration",
  !boardLaunchdPresentationSafety({
    supported: true,
    installed: true,
    configured: true,
    persistent: true,
    owned: false
  }).ok);

function persistentPrint(plistPath) {
  return `
gui/501/${BOARD_LAUNCHD_LABEL} = {
  path = ${plistPath}
  arguments = {
    /bin/zsh
    -lc
    cd ${root} && exec ${npmPath} run board:demo -- --reset
  }
}`;
}

const homeDir = await mkdtemp(path.join(os.tmpdir(), "sandfest-board-launchagent-"));
const plistPath = boardLaunchAgentPath({ homeDir });
let loaded = false;
let launchctlPrint = "";
const calls = [];
async function runFile(file, args) {
  calls.push([file, args]);
  if (file === "which") return { stdout: `${npmPath}\n`, stderr: "" };
  assert.equal(file, "launchctl");
  if (args[0] === "print") {
    if (!loaded) throw missingError;
    return { stdout: launchctlPrint, stderr: "" };
  }
  if (args[0] === "bootstrap") {
    loaded = true;
    launchctlPrint = persistentPrint(plistPath);
    return { stdout: "", stderr: "" };
  }
  if (args[0] === "kickstart") return { stdout: "", stderr: "" };
  if (args[0] === "bootout") {
    loaded = false;
    return { stdout: "", stderr: "" };
  }
  throw new Error(`Unexpected launchctl command: ${args.join(" ")}`);
}

const controller = createBoardLaunchdController({
  root,
  uid: 501,
  platform: "darwin",
  homeDir,
  runFile,
  npmPath,
  logPath
});
const firstStart = await controller.start();
const writtenPlist = await readFile(plistPath, "utf8");
check("first start writes and bootstraps a user LaunchAgent",
  firstStart.action === "started"
  && writtenPlist === plist
  && calls.some(([, args]) => args[0] === "bootstrap" && args[2] === plistPath));
const loadedState = await controller.inspect();
check("loaded service proves persistent checkout ownership",
  loadedState.installed
  && loadedState.configured
  && loadedState.persistent
  && loadedState.owned);
const secondStart = await controller.start();
check("repeated persistent start is idempotent", secondStart.action === "already_running");
const restart = await controller.restart();
check("restart replaces the loaded LaunchAgent process", restart.action === "restarted"
  && calls.some(([, args]) => args[0] === "kickstart" && args[1] === "-k"));
const stop = await controller.stop();
const stoppedState = await controller.inspect();
check("stop unloads the job but retains next-login configuration",
  stop.action === "stopped"
  && !stoppedState.installed
  && stoppedState.configured
  && stoppedState.owned);
const resumed = await controller.start();
check("start reloads the retained LaunchAgent", resumed.action === "started" && loaded);
const uninstall = await controller.uninstall();
const uninstalledState = await controller.inspect();
check("uninstall removes both the loaded job and persistent plist",
  uninstall.action === "uninstalled"
  && !uninstalledState.installed
  && !uninstalledState.configured);

const migrationHome = await mkdtemp(path.join(os.tmpdir(), "sandfest-board-migration-"));
const migrationPlist = boardLaunchAgentPath({ homeDir: migrationHome });
let legacyLoaded = true;
let legacyPrint = submittedPrint;
let legacyRetirementPolls = 0;
const migrationCalls = [];
async function migrationRunFile(file, args) {
  migrationCalls.push([file, args]);
  if (file === "which") return { stdout: `${npmPath}\n`, stderr: "" };
  if (args[0] === "print") {
    if (legacyRetirementPolls > 0) {
      legacyRetirementPolls -= 1;
      if (legacyRetirementPolls === 0) legacyLoaded = false;
    }
    if (!legacyLoaded) throw missingError;
    return { stdout: legacyPrint, stderr: "" };
  }
  if (args[0] === "bootout") {
    legacyRetirementPolls = 2;
    return { stdout: "", stderr: "" };
  }
  if (args[0] === "bootstrap") {
    legacyLoaded = true;
    legacyPrint = persistentPrint(migrationPlist);
    return { stdout: "", stderr: "" };
  }
  throw new Error(`Unexpected migration command: ${file} ${args.join(" ")}`);
}
const migrationController = createBoardLaunchdController({
  root,
  uid: 501,
  platform: "darwin",
  homeDir: migrationHome,
  runFile: migrationRunFile,
  sleep: async () => {},
  npmPath,
  logPath
});
const migration = await migrationController.start();
check("session-scoped jobs migrate through bootout and LaunchAgent bootstrap",
  migration.action === "migrated"
  && migrationCalls.some(([, args]) => args[0] === "bootout")
  && migrationCalls.some(([, args]) => args[0] === "bootstrap")
  && migrationCalls.filter(([, args]) => args[0] === "print").length >= 3
  && (await readFile(migrationPlist, "utf8")) === plist);

const foreignHome = await mkdtemp(path.join(os.tmpdir(), "sandfest-board-foreign-"));
const foreignPlist = boardLaunchAgentPath({ homeDir: foreignHome });
await mkdir(path.dirname(foreignPlist), { recursive: true });
await writeFile(foreignPlist, boardLaunchAgentPlist({
  root: "/Users/presenter/other",
  npmPath,
  logPath: "/Users/presenter/other/.sandfest-runtime/board.log"
}));
const foreignController = createBoardLaunchdController({
  root,
  uid: 501,
  platform: "darwin",
  homeDir: foreignHome,
  runFile: async (_file, args) => {
    if (args[0] === "print") throw missingError;
    throw new Error(`Unexpected foreign command: ${args.join(" ")}`);
  },
  npmPath,
  logPath
});
await assert.rejects(
  () => foreignController.start(),
  /Refusing to control/
);
checks += 1;
console.log("  ok an unowned persistent plist fails closed");

const unsupported = createBoardLaunchdController({
  root,
  uid: 501,
  platform: "linux",
  homeDir,
  runFile
});
check("non-macOS hosts report the service unsupported", !(await unsupported.inspect()).supported);

await Promise.all([
  rm(homeDir, { recursive: true, force: true }),
  rm(migrationHome, { recursive: true, force: true }),
  rm(foreignHome, { recursive: true, force: true })
]);

console.log(`\nBoard service lifecycle: ${checks}/${checks} checks passed.`);

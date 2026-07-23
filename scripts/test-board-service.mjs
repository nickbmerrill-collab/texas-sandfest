#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  BOARD_LAUNCHD_LABEL,
  assessBoardLaunchdOwnership,
  boardLaunchdCommand,
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

check("launchd target is scoped to the current GUI user", boardLaunchdTarget({ uid: 501 }) === `gui/501/${BOARD_LAUNCHD_LABEL}`);
check("shell quoting preserves apostrophes without opening interpolation", shellQuote("board's demo") === "'board'\"'\"'s demo'");
check("launch command uses absolute paths and the reset-safe board entrypoint",
  command.includes(`mkdir -p '${root}/.sandfest-runtime'`)
  && command.includes(`cd '${root}'`)
  && command.includes(`exec '${npmPath}' run board:demo -- --reset`)
  && command.includes(`>> '${logPath}' 2>&1`));
check("launch command does not embed board credentials",
  !command.includes("ADMIN_TOKEN")
  && !command.includes("BREVO")
  && !command.includes("TWILIO"));
assert.throws(
  () => boardLaunchdCommand({ root: "", npmPath, logPath }),
  /paths are required/
);
checks += 1;
console.log("  ok missing launch paths fail closed");

const ownedPrint = `
gui/501/${BOARD_LAUNCHD_LABEL} = {
  arguments = {
    /bin/zsh
    -lc
    cd ${root} && exec ${npmPath} run board:demo -- --reset
  }
}`;
check("ownership accepts the exact checkout and board command",
  assessBoardLaunchdOwnership(ownedPrint, { root }).owned);
check("ownership rejects another checkout",
  !assessBoardLaunchdOwnership(ownedPrint, { root: "/Users/presenter/other" }).owned);
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

let installed = false;
let launchctlPrint = ownedPrint;
const calls = [];
async function runFile(file, args) {
  calls.push([file, args]);
  if (file === "which") return { stdout: `${npmPath}\n`, stderr: "" };
  assert.equal(file, "launchctl");
  if (args[0] === "print") {
    if (!installed) throw missingError;
    return { stdout: launchctlPrint, stderr: "" };
  }
  if (args[0] === "submit") {
    installed = true;
    return { stdout: "", stderr: "" };
  }
  if (args[0] === "kickstart") return { stdout: "", stderr: "" };
  if (args[0] === "bootout") {
    installed = false;
    return { stdout: "", stderr: "" };
  }
  throw new Error(`Unexpected launchctl command: ${args.join(" ")}`);
}

const controller = createBoardLaunchdController({
  root,
  uid: 501,
  platform: "darwin",
  runFile,
  npmPath
});
const firstStart = await controller.start();
check("first start submits one keepalive launchd job",
  firstStart.action === "started"
  && calls.some(([, args]) => args[0] === "submit" && args.includes(BOARD_LAUNCHD_LABEL)));
const secondStart = await controller.start();
check("repeated start is idempotent", secondStart.action === "already_running");
const restart = await controller.restart();
check("restart replaces the owned launchd process", restart.action === "restarted"
  && calls.some(([, args]) => args[0] === "kickstart" && args[1] === "-k"));
const stop = await controller.stop();
check("stop boots out the keepalive owner", stop.action === "stopped" && installed === false);

installed = true;
launchctlPrint = `gui/501/${BOARD_LAUNCHD_LABEL} = { arguments = { sleep 60 } }`;
await assert.rejects(
  () => controller.restart(),
  /Refusing to control/
);
checks += 1;
console.log("  ok an unowned label fails closed");

const unsupported = createBoardLaunchdController({
  root,
  uid: 501,
  platform: "linux",
  runFile
});
check("non-macOS hosts report the service unsupported", !(await unsupported.inspect()).supported);

console.log(`\nBoard service lifecycle: ${checks}/${checks} checks passed.`);

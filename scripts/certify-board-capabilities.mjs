#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BOARD_CAPABILITY_CERTIFICATE_SCHEMA_VERSION,
  BOARD_CAPABILITY_DEFERRED_GATES,
  BOARD_CAPABILITY_JOURNEYS,
  boardCapabilityCoverage,
  certifyBoardBrowserReport,
  certifyBoardCapabilityJourney,
  certifyBoardReadinessReport
} from "../lib/board-capability-certificate.mjs";
import {
  BOARD_DEMO_SESSION_SCHEMA_VERSION,
  boardDemoSessionPath,
  boardDemoSessionProcessAlive,
  readBoardDemoSession
} from "../lib/board-demo-session.mjs";
import { writeJsonFileAtomic } from "../lib/safe-json-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, ".sandfest-runtime", "board-capability-certification.json");
const jsonOutput = process.argv.includes("--json");
const skipBrowsers = process.argv.includes("--skip-browsers");

function optionValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || null;
}

if (process.argv.includes("--help")) {
  console.log("Usage: npm run board:certify -- [--json] [--only=id,id] [--skip-browsers] [--output=path|none]");
  console.log("Runs every board workflow proof, Chromium and WebKit acceptance, and a final exact-baseline check.");
  console.log(`Journey IDs: ${BOARD_CAPABILITY_JOURNEYS.map(item => item.id).join(", ")}`);
  process.exit(0);
}

const requestedIds = optionValue("only")?.split(",").map(value => value.trim()).filter(Boolean) || [];
const unknownIds = requestedIds.filter(id => !BOARD_CAPABILITY_JOURNEYS.some(item => item.id === id));
if (unknownIds.length) {
  console.error(`Unknown board capability journey: ${unknownIds.join(", ")}.`);
  process.exit(2);
}
const journeys = requestedIds.length
  ? BOARD_CAPABILITY_JOURNEYS.filter(item => requestedIds.includes(item.id))
  : [...BOARD_CAPABILITY_JOURNEYS];
const outputOption = optionValue("output") || process.env.SANDFEST_BOARD_CERTIFICATE_FILE || DEFAULT_OUTPUT;
const outputFile = outputOption === "none" ? null : path.resolve(outputOption);
const sessionFile = boardDemoSessionPath(process.env, { root: ROOT });

function log(value = "") {
  if (!jsonOutput) console.log(value);
}

function commandEnvironment() {
  const env = { ...process.env, SANDFEST_BOARD_SESSION_FILE: sessionFile };
  for (const key of [
    "SANDFEST_BOARD_WEB_URL",
    "SANDFEST_BOARD_PUBLIC_SITE_URL",
    "SANDFEST_BOARD_API_BASE",
    "SANDFEST_BOARD_EMAIL_BASE",
    "SANDFEST_BOARD_SMS_BASE"
  ]) delete env[key];
  return env;
}

async function runJson(script, { args = [], timeoutMs, environment = {} } = {}) {
  const child = spawn(process.execPath, [script, ...args, "--json"], {
    cwd: ROOT,
    env: { ...commandEnvironment(), ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${script} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", value => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  let report = null;
  try {
    report = JSON.parse(stdout);
  } catch {
    const error = new Error(`${script} returned invalid JSON.`);
    error.diagnostic = `${stderr}\n${stdout}`.trim();
    throw error;
  }
  if (code !== 0) {
    const error = new Error(`${script} exited ${code}.`);
    error.diagnostic = report?.error || stderr.trim() || `Exit ${code}`;
    throw error;
  }
  return report;
}

async function readiness() {
  return certifyBoardReadinessReport(await runJson("scripts/check-board-demo.mjs", { timeoutMs: 30_000 }));
}

function sourceProjection(session) {
  if (
    !session
    || session.schemaVersion !== BOARD_DEMO_SESSION_SCHEMA_VERSION
    || session.status !== "ready"
    || !boardDemoSessionProcessAlive(session)
  ) {
    throw new Error("The active board supervisor session is not ready.");
  }
  if (!session.source?.commit || !session.source?.branch) {
    throw new Error("The active board supervisor session does not pin a source revision.");
  }
  if (
    session.source.branch !== "main"
    || session.source.dirty !== false
    || session.source.matchesOriginMain !== true
    || session.source.commit !== session.source.originMainCommit
  ) {
    throw new Error("Certification requires clean main at local origin/main.");
  }
  const source = {
    branch: session.source?.branch || null,
    commit: session.source?.commit || null,
    originMainCommit: session.source?.originMainCommit || null,
    matchesOriginMain: session.source?.matchesOriginMain === true,
    dirty: session.source?.dirty === true
  };
  return source;
}

function publicFailure(stage, item, error) {
  const label = item?.label || stage;
  const command = item?.command || "npm run board:check";
  return {
    stage,
    id: item?.id || null,
    message: `${label} certification failed. Run ${command} for detailed diagnostics.`
  };
}

function relativeOutputPath(file) {
  if (!file) return null;
  const relative = path.relative(ROOT, file);
  return relative && !relative.startsWith("..") ? relative : file;
}

const startedAt = new Date();
const results = [];
const browsers = [];
let initialReadiness = null;
let finalReadiness = null;
let source = null;
let failure = null;
let diagnostic = "";

try {
  log("\n=== Board capability certification ===\n");
  initialReadiness = await readiness();
  source = sourceProjection(await readBoardDemoSession(sessionFile));
  log(`Source: ${source.branch}@${source.commit.slice(0, 8)} · ${initialReadiness.readiness} ready`);

  for (const [index, journey] of journeys.entries()) {
    log(`[${index + 1}/${journeys.length}] ${journey.label}...`);
    const journeyStartedAt = Date.now();
    try {
      const report = await runJson(journey.script, { timeoutMs: journey.timeoutMs });
      results.push({
        ...certifyBoardCapabilityJourney(journey.id, report),
        durationMs: Date.now() - journeyStartedAt
      });
      log(`      passed · baseline ${results.at(-1).reset}`);
    } catch (error) {
      failure = publicFailure("journey", journey, error);
      diagnostic = error.diagnostic || error.message;
      break;
    }
  }

  if (!failure && !skipBrowsers) {
    for (const engine of ["chromium", "webkit"]) {
      log(`Browser acceptance: ${engine}...`);
      const browserStartedAt = Date.now();
      try {
        const report = await runJson("scripts/check-board-browser.mjs", {
          timeoutMs: 240_000,
          environment: engine === "webkit" ? { SANDFEST_BOARD_BROWSER: "webkit" } : {}
        });
        browsers.push({
          ...certifyBoardBrowserReport(report, engine),
          durationMs: Date.now() - browserStartedAt
        });
        log(`      passed · ${report.passed}/${report.total}`);
      } catch (error) {
        failure = publicFailure("browser", {
          id: engine,
          label: `${engine} browser acceptance`,
          command: engine === "webkit" ? "npm run board:rehearse:webkit" : "npm run board:rehearse"
        }, error);
        diagnostic = error.diagnostic || error.message;
        break;
      }
    }
  }
} catch (error) {
  failure = publicFailure("readiness", null, error);
  diagnostic = error.diagnostic || error.message;
}

try {
  finalReadiness = await readiness();
  const finalSource = sourceProjection(await readBoardDemoSession(sessionFile));
  if (source && finalSource.commit !== source.commit) {
    throw new Error("The presentation source changed during certification.");
  }
} catch (error) {
  if (!failure) failure = publicFailure("final_readiness", null, error);
  diagnostic = diagnostic || error.diagnostic || error.message;
}

const completedAt = new Date();
const fullJourneyScope = journeys.length === BOARD_CAPABILITY_JOURNEYS.length;
const fullBrowserScope = !skipBrowsers && browsers.length === 2;
const ok = !failure
  && results.length === journeys.length
  && Boolean(finalReadiness)
  && (skipBrowsers || browsers.length === 2);
const certificate = {
  schemaVersion: BOARD_CAPABILITY_CERTIFICATE_SCHEMA_VERSION,
  kind: "sandfest_board_capability_certificate",
  mode: "synthetic_board_demo",
  scope: fullJourneyScope && fullBrowserScope ? "full" : "focused",
  ok,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: completedAt.getTime() - startedAt.getTime(),
  source,
  links: finalReadiness ? {
    visitor: finalReadiness.visitor,
    operations: finalReadiness.operations
  } : null,
  readiness: {
    before: initialReadiness?.readiness || null,
    after: finalReadiness?.readiness || null,
    baselineRestored: finalReadiness?.readiness === "12/12"
  },
  selectedJourneys: journeys.map(item => item.id),
  journeys: results,
  browsers,
  certifiedCapabilities: [
    "source_and_service_readiness",
    ...boardCapabilityCoverage(journeys),
    ...(fullBrowserScope ? ["responsive_cross_browser_web"] : [])
  ],
  deferredProductionGates: [...BOARD_CAPABILITY_DEFERRED_GATES],
  failure
};

try {
  if (outputFile) await writeJsonFileAtomic(outputFile, certificate);
} catch (error) {
  certificate.ok = false;
  certificate.failure = {
    stage: "artifact",
    id: null,
    message: "The capability certificate could not be written atomically."
  };
  diagnostic = diagnostic || error.message;
}

if (jsonOutput) {
  console.log(JSON.stringify({ ...certificate, artifact: relativeOutputPath(outputFile) }, null, 2));
} else if (certificate.ok) {
  console.log("\nBoard capability certification passed.");
  console.log(`Journeys:   ${certificate.journeys.length}/${journeys.length}`);
  console.log(`Browsers:   ${skipBrowsers ? "skipped by operator" : certificate.browsers.map(item => `${item.engine} ${item.passed}/${item.total}`).join(" · ")}`);
  console.log(`Baseline:   ${certificate.readiness.after}`);
  console.log(`Visitor:    ${certificate.links.visitor}`);
  console.log(`Operations: ${certificate.links.operations}`);
  if (outputFile) console.log(`Certificate: ${relativeOutputPath(outputFile)}`);
  if (certificate.scope !== "full") console.log("Scope:      focused certification; run without filters for the full board certificate.");
} else {
  console.error(`\nBoard capability certification failed: ${certificate.failure?.message || "unknown failure"}`);
  if (diagnostic) console.error(`Diagnostic: ${diagnostic}`);
  if (certificate.readiness.after) console.error(`Final baseline: ${certificate.readiness.after}`);
  if (outputFile) console.error(`Certificate: ${relativeOutputPath(outputFile)}`);
}

process.exitCode = certificate.ok ? 0 : 1;

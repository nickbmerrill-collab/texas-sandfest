#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assessBoardBriefingDeck,
  assessBoardShowtimeBinding
} from "../lib/board-showtime.mjs";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOutput = process.argv.includes("--json");
const unknown = process.argv.slice(2).filter(argument => argument !== "--json");
const runtimeDir = path.join(ROOT, ".sandfest-runtime");
const deckPath = path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx");
const decisionBriefPath = path.join(ROOT, "output", "pdf", "SandFest-Board-Decision-Brief.pdf");
const flightCardPath = path.join(ROOT, "output", "pdf", "SandFest-Presenter-Flight-Card.pdf");
const videoDir = path.join(ROOT, "artifacts", "board-demo");
const videoPath = path.join(videoDir, "texas-sandfest-board-demo.mp4");
const capturePath = path.join(videoDir, "capture.json");
const sessionPath = path.join(runtimeDir, "board-demo-session.json");
const certificatePath = path.join(runtimeDir, "board-capability-certification.json");

if (unknown.length) {
  console.error("Usage: node scripts/board-showtime.mjs [--json]");
  process.exit(1);
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
    ...options
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function gitState() {
  const [{ stdout: branch }, { stdout: head }, { stdout: originMain }, { stdout: status }] = await Promise.all([
    run("git", ["branch", "--show-current"]),
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["rev-parse", "origin/main"]),
    run("git", ["status", "--porcelain=v1"])
  ]);
  const changes = status.trim() ? status.trim().split("\n") : [];
  return {
    branch: branch.trim(),
    head: head.trim(),
    originMain: originMain.trim(),
    dirty: changes.length > 0,
    changeCount: changes.length
  };
}

async function inspectDeck() {
  try {
    await run("unzip", ["-tqq", deckPath]);
    const [{ stdout: listing }, details] = await Promise.all([
      run("unzip", ["-Z1", deckPath]),
      stat(deckPath)
    ]);
    const entries = listing.trim().split("\n").filter(Boolean);
    const slideEntries = entries.filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry));
    const noteEntries = entries.filter(entry => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry));
    const xmlEntries = [...slideEntries, ...noteEntries];
    const xmlPairs = await Promise.all(xmlEntries.map(async entry => {
      const { stdout } = await run("unzip", ["-p", deckPath, entry]);
      return [entry, stdout];
    }));
    const xml = Object.fromEntries(xmlPairs);
    return assessBoardBriefingDeck({
      entries,
      slideXml: Object.fromEntries(slideEntries.map(entry => [entry, xml[entry]])),
      notesXml: Object.fromEntries(noteEntries.map(entry => [entry, xml[entry]])),
      size: details.size
    });
  } catch (error) {
    return {
      ok: false,
      slideCount: 0,
      notesCount: 0,
      sourceNoteCount: 0,
      size: 0,
      errors: [`The board briefing could not be inspected: ${error.message}`]
    };
  }
}

async function verifyVideo() {
  try {
    const [{ stdout }, details] = await Promise.all([
      run(process.execPath, [path.join(ROOT, "scripts", "verify-board-demo-video.mjs")]),
      stat(videoPath)
    ]);
    return {
      ok: true,
      size: details.size,
      detail: stdout.trim().split("\n").at(-1) || "Verified."
    };
  } catch (error) {
    const output = String(error?.stderr || error?.stdout || error?.message || "").trim();
    return {
      ok: false,
      size: 0,
      detail: output.split("\n").filter(Boolean).at(-1) || "The fallback video could not be verified."
    };
  }
}

async function verifyHandouts() {
  try {
    const { stdout } = await run(process.execPath, [
      path.join(ROOT, "scripts", "verify-board-handouts.mjs")
    ]);
    return {
      ok: true,
      detail: stdout.trim().split("\n").at(-1) || "Board presentation handouts verified."
    };
  } catch (error) {
    const output = String(error?.stderr || error?.stdout || error?.message || "").trim();
    return {
      ok: false,
      detail: output.split("\n").filter(Boolean).at(-1) || "The board presentation handouts could not be verified."
    };
  }
}

async function serviceGate() {
  try {
    const { stdout } = await run(process.execPath, [
      path.join(ROOT, "scripts", "board-service.mjs"),
      "present"
    ]);
    return {
      ok: true,
      detail: stdout.trim().split("\n").find(line => line.includes("Presentation gate")) || "Presentation gate passed."
    };
  } catch (error) {
    const output = `${error?.stdout || ""}\n${error?.stderr || ""}`.trim();
    return {
      ok: false,
      detail: output.split("\n").filter(Boolean).at(-1) || error.message
    };
  }
}

const [
  git,
  deck,
  handouts,
  video,
  service,
  session,
  certificate,
  capture
] = await Promise.all([
  gitState(),
  inspectDeck(),
  verifyHandouts(),
  verifyVideo(),
  serviceGate(),
  readJson(sessionPath),
  readJson(certificatePath),
  readJson(capturePath)
]);

const binding = assessBoardShowtimeBinding({ git, session, certificate, capture });
const checks = [
  {
    id: "source_binding",
    label: "Source and artifact binding",
    ok: binding.ok,
    detail: binding.ok
      ? `${binding.source} · deck, certificate, video, and links agree`
      : binding.errors.join(" "),
    action: "Commit and merge the presentation changes, restart the board service, run board:certify, then rebuild the video."
  },
  {
    id: "persistent_service",
    label: "Persistent presentation service",
    ok: service.ok,
    detail: service.detail,
    action: "Run npm run board:service:restart, npm run board:certify, and npm run board:present from clean main."
  },
  {
    id: "briefing_deck",
    label: "Board briefing deck",
    ok: deck.ok,
    detail: deck.ok
      ? `${deck.slideCount}/12 slides · ${deck.sourceNoteCount}/12 source-backed presenter notes`
      : deck.errors.join(" "),
    action: "Repair and re-export docs/presentations/SandFest-Board-Platform-Briefing.pptx."
  },
  {
    id: "fallback_video",
    label: "Narrated fallback video",
    ok: video.ok,
    detail: video.detail,
    action: "Run npm run video:board against the current certified presentation service."
  },
  {
    id: "boardroom_handouts",
    label: "Board decision brief and presenter flight card",
    ok: handouts.ok,
    detail: handouts.detail,
    action: "Run npm run board:handouts and visually inspect both one-page PDFs."
  }
];
const result = {
  ok: checks.every(check => check.ok),
  checkedAt: new Date().toISOString(),
  source: binding.source,
  links: {
    visitor: binding.visitor,
    operations: binding.operations
  },
  files: {
    deck: deckPath,
    video: videoPath,
    decisionBrief: decisionBriefPath,
    flightCard: flightCardPath
  },
  checks
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\nBoard showtime preflight: ${result.ok ? "READY" : "NOT READY"}\n`);
  for (const check of checks) {
    console.log(`  ${check.ok ? "✓" : "✗"} ${check.label}: ${check.detail}`);
    if (!check.ok) console.log(`    Action: ${check.action}`);
  }
  if (result.links.visitor) console.log(`\nVisitor:    ${result.links.visitor}`);
  if (result.links.operations) console.log(`Operations: ${result.links.operations}`);
  console.log(`Deck:       ${deckPath}`);
  console.log(`Video:      ${videoPath}\n`);
  console.log(`Brief:      ${decisionBriefPath}`);
  console.log(`Flight card: ${flightCardPath}\n`);
}

process.exitCode = result.ok ? 0 : 1;

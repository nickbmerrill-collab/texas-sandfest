import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessBoardBriefingDeck,
  assessBoardShowtimeBinding,
  BOARD_BRIEFING_SLIDE_COUNT
} from "../lib/board-showtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;

async function check(label, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const entries = [];
const slideXml = {};
const notesXml = {};
for (let index = 1; index <= BOARD_BRIEFING_SLIDE_COUNT; index += 1) {
  const slide = `ppt/slides/slide${index}.xml`;
  const note = `ppt/notesSlides/notesSlide${index}.xml`;
  entries.push(slide, note);
  slideXml[slide] = `<a:t>${index === 1 ? "A Certified Festival Platform" : `Slide ${index}`}</a:t>`;
  notesXml[note] = `<a:t>Presenter note</a:t><a:t>[Sources]</a:t><a:t>- Internal: evidence.json</a:t>`;
}
const source = {
  branch: "main",
  commit: "a".repeat(40),
  originMainCommit: "a".repeat(40),
  matchesOriginMain: true,
  dirty: false
};
const links = {
  visitor: "http://127.0.0.1:5175/?mode=visitor",
  operations: "http://127.0.0.1:5175/admin.html"
};
const certificate = {
  ok: true,
  completedAt: "2026-07-25T20:16:04.485Z",
  source,
  links
};
const session = {
  status: "ready",
  source,
  links
};
const capture = {
  visitorUrl: links.visitor,
  operationsUrl: links.operations,
  runtime: {
    mode: "board_demo",
    eventId: "texas-sandfest-2027",
    documentIngestionReady: true,
    label: "Board demonstration | Synthetic 2027 data | No external messages, charges, or live-provider calls"
  },
  certificate: {
    ok: true,
    completedAt: certificate.completedAt,
    source
  }
};
const git = {
  branch: "main",
  head: source.commit,
  originMain: source.originMainCommit,
  dirty: false,
  changeCount: 0
};

console.log("\n=== Board showtime contract ===\n");

await check("deck assessment requires 12 slides and source-backed presenter notes", () => {
  const result = assessBoardBriefingDeck({
    entries,
    slideXml,
    notesXml,
    size: 55_000
  });
  assert.equal(result.ok, true);
  assert.equal(result.slideCount, 12);
  assert.equal(result.sourceNoteCount, 12);
});

await check("deck assessment rejects a missing source note and stale title", () => {
  const result = assessBoardBriefingDeck({
    entries,
    slideXml: { ...slideXml, "ppt/slides/slide1.xml": "<a:t>Old briefing</a:t>" },
    notesXml: { ...notesXml, "ppt/notesSlides/notesSlide12.xml": "<a:t>No source block</a:t>" },
    size: 55_000
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

await check("showtime binding accepts one clean source, certificate, session, video, and link set", () => {
  const result = assessBoardShowtimeBinding({ git, session, certificate, capture });
  assert.equal(result.ok, true);
});

await check("showtime binding rejects dirty source, stale video, and link drift", () => {
  const result = assessBoardShowtimeBinding({
    git: { ...git, dirty: true, changeCount: 2 },
    session,
    certificate,
    capture: {
      ...capture,
      operationsUrl: "http://127.0.0.1:5199/admin.html",
      certificate: {
        ...capture.certificate,
        source: { ...source, commit: "b".repeat(40) }
      }
    }
  });
  assert.equal(result.ok, false);
  assert(result.errors.some(error => error.includes("uncommitted")));
  assert(result.errors.some(error => error.includes("fallback video")));
  assert(result.errors.some(error => error.includes("links")));
});

await check("package scripts expose the showtime preflight", async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["board:showtime"], "node scripts/board-showtime.mjs");
  assert.equal(packageJson.scripts["board:handouts"], "npm run board:handouts:build && npm run board:handouts:verify");
});

console.log(`\nBoard showtime contract: ${passed}/${passed} checks passed.\n`);

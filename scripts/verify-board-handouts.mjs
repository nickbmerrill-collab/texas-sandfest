import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handouts = [
  {
    file: path.join(ROOT, "output", "pdf", "SandFest-Board-Decision-Brief.pdf"),
    required: [
      "Approve the activation path",
      "Five decisions requested",
      "Recommended motion",
      "deployment:verify:site",
      "higher-risk optional technologies deferred until each gate is accepted"
    ]
  },
  {
    file: path.join(ROOT, "output", "pdf", "SandFest-Presenter-Flight-Card.pdf"),
    required: [
      "Boardroom route and recovery",
      "18-minute route",
      "npm run board:showtime",
      "deployment:verify:site",
      "Never send, charge, or activate a live provider"
    ]
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const handout of handouts) {
  const details = await stat(handout.file);
  assert(details.size >= 30_000, `${path.basename(handout.file)} is unexpectedly small.`);
  const [{ stdout: info }, { stdout: text }] = await Promise.all([
    run("pdfinfo", [handout.file], { encoding: "utf8" }),
    run("pdftotext", ["-layout", handout.file, "-"], { encoding: "utf8" })
  ]);
  const pages = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1] || 0);
  const normalizedText = text.replace(/\s+/g, " ").trim().toLowerCase();
  assert(pages === 1, `${path.basename(handout.file)} must be exactly one page.`);
  assert(/Page size:\s+612 x 792 pts \(letter\)/.test(info), `${path.basename(handout.file)} is not US Letter.`);
  for (const phrase of handout.required) {
    assert(normalizedText.includes(phrase.toLowerCase()), `${path.basename(handout.file)} is missing "${phrase}".`);
  }
  assert(!/\b(TODO|TBD|Lorem ipsum)\b/i.test(text), `${path.basename(handout.file)} contains placeholder copy.`);
  console.log(`Verified ${path.basename(handout.file)} · 1 page · ${(details.size / 1_000).toFixed(1)} KB`);
}

console.log("Board presentation handouts verified.");

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(process.env.SANDFEST_VIDEO_DIR || join(root, "artifacts/board-demo"));
const frameDir = resolve(process.env.SANDFEST_VIDEO_FRAME_DIR || join(artifactDir, "frames"));
const manifestPath = join(root, "docs/board-demo-scenes.json");
const capturePath = join(artifactDir, "capture.json");
const outputPath = join(artifactDir, "texas-sandfest-board-demo.mp4");
const posterPath = join(artifactDir, "texas-sandfest-board-demo-poster.png");
const transcriptPath = join(artifactDir, "texas-sandfest-board-demo-transcript.txt");
const expectedDeferrals = [
  "live_payment_and_accounting_providers",
  "live_email_and_sms_providers",
  "live_weather_and_ferry_feeds",
  "live_webcam_edge_agents",
  "production_identity_and_bot_protection",
  "public_dns_and_recovery_cutover"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngDimensions(bytes) {
  assert(bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG", "Frame is not a PNG.");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const capture = JSON.parse(await readFile(capturePath, "utf8"));
assert(manifest?.title && Array.isArray(manifest.scenes) && manifest.scenes.length === 12, "The board video must define exactly 12 narrated scenes.");
assert(capture?.schemaVersion === 1 && Array.isArray(capture.frames), "Capture evidence is missing or incompatible.");
assert(capture.runtime?.mode === "board_demo", "Capture evidence is not from the board runtime.");
assert(capture.runtime?.documentIngestionReady === true, "Document ingestion was not ready during capture.");
assert(capture.runtime?.label?.includes("Synthetic 2027 data"), "Synthetic-data disclosure is missing from capture evidence.");
assert(capture.runtime?.label?.includes("No external messages, charges, or live-provider calls"), "The no-live-provider boundary is missing from capture evidence.");
assert(capture.certificate?.ok === true
  && capture.certificate?.source?.branch === "main"
  && capture.certificate?.source?.dirty === false
  && capture.certificate?.source?.matchesOriginMain === true,
  "Capture evidence is not bound to a certified clean main revision.");
assert(capture.certificate?.journeyCount === 10, "Capture evidence does not contain all 10 board journeys.");
assert(JSON.stringify(capture.certificate?.deferredProductionGates || []) === JSON.stringify(expectedDeferrals),
  "Capture evidence does not preserve the approved post-board provider deferrals.");
for (const engine of ["chromium", "webkit"]) {
  const proof = capture.certificate?.browsers?.find(item => item.engine === engine);
  assert(proof?.passed === 14 && proof?.total === 14, `${engine} capture evidence is not 14/14.`);
}

const expectedFrames = manifest.scenes.map(scene => scene.frame);
assert(new Set(expectedFrames).size === expectedFrames.length, "Scene frame names must be unique.");
assert(capture.frames.length === expectedFrames.length, "Capture evidence frame count does not match the scene manifest.");
const frameHashes = new Set();
let latestFrameMtime = 0;
for (const frame of expectedFrames) {
  const framePath = join(frameDir, frame);
  const bytes = await readFile(framePath);
  const details = await stat(framePath);
  const dimensions = pngDimensions(bytes);
  const digest = sha256(bytes);
  const evidence = capture.frames.find(item => item.file === frame);
  assert(bytes.length >= 20_000, `${frame} is too small to be a complete application capture.`);
  assert(dimensions.width === 1600 && dimensions.height === 900, `${frame} is not 1600 by 900.`);
  assert(evidence?.sha256 === digest && evidence?.bytes === bytes.length, `${frame} does not match capture evidence.`);
  frameHashes.add(digest);
  latestFrameMtime = Math.max(latestFrameMtime, details.mtimeMs);
}
assert(frameHashes.size === expectedFrames.length, "One or more board video scenes reuse the same frame.");
const captureDetails = await stat(capturePath);
latestFrameMtime = Math.max(latestFrameMtime, captureDetails.mtimeMs);

const expectedTranscript = [manifest.title, "", ...manifest.scenes.flatMap((scene, index) => [
  `${index + 1}. ${scene.title}`,
  scene.narration,
  ""
])].join("\n");
const transcript = await readFile(transcriptPath, "utf8");
assert(transcript === expectedTranscript, "The rendered transcript does not match the scene manifest.");

const poster = await readFile(posterPath);
const firstFrame = await readFile(join(frameDir, expectedFrames[0]));
assert(sha256(poster) === sha256(firstFrame), "The poster is not the verified opening frame.");

const { stdout } = await run("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate",
  "-of", "json",
  outputPath
]);
const probe = JSON.parse(stdout);
const video = probe.streams?.find(stream => stream.codec_type === "video");
const audio = probe.streams?.find(stream => stream.codec_type === "audio");
const duration = Number(probe.format?.duration);
const size = Number(probe.format?.size);
assert(video?.codec_name === "h264" && video?.width === 1920 && video?.height === 1080, "Video stream is not 1080p H.264.");
assert(video?.r_frame_rate === "30/1", "Video stream is not 30 frames per second.");
assert(audio?.codec_name === "aac", "Audio stream is not AAC.");
assert(Number.isFinite(duration) && duration >= 120 && duration <= 600, "Video duration is outside the two-to-ten-minute presentation range.");
assert(Number.isFinite(size) && size >= 1_000_000, "Video output is unexpectedly small.");
const videoDetails = await stat(outputPath);
assert(videoDetails.mtimeMs >= latestFrameMtime, "Video output predates one or more captured frames.");

console.log("Board demo video verification passed.");
console.log(`Scenes: ${manifest.scenes.length}/12`);
console.log(`Certificate: ${capture.certificate.journeyCount}/10 journeys · Chromium 14/14 · WebKit 14/14`);
console.log(`Video: ${Math.round(duration)}s · 1920x1080 · H.264/AAC · ${(size / 1_000_000).toFixed(1)} MB`);

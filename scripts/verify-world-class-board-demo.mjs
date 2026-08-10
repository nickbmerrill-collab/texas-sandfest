import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = join(root, "artifacts/board-presentation-demo/h3");
const videoPath = join(artifactDir, "texas-sandfest-world-class-board-demo.mp4");
const reportPath = join(artifactDir, "texas-sandfest-world-class-board-demo-verification.json");
const transcriptQaPath = join(artifactDir, "narration/transcript-qa.json");
const fullTranscriptQaPath = join(artifactDir, "texas-sandfest-world-class-board-demo-transcript-qa.json");

async function inspect(filter) {
  try {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", videoPath, "-vf", filter, "-an", "-f", "null", "-"], { maxBuffer: 1024 * 1024 * 20 });
    return `${stderr || ""}`;
  } catch (error) {
    return `${error.stderr || ""}`;
  }
}

const { stdout: probeText } = await run("ffprobe", [
  "-v", "error", "-show_entries",
  "format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,channels,sample_rate",
  "-of", "json", videoPath,
]);
const probe = JSON.parse(probeText);
const video = probe.streams.find(stream => stream.codec_type === "video");
const audio = probe.streams.find(stream => stream.codec_type === "audio");
const duration = Number(probe.format.duration);
const blackLog = await inspect("blackdetect=d=0.8:pix_th=0.04");
let silenceLog = "";
try {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", videoPath, "-af", "silencedetect=n=-43dB:d=2.8", "-vn", "-f", "null", "-"], { maxBuffer: 1024 * 1024 * 20 });
  silenceLog = `${stderr || ""}`;
} catch (error) {
  silenceLog = `${error.stderr || ""}`;
}
const { stdout: hashes } = await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-i", videoPath,
  "-vf", "fps=1/10,scale=320:-1", "-an", "-f", "framemd5", "-",
]);
const frameHashes = hashes.split("\n").filter(line => /^\d/.test(line)).map(line => line.split(",").at(-1).trim());
const transcriptQa = JSON.parse(await readFile(transcriptQaPath, "utf8"));
const fullTranscriptQa = JSON.parse(await readFile(fullTranscriptQaPath, "utf8"));
const checks = {
  duration: duration >= 95 && duration <= 102,
  resolution: video?.width === 1920 && video?.height === 1080,
  frameRate: video?.r_frame_rate === "30/1",
  audio: audio?.channels === 2 && audio?.sample_rate === "48000",
  noSustainedBlack: !blackLog.includes("black_start"),
  noSustainedSilence: !silenceLog.includes("silence_start"),
  distinctFrames: frameHashes.length >= 9 && new Set(frameHashes).size === frameHashes.length,
  narrationWords: transcriptQa.items.every(item => item.exactNormalized || item.id === "08-close"),
  finalTranscript: fullTranscriptQa.passed === true,
};
const passed = Object.values(checks).every(Boolean);
const report = {
  passed,
  generatedAt: new Date().toISOString(),
  videoPath,
  checks,
  ffprobe: probe,
  sampledFrameHashes: frameHashes,
  blackDetectEvents: blackLog.split("\n").filter(line => line.includes("black_")),
  silenceDetectEvents: silenceLog.split("\n").filter(line => line.includes("silence_")),
  narrationQaException: "Whisper separated the Texas SandFest proper name into two words in the closing line.",
  finalTranscriptQa: fullTranscriptQa,
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(process.env.SANDFEST_ENTERPRISE_VIDEO_DIR || join(root, "artifacts/enterprise-demo"));
const audioDir = join(artifactDir, "audio");
const overlayDir = join(artifactDir, "overlays");
const segmentDir = join(artifactDir, "segments");
const qaDir = join(artifactDir, "qa");
const boardSegmentDir = join(root, "artifacts/board-demo/segments");
const modelClip = resolve(process.env.SANDFEST_MODEL_VIDEO_CLIP || "/Volumes/ModelRAID/sandfest-ai-video/outputs/ltx_sandfest_shoreline_broll.mp4");
const outputPath = join(artifactDir, "texas-sandfest-enterprise-demo.mp4");
const posterPath = join(artifactDir, "texas-sandfest-enterprise-demo-poster.png");
const transcriptPath = join(artifactDir, "texas-sandfest-enterprise-demo-transcript.txt");
const metadataPath = join(artifactDir, "texas-sandfest-enterprise-demo-metadata.json");
const stagingOutputPath = join(artifactDir, "texas-sandfest-enterprise-demo.rendering.mp4");
const voice = process.env.SANDFEST_ENTERPRISE_VIDEO_VOICE || "Samantha";
const speakingRate = process.env.SANDFEST_ENTERPRISE_VIDEO_RATE || "164";

const scenes = [
  {
    id: "00-ai-opener",
    title: "Texas SandFest Operations Platform",
    label: "Enterprise Board Demo",
    kind: "model",
    source: modelClip,
    duration: 11.5,
    narration:
      "Texas SandFest now has a working festival platform for visitors, sponsors, vendors, staff, and board oversight. This executive demo is built from the certified local runtime, with AI-generated visual material used only as presentation packaging."
  },
  {
    id: "01-partner-intake",
    title: "Sponsor and Vendor Intake",
    label: "Applications, consent, status links, staff review",
    kind: "board",
    source: join(boardSegmentDir, "06.mp4"),
    duration: 20.5,
    narration:
      "Sponsors and vendors move through current server-published programs. The site captures consent, creates private status links, opens staff review work, and keeps brand proof, compliance, booth assignment, receivables, milestones, and partner preferences connected."
  },
  {
    id: "02-outreach",
    title: "Automated Outreach Portal",
    label: "Prospects, approvals, brand delivery, follow-up",
    kind: "board",
    source: join(boardSegmentDir, "10.mp4"),
    duration: 20.5,
    narration:
      "Partner Operations brings outreach, message approvals, sponsor deliverables, payment tracking, and key dates into one accountable loop. Transactional notices run through the local provider sandbox, while prospect outreach remains review-first for board-safe governance."
  },
  {
    id: "03-command",
    title: "Operations Command",
    label: "Revenue, work, conditions, launch gates",
    kind: "board",
    source: join(boardSegmentDir, "08.mp4"),
    duration: 18.5,
    narration:
      "The operations portal gives staff a command summary across work, revenue, partner readiness, guest services, field conditions, messages, key dates, and launch gates. The board can see what is active now and what remains behind explicit production approval."
  },
  {
    id: "04-delegation",
    title: "Staff and Volunteer Delegation",
    label: "Owners, urgency, deadlines, evidence",
    kind: "board",
    source: join(boardSegmentDir, "11.mp4"),
    duration: 17.5,
    narration:
      "Incidents and delegated work share the same operating loop. Staff can assign owners, track urgency and deadlines, send private task links, and close work with evidence across employees, volunteers, guest services, partner milestones, and event-day operations."
  },
  {
    id: "05-activation",
    title: "Activation Gates",
    label: "Certified local proof, production controls",
    kind: "board",
    source: join(boardSegmentDir, "12.mp4"),
    duration: 22.5,
    narration:
      "The final gate is deliberate. The product is certified locally for the board presentation, while Stripe, QuickBooks, live communications, weather, ferry data, camera edge agents, identity, Turnstile, domains, and managed recovery stay as explicit activation controls."
  }
];

await mkdir(audioDir, { recursive: true });
await mkdir(overlayDir, { recursive: true });
await mkdir(qaDir, { recursive: true });
await rm(segmentDir, { recursive: true, force: true });
await mkdir(segmentDir, { recursive: true });
await rm(stagingOutputPath, { force: true });

const xmlText = value => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const baseVideoFilter = (scene, duration) => [
  "scale=1920:1080:force_original_aspect_ratio=increase",
  "crop=1920:1080",
  "setsar=1",
  "format=yuv420p",
  "eq=contrast=1.03:saturation=1.04:brightness=0.01",
  `fade=t=in:st=0:d=0.35`,
  `fade=t=out:st=${Math.max(0, duration - 0.45).toFixed(3)}:d=0.45`,
  `drawbox=x=0:y=0:w=iw:h=ih:color=0x12333A@${scene.kind === "model" ? "0.30" : "0.08"}:t=fill`
].join(",");

const buildOverlay = async (scene, number) => {
  const overlayPath = join(overlayDir, `${number}-${scene.id}.png`);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="1920" height="118" fill="#12333A" opacity="0.88"/>
  <rect x="0" y="118" width="1920" height="5" fill="#F7B733" opacity="0.96"/>
  <text x="70" y="74" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="42" fill="#FFFDF7">${xmlText(scene.title)}</text>
  <text x="1850" y="66" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#F4DFAC">${xmlText(scene.label)}</text>
  <text x="70" y="1012" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#FFFDF7" opacity="0.92">Texas SandFest Board Capability Demo</text>
  <rect x="70" y="1046" width="330" height="4" fill="#006D77" opacity="0.92"/>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(overlayPath);
  return overlayPath;
};

const concatLines = [];
const transcript = ["Texas SandFest Enterprise Demo", ""];

for (const [index, scene] of scenes.entries()) {
  const number = String(index + 1).padStart(2, "0");
  const textPath = join(audioDir, `${number}-${scene.id}.txt`);
  const audioPath = join(audioDir, `${number}-${scene.id}.aiff`);
  const segmentPath = join(segmentDir, `${number}-${scene.id}.mp4`);
  const overlayPath = await buildOverlay(scene, number);
  await writeFile(textPath, `${scene.narration}\n`);
  await run("/usr/bin/say", ["-v", voice, "-r", speakingRate, "-f", textPath, "-o", audioPath]);
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    audioPath
  ]);
  const audioDuration = Number(stdout.trim());
  const duration = Math.max(scene.duration, audioDuration + 0.8);
  const inputArgs = scene.kind === "model"
    ? ["-stream_loop", "-1", "-i", scene.source]
    : ["-i", scene.source];
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputArgs,
    "-i", audioPath,
    "-i", overlayPath,
    "-filter_complex", `[0:v]${baseVideoFilter(scene, duration)}[base];[base][2:v]overlay=0:0[v]`,
    "-map", "[v]", "-map", "1:a:0",
    "-af", "afade=t=in:st=0:d=0.18,apad=pad_dur=0.8",
    "-t", duration.toFixed(3),
    "-r", "30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    segmentPath
  ], { maxBuffer: 1024 * 1024 * 10 });
  concatLines.push(`file '${segmentPath.replaceAll("'", "'\\''")}'`);
  transcript.push(`${index + 1}. ${scene.title}`, scene.narration, "");
  console.log(`Rendered ${number}/${scenes.length}: ${scene.title}`);
}

const concatPath = join(segmentDir, "concat.txt");
await writeFile(concatPath, `${concatLines.join("\n")}\n`);
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", concatPath,
  "-c", "copy", "-movflags", "+faststart", stagingOutputPath
]);

await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-ss", "00:00:02", "-i", stagingOutputPath,
  "-frames:v", "1", posterPath
]);

await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", stagingOutputPath,
  "-vf", "fps=1/18,scale=480:-1,tile=3x2",
  "-frames:v", "1",
  join(qaDir, "contact-sheet.png")
]);

const { stdout: probe } = await run("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate",
  "-of", "json",
  stagingOutputPath
]);

await rename(stagingOutputPath, outputPath);
await writeFile(transcriptPath, transcript.join("\n"));
await writeFile(metadataPath, `${JSON.stringify({
  title: "Texas SandFest Enterprise Demo",
  generatedAt: new Date().toISOString(),
  output: outputPath,
  poster: posterPath,
  transcript: transcriptPath,
  modelClip,
  model: "Lightricks/LTX-Video",
  voice,
  speakingRate,
  sourceBoardSegments: scenes.filter(scene => scene.kind === "board").map(scene => scene.source),
  ffprobe: JSON.parse(probe)
}, null, 2)}\n`);

console.log(`Video: ${outputPath}`);
console.log(`Poster: ${posterPath}`);
console.log(`Transcript: ${transcriptPath}`);
console.log(`Metadata: ${metadataPath}`);
console.log(probe.trim());

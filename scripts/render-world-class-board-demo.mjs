import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = join(root, "artifacts/board-presentation-demo/h3");
const fullDir = join(artifactDir, "full");
const captureDir = join(root, "artifacts/board-presentation-demo/captures");
const narrationDir = join(artifactDir, "narration/raw");
const musicPath = join(artifactDir, "music/sandfest-score.wav");
const renderDir = join(artifactDir, "world-class-render");
const segmentDir = join(renderDir, "segments");
const overlayDir = join(renderDir, "overlays");
const qaDir = join(renderDir, "qa");
const hostDir = join(artifactDir, "host");
const hostTemplate = join(root, "ops/minimax-h3/video-host/index.html");
const outputPath = join(artifactDir, "texas-sandfest-world-class-board-demo.mp4");
const tempOutputPath = join(artifactDir, "texas-sandfest-world-class-board-demo.rendering.mp4");
const posterPath = join(artifactDir, "texas-sandfest-world-class-board-demo-poster.jpg");
const metadataPath = join(artifactDir, "texas-sandfest-world-class-board-demo-metadata.json");
const transcriptPath = join(artifactDir, "texas-sandfest-world-class-board-demo-transcript.txt");
const transitionDuration = 0.55;

const narration = [
  { id: "02-visitor", at: 10.2, tempo: 0.9 },
  { id: "03-partners", at: 23.1, tempo: 0.9 },
  { id: "04-command", at: 36.7, tempo: 0.9 },
  { id: "05-outreach-accounting", at: 47.7, tempo: 0.9 },
  { id: "06-delegation-island", at: 63.2, tempo: 0.9 },
  { id: "07-readiness", at: 79.7, tempo: 0.9 },
  { id: "08-close", at: 92.0, tempo: 0.98 },
];

const visuals = [
  { id: "01-open", kind: "h3", prefix: "01-sunrise-reveal", duration: 10.125, overlay: "open" },
  { id: "02-visitor", kind: "capture", file: "03-visitor.webm", start: 1.5, sourceDuration: 16.875, speed: 1.25, duration: 13.5, label: "VISITOR EXPERIENCE", title: "Plan. Discover. Participate." },
  { id: "03-partners", kind: "capture", file: "04-partner-intake.webm", start: 1.4, sourceDuration: 12.1, speed: 1.1, duration: 11.0, label: "PARTNER GROWTH", title: "Sponsor and vendor intake" },
  { id: "04-vendor", kind: "h3", prefix: "04-partner-experience", start: 3.5, duration: 4.0 },
  { id: "05-command", kind: "capture", file: "05-command.webm", start: 2.0, sourceDuration: 13.75, speed: 1.25, duration: 11.0, label: "OPERATIONS COMMAND", title: "Revenue, readiness, and next actions" },
  { id: "06-outreach", kind: "capture", file: "06-outreach-accounting.webm", start: 2.0, sourceDuration: 17.55, speed: 1.35, duration: 13.0, label: "OUTREACH + ACCOUNTING", title: "Targeting, follow-up, and receivables" },
  { id: "07-flow", kind: "h3", prefix: "03-island-flow", start: 3.25, duration: 4.0 },
  { id: "08-delegation", kind: "capture", file: "07-delegation-island.webm", start: 2.0, sourceDuration: 22.5, speed: 1.5, duration: 15.0, label: "EVENT OPERATIONS", title: "Delegation and Island Conditions" },
  { id: "09-guests", kind: "h3", prefix: "05-guest-moment", start: 3.5, duration: 4.0 },
  { id: "10-readiness", kind: "capture", file: "09-gates.webm", start: 2.0, sourceDuration: 11.25, speed: 1.25, duration: 9.0, label: "READINESS", title: "Certified capability. Explicit activation." },
  { id: "11-close", kind: "h3", prefix: "06-golden-hour-close", start: 2.5, speed: 0.7, duration: 10.0, overlay: "close" },
];

await Promise.all([artifactDir, renderDir, segmentDir, overlayDir, qaDir, hostDir].map(path => mkdir(path, { recursive: true })));
await rm(segmentDir, { recursive: true, force: true });
await mkdir(segmentDir, { recursive: true });

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function latestH3(prefix) {
  const candidates = (await readdir(fullDir))
    .filter(name => name.startsWith(`${prefix}_`) && name.endsWith(".mp4"));
  if (!candidates.length) throw new Error(`Missing H3 footage for ${prefix} in ${fullDir}`);
  const ranked = await Promise.all(candidates.map(async name => ({ name, info: await stat(join(fullDir, name)) })));
  ranked.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
  return join(fullDir, ranked[0].name);
}

async function makeOverlay(scene) {
  if (!scene.overlay && !scene.label) return null;
  let svg;
  if (scene.overlay === "open") {
    svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="shade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#071619" stop-opacity=".84"/><stop offset=".58" stop-color="#071619" stop-opacity="0"/></linearGradient></defs>
      <rect width="1920" height="1080" fill="url(#shade)"/>
      <rect x="118" y="694" width="7" height="210" fill="#F4B43A"/>
      <text x="164" y="756" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#F4DFAC" letter-spacing="0">TEXAS SANDFEST</text>
      <text x="164" y="840" font-family="Georgia, serif" font-size="72" fill="#FFFDF7" letter-spacing="0">One Festival. One Operating System.</text>
    </svg>`;
  } else if (scene.overlay === "close") {
    svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="shade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#071619" stop-opacity=".9"/><stop offset=".66" stop-color="#071619" stop-opacity="0"/></linearGradient></defs>
      <rect width="1920" height="1080" fill="url(#shade)"/>
      <text x="960" y="790" text-anchor="middle" font-family="Georgia, serif" font-size="84" fill="#FFFDF7" letter-spacing="0">Texas SandFest</text>
      <rect x="780" y="832" width="360" height="5" fill="#F4B43A"/>
      <text x="960" y="894" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#F4DFAC" letter-spacing="0">BUILT FOR THE FESTIVAL WE ARE BECOMING</text>
    </svg>`;
  } else {
    svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <rect x="54" y="48" width="720" height="116" fill="#071619" opacity=".92"/>
      <rect x="54" y="48" width="7" height="116" fill="#F4B43A"/>
      <text x="90" y="92" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#F4DFAC" letter-spacing="0">${escapeXml(scene.label)}</text>
      <text x="90" y="137" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="34" fill="#FFFDF7" letter-spacing="0">${escapeXml(scene.title)}</text>
    </svg>`;
  }
  const output = join(overlayDir, `${scene.id}.png`);
  await sharp(Buffer.from(svg)).png().toFile(output);
  return output;
}

async function renderVisual(scene) {
  const source = scene.kind === "h3" ? await latestH3(scene.prefix) : join(captureDir, scene.file);
  if (!(await exists(source))) throw new Error(`Missing visual source: ${source}`);
  const overlay = await makeOverlay(scene);
  const output = join(segmentDir, `${scene.id}.mp4`);
  const inputArgs = [
    ...(scene.start ? ["-ss", String(scene.start)] : []),
    "-i", source,
    ...(overlay ? ["-loop", "1", "-framerate", "30", "-i", overlay] : []),
  ];
  const base = scene.kind === "capture"
    ? `setpts=(PTS-STARTPTS)/${scene.speed},fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,eq=contrast=1.015:saturation=1.02`
    : `setpts=(PTS-STARTPTS)/${scene.speed || 1},fps=30,scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1,format=yuv420p,eq=contrast=1.025:saturation=1.035`;
  const filter = overlay
    ? `[0:v]${base}[base];[1:v]format=rgba,fade=t=in:st=0.28:d=0.42:alpha=1,fade=t=out:st=${scene.overlay === "close" ? 9.7 : 4.5}:d=0.45:alpha=1[mark];[base][mark]overlay=0:0:eof_action=repeat[v]`
    : `[0:v]${base}[v]`;
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    ...inputArgs,
    "-filter_complex", filter,
    "-map", "[v]", "-an", "-t", String(scene.duration),
    "-r", "30", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-preset", "medium", "-crf", "17", "-movflags", "+faststart", output,
  ], { maxBuffer: 1024 * 1024 * 20 });
  return { ...scene, source, overlay, output };
}

const rendered = [];
for (const scene of visuals) {
  rendered.push(await renderVisual(scene));
  console.log(`VISUAL ${scene.id}`);
}

let videoLabel = "[0:v]";
let offset = rendered[0].duration - transitionDuration;
const transitionFilters = [];
for (let index = 1; index < rendered.length; index += 1) {
  const next = `v${index}`;
  transitionFilters.push(`${videoLabel}[${index}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(3)}[${next}]`);
  videoLabel = `[${next}]`;
  offset += rendered[index].duration - transitionDuration;
}
const visualDuration = offset + transitionDuration;
const visualPath = join(renderDir, "picture.mp4");
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  ...rendered.flatMap(scene => ["-i", scene.output]),
  "-filter_complex", transitionFilters.join(";"), "-map", videoLabel,
  "-an", "-r", "30", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-preset", "slow", "-crf", "16", "-movflags", "+faststart", visualPath,
], { maxBuffer: 1024 * 1024 * 40 });

const opener = rendered[0].source;
const narrationPaths = narration.map(item => join(narrationDir, `${item.id}.wav`));
for (const path of narrationPaths) {
  if (!(await exists(path))) throw new Error(`Missing narration: ${path}`);
}
const hasMusic = await exists(musicPath);
const audioInputs = ["-i", opener, ...narrationPaths.flatMap(path => ["-i", path])];
if (hasMusic) audioInputs.push("-stream_loop", "-1", "-i", musicPath);
const audioFilters = [
  `[1:a]atrim=0:10.125,asetpts=PTS-STARTPTS,highpass=f=55,lowpass=f=16000,acompressor=threshold=-19dB:ratio=1.8:attack=18:release=180,loudnorm=I=-17:LRA=8:TP=-1.5[opening]`,
];
const mixLabels = ["[opening]"];
narration.forEach((item, index) => {
  const label = `n${index}`;
  const delay = Math.round(item.at * 1000);
  audioFilters.push(`[${index + 2}:a]atempo=${item.tempo},highpass=f=70,lowpass=f=15500,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=3400:t=q:w=1:g=1.2,acompressor=threshold=-22dB:ratio=2.1:attack=18:release=190,loudnorm=I=-16:LRA=7:TP=-1.5,adelay=${delay}:all=1[${label}]`);
  mixLabels.push(`[${label}]`);
});
if (hasMusic) {
  const musicIndex = narration.length + 2;
  audioFilters.push(`[${musicIndex}:a]atrim=0:${visualDuration.toFixed(3)},asetpts=PTS-STARTPTS,highpass=f=38,lowpass=f=14500,loudnorm=I=-29:LRA=10:TP=-6,afade=t=in:st=8.5:d=2.2,afade=t=out:st=${(visualDuration - 3.2).toFixed(3)}:d=3[music]`);
  mixLabels.push("[music]");
}
audioFilters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0:normalize=0,loudnorm=I=-15:LRA=9:TP=-1.2,atrim=0:${visualDuration.toFixed(3)},apad=pad_dur=0.2[a]`);

await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y", "-i", visualPath, ...audioInputs,
  "-filter_complex", audioFilters.join(";"),
  "-map", "0:v:0", "-map", "[a]", "-t", visualDuration.toFixed(3),
  "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
  "-movflags", "+faststart", tempOutputPath,
], { maxBuffer: 1024 * 1024 * 40 });
await rename(tempOutputPath, outputPath);

await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "2.5", "-i", outputPath, "-frames:v", "1", posterPath]);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", outputPath, "-vf", "fps=1/11,scale=480:-1,tile=5x2", "-frames:v", "1", join(qaDir, "contact-sheet.jpg")]);
const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate,channels,sample_rate", "-of", "json", outputPath]);
const manifest = JSON.parse(await readFile(join(narrationDir, "manifest.json"), "utf8"));
await writeFile(transcriptPath, [
  "Texas SandFest World-Class Board Demo",
  "",
  "Texas SandFest is unforgettable on the beach. Now, the operation behind it can be just as remarkable.",
  ...manifest.map(item => item.text),
  "",
].join("\n"));
await writeFile(metadataPath, JSON.stringify({
  title: "Texas SandFest World-Class Board Demo",
  generatedAt: new Date().toISOString(),
  localOnly: true,
  videoModel: "MiniMax H3 through ComfyUI on two local RTX PRO 6000 GPUs",
  narrationModel: "Chatterbox Turbo on local Apple Silicon",
  music: hasMusic ? musicPath : null,
  duration: visualDuration,
  transitionDuration,
  visuals: rendered.map(({ id, kind, source, duration, start, speed }) => ({ id, kind, source, duration, start, speed })),
  narration,
  ffprobe: JSON.parse(probe),
}, null, 2) + "\n");
await Promise.all([
  copyFile(outputPath, join(hostDir, "texas-sandfest-world-class-board-demo.mp4")),
  copyFile(posterPath, join(hostDir, "texas-sandfest-world-class-board-demo-poster.jpg")),
  copyFile(hostTemplate, join(hostDir, "index.html")),
]);
console.log(`VIDEO ${outputPath}`);
console.log(probe.trim());

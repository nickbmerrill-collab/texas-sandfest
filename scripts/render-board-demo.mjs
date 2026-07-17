import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(process.env.SANDFEST_VIDEO_DIR || join(root, "artifacts/board-demo"));
const frameDir = resolve(process.env.SANDFEST_VIDEO_FRAME_DIR || join(artifactDir, "frames"));
const audioDir = join(artifactDir, "audio");
const segmentDir = join(artifactDir, "segments");
const manifestPath = join(root, "docs/board-demo-scenes.json");
const outputPath = join(artifactDir, "texas-sandfest-board-demo.mp4");
const posterPath = join(artifactDir, "texas-sandfest-board-demo-poster.png");
const transcriptPath = join(artifactDir, "texas-sandfest-board-demo-transcript.txt");
const voice = process.env.SANDFEST_VIDEO_VOICE || "Samantha";
const speakingRate = process.env.SANDFEST_VIDEO_RATE || "168";

await mkdir(audioDir, { recursive: true });
await rm(segmentDir, { recursive: true, force: true });
await mkdir(segmentDir, { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const concatLines = [];
const transcript = [manifest.title, "", ...manifest.scenes.flatMap((scene, index) => [
  `${index + 1}. ${scene.title}`,
  scene.narration,
  ""
])];

for (const [index, scene] of manifest.scenes.entries()) {
  const number = String(index + 1).padStart(2, "0");
  const framePath = join(frameDir, scene.frame);
  const textPath = join(audioDir, `${number}.txt`);
  const audioPath = join(audioDir, `${number}.aiff`);
  const segmentPath = join(segmentDir, `${number}.mp4`);

  await writeFile(textPath, `${scene.narration}\n`);
  await run("/usr/bin/say", ["-v", voice, "-r", speakingRate, "-f", textPath, "-o", audioPath]);
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    audioPath
  ]);
  const narrationDuration = Number(stdout.trim());
  const duration = Math.max(4, narrationDuration + 1.1);
  const frameCount = Math.ceil(duration * 30);
  const fadeOutStart = Math.max(0, duration - 0.55).toFixed(3);

  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-i", framePath,
    "-i", audioPath,
    "-vf", `scale=1920:1080,zoompan=z='min(zoom+0.00008,1.022)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=1920x1080:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.55,format=yuv420p`,
    "-af", "apad=pad_dur=1.1,afade=t=in:st=0:d=0.2",
    "-t", duration.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    segmentPath
  ], { maxBuffer: 1024 * 1024 * 10 });

  concatLines.push(`file '${segmentPath.replaceAll("'", "'\\''")}'`);
  console.log(`Rendered ${number}/${manifest.scenes.length}: ${scene.title}`);
}

const concatPath = join(segmentDir, "concat.txt");
await writeFile(concatPath, `${concatLines.join("\n")}\n`);
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", concatPath,
  "-c", "copy", "-movflags", "+faststart", outputPath
]);

await copyFile(join(frameDir, manifest.scenes[0].frame), posterPath);
await writeFile(transcriptPath, transcript.join("\n"));

const { stdout: probe } = await run("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration,size:stream=codec_name,width,height",
  "-of", "json",
  outputPath
]);

console.log(`Video: ${outputPath}`);
console.log(`Poster: ${posterPath}`);
console.log(`Transcript: ${transcriptPath}`);
console.log(probe.trim());

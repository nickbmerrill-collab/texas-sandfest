import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(process.env.SANDFEST_BOARD_PRESENTATION_VIDEO_DIR || join(root, "artifacts/board-presentation-demo"));
const captureDir = join(artifactDir, "captures");
const audioDir = join(artifactDir, "audio");
const slideDir = join(artifactDir, "slides");
const overlayDir = join(artifactDir, "overlays");
const segmentDir = join(artifactDir, "segments");
const qaDir = join(artifactDir, "qa");
const outputPath = join(artifactDir, "texas-sandfest-board-presentation-demo.mp4");
const tempOutputPath = join(artifactDir, "texas-sandfest-board-presentation-demo.rendering.mp4");
const posterPath = join(artifactDir, "texas-sandfest-board-presentation-demo-poster.png");
const transcriptPath = join(artifactDir, "texas-sandfest-board-presentation-demo-transcript.txt");
const metadataPath = join(artifactDir, "texas-sandfest-board-presentation-demo-metadata.json");
const narrationManifestPath = join(artifactDir, "narration-manifest.json");
const visitorUrl = process.env.SANDFEST_VISITOR_URL || "http://127.0.0.1:5175/?apiBase=http%3A%2F%2F127.0.0.1%3A8806&mode=visitor";
const operationsUrl = process.env.SANDFEST_OPERATIONS_URL || "http://127.0.0.1:5175/admin.html?apiBase=http%3A%2F%2F127.0.0.1%3A8806";
const ttsPython = process.env.SANDFEST_QWEN_TTS_PYTHON || "/Volumes/ModelRAID/sandfest-qwen-tts/.venv/bin/python";
const ttsModel = process.env.SANDFEST_QWEN_TTS_MODEL || "/Volumes/ModelRAID/sandfest-qwen-tts/model";
const voice = process.env.SANDFEST_QWEN_TTS_VOICE || "Aiden";
const heroImage = join(root, "public/assets/sandfest-media/optimized/hero-2400.webp");

const scenes = [
  {
    id: "01-opening",
    kind: "slide",
    title: "One Festival. One Operating System.",
    eyebrow: "Texas SandFest",
    background: heroImage,
    narration: "Texas SandFest already creates an experience people travel to see. | Now, the organization behind it can operate with that same level of ambition."
  },
  {
    id: "03-visitor",
    kind: "capture",
    title: "Visitor Experience",
    label: "Public site, Live Beach, ticketing, sculptors, passport",
    callouts: ["Live Beach and island conditions", "Ticketing with consent separation", "Sculptor map, passport, and voting"],
    narration: "It begins where every great festival should: with the guest. | The public experience makes planning simple, from tickets and sculptors to live beach conditions, the digital passport, and People's Choice voting. | Everything feels like one event, because everything is connected."
  },
  {
    id: "04-partner-intake",
    kind: "capture",
    title: "Sponsor and Vendor Signups",
    label: "Sponsor tiers, vendor intake, private status links",
    callouts: ["Published sponsor tiers", "Vendor application fields", "Private applicant status path"],
    narration: "The same platform turns interest into organized revenue. | Sponsors can understand the value of each tier. Vendors can apply without email chains. | Every submission enters a private, trackable workflow for review, payment, deadlines, and follow-up."
  },
  {
    id: "05-command",
    kind: "capture",
    title: "Operations Command",
    label: "Revenue, work, partner readiness, key dates",
    callouts: ["Command summary", "Impact snapshot", "Partner readiness and next actions"],
    narration: "Behind the public site is the command center. | Staff see revenue, partner readiness, guest issues, deadlines, and assigned work in one place. | The board sees the same thing leadership needs: what is moving, what is late, and what requires attention."
  },
  {
    id: "06-outreach-accounting",
    kind: "capture",
    title: "Outreach and Accounting",
    label: "Geographic targeting, follow-up, receivables, exports",
    callouts: ["Geographic sponsor targeting", "Review-first outreach automation", "Receivables, payments, and exports"],
    narration: "Outreach becomes disciplined instead of reactive. | The team can target the right industries and locations, preview campaigns, automate follow-up, and track receivables through payment. | Communications remain review-first, giving automation speed without giving up control."
  },
  {
    id: "07-delegation-island",
    kind: "capture",
    title: "Delegation and Island Conditions",
    label: "Guest services, staff tasks, volunteers, incident response",
    callouts: ["Guest cases with private updates", "Staff and volunteer assignments", "Weather, ferry, camera, crowd model"],
    narration: "On event week, the platform becomes an accountability system. | Guest cases, staff assignments, volunteer work, incidents, and deadlines all have owners. | Island Conditions is designed to bring weather, ferry queues, camera feeds, crowd density, and line monitoring into that same operating picture."
  },
  {
    id: "09-gates",
    kind: "capture",
    title: "Readiness and Activation Gates",
    label: "Certified now, production controls explicit",
    callouts: ["Board capability proof", "Browser acceptance evidence", "Deferred production gates"],
    narration: "The readiness screen makes that boundary visible. | It separates what has been certified for board review from what requires production credentials, policy approval, and a deliberate launch decision."
  },
  {
    id: "10-close",
    kind: "slide",
    title: "Built for the Festival Texas SandFest Is Becoming.",
    eyebrow: "Visitor experience · Partner growth · Event command",
    background: heroImage,
    narration: "This is the foundation for a stronger visitor experience, more professional partner relationships, and a calmer, more accountable event operation. | It is ready for the board to experience, challenge, and shape."
  }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await Promise.all([artifactDir, captureDir, audioDir, slideDir, overlayDir, segmentDir, qaDir].map(dir => mkdir(dir, { recursive: true })));
await rm(captureDir, { recursive: true, force: true });
await rm(segmentDir, { recursive: true, force: true });
await Promise.all([captureDir, segmentDir].map(dir => mkdir(dir, { recursive: true })));

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function makeSlide(scene) {
  const words = scene.title.split(/\s+/);
  const titleLines = [];
  let currentLine = "";
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length > 29 && currentLine) {
      titleLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  if (currentLine) titleLines.push(currentLine);
  const titleText = titleLines.slice(0, 3).map((line, index) =>
    `<text x="176" y="${410 + index * 92}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="82" fill="#FFFDF7">${escapeXml(line)}</text>`
  ).join("");
  const overlay = `<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#081317" stop-opacity="0.94"/>
        <stop offset="0.55" stop-color="#081317" stop-opacity="0.58"/>
        <stop offset="1" stop-color="#081317" stop-opacity="0.12"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#shade)"/>
    <rect x="118" y="196" width="6" height="520" fill="#F7B733"/>
    <text x="176" y="260" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#F4DFAC">${escapeXml(scene.eyebrow)}</text>
    ${titleText}
  </svg>`;
  const out = join(slideDir, `${scene.id}.png`);
  await sharp(scene.background)
    .resize(1920, 1080, { fit: "cover", position: "centre" })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(out);
  return out;
}

async function addCursor(page) {
  await page.addStyleTag({ content: `
    #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;border-radius:999px;background:#f7b733;border:3px solid #12333a;box-shadow:0 6px 20px rgba(18,51,58,.38);z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);}
  `});
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    document.body.appendChild(cursor);
  });
}

async function moveCursor(page, x, y, steps = 20) {
  await page.mouse.move(x, y, { steps });
  await page.evaluate(([left, top]) => {
    const cursor = document.querySelector("#demo-cursor");
    if (cursor) {
      cursor.style.left = `${left}px`;
      cursor.style.top = `${top}px`;
    }
  }, [x, y]);
}

async function clickVisible(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return false;
  await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(selector).first().click({ trial: false });
  await sleep(850);
  return true;
}

async function gotoHash(page, hash) {
  await page.evaluate(target => {
    history.replaceState(null, "", target);
    document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, hash);
  await sleep(2600);
}

async function fillIfPresent(page, selector, value) {
  const locator = page.locator(selector).first();
  if (await locator.count()) {
    await locator.fill(value);
    await sleep(250);
  }
}

async function recordScene(browser, scene) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: captureDir, size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const url = scene.id === "03-visitor" || scene.id === "04-partner-intake" ? visitorUrl : operationsUrl;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app");
  await sleep(2200);
  await addCursor(page);
  await moveCursor(page, 220, 160);

  if (scene.id === "03-visitor") {
    await clickVisible(page, 'a[href="#live-beach"]');
    await page.locator("#lb-scrub-input").fill("9").catch(() => {});
    await sleep(1600);
    await clickVisible(page, 'a[href="#tickets"]');
    await clickVisible(page, '[data-ticket-action="increase"]');
    await fillIfPresent(page, "#checkout-email", "board.demo@example.com");
    await fillIfPresent(page, "#checkout-phone", "3615550148");
    await sleep(1400);
    await gotoHash(page, "#sculptors-showcase");
    await clickVisible(page, "#passport-reset");
    await sleep(1800);
    await gotoHash(page, "#island-conditions");
    await sleep(1800);
  } else if (scene.id === "04-partner-intake") {
    await gotoHash(page, "#sponsors");
    await clickVisible(page, "[data-package-id]");
    await fillIfPresent(page, '#sponsor-inquiry-form [name="organizationName"]', "Gulf Shore Credit Union");
    await fillIfPresent(page, '#sponsor-inquiry-form [name="contactName"]', "Maria Alvarez");
    await fillIfPresent(page, '#sponsor-inquiry-form [name="contactEmail"]', "maria@example.com");
    await fillIfPresent(page, '#sponsor-inquiry-form [name="contactPhone"]', "3615550177");
    await sleep(1800);
    await gotoHash(page, "#vendor-application-form");
    await fillIfPresent(page, '#vendor-application-form [name="organizationName"]', "Coastal Coffee Cart");
    await fillIfPresent(page, '#vendor-application-form [name="contactName"]', "Jordan Lee");
    await fillIfPresent(page, '#vendor-application-form [name="contactEmail"]', "jordan@example.com");
    await sleep(2600);
  } else if (scene.id === "05-command") {
    await clickVisible(page, "#admin-load-config");
    await sleep(1500);
    await gotoHash(page, "#admin-config");
    await sleep(1600);
    await gotoHash(page, "#admin-impact-report");
    await clickVisible(page, "#admin-load-impact");
    await sleep(1800);
    await gotoHash(page, "#admin-partners");
    await clickVisible(page, "#admin-load-partners");
    await sleep(2600);
  } else if (scene.id === "06-outreach-accounting") {
    await gotoHash(page, "#admin-partners");
    await clickVisible(page, "#admin-load-partners");
    await sleep(2200);
    await fillIfPresent(page, '#admin-create-campaign [name="name"]', "Hospitality and finance sponsors");
    await fillIfPresent(page, '#admin-create-campaign [name="industries"]', "hospitality, banking, restaurants");
    await page.locator('#admin-create-campaign [name="centerSource"]').selectOption("sandfest").catch(() => {});
    await fillIfPresent(page, '#admin-create-campaign [name="radiusMiles"]', "35");
    await clickVisible(page, "#admin-preview-campaign");
    await sleep(2400);
    await gotoHash(page, "#admin-receivables-workspace");
    await sleep(1800);
    await gotoHash(page, "#admin-outreach-targeting-map");
    await sleep(2000);
  } else if (scene.id === "07-delegation-island") {
    await gotoHash(page, "#admin-guest-services");
    await clickVisible(page, "#admin-load-guest-services");
    await sleep(2200);
    await gotoHash(page, "#admin-partners");
    await clickVisible(page, "#admin-load-partners");
    await sleep(1400);
    await gotoHash(page, "#admin-partner-tasks-workspace");
    await sleep(1800);
    await gotoHash(page, "#admin-volunteers");
    await clickVisible(page, "#admin-load-volunteers");
    await sleep(1600);
    await gotoHash(page, "#admin-island-conditions");
    await clickVisible(page, "#admin-load-conditions");
    await sleep(2400);
  } else if (scene.id === "09-gates") {
    await clickVisible(page, "#admin-load-config");
    await sleep(1200);
    await gotoHash(page, "#admin-board-capability-proof");
    await sleep(3200);
    await gotoHash(page, "#admin-system-monitor");
    await clickVisible(page, "#admin-load-orders");
    await sleep(2200);
  }

  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  const out = join(captureDir, `${scene.id}.webm`);
  await run("mv", [videoPath, out]);
  return out;
}

function overlayFilter(scene, duration) {
  return [
    "scale=1920:1080:force_original_aspect_ratio=increase",
    "crop=1920:1080",
    "setsar=1",
    "format=yuv420p",
    "eq=contrast=1.02:saturation=1.03",
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x12333A@0.04:t=fill"
  ].join(",");
}

async function makeCaptureOverlay(scene) {
  const out = join(overlayDir, `${scene.id}.png`);
  const svg = `<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
    <rect x="46" y="42" width="790" height="108" fill="#081317" opacity="0.88"/>
    <rect x="46" y="42" width="7" height="108" fill="#F7B733"/>
    <text x="82" y="88" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#F4DFAC">TEXAS SANDFEST PLATFORM</text>
    <text x="82" y="128" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="34" fill="#FFFDF7">${escapeXml(scene.title)}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
  return out;
}

async function durationOf(path) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  return Number(stdout.trim());
}

const narrationItems = scenes.map(scene => ({
  id: scene.id,
  text: scene.narration,
  out: join(audioDir, `${scene.id}.wav`)
}));
await writeFile(narrationManifestPath, JSON.stringify(narrationItems, null, 2));
await run(ttsPython, [join(root, "scripts/generate-qwen-narration.py"), "--manifest", narrationManifestPath, "--model", ttsModel, "--voice", voice, "--speed", "0.96"], {
  env: {
    ...process.env,
    HF_HOME: "/Volumes/ModelRAID/huggingface-cache",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false"
  },
  maxBuffer: 1024 * 1024 * 20
});

const browser = await chromium.launch({ headless: true });
const transcript = ["Texas SandFest Board Presentation Demo", ""];
const renderedScenes = [];

try {
  for (const scene of scenes) {
    const audioPath = join(audioDir, `${scene.id}.wav`);
    const audioDuration = await durationOf(audioPath);
    let visualPath;
    let inputArgs;
    if (scene.kind === "slide") {
      visualPath = await makeSlide(scene);
      inputArgs = ["-loop", "1", "-i", visualPath];
    } else {
      visualPath = await recordScene(browser, scene);
      inputArgs = ["-stream_loop", "-1", "-i", visualPath];
    }
    const duration = Math.max(audioDuration + 1.8, scene.kind === "slide" ? 11 : 24);
    const segmentPath = join(segmentDir, `${scene.id}.mp4`);
    const captureOverlay = scene.kind === "capture" ? await makeCaptureOverlay(scene) : null;
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputArgs,
      "-i", audioPath,
      ...(captureOverlay ? ["-i", captureOverlay] : []),
      ...(captureOverlay
        ? ["-filter_complex", `[0:v]${overlayFilter(scene, duration)}[base];[2:v]format=rgba,fade=t=out:st=4:d=0.7:alpha=1[lowerthird];[base][lowerthird]overlay=0:0:eof_action=repeat[v]`, "-map", "[v]", "-map", "1:a:0"]
        : ["-map", "0:v:0", "-map", "1:a:0", "-vf", "scale=1920:1080,format=yuv420p,zoompan=z='min(zoom+0.00035,1.055)':d=1:s=1920x1080:fps=30"]),
      "-af", "highpass=f=65,lowpass=f=16000,acompressor=threshold=-18dB:ratio=1.55:attack=22:release=220,loudnorm=I=-16:LRA=9:TP=-1.5,afade=t=in:st=0:d=0.18,apad",
      "-t", duration.toFixed(3),
      "-r", "30",
      "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      segmentPath
    ], { maxBuffer: 1024 * 1024 * 20 });
    transcript.push(scene.title, scene.narration, "");
    renderedScenes.push({ ...scene, audioDuration, duration, visualPath, segmentPath });
    console.log(`Rendered ${scene.id}: ${scene.title}`);
  }
} finally {
  await browser.close();
}

const transitionDuration = 1.25;
const transitionInputs = renderedScenes.flatMap(scene => ["-i", scene.segmentPath]);
let videoLabel = "[0:v]";
let audioLabel = "[0:a]";
let transitionOffset = renderedScenes[0].duration - transitionDuration;
const transitionFilters = [];
for (let index = 1; index < renderedScenes.length; index += 1) {
  const nextVideo = `v${index}`;
  const nextAudio = `a${index}`;
  transitionFilters.push(`${videoLabel}[${index}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${transitionOffset.toFixed(3)}[${nextVideo}]`);
  transitionFilters.push(`${audioLabel}[${index}:a]acrossfade=d=${transitionDuration}:c1=tri:c2=tri[${nextAudio}]`);
  videoLabel = `[${nextVideo}]`;
  audioLabel = `[${nextAudio}]`;
  transitionOffset += renderedScenes[index].duration - transitionDuration;
}
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  ...transitionInputs,
  "-filter_complex", transitionFilters.join(";"),
  "-map", videoLabel,
  "-map", audioLabel,
  "-r", "30",
  "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "17",
  "-c:a", "aac", "-b:a", "256k",
  "-movflags", "+faststart",
  tempOutputPath
], { maxBuffer: 1024 * 1024 * 20 });
await rename(tempOutputPath, outputPath);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "00:00:02", "-i", outputPath, "-frames:v", "1", posterPath]);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", outputPath, "-vf", "fps=1/34,scale=480:-1,tile=4x2", "-frames:v", "1", join(qaDir, "contact-sheet.png")]);
const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate", "-of", "json", outputPath]);
await writeFile(transcriptPath, transcript.join("\n"));
await writeFile(metadataPath, JSON.stringify({
  title: "Texas SandFest Board Presentation Demo",
  generatedAt: new Date().toISOString(),
  voice,
  localOnly: true,
  tts: "Qwen3-TTS 1.7B CustomVoice 8-bit via MLX on Apple Silicon",
  ttsModel,
  visitorUrl,
  operationsUrl,
  scenes: renderedScenes.map(({ id, title, kind, duration, audioDuration, visualPath }) => ({ id, title, kind, duration, audioDuration, visualPath })),
  ffprobe: JSON.parse(probe)
}, null, 2));
console.log(`Video: ${outputPath}`);
console.log(`Poster: ${posterPath}`);
console.log(`Transcript: ${transcriptPath}`);
console.log(`Metadata: ${metadataPath}`);
console.log(probe.trim());

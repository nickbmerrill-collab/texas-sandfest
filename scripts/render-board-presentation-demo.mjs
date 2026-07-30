import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const posterPath = join(artifactDir, "texas-sandfest-board-presentation-demo-poster.png");
const transcriptPath = join(artifactDir, "texas-sandfest-board-presentation-demo-transcript.txt");
const metadataPath = join(artifactDir, "texas-sandfest-board-presentation-demo-metadata.json");
const narrationManifestPath = join(artifactDir, "narration-manifest.json");
const visitorUrl = process.env.SANDFEST_VISITOR_URL || "http://127.0.0.1:5175/?apiBase=http%3A%2F%2F127.0.0.1%3A8806&mode=visitor";
const operationsUrl = process.env.SANDFEST_OPERATIONS_URL || "http://127.0.0.1:5175/admin.html?apiBase=http%3A%2F%2F127.0.0.1%3A8806";
const ttsPython = process.env.SANDFEST_KOKORO_PYTHON || "/Volumes/ModelRAID/sandfest-local-tts/.venv/bin/python";
const voice = process.env.SANDFEST_KOKORO_VOICE || "am_michael";

const scenes = [
  {
    id: "01-opening",
    kind: "slide",
    title: "Texas SandFest Digital Operating System",
    eyebrow: "Board presentation",
    bullets: ["A public visitor experience", "A partner revenue and outreach portal", "A staff command center for event operations"],
    kpis: ["10 certified board journeys", "Chromium and WebKit accepted", "Local provider sandboxes active"],
    narration: "Texas SandFest now has a working digital operating system. It connects the public visitor experience, sponsor and vendor revenue, staff operations, guest services, accounting evidence, and board-level launch controls. This is a real application walkthrough, not a concept deck."
  },
  {
    id: "02-proof",
    kind: "slide",
    title: "What The Board Will See",
    eyebrow: "Certified local proof",
    bullets: ["Actual public and operations workflows", "Review-gated automation for partners and outreach", "Clear production activation gates"],
    kpis: ["Sponsor and vendor intake", "Receivables and key dates", "Tasks, incidents, island conditions"],
    narration: "The goal of this demo is to make the decision surface obvious. The board will see what is working now, how automation is controlled, and which integrations remain gated before any public launch."
  },
  {
    id: "03-visitor",
    kind: "capture",
    title: "Visitor Experience",
    label: "Public site, Live Beach, ticketing, sculptors, passport",
    callouts: ["Live Beach and island conditions", "Ticketing with consent separation", "Sculptor map, passport, and voting"],
    narration: "The visitor experience starts with the public website. Guests can find event details, open Live Beach, review island conditions, enter the ticket flow, explore the sculptor map, and use the passport and People's Choice workflows. For the board demo, the signals are local and reset-safe."
  },
  {
    id: "04-partner-intake",
    kind: "capture",
    title: "Sponsor and Vendor Signups",
    label: "Sponsor tiers, vendor intake, private status links",
    callouts: ["Published sponsor tiers", "Vendor application fields", "Private applicant status path"],
    narration: "Sponsor and vendor intake is handled through real application forms. The public site shows current sponsor tiers, captures partner contact details, supports vendor interest and application modes, and connects each submission to private status tracking and staff review."
  },
  {
    id: "05-command",
    kind: "capture",
    title: "Operations Command",
    label: "Revenue, work, partner readiness, key dates",
    callouts: ["Command summary", "Impact snapshot", "Partner readiness and next actions"],
    narration: "The operations portal gives staff a command surface across revenue, partner readiness, guest services, key dates, delegated work, and launch gates. The goal is not another spreadsheet; it is a shared operating view for the event team."
  },
  {
    id: "06-outreach-accounting",
    kind: "capture",
    title: "Outreach and Accounting",
    label: "Geographic targeting, follow-up, receivables, exports",
    callouts: ["Geographic sponsor targeting", "Review-first outreach automation", "Receivables, payments, and exports"],
    narration: "Partner operations includes outreach targeting, campaign preview, automated follow-up tracking, receivables aging, payment status, and export paths for accounting. Prospecting remains review-first, so external messages are governed before anything leaves the system."
  },
  {
    id: "07-delegation-island",
    kind: "capture",
    title: "Delegation and Island Conditions",
    label: "Guest services, staff tasks, volunteers, incident response",
    callouts: ["Guest cases with private updates", "Staff and volunteer assignments", "Weather, ferry, camera, crowd model"],
    narration: "Guest Services and task delegation share the same accountable loop. Staff can assign owners, priorities, deadlines, and evidence. Island Conditions shows the event-day model for weather, ferry, camera, crowd, and line monitoring, with live feeds held behind post-board activation."
  },
  {
    id: "08-boundary",
    kind: "slide",
    title: "Certified Now. Activated Deliberately.",
    eyebrow: "Board-safe launch boundary",
    bullets: ["Local workflows are proven and reset-safe", "Live money, messages, identity, domains, and feeds stay gated", "The board can approve activation in controlled stages"],
    kpis: ["Stripe and QuickBooks gated", "Live SMS and email gated", "Weather, ferry, and cameras post-board"],
    narration: "This distinction matters. The workflows are proven locally, but live money movement, live communications, identity, domains, weather, ferry data, and camera agents remain controlled activation decisions after board review."
  },
  {
    id: "09-gates",
    kind: "capture",
    title: "Readiness and Activation Gates",
    label: "Certified now, production controls explicit",
    callouts: ["Board capability proof", "Browser acceptance evidence", "Deferred production gates"],
    narration: "The board proof screen separates certified local capability from production activation. The workflows are proven for review, while live payments, QuickBooks, live email and SMS, identity, bot protection, domains, weather, ferry data, and camera agents remain explicit approval gates."
  },
  {
    id: "10-close",
    kind: "slide",
    title: "Ready for Board Review",
    eyebrow: "Decision surface",
    bullets: ["Real workflows demonstrated", "Automation is governed", "Production gates are explicit"],
    kpis: ["Visitor experience", "Partner revenue operations", "Event command and accountability"],
    narration: "This gives the board a clear decision surface: what is working, what is controlled, and what needs approval before public launch. The platform is ready to review as a serious operating system for Texas SandFest."
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
  const bullets = scene.bullets.map((item, index) => `
    <g transform="translate(210 ${548 + index * 88})">
      <circle cx="0" cy="0" r="9" fill="#F7B733"/>
      <text x="32" y="11" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#FFFDF7">${escapeXml(item)}</text>
    </g>`).join("");
  const wrapKpi = item => {
    const words = String(item).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > 24 && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  };
  const kpis = (scene.kpis || []).map((item, index) => {
    const lines = wrapKpi(item);
    return `
    <g transform="translate(${700 + index * 380} 784)">
      <rect x="0" y="0" width="340" height="130" fill="#FFFDF7" opacity="0.96"/>
      <rect x="0" y="0" width="340" height="6" fill="${index === 0 ? "#F7B733" : index === 1 ? "#E85D4A" : "#7DD3C0"}"/>
      ${lines.map((line, lineIndex) => `<text x="24" y="${46 + lineIndex * 30}" font-family="Arial, Helvetica, sans-serif" font-weight="${lineIndex === 0 ? "700" : "400"}" font-size="${lineIndex === 0 ? "23" : "20"}" fill="${lineIndex === 0 ? "#12333A" : "#56636A"}">${escapeXml(line)}</text>`).join("")}
    </g>`;
  }).join("");
  const svg = `<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#12333A"/>
        <stop offset="0.58" stop-color="#006D77"/>
        <stop offset="1" stop-color="#172126"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect x="0" y="0" width="1920" height="11" fill="#F7B733"/>
    <rect x="120" y="118" width="1680" height="844" rx="0" fill="#000000" opacity="0.18"/>
    <path d="M1240 118 C1510 205 1715 405 1800 712 L1800 962 L1228 962 C1302 792 1278 599 1158 451 C1080 355 1045 231 1102 118 Z" fill="#F7B733" opacity="0.11"/>
    <path d="M1380 118 C1590 238 1722 390 1800 595 L1800 962 L1515 962 C1565 781 1525 620 1392 479 C1285 366 1257 228 1380 118 Z" fill="#7DD3C0" opacity="0.13"/>
    <text x="200" y="222" font-family="Arial, Helvetica, sans-serif" font-size="28" letter-spacing="2" fill="#F4DFAC">${escapeXml(scene.eyebrow || "Texas SandFest")}</text>
    <text x="200" y="342" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="76" fill="#FFFDF7">${escapeXml(scene.title)}</text>
    <rect x="200" y="402" width="390" height="6" fill="#E85D4A"/>
    ${bullets}
    ${kpis}
    <text x="200" y="940" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#F8F5EC" opacity="0.82">Visitor experience · Partner operations · Event command</text>
  </svg>`;
  const out = join(slideDir, `${scene.id}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
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
    location.hash = target;
    document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, hash);
  await sleep(1400);
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
    `fade=t=in:st=0:d=0.25`,
    `fade=t=out:st=${Math.max(0, duration - 0.35).toFixed(3)}:d=0.35`,
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x12333A@0.04:t=fill"
  ].join(",");
}

async function makeCaptureOverlay(scene) {
  const out = join(overlayDir, `${scene.id}.png`);
  const callouts = (scene.callouts || []).map((item, index) => `
    <g transform="translate(${54 + index * 520} 956)">
      <rect x="0" y="0" width="480" height="62" fill="#12333A" opacity="0.86"/>
      <circle cx="32" cy="31" r="8" fill="${index === 0 ? "#F7B733" : index === 1 ? "#E85D4A" : "#7DD3C0"}"/>
      <text x="56" y="39" font-family="Arial, Helvetica, sans-serif" font-size="23" fill="#FFFDF7">${escapeXml(item)}</text>
    </g>`).join("");
  const svg = `<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="1920" height="104" fill="#12333A" opacity="0.88"/>
    <rect x="0" y="104" width="1920" height="5" fill="#F7B733" opacity="0.96"/>
    <rect x="0" y="934" width="1920" height="146" fill="#000000" opacity="0.18"/>
    <text x="54" y="67" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="38" fill="#FFFDF7">${escapeXml(scene.title)}</text>
    <text x="1866" y="61" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#F4DFAC">${escapeXml(scene.label)}</text>
    <text x="54" y="916" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#FFFDF7" opacity="0.85">LIVE APPLICATION CAPTURE</text>
    ${callouts}
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
await run(ttsPython, [join(root, "scripts/generate-kokoro-narration.py"), "--manifest", narrationManifestPath, "--voice", voice, "--speed", "0.92"], {
  env: {
    ...process.env,
    HF_HOME: "/Volumes/ModelRAID/huggingface-cache",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1"
  },
  maxBuffer: 1024 * 1024 * 20
});

const browser = await chromium.launch({ headless: true });
const concatLines = [];
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
    const duration = Math.max(audioDuration + 0.9, scene.kind === "slide" ? 11 : 18);
    const segmentPath = join(segmentDir, `${scene.id}.mp4`);
    const captureOverlay = scene.kind === "capture" ? await makeCaptureOverlay(scene) : null;
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputArgs,
      "-i", audioPath,
      ...(captureOverlay ? ["-i", captureOverlay] : []),
      ...(captureOverlay
        ? ["-filter_complex", `[0:v]${overlayFilter(scene, duration)}[base];[base][2:v]overlay=0:0[v]`, "-map", "[v]", "-map", "1:a:0"]
        : ["-map", "0:v:0", "-map", "1:a:0", "-vf", `scale=1920:1080,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, duration - 0.45).toFixed(3)}:d=0.45`]),
      "-af", "loudnorm=I=-16:LRA=11:TP=-1.5,afade=t=in:st=0:d=0.12,apad=pad_dur=0.9",
      "-t", duration.toFixed(3),
      "-r", "30",
      "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      segmentPath
    ], { maxBuffer: 1024 * 1024 * 20 });
    concatLines.push(`file '${segmentPath.replaceAll("'", "'\\''")}'`);
    transcript.push(scene.title, scene.narration, "");
    renderedScenes.push({ ...scene, audioDuration, duration, visualPath, segmentPath });
    console.log(`Rendered ${scene.id}: ${scene.title}`);
  }
} finally {
  await browser.close();
}

const concatPath = join(segmentDir, "concat.txt");
await writeFile(concatPath, `${concatLines.join("\n")}\n`);
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", concatPath,
  "-c", "copy", "-movflags", "+faststart", outputPath
]);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "00:00:02", "-i", outputPath, "-frames:v", "1", posterPath]);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", outputPath, "-vf", "fps=1/34,scale=480:-1,tile=4x2", "-frames:v", "1", join(qaDir, "contact-sheet.png")]);
const { stdout: probe } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=index,codec_name,codec_type,width,height,r_frame_rate", "-of", "json", outputPath]);
await writeFile(transcriptPath, transcript.join("\n"));
await writeFile(metadataPath, JSON.stringify({
  title: "Texas SandFest Board Presentation Demo",
  generatedAt: new Date().toISOString(),
  voice,
  localOnly: true,
  tts: "Kokoro local model via /Volumes/ModelRAID/sandfest-local-tts",
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

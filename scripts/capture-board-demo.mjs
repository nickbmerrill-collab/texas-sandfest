import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolve(process.env.SANDFEST_VIDEO_DIR || join(root, "artifacts/board-demo"));
const frameDir = resolve(process.env.SANDFEST_VIDEO_FRAME_DIR || join(artifactDir, "frames"));
const captureManifestPath = join(artifactDir, "capture.json");
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const demoUrl = process.env.SANDFEST_DEMO_URL || "http://127.0.0.1:5175/?apiBase=http%3A%2F%2F127.0.0.1%3A8806&mode=visitor";
const adminToken = process.env.SANDFEST_ADMIN_API_TOKEN || "board-demo-local-admin-token-change-me";
const parsedDemoUrl = new URL(demoUrl);
const apiBase = parsedDemoUrl.searchParams.get("apiBase") || "http://127.0.0.1:8806";
const operationsUrl = process.env.SANDFEST_OPERATIONS_URL || (() => {
  const url = new URL("admin.html", parsedDemoUrl);
  url.searchParams.set("apiBase", apiBase);
  return url.href;
})();
const debugPort = Number(process.env.SANDFEST_CHROME_DEBUG_PORT || 0) || 9300 + Math.floor(Math.random() * 500);
const profileDir = await mkdtemp(join(tmpdir(), "sandfest-board-video-"));
await mkdir(artifactDir, { recursive: true });
const stagingFrameDir = await mkdtemp(join(artifactDir, "frames-staging-"));
const stagingCaptureManifestPath = join(artifactDir, `.capture-${process.pid}.json`);
const capturedFrames = [];
let capturePublished = false;

const expectedDeferrals = [
  "live_payment_and_accounting_providers",
  "live_email_and_sms_providers",
  "live_weather_and_ferry_feeds",
  "live_webcam_edge_agents",
  "production_identity_and_bot_protection",
  "public_dns_and_recovery_cutover"
];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function requireLoopback(label, value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`${label} must use exact loopback HTTP for the offline-safe board recording.`);
  }
  return url;
}

requireLoopback("Visitor URL", demoUrl);
requireLoopback("Operations URL", operationsUrl);
requireLoopback("API base", apiBase);

async function waitForJson(url, timeoutMs = 15000, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`JSON endpoint did not become ready: ${lastError?.message || url}`);
}

function browserProofIsComplete(items) {
  return ["chromium", "webkit"].every(engine => {
    const item = items.find(candidate => candidate.engine === engine);
    return item?.passed === 14 && item?.total === 14;
  });
}

async function readBoardEvidence() {
  const apiUrl = requireLoopback("API base", apiBase);
  const healthUrl = new URL("/health", apiUrl);
  const bootstrapUrl = new URL("/api/public/bootstrap", apiUrl);
  const deploymentUrl = new URL("/api/admin/deployment", apiUrl);
  const [health, bootstrap, deploymentPayload] = await Promise.all([
    waitForJson(healthUrl),
    waitForJson(bootstrapUrl),
    waitForJson(deploymentUrl, 15000, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
  ]);
  const proof = deploymentPayload?.deployment?.boardCapabilities;
  const runtimeLabel = bootstrap?.runtime?.label || "";
  const journeyCount = Array.isArray(proof?.journeys) ? proof.journeys.length : 0;
  const certificateTime = new Date(proof?.completedAt || "").getTime();
  if (health?.ok !== true
    || health?.boardDemoRuntime !== true
    || health?.runtimeDataMode !== "isolated"
    || health?.currentEventId !== "texas-sandfest-2027"
    || health?.documentIngestionReady !== true) {
    throw new Error("The recording target is not the ready, isolated 2027 board runtime with document ingestion enabled.");
  }
  if (bootstrap?.runtime?.mode !== "board_demo"
    || !runtimeLabel.includes("Synthetic 2027 data")
    || !runtimeLabel.includes("No external messages, charges, or live-provider calls")) {
    throw new Error("The recording target does not expose the required synthetic-data and no-live-provider boundary.");
  }
  if (proof?.ok !== true
    || proof?.source?.branch !== "main"
    || proof?.source?.dirty !== false
    || proof?.source?.matchesOriginMain !== true
    || journeyCount !== 10
    || !Number.isFinite(certificateTime)
    || certificateTime > Date.now() + 5 * 60_000
    || Date.now() - certificateTime > 7 * 24 * 60 * 60_000
    || JSON.stringify(proof?.deferredProductionGates || []) !== JSON.stringify(expectedDeferrals)
    || !browserProofIsComplete(proof?.browsers || [])) {
    throw new Error("The recording target does not have a current full board capability certificate.");
  }
  return {
    runtime: {
      mode: bootstrap.runtime.mode,
      label: runtimeLabel,
      eventId: health.currentEventId,
      generation: health.boardDemoGeneration,
      documentIngestionReady: health.documentIngestionReady
    },
    certificate: {
      ok: proof.ok,
      completedAt: proof.completedAt,
      source: proof.source,
      journeyCount,
      browsers: proof.browsers,
      deferredProductionGates: proof.deferredProductionGates
    }
  };
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolveConnect, rejectConnect) => {
      this.socket.addEventListener("open", resolveConnect, { once: true });
      this.socket.addEventListener("error", rejectConnect, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.listeners.get(message.method) || [];
      this.listeners.delete(message.method);
      listeners.forEach(listener => listener.resolve(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeoutMs = 15000) {
    return new Promise((resolveWait, rejectWait) => {
      const listener = { resolve: resolveWait, reject: rejectWait };
      const listeners = this.listeners.get(method) || [];
      listeners.push(listener);
      this.listeners.set(method, listeners);
      setTimeout(() => {
        const active = this.listeners.get(method) || [];
        const index = active.indexOf(listener);
        if (index >= 0) active.splice(index, 1);
        rejectWait(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs).unref();
    });
  }

  close() {
    this.socket.close();
  }
}

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=1600,900",
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeError = "";
chrome.stderr.on("data", chunk => {
  chromeError += chunk.toString();
  if (chromeError.length > 8000) chromeError = chromeError.slice(-8000);
});

let cdp;
try {
  const boardEvidence = await readBoardEvidence();
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const pageTarget = targets.find(target => target.type === "page");
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target.");

  cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  const evaluate = async (expression, awaitPromise = true) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  const waitForSelector = selector => evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const check = () => {
      if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error("Missing selector: ${selector}"));
      setTimeout(check, 100);
    };
    check();
  })`);

  const waitForExpression = (expression, description) => evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 25000;
    const check = () => {
      try {
        if (${expression}) return resolve(true);
      } catch {}
      if (Date.now() >= deadline) return reject(new Error(${JSON.stringify(`Timed out waiting for ${description}`)}));
      setTimeout(check, 100);
    };
    check();
  })`);

  const navigate = async url => {
    const loaded = cdp.waitFor("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await loaded;
    await waitForSelector("#app main");
    await delay(900);
  };

  const scrollTo = async selector => {
    await evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) throw new Error("Missing capture target: ${selector}");
      document.documentElement.style.scrollBehavior = "auto";
      const top = target.getBoundingClientRect().top + window.scrollY - 86;
      window.scrollTo(0, Math.max(0, top));
      return { top: window.scrollY, title: target.querySelector("h1,h2,h3")?.textContent || "" };
    })()`);
    await delay(500);
  };

  const capture = async (file, selector) => {
    await scrollTo(selector);
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    const bytes = Buffer.from(screenshot.data, "base64");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (bytes.length < 20_000 || width !== 1600 || height !== 900) {
      throw new Error(`Capture ${file} is not a complete 1600 by 900 frame.`);
    }
    await writeFile(join(stagingFrameDir, file), bytes);
    capturedFrames.push({
      file,
      selector,
      width,
      height,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
    console.log(`Captured ${file}`);
  };

  await navigate(demoUrl);
  await evaluate(`localStorage.setItem("sandfest_site_mode", "public")`);
  await evaluate(`window.scrollTo(0, 0)`);
  await delay(350);
  await capture("01-visitor-home.png", ".hero");

  await evaluate(`(() => {
    const scrubber = document.querySelector("#lb-scrub-input");
    scrubber.value = "9";
    scrubber.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#lb-walk-btn")?.click();
  })()`);
  await capture("02-live-beach.png", "#live-beach");

  await evaluate(`(() => {
    document.querySelector('button[aria-label="Add General Admission 3-Day Wristband"]')?.click();
    document.querySelector('button[aria-label="Add VIP Wristband - Friday"]')?.click();
    document.querySelector("#consent-sms-safety")?.click();
  })()`);
  await capture("03-ticketing.png", "#tickets");

  await evaluate(`(async () => {
    const data = await fetch("/data/sculptors.json").then(response => response.json());
    localStorage.setItem("sandfest_passport_v1", JSON.stringify(data.entries.map(entry => entry.id)));
    localStorage.setItem("sandfest_site_mode", "public");
  })()`);
  await navigate(demoUrl);
  await evaluate(`document.querySelector("[data-sculptor]")?.click()`);
  await capture("04-sculptors-passport.png", "#sculptors-showcase");
  await capture("05-voting-passport.png", "#passport-panel");
  await capture("06-partner-intake.png", "#sponsors");

  await capture("07-guest-services.png", "#guest-services");

  await navigate(operationsUrl);
  await waitForSelector("#admin-config");
  await waitForExpression(
    `document.querySelector("#admin-api-pill")?.dataset.state === "ok"
      && document.querySelector("#admin-command-signals")?.getAttribute("aria-busy") === "false"`,
    "the Operations command center"
  );
  await capture("08-operations-command.png", "#admin-command-center");
  await capture("09-document-intake.png", "#admin-documents");
  await capture("10-partner-operations.png", "#admin-partners");
  await capture("11-incident-delegation.png", "#admin-incident-command");
  await waitForExpression(
    `document.querySelector("#admin-board-capability-proof")?.hidden === false
      && document.querySelector("#admin-board-capability-proof-summary")?.textContent.includes("10/10")`,
    "the board capability proof"
  );
  await capture("12-readiness-proof.png", "#admin-board-stage-summary");

  await writeFile(stagingCaptureManifestPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    visitorUrl: demoUrl,
    operationsUrl,
    apiBase,
    viewport: { width: 1600, height: 900 },
    ...boardEvidence,
    frames: capturedFrames
  }, null, 2)}\n`);
  await rm(frameDir, { recursive: true, force: true });
  await rename(stagingFrameDir, frameDir);
  await rename(stagingCaptureManifestPath, captureManifestPath);
  capturePublished = true;
  console.log(`Capture evidence: ${captureManifestPath}`);
} catch (error) {
  const details = chromeError.trim() ? `\nChrome: ${chromeError.trim()}` : "";
  throw new Error(`${error.message}${details}`);
} finally {
  cdp?.close();
  if (chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([once(chrome, "exit"), delay(3000)]);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (!capturePublished) {
    await rm(stagingFrameDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await rm(stagingCaptureManifestPath, { force: true });
  }
}

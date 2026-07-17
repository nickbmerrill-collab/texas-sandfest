import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frameDir = resolve(process.env.SANDFEST_VIDEO_FRAME_DIR || join(root, "artifacts/board-demo/frames"));
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const demoUrl = process.env.SANDFEST_DEMO_URL || "http://127.0.0.1:5175/?apiBase=http://127.0.0.1:8806";
const adminToken = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";
const parsedDemoUrl = new URL(demoUrl);
const apiBase = parsedDemoUrl.searchParams.get("apiBase") || "http://127.0.0.1:8806";
const debugPort = Number(process.env.SANDFEST_CHROME_DEBUG_PORT || 0) || 9300 + Math.floor(Math.random() * 500);
const profileDir = await mkdtemp(join(tmpdir(), "sandfest-board-video-"));

await mkdir(frameDir, { recursive: true });

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Chrome debugging endpoint did not start: ${lastError?.message || url}`);
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
    await writeFile(join(frameDir, file), Buffer.from(screenshot.data, "base64"));
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
  await capture("06-vendor-map.png", "#vendors-map");

  await evaluate(`document.querySelector('button[data-prompt="What do families need on-site?"]')?.click()`);
  await capture("07-ask-sandy.png", "#concierge");

  await evaluate(`document.querySelector('[data-site-mode="ops"]')?.click()`);
  await evaluate(`document.querySelector("#simulate-btn")?.click()`);
  await capture("08-operations.png", "#operations");

  await evaluate(`(() => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue("#admin-api-base", ${JSON.stringify(apiBase)});
    setValue("#admin-api-token", ${JSON.stringify(adminToken)});
    document.querySelector("#admin-load-config")?.click();
  })()`);
  const adminState = await evaluate(`new Promise(resolve => {
    const deadline = Date.now() + 15000;
    const check = () => {
      const pill = document.querySelector("#admin-api-pill");
      if (pill?.dataset.state === "ok" || Date.now() >= deadline) return resolve(pill?.dataset.state || "timeout");
      setTimeout(check, 150);
    };
    check();
  })`);
  if (adminState !== "ok") {
    throw new Error(`Admin API did not connect before capture (state: ${adminState}).`);
  }
  await capture("09-admin-readiness.png", "#admin-config");
  await capture("10-revenue-fleet.png", ".admin-revenue-panel");
  await capture("11-fleet-operations.png", ".admin-fleet-panel");
  await capture("12-volunteer-coverage.png", ".admin-volunteers-panel");
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
}

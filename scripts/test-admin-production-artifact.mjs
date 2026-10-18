#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_CLI = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPreview(url, preview) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) {
      throw new Error(`Admin preview exited before it became ready (${preview.exitCode}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The preview socket is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Admin production artifact preview did not become ready.");
}

function stopPreview(preview) {
  return new Promise(resolve => {
    if (preview.exitCode !== null) return resolve();
    const timeout = setTimeout(() => preview.kill("SIGKILL"), 2_000);
    preview.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    preview.kill("SIGTERM");
  });
}

const port = await availablePort();
const previewUrl = `http://127.0.0.1:${port}/`;
const preview = spawn(process.execPath, [
  VITE_CLI,
  "preview",
  "--host", "127.0.0.1",
  "--port", String(port),
  "--strictPort",
  "--outDir", "dist-admin"
], {
  cwd: ROOT,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

let browser;
try {
  await waitForPreview(previewUrl, preview);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(7_000);
  page.setDefaultNavigationTimeout(7_000);

  const pageErrors = [];
  const requiredChunkResponses = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (/admin-(?:auth|operations-ui)-/.test(response.url())) {
      requiredChunkResponses.push({ url: response.url(), status: response.status() });
    }
  });

  const response = await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
  const heading = await page.locator("h1").first().textContent();
  const authStatus = (await page.locator("#admin-api-status").textContent())?.trim();

  if (response?.status() !== 200) {
    throw new Error(`Admin production document returned ${response?.status() ?? "no response"}.`);
  }
  if (heading?.trim() !== "Festival operations command center") {
    throw new Error(`Admin production artifact did not render its primary heading: ${heading ?? "missing"}.`);
  }
  if (authStatus !== "Signed out.") {
    throw new Error(`Admin production artifact did not reach the safe signed-out state: ${authStatus ?? "missing"}.`);
  }
  if (requiredChunkResponses.length !== 2 || requiredChunkResponses.some(item => item.status !== 200)) {
    throw new Error(`Admin startup chunks did not load exactly once: ${JSON.stringify(requiredChunkResponses)}.`);
  }
  if (pageErrors.length) {
    throw new Error(`Admin production artifact emitted page errors: ${pageErrors.join(" | ")}`);
  }

  console.log(
    "Admin production artifact readiness: document, operations UI, OIDC cache boundary, heading, and safe signed-out state passed."
  );
} finally {
  await browser?.close();
  await stopPreview(preview);
}

// Builds the public site as a read-only launch and drives it in Chromium against the in-repo
// read-only bridge. Proves no staff, admin, checkout, or intake action is reachable and that
// what the page claims is honest. Requires `npx playwright install chromium`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import worker from "../cloudflare/public-api/index.js";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist-public");
const API = "https://sandfest-api.heyelab.com";
const PUBLIC_ORIGIN = "https://sandfest.heyelab.com";

const build = spawnSync("npm", ["run", "build:public"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE: "read_only", VERCEL: "1", VERCEL_ENV: "production", SANDFEST_DEPLOYMENT_ENV: "production", VITE_SANDFEST_TURNSTILE_SITE_KEY: "production_site_key_0123456789" }
});
assert.equal(build.status, 0, `read-only build failed:\n${build.stdout}\n${build.stderr}`);
assert.ok(!existsSync(path.join(dist, "admin.html")), "the public artifact must not contain the admin entry.");

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = http.createServer(async (request, response) => {
  let pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.endsWith("/")) pathname += "index.html";
  try {
    const body = await readFile(path.join(dist, pathname));
    response.writeHead(200, { "content-type": types[path.extname(pathname)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(await readFile(path.join(dist, "index.html")));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  page.on("request", request => requests.push({ method: request.method(), url: request.url() }));
  await page.route(url => !url.href.startsWith(origin) && !url.href.startsWith(API), route => route.abort());
  await page.route(`${API}/**`, async route => {
    const request = route.request();
    // Present the production origin to the bridge, then allow the local page to read the reply.
    const headers = { ...request.headers(), origin: PUBLIC_ORIGIN };
    const response = await worker.fetch(new Request(request.url(), { method: request.method(), headers, body: request.postData() || undefined }));
    const replyHeaders = Object.fromEntries(response.headers);
    replyHeaders["access-control-allow-origin"] = origin;
    await route.fulfill({ status: response.status, headers: replyHeaders, body: await response.text() });
  });

  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.waitForSelector("#ask-form");
  await page.waitForTimeout(3000);

  ok(await page.locator('meta[name="sandfest-launch-mode"]').getAttribute("content") === "read_only", "the built page is marked as a read-only launch");

  // No staff, admin, payment, or Turnstile traffic, and no state-changing request, on load.
  const bad = requests.filter(entry => /\/api\/(admin|staff|board|stripe|quickbooks|sms|webhooks)/.test(entry.url) || /challenges\.cloudflare\.com/.test(entry.url));
  ok(bad.length === 0, `forbidden requests on load: ${bad.map(entry => entry.url).join(", ")}`);
  ok(requests.filter(entry => entry.url.startsWith(API)).every(entry => entry.method === "GET"), "only GET requests reach the bridge on load");
  ok(requests.filter(entry => !entry.url.startsWith(origin) && !entry.url.startsWith(API)).length === 0, "the page talks only to itself and the bridge");

  // Every visible submit control is disabled, except Ask Sandy and the private-status lookups.
  const forms = await page.evaluate(() => [...document.querySelectorAll("form")].map(form => ({
    id: form.id,
    submits: [...form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')].map(button => ({ text: button.textContent.trim(), disabled: button.disabled }))
  })));
  const allowedOpen = new Set(["ask-form", "guest-services-status-form", "partner-status-form"]);
  for (const form of forms) {
    if (allowedOpen.has(form.id)) continue;
    ok(form.submits.length > 0 && form.submits.every(button => button.disabled), `form #${form.id} has an enabled submit control: ${JSON.stringify(form.submits)}`);
  }
  ok(forms.some(form => form.id === "vendor-application-form") && forms.some(form => form.id === "sponsor-inquiry-form"), "intake forms are present but disabled");

  // Checkout, payment, and staff claims are not on the page.
  const text = await page.evaluate(() => document.body.innerText);
  for (const forbidden of [/Stripe/i, /Apple Pay/i, /QuickBooks/i, /Webhook/i, /Customer checkout/i, /Continue to/i, /Get tickets/i, /\b11\s+sponsorship packages/i, /Admin console/i, /SandFest Ops Console/i, /sign in/i]) {
    ok(!forbidden.test(text), `the read-only page must not show ${forbidden}`);
  }
  ok(await page.locator(".checkout-panel").isHidden(), "the order draft and checkout panel are hidden");
  ok(await page.locator("#checkout-btn").isDisabled(), "the checkout button cannot be used");
  ok(/Online sales will open after/i.test(text) || /Sales pending/i.test(text), "ticketing says sales are not open");
  ok(await page.locator('a[href*="admin"]').count() === 0, "no link points at an admin surface");

  // Unavailable feeds are shown as unavailable, with no readings.
  ok(/Weather[\s\S]{0,80}Unavailable/i.test(text) && /Awaiting Update/i.test(text) && /Unknown/.test(text), "weather, ferry and island load say they are unavailable");
  ok(!/\b\d{2,3}\s?°\s?F\b/.test(text), "no temperature reading is shown while the weather feed is unavailable");
  ok(/April 16-18, 2027/.test(text) && /9:00 AM - 7:30 PM/.test(text), "the verified event dates and hours are shown");

  // Staff and demo modes cannot be summoned through the URL.
  for (const url of [`${origin}/?mode=ops`, `${origin}/#admin`, `${origin}/#operations`, `${origin}/#admin-config`]) {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("#ask-form");
    const body = await page.evaluate(() => document.body.innerText);
    ok(!/SandFest Ops Console|Command board|Admin token|Operations portal/i.test(body), `${url} must not reveal staff tooling`);
    ok(await page.locator("body.mode-ops").count() === 0, `${url} must not enter ops mode`);
  }
  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.waitForSelector("#ask-form");
  await page.waitForTimeout(1500);

  // Private-status lookups are refused before any request is made.
  const before = requests.length;
  for (const formId of ["#partner-status-form", "#guest-services-status-form"]) {
    await page.locator(`${formId} input[name="reference"]`).fill("TSF-X-000000");
    await page.locator(`${formId} input[name="token"]`).fill("tsfp_read_only_probe");
    await page.locator(`${formId} button[type="submit"]`).click();
    await page.waitForTimeout(500);
  }
  const lookups = requests.slice(before).filter(entry => entry.url.startsWith(API));
  ok(lookups.every(entry => entry.method === "GET" && /^https:\/\/sandfest-api\.heyelab\.com\/api\/public\/[a-z-]+$/.test(entry.url)), `status lookups must not send credentials to the bridge: ${JSON.stringify(lookups)}`);
  ok(lookups.length === 0 || lookups.every(entry => !/status|token|reference/i.test(entry.url)), "no lookup carries the private reference or code");

  // Ask Sandy still works, and it is the only write.
  const askBefore = requests.length;
  await page.locator("#ask-input").fill("When is Texas SandFest?");
  const concierge = page.waitForResponse(response => response.url() === `${API}/api/public/concierge`, { timeout: 15000 });
  await page.locator("#ask-submit").click();
  ok((await concierge).status() === 200, "Ask Sandy gets a 200 from the bridge");
  await page.waitForTimeout(500);
  const askRequests = requests.slice(askBefore).filter(entry => entry.url.startsWith(API));
  ok(askRequests.some(entry => entry.method === "POST" && entry.url === `${API}/api/public/concierge`), "Ask Sandy posts to the concierge");
  ok(askRequests.every(entry => entry.method === "GET" || entry.url === `${API}/api/public/concierge`), "Ask Sandy is the only state-changing request the page can send");
} finally {
  await browser.close();
  server.close();
}
console.log(`Read-only launch browser acceptance: ${checks} checks passed.`);

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(root, process.env.SANDFEST_BUILD_OUT_DIR || "dist-public");
const expectedBase = process.env.DEPLOY_BASE || "/texas-sandfest/";
const normalizedBase = `/${expectedBase.replace(/^\/+|\/+$/g, "")}/`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [html, fallbackHtml, manifestText, worker, appleAssociationText] = await Promise.all([
  readFile(path.join(outDir, "index.html"), "utf8"),
  readFile(path.join(outDir, "404.html"), "utf8"),
  readFile(path.join(outDir, "manifest.webmanifest"), "utf8"),
  readFile(path.join(outDir, "sw.js"), "utf8"),
  readFile(path.join(outDir, ".well-known", "apple-app-site-association"), "utf8")
]);
const manifest = JSON.parse(manifestText);
const appleAssociation = JSON.parse(appleAssociationText);
const publishedMediaEntries = await readdir(path.join(outDir, "assets", "sandfest-media"), { withFileTypes: true });
const localReferences = [...html.matchAll(/(?:href|src|content)="(\/[^"\s]+)"/g)].map(match => match[1]);

assert(localReferences.length >= 6, "Pages artifact did not expose the expected local HTML resources.");
assert(localReferences.every(value => value.startsWith(normalizedBase)), `Pages artifact contains a root reference outside ${normalizedBase}.`);
assert(html.includes(`src="${normalizedBase}assets/main-`), "Pages artifact JavaScript does not use the repository base path.");
assert(html.includes(`href="${normalizedBase}assets/main-`), "Pages artifact stylesheet does not use the repository base path.");
assert(html.includes(`href="${normalizedBase}manifest.webmanifest"`), "Pages artifact manifest does not use the repository base path.");
assert(fallbackHtml === html, "Pages canonical-path fallback must boot the exact visitor artifact.");
assert(appleAssociation.applinks?.details?.[0]?.appIDs?.[0] === "ABCDE12345.com.portalcodex.texassandfest", "Pages AASA artifact does not identify the verified iOS bundle.");
assert(appleAssociation.applinks?.details?.[0]?.components?.some(component => component["/"] === "/schedule/*"), "Pages AASA artifact is missing exact schedule routes.");
assert(manifest.start_url === "./" && manifest.scope === "./", "Pages manifest must remain relative to its deployment directory.");
assert(manifest.icons?.every(icon => !String(icon.src).startsWith("/")), "Pages manifest contains a root-relative icon.");
assert(
  publishedMediaEntries.filter(entry => entry.isDirectory()).every(entry => entry.name === "optimized"),
  "Pages artifact contains original media instead of only deployment-optimized derivatives."
);
assert(/const CACHE_VERSION = "sandfest-public-[a-f0-9]{12}";/.test(worker), "Pages service worker is not build-versioned.");
assert(!worker.includes("__BUILD_ID__") && !worker.includes("__BUILD_ASSETS__"), "Pages service worker contains unresolved build placeholders.");
assert(!worker.includes("__MEDIA_ASSETS__"), "Pages service worker contains an unresolved media placeholder.");
assert(!worker.includes(normalizedBase), "Pages service worker must derive its scope instead of hardcoding the repository base.");

const listeners = new Map();
const precachedUrls = [];
const cachedIndex = { source: "offline-index" };
const workerContext = {
  URL,
  Response: { error: () => ({ source: "response-error" }) },
  fetch: async () => { throw new Error("offline"); },
  caches: {
    open: async () => ({
      addAll: async urls => { precachedUrls.push(...urls); },
      put: async () => {}
    }),
    keys: async () => [],
    delete: async () => true,
    match: async request => request === `${normalizedBase}index.html` ? cachedIndex : null
  },
  self: {
    location: { href: `https://example.test${normalizedBase}sw.js`, origin: "https://example.test" },
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  }
};
vm.runInNewContext(worker, workerContext, { filename: "dist-public/sw.js" });

let installPromise;
listeners.get("install")?.({ waitUntil: promise => { installPromise = promise; } });
await installPromise;
assert(precachedUrls.length >= 20, "Pages service worker installed an incomplete offline shell.");
assert(precachedUrls.every(url => url.startsWith(normalizedBase)), "Pages service worker precache escaped its repository scope.");
assert(precachedUrls.some(url => /\/assets\/main-[^/]+\.js$/.test(url)), "Pages offline shell is missing the visitor JavaScript bundle.");
assert(precachedUrls.some(url => /\/assets\/main-[^/]+\.css$/.test(url)), "Pages offline shell is missing the visitor stylesheet.");
assert(precachedUrls.some(url => url.endsWith(".woff2")), "Pages offline shell is missing its brand fonts.");
assert(precachedUrls.some(url => url.endsWith("/assets/sandfest-media/optimized/hero-1440.webp")), "Pages offline shell is missing its optimized hero.");
assert(precachedUrls.filter(url => url.includes("/assets/sandfest-media/optimized/")).length >= 30, "Pages offline shell is missing optimized presentation media.");

let navigationResponse;
listeners.get("fetch")?.({
  request: { method: "GET", mode: "navigate", url: `https://example.test${normalizedBase}sponsors` },
  respondWith: promise => { navigationResponse = promise; }
});
assert(await navigationResponse === cachedIndex, "Pages service worker did not return cached index.html for an offline navigation.");

console.log(`GitHub Pages artifact verified at ${normalizedBase}: HTML, manifest, precache install, and offline navigation are subpath-safe.`);

const CACHE_VERSION = "sandfest-public-__BUILD_ID__";
const BUILD_ASSETS = /* __BUILD_ASSETS__ */ [];
const MEDIA_ASSETS = /* __MEDIA_ASSETS__ */ [];
const APP_BASE = new URL("./", self.location.href);
const appUrl = value => new URL(value, APP_BASE).pathname;
const APP_SHELL = [...new Set([
  "./",
  "index.html",
  "manifest.webmanifest",
  "data/app-bootstrap.json",
  "data/ticket-products.json",
  "data/sculptors.json",
  "data/crawl-summary.json",
  "data/media-assets.json",
  "data/incoming-inventory.json",
  "assets/sandfest-media/media-manifest.json",
  "assets/sandfest-media/media-derivatives.json",
  "assets/sandfest-app-icon.svg",
  ...MEDIA_ASSETS,
  ...BUILD_ASSETS
])].map(appUrl);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/data/") || url.pathname.endsWith("media-manifest.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, appUrl("index.html")));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl = null) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (fallbackUrl ? caches.match(fallbackUrl) : null) || Response.error();
  }
}

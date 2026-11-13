// Proves the Vercel visitor build is served from the domain root.
//
// Regression guard: production once shipped an index.html whose scripts, styles and
// images all pointed under /texas-sandfest/app/, so every asset 404ed on
// texas-sandfest-ten.vercel.app. This test builds the public surface the way Vercel does
// (VERCEL=1) with a hostile DEPLOY_BASE and verifies the artifact, vercel.json rewrites,
// and the iOS Associated Domains contract (sandfest.heyelab.com) still agree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolveDeployBase } from "../vite.config.js";
import {
  SANDFEST_ASSOCIATED_DOMAIN,
  SANDFEST_UNIVERSAL_LINK_COMPONENTS
} from "../lib/public-deep-links.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "dist-public");

// 1. Base resolution contract.
assert.equal(resolveDeployBase({}), "/");
assert.equal(resolveDeployBase({ DEPLOY_BASE: "/" }), "/");
assert.equal(resolveDeployBase({ DEPLOY_BASE: "/texas-sandfest/" }), "/texas-sandfest/");
assert.throws(() => resolveDeployBase({ DEPLOY_BASE: "texas-sandfest" }), /must start and end with/);
assert.throws(() => resolveDeployBase({ DEPLOY_BASE: "/texas-sandfest" }), /must start and end with/);
const originalWarn = console.warn;
console.warn = () => {};
try {
  for (const hostile of ["/texas-sandfest/app/", "/texas-sandfest/", "garbage"]) {
    assert.equal(resolveDeployBase({ VERCEL: "1", DEPLOY_BASE: hostile }), "/", `Vercel must ignore DEPLOY_BASE=${hostile}`);
  }
} finally {
  console.warn = originalWarn;
}
assert.equal(resolveDeployBase({ VERCEL: "1" }), "/");

// 2. Build exactly as vercel.json does, with a hostile DEPLOY_BASE in the environment.
const vercelConfig = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
assert.equal(vercelConfig.outputDirectory, "dist-public", "vercel.json must publish dist-public.");
assert.match(vercelConfig.buildCommand, /npm run build:public$/, "vercel.json must build the isolated public surface.");

const build = spawnSync("npm", ["run", "build:public"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    VERCEL: "1",
    VERCEL_ENV: "production",
    DEPLOY_BASE: "/texas-sandfest/app/",
    SANDFEST_DEPLOYMENT_ENV: "production",
    SANDFEST_BUILD_VERIFICATION: "true",
    SANDFEST_APPLE_APP_ID_PREFIX: "ABCDE12345",
    VITE_SANDFEST_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
  }
});
assert.equal(build.status, 0, `Vercel-style public build failed:\n${build.stdout}\n${build.stderr}`);
assert.match(`${build.stdout}${build.stderr}`, /Ignoring DEPLOY_BASE=\/texas-sandfest\/app\//, "Build should warn that DEPLOY_BASE was ignored.");

// 3. The artifact is root-relative and every referenced local file exists.
const html = await readFile(path.join(outDir, "index.html"), "utf8");
assert.ok(!html.includes("/texas-sandfest"), "index.html still references a /texas-sandfest subpath.");
const references = [...html.matchAll(/(?:href|src)="(\/[^"\s#?]*)"/g)].map(match => match[1]);
assert.ok(references.length >= 6, "index.html exposes too few local resources to prove the base path.");
assert.ok(references.some(value => /^\/assets\/main-[^/]+\.js$/.test(value)), "index.html is missing the root-relative visitor script.");
assert.ok(references.some(value => /^\/assets\/main-[^/]+\.css$/.test(value)), "index.html is missing the root-relative visitor stylesheet.");
assert.ok(references.includes("/manifest.webmanifest"), "index.html is missing the root-relative manifest.");
assert.ok(references.every(value => !value.startsWith("//")), "index.html contains a protocol-relative reference.");
for (const reference of references) {
  assert.ok(existsSync(path.join(outDir, reference)), `index.html references ${reference}, which is not in dist-public.`);
}
assert.equal(await readFile(path.join(outDir, "404.html"), "utf8"), html, "404.html must boot the same visitor artifact.");

// 4. Deep links: AASA, rewrites and the associated domain must agree.
assert.equal(SANDFEST_ASSOCIATED_DOMAIN, "sandfest.heyelab.com", "iOS Associated Domains contract changed.");
const association = JSON.parse(await readFile(path.join(outDir, ".well-known", "apple-app-site-association"), "utf8"));
const aasaPaths = association.applinks.details[0].components.map(component => component["/"]);
assert.deepEqual(aasaPaths, SANDFEST_UNIVERSAL_LINK_COMPONENTS.map(component => component["/"]), "AASA components drifted from the deep-link contract.");
assert.ok(aasaPaths.every(value => value.startsWith("/") && !value.startsWith("/texas-sandfest")), "AASA paths must be root paths on sandfest.heyelab.com.");
const rewriteSources = new Set((vercelConfig.rewrites || []).map(rewrite => rewrite.source));
for (const route of aasaPaths) {
  const expected = route.endsWith("/*") ? `${route.slice(0, -2)}/:path*` : route;
  assert.ok(rewriteSources.has(expected), `vercel.json has no rewrite for universal-link route ${route}; Vercel would 404 it.`);
}
for (const rewrite of vercelConfig.rewrites || []) {
  assert.equal(rewrite.destination, "/index.html", "Visitor routes must rewrite to the visitor shell.");
}
const aasaHeader = (vercelConfig.headers || []).find(entry => entry.source === "/.well-known/apple-app-site-association");
assert.ok(aasaHeader?.headers?.some(header => header.key === "Content-Type" && header.value === "application/json"), "vercel.json must serve the AASA file as application/json.");

// 5. CSP still allows same-origin assets from the root and the production API.
const csp = vercelConfig.headers.flatMap(entry => entry.headers).find(header => header.key === "Content-Security-Policy")?.value || "";
for (const directive of ["script-src 'self'", "style-src 'self'", "img-src 'self'", "connect-src 'self' https://sandfest-api.heyelab.com"]) {
  assert.ok(csp.includes(directive), `vercel.json CSP is missing "${directive}".`);
}
const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
assert.ok(meta.includes("script-src 'self'") && meta.includes("https://sandfest-api.heyelab.com"), "index.html lost its production CSP meta tag.");

console.log("Vercel visitor artifact verified: root-relative assets, existing files, AASA/rewrite contract, and CSP.");

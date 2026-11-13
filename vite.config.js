import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import { normalizeAppleApplicationIdentifierPrefix } from "./lib/public-deep-links.mjs";
import { READ_ONLY_LAUNCH_ENV, readOnlyLaunchSetting } from "./lib/read-only-launch-policy.mjs";

// Deploy base path.
// - Vercel (production, preview) and any custom domain serve from the domain root, so the
//   base is always "/". A stray DEPLOY_BASE in a Vercel project or shell must never move
//   the visitor assets under a subpath, or every script, stylesheet and image 404s.
// - GitHub Pages serves from /<repo>/, so the Pages workflow pins DEPLOY_BASE explicitly.
export function resolveDeployBase(env = process.env) {
  const requested = String(env.DEPLOY_BASE || "").trim();
  if (env.VERCEL) {
    if (requested && requested !== "/") {
      console.warn(`[sandfest] Ignoring DEPLOY_BASE=${requested}: Vercel builds are served from the domain root ("/").`);
    }
    return "/";
  }
  if (!requested) return "/";
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(requested)) {
    throw new Error(`DEPLOY_BASE must start and end with "/" (for example "/" or "/texas-sandfest/"); received "${requested}".`);
  }
  return requested;
}

const base = resolveDeployBase();
const sourcemap = process.env.SOURCE_MAPS === "true";
const buildTarget = process.env.SANDFEST_BUILD_TARGET || "all";
const outDir = process.env.SANDFEST_BUILD_OUT_DIR || "dist";

export const PUBLIC_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob: https://sandfest-api.heyelab.com",
  "font-src 'self'",
  "connect-src 'self' https://sandfest-api.heyelab.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests"
].join("; ");

const buildInputs = buildTarget === "public"
  ? { main: resolve(import.meta.dirname, "index.html") }
  : buildTarget === "admin"
    ? { admin: resolve(import.meta.dirname, "admin.html") }
    : {
        main: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin.html")
      };

function requiredHttpsUrl(value, key) {
  if (!value) throw new Error(`${key} is required for an OIDC admin build.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${key} must use HTTPS.`);
}

export function validateAdminBuildEnvironment(env, target = buildTarget) {
  if (target !== "admin") return;
  const production = env.SANDFEST_DEPLOYMENT_ENV === "production";
  const authMode = String(env.VITE_SANDFEST_AUTH_MODE || "token").trim().toLowerCase();
  if (production && authMode !== "oidc") {
    throw new Error("Production admin builds require VITE_SANDFEST_AUTH_MODE=oidc.");
  }
  if (authMode !== "oidc") return;
  if (!String(env.VITE_SANDFEST_AUTH_CLIENT_ID || "").trim()) {
    throw new Error("VITE_SANDFEST_AUTH_CLIENT_ID is required for an OIDC admin build.");
  }
  requiredHttpsUrl(env.VITE_SANDFEST_AUTH_ISSUER, "VITE_SANDFEST_AUTH_ISSUER");
  requiredHttpsUrl(env.VITE_SANDFEST_AUTH_REDIRECT_URI, "VITE_SANDFEST_AUTH_REDIRECT_URI");
  requiredHttpsUrl(env.VITE_SANDFEST_API_BASE_URL, "VITE_SANDFEST_API_BASE_URL");
  if (env.VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI) {
    requiredHttpsUrl(env.VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI, "VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI");
  }
}

const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF"
]);

export function validatePublicBuildEnvironment(env, target = buildTarget) {
  if (target !== "public" || env.SANDFEST_DEPLOYMENT_ENV !== "production") return;
  const siteKey = String(env.VITE_SANDFEST_TURNSTILE_SITE_KEY || "").trim();
  // A web-only preview may omit Turnstile, but the visitor bundle disables every
  // protected intake action in that state. The production release workflow still
  // requires the real site key before it can publish.
  if (siteKey) {
    if (siteKey.length < 20 || !/^[A-Za-z0-9_-]+$/.test(siteKey)) {
      throw new Error("VITE_SANDFEST_TURNSTILE_SITE_KEY is set but is not a valid Turnstile site key.");
    }
    if (TURNSTILE_TEST_SITE_KEYS.has(siteKey) && env.SANDFEST_BUILD_VERIFICATION !== "true") {
      throw new Error("Production public builds reject Cloudflare Turnstile test site keys.");
    }
  } else {
    console.warn(
      "[sandfest] VITE_SANDFEST_TURNSTILE_SITE_KEY not set - protected public intake will be disabled in this build."
    );
  }
  // The Apple application identifier prefix only powers iOS universal links,
  // which a web-only deploy does not use. Validate it when provided; otherwise
  // build without iOS deep-link support rather than failing the build.
  if (String(env.SANDFEST_APPLE_APP_ID_PREFIX || "").trim()) {
    normalizeAppleApplicationIdentifierPrefix(env.SANDFEST_APPLE_APP_ID_PREFIX);
  }
}

const READ_ONLY_BRIDGE_API_BASE = "https://sandfest-api.heyelab.com";

// Opt-in read-only public launch: the visitor bundle talks only to the read-only bridge, and
// every staff, payment, and intake request is refused client-side (see src/main.js and
// lib/read-only-launch-policy.mjs). Off unless SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE=read_only.
export function validateReadOnlyLaunchBuildEnvironment(env, target = buildTarget) {
  const setting = readOnlyLaunchSetting(env);
  if (setting.error) throw new Error(setting.error);
  if (!setting.enabled) return false;
  if (target !== "public") {
    throw new Error(`${READ_ONLY_LAUNCH_ENV}=read_only only applies to the isolated public build (SANDFEST_BUILD_TARGET=public).`);
  }
  if (String(env.VITE_SANDFEST_OPS_DEMO || "").toLowerCase() === "true") {
    throw new Error(`${READ_ONLY_LAUNCH_ENV}=read_only cannot be combined with VITE_SANDFEST_OPS_DEMO=true.`);
  }
  const apiBase = String(env.VITE_SANDFEST_API_BASE_URL || "").replace(/\/+$/, "");
  if (apiBase && apiBase !== READ_ONLY_BRIDGE_API_BASE) {
    throw new Error(`${READ_ONLY_LAUNCH_ENV}=read_only requires the public API base to be ${READ_ONLY_BRIDGE_API_BASE}; received ${apiBase}.`);
  }
  return true;
}

function readOnlyLaunchMarkerPlugin(enabled) {
  if (!enabled) return null;
  return {
    name: "sandfest-read-only-launch-marker",
    transformIndexHtml(html) {
      const marker = '<meta name="sandfest-surface" content="public" />';
      if (!html.includes(marker)) {
        throw new Error("Read-only launch build is missing the surface marker required for the launch-mode marker.");
      }
      console.warn(`[sandfest] READ-ONLY LAUNCH BUILD (${READ_ONLY_LAUNCH_ENV}=read_only): checkout, intake, staff and admin requests are disabled in this bundle.`);
      return html.replace(marker, `${marker}\n    <meta name="sandfest-launch-mode" content="read_only" />`);
    }
  };
}

function publicProductionSecurityPlugin(env, target = buildTarget) {
  if (target !== "public" || env.SANDFEST_DEPLOYMENT_ENV !== "production") return null;
  return {
    name: "sandfest-public-production-security",
    apply: "build",
    transformIndexHtml(html) {
      const marker = '<meta name="sandfest-surface" content="public" />';
      if (!html.includes(marker)) {
        throw new Error("Public production build is missing the surface marker required for CSP injection.");
      }
      return html.replace(marker, `${marker}\n    <meta http-equiv="Content-Security-Policy" content="${PUBLIC_CONTENT_SECURITY_POLICY}" />\n    <meta name="referrer" content="no-referrer" />`);
    }
  };
}

function adminCssPrunePlugin(target = buildTarget) {
  if (target !== "admin") return null;
  return {
    postcssPlugin: "sandfest-admin-css-prune",
    Once(root) {
      let pruning = false;
      root.each(node => {
        if (node.type === "comment" && node.text.trim().startsWith("admin-prune:start ")) {
          pruning = true;
          node.remove();
          return;
        }
        if (node.type === "comment" && node.text.trim().startsWith("admin-prune:end ")) {
          pruning = false;
          node.remove();
          return;
        }
        if (pruning) node.remove();
      });
    }
  };
}

const BOARD_DEMO_WEB_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function boardDemoAccessPlugin(env) {
  const token = String(env.SANDFEST_BOARD_DEMO_ADMIN_TOKEN || "").trim();
  if (!token) return null;
  if (token.length < 24) throw new Error("SANDFEST_BOARD_DEMO_ADMIN_TOKEN must be at least 24 characters.");
  const generation = String(env.SANDFEST_BOARD_DEMO_GENERATION || "").trim();
  if (generation && (!Number.isFinite(Date.parse(generation)) || generation.length > 64)) {
    throw new Error("SANDFEST_BOARD_DEMO_GENERATION must be a valid timestamp.");
  }
  return {
    name: "sandfest-board-demo-access",
    apply: "serve",
    configureServer(server) {
      const host = String(server.config.server.host || "");
      if (!BOARD_DEMO_WEB_HOSTS.has(host)) {
        throw new Error("Board demo access requires the Vite server to bind an exact loopback host.");
      }
    },
    transformIndexHtml() {
      const serializedToken = JSON.stringify(token)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
      const serializedGeneration = JSON.stringify(generation)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
      return [{
        tag: "script",
        children: `globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__ = ${serializedToken};globalThis.__SANDFEST_BOARD_DEMO_GENERATION__ = ${serializedGeneration};`,
        injectTo: "head-prepend"
      }];
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  validateAdminBuildEnvironment(env);
  validatePublicBuildEnvironment(env);
  const readOnlyLaunch = validateReadOnlyLaunchBuildEnvironment(env);
  return {
    base,
    define: {
      "import.meta.env.VITE_SANDFEST_READ_ONLY": JSON.stringify(readOnlyLaunch ? "true" : "false")
    },
    plugins: [publicProductionSecurityPlugin(env), readOnlyLaunchMarkerPlugin(readOnlyLaunch), boardDemoAccessPlugin(env)].filter(Boolean),
    css: {
      postcss: {
        plugins: [adminCssPrunePlugin()].filter(Boolean)
      }
    },
    publicDir: buildTarget === "admin" ? false : "public",
    server: {
      host: "127.0.0.1",
      port: 5173
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap,
      rollupOptions: {
        input: buildInputs,
        output: buildTarget === "admin" ? {
          manualChunks: {
            "admin-runtime": [
              resolve(import.meta.dirname, "src/main.js"),
              resolve(import.meta.dirname, "src/admin-auth.js"),
              resolve(import.meta.dirname, "src/admin-operations-ui.js")
            ],
            "admin-budget": [
              resolve(import.meta.dirname, "src/admin-budget.js")
            ],
            "admin-incident-delivery-reconciliation": [
              resolve(import.meta.dirname, "src/admin-incident-delivery-reconciliation.js")
            ]
          }
        } : undefined
      }
    }
  };
});

import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import { normalizeAppleApplicationIdentifierPrefix } from "./lib/public-deep-links.mjs";

// On GitHub Pages we live at /<repo>/; custom domains use root-relative paths.
// we live at the root. The DEPLOY_BASE env var lets the workflow pin this.
const base = process.env.DEPLOY_BASE || "/";
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
      return [{
        tag: "script",
        children: `globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__ = ${serializedToken};`,
        injectTo: "head-prepend"
      }];
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  validateAdminBuildEnvironment(env);
  validatePublicBuildEnvironment(env);
  return {
    base,
    plugins: [publicProductionSecurityPlugin(env), boardDemoAccessPlugin(env)].filter(Boolean),
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

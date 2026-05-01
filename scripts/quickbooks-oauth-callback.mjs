#!/usr/bin/env node
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDotEnv } from "../lib/load-env.mjs";
import { exchangeCodeForTokens, quickBooksConfig } from "../lib/quickbooks/client.mjs";

await loadDotEnv();

const config = quickBooksConfig();
const callbackUrl = new URL(config.redirectUri);
const host = callbackUrl.hostname || "127.0.0.1";
const port = Number(callbackUrl.port || 8787);
const expectedPath = callbackUrl.pathname;

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname !== expectedPath) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }

    const error = requestUrl.searchParams.get("error");
    if (error) {
      respond(res, 400, `QuickBooks authorization failed: ${error}`);
      return;
    }

    const code = requestUrl.searchParams.get("code");
    const realmId = requestUrl.searchParams.get("realmId");
    const state = requestUrl.searchParams.get("state");

    if (!code || !realmId) {
      respond(res, 400, "Missing code or realmId from QuickBooks callback.");
      return;
    }

    if (process.env.QB_OAUTH_STATE && state !== process.env.QB_OAUTH_STATE) {
      respond(res, 400, "State mismatch. Refusing to exchange token.");
      return;
    }

    const token = await exchangeCodeForTokens({ code, realmId });
    const payload = {
      capturedAt: new Date().toISOString(),
      environment: config.environment,
      realmId,
      token
    };

    if (process.env.QB_WRITE_TOKEN_FILE === "true") {
      const outDir = path.resolve("data", "incoming", "quickbooks");
      await mkdir(outDir, { recursive: true });
      const outFile = path.join(outDir, `quickbooks-token-${Date.now()}.json`);
      await writeFile(outFile, JSON.stringify(payload, null, 2) + "\n");
      respond(res, 200, `QuickBooks connected. Token file written locally to ${outFile}. Keep it private.`);
    } else {
      console.log(JSON.stringify(payload, null, 2));
      respond(res, 200, "QuickBooks connected. Token payload printed in the terminal. Set QB_WRITE_TOKEN_FILE=true to write it locally next time.");
    }

    server.close();
  } catch (error) {
    respond(res, 500, error.message);
  }
});

server.listen(port, host, () => {
  console.log(`QuickBooks OAuth callback listening at ${config.redirectUri}`);
  console.log("Run `npm run qb:auth-url`, open the URL, approve access, then return here.");
});

function respond(res, status, message) {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body><h1>${escapeHtml(message)}</h1><p>You can close this tab.</p></body></html>`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

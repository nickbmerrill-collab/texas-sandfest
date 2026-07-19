import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import twilio from "twilio";
import { normalizePhone, smsPreferenceAction } from "./consent.mjs";

const BODY_LIMIT_BYTES = 64 * 1024;
const MESSAGE_PATH = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/;

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function loopbackUrl(value, label) {
  try {
    const url = new URL(clean(value));
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      throw new Error("not loopback");
    }
    return url.toString();
  } catch {
    throw new Error(`${label} must be a loopback HTTP(S) URL.`);
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

async function readFormBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new Error("Sandbox SMS payload exceeds 64 KB.");
    chunks.push(Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function basicCredentials(header) {
  const value = clean(header, 2000);
  if (!value.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function providerAuthorized(request, config) {
  const credentials = basicCredentials(request.headers.authorization);
  return Boolean(credentials
    && safeEqual(credentials.username, config.accountSid)
    && safeEqual(credentials.password, config.authToken));
}

function deterministicSid(parts) {
  const digest = createHash("sha256").update(parts.join("\n")).digest("hex");
  return `SM${digest.slice(0, 32)}`;
}

async function postSignedForm(url, params, config, state, counter) {
  let lastError = null;
  for (let attempt = 1; attempt <= 6 && !state.stopping; attempt += 1) {
    try {
      const signature = twilio.getExpectedTwilioSignature(config.authToken, url, params);
      const response = await config.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": signature
        },
        body: new URLSearchParams(params)
      });
      if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
      state[counter] += 1;
      state.lastCallbackAt = new Date().toISOString();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 50 * 2 ** (attempt - 1)));
    }
  }
  if (!state.stopping) {
    state.callbackFailures += 1;
    state.lastError = clean(lastError?.message || lastError, 500);
  }
  return false;
}

async function deliverStatus(message, config, state) {
  await new Promise(resolve => setTimeout(resolve, config.deliveryDelayMs));
  const deliveredAt = new Date().toISOString();
  const delivered = await postSignedForm(message.statusCallbackUrl, {
    AccountSid: config.accountSid,
    MessageSid: message.sid,
    MessageStatus: "delivered",
    To: message.to,
    From: config.fromNumber,
    ApiVersion: "2010-04-01"
  }, config, state, "deliveryCallbacks");
  if (delivered) state.lastDeliveryAt = deliveredAt;
}

export function boardSmsSandboxRecipientAllowed(value) {
  const phone = normalizePhone(value);
  return /^\+1[2-9]\d{2}55501\d{2}$/.test(phone || "");
}

export function boardSmsSandboxConfig(env = process.env, options = {}) {
  const enabled = env.SANDFEST_BOARD_SMS_SANDBOX === "true";
  const production = env.SANDFEST_ENV === "production" || env.NODE_ENV === "production";
  const accountSid = clean(env.BOARD_TWILIO_ACCOUNT_SID || env.TWILIO_ACCOUNT_SID, 100);
  const authToken = clean(env.BOARD_TWILIO_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN, 500);
  const fromNumber = normalizePhone(env.BOARD_TWILIO_FROM_NUMBER || env.TWILIO_FROM_NUMBER);
  const port = Math.max(1, Math.min(65_535, Number(env.SANDFEST_BOARD_SMS_PORT || 8808)));
  const deliveryDelayMs = Math.max(10, Math.min(10_000, Number(env.SANDFEST_BOARD_SMS_DELIVERY_DELAY_MS || 750)));
  const missing = [];
  if (!enabled) missing.push("SANDFEST_BOARD_SMS_SANDBOX=true");
  if (production) missing.push("non-production environment");
  if (!/^AC[A-Za-z0-9]{32}$/.test(accountSid)) missing.push("BOARD_TWILIO_ACCOUNT_SID(valid synthetic SID)");
  if (authToken.length < 32) missing.push("BOARD_TWILIO_AUTH_TOKEN(32+ characters)");
  if (!boardSmsSandboxRecipientAllowed(fromNumber)) missing.push("BOARD_TWILIO_FROM_NUMBER(reserved 555-01xx number)");
  let inboundWebhookUrl = null;
  try {
    inboundWebhookUrl = loopbackUrl(
      env.SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL || "http://127.0.0.1:8806/api/webhooks/twilio/inbound/smsSafety",
      "Board SMS inbound webhook URL"
    );
  } catch (error) {
    missing.push(error.message);
  }
  return {
    enabled,
    production,
    ready: missing.length === 0,
    reason: missing.length ? `Missing ${missing.join(", ")}` : null,
    host: "127.0.0.1",
    port,
    deliveryDelayMs,
    accountSid,
    authToken,
    fromNumber,
    inboundWebhookUrl,
    fetchImpl: options.fetchImpl ?? fetch
  };
}

export async function startBoardSmsSandbox(options = {}) {
  const config = options.config ?? boardSmsSandboxConfig(options.env, { fetchImpl: options.fetchImpl });
  if (!config.ready) throw new Error(config.reason || "Board SMS sandbox is not ready.");
  const messageIds = new Set();
  const preferenceIds = new Set();
  const state = {
    stopping: false,
    deliveryCallbacks: 0,
    preferenceCallbacks: 0,
    callbackFailures: 0,
    lastAcceptedAt: null,
    lastDeliveryAt: null,
    lastCallbackAt: null,
    lastError: null
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${config.host}:${config.port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "sandfest-board-sms-sandbox",
        mode: "board_demo",
        recipientPolicy: "reserved-555-01xx-only",
        acceptedMessages: messageIds.size,
        simulatedPreferences: preferenceIds.size,
        deliveryCallbacks: state.deliveryCallbacks,
        preferenceCallbacks: state.preferenceCallbacks,
        callbackFailures: state.callbackFailures,
        lastAcceptedAt: state.lastAcceptedAt,
        lastDeliveryAt: state.lastDeliveryAt,
        lastCallbackAt: state.lastCallbackAt,
        lastError: state.lastError
      });
      return;
    }

    const messageMatch = url.pathname.match(MESSAGE_PATH);
    const inboundSimulation = request.method === "POST" && url.pathname === "/simulate/inbound";
    if (request.method !== "POST" || (!messageMatch && !inboundSimulation)) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (!providerAuthorized(request, config)) {
      sendJson(response, 401, { error: "Sandbox provider authentication failed." });
      return;
    }

    try {
      const form = await readFormBody(request);
      if (inboundSimulation) {
        const from = normalizePhone(form.get("From"));
        const body = clean(form.get("Body"), 1600);
        const simulationId = clean(form.get("SimulationId"), 100);
        const action = smsPreferenceAction(form.get("OptOutType"), body);
        if (!boardSmsSandboxRecipientAllowed(from) || !action) {
          sendJson(response, 422, { error: "Inbound simulation requires a reserved sender and STOP, START, or HELP." });
          return;
        }
        const sid = deterministicSid([from, body, action, config.inboundWebhookUrl, simulationId]);
        const firstAcceptance = !preferenceIds.has(sid);
        preferenceIds.add(sid);
        const params = {
          AccountSid: config.accountSid,
          MessageSid: sid,
          From: from,
          To: config.fromNumber,
          Body: body,
          OptOutType: action,
          NumMedia: "0"
        };
        const delivered = firstAcceptance
          ? await postSignedForm(config.inboundWebhookUrl, params, config, state, "preferenceCallbacks")
          : true;
        sendJson(response, delivered ? (firstAcceptance ? 201 : 200) : 502, {
          sid,
          status: delivered ? "accepted" : "failed",
          action
        });
        return;
      }

      if (!safeEqual(messageMatch[1], config.accountSid)) {
        sendJson(response, 404, { error: "Sandbox account was not found." });
        return;
      }
      const to = normalizePhone(form.get("To"));
      const from = normalizePhone(form.get("From"));
      const body = clean(form.get("Body"), 1600);
      let statusCallbackUrl = null;
      try {
        statusCallbackUrl = loopbackUrl(form.get("StatusCallback"), "StatusCallback");
      } catch (error) {
        sendJson(response, 422, { error: error.message });
        return;
      }
      if (!boardSmsSandboxRecipientAllowed(to) || from !== config.fromNumber || !body) {
        sendJson(response, 422, { error: "Board SMS sandbox accepts one reserved 555-01xx destination from its configured reserved sender." });
        return;
      }
      const sid = deterministicSid([to, from, body, statusCallbackUrl]);
      const firstAcceptance = !messageIds.has(sid);
      messageIds.add(sid);
      state.lastAcceptedAt = new Date().toISOString();
      sendJson(response, firstAcceptance ? 201 : 200, { sid, status: "queued" });
      if (firstAcceptance) void deliverStatus({ sid, to, statusCallbackUrl }, config, state);
    } catch (error) {
      sendJson(response, error.message.includes("64 KB") ? 413 : 400, { error: clean(error.message, 500) });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const address = server.address();
  return {
    config,
    state,
    server,
    url: `http://${config.host}:${address.port}`,
    close: async () => {
      state.stopping = true;
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

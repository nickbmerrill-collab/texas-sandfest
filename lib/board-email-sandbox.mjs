import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const BODY_LIMIT_BYTES = 512 * 1024;

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 254).toLowerCase());
}

function safeEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function loopbackUrl(value, label) {
  try {
    const url = new URL(clean(value, 2000));
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

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) throw new Error("Sandbox email payload exceeds 512 KB.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Sandbox email payload must be valid JSON.");
  }
}

function messageInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "Email payload must be an object." };
  if ((Array.isArray(payload.attachment) && payload.attachment.length) || (Array.isArray(payload.attachments) && payload.attachments.length)) {
    return { ok: false, error: "Board email sandbox does not accept attachments." };
  }
  const sender = clean(payload.sender?.email, 254).toLowerCase();
  const recipients = Array.isArray(payload.to) ? payload.to : [];
  const recipient = clean(recipients[0]?.email, 254).toLowerCase();
  const subject = clean(payload.subject, 998);
  const textContent = clean(payload.textContent, 100_000);
  const idempotencyKey = clean(payload.headers?.["Idempotency-Key"], 100);
  if (!validEmail(sender)) return { ok: false, error: "Sandbox sender is invalid." };
  if (recipients.length !== 1 || !boardEmailSandboxRecipientAllowed(recipient)) {
    return { ok: false, error: "Board email sandbox accepts exactly one reserved example-domain recipient." };
  }
  if (!subject) return { ok: false, error: "Sandbox email subject is required." };
  if (!textContent) return { ok: false, error: "Sandbox email text body is required." };
  if (idempotencyKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return { ok: false, error: "Sandbox email idempotency key is invalid." };
  }
  return { ok: true, sender, recipient, subject, textContent, idempotencyKey: idempotencyKey || null };
}

async function deliverWebhook(message, config, state) {
  await new Promise(resolve => setTimeout(resolve, config.deliveryDelayMs));
  const event = {
    event: "delivered",
    email: message.recipient,
    id: `board_${message.digest}`,
    date: new Date().toISOString(),
    "message-id": message.messageId,
    subject: message.subject
  };
  let lastError = null;
  for (let attempt = 1; attempt <= 6 && !state.stopping; attempt += 1) {
    try {
      const response = await config.fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.webhookToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(event)
      });
      if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
      state.deliveryCallbacks += 1;
      state.lastDeliveryAt = event.date;
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 50 * 2 ** (attempt - 1)));
    }
  }
  if (!state.stopping) {
    state.callbackFailures += 1;
    state.lastError = clean(lastError?.message || lastError, 500);
  }
}

export function boardEmailSandboxRecipientAllowed(value) {
  const email = clean(value, 254).toLowerCase();
  if (!validEmail(email)) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return domain === "example.com" || domain.endsWith(".example");
}

export function boardEmailSandboxConfig(env = process.env, options = {}) {
  const enabled = env.SANDFEST_BOARD_EMAIL_SANDBOX === "true";
  const production = env.SANDFEST_ENV === "production" || env.NODE_ENV === "production";
  const apiKey = clean(env.BOARD_BREVO_API_KEY || env.BREVO_API_KEY, 500);
  const webhookToken = clean(env.BREVO_WEBHOOK_TOKEN, 500);
  const port = Math.max(1, Math.min(65_535, Number(env.SANDFEST_BOARD_EMAIL_PORT || 8807)));
  const deliveryDelayMs = Math.max(10, Math.min(10_000, Number(env.SANDFEST_BOARD_EMAIL_DELIVERY_DELAY_MS || 750)));
  const missing = [];
  if (!enabled) missing.push("SANDFEST_BOARD_EMAIL_SANDBOX=true");
  if (production) missing.push("non-production environment");
  if (apiKey.length < 32) missing.push("BOARD_BREVO_API_KEY(32+ characters)");
  if (webhookToken.length < 32) missing.push("BREVO_WEBHOOK_TOKEN(32+ characters)");
  let webhookUrl = null;
  try {
    webhookUrl = loopbackUrl(env.SANDFEST_BOARD_EMAIL_WEBHOOK_URL || "http://127.0.0.1:8806/api/webhooks/brevo", "Board email webhook URL");
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
    apiKey,
    webhookToken,
    webhookUrl,
    fetchImpl: options.fetchImpl ?? fetch
  };
}

export async function startBoardEmailSandbox(options = {}) {
  const config = options.config ?? boardEmailSandboxConfig(options.env, { fetchImpl: options.fetchImpl });
  if (!config.ready) throw new Error(config.reason || "Board email sandbox is not ready.");
  const messageIds = new Set();
  const state = {
    stopping: false,
    deliveryCallbacks: 0,
    callbackFailures: 0,
    lastAcceptedAt: null,
    lastDeliveryAt: null,
    lastError: null
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${config.host}:${config.port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "sandfest-board-email-sandbox",
        mode: "board_demo",
        recipientPolicy: "reserved-example-domains-only",
        acceptedMessages: messageIds.size,
        deliveryCallbacks: state.deliveryCallbacks,
        callbackFailures: state.callbackFailures,
        lastAcceptedAt: state.lastAcceptedAt,
        lastDeliveryAt: state.lastDeliveryAt,
        lastError: state.lastError
      });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v3/smtp/email") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (!safeEqual(request.headers["api-key"] || "", config.apiKey)) {
      sendJson(response, 401, { error: "Sandbox provider authentication failed." });
      return;
    }
    try {
      const parsed = messageInput(await readJsonBody(request));
      if (!parsed.ok) {
        sendJson(response, 422, { error: parsed.error });
        return;
      }
      const identity = parsed.idempotencyKey
        ? `idempotency:${parsed.idempotencyKey}`
        : [parsed.recipient, parsed.subject, parsed.textContent].join("\n");
      const digest = createHash("sha256").update(identity).digest("hex");
      const message = { ...parsed, digest, messageId: `board-mail-${digest.slice(0, 32)}` };
      const firstAcceptance = !messageIds.has(message.messageId);
      messageIds.add(message.messageId);
      state.lastAcceptedAt = new Date().toISOString();
      sendJson(response, firstAcceptance ? 201 : 200, { messageId: message.messageId });
      if (firstAcceptance) void deliverWebhook(message, config, state);
    } catch (error) {
      sendJson(response, error.message.includes("512 KB") ? 413 : 400, { error: clean(error.message, 500) });
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

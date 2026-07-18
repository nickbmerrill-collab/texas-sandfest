import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  readPlatformDoc,
  updatePlatformDoc
} from "../platform-data.mjs";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  quickBooksConfig,
  quickBooksReadiness
} from "./client.mjs";

const DOCUMENT_VERSION = 1;
const ENCRYPTION_VERSION = 1;
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_ATTEMPTS = 10;
const PROVIDER = "quickbooks";

function iso(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function nowIso(value = Date.now()) {
  return new Date(value).toISOString();
}

function environmentName(env = process.env) {
  return quickBooksConfig(env).environment;
}

function stateHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function safeHashMatch(left, right) {
  const first = Buffer.from(String(left || ""), "hex");
  const second = Buffer.from(String(right || ""), "hex");
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second);
}

function encryptionConfig(env = process.env) {
  const secret = String(env.QB_TOKEN_ENCRYPTION_KEY || "");
  const production = env.SANDFEST_ENV === "production";
  const durableStorage = Boolean(env.SANDFEST_DATABASE_URL);
  const failures = [];
  if (secret.length < 32) failures.push("QB_TOKEN_ENCRYPTION_KEY must contain at least 32 characters");
  if (production && !durableStorage) failures.push("production QuickBooks credentials require Postgres storage");
  const key = secret.length >= 32 ? createHash("sha256").update(secret).digest() : null;
  return {
    ready: failures.length === 0,
    reason: failures.length ? `QuickBooks credential storage is not ready: ${failures.join("; ")}.` : null,
    key,
    keyId: key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : null,
    storage: durableStorage ? "postgres" : "atomic-file"
  };
}

function oauthConfigReadiness(env = process.env) {
  const config = quickBooksConfig(env);
  const encryption = encryptionConfig(env);
  const failures = [];
  for (const field of ["clientId", "clientSecret", "redirectUri"]) {
    if (!config[field]) failures.push(field);
  }
  let redirect = null;
  try {
    redirect = new URL(config.redirectUri);
  } catch {
    failures.push("valid redirectUri");
  }
  if (redirect && !redirect.pathname.endsWith("/api/integrations/quickbooks/callback")) {
    failures.push("QuickBooks callback redirectUri");
  }
  if (env.SANDFEST_ENV === "production") {
    if (redirect?.protocol !== "https:") failures.push("HTTPS redirectUri");
    try {
      const publicApi = new URL(env.SANDFEST_API_PUBLIC_BASE_URL || "");
      const expectedPath = `${publicApi.pathname.replace(/\/+$/, "")}/api/integrations/quickbooks/callback`;
      if (redirect?.origin !== publicApi.origin || redirect?.pathname !== expectedPath) failures.push("public API callback origin");
    } catch {
      failures.push("SANDFEST_API_PUBLIC_BASE_URL");
    }
    if (config.authBaseUrl !== "https://appcenter.intuit.com/connect/oauth2") failures.push("official authorization endpoint");
    if (config.tokenUrl !== "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer") failures.push("official token endpoint");
    const expectedApi = config.environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
    if (config.apiBaseUrl !== expectedApi) failures.push("official accounting API endpoint");
  }
  if (!encryption.ready) failures.push(encryption.reason);
  return {
    ready: failures.length === 0,
    reason: failures.length ? `QuickBooks OAuth is not ready: ${failures.join(", ")}.` : null,
    environment: config.environment,
    storage: encryption.storage,
    redirectUriReady: Boolean(redirect),
    encryptionReady: encryption.ready
  };
}

export function emptyQuickBooksCredentialStore(env = process.env) {
  return {
    schemaVersion: DOCUMENT_VERSION,
    provider: PROVIDER,
    environment: environmentName(env),
    connection: null,
    pendingAttempts: [],
    lastUpdated: null
  };
}

export function normalizeQuickBooksCredentialStore(input, env = process.env) {
  const fallback = emptyQuickBooksCredentialStore(env);
  const doc = input && typeof input === "object" && !Array.isArray(input) ? input : fallback;
  return {
    schemaVersion: DOCUMENT_VERSION,
    provider: PROVIDER,
    environment: environmentName(env),
    connection: doc.connection && typeof doc.connection === "object" ? doc.connection : null,
    pendingAttempts: Array.isArray(doc.pendingAttempts) ? doc.pendingAttempts.slice(-MAX_PENDING_ATTEMPTS) : [],
    lastUpdated: iso(doc.lastUpdated)
  };
}

function encryptionAad(environment, realmId) {
  return Buffer.from(`sandfest:${PROVIDER}:refresh-token:v${ENCRYPTION_VERSION}:${environment}:${realmId}`, "utf8");
}

export function encryptQuickBooksRefreshToken(refreshToken, { environment, realmId }, env = process.env) {
  const config = encryptionConfig(env);
  if (!config.ready || !config.key) throw new Error(config.reason || "QuickBooks credential encryption is unavailable.");
  const token = String(refreshToken || "");
  if (!token) throw new Error("QuickBooks refresh token is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(encryptionAad(environment, realmId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    version: ENCRYPTION_VERSION,
    algorithm: "aes-256-gcm",
    keyId: config.keyId,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

export function decryptQuickBooksRefreshToken(connection, env = process.env) {
  const encrypted = connection?.encryptedRefreshToken;
  const config = encryptionConfig(env);
  if (!config.ready || !config.key) throw new Error(config.reason || "QuickBooks credential decryption is unavailable.");
  if (!encrypted || encrypted.version !== ENCRYPTION_VERSION || encrypted.algorithm !== "aes-256-gcm") {
    throw new Error("Stored QuickBooks credential format is unsupported.");
  }
  if (encrypted.keyId !== config.keyId) throw new Error("Stored QuickBooks credentials use a different encryption key.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", config.key, Buffer.from(encrypted.iv, "base64url"));
    decipher.setAAD(encryptionAad(connection.environment, connection.realmId));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Stored QuickBooks credentials could not be decrypted.");
  }
}

function connectionMetadata(doc, env = process.env, { verify = true } = {}) {
  const connection = doc.connection;
  const oauth = oauthConfigReadiness(env);
  if (!connection) {
    return {
      connected: false,
      credentialSource: null,
      connectedAt: null,
      lastRefreshedAt: null,
      refreshTokenExpiresAt: null,
      tokenVersion: 0,
      realmIdPresent: false,
      storedCredentialReady: false,
      storedCredentialReason: "QuickBooks has not been connected."
    };
  }
  let reason = null;
  if (connection.environment !== environmentName(env)) reason = "Stored QuickBooks credentials belong to a different environment.";
  if (!reason && !connection.connectionId) reason = "Stored QuickBooks credentials are missing the connection identity.";
  if (!reason && !connection.realmId) reason = "Stored QuickBooks credentials are missing the company realm.";
  if (!reason && !connection.encryptedRefreshToken) reason = "Stored QuickBooks credentials are missing the encrypted refresh token.";
  const refreshTokenExpiresAt = iso(connection.refreshTokenExpiresAt);
  if (!reason && refreshTokenExpiresAt && Date.parse(refreshTokenExpiresAt) <= Date.now()) {
    reason = "Stored QuickBooks credentials have expired.";
  }
  if (!reason && verify) {
    try {
      if (!decryptQuickBooksRefreshToken(connection, env)) reason = "Stored QuickBooks refresh token is empty.";
    } catch (error) {
      reason = error.message;
    }
  }
  return {
    connected: !reason,
    credentialSource: "encrypted_store",
    connectedAt: iso(connection.connectedAt),
    lastRefreshedAt: iso(connection.lastRefreshedAt),
    refreshTokenExpiresAt,
    tokenVersion: Number(connection.tokenVersion || 0),
    realmIdPresent: Boolean(connection.realmId),
    storedCredentialReady: !reason && oauth.encryptionReady,
    storedCredentialReason: reason
  };
}

export async function readQuickBooksCredentialStatus(root, env = process.env) {
  const doc = normalizeQuickBooksCredentialStore(
    await readPlatformDoc(root, "quickBooksCredentials", emptyQuickBooksCredentialStore(env)),
    env
  );
  const connection = connectionMetadata(doc, env);
  const oauth = oauthConfigReadiness(env);
  const readiness = quickBooksReadiness(env, { connection });
  const canSyncPartnerInvoices = readiness.canSyncPartnerInvoices && oauth.ready;
  return {
    ...readiness,
    canSyncPartnerInvoices,
    reason: canSyncPartnerInvoices ? null : readiness.canSyncPartnerInvoices ? oauth.reason : readiness.reason,
    oauthReady: oauth.ready,
    oauthReason: oauth.reason,
    credentialStorage: oauth.storage,
    connected: connection.connected,
    connectedAt: connection.connectedAt,
    lastRefreshedAt: connection.lastRefreshedAt,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
    tokenVersion: connection.tokenVersion,
    credentialSource: connection.connected ? "encrypted_store" : readiness.credentialSource
  };
}

export async function beginQuickBooksAuthorization(root, { actorId, now = Date.now() } = {}, env = process.env) {
  const oauth = oauthConfigReadiness(env);
  if (!oauth.ready) return { ok: false, error: oauth.reason, quickbooks: await readQuickBooksCredentialStatus(root, env) };
  const state = randomBytes(32).toString("base64url");
  const createdAt = nowIso(now);
  const expiresAt = nowIso(now + OAUTH_ATTEMPT_TTL_MS);
  await updatePlatformDoc(root, "quickBooksCredentials", current => {
    const doc = normalizeQuickBooksCredentialStore(current, env);
    const pendingAttempts = doc.pendingAttempts
      .filter(item => Date.parse(item.expiresAt || "") > now)
      .slice(-(MAX_PENDING_ATTEMPTS - 1));
    pendingAttempts.push({
      stateHash: stateHash(state),
      actorId: String(actorId || "finance-admin").slice(0, 160),
      createdAt,
      expiresAt
    });
    return { ...doc, pendingAttempts, lastUpdated: createdAt };
  }, { fallback: emptyQuickBooksCredentialStore(env) });
  return {
    ok: true,
    authorizationUrl: buildAuthorizationUrl({ state }, env),
    expiresAt,
    quickbooks: await readQuickBooksCredentialStatus(root, env)
  };
}

async function consumeAuthorizationAttempt(root, state, now, env) {
  const requestedHash = stateHash(state);
  let consumed = null;
  await updatePlatformDoc(root, "quickBooksCredentials", current => {
    const doc = normalizeQuickBooksCredentialStore(current, env);
    const pendingAttempts = [];
    for (const item of doc.pendingAttempts) {
      const expired = Date.parse(item.expiresAt || "") <= now;
      if (!consumed && !expired && safeHashMatch(item.stateHash, requestedHash)) {
        consumed = item;
        continue;
      }
      if (!expired) pendingAttempts.push(item);
    }
    return { ...doc, pendingAttempts, lastUpdated: nowIso(now) };
  }, { fallback: emptyQuickBooksCredentialStore(env) });
  return consumed;
}

export async function cancelQuickBooksAuthorization(root, { state, now = Date.now() } = {}, env = process.env) {
  if (!state) return { changed: false, quickbooks: await readQuickBooksCredentialStatus(root, env) };
  const attempt = await consumeAuthorizationAttempt(root, state, now, env);
  return { changed: Boolean(attempt), quickbooks: await readQuickBooksCredentialStatus(root, env) };
}

function tokenExpiry(now, seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? nowIso(now + Math.round(value * 1000)) : null;
}

export async function completeQuickBooksAuthorization(root, { state, code, realmId, now = Date.now(), fetchImpl } = {}, env = process.env) {
  if (!state || !code || !realmId) return { ok: false, error: "QuickBooks authorization response is incomplete." };
  const normalizedRealmId = String(realmId).trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(normalizedRealmId)) return { ok: false, error: "QuickBooks authorization company realm is invalid." };
  const attempt = await consumeAuthorizationAttempt(root, state, now, env);
  if (!attempt) return { ok: false, error: "QuickBooks authorization request is invalid, expired, or already used." };
  const token = await exchangeCodeForTokens({ code, realmId: normalizedRealmId }, env, { fetchImpl });
  if (!token.refresh_token) throw new Error("QuickBooks authorization did not return a refresh token.");
  const environment = environmentName(env);
  const connectedAt = nowIso(now);
  await updatePlatformDoc(root, "quickBooksCredentials", current => {
    const doc = normalizeQuickBooksCredentialStore(current, env);
    const tokenVersion = Number(doc.connection?.tokenVersion || 0) + 1;
    return {
      ...doc,
      environment,
      connection: {
        connectionId: randomBytes(16).toString("base64url"),
        environment,
        realmId: normalizedRealmId,
        encryptedRefreshToken: encryptQuickBooksRefreshToken(token.refresh_token, { environment, realmId: normalizedRealmId }, env),
        tokenVersion,
        connectedAt,
        connectedBy: String(attempt.actorId || "finance-admin").slice(0, 160),
        lastRefreshedAt: connectedAt,
        refreshTokenExpiresAt: tokenExpiry(now, token.x_refresh_token_expires_in)
      },
      lastUpdated: connectedAt
    };
  }, { fallback: emptyQuickBooksCredentialStore(env) });
  return { ok: true, quickbooks: await readQuickBooksCredentialStatus(root, env) };
}

export async function loadQuickBooksRuntimeCredentials(root, env = process.env) {
  const doc = normalizeQuickBooksCredentialStore(
    await readPlatformDoc(root, "quickBooksCredentials", emptyQuickBooksCredentialStore(env)),
    env
  );
  const metadata = connectionMetadata(doc, env);
  const oauth = oauthConfigReadiness(env);
  if (env.SANDFEST_ENV === "production" && !oauth.ready) throw new Error(oauth.reason || "QuickBooks OAuth policy is not ready.");
  if (metadata.connected) {
    const refreshToken = decryptQuickBooksRefreshToken(doc.connection, env);
    return {
      source: "encrypted_store",
      connectionId: doc.connection.connectionId,
      tokenVersion: Number(doc.connection.tokenVersion || 0),
      env: {
        ...env,
        QB_REALM_ID: doc.connection.realmId,
        QB_REFRESH_TOKEN: refreshToken
      }
    };
  }
  const readiness = quickBooksReadiness(env);
  if (!readiness.canRefreshToken) throw new Error(metadata.storedCredentialReason || readiness.reason || "QuickBooks credentials are unavailable.");
  return { source: "environment", tokenVersion: null, env };
}

export async function persistQuickBooksTokenRotation(root, runtime, token, { now = Date.now() } = {}, env = process.env) {
  if (runtime?.source !== "encrypted_store" || !token?.refresh_token) return { changed: false };
  let changed = false;
  await updatePlatformDoc(root, "quickBooksCredentials", current => {
    const doc = normalizeQuickBooksCredentialStore(current, env);
    const connection = doc.connection;
    if (!connection || !runtime.connectionId || connection.connectionId !== runtime.connectionId) return doc;
    const timestamp = nowIso(now);
    changed = true;
    return {
      ...doc,
      connection: {
        ...connection,
        encryptedRefreshToken: encryptQuickBooksRefreshToken(token.refresh_token, connection, env),
        tokenVersion: Number(connection.tokenVersion || 0) + 1,
        lastRefreshedAt: timestamp,
        refreshTokenExpiresAt: tokenExpiry(now, token.x_refresh_token_expires_in) || connection.refreshTokenExpiresAt || null
      },
      lastUpdated: timestamp
    };
  }, { fallback: emptyQuickBooksCredentialStore(env) });
  return { changed };
}

export async function disconnectQuickBooks(root, { now = Date.now() } = {}, env = process.env) {
  let changed = false;
  await updatePlatformDoc(root, "quickBooksCredentials", current => {
    const doc = normalizeQuickBooksCredentialStore(current, env);
    changed = Boolean(doc.connection);
    return { ...doc, connection: null, pendingAttempts: [], lastUpdated: nowIso(now) };
  }, { fallback: emptyQuickBooksCredentialStore(env) });
  return { changed, quickbooks: await readQuickBooksCredentialStatus(root, env) };
}

export const quickBooksCredentialPolicy = Object.freeze({
  documentVersion: DOCUMENT_VERSION,
  encryptionVersion: ENCRYPTION_VERSION,
  oauthAttemptTtlMs: OAUTH_ATTEMPT_TTL_MS,
  maxPendingAttempts: MAX_PENDING_ATTEMPTS
});

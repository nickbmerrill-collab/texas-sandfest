import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  beginQuickBooksAuthorization,
  cancelQuickBooksAuthorization,
  completeQuickBooksAuthorization,
  disconnectQuickBooks,
  loadQuickBooksRuntimeCredentials,
  persistQuickBooksTokenRotation,
  quickBooksCredentialPolicy,
  readQuickBooksCredentialStatus
} from "../lib/quickbooks/credentials.mjs";

const previousDatabaseUrl = process.env.SANDFEST_DATABASE_URL;
delete process.env.SANDFEST_DATABASE_URL;

const roots = [];
let passed = 0;

function ok(name, predicate) {
  assert.ok(predicate, name);
  passed += 1;
  console.log(`  ok ${name}`);
}

async function runtimeRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandfest-qb-credentials-"));
  roots.push(root);
  return root;
}

function testEnv(overrides = {}) {
  return {
    SANDFEST_ENV: "development",
    QB_ENVIRONMENT: "sandbox",
    QB_INVOICE_SYNC_ENABLED: "true",
    QB_CLIENT_ID: "sandbox-client-id",
    QB_CLIENT_SECRET: "sandbox-client-secret",
    QB_REDIRECT_URI: "http://127.0.0.1:8787/api/integrations/quickbooks/callback",
    QB_TOKEN_ENCRYPTION_KEY: "sandfest-test-encryption-key-0123456789abcdef",
    QB_TOKEN_URL: "http://127.0.0.1:9999/oauth/tokens",
    ...overrides
  };
}

function tokenExchange(refreshToken = "refresh-token-initial") {
  return async (_url, options = {}) => {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "authorization-code-private");
    return new Response(JSON.stringify({
      access_token: "access-token-ephemeral",
      refresh_token: refreshToken,
      expires_in: 3600,
      x_refresh_token_expires_in: 8_726_400
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

console.log("\n=== QuickBooks encrypted credential contract ===\n");

try {
  const root = await runtimeRoot();
  const env = testEnv();
  const startedAt = Date.now();
  const begun = await beginQuickBooksAuthorization(root, { actorId: "finance-admin-1", now: startedAt }, env);
  const authorization = new URL(begun.authorizationUrl);
  const state = authorization.searchParams.get("state");
  const filePath = path.join(root, "data", "processed", "quickbooks-credentials.json");
  const pendingSource = await readFile(filePath, "utf8");

  ok("authorization creates a bounded Intuit request", begun.ok && state?.length >= 40 && authorization.hostname === "appcenter.intuit.com" && Date.parse(begun.expiresAt) - startedAt === quickBooksCredentialPolicy.oauthAttemptTtlMs);
  ok("OAuth state is stored only as a hash", !pendingSource.includes(state) && /"stateHash": "[a-f0-9]{64}"/.test(pendingSource));

  const completed = await completeQuickBooksAuthorization(root, {
    state,
    code: "authorization-code-private",
    realmId: "realm-private-123",
    now: startedAt + 1_000,
    fetchImpl: tokenExchange()
  }, env);
  const storedSource = await readFile(filePath, "utf8");
  ok("authorization stores an encrypted ready connection", completed.ok && completed.quickbooks.connected && completed.quickbooks.canSyncPartnerInvoices && completed.quickbooks.credentialSource === "encrypted_store");
  ok("stored document contains no OAuth token plaintext", !storedSource.includes("refresh-token-initial") && !storedSource.includes("access-token-ephemeral") && storedSource.includes('"algorithm": "aes-256-gcm"'));
  ok("public status excludes realm and encrypted payload", !JSON.stringify(completed.quickbooks).includes("realm-private-123") && !JSON.stringify(completed.quickbooks).includes("ciphertext"));

  const replay = await completeQuickBooksAuthorization(root, {
    state,
    code: "authorization-code-private",
    realmId: "realm-private-123",
    now: startedAt + 2_000,
    fetchImpl: tokenExchange("must-not-be-used")
  }, env);
  ok("OAuth state cannot be replayed", replay.ok === false && replay.error.includes("already used"));

  const runtime = await loadQuickBooksRuntimeCredentials(root, env);
  const concurrentRuntime = await loadQuickBooksRuntimeCredentials(root, env);
  ok("worker can decrypt private runtime credentials", runtime.source === "encrypted_store" && runtime.env.QB_REALM_ID === "realm-private-123" && runtime.env.QB_REFRESH_TOKEN === "refresh-token-initial");
  const rotated = await persistQuickBooksTokenRotation(root, runtime, {
    refresh_token: "refresh-token-rotated",
    x_refresh_token_expires_in: 8_726_400
  }, { now: startedAt + 3_000 }, env);
  const rotatedSource = await readFile(filePath, "utf8");
  const rotatedRuntime = await loadQuickBooksRuntimeCredentials(root, env);
  ok("worker persists refresh-token rotation with a version increment", rotated.changed && rotatedRuntime.tokenVersion === runtime.tokenVersion + 1 && rotatedRuntime.env.QB_REFRESH_TOKEN === "refresh-token-rotated");
  ok("rotated token also remains out of serialized storage", !rotatedSource.includes("refresh-token-initial") && !rotatedSource.includes("refresh-token-rotated"));
  const concurrentRotation = await persistQuickBooksTokenRotation(root, concurrentRuntime, {
    refresh_token: "refresh-token-concurrent",
    x_refresh_token_expires_in: 8_726_400
  }, { now: startedAt + 3_500 }, env);
  const concurrentSource = await readFile(filePath, "utf8");
  const concurrentResult = await loadQuickBooksRuntimeCredentials(root, env);
  ok("same-connection concurrent rotation keeps the last completed token", concurrentRotation.changed && concurrentResult.tokenVersion === runtime.tokenVersion + 2 && concurrentResult.env.QB_REFRESH_TOKEN === "refresh-token-concurrent" && !concurrentSource.includes("refresh-token-concurrent"));

  const wrongKey = testEnv({ QB_TOKEN_ENCRYPTION_KEY: "different-test-encryption-key-0123456789abc" });
  const wrongKeyStatus = await readQuickBooksCredentialStatus(root, wrongKey);
  await assert.rejects(() => loadQuickBooksRuntimeCredentials(root, wrongKey), /different encryption key/);
  ok("wrong encryption key fails closed", !wrongKeyStatus.connected && !wrongKeyStatus.canSyncPartnerInvoices);

  const tampered = JSON.parse(concurrentSource);
  const originalTag = tampered.connection.encryptedRefreshToken.tag;
  const replacement = originalTag.endsWith("A") ? "B" : "A";
  tampered.connection.encryptedRefreshToken.tag = `${originalTag.slice(0, -1)}${replacement}`;
  await writeFile(filePath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  const tamperedStatus = await readQuickBooksCredentialStatus(root, env);
  await assert.rejects(() => loadQuickBooksRuntimeCredentials(root, env), /could not be decrypted/);
  ok("ciphertext authentication failure blocks accounting calls", !tamperedStatus.connected && !tamperedStatus.canSyncPartnerInvoices);

  await writeFile(filePath, concurrentSource, "utf8");
  const disconnected = await disconnectQuickBooks(root, { now: startedAt + 4_000 }, env);
  ok("disconnect clears connection and pending attempts", disconnected.changed && !disconnected.quickbooks.connected && !disconnected.quickbooks.canSyncPartnerInvoices);
  const staleRotation = await persistQuickBooksTokenRotation(root, concurrentRuntime, {
    refresh_token: "must-not-reconnect-stale-job"
  }, { now: startedAt + 5_000 }, env);
  const disconnectedSource = await readFile(filePath, "utf8");
  ok("disconnected connection rejects an in-flight stale rotation", !staleRotation.changed && !disconnectedSource.includes("must-not-reconnect-stale-job"));

  const expiredRoot = await runtimeRoot();
  const expired = await beginQuickBooksAuthorization(expiredRoot, { actorId: "finance-admin-2", now: startedAt }, env);
  const expiredState = new URL(expired.authorizationUrl).searchParams.get("state");
  const expiredResult = await completeQuickBooksAuthorization(expiredRoot, {
    state: expiredState,
    code: "authorization-code-private",
    realmId: "realm-private-123",
    now: startedAt + quickBooksCredentialPolicy.oauthAttemptTtlMs + 1,
    fetchImpl: tokenExchange("must-not-be-used")
  }, env);
  ok("expired OAuth state is rejected", expiredResult.ok === false && expiredResult.error.includes("expired"));

  const canceledRoot = await runtimeRoot();
  const canceled = await beginQuickBooksAuthorization(canceledRoot, { actorId: "finance-admin-4", now: startedAt }, env);
  const canceledState = new URL(canceled.authorizationUrl).searchParams.get("state");
  const canceledAttempt = await cancelQuickBooksAuthorization(canceledRoot, { state: canceledState, now: startedAt + 1_000 }, env);
  const canceledReplay = await completeQuickBooksAuthorization(canceledRoot, {
    state: canceledState,
    code: "authorization-code-private",
    realmId: "realm-private-123",
    now: startedAt + 2_000,
    fetchImpl: tokenExchange("must-not-be-used")
  }, env);
  ok("provider cancellation consumes its OAuth state", canceledAttempt.changed && canceledReplay.ok === false);

  const productionRoot = await runtimeRoot();
  const productionEnv = testEnv({
    SANDFEST_ENV: "production",
    SANDFEST_API_PUBLIC_BASE_URL: "https://sandfest-api.heyelab.com",
    QB_REDIRECT_URI: "https://sandfest-api.heyelab.com/api/integrations/quickbooks/callback",
    QB_TOKEN_URL: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
  });
  const productionAttempt = await beginQuickBooksAuthorization(productionRoot, { actorId: "finance-admin-3" }, productionEnv);
  ok("production credential storage requires Postgres", productionAttempt.ok === false && productionAttempt.error.includes("Postgres"));

  console.log(`\nQuickBooks credential contract: ${passed} passed.`);
} finally {
  if (previousDatabaseUrl === undefined) delete process.env.SANDFEST_DATABASE_URL;
  else process.env.SANDFEST_DATABASE_URL = previousDatabaseUrl;
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
}

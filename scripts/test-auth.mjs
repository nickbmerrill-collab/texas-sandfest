#!/usr/bin/env node

import { createServer } from "node:http";
import {
  exportJWK,
  generateKeyPair,
  generateSecret,
  SignJWT
} from "jose";
import { authConfiguration, authMode, resolveSession } from "../lib/auth.mjs";

const ISSUER = "https://auth.sandfest.test/";
const AUDIENCE = "https://sandfest-api.sandfest.test";
const ROLE_PERMISSIONS = {
  super_admin: ["*"],
  finance_admin: ["finance:read", "finance:write"],
  viewer: ["admin:read"]
};
const ENV_KEYS = [
  "SANDFEST_AUTH_MODE",
  "SANDFEST_AUTH_JWKS_URL",
  "SANDFEST_AUTH_ISSUER",
  "SANDFEST_AUTH_AUDIENCE",
  "SANDFEST_AUTH_ROLE_CLAIM",
  "SANDFEST_AUTH_ACTOR_CLAIM",
  "SANDFEST_AUTH_USER_ROLES"
];

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ok ${name}`);
  } else {
    failed += 1;
    console.error(`  not ok ${name}`);
  }
}

function requestFor(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function token(privateKey, {
  alg = "RS256",
  kid = "sandfest-test-rsa",
  issuer = ISSUER,
  audience = AUDIENCE,
  subject = "user_finance",
  role = "finance_admin",
  issuedAt = Math.floor(Date.now() / 1_000),
  expiresAt = Math.floor(Date.now() / 1_000) + 300,
  includeSubject = true,
  includeRole = true,
  includeIssuedAt = true,
  includeExpiration = true
} = {}) {
  let signer = new SignJWT(includeRole ? { sandfest_role: role } : {})
    .setProtectedHeader({ alg, kid });
  if (issuer !== undefined) signer = signer.setIssuer(issuer);
  if (audience !== undefined) signer = signer.setAudience(audience);
  if (includeSubject) signer = signer.setSubject(subject);
  if (includeIssuedAt) signer = signer.setIssuedAt(issuedAt);
  if (includeExpiration) signer = signer.setExpirationTime(expiresAt);
  return signer.sign(privateKey);
}

const originalEnvironment = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
let jwksServer = null;

try {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const hmacSecret = await generateSecret("HS256", { extractable: true });
  const rsaJwk = {
    ...await exportJWK(publicKey),
    alg: "RS256",
    kid: "sandfest-test-rsa",
    use: "sig"
  };
  const hmacJwk = {
    ...await exportJWK(hmacSecret),
    alg: "HS256",
    kid: "sandfest-test-hmac",
    use: "sig"
  };
  jwksServer = createServer((request, response) => {
    if (request.url !== "/.well-known/jwks.json") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify({ keys: [rsaJwk, hmacJwk] }));
  });
  const port = await listen(jwksServer);

  Object.assign(process.env, {
    SANDFEST_AUTH_MODE: "jwt",
    SANDFEST_AUTH_JWKS_URL: `http://127.0.0.1:${port}/.well-known/jwks.json`,
    SANDFEST_AUTH_ISSUER: ISSUER,
    SANDFEST_AUTH_AUDIENCE: AUDIENCE,
    SANDFEST_AUTH_ROLE_CLAIM: "sandfest_role",
    SANDFEST_AUTH_ACTOR_CLAIM: "sub",
    SANDFEST_AUTH_USER_ROLES: ""
  });

  const validToken = await token(privateKey);
  const validSession = await resolveSession(requestFor(validToken), { rolePermissions: ROLE_PERMISSIONS });
  check("JWT mode is selected explicitly", authMode() === "jwt");
  check("complete issuer and audience configuration is readiness-safe", authConfiguration().ready === true);
  check("correctly signed issuer- and audience-bound token resolves one role", validSession?.id === "user_finance"
    && validSession?.role === "finance_admin"
    && validSession?.permissions === ROLE_PERMISSIONS.finance_admin
    && validSession?.auth === "jwt");

  const audienceListToken = await token(privateKey, { audience: ["another-resource", AUDIENCE] });
  const audienceListSession = await resolveSession(requestFor(audienceListToken), { rolePermissions: ROLE_PERMISSIONS });
  check("audience arrays are accepted only when they contain the configured API", audienceListSession?.role === "finance_admin");

  const wrongAudienceToken = await token(privateKey, { audience: "https://another-api.sandfest.test" });
  check("token minted for another resource is rejected", await resolveSession(requestFor(wrongAudienceToken), { rolePermissions: ROLE_PERMISSIONS }) === null);

  process.env.SANDFEST_AUTH_AUDIENCE = "";
  check("missing audience configuration fails closed at request time", await resolveSession(requestFor(validToken), { rolePermissions: ROLE_PERMISSIONS }) === null);
  check("missing audience configuration fails the auth readiness contract", authConfiguration().ready === false
    && authConfiguration().checks.audience === false);
  process.env.SANDFEST_AUTH_AUDIENCE = AUDIENCE;

  process.env.SANDFEST_AUTH_ISSUER = "";
  check("missing issuer configuration fails closed at request time", await resolveSession(requestFor(validToken), { rolePermissions: ROLE_PERMISSIONS }) === null);
  process.env.SANDFEST_AUTH_ISSUER = ISSUER;

  const insecureProductionConfig = authConfiguration({
    SANDFEST_ENV: "production",
    SANDFEST_AUTH_MODE: "jwt",
    SANDFEST_AUTH_JWKS_URL: "http://auth.sandfest.test/.well-known/jwks.json",
    SANDFEST_AUTH_ISSUER: "http://auth.sandfest.test/",
    SANDFEST_AUTH_AUDIENCE: AUDIENCE
  });
  check("production auth readiness rejects insecure JWKS and issuer origins", insecureProductionConfig.ready === false
    && insecureProductionConfig.checks.jwks === false
    && insecureProductionConfig.checks.issuer === false);

  const missingSubjectToken = await token(privateKey, { includeSubject: false });
  check("token without a stable audit subject is rejected", await resolveSession(requestFor(missingSubjectToken), { rolePermissions: ROLE_PERMISSIONS }) === null);

  const missingIssuedAtToken = await token(privateKey, { includeIssuedAt: false });
  check("token without issued-at is rejected", await resolveSession(requestFor(missingIssuedAtToken), { rolePermissions: ROLE_PERMISSIONS }) === null);

  const missingExpirationToken = await token(privateKey, { includeExpiration: false });
  check("token without expiration is rejected", await resolveSession(requestFor(missingExpirationToken), { rolePermissions: ROLE_PERMISSIONS }) === null);

  const invertedLifetimeToken = await token(privateKey, {
    issuedAt: Math.floor(Date.now() / 1_000),
    expiresAt: Math.floor(Date.now() / 1_000) - 10
  });
  check("expired or inverted token lifetime is rejected", await resolveSession(requestFor(invertedLifetimeToken), { rolePermissions: ROLE_PERMISSIONS }) === null);

  const unknownRoleToken = await token(privateKey, { role: "unrecognized_admin" });
  check("token without a recognized SandFest role is rejected", await resolveSession(requestFor(unknownRoleToken), { rolePermissions: ROLE_PERMISSIONS }) === null);

  const roleArrayToken = await token(privateKey, { role: ["viewer", "super_admin"] });
  const roleArraySession = await resolveSession(requestFor(roleArrayToken), { rolePermissions: ROLE_PERMISSIONS });
  check("highest recognized role wins for an authorized role array", roleArraySession?.role === "super_admin"
    && roleArraySession?.permissions === ROLE_PERMISSIONS.super_admin);

  process.env.SANDFEST_AUTH_USER_ROLES = "user_mapped:viewer";
  const mappedRoleToken = await token(privateKey, { subject: "user_mapped", includeRole: false });
  const mappedRoleSession = await resolveSession(requestFor(mappedRoleToken), { rolePermissions: ROLE_PERMISSIONS });
  check("explicit user-role fallback remains scoped to the stable token subject", mappedRoleSession?.id === "user_mapped"
    && mappedRoleSession?.role === "viewer");
  process.env.SANDFEST_AUTH_USER_ROLES = "";

  const hmacToken = await token(hmacSecret, {
    alg: "HS256",
    kid: "sandfest-test-hmac"
  });
  check("symmetric JWT signatures are rejected even if published in JWKS", await resolveSession(requestFor(hmacToken), { rolePermissions: ROLE_PERMISSIONS }) === null);
} catch (error) {
  failed += 1;
  console.error(`\nJWT acceptance suite failed: ${error.stack || error.message}`);
} finally {
  if (jwksServer) await close(jwksServer).catch(() => {});
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(`\nJWT acceptance total: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;

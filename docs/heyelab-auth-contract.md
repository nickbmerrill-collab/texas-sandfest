# Heyelab Auth Contract

The Texas SandFest admin API authenticates via OIDC-style JWTs verified against a remote JWKS. In production it expects those tokens to come from **Heyelab's own identity provider** running on a Heyelab-controlled subdomain.

This doc is the contract that Heyelab's auth service must satisfy for the SandFest API to accept its tokens. It is **not** a Heyelab build plan — Heyelab can implement the IdP however it likes (custom OIDC server, federated wrapper around Auth0/Clerk/Cognito, internal SSO, etc.) as long as the public surface below is honored.

## Public surface

| Concern | Requirement |
| --- | --- |
| JWKS endpoint | `GET https://auth.heyelab.com/.well-known/jwks.json` returning `{"keys":[…]}` per RFC 7517. RS256 keys at minimum. `kid` set on each key. |
| Issuer | `https://auth.heyelab.com/` (matches `iss` claim in tokens, trailing slash optional but must match what's minted). |
| Audience | Tokens minted for the SandFest API must include `aud: "https://api.heyelab.com/sandfest"` (or a list containing it). |
| Algorithm | RS256 (or any asymmetric alg supported by [`jose`](https://github.com/panva/jose)). HS256 is rejected. |
| Key rotation | Publish new keys on the JWKS endpoint **before** signing with them; keep old keys for at least one token-lifetime window after rotation. The SandFest API caches the JWKS with `jose`'s default policy and refetches on `kid` miss. |
| Discovery | `GET https://auth.heyelab.com/.well-known/openid-configuration` is required by the browser admin client. It must advertise the issuer, authorization endpoint, token endpoint, JWKS URI, `code` response type, and `S256` PKCE support. The token and discovery endpoints must allow CORS from `https://sandfest-admin.heyelab.com`. |

The API still reads `SANDFEST_AUTH_JWKS_URL` directly. Discovery is required for the admin browser login, not for API token verification.

## Browser client registration

Register `https://sandfest-admin.heyelab.com` as a **public SPA client**:

| Setting | Value |
| --- | --- |
| Grant / response type | Authorization Code / `code` |
| PKCE | Required, `S256` only |
| Client authentication | `none` (no client secret in the browser) |
| Redirect URI | `https://sandfest-admin.heyelab.com/` (exact match) |
| Post-logout redirect URI | `https://sandfest-admin.heyelab.com/` (exact match) |
| Scopes | `openid profile email` |
| API audience | `https://api.heyelab.com/sandfest` |

The access token must be the JWT described in this contract. The UI uses `oidc-client-ts` for callback state validation and PKCE, stores the user session in `sessionStorage`, does not use the implicit flow, and does not put a client secret or refresh token in build configuration.

## Required claims

Every token presented to the SandFest admin API must include:

| Claim | Type | Example | Purpose |
| --- | --- | --- | --- |
| `iss` | string | `https://auth.heyelab.com/` | Issuer pinning. SandFest rejects tokens whose `iss` does not match `SANDFEST_AUTH_ISSUER`. |
| `aud` | string \| string[] | `https://api.heyelab.com/sandfest` | Audience pinning. SandFest rejects tokens minted for other services. |
| `sub` | string | `user_3kCvF…` (Heyelab user id) | Used as the audit-log actor id. Stable per-user. |
| `exp` | number | unix seconds | Token expiry. Recommended lifetime: 60 minutes for interactive admin sessions. |
| `iat` | number | unix seconds | Issued-at. |
| `sandfest_role` | string \| string[] | `"ticketing_admin"` or `["super_admin","tester"]` | Maps to the SandFest RBAC roles below. If an array, the highest-privilege match wins. |

`jti` is recommended but not required. SandFest stores it on audit records when present.

The role-claim name and actor-claim name are configurable via `SANDFEST_AUTH_ROLE_CLAIM` and `SANDFEST_AUTH_ACTOR_CLAIM` (defaults `sandfest_role` and `sub`). If Heyelab has an existing IdP that uses different claim names, change the env vars rather than the IdP.

## Role values

The `sandfest_role` claim must contain one of these six string values (or an array containing at least one):

| Role | Capabilities |
| --- | --- |
| `super_admin` | Everything. |
| `ops_admin` | Alerts, orders, payment events, fulfillment status updates, audit, snapshots. |
| `ticketing_admin` | Ticket catalog writes, plus orders/payments/fulfillment reads. |
| `sponsor_admin` | Sponsor package writes, plus orders/fulfillment reads. |
| `finance_admin` | Finance reads plus review-gated partner invoice create, approve, void, and QuickBooks sync. |
| `viewer` | Read-only across the admin surface. No writes, no rollback. |

Tokens with no recognized role value are rejected with HTTP 401. Tokens with a recognized role but missing a permission for the requested route get HTTP 403.

Heyelab is the source of truth for which Heyelab user maps to which SandFest role. If a user's Heyelab role/group changes, the next minted token reflects it — the SandFest API holds no role state.

## Trust boundary

- The SandFest API never stores Heyelab tokens, refresh tokens, user passwords, or MFA secrets. It only verifies bearer tokens it receives on each request.
- The SandFest admin UI (`https://sandfest-admin.heyelab.com`) handles login by redirecting to Heyelab's IdP, then attaches the resulting JWT as `Authorization: Bearer …` on API calls.
- The admin UI keeps the OIDC user and access token in per-tab `sessionStorage`. A 401 or token-expiry event clears that session and requires another sign-in.
- The production admin bundle pins the API base to `https://api.heyelab.com/sandfest`; staff cannot edit the destination that receives the bearer token.
- The SandFest API never federates to the IdP server-to-server. Heyelab can rotate keys, change session policy, force MFA, or revoke users without coordinating with the SandFest deployment.

## SandFest admin build env vars (production)

```bash
SANDFEST_DEPLOYMENT_ENV=production
VITE_SANDFEST_AUTH_MODE=oidc
VITE_SANDFEST_AUTH_ISSUER=https://auth.heyelab.com/
VITE_SANDFEST_AUTH_CLIENT_ID=<registered-public-spa-client-id>
VITE_SANDFEST_AUTH_REDIRECT_URI=https://sandfest-admin.heyelab.com/
VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI=https://sandfest-admin.heyelab.com/
VITE_SANDFEST_AUTH_SCOPES="openid profile email"
VITE_SANDFEST_AUTH_AUDIENCE=https://api.heyelab.com/sandfest
VITE_SANDFEST_API_BASE_URL=https://api.heyelab.com/sandfest
```

The client ID is a public identifier, not a secret. It is left as a required Render value so a deploy cannot accidentally use an unregistered placeholder. The Vite build fails closed when production mode is selected without OIDC or when an OIDC issuer, client ID, redirect URI, or API base is missing or insecure.

## SandFest API env vars (production)

```bash
SANDFEST_AUTH_MODE=jwt
SANDFEST_AUTH_JWKS_URL=https://auth.heyelab.com/.well-known/jwks.json
SANDFEST_AUTH_ISSUER=https://auth.heyelab.com/
SANDFEST_AUTH_AUDIENCE=https://api.heyelab.com/sandfest
SANDFEST_AUTH_ROLE_CLAIM=sandfest_role
SANDFEST_AUTH_ACTOR_CLAIM=sub
```

`GET /api/admin/deployment` returns the readiness profile and surfaces `authMode`, `authJwks`, and `authIssuer` checks. Until Heyelab's IdP is live, those checks fail with `error` severity and `/ready` returns 503 — which is the right behavior, because no admin should be able to use the API until the IdP is real.

## Interim: Clerk dev instance

While Heyelab's own IdP is being built, a Clerk dev app named **Texas Sandfest** (Hobby tier, Personal workspace) holds the staging configuration. Captured 2026-05-01:

- App ID: `app_3D7zeyJPFp3uvCrCQEZwiJdweSs`
- Instance ID: `ins_3D7zesniMxoRhXn1OBtFUp2N9dP`
- Issuer / Frontend API: `https://distinct-opossum-3.clerk.accounts.dev`
- JWKS: `https://distinct-opossum-3.clerk.accounts.dev/.well-known/jwks.json`

**Open issue (2026-05-01):** Clerk's dashboard "Customize session token" save form returns `Could not save settings` for any non-trivial claims body, including a known-good `{"first_name": "{{user.first_name}}"}`. Each save attempt logs `Form error Object` to the console and produces no observable network request from `window.fetch` or `XMLHttpRequest`. Reason TBD — likely a Clerk dashboard regression or a Hobby-tier limit not surfaced in the UI. Until that's resolved, tokens minted by Clerk only carry the default claims (`iss`, `sub`, `iat`, `exp`, `azp`, `sid`, etc.) with no `sandfest_role`.

Workaround in `lib/auth.mjs`: `SANDFEST_AUTH_USER_ROLES` env supports a `<sub>:<role>` map that's consulted when the JWT has no role claim. Once Clerk's UI cooperates, customize the session token to add `"sandfest_role": "{{user.public_metadata.sandfest_role}}"` and remove the env-var workaround.

## Verification checklist

Once Heyelab's IdP is live, run this from a workstation with a freshly minted token to confirm:

```bash
TOKEN=$(<get-a-real-heyelab-token>)
curl -s -H "Authorization: Bearer $TOKEN" https://api.heyelab.com/sandfest/api/admin/session
```

The response should look like:

```json
{
  "session": {
    "id": "<heyelab-user-id-from-sub>",
    "role": "<one-of-the-six-sandfest-roles>",
    "permissions": ["…"],
    "auth": "jwt",
    "issuer": "https://auth.heyelab.com/",
    "audience": "https://api.heyelab.com/sandfest",
    "expiresAt": "<iso>"
  }
}
```

If the `role` is wrong or missing, the issue is on the IdP side (claim name, value, or role mapping). If the response is 401, the issue is signature/issuer/audience and is verifiable by base64-decoding the token's middle segment and comparing to the env config.

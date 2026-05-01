# Deploy Runbook — heyelab.com cutover

End-state hostnames (from `heyelab-backend-deployment.md`):

| Service | URL |
| --- | --- |
| Public web | `https://sandfest.heyelab.com` |
| API (public + admin) | `https://api.heyelab.com/sandfest` |
| Admin console | `https://sandfest-admin.heyelab.com` |
| Identity provider | `https://auth.heyelab.com` |

This runbook gets you to those URLs in three phases. Public web first (zero risk, free), then API behind a one-click Render Blueprint, then DNS cutover.

## Phase 1 — Public web on GitHub Pages (live now)

A workflow at `.github/workflows/pages.yml` builds the Vite app and publishes to GitHub Pages on every `main` push.

**Enable Pages once:**
1. Go to https://github.com/nickbmerrill-collab/texas-sandfest/settings/pages
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

The next push (or a manual `Actions → Deploy public web → Run workflow`) publishes to:

```
https://nickbmerrill-collab.github.io/texas-sandfest/
```

That's the demo URL. To swap in `sandfest.heyelab.com`:

1. In the repo's Pages settings, set the custom domain to `sandfest.heyelab.com`.
2. In your DNS provider for `heyelab.com`, add:
   ```
   CNAME  sandfest  → nickbmerrill-collab.github.io
   ```
3. Wait for the cert to provision (a few minutes), then enable **Enforce HTTPS**.
4. Update `vite.config.js` to use `DEPLOY_BASE=/` for the custom-domain build (or set the workflow env var to `/` when on the custom domain).

## Phase 2 — API on Render (one click)

`render.yaml` is a complete Render Blueprint. It stands up:

- A `sandfest-api` web service running the existing Node `admin-api-server.mjs` from a Docker image
- A `sandfest-db` Postgres database wired into `SANDFEST_DATABASE_URL`
- All the production env vars from the deployment doc (JWKS, CORS, rate limits, public/admin base URLs)

**Deploy:**

1. Go to https://render.com/deploy?repo=https://github.com/nickbmerrill-collab/texas-sandfest
2. Render reads `render.yaml`, prompts you for the few `sync: false` secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
3. Click **Apply**. First deploy takes ~6 minutes (Docker build + pg provisioning).
4. Service comes up at `https://sandfest-api.onrender.com`. Hit `/health`:
   ```bash
   curl https://sandfest-api.onrender.com/health
   ```
   Expect `{ "status": "ok", "storage": "postgres", ... }`.

**Note:** the API will return 503 from `/ready` until `auth.heyelab.com` is live, because production requires JWT mode. That's intended — it's a deployment guard, not a bug.

## Phase 3 — Custom domains

After Render is healthy, point heyelab.com DNS:

```
CNAME  api               → sandfest-api.onrender.com
CNAME  sandfest-admin    → sandfest-api.onrender.com
CNAME  sandfest          → nickbmerrill-collab.github.io
```

If `auth.heyelab.com` doesn't exist yet, the API still runs in production with `/ready` returning 503; admin endpoints will refuse requests. To unblock admin during the IdP build-out, use a Clerk dev app temporarily — see `docs/heyelab-auth-contract.md` for the issuer/JWKS shape and the existing Clerk staging notes.

In Render, add the custom domains under **Settings → Custom Domains** for `sandfest-api`. Render handles cert issuance.

## Phase 4 — iOS app

`AppDataStore.apiBase` resolves the API in this order:

1. `-apiBase https://api.heyelab.com/sandfest` launch arg (demos / Xcode schemes)
2. `SANDFEST_API_BASE` env var
3. `SandFestAPIBase` Info.plist key
4. `https://api.heyelab.com/sandfest` (Release builds)
5. `http://127.0.0.1:8788` (Debug builds)

To ship a TestFlight build that talks to the real API, no code changes — Release config picks up the production default automatically. To stage against Render before DNS is ready:

```bash
xcodebuild ... build  # Release config
# Run with:
xcrun simctl launch booted com.portalcodex.texassandfest \
  -apiBase https://sandfest-api.onrender.com
```

## Phase 5 — Bootstrap data sync

The iOS app currently uses an in-code `SampleData.liveBeach` plus a bundled `sandfest-seed.json`. Once the API is live, the public bootstrap endpoint becomes the source of truth:

```bash
curl https://api.heyelab.com/sandfest/api/public/bootstrap > data/processed/app-bootstrap.json
npm run ios:seed
```

For production, the iOS app should fetch this on launch and cache locally. That's a follow-up task — for the demo, the bundled seed is fine.

## Checklist

- [ ] Enable GitHub Pages → Source: GitHub Actions
- [ ] Push `main` → Pages workflow goes green → demo URL live
- [ ] Render Blueprint deploy → `sandfest-api.onrender.com/health` is OK
- [ ] DNS:
  - [ ] `sandfest.heyelab.com` CNAME → `nickbmerrill-collab.github.io`
  - [ ] `api.heyelab.com` CNAME → `sandfest-api.onrender.com`
  - [ ] `sandfest-admin.heyelab.com` CNAME → `sandfest-api.onrender.com`
- [ ] Render → Custom Domains → add all three; wait for certs
- [ ] Update GitHub Pages custom domain to `sandfest.heyelab.com`, enforce HTTPS
- [ ] Bring `auth.heyelab.com` online (separate runbook); `/ready` flips to 200
- [ ] iOS Release build hits production API automatically

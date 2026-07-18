# Deploy Runbook — heyelab.com cutover

End-state hostnames (from `heyelab-backend-deployment.md`):

| Service | URL |
| --- | --- |
| Public web | `https://sandfest.heyelab.com` |
| API (public + admin) | `https://api.heyelab.com/sandfest` |
| Admin console | `https://sandfest-admin.heyelab.com` |
| Identity provider | `https://auth.heyelab.com` |

This runbook gets you to those URLs in three phases. Public web first (zero risk, free), then API behind a one-click Render Blueprint, then DNS cutover.

## Phase 1 — Public web on GitHub Pages (enablement pending)

A workflow at `.github/workflows/pages.yml` builds the Vite app only after the full `CI` workflow succeeds for a direct push to `main`. Pull-request and feature-branch runs cannot publish, and there is no manual bypass around the release gate.

Repository configuration, workflow success, the GitHub Pages URL, custom DNS, and customer-visible rendering must each be verified directly before this phase is marked live. A local build or committed workflow is not deploy proof.

The production visitor build injects a CSP meta policy before any loadable resource, uses only self-hosted brand fonts, restricts executable scripts and frames to the app plus Cloudflare Turnstile, and publishes `no-referrer`. The narrow `style-src-attr 'unsafe-inline'` allowance is required by the interactive maps, meters, and canvas sizing; `script-src` does not allow inline or evaluated code. Build verification fails if these boundaries drift.

The same build finalizes the public service worker with the exact hashed JavaScript, CSS, and font files emitted by Vite. Its cache name is derived from that artifact, installation fails instead of accepting a partial core shell, and activation removes superseded caches. The Pages workflow verifies that HTML, manifest, and worker remain safe under `/texas-sandfest/` before upload. Large galleries remain network-first or on-demand so a first visit does not force hundreds of media files into device storage.

This static meta policy does not replace response headers. In particular, browsers ignore `frame-ancestors` in a meta CSP, and policies such as HSTS, `X-Content-Type-Options`, and `Permissions-Policy` require HTTP response headers. Before the canonical-domain launch, put `sandfest.heyelab.com` behind an edge capable of setting those headers, mirror the public CSP there, add `frame-ancestors 'none'`, and verify the headers directly from the customer hostname. The Render-hosted admin surface already declares this header set in `render.yaml`.

**Enable Pages once:**
1. Go to https://github.com/nickbmerrill-collab/texas-sandfest/settings/pages
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Under **Settings → Secrets and variables → Actions → Variables**, create `SANDFEST_TURNSTILE_SITE_KEY` with the public key from the production Cloudflare Turnstile widget. Configure that widget to allow the Pages hostname and every planned custom public hostname. The production visitor build intentionally fails when this variable is missing or is a Cloudflare test key.

The next successful `CI` run for a direct `main` push publishes to:

```
https://nickbmerrill-collab.github.io/texas-sandfest/
```

Pull requests also receive a Vercel preview of the isolated public artifact.
`vercel.json` owns that preview build so stale dashboard framework settings
cannot make this Vite repository run a Next.js build. A preview is review
evidence only: it does not replace the gated Pages release or prove that the
production API and provider capabilities are live.

That is the expected demo URL after a successful workflow and Pages enablement. Verify it directly before sharing it. To swap in `sandfest.heyelab.com`:

1. In the repo's Pages settings, set the custom domain to `sandfest.heyelab.com`.
2. In your DNS provider for `heyelab.com`, add:
   ```
   CNAME  sandfest  → nickbmerrill-collab.github.io
   ```
3. Wait for the cert to provision (a few minutes), then enable **Enforce HTTPS**.
4. Update `vite.config.js` to use `DEPLOY_BASE=/` for the custom-domain build (or set the workflow env var to `/` when on the custom domain).

## Phase 2 — API on Render (Blueprint)

`render.yaml` is a complete Render Blueprint. It stands up:

- A `sandfest-api` web service running the existing Node `admin-api-server.mjs` from a Docker image
- A `sandfest-admin` static site that boots the complete operations workspace from the admin entry while excluding public data files and visitor runtime work
- A `sandfest-worker` background service for approved messages and durable jobs
- A private paid `sandfest-rate-limit` Key Value service wired into `REDIS_URL`
- A paid `basic-1gb` `sandfest-db` Postgres database wired into `SANDFEST_DATABASE_URL`, with a 15 GB autoscaling disk and managed point-in-time recovery
- All the production env vars from the deployment doc (JWKS, CORS, rate limits, public/admin base URLs)

The API also reconciles every failing launch gate into the governed work board at startup and every 15 minutes. The Blueprint pins `SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS=900000`; production readiness remains red until startup reconciliation succeeds and becomes red after an automatic failure. Disabling it is a readiness failure, not a way to waive unresolved launch work.

API, admin, and worker deploys follow `main` only after repository checks pass. The API owns provider configuration; the worker receives the exact QuickBooks, Brevo, Twilio, and portal-capability values through Render service references instead of duplicate dashboard entries. Run `npm run test:container-contract` and `npm run test:render-blueprint` before every container or Blueprint change. The container contract requires a frozen production-only dependency install, follows both API and worker import graphs, verifies every runtime package is declared in `dependencies`, enforces a non-root runtime stage, and rejects sensitive build-context paths. With the official Render CLI authenticated to the target workspace, also run `render blueprints validate render.yaml` before applying it. A passing static contract does not replace the first real Render image build and service smoke test.

**Deploy:**

Before the first production import for a new festival year, preview the annual rollover while the existing API and worker remain online:

```bash
npm run event:rollover -- --from texas-sandfest-2026 --to texas-sandfest-2027
```

The preview must name the expected source and target event, report every carried configuration count, and show the number of consent, vote, passport, partner, and incident records that will be reset. To apply it, stop the API and worker, take the provider backup required by the recovery checklist, and run:

```bash
SANDFEST_ROLLOVER_MAINTENANCE=true \
npm run event:rollover -- --from texas-sandfest-2026 --to texas-sandfest-2027 --apply
```

The command writes a complete private archive snapshot before changing any active document, verifies every new document by reading it back, and restores already-written documents if a later write or verification fails. Postgres passport scans and votes are included in the archive and retained in their append tables; annual hunt and event filters keep them out of the new season. Never retag historical order, payment, fulfillment, or audit records. Restart both services only after `/health` reports `currentEventReady: true` and `currentEventId` matches the published guide.

1. Go to https://render.com/deploy?repo=https://github.com/nickbmerrill-collab/texas-sandfest
2. Render reads `render.yaml` and prompts for API-owned `sync: false` values, including the private Turnstile secret, outreach discovery credential, Stripe, Brevo, QuickBooks, camera credentials, camera model approval attestation, and Twilio sender credentials. The Blueprint generates the partner portal and outreach-preference capabilities, provisions private Redis and Postgres itself, and binds the worker to the API-owned provider values. Set `OUTREACH_DISCOVERY_SECRET` to a separate random 32+ character value; the Blueprint already pins the review-first OpenStreetMap provider to the official SandFest operator identity and a bounded ordered list of reviewed Overpass instances. Leave a provider disabled until its full credential set is approved, but remember that the required-capabilities policy intentionally keeps `/ready` red for launch-critical providers. After changing an API-owned provider value in Render, sync the Blueprint and deploy both API and worker so the service references update together.
3. Click **Apply**. First deploy takes ~6 minutes (Docker build + pg provisioning).
4. The API comes up at its Render service URL. Hit `/health` using the exact URL shown by Render:
   ```bash
   curl https://sandfest-api.onrender.com/health
   ```
   Expect an HTTP 200 health response with `storage: "postgres"`. This proves the process and data plane, not full launch readiness.
5. Hit `/ready` separately. Do not promote domains or invite staff until it returns HTTP 200 and every required capability is green.
6. From the API service shell, run the read-only regional discovery acceptance:
   ```bash
   npm run test:outreach-discovery:live
   ```
   It must resolve Port Aransas, return at least one nearby source-attributed OpenStreetMap business, and report `readOnly: true`. The command never imports a prospect or creates a message.
7. Open `https://sandfest-admin.onrender.com`. It must show the isolated
   operations console, not the visitor site. Admin API calls remain unavailable
   until a valid JWT can be minted.
8. Open `/api/public/sponsors` on the production API. Confirm an approved sponsor appears only after both its application and brand profile are approved. An approved self-hosted PNG, JPEG, or WebP logo may expose a `/api/public/sponsor-showcase/assets/:id` path; external URLs, PDFs, contact fields, application IDs, review notes, checksums, and storage keys must never appear. Rejecting the application, profile, or asset must remove its public eligibility on the next API request.
9. POST `{"question":"Where can I buy tickets?"}` to `/api/public/concierge`. Require HTTP 200, `cache-control: no-store`, a `tickets` topic, at least one public citation, no provider or workflow fields, and no echoed question text. Repeat with a ferry question after live feeds are green, then confirm an urgent missing-person question explicitly says Ask Sandy cannot dispatch help and directs immediate danger to 911.
10. Run `npm run test:live-feeds` from the production API service shell. Require current National Weather Service data and a current TxDOT ferry response; an unavailable or expired source is a failed launch check, even though the visitor surface safely preserves last-known information.
11. Run `npm run test:outreach-discovery:live` from the production API service shell. Require a source-attributed, in-radius Port Aransas result from the configured production OpenStreetMap adapter.
12. Approve the exact detector artifact and license decision, populate the matching `model.approval` block and API `CAMERA_MODEL_*` variables, and run `npm run ready:camera-edge` on the proposed edge host with `SANDFEST_CAMERA_CONFIG` pointing to the deployed config. Retain the checksum-bound fleet qualification report, then prove `--validate-production`, start all eight camera agents against their commissioned streams, and run `npm run deployment:verify`. The local qualification requires the exact eight enabled lanes, independent model instances, and the slowest generated-pixel fleet cycle within budget; it does not replace live decoder, network, placement, or calibration acceptance. Island Conditions requires current weather, current ferry status, and eight configured, armed, live cameras with healthy pipelines and fresh observations. Pending model approval, placeholders, stale metrics, and missing heartbeats fail closed.
13. Keep `STRIPE_TICKETING_ENABLED=false` until ticket prices, terms, limits, and real Stripe Price IDs are approved. In Stripe test mode, enable ticketing and confirm `/api/public/tickets` exposes no Price IDs, one checkout retry key creates one hosted session, a changed cart conflicts, a fresh signed paid event creates fulfillment from the stored order, replay creates nothing new, and full plus partial refunds update both the order and fulfillment. Repeat the acceptance against Postgres before introducing live keys.
14. Keep `SMS_ENABLED=false` until the safety sender is approved and every check in [`sms-safety.md`](sms-safety.md) passes. Confirm alert publishing without the explicit SMS checkbox creates no SMS jobs; a checked publish creates only consent-record jobs; the worker sends only after revalidating current consent; signed delivery and STOP/START callbacks update the aggregate dashboard; an invalid signature is rejected; and clearing an alert prevents every still-queued provider submission. Perform the approved-volume rehearsal before increasing `SANDFEST_SMS_MAX_RECIPIENTS`.

**Note:** the API will return 503 from `/ready` until production JWT, Turnstile intake verification, Stripe ticketing and partner payments, Brevo email, QuickBooks invoice sync, Twilio safety messaging, the verified current-event staff directory, live regional business discovery, the full camera credential fleet, and an artifact-bound camera model approval are configured. `SANDFEST_REQUIRED_CAPABILITIES` makes provider gates explicit, while Turnstile and the staff-directory integrity checks are unconditional production gates. `/health` remains available while the team closes them; a red `/ready` is an intentional no-launch signal.

### Recovery acceptance

The paid database receives managed point-in-time recovery, and Render snapshots the encrypted partner-asset disk daily. Those provider features are not enough by themselves: `/ready` remains red until both restore paths have been exercised within the last 90 days.

1. From the database Recovery page, restore a point in time into a new isolated database. Do not repoint the API.
2. Run the read-only verifier against the restored database:
   ```bash
   SANDFEST_RECOVERY_DATABASE_URL='postgresql://...' \
   SANDFEST_RECOVERY_DATABASE_SSL=no-verify \
   npm run recovery:verify
   ```
3. Confirm the JSON result has `ok: true`, all ten required tables, all four config documents, and plausible row counts.
4. Restore a partner-asset disk snapshot at an isolated path in a disposable staging service. Do not restore over the production disk or reuse `SANDFEST_PARTNER_ASSET_DIR`.
5. Verify every uploaded sponsor and vendor file referenced by the restored database:
   ```bash
   SANDFEST_RECOVERY_DATABASE_URL='postgresql://...' \
   SANDFEST_RECOVERY_DATABASE_SSL=no-verify \
   SANDFEST_RECOVERY_ASSET_DIR='/var/data/restored-partner-assets' \
   SANDFEST_RECOVERY_ASSET_MIN_FILES=1 \
   npm run recovery:verify:assets
   ```
6. Confirm the JSON result has `ok: true`, `referenced` equals `verified`, both sponsor/vendor category counts are plausible, and retain the manifest SHA-256 with the drill record. The verifier checks every upload's existence, byte count, and checksum; it refuses the active database and active asset directory.
7. Set `SANDFEST_DATABASE_RESTORE_DRILL_AT` and `SANDFEST_ASSET_RESTORE_DRILL_AT` to the respective successful verifier timestamps. Repeat both drills at least every 90 days.

Render documents paid Postgres recovery windows and isolated PITR instances in its [Postgres recovery guide](https://render.com/docs/postgresql-backups). Daily encrypted disk snapshots and their retention are documented in [Persistent Disks](https://render.com/docs/disks).

## Phase 3 — Custom domains

After Render is healthy, point heyelab.com DNS:

```
CNAME  api               → sandfest-api.onrender.com
CNAME  sandfest-admin    → sandfest-admin.onrender.com
CNAME  sandfest          → nickbmerrill-collab.github.io
```

If `auth.heyelab.com` doesn't exist yet, the API still runs in production with `/ready` returning 503; admin endpoints will refuse requests. To unblock admin during the IdP build-out, use a Clerk dev app temporarily — see `docs/heyelab-auth-contract.md` for the issuer/JWKS shape and the existing Clerk staging notes.

The Blueprint assigns `sandfest-admin.heyelab.com` to the static admin service.
Assign `api.heyelab.com` to `sandfest-api` and verify each hostname receives its
own managed certificate. Do not attach the admin hostname to the API service.

## Live deployment acceptance

Build both isolated surfaces, then run the fail-closed live verifier before
sharing or promoting any hostname:

```bash
npm run test:accessibility
npm run build:surfaces
npm run deployment:verify
```

The accessibility acceptance uses the rendered application and the real local
API workflow. It must report zero automated WCAG A/AA violations across public
partner intake, the private status handoff, Ask Sandy, mobile intake, and the
staff operations workspace. Manual keyboard and screen-reader review remains
part of release signoff because automated rules do not cover every interaction.

The default targets are `https://sandfest.heyelab.com/`,
`https://api.heyelab.com/sandfest/`, and
`https://sandfest-admin.heyelab.com/`. The verifier requires the exact current
public and admin asset names, the current service-worker cache version, the
governed 2027 event, document security headers, a production
JWT/Postgres/shared-rate-limit runtime, every required capability gate, a
healthy worker and queue, both CORS origins, checkout-ready tickets, sponsor
tiers with trusted amounts and benefits and no public provider mappings, vendor
offerings, current weather and ferry data, and eight configured, armed, live
camera pipelines with fresh observations.

To verify the temporary Pages hostname while DNS is being prepared, override
only the public target. This remains a staging check because Pages cannot prove
the canonical admin/API surfaces or the complete edge-header contract:

```bash
SANDFEST_LIVE_PUBLIC_URL=https://nickbmerrill-collab.github.io/texas-sandfest/ \
  npm run deployment:verify
```

A failed check is a no-launch result. Do not waive artifact-freshness,
`/ready`, production identity, security-header, or CORS failures based on a
successful local build.

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
- [ ] Push `main` → full CI goes green → Pages workflow goes green → demo URL live
- [ ] `npm run test:render-blueprint` and authenticated `render blueprints validate render.yaml` both pass
- [ ] Render Key Value and Postgres accept private-network connections only
- [ ] Put the canonical public hostname behind security response headers; verify CSP, `frame-ancestors`, HSTS, `nosniff`, referrer, and permissions policies directly
- [ ] Render Blueprint deploy → `sandfest-api.onrender.com/health` is OK
- [ ] `sandfest-admin.onrender.com` renders the full operations entry with no visitor forms
- [ ] Paid Postgres PITR restore verified with `npm run recovery:verify`
- [ ] Partner-asset snapshot restored in isolation and every referenced upload verified with `npm run recovery:verify:assets`
- [ ] Both restore drill timestamps set; `/ready` recovery check is green
- [ ] OpenStreetMap outreach search returns source-attributed candidates for a reviewed Port Aransas query; no prospect or message is created until staff explicitly imports and qualifies it
- [ ] `npm run test:live-feeds` confirms current NWS and TxDOT responses from the production service shell
- [ ] Exact camera detector bytes have a recorded license decision; edge `--validate-production`, checksum preflight, and API `cameraModelApproval` are green
- [ ] `ready:camera-edge` passes on the commissioned edge host and its fresh checksum-bound eight-lane qualification report is retained
- [ ] All eight commissioned camera agents report healthy pipelines and fresh observations; `api.camera_fleet_live` passes
- [ ] `/api/public/sponsors` publishes an approved sponsor profile without private workflow data; its approved uploaded logo renders on the public hostname and becomes unavailable after approval is revoked
- [ ] `/api/public/concierge` returns source-cited, no-store answers from current public data and fails its deployment gate on private fields
- [ ] Static ticket catalog contains no Stripe Price IDs and reports every product unavailable until the ready API is reachable
- [ ] Stripe test-mode ticket checkout passes same-key replay, changed-cart conflict, signed payment, webhook replay, mismatch rejection, and full/partial refund acceptance against Postgres
- [ ] Approved live ticket prices, limits, terms, Price IDs, HTTPS redirects, and webhook endpoint are configured before `STRIPE_TICKETING_ENABLED=true`
- [ ] DNS:
  - [ ] `sandfest.heyelab.com` CNAME → `nickbmerrill-collab.github.io`
  - [ ] `api.heyelab.com` CNAME → `sandfest-api.onrender.com`
  - [ ] `sandfest-admin.heyelab.com` CNAME → `sandfest-admin.onrender.com`
- [ ] Render → verify API and admin custom domains on their respective services; wait for certs
- [ ] Update GitHub Pages custom domain to `sandfest.heyelab.com`, enforce HTTPS
- [ ] Bring `auth.heyelab.com` online (separate runbook); `/ready` flips to 200
- [ ] iOS Release build hits production API automatically

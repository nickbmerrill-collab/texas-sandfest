import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { publicAppBootstrapSafety } from "../lib/public-bootstrap.mjs";
import { publicMediaManifestSafety } from "../lib/public-media-manifest.mjs";
import {
  PUBLIC_FIELD_MEDIA,
  PUBLIC_GALLERY_MEDIA,
  selectPublicMediaAssets
} from "../lib/public-media-selection.mjs";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "dist-public");
const adminDir = path.join(root, "dist-admin");
const visitorSource = await readFile(path.join(root, "src", "main.js"), "utf8");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const publicHtml = await readFile(path.join(publicDir, "index.html"), "utf8");
const adminHtml = await readFile(path.join(adminDir, "index.html"), "utf8");
const publicAssets = await readdir(path.join(publicDir, "assets"));
const adminAssets = await readdir(path.join(adminDir, "assets"));
const publicStylesheets = (await Promise.all(
  publicAssets.filter(file => file.endsWith(".css")).map(file => readFile(path.join(publicDir, "assets", file), "utf8"))
)).join("\n");
const adminStylesheets = (await Promise.all(
  adminAssets.filter(file => file.endsWith(".css")).map(file => readFile(path.join(adminDir, "assets", file), "utf8"))
)).join("\n");
const publicJavaScript = (await Promise.all(
  publicAssets.filter(file => file.endsWith(".js")).map(file => readFile(path.join(publicDir, "assets", file), "utf8"))
)).join("\n");
const adminJavaScript = (await Promise.all(
  adminAssets.filter(file => file.endsWith(".js")).map(file => readFile(path.join(adminDir, "assets", file), "utf8"))
)).join("\n");
const publicBootstrap = JSON.parse(await readFile(path.join(publicDir, "data", "app-bootstrap.json"), "utf8"));
const publicDataFiles = (await readdir(path.join(publicDir, "data"))).sort();
const publicTicketCatalog = JSON.parse(await readFile(path.join(publicDir, "data", "ticket-products.json"), "utf8"));
const publicSculptorRoster = JSON.parse(await readFile(path.join(publicDir, "data", "sculptors.json"), "utf8"));
const sourceVoting = JSON.parse(await readFile(path.join(root, "data", "processed", "peoples-choice.json"), "utf8"));
const sourcePassport = JSON.parse(await readFile(path.join(root, "data", "processed", "sculpture-passport.json"), "utf8"));
const vercelConfig = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
const mediaDerivatives = JSON.parse(await readFile(path.join(publicDir, "assets", "sandfest-media", "media-derivatives.json"), "utf8"));
const publicMediaManifest = JSON.parse(await readFile(path.join(publicDir, "assets", "sandfest-media", "media-manifest.json"), "utf8"));
const robots = await readFile(path.join(publicDir, "robots.txt"), "utf8");
const publicWorker = await readFile(path.join(publicDir, "sw.js"), "utf8");
const boardDemoCredentialMarkers = [
  "board-demo-production-leak-sentinel",
  "board-demo-local-admin-token-change-me"
];
const fictionalPublicContentMarkers = [
  "River Delgado",
  "samplehandle",
  "Diego Aponte",
  "Nino Suarez",
  "Niño Suárez"
];

assert(!(await exists(path.join(publicDir, "admin.html"))), "Public artifact must not contain admin.html.");
assert(!(await exists(path.join(adminDir, "admin.html"))), "Admin artifact must promote admin.html to the root entry.");
assert(vercelConfig.framework === "vite", "Vercel PR previews must use the Vite framework preset.");
assert(vercelConfig.buildCommand === "node scripts/verify-vercel-project.mjs && SANDFEST_DEPLOYMENT_ENV=$VERCEL_ENV npm run build:public", "Vercel builds must verify project isolation, inherit the deployment environment, and build only the public surface.");
assert(vercelConfig.outputDirectory === "dist-public", "Vercel PR previews must publish only the isolated public artifact.");
assert(publicHtml.includes("Texas SandFest | Port Aransas"), "Public artifact does not contain the visitor entry.");
assert(!publicHtml.includes("SandFest Ops Console"), "Public artifact contains the admin entry.");
assert(adminHtml.includes("SandFest Ops Console"), "Admin artifact does not contain the ops entry.");
assert(!adminHtml.includes("Texas SandFest | Port Aransas"), "Admin artifact contains the visitor entry.");
const cspMatch = publicHtml.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"[^>]*>/i);
assert(cspMatch, "Public production artifact is missing its Content Security Policy.");
const csp = Object.fromEntries(cspMatch[1].split(";").map(directive => directive.trim()).filter(Boolean).map(directive => {
  const [name, ...values] = directive.split(/\s+/);
  return [name, values];
}));
assert(csp["default-src"]?.join(" ") === "'self'", "Public CSP default-src must be self-only.");
assert(csp["script-src"]?.join(" ") === "'self' https://challenges.cloudflare.com", "Public CSP scripts must be limited to the app and Turnstile.");
assert(!csp["script-src"].includes("'unsafe-inline'") && !csp["script-src"].includes("'unsafe-eval'"), "Public CSP must not permit inline or evaluated scripts.");
assert(csp["style-src"]?.join(" ") === "'self'", "Public CSP stylesheets must be self-hosted.");
assert(csp["style-src-attr"]?.join(" ") === "'unsafe-inline'", "Public CSP must retain the narrow dynamic style-attribute allowance used by maps and meters.");
assert(csp["img-src"]?.join(" ") === "'self' data: blob: https://sandfest-api.heyelab.com", "Public CSP images must be limited to bundled assets, local data/blob images, and approved API-hosted sponsor logos.");
assert(csp["connect-src"]?.includes("https://sandfest-api.heyelab.com") && csp["connect-src"]?.includes("https://challenges.cloudflare.com"), "Public CSP must allow the dedicated production API and Turnstile connections.");
assert(csp["frame-src"]?.join(" ") === "https://challenges.cloudflare.com", "Public CSP frames must be limited to Turnstile.");
for (const directive of ["object-src", "base-uri"]) {
  assert(csp[directive]?.join(" ") === "'none'", `Public CSP ${directive} must be disabled.`);
}
assert(csp["form-action"]?.join(" ") === "'self'", "Public CSP forms must submit only to the same origin.");
assert("upgrade-insecure-requests" in csp, "Public CSP must upgrade mixed-content requests.");
assert(publicHtml.includes('<meta name="referrer" content="no-referrer"'), "Public production artifact is missing its referrer policy.");
assert(!adminHtml.includes("Content-Security-Policy"), "Admin artifact must rely on its deployment response headers, not the public meta policy.");
assert(!publicHtml.includes("fonts.googleapis.com") && !publicHtml.includes("fonts.gstatic.com"), "Public artifact still depends on Google-hosted fonts.");
assert(publicStylesheets.includes("font-family:Inter") && publicStylesheets.includes("font-family:\"Instrument Serif\""), "Public artifact is missing its self-hosted brand fonts.");
assert(publicAssets.some(file => file.endsWith(".woff2")), "Public artifact is missing bundled font files.");
assert(robots === "User-agent: *\nAllow: /\n", "Public artifact has an invalid or unexpected robots.txt policy.");
assert(publicHtml.includes("optimized/hero-1440.webp") && publicHtml.includes('fetchpriority="high"'), "Public artifact is missing its optimized hero preload.");
assert(mediaDerivatives.derivatives?.length >= 30, "Public artifact is missing its optimized media catalog.");
assert(publicMediaManifestSafety(publicMediaManifest).ready, "Public media manifest exposes internal fields or filesystem paths.");
const curatedGalleryAssets = selectPublicMediaAssets(publicMediaManifest.assets, PUBLIC_GALLERY_MEDIA);
const curatedFieldAssets = selectPublicMediaAssets(publicMediaManifest.assets, PUBLIC_FIELD_MEDIA);
assert(curatedGalleryAssets.length === PUBLIC_GALLERY_MEDIA.length, "Public artifact is missing a curated gallery photograph.");
assert(curatedFieldAssets.length === PUBLIC_FIELD_MEDIA.length, "Public artifact is missing a curated field photograph.");
const galleryDerivativeSources = mediaDerivatives.derivatives
  .filter(derivative => derivative.kind === "gallery")
  .map(derivative => derivative.sourcePath);
const fieldDerivativeSources = mediaDerivatives.derivatives
  .filter(derivative => derivative.kind === "field")
  .map(derivative => derivative.sourcePath);
assert(JSON.stringify(galleryDerivativeSources) === JSON.stringify(curatedGalleryAssets.map(asset => asset.publicPath)), "Responsive gallery derivatives do not match the curated public selection.");
assert(JSON.stringify(fieldDerivativeSources) === JSON.stringify(curatedFieldAssets.map(asset => asset.publicPath)), "Responsive field derivatives do not match the curated public selection.");
const optimizedMediaBytes = mediaDerivatives.derivatives
  .flatMap(derivative => derivative.sources ?? [])
  .reduce((sum, source) => sum + Number(source.bytes || 0), 0);
assert(optimizedMediaBytes < 2 * 1024 * 1024, "Public optimized media exceeds the 2 MB offline presentation budget.");
for (const derivative of mediaDerivatives.derivatives) {
  assert(derivative.defaultPath?.startsWith("/assets/sandfest-media/optimized/"), `Optimized media default escaped its directory for ${derivative.sourcePath}.`);
  for (const source of derivative.sources ?? []) {
    assert(await exists(path.join(publicDir, source.publicPath.replace(/^\/+/, ""))), `Optimized media file is missing: ${source.publicPath}.`);
  }
}
const workerAssetsMatch = publicWorker.match(/const BUILD_ASSETS = (\[[\s\S]*?\]);/);
assert(workerAssetsMatch, "Public service worker is missing its compiled precache manifest.");
const workerAssets = JSON.parse(workerAssetsMatch[1]);
const workerMediaMatch = publicWorker.match(/const MEDIA_ASSETS = (\[[\s\S]*?\]);/);
assert(workerMediaMatch, "Public service worker is missing its optimized media precache manifest.");
const workerMedia = JSON.parse(workerMediaMatch[1]);
const expectedWorkerAssets = publicAssets.filter(file => /\.(?:css|js|woff2?)$/i.test(file)).map(file => `assets/${file}`).sort();
assert(JSON.stringify(workerAssets) === JSON.stringify(expectedWorkerAssets), "Public service worker precache does not match the compiled asset set.");
const expectedWorkerMedia = [...new Set(mediaDerivatives.derivatives.flatMap(derivative => derivative.sources.map(source => source.publicPath.replace(/^\/+/, ""))))].sort();
assert(JSON.stringify(workerMedia) === JSON.stringify(expectedWorkerMedia), "Public service worker precache does not match the optimized media set.");
assert(/const CACHE_VERSION = "sandfest-public-[a-f0-9]{12}";/.test(publicWorker), "Public service worker cache is not build-versioned.");
assert(publicWorker.includes("cache.addAll(APP_SHELL)"), "Public service worker does not require the complete offline shell during install.");
assert(!publicWorker.includes("__BUILD_ID__") && !publicWorker.includes("__BUILD_ASSETS__") && !publicWorker.includes("__MEDIA_ASSETS__"), "Public service worker contains unresolved build placeholders.");
assert(publicJavaScript.includes("serviceWorker.register"), "Public artifact is missing production worker registration.");
assert(visitorSource.includes("import.meta.env.PROD") && visitorSource.includes("registration.unregister()") && visitorSource.includes('key.startsWith("sandfest-public-")'), "Development mode does not clean up stale production worker state.");
assert(!(await exists(path.join(adminDir, "manifest.webmanifest"))), "Admin artifact contains the public app manifest.");
assert(!(await exists(path.join(adminDir, "sw.js"))), "Admin artifact contains the public service worker.");
assert(!(await exists(path.join(adminDir, "data"))), "Admin artifact contains public visitor data.");
assert(publicAssets.some(file => /^main-[^.]+\.js$/.test(file)), "Public artifact is missing its visitor JavaScript bundle.");
assert(!publicAssets.some(file => /^admin-[^.]+\.js$/.test(file)), "Public artifact contains an admin JavaScript bundle.");
assert(adminAssets.some(file => /^admin-[^.]+\.js$/.test(file)), "Admin artifact is missing its operations JavaScript bundle.");
assert(!adminAssets.some(file => /^main-[^.]+\.js$/.test(file)), "Admin artifact contains a visitor JavaScript bundle.");
for (const marker of boardDemoCredentialMarkers) {
  assert(!publicHtml.includes(marker), `Public production HTML contains the board demo credential marker ${marker}.`);
  assert(!adminHtml.includes(marker), `Admin production HTML contains the board demo credential marker ${marker}.`);
  assert(!publicJavaScript.includes(marker), `Public production artifact contains the board demo credential marker ${marker}.`);
  assert(!adminJavaScript.includes(marker), `Admin production artifact contains the board demo credential marker ${marker}.`);
}
for (const marker of ["admin-partner-kpis", "admin-receivables-aging", "admin-outreach-prospects", "admin-condition-cameras", "admin-deployment-checks", "data-deployment-filter"]) {
  assert(adminJavaScript.includes(marker), `Admin artifact is missing the full operations marker ${marker}.`);
}
for (const marker of ["admin-import-volunteers", "admin-commit-volunteer-import", "/api/admin/volunteers/import", "volunteers:write"]) {
  assert(adminJavaScript.includes(marker), `Admin artifact is missing the VolunteerLocal reconciliation marker ${marker}.`);
}
for (const marker of ["admin-import-booths", "admin-commit-booth-import", "/api/admin/booths/import", "booths:write"]) {
  assert(adminJavaScript.includes(marker), `Admin artifact is missing the Eventeny booth reconciliation marker ${marker}.`);
}
for (const marker of ["admin-workspace-nav", "One governed workspace", "admin-system-monitor", "admin-island-conditions"]) {
  assert(adminJavaScript.includes(marker), `Admin artifact is missing the focused operations marker ${marker}.`);
}
assert(/\.admin-surface>section:not\(\.admin-config-section\)\{display:none\}/.test(adminStylesheets), "Admin artifact does not suppress visitor, prototype, and roadmap sections.");
for (const marker of ["Redirecting to secure sign-in", "sandfest-admin-build-verification", "code_challenge"]) {
  assert(adminJavaScript.includes(marker), `Admin artifact is missing the OIDC marker ${marker}.`);
  assert(!publicJavaScript.includes(marker), `Public artifact contains the admin OIDC marker ${marker}.`);
}
for (const marker of ["challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", "1x00000000000000000000AA"]) {
  assert(publicJavaScript.includes(marker), `Public artifact is missing the Turnstile marker ${marker}.`);
  assert(!adminJavaScript.includes(marker), `Admin artifact contains the public Turnstile marker ${marker}.`);
}
for (const marker of ["vendor_application", "sponsor_inquiry"]) {
  assert(publicJavaScript.includes(marker), `Public artifact is missing the Turnstile action ${marker}.`);
}
for (const marker of ["public-sponsor-showcase", "/api/public/sponsor-showcase/assets/"]) {
  assert(publicJavaScript.includes(marker), `Public artifact is missing the approved sponsor showcase marker ${marker}.`);
}
for (const marker of ["/api/public/tickets", "idempotency-key", "checkout.stripe.com"]) {
  assert(publicJavaScript.includes(marker), `Public artifact is missing the ticket-commerce marker ${marker}.`);
}
assert(visitorSource.includes('checkoutUrl.hostname !== "checkout.stripe.com"'), "Visitor checkout does not require Stripe's exact hosted-checkout hostname.");
const serializedPublicTickets = JSON.stringify(publicTicketCatalog);
assert(publicTicketCatalog.checkoutEndpoint === "/api/stripe/create-checkout-session", "Static ticket catalog contains an unsafe checkout endpoint.");
assert(!serializedPublicTickets.includes("stripePriceId") && !serializedPublicTickets.includes("price_replace"), "Static ticket catalog exposes private or placeholder Stripe configuration.");
assert(publicTicketCatalog.products?.length > 0 && publicTicketCatalog.products.every(product => product.availableForCheckout === false), "Static ticket catalog must fail closed until the ready API is loaded.");

const serializedPublicRoster = JSON.stringify(publicSculptorRoster);
assert(publicSculptorRoster.meta?.eventId === "texas-sandfest-2027" && publicSculptorRoster.meta?.publicationStatus === "unpublished", "Static sculptor roster is not current-event and publication-gated.");
assert(publicSculptorRoster.sculptors?.length === 0 && publicSculptorRoster.entries?.length === 0 && publicSculptorRoster.pois?.length === 0, "Static sculptor roster exposes records before publication.");
assert(sourceVoting.publicationStatus === "unpublished" && sourceVoting.votingOpen === false && sourceVoting.entries?.length === 0 && sourceVoting.votes?.length === 0, "Repository voting seed exposes an unpublished ballot.");
assert(sourcePassport.hunt?.active === false && sourcePassport.checkpoints?.length === 0, "Repository passport seed exposes unpublished checkpoints.");
assert(!(await exists(path.join(publicDir, "board-demo"))) && !(await exists(path.join(publicDir, "data", "sculptors-demo.json"))) && !(await exists(path.join(publicDir, "data", "live-beach-demo.json"))), "Production artifact contains local board-demonstration data files.");
for (const marker of fictionalPublicContentMarkers) {
  assert(!serializedPublicRoster.includes(marker), `Public sculptor roster contains fictional marker ${marker}.`);
  assert(!publicJavaScript.includes(marker), `Public production JavaScript contains fictional marker ${marker}.`);
  assert(!adminJavaScript.includes(marker), `Admin production JavaScript contains fictional marker ${marker}.`);
}
assert(publicJavaScript.includes("Event-day monitoring is not active.") && publicJavaScript.includes("No unapproved artist data is shown."), "Production visitor artifact does not fail closed for unavailable Live Beach or sculptor content.");
assert(visitorSource.includes("publicSculptorRosterPublication") && visitorSource.includes("if (LIVE_BEACH_DEMO_ENABLED) startLiveBeach();"), "Visitor source does not enforce roster publication and local-only Live Beach activation.");
assert(visitorSource.includes('const boardDemoRuntimeEnabled = LIVE_BEACH_DEMO_ENABLED && runtime?.mode === "board_demo";'), "Board runtime copy is not gated by local demonstration content.");
assert(visitorSource.includes('const DEVELOPMENT_PUBLIC_API = import.meta.env.DEV ? await import("./dev-public-api-base.js") : null;'), "API query overrides are not isolated in a development-only module.");
assert(!publicJavaScript.includes("sandfest_api_base") && !adminJavaScript.includes("sandfest_api_base"), "A production artifact contains the local API override path.");
const publicVotingLoader = visitorSource.slice(visitorSource.indexOf("async function loadVoting"), visitorSource.indexOf("async function castVote"));
assert(publicVotingLoader.includes("if (!sculptorRosterVisible) return null;"), "Voting can load before the sculptor roster is published.");
assert(visitorSource.includes("if (sculptorRosterVisible) initialPublicLoads.push(loadVoting());") && visitorSource.includes("if (sculptorRosterVisible) recoveryLoads.push(loadVoting());"), "Public startup or recovery fetches an unpublished ballot.");

assert(publicBootstrap.guide?.startDate === "2027-04-16" && publicBootstrap.guide?.endDate === "2027-04-18", "Public artifact does not contain the governed 2027 event guide.");
assert(publicBootstrap.guide?.dailyOpen === "09:00" && publicBootstrap.guide?.dailyClose === "19:30", "Public artifact contains stale event hours.");
const serializedPublicBootstrap = JSON.stringify(publicBootstrap);
assert(publicAppBootstrapSafety(publicBootstrap).ready, "Public static bootstrap violates the approved visitor projection.");
assert(JSON.stringify(Object.keys(publicBootstrap).sort()) === JSON.stringify(["alert", "guide", "schedule", "zones"]), "Public static bootstrap contains an unexpected root collection.");
assert(publicBootstrap.schedule?.every(item => item.category !== "Staff"), "Public static bootstrap contains a staff-only schedule entry.");
assert(publicBootstrap.zones?.every(item => !Object.hasOwn(item, "status")), "Public static bootstrap exposes operational zone status.");
assert(!/(sponsors|vendors|coverage|financeSignals|ticketOptions|publishedBy|invoiceStatus)/.test(serializedPublicBootstrap), "Public static bootstrap exposes private workflow data.");
assert(JSON.stringify(publicDataFiles) === JSON.stringify(["app-bootstrap.json", "sculptors.json", "ticket-products.json"]), "Public artifact contains an unapproved data manifest.");
for (const marker of [
  "/Users/nick/Projects/Teaxs Sandfest",
  "2026-04-30T20:58:47.426Z",
  "https://www.eventeny.com/pride/",
  "Volunteer captain briefing",
  "Needs QBO match"
]) {
  assert(!publicJavaScript.includes(marker), `Public production JavaScript contains internal data marker ${marker}.`);
}
for (const marker of [
  "Scraped frontend media",
  "should become reviewed records",
  "Run npm run media:download",
  "inheriting operational chaos"
]) {
  assert(!visitorSource.includes(marker), `Visitor source contains unfinished public copy: ${marker}.`);
}
assert(!publicJavaScript.includes("April 17-19, 2026") && !publicJavaScript.includes("April 17, 2026"), "Public artifact contains stale 2026 event dates.");
assert(visitorSource.includes('class="skip-link"') && visitorSource.includes('href="#top"'), "Visitor source is missing its keyboard skip link.");
assert(visitorSource.includes('aria-label="Ask Sandy a question"') && visitorSource.includes('maxlength="280"'), "Public concierge input is not accessible and bounded.");
assert(visitorSource.includes('id="chat" class="chat-log keyboard-scroll-region" role="log" aria-label="Ask Sandy conversation" aria-live="polite"') && visitorSource.includes('aria-relevant="additions" tabindex="0"'), "Public concierge responses are not announced as a named, keyboard-accessible live conversation log.");
for (const id of [
  "booth-list",
  "admin-fleet-assets",
  "admin-fleet-open",
  "admin-volunteers-zones",
  "admin-volunteers-gaps",
  "admin-sms-campaigns",
  "admin-passport-checkpoints",
  "admin-incidents",
  "admin-partner-milestones",
  "admin-receivables-accounts",
  "admin-receivables-exceptions",
  "admin-partner-applications",
  "admin-partner-followups",
  "admin-outreach-campaigns",
  "admin-outreach-prospects",
  "admin-condition-cameras"
]) {
  const tag = visitorSource.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] || "";
  assert(tag.includes("keyboard-scroll-region") && tag.includes('tabindex="0"') && tag.includes('aria-label="'), `${id} is not a named, keyboard-accessible scroll region.`);
}
assert(visitorSource.includes('/api/public/concierge') && visitorSource.includes('className = "concierge-sources"'), "Public concierge is not wired to governed source-cited answers.");
assert(!visitorSource.includes("const knowledge = [") && !visitorSource.includes("What should the iOS app do first?"), "Public concierge still contains the internal hard-coded roadmap answer table.");
assert(visitorSource.includes('id="checkout-status" class="checkout-status" role="status" aria-live="polite"'), "Ticket checkout is missing its live status region.");
assert(visitorSource.includes('id="admin-api-status" class="checkout-status" role="status" aria-live="polite"'), "Admin operations are missing their live status region.");
assert(visitorSource.includes('id="admin-deployment-checks" class="admin-deployment-checks" aria-live="polite"'), "Deployment readiness checks are missing their live status region.");
assert(visitorSource.includes('data-deployment-filter="attention" aria-pressed="true"') && visitorSource.includes('data-deployment-filter="all" aria-pressed="false"'), "Deployment readiness filters are missing pressed-state semantics.");
assert(visitorSource.includes("const groupSummary = groupSummaries.get(group);") && visitorSource.includes("${passing}/${total} passing"), "Filtered deployment views do not preserve full-group readiness totals.");
assert(visitorSource.includes('id="island-condition-updated" role="status" aria-live="polite"'), "Island Conditions is missing its live refresh status.");
assert(visitorSource.includes('const ferryLive = ferry.freshness?.state === "live";') && visitorSource.includes('Current directional waits unavailable'), "Island Conditions does not fail closed for stale ferry estimates.");
assert(visitorSource.includes('const observation = camera.freshness?.state === "live"') && visitorSource.includes('${observation?.queueLength ?? "-"}'), "Island Conditions does not fail closed for stale or unarmed camera metrics.");
assert(visitorSource.includes('id="admin-volunteer-import-result" class="admin-import-result admin-import-wide" aria-live="polite"'), "VolunteerLocal reconciliation is missing its live preview status.");
assert(visitorSource.includes('id="admin-booth-import-result" class="admin-import-result admin-import-wide" aria-live="polite"'), "Eventeny booth reconciliation is missing its live preview status.");
assert(visitorSource.includes('class="site-footer"') && visitorSource.includes('aria-label="Festival contact links"'), "Public source is missing its contact footer landmark.");
assert(visitorSource.includes('<h1>Pricing, sponsorships, and event controls</h1>'), "Admin source is missing its primary heading.");
for (const marker of [
  "operating profile review notes",
  "brand profile review notes",
  "delivery proof URL",
  "custom deliverable due date",
  "outreach suppression reason"
]) {
  assert(visitorSource.includes(marker), `Admin source is missing the accessible control marker ${marker}.`);
}
assert(visitorSource.includes('if (ADMIN_ENTRY) {\n      link.dataset.audience = "ops";') && visitorSource.includes('if (OPS_DEMO_ENABLED) {\n    window.addEventListener("hashchange"'), "Admin workspace navigation is not isolated from the visitor demo mode switch.");
assert(visitorSource.includes('<a href="#admin-config">Overview</a>')
  && visitorSource.includes('<a href="#admin-documents">Documents</a>')
  && visitorSource.includes('<a href="#admin-partners">Partners</a>')
  && visitorSource.includes('const targetHash = requestedMode === "ops" ? "#admin-config" : "#top";'), "The local board mode switch does not land on functional operations workspaces.");
assert(visitorSource.includes('<input name="reviewDueAt" type="datetime-local" required />')
  && visitorSource.includes('<select name="ownerTeam" required><option value="operations" selected>Operations</option>')
  && visitorSource.includes('reviewTask ? ` · Task ${escapeHtml(conditionLabel(reviewTask.status))}`'), "Document intake does not expose its accountable review deadline and task state.");
assert(visitorSource.includes("if (BOARD_DEMO_ACCESS.enabled) boardDemoWorkspaceLoaded = true;\n    stabilizeRenderedHashTarget();"), "Async operations loading can push the selected board-demo workspace out of view.");
assert(publicStylesheets.includes(".admin-config-section{max-width:1240px;scroll-margin-top:72px}")
  && publicStylesheets.includes("#admin-documents,#admin-system-monitor,#admin-revenue,#admin-fleet,#admin-volunteers,#admin-partners,#admin-island-conditions{scroll-margin-top:132px}"), "Operations shortcuts can land underneath the sticky workspace navigation.");
assert(!visitorSource.includes('class="lb-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true"'), "Interactive Live Beach SVG is hidden from assistive technology.");
assert(!publicStylesheets.includes("outline:none") && !publicStylesheets.includes("outline: none"), "Public stylesheet removes a keyboard focus outline.");
assert(publicStylesheets.includes("outline:3px solid var(--sun)") && adminStylesheets.includes("outline:3px solid var(--sun)"), "Compiled surfaces are missing the high-visibility keyboard focus treatment.");
assert(publicStylesheets.includes("[hidden]{display:none!important}") && adminStylesheets.includes("[hidden]{display:none!important}"), "Compiled surfaces allow component display rules to override hidden states.");
assert(visitorSource.includes("armPartnerBotProtection();") && !visitorSource.includes("initPartnerBotProtection(),"), "Partner bot protection is not deferred until form interaction.");
assert((visitorSource.match(/\bfetch\(/g) || []).length === 1 && visitorSource.includes("fetchWithTimeout"), "Browser requests are not consistently bounded by the shared timeout wrapper.");
assert(visitorSource.includes("Your private access is still saved; try again.") && visitorSource.includes("!activePartnerPortalApplication"), "Transient partner-portal failures do not preserve private access and the last loaded view.");
assert(visitorSource.includes('const portalAccess = partnerPortalAccessFromFragment();\n    if (portalAccess) {\n      loadPartnerPortalStatus(portalAccess, { scroll: true });')
  && visitorSource.includes('const outreachAccess = outreachPreferenceAccessFromFragment();\n    if (outreachAccess) {\n      loadOutreachPreference(outreachAccess, { scroll: true });'), "Same-document private links do not switch partner or outreach views.");
assert(visitorSource.includes("const loadVersion = ++partnerPortalLoadVersion;")
  && visitorSource.includes("if (switchingAccess) {\n    activePartnerPortalApplication = null;")
  && visitorSource.includes("if (loadVersion !== partnerPortalLoadVersion) return;")
  && visitorSource.includes("if (loadVersion === partnerPortalLoadVersion) button.disabled = false;"), "Partner link switching can expose or restore a stale private portal response.");
assert(visitorSource.includes("const loadVersion = ++outreachPreferenceLoadVersion;")
  && visitorSource.includes("lastLoadedOutreachPreference = { access, preference: data.preference };")
  && visitorSource.includes("The previously loaded preference remains available.")
  && visitorSource.includes("No outreach recipient is shown because this private link could not be verified.")
  && visitorSource.includes("if (loadVersion !== outreachPreferenceLoadVersion) return;"), "Outreach preference links can erase valid access or render stale overlapping responses.");
assert(visitorSource.includes("const loadVersion = ++sponsorInvitationLoadVersion;")
  && visitorSource.includes("if (loadVersion !== sponsorInvitationLoadVersion) return;"), "Overlapping sponsor invitation links can render an older invitation.");
assert(visitorSource.indexOf('window.location.hash.startsWith("#sponsor-invitation?")') < visitorSource.indexOf('body: JSON.stringify({ token })')
  && visitorSource.indexOf('window.location.hash.startsWith("#outreach-preferences?")') < visitorSource.indexOf('body: JSON.stringify(access)'), "Private fragment capabilities are not concealed before provider requests.");
assert(visitorSource.includes("[400, 401, 403, 409, 422].includes(error.status)") && visitorSource.includes("retry protection remains active"), "Partner intake does not distinguish correctable errors from retry-safe transient failures.");
const publicAlertLoader = visitorSource.slice(visitorSource.indexOf("async function loadPublicAlert"), visitorSource.indexOf("function applyPublicEventGuide"));
assert(publicAlertLoader && !publicAlertLoader.includes("renderPublicAlert(null)"), "A transient public-alert fetch failure clears the last known safety message.");
assert(visitorSource.includes('loadIslandConditions({ force: true, preserveOnError: true })'), "Manual Island Conditions refresh does not preserve the last known reading on failure.");
assert(visitorSource.includes('window.addEventListener("online", recoverPublicConnectivity)') && visitorSource.includes("recoveryLoads.push(loadPartnerPortalStatus(portalAccess))"), "Public connectivity recovery does not refresh live data and retained partner access.");

console.log("Static entrypoint isolation verified: visitor entry is 2027-current, CSP-hardened, self-hosted, Turnstile-protected, and public-only; admin entry is OIDC ops-only.");

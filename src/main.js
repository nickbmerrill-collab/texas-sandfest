import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import { escapeHtml, escapeAttr } from "../lib/html-escape.mjs";
import { normalizeEventGuide } from "../lib/event-guide.mjs";
import {
  OPS_DEMO_SECTION_IDS,
  resolveInitialSiteMode,
  siteModeForHash
} from "../lib/site-mode.mjs";
import { boardDemoAccessConfig } from "../lib/board-demo-access.mjs";
import {
  forgetMatchingPartnerPortalAccess,
  partnerPortalSafeHash,
  shouldForgetPartnerPortalAccess
} from "../lib/partner-portal-session.mjs";
import {
  DEFAULT_VENDOR_OFFERINGS,
  publicVendorOffering
} from "../lib/vendor-offerings.mjs";
import { partnerContactNotice } from "../lib/partner-consent.mjs";
import {
  DEFAULT_SPONSOR_PACKAGES,
  publicSponsorPackage
} from "../lib/sponsor-packages.mjs";
import { publicIslandConditionsRefreshDelay } from "../lib/island-conditions.mjs";
import { DEFAULT_EVENT_ID } from "../lib/event-context.mjs";
import { publicSculptorRosterPublication } from "../lib/public-roster.mjs";
import {
  PUBLIC_FIELD_MEDIA,
  PUBLIC_GALLERY_MEDIA,
  selectPublicMediaAssets
} from "../lib/public-media-selection.mjs";

const adminTicketPolicyUi = (import.meta.env.DEV || import.meta.env.VITE_SANDFEST_SURFACE === "admin")
  ? await import("./admin-ticket-policy.js")
  : null;

const siteBase = import.meta.env.BASE_URL || "/";
const sitePath = value => {
  const input = String(value || "");
  if (/^(https?:|data:|blob:)/i.test(input)) return input;
  return `${siteBase}${input.replace(/^\/+/, "")}`;
};

const REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error("The request timed out. Check the connection and try again.");
      timeoutError.code = "request_timeout";
      throw timeoutError;
    }
    if (error instanceof TypeError || /failed to fetch|network error|load failed/i.test(String(error?.message || ""))) {
      const networkError = new Error("We could not reach SandFest. Check the connection and try again.");
      networkError.code = "network_error";
      throw networkError;
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function friendlyRequestError(error, fallback = "The request could not be completed.") {
  if (error?.code === "request_timeout") return error.message;
  if (error instanceof TypeError || /failed to fetch|network error|load failed/i.test(String(error?.message || ""))) {
    return "We could not reach SandFest. Check the connection and try again.";
  }
  return error?.message || fallback;
}

const safeExternalHref = value => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

const documentSurface = document.querySelector('meta[name="sandfest-surface"]')?.content;
const buildSurface = import.meta.env.VITE_SANDFEST_SURFACE;
const ADMIN_ENTRY = buildSurface === "admin" || (!buildSurface && documentSurface === "admin");
const ADMIN_AUTH_MODE = ADMIN_ENTRY
  ? String(import.meta.env.VITE_SANDFEST_AUTH_MODE || "token").trim().toLowerCase()
  : "token";
const CONFIGURED_ADMIN_API_BASE = String(import.meta.env.VITE_SANDFEST_API_BASE_URL || "").replace(/\/+$/, "");
const TURNSTILE_SITE_KEY = ADMIN_ENTRY ? "" : String(import.meta.env.VITE_SANDFEST_TURNSTILE_SITE_KEY || "").trim();
let adminAuthClient = null;
let adminAuthInitializationError = null;
let partnerBotProtection = { enabled: false, tokenFor: () => "", reset: () => {} };
let partnerBotProtectionPromise = null;
const DEVELOPMENT_PUBLIC_API = import.meta.env.DEV ? await import("./dev-public-api-base.js") : null;
const DEVELOPMENT_PUBLIC_API_BASE = DEVELOPMENT_PUBLIC_API?.developmentPublicApiBase() || "";

if (ADMIN_ENTRY && ADMIN_AUTH_MODE === "oidc") {
  try {
    const { createAdminAuthClient } = await import("./admin-auth.js");
    adminAuthClient = createAdminAuthClient({
      env: {
        VITE_SANDFEST_AUTH_MODE: import.meta.env.VITE_SANDFEST_AUTH_MODE,
        VITE_SANDFEST_AUTH_ISSUER: import.meta.env.VITE_SANDFEST_AUTH_ISSUER,
        VITE_SANDFEST_AUTH_CLIENT_ID: import.meta.env.VITE_SANDFEST_AUTH_CLIENT_ID,
        VITE_SANDFEST_AUTH_REDIRECT_URI: import.meta.env.VITE_SANDFEST_AUTH_REDIRECT_URI,
        VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI: import.meta.env.VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI,
        VITE_SANDFEST_AUTH_METADATA_URL: import.meta.env.VITE_SANDFEST_AUTH_METADATA_URL,
        VITE_SANDFEST_AUTH_SCOPES: import.meta.env.VITE_SANDFEST_AUTH_SCOPES,
        VITE_SANDFEST_AUTH_AUDIENCE: import.meta.env.VITE_SANDFEST_AUTH_AUDIENCE
      },
      onSessionExpired: () => {
        renderAdminAuthState(false);
        setAdminStatus("Your session expired. Sign in again.", "error");
      }
    });
  } catch (error) {
    adminAuthInitializationError = error;
  }
}

const loadPublicJson = path => ADMIN_ENTRY
  ? Promise.resolve(null)
  : fetchWithTimeout(sitePath(path))
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);

const localBoardContentEnabled = !ADMIN_ENTRY && import.meta.env.DEV;
const sculptorDataPromise = localBoardContentEnabled
  ? import("./board-demo/sculptors-demo.json").then(module => module.default)
  : loadPublicJson("data/sculptors.json");
const liveBeachDemoPromise = localBoardContentEnabled
  ? import("./board-demo/live-beach-demo.json").then(module => module.default)
  : Promise.resolve(null);
const crawlSummaryPromise = Promise.resolve(null);
const incomingInventoryPromise = Promise.resolve(null);

const [
  mediaManifest,
  mediaDerivatives,
  crawlSummary,
  incomingInventory,
  ticketCatalog,
  sculptorData,
  appBootstrap,
  liveBeachDemo
] = await Promise.all([
  loadPublicJson("assets/sandfest-media/media-manifest.json"),
  loadPublicJson("assets/sandfest-media/media-derivatives.json"),
  crawlSummaryPromise,
  incomingInventoryPromise,
  loadPublicJson("data/ticket-products.json"),
  sculptorDataPromise,
  loadPublicJson("data/app-bootstrap.json"),
  liveBeachDemoPromise
]);
let runtimeDataMode = null;

const mediaDerivativeBySource = new Map(
  (mediaDerivatives?.derivatives ?? []).map(derivative => [derivative.sourcePath, derivative])
);
const mediaAssets = (mediaManifest?.assets ?? []).map(asset => {
  const sourcePublicPath = asset.publicPath;
  const derivative = mediaDerivativeBySource.get(sourcePublicPath);
  const sources = (derivative?.sources ?? []).map(source => ({
    ...source,
    publicPath: sitePath(source.publicPath)
  }));
  return {
    ...asset,
    sourcePublicPath,
    originalPublicPath: sitePath(sourcePublicPath),
    publicPath: sitePath(derivative?.defaultPath ?? sourcePublicPath),
    width: derivative?.width ?? null,
    height: derivative?.height ?? null,
    srcset: sources.map(source => `${source.publicPath} ${source.width}w`).join(", ")
  };
});
const responsiveImageAttributes = (asset, sizes) => {
  const attributes = [`src="${escapeAttr(asset.publicPath)}"`];
  if (asset.srcset) attributes.push(`srcset="${escapeAttr(asset.srcset)}"`, `sizes="${escapeAttr(sizes)}"`);
  if (asset.width && asset.height) attributes.push(`width="${asset.width}"`, `height="${asset.height}"`);
  return attributes.join(" ");
};
const heroAsset = mediaAssets.find(asset => asset.role === "hero");
const heroImage = heroAsset?.publicPath
  ?? "https://static.wixstatic.com/media/f800df_53497f8c3802433885cf16fd00de0b7b~mv2.jpg/v1/fill/w_2500,h_1666,al_c/f800df_53497f8c3802433885cf16fd00de0b7b~mv2.jpg";
const officialLogo = mediaAssets.find(asset => asset.role === "official_brand")?.publicPath;
const sponsorLogoAssets = mediaAssets.filter(asset => asset.category === "sponsor-logos").slice(0, 18);
const galleryAssets = selectPublicMediaAssets(mediaAssets, PUBLIC_GALLERY_MEDIA);
const featuredPhotoAssets = selectPublicMediaAssets(mediaAssets, PUBLIC_FIELD_MEDIA);
const mapAssets = mediaAssets.filter(asset => asset.category === "maps").slice(0, 4);
let publicTicketCatalogState = ticketCatalog || { currency: "usd", products: [] };
let ticketProducts = publicTicketCatalogState.products ?? [];
const ticketCart = new Map();
let ticketCheckoutRetryKey = null;
let ticketCheckoutRequestFingerprint = null;
let ticketDemoCheckoutState = null;
let acceptedTicketPolicyKey = null;

const sculptorPublication = publicSculptorRosterPublication(sculptorData, {
  eventId: DEFAULT_EVENT_ID,
  allowSample: localBoardContentEnabled
});
const sculptorRosterPublished = sculptorPublication.mode === "published";
const sculptorRosterDemo = sculptorPublication.mode === "demo";
const sculptorRosterVisible = sculptorPublication.visible;
const visibleSculptorData = sculptorRosterVisible ? sculptorData : null;
const sculptors = visibleSculptorData?.sculptors ?? [];
const sculptureEntries = visibleSculptorData?.entries ?? [];
const sculpturePois = visibleSculptorData?.pois ?? [];
const sculptorLegend = visibleSculptorData?.legend ?? [];
const LIVE_BEACH_DEMO_ENABLED = sculptorRosterDemo && Boolean(liveBeachDemo);
const sculptorsById = new Map(sculptors.map(s => [s.id, s]));
const entriesById = new Map(sculptureEntries.map(e => [e.id, e]));
const divisionLabels = {
  master_solo: "Master Solo",
  master_duo: "Master Duo",
  semi_pro: "Semi-Pro",
  amateur: "Amateur",
  non_competing_master: "Non-Competing Master"
};
const statusLabels = {
  planning: "Setting up",
  sculpting: "Sculpting live",
  complete: "Complete",
  judged: "Judged"
};
const legendColorByKey = new Map(sculptorLegend.map(l => [l.colorKey, l.colorHex]));
function divisionLabel(key) {
  return divisionLabels[key] ?? key;
}
let adminConfigState = null;
let adminSessionState = null;
let adminDeploymentState = null;
let adminDeploymentFilter = "attention";
let adminPartnerState = null;
let selectedOutreachCampaignId = null;
let adminConditionsState = null;
let adminDocumentState = null;
let revenueImportPreview = null;
let volunteerImportPreview = null;
let staffImportPreview = null;
let boothImportPreview = null;
let partnerImportPreview = null;
let outreachImportPreview = null;
let outreachDiscoveryPreview = null;
let activeSponsorInvitationToken = null;
let sponsorInvitationLoadVersion = 0;
let activePartnerPortalAccess = null;
let activePartnerPortalApplication = null;
let partnerPortalLoadVersion = 0;
let publicSponsorPackages = DEFAULT_SPONSOR_PACKAGES.map(publicSponsorPackage);
let publicVendorOfferings = DEFAULT_VENDOR_OFFERINGS.map(publicVendorOffering);
const sponsorContactNotice = partnerContactNotice("sponsor");
const vendorInterestContactNotice = partnerContactNotice("vendor", "interest");
const taskBoardFilters = { status: "active", assignment: "all", query: "" };
let incidentBoardFilter = "active";
const SANDFEST_OUTREACH_CENTER = Object.freeze({
  id: "sandfest",
  label: "Texas SandFest, Port Aransas",
  latitude: 27.8339,
  longitude: -97.0611
});

const defaultEventGuide = {
  id: "texas-sandfest-2027",
  name: "Texas SandFest",
  startDate: "2027-04-16",
  endDate: "2027-04-18",
  dailyOpen: "09:00",
  dailyClose: "19:30",
  timeZone: "America/Chicago",
  location: "On the beach, Port Aransas, TX 78373",
  mission: "The largest beach sand sculpture competition in the USA, supporting local nonprofit organizations and scholarships.",
  phone: "361-267-2474",
  email: "info@texassandfest.org",
  address: "200 S. Alister Street, Suite E, Port Aransas, TX 78373",
  sourceUrl: "https://www.texassandfest.org/knowbeforeyougo",
  sourceCheckedAt: "2026-07-17T00:00:00.000Z",
  publishedAt: "2026-07-17T00:00:00.000Z",
  lastUpdated: "2026-07-17T00:00:00.000Z"
};
const event = normalizeEventGuide(appBootstrap?.guide ?? defaultEventGuide);

const quickStats = [
  ["3", "festival days"],
  ["9", "beach zones"],
  ["11", "sponsorship packages"],
  ["1", "island celebration"]
];

const schedule = (appBootstrap?.schedule ?? [
  { day: "Friday", time: "9:00 AM", title: "Beach gates open", zone: "Entry + ticket exchange", category: "Visitor" },
  { day: "Friday", time: "10:00 AM", title: "Master sculptor showcase begins", zone: "Competition corridor", category: "Competition" },
  { day: "Friday", time: "2:00 PM", title: "Youth build activation", zone: "Family sand lab", category: "Family" }
]).map(item => ({ ...item, type: item.category ?? item.type }));

const zones = [
  { name: "North Gate", detail: "Ticket scan, ADA routing, wristband support", load: 82 },
  { name: "Competition Corridor", detail: "Master, semi-pro, amateur sculpture lines", load: 76 },
  { name: "Food Court", detail: "Vendor row, sanitation, payment help", load: 68 },
  { name: "Family Sand Lab", detail: "Youth activities and parent meetup point", load: 44 },
  { name: "Sponsor Harbor", detail: "VIP, sponsor check-in, hospitality", load: 51 },
  { name: "Command", detail: "Weather, incidents, volunteer dispatch", load: 37 }
];

// The rich Live Beach scene is board-demo content until verified event-day
// camera, schedule, and roster feeds can drive it without synthetic claims.
const sculptures = LIVE_BEACH_DEMO_ENABLED ? liveBeachDemo.sculptures ?? [] : [];
const liveBeachContext = LIVE_BEACH_DEMO_ENABLED ? liveBeachDemo.context ?? {} : {};
const liveBeachSuggestion = liveBeachContext.suggestion ?? {};
const liveBeachSuggestedSculpture = sculptures.find(item => item.id === liveBeachSuggestion.targetId) ?? {};
const liveBeachStats = liveBeachContext.stats ?? {};
const liveBeachInitialTimeline = liveBeachContext.timeline?.[3] ?? {};

const workflows = [
  {
    title: "Visitor Concierge",
    icon: "✦",
    detail: "Answers ticket, schedule, parking, accessibility, pet policy, and vendor questions from one trusted event knowledge base.",
    actions: ["Ask Sandy", "SMS handoff", "Lost party help"]
  },
  {
    title: "Volunteer Ops",
    icon: "◈",
    detail: "Turns signup data into shift coverage, captain briefs, gap alerts, and beach-zone dispatch cards.",
    actions: ["Shift board", "Role fit", "No-show alerts"]
  },
  {
    title: "Sponsor CRM",
    icon: "◇",
    detail: "Tracks sponsor tiers, benefit delivery, booth assets, social proof, and post-event ROI packets.",
    actions: ["Tier tracker", "Asset checklist", "Impact report"]
  },
  {
    title: "Vendor Command",
    icon: "◆",
    detail: "Keeps food/non-food vendors aligned on permits, load-in windows, utilities, inspection state, and urgent notices.",
    actions: ["Load-in map", "Permit status", "Broadcast"]
  }
];

const surfaces = [
  {
    name: "Public Web",
    status: "Operations preview ready",
    role: "Primary visitor surface for tickets, schedules, policies, maps, sponsor visibility, and AI concierge."
  },
  {
    name: "Native iOS",
    status: "Source prototype implemented",
    role: "Local source prototype for guests and staff with cached event data, push alerts, QR/ticket handoff, volunteer check-in, and incident capture. Device QA and distribution remain ahead."
  },
  {
    name: "Port A Local Co",
    status: "Future integration",
    role: "Destination layer for Port Aransas discovery, lodging/food/activity context, local offers, and year-round visitor retention."
  }
];

const dataDomains = [
  ["Plan the visit", "Dates, hours, accessibility guidance, maps, tickets, and festival policies in one trusted place."],
  ["Reach the beach", "Ferry conditions, parking guidance, entrances, walking routes, and timely arrival updates."],
  ["Explore Port Aransas", "Lodging, dining, shopping, and local experiences that extend the festival weekend."],
  ["Support local business", "Sponsor, vendor, and community partner discovery connected to the event journey."],
  ["Share the impact", "Nonprofit support, scholarships, local partnerships, and post-event community results."]
];

const financeFlows = [
  ["Sponsor invoices", "Create or match QuickBooks customers, send invoices, mirror payment status into Sponsor CRM."],
  ["Stripe ticketing", "Capture GA, VIP, Apple Pay, refunds, and payout signals before reconciling reviewed totals into QuickBooks."],
  ["Vendor finance", "Track vendor bills or purchases without mixing accounting status with booth/load-in operations."],
  ["Raffle + merch", "Reconcile sales receipts, payments, and item/category totals after Eventeny or point-of-sale exports."],
  ["Impact reporting", "Pull reviewed totals for nonprofit donations, scholarships, and board-ready post-event reports."]
];

const experiencePanels = [
  {
    audience: "Customer",
    title: "Plan, arrive, navigate, ask.",
    detail: "A public surface for tickets, beach entry, schedule, maps, accessibility, sponsor discovery, and Ask Sandy answers.",
    actions: ["Buy tickets", "Find parking", "Open map", "Ask Sandy"]
  },
  {
    audience: "Admin",
    title: "Run the event without another spreadsheet.",
    detail: "A staff surface for volunteer coverage, incidents, vendor readiness, sponsor fulfillment, finance signals, and content approvals.",
    actions: ["Command board", "Asset review", "Partner CRM", "QuickBooks sync"]
  }
];

const incomingByDomain = new Map((incomingInventory?.folders ?? []).map(folder => [folder.domain, folder]));

const sourcePipelines = [
  {
    name: "Public website",
    status: crawlSummary ? "Live scrape" : "Needs scrape",
    count: crawlSummary?.successfulPages ?? 0,
    detail: "Official pages, policies, schedules, maps, sponsors, vendors, and source links.",
    drop: "data/raw + data/processed"
  },
  {
    name: "Media assets",
    status: mediaManifest ? "Cataloged" : "Needs download",
    count: mediaManifest?.count ?? 0,
    detail: "Official logo, photos, sponsor logos, maps, and social imagery for review.",
    drop: "public/assets/sandfest-media"
  }
];

const incomingPipelines = ["eventeny", "quickbooks", "finance", "ops", "docs", "comms"].map(domain => {
  const folder = incomingByDomain.get(domain);
  return {
    name: folder?.label ?? domain,
    status: folder?.status === "needs_review" ? "Needs review" : domain === "quickbooks" ? "Credential-ready" : "Drop-ready",
    count: folder?.count ?? 0,
    detail: folder?.expected ?? "Waiting for source files.",
    drop: folder?.path ?? `data/incoming/${domain}`,
    handler: folder?.handler
  };
});

const ingestionPipelines = [...sourcePipelines, ...incomingPipelines];
const incomingFiles = incomingInventory?.files ?? [];

const adminTasks = [
  ["Connect Eventeny", "Export current-season tickets, applications, sponsor records, vendor lists, and message threads."],
  ["Connect QuickBooks", "Add Intuit credentials, complete OAuth, then snapshot company info and open invoices."],
  ["Curate media", "Approve public-safe photo sets, sponsor logos, maps, captions, and App Store-safe imagery."],
  ["Normalize roles", "Define guest, volunteer, vendor, sponsor, board, finance, ops, and super-admin permissions."],
  ["Publish app feed", "Promote reviewed records into the shared bootstrap payload used by web and iOS."]
];

const app = document.querySelector("#app");

function formatMoney(cents) {
  if (typeof cents !== "number") return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: publicTicketCatalogState?.currency?.toUpperCase() ?? "USD"
  }).format(cents / 100);
}

function productPrice(product) {
  const amount = formatMoney(product.unitAmount);
  if (amount && publicTicketCatalogState?.checkoutEnvironment === "board_sandbox") return `${amount} demo`;
  return amount ?? product.priceLabel ?? "Set in Stripe";
}

function ticketBadge(product) {
  if (product.requiresReview) return "Review gated";
  if (product.availableForCheckout && publicTicketCatalogState?.checkoutEnvironment === "board_sandbox") return "Demo checkout";
  if (product.category === "vip") return "VIP";
  if (product.category === "sponsor") return "Sponsor";
  return product.availableForCheckout ? "Secure checkout" : "Sales pending";
}

function ticketCheckoutPresentation() {
  const sandbox = publicTicketCatalogState?.checkoutEnvironment === "board_sandbox";
  const ready = ticketCommerceReady();
  return {
    sandbox,
    heading: sandbox ? "Walk through the ticket purchase lifecycle." : ready ? "Buy official Texas SandFest wristbands securely." : "Plan your Texas SandFest tickets.",
    copy: sandbox
      ? "Choose wristbands and walk through a complete local payment, fulfillment, accounting, and refund demonstration. No external charge is sent."
      : ready
        ? "Choose wristbands here, then complete payment through secure Stripe Checkout."
        : "Online sales will open after the current ticket catalog and payment window are approved.",
    pill: sandbox ? "Local payment sandbox" : ready ? "Secure Stripe checkout" : "Sales configuration pending",
    button: sandbox ? "Open demo checkout" : "Continue to Stripe",
    status: sandbox
      ? "Select tickets to open the local payment sandbox. Demo prices are not approved public prices."
      : ready ? "Select tickets to continue to secure checkout." : "Online ticket sales are not open yet."
  };
}

function ticketCommerceReady() {
  return ticketProducts.some(product => product.availableForCheckout === true);
}

function ticketProductCardsMarkup() {
  return ticketProducts.map(product => {
    const purchasable = product.availableForCheckout === true && product.requiresReview !== true;
    return `<article class="ticket-card ${product.requiresReview ? "ticket-card-review" : ""}">
      <div>
        <span>${escapeHtml(ticketBadge(product))}</span>
        <strong>${escapeHtml(product.name)}</strong>
      </div>
      <p>${escapeHtml(product.description)}</p>
      <div class="ticket-card-footer">
        <b>${escapeHtml(purchasable || product.requiresReview ? productPrice(product) : "Sales opening soon")}</b>
        ${product.requiresReview ? `
          <button class="button secondary ticket-request" data-ticket-request="${escapeAttr(product.id)}" type="button">Request review</button>
        ` : purchasable ? `
          <div class="ticket-stepper" aria-label="${escapeAttr(product.name)} quantity">
            <button data-ticket-action="decrease" data-ticket-id="${escapeAttr(product.id)}" type="button" aria-label="Remove ${escapeAttr(product.name)}">-</button>
            <span data-ticket-qty="${escapeAttr(product.id)}">0</span>
            <button data-ticket-action="increase" data-ticket-id="${escapeAttr(product.id)}" type="button" aria-label="Add ${escapeAttr(product.name)}">+</button>
          </div>
        ` : '<span class="ticket-sale-status">Not on sale</span>'}
      </div>
    </article>`;
  }).join("") || `
    <article class="ticket-card">
      <div><span>Sales pending</span><strong>Ticket information is being updated</strong></div>
      <p>Official ticket options will appear here when the current catalog is published.</p>
    </article>`;
}

function moneyInput(cents) {
  if (typeof cents !== "number") return "";
  return (cents / 100).toFixed(2);
}

function adminMoney(cents, fallback = "Not set") {
  return formatMoney(cents) ?? fallback;
}

function defaultPublicApiBase() {
  if (ADMIN_ENTRY && ADMIN_AUTH_MODE === "oidc" && CONFIGURED_ADMIN_API_BASE) {
    return CONFIGURED_ADMIN_API_BASE;
  }
  return DEVELOPMENT_PUBLIC_API_BASE || CONFIGURED_ADMIN_API_BASE || "https://sandfest-api.heyelab.com";
}

// Local development can present both surfaces from the visitor entry. Built
// visitor artifacts stay public-only; the admin entry always enables ops mode.
const OPS_DEMO_ENABLED = !ADMIN_ENTRY && (import.meta.env.DEV || import.meta.env.VITE_SANDFEST_OPS_DEMO === "true");
const OPS_SURFACE_ENABLED = ADMIN_ENTRY || OPS_DEMO_ENABLED;
const BOARD_DEMO_INJECTED_TOKEN = globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__;
try { delete globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__; } catch { /* ignore */ }
const BOARD_DEMO_ACCESS = boardDemoAccessConfig({
  development: import.meta.env.DEV,
  authMode: ADMIN_AUTH_MODE,
  apiBase: defaultPublicApiBase(),
  token: BOARD_DEMO_INJECTED_TOKEN
});
const BOARD_PARTNER_PRESET_LOADER = import.meta.env.DEV
  ? () => import("./board-demo/partner-form-presets.js")
  : null;
const navCtaHref = ADMIN_ENTRY && BOARD_DEMO_ACCESS.enabled
  ? (() => {
      const url = new URL(siteBase, window.location.origin);
      url.searchParams.set("apiBase", defaultPublicApiBase());
      url.searchParams.set("mode", "visitor");
      return url.toString();
    })()
  : "https://www.texassandfest.org/";
const operationsSurfaceHref = (() => {
  const url = new URL(sitePath("admin.html"), window.location.origin);
  url.searchParams.set("apiBase", defaultPublicApiBase());
  return url.toString();
})();
let boardDemoWorkspaceLoaded = false;
let boardDemoWorkspaceLoad = null;

function publicApiBase() {
  const adminBaseInput = document.querySelector("#admin-api-base");
  return (adminBaseInput?.value || defaultPublicApiBase()).replace(/\/+$/, "");
}

app.innerHTML = `
  <a class="skip-link" href="#top">Skip to main content</a>
  <header class="topbar">
    <a class="brand" href="${ADMIN_ENTRY ? "#admin-config" : "#top"}" aria-label="${ADMIN_ENTRY ? "Texas SandFest operations" : "Texas SandFest home"}">
      ${officialLogo ? `<img class="brand-logo" ${responsiveImageAttributes(mediaAssets.find(asset => asset.role === "official_brand"), "84px")} alt="Texas SandFest logo" decoding="async" />` : `<span class="brand-mark">TSF</span>`}
      <span>${ADMIN_ENTRY ? "SandFest Operations" : "Texas SandFest"}</span>
    </a>
    ${ADMIN_ENTRY ? "" : `<nav id="public-navigation" class="primary-nav" aria-label="Primary navigation" data-open="false">
        <a href="#live-beach">Live Beach</a>
        <a href="#concierge">Concierge</a>
        <a href="#tickets">Tickets</a>
        <a href="#sculptors-showcase">Sculptors</a>
        <a href="#vendors-map">Vendors</a>
        <a href="#island-conditions">Island</a>
        <a href="#media">Media</a>
        <a href="#sponsors">Sponsors</a>
        <a href="#partner-status">Status</a>
        <a href="#port-a">Port A</a>

      ${OPS_DEMO_ENABLED ? `
        <a href="#admin-config">Overview</a>
        <a href="#admin-documents">Documents</a>
        <a href="#admin-partners">Partners</a>
        <a href="#admin-budget">Accounting</a>
        <a href="#admin-volunteers">Staffing</a>
        <a href="#admin-island-conditions">Island</a>
        <a href="#admin-system-monitor">Systems</a>
      ` : ""}
    </nav>`}
    <div class="app-status-controls">
      ${OPS_DEMO_ENABLED ? `
        <nav class="site-mode-toggle" aria-label="Presentation views">
          <a data-site-mode="public" href="#top">Visitor</a>
          <a data-site-mode="ops" data-operations-surface href="${escapeAttr(operationsSurfaceHref)}">Operations</a>
        </nav>
      ` : ""}
      ${ADMIN_ENTRY && BOARD_DEMO_ACCESS.enabled ? `
        <button id="admin-reset-board-demo" class="board-demo-reset" type="button" aria-label="Reset board demonstration" title="Restore the prepared board demonstration" hidden>
          <span aria-hidden="true">&#8635;</span>
        </button>
      ` : ""}
      <span id="network-status" class="network-status" data-state="online">Online</span>
      <button id="install-app-btn" class="install-app-btn" type="button" hidden>Install</button>
    </div>
    ${ADMIN_ENTRY ? "" : `
      <button id="mobile-nav-toggle" class="mobile-nav-toggle" type="button" aria-controls="public-navigation" aria-expanded="false" aria-label="Open navigation" title="Open navigation">
        <span class="mobile-nav-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>
    `}
    <a class="nav-cta" href="${escapeAttr(navCtaHref)}" target="_blank" rel="noreferrer">${ADMIN_ENTRY ? "Visitor site" : "Official site"}</a>
  </header>

  ${ADMIN_ENTRY ? "" : `
    <div id="public-alert" class="public-alert" hidden>
      <div>
        <span id="public-alert-severity">Alert</span>
        <strong id="public-alert-title"></strong>
        <p id="public-alert-message"></p>
      </div>
    </div>
  `}

  <main id="top" class="${ADMIN_ENTRY ? "admin-surface" : ""}">
    ${ADMIN_ENTRY ? "" : `<section class="hero">
      ${heroAsset
        ? `<img class="hero-media" ${responsiveImageAttributes(heroAsset, "100vw")} alt="" fetchpriority="high" decoding="async" />`
        : `<img class="hero-media" src="${escapeAttr(heroImage)}" alt="" fetchpriority="high" decoding="async" />`}
      <canvas id="tide-motion" class="tide-motion" aria-hidden="true"></canvas>
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <p class="eyebrow">Port Aransas · On the beach</p>
        <h1 id="public-event-name">${event.name}</h1>
        <p id="public-event-mission" class="hero-copy">${event.mission}</p>
        <div class="hero-actions">
          <a class="button primary" href="#tickets">Get tickets</a>
          <a class="button secondary" href="#live-beach">Open Live Beach →</a>
        </div>
      </div>
      <aside class="motion-console" aria-label="Live motion status">
        <div>
          <span class="pulse-dot"></span>
          <strong>Motion OS</strong>
        </div>
        <p id="motion-status-copy">${LIVE_BEACH_DEMO_ENABLED ? "Demonstration tide, crowd, and heat signals animate the beach layer." : "Verified event-day crowd signals will appear here after operations activate the feeds."}</p>
        <div class="motion-metrics">
          <span><b>${LIVE_BEACH_DEMO_ENABLED ? "82%" : "-"}</b> North Gate</span>
          <span><b>${LIVE_BEACH_DEMO_ENABLED ? "68%" : "-"}</b> Vendor Row</span>
          <span><b id="motion-tide-state">${LIVE_BEACH_DEMO_ENABLED ? "Demo" : "Standby"}</b> Tide Flow</span>
        </div>
        <button id="motion-toggle" class="motion-toggle" type="button" aria-pressed="true">Pause motion</button>
      </aside>
      <aside class="event-card" aria-label="Event snapshot">
        <span class="status-dot"></span>
        <strong id="public-event-dates">${event.dateRange}</strong>
        <span id="public-event-hours">${event.hours}</span>
        <span id="public-event-location">${event.location}</span>
      </aside>
    </section>`}

    <section class="live-beach" id="live-beach" aria-label="Live Beach">
      <div class="lb-header">
        <div class="lb-eyebrow-row">
          <span class="lb-live-pill"><span class="lb-live-dot"></span>${LIVE_BEACH_DEMO_ENABLED ? "BOARD DEMONSTRATION" : "MONITORING STANDBY"}</span>
          <span class="lb-eyebrow">${LIVE_BEACH_DEMO_ENABLED ? "Synthetic Live Beach scene" : "Live Beach · Mustang Island"}</span>
        </div>
        <h2 class="lb-headline">Walk the festival like you have a <em>superpower.</em></h2>
        <p class="lb-sub">${LIVE_BEACH_DEMO_ENABLED ? "This clearly labeled simulation shows the planned event-day experience without claiming fictional people or signals are live." : "Live routing remains unavailable until verified camera metrics, the approved run of show, and the published sculptor roster are active."}</p>
      </div>

      ${LIVE_BEACH_DEMO_ENABLED ? `
      <div class="lb-stage" data-preset="balanced">
        <aside class="lb-rail lb-rail-left" aria-label="Sandy suggests">
          <header class="lb-rail-head">
            <span class="lb-rail-mark">✦</span>
            <div>
              <p class="lb-rail-eyebrow">Sandy suggests</p>
              <p class="lb-rail-title">Right now</p>
            </div>
          </header>
          <article class="lb-suggest">
            <p class="lb-suggest-target">
              Sculpture <strong id="lb-suggest-num">#${escapeHtml(liveBeachSuggestedSculpture.id ?? "-")}</strong>
              <span class="lb-suggest-flag" id="lb-suggest-flag">${escapeHtml(liveBeachSuggestedSculpture.country ?? "")}</span>
            </p>
            <p class="lb-suggest-name">
              <em id="lb-suggest-title">${escapeHtml(liveBeachSuggestedSculpture.title ?? "Demonstration route")}</em>
              <span id="lb-suggest-sculptor">${escapeHtml(liveBeachSuggestedSculpture.sculptor ?? "Sample artist")}</span>
            </p>
            <p class="lb-suggest-reason" id="lb-suggest-reason">${escapeHtml(liveBeachSuggestion.reason ?? "Synthetic routing demonstration")}</p>
            <div class="lb-suggest-chips">
              <span class="lb-chip lb-chip-walk"><span>↗</span> <strong id="lb-suggest-walk">${escapeHtml(liveBeachSuggestion.walkMinutes ?? "-")}</strong> min walk</span>
              <span class="lb-chip lb-chip-soon"><span class="lb-pulse-dot"></span> Talk in <strong id="lb-suggest-min">${escapeHtml(liveBeachSuggestion.eventStartsInMin ?? "-")}</strong> min</span>
            </div>
            <button id="lb-walk-btn" class="lb-walk-btn" type="button">Start walking →</button>
          </article>
          <dl class="lb-stat-grid">
            <div><dt>Tide</dt><dd>${escapeHtml(liveBeachStats.tide ?? "-")} <span class="lb-trend-up">↑</span></dd></div>
            <div><dt>Sunset</dt><dd id="lb-sunset">${escapeHtml(liveBeachStats.sunset ?? "-")}</dd></div>
            <div><dt>Stage A next</dt><dd>${escapeHtml(liveBeachStats.nextStage ?? "-")}</dd></div>
            <div><dt>Air</dt><dd>${escapeHtml(liveBeachStats.air ?? "-")}</dd></div>
          </dl>
        </aside>

        <div class="lb-canvas" id="lb-canvas">
          <svg class="lb-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="lb-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f3e8c8"/>
                <stop offset="60%" stop-color="#fff6e6"/>
                <stop offset="100%" stop-color="#fff6e6"/>
              </linearGradient>
              <linearGradient id="lb-water" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#0e2a47" stop-opacity="0.92"/>
                <stop offset="100%" stop-color="#06192c" stop-opacity="1"/>
              </linearGradient>
              <radialGradient id="lb-bloom-coral">
                <stop offset="0%"  stop-color="#F08A5D" stop-opacity="0.72"/>
                <stop offset="60%" stop-color="#F08A5D" stop-opacity="0.18"/>
                <stop offset="100%" stop-color="#F08A5D" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="lb-bloom-mint">
                <stop offset="0%"  stop-color="#7DD3C0" stop-opacity="0.55"/>
                <stop offset="60%" stop-color="#7DD3C0" stop-opacity="0.14"/>
                <stop offset="100%" stop-color="#7DD3C0" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="lb-bloom-mixed">
                <stop offset="0%"  stop-color="#F6D66F" stop-opacity="0.55"/>
                <stop offset="55%" stop-color="#F08A5D" stop-opacity="0.18"/>
                <stop offset="100%" stop-color="#F6D66F" stop-opacity="0"/>
              </radialGradient>
              <pattern id="lb-grain" width="200" height="200" patternUnits="userSpaceOnUse">
                <rect width="200" height="200" fill="transparent"/>
                <circle cx="32"  cy="60"  r="0.6" fill="#0e2a47" opacity="0.05"/>
                <circle cx="118" cy="22"  r="0.5" fill="#0e2a47" opacity="0.06"/>
                <circle cx="180" cy="160" r="0.7" fill="#0e2a47" opacity="0.05"/>
                <circle cx="62"  cy="180" r="0.5" fill="#0e2a47" opacity="0.06"/>
                <circle cx="140" cy="92"  r="0.4" fill="#0e2a47" opacity="0.05"/>
              </pattern>
              <filter id="lb-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="22"/>
              </filter>
            </defs>

            <!-- Sky / dunes -->
            <rect x="0" y="0" width="1600" height="280" fill="url(#lb-sky)"/>
            <path d="M0,260 C220,200 360,300 600,240 C820,180 1000,290 1240,220 C1420,170 1520,260 1600,230 L1600,300 L0,300 Z" fill="#f0d9a3" opacity="0.78"/>
            <path d="M0,300 C260,260 480,320 760,290 C1020,262 1240,330 1600,300 L1600,330 L0,330 Z" fill="#e7c98a" opacity="0.6"/>

            <!-- Beach sand -->
            <rect x="0" y="280" width="1600" height="420" fill="#fff1d3"/>
            <rect x="0" y="280" width="1600" height="420" fill="url(#lb-grain)"/>

            <!-- Heatmap blooms -->
            <g class="lb-blooms" filter="url(#lb-soft)">
              <circle class="lb-bloom" cx="224" cy="450" r="170" fill="url(#lb-bloom-coral)"/>
              <circle class="lb-bloom" cx="544" cy="414" r="140" fill="url(#lb-bloom-mixed)"/>
              <circle class="lb-bloom" cx="928" cy="450" r="150" fill="url(#lb-bloom-mint)"/>
              <circle class="lb-bloom" cx="1344" cy="450" r="160" fill="url(#lb-bloom-mint)"/>
            </g>

            <!-- Surf -->
            <path class="lb-tide lb-tide-1" d="M0,720 Q200,705 400,720 T800,720 T1200,720 T1600,720 L1600,900 L0,900 Z" fill="url(#lb-water)" opacity="0.82"/>
            <path class="lb-tide lb-tide-2" d="M0,740 Q200,730 400,742 T800,738 T1200,744 T1600,738 L1600,900 L0,900 Z" fill="#0e2a47" opacity="0.55"/>
            <path class="lb-tide lb-tide-3" d="M0,760 Q200,752 400,762 T800,758 T1200,766 T1600,760 L1600,900 L0,900 Z" fill="#7DD3C0" opacity="0.18"/>

            <!-- Foam line -->
            <path class="lb-foam" d="M0,712 Q200,700 400,712 T800,712 T1200,712 T1600,712" stroke="#fff6e6" stroke-width="2" fill="none" opacity="0.55"/>

            <!-- Route line (visitor → suggested) -->
            <path id="lb-route" class="lb-route" d="" fill="none" stroke="#0E2A47" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 8"/>

            <!-- Visitor "you are here" -->
            <g id="lb-visitor" class="lb-visitor">
              <circle r="34" class="lb-visitor-halo"/>
              <circle r="11" class="lb-visitor-core"/>
            </g>

            <!-- Sculpture pins (rendered by JS) -->
            <g id="lb-pins"></g>

            <!-- Seagull -->
            <g id="lb-gull" class="lb-gull">
              <path d="M0,0 q-8,-6 -16,0 q-8,-6 -16,0 q8,4 16,2 q8,2 16,-2 z" fill="#0e2a47" opacity="0.7"/>
            </g>
          </svg>

          <!-- Pin hover card -->
          <div id="lb-pop" class="lb-pop" hidden>
            <div class="lb-pop-head">
              <span class="lb-pop-num"></span>
              <span class="lb-pop-flag"></span>
              <span class="lb-pop-crowd"></span>
            </div>
            <p class="lb-pop-title"><em></em></p>
            <p class="lb-pop-sculptor"></p>
            <p class="lb-pop-walk"></p>
          </div>
        </div>

        <aside class="lb-rail lb-rail-right" aria-label="Now on the beach">
          <header class="lb-rail-head">
            <span class="lb-rail-mark lb-rail-mark-live">●</span>
            <div>
              <p class="lb-rail-eyebrow">Now on the beach</p>
              <p class="lb-rail-title">Updated · just now</p>
            </div>
          </header>
          <ul class="lb-now-feed" id="lb-now-feed"></ul>
        </aside>
      </div>

      <div class="lb-scrub" aria-label="Day timeline scrubber">
        <div class="lb-scrub-head">
          <span class="lb-scrub-eyebrow">Festival timeline</span>
          <span class="lb-scrub-readout" id="lb-scrub-readout">${escapeHtml(liveBeachInitialTimeline.hour ?? "-")} · ${escapeHtml(liveBeachInitialTimeline.label ?? "Demonstration")}</span>
        </div>
        <input id="lb-scrub-input" class="lb-scrub-input" type="range" min="0" max="11" value="3" step="1" aria-label="Drag to rewind or fast-forward the day"/>
        <div class="lb-scrub-track">
          <div class="lb-scrub-fill" id="lb-scrub-fill"></div>
          <ul class="lb-scrub-ticks" id="lb-scrub-ticks"></ul>
        </div>
      </div>

      ` : `
      <div class="lb-standby" role="status">
        <strong>Event-day monitoring is not active.</strong>
        <span>Use Island Conditions below for current weather, ferry, traffic, crowd, and line readings that have passed freshness checks.</span>
        <a class="button secondary" href="#island-conditions">Open Island Conditions</a>
      </div>
      `}

      <p class="lb-foot">
        ${LIVE_BEACH_DEMO_ENABLED ? "Board demonstration data is synthetic and remains local to this development build." : "Live Beach activates only from reviewed event content and current, privacy-safe operational metrics."}
        ${OPS_DEMO_ENABLED ? `<a data-operations-handoff href="${escapeAttr(operationsSurfaceHref)}" target="_blank" rel="noreferrer">Open the operator view →</a>` : ""}
      </p>
    </section>

    <section class="stats" aria-label="Platform snapshot">
      ${quickStats.map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("")}
    </section>

    <section class="section experience-section" id="experience">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Customer + admin sides</p>
          <h2>One platform, two working surfaces.</h2>
          <p class="section-copy">The public app should feel simple. The admin side should expose the messy operational truth without leaking staff-only data to guests.</p>
        </div>
      </div>
      <div class="experience-grid">
        ${experiencePanels.map(panel => `
          <article>
            <span>${panel.audience}</span>
            <h3>${panel.title}</h3>
            <p>${panel.detail}</p>
            <div>
              ${panel.actions.map(action => `<strong>${action}</strong>`).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section ticketing-section" id="tickets">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Ticket ordering</p>
          <h2 id="ticketing-heading">${ticketCheckoutPresentation().heading}</h2>
          <p id="ticketing-copy" class="section-copy">${ticketCheckoutPresentation().copy}</p>
        </div>
        <span id="ticketing-status-pill" class="checkout-status-pill">${ticketCheckoutPresentation().pill}</span>
      </div>
      <div class="ticketing-grid">
        <div id="ticket-product-grid" class="ticket-product-grid">
          ${ticketProductCardsMarkup()}
        </div>
        <aside class="checkout-panel">
          <div>
            <p class="eyebrow">Order draft</p>
            <h3>Customer checkout</h3>
          </div>
          <div id="ticket-cart-lines" class="ticket-cart-lines">
            <span>No tickets selected yet.</span>
          </div>
          <div class="ticket-total">
            <span>Subtotal</span>
            <strong id="ticket-subtotal">$0.00</strong>
          </div>
          <div class="checkout-contact">
            <label>Email <input id="checkout-email" type="email" autocomplete="email" placeholder="you@example.com" /></label>
            <label>Mobile <input id="checkout-phone" type="tel" autocomplete="tel" placeholder="(512) 555-0100" /></label>
          </div>
          <fieldset class="checkout-consent">
            <legend>Optional updates</legend>
            <p class="checkout-consent-note">Buying a ticket does <strong>not</strong> enroll you. Leave boxes unchecked to skip.</p>
            <label class="consent-check">
              <input id="consent-email-marketing" type="checkbox" />
              <span>Email me festival news and early-bird offers</span>
            </label>
            <label class="consent-check">
              <input id="consent-sms-marketing" type="checkbox" />
              <span>Text me promo updates (separate from safety alerts)</span>
            </label>
            <label class="consent-check">
              <input id="consent-sms-safety" type="checkbox" />
              <span>Text me event-day safety &amp; logistics alerts</span>
            </label>
          </fieldset>
          <fieldset id="ticket-policy-fieldset" class="checkout-policy" hidden>
            <legend>Required acknowledgement</legend>
            <details>
              <summary id="ticket-policy-summary">Review ticket policies</summary>
              <div id="ticket-policy-notices" class="ticket-policy-notices"></div>
            </details>
            <label class="consent-check ticket-policy-check">
              <input id="ticket-policy-acceptance" type="checkbox" required aria-describedby="ticket-policy-help" />
              <span id="ticket-policy-label"></span>
            </label>
            <p id="ticket-policy-help" class="checkout-consent-note">Required before secure checkout.</p>
          </fieldset>
          <button id="checkout-btn" class="button primary" type="button" disabled>${ticketCheckoutPresentation().button}</button>
          <p id="checkout-status" class="checkout-status" role="status" aria-live="polite">${ticketCheckoutPresentation().status}</p>
          <section id="ticket-demo-checkout" class="ticket-demo-checkout" aria-label="Local payment sandbox" hidden>
            <header>
              <div><span>Local payment sandbox</span><strong>No external charge</strong></div>
              <b id="ticket-demo-amount">$0.00 demo</b>
            </header>
            <div id="ticket-demo-summary"></div>
            <div class="ticket-demo-actions">
              <button id="ticket-demo-pay" class="button primary" type="button">Complete demo payment</button>
              <button id="ticket-demo-cancel" class="button secondary" type="button">Return to order</button>
            </div>
            <p id="ticket-demo-status" class="checkout-status" role="status" aria-live="polite"></p>
          </section>
          <div id="ticket-payment-rails" class="payment-rails">
            <span>Stripe Checkout</span>
            <span>Apple Pay</span>
            <span>Webhook fulfillment</span>
            <span>QuickBooks sync</span>
          </div>
        </aside>
      </div>
    </section>

    <section class="section sculptors-section" id="sculptors-showcase">
      <div class="section-heading">
        <div>
          <p class="eyebrow">${sculptorRosterDemo ? "Board demonstration roster" : "The sculptors"}</p>
          <h2>${sculptorRosterVisible ? "Meet the artists &mdash; and find them on the beach." : "The 2027 sculptor roster is awaiting publication."}</h2>
          <p class="section-copy">${sculptorRosterDemo ? "These fictional artists demonstrate roster, map, passport, and voting workflows without being presented as official participants." : sculptorRosterPublished ? "Browse the reviewed roster, filter by division, and locate each published entry by beach marker." : "Official artist profiles and beach-marker assignments will appear after the current roster completes source and publication review."}</p>
        </div>
        <span class="sculptor-count">${sculptorRosterVisible ? `${sculptors.length} ${sculptorRosterDemo ? "sample " : ""}sculptors` : "Publication pending"}</span>
      </div>
      ${sculptorRosterVisible ? "" : `<div class="sculptor-publication-pending" role="status"><strong>No unapproved artist data is shown.</strong><span>The site will open the roster, corridor map, passport, and People's Choice ballot together after publication.</span></div>`}
      <div class="sculptor-layout" ${sculptorRosterVisible ? "" : "hidden"}>
        <div class="corridor-map-wrap">
          <div class="corridor-map" id="corridor-map" role="group" aria-label="Competition corridor map with sculpture locations"></div>
          <div class="corridor-legend" id="corridor-legend"></div>
        </div>
        <aside class="sculptor-detail" id="sculptor-detail" aria-live="polite"></aside>
      </div>
      <div class="sculptor-filters" id="sculptor-filters" ${sculptorRosterVisible ? "" : "hidden"}></div>
      <div class="sculptor-roster" id="sculptor-roster" ${sculptorRosterVisible ? "" : "hidden"}></div>

      <div class="passport-panel" id="passport-panel" ${sculptorRosterVisible ? "" : "hidden"}>
        <div class="passport-head">
          <div>
            <p class="eyebrow">Sculpture Passport</p>
            <h3>Collect every master sculpture &mdash; finish to enter the prize drawing.</h3>
            <p class="section-copy">On the beach, scan the QR at each sculpture to stamp your passport. Here's a preview of the trail.</p>
          </div>
          <div class="passport-progress">
            <div class="passport-ring" id="passport-ring"><span id="passport-count">0</span></div>
            <button id="passport-reset" class="button secondary" type="button">Reset</button>
          </div>
        </div>
        <div class="passport-stamps" id="passport-stamps"></div>
        <div class="passport-reward" id="passport-reward" hidden></div>
      </div>

      <div class="voting-panel" id="voting-panel" ${sculptorRosterVisible ? "" : "hidden"}>
        <div class="passport-head">
          <div>
            <p class="eyebrow">People's Choice</p>
            <h3>Vote for your favorite sculpture</h3>
            <p class="section-copy">One vote per device. Change it anytime until voting closes Sunday evening.</p>
          </div>
          <div class="voting-totals" id="voting-totals">
            <strong id="voting-count">—</strong>
            <span>votes</span>
          </div>
        </div>
        <label class="checkout-contact" style="max-width:420px">
          Ticket QR / order id (optional unless enforced)
          <input id="voting-ticket-ref" type="text" placeholder="tsf:t:WB-29F4-7B0A" autocomplete="off" />
        </label>
        <div class="voting-ballot" id="voting-ballot">
          <article class="empty-state"><span>Loading ballot…</span></article>
        </div>
        <p id="voting-status" class="checkout-status"></p>
      </div>
    </section>

    <section class="section booths-section" id="vendors-map">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Food &amp; vendors</p>
          <h2>Find booths on the beach corridor</h2>
          <p class="section-copy">Explore food, merchandise, and services by beach location. Published booth assignments appear here as the festival map is finalized.</p>
        </div>
        <div class="booth-section-actions">
          <span class="sculptor-count" id="booth-pin-count">— booths</span>
          <a id="vendor-intake-cta" class="button primary booth-apply-link" href="#vendor-application-form">Join vendor interest list</a>
        </div>
      </div>
      <div class="booth-map-layout">
        <div class="booth-corridor" id="booth-corridor" aria-label="Vendor booth map"></div>
        <div class="booth-list keyboard-scroll-region" id="booth-list" role="region" aria-label="Vendor booth directory" tabindex="0"></div>
      </div>
    </section>

    <section class="section island-conditions-section" id="island-conditions">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Port Aransas arrival picture</p>
          <h2>Island Conditions</h2>
          <p class="section-copy">Weather, ferry access, beach traffic, entry crowds, and line pressure in one current view.</p>
        </div>
        <button id="refresh-island-conditions" class="button secondary" type="button">Refresh conditions</button>
      </div>
      <div id="island-condition-kpis" class="island-condition-kpis">
        <article class="empty-state"><span>Loading current conditions...</span></article>
      </div>
      <div class="island-camera-heading">
        <strong>Traffic, crowd, and line monitors</strong>
        <span id="island-condition-updated" role="status" aria-live="polite">Checking sources</span>
      </div>
      <div id="island-camera-grid" class="island-camera-grid"></div>
    </section>

    <section class="section admin-config-section" id="admin-config">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Texas SandFest operations</p>
          <h1>Festival operations command center</h1>
          <p class="section-copy">One governed workspace for partner revenue, staffing, field conditions, communications, and launch readiness.</p>
        </div>
        <span id="admin-api-pill" class="checkout-status-pill">API not loaded</span>
      </div>
      <nav class="admin-workspace-nav" aria-label="Operations workspaces">
        <a href="#admin-config">Overview</a>
        <a href="#admin-documents">Documents</a>
        <a href="#admin-partners">Partners</a>
        <a href="#admin-budget">Accounting</a>
        <a href="#admin-volunteers">Staffing</a>
        <a href="#admin-island-conditions">Island conditions</a>
        <a href="#admin-system-monitor">Systems</a>
      </nav>
      <div class="admin-api-bar" ${BOARD_DEMO_ACCESS.enabled ? "hidden" : ""}>
        <label>
          <span>API base</span>
          <input id="admin-api-base" value="${escapeAttr(defaultPublicApiBase())}" autocomplete="off" ${ADMIN_AUTH_MODE === "oidc" ? "readonly" : ""} />
        </label>
        ${ADMIN_AUTH_MODE === "oidc" ? `
          <div class="admin-auth-control">
            <span>Staff session</span>
            <div class="admin-auth-actions">
              <button id="admin-sign-in" class="button primary" type="button">Sign in</button>
              <button id="admin-sign-out" class="button secondary" type="button" hidden>Sign out</button>
            </div>
          </div>
        ` : BOARD_DEMO_ACCESS.enabled ? `
          <div class="admin-auth-control">
            <span>Staff session</span>
            <strong>Local board demo</strong>
          </div>
        ` : `
          <label>
            <span>Admin token</span>
            <input id="admin-api-token" type="password" value="" placeholder="Admin token (never commit)" autocomplete="off" />
          </label>
        `}
        <button id="admin-load-config" class="button primary" type="button" ${ADMIN_AUTH_MODE === "oidc" ? "disabled" : ""}>Load config</button>
      </div>
      <p id="admin-api-status" class="checkout-status" role="status" aria-live="polite">${ADMIN_AUTH_MODE === "oidc" ? "Signed out." : BOARD_DEMO_ACCESS.enabled ? "Local board session ready. Loading operations..." : "Start the local backend, enter its admin token, then load config."}</p>
      <div class="admin-command-center" id="admin-command-center" aria-labelledby="admin-command-center-title">
        <div class="admin-command-heading">
          <div>
            <p class="eyebrow">Operations pulse</p>
            <h2 id="admin-command-center-title">Festival command summary</h2>
          </div>
          <span id="admin-command-updated">Waiting for operations data</span>
        </div>
        <div id="admin-command-signals" class="admin-command-signals" aria-live="polite" aria-busy="true">
          <article class="empty-state"><span>Loading workflow signals.</span></article>
        </div>
      </div>
      <div class="admin-readiness-grid">
        <article>
          <strong>${BOARD_DEMO_ACCESS.enabled ? "API workspace" : "API subdomain"}</strong>
          <span>${BOARD_DEMO_ACCESS.enabled ? "Local loopback presentation service" : "sandfest-api.heyelab.com"}</span>
        </article>
        <article>
          <strong>${BOARD_DEMO_ACCESS.enabled ? "Admin access" : "Admin app"}</strong>
          <span>${BOARD_DEMO_ACCESS.enabled ? "Local board session · production OIDC post-board" : "sandfest-admin.heyelab.com"}</span>
        </article>
        <article>
          <strong>Payments</strong>
          <span>${BOARD_DEMO_ACCESS.enabled ? "Site-native sandbox · Stripe post-board" : "Provider readiness is enforced by the API"}</span>
        </article>
        <article>
          <strong>Price authority</strong>
          <span>Catalog and invoice amounts are server validated</span>
        </article>
        <article>
          <strong>Admin role</strong>
          <span id="admin-role-summary">Not loaded</span>
        </article>
        <article>
          <strong>Deployment</strong>
          <span id="admin-deployment-summary">Not checked</span>
        </article>
        <article>
          <strong>Background work</strong>
          <span id="admin-job-summary">Not checked</span>
        </article>
      </div>
      ${BOARD_DEMO_ACCESS.enabled ? `
        <section id="admin-board-stage-summary" class="admin-board-stage-summary" aria-label="Board presentation activation boundary">
          <div data-board-stage="presentation-ready">
            <span>Board-ready</span>
            <strong>Real workflows with synthetic providers</strong>
            <p>Intake, receivables, key dates, delegated work, sponsor branding, outreach, and Island Conditions use the real application contracts.</p>
          </div>
          <div data-board-stage="post-presentation">
            <span>Post-board</span>
            <strong>Live provider activation</strong>
            <p>Connect Stripe, QuickBooks, Brevo, Twilio, NWS, TxDOT, eight webcam edge agents, OIDC, Turnstile, DNS, and managed recovery.</p>
          </div>
        </section>
      ` : ""}
      <div class="admin-launch-readiness" id="admin-launch-readiness">
        <div class="admin-launch-readiness-heading">
          <div>
            <p class="eyebrow">Launch control</p>
            <h2>${BOARD_DEMO_ACCESS.enabled ? "Presentation and production readiness" : "Production readiness"}</h2>
            <p id="admin-deployment-check-count" class="admin-launch-readiness-count">Load the operations workspace to evaluate launch gates.</p>
          </div>
          <div class="admin-launch-readiness-actions">
            <button id="admin-sync-deployment-tasks" type="button" class="button secondary" data-requires-permission="partners:write">Sync work board</button>
            <div class="admin-readiness-filter" role="group" aria-label="Deployment checks">
              <button type="button" data-deployment-filter="attention" aria-pressed="true">Needs action <span id="admin-deployment-attention-count">0</span></button>
              <button type="button" data-deployment-filter="all" aria-pressed="false">All checks <span id="admin-deployment-total-count">0</span></button>
            </div>
          </div>
        </div>
        <div id="admin-deployment-checks" class="admin-deployment-checks" aria-live="polite">
          <div class="admin-deployment-empty"><strong>Readiness not checked</strong><span>Connect the API to load the current environment.</span></div>
        </div>
      </div>
      <div class="admin-event-guide-panel">
        <div class="editor-heading">
          <p class="eyebrow">Published event facts</p>
          <h2>Event guide</h2>
          <p id="admin-event-guide-readiness" class="admin-event-guide-status">Not loaded</p>
        </div>
        <form id="admin-event-guide-form" class="admin-event-guide-form" data-requires-permission="content:write">
          <label><span>Start date</span><input name="startDate" type="date" required /></label>
          <label><span>End date</span><input name="endDate" type="date" required /></label>
          <label><span>Opens</span><input name="dailyOpen" type="time" required /></label>
          <label><span>Closes</span><input name="dailyClose" type="time" required /></label>
          <label class="admin-event-guide-location"><span>Location</span><input name="location" maxlength="240" required /></label>
          <label class="admin-event-guide-mission"><span>Public description</span><textarea name="mission" rows="3" maxlength="600" required></textarea></label>
          <label><span>Phone</span><input name="phone" type="tel" maxlength="40" /></label>
          <label><span>Email</span><input name="email" type="email" maxlength="254" required /></label>
          <label class="admin-event-guide-address"><span>Office address</span><input name="address" maxlength="300" /></label>
          <label class="admin-event-guide-source"><span>Official source</span><input name="sourceUrl" type="url" inputmode="url" required /></label>
          <label><span>Source checked</span><input name="sourceCheckedAt" type="datetime-local" required /></label>
          <div class="admin-event-guide-actions">
            <button id="admin-publish-event-guide" class="button primary" type="submit">Publish facts</button>
          </div>
        </form>
      </div>
      <div class="admin-document-panel" id="admin-documents">
        <div class="editor-heading admin-document-heading">
          <div>
            <p class="eyebrow">Private document intake</p>
            <h2>Review queue</h2>
          </div>
          <button id="admin-load-documents" class="button secondary" data-requires-permission="documents:read" type="button">Refresh documents</button>
        </div>
        <div id="admin-document-summary" class="admin-document-summary">
          <article class="empty-state"><span>No documents loaded.</span></article>
        </div>
        <form id="admin-document-upload" class="admin-document-upload" data-requires-permission="documents:write">
          <label class="admin-document-file"><span>File</span><input name="file" type="file" required accept=".pdf,.txt,.csv,.json,.eml,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx" /></label>
          <label><span>Domain</span><select name="domain" required><option value="docs">Board and policy</option><option value="ops">Operations</option><option value="finance">Finance</option><option value="eventeny">Eventeny</option><option value="quickbooks">QuickBooks</option><option value="comms">Communications</option></select></label>
          <label><span>Owner</span><select name="ownerTeam" required><option value="operations" selected>Operations</option><option value="sponsor">Sponsor</option><option value="finance">Finance</option><option value="volunteer-captains">Volunteer captains</option><option value="traffic">Traffic and parking</option><option value="guest-services">Guest services</option><option value="production">Production</option></select></label>
          <label><span>Review due</span><input name="reviewDueAt" type="datetime-local" required /></label>
          <label class="admin-document-title"><span>Title</span><input name="title" required maxlength="180" /></label>
          <button class="button primary" type="submit">Upload document</button>
          <p id="admin-document-upload-status" class="checkout-status" role="status" aria-live="polite"></p>
        </form>
        <div id="admin-document-list" class="admin-document-list">
          <article class="empty-state"><span>No documents loaded.</span></article>
        </div>
      </div>
      <div class="admin-alert-panel">
        <div class="editor-heading">
          <p class="eyebrow">Emergency alert</p>
          <h2>Public crowd message</h2>
        </div>
        <div class="admin-alert-form">
          <label>
            <span>Severity</span>
            <select id="admin-alert-severity">
              <option value="info">Info</option>
              <option value="watch">Watch</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            <span>Title</span>
            <input id="admin-alert-title" maxlength="120" placeholder="Weather delay" />
          </label>
          <label>
            <span>Expires at</span>
            <input id="admin-alert-expires" type="datetime-local" />
          </label>
          <label class="admin-check admin-alert-active">
            <input id="admin-alert-active" type="checkbox" />
            <span>Active</span>
          </label>
          <label class="admin-check admin-alert-sms">
            <input id="admin-alert-send-sms" type="checkbox" />
            <span>Send safety SMS to currently opted-in recipients</span>
          </label>
          <label class="admin-alert-message">
            <span>Message</span>
            <textarea id="admin-alert-message" rows="3" maxlength="600" placeholder="Short public message for guests"></textarea>
          </label>
          <div class="admin-alert-actions">
            <button id="admin-publish-alert" class="button primary" data-requires-permission="alert:write" type="button">Publish alert</button>
            <button id="admin-clear-alert" class="button secondary" data-requires-permission="alert:write" type="button">Clear alert</button>
          </div>
        </div>
      </div>
      <div class="admin-order-monitor" id="admin-system-monitor">
        <div class="editor-heading">
          <p class="eyebrow">Systems monitor</p>
          <h2>Automation, transactions, fulfillment, and audit</h2>
        </div>
        <button id="admin-load-orders" class="button secondary" data-requires-permission="orders:read" type="button">Refresh systems</button>
        <section class="admin-automation-monitor" aria-labelledby="admin-automation-title">
          <div class="admin-automation-heading">
            <strong id="admin-automation-title">Automation queue</strong>
            <span>Provider delivery, document extraction, accounting, and incident dispatch</span>
          </div>
          <div id="admin-job-list" class="admin-job-list keyboard-scroll-region" role="region" aria-label="Background automation queue" tabindex="0">
            <article class="empty-state"><span>No automation records loaded.</span></article>
          </div>
        </section>
        <div class="admin-order-grid">
          <div>
            <strong>Pending checkout attempts</strong>
            <div id="admin-order-list" class="admin-record-list keyboard-scroll-region" role="region" aria-label="Pending checkout attempts" tabindex="0">
              <article class="empty-state"><span>No order records loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Payment events</strong>
            <div id="admin-payment-event-list" class="admin-record-list keyboard-scroll-region" role="region" aria-label="Payment events" tabindex="0">
              <article class="empty-state"><span>No payment events loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Fulfillment queue</strong>
            <div id="admin-fulfillment-list" class="admin-record-list keyboard-scroll-region" role="region" aria-label="Fulfillment queue" tabindex="0">
              <article class="empty-state"><span>No fulfillment records loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Admin audit trail</strong>
            <div id="admin-audit-list" class="admin-record-list keyboard-scroll-region" role="region" aria-label="Admin audit trail" tabindex="0">
              <article class="empty-state"><span>No audit records loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Config snapshots</strong>
            <div id="admin-snapshot-list" class="admin-record-list keyboard-scroll-region" role="region" aria-label="Configuration snapshots" tabindex="0">
              <article class="empty-state"><span>No snapshots loaded.</span></article>
            </div>
          </div>
        </div>
      </div>
      <div id="admin-budget-module"></div>
      <div class="admin-revenue-panel" id="admin-revenue">
        <div class="editor-heading">
          <p class="eyebrow">Revenue dashboard</p>
          <h2>Unified ticket, vendor, sponsor &amp; merch revenue</h2>
        </div>
        <button id="admin-load-revenue" class="button secondary" data-requires-permission="revenue:read" type="button">Load revenue</button>
        <p id="admin-revenue-updated" class="admin-revenue-updated">Reconciles Stripe, Eventeny, Square, and manual entries to QuickBooks. Load config, or click Load revenue.</p>
        <div id="admin-revenue-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No revenue loaded.</span></article>
        </div>
        <div class="admin-revenue-breakdown">
          <div>
            <strong>By category</strong>
            <div id="admin-revenue-categories" class="admin-revenue-rows"></div>
          </div>
          <div>
            <strong>By source</strong>
            <div id="admin-revenue-sources" class="admin-revenue-rows"></div>
          </div>
        </div>
        <form id="admin-import-revenue" class="admin-inline-form admin-revenue-import" data-requires-permission="revenue:write">
          <strong>Import provider settlement</strong>
          <label class="admin-import-file"><span>CSV file</span><input name="file" type="file" accept=".csv,text/csv" /></label>
          <label><span>Provider</span><select name="source" required><option value="eventeny">Eventeny</option><option value="square">Square</option><option value="stripe">Stripe</option><option value="manual">Manual</option></select></label>
          <label class="admin-import-wide"><span>Settlement rows</span><textarea name="csv" required rows="6" placeholder="transaction_id,date,category,gross_amount,fee_amount,net_amount,quantity,payout_id,payout_date,reconciled"></textarea></label>
          <div id="admin-revenue-import-result" class="admin-import-result admin-import-wide" aria-live="polite"></div>
          <div class="admin-import-actions admin-import-wide">
            <button class="button secondary" type="submit">Preview settlement</button>
            <button id="admin-commit-revenue-import" class="button primary" type="button" hidden disabled>Import valid rows</button>
          </div>
        </form>
        <div class="admin-revenue-import-history">
          <strong>Recent settlement imports</strong>
          <div id="admin-revenue-import-history" class="admin-revenue-rows"><article class="empty-state"><span>No settlement imports.</span></article></div>
        </div>
      </div>
      <div class="admin-fleet-panel" id="admin-fleet">
        <div class="editor-heading">
          <p class="eyebrow">Fleet checkout</p>
          <h2>Golf carts, UTVs, generators &amp; equipment</h2>
        </div>
        <div class="admin-fleet-actions">
          <button id="admin-load-fleet" class="button secondary" data-requires-permission="fleet:read" type="button">Load fleet</button>
        </div>
        <p id="admin-fleet-updated" class="admin-revenue-updated">3-day checkout log for event vehicles and gear. QR payload is <code>tsf:asset:&lt;id&gt;</code>. Load config, or click Load fleet.</p>
        <div id="admin-fleet-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No fleet loaded.</span></article>
        </div>
        <div class="admin-fleet-breakdown">
          <div>
            <strong>Assets</strong>
            <div id="admin-fleet-assets" class="admin-fleet-rows keyboard-scroll-region" role="region" aria-label="Fleet asset list" tabindex="0"></div>
          </div>
          <div>
            <strong>Open checkouts</strong>
            <div id="admin-fleet-open" class="admin-fleet-rows keyboard-scroll-region" role="region" aria-label="Open fleet checkouts" tabindex="0"></div>
          </div>
        </div>
        <div class="admin-fleet-checkout-form" data-requires-permission="fleet:write">
          <div class="editor-heading">
            <p class="eyebrow">Quick action</p>
            <h3>Check out / check in</h3>
          </div>
          <div class="admin-fleet-form-grid">
            <label>Asset ID <input id="fleet-asset-id" type="text" placeholder="cart-02" autocomplete="off" /></label>
            <label>Checked out to <input id="fleet-checked-out-to" type="text" placeholder="Name or radio callsign" autocomplete="off" /></label>
            <label>Team <input id="fleet-team" type="text" placeholder="site-ops" autocomplete="off" /></label>
            <label>Start charge % <input id="fleet-start-charge" type="number" min="0" max="100" placeholder="100" /></label>
            <label>End charge % <input id="fleet-end-charge" type="number" min="0" max="100" placeholder="55" /></label>
            <label>Damage notes <input id="fleet-damage" type="text" placeholder="Optional on check-in" autocomplete="off" /></label>
          </div>
          <div class="admin-fleet-form-actions">
            <button id="admin-fleet-checkout" class="button primary" data-requires-permission="fleet:write" type="button">Check out</button>
            <button id="admin-fleet-checkin" class="button secondary" data-requires-permission="fleet:write" type="button">Check in</button>
          </div>
        </div>
      </div>
      <div class="admin-volunteers-panel" id="admin-volunteers">
        <div class="editor-heading">
          <p class="eyebrow">Volunteer coverage</p>
          <h2>Shift fill vs needed by zone</h2>
        </div>
        <button id="admin-load-volunteers" class="button secondary" data-requires-permission="volunteers:read" type="button">Load coverage</button>
        <p id="admin-volunteers-updated" class="admin-revenue-updated">Volunteer coverage, shifts, and hours load from the governed scheduling mirror.</p>
        <div id="admin-volunteers-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No volunteer coverage loaded.</span></article>
        </div>
        <div class="admin-volunteers-breakdown">
          <div>
            <strong>By zone</strong>
            <div id="admin-volunteers-zones" class="admin-volunteers-rows keyboard-scroll-region" role="region" aria-label="Volunteer coverage by zone" tabindex="0"></div>
          </div>
          <div>
            <strong>Understaffed shifts</strong>
            <div id="admin-volunteers-gaps" class="admin-volunteers-rows keyboard-scroll-region" role="region" aria-label="Understaffed volunteer shifts" tabindex="0"></div>
          </div>
        </div>
        <form id="admin-import-volunteers" class="admin-inline-form admin-revenue-import" data-requires-permission="volunteers:write">
          <strong>Reconcile VolunteerLocal exports</strong>
          <label class="admin-import-file"><span>Roster CSV</span><input name="rosterFile" type="file" accept=".csv,text/csv" required /></label>
          <label class="admin-import-file"><span>Shifts CSV (optional)</span><input name="shiftsFile" type="file" accept=".csv,text/csv" /></label>
          <label class="admin-import-file"><span>Hours CSV (optional)</span><input name="hoursFile" type="file" accept=".csv,text/csv" /></label>
          <label class="admin-check admin-import-wide"><input name="currentEventConfirmed" type="checkbox" /><span>I verified every selected export belongs to the current SandFest event.</span></label>
          <div id="admin-volunteer-import-result" class="admin-import-result admin-import-wide" aria-live="polite"></div>
          <div class="admin-import-actions admin-import-wide">
            <button class="button secondary" type="submit">Preview reconciliation</button>
            <button id="admin-commit-volunteer-import" class="button primary" type="button" hidden disabled>Commit reconciliation</button>
          </div>
        </form>
        <div class="admin-revenue-import-history">
          <strong>Recent VolunteerLocal imports</strong>
          <div id="admin-volunteer-import-history" class="admin-revenue-rows"><article class="empty-state"><span>No VolunteerLocal imports.</span></article></div>
        </div>
      </div>
      <div class="admin-consent-panel" id="admin-consent">
        <div class="editor-heading">
          <p class="eyebrow">Consent &amp; SMS</p>
          <h2>Checkout opt-ins feeding Brevo + Twilio</h2>
        </div>
        <button id="admin-load-consent" class="button secondary" data-requires-permission="consent:read" type="button">Load consent</button>
        <p id="admin-consent-updated" class="admin-revenue-updated">Separate unchecked opt-ins for email marketing, SMS promo, and SMS safety. Load consent to verify provider readiness.</p>
        <div id="admin-consent-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No consent ledger loaded.</span></article>
        </div>
        ${BOARD_DEMO_ACCESS.enabled ? `
          <div id="admin-board-sms-preference" class="admin-board-sms-preference" data-requires-permission="alert:write" hidden>
            <div>
              <strong>Sandbox attendee preference</strong>
              <span id="admin-board-sms-preference-status" role="status" aria-live="polite">Loading signed callback state...</span>
            </div>
            <div class="admin-board-sms-preference-actions">
              <button type="button" class="button secondary" data-board-sms-preference="STOP">Simulate STOP</button>
              <button type="button" class="button secondary" data-board-sms-preference="START">Simulate START</button>
            </div>
          </div>
        ` : ""}
        <div>
          <strong>Safety SMS delivery</strong>
          <div id="admin-sms-campaigns" class="admin-fleet-rows keyboard-scroll-region" role="region" aria-label="Safety SMS delivery campaigns" tabindex="0"></div>
        </div>
      </div>
      <div class="admin-passport-panel">
        <div class="editor-heading">
          <p class="eyebrow">Sculpture Passport</p>
          <h2>QR stamp completions &amp; finishers</h2>
        </div>
        <button id="admin-load-passport" class="button secondary" data-requires-permission="passport:read" type="button">Load passport stats</button>
        <p id="admin-passport-updated" class="admin-revenue-updated">Scans and taps synchronize checkpoint progress, rewards, and attendance totals.</p>
        <div id="admin-passport-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No passport stats loaded.</span></article>
        </div>
        <div id="admin-passport-checkpoints" class="admin-fleet-rows keyboard-scroll-region" role="region" aria-label="Sculpture Passport checkpoint totals" tabindex="0"></div>
      </div>
      <div class="admin-voting-panel">
        <div class="editor-heading">
          <p class="eyebrow">People's Choice</p>
          <h2>Live vote tallies</h2>
        </div>
        <button id="admin-load-voting" class="button secondary" data-requires-permission="voting:read" type="button">Load votes</button>
        <div id="admin-voting-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No votes loaded.</span></article>
        </div>
      </div>
      <div class="admin-booths-panel">
        <div class="editor-heading">
          <p class="eyebrow">Booth map</p>
          <h2>Vendor readiness &amp; public pins</h2>
        </div>
        <button id="admin-load-booths" class="button secondary" data-requires-permission="booths:read" type="button">Load booths</button>
        <div id="admin-booths-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No booths loaded.</span></article>
        </div>
        <form id="admin-import-booths" class="admin-inline-form admin-revenue-import" data-requires-permission="booths:write">
          <strong>Reconcile Eventeny booth assignments</strong>
          <label class="admin-import-file admin-import-wide"><span>Booth CSV</span><input name="boothFile" type="file" accept=".csv,text/csv" required /></label>
          <label class="admin-check admin-import-wide"><input name="currentEventConfirmed" type="checkbox" /><span>I verified this export belongs to the current SandFest event.</span></label>
          <div id="admin-booth-import-result" class="admin-import-result admin-import-wide" aria-live="polite"></div>
          <div class="admin-import-actions admin-import-wide">
            <button class="button secondary" type="submit">Preview reconciliation</button>
            <button id="admin-commit-booth-import" class="button primary" type="button" hidden disabled>Commit reconciliation</button>
          </div>
        </form>
        <div class="admin-revenue-import-history">
          <strong>Recent Eventeny booth imports</strong>
          <div id="admin-booth-import-history" class="admin-revenue-rows"><article class="empty-state"><span>No Eventeny booth imports.</span></article></div>
        </div>
      </div>
      <div class="admin-partners-panel" id="admin-partners">
        <div class="editor-heading">
          <p class="eyebrow">Partner operations</p>
          <h2>Applications, payments, dates, follow-ups, and assignments</h2>
        </div>
        <div class="admin-partner-actions">
          <button id="admin-load-partners" class="button secondary" data-requires-permission="partners:read" type="button">Load partner workspace</button>
          <button id="admin-load-conditions" class="button secondary" data-requires-permission="conditions:read" type="button">Load island operations</button>
          <div class="admin-export-control">
            <select id="admin-export-type" aria-label="Operations export">
              <option value="partners.csv">Partner directory</option>
              <option value="receivables.csv">Receivables</option>
              <option value="payments.csv">Payment ledger</option>
              <option value="tasks.csv">Staff and volunteer tasks</option>
              <option value="outreach.csv">Sponsor outreach</option>
              <option value="milestones.ics">Key dates calendar</option>
            </select>
            <button id="admin-download-export" class="button secondary" type="button">Download</button>
          </div>
        </div>
        <div id="admin-partner-kpis" class="admin-revenue-kpis"><article class="empty-state"><span>No partner records loaded.</span></article></div>
        <div class="admin-partner-activity-board">
          <div class="admin-task-board-heading">
            <strong>Recent partner workflow activity</strong>
            <span id="admin-partner-activity-summary">Load partner workspace to view activity.</span>
          </div>
          <div id="admin-partner-activity" class="admin-partner-activity keyboard-scroll-region" role="feed" aria-label="Recent partner workflow activity" tabindex="0">
            <article class="empty-state"><span>No partner activity loaded.</span></article>
          </div>
        </div>
        <form id="admin-partner-automation" class="admin-partner-automation" data-requires-permission="partners:write">
          <div><strong>Transactional partner messages</strong><span id="admin-partner-automation-status">Load partner workspace to view policy state.</span></div>
          <select name="mode" aria-label="Partner message automation mode">
            <option value="review_first">Review first</option>
            <option value="transactional_auto">Automatic transactional</option>
          </select>
          <button class="button secondary" type="submit">Save policy</button>
        </form>
        <div id="admin-quickbooks-connection" class="admin-quickbooks-connection">
          <div><strong>QuickBooks accounting connection</strong><span id="admin-quickbooks-status" aria-live="polite">Load partner workspace to view connection state.</span></div>
          <div class="admin-quickbooks-actions">
            <button id="admin-connect-quickbooks" class="button primary" data-requires-permission="finance:write" type="button">Connect QuickBooks</button>
            <button id="admin-refresh-quickbooks" class="button secondary" data-requires-permission="partners:read" type="button">Refresh status</button>
            <button id="admin-disconnect-quickbooks" class="button secondary" data-requires-permission="finance:write" type="button" hidden>Disconnect</button>
          </div>
        </div>
        <div class="admin-incident-board" id="admin-incident-command">
          <div class="admin-task-board-heading"><strong>Island incident command</strong><span id="admin-incident-summary">Load island operations to view incidents.</span></div>
          <div id="admin-incident-kpis" class="admin-incident-kpis"><article class="empty-state"><span>No incident data loaded.</span></article></div>
          <div class="admin-incident-toolbar">
            <select id="admin-incident-filter" aria-label="Incident status filter">
              <option value="active">Active incidents</option><option value="open">Open</option><option value="responding">Responding</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option><option value="all">All incidents</option>
            </select>
          </div>
          <form id="admin-create-incident" class="admin-incident-create" data-requires-permission="conditions:write">
            <label><span>Incident</span><input name="title" required maxlength="180" placeholder="South gate access issue" /></label>
            <label><span>Severity</span><select name="severity"><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label>
            <label><span>Team</span><select name="ownerTeam"><option value="operations">Operations</option><option value="traffic">Traffic</option><option value="guest-services">Guest services</option><option value="safety">Safety</option><option value="medical">Medical</option><option value="security">Security</option><option value="production">Production</option><option value="volunteer-captains">Volunteer captains</option></select></label>
            <label><span>Owner</span><input name="ownerName" maxlength="120" placeholder="Unassigned" /></label>
            <label class="admin-incident-wide"><span>Situation</span><textarea name="summary" rows="2" maxlength="1000"></textarea></label>
            <label class="admin-incident-public"><input name="publicImpact" type="checkbox" /><span>Approved public notice</span></label>
            <button class="button primary" type="submit">Open incident</button>
          </form>
          <div id="admin-incidents" class="admin-incident-list keyboard-scroll-region" role="region" aria-label="Island incident list" tabindex="0"></div>
        </div>
        <div id="admin-partner-tasks-workspace" class="admin-task-board">
          <div class="admin-task-board-heading"><strong>Staff and volunteer work board</strong><span id="admin-task-board-summary">Load partner workspace to view assignments.</span></div>
          <form id="admin-import-staff" class="admin-inline-form admin-staff-import" data-requires-permission="staff:write">
            <div class="admin-task-board-heading admin-import-wide"><strong>Staff routing directory</strong><span id="admin-staff-directory-status">Load partner workspace to view routing readiness.</span></div>
            <label class="admin-import-file"><span>Staff CSV or JSON</span><input name="file" type="file" accept=".csv,.json,text/csv,application/json" required /></label>
            <label><span>Verified source</span><select name="source"><option value="manual_verified">Board verified</option><option value="connecteam">Connecteam</option><option value="oidc">Identity provider</option><option value="hr_import">HR import</option></select></label>
            <label class="admin-check admin-import-wide"><input name="currentEventConfirmed" type="checkbox" /><span>I verified this directory and all notification routes belong to the current SandFest event.</span></label>
            <div id="admin-staff-import-result" class="admin-import-result admin-import-wide" aria-live="polite"></div>
            <div class="admin-import-actions admin-import-wide">
              <button class="button secondary" type="submit">Preview directory</button>
              <button id="admin-commit-staff-import" class="button primary" type="button" hidden disabled>Commit directory</button>
            </div>
          </form>
          <div class="admin-task-toolbar">
            <select id="admin-task-status-filter" aria-label="Task status filter">
              <option value="active">Active tasks</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="blocked">Blocked</option><option value="done">Completed</option><option value="all">All tasks</option>
            </select>
            <select id="admin-task-assignment-filter" aria-label="Task assignment filter">
              <option value="all">All assignments</option><option value="unassigned">Unassigned</option><option value="staff">Staff</option><option value="volunteer">Volunteers</option><option value="team">Teams</option>
            </select>
            <input id="admin-task-search" type="search" maxlength="120" placeholder="Search tasks or owners" aria-label="Search tasks or owners" />
          </div>
          <div id="admin-partner-tasks" class="admin-task-list"></div>
        </div>
        <div id="admin-partner-milestones-workspace" class="admin-key-date-board">
          <div class="admin-task-board-heading"><strong>Partner key dates and reminder cadence</strong><span id="admin-key-date-summary">Load partner workspace to manage dates.</span></div>
          <form id="admin-create-milestone" class="admin-key-date-create" data-requires-permission="partners:write">
            <select name="applicationId" required aria-label="Partner account"><option value="">Partner account</option></select>
            <input name="label" required maxlength="160" placeholder="New key date" aria-label="Key date label" />
            <input name="dueAt" required type="datetime-local" aria-label="Key date due date" />
            <select name="assigneeTeam" aria-label="Responsible team"><option value="operations">Operations</option><option value="sponsor">Sponsor</option><option value="finance">Finance</option><option value="volunteer-captains">Volunteer captains</option><option value="traffic">Traffic and parking</option><option value="guest-services">Guest services</option><option value="production">Production</option></select>
            <input name="reminderLeadDays" type="number" min="0" max="30" step="1" value="3" aria-label="Reminder lead days" />
            <button class="button primary" type="submit">Add key date</button>
          </form>
          <div id="admin-partner-milestones" class="admin-key-date-list keyboard-scroll-region" role="region" aria-label="Partner key dates" tabindex="0"></div>
        </div>
        <div id="admin-sponsor-fulfillment-workspace" class="admin-fulfillment-board">
          <div class="admin-task-board-heading"><strong>Sponsor brand and benefit fulfillment</strong><span id="admin-fulfillment-summary">Load partner workspace to view sponsor delivery.</span></div>
          <div id="admin-sponsor-fulfillment" class="admin-sponsor-fulfillment"></div>
        </div>
        <div id="admin-vendor-readiness-workspace" class="admin-vendor-readiness-board">
          <div class="admin-task-board-heading"><strong>Vendor compliance and load-in readiness</strong><span id="admin-vendor-readiness-summary">Load partner workspace to view vendor readiness.</span></div>
          <div id="admin-vendor-readiness" class="admin-vendor-readiness"></div>
        </div>
        <div class="admin-receivables-board">
          <div class="admin-task-board-heading"><strong>Receivables aging and reconciliation</strong><span id="admin-receivables-summary">Load partner workspace to review balances.</span></div>
          <div id="admin-receivables-aging" class="admin-receivables-aging"></div>
          <div class="admin-receivables-columns">
            <div id="admin-receivables-workspace"><strong>Open accounts</strong><div id="admin-receivables-accounts" class="admin-receivables-list keyboard-scroll-region" role="region" aria-label="Open receivable accounts" tabindex="0"></div></div>
            <div><strong>Exceptions</strong><div id="admin-receivables-exceptions" class="admin-receivables-list keyboard-scroll-region" role="region" aria-label="Receivable reconciliation exceptions" tabindex="0"></div></div>
          </div>
        </div>
        <div class="admin-partner-columns">
          <div id="admin-partner-applications-workspace"><strong>Applications and accounting</strong><div id="admin-partner-applications" class="admin-partner-list keyboard-scroll-region" role="region" aria-label="Partner applications and accounting" tabindex="0"></div></div>
          <div id="admin-partner-followups-workspace"><strong>Message drafts</strong><div id="admin-partner-followups" class="admin-partner-list keyboard-scroll-region" role="region" aria-label="Partner message drafts" tabindex="0"></div></div>
        </div>
        <div class="admin-partner-create">
          <form id="admin-import-partners" class="admin-inline-form admin-outreach-import" data-requires-permission="partners:write">
            <strong>Import Eventeny applications</strong>
            <label class="admin-import-file"><span>CSV file</span><input name="file" type="file" accept=".csv,text/csv" /></label>
            <label><span>Default type</span><select name="defaultType"><option value="">Use CSV type</option><option value="vendor">Vendor</option><option value="sponsor">Sponsor</option></select></label>
            <label class="admin-prospect-community admin-import-wide"><input name="transactionalContactConfirmed" type="checkbox" required /> <span>Eventeny applicant relationship permits transactional organizer messages</span></label>
            <label class="admin-import-wide"><span>CSV data</span><textarea name="csv" required rows="7" placeholder="application_id,type,business_name,contact_name,contact_email,category,offering_id,package_id,status"></textarea></label>
            <div id="admin-partner-import-result" class="admin-import-result admin-import-wide" aria-live="polite"></div>
            <div class="admin-import-actions admin-import-wide">
              <button class="button secondary" type="submit">Preview applications</button>
              <button id="admin-commit-partner-import" class="button primary" type="button" hidden disabled>Import valid applications</button>
            </div>
          </form>
          <form id="admin-create-task" class="admin-inline-form admin-task-create" data-requires-permission="partners:write">
            <strong>Delegate a task</strong>
            <label><span>Task</span><input name="title" required maxlength="180" /></label>
            <label><span>Assignment</span><select name="assigneeType"><option value="team">Team</option><option value="volunteer">Volunteer</option><option value="staff">Staff member</option><option value="unassigned">Unassigned</option></select></label>
            <label><span>Owner</span><select name="assigneeId" required></select></label>
            <label><span>Due date</span><input name="dueAt" type="datetime-local" /></label>
            <label><span>Priority</span><select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></label>
            <label class="admin-task-wide"><span>Description</span><textarea name="description" rows="3" maxlength="1000"></textarea></label>
            <datalist id="admin-task-assignee-options"></datalist>
            <button class="button primary" type="submit">Assign task</button>
          </form>
          <form id="admin-create-prospect" class="admin-inline-form" data-requires-permission="outreach:write">
            <strong>Add outreach target</strong>
            <input name="organizationName" required maxlength="160" placeholder="Business" aria-label="Business or organization" />
            <input name="contactName" maxlength="120" placeholder="Decision maker" aria-label="Decision maker" />
            <input name="industry" maxlength="100" placeholder="Industry" aria-label="Business industry" />
            <input name="city" maxlength="100" placeholder="City" aria-label="Business city" />
            <input name="state" maxlength="40" value="TX" placeholder="State" aria-label="Business state" />
            <input name="postalCode" inputmode="numeric" maxlength="10" placeholder="ZIP code" aria-label="Business ZIP code" />
            <input name="latitude" type="number" min="-90" max="90" step="any" placeholder="Latitude" aria-label="Business latitude" />
            <input name="longitude" type="number" min="-180" max="180" step="any" placeholder="Longitude" aria-label="Business longitude" />
            <input name="contactEmail" type="email" maxlength="254" placeholder="Business email" aria-label="Business contact email" required />
            <label class="admin-prospect-community"><span>Community fit</span><input name="communityFit" type="checkbox" /></label>
            <select name="contactBasis" required aria-label="Contact basis">
              <option value="">Contact basis</option>
              <option value="business_relevance">Relevant business contact</option>
              <option value="existing_relationship">Existing relationship</option>
              <option value="event_partner">Current or prior partner</option>
              <option value="inbound_request">Inbound request</option>
              <option value="referral">Referral</option>
            </select>
            <select name="status" aria-label="Prospect readiness"><option value="contact_ready">Contact ready</option><option value="qualified">Qualified</option><option value="researching">Researching</option><option value="identified">Identified</option></select>
            <input name="ownerId" maxlength="100" list="admin-task-assignee-options" placeholder="Follow-up owner" aria-label="Follow-up owner" />
            <label><span>Follow-up due</span><input name="nextActionAt" type="datetime-local" /></label>
            <label class="admin-task-wide"><span>Next action</span><input name="nextAction" maxlength="300" value="Research decision maker" /></label>
            <button class="button primary" type="submit">Score prospect</button>
          </form>
          <form id="admin-import-prospects" class="admin-inline-form admin-outreach-import" data-requires-permission="outreach:write">
            <strong>Import outreach list</strong>
            <label class="admin-import-file"><span>CSV file</span><input name="file" type="file" accept=".csv,text/csv" /></label>
            <label><span>Default contact basis</span><select name="contactBasis" required>
              <option value="business_relevance">Relevant business contact</option>
              <option value="existing_relationship">Existing relationship</option>
              <option value="event_partner">Current or prior partner</option>
              <option value="inbound_request">Inbound request</option>
              <option value="referral">Referral</option>
            </select></label>
            <label><span>Default readiness</span><select name="status"><option value="identified">Identified</option><option value="researching">Researching</option><option value="qualified">Qualified</option><option value="contact_ready">Contact ready</option></select></label>
            <label><span>Default state</span><input name="state" maxlength="40" value="TX" /></label>
            <label class="admin-prospect-community"><span>Community fit</span><input name="communityFit" type="checkbox" /></label>
            <label class="admin-import-wide"><span>CSV data</span><textarea name="csv" required rows="7" placeholder="organization_name,industry,city,state,postal_code,latitude,longitude,contact_name,contact_email"></textarea></label>
            <div id="admin-outreach-import-result" class="admin-import-result admin-import-wide" aria-live="polite"></div>
            <div class="admin-import-actions admin-import-wide">
              <button class="button secondary" type="submit">Preview rows</button>
              <button id="admin-commit-prospect-import" class="button primary" type="button" hidden disabled>Import valid rows</button>
            </div>
          </form>
          <form id="admin-discover-businesses" class="admin-outreach-discovery" data-requires-permission="outreach:write">
            <div class="admin-discovery-heading">
              <strong>Discover regional businesses</strong>
              <span id="admin-outreach-discovery-readiness">Provider not loaded</span>
            </div>
            <div class="admin-discovery-fields">
              <label><span>Location</span><input name="location" maxlength="160" value="Port Aransas, TX 78373" /></label>
              <label><span>Latitude</span><input name="latitude" type="number" min="-90" max="90" step="any" placeholder="Optional" /></label>
              <label><span>Longitude</span><input name="longitude" type="number" min="-180" max="180" step="any" placeholder="Optional" /></label>
              <label><span>Radius</span><input name="radiusMiles" type="number" min="0.5" max="50" step="0.5" value="25" /></label>
              <label><span>Results</span><input name="limit" type="number" min="1" max="50" value="20" /></label>
            </div>
            <fieldset class="admin-discovery-categories">
              <legend>Business categories</legend>
              <label><input type="checkbox" name="categories" value="lodging" checked /> Lodging</label>
              <label><input type="checkbox" name="categories" value="food_beverage" checked /> Food and beverage</label>
              <label><input type="checkbox" name="categories" value="financial" checked /> Financial</label>
              <label><input type="checkbox" name="categories" value="healthcare" /> Healthcare</label>
              <label><input type="checkbox" name="categories" value="retail" checked /> Retail</label>
              <label><input type="checkbox" name="categories" value="professional_services" /> Professional services</label>
              <label><input type="checkbox" name="categories" value="automotive" /> Automotive</label>
              <label><input type="checkbox" name="categories" value="arts_entertainment" /> Arts and entertainment</label>
            </fieldset>
            <div class="admin-discovery-actions">
              <button class="button secondary" type="submit">Search businesses</button>
              <button id="admin-import-discovered-businesses" class="button primary" type="button" hidden disabled>Import selected</button>
            </div>
            <div id="admin-outreach-discovery-result" class="admin-discovery-result" aria-live="polite"></div>
          </form>
        </div>
        <div class="admin-outreach-workspace">
          <form id="admin-create-campaign" class="admin-campaign-form" data-requires-permission="outreach:write">
            <div class="editor-heading">
              <p class="eyebrow">Sponsor outreach</p>
              <h3>Build a targeted campaign</h3>
            </div>
            <div class="admin-campaign-fields">
              <label><span>Campaign</span><input name="name" required maxlength="160" placeholder="Coastal hospitality partners" /></label>
              <label><span>Goal</span><input name="objective" maxlength="500" placeholder="Introduce the 2027 sponsor program" /></label>
              <label><span>Industries</span><input name="industries" maxlength="500" placeholder="hospitality, banking" /></label>
              <label><span>Cities</span><input name="cities" maxlength="500" placeholder="Port Aransas, Corpus Christi" /></label>
              <label><span>States</span><input name="states" maxlength="100" value="TX" /></label>
              <label><span>ZIP codes</span><input name="postalCodes" maxlength="300" placeholder="78373, 78418" /></label>
              <label class="admin-campaign-wide"><span>Center point</span><select name="centerSource"><option value="none">Business filters only (no radius)</option><option value="sandfest">Texas SandFest, Port Aransas</option><option value="custom">Custom coordinates</option></select></label>
              <label><span>Center latitude</span><input name="centerLatitude" type="number" min="-90" max="90" step="any" placeholder="27.8339" /></label>
              <label><span>Center longitude</span><input name="centerLongitude" type="number" min="-180" max="180" step="any" placeholder="-97.0611" /></label>
              <label><span>Radius miles</span><input name="radiusMiles" type="number" min="0.1" max="500" step="0.1" placeholder="25" /></label>
              <output id="admin-campaign-center-preview" class="admin-campaign-center-preview admin-campaign-wide" aria-live="polite"><strong>Business filters only</strong><span>Add a center and radius when this campaign should be geographically bounded.</span></output>
              <label><span>Minimum fit</span><input name="minFitScore" type="number" min="0" max="100" value="60" /></label>
              <label><span>Delivery</span><select name="deliveryMode"><option value="review_first">Review every message</option><option value="approved_sequence">Automate approved sequence</option></select></label>
              <label><span>Daily send limit</span><input name="dailySendLimit" type="number" min="1" max="100" value="25" /></label>
              <label class="admin-campaign-wide"><span>Opening subject</span><input name="subject1" required maxlength="180" value="A Texas SandFest partnership for {{organization}}" /></label>
              <label class="admin-campaign-wide"><span>Opening message</span><textarea name="body1" required rows="5" maxlength="5000">Hello {{contactName}},\n\nTexas SandFest brings artists, visitors, and Coastal Bend businesses together for one of the region's signature events. We would love to explore how {{organization}} could be represented as a 2027 sponsor.\n\nMay we send the current partnership opportunities?</textarea></label>
              <label><span>Follow-up delay</span><input name="delay2" type="number" min="1" max="90" value="7" /></label>
              <label><span>Follow-up subject</span><input name="subject2" required maxlength="180" value="Following up with {{organization}}" /></label>
              <label class="admin-campaign-wide"><span>Follow-up message</span><textarea name="body2" required rows="4" maxlength="5000">Hello {{contactName}},\n\nI wanted to follow up on the Texas SandFest partnership opportunity. I would be glad to help identify the sponsorship level that best fits {{organization}}.\n\nTexas SandFest</textarea></label>
            </div>
            <div class="admin-campaign-actions">
              <button id="admin-preview-campaign" class="button secondary" type="button">Preview audience</button>
              <button class="button primary" type="submit" disabled>Create campaign draft</button>
            </div>
            <section id="admin-campaign-audience-preview" class="admin-campaign-audience-preview" data-state="idle" aria-live="polite">
              <strong>Audience preview required</strong><span>Check exact server-qualified businesses and message personalization before saving this campaign draft.</span>
            </section>
          </form>
          <div>
            <strong>Campaigns</strong>
            <div id="admin-outreach-campaigns" class="admin-partner-list admin-campaign-list keyboard-scroll-region" role="region" aria-label="Sponsor outreach campaigns" tabindex="0"></div>
          </div>
        </div>
        <section id="admin-outreach-targeting-map" class="admin-outreach-targeting-map" aria-label="Campaign coverage">
          <div class="admin-outreach-map-empty">Campaign coverage loads with the outreach workspace.</div>
        </section>
        <div class="admin-partner-columns admin-conditions-columns">
          <div id="admin-outreach-prospects-workspace"><strong>Outreach pipeline</strong><div id="admin-outreach-prospects" class="admin-partner-list keyboard-scroll-region" role="region" aria-label="Sponsor outreach pipeline" tabindex="0"></div></div>
          <div class="admin-condition-span" id="admin-island-conditions"><strong>Source health</strong><div id="admin-condition-feeds" class="admin-condition-feeds"><span>Weather and ferry feeds not loaded</span></div><strong>Eight-source condition grid</strong><span id="admin-condition-ingest" class="admin-condition-ingest">Metric ingest not loaded</span><div id="admin-condition-cameras" class="admin-partner-list keyboard-scroll-region" role="region" aria-label="Eight-source condition grid" tabindex="0"></div></div>
        </div>
      </div>
      <div class="admin-editor-layout">
        <div>
          <div class="editor-heading">
            <p class="eyebrow">Ticket pricing</p>
            <h2>GA, VIP, raffle gates</h2>
          </div>
          ${adminTicketPolicyUi?.ticketPolicyEditorMarkup() || ""}
          <div id="admin-ticket-editor" class="admin-editor-list">
            <article class="empty-state">
              <strong>No API config loaded</strong>
              <span>Load the current catalog to manage ticket products.</span>
            </article>
          </div>
        </div>
        <div>
          <div class="editor-heading">
            <p class="eyebrow">Sponsor packages</p>
            <h2>Tiers, benefits, finance mapping</h2>
          </div>
          <form id="admin-create-sponsor-package" class="admin-edit-card admin-sponsor-create" data-requires-permission="sponsor:write">
            <div class="admin-edit-title">
              <strong>Add sponsor tier</strong>
              <span>Published immediately when active</span>
            </div>
            <div class="admin-form-grid">
              <label><span>Name</span><input name="name" required maxlength="120" autocomplete="off" placeholder="Community Partner" /></label>
              <label><span>Tier ID</span><input name="id" required maxlength="100" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" autocomplete="off" placeholder="community-partner" /></label>
              <label><span>Amount</span><input name="amount" required type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="7500.00" /></label>
              <label><span>Public label</span><input name="publicLabel" maxlength="120" placeholder="Generated from amount" /></label>
              <label><span>Stripe ID</span><input name="stripePriceId" maxlength="160" autocomplete="off" placeholder="Optional" /></label>
              <label><span>QBO item</span><input name="quickBooksItemId" maxlength="160" autocomplete="off" placeholder="Optional" /></label>
            </div>
            <label><span>Benefits</span><textarea name="benefits" required rows="4" maxlength="4000" placeholder="One public benefit per line"></textarea></label>
            <div class="admin-check-row">
              <label class="admin-check"><input name="active" type="checkbox" checked /><span>Publicly active</span></label>
              <label class="admin-check"><input name="requiresApproval" type="checkbox" checked /><span>Approval required</span></label>
            </div>
            <div class="admin-edit-actions">
              <span>Provider mappings remain private</span>
              <button class="button primary" type="submit">Add tier</button>
            </div>
          </form>
          <div id="admin-sponsor-editor" class="admin-editor-list">
            <article class="empty-state">
              <strong>No sponsor config loaded</strong>
              <span>Use Load config to edit Heyelab-hosted sponsorship settings.</span>
            </article>
          </div>
        </div>
        <div class="admin-editor-span">
          <div class="editor-heading">
            <p class="eyebrow">Vendor offerings</p>
            <h2>Categories, intake mode, fees, and accounting</h2>
          </div>
          <form id="admin-create-vendor-offering" class="admin-edit-card admin-vendor-offering-create" data-requires-permission="finance:write">
            <div class="admin-edit-title">
              <strong>Add vendor offering</strong>
              <span>New application package</span>
            </div>
            <div class="admin-form-grid">
              <label><span>Name</span><input name="name" required maxlength="120" autocomplete="off" placeholder="Premium marketplace booth" /></label>
              <label><span>Offering ID</span><input name="id" required maxlength="100" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" autocomplete="off" placeholder="premium-marketplace-booth" /></label>
              <label><span>Amount</span><input name="amount" required type="number" min="0" max="1000000" step="0.01" inputmode="decimal" placeholder="2500.00" /></label>
              <label><span>Intake mode</span><select name="intakeMode"><option value="interest">Interest list</option><option value="application">Applications open</option></select></label>
              <label><span>Public label</span><input name="publicLabel" maxlength="120" placeholder="Generated from amount" /></label>
              <label><span>Stripe ID</span><input name="stripePriceId" maxlength="160" autocomplete="off" placeholder="Optional" /></label>
              <label><span>QBO item</span><input name="quickBooksItemId" maxlength="160" autocomplete="off" placeholder="Optional" /></label>
            </div>
            <fieldset class="admin-vendor-categories">
              <legend>Eligible categories</legend>
              <label class="admin-check"><input name="categories" type="checkbox" value="food" /><span>Food</span></label>
              <label class="admin-check"><input name="categories" type="checkbox" value="retail" /><span>Retail</span></label>
              <label class="admin-check"><input name="categories" type="checkbox" value="artisan" /><span>Artisan</span></label>
              <label class="admin-check"><input name="categories" type="checkbox" value="service" /><span>Service</span></label>
              <label class="admin-check"><input name="categories" type="checkbox" value="nonprofit" /><span>Nonprofit</span></label>
            </fieldset>
            <label><span>Public description</span><textarea name="description" required rows="3" maxlength="500" placeholder="Describe the space and eligible vendor use."></textarea></label>
            <label><span>Inclusions</span><textarea name="inclusions" required rows="3" maxlength="4000" placeholder="One inclusion per line"></textarea></label>
            <div class="admin-check-row">
              <label class="admin-check"><input name="active" type="checkbox" checked /><span>Publicly active</span></label>
              <label class="admin-check"><input name="requiresApproval" type="checkbox" checked /><span>Approval required</span></label>
            </div>
            <div class="admin-edit-actions">
              <span></span>
              <button class="button primary" type="submit">Add offering</button>
            </div>
          </form>
          <div id="admin-vendor-offering-editor" class="admin-editor-list admin-vendor-offering-editor">
            <article class="empty-state">
              <strong>No vendor offering config loaded</strong>
              <span>Use Load config to edit public vendor programs and intake mode.</span>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section class="section media-section" id="media">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Scenes from SandFest</p>
          <h2>Artistry, community, and Gulf Coast energy.</h2>
          <p class="section-copy">A look at the sculptures, shared moments, and beach setting that make Texas SandFest a Port Aransas tradition.</p>
        </div>
      </div>
      <div class="media-gallery">
        ${galleryAssets.map(asset => `
          <figure>
            <img ${responsiveImageAttributes(asset, "(max-width: 760px) 100vw, 25vw")} alt="${escapeAttr(asset.alt || asset.name || "Texas SandFest media")}" loading="lazy" decoding="async" />
          </figure>
        `).join("")}
      </div>
    </section>

    <section class="split" id="concierge">
      <div>
        <p class="eyebrow">Visitor concierge</p>
        <h2>Current answers for planning a day on the beach.</h2>
        <p class="section-copy">Ask about tickets, schedules, accessibility, parking, vendors, sponsorships, and volunteer opportunities.</p>
        <div class="prompt-grid">
          <button data-prompt="Where do I buy tickets?">Tickets</button>
          <button data-prompt="When is SandFest open?">Schedule</button>
          <button data-prompt="What is the current weather?">Weather</button>
          <button data-prompt="What is the current ferry wait?">Ferry</button>
          <button data-prompt="What sponsorship packages are open?">Sponsors</button>
          <button data-prompt="How do vendors apply?">Vendors</button>
          <button data-prompt="What accessibility guidance is available?">Accessibility</button>
        </div>
      </div>
      <div class="assistant-panel">
        <div class="assistant-header">
          <div>
            <strong>Ask Sandy</strong>
            <span>Trusted SandFest concierge</span>
          </div>
          <span class="live-pill">Reviewed sources</span>
        </div>
        <div id="chat" class="chat-log keyboard-scroll-region" role="log" aria-label="Ask Sandy conversation" aria-live="polite" aria-relevant="additions" tabindex="0">
          <div class="message ai">Ask about tickets, schedules, sponsors, vendors, weather, ferry waits, or live beach conditions.</div>
        </div>
        <form id="ask-form" class="ask-form">
          <input id="ask-input" name="question" autocomplete="off" maxlength="280" placeholder="Ask a SandFest question..." aria-label="Ask Sandy a question" />
          <button id="ask-submit" class="button primary" type="submit">Ask</button>
        </form>
      </div>
    </section>

    <section class="section" id="operations">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Command center</p>
          <h2>Live beach operating system</h2>
        </div>
        <button id="simulate-btn" class="button secondary" type="button">Simulate crowd update</button>
      </div>
      <div class="ops-grid">
        <div class="map-panel">
          <div class="beach-map" aria-label="Beach zone map">
            ${zones.map((zone, index) => `
              <button class="zone zone-${index + 1}" data-zone="${zone.name}">
                <strong>${zone.name}</strong>
                <span>${zone.load}%</span>
              </button>
            `).join("")}
          </div>
          <div id="zone-detail" class="zone-detail">
            <strong>North Gate</strong>
            <span>Ticket scan, ADA routing, wristband support</span>
          </div>
        </div>
        <div class="schedule-panel">
          <h3>Run of show</h3>
          <div class="schedule-list">
            ${schedule.map(item => `
              <article>
                <time>${item.day} ${item.time}</time>
                <strong>${item.title}</strong>
                <span>${item.zone}</span>
                <em>${item.type}</em>
              </article>
            `).join("")}
          </div>
        </div>
      </div>
    </section>

    <section class="section map-media-section">
      <div>
        <p class="eyebrow">Know before you go</p>
        <h2>See the beach corridor before you arrive.</h2>
        <p class="section-copy">Use festival maps and recent imagery to recognize the beach setting, plan the day, and arrive with a clearer picture of the event.</p>
      </div>
      <div class="map-media-grid">
        ${[...mapAssets, ...featuredPhotoAssets].slice(0, 6).map(asset => `
          <figure>
            <img ${responsiveImageAttributes(asset, "(max-width: 760px) 100vw, 20vw")} alt="${escapeAttr(asset.alt || asset.name || "Texas SandFest visual asset")}" loading="lazy" decoding="async" />
            <figcaption>${asset.category.replace("-", " ")}</figcaption>
          </figure>
        `).join("")}
      </div>
    </section>

    <section class="section admin-console" id="admin">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Admin ingestion cockpit</p>
          <h2>Turn chaotic source drops into reviewed platform records.</h2>
          <p class="section-copy">This is the operating layer we need before connecting more accounts: every source gets a status, owner, drop zone, review pass, and promotion path into the customer/admin app.</p>
        </div>
      </div>
      <div class="pipeline-grid">
        ${ingestionPipelines.map(pipeline => `
          <article>
            <div>
              <strong>${pipeline.name}</strong>
              <span>${pipeline.status}</span>
            </div>
            <b>${pipeline.count}</b>
            <p>${pipeline.detail}</p>
            <code>${pipeline.drop}</code>
          </article>
        `).join("")}
      </div>
      <div class="admin-task-panel">
        <div>
          <p class="eyebrow">Next access unlocks</p>
          <h3>Plug-in sequence</h3>
          <p class="section-copy">Once credentials and exports arrive, these become the first implementation passes before any public launch.</p>
        </div>
        <div class="task-list">
          ${adminTasks.map(([name, detail], index) => `
            <article>
              <span>${index + 1}</span>
              <div>
                <strong>${name}</strong>
                <p>${detail}</p>
              </div>
            </article>
          `).join("")}
        </div>
      </div>
      <div class="incoming-file-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Detected files</p>
            <h3>Incoming review queue</h3>
          </div>
          <span>${incomingInventory ? `${incomingInventory.totalFiles} files` : "No scan yet"}</span>
        </div>
        <div class="incoming-table">
          ${incomingFiles.length > 0 ? incomingFiles.slice(0, 12).map(file => `
            <article>
              <strong>${file.name}</strong>
              <span>${file.label}</span>
              <code>${file.relativePath}</code>
              <p>${file.recommendedHandler}</p>
            </article>
          `).join("") : `
            <article class="empty-state">
              <strong>No incoming files yet</strong>
              <span>Drop exports into Eventeny, QuickBooks, finance, ops, docs, or comms folders, then run npm run incoming:scan.</span>
              <code>data/incoming/*</code>
              <p>The scanner will classify files and assign recommended handlers automatically.</p>
            </article>
          `}
        </div>
      </div>
    </section>

    <section class="section workflows" id="workflows">
      <p class="eyebrow">Platform modules</p>
      <h2>Built around the jobs SandFest actually has to run.</h2>
      <div class="workflow-grid">
        ${workflows.map(flow => `
          <article class="workflow-card">
            <span class="workflow-icon">${flow.icon}</span>
            <h3>${flow.title}</h3>
            <p>${flow.detail}</p>
            <div>${flow.actions.map(action => `<span>${action}</span>`).join("")}</div>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section sponsor-section" id="sponsors">
      <div class="partner-heading">
        <p class="eyebrow">Revenue + relationships</p>
        <h2>Partner with Texas SandFest</h2>
        <p class="section-copy">Bring your business to the beach or put your brand behind one of the country's largest sand sculpture festivals.</p>
      </div>
      <div class="tier-table partner-tier-table" id="public-sponsor-tiers">
        ${sponsorPackageCards(publicSponsorPackages)}
      </div>
      <p class="partner-program-note"><a href="https://www.texassandfest.org/sponsorship" target="_blank" rel="noopener noreferrer">View the current sponsorship program</a><span>Package availability and final fulfillment details are confirmed during review.</span></p>
      <div class="partner-form-grid">
        <form id="sponsor-inquiry-form" class="partner-form" data-turnstile-action="sponsor_inquiry">
          <div class="partner-form-heading">
            <div class="partner-form-title"><span>Sponsorship</span><h3>Start a partnership</h3></div>
            ${import.meta.env.DEV && BOARD_DEMO_ACCESS.enabled ? '<button class="button secondary partner-demo-preset" type="button" data-board-partner-preset="sponsor">Use demo sponsor</button>' : ""}
          </div>
          <div id="sponsor-invitation" class="sponsor-invitation" hidden><strong>SandFest invitation</strong><span id="sponsor-invitation-copy"></span></div>
          <div class="partner-fields">
            <label>Business or organization<input name="organizationName" required maxlength="160" autocomplete="organization" /></label>
            <label>Contact name<input name="contactName" required maxlength="120" autocomplete="name" /></label>
            <label>Email<input name="contactEmail" required type="email" maxlength="254" autocomplete="email" /></label>
            <label>Phone<input name="contactPhone" type="tel" maxlength="40" autocomplete="tel" /></label>
            <label>Package<select name="packageId" aria-describedby="sponsor-package-summary" required>${sponsorPackageOptions(publicSponsorPackages)}</select></label>
            <label>Website<input name="website" type="url" maxlength="500" placeholder="https://" autocomplete="url" /></label>
            <label class="partner-field-wide">Partnership goals<textarea name="description" rows="4" maxlength="2000"></textarea></label>
          </div>
          <p id="sponsor-package-summary" class="partner-offering-summary" aria-live="polite"></p>
          <p class="partner-data-use-note">${escapeHtml(sponsorContactNotice.disclosure)}</p>
          <label class="partner-consent"><input name="consentToContact" type="checkbox" required /><span>${escapeHtml(sponsorContactNotice.checkboxLabel)}</span></label>
          <div class="partner-verification" data-turnstile-verification hidden><div data-turnstile-widget></div></div>
          <button class="button primary" type="submit">Submit sponsorship inquiry</button>
          <p class="partner-form-status" aria-live="polite"></p>
        </form>
        <form id="vendor-application-form" class="partner-form" data-turnstile-action="vendor_application">
          <div class="partner-form-heading">
            <div class="partner-form-title"><span id="vendor-intake-label">Vendor interest</span><h3 id="vendor-intake-heading">Join the vendor interest list</h3></div>
            ${import.meta.env.DEV && BOARD_DEMO_ACCESS.enabled ? '<button class="button secondary partner-demo-preset" type="button" data-board-partner-preset="vendor">Use demo vendor</button>' : ""}
          </div>
          <div class="partner-fields">
            <label>Business name<input name="organizationName" required maxlength="160" autocomplete="organization" /></label>
            <label>Contact name<input name="contactName" required maxlength="120" autocomplete="name" /></label>
            <label>Email<input name="contactEmail" required type="email" maxlength="254" autocomplete="email" /></label>
            <label>Phone<input name="contactPhone" type="tel" maxlength="40" autocomplete="tel" /></label>
            <label>Vendor type<select name="category" required><option value="food">Food and beverage</option><option value="retail">Retail</option><option value="artisan">Artist or maker</option><option value="service">Service</option><option value="nonprofit">Nonprofit</option></select></label>
            <label>Program<select name="vendorOfferingId" required>${vendorOfferingOptionsForCategory("food")}</select></label>
            <label>Website<input name="website" type="url" maxlength="500" placeholder="https://" autocomplete="url" /></label>
            <label>City<input name="city" maxlength="100" autocomplete="address-level2" /></label>
            <label>State<input name="state" maxlength="40" value="TX" autocomplete="address-level1" /></label>
            <label class="partner-field-wide">Products and booth needs<textarea name="description" rows="4" maxlength="2000"></textarea></label>
          </div>
          <p id="vendor-intake-availability" class="partner-availability-note">Vendor applications are not currently open. Join the interest list and review updates on the <a href="https://www.texassandfest.org/vendors" target="_blank" rel="noopener noreferrer">official vendor page</a>.</p>
          <p id="vendor-offering-summary" class="partner-offering-summary" aria-live="polite"></p>
          <p id="vendor-data-use-note" class="partner-data-use-note">${escapeHtml(vendorInterestContactNotice.disclosure)}</p>
          <label class="partner-consent"><input name="consentToContact" type="checkbox" required /><span id="vendor-consent-label">${escapeHtml(vendorInterestContactNotice.checkboxLabel)}</span></label>
          <div class="partner-verification" data-turnstile-verification hidden><div data-turnstile-widget></div></div>
          <button id="vendor-intake-submit" class="button primary" type="submit">Submit vendor interest</button>
          <p class="partner-form-status" aria-live="polite"></p>
        </form>
      </div>
      <div class="partner-status-portal" id="partner-status">
        <form id="partner-status-form" class="partner-status-form">
          <div class="partner-form-title"><span>Partner portal</span><h3>Application status</h3></div>
          <p>Use the reference and private access code from your confirmation link.</p>
          <div class="partner-status-fields">
            <label>Application reference<input name="reference" required maxlength="80" autocomplete="off" placeholder="TSF-V-000000" /></label>
            <label>Private access code<input name="token" required type="password" maxlength="200" autocomplete="off" placeholder="tsfp_..." /></label>
          </div>
          <div class="partner-status-actions">
            <button class="button primary" type="submit">View status</button>
            <button id="partner-status-forget" class="button secondary" type="button" hidden>Forget this browser</button>
          </div>
          <p class="partner-form-status" aria-live="polite"></p>
        </form>
        <form id="partner-portal-recovery-form" class="partner-recovery-form" data-turnstile-action="partner_access_recovery">
          <div class="partner-form-title"><span>Lost your link?</span><h3>Email private access</h3></div>
          <p>Enter the application reference and contact email used to apply. For privacy, every request receives the same confirmation.</p>
          <div class="partner-status-fields">
            <label>Application reference<input name="reference" required maxlength="80" autocomplete="off" placeholder="TSF-V-000000" /></label>
            <label>Contact email<input name="contactEmail" required type="email" maxlength="254" autocomplete="email" placeholder="name@business.com" /></label>
          </div>
          <div class="partner-verification" data-turnstile-verification hidden><div data-turnstile-widget></div></div>
          <button class="button secondary" type="submit">Email private access link</button>
          <p class="partner-form-status" aria-live="polite"></p>
        </form>
        <div id="partner-status-result" class="partner-status-result" aria-live="polite" tabindex="-1">
          <div class="partner-status-empty">
            <strong>Your SandFest partnership, in one place</strong>
            <span>Review progress, payments, invoices, and upcoming dates are shown here after secure access.</span>
          </div>
        </div>
      </div>
      <div class="outreach-preferences-portal" id="outreach-preferences" hidden>
        <div>
          <span>Sponsor outreach</span>
          <h3>Email preferences</h3>
          <p id="outreach-preferences-copy">Review this business contact's Texas SandFest sponsor outreach setting.</p>
        </div>
        <button id="outreach-preferences-unsubscribe" class="button secondary" type="button" hidden>Stop sponsor outreach</button>
        <p id="outreach-preferences-status" aria-live="polite"></p>
      </div>
      <div id="public-sponsor-showcase" class="public-sponsor-showcase" aria-label="Featured Texas SandFest partners" hidden></div>
      <p class="sponsor-community-label">Texas SandFest supporters</p>
      <div class="logo-wall" aria-label="Texas SandFest sponsor logos">
        ${sponsorLogoAssets.map(asset => `
          <div>
            <img ${responsiveImageAttributes(asset, "180px")} alt="${escapeAttr(asset.alt || asset.name || "Sponsor logo")}" loading="lazy" decoding="async" />
          </div>
        `).join("")}
      </div>
    </section>

    <section class="section surfaces" id="surfaces">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Multi-surface platform</p>
          <h2>Web, native iOS, and Port A Local Co share one operating brain.</h2>
        </div>
      </div>
      <div class="surface-grid">
        ${surfaces.map(surface => `
          <article class="surface-card">
            <span>${surface.status}</span>
            <h3>${surface.name}</h3>
            <p>${surface.role}</p>
          </article>
        `).join("")}
      </div>
      <div class="mobile-shell" aria-label="iOS app source prototype">
        <div class="phone-frame">
          <div class="phone-top"></div>
          <div class="phone-screen">
            <strong>SandFest Today</strong>
            <span id="mobile-event-date">${event.dateRange}</span>
            <button>Ask Sandy</button>
            <div class="phone-list">
              <p><b>9:00 AM</b> Gates open</p>
              <p><b>Marker 12.5</b> ADA parking</p>
              <p><b>Alert</b> North Gate queue rising</p>
            </div>
          </div>
        </div>
        <div>
          <p class="eyebrow">iOS source prototype</p>
          <h3>The field app prototype centers the realities of the beach.</h3>
          <p class="section-copy">The current Swift source caches event data, maps the schedule to the published festival dates, and includes alerts, ticket handoff, volunteer, incident, partner, and operations views. A real Xcode build, signing, device QA, and TestFlight distribution are still required.</p>
          <div class="capability-list">
            <span>Offline map</span>
            <span>Push alerts</span>
            <span>Volunteer check-in</span>
            <span>Incident capture</span>
            <span>Ticket handoff</span>
            <span>AI concierge</span>
          </div>
        </div>
      </div>
    </section>

    <section class="section data-section" id="port-a">
      <div>
        <p class="eyebrow">Regional destination connection</p>
        <h2>Extend the festival journey across Port Aransas.</h2>
        <p class="section-copy">Connect reviewed event information with arrival guidance, lodging, dining, local businesses, and year-round discovery through a governed destination feed.</p>
      </div>
      <div class="domain-grid">
        ${dataDomains.map(([name, detail]) => `
          <article>
            <strong>${name}</strong>
            <span>${detail}</span>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section finance-section" id="finance">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Finance integration</p>
          <h2>QuickBooks becomes the accounting ledger, not another ops silo.</h2>
          <p class="section-copy">When access arrives, the platform is ready for OAuth credentials, realm ID, refresh token, and minor-versioned QBO Accounting API calls. SandFest will keep sponsor/vendor fulfillment operational while QuickBooks remains the source of truth for invoices, payments, vendors, and reports.</p>
        </div>
      </div>
      <div class="finance-grid">
        ${financeFlows.map(([name, detail]) => `
          <article>
            <strong>${name}</strong>
            <span>${detail}</span>
          </article>
        `).join("")}
      </div>
      <div class="integration-strip">
        <span>OAuth 2.0 ready</span>
        <span>Sandbox first</span>
        <span>Minor version 75</span>
        <span>No credentials committed</span>
      </div>
    </section>

    <section class="section roadmap" id="roadmap">
      <p class="eyebrow">Ground-up build path</p>
      <h2>Platform capabilities</h2>
      <div class="roadmap-grid">
        <article><strong>1. Content OS</strong><span>Canon event facts, FAQ, policies, maps, schedule, sponsor/vendor/volunteer documents.</span></article>
        <article><strong>2. AI Concierge</strong><span>RAG assistant with approved answers, escalation rules, multilingual support, and SMS/web widgets.</span></article>
        <article><strong>3. Ops Console</strong><span>Volunteer shifts, incidents, weather, crowd density, gate queues, lost party, ADA requests.</span></article>
        <article><strong>4. Native iOS</strong><span>Implemented source prototype for the cached guide, alerts, check-in, incident capture, and staff tools; real-device QA and TestFlight release remain.</span></article>
        <article><strong>5. QuickBooks</strong><span>Connect accounting truth to sponsor invoices, vendor payments, raffle reconciliation, and impact reporting.</span></article>
        <article><strong>6. Partner Portals</strong><span>Sponsor CRM, vendor onboarding, nonprofit grants, city coordination, post-event impact.</span></article>
        <article><strong>7. Port A Local Co</strong><span>Expose SandFest as an event/destination module for local discovery, commerce, and retention.</span></article>
      </div>
    </section>
    ${ADMIN_ENTRY ? "" : `<footer class="site-footer">
      <div>
        <strong>Texas SandFest</strong>
        <span>${escapeHtml(event.dateRange)} · ${escapeHtml(event.location)}</span>
      </div>
      <nav aria-label="Festival contact links">
        <a href="mailto:${escapeAttr(event.email)}">${escapeHtml(event.email)}</a>
        <a href="tel:${escapeAttr(event.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(event.phone)}</a>
        <a href="${escapeAttr(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official event information</a>
      </nav>
    </footer>`}
  </main>
`;

function addMessage(text, type) {
  const chat = document.querySelector("#chat");
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.textContent = text;
  chat.append(node);
  chat.scrollTop = chat.scrollHeight;
  return node;
}

function conciergeSourceHref(value) {
  const href = String(value || "");
  if (/^#[a-z][a-z0-9_-]*$/i.test(href)) return href;
  const external = safeExternalHref(href);
  return external?.startsWith("https://") ? external : null;
}

function addConciergeAnswer(answer) {
  const chat = document.querySelector("#chat");
  const node = document.createElement("div");
  node.className = "message ai concierge-answer";
  node.dataset.confidence = answer.confidence || "low";

  const copy = document.createElement("p");
  copy.textContent = String(answer.answer || "Ask Sandy could not find a current answer.");
  node.append(copy);

  const validSources = (Array.isArray(answer.sources) ? answer.sources : [])
    .map(item => ({ ...item, href: conciergeSourceHref(item.href) }))
    .filter(item => item.href && item.label)
    .slice(0, 4);
  if (validSources.length) {
    const sources = document.createElement("div");
    sources.className = "concierge-sources";
    const label = document.createElement("span");
    label.textContent = answer.escalated ? "Confirm with" : "Sources";
    sources.append(label);
    validSources.forEach(item => {
      const link = document.createElement("a");
      link.href = item.href;
      link.textContent = item.label;
      if (!item.href.startsWith("#")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      sources.append(link);
    });
    node.append(sources);
  }

  const suggestions = (Array.isArray(answer.suggestions) ? answer.suggestions : []).filter(Boolean).slice(0, 3);
  if (suggestions.length) {
    const suggestionRow = document.createElement("div");
    suggestionRow.className = "concierge-suggestions";
    suggestions.forEach(suggestion => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.conciergeSuggestion = String(suggestion).slice(0, 120);
      button.textContent = String(suggestion).slice(0, 120);
      suggestionRow.append(button);
    });
    node.append(suggestionRow);
  }

  chat.append(node);
  chat.scrollTop = chat.scrollHeight;
  return node;
}

async function requestConciergeAnswer(question) {
  const response = await fetchWithTimeout(`${publicApiBase()}/api/public/concierge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question })
  }, 12_000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Ask Sandy could not answer that question.");
  if (!data.answer || !Array.isArray(data.sources)) throw new Error("Ask Sandy returned an incomplete answer.");
  return data;
}

let conciergeRequestPending = false;

function setConciergePending(pending) {
  conciergeRequestPending = pending;
  const input = document.querySelector("#ask-input");
  const submit = document.querySelector("#ask-submit");
  input.disabled = pending;
  submit.disabled = pending;
  submit.textContent = pending ? "Checking" : "Ask";
  document.querySelectorAll("[data-prompt], [data-concierge-suggestion]").forEach(button => {
    button.disabled = pending;
  });
}

async function submitConciergeQuestion(questionInput) {
  const question = String(questionInput || "").trim();
  if (!question || conciergeRequestPending) return;
  addMessage(question, "user");
  const pending = addMessage("Checking current SandFest sources...", "ai pending");
  setConciergePending(true);
  try {
    const answer = await requestConciergeAnswer(question);
    pending.remove();
    addConciergeAnswer(answer);
  } catch (error) {
    pending.remove();
    addMessage(friendlyRequestError(error, `Ask Sandy cannot reach current sources right now. Contact ${event.email} or ${event.phone}.`), "ai error");
  } finally {
    setConciergePending(false);
    document.querySelector("#ask-input")?.focus({ preventScroll: true });
  }
}

document.querySelector("#ask-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.querySelector("#ask-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  await submitConciergeQuestion(question);
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => submitConciergeQuestion(button.dataset.prompt));
});

document.querySelector("#chat").addEventListener("click", event => {
  const button = event.target.closest("[data-concierge-suggestion]");
  if (button) submitConciergeQuestion(button.dataset.conciergeSuggestion);
});

function currentTicketPolicy() {
  const policy = publicTicketCatalogState?.checkoutPolicy;
  return policy?.ready === true && policy.version && policy.digest ? policy : null;
}

function currentTicketPolicyKey() {
  const policy = currentTicketPolicy();
  return policy ? `${policy.version}:${policy.digest}` : null;
}

function ticketPolicyAccepted() {
  const checkbox = document.querySelector("#ticket-policy-acceptance");
  return Boolean(checkbox?.checked && acceptedTicketPolicyKey === currentTicketPolicyKey());
}

function renderTicketPolicy() {
  const fieldset = document.querySelector("#ticket-policy-fieldset");
  const checkbox = document.querySelector("#ticket-policy-acceptance");
  const label = document.querySelector("#ticket-policy-label");
  const notices = document.querySelector("#ticket-policy-notices");
  const summary = document.querySelector("#ticket-policy-summary");
  const help = document.querySelector("#ticket-policy-help");
  const policy = currentTicketPolicy();
  if (!fieldset || !checkbox || !label || !notices || !summary || !help) return;
  fieldset.hidden = !policy;
  if (!policy) {
    acceptedTicketPolicyKey = null;
    checkbox.checked = false;
    notices.replaceChildren();
    return;
  }
  if (acceptedTicketPolicyKey !== currentTicketPolicyKey()) checkbox.checked = false;
  label.textContent = policy.acknowledgment;
  summary.textContent = policy.demonstration ? "Review demonstration policies" : "Review ticket policies";
  help.textContent = policy.demonstration
    ? "Required for this local walkthrough. No external charge is sent."
    : "Required before secure checkout.";
  notices.innerHTML = policy.notices.map(item => `
    <article data-ticket-policy-notice="${escapeAttr(item.id)}">
      <strong>${escapeHtml(item.label)}</strong>
      <p>${escapeHtml(item.summary)}</p>
    </article>
  `).join("");
}

function renderTicketCart() {
  const linePanel = document.querySelector("#ticket-cart-lines");
  const subtotal = document.querySelector("#ticket-subtotal");
  const checkout = document.querySelector("#checkout-btn");
  const entries = [...ticketCart.entries()]
    .map(([id, quantity]) => [ticketProducts.find(product => product.id === id), quantity])
    .filter(([product, quantity]) => product && quantity > 0);
  const knownTotal = entries.reduce((sum, [product, quantity]) => {
    if (typeof product.unitAmount !== "number") return sum;
    return sum + product.unitAmount * quantity;
  }, 0);
  const hasTbd = entries.some(([product]) => typeof product.unitAmount !== "number");

  document.querySelectorAll("[data-ticket-qty]").forEach(node => {
    node.textContent = ticketCart.get(node.dataset.ticketQty) ?? 0;
  });

  if (entries.length === 0) {
    linePanel.innerHTML = "<span>No tickets selected yet.</span>";
    subtotal.textContent = "$0.00";
    checkout.disabled = true;
    return;
  }

  linePanel.innerHTML = entries.map(([product, quantity]) => `
    <article>
      <span>${quantity} x ${product.name}</span>
      <strong>${typeof product.unitAmount === "number" ? formatMoney(product.unitAmount * quantity) : product.priceLabel ?? "TBD"}</strong>
    </article>
  `).join("");
  subtotal.textContent = hasTbd ? `${formatMoney(knownTotal) ?? "$0.00"} + TBD` : formatMoney(knownTotal);
  checkout.disabled = Boolean(ticketDemoCheckoutState) || !ticketPolicyAccepted();
}

function resetTicketCheckoutRetry() {
  ticketCheckoutRetryKey = null;
  ticketCheckoutRequestFingerprint = null;
}

function renderPublicTicketCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.products)) return;
  publicTicketCatalogState = catalog;
  ticketProducts = catalog.products;
  for (const productId of ticketCart.keys()) {
    const product = ticketProducts.find(item => item.id === productId);
    if (!product?.availableForCheckout) ticketCart.delete(productId);
  }
  resetTicketCheckoutRetry();
  const grid = document.querySelector("#ticket-product-grid");
  if (grid) grid.innerHTML = ticketProductCardsMarkup();
  const heading = document.querySelector("#ticketing-heading");
  const copy = document.querySelector("#ticketing-copy");
  const pill = document.querySelector("#ticketing-status-pill");
  const status = document.querySelector("#checkout-status");
  const button = document.querySelector("#checkout-btn");
  const rails = document.querySelector("#ticket-payment-rails");
  const presentation = ticketCheckoutPresentation();
  if (heading) heading.textContent = presentation.heading;
  if (copy) copy.textContent = presentation.copy;
  if (pill) pill.textContent = presentation.pill;
  if (button) button.textContent = presentation.button;
  if (status && ticketCart.size === 0) status.textContent = presentation.status;
  if (rails && presentation.sandbox) {
    rails.innerHTML = "<span>Local sandbox</span><span>Signed completion</span><span>Fulfillment queue</span><span>Revenue ledger</span>";
  }
  renderTicketPolicy();
  renderTicketCart();
}

function closeTicketDemoCheckout() {
  ticketDemoCheckoutState = null;
  const panel = document.querySelector("#ticket-demo-checkout");
  const payButton = document.querySelector("#ticket-demo-pay");
  const cancelButton = document.querySelector("#ticket-demo-cancel");
  if (panel) panel.hidden = true;
  if (payButton) {
    payButton.hidden = false;
    payButton.disabled = false;
  }
  if (cancelButton) cancelButton.hidden = false;
  renderTicketCart();
}

function showTicketDemoCheckout(checkout) {
  if (checkout?.mode !== "board_sandbox" || checkout.completeEndpoint !== "/api/public/board-ticket-checkout/complete" || typeof checkout.token !== "string") {
    throw new Error("The local payment sandbox returned an invalid checkout.");
  }
  ticketDemoCheckoutState = checkout;
  const panel = document.querySelector("#ticket-demo-checkout");
  const amount = document.querySelector("#ticket-demo-amount");
  const summary = document.querySelector("#ticket-demo-summary");
  const sandboxStatus = document.querySelector("#ticket-demo-status");
  if (!panel || !amount || !summary || !sandboxStatus) throw new Error("The local payment sandbox is unavailable.");
  amount.textContent = `${formatMoney(checkout.amountCents) || "$0.00"} demo`;
  summary.innerHTML = checkout.lineItems.map(line => `<p><span>${escapeHtml(`${line.quantity} x ${line.name}`)}</span><strong>${escapeHtml(formatMoney(line.unitAmount * line.quantity) || "$0.00")}</strong></p>`).join("");
  sandboxStatus.textContent = "Ready to simulate an approved payment. This stays on the local board runtime.";
  sandboxStatus.dataset.state = "idle";
  panel.hidden = false;
  renderTicketCart();
  document.querySelector("#ticket-demo-pay")?.focus();
}

async function loadPublicTicketCatalog() {
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/tickets`, { cache: "no-store" });
    const catalog = await response.json().catch(() => null);
    if (response.ok) renderPublicTicketCatalog(catalog);
  } catch {
    // The sanitized static catalog remains the offline fallback.
  }
}

document.querySelector("#ticket-product-grid")?.addEventListener("click", event => {
  const button = event.target.closest("[data-ticket-action],[data-ticket-request]");
  if (!button || !event.currentTarget.contains(button)) return;
  if (button.dataset.ticketAction) {
    const product = ticketProducts.find(item => item.id === button.dataset.ticketId);
    if (!product?.availableForCheckout) return;
    const current = ticketCart.get(product.id) ?? 0;
    const max = product.quantity?.max ?? 12;
    const next = button.dataset.ticketAction === "increase"
      ? Math.min(current + 1, max)
      : Math.max(current - 1, 0);
    if (next === 0) ticketCart.delete(product.id);
    else ticketCart.set(product.id, next);
    closeTicketDemoCheckout();
    resetTicketCheckoutRetry();
    renderTicketCart();
    return;
  }
  if (button.dataset.ticketRequest) {
    const product = ticketProducts.find(item => item.id === button.dataset.ticketRequest);
    const status = document.querySelector("#checkout-status");
    if (!product || !status) return;
    setFormStatus(status, product.category === "sponsor"
      ? "Sponsor and hospitality packages begin with the partnership form below."
      : `${product.name} is not available for online checkout.`, "idle");
    if (product.category === "sponsor") {
      const form = document.querySelector("#sponsor-inquiry-form");
      if (window.location.hash !== "#sponsor-inquiry-form") window.location.hash = "sponsor-inquiry-form";
      else form?.scrollIntoView({ behavior: "smooth", block: "start" });
      form?.elements.organizationName?.focus({ preventScroll: true });
    }
  }
});

document.querySelector("#ticket-demo-cancel")?.addEventListener("click", () => {
  closeTicketDemoCheckout();
  setFormStatus(document.querySelector("#checkout-status"), "Demo checkout closed. Your ticket selection is still here.", "idle");
});

document.querySelector("#ticket-demo-pay")?.addEventListener("click", async () => {
  const checkout = ticketDemoCheckoutState;
  const button = document.querySelector("#ticket-demo-pay");
  const cancelButton = document.querySelector("#ticket-demo-cancel");
  const sandboxStatus = document.querySelector("#ticket-demo-status");
  const checkoutStatus = document.querySelector("#checkout-status");
  if (!checkout || !button || !sandboxStatus) return;
  button.disabled = true;
  if (cancelButton) cancelButton.disabled = true;
  setFormStatus(sandboxStatus, "Recording the local payment and creating fulfillment...", "loading");
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}${checkout.completeEndpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: checkout.token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Demo payment failed with ${response.status}`);
    const receipt = data.receipt || {};
    if (data.order?.status !== "paid" || receipt.environment !== "board_sandbox") throw new Error("The local payment did not return a paid receipt.");
    ticketDemoCheckoutState = null;
    ticketCart.clear();
    acceptedTicketPolicyKey = null;
    const policyAcceptance = document.querySelector("#ticket-policy-acceptance");
    if (policyAcceptance) policyAcceptance.checked = false;
    resetTicketCheckoutRetry();
    document.querySelector("#ticket-demo-summary").innerHTML = `<p><span>Order</span><strong>${escapeHtml(receipt.orderId)}</strong></p><p><span>Fulfillment</span><strong>${escapeHtml(`${receipt.fulfillmentCount} wristband${receipt.fulfillmentCount === 1 ? "" : "s"} queued`)}</strong></p>`;
    button.hidden = true;
    if (cancelButton) cancelButton.hidden = true;
    setFormStatus(sandboxStatus, "Demo payment complete. The order, payment event, fulfillment, and ticket revenue are now visible in operations.", "ok");
    setFormStatus(checkoutStatus, `Demo payment complete for ${receipt.orderId}. No external charge was sent.`, "ok");
    renderTicketCart();
  } catch (error) {
    setFormStatus(sandboxStatus, friendlyRequestError(error), "error");
    button.disabled = false;
    if (cancelButton) cancelButton.disabled = false;
  }
});

document.querySelector("#checkout-btn").addEventListener("click", async () => {
  const status = document.querySelector("#checkout-status");
  const button = document.querySelector("#checkout-btn");
  const items = [...ticketCart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  const email = document.querySelector("#checkout-email")?.value?.trim() || "";
  const phone = document.querySelector("#checkout-phone")?.value?.trim() || "";
  const consent = {
    emailMarketing: Boolean(document.querySelector("#consent-email-marketing")?.checked),
    smsMarketing: Boolean(document.querySelector("#consent-sms-marketing")?.checked),
    smsSafety: Boolean(document.querySelector("#consent-sms-safety")?.checked)
  };
  const policy = currentTicketPolicy();
  if (!policy || !ticketPolicyAccepted()) {
    setFormStatus(status, "Review and accept the current ticket policies before checkout.", "error");
    document.querySelector("#ticket-policy-acceptance")?.focus();
    renderTicketCart();
    return;
  }
  const payload = {
    items,
    customer: { email: email || null, phone: phone || null },
    email: email || null,
    phone: phone || null,
    consent,
    policyAcceptance: {
      accepted: true,
      version: policy.version,
      digest: policy.digest
    }
  };
  const requestFingerprint = JSON.stringify(payload);
  if (!ticketCheckoutRetryKey || ticketCheckoutRequestFingerprint !== requestFingerprint) {
    ticketCheckoutRetryKey = globalThis.crypto?.randomUUID?.()
      || `ticket_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    ticketCheckoutRequestFingerprint = requestFingerprint;
  }
  button.disabled = true;
  setFormStatus(status, "Validating order with the SandFest API...", "loading");
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}${publicTicketCatalogState?.checkoutEndpoint ?? "/api/stripe/create-checkout-session"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": ticketCheckoutRetryKey
      },
      body: requestFingerprint
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const checkoutError = new Error(data.error || `Checkout request failed with ${response.status}`);
      checkoutError.status = response.status;
      throw checkoutError;
    }
    if (data.checkoutUrl) {
      const checkoutUrl = new URL(data.checkoutUrl);
      if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") throw new Error("Checkout returned an invalid payment address.");
      setFormStatus(status, "Stripe Checkout session created. Redirecting...", "ok");
      window.location.href = checkoutUrl.toString();
      return;
    }
    if (data.demoCheckout) {
      showTicketDemoCheckout(data.demoCheckout);
      setFormStatus(status, "Local demo checkout created. Review the sandbox payment below.", "ok");
      return;
    }
    const consentNote = data.order?.consent?.consentId
      ? ` Consent saved (${[
          data.order.consent.emailMarketing && "email",
          data.order.consent.smsMarketing && "SMS promo",
          data.order.consent.smsSafety && "SMS safety"
        ].filter(Boolean).join(", ") || "flags"}).`
      : "";
    setFormStatus(status, (data.message || `Checkout validated and stored as ${data.order?.id ?? "a pending order"}. Stripe is not configured yet.`) + consentNote, "ok");
  } catch (error) {
    if (error.status === 409) resetTicketCheckoutRetry();
    setFormStatus(status, `${friendlyRequestError(error)} Please review the order and try again.`, "error");
  } finally {
    renderTicketCart();
  }
});

document.querySelector("#ticket-policy-acceptance")?.addEventListener("change", event => {
  acceptedTicketPolicyKey = event.currentTarget.checked ? currentTicketPolicyKey() : null;
  resetTicketCheckoutRetry();
  renderTicketCart();
});

renderTicketPolicy();
renderTicketCart();

function adminApiBase() {
  if (ADMIN_AUTH_MODE === "oidc") return CONFIGURED_ADMIN_API_BASE;
  const value = document.querySelector("#admin-api-base")?.value.replace(/\/+$/, "") || "";
  DEVELOPMENT_PUBLIC_API?.persistDevelopmentPublicApiBase(value);
  return value;
}

function adminToken() {
  if (ADMIN_AUTH_MODE === "oidc") return adminAuthClient?.accessToken() || "";
  if (BOARD_DEMO_ACCESS.enabled) return BOARD_DEMO_ACCESS.token;
  return document.querySelector("#admin-api-token")?.value || "";
}

function renderAdminAuthState(authenticated) {
  if (ADMIN_AUTH_MODE !== "oidc") return;
  const signIn = document.querySelector("#admin-sign-in");
  const signOut = document.querySelector("#admin-sign-out");
  const load = document.querySelector("#admin-load-config");
  if (signIn) signIn.hidden = authenticated;
  if (signOut) signOut.hidden = !authenticated;
  if (load) load.disabled = !authenticated;
  if (!authenticated) renderAdminSession(null);
}

function setAdminStatus(message, state = "idle") {
  const status = document.querySelector("#admin-api-status");
  const pill = document.querySelector("#admin-api-pill");
  status.textContent = message;
  status.dataset.state = state;
  status.setAttribute("role", state === "error" ? "alert" : "status");
  status.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  pill.textContent = state === "ok"
    ? "API connected"
    : state === "error"
      ? "Needs attention"
      : state === "warning"
        ? "Needs review"
        : "API ready";
  pill.dataset.state = state;
}

async function writeClipboardText(value) {
  if (!value || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function adminCan(permission) {
  const permissions = adminSessionState?.permissions ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}

function renderAdminSession(session) {
  adminSessionState = session || null;
  const summary = document.querySelector("#admin-role-summary");
  if (summary) {
    summary.textContent = session
      ? `${session.role.replace("_", " ")} · ${session.permissions.includes("*") ? "all permissions" : `${session.permissions.length} permissions`}`
      : "Signed out";
  }
  const permissions = session?.permissions ?? [];
  document.querySelectorAll("[data-requires-permission]").forEach(node => {
    const permission = node.dataset.requiresPermission;
    const allowed = permissions.includes("*") || permissions.includes(permission);
    const controls = node.matches("button, input, select, textarea")
      ? [node]
      : [...node.querySelectorAll("button, input, select, textarea")];

    node.toggleAttribute("aria-disabled", !allowed);
    node.title = allowed ? "" : `Requires ${permission}`;
    controls.forEach(control => {
      if (!allowed && !control.disabled) {
        control.disabled = true;
        control.dataset.permissionDisabled = "true";
      } else if (allowed && control.dataset.permissionDisabled === "true") {
        control.disabled = false;
        delete control.dataset.permissionDisabled;
      }
    });
  });
}

async function loadAdminSession() {
  const data = await adminFetch("/api/admin/session");
  renderAdminSession(data.session);
  const resetButton = document.querySelector("#admin-reset-board-demo");
  if (resetButton) resetButton.hidden = data.capabilities?.boardDemoReset !== true;
  return data.session;
}

function renderAdminDeployment(deployment) {
  const summary = document.querySelector("#admin-deployment-summary");
  const target = document.querySelector("#admin-deployment-checks");
  if (!summary || !target) return;
  adminDeploymentState = deployment;
  const state = deployment.ok ? "ready" : "blocked";
  summary.textContent = BOARD_DEMO_ACCESS.enabled
    ? `board demo · ${state} · live providers post-board`
    : `${deployment.environment} · ${state} · ${deployment.warnings} warnings · ${deployment.errors} errors`;
  summary.dataset.state = deployment.errors ? "error" : deployment.warnings ? "warning" : "ok";

  const checks = Object.values(deployment.checks || {});
  const attention = checks.filter(check => !check.ok);
  const visible = adminDeploymentFilter === "attention" ? attention : checks;
  const checkCount = document.querySelector("#admin-deployment-check-count");
  const attentionCount = document.querySelector("#admin-deployment-attention-count");
  const totalCount = document.querySelector("#admin-deployment-total-count");
  if (checkCount) {
    const postBoardCount = BOARD_DEMO_ACCESS.enabled && attention.some(check => check.id === "backupRecovery") ? 1 : 0;
    const reviewCount = Math.max(0, attention.length - postBoardCount);
    checkCount.textContent = BOARD_DEMO_ACCESS.enabled
      ? `${checks.length - attention.length} passing · ${postBoardCount} post-board · ${reviewCount} need review`
      : `${checks.length - attention.length} passing · ${deployment.warnings} review · ${deployment.errors} blocked`;
  }
  if (attentionCount) attentionCount.textContent = String(attention.length);
  if (totalCount) totalCount.textContent = String(checks.length);
  document.querySelectorAll("[data-deployment-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.deploymentFilter === adminDeploymentFilter));
  });

  if (!visible.length) {
    target.innerHTML = `<div class="admin-deployment-empty" data-state="ok"><strong>No launch gates need action</strong><span>All ${checks.length} checks are passing for ${escapeHtml(deployment.environment)}.</span></div>`;
    return;
  }

  const groups = new Map();
  const groupSummaries = new Map((deployment.groups || []).map(group => [group.group, group]));
  visible.forEach(check => {
    const group = check.group || "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(check);
  });
  target.innerHTML = [...groups.entries()].map(([group, items]) => {
    const groupSummary = groupSummaries.get(group);
    const passing = groupSummary?.passing ?? items.filter(item => item.ok).length;
    const total = groupSummary?.total ?? items.length;
    return `<section class="admin-deployment-group">
      <header><strong>${escapeHtml(group)}</strong><span>${passing}/${total} passing</span></header>
      <div>${items.map(check => {
        const deferredForBoard = BOARD_DEMO_ACCESS.enabled && check.id === "backupRecovery" && !check.ok;
        const tone = check.ok ? "ok" : check.severity === "warning" ? "warning" : "error";
        const status = deferredForBoard ? "Post-board" : check.ok ? "Passing" : check.severity === "warning" ? "Review" : "Blocked";
        const message = deferredForBoard
          ? "Managed backup provisioning and provider restore drills are scheduled after the presentation. Isolated database and upload recovery verification remains in the release gate."
          : check.message || "No status detail provided.";
        return `<article class="admin-deployment-check" data-state="${tone}"${deferredForBoard ? ' data-board-stage="post-presentation"' : ""}>
          <span class="admin-deployment-status">${status}</span>
          <div><strong>${escapeHtml(check.label || check.id || "Deployment check")}</strong><p>${escapeHtml(message)}</p></div>
        </article>`;
      }).join("")}</div>
    </section>`;
  }).join("");
}

async function loadAdminDeployment() {
  const data = await adminFetch("/api/admin/deployment");
  renderAdminDeployment(data.deployment);
  return data.deployment;
}

function renderAdminJobHealth(summary) {
  const target = document.querySelector("#admin-job-summary");
  if (!target) return;
  const done = Number(summary?.done || 0);
  const pending = Number(summary?.pending || 0);
  const running = Number(summary?.running || 0);
  const failed = Number(summary?.failed || 0);
  const unhandled = Number(summary?.unhandledFailed || 0);
  const stale = Number(summary?.staleRunning || 0);
  const handled = Math.max(0, failed - unhandled);
  target.textContent = `${done} complete · ${pending} pending · ${running} active · ${unhandled} need review${handled ? ` · ${handled} handled` : ""}${stale ? ` · ${stale} expired` : ""}`;
  target.dataset.state = summary?.needsAttention ? "error" : "ok";
}

function adminJobTimeLabel(job) {
  const source = job.status === "queued" ? job.runAfter : job.status === "running" ? job.leaseExpiresAt : job.updatedAt;
  const timestamp = new Date(source || "");
  if (Number.isNaN(timestamp.getTime())) return "Timestamp unavailable";
  const prefix = job.displayKind === "completed_group"
    ? "Latest"
    : job.status === "queued"
    ? "Scheduled"
    : job.status === "running"
      ? "Lease ends"
      : job.status === "done"
        ? "Completed"
        : job.failureHandledAt ? "Reviewed" : "Stopped";
  return `${prefix} ${timestamp.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
}

function adminJobCard(job) {
  const status = adminRecordDisplayLabel(job.status, "Unknown");
  const completedGroup = job.displayKind === "completed_group";
  const attempt = completedGroup
    ? `${job.completedCount} completed run${job.completedCount === 1 ? "" : "s"}`
    : job.maxAttempts
      ? `${job.attempts} of ${job.maxAttempts} attempts used`
      : `${job.attempts} attempts used`;
  const failure = job.failureSummary ? `<p class="admin-delivery-error">${escapeHtml(job.failureSummary)}</p>` : "";
  const resolution = completedGroup ? `
    <div class="admin-job-actions">
      <a class="button secondary" href="${escapeAttr(job.workspaceHref)}">Open ${escapeHtml(job.workspaceLabel)}</a>
    </div>` : job.requiresAcknowledgement ? `
    <div class="admin-job-actions">
      <a class="button secondary" href="${escapeAttr(job.workspaceHref)}">Open ${escapeHtml(job.workspaceLabel)}</a>
      <form data-acknowledge-job="${escapeAttr(job.id)}" data-requires-permission="jobs:write">
        <label><span>Resolution note</span><input name="resolutionNote" minlength="12" maxlength="500" required /></label>
        <button class="button primary" type="submit">Acknowledge</button>
      </form>
    </div>` : job.status === "failed" ? `
    <div class="admin-job-actions">
      <a class="button secondary" href="${escapeAttr(job.workspaceHref)}">Open ${escapeHtml(job.workspaceLabel)}</a>
      <span>Failure reviewed</span>
    </div>` : "";
  return `
    <article class="admin-record-card admin-job-card" data-automation-row data-job-status="${escapeAttr(job.status)}" data-job-count="${completedGroup ? job.completedCount : 1}"${completedGroup ? ' data-job-group="completed"' : ` data-admin-job="${escapeAttr(job.id)}"`}>
      <div><strong>${escapeHtml(job.label)}</strong><span>${escapeHtml(status)}</span></div>
      <p>${escapeHtml(attempt)} · ${escapeHtml(adminJobTimeLabel(job))}</p>
      ${failure}
      ${resolution}
    </article>`;
}

function bindAdminJobActions() {
  document.querySelectorAll("[data-acknowledge-job]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/jobs/${encodeURIComponent(form.dataset.acknowledgeJob)}/acknowledge`, {
          method: "POST",
          body: JSON.stringify({ resolutionNote: form.elements.resolutionNote.value })
        });
        renderAdminJobHealth(result.summary);
        await loadAdminJobHealth();
        setAdminStatus(`${result.job.label} failure acknowledged.`, "ok");
      } catch (error) {
        setAdminStatus(error.message, "error");
        button.disabled = !adminCan("jobs:write");
      }
    });
  });
}

function renderAdminJobs(data) {
  renderAdminJobHealth(data?.summary);
  const target = document.querySelector("#admin-job-list");
  if (!target) return;
  const rows = Array.isArray(data?.displayRows)
    ? data.displayRows
    : Array.isArray(data?.jobs)
      ? data.jobs.map((job) => ({ ...job, displayKind: "job", completedCount: 0 }))
      : [];
  target.innerHTML = rows.length
    ? rows.map(adminJobCard).join("")
    : '<article class="empty-state"><span>No background automation has run yet.</span></article>';
  bindAdminJobActions();
  if (adminSessionState) renderAdminSession(adminSessionState);
}

async function loadAdminJobHealth() {
  const data = await adminFetch("/api/admin/jobs?limit=50");
  renderAdminJobs(data);
  return data;
}

const adminDocumentStatusLabels = {
  received: "Received",
  in_review: "In review",
  approved: "Approved",
  changes_requested: "Changes requested",
  archived: "Archived"
};

const adminDocumentOwnerLabels = {
  operations: "Operations",
  sponsor: "Sponsor",
  finance: "Finance",
  "volunteer-captains": "Volunteer captains",
  traffic: "Traffic and parking",
  "guest-services": "Guest services",
  production: "Production"
};

const adminDocumentExtractionLabels = {
  stored: "Stored for review",
  preview_ready: "Text ready",
  queued: "Extraction queued",
  extracting: "Extracting text",
  ready: "Extraction ready",
  needs_review: "Text review needed",
  failed: "Extraction failed"
};

function adminDocumentBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function adminDocumentStatusOptions(selected) {
  return Object.entries(adminDocumentStatusLabels)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function adminDocumentOwnerOptions(selected) {
  return ["<option value=\"\">Unassigned</option>", ...Object.entries(adminDocumentOwnerLabels)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)]
    .join("");
}

function renderAdminDocuments(payload = adminDocumentState) {
  const summaryTarget = document.querySelector("#admin-document-summary");
  const list = document.querySelector("#admin-document-list");
  if (!summaryTarget || !list) return;
  adminDocumentState = payload || { documents: [], summary: {}, storage: {} };
  const summary = adminDocumentState.summary || {};
  summaryTarget.innerHTML = `
    <article><strong>${Number(summary.active || 0)}</strong><span>Active</span></article>
    <article><strong>${Number(summary.byStatus?.in_review || 0)}</strong><span>In review</span></article>
    <article><strong>${Number(summary.byStatus?.approved || 0)}</strong><span>Approved</span></article>
    <article><strong>${Number(summary.unassigned || 0)}</strong><span>Unassigned</span></article>
    <article><strong>${Number(summary.overdue || 0)}</strong><span>Overdue</span></article>
    <article><strong>${Number(summary.dueSoon || 0)}</strong><span>Due in 3 days</span></article>
    <article><strong>${Number(summary.extractionReady || 0)}</strong><span>Text ready</span></article>
    <article><strong>${Number(summary.extractionQueued || 0)}</strong><span>Extracting</span></article>
    <article><strong>${Number(summary.extractionNeedsReview || 0)}</strong><span>Text attention</span></article>
    <article><strong>${adminDocumentBytes(summary.bytes)}</strong><span>Private storage</span></article>
  `;
  const documents = adminDocumentState.documents || [];
  list.innerHTML = documents.length ? documents.map(item => {
    const reviewTask = item.reviewTask || null;
    return `
    <article class="admin-document-row" data-admin-document="${escapeAttr(item.id)}">
      <header>
        <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.fileName)} · ${adminDocumentBytes(item.sizeBytes)} · ${escapeHtml(item.domain)}</span></div>
        <div class="admin-document-states">
          <span class="admin-document-state" data-state="${escapeAttr(item.status)}">${escapeHtml(adminDocumentStatusLabels[item.status] || item.status)}</span>
          <span class="admin-document-extraction" data-state="${escapeAttr(item.extractionStatus)}">${escapeHtml(adminDocumentExtractionLabels[item.extractionStatus] || item.extractionStatus)}</span>
        </div>
      </header>
      <div class="admin-document-fields">
        <label><span>Status</span><select name="status" ${adminCan("documents:write") ? "" : "disabled"}>${adminDocumentStatusOptions(item.status)}</select></label>
        <label><span>Owner</span><select name="ownerTeam" ${adminCan("documents:write") ? "" : "disabled"}>${adminDocumentOwnerOptions(item.ownerTeam)}</select></label>
        <label><span>Review due</span><input name="reviewDueAt" type="datetime-local" value="${escapeAttr(taskDateTimeInput(item.reviewDueAt))}" ${adminCan("documents:write") ? "" : "disabled"} /></label>
        <label class="admin-document-notes"><span>Review note</span><input name="notes" maxlength="2000" value="${escapeAttr(item.notes || "")}" ${adminCan("documents:write") ? "" : "disabled"} /></label>
      </div>
      ${item.extractionError ? `<p class="admin-document-extraction-error">${escapeHtml(item.extractionError)}</p>` : ""}
      ${item.textPreview ? `<details class="admin-document-preview"><summary>${item.extractionStatus === "ready" ? `Extracted text · ${Number(item.extractedCharacterCount || 0).toLocaleString()} characters · ${Number(item.extractedChunkCount || 0)} chunks` : "Text preview"}${item.previewTruncated || item.extractionTruncated ? " · shortened" : ""}</summary><pre class="keyboard-scroll-region" tabindex="0" aria-label="${escapeAttr(`${item.title} text preview`)}">${escapeHtml(item.textPreview)}</pre></details>` : ""}
      <footer>
        <span>${item.uploadedAt ? escapeHtml(new Date(item.uploadedAt).toLocaleString()) : "Timestamp unavailable"}${item.ownerTeam ? ` · ${escapeHtml(adminDocumentOwnerLabels[item.ownerTeam] || item.ownerTeam)}` : ""}${reviewTask ? ` · Task ${escapeHtml(conditionLabel(reviewTask.status))}` : " · Task routing pending"}</span>
        <div>
          ${item.extractionSupported && ["stored", "needs_review", "failed"].includes(item.extractionStatus) ? `<button class="button secondary" type="button" data-retry-admin-document-extraction="${escapeAttr(item.id)}">${item.extractionStatus === "stored" ? "Extract text" : "Retry extraction"}</button>` : ""}
          <button class="button secondary" type="button" data-download-admin-document="${escapeAttr(item.id)}">Download</button>
          <button class="button primary" type="button" data-save-admin-document="${escapeAttr(item.id)}" ${adminCan("documents:write") ? "" : "disabled"}>Save review</button>
        </div>
      </footer>
    </article>
  `;
  }).join("") : `<article class="empty-state"><strong>No private documents</strong><span>The intake queue is empty.</span></article>`;

  document.querySelectorAll("[data-save-admin-document]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-admin-document]");
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/documents/${encodeURIComponent(button.dataset.saveAdminDocument)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: card.querySelector('[name="status"]').value,
          ownerTeam: card.querySelector('[name="ownerTeam"]').value || null,
          reviewDueAt: localDateTimeToIso(card.querySelector('[name="reviewDueAt"]').value),
          notes: card.querySelector('[name="notes"]').value
        })
      });
      const index = adminDocumentState.documents.findIndex(item => item.id === result.document.id);
      if (index >= 0) adminDocumentState.documents[index] = result.document;
      adminDocumentState.summary = result.summary;
      renderAdminDocuments();
      setAdminStatus(`Saved review for ${result.document.title}.`, "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
      button.disabled = false;
    }
  }));

  document.querySelectorAll("[data-download-admin-document]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await adminRawFetch(`/api/admin/documents/${encodeURIComponent(button.dataset.downloadAdminDocument)}/content`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Document download failed with ${response.status}`);
      }
      const disposition = response.headers.get("content-disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/i)?.[1] || "sandfest-document";
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setAdminStatus(`Downloaded ${fileName}.`, "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }));

  document.querySelectorAll("[data-retry-admin-document-extraction]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/documents/${encodeURIComponent(button.dataset.retryAdminDocumentExtraction)}/extraction/retry`, {
        method: "POST"
      });
      const index = adminDocumentState.documents.findIndex(item => item.id === result.document.id);
      if (index >= 0) adminDocumentState.documents[index] = { ...adminDocumentState.documents[index], ...result.document };
      adminDocumentState.summary = result.summary;
      renderAdminDocuments();
      setAdminStatus(`Queued text extraction for ${result.document.title}.`, "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
      button.disabled = false;
    }
  }));
}

async function loadAdminDocuments({ quiet = false } = {}) {
  try {
    const payload = await adminFetch("/api/admin/documents?limit=200");
    renderAdminDocuments(payload);
    if (!quiet) setAdminStatus(`Loaded ${payload.summary.active} active private documents.`, "ok");
    return payload;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  }
}

async function adminFetch(path, options = {}) {
  const response = await adminRawFetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
}

async function adminRawFetch(path, options = {}) {
  const token = adminToken();
  if (!token) {
    throw new Error(ADMIN_AUTH_MODE === "oidc" ? "Sign in to continue." : "Enter the admin token to continue.");
  }
  const headers = new Headers(options.headers ?? {});
  headers.set("authorization", `Bearer ${token}`);
  if (options.body != null && !headers.has("content-type") && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  let response;
  try {
    response = await fetchWithTimeout(`${adminApiBase()}${path}`, {
      ...options,
      headers
    });
  } catch (error) {
    throw new Error(friendlyRequestError(error, "The operations API request failed."));
  }
  if (response.status === 401 && ADMIN_AUTH_MODE === "oidc") {
    await adminAuthClient?.clear().catch(() => {});
    renderAdminAuthState(false);
    throw new Error("Your session is no longer valid. Sign in again.");
  }
  return response;
}

async function downloadAdminExport(name) {
  const response = await adminRawFetch(`/api/admin/exports/${encodeURIComponent(name)}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Export failed with ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const fileName = disposition.match(/filename="([^"]+)"/i)?.[1] || name;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

async function initializeAdminAuthentication() {
  if (!ADMIN_ENTRY || ADMIN_AUTH_MODE !== "oidc") return;
  renderAdminAuthState(false);
  if (adminAuthInitializationError || !adminAuthClient) {
    setAdminStatus(adminAuthInitializationError?.message || "Admin authentication is not configured.", "error");
    return;
  }
  if (!CONFIGURED_ADMIN_API_BASE) {
    setAdminStatus("VITE_SANDFEST_API_BASE_URL is required when admin auth mode is oidc.", "error");
    return;
  }

  setAdminStatus("Checking staff session...", "idle");
  try {
    const state = await adminAuthClient.initialize();
    renderAdminAuthState(state.authenticated);
    if (!state.authenticated) {
      setAdminStatus("Signed out.", "idle");
      return;
    }
    setAdminStatus("Signed in. Loading operations...", "idle");
    await loadAdminWorkspace();
  } catch (error) {
    renderAdminAuthState(false);
    setAdminStatus(`Sign-in failed: ${error.message}`, "error");
  }
}

function renderPublicAlert(alert) {
  const banner = document.querySelector("#public-alert");
  if (!banner) return;
  if (!alert?.active) {
    banner.hidden = true;
    banner.dataset.severity = "clear";
    return;
  }
  banner.hidden = false;
  banner.dataset.severity = alert.severity || "info";
  document.querySelector("#public-alert-severity").textContent = (alert.severity || "info").replace("_", " ");
  document.querySelector("#public-alert-title").textContent = alert.title || "SandFest alert";
  document.querySelector("#public-alert-message").textContent = alert.message || "";
}

async function loadPublicAlert() {
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/alert`, { cache: "no-store" });
    if (!response.ok) return;
    renderPublicAlert(await response.json());
  } catch {
    // Preserve the last known safety message during a transient network failure.
  }
}

function applyPublicEventGuide(input) {
  const guide = normalizeEventGuide(input);
  if (!guide.startDate || !guide.endDate || !guide.dailyOpen || !guide.dailyClose || !guide.location || !guide.email) return false;
  Object.assign(event, guide);
  const values = {
    "#public-event-name": guide.name,
    "#public-event-mission": guide.mission,
    "#public-event-dates": guide.dateRange,
    "#public-event-hours": guide.hours,
    "#public-event-location": guide.location,
    "#mobile-event-date": guide.dateRange
  };
  Object.entries(values).forEach(([selector, value]) => {
    const target = document.querySelector(selector);
    if (target) target.textContent = value;
  });
  document.title = `${guide.name} | Port Aransas`;
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    `${guide.name}, ${guide.dateRange}, on the beach in Port Aransas. Tickets, sculptors, island conditions, vendors, sponsors, and visitor information.`
  );
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", guide.name);
  return true;
}

function applyRuntimeNotice(runtime) {
  const existing = document.querySelector("#runtime-data-notice");
  const boardDemoRuntimeEnabled = runtime?.mode === "board_demo"
    && (LIVE_BEACH_DEMO_ENABLED || BOARD_DEMO_ACCESS.enabled);
  runtimeDataMode = boardDemoRuntimeEnabled ? "board_demo" : null;
  document.body.classList.toggle("runtime-board-demo", boardDemoRuntimeEnabled);
  if (!boardDemoRuntimeEnabled) {
    existing?.remove();
    updateNetworkStatus();
    return;
  }
  const notice = existing || document.createElement("div");
  notice.id = "runtime-data-notice";
  notice.className = "runtime-data-notice";
  notice.setAttribute("role", "status");
  const [stage = "Board demonstration", data = "Synthetic data", ...boundaries] = String(runtime.label || "Board demonstration | Synthetic data")
    .slice(0, 180)
    .split("|")
    .map(part => part.trim())
    .filter(Boolean);
  const title = document.createElement("strong");
  title.textContent = `${stage} · ${data}`;
  const detail = document.createElement("span");
  detail.textContent = boundaries.join(" · ");
  detail.hidden = boundaries.length === 0;
  notice.setAttribute("aria-label", [stage, data, ...boundaries].join(". "));
  notice.replaceChildren(title, detail);
  const topbar = document.querySelector(".topbar");
  if (topbar && notice.previousElementSibling !== topbar) topbar.insertAdjacentElement("afterend", notice);
  else if (!topbar && !existing) document.body.prepend(notice);
  const motionCopy = document.querySelector("#motion-status-copy");
  if (motionCopy) motionCopy.textContent = "Simulated crowd and traffic signals animate the beach layer.";
  const tideState = document.querySelector("#motion-tide-state");
  if (tideState) tideState.textContent = "Demo";
  updateNetworkStatus();
}

async function loadPublicBootstrap({ applyGuide = true } = {}) {
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/bootstrap`, { cache: "no-store" });
    if (!response.ok) return false;
    const bootstrap = await response.json();
    applyRuntimeNotice(bootstrap.runtime);
    return applyGuide ? applyPublicEventGuide(bootstrap.guide) : true;
  } catch {
    return false;
  }
}

function isoToLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localDateTimeToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function renderAdminAlert(alert) {
  document.querySelector("#admin-alert-severity").value = alert?.severity && alert.severity !== "clear" ? alert.severity : "info";
  document.querySelector("#admin-alert-title").value = alert?.title ?? "";
  document.querySelector("#admin-alert-message").value = alert?.message ?? "";
  document.querySelector("#admin-alert-expires").value = isoToLocalDateTime(alert?.expiresAt);
  document.querySelector("#admin-alert-active").checked = Boolean(alert?.active);
  document.querySelector("#admin-alert-send-sms").checked = false;
}

function renderAdminEventGuide(bootstrap, readiness) {
  const form = document.querySelector("#admin-event-guide-form");
  if (!form) return;
  const guide = normalizeEventGuide(bootstrap?.guide);
  const values = {
    startDate: guide.startDate ?? "",
    endDate: guide.endDate ?? "",
    dailyOpen: guide.dailyOpen ?? "",
    dailyClose: guide.dailyClose ?? "",
    location: guide.location,
    mission: guide.mission,
    phone: guide.phone,
    email: guide.email ?? "",
    address: guide.address,
    sourceUrl: guide.sourceUrl ?? "",
    sourceCheckedAt: isoToLocalDateTime(guide.sourceCheckedAt)
  };
  Object.entries(values).forEach(([name, value]) => {
    if (form.elements[name]) form.elements[name].value = value;
  });
  const status = document.querySelector("#admin-event-guide-readiness");
  if (status) {
    status.textContent = readiness?.reason ?? "Event guide readiness has not been checked.";
    status.dataset.state = readiness?.ready ? "ok" : "error";
  }
}

async function publishAdminEventGuide(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const data = await adminFetch("/api/admin/event-guide/publish", {
    method: "POST",
    body: JSON.stringify({
      publish: true,
      guide: {
        ...values,
        sourceCheckedAt: localDateTimeToIso(values.sourceCheckedAt)
      }
    })
  });
  adminConfigState = await adminFetch("/api/admin/config");
  renderAdminEditors();
  await loadAdminDeployment();
  return data;
}

async function loadAdminAlert() {
  const data = await adminFetch("/api/admin/alert");
  renderAdminAlert(data.alert);
  renderPublicAlert({
    ...data.alert,
    active: data.alert?.active && (!data.alert.expiresAt || new Date(data.alert.expiresAt).getTime() > Date.now())
  });
  return data.alert;
}

async function saveAdminAlert(active) {
  const payload = active ? {
    active: true,
    severity: document.querySelector("#admin-alert-severity").value,
    title: document.querySelector("#admin-alert-title").value,
    message: document.querySelector("#admin-alert-message").value,
    audience: ["public"],
    expiresAt: localDateTimeToIso(document.querySelector("#admin-alert-expires").value),
    sendSms: document.querySelector("#admin-alert-send-sms").checked === true
  } : {
    active: false,
    severity: "clear",
    title: "",
    message: "",
    audience: ["public"],
    expiresAt: null
  };
  const data = await adminFetch("/api/admin/alert", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  renderAdminAlert(data.alert);
  await loadPublicAlert();
  return data;
}

function ticketAdminCard(product) {
  return `
    <article class="admin-edit-card" data-admin-ticket="${escapeAttr(product.id)}">
      <div class="admin-edit-title">
        <strong>${escapeHtml(product.name)}</strong>
        <span>${product.requiresReview ? "Review gated" : "Checkout enabled"}</span>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>Price label</span>
          <input name="priceLabel" value="${escapeAttr(product.priceLabel ?? "")}" />
        </label>
        <label>
          <span>Amount</span>
          <input name="unitAmount" inputmode="decimal" placeholder="0.00" value="${escapeAttr(moneyInput(product.unitAmount))}" />
        </label>
        <label>
          <span>Stripe Price ID</span>
          <input name="stripePriceId" value="${escapeAttr(product.stripePriceId ?? "")}" />
        </label>
        <label>
          <span>Max qty</span>
          <input name="quantityMax" inputmode="numeric" value="${escapeAttr(product.quantity?.max ?? "")}" />
        </label>
      </div>
      <label class="admin-check">
        <input name="requiresReview" type="checkbox" ${product.requiresReview ? "checked" : ""} />
        <span>Require admin review before checkout</span>
      </label>
      <p>${escapeHtml(product.description)}</p>
      <div class="admin-edit-actions">
        <span>${escapeHtml(adminMoney(product.unitAmount, product.priceLabel ?? "Set in Stripe"))}</span>
        <button class="button secondary" data-save-ticket="${escapeAttr(product.id)}" data-requires-permission="ticket:write" type="button">Save ticket</button>
      </div>
    </article>
  `;
}

function renderAdminTicketPolicy() {
  adminTicketPolicyUi?.renderTicketPolicyEditor(adminConfigState);
}

function sponsorAdminCard(sponsorPackage) {
  return `
    <article class="admin-edit-card" data-admin-sponsor="${escapeAttr(sponsorPackage.id)}">
      <div class="admin-edit-title">
        <strong>${escapeHtml(sponsorPackage.name)}</strong>
        <span>${sponsorPackage.active ? "Active" : "Hidden"}</span>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>Public label</span>
          <input name="publicLabel" value="${escapeAttr(sponsorPackage.publicLabel ?? "")}" />
        </label>
        <label>
          <span>Amount</span>
          <input name="amount" inputmode="decimal" value="${escapeAttr(moneyInput(sponsorPackage.amount))}" />
        </label>
        <label>
          <span>Stripe ID</span>
          <input name="stripePriceId" value="${escapeAttr(sponsorPackage.stripePriceId ?? "")}" />
        </label>
        <label>
          <span>QBO item</span>
          <input name="quickBooksItemId" value="${escapeAttr(sponsorPackage.quickBooksItemId ?? "")}" />
        </label>
      </div>
      <label>
        <span>Benefits</span>
        <textarea name="benefits" rows="3">${escapeHtml((sponsorPackage.benefits ?? []).join("\n"))}</textarea>
      </label>
      <div class="admin-check-row">
        <label class="admin-check">
          <input name="active" type="checkbox" ${sponsorPackage.active ? "checked" : ""} />
          <span>Publicly active</span>
        </label>
        <label class="admin-check">
          <input name="requiresApproval" type="checkbox" ${sponsorPackage.requiresApproval ? "checked" : ""} />
          <span>Approval required</span>
        </label>
      </div>
      <div class="admin-edit-actions">
        <span>${escapeHtml(adminMoney(sponsorPackage.amount, sponsorPackage.publicLabel ?? "Not set"))}</span>
        <button class="button secondary" data-save-sponsor="${escapeAttr(sponsorPackage.id)}" data-requires-permission="sponsor:write" type="button">Save sponsor</button>
      </div>
    </article>
  `;
}

function vendorOfferingAdminCard(offering) {
  return `
    <article class="admin-edit-card" data-admin-vendor-offering="${escapeAttr(offering.id)}">
      <div class="admin-edit-title">
        <strong>${escapeHtml(offering.name)}</strong>
        <span>${offering.active ? "Active" : "Hidden"}</span>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>Name</span>
          <input name="name" value="${escapeAttr(offering.name ?? "")}" />
        </label>
        <label>
          <span>Public label</span>
          <input name="publicLabel" value="${escapeAttr(offering.publicLabel ?? "")}" />
        </label>
        <label>
          <span>Amount</span>
          <input name="amount" inputmode="decimal" value="${escapeAttr(moneyInput(offering.amount))}" />
        </label>
        <label>
          <span>Intake mode</span>
          <select name="intakeMode"><option value="interest" ${offering.intakeMode === "interest" ? "selected" : ""}>Interest list</option><option value="application" ${offering.intakeMode !== "interest" ? "selected" : ""}>Applications open</option></select>
        </label>
        <label>
          <span>Eligible categories</span>
          <input name="categories" value="${escapeAttr((offering.categories ?? []).join(", "))}" />
        </label>
        <label>
          <span>Stripe ID</span>
          <input name="stripePriceId" value="${escapeAttr(offering.stripePriceId ?? "")}" />
        </label>
        <label>
          <span>QBO item</span>
          <input name="quickBooksItemId" value="${escapeAttr(offering.quickBooksItemId ?? "")}" />
        </label>
      </div>
      <label>
        <span>Public description</span>
        <textarea name="description" rows="3">${escapeHtml(offering.description ?? "")}</textarea>
      </label>
      <label>
        <span>Inclusions</span>
        <textarea name="inclusions" rows="3">${escapeHtml((offering.inclusions ?? []).join("\n"))}</textarea>
      </label>
      <div class="admin-check-row">
        <label class="admin-check">
          <input name="active" type="checkbox" ${offering.active ? "checked" : ""} />
          <span>Publicly active</span>
        </label>
        <label class="admin-check">
          <input name="requiresApproval" type="checkbox" ${offering.requiresApproval ? "checked" : ""} />
          <span>Approval required</span>
        </label>
      </div>
      <div class="admin-edit-actions">
        <span>${escapeHtml(adminMoney(offering.amount, offering.publicLabel ?? "Not set"))}</span>
        <button class="button secondary" data-save-vendor-offering="${escapeAttr(offering.id)}" data-requires-permission="finance:write" type="button">Save offering</button>
      </div>
    </article>
  `;
}

function renderAdminEditors() {
  const tickets = adminConfigState?.tickets?.products ?? [];
  const sponsors = adminConfigState?.config?.sponsorPackages ?? [];
  const vendorOfferings = adminConfigState?.config?.vendorOfferings ?? [];
  document.querySelector("#admin-ticket-editor").innerHTML = tickets.map(ticketAdminCard).join("");
  document.querySelector("#admin-sponsor-editor").innerHTML = sponsors.map(sponsorAdminCard).join("");
  document.querySelector("#admin-vendor-offering-editor").innerHTML = vendorOfferings.map(vendorOfferingAdminCard).join("");
  renderAdminTicketPolicy();
  renderAdminEventGuide(adminConfigState?.bootstrap, adminConfigState?.eventGuideReadiness);
  if (adminSessionState) renderAdminSession(adminSessionState);
  bindAdminSaveButtons();
}

function orderRecordCard(item) {
  const order = item.record;
  const lines = order.lineItems?.map(line => `${line.quantity} x ${line.name}`).join(", ") ?? "No line items";
  const boardRefundReady = BOARD_DEMO_ACCESS.enabled
    && order.checkoutEnvironment === "board_sandbox"
    && ["paid", "partially_refunded"].includes(order.status)
    && adminCan("finance:write");
  return `
    <article class="admin-record-card" data-ticket-order="${escapeAttr(order.id ?? "")}">
      <div>
        <strong>${escapeHtml(order.id ?? "Order record")}</strong>
        <span>${escapeHtml(order.status ?? "unknown")}</span>
      </div>
      <p>${escapeHtml(lines)}</p>
      <p>${escapeHtml(adminMoney(order.totals?.knownAmount, "$0.00"))} · ${escapeHtml(order.customer?.email ?? "No buyer email")}${order.checkoutEnvironment === "board_sandbox" ? " · local sandbox" : ""}</p>
      ${order.policyAcceptance?.version ? `<p class="admin-ticket-policy-evidence">Policy ${escapeHtml(order.policyAcceptance.version)} accepted ${escapeHtml(new Date(order.policyAcceptance.acceptedAt).toLocaleString())}</p>` : ""}
      ${boardRefundReady ? `<button class="button secondary" data-refund-board-ticket="${escapeAttr(order.id)}" type="button">Refund demo order</button>` : ""}
    </article>
  `;
}

function paymentEventCard(item) {
  const event = item.record;
  return `
    <article class="admin-record-card">
      <div>
        <strong>${escapeHtml(event.type ?? event.id ?? "Payment event")}</strong>
        <span>${escapeHtml(event.fulfillmentStatus ?? "not_required")}</span>
      </div>
      <p>${escapeHtml(event.checkoutSessionId ?? event.objectId ?? "No checkout session attached")} · ${escapeHtml(event.verificationReason ?? "signature not checked")}</p>
    </article>
  `;
}

function fulfillmentCard(item) {
  const fulfillment = item.record;
  const statusOptions = ["queued", "needs_review", "ready", "issued", "checked_in", "refunded", "voided"]
    .map(status => `<option value="${escapeAttr(status)}" ${status === fulfillment.status ? "selected" : ""}>${escapeHtml(status.replace("_", " "))}</option>`)
    .join("");
  return `
    <article class="admin-record-card" data-fulfillment-id="${escapeAttr(fulfillment.id)}">
      <div>
        <strong>${escapeHtml(fulfillment.name ?? fulfillment.productId ?? "Fulfillment record")}</strong>
        <span>${escapeHtml(fulfillment.fulfillmentType ?? "manual_review")}</span>
      </div>
      <p>${escapeHtml(fulfillment.orderId ?? "No order")} · ${escapeHtml(fulfillment.holder?.email ?? "No holder email")}</p>
      <div class="fulfillment-actions">
        <select aria-label="Fulfillment status">${statusOptions}</select>
        <button class="button secondary" data-save-fulfillment="${escapeAttr(fulfillment.id)}" data-requires-permission="fulfillment:update" type="button">Update</button>
      </div>
    </article>
  `;
}

function adminRecordDisplayLabel(value, fallback = "Recorded change") {
  const text = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : fallback;
}

function auditCard(item) {
  const audit = item.record;
  const targetType = adminRecordDisplayLabel(audit.target?.type, "Record");
  const targetName = audit.after?.organizationName
    || audit.before?.organizationName
    || audit.after?.title
    || audit.before?.title
    || audit.after?.name
    || audit.before?.name;
  const target = targetName || targetType;
  const fields = audit.metadata?.changedFields?.length
    ? `Changed: ${audit.metadata.changedFields.map(field => adminRecordDisplayLabel(field)).join(", ")}`
    : adminRecordDisplayLabel(audit.metadata?.severity, "Recorded");
  const actor = adminRecordDisplayLabel(audit.actor?.role || audit.actor?.type, "System");
  const timestamp = new Date(audit.createdAt);
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? "Timestamp unavailable"
    : timestamp.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return `
    <article class="admin-record-card" data-audit-action="${escapeAttr(audit.action ?? "recorded")}">
      <div>
        <strong>${escapeHtml(adminRecordDisplayLabel(audit.action))}</strong>
        <span>${escapeHtml(target)}</span>
      </div>
      <p>${escapeHtml(fields)} · ${escapeHtml(actor)} · ${escapeHtml(timeLabel)}</p>
    </article>
  `;
}

function snapshotCard(item) {
  const snapshot = item.record;
  const target = adminRecordDisplayLabel(snapshot.target?.type, "Configuration");
  return `
    <article class="admin-record-card" data-snapshot-file="${escapeAttr(item.file)}">
      <div>
        <strong>${escapeHtml(snapshot.reason ?? snapshot.id ?? "Configuration snapshot")}</strong>
        <span>${escapeHtml(target)}</span>
      </div>
      <p>${snapshot.createdAt ? escapeHtml(new Date(snapshot.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })) : "Timestamp unavailable"}</p>
      <div class="snapshot-actions">
        <button class="button secondary" data-restore-snapshot="${escapeAttr(item.file)}" data-requires-permission="config:rollback" type="button">Restore</button>
      </div>
    </article>
  `;
}

function pinColor(colorKey) {
  return legendColorByKey.get(colorKey) || "var(--gulf)";
}

function pinInk(colorKey) {
  return colorKey === "master_duo" || colorKey === "semi_pro" ? "var(--ink)" : "var(--white)";
}

function corridorPinMarkup(poi) {
  const xy = poi.illustratedMapXY || { x: 0.5, y: 0.5 };
  const entry = poi.entryId ? entriesById.get(poi.entryId) : null;
  const sculptor = entry ? sculptorsById.get(entry.sculptorId) : null;
  const isSculpture = poi.type === "sculpture";
  const label = entry ? entry.title : (poi.label || poi.type);
  const mobileLabel = ({ poi_north_gate: "Gate", poi_food: "Food", poi_restroom: "Restrooms" })[poi.id] || label;
  const live = entry && entry.status === "sculpting";
  const title = sculptor
    ? `${entry.title} — ${sculptor.name} (marker ${poi.beachMarker})`
    : `${label} (marker ${poi.beachMarker})`;
  return `<button class="corridor-pin${isSculpture ? "" : " corridor-pin-amenity"}${live ? " is-live" : ""}" type="button"
     style="left:${(xy.x * 100).toFixed(1)}%;top:${(xy.y * 100).toFixed(1)}%;--pin:${pinColor(poi.colorKey)}"
     ${sculptor ? `data-sculptor="${sculptor.id}"` : ""} data-poi="${poi.id}"
     title="${title}" aria-label="${title}">
     <span class="corridor-pin-dot"></span>
     <span class="corridor-pin-label" data-mobile-label="${escapeAttr(mobileLabel)}">${escapeHtml(isSculpture ? poi.beachMarker : label)}</span>
   </button>`;
}

function renderCorridorMap() {
  const map = document.querySelector("#corridor-map");
  if (!map) return;
  map.innerHTML = `
    <span class="corridor-water" aria-hidden="true"></span>
    <span class="corridor-sand" aria-hidden="true"></span>
    <span class="corridor-axis" aria-hidden="true">North Gate → beach markers 12.5&ndash;14.5</span>
    ${sculpturePois.map(corridorPinMarkup).join("")}
  `;
  map.querySelectorAll("[data-sculptor]").forEach(pin => {
    pin.addEventListener("click", () => selectSculptor(pin.dataset.sculptor));
  });
  const legend = document.querySelector("#corridor-legend");
  if (legend) {
    legend.innerHTML = sculptorLegend
      .map(item => `<span><i style="background:${item.colorHex}"></i>${item.label}</span>`)
      .join("");
  }
}

function sculptorCardMarkup(sculptor) {
  const entry = sculptor.entryId ? entriesById.get(sculptor.entryId) : null;
  return `
    <button class="sculptor-card" type="button" data-sculptor="${sculptor.id}" data-division="${sculptor.division}">
      <span class="sculptor-card-chip" style="--pin:${pinColor(sculptor.division)};--pin-ink:${pinInk(sculptor.division)}">${divisionLabel(sculptor.division)}</span>
      <strong>${sculptor.name}</strong>
      <span class="sculptor-card-home">${sculptor.hometown ?? ""}</span>
      ${entry ? `<span class="sculptor-card-entry">&ldquo;${entry.title}&rdquo; · marker ${entry.beachMarker}</span>` : ""}
      <span class="sculptor-card-return${sculptor.returning ? "" : " sculptor-card-new"}">${sculptor.returning ? "Returning artist" : "New this year"}</span>
    </button>`;
}

function renderSculptorRoster(filter) {
  const roster = document.querySelector("#sculptor-roster");
  if (!roster) return;
  const list = [...sculptors]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(s => filter === "all" || s.division === filter);
  roster.innerHTML = list.length
    ? list.map(sculptorCardMarkup).join("")
    : '<article class="empty-state"><span>No sculptors in this division yet.</span></article>';
  roster.querySelectorAll("[data-sculptor]").forEach(card => {
    card.addEventListener("click", () => selectSculptor(card.dataset.sculptor));
  });
}

function renderSculptorFilters(active) {
  const el = document.querySelector("#sculptor-filters");
  if (!el) return;
  const divisions = [...new Set(sculptors.map(s => s.division))];
  const chips = [["all", "All"], ...divisions.map(d => [d, divisionLabel(d)])];
  el.innerHTML = chips
    .map(([key, label]) => `<button class="sculptor-chip${key === active ? " is-active" : ""}" type="button" data-filter="${key}">${label}</button>`)
    .join("");
  el.querySelectorAll("[data-filter]").forEach(chip => {
    chip.addEventListener("click", () => {
      renderSculptorFilters(chip.dataset.filter);
      renderSculptorRoster(chip.dataset.filter);
    });
  });
}

function selectSculptor(id) {
  const sculptor = sculptorsById.get(id);
  const detail = document.querySelector("#sculptor-detail");
  if (!detail || !sculptor) return;
  const entry = sculptor.entryId ? entriesById.get(sculptor.entryId) : null;
  const status = entry ? (statusLabels[entry.status] ?? entry.status) : null;
  detail.innerHTML = `
    <div class="sculptor-detail-head" style="--pin:${escapeAttr(pinColor(sculptor.division))}">
      <span class="sculptor-detail-chip">${escapeHtml(divisionLabel(sculptor.division))}</span>
      ${entry && entry.status === "sculpting"
        ? `<span class="sculptor-detail-live">&#9679; ${escapeHtml(status)}</span>`
        : (status ? `<span class="sculptor-detail-status">${escapeHtml(status)}</span>` : "")}
    </div>
    <h3>${escapeHtml(sculptor.name)}</h3>
    <p class="sculptor-detail-home">${escapeHtml(sculptor.hometown ?? "")}${sculptor.returning ? " · Returning artist" : " · New this year"}</p>
    ${entry ? `<p class="sculptor-detail-entry"><strong>&ldquo;${escapeHtml(entry.title)}&rdquo;</strong> — beach marker ${escapeHtml(entry.beachMarker)}</p>` : ""}
    ${entry && entry.statement ? `<p class="sculptor-detail-statement">${escapeHtml(entry.statement)}</p>` : ""}
    <p class="sculptor-detail-bio">${escapeHtml(sculptor.bio ?? "")}</p>
    ${sculptor.socials && sculptor.socials.instagram ? `<p class="sculptor-detail-social">${escapeHtml(sculptor.socials.instagram)}</p>` : ""}
  `;
  document.querySelectorAll(".corridor-pin").forEach(pin => {
    pin.classList.toggle("is-selected", pin.dataset.sculptor === id);
  });
}

function defaultSculptorDetail() {
  const detail = document.querySelector("#sculptor-detail");
  if (!detail) return;
  detail.innerHTML = '<div class="sculptor-detail-empty"><strong>Tap a sculpture or a sculptor</strong><span>See the artist, their work, and where to find them on the beach.</span></div>';
}

// Public/ops split: the visitor site is the default; internal ops/admin/build
// surfaces move behind Operations mode (mirrors the iOS Customer/Admin switch).
const OPS_SECTION_IDS = new Set(OPS_DEMO_SECTION_IDS);

function classifyAudiences() {
  document.querySelectorAll("main > section").forEach(sec => {
    if (sec.classList.contains("hero")) { sec.dataset.audience = "all"; return; }
    sec.dataset.audience = OPS_SECTION_IDS.has(sec.id) ? "ops" : "public";
  });
  document.querySelectorAll("header nav a").forEach(link => {
    if (ADMIN_ENTRY) {
      link.dataset.audience = "ops";
      return;
    }
    const id = (link.getAttribute("href") || "").replace("#", "");
    link.dataset.audience = OPS_SECTION_IDS.has(id) ? "ops" : "public";
  });
}

function setSiteMode(mode) {
  const normalized = mode === "ops" && OPS_SURFACE_ENABLED ? "ops" : "public";
  document.body.classList.toggle("mode-ops", normalized === "ops");
  document.body.classList.toggle("mode-public", normalized === "public");
  document.querySelectorAll("[data-site-mode]").forEach(btn => {
    const active = btn.dataset.siteMode === normalized;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  try { localStorage.setItem("sandfest_site_mode", normalized); } catch { /* ignore */ }
  if (normalized === "ops" && BOARD_DEMO_ACCESS.enabled) void loadBoardDemoWorkspace();
}

function initMobileNavigation() {
  const toggle = document.querySelector("#mobile-nav-toggle");
  const navigation = document.querySelector("#public-navigation");
  if (!toggle || !navigation) return;

  const setOpen = (open, { restoreFocus = false } = {}) => {
    const expanded = open === true;
    navigation.dataset.open = String(expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Close navigation" : "Open navigation");
    toggle.title = expanded ? "Close navigation" : "Open navigation";
    document.body.classList.toggle("mobile-nav-open", expanded);
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
  navigation.addEventListener("click", event => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    setOpen(false);
    const targetId = link.hash.slice(1);
    requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;
      const removeTabIndex = !target.hasAttribute("tabindex");
      if (removeTabIndex) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      if (removeTabIndex) target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    });
  });
  document.querySelectorAll("[data-site-mode]").forEach(button => {
    button.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("click", event => {
    const clickedTopbar = event.target instanceof Element && event.target.closest(".topbar");
    if (toggle.getAttribute("aria-expanded") === "true" && !clickedTopbar) setOpen(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false, { restoreFocus: true });
    }
  });
  window.addEventListener("hashchange", () => setOpen(false));
  const mobileViewport = window.matchMedia("(max-width: 920px)");
  mobileViewport.addEventListener?.("change", event => {
    if (!event.matches) setOpen(false);
  });
}

function initSiteMode() {
  classifyAudiences();
  let saved = null;
  if (OPS_DEMO_ENABLED) {
    try { saved = localStorage.getItem("sandfest_site_mode"); } catch { /* ignore */ }
  }
  const queryMode = new URLSearchParams(window.location.search).get("mode");
  setSiteMode(resolveInitialSiteMode({
    adminEntry: ADMIN_ENTRY,
    opsDemoEnabled: OPS_DEMO_ENABLED,
    queryMode,
    hash: window.location.hash,
    savedMode: saved,
    opsSectionIds: OPS_SECTION_IDS
  }));
  document.querySelectorAll("[data-site-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.matches("[data-operations-surface]")) return;
      const requestedMode = btn.dataset.siteMode === "ops" ? "ops" : "public";
      setSiteMode(requestedMode);
      const targetHash = requestedMode === "ops" ? "#admin-config" : "#top";
      if (window.location.hash !== targetHash) window.location.hash = targetHash;
      else document.querySelector(targetHash)?.scrollIntoView({ block: "start" });
    });
  });
  if (OPS_DEMO_ENABLED) {
    window.addEventListener("hashchange", () => {
      const linkedMode = siteModeForHash(window.location.hash, OPS_SECTION_IDS);
      if (linkedMode) setSiteMode(linkedMode);
    });
  }
}

const PASSPORT_KEY = "sandfest_passport_v1";
const PASSPORT_ATTENDEE_KEY = "sandfest_passport_attendee_v1";
const passportCheckpoints = sculptureEntries.filter(e => sculptorsById.has(e.sculptorId));

function passportAttendeeRef() {
  try {
    let id = localStorage.getItem(PASSPORT_ATTENDEE_KEY);
    if (!id) {
      id = `web_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
      localStorage.setItem(PASSPORT_ATTENDEE_KEY, id);
    }
    return id;
  } catch {
    return `web_session_${Date.now()}`;
  }
}

function readPassport() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PASSPORT_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writePassport(set) {
  try {
    localStorage.setItem(PASSPORT_KEY, JSON.stringify([...set]));
  } catch {
    /* localStorage unavailable — session-only */
  }
}

async function stampPassportBackend(entryId, { method = "tap" } = {}) {
  const attendeeRef = passportAttendeeRef();
  const payload = entryId.startsWith("ent_") ? `tsf:entry:${entryId}` : `tsf:entry:${entryId}`;
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/passport/stamp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attendeeRef,
        payload,
        entryId,
        method
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Stamp failed (${response.status})`);
    return data;
  } catch (error) {
    // Offline-first: local stamp still works.
    return { offline: true, error: error.message };
  }
}

async function collectStamp(entryId) {
  const collected = readPassport();
  const already = collected.has(entryId);
  if (already) {
    // Demo toggle-off stays local only (backend stamps are append-only).
    collected.delete(entryId);
    writePassport(collected);
    renderPassport();
    return;
  }
  collected.add(entryId);
  writePassport(collected);
  renderPassport();
  const result = await stampPassportBackend(entryId, { method: "tap" });
  if (result?.progress?.complete) {
    const reward = document.querySelector("#passport-reward");
    if (reward) {
      reward.hidden = false;
      reward.innerHTML = `<strong>&#127881; Passport complete!</strong><span>Stamps synced to the prize drawing${result.offline ? " (offline — will retry when API is up)" : ""}.</span>`;
    }
  }
}

function resetPassport() {
  writePassport(new Set());
  renderPassport();
}

function renderPassport() {
  const stampsEl = document.querySelector("#passport-stamps");
  if (!stampsEl || !passportCheckpoints.length) {
    const panel = document.querySelector("#passport-panel");
    if (panel && !passportCheckpoints.length) panel.hidden = true;
    return;
  }
  const collected = readPassport();
  const total = passportCheckpoints.length;
  const count = passportCheckpoints.filter(e => collected.has(e.id)).length;

  stampsEl.innerHTML = passportCheckpoints.map(entry => {
    const sculptor = sculptorsById.get(entry.sculptorId);
    const done = collected.has(entry.id);
    return `
      <button class="passport-stamp${done ? " is-collected" : ""}" type="button" data-collect="${escapeAttr(entry.id)}"
        aria-pressed="${done}" title="${done ? "Collected" : "Tap to collect (simulates the on-beach QR scan)"}">
        <span class="passport-stamp-mark" style="--pin:${escapeAttr(pinColor(entry.division))};--pin-ink:${escapeAttr(pinInk(entry.division))}">${done ? "&#10003;" : escapeHtml(entry.beachMarker)}</span>
        <strong>${escapeHtml(entry.title)}</strong>
        <span class="passport-stamp-artist">${escapeHtml(sculptor ? sculptor.name : "")}</span>
        <span class="passport-stamp-state">${done ? "Stamped" : `Scan at marker ${escapeHtml(entry.beachMarker)}`}</span>
      </button>`;
  }).join("");

  stampsEl.querySelectorAll("[data-collect]").forEach(btn => {
    btn.addEventListener("click", () => collectStamp(btn.dataset.collect));
  });

  const countEl = document.querySelector("#passport-count");
  const ring = document.querySelector("#passport-ring");
  if (countEl) countEl.textContent = `${count}/${total}`;
  if (ring) {
    const pct = total ? Math.round((count / total) * 100) : 0;
    ring.style.setProperty("--pct", `${pct}`);
    ring.classList.toggle("is-complete", count === total);
  }

  const reward = document.querySelector("#passport-reward");
  if (reward) {
    if (count === total && total > 0) {
      reward.hidden = false;
      reward.innerHTML = `<strong>&#127881; Passport complete!</strong><span>You'd now be entered into the prize drawing and earn a digital finisher badge.</span>`;
    } else {
      reward.hidden = true;
    }
  }
}

function initSculptors() {
  if (!sculptorRosterVisible) return;
  if (!document.querySelector("#corridor-map")) return;
  renderCorridorMap();
  renderSculptorFilters("all");
  renderSculptorRoster("all");
  defaultSculptorDetail();
  renderPassport();
  const resetBtn = document.querySelector("#passport-reset");
  if (resetBtn) resetBtn.addEventListener("click", resetPassport);
  // Best-effort hydrate from backend progress for this device id.
  hydratePassportFromApi().catch(() => {});
}

// --- People's Choice ---
const VOTING_KEY = "sandfest_vote_entry_v1";

function readLocalVote() {
  try { return localStorage.getItem(VOTING_KEY) || null; } catch { return null; }
}
function writeLocalVote(entryId) {
  try { localStorage.setItem(VOTING_KEY, entryId); } catch { /* ignore */ }
}

function renderVotingBallot(payload) {
  if (!sculptorRosterVisible) return;
  const ballot = document.querySelector("#voting-ballot");
  const countEl = document.querySelector("#voting-count");
  if (!ballot) return;
  const myVote = readLocalVote();
  const board = payload.leaderboard || [];
  if (countEl) countEl.textContent = String(payload.totals?.totalVotes ?? board.reduce((s, e) => s + (e.votes || 0), 0));
  ballot.innerHTML = board.map(entry => {
    const selected = myVote === entry.id;
    return `
      <button type="button" class="voting-card${selected ? " is-selected" : ""}" data-vote-entry="${escapeAttr(entry.id)}" ${payload.votingOpen === false ? "disabled" : ""}>
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(entry.sculptorName || "")} · marker ${escapeHtml(entry.beachMarker || "—")}</span>
        <b>${Number(entry.votes) || 0} votes · ${Number(entry.sharePct) || 0}%</b>
        <em>${selected ? "Your pick" : "Tap to vote"}</em>
      </button>`;
  }).join("") || '<article class="empty-state"><span>No eligible entries.</span></article>';
  ballot.querySelectorAll("[data-vote-entry]").forEach(btn => {
    btn.addEventListener("click", () => castVote(btn.dataset.voteEntry));
  });
}

async function loadVoting() {
  if (!sculptorRosterVisible) return null;
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/voting`, { cache: "no-store" });
    if (!response.ok) throw new Error("Voting API unavailable");
    const data = await response.json();
    renderVotingBallot(data);
    return data;
  } catch {
    // Offline fallback from sculptors seed
    const board = passportCheckpoints.map(e => ({
      id: e.id,
      title: e.title,
      sculptorName: sculptorsById.get(e.sculptorId)?.name || "",
      beachMarker: e.beachMarker,
      votes: 0,
      sharePct: 0
    }));
    renderVotingBallot({ leaderboard: board, totals: { totalVotes: 0 }, votingOpen: true });
  }
}

async function castVote(entryId) {
  if (!sculptorRosterVisible) return null;
  const status = document.querySelector("#voting-status");
  writeLocalVote(entryId);
  if (status) status.textContent = "Saving your vote…";
  try {
    const ticketRef = document.querySelector("#voting-ticket-ref")?.value?.trim() || null;
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/voting`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attendeeRef: passportAttendeeRef(),
        entryId,
        ticketRef,
        channel: "web"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Vote failed (${response.status})`);
    renderVotingBallot(data);
    if (status) status.textContent = data.changed ? "Vote saved." : "Already your pick.";
  } catch (error) {
    renderVotingBallot({
      leaderboard: passportCheckpoints.map(e => ({
        id: e.id,
        title: e.title,
        sculptorName: sculptorsById.get(e.sculptorId)?.name || "",
        beachMarker: e.beachMarker,
        votes: 0,
        sharePct: 0
      })),
      totals: { totalVotes: 0 },
      votingOpen: true
    });
    if (status) status.textContent = `${error.message} — pick kept on this device.`;
  }
}

// --- Booth / vendor map ---
async function loadBooths() {
  const corridor = document.querySelector("#booth-corridor");
  const list = document.querySelector("#booth-list");
  const countEl = document.querySelector("#booth-pin-count");
  if (!corridor || !list) return;
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/booths`, { cache: "no-store" });
    if (!response.ok) throw new Error("Booths API unavailable");
    const data = await response.json();
    renderBoothMap(data.pins || []);
    if (countEl) countEl.textContent = `${data.pins?.length || 0} booths`;
  } catch {
    corridor.innerHTML = '<p class="empty-state">The booth map is temporarily unavailable. Please check back shortly.</p>';
    list.innerHTML = "";
    if (countEl) countEl.textContent = "Map unavailable";
  }
}

function formPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.consentToContact = form.elements.consentToContact?.checked === true;
  if (form.id === "sponsor-inquiry-form" && activeSponsorInvitationToken) {
    payload.sponsorInvitationToken = activeSponsorInvitationToken;
    payload.packageId = form.elements.packageId.value;
  }
  if (TURNSTILE_SITE_KEY) payload.botToken = partnerBotProtection.tokenFor(form);
  return payload;
}

async function fillBoardPartnerPreset(kind) {
  if (!import.meta.env.DEV || !BOARD_DEMO_ACCESS.enabled || !BOARD_PARTNER_PRESET_LOADER || !["sponsor", "vendor"].includes(kind)) return;
  const form = document.querySelector(kind === "sponsor" ? "#sponsor-inquiry-form" : "#vendor-application-form");
  if (!form) return;
  const status = form.querySelector(".partner-form-status");
  if (kind === "sponsor" && activeSponsorInvitationToken) {
    setFormStatus(status, "This form is already using a sponsor invitation.", "error");
    return;
  }

  try {
    const runId = globalThis.crypto?.randomUUID?.().slice(0, 8) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { boardPartnerFormPreset } = await BOARD_PARTNER_PRESET_LOADER();
    const preset = boardPartnerFormPreset(kind, runId);
    form.reset();
    delete form.dataset.idempotencyKey;
    if (kind === "vendor") {
      form.elements.category.value = preset.fields.category;
      renderVendorOfferingChoices();
    }
    for (const [name, value] of Object.entries(preset.fields)) {
      if (form.elements[name]) form.elements[name].value = value;
    }
    if (kind === "sponsor") renderSponsorPackageSummary();
    form.elements.consentToContact.checked = false;
    setFormStatus(status, "Synthetic details are ready. Contact consent remains unchecked.", "ok");
    form.elements.organizationName.focus({ preventScroll: true });
  } catch {
    setFormStatus(status, "Synthetic details could not be loaded. Try again.", "error");
  }
}

function setFormStatus(status, message, state = "idle", { html = false } = {}) {
  if (!status) return;
  status.dataset.state = state;
  status.setAttribute("role", state === "error" ? "alert" : "status");
  status.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  if (html) status.innerHTML = message;
  else status.textContent = message;
}

async function initPartnerBotProtection() {
  if (!TURNSTILE_SITE_KEY) return;
  if (partnerBotProtectionPromise) return partnerBotProtectionPromise;
  const forms = [...document.querySelectorAll("form[data-turnstile-action]")];
  partnerBotProtectionPromise = (async () => {
    try {
      const { createPartnerBotProtection } = await import("./partner-bot-protection.js");
      partnerBotProtection = await createPartnerBotProtection({ siteKey: TURNSTILE_SITE_KEY, forms });
    } catch (error) {
      for (const form of forms) {
        const button = form.querySelector('button[type="submit"]');
        const status = form.querySelector(".partner-form-status");
        if (button) button.disabled = true;
        if (status) {
          status.dataset.state = "error";
          status.textContent = error.message || "Security verification is unavailable. Reload this page to try again.";
        }
      }
    }
  })();
  return partnerBotProtectionPromise;
}

function armPartnerBotProtection() {
  if (!TURNSTILE_SITE_KEY) return;
  const forms = [...document.querySelectorAll("form[data-turnstile-action]")];
  const initialize = () => { initPartnerBotProtection(); };
  for (const form of forms) {
    form.addEventListener("focusin", initialize, { once: true });
    form.addEventListener("pointerdown", initialize, { once: true });
  }
}

const PARTNER_PORTAL_SESSION_KEY = "sandfest_partner_portal_v1";
const TASK_PORTAL_SESSION_KEY = "sandfest_task_portal_v1";
let taskPortalController = null;
let taskPortalControllerLoad = null;
let activeOutreachPreferenceAccess = null;
let lastLoadedOutreachPreference = null;
let outreachPreferenceLoadVersion = 0;

function partnerPortalAccessFromFragment() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith("partner-status?")) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  const reference = params.get("reference")?.trim();
  const token = params.get("token")?.trim();
  return reference && token ? { reference, token } : null;
}

function taskPortalRequested() {
  if (window.location.hash.startsWith("#task-status?")) return true;
  if (window.location.hash !== "#task-status") return false;
  try { return Boolean(sessionStorage.getItem(TASK_PORTAL_SESSION_KEY)); } catch { return false; }
}

async function loadTaskPortalFromLocation(options = {}) {
  if (!taskPortalControllerLoad) {
    taskPortalControllerLoad = import("./task-portal-ui.js").then(({ createTaskPortalController }) => {
      taskPortalController = createTaskPortalController({
        document,
        window,
        storage: sessionStorage,
        publicApiBase,
        fetchWithTimeout,
        friendlyRequestError,
        conditionLabel,
        stabilizeRenderedHashTarget
      });
      return taskPortalController;
    }).catch(error => {
      taskPortalControllerLoad = null;
      throw error;
    });
  }
  return (await taskPortalControllerLoad).loadFromLocation(options);
}

function outreachPreferenceAccessFromFragment() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith("outreach-preferences?")) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  const prospectId = params.get("prospect")?.trim();
  const token = params.get("token")?.trim();
  return prospectId && token ? { prospectId, token } : null;
}

function sponsorInvitationTokenFromFragment() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith("sponsor-invitation?")) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  return params.get("token")?.trim() || null;
}

async function loadSponsorInvitation(token, options = {}) {
  const banner = document.querySelector("#sponsor-invitation");
  const copy = document.querySelector("#sponsor-invitation-copy");
  const form = document.querySelector("#sponsor-inquiry-form");
  if (!banner || !copy || !form || !token) return;
  const loadVersion = ++sponsorInvitationLoadVersion;
  if (activeSponsorInvitationToken && activeSponsorInvitationToken !== token) clearSponsorInvitationForm(form);
  if (window.location.hash.startsWith("#sponsor-invitation?")) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#sponsors`);
  }
  banner.hidden = false;
  banner.dataset.state = "loading";
  copy.textContent = "Opening your sponsor invitation...";
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/sponsor-invitation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await response.json().catch(() => ({}));
    if (loadVersion !== sponsorInvitationLoadVersion) return;
    if (!response.ok) throw new Error(data.error || `Invitation lookup failed with ${response.status}`);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#sponsors`);
    if (data.converted && data.portalAccess?.reference && data.portalAccess?.token) {
      clearSponsorInvitationForm(form);
      banner.hidden = false;
      banner.dataset.state = "ok";
      copy.textContent = "This invitation is already connected to your sponsor application. Opening its private status now.";
      await loadPartnerPortalStatus({ reference: data.portalAccess.reference, token: data.portalAccess.token }, { scroll: true });
      return;
    }
    const invitation = data.invitation || {};
    activeSponsorInvitationToken = token;
    form.elements.organizationName.value = invitation.organizationName || "";
    form.elements.organizationName.readOnly = true;
    form.elements.contactName.value = invitation.contactName || "";
    form.elements.contactEmail.value = invitation.contactEmail || "";
    form.elements.contactEmail.readOnly = true;
    form.elements.website.value = invitation.website || "";
    form.elements.packageId.value = invitation.packageId || form.elements.packageId.value;
    form.elements.packageId.disabled = true;
    renderSponsorPackageSummary();
    banner.dataset.state = "ok";
    copy.textContent = `${invitation.organizationName} · ${invitation.packageName}${invitation.packageLabel ? ` · ${invitation.packageLabel}` : ""}`;
    if (options.scroll) form.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    if (loadVersion !== sponsorInvitationLoadVersion) return;
    clearSponsorInvitationForm(form);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#sponsors`);
    banner.hidden = false;
    banner.dataset.state = "error";
    copy.textContent = error.message;
  }
}

function clearSponsorInvitationForm(form) {
  if (!form || form.id !== "sponsor-inquiry-form") return;
  activeSponsorInvitationToken = null;
  if (form.elements.organizationName) form.elements.organizationName.readOnly = false;
  if (form.elements.contactEmail) form.elements.contactEmail.readOnly = false;
  if (form.elements.packageId) form.elements.packageId.disabled = false;
  const banner = document.querySelector("#sponsor-invitation");
  if (banner) {
    banner.hidden = true;
    delete banner.dataset.state;
  }
}

function renderOutreachPreference(preference) {
  const section = document.querySelector("#outreach-preferences");
  const copy = document.querySelector("#outreach-preferences-copy");
  const status = document.querySelector("#outreach-preferences-status");
  const button = document.querySelector("#outreach-preferences-unsubscribe");
  if (!section || !copy || !status || !button) return;
  section.hidden = false;
  const unsubscribed = preference?.status === "unsubscribed";
  copy.textContent = unsubscribed
    ? `${preference.organizationName} will not receive further Texas SandFest sponsor outreach.`
    : `${preference.organizationName} is currently eligible for reviewed Texas SandFest sponsor outreach.`;
  status.dataset.state = unsubscribed ? "ok" : "ready";
  status.textContent = unsubscribed ? "Preference saved. Any unsent outreach has been canceled." : "You can stop future sponsor outreach below.";
  button.hidden = unsubscribed;
  button.disabled = false;
}

function sameOutreachPreferenceAccess(left, right) {
  return Boolean(left?.prospectId && left?.token)
    && left.prospectId === right?.prospectId
    && left.token === right?.token;
}

async function loadOutreachPreference(access, options = {}) {
  const section = document.querySelector("#outreach-preferences");
  const copy = document.querySelector("#outreach-preferences-copy");
  const status = document.querySelector("#outreach-preferences-status");
  const button = document.querySelector("#outreach-preferences-unsubscribe");
  if (!section || !copy || !status || !button || !access?.prospectId || !access?.token) return;
  const loadVersion = ++outreachPreferenceLoadVersion;
  const previous = lastLoadedOutreachPreference;
  const switchingAccess = Boolean(activeOutreachPreferenceAccess)
    && !sameOutreachPreferenceAccess(activeOutreachPreferenceAccess, access);
  activeOutreachPreferenceAccess = access;
  if (window.location.hash.startsWith("#outreach-preferences?")) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#outreach-preferences`);
  }
  section.hidden = false;
  button.hidden = true;
  button.disabled = true;
  if (switchingAccess) copy.textContent = "Verifying another outreach preference link before showing recipient details.";
  status.dataset.state = "loading";
  status.textContent = "Loading outreach preference...";
  let responseStatus = 0;
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/outreach-preferences`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(access)
    });
    responseStatus = response.status;
    const data = await response.json().catch(() => ({}));
    if (loadVersion !== outreachPreferenceLoadVersion) return;
    if (!response.ok) {
      const preferenceError = new Error(data.error || `Preference lookup failed with ${response.status}`);
      preferenceError.status = response.status;
      throw preferenceError;
    }
    lastLoadedOutreachPreference = { access, preference: data.preference };
    renderOutreachPreference(data.preference);
    if (options.scroll) section.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    if (loadVersion !== outreachPreferenceLoadVersion) return;
    const accessRejected = shouldForgetPartnerPortalAccess(responseStatus);
    if (accessRejected && previous?.access && previous?.preference) {
      if (switchingAccess) {
        activeOutreachPreferenceAccess = previous.access;
        renderOutreachPreference(previous.preference);
        status.dataset.state = "error";
        status.textContent = "This new outreach preference link is invalid. The previously loaded preference remains available.";
        return;
      }
      if (sameOutreachPreferenceAccess(previous.access, access)) lastLoadedOutreachPreference = null;
    }
    if (!accessRejected && previous?.preference && sameOutreachPreferenceAccess(previous.access, access)) {
      activeOutreachPreferenceAccess = previous.access;
      renderOutreachPreference(previous.preference);
      status.dataset.state = "error";
      status.textContent = "Outreach preferences are temporarily unavailable. Showing the last verified preference so you can retry.";
      return;
    }
    if (accessRejected) {
      activeOutreachPreferenceAccess = null;
      copy.textContent = "No outreach recipient is shown because this private link could not be verified.";
    }
    status.dataset.state = "error";
    status.textContent = accessRejected
      ? "This outreach preference link is invalid. Use the latest link from the SandFest message."
      : "Outreach preferences are temporarily unavailable. This private access remains available to retry.";
  }
}

async function unsubscribeOutreachPreference() {
  const button = document.querySelector("#outreach-preferences-unsubscribe");
  const status = document.querySelector("#outreach-preferences-status");
  if (!button || !status || !activeOutreachPreferenceAccess) return;
  const access = activeOutreachPreferenceAccess;
  const loadVersion = outreachPreferenceLoadVersion;
  button.disabled = true;
  status.dataset.state = "loading";
  status.textContent = "Saving preference...";
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/outreach-preferences/unsubscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(access)
    });
    const data = await response.json().catch(() => ({}));
    if (loadVersion !== outreachPreferenceLoadVersion || !sameOutreachPreferenceAccess(activeOutreachPreferenceAccess, access)) return;
    if (!response.ok) throw new Error(data.error || `Preference update failed with ${response.status}`);
    lastLoadedOutreachPreference = { access, preference: data.preference };
    renderOutreachPreference(data.preference);
  } catch (error) {
    if (loadVersion !== outreachPreferenceLoadVersion || !sameOutreachPreferenceAccess(activeOutreachPreferenceAccess, access)) return;
    button.disabled = false;
    status.dataset.state = "error";
    status.textContent = error.message;
  }
}

function rememberPartnerPortalAccess(access) {
  try { sessionStorage.setItem(PARTNER_PORTAL_SESSION_KEY, JSON.stringify(access)); } catch { /* ignore */ }
}

function concealPartnerPortalCapability() {
  const safeHash = partnerPortalSafeHash(window.location.hash);
  if (safeHash) history.replaceState(null, "", `${window.location.pathname}${window.location.search}${safeHash}`);
}

function forgetPartnerPortalAccess(access, form) {
  try { forgetMatchingPartnerPortalAccess(sessionStorage, PARTNER_PORTAL_SESSION_KEY, access); } catch { /* ignore */ }
  if (form?.elements.token.value === access?.token) form.elements.token.value = "";
}

function clearPartnerPortalView() {
  const form = document.querySelector("#partner-status-form");
  const status = form?.querySelector(".partner-form-status");
  const result = document.querySelector("#partner-status-result");
  const forgetButton = document.querySelector("#partner-status-forget");
  const access = activePartnerPortalAccess || savedPartnerPortalAccess();
  if (access) forgetPartnerPortalAccess(access, form);
  else {
    try { sessionStorage.removeItem(PARTNER_PORTAL_SESSION_KEY); } catch { /* ignore */ }
  }
  activePartnerPortalAccess = null;
  activePartnerPortalApplication = null;
  form?.reset();
  if (forgetButton) forgetButton.hidden = true;
  if (status) {
    status.dataset.state = "ok";
    status.textContent = "Private access removed from this browser.";
  }
  if (result) result.innerHTML = '<div class="partner-status-empty"><strong>Your SandFest partnership, in one place</strong><span>Review progress, payments, invoices, and upcoming dates are shown here after secure access.</span></div>';
}

function savedPartnerPortalAccess() {
  try {
    const access = JSON.parse(sessionStorage.getItem(PARTNER_PORTAL_SESSION_KEY) || "null");
    return access?.reference && access?.token ? access : null;
  } catch {
    return null;
  }
}

function portalDate(value, fallback = "To be scheduled") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function partnerAssetKindOptions(selected = "primary_logo") {
  return [
    ["primary_logo", "Primary logo"], ["alternate_logo", "Alternate logo"],
    ["brand_guidelines", "Brand guidelines"], ["ad_creative", "Ad creative"],
    ["event_photo", "Event photo"], ["other", "Other"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function partnerBrandColor(value, fallback) {
  const color = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}

function partnerBrandContrast(color) {
  const hex = partnerBrandColor(color, "#005B63").slice(1);
  const channels = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}

function bindPartnerBrandPreview() {
  const form = document.querySelector("#partner-brand-profile-form");
  const preview = document.querySelector("#partner-brand-preview");
  if (!form || !preview) return;
  const primaryText = form.elements.primaryColor;
  const secondaryText = form.elements.secondaryColor;
  const primaryPicker = form.querySelector('[data-brand-color-picker="primaryColor"]');
  const secondaryPicker = form.querySelector('[data-brand-color-picker="secondaryColor"]');
  const update = () => {
    const displayName = form.elements.displayName.value.trim() || activePartnerPortalApplication?.organizationName || "Sponsor name";
    const tagline = form.elements.tagline.value.trim() || "Sponsor tagline";
    const primary = partnerBrandColor(primaryText.value, primaryPicker.value || "#005B63");
    const secondary = partnerBrandColor(secondaryText.value, secondaryPicker.value || "#F7B733");
    if (/^#[0-9A-Fa-f]{6}$/.test(primaryText.value.trim())) primaryPicker.value = primary;
    if (/^#[0-9A-Fa-f]{6}$/.test(secondaryText.value.trim())) secondaryPicker.value = secondary;
    preview.style.setProperty("--brand-preview-primary", primary);
    preview.style.setProperty("--brand-preview-primary-ink", partnerBrandContrast(primary));
    preview.style.setProperty("--brand-preview-secondary", secondary);
    preview.style.setProperty("--brand-preview-secondary-ink", partnerBrandContrast(secondary));
    preview.querySelector("[data-brand-preview-name]").textContent = displayName;
    preview.querySelector("[data-brand-preview-tagline]").textContent = tagline;
    preview.querySelector("[data-brand-preview-mark]").textContent = sponsorShowcaseInitials(displayName);
    preview.querySelector('[data-brand-preview-color="primary"]').title = `Primary ${primary}`;
    preview.querySelector('[data-brand-preview-color="secondary"]').title = `Secondary ${secondary}`;
    preview.setAttribute("aria-label", `${displayName} brand preview. Primary ${primary}; secondary ${secondary}.`);
  };
  [[primaryPicker, primaryText], [secondaryPicker, secondaryText]].forEach(([picker, text]) => {
    picker.addEventListener("input", () => {
      text.value = picker.value.toUpperCase();
      update();
    });
    text.addEventListener("input", update);
  });
  form.elements.displayName.addEventListener("input", update);
  form.elements.tagline.addEventListener("input", update);
  update();
}

function renderPartnerBranding(branding) {
  if (!branding) return "";
  const profile = branding.profile || {};
  const assets = Array.isArray(branding.assets) ? branding.assets : [];
  const deliverables = Array.isArray(branding.deliverables) ? branding.deliverables : [];
  const primaryColor = partnerBrandColor(profile.primaryColor, "#005B63");
  const secondaryColor = partnerBrandColor(profile.secondaryColor, "#F7B733");
  const displayName = profile.displayName || activePartnerPortalApplication?.organizationName || "Sponsor name";
  return `<section class="partner-brand-center">
    <header class="partner-brand-heading"><div><span>Sponsor fulfillment</span><h4>Brand center</h4></div><b>${deliverables.filter(item => item.status === "complete").length} / ${deliverables.length} complete</b></header>
    <div id="partner-brand-preview" class="partner-brand-preview" role="group" aria-label="${escapeAttr(`${displayName} brand preview`)}">
      <span class="partner-brand-preview-mark" data-brand-preview-mark aria-hidden="true">${escapeHtml(sponsorShowcaseInitials(displayName))}</span>
      <div class="partner-brand-preview-copy"><span>Brand preview</span><strong data-brand-preview-name>${escapeHtml(displayName)}</strong><p data-brand-preview-tagline>${escapeHtml(profile.tagline || "Sponsor tagline")}</p></div>
      <div class="partner-brand-preview-colors" aria-label="Brand colors"><span data-brand-preview-color="primary" title="Primary ${escapeAttr(primaryColor)}"></span><span data-brand-preview-color="secondary" title="Secondary ${escapeAttr(secondaryColor)}"></span></div>
    </div>
    <div class="partner-brand-forms">
      <form id="partner-brand-profile-form" class="partner-brand-form">
        <div class="partner-brand-form-heading"><strong>Brand profile</strong><span data-status="${escapeAttr(profile.status || "draft")}">${escapeHtml(conditionLabel(profile.status || "draft"))}</span></div>
        ${profile.reviewNotes ? `<p class="partner-brand-review-note">${escapeHtml(profile.reviewNotes)}</p>` : ""}
        <div class="partner-brand-fields">
          <label><span>Display name</span><input name="displayName" required maxlength="160" value="${escapeAttr(profile.displayName || activePartnerPortalApplication?.organizationName || "")}" /></label>
          <label><span>Website</span><input name="website" type="url" maxlength="1000" placeholder="https://" value="${escapeAttr(profile.website || "")}" /></label>
          <label class="partner-brand-wide"><span>Tagline</span><input name="tagline" maxlength="240" value="${escapeAttr(profile.tagline || "")}" /></label>
          <label><span>Primary color</span><div class="partner-brand-color-control"><input type="color" data-brand-color-picker="primaryColor" value="${escapeAttr(primaryColor)}" aria-label="Choose primary color" /><input name="primaryColor" pattern="#[0-9A-Fa-f]{6}" maxlength="7" placeholder="#005B63" value="${escapeAttr(profile.primaryColor || "")}" /></div></label>
          <label><span>Secondary color</span><div class="partner-brand-color-control"><input type="color" data-brand-color-picker="secondaryColor" value="${escapeAttr(secondaryColor)}" aria-label="Choose secondary color" /><input name="secondaryColor" pattern="#[0-9A-Fa-f]{6}" maxlength="7" placeholder="#F7B733" value="${escapeAttr(profile.secondaryColor || "")}" /></div></label>
          <label><span>Instagram</span><input name="instagramUrl" type="url" maxlength="1000" placeholder="https://" value="${escapeAttr(profile.instagramUrl || "")}" /></label>
          <label><span>LinkedIn</span><input name="linkedinUrl" type="url" maxlength="1000" placeholder="https://" value="${escapeAttr(profile.linkedinUrl || "")}" /></label>
          <label class="partner-brand-wide"><span>Usage requirements</span><textarea name="usageNotes" rows="3" maxlength="2000">${escapeHtml(profile.usageNotes || "")}</textarea></label>
        </div>
        <button class="button primary" type="submit">Submit profile</button>
        <p class="partner-form-status partner-brand-status" aria-live="polite"></p>
      </form>
      <form id="partner-brand-asset-form" class="partner-brand-form">
        <div class="partner-brand-form-heading"><strong>Add brand asset</strong><span>${assets.length} on file</span></div>
        <div class="partner-brand-fields">
          <label><span>Asset type</span><select name="kind">${partnerAssetKindOptions()}</select></label>
          <label><span>Label</span><input name="label" maxlength="160" placeholder="Primary horizontal logo" /></label>
          <label class="partner-brand-wide"><span>Private file</span><input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
          <label class="partner-brand-wide"><span>Or secure asset URL</span><input name="sourceUrl" type="url" maxlength="1000" placeholder="https://" /></label>
        </div>
        <button class="button primary" type="submit">Submit asset</button>
        <p class="partner-form-status partner-brand-status" aria-live="polite"></p>
      </form>
    </div>
    <div class="partner-brand-assets">
      <strong>Assets</strong>
      <div>${assets.map(asset => `<article data-partner-brand-asset="${escapeAttr(asset.id)}">
        <div><strong>${escapeHtml(asset.label)}</strong><b data-status="${escapeAttr(asset.status)}">${escapeHtml(conditionLabel(asset.status))}</b></div>
        <span>${escapeHtml(conditionLabel(asset.kind))}${asset.fileName ? ` · ${escapeHtml(asset.fileName)}` : ""}${asset.sizeBytes ? ` · ${escapeHtml(`${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB`)}` : ""}</span>
        ${asset.reviewNotes ? `<p>${escapeHtml(asset.reviewNotes)}</p>` : ""}
        ${asset.sourceType === "upload" ? `<button type="button" class="button secondary" data-download-brand-asset="${escapeAttr(asset.id)}" data-file-name="${escapeAttr(asset.fileName || asset.label)}">Download</button>` : `<a class="button secondary" href="${escapeAttr(asset.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open asset</a>`}
      </article>`).join("") || '<span class="empty-state">No brand assets submitted.</span>'}</div>
    </div>
    <div class="partner-deliverables">
      <strong>Package fulfillment</strong>
      <div>${deliverables.map(item => `<article data-partner-deliverable="${escapeAttr(item.id)}">
        <header><div><strong>${escapeHtml(item.label)}</strong><span>${item.dueAt ? `Due ${escapeHtml(portalDate(item.dueAt))}` : "Scheduling pending"}</span></div><b data-status="${escapeAttr(item.status)}">${escapeHtml(conditionLabel(item.status))}</b></header>
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        ${(item.proofUrl || item.proofNotes) ? `<div class="partner-deliverable-proof"><span>Delivery proof · version ${item.proofVersion}</span>${item.proofUrl ? `<a href="${escapeAttr(item.proofUrl)}" target="_blank" rel="noopener noreferrer">View proof</a>` : ""}${item.proofNotes ? `<p>${escapeHtml(item.proofNotes)}</p>` : ""}</div>` : ""}
        <div class="partner-deliverable-review" data-status="${escapeAttr(item.partnerReviewStatus)}">
          <span>Partner review: ${escapeHtml(conditionLabel(item.partnerReviewStatus))}</span>
          ${item.partnerReviewNotes ? `<p>${escapeHtml(item.partnerReviewNotes)}</p>` : ""}
          ${item.partnerReviewStatus === "pending" ? `<textarea name="reviewNotes" rows="2" maxlength="1000" placeholder="Notes required when requesting changes"></textarea><div><button type="button" class="button primary" data-deliverable-review="approve">Approve proof</button><button type="button" class="button secondary" data-deliverable-review="request_changes">Request changes</button></div>` : ""}
        </div>
      </article>`).join("") || '<span class="empty-state">Package benefits will appear after tier review.</span>'}</div>
    </div>
  </section>`;
}

function vendorPowerOptions(selected = "none") {
  return [["none", "No power"], ["15a", "15 amp"], ["20a", "20 amp"], ["30a", "30 amp"], ["50a", "50 amp"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function vendorCookingOptions(selected = "none") {
  return [["none", "No cooking"], ["electric", "Electric"], ["propane", "Propane"], ["other", "Other"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderVendorOnboarding(onboarding) {
  if (!onboarding) return "";
  const profile = onboarding.profile || {};
  const requirements = Array.isArray(onboarding.requirements) ? onboarding.requirements : [];
  const assignment = onboarding.assignment || {};
  const approved = requirements.filter(item => ["approved", "waived"].includes(item.status)).length;
  return `<section class="partner-vendor-center">
    <header class="partner-brand-heading"><div><span>Vendor onboarding</span><h4>Beach marketplace readiness</h4></div><b>${approved} / ${requirements.length} requirements cleared</b></header>
    <form id="partner-vendor-profile-form" class="partner-brand-form partner-vendor-profile-form">
      <div class="partner-brand-form-heading"><strong>Operating profile</strong><span data-status="${escapeAttr(profile.status || "draft")}">${escapeHtml(conditionLabel(profile.status || "draft"))}</span></div>
      ${profile.reviewNotes ? `<p class="partner-brand-review-note">${escapeHtml(profile.reviewNotes)}</p>` : ""}
      <div class="partner-brand-fields partner-vendor-fields">
        <label><span>Legal business name</span><input name="legalName" required maxlength="160" value="${escapeAttr(profile.legalName || activePartnerPortalApplication?.organizationName || "")}" /></label>
        <label><span>Public booth name</span><input name="boothName" required maxlength="160" value="${escapeAttr(profile.boothName || activePartnerPortalApplication?.organizationName || "")}" /></label>
        <label><span>Website</span><input name="website" type="url" maxlength="1000" placeholder="https://" value="${escapeAttr(profile.website || "")}" /></label>
        <label><span>Power</span><select name="powerNeed">${vendorPowerOptions(profile.powerNeed)}</select></label>
        <label><span>Cooking</span><select name="cookingMethod">${vendorCookingOptions(profile.cookingMethod)}</select></label>
        <label><span>Vehicle/trailer length</span><input name="vehicleLengthFeet" type="number" min="0" max="80" step="0.5" value="${escapeAttr(profile.vehicleLengthFeet ?? "")}" /></label>
        <label><span>Emergency contact</span><input name="emergencyContactName" required maxlength="120" value="${escapeAttr(profile.emergencyContactName || "")}" /></label>
        <label><span>Emergency phone</span><input name="emergencyContactPhone" required type="tel" maxlength="40" value="${escapeAttr(profile.emergencyContactPhone || "")}" /></label>
        <label class="partner-vendor-check"><input name="waterRequired" type="checkbox" ${profile.waterRequired ? "checked" : ""} /><span>Water connection required</span></label>
        <label class="partner-brand-wide"><span>Public products or services</span><textarea name="publicDescription" required rows="3" maxlength="2000">${escapeHtml(profile.publicDescription || "")}</textarea></label>
        <label class="partner-brand-wide"><span>Accessibility needs</span><textarea name="accessibilityNotes" rows="2" maxlength="1000">${escapeHtml(profile.accessibilityNotes || "")}</textarea></label>
        <label class="partner-brand-wide"><span>Operational notes</span><textarea name="operationalNotes" rows="3" maxlength="2000">${escapeHtml(profile.operationalNotes || "")}</textarea></label>
      </div>
      <button class="button primary" type="submit">Submit operating profile</button>
      <p class="partner-form-status partner-vendor-status" aria-live="polite"></p>
    </form>
    <div class="partner-vendor-assignment" data-status="${escapeAttr(assignment.status || "unassigned")}">
      <header><div><strong>Booth and load-in</strong><span>${escapeHtml(conditionLabel(assignment.status || "unassigned"))}</span></div>${assignment.boothNumber ? `<b>${escapeHtml(assignment.boothNumber)}</b>` : ""}</header>
      ${assignment.boothNumber ? `<dl><div><dt>Zone</dt><dd>${escapeHtml(assignment.zone || "Assigned on map")}</dd></div><div><dt>Access gate</dt><dd>${escapeHtml(assignment.accessGate || "See instructions")}</dd></div><div><dt>Load-in</dt><dd>${escapeHtml(new Date(assignment.loadInStart).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))} - ${escapeHtml(new Date(assignment.loadInEnd).toLocaleTimeString([], { timeStyle: "short" }))}</dd></div><div><dt>Passes</dt><dd>${assignment.parkingPasses} parking · ${assignment.staffWristbands} staff</dd></div></dl>${assignment.instructions ? `<p>${escapeHtml(assignment.instructions)}</p>` : ""}` : '<p class="empty-state">Booth and load-in details will appear after staff review.</p>'}
      ${assignment.status === "scheduled" ? '<button type="button" class="button primary" id="partner-confirm-vendor-assignment">Confirm assignment</button>' : ""}
    </div>
    <div class="partner-vendor-requirements"><strong>Compliance checklist</strong><div>${requirements.map(item => `<article data-vendor-requirement="${escapeAttr(item.id)}">
      <header><div><strong>${escapeHtml(item.label)}</strong><span>${item.dueAt ? `Due ${escapeHtml(portalDate(item.dueAt))}` : "Required before load-in"}</span></div><b data-status="${escapeAttr(item.status)}">${escapeHtml(conditionLabel(item.status))}</b></header>
      ${item.reviewNotes ? `<p class="partner-brand-review-note">${escapeHtml(item.reviewNotes)}</p>` : ""}
      ${item.document ? `<div class="partner-vendor-document"><span>${escapeHtml(item.document.label)}${item.document.fileName ? ` · ${escapeHtml(item.document.fileName)}` : ""}</span>${item.document.sourceType === "upload" ? `<button type="button" class="button secondary" data-download-vendor-document="${escapeAttr(item.document.id)}" data-file-name="${escapeAttr(item.document.fileName || item.document.label)}">Download</button>` : `<a class="button secondary" href="${escapeAttr(item.document.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open document</a>`}</div>` : ""}
      ${["missing", "changes_requested", "expired"].includes(item.status) ? `<form class="partner-vendor-document-form" data-submit-vendor-document="${escapeAttr(item.id)}">
        <label><span>Private file</span><input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" /></label>
        <label><span>Or secure document URL</span><input name="sourceUrl" type="url" maxlength="1000" placeholder="https://" /></label>
        <button class="button primary" type="submit">Submit document</button>
        <p class="partner-form-status" aria-live="polite"></p>
      </form>` : ""}
    </article>`).join("") || '<span class="empty-state">Requirements will appear after application review.</span>'}</div></div>
  </section>`;
}

function renderPartnerPortalStatus(application) {
  const result = document.querySelector("#partner-status-result");
  if (!result) return;
  activePartnerPortalApplication = application;
  const finance = application.finance || {};
  const invoice = finance.invoice || null;
  const onlinePayment = finance.onlinePayment || {};
  const canPayOnline = invoice && invoice.balanceCents > 0 && ["approved", "queued", "synced", "failed"].includes(invoice.status) && onlinePayment.ready;
  const checkoutAction = finance.checkout?.checkoutUrl
    ? `<a class="button primary" href="${escapeAttr(finance.checkout.checkoutUrl)}" rel="noopener noreferrer">Resume secure payment</a>`
    : canPayOnline
      ? `<button class="button primary" type="button" data-partner-pay-invoice="${escapeAttr(invoice.id)}">Pay securely</button>`
      : "";
  const milestones = Array.isArray(application.milestones) ? application.milestones : [];
  const nextStep = application.nextStep;
  const isVendorInterest = application.type === "vendor" && application.intakeMode === "interest";
  result.innerHTML = `
    <header class="partner-status-heading">
      <div><span>${escapeHtml(isVendorInterest ? "Vendor interest" : application.type === "vendor" ? "Vendor application" : "Sponsorship inquiry")}</span><h3>${escapeHtml(application.organizationName)}</h3></div>
      <b data-status="${escapeAttr(application.status)}">${escapeHtml(conditionLabel(application.status))}</b>
    </header>
    <p class="partner-status-reference">${escapeHtml(application.reference)}${application.offeringName ? ` · ${escapeHtml(application.offeringName)}` : ""} · Submitted ${escapeHtml(portalDate(application.submittedAt))}</p>
    ${isVendorInterest ? '<div class="partner-status-interest"><strong>No fee or booth assignment is attached to this interest.</strong><span>The SandFest team will contact you when applications open or more information is available.</span></div>' : `<div class="partner-status-kpis">
      <article><span>Payment status</span><strong>${escapeHtml(conditionLabel(finance.paymentStatus || "pending_review"))}</strong></article>
      <article><span>Amount expected</span><strong>${finance.expectedAmountCents > 0 ? escapeHtml(adminMoney(finance.expectedAmountCents)) : "Pending review"}</strong></article>
      <article><span>Paid</span><strong>${escapeHtml(adminMoney(finance.paidAmountCents, "$0.00"))}</strong></article>
      <article><span>Balance</span><strong>${escapeHtml(adminMoney(finance.balanceCents, "$0.00"))}</strong></article>
    </div>`}
    <div class="partner-status-next">
      <span>Next step</span>
      <strong>${escapeHtml(nextStep?.label || "SandFest team review")}</strong>
      <small>${nextStep?.dueAt ? `Target ${escapeHtml(portalDate(nextStep.dueAt))}` : "We will add the next target date after review."}</small>
    </div>
    ${invoice ? `<div class="partner-status-invoice"><div><span>Invoice</span><strong>${escapeHtml(conditionLabel(invoice.status))}</strong><small>${escapeHtml(adminMoney(invoice.balanceCents, "$0.00"))} open${invoice.dueAt ? ` · due ${escapeHtml(portalDate(invoice.dueAt))}` : ""}</small></div>${checkoutAction}<p class="partner-payment-status" aria-live="polite"></p></div>` : ""}
    <div class="partner-status-milestones">
      <strong>Key dates</strong>
      <div>${milestones.map(item => `<article data-status="${escapeAttr(item.status)}"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(conditionLabel(item.status))}</b><small>${escapeHtml(portalDate(item.dueAt))}</small></article>`).join("") || "<span>Dates will appear after review.</span>"}</div>
    </div>
    ${renderPartnerBranding(application.branding)}
    ${renderVendorOnboarding(application.vendorOnboarding)}`;
  bindPartnerBrandPreview();
  bindPartnerBrandingActions();
  bindVendorOnboardingActions();
  bindPartnerPaymentActions();
}

async function partnerPortalJson(endpoint, payload) {
  if (!activePartnerPortalAccess) throw new Error("Open the private partner link again before making changes.");
  const response = await fetchWithTimeout(`${publicApiBase()}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...activePartnerPortalAccess, ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Partner update failed with ${response.status}`);
  return data;
}

function bindPartnerPaymentActions() {
  const button = document.querySelector("[data-partner-pay-invoice]");
  if (!button) return;
  button.addEventListener("click", async () => {
    const status = document.querySelector(".partner-payment-status");
    button.disabled = true;
    status.dataset.state = "loading";
    status.textContent = "Preparing secure payment...";
    try {
      const data = await partnerPortalJson("/api/public/partner-payment-checkout", {
        invoiceId: button.dataset.partnerPayInvoice
      });
      const checkoutUrl = new URL(data.checkout?.checkoutUrl);
      if (checkoutUrl.protocol !== "https:") throw new Error("Stripe returned an invalid payment address.");
      status.dataset.state = "ok";
      status.textContent = "Opening Stripe...";
      window.location.assign(checkoutUrl.toString());
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
      button.disabled = false;
    }
  });
}

function bindPartnerBrandingActions() {
  const profileForm = document.querySelector("#partner-brand-profile-form");
  profileForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = profileForm.querySelector('button[type="submit"]');
    const status = profileForm.querySelector(".partner-brand-status");
    button.disabled = true;
    status.dataset.state = "loading";
    status.textContent = "Submitting profile...";
    try {
      const values = Object.fromEntries(new FormData(profileForm).entries());
      const data = await partnerPortalJson("/api/public/partner-brand-profile", { profile: values });
      renderPartnerPortalStatus(data.application);
      document.querySelector("#partner-status-form .partner-form-status").textContent = "Brand profile submitted for review.";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const assetForm = document.querySelector("#partner-brand-asset-form");
  assetForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = assetForm.querySelector('button[type="submit"]');
    const status = assetForm.querySelector(".partner-brand-status");
    const file = assetForm.elements.file.files?.[0];
    const sourceUrl = assetForm.elements.sourceUrl.value.trim();
    if (file && sourceUrl) {
      status.dataset.state = "error";
      status.textContent = "Choose either a private file or an asset URL.";
      return;
    }
    if (!file && !sourceUrl) {
      status.dataset.state = "error";
      status.textContent = "Choose a file or enter a secure asset URL.";
      return;
    }
    button.disabled = true;
    status.dataset.state = "loading";
    status.textContent = file ? "Uploading private asset..." : "Submitting asset...";
    try {
      if (file) {
        if (!activePartnerPortalAccess) throw new Error("Open the private partner link again before uploading.");
        const response = await fetchWithTimeout(`${publicApiBase()}/api/public/partner-brand-assets/upload`, {
          method: "POST",
          headers: {
            "content-type": file.type,
            "x-partner-reference": activePartnerPortalAccess.reference,
            "x-partner-token": activePartnerPortalAccess.token,
            "x-file-name": file.name.replace(/[^\x20-\x7E]/g, "-").slice(0, 180),
            "x-asset-kind": assetForm.elements.kind.value,
            "x-asset-label": assetForm.elements.label.value.trim()
          },
          body: file
        }, 60_000);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Asset upload failed with ${response.status}`);
      } else {
        await partnerPortalJson("/api/public/partner-brand-assets", {
          asset: { kind: assetForm.elements.kind.value, label: assetForm.elements.label.value.trim(), sourceUrl }
        });
      }
      await loadPartnerPortalStatus(activePartnerPortalAccess);
      document.querySelector("#partner-status-form .partner-form-status").textContent = "Brand asset submitted for review.";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-download-brand-asset]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!activePartnerPortalAccess) throw new Error("Open the private partner link again before downloading.");
      const response = await fetchWithTimeout(`${publicApiBase()}/api/public/partner-brand-assets/${encodeURIComponent(button.dataset.downloadBrandAsset)}/content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activePartnerPortalAccess)
      }, 60_000);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Asset download failed with ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = button.dataset.fileName || "brand-asset";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const status = document.querySelector("#partner-status-form .partner-form-status");
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }));

  document.querySelectorAll("[data-deliverable-review]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-partner-deliverable]");
    const notes = card.querySelector('[name="reviewNotes"]')?.value.trim() || "";
    button.disabled = true;
    try {
      const data = await partnerPortalJson(`/api/public/partner-deliverables/${encodeURIComponent(card.dataset.partnerDeliverable)}/review`, {
        action: button.dataset.deliverableReview,
        notes
      });
      renderPartnerPortalStatus(data.application);
      document.querySelector("#partner-status-form .partner-form-status").textContent = button.dataset.deliverableReview === "approve" ? "Delivery proof approved." : "Requested changes sent to the SandFest team.";
    } catch (error) {
      const status = document.querySelector("#partner-status-form .partner-form-status");
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }));
}

function bindVendorOnboardingActions() {
  const profileForm = document.querySelector("#partner-vendor-profile-form");
  profileForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = profileForm.querySelector('button[type="submit"]');
    const status = profileForm.querySelector(".partner-vendor-status");
    const values = Object.fromEntries(new FormData(profileForm).entries());
    values.waterRequired = profileForm.elements.waterRequired.checked;
    button.disabled = true;
    status.dataset.state = "loading";
    status.textContent = "Submitting operating profile...";
    try {
      const data = await partnerPortalJson("/api/public/partner-vendor-profile", { profile: values });
      renderPartnerPortalStatus(data.application);
      document.querySelector("#partner-status-form .partner-form-status").textContent = "Operating profile submitted for review.";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-submit-vendor-document]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".partner-form-status");
    const file = form.elements.file.files?.[0];
    const sourceUrl = form.elements.sourceUrl.value.trim();
    if (Boolean(file) === Boolean(sourceUrl)) {
      status.dataset.state = "error";
      status.textContent = file ? "Choose either a private file or a secure document URL." : "Choose a private file or enter a secure document URL.";
      return;
    }
    const requirementId = form.dataset.submitVendorDocument;
    const requirementLabel = form.closest("[data-vendor-requirement]")?.querySelector("header strong")?.textContent || "Vendor document";
    button.disabled = true;
    status.dataset.state = "loading";
    status.textContent = file ? "Uploading private document..." : "Submitting document...";
    try {
      let data;
      if (file) {
        if (!activePartnerPortalAccess) throw new Error("Open the private partner link again before uploading.");
        const response = await fetchWithTimeout(`${publicApiBase()}/api/public/partner-vendor-documents/upload`, {
          method: "POST",
          headers: {
            "content-type": file.type,
            "x-partner-reference": activePartnerPortalAccess.reference,
            "x-partner-token": activePartnerPortalAccess.token,
            "x-requirement-id": requirementId,
            "x-file-name": file.name.replace(/[^\x20-\x7E]/g, "-").slice(0, 180),
            "x-document-label": requirementLabel
          },
          body: file
        }, 60_000);
        data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Document upload failed with ${response.status}`);
      } else {
        data = await partnerPortalJson("/api/public/partner-vendor-documents", {
          requirementId,
          document: { requirementId, label: requirementLabel, sourceUrl }
        });
      }
      renderPartnerPortalStatus(data.application);
      document.querySelector("#partner-status-form .partner-form-status").textContent = "Vendor document submitted for staff review.";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }));

  document.querySelectorAll("[data-download-vendor-document]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!activePartnerPortalAccess) throw new Error("Open the private partner link again before downloading.");
      const response = await fetchWithTimeout(`${publicApiBase()}/api/public/partner-vendor-documents/${encodeURIComponent(button.dataset.downloadVendorDocument)}/content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activePartnerPortalAccess)
      }, 60_000);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Document download failed with ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = button.dataset.fileName || "vendor-document";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const status = document.querySelector("#partner-status-form .partner-form-status");
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }));

  document.querySelector("#partner-confirm-vendor-assignment")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const data = await partnerPortalJson("/api/public/partner-vendor-assignment/confirm", {});
      renderPartnerPortalStatus(data.application);
      document.querySelector("#partner-status-form .partner-form-status").textContent = "Booth and load-in assignment confirmed.";
    } catch (error) {
      const status = document.querySelector("#partner-status-form .partner-form-status");
      status.dataset.state = "error";
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function loadPartnerPortalStatus(access, options = {}) {
  const form = document.querySelector("#partner-status-form");
  if (!form || !access?.reference || !access?.token) return;
  const status = form.querySelector(".partner-form-status");
  const button = form.querySelector('button[type="submit"]');
  const forgetButton = document.querySelector("#partner-status-forget");
  const result = document.querySelector("#partner-status-result");
  const loadVersion = ++partnerPortalLoadVersion;
  const switchingAccess = Boolean(activePartnerPortalAccess)
    && (activePartnerPortalAccess.reference !== access.reference || activePartnerPortalAccess.token !== access.token);
  activePartnerPortalAccess = access;
  if (switchingAccess) {
    activePartnerPortalApplication = null;
    if (result) result.innerHTML = '<div class="partner-status-empty"><strong>Opening another application.</strong><span>Verifying this private access before showing partner details.</span></div>';
  }
  form.elements.reference.value = access.reference;
  form.elements.token.value = access.token;
  concealPartnerPortalCapability();
  setFormStatus(status, "Loading application...", "loading");
  button.disabled = true;
  let responseStatus = 0;
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/partner-status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: access.reference, token: access.token })
    });
    responseStatus = response.status;
    const data = await response.json().catch(() => ({}));
    if (loadVersion !== partnerPortalLoadVersion) return;
    if (!response.ok) {
      const statusError = new Error(data.error || `Status lookup failed with ${response.status}`);
      statusError.status = response.status;
      throw statusError;
    }
    rememberPartnerPortalAccess(access);
    renderPartnerPortalStatus(data.application);
    if (forgetButton) forgetButton.hidden = false;
    setFormStatus(status, `Secure status loaded for ${data.application.reference}.`, "ok");
    if (options.scroll) {
      if (window.location.hash !== "#partner-status") window.location.hash = "partner-status";
      stabilizeRenderedHashTarget({
        behavior: options.scrollBehavior === "auto" ? "instant" : "smooth"
      });
      result?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (loadVersion !== partnerPortalLoadVersion) return;
    const accessRejected = shouldForgetPartnerPortalAccess(responseStatus);
    if (accessRejected) {
      activePartnerPortalAccess = null;
      activePartnerPortalApplication = null;
      forgetPartnerPortalAccess(access, form);
      if (forgetButton) forgetButton.hidden = true;
      setFormStatus(status, friendlyRequestError(error, "This private access link is no longer valid."), "error");
      if (result) result.innerHTML = '<div class="partner-status-empty"><strong>We could not open this application.</strong><span>Check the private link or ask the SandFest team to issue a new one.</span></div>';
    } else {
      rememberPartnerPortalAccess(access);
      if (forgetButton) forgetButton.hidden = false;
      setFormStatus(status, "SandFest status is temporarily unavailable. Your private access is still saved; try again.", "error");
      if (result && !activePartnerPortalApplication) {
        result.innerHTML = '<div class="partner-status-empty"><strong>Status is temporarily unavailable.</strong><span>Your private access is still saved in this browser. Try again when the connection recovers.</span></div>';
      }
    }
  } finally {
    if (loadVersion === partnerPortalLoadVersion) button.disabled = false;
  }
}

async function submitPartnerForm(form, endpoint) {
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".partner-form-status");
  if (TURNSTILE_SITE_KEY && !partnerBotProtection.enabled) await initPartnerBotProtection();
  if (TURNSTILE_SITE_KEY && !partnerBotProtection.tokenFor(form)) {
    setFormStatus(status, "Complete the security check and try again.", "error");
    return;
  }
  const fallbackKey = () => `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  const idempotencyKey = form.dataset.idempotencyKey || globalThis.crypto?.randomUUID?.() || fallbackKey();
  form.dataset.idempotencyKey = idempotencyKey;
  button.disabled = true;
  setFormStatus(status, "Submitting...", "loading");
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(formPayload(form))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const submissionError = new Error(data.error || `Submission failed with ${response.status}`);
      submissionError.status = response.status;
      submissionError.retryAfter = response.headers.get("retry-after");
      throw submissionError;
    }
    const isVendorInterest = data.application.type === "vendor" && data.application.intakeMode === "interest";
    const submissionLabel = isVendorInterest ? "Interest" : "Application";
    setFormStatus(
      status,
      `<strong>${data.duplicate ? `${submissionLabel} already received.` : `${submissionLabel} received.`}</strong> Reference ${escapeHtml(data.application.reference)}. ${escapeHtml(data.nextStep)}`,
      "ok",
      { html: true }
    );
    const portalAccess = { reference: data.application.reference, token: data.portalAccess?.token };
    if (portalAccess.token) {
      rememberPartnerPortalAccess(portalAccess);
      await loadPartnerPortalStatus(portalAccess, { scroll: true });
    }
    clearSponsorInvitationForm(form);
    delete form.dataset.idempotencyKey;
    form.reset();
    if (form.id === "vendor-application-form") {
      form.elements.state.value = "TX";
      renderVendorOfferingChoices();
    } else if (form.id === "sponsor-inquiry-form") {
      renderSponsorPackageChoices();
    }
    partnerBotProtection.reset(form);
  } catch (error) {
    if ([400, 401, 403, 409, 422].includes(error.status)) delete form.dataset.idempotencyKey;
    const message = error.status === 409
      ? "These submission details changed after an earlier attempt. Review them and submit once more."
      : error.status === 429
        ? `Too many attempts. Wait${error.retryAfter ? ` ${error.retryAfter} seconds` : " a moment"} and try again; your entries are still here.`
        : !error.status
          ? `${friendlyRequestError(error)} Your entries are still here, and retry protection remains active.`
          : error.message;
    setFormStatus(status, message, "error");
    partnerBotProtection.reset(form);
  } finally {
    button.disabled = false;
  }
}

async function submitPartnerPortalRecovery(form) {
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".partner-form-status");
  if (TURNSTILE_SITE_KEY && !partnerBotProtection.enabled) await initPartnerBotProtection();
  if (TURNSTILE_SITE_KEY && !partnerBotProtection.tokenFor(form)) {
    setFormStatus(status, "Complete the security check and try again.", "error");
    return;
  }
  const fallbackKey = () => `recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const idempotencyKey = form.dataset.idempotencyKey || globalThis.crypto?.randomUUID?.() || fallbackKey();
  form.dataset.idempotencyKey = idempotencyKey;
  button.disabled = true;
  setFormStatus(status, "Requesting access...", "loading");
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/partner-portal-recovery`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(formPayload(form))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(data.error || `Access request failed with ${response.status}`);
      requestError.status = response.status;
      requestError.retryAfter = response.headers.get("retry-after");
      throw requestError;
    }
    setFormStatus(status, data.message || "If the reference and email match an application, a private access link will be sent shortly.", "ok");
    delete form.dataset.idempotencyKey;
    form.elements.contactEmail.value = "";
    partnerBotProtection.reset(form);
  } catch (error) {
    if ([400, 401, 403, 422].includes(error.status)) delete form.dataset.idempotencyKey;
    const message = error.status === 429
      ? `Too many attempts. Wait${error.retryAfter ? ` ${error.retryAfter} seconds` : " a moment"} and try again.`
      : friendlyRequestError(error, "Private access email is temporarily unavailable. Try again shortly.");
    setFormStatus(status, message, "error");
    partnerBotProtection.reset(form);
  } finally {
    button.disabled = false;
  }
}

function sponsorPackageOptions(packages = publicSponsorPackages, selectedId = "") {
  return packages.map((item, index) => `<option value="${escapeAttr(item.id)}" ${(selectedId ? item.id === selectedId : index === 0) ? "selected" : ""}>${escapeHtml(item.name)} - ${escapeHtml(item.publicLabel || adminMoney(item.amount))}</option>`).join("");
}

function sponsorPackageCardSummary(sponsorPackage) {
  const benefits = Array.isArray(sponsorPackage?.benefits) ? sponsorPackage.benefits.filter(Boolean) : [];
  const visible = benefits.slice(0, 3);
  const remaining = Math.max(0, benefits.length - visible.length);
  return `${visible.join(" · ")}${remaining ? ` · ${remaining} more benefit${remaining === 1 ? "" : "s"}` : ""}`;
}

function sponsorPackageCards(packages = publicSponsorPackages, selectedId = "") {
  return packages.map((item, index) => `
    <button type="button" data-package-id="${escapeAttr(item.id)}" class="partner-tier ${(selectedId ? item.id === selectedId : index === 0) ? "is-selected" : ""}" aria-controls="sponsor-inquiry-form" aria-pressed="${(selectedId ? item.id === selectedId : index === 0) ? "true" : "false"}">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.publicLabel || adminMoney(item.amount))}</span>
      <p>${escapeHtml(sponsorPackageCardSummary(item))}</p>
      <small data-package-action>${(selectedId ? item.id === selectedId : index === 0) ? "Selected" : "Choose tier"}</small>
    </button>
  `).join("");
}

function renderSponsorPackageSummary() {
  const form = document.querySelector("#sponsor-inquiry-form");
  const summary = document.querySelector("#sponsor-package-summary");
  if (!form || !summary) return;
  const selected = publicSponsorPackages.find(item => item.id === form.elements.packageId.value);
  summary.textContent = selected
    ? `${selected.publicLabel || adminMoney(selected.amount)}. Includes ${selected.benefits.join("; ")}. Final availability is confirmed during SandFest review.`
    : "No active sponsorship package is currently available.";
  summary.dataset.state = selected ? "ready" : "unavailable";
  document.querySelectorAll("[data-package-id]").forEach(item => {
    const isSelected = item.dataset.packageId === selected?.id;
    item.classList.toggle("is-selected", isSelected);
    item.setAttribute("aria-pressed", String(isSelected));
    const action = item.querySelector("[data-package-action]");
    if (action) action.textContent = isSelected ? "Selected" : "Choose tier";
  });
}

function renderSponsorPackageChoices(selectedId = "") {
  const tiers = document.querySelector("#public-sponsor-tiers");
  const form = document.querySelector("#sponsor-inquiry-form");
  if (!form) return;
  const select = form.elements.packageId;
  const preferredId = selectedId || select.value;
  const selected = publicSponsorPackages.find(item => item.id === preferredId) || publicSponsorPackages[0];
  select.innerHTML = sponsorPackageOptions(publicSponsorPackages, selected?.id || "");
  select.disabled = !publicSponsorPackages.length || Boolean(activeSponsorInvitationToken);
  if (tiers) tiers.innerHTML = sponsorPackageCards(publicSponsorPackages, selected?.id || "");
  bindSponsorTierButtons();
  renderSponsorPackageSummary();
}

function bindSponsorTierButtons() {
  document.querySelectorAll("[data-package-id]").forEach(button => button.addEventListener("click", () => {
    const form = document.querySelector("#sponsor-inquiry-form");
    if (form && !form.elements.packageId.disabled) {
      form.elements.packageId.value = button.dataset.packageId;
      renderSponsorPackageSummary();
      if (window.location.hash !== "#sponsor-inquiry-form") window.location.hash = "sponsor-inquiry-form";
      else form.scrollIntoView({ behavior: "smooth", block: "start" });
      form.elements.packageId.focus({ preventScroll: true });
    }
  }));
}

function bindSponsorPackageChoices() {
  const form = document.querySelector("#sponsor-inquiry-form");
  if (!form) return;
  form.elements.packageId.addEventListener("change", renderSponsorPackageSummary);
  renderSponsorPackageSummary();
}

function sponsorShowcaseInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "TSF";
}

function sponsorShowcaseWebsite(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

const PUBLIC_SPONSOR_ASSET_PATH = "/api/public/sponsor-showcase/assets/";

function renderPublicSponsorShowcase(items = []) {
  const showcase = document.querySelector("#public-sponsor-showcase");
  if (!showcase) return;
  const sponsors = (Array.isArray(items) ? items : []).filter(item => item?.displayName);
  showcase.hidden = sponsors.length === 0;
  showcase.innerHTML = sponsors.map(item => {
    const website = sponsorShowcaseWebsite(item.website);
    const primary = /^#[0-9A-F]{6}$/i.test(item.primaryColor || "") ? item.primaryColor : "#12333A";
    const secondary = /^#[0-9A-F]{6}$/i.test(item.secondaryColor || "") ? item.secondaryColor : "#F4B942";
    const candidateLogoPath = String(item.logo?.path || "");
    const logoAssetId = candidateLogoPath.startsWith(PUBLIC_SPONSOR_ASSET_PATH)
      ? candidateLogoPath.slice(PUBLIC_SPONSOR_ASSET_PATH.length)
      : "";
    const logoPath = /^[A-Za-z0-9._~-]+$/.test(logoAssetId)
      ? `${PUBLIC_SPONSOR_ASSET_PATH}${logoAssetId}`
      : "";
    const logo = logoPath
      ? `<img src="${escapeAttr(`${publicApiBase()}${logoPath}`)}" alt="${escapeAttr(item.logo?.label || `${item.displayName} logo`)}" loading="lazy" decoding="async" />`
      : `<span aria-hidden="true">${escapeHtml(sponsorShowcaseInitials(item.displayName))}</span>`;
    const content = `<span class="public-sponsor-mark">${logo}</span>
      <span class="public-sponsor-copy">
        ${item.packageName ? `<small>${escapeHtml(item.packageName)} partner</small>` : ""}
        <strong>${escapeHtml(item.displayName)}</strong>
        ${item.tagline ? `<span>${escapeHtml(item.tagline)}</span>` : ""}
      </span>`;
    const style = `--sponsor-primary:${primary};--sponsor-secondary:${secondary}`;
    return website
      ? `<a class="public-sponsor-card" href="${escapeAttr(website)}" target="_blank" rel="noopener noreferrer" style="${escapeAttr(style)}">${content}</a>`
      : `<article class="public-sponsor-card" style="${escapeAttr(style)}">${content}</article>`;
  }).join("");
}

async function loadPublicSponsorPackages() {
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/sponsors`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    renderPublicSponsorShowcase(data.sponsors);
    if (!Array.isArray(data.sponsorPackages) || !data.sponsorPackages.length) return;
    publicSponsorPackages = data.sponsorPackages.map(publicSponsorPackage);
    renderSponsorPackageChoices();
  } catch {
    // Static launch-safe tiers remain available when the API is offline.
  }
}

function vendorOfferingOptionsForCategory(category, selectedId = "") {
  const eligible = publicVendorOfferings.filter(item => item.categories?.includes(category));
  return eligible.length
    ? eligible.map((item, index) => `<option value="${escapeAttr(item.id)}" ${(selectedId ? item.id === selectedId : index === 0) ? "selected" : ""}>${escapeHtml(item.intakeMode === "interest" ? item.name : `${item.name} - ${item.publicLabel || adminMoney(item.amount)}`)}</option>`).join("")
    : '<option value="">No offering is currently available</option>';
}

function renderVendorIntakeMode(offering) {
  const isInterest = !offering || offering.intakeMode === "interest";
  const notice = partnerContactNotice("vendor", isInterest ? "interest" : "application");
  const label = document.querySelector("#vendor-intake-label");
  const heading = document.querySelector("#vendor-intake-heading");
  const availability = document.querySelector("#vendor-intake-availability");
  const disclosure = document.querySelector("#vendor-data-use-note");
  const consent = document.querySelector("#vendor-consent-label");
  const submit = document.querySelector("#vendor-intake-submit");
  const cta = document.querySelector("#vendor-intake-cta");
  if (label) label.textContent = isInterest ? "Vendor interest" : "Vendor application";
  if (heading) heading.textContent = isInterest ? "Join the vendor interest list" : "Apply for the beach marketplace";
  if (availability) {
    availability.innerHTML = isInterest
      ? 'Vendor applications are not currently open. Join the interest list and review updates on the <a href="https://www.texassandfest.org/vendors" target="_blank" rel="noopener noreferrer">official vendor page</a>.'
      : 'Applications are open for this program. Fees and placement remain subject to approval; review updates on the <a href="https://www.texassandfest.org/vendors" target="_blank" rel="noopener noreferrer">official vendor page</a>.';
  }
  if (disclosure) disclosure.textContent = notice.disclosure;
  if (consent) consent.textContent = notice.checkboxLabel;
  if (submit) submit.textContent = isInterest ? "Submit vendor interest" : "Submit vendor application";
  if (cta) cta.textContent = isInterest ? "Join vendor interest list" : "Apply as a vendor";
}

function renderVendorOfferingChoices() {
  const form = document.querySelector("#vendor-application-form");
  if (!form) return;
  const category = form.elements.category.value;
  const select = form.elements.vendorOfferingId;
  const previous = select.value;
  select.innerHTML = vendorOfferingOptionsForCategory(category, previous);
  const eligible = publicVendorOfferings.filter(item => item.categories?.includes(category));
  select.disabled = eligible.length === 0;
  const selected = eligible.find(item => item.id === select.value) || eligible[0];
  const summary = document.querySelector("#vendor-offering-summary");
  if (summary) {
    summary.textContent = selected
      ? `${selected.publicLabel || adminMoney(selected.amount)}. ${selected.description}${selected.inclusions?.length ? ` Includes ${selected.inclusions.join(", ").toLowerCase()}.` : ""}`
      : "No active offering is available for this vendor type.";
    summary.dataset.state = selected ? "ready" : "unavailable";
  }
  renderVendorIntakeMode(selected);
}

function bindVendorOfferingChoices() {
  const form = document.querySelector("#vendor-application-form");
  if (!form) return;
  form.elements.category.addEventListener("change", renderVendorOfferingChoices);
  form.elements.vendorOfferingId.addEventListener("change", renderVendorOfferingChoices);
  renderVendorOfferingChoices();
}

async function loadPublicVendorOfferings() {
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/vendors`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.vendorOfferings) || !data.vendorOfferings.length) return;
    publicVendorOfferings = data.vendorOfferings;
    renderVendorOfferingChoices();
  } catch {
    // Static launch-safe offerings remain visible when the API is offline.
  }
}

function conditionLabel(value) {
  return String(value || "unknown").replace(/[-_]/g, " ");
}

function isBoardConditionSimulation(payload) {
  return payload?.weather?.source === "Board weather simulation"
    && payload?.ferry?.source === "Board ferry simulation";
}

function renderIslandConditions(payload) {
  const kpis = document.querySelector("#island-condition-kpis");
  const grid = document.querySelector("#island-camera-grid");
  const updated = document.querySelector("#island-condition-updated");
  if (!kpis || !grid) return;
  const weather = payload.weather || {};
  const ferry = payload.ferry || {};
  const syntheticWeather = weather.source === "Board weather simulation";
  const syntheticFerry = ferry.source === "Board ferry simulation";
  const syntheticConditions = isBoardConditionSimulation(payload);
  const ferryDirections = Array.isArray(ferry.directions) ? ferry.directions : [];
  const ferryLive = ferry.freshness?.state === "live";
  const ferryHasInterruption = ferryLive && (ferry.status === "service_interruption" || ferryDirections.some(direction => direction.status === "service_interruption"));
  const ferryPrimary = !ferryLive
    ? "Awaiting update"
    : ferryHasInterruption
    ? "Service alert"
    : ferry.estimatedWaitMinutes != null
      ? `${ferry.estimatedWaitMinutes} min max`
      : "Awaiting update";
  const ferryDirectionSummary = !ferryLive
    ? "Current directional waits unavailable"
    : ferryDirections.length
    ? ferryDirections.map(direction => `${direction.label}: ${direction.estimatedWaitMinutes != null ? `${direction.estimatedWaitMinutes} min` : direction.status === "service_interruption" ? "service interruption" : "unavailable"}`).join(" · ")
    : ferry.operatingFerries != null ? `${ferry.operatingFerries} ferries operating` : "Port Aransas route";
  const ferrySource = ferry.sourceUrl
    ? `<a href="${escapeAttr(ferry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ferry.source || "TxDOT official feed")}</a>`
    : escapeHtml(ferry.source || "TxDOT");
  kpis.innerHTML = `
    <article data-level="${escapeAttr(weather.freshness?.state || "unknown")}">
      <span>Weather</span><strong>${weather.temperatureF != null ? `${Math.round(weather.temperatureF)} F` : "Unavailable"}</strong>
      <p>${escapeHtml(weather.shortForecast || conditionLabel(weather.status))}</p>
      <small>${escapeHtml([weather.windDirection, weather.windSpeed].filter(Boolean).join(" ") || (syntheticWeather ? "Board simulation awaiting refresh" : "NWS feed awaiting refresh"))}</small>
    </article>
    <article data-level="${escapeAttr(ferryHasInterruption ? "critical" : ferry.freshness?.state || "unknown")}">
      <span>Ferry wait</span><strong>${escapeHtml(ferryPrimary)}</strong>
      <p>${escapeHtml(ferryDirectionSummary)}</p>
      <small>${ferrySource} · ${escapeHtml(syntheticFerry ? "simulated" : conditionLabel(ferry.freshness?.state))}</small>
    </article>
    <article data-level="${escapeAttr(payload.summary?.overallLevel || "unknown")}">
      <span>Island load</span><strong>${escapeHtml(conditionLabel(payload.summary?.overallLevel))}</strong>
      <p>${syntheticConditions ? `${payload.summary?.liveCameras || 0} simulated feeds across ${payload.summary?.armedCameras || 0} armed sources` : `${payload.summary?.liveCameras || 0} operationally live of ${payload.summary?.armedCameras || 0} armed sources`}</p>
      <small>${payload.summary?.freshObservations || 0} fresh observations · ${payload.summary?.standbyCameras || 0} standby · ${payload.summary?.awaitingSource || 0} awaiting source</small>
    </article>
    <article data-level="${weather.alerts?.length ? "high" : "low"}">
      <span>Weather alerts</span><strong>${weather.alerts?.length || 0}</strong>
      <p>${escapeHtml(weather.alerts?.[0]?.event || (syntheticWeather ? "No simulated weather alerts" : "No active NWS alerts"))}</p>
      <small>${escapeHtml(weather.source || "National Weather Service")}</small>
    </article>`;
  grid.innerHTML = (payload.cameras || []).map(camera => {
    const displayStatus = camera.operationalStatus === "live" ? camera.level : camera.operationalStatus || camera.level;
    const observation = camera.freshness?.state === "live" && ["live", "degraded"].includes(camera.operationalStatus)
      ? camera.observation
      : null;
    return `
    <article class="island-camera-card" data-level="${escapeAttr(camera.level || "unknown")}" data-operational-status="${escapeAttr(camera.operationalStatus || "unknown")}">
      <div><span>${escapeHtml(conditionLabel(camera.kind))}</span><b>${escapeHtml(conditionLabel(displayStatus))}</b></div>
      <strong>${escapeHtml(camera.name)}</strong>
      <p>${escapeHtml(camera.zone)}</p>
      <dl>
        <div><dt>Queue</dt><dd>${observation?.queueLength ?? "-"}</dd></div>
        <div><dt>Flow/min</dt><dd>${observation?.flowPerMinute ?? "-"}</dd></div>
        <div><dt>Wait</dt><dd>${observation?.estimatedWaitMinutes != null ? `${observation.estimatedWaitMinutes}m` : "-"}</dd></div>
      </dl>
      <small>${escapeHtml(syntheticConditions && camera.operationalStatus === "live" ? "playback" : conditionLabel(camera.operationalStatus))}${camera.freshness?.ageMinutes != null ? ` · ${observation ? "metric" : "last metric"} ${camera.freshness.ageMinutes}m ago` : ""}</small>
    </article>
  `;
  }).join("");
  setFormStatus(updated, payload.lastUpdated
    ? `Updated ${new Date(payload.lastUpdated).toLocaleString()}${syntheticConditions ? " · Board simulation" : ""}`
    : syntheticConditions ? "Board simulation awaiting refresh" : "Live sources connected as available", "ok");
}

async function loadIslandConditions(options = {}) {
  const button = document.querySelector("#refresh-island-conditions");
  if (button) button.disabled = true;
  try {
    const response = await fetchWithTimeout(`${publicApiBase()}/api/public/island-conditions`, { cache: options.force ? "reload" : "default" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Conditions API unavailable");
    renderIslandConditions(data);
    return data;
  } catch (error) {
    const kpis = document.querySelector("#island-condition-kpis");
    const updated = document.querySelector("#island-condition-updated");
    if (options.preserveOnError && kpis?.querySelector("article:not(.empty-state)")) {
      setFormStatus(updated, "Automatic refresh delayed · showing last update", "warning");
    } else if (kpis) {
      setFormStatus(updated, "Current conditions could not be refreshed.", "error");
      kpis.innerHTML = `<article class="empty-state" role="alert"><strong>Conditions unavailable</strong><span>${escapeHtml(friendlyRequestError(error))}</span></article>`;
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function renderBoothMap(pins) {
  const corridor = document.querySelector("#booth-corridor");
  const list = document.querySelector("#booth-list");
  if (!corridor || !list) return;
  corridor.innerHTML = `
    <div class="booth-corridor-inner">
      <span class="booth-corridor-label">Gulf → dunes</span>
      ${pins.map(p => {
        const x = ((p.illustratedMapXY?.x ?? 0.5) * 100).toFixed(1);
        const y = ((p.illustratedMapXY?.y ?? 0.5) * 100).toFixed(1);
        const type = escapeAttr(String(p.type || "vendor").replace(/[^a-z0-9_-]/gi, ""));
        return `<button type="button" class="booth-pin type-${type}" style="left:${x}%;top:${y}%" title="${escapeAttr(p.label)}" data-booth="${escapeAttr(p.id)}">${escapeHtml(p.id)}</button>`;
      }).join("")}
    </div>`;
  list.innerHTML = pins.map(p => `
    <article class="booth-card" id="booth-card-${escapeAttr(p.id)}">
      <strong>${escapeHtml(p.label)}</strong>
      <span>${escapeHtml(p.category)} · ${escapeHtml(p.id)}${p.beachMarker ? ` · marker ${escapeHtml(p.beachMarker)}` : ""}</span>
      <p>${escapeHtml(p.description || "")}</p>
    </article>
  `).join("") || '<article class="empty-state"><span>No public booths.</span></article>';
  corridor.querySelectorAll("[data-booth]").forEach(pin => {
    pin.addEventListener("click", () => {
      document.querySelector(`#booth-card-${pin.dataset.booth}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

async function hydratePassportFromApi() {
  const attendeeRef = passportAttendeeRef();
  const response = await fetchWithTimeout(`${publicApiBase()}/api/public/passport/progress?attendeeRef=${encodeURIComponent(attendeeRef)}`, { cache: "no-store" });
  if (!response.ok) return;
  const data = await response.json();
  const ids = data.progress?.stampedCheckpointIds || [];
  if (!ids.length) return;
  // Map checkpoint ids (cp_ent_…) or entry ids onto local entry ids.
  const collected = readPassport();
  for (const id of ids) {
    const entryId = id.startsWith("cp_ent_") ? id.slice(3) : id.startsWith("cp_") ? null : id;
    const resolved = entryId && passportCheckpoints.some(e => e.id === entryId)
      ? entryId
      : passportCheckpoints.find(e => `cp_${e.id}` === id)?.id;
    if (resolved) collected.add(resolved);
  }
  writePassport(collected);
  renderPassport();
}

function revenueKpiCard(label, value, sub) {
  return `<article><span>${label}</span><strong>${value}</strong>${sub ? `<b>${sub}</b>` : ""}</article>`;
}

function revenueRow(name, bucket) {
  return `
    <article>
      <span>${name.replace(/_/g, " ")}</span>
      <b>${adminMoney(bucket.netCents)}</b>
      <em>${bucket.count} ${bucket.count === 1 ? "entry" : "entries"}</em>
    </article>`;
}

function renderAdminRevenue(payload) {
  const s = payload.summary;
  const kpis = document.querySelector("#admin-revenue-kpis");
  const updated = document.querySelector("#admin-revenue-updated");
  const cats = document.querySelector("#admin-revenue-categories");
  const sources = document.querySelector("#admin-revenue-sources");
  const importHistory = document.querySelector("#admin-revenue-import-history");
  if (!kpis || !s) return;
  kpis.innerHTML = [
    revenueKpiCard("Gross", adminMoney(s.totals.grossCents), `${s.totals.count} entries`),
    revenueKpiCard("Refunds / voids", adminMoney(s.totals.refundCents), s.totals.refundCents ? "Recorded adjustments" : "No reversals"),
    revenueKpiCard("Fees", adminMoney(s.totals.feeCents), `${s.totals.effectiveFeeRatePct}% of gross`),
    revenueKpiCard("Net", adminMoney(s.totals.netCents), s.spendPerAttendeeCents ? `${adminMoney(s.spendPerAttendeeCents)}/guest` : ""),
    revenueKpiCard("Reconciled", `${s.reconciliation.pctReconciled}%`, `${adminMoney(s.reconciliation.unreconciledNetCents)} pending`),
    revenueKpiCard("Tickets sold", `${s.tickets.sold}`, s.tickets.pctSold != null ? `${s.tickets.pctSold}% of ${s.tickets.capacity}` : "")
  ].join("");
  cats.innerHTML = Object.entries(s.byCategory).map(([k, v]) => revenueRow(k, v)).join("")
    || '<article class="empty-state"><span>No entries.</span></article>';
  sources.innerHTML = Object.entries(s.bySource).map(([k, v]) => revenueRow(k, v)).join("")
    || '<article class="empty-state"><span>No entries.</span></article>';
  const imported = payload.sources?.imported;
  const partner = payload.sources?.partnerOperations;
  const ticketOrders = payload.sources?.ticketOrders;
  const imports = Array.isArray(payload.imports) ? payload.imports : [];
  const excluded = Number(imported?.excludedEntries || 0) + Number(imported?.unscopedEntries || 0);
  const sourceStatus = [
    `${Number(imported?.entries || 0)} imported`,
    `${Number(partner?.entries || 0)} partner ledger`,
    `${Number(ticketOrders?.entries || 0)} ticket ledger`,
    imports.length ? `${imports.length} settlement batch${imports.length === 1 ? "" : "es"}` : null,
    excluded ? `${excluded} out-of-scope excluded` : null
  ].filter(Boolean).join(" · ");
  if (importHistory) {
    importHistory.innerHTML = imports.map(item => `
      <article>
        <span>${escapeHtml(conditionLabel(item.source || "manual"))}${item.fileName ? ` · ${escapeHtml(item.fileName)}` : ""}</span>
        <b>${escapeHtml(item.imported || 0)} imported</b>
        <em>${item.importedAt ? escapeHtml(new Date(item.importedAt).toLocaleString()) : "Pending timestamp"}</em>
      </article>`).join("") || '<article class="empty-state"><span>No settlement imports.</span></article>';
  }
  updated.textContent = payload.lastUpdated
    ? `${payload.eventId || "Current event"} · updated ${new Date(payload.lastUpdated).toLocaleString()} · ${sourceStatus}`
    : `${payload.eventId || "Current event"} · ${sourceStatus || "No revenue entries"}`;
}

const ADMIN_BUDGET_UI_ENABLED = import.meta.env.DEV || import.meta.env.VITE_SANDFEST_SURFACE === "admin";
const adminBudgetUiPromise = ADMIN_BUDGET_UI_ENABLED
  ? import("./admin-budget.js").then(module => module.createAdminBudgetUi({
      adminCan,
      adminFetch,
      adminMoney,
      getAdminSessionState: () => adminSessionState,
      renderAdminSession,
      revenueKpiCard,
      setAdminStatus
    }))
  : Promise.resolve(null);

async function loadAdminBudget(options = {}) {
  const controller = await adminBudgetUiPromise;
  if (!controller) return null;
  controller.mount();
  return controller.load(options);
}
async function loadAdminRevenue({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-revenue");
  if (button) button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/revenue");
    renderAdminRevenue(data);
    if (!quiet) setAdminStatus(`Loaded revenue: ${adminMoney(data.summary.totals.netCents)} net across ${data.summary.totals.count} entries.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

function revenueImportPayload(form) {
  return {
    csv: form.elements.csv.value,
    source: form.elements.source.value,
    fileName: form.elements.file.files?.[0]?.name || ""
  };
}

function renderRevenueImportResult(result, { committed = false } = {}) {
  const output = document.querySelector("#admin-revenue-import-result");
  if (!output) return;
  const summary = result.summary || {};
  const accepted = committed ? summary.imported : summary.importable;
  const issues = [
    ...(result.errors || []).map(item => ({ ...item, label: item.error || "Invalid row" })),
    ...(result.duplicates || []).map(item => ({ ...item, label: `Already recorded${item.origin ? ` in ${conditionLabel(item.origin)}` : ""}` }))
  ].sort((a, b) => Number(a.row || 0) - Number(b.row || 0));
  output.dataset.state = summary.invalid || summary.duplicates ? "warning" : "ok";
  output.innerHTML = `
    <div class="admin-import-summary">
      <span><b>${escapeHtml(summary.rows || 0)}</b> rows</span>
      <span><b>${escapeHtml(accepted || 0)}</b> ${committed ? "imported" : "importable"}</span>
      <span><b>${escapeHtml(summary.duplicates || 0)}</b> duplicates</span>
      <span><b>${escapeHtml(summary.invalid || 0)}</b> invalid</span>
    </div>
    ${issues.length ? `<ul class="keyboard-scroll-region" tabindex="0" aria-label="Settlement import issues">${issues.slice(0, 20).map(item => `<li><b>Row ${escapeHtml(item.row || "?")}</b>${item.externalRef ? ` · ${escapeHtml(item.externalRef)}` : ""} · ${escapeHtml(item.label)}</li>`).join("")}</ul>` : ""}
    <p>${result.replay ? "This exact settlement was already imported. No ledger entries were added." : `${adminMoney(summary.grossCents || 0)} gross · ${adminMoney(summary.feeCents || 0)} fees · ${adminMoney(summary.netCents || 0)} net`}</p>
    ${(result.sample || []).length ? `<p>${escapeHtml(result.sample.map(item => `${item.externalRef} (${adminMoney(item.netCents)})`).join(" · "))}</p>` : ""}`;
}

function clearRevenueImportPreview({ keepResult = false } = {}) {
  revenueImportPreview = null;
  const commit = document.querySelector("#admin-commit-revenue-import");
  if (commit) {
    commit.hidden = true;
    commit.disabled = true;
    commit.textContent = "Import valid rows";
  }
  if (!keepResult) {
    const output = document.querySelector("#admin-revenue-import-result");
    if (output) output.replaceChildren();
  }
}

function fleetStatusLabel(status) {
  return String(status || "unknown").replace(/_/g, " ");
}

function renderAdminFleet(payload) {
  const s = payload.summary;
  const kpis = document.querySelector("#admin-fleet-kpis");
  const updated = document.querySelector("#admin-fleet-updated");
  const assetsEl = document.querySelector("#admin-fleet-assets");
  const openEl = document.querySelector("#admin-fleet-open");
  if (!kpis || !s) return;
  kpis.innerHTML = [
    revenueKpiCard("Assets", `${s.totals.assets}`, `${s.totals.available} available`),
    revenueKpiCard("Checked out", `${s.totals.openCheckouts}`, Object.entries(s.teams || {}).map(([t, n]) => `${t}: ${n}`).join(" · ") || "none open"),
    revenueKpiCard("Maintenance", `${s.totals.maintenance}`, s.totals.damageReports ? `${s.totals.damageReports} damage reports` : "no damage"),
    revenueKpiCard("Trackers", `${s.totals.withLiveLocation}/${s.totals.withTracker}`, "live / tagged"),
    revenueKpiCard("Rental cost", adminMoney(s.totals.rentalCostCents), "seed pool")
  ].join("");

  assetsEl.innerHTML = (payload.assets || []).map(asset => {
    const who = asset.activeCheckout
      ? `${asset.activeCheckout.checkedOutTo} · ${asset.activeCheckout.team || "no team"}`
      : fleetStatusLabel(asset.status);
    const loc = asset.lastLocation?.beachMarker
      || (asset.lastLocation?.lat != null ? `${asset.lastLocation.lat.toFixed(4)}, ${asset.lastLocation.lng.toFixed(4)}` : asset.homeZoneId || "—");
    const statusClass = String(asset.status || "").replace(/[^a-z0-9_-]/gi, "");
    return `
      <article data-fleet-asset="${escapeAttr(asset.id)}" class="fleet-asset-row status-${escapeAttr(statusClass)}">
        <div>
          <strong>${escapeHtml(asset.label)}</strong>
          <span>${escapeHtml(asset.type.replace(/_/g, " "))} · ${escapeHtml(asset.id)}${asset.qrPayload ? ` · ${escapeHtml(asset.qrPayload)}` : ""}</span>
        </div>
        <b>${escapeHtml(fleetStatusLabel(asset.status))}</b>
        <em>${escapeHtml(who)}</em>
        <i>${escapeHtml(loc)}</i>
      </article>`;
  }).join("") || '<article class="empty-state"><span>No assets.</span></article>';

  openEl.innerHTML = (payload.openCheckouts || []).map(co => `
    <article>
      <div>
        <strong>${escapeHtml(co.assetId)}</strong>
        <span>${escapeHtml(co.checkedOutTo)} · ${escapeHtml(co.team || "unassigned")}</span>
      </div>
      <b>${escapeHtml(co.startCondition || "—")}</b>
      <em>${co.startChargePct != null ? `${Number(co.startChargePct)}%` : "—"}</em>
      <i>${co.checkOutAt ? escapeHtml(new Date(co.checkOutAt).toLocaleString()) : ""}</i>
    </article>
  `).join("") || '<article class="empty-state"><span>No open checkouts.</span></article>';

  // Clicking a row fills the quick-action form.
  assetsEl.querySelectorAll("[data-fleet-asset]").forEach(row => {
    row.addEventListener("click", () => {
      const input = document.querySelector("#fleet-asset-id");
      if (input) input.value = row.dataset.fleetAsset;
    });
  });

  updated.textContent = payload.lastUpdated
    ? `Fleet updated ${new Date(payload.lastUpdated).toLocaleString()} · ${payload.assets.length} assets · ${s.totals.openCheckouts} open.`
    : "Fleet loaded.";
}

async function loadAdminFleet({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-fleet");
  if (button) button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/fleet");
    renderAdminFleet(data);
    if (!quiet) setAdminStatus(`Loaded fleet: ${data.summary.totals.assets} assets, ${data.summary.totals.openCheckouts} checked out.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

function fleetFormValues() {
  return {
    assetId: document.querySelector("#fleet-asset-id")?.value?.trim() || "",
    checkedOutTo: document.querySelector("#fleet-checked-out-to")?.value?.trim() || "",
    team: document.querySelector("#fleet-team")?.value?.trim() || "",
    startChargePct: document.querySelector("#fleet-start-charge")?.value,
    endChargePct: document.querySelector("#fleet-end-charge")?.value,
    damageReport: document.querySelector("#fleet-damage")?.value?.trim() || null
  };
}

async function adminFleetCheckout() {
  const button = document.querySelector("#admin-fleet-checkout");
  if (button) button.disabled = true;
  try {
    const values = fleetFormValues();
    if (!values.assetId) throw new Error("Asset ID is required.");
    if (!values.checkedOutTo) throw new Error("Checked out to is required.");
    const data = await adminFetch("/api/admin/fleet/checkout", {
      method: "POST",
      body: JSON.stringify({
        assetId: values.assetId,
        checkedOutTo: values.checkedOutTo,
        team: values.team,
        startChargePct: values.startChargePct === "" ? null : Number(values.startChargePct),
        method: "manual"
      })
    });
    await loadAdminFleet({ quiet: true });
    setAdminStatus(`Checked out ${data.asset.label} to ${data.checkout.checkedOutTo}.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function adminFleetCheckin() {
  const button = document.querySelector("#admin-fleet-checkin");
  if (button) button.disabled = true;
  try {
    const values = fleetFormValues();
    if (!values.assetId) throw new Error("Asset ID is required.");
    const data = await adminFetch("/api/admin/fleet/checkin", {
      method: "POST",
      body: JSON.stringify({
        assetId: values.assetId,
        endChargePct: values.endChargePct === "" ? null : Number(values.endChargePct),
        damageReport: values.damageReport || null,
        endCondition: values.damageReport ? "damaged" : "good",
        method: "manual"
      })
    });
    await loadAdminFleet({ quiet: true });
    setAdminStatus(`Checked in ${data.checkout.assetId}${data.checkout.damageReport ? " (damage noted)" : ""}.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAdminVolunteers(payload) {
  const s = payload.summary;
  const kpis = document.querySelector("#admin-volunteers-kpis");
  const updated = document.querySelector("#admin-volunteers-updated");
  const zonesEl = document.querySelector("#admin-volunteers-zones");
  const gapsEl = document.querySelector("#admin-volunteers-gaps");
  const importHistory = document.querySelector("#admin-volunteer-import-history");
  if (!kpis || !s) return;
  kpis.innerHTML = [
    revenueKpiCard("Volunteers", `${s.totals.volunteers}`, `${s.totals.confirmed} confirmed · ${s.totals.checkedIn} in`),
    revenueKpiCard("Shift fill", `${s.totals.fillPct}%`, `${s.totals.slotsFilled}/${s.totals.slotsNeeded} slots`),
    revenueKpiCard("Open gaps", `${s.totals.openGaps}`, `${s.understaffed?.length || 0} understaffed shifts`),
    revenueKpiCard("Hours logged", `${s.totals.totalHours}`, `${s.totals.openHourLogs} still on shift`),
    revenueKpiCard("Waivers", `${s.totals.waiverSigned}`, `${s.totals.smsConsent} SMS opt-in`)
  ].join("");

  zonesEl.innerHTML = (s.zones || []).map(z => `
    <article class="vol-zone status-${z.status}">
      <div>
        <strong>${z.zone}</strong>
        <span>${z.shifts} shifts · ${z.roles.map(r => r.replace(/-/g, " ")).join(", ")}</span>
      </div>
      <b>${z.filled}/${z.needed}</b>
      <em>${z.fillPct}%</em>
      <i>${z.openGaps ? `${z.openGaps} short` : "full"}</i>
    </article>
  `).join("") || '<article class="empty-state"><span>No zones.</span></article>';

  gapsEl.innerHTML = (s.understaffed || []).map(g => `
    <article class="vol-gap status-${g.status}">
      <div>
        <strong>${g.zoneLabel}</strong>
        <span>${g.day || ""} · ${g.roleId.replace(/-/g, " ")} · ${g.startsAt ? new Date(g.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span>
      </div>
      <b>−${g.gap}</b>
      <em>${g.filled}/${g.needed}</em>
      <i>${g.fillPct}%</i>
    </article>
  `).join("") || '<article class="empty-state"><span>All shifts filled.</span></article>';

  if (importHistory) {
    importHistory.innerHTML = (payload.imports || []).map(item => {
      const summary = item.summary || {};
      const changed = [summary.volunteers, summary.shifts, summary.hourLogs]
        .reduce((total, bucket) => total + Number(bucket?.created || 0) + Number(bucket?.updated || 0), 0);
      const names = Object.values(item.files || {}).filter(Boolean).join(" · ");
      return `<article>
        <span>${escapeHtml(names || "VolunteerLocal export")}</span>
        <b>${escapeHtml(changed)} changed</b>
        <em>${item.importedAt ? escapeHtml(new Date(item.importedAt).toLocaleString()) : "Pending timestamp"}</em>
      </article>`;
    }).join("") || '<article class="empty-state"><span>No VolunteerLocal imports.</span></article>';
  }

  updated.textContent = payload.lastUpdated
    ? `Mirror updated ${new Date(payload.lastUpdated).toLocaleString()} · source ${payload.source || "seed"} · ${s.totals.shifts} shifts.`
    : "Volunteer coverage loaded.";
}

async function loadAdminVolunteers({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-volunteers");
  if (button) button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/volunteers");
    renderAdminVolunteers(data);
    if (!quiet) setAdminStatus(`Loaded volunteer coverage: ${data.summary.totals.fillPct}% fill, ${data.summary.totals.openGaps} open gaps.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function volunteerImportPayload(form) {
  const selectedFiles = ["rosterFile", "shiftsFile", "hoursFile"]
    .map(name => form.elements[name].files?.[0])
    .filter(Boolean);
  if (selectedFiles.reduce((total, file) => total + file.size, 0) > 5_000_000) {
    throw new Error("The combined VolunteerLocal exports are larger than the 5 MB import limit.");
  }
  const read = async (name, required = false) => {
    const file = form.elements[name].files?.[0];
    if (!file) {
      if (required) throw new Error("Choose a VolunteerLocal roster CSV.");
      return { csv: "", name: "" };
    }
    return { csv: await file.text(), name: file.name };
  };
  const [roster, shifts, hours] = await Promise.all([
    read("rosterFile", true),
    read("shiftsFile"),
    read("hoursFile")
  ]);
  return {
    rosterCsv: roster.csv,
    shiftsCsv: shifts.csv,
    hoursCsv: hours.csv,
    fileNames: { roster: roster.name, shifts: shifts.name, hours: hours.name },
    currentEventConfirmed: form.elements.currentEventConfirmed.checked
  };
}

function volunteerImportCount(summary, key) {
  return [summary?.volunteers, summary?.shifts, summary?.hourLogs]
    .reduce((total, bucket) => total + Number(bucket?.[key] || 0), 0);
}

function renderVolunteerImportResult(result, { committed = false } = {}) {
  const output = document.querySelector("#admin-volunteer-import-result");
  if (!output) return;
  const summary = result.summary || {};
  const valid = volunteerImportCount(summary, "valid");
  const created = volunteerImportCount(summary, "created");
  const updated = volunteerImportCount(summary, "updated");
  const unchanged = volunteerImportCount(summary, "unchanged");
  output.dataset.state = Number(summary.invalid || 0) ? "warning" : "ok";
  output.innerHTML = `
    <div class="admin-import-summary">
      <span><b>${escapeHtml(valid)}</b> valid</span>
      <span><b>${escapeHtml(created)}</b> new</span>
      <span><b>${escapeHtml(updated)}</b> updated</span>
      <span><b>${escapeHtml(unchanged)}</b> unchanged</span>
      <span><b>${escapeHtml(summary.invalid || 0)}</b> invalid</span>
    </div>
    ${(result.errors || []).length ? `<ul class="keyboard-scroll-region" tabindex="0" aria-label="Volunteer import issues">${result.errors.slice(0, 20).map(item => `<li><b>${escapeHtml(conditionLabel(item.file || "file"))} row ${escapeHtml(item.row || "?")}</b>${item.externalId ? ` · ${escapeHtml(item.externalId)}` : ""} · ${escapeHtml(item.error || "Invalid row")}</li>`).join("")}</ul>` : ""}
    <p>${result.replay ? "This exact export bundle was already imported; nothing was duplicated." : committed ? "Roster, shifts, and hours were reconciled atomically." : "Preview only. Existing local records missing from the export will not be deleted."}</p>`;
}

function clearVolunteerImportPreview({ keepResult = false } = {}) {
  volunteerImportPreview = null;
  const commit = document.querySelector("#admin-commit-volunteer-import");
  if (commit) {
    commit.hidden = true;
    commit.disabled = true;
    commit.textContent = "Commit reconciliation";
  }
  if (!keepResult) document.querySelector("#admin-volunteer-import-result")?.replaceChildren();
}

async function staffImportPayload(form) {
  const file = form.elements.file.files?.[0];
  if (!file) throw new Error("Choose a staff CSV or JSON file.");
  if (file.size > 5_000_000) throw new Error("The staff directory file is larger than the 5 MB import limit.");
  return {
    contents: await file.text(),
    fileName: file.name,
    source: form.elements.source.value,
    currentEventConfirmed: form.elements.currentEventConfirmed.checked
  };
}

function renderStaffImportResult(result, { committed = false } = {}) {
  const output = document.querySelector("#admin-staff-import-result");
  if (!output) return;
  const summary = result.summary || {};
  const ready = result.readiness?.ready === true;
  output.dataset.state = ready && result.commitAllowed !== false ? "ok" : "warning";
  output.innerHTML = `
    <div class="admin-import-summary">
      <span><b>${escapeHtml(summary.totalStaff || 0)}</b> staff</span>
      <span><b>${escapeHtml(summary.activeStaff || 0)}</b> active</span>
      <span><b>${escapeHtml(summary.routedTeams || 0)}/${escapeHtml(summary.totalTeams || 0)}</b> routes</span>
      <span><b>${ready ? "Ready" : "Blocked"}</b> verification</span>
    </div>
    <p>${result.replay ? "This exact directory was already imported; nothing was duplicated." : result.commitBlockReason ? escapeHtml(result.commitBlockReason) : committed ? "The verified directory and all notification routes were replaced atomically." : "Preview only. No staff routing or private contact data has changed."}</p>`;
}

function clearStaffImportPreview({ keepResult = false } = {}) {
  staffImportPreview = null;
  const commit = document.querySelector("#admin-commit-staff-import");
  if (commit) {
    commit.hidden = true;
    commit.disabled = true;
    commit.textContent = "Commit directory";
  }
  if (!keepResult) document.querySelector("#admin-staff-import-result")?.replaceChildren();
}

function renderAdminConsent(payload) {
  const s = payload.summary;
  const kpis = document.querySelector("#admin-consent-kpis");
  const updated = document.querySelector("#admin-consent-updated");
  if (!kpis || !s) return;
  const smsLabel = payload.sms?.ready
    ? payload.sms.providerMode === "sandbox" ? "Sandbox ready" : "Twilio ready"
    : payload.sms?.enabled
      ? "Twilio misconfigured"
      : "SMS idle";
  kpis.innerHTML = [
    revenueKpiCard("Records", `${s.totals.records}`, `${s.totals.withEmail} email · ${s.totals.withPhone} phone`),
    revenueKpiCard("Email marketing", `${payload.marketingEmailCount ?? s.totals.emailMarketing}`, "Brevo-ready list"),
    revenueKpiCard("SMS promo", `${payload.marketingSmsCount ?? s.totals.smsMarketing}`, "A2P marketing campaign"),
    revenueKpiCard("SMS safety", `${payload.safetyRecipientCount ?? s.totals.smsSafety}`, "alert fan-out list"),
    revenueKpiCard("SMS delivery", smsLabel, payload.sms?.reason || "")
  ].join("");
  updated.textContent = payload.lastUpdated
    ? `Consent ledger updated ${new Date(payload.lastUpdated).toLocaleString()} · ${s.totals.records} records.`
    : "Consent loaded.";
}

function renderAdminBoardSmsPreference(preference) {
  const target = document.querySelector("#admin-board-sms-preference");
  const status = document.querySelector("#admin-board-sms-preference-status");
  if (!target || !status) return;
  const available = preference?.available === true;
  target.hidden = !available;
  if (!available) return;
  const optedIn = preference.state === "opted_in";
  const callbacks = Number(preference.signedCallbacks || 0);
  target.dataset.state = optedIn ? "opted_in" : "opted_out";
  status.textContent = `${optedIn ? "Opted in" : "Opted out"} · ${callbacks} signed sandbox callback${callbacks === 1 ? "" : "s"}`;
  const canSimulate = adminCan("alert:write");
  const stop = target.querySelector('[data-board-sms-preference="STOP"]');
  const start = target.querySelector('[data-board-sms-preference="START"]');
  if (stop) stop.disabled = !canSimulate || !optedIn;
  if (start) start.disabled = !canSimulate || optedIn;
}

function renderAdminSms(payload) {
  const rows = document.querySelector("#admin-sms-campaigns");
  if (!rows) return;
  renderAdminBoardSmsPreference(payload.boardDemoPreference);
  rows.innerHTML = (payload.campaigns || []).map(campaign => {
    const counts = campaign.counts || {};
    const complete = Number(counts.delivered || 0) + Number(counts.failed || 0)
      + Number(counts.suppressed || 0) + Number(counts.unknown || 0);
    return `
      <article>
        <div>
          <strong>${escapeHtml(campaign.title || "Safety alert")}</strong>
          <span>${escapeHtml(campaign.severity || "info")} · ${campaign.createdAt ? new Date(campaign.createdAt).toLocaleString() : "pending"}</span>
        </div>
        <b>${counts.delivered || 0}/${counts.total || 0}</b>
        <em>${escapeHtml(campaign.status || "queued")}</em>
        <i>${complete}/${counts.total || 0} final</i>
      </article>
    `;
  }).join("") || '<article class="empty-state"><span>No safety SMS campaigns.</span></article>';
}

async function loadAdminConsent({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-consent");
  if (button) button.disabled = true;
  try {
    const [data, sms] = await Promise.all([
      adminFetch("/api/admin/consent"),
      adminFetch("/api/admin/sms")
    ]);
    renderAdminConsent(data);
    renderAdminSms(sms);
    if (!quiet) setAdminStatus(`Loaded consent: ${data.summary.totals.emailMarketing} email · ${sms.eligibleSafetyRecipients} safety SMS.`, "ok");
    return { consent: data, sms };
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAdminPassport(payload) {
  const s = payload.summary;
  const kpis = document.querySelector("#admin-passport-kpis");
  const updated = document.querySelector("#admin-passport-updated");
  const rows = document.querySelector("#admin-passport-checkpoints");
  if (!kpis || !s) return;
  kpis.innerHTML = [
    revenueKpiCard("Checkpoints", `${s.totals.checkpoints}`, payload.hunt?.active ? "hunt active" : "hunt inactive"),
    revenueKpiCard("Stamps", `${s.totals.stamps}`, `${s.totals.uniqueAttendees} visitors`),
    revenueKpiCard("Finishers", `${s.totals.finishers}`, "full passport"),
    revenueKpiCard("Points", `${s.totals.totalPointsAwarded}`, "awarded")
  ].join("");
  if (rows) {
    rows.innerHTML = (s.byCheckpoint || []).map(c => `
      <article>
        <div>
          <strong>${c.label}</strong>
          <span>${c.checkpointId}</span>
        </div>
        <b>${c.stamps}</b>
        <em>stamps</em>
        <i>${c.points} pts</i>
      </article>
    `).join("") || '<article class="empty-state"><span>No checkpoints.</span></article>';
  }
  updated.textContent = payload.lastUpdated
    ? `Passport stats updated ${new Date(payload.lastUpdated).toLocaleString()}.`
    : "Passport stats loaded.";
}

async function loadAdminPassport({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-passport");
  if (button) button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/passport");
    renderAdminPassport(data);
    if (!quiet) setAdminStatus(`Loaded passport: ${data.summary.totals.stamps} stamps, ${data.summary.totals.finishers} finishers.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadAdminVoting({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-voting");
  if (button) button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/voting");
    const kpis = document.querySelector("#admin-voting-kpis");
    if (kpis && data.summary) {
      const s = data.summary;
      kpis.innerHTML = [
        revenueKpiCard("Votes", `${s.totals.totalVotes}`, `${s.totals.uniqueVoters} voters`),
        revenueKpiCard("Entries", `${s.totals.eligibleEntries}`, data.votingOpen ? "open" : "closed"),
        revenueKpiCard("Leader", s.leader?.title || "—", s.leader ? `${s.leader.votes} votes` : "")
      ].join("");
    }
    if (!quiet) setAdminStatus(`Loaded People's Choice: ${data.summary.totals.totalVotes} votes.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadAdminBooths({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-booths");
  if (button) button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/booths");
    const kpis = document.querySelector("#admin-booths-kpis");
    if (kpis && data.summary) {
      const t = data.summary.totals;
      kpis.innerHTML = [
        revenueKpiCard("Booths", `${t.booths}`, `${t.assigned} assigned`),
        revenueKpiCard("Vendors", `${t.vendors}`, `${t.docsNeeded} need docs`),
        revenueKpiCard("Public pins", `${t.publicPins}`, data.source || "seed")
      ].join("");
    }
    const history = document.querySelector("#admin-booth-import-history");
    if (history) {
      history.innerHTML = (data.imports || []).slice(0, 8).map(item => `
        <article>
          <span>${escapeHtml(item.fileName || "Eventeny booth export")}</span>
          <strong>${escapeHtml(item.summary?.booths?.valid || 0)} booth rows</strong>
          <small>${escapeHtml(item.importedAt ? new Date(item.importedAt).toLocaleString() : "")}</small>
        </article>`).join("") || '<article class="empty-state"><span>No Eventeny booth imports.</span></article>';
    }
    if (!quiet) setAdminStatus(`Loaded booths: ${data.summary.totals.booths} total.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}

async function boothImportPayload(form) {
  const file = form.elements.boothFile.files?.[0];
  if (!file) throw new Error("Choose an Eventeny booth CSV.");
  if (file.size > 5_000_000) throw new Error("The Eventeny booth export is larger than the 5 MB import limit.");
  return {
    csv: await file.text(),
    fileName: file.name,
    currentEventConfirmed: form.elements.currentEventConfirmed.checked
  };
}

function renderBoothImportResult(result, { committed = false } = {}) {
  const output = document.querySelector("#admin-booth-import-result");
  if (!output) return;
  const summary = result.summary || {};
  const booths = summary.booths || {};
  const vendors = summary.vendors || {};
  output.dataset.state = Number(summary.invalid || 0) ? "warning" : "ok";
  output.innerHTML = `
    <div class="admin-import-summary">
      <span><b>${escapeHtml(booths.valid || 0)}</b> booth rows</span>
      <span><b>${escapeHtml(booths.created || 0)}</b> new booths</span>
      <span><b>${escapeHtml(booths.updated || 0)}</b> booth updates</span>
      <span><b>${escapeHtml(vendors.created || 0)}</b> new vendors</span>
      <span><b>${escapeHtml(vendors.updated || 0)}</b> vendor updates</span>
      <span><b>${escapeHtml(summary.assignmentChanges || 0)}</b> moves cleared</span>
      <span><b>${escapeHtml(booths.unchanged || 0)}</b> unchanged</span>
      <span><b>${escapeHtml(summary.invalid || 0)}</b> invalid</span>
    </div>
    ${(result.errors || []).length ? `<ul class="keyboard-scroll-region" tabindex="0" aria-label="Booth import issues">${result.errors.slice(0, 20).map(item => `<li><b>Booths row ${escapeHtml(item.row || "?")}</b>${item.boothId ? ` · ${escapeHtml(item.boothId)}` : ""} · ${escapeHtml(item.error || "Invalid row")}</li>`).join("")}</ul>` : ""}
    <p>${result.replay ? "This exact Eventeny export was already imported; nothing was duplicated." : committed ? "Booths, vendor assignments, compliance state, and public-map eligibility were reconciled atomically." : "Preview only. Missing rows will not be deleted; explicit open or moved assignments are reconciled."}</p>`;
}

function clearBoothImportPreview({ keepResult = false } = {}) {
  boothImportPreview = null;
  const commit = document.querySelector("#admin-commit-booth-import");
  if (commit) {
    commit.hidden = true;
    commit.disabled = true;
    commit.textContent = "Commit reconciliation";
  }
  if (!keepResult) document.querySelector("#admin-booth-import-result")?.replaceChildren();
}

function partnerStatusOptions(selected) {
  return ["submitted", "under_review", "approved", "contracted", "invoiced", "partial", "paid", "active", "complete", "rejected", "withdrawn"]
    .map(status => `<option value="${status}" ${status === selected ? "selected" : ""}>${conditionLabel(status)}</option>`)
    .join("");
}

function prospectStatusOptions(selected) {
  return ["identified", "researching", "qualified", "contact_ready", "contacted", "engaged", "won", "lost", "do_not_contact"]
    .map(status => `<option value="${status}" ${status === selected ? "selected" : ""}>${conditionLabel(status)}</option>`)
    .join("");
}

function partnerImportPayload(form) {
  return {
    csv: form.elements.csv.value,
    fileName: form.elements.file.files?.[0]?.name || "",
    defaultType: form.elements.defaultType.value,
    transactionalContactConfirmed: form.elements.transactionalContactConfirmed.checked
  };
}

function renderPartnerImportResult(result, { committed = false } = {}) {
  const output = document.querySelector("#admin-partner-import-result");
  if (!output) return;
  const summary = result.summary || {};
  const accepted = committed ? summary.imported : summary.importable;
  const issues = [
    ...(result.errors || []).map(item => ({ ...item, label: item.error || "Invalid row" })),
    ...(result.conflicts || []).map(item => ({ ...item, label: item.error || "Changed application needs manual review" })),
    ...(result.duplicates || []).map(item => ({ ...item, label: "Already imported" }))
  ].sort((a, b) => Number(a.row || 0) - Number(b.row || 0));
  output.dataset.state = summary.invalid || summary.conflicts ? "warning" : "ok";
  output.innerHTML = `
    <div class="admin-import-summary">
      <span><b>${escapeHtml(summary.rows || 0)}</b> rows</span>
      <span><b>${escapeHtml(accepted || 0)}</b> ${committed ? "imported" : "importable"}</span>
      <span><b>${escapeHtml(summary.duplicates || 0)}</b> duplicates</span>
      <span><b>${escapeHtml((summary.invalid || 0) + (summary.conflicts || 0))}</b> review</span>
    </div>
    ${issues.length ? `<ul class="keyboard-scroll-region" tabindex="0" aria-label="Partner import issues">${issues.slice(0, 20).map(item => `<li><b>Row ${escapeHtml(item.row || "?")}</b>${item.organizationName ? ` · ${escapeHtml(item.organizationName)}` : ""} · ${escapeHtml(item.label)}</li>`).join("")}</ul>` : ""}
    ${(result.sample || []).length ? `<p>${escapeHtml(result.sample.map(item => `${item.organizationName} · ${conditionLabel(item.type)} · ${item.packageName || item.offeringName || "catalog match"}`).join(" · "))}</p>` : ""}`;
}

function clearPartnerImportPreview({ keepResult = false } = {}) {
  partnerImportPreview = null;
  const commit = document.querySelector("#admin-commit-partner-import");
  if (commit) {
    commit.hidden = true;
    commit.disabled = true;
    commit.textContent = "Import valid applications";
  }
  if (!keepResult) {
    const output = document.querySelector("#admin-partner-import-result");
    if (output) output.replaceChildren();
  }
}

function outreachImportPayload(form) {
  return {
    csv: form.elements.csv.value,
    defaults: {
      state: form.elements.state.value,
      contactBasis: form.elements.contactBasis.value,
      status: form.elements.status.value,
      communityFit: form.elements.communityFit.checked
    }
  };
}

function renderOutreachImportResult(result, { committed = false } = {}) {
  const output = document.querySelector("#admin-outreach-import-result");
  if (!output) return;
  const summary = result.summary || {};
  const issues = [
    ...(result.errors || []).map(item => ({ ...item, label: item.error || "Invalid row" })),
    ...(result.duplicates || []).map(item => ({ ...item, label: "Already in the outreach pipeline" }))
  ].sort((a, b) => Number(a.row || 0) - Number(b.row || 0));
  output.dataset.state = summary.invalid ? "warning" : "ok";
  output.innerHTML = `
    <div class="admin-import-summary">
      <span><b>${escapeHtml(summary.rows || 0)}</b> rows</span>
      <span><b>${escapeHtml(summary.valid || 0)}</b> ${committed ? "imported" : "valid"}</span>
      <span><b>${escapeHtml(summary.duplicates || 0)}</b> duplicates</span>
      <span><b>${escapeHtml(summary.invalid || 0)}</b> invalid</span>
    </div>
    ${issues.length ? `<ul class="keyboard-scroll-region" tabindex="0" aria-label="Outreach import issues">${issues.slice(0, 20).map(item => `<li><b>Row ${escapeHtml(item.row || "?")}</b>${item.organizationName ? ` · ${escapeHtml(item.organizationName)}` : ""} · ${escapeHtml(item.label)}</li>`).join("")}</ul>` : ""}
    ${(result.sample || []).length ? `<p>${escapeHtml(result.sample.map(item => `${item.organizationName} (${item.fitScore}/100)`).join(" · "))}</p>` : ""}`;
}

function clearOutreachImportPreview({ keepResult = false } = {}) {
  outreachImportPreview = null;
  const commit = document.querySelector("#admin-commit-prospect-import");
  if (commit) {
    commit.hidden = true;
    commit.disabled = true;
    commit.textContent = "Import valid rows";
  }
  if (!keepResult) {
    const output = document.querySelector("#admin-outreach-import-result");
    if (output) output.replaceChildren();
  }
}

function outreachDiscoveryPayload(form) {
  return {
    location: form.elements.location.value,
    latitude: form.elements.latitude.value || null,
    longitude: form.elements.longitude.value || null,
    radiusMiles: form.elements.radiusMiles.value,
    limit: form.elements.limit.value,
    categories: [...form.querySelectorAll('input[name="categories"]:checked')].map(input => input.value)
  };
}

function updateOutreachDiscoverySelection() {
  const output = document.querySelector("#admin-outreach-discovery-result");
  const button = document.querySelector("#admin-import-discovered-businesses");
  if (!output || !button || !outreachDiscoveryPreview) return;
  const selected = output.querySelectorAll('input[name="discoveredSourceRef"]:checked').length;
  button.disabled = selected < 1 || !adminCan("outreach:write");
  button.textContent = `Import ${selected} selected`;
}

function clearOutreachDiscoveryPreview({ keepResult = false } = {}) {
  outreachDiscoveryPreview = null;
  const button = document.querySelector("#admin-import-discovered-businesses");
  if (button) {
    button.hidden = true;
    button.disabled = true;
    button.textContent = "Import selected";
  }
  if (!keepResult) document.querySelector("#admin-outreach-discovery-result")?.replaceChildren();
}

function renderOutreachDiscoveryResult(result, { imported = false } = {}) {
  const output = document.querySelector("#admin-outreach-discovery-result");
  const button = document.querySelector("#admin-import-discovered-businesses");
  if (!output || !button) return;
  if (imported) {
    const summary = result.summary || {};
    output.dataset.state = summary.invalid ? "warning" : "ok";
    output.innerHTML = `<div class="admin-import-summary">
      <span><b>${escapeHtml(summary.selected || 0)}</b> selected</span>
      <span><b>${escapeHtml(summary.imported || 0)}</b> imported</span>
      <span><b>${escapeHtml(summary.duplicates || 0)}</b> duplicates</span>
      <span><b>${escapeHtml(summary.contactResearchRequired || 0)}</b> need research</span>
    </div>`;
    return;
  }
  const candidates = result.candidates || [];
  const attributionUrl = safeExternalHref(result.discovery?.attributionUrl);
  const providerNote = result.provider?.endpointHost
    ? `Source query via ${result.provider.endpointHost}${result.provider.attemptCount > 1 ? ` after ${result.provider.attemptCount} attempts` : ""}`
    : "";
  output.dataset.state = "ok";
  output.innerHTML = `
    <div class="admin-discovery-summary">
      <span><b>${escapeHtml(candidates.length)}</b> candidates near ${escapeHtml(result.query?.resolvedLocation || result.query?.location || "selected coordinates")}</span>
      <span>${escapeHtml(providerNote)}${providerNote && result.discovery?.attribution ? " · " : ""}${attributionUrl ? `<a href="${escapeAttr(attributionUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(result.discovery.attribution)}</a>` : escapeHtml(result.discovery?.attribution || "")}</span>
    </div>
    <div class="admin-discovery-candidates keyboard-scroll-region" role="region" aria-label="Business discovery candidates" tabindex="0">
      ${candidates.map(candidate => {
        const website = safeExternalHref(candidate.website);
        const sourceUrl = safeExternalHref(candidate.sourceUrl);
        return `<div class="admin-discovery-candidate">
          <label class="admin-discovery-select"><input type="checkbox" name="discoveredSourceRef" value="${escapeAttr(candidate.sourceRef)}" />
          <span><strong>${escapeHtml(candidate.organizationName)}</strong><small>${escapeHtml([conditionLabel(candidate.industry), candidate.city, candidate.state, candidate.postalCode, `${candidate.distanceMiles} mi`].filter(Boolean).join(" · "))}</small></span></label>
          <span class="admin-discovery-links">${website ? `<a href="${escapeAttr(website)}" target="_blank" rel="noreferrer noopener">Website</a>` : "No website"}${sourceUrl ? `<a href="${escapeAttr(sourceUrl)}" target="_blank" rel="noreferrer noopener">Source</a>` : ""}${candidate.contactEmail ? "Listed email unverified" : "Contact research"}</span>
        </div>`;
      }).join("") || '<div class="empty-state"><span>No candidates matched this search.</span></div>'}
    </div>`;
  button.hidden = candidates.length < 1;
  updateOutreachDiscoverySelection();
}

function renderOutreachDiscoveryAvailability(outreach) {
  const form = document.querySelector("#admin-discover-businesses");
  const status = document.querySelector("#admin-outreach-discovery-readiness");
  if (!form || !status) return;
  const discovery = outreach.discovery || {};
  status.textContent = discovery.ready ? `${conditionLabel(discovery.provider)} ready` : discovery.reason || "Provider unavailable";
  status.dataset.ready = discovery.ready ? "true" : "false";
  const unavailable = !discovery.ready || !adminCan("outreach:write");
  form.querySelector('button[type="submit"]').disabled = unavailable;
  form.querySelectorAll("input").forEach(input => { input.disabled = unavailable; });
  if (!discovery.ready) clearOutreachDiscoveryPreview();
}

function contactBasisOptions(selected) {
  return [
    ["", "Contact basis"],
    ["business_relevance", "Relevant business contact"],
    ["existing_relationship", "Existing relationship"],
    ["event_partner", "Current or prior partner"],
    ["inbound_request", "Inbound request"],
    ["referral", "Referral"]
  ].map(([value, label]) => `<option value="${value}" ${value === (selected || "") ? "selected" : ""}>${label}</option>`).join("");
}

function taskStatusOptions(selected) {
  return ["open", "in_progress", "blocked", "done", "cancelled"]
    .map(status => `<option value="${status}" ${status === selected ? "selected" : ""}>${conditionLabel(status)}</option>`)
    .join("");
}

function taskPriorityOptions(selected) {
  return ["urgent", "high", "normal", "low"]
    .map(priority => `<option value="${priority}" ${priority === (selected || "normal") ? "selected" : ""}>${conditionLabel(priority)}</option>`)
    .join("");
}

function taskAssignmentType(task) {
  return task.assigneeType || (task.assigneeId ? "staff" : task.assigneeRole ? "team" : "unassigned");
}

function taskAssignmentOptions(selected) {
  return [["unassigned", "Unassigned"], ["staff", "Staff"], ["volunteer", "Volunteer"], ["team", "Team"]]
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function taskDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function taskTimeLabel(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function taskDueState(task, now = new Date()) {
  if (["done", "completed", "cancelled"].includes(task.status)) return "complete";
  if (!task.dueAt) return "unscheduled";
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return "unscheduled";
  if (due.getTime() < now.getTime()) return "overdue";
  return due.toLocaleDateString() === now.toLocaleDateString() ? "today" : "upcoming";
}

function prospectNextActionState(prospect, now = new Date()) {
  if (prospect.suppressedAt || ["won", "lost", "do_not_contact"].includes(prospect.status)) return "complete";
  return taskDueState({ status: "open", dueAt: prospect.nextActionAt }, now);
}

function taskCreateAssignmentOptions(payload, assigneeType) {
  const directory = payload.assignmentDirectory || {};
  if (assigneeType === "team") {
    return (directory.teams || []).map(item => ({
      ...item,
      label: `${item.name} · ${item.notificationReady ? "notifications ready" : "assignment only"}`
    }));
  }
  if (assigneeType === "staff") {
    return (directory.staff || [])
      .filter(item => ["active", "on_call"].includes(item.status))
      .map(item => {
        const roles = (item.roles || []).join(", ");
        return {
          ...item,
          label: `${item.name}${roles ? ` · ${roles}` : ""} · ${item.emailAvailable ? "notifications ready" : "assignment only"}`
        };
      });
  }
  if (assigneeType === "volunteer") {
    return (directory.volunteers || [])
      .filter(item => !["no_show", "withdrawn", "inactive"].includes(item.status))
      .map(item => {
        const roles = (item.roles || []).join(", ");
        return {
          ...item,
          label: `${item.name}${roles ? ` · ${roles}` : ""} · ${item.emailAvailable ? "notifications ready" : "assignment only"}`
        };
      });
  }
  return [];
}

function populateTaskCreateOwners(payload, { preserve = true } = {}) {
  const form = document.querySelector("#admin-create-task");
  const type = form?.querySelector('[name="assigneeType"]');
  const owner = form?.querySelector('[name="assigneeId"]');
  if (!type || !owner) return;
  const previous = preserve ? owner.value : "";
  const options = taskCreateAssignmentOptions(payload, type.value);
  if (type.value === "unassigned") {
    owner.innerHTML = '<option value="">No owner</option>';
    owner.disabled = true;
    owner.required = false;
    return;
  }
  owner.innerHTML = options.length
    ? options.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)}</option>`).join("")
    : '<option value="">No eligible owners available</option>';
  owner.disabled = options.length === 0;
  owner.required = options.length > 0;
  if (options.some(item => item.id === previous)) owner.value = previous;
}

function populateTaskAssignmentDirectory(payload) {
  const datalist = document.querySelector("#admin-task-assignee-options");
  const teams = payload.assignmentDirectory?.teams || [];
  const staff = payload.assignmentDirectory?.staff || [];
  const volunteers = payload.assignmentDirectory?.volunteers || [];
  if (datalist) {
    datalist.innerHTML = [
      ...teams.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`),
      ...staff.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} · ${escapeHtml((item.roles || []).join(", "))}</option>`),
      ...volunteers.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} · ${escapeHtml((item.roles || []).join(", "))}</option>`)
    ].join("");
  }
  populateTaskCreateOwners(payload);
}

function renderAdminTaskBoard(payload) {
  const tasks = document.querySelector("#admin-partner-tasks");
  const summary = document.querySelector("#admin-task-board-summary");
  if (!tasks) return;
  const now = new Date();
  const allTasks = payload.tasks || [];
  const query = taskBoardFilters.query.toLowerCase();
  const visible = allTasks.filter(task => {
    const dueState = taskDueState(task, now);
    const statusMatch = taskBoardFilters.status === "all"
      || (taskBoardFilters.status === "active" && ["open", "in_progress", "blocked"].includes(task.status))
      || taskBoardFilters.status === task.status
      || (taskBoardFilters.status === "overdue" && dueState === "overdue")
      || (taskBoardFilters.status === "today" && dueState === "today");
    const assignment = taskAssignmentType(task);
    const assignmentMatch = taskBoardFilters.assignment === "all" || taskBoardFilters.assignment === assignment;
    const haystack = [task.title, task.description, task.assigneeName, task.assigneeId, task.assigneeRole].filter(Boolean).join(" ").toLowerCase();
    return statusMatch && assignmentMatch && (!query || haystack.includes(query));
  }).sort((a, b) => {
    const rank = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, complete: 4 };
    return rank[taskDueState(a, now)] - rank[taskDueState(b, now)]
      || String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999"))
      || String(a.title).localeCompare(String(b.title));
  });
  const board = payload.taskBoard?.totals || {};
  if (summary) summary.textContent = `${board.active || 0} active · ${board.overdue || 0} overdue · ${board.dueToday || 0} due today · ${board.unassigned || 0} unassigned`;
  tasks.innerHTML = visible.map(task => {
    const assignmentType = taskAssignmentType(task);
    const dueState = taskDueState(task, now);
    const owner = task.assigneeName || task.assigneeId || task.assigneeRole || "Unassigned";
    const notification = (payload.followups || [])
      .filter(item => item.taskId === task.id)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0];
    const notificationState = notification?.deliveryStatus || notification?.status || (assignmentType === "unassigned" ? "not_configured" : "awaiting_directory");
    const currentUpdates = (task.assigneeUpdates || []).filter(item => Number(item.assignmentVersion || 1) === Number(task.assignmentVersion || 1));
    const latestUpdate = currentUpdates[currentUpdates.length - 1];
    const responseState = task.acknowledgedAt
      ? `Acknowledged ${taskTimeLabel(task.acknowledgedAt)}${latestUpdate ? ` · ${conditionLabel(latestUpdate.action)} ${taskTimeLabel(latestUpdate.at)}` : ""}`
      : assignmentType === "unassigned" ? "No assignee response expected" : "Awaiting assignee acknowledgement";
    return `<article class="admin-task-card" data-task="${escapeAttr(task.id)}" data-due-state="${escapeAttr(dueState)}" data-priority="${escapeAttr(task.priority || "normal")}">
      <header><div><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(conditionLabel(task.priority || "normal"))} priority</span></div><b>${escapeHtml(conditionLabel(task.status))}</b></header>
      <p>${escapeHtml(owner)} · ${escapeHtml(conditionLabel(assignmentType))} · ${task.dueAt ? `Due ${escapeHtml(new Date(task.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}` : "No due date"}</p>
      <span>Notification · ${escapeHtml(conditionLabel(notificationState))}${notification?.kind ? ` · ${escapeHtml(conditionLabel(notification.kind))}` : ""}</span>
      <span>Assignee response · ${escapeHtml(responseState)}</span>
      ${latestUpdate?.note ? `<blockquote class="admin-task-assignee-note"><strong>Latest assignee note</strong><span>${escapeHtml(latestUpdate.note)}</span></blockquote>` : ""}
      ${task.description ? `<span>${escapeHtml(task.description)}</span>` : ""}
      <div class="admin-task-controls">
        <select name="status" aria-label="${escapeAttr(task.title)} status">${taskStatusOptions(task.status)}</select>
        <select name="assigneeType" aria-label="${escapeAttr(task.title)} assignment type">${taskAssignmentOptions(assignmentType)}</select>
        <input name="assigneeId" list="admin-task-assignee-options" value="${escapeAttr(task.assigneeId || "")}" aria-label="${escapeAttr(task.title)} owner" />
        <input name="dueAt" type="datetime-local" value="${escapeAttr(taskDateTimeInput(task.dueAt))}" aria-label="${escapeAttr(task.title)} due date" />
        <select name="priority" aria-label="${escapeAttr(task.title)} priority">${taskPriorityOptions(task.priority)}</select>
        <button type="button" class="button secondary" data-save-task="${escapeAttr(task.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Save task</button>
      </div>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No tasks match these filters.</span></article>';

  tasks.querySelectorAll("[data-save-task]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-task]");
    const dueAtValue = card.querySelector('[name="dueAt"]').value;
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/tasks/${encodeURIComponent(button.dataset.saveTask)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: card.querySelector('[name="status"]').value,
          assigneeType: card.querySelector('[name="assigneeType"]').value,
          assigneeId: card.querySelector('[name="assigneeId"]').value.trim(),
          dueAt: dueAtValue ? new Date(dueAtValue).toISOString() : null,
          priority: card.querySelector('[name="priority"]').value
        })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Task assignment saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
}

function milestoneStatusOptions(selected) {
  return [["open", "Open"], ["completed", "Completed"], ["cancelled", "Cancelled"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function milestoneTeamOptions(selected) {
  return [["operations", "Operations"], ["sponsor", "Sponsor"], ["finance", "Finance"], ["volunteer-captains", "Volunteer captains"], ["traffic", "Traffic and parking"], ["guest-services", "Guest services"], ["production", "Production"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderAdminMilestones(payload) {
  const target = document.querySelector("#admin-partner-milestones");
  const summary = document.querySelector("#admin-key-date-summary");
  const createForm = document.querySelector("#admin-create-milestone");
  if (!target || !createForm) return;
  const applications = payload.applications || [];
  const milestones = payload.milestones || [];
  const totals = payload.milestoneSummary?.totals || {};
  if (summary) summary.textContent = `${totals.open || 0} open · ${totals.overdue || 0} overdue · ${totals.dueSoon || 0} due soon · ${totals.completed || 0} completed`;
  createForm.elements.applicationId.innerHTML = `<option value="">Partner account</option>${applications.map(application => `<option value="${escapeAttr(application.id)}">${escapeHtml(application.organizationName)} · ${escapeHtml(application.reference)}</option>`).join("")}`;
  const rank = { open: 0, completed: 1, cancelled: 2 };
  target.innerHTML = milestones.slice().sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(a.dueAt).localeCompare(String(b.dueAt))).map(item => {
    const application = applications.find(candidate => candidate.id === item.applicationId);
    const reminder = (payload.followups || []).filter(candidate => candidate.milestoneId === item.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const dueState = taskDueState(item);
    return `<article class="admin-key-date-card" data-admin-milestone="${escapeAttr(item.id)}" data-due-state="${escapeAttr(dueState)}">
      <header><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(application?.organizationName || "Unknown partner")} · ${escapeHtml(application?.reference || item.applicationId)}</span></div><b>${escapeHtml(conditionLabel(item.status))}</b></header>
      <div class="admin-key-date-controls">
        <input name="label" maxlength="160" value="${escapeAttr(item.label)}" aria-label="Milestone label" />
        <select name="status" aria-label="Milestone status">${milestoneStatusOptions(item.status)}</select>
        <select name="assigneeTeam" aria-label="Responsible team">${milestoneTeamOptions(item.assigneeTeam || (application?.type === "sponsor" ? "sponsor" : "operations"))}</select>
        <input name="dueAt" type="datetime-local" value="${escapeAttr(taskDateTimeInput(item.dueAt))}" aria-label="Milestone due date" />
        <label><span>Lead days</span><input name="reminderLeadDays" type="number" min="0" max="30" step="1" value="${escapeAttr(item.reminderLeadDays ?? 3)}" /></label>
        <input name="notes" maxlength="1000" value="${escapeAttr(item.notes || "")}" placeholder="Internal note" aria-label="Milestone internal note" />
        <button type="button" class="button secondary" data-save-milestone="${escapeAttr(item.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Save date</button>
      </div>
      <small>${dueState === "overdue" ? "Overdue" : dueState === "today" ? "Due today" : `Due ${escapeHtml(new Date(item.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}`} · ${escapeHtml(conditionLabel(item.assigneeTeam || "operations"))}${reminder ? ` · latest reminder ${escapeHtml(conditionLabel(reminder.reminderPhase || reminder.status))} (${escapeHtml(conditionLabel(reminder.status))})` : " · reminder not generated"}</small>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No partner key dates configured.</span></article>';

  target.querySelectorAll("[data-save-milestone]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-admin-milestone]");
    const dueAt = card.querySelector('[name="dueAt"]').value;
    if (!dueAt) { setAdminStatus("Choose a due date for this milestone.", "error"); return; }
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/milestones/${encodeURIComponent(button.dataset.saveMilestone)}`, {
        method: "PATCH",
        body: JSON.stringify({
          label: card.querySelector('[name="label"]').value.trim(),
          status: card.querySelector('[name="status"]').value,
          assigneeTeam: card.querySelector('[name="assigneeTeam"]').value,
          dueAt: new Date(dueAt).toISOString(),
          reminderLeadDays: Number(card.querySelector('[name="reminderLeadDays"]').value),
          notes: card.querySelector('[name="notes"]').value.trim()
        })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(result.dismissedFollowups ? `Key date saved; ${result.dismissedFollowups} stale reminder${result.dismissedFollowups === 1 ? "" : "s"} dismissed.` : "Key date saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  createForm.onsubmit = async event => {
    event.preventDefault();
    const button = createForm.querySelector('button[type="submit"]');
    const dueAt = createForm.elements.dueAt.value;
    if (!createForm.elements.applicationId.value || !dueAt) { setAdminStatus("Choose a partner and due date.", "error"); return; }
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(createForm.elements.applicationId.value)}/milestones`, {
        method: "POST",
        body: JSON.stringify({
          label: createForm.elements.label.value.trim(),
          dueAt: new Date(dueAt).toISOString(),
          assigneeTeam: createForm.elements.assigneeTeam.value,
          reminderLeadDays: Number(createForm.elements.reminderLeadDays.value)
        })
      });
      createForm.reset();
      createForm.elements.reminderLeadDays.value = "3";
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Partner key date added.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  };
}

function deliverableStatusOptions(selected) {
  return ["planned", "awaiting_assets", "ready", "in_production", "scheduled", "published", "complete", "cancelled"]
    .map(value => `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("");
}

function brandAssetStatusOptions(selected) {
  return ["under_review", "approved", "changes_requested", "rejected", "archived"]
    .map(value => `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("");
}

function vendorRequirementStatusOptions(selected, hasDocument) {
  return [
    ...(hasDocument ? [["under_review", "Under review"], ["approved", "Approved"], ["changes_requested", "Changes requested"], ["expired", "Expired"]] : []),
    ["waived", "Waived"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function vendorAssignmentStatusOptions(selected) {
  return ["unassigned", "scheduled", "confirmed", "checked_in", "complete", "cancelled"]
    .map(value => `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("");
}

function renderAdminVendorReadiness(payload) {
  const target = document.querySelector("#admin-vendor-readiness");
  const summary = document.querySelector("#admin-vendor-readiness-summary");
  if (!target) return;
  const readiness = payload.vendorReadiness || { totals: {}, vendors: [] };
  const totals = readiness.totals || {};
  const vendorApplications = (payload.applications || []).filter(item => item.type === "vendor" && item.intakeMode !== "interest");
  if (summary) summary.textContent = `${totals.ready || 0}/${totals.vendors || 0} ready · ${totals.interests || 0} interests · ${totals.requirementsMissing || 0} missing · ${totals.requirementsAwaitingReview || 0} awaiting review · ${totals.assignmentsUnconfirmed || 0} assignments unconfirmed`;
  target.innerHTML = vendorApplications.map(application => {
    const state = (readiness.vendors || []).find(item => item.applicationId === application.id) || {};
    const profile = (payload.vendorProfiles || []).find(item => item.applicationId === application.id);
    const requirements = (payload.vendorRequirements || []).filter(item => item.applicationId === application.id);
    const documents = payload.vendorDocuments || [];
    const assignment = (payload.vendorAssignments || []).find(item => item.applicationId === application.id) || { status: "unassigned" };
    return `<article class="admin-vendor-account" data-admin-vendor="${escapeAttr(application.id)}" data-status="${escapeAttr(state.status || "blocked")}">
      <header><div><strong>${escapeHtml(application.organizationName)}</strong><span>${escapeHtml(conditionLabel(application.category || "vendor"))} · ${escapeHtml(application.reference)}</span></div><b data-status="${escapeAttr(state.status || "blocked")}">${escapeHtml(conditionLabel(state.status || "blocked"))}</b></header>
      <div class="admin-vendor-readiness-strip"><span>${state.compliance?.approved || 0}/${state.compliance?.required || requirements.length} compliance</span><span>${escapeHtml(conditionLabel(state.profileStatus || "missing"))} profile</span><span>${escapeHtml(conditionLabel(state.assignmentStatus || "unassigned"))} load-in</span></div>
      <section class="admin-vendor-profile" data-admin-vendor-profile="${escapeAttr(application.id)}">
        <div><strong>Operating profile</strong><b data-status="${escapeAttr(profile?.status || "missing")}">${escapeHtml(conditionLabel(profile?.status || "missing"))}</b></div>
        ${profile ? `<p>${escapeHtml([profile.legalName, profile.boothName, profile.website].filter(Boolean).join(" · "))}</p><small>${escapeHtml(profile.publicDescription || "")}</small><dl><div><dt>Emergency</dt><dd>${escapeHtml(profile.emergencyContactName)} · ${escapeHtml(profile.emergencyContactPhone)}</dd></div><div><dt>Utilities</dt><dd>${escapeHtml(conditionLabel(profile.powerNeed))} power · ${profile.waterRequired ? "water requested" : "no water"} · ${escapeHtml(conditionLabel(profile.cookingMethod))} cooking</dd></div><div><dt>Vehicle</dt><dd>${profile.vehicleLengthFeet === null ? "Not listed" : `${profile.vehicleLengthFeet} ft`}</dd></div></dl>` : '<p class="empty-state">Awaiting vendor submission.</p>'}
        ${profile && ["submitted", "changes_requested"].includes(profile.status) ? `<div class="admin-vendor-profile-controls"><input name="reviewNotes" maxlength="1000" value="${escapeAttr(profile.reviewNotes || "")}" placeholder="Required for requested changes" aria-label="${escapeAttr(application.organizationName)} operating profile review notes" /><button type="button" class="button primary" data-review-vendor-profile="approve">Approve</button><button type="button" class="button secondary" data-review-vendor-profile="request_changes">Request changes</button></div>` : ""}
      </section>
      <section class="admin-vendor-requirements"><strong>Compliance packet</strong>${requirements.map(requirement => {
        const document = documents.find(item => item.id === requirement.currentDocumentId);
        return `<div data-admin-vendor-requirement="${escapeAttr(requirement.id)}"><header><div><span>${escapeHtml(requirement.label)}</span><small>${requirement.dueAt ? `Due ${escapeHtml(portalDate(requirement.dueAt))}` : "Required before load-in"}</small></div><b data-status="${escapeAttr(requirement.status)}">${escapeHtml(conditionLabel(requirement.status))}</b></header>
          ${document ? `<p>${escapeHtml(document.label)}${document.fileName ? ` · ${escapeHtml(document.fileName)}` : ""}</p>` : '<p>No document submitted.</p>'}
          <div class="admin-vendor-requirement-controls">
            <select name="status" aria-label="${escapeAttr(requirement.label)} review status">${vendorRequirementStatusOptions(requirement.status, Boolean(document))}</select>
            <input name="expiresAt" type="date" value="${escapeAttr(requirement.expiresAt ? String(requirement.expiresAt).slice(0, 10) : "")}" aria-label="${escapeAttr(requirement.label)} expiration" />
            <input name="reviewNotes" maxlength="1000" value="${escapeAttr(requirement.reviewNotes || "")}" placeholder="Decision note" aria-label="${escapeAttr(requirement.label)} review notes" />
            ${document?.sourceType === "upload" ? `<button type="button" class="button secondary" data-admin-download-vendor-document="${escapeAttr(document.id)}" data-file-name="${escapeAttr(document.fileName || document.label)}">Download</button>` : document ? `<a class="button secondary" href="${escapeAttr(document.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}
            <button type="button" class="button primary" data-save-vendor-requirement="${escapeAttr(requirement.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Save review</button>
          </div>
        </div>`;
      }).join("") || '<span class="empty-state">No requirements configured.</span>'}</section>
      <section class="admin-vendor-assignment" data-admin-vendor-assignment="${escapeAttr(application.id)}">
        <strong>Booth and load-in</strong>
        <div class="admin-vendor-assignment-fields">
          <label><span>Status</span><select name="status">${vendorAssignmentStatusOptions(assignment.status)}</select></label>
          <label><span>Booth</span><input name="boothNumber" maxlength="80" value="${escapeAttr(assignment.boothNumber || "")}" /></label>
          <label><span>Zone</span><input name="zone" maxlength="120" value="${escapeAttr(assignment.zone || "")}" /></label>
          <label><span>Access gate</span><input name="accessGate" maxlength="120" value="${escapeAttr(assignment.accessGate || "")}" /></label>
          <label><span>Load-in starts</span><input name="loadInStart" type="datetime-local" value="${escapeAttr(taskDateTimeInput(assignment.loadInStart))}" /></label>
          <label><span>Load-in ends</span><input name="loadInEnd" type="datetime-local" value="${escapeAttr(taskDateTimeInput(assignment.loadInEnd))}" /></label>
          <label><span>Load-out starts</span><input name="loadOutStart" type="datetime-local" value="${escapeAttr(taskDateTimeInput(assignment.loadOutStart))}" /></label>
          <label><span>Load-out ends</span><input name="loadOutEnd" type="datetime-local" value="${escapeAttr(taskDateTimeInput(assignment.loadOutEnd))}" /></label>
          <label><span>Parking passes</span><input name="parkingPasses" type="number" min="0" max="50" value="${escapeAttr(assignment.parkingPasses ?? 0)}" /></label>
          <label><span>Staff wristbands</span><input name="staffWristbands" type="number" min="0" max="50" value="${escapeAttr(assignment.staffWristbands ?? 0)}" /></label>
          <label class="admin-vendor-wide"><span>Instructions</span><textarea name="instructions" rows="3" maxlength="2000">${escapeHtml(assignment.instructions || "")}</textarea></label>
        </div>
        ${assignment.partnerConfirmedAt ? `<small>Vendor confirmed ${escapeHtml(new Date(assignment.partnerConfirmedAt).toLocaleString())}</small>` : ""}
        <button type="button" class="button primary" data-save-vendor-assignment="${escapeAttr(application.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Publish assignment</button>
      </section>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No vendor applications yet.</span></article>';

  target.querySelectorAll("[data-review-vendor-profile]").forEach(button => button.addEventListener("click", async () => {
    const section = button.closest("[data-admin-vendor-profile]");
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(section.dataset.adminVendorProfile)}/vendor-profile/review`, { method: "POST", body: JSON.stringify({ action: button.dataset.reviewVendorProfile, reviewNotes: section.querySelector('[name="reviewNotes"]')?.value.trim() || "" }) });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(result.notificationDrafted ? "Vendor profile changes saved and a message draft is ready for review." : "Vendor operating profile review saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-save-vendor-requirement]").forEach(button => button.addEventListener("click", async () => {
    const row = button.closest("[data-admin-vendor-requirement]");
    const expiresAt = row.querySelector('[name="expiresAt"]').value;
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/vendor-requirements/${encodeURIComponent(button.dataset.saveVendorRequirement)}`, { method: "PATCH", body: JSON.stringify({ status: row.querySelector('[name="status"]').value, expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null, reviewNotes: row.querySelector('[name="reviewNotes"]').value.trim() }) });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(result.notificationDrafted ? "Vendor compliance decision saved and a message draft is ready for review." : "Vendor compliance decision saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-admin-download-vendor-document]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await adminRawFetch(`/api/admin/partners/vendor-documents/${encodeURIComponent(button.dataset.adminDownloadVendorDocument)}/content`);
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Document download failed with ${response.status}`); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = button.dataset.fileName || "vendor-document";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-save-vendor-assignment]").forEach(button => button.addEventListener("click", async () => {
    const section = button.closest("[data-admin-vendor-assignment]");
    const value = name => section.querySelector(`[name="${name}"]`).value;
    const dateValue = name => value(name) ? new Date(value(name)).toISOString() : null;
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(button.dataset.saveVendorAssignment)}/vendor-assignment`, { method: "PATCH", body: JSON.stringify({ status: value("status"), boothNumber: value("boothNumber").trim(), zone: value("zone").trim(), accessGate: value("accessGate").trim(), loadInStart: dateValue("loadInStart"), loadInEnd: dateValue("loadInEnd"), loadOutStart: dateValue("loadOutStart"), loadOutEnd: dateValue("loadOutEnd"), parkingPasses: value("parkingPasses"), staffWristbands: value("staffWristbands"), instructions: value("instructions").trim() }) });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(result.notificationDrafted ? "Vendor assignment published and a confirmation message draft is ready for review." : "Vendor booth and load-in assignment published.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
}

function renderAdminSponsorFulfillment(payload) {
  const target = document.querySelector("#admin-sponsor-fulfillment");
  const summary = document.querySelector("#admin-fulfillment-summary");
  if (!target) return;
  const fulfillment = payload.fulfillment || payload.summary?.fulfillment || {};
  const sponsorApplications = (payload.applications || []).filter(item => item.type === "sponsor");
  const profileSummary = fulfillment.profiles || {};
  const assetSummary = fulfillment.assets || {};
  const deliverableSummary = fulfillment.deliverables || {};
  if (summary) summary.textContent = `${profileSummary.submitted || 0} profiles pending · ${assetSummary.awaitingReview || 0} assets pending · ${deliverableSummary.awaitingPartnerReview || 0} proofs awaiting sign-off`;
  target.innerHTML = sponsorApplications.map(application => {
    const profile = (payload.brandProfiles || []).find(item => item.applicationId === application.id);
    const assets = (payload.brandAssets || []).filter(item => item.applicationId === application.id && item.status !== "archived");
    const deliverables = (payload.deliverables || []).filter(item => item.applicationId === application.id && item.status !== "cancelled");
    return `<article class="admin-sponsor-account" data-sponsor-fulfillment="${escapeAttr(application.id)}">
      <header><div><strong>${escapeHtml(application.organizationName)}</strong><span>${escapeHtml(application.packageName || conditionLabel(application.packageId || "custom"))} · ${escapeHtml(application.reference)}</span></div><b>${deliverables.filter(item => item.status === "complete").length}/${deliverables.length} complete</b></header>
      <div class="admin-brand-profile" data-brand-profile="${escapeAttr(application.id)}">
        <div><strong>Brand profile</strong><span data-status="${escapeAttr(profile?.status || "draft")}">${escapeHtml(conditionLabel(profile?.status || "draft"))}</span></div>
        ${profile ? `<p>${escapeHtml([profile.displayName, profile.website, profile.tagline].filter(Boolean).join(" · "))}</p>${profile.usageNotes ? `<small>${escapeHtml(profile.usageNotes)}</small>` : ""}` : "<p>Awaiting sponsor submission.</p>"}
        ${profile?.status === "submitted" || profile?.status === "changes_requested" ? `<div class="admin-brand-review-controls"><input name="reviewNotes" maxlength="1000" placeholder="Review note for requested changes" aria-label="${escapeAttr(application.organizationName)} brand profile review notes" /><button type="button" class="button primary" data-review-brand-profile="approve">Approve</button><button type="button" class="button secondary" data-review-brand-profile="request_changes">Request changes</button></div>` : ""}
      </div>
      <div class="admin-brand-assets"><strong>Brand assets</strong>${assets.map(asset => `<div data-admin-brand-asset="${escapeAttr(asset.id)}">
        <div><span>${escapeHtml(asset.label)} · ${escapeHtml(conditionLabel(asset.kind))}${asset.fileName ? ` · ${escapeHtml(asset.fileName)}` : ""}</span><b data-status="${escapeAttr(asset.status)}">${escapeHtml(conditionLabel(asset.status))}</b></div>
        ${asset.reviewNotes ? `<small>${escapeHtml(asset.reviewNotes)}</small>` : ""}
        <div class="admin-brand-asset-controls">
          <select name="status" aria-label="${escapeAttr(asset.label)} review status">${brandAssetStatusOptions(asset.status)}</select>
          <input name="reviewNotes" maxlength="1000" value="${escapeAttr(asset.reviewNotes || "")}" placeholder="Review note" aria-label="${escapeAttr(asset.label)} review notes" />
          ${asset.sourceType === "upload" ? `<button type="button" class="button secondary" data-admin-download-brand-asset="${escapeAttr(asset.id)}" data-file-name="${escapeAttr(asset.fileName || asset.label)}">Download</button>` : `<a class="button secondary" href="${escapeAttr(asset.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`}
          <button type="button" class="button primary" data-save-brand-asset="${escapeAttr(asset.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Save review</button>
        </div>
      </div>`).join("") || '<span class="empty-state">No assets submitted.</span>'}</div>
      <div class="admin-deliverables"><strong>Benefit delivery</strong>${deliverables.map(item => `<div data-admin-deliverable="${escapeAttr(item.id)}">
        <header><div><span>${escapeHtml(item.label)}</span><small>${item.source === "package_benefit" ? "Package benefit" : "Custom deliverable"}</small></div><b data-status="${escapeAttr(item.partnerReviewStatus)}">${escapeHtml(conditionLabel(item.partnerReviewStatus))}</b></header>
        ${item.partnerReviewNotes ? `<p>${escapeHtml(item.partnerReviewNotes)}</p>` : ""}
        <div class="admin-deliverable-controls">
          <select name="status" aria-label="${escapeAttr(item.label)} status">${deliverableStatusOptions(item.status)}</select>
          <input name="ownerId" maxlength="100" value="${escapeAttr(item.ownerId || "")}" placeholder="Owner" aria-label="${escapeAttr(item.label)} owner" />
          <input name="dueAt" type="datetime-local" value="${escapeAttr(taskDateTimeInput(item.dueAt))}" aria-label="${escapeAttr(item.label)} due date" />
          <input name="proofUrl" type="url" maxlength="1000" value="${escapeAttr(item.proofUrl || "")}" placeholder="https:// proof" aria-label="${escapeAttr(item.label)} delivery proof URL" />
          <textarea name="proofNotes" rows="2" maxlength="1000" placeholder="Delivery proof note" aria-label="${escapeAttr(item.label)} delivery proof notes">${escapeHtml(item.proofNotes || "")}</textarea>
          <button type="button" class="button primary" data-save-deliverable="${escapeAttr(item.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Save deliverable</button>
        </div>
      </div>`).join("") || '<span class="empty-state">No package benefits configured.</span>'}</div>
      <form class="admin-custom-deliverable" data-create-deliverable="${escapeAttr(application.id)}">
        <strong>Add custom deliverable</strong>
        <input name="label" required maxlength="160" placeholder="Deliverable" aria-label="${escapeAttr(application.organizationName)} custom deliverable" />
        <input name="ownerId" maxlength="100" placeholder="Owner" aria-label="${escapeAttr(application.organizationName)} custom deliverable owner" />
        <input name="dueAt" type="datetime-local" aria-label="${escapeAttr(application.organizationName)} custom deliverable due date" />
        <input name="description" maxlength="1000" placeholder="Scope" aria-label="${escapeAttr(application.organizationName)} custom deliverable scope" />
        <button class="button secondary" type="submit" ${adminCan("partners:write") ? "" : "disabled"}>Add</button>
      </form>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No sponsor applications yet.</span></article>';

  target.querySelectorAll("[data-review-brand-profile]").forEach(button => button.addEventListener("click", async () => {
    const profile = button.closest("[data-brand-profile]");
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(profile.dataset.brandProfile)}/brand-profile/review`, {
        method: "POST",
        body: JSON.stringify({ action: button.dataset.reviewBrandProfile, reviewNotes: profile.querySelector('[name="reviewNotes"]')?.value.trim() || "" })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Brand profile review saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-save-brand-asset]").forEach(button => button.addEventListener("click", async () => {
    const row = button.closest("[data-admin-brand-asset]");
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/brand-assets/${encodeURIComponent(button.dataset.saveBrandAsset)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: row.querySelector('[name="status"]').value, reviewNotes: row.querySelector('[name="reviewNotes"]').value.trim() })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Brand asset review saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-admin-download-brand-asset]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await adminRawFetch(`/api/admin/partners/brand-assets/${encodeURIComponent(button.dataset.adminDownloadBrandAsset)}/content`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Asset download failed with ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = button.dataset.fileName || "brand-asset";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-save-deliverable]").forEach(button => button.addEventListener("click", async () => {
    const row = button.closest("[data-admin-deliverable]");
    const dueAt = row.querySelector('[name="dueAt"]').value;
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/deliverables/${encodeURIComponent(button.dataset.saveDeliverable)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: row.querySelector('[name="status"]').value,
          ownerId: row.querySelector('[name="ownerId"]').value.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          proofUrl: row.querySelector('[name="proofUrl"]').value.trim(),
          proofNotes: row.querySelector('[name="proofNotes"]').value.trim()
        })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Sponsor deliverable saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  target.querySelectorAll("[data-create-deliverable]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const dueAt = form.elements.dueAt.value;
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(form.dataset.createDeliverable)}/deliverables`, {
        method: "POST",
        body: JSON.stringify({ label: form.elements.label.value.trim(), ownerId: form.elements.ownerId.value.trim(), dueAt: dueAt ? new Date(dueAt).toISOString() : null, description: form.elements.description.value.trim() })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Custom sponsor deliverable added.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
}

function renderAdminReceivables(payload) {
  const receivables = payload.receivables;
  const summary = document.querySelector("#admin-receivables-summary");
  const agingTarget = document.querySelector("#admin-receivables-aging");
  const accountsTarget = document.querySelector("#admin-receivables-accounts");
  const exceptionsTarget = document.querySelector("#admin-receivables-exceptions");
  if (!receivables || !summary || !agingTarget || !accountsTarget || !exceptionsTarget) return;
  const totals = receivables.totals || {};
  const aging = receivables.aging || {};
  summary.textContent = `${adminMoney(totals.outstandingCents, "$0.00")} outstanding · ${adminMoney(totals.overdueCents, "$0.00")} overdue · ${totals.exceptions || 0} exceptions`;
  agingTarget.innerHTML = [
    ["Current", aging.currentCents],
    ["1-30 days", aging.days1To30Cents],
    ["31-60 days", aging.days31To60Cents],
    ["61-90 days", aging.days61To90Cents],
    ["90+ days", aging.days90PlusCents],
    ["Unbilled", aging.unbilledCents]
  ].map(([label, amount]) => `<article><span>${escapeHtml(label)}</span><strong>${adminMoney(amount, "$0.00")}</strong></article>`).join("");
  const openAccounts = (receivables.accounts || []).filter(item => item.balanceCents > 0 || item.creditCents > 0 || item.unappliedAmountCents > 0);
  accountsTarget.innerHTML = openAccounts.map(account => `<article data-reconciliation="${escapeAttr(account.reconciliationStatus)}">
    <header><div><strong>${escapeHtml(account.organizationName)}</strong><span>${escapeHtml(account.reference)} · ${escapeHtml(conditionLabel(account.agingBucket))}</span></div><b>${adminMoney(account.balanceCents, "$0.00")}</b></header>
    <p>${adminMoney(account.paidAmountCents, "$0.00")} paid of ${adminMoney(account.expectedAmountCents, "$0.00")} · ${escapeHtml(conditionLabel(account.reconciliationStatus))}</p>
    ${account.invoice ? `<span>${escapeHtml(conditionLabel(account.invoice.status))} invoice · due ${escapeHtml(new Date(account.invoice.dueAt).toLocaleDateString())}${account.daysOverdue ? ` · ${account.daysOverdue} days overdue` : ""}</span>` : `<span>${escapeHtml(conditionLabel(account.applicationStatus))} · no active invoice</span>`}
  </article>`).join("") || '<article class="empty-state"><span>No open receivable accounts.</span></article>';
  exceptionsTarget.innerHTML = (receivables.exceptions || []).map(item => `<article data-severity="${escapeAttr(item.severity)}">
    <header><strong>${escapeHtml(conditionLabel(item.type))}</strong><b>${adminMoney(item.amountCents, "$0.00")}</b></header>
    <p>${escapeHtml(item.message)}</p>
  </article>`).join("") || '<article class="empty-state"><span>Balances reconcile with no active exceptions.</span></article>';
}

function renderAdminQuickBooksConnection(quickbooks = {}) {
  const container = document.querySelector("#admin-quickbooks-connection");
  const status = document.querySelector("#admin-quickbooks-status");
  const connectButton = document.querySelector("#admin-connect-quickbooks");
  const refreshButton = document.querySelector("#admin-refresh-quickbooks");
  const disconnectButton = document.querySelector("#admin-disconnect-quickbooks");
  if (!container || !status || !connectButton || !refreshButton || !disconnectButton) return;

  const canFinance = adminCan("finance:write");
  const canRead = adminCan("partners:read");
  const deferredForBoard = BOARD_DEMO_ACCESS.enabled
    && !quickbooks.connected
    && !quickbooks.canSyncPartnerInvoices;
  const refreshedAt = quickbooks.lastRefreshedAt
    ? new Date(quickbooks.lastRefreshedAt).toLocaleString()
    : null;
  status.textContent = deferredForBoard
    ? "Provider connection is deferred until post-presentation setup. Site-native invoices, payments, aging, and reconciliation remain active."
    : quickbooks.connected
    ? `Connected securely · encrypted ${quickbooks.credentialStorage === "postgres" ? "Postgres" : "local"} credential${refreshedAt ? ` · refreshed ${refreshedAt}` : ""}`
    : quickbooks.canSyncPartnerInvoices && quickbooks.credentialSource === "environment"
      ? "Connected through deployment secret"
      : quickbooks.oauthReady
        ? `Ready to connect · ${quickbooks.environment || "sandbox"}`
        : quickbooks.oauthReason || quickbooks.reason || "QuickBooks is not configured.";
  container.dataset.state = deferredForBoard
    ? "deferred"
    : quickbooks.connected || quickbooks.canSyncPartnerInvoices
      ? "connected"
      : quickbooks.oauthReady ? "ready" : "unavailable";

  connectButton.hidden = deferredForBoard || quickbooks.connected === true;
  connectButton.disabled = deferredForBoard || !canFinance || !quickbooks.oauthReady || quickbooks.connected === true;
  disconnectButton.hidden = quickbooks.connected !== true;
  disconnectButton.disabled = !canFinance || quickbooks.connected !== true;
  refreshButton.disabled = !canRead;

  refreshButton.onclick = async () => {
    refreshButton.disabled = true;
    try {
      const result = await adminFetch("/api/admin/integrations/quickbooks");
      if (adminPartnerState?.payload) adminPartnerState.payload.quickbooks = result.quickbooks;
      renderAdminQuickBooksConnection(result.quickbooks);
      setAdminStatus(result.quickbooks.connected ? "QuickBooks connection is healthy." : "QuickBooks connection status refreshed.", "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      refreshButton.disabled = !adminCan("partners:read");
    }
  };

  connectButton.onclick = async () => {
    const popup = window.open("about:blank", "sandfest-quickbooks-connect", "popup,width=720,height=780");
    if (!popup) {
      setAdminStatus("QuickBooks connection window could not be opened.", "error");
      return;
    }
    connectButton.disabled = true;
    try {
      const result = await adminFetch("/api/admin/integrations/quickbooks/authorize", { method: "POST" });
      popup.opener = null;
      popup.location.replace(result.authorizationUrl);
      setAdminStatus("QuickBooks authorization is in progress.", "idle");
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 2_000));
        const current = await adminFetch("/api/admin/integrations/quickbooks");
        if (current.quickbooks.connected) {
          await loadAdminPartners({ quiet: true });
          setAdminStatus("QuickBooks accounting is connected and ready.", "ok");
          return;
        }
      }
      setAdminStatus("QuickBooks authorization is still pending. Refresh the connection status after it is completed.", "warning");
    } catch (error) {
      if (!popup.closed) popup.close();
      setAdminStatus(error.message, "error");
    } finally {
      connectButton.disabled = deferredForBoard || !adminCan("finance:write") || !quickbooks.oauthReady;
    }
  };

  disconnectButton.onclick = async () => {
    if (!window.confirm("Disconnect the stored QuickBooks credential from SandFest? This does not revoke the authorization inside QuickBooks.")) return;
    disconnectButton.disabled = true;
    try {
      const result = await adminFetch("/api/admin/integrations/quickbooks/disconnect", {
        method: "POST",
        body: JSON.stringify({ confirm: true })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(
        result.quickbooks?.credentialSource === "environment"
          ? "Stored QuickBooks connection removed; the deployment-secret fallback remains active."
          : "QuickBooks was disconnected from SandFest.",
        "ok"
      );
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      disconnectButton.disabled = !adminCan("finance:write");
    }
  };
}

function partnerAutomationPresentation(payload, draftsAwaitingReview = 0) {
  const automation = payload?.automation || {};
  const mode = automation.mode || payload?.automationMode || "review_first";
  const providerReady = automation.providerReady === true;
  const active = mode === "transactional_auto" && automation.active === true;
  const reviewCount = Number(draftsAwaitingReview || 0);
  const reviewDetail = `${reviewCount} draft${reviewCount === 1 ? "" : "s"} awaiting staff review`;
  if (mode === "transactional_auto") {
    return {
      active,
      commandDetail: `${providerReady ? "Provider ready" : "Provider unavailable"} · ${active ? "automatic follow-up" : "automation paused"}`,
      detail: active ? reviewDetail : providerReady ? "Automation paused" : "Provider connection required",
      label: active ? "Automatic" : "Needs attention",
      mode
    };
  }
  return {
    active: false,
    commandDetail: `${providerReady ? "Provider ready" : "Provider unavailable"} · staff review required`,
    detail: reviewDetail,
    label: "Review first",
    mode
  };
}

function renderAdminCommandSummary(payload, outreach) {
  const target = document.querySelector("#admin-command-signals");
  const updated = document.querySelector("#admin-command-updated");
  if (!target || !updated) return;
  const summary = payload.summary || {};
  const applications = summary.applications || {};
  const finance = summary.finance || {};
  const operations = summary.operations || {};
  const taskBoard = payload.taskBoard || {};
  const taskTotals = taskBoard.totals || {};
  const assignmentTypes = new Set((taskBoard.workload || [])
    .filter(item => Number(item.open || 0) > 0)
    .map(item => item.assigneeType));
  const assignmentCoverage = ["staff", "volunteer", "team"].filter(type => assignmentTypes.has(type));
  const vendor = payload.vendorReadiness?.totals || summary.vendorReadiness || {};
  const fulfillment = summary.fulfillment || payload.fulfillment || {};
  const outreachSummary = outreach?.summary || {};
  const automationPresentation = partnerAutomationPresentation(payload, operations.draftsAwaitingReview);
  const automationReady = payload.automation?.providerReady === true
    && (automationPresentation.active || automationPresentation.mode === "review_first");
  const assignmentsReady = Number(taskTotals.active || 0) > 0
    && Number(taskTotals.unassigned || 0) === 0
    && assignmentCoverage.length === 3;
  const sponsorsReady = Number(fulfillment.profiles?.approved || 0) > 0
    && Number(fulfillment.assets?.approved || 0) > 0
    && Number(fulfillment.deliverables?.active || 0) > 0;
  const outreachReady = Number(outreachSummary.qualified || 0) > 0
    && Number(outreachSummary.nextActionsScheduled || 0) > 0
    && Number(outreachSummary.unassigned || 0) === 0;
  const signals = [
    {
      id: "applications",
      label: "Applications",
      value: `${Number(applications.total || 0)} active`,
      detail: `${Number(applications.vendors || 0)} vendors · ${Number(applications.sponsors || 0)} sponsors`,
      action: "View intake",
      href: "#admin-partner-applications-workspace",
      state: Number(applications.total || 0) > 0 ? "ready" : "idle"
    },
    {
      id: "receivables",
      label: "Receivables",
      value: adminMoney(finance.balanceCents, "$0.00"),
      detail: `${adminMoney(finance.amountPaidCents, "$0.00")} received of ${adminMoney(finance.amountExpectedCents, "$0.00")}`,
      action: "Open accounts",
      href: "#admin-receivables-workspace",
      state: Number(finance.amountExpectedCents || 0) > 0 ? "tracking" : "idle"
    },
    {
      id: "messages",
      label: "Messages",
      value: `${Number(operations.draftsAwaitingReview || 0)} to review`,
      detail: automationPresentation.commandDetail,
      action: "Review queue",
      href: "#admin-partner-followups-workspace",
      state: automationReady ? Number(operations.draftsAwaitingReview || 0) > 0 ? "attention" : "ready" : "blocked"
    },
    {
      id: "assignments",
      label: "Assignments",
      value: `${Number(taskTotals.active || 0)} active`,
      detail: `${Number(taskTotals.unassigned || 0)} unassigned · ${assignmentCoverage.join(" / ") || "No owners"}`,
      action: "Open work board",
      href: "#admin-partner-tasks-workspace",
      state: assignmentsReady ? "ready" : "attention"
    },
    {
      id: "key-dates",
      label: "Key dates",
      value: `${Number(operations.upcomingMilestones || 0)} upcoming`,
      detail: `${Number(operations.overdueMilestones || 0)} overdue · ${Number(operations.dueSoonMilestones || 0)} due soon`,
      action: "View calendar",
      href: "#admin-partner-milestones-workspace",
      state: Number(operations.overdueMilestones || 0) > 0 ? "attention" : Number(operations.upcomingMilestones || 0) > 0 ? "ready" : "idle"
    },
    {
      id: "sponsors",
      label: "Sponsor delivery",
      value: `${Number(fulfillment.assets?.approved || 0)} assets approved`,
      detail: `${Number(fulfillment.profiles?.approved || 0)} brand approved · ${Number(fulfillment.deliverables?.active || 0)} active benefits`,
      action: "View fulfillment",
      href: "#admin-sponsor-fulfillment-workspace",
      state: sponsorsReady ? "ready" : "attention"
    },
    {
      id: "vendors",
      label: "Vendor readiness",
      value: `${Number(vendor.ready || 0)}/${Number(vendor.vendors || 0)} ready`,
      detail: `${Number(vendor.blocked || 0)} blocked · ${Number(vendor.requirementsMissing || 0)} missing items`,
      action: "Review vendors",
      href: "#admin-vendor-readiness-workspace",
      state: Number(vendor.blocked || 0) > 0 ? "attention" : Number(vendor.ready || 0) > 0 ? "ready" : "idle"
    },
    {
      id: "outreach",
      label: "Sponsor outreach",
      value: `${Number(outreachSummary.qualified || 0)} qualified`,
      detail: `${Number(outreachSummary.nextActionsScheduled || 0)} next actions · ${Number(outreachSummary.unassigned || 0)} unassigned`,
      action: "Open pipeline",
      href: "#admin-outreach-prospects-workspace",
      state: outreachReady ? "ready" : Number(outreachSummary.nextActionsOverdue || 0) > 0 ? "attention" : "idle"
    }
  ];
  target.innerHTML = signals.map(signal => `<a href="${escapeAttr(signal.href)}" data-command-signal="${escapeAttr(signal.id)}" data-state="${escapeAttr(signal.state)}">
    <span>${escapeHtml(signal.label)}</span>
    <strong>${escapeHtml(signal.value)}</strong>
    <small>${escapeHtml(signal.detail)}</small>
    <b>${escapeHtml(signal.action)}</b>
  </a>`).join("");
  target.setAttribute("aria-busy", "false");
  updated.textContent = `Updated ${new Date(taskBoard.generatedAt || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

const adminPartnerActivityTypes = {
  "application.created": { category: "intake", one: "Application received", many: "Applications received" },
  "application.updated": { category: "intake", one: "Application status updated", many: "Application statuses updated" },
  "application.portal_access_rotated": { category: "intake", one: "Partner portal access refreshed", many: "Partner portal links refreshed" },
  "application.portal_access_requested": { category: "intake", one: "Partner portal access requested", many: "Partner portal access requests" },
  "invoice.created": { category: "finance", one: "Invoice created", many: "Invoices created" },
  "invoice.reconciled": { category: "finance", one: "Invoice reconciled", many: "Invoices reconciled" },
  "payment.recorded": { category: "finance", one: "Payment recorded", many: "Payments recorded" },
  "payment.reversed": { category: "finance", one: "Payment reversed", many: "Payments reversed" },
  "payment.voided": { category: "finance", one: "Payment voided", many: "Payments voided" },
  "payment.stripe_refund_reconciled": { category: "finance", one: "Refund reconciled", many: "Refunds reconciled" },
  "payment_checkout.created": { category: "finance", one: "Online checkout prepared", many: "Online checkouts prepared" },
  "payment_checkout.completed": { category: "finance", one: "Online payment completed", many: "Online payments completed" },
  "milestone.created": { category: "schedule", one: "Key date added", many: "Key dates added" },
  "milestone.updated": { category: "schedule", one: "Key date updated", many: "Key dates updated" },
  "milestone.invoice_due_synced": { category: "schedule", one: "Invoice due date synchronized", many: "Invoice due dates synchronized" },
  "followup.generated": { category: "messaging", one: "Partner message prepared", many: "Partner messages prepared" },
  "followup.approved": { category: "messaging", one: "Partner message approved", many: "Partner messages approved" },
  "followup.queued": { category: "messaging", one: "Partner message queued", many: "Partner messages queued" },
  "followup.sent": { category: "messaging", one: "Partner message accepted", many: "Partner messages accepted" },
  "task.created": { category: "work", one: "Task assigned", many: "Tasks assigned" },
  "task.updated": { category: "work", one: "Task updated", many: "Tasks updated" },
  "task.assignee_updated": { category: "work", one: "Assignee updated a task", many: "Assignee task updates" },
  "task.followup.generated": { category: "work", one: "Assignment notice prepared", many: "Assignment notices prepared" },
  "brand.profile_submitted": { category: "branding", one: "Brand profile submitted", many: "Brand profiles submitted" },
  "brand.profile_approved": { category: "branding", one: "Brand profile approved", many: "Brand profiles approved" },
  "brand.profile_changes_requested": { category: "branding", one: "Brand profile changes requested", many: "Brand profile changes requested" },
  "brand.asset_submitted": { category: "branding", one: "Brand asset submitted", many: "Brand assets submitted" },
  "brand.asset_approved": { category: "branding", one: "Brand asset approved", many: "Brand assets approved" },
  "brand.asset_changes_requested": { category: "branding", one: "Brand asset changes requested", many: "Brand asset changes requested" },
  "deliverable.created": { category: "branding", one: "Sponsor benefit added", many: "Sponsor benefits added" },
  "deliverable.updated": { category: "branding", one: "Sponsor benefit updated", many: "Sponsor benefits updated" },
  "deliverable.partner_approved": { category: "branding", one: "Sponsor benefit approved", many: "Sponsor benefits approved" },
  "vendor.profile_submitted": { category: "vendor", one: "Vendor profile submitted", many: "Vendor profiles submitted" },
  "vendor.profile_approved": { category: "vendor", one: "Vendor profile approved", many: "Vendor profiles approved" },
  "vendor.requirement_approved": { category: "vendor", one: "Vendor requirement approved", many: "Vendor requirements approved" },
  "vendor.requirement_waived": { category: "vendor", one: "Vendor requirement waived", many: "Vendor requirements waived" },
  "vendor.requirement_changes_requested": { category: "vendor", one: "Vendor correction requested", many: "Vendor corrections requested" },
  "vendor.assignment_updated": { category: "vendor", one: "Vendor assignment published", many: "Vendor assignments published" },
  "vendor.assignment_confirmed": { category: "vendor", one: "Vendor assignment confirmed", many: "Vendor assignments confirmed" },
  "outreach.prospect.created": { category: "outreach", one: "Sponsor target added", many: "Sponsor targets added" },
  "outreach.prospect.updated": { category: "outreach", one: "Sponsor target updated", many: "Sponsor targets updated" },
  "outreach.prospect.suppressed": { category: "outreach", one: "Sponsor outreach suppressed", many: "Sponsor outreach records suppressed" },
  "outreach.campaign.created": { category: "outreach", one: "Outreach campaign drafted", many: "Outreach campaigns drafted" },
  "outreach.campaign.activated": { category: "outreach", one: "Outreach campaign activated", many: "Outreach campaigns activated" },
  "outreach.campaign.paused": { category: "outreach", one: "Outreach campaign paused", many: "Outreach campaigns paused" },
  "outreach.sponsor_invitation.issued": { category: "outreach", one: "Sponsor invitation issued", many: "Sponsor invitations issued" },
  "outreach.sponsor_invitation.revoked": { category: "outreach", one: "Sponsor invitation revoked", many: "Sponsor invitations revoked" },
  "outreach.prospect.converted": { category: "outreach", one: "Sponsor target converted", many: "Sponsor targets converted" }
};

const adminPartnerActivityCategories = {
  intake: "Intake",
  finance: "Finance",
  schedule: "Key dates",
  messaging: "Messaging",
  work: "Work board",
  branding: "Sponsor branding",
  vendor: "Vendor readiness",
  outreach: "Sponsor outreach",
  operations: "Partner operations"
};

function adminPartnerActivityDefinition(type) {
  if (adminPartnerActivityTypes[type]) return adminPartnerActivityTypes[type];
  const category = type.startsWith("payment") || type.startsWith("invoice")
    ? "finance"
    : type.startsWith("milestone")
      ? "schedule"
      : type.startsWith("followup")
        ? "messaging"
        : type.startsWith("task")
          ? "work"
          : type.startsWith("brand") || type.startsWith("deliverable")
            ? "branding"
            : type.startsWith("vendor")
              ? "vendor"
              : type.startsWith("outreach")
                ? "outreach"
                : type.startsWith("application")
                  ? "intake"
                  : "operations";
  const words = String(type || "workflow updated").replace(/[._]+/g, " ");
  const label = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  return { category, one: label, many: `${label} records` };
}

function adminPartnerActivityActor(actorId) {
  const actor = String(actorId || "");
  if (actor === "automation") return "Automation";
  if (actor === "public") return "Public site";
  if (actor.startsWith("partner:")) return "Partner portal";
  if (actor.startsWith("task-assignee:")) return "Task assignee";
  if (actor.includes("finance")) return "Finance team";
  if (actor.includes("sponsor")) return "Sponsor team";
  if (actor.includes("vendor")) return "Vendor team";
  if (actor === "admin" || actor.includes("board")) return "Operations team";
  return "Staff workflow";
}

function adminPartnerActivitySubject(payload, outreach, activity) {
  const entityId = activity.entityId;
  const detail = activity.detail || {};
  const applications = payload.applications || [];
  const directApplication = applications.find(item => item.id === entityId);
  if (directApplication) return directApplication.organizationName;

  const relatedCollections = [
    payload.invoices,
    payload.payments,
    payload.paymentCheckouts,
    payload.milestones,
    payload.followups,
    payload.brandProfiles,
    payload.brandAssets,
    payload.deliverables,
    payload.vendorProfiles,
    payload.vendorDocuments,
    payload.vendorRequirements,
    payload.vendorAssignments
  ];
  const related = relatedCollections.flatMap(items => items || []).find(item => item.id === entityId);
  const applicationId = detail.applicationId || related?.applicationId;
  const application = applications.find(item => item.id === applicationId);
  if (application) return application.organizationName;

  const task = (payload.tasks || []).find(item => item.id === entityId || item.id === detail.taskId);
  if (task?.title) return task.title;
  const prospect = (outreach?.prospects || []).find(item => item.id === entityId || item.id === detail.prospectId);
  if (prospect?.organizationName) return prospect.organizationName;
  const campaign = (outreach?.campaigns || []).find(item => item.id === entityId || item.id === detail.campaignId);
  if (campaign?.name) return campaign.name;
  return "Partner operations";
}

function groupedAdminPartnerActivity(payload, outreach) {
  const groups = new Map();
  for (const activity of payload.activity || []) {
    const type = String(activity.type || "workflow.updated");
    const at = String(activity.at || "");
    const key = `${type}|${at.slice(0, 19)}|${String(activity.actorId || "")}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    groups.set(key, {
      activity,
      count: 1,
      definition: adminPartnerActivityDefinition(type),
      subject: adminPartnerActivitySubject(payload, outreach, activity)
    });
  }
  return [...groups.values()].slice(0, 40);
}

function renderAdminPartnerActivity(payload, outreach) {
  const target = document.querySelector("#admin-partner-activity");
  const summary = document.querySelector("#admin-partner-activity-summary");
  if (!target || !summary) return;
  const groups = groupedAdminPartnerActivity(payload, outreach);
  summary.textContent = `${(payload.activity || []).length} recorded event${(payload.activity || []).length === 1 ? "" : "s"} · ${groups.length} recent update${groups.length === 1 ? "" : "s"}`;
  target.innerHTML = groups.map(group => {
    const { activity, count, definition } = group;
    const title = count === 1 ? definition.one : `${count} ${definition.many.toLowerCase()}`;
    const timestamp = new Date(activity.at);
    const timeLabel = Number.isNaN(timestamp.getTime())
      ? "Time unavailable"
      : timestamp.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    return `<article data-partner-activity data-category="${escapeAttr(definition.category)}">
      <span class="admin-partner-activity-marker" aria-hidden="true"></span>
      <div>
        <header><strong>${escapeHtml(title)}</strong><span>${escapeHtml(adminPartnerActivityCategories[definition.category] || adminPartnerActivityCategories.operations)}</span></header>
        <p>${escapeHtml(count === 1 ? group.subject : "Multiple related workflow records")}</p>
        <small>${escapeHtml(adminPartnerActivityActor(activity.actorId))} · ${escapeHtml(timeLabel)}</small>
      </div>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No partner workflow activity has been recorded.</span></article>';
}

function validOutreachCoordinate(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function outreachMapPosition(prospect, geofence) {
  const latitude = validOutreachCoordinate(prospect.latitude, -90, 90);
  const longitude = validOutreachCoordinate(prospect.longitude, -180, 180);
  if (latitude === null || longitude === null) return null;
  const radians = value => value * Math.PI / 180;
  const centerLatitude = Number(geofence.latitude);
  const centerLongitude = Number(geofence.longitude);
  const latitudeDelta = radians(latitude - centerLatitude);
  const longitudeDelta = radians(longitude - centerLongitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(centerLatitude)) * Math.cos(radians(latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const distanceMiles = 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  const northMiles = (latitude - centerLatitude) * 69.093;
  const eastMiles = (longitude - centerLongitude) * 69.172 * Math.cos(radians(centerLatitude));
  return { latitude, longitude, distanceMiles, northMiles, eastMiles };
}

function campaignCenterChoices(outreach) {
  const locatedProspects = (outreach?.prospects || []).filter(prospect => (
    validOutreachCoordinate(prospect.latitude, -90, 90) !== null
    && validOutreachCoordinate(prospect.longitude, -180, 180) !== null
  )).sort((left, right) => left.organizationName.localeCompare(right.organizationName));
  return [
    { id: "none", label: "Business filters only (no radius)", latitude: null, longitude: null },
    SANDFEST_OUTREACH_CENTER,
    ...locatedProspects.map(prospect => ({
      id: `prospect:${prospect.id}`,
      label: `${prospect.organizationName}${prospect.city ? `, ${prospect.city}` : ""}`,
      latitude: Number(prospect.latitude),
      longitude: Number(prospect.longitude)
    })),
    { id: "custom", label: "Custom coordinates", latitude: null, longitude: null }
  ];
}

function renderCampaignCenterPreview(form, outreach) {
  const preview = form?.querySelector("#admin-campaign-center-preview");
  if (!form || !preview) return;
  const latitude = validOutreachCoordinate(form.elements.centerLatitude.value, -90, 90);
  const longitude = validOutreachCoordinate(form.elements.centerLongitude.value, -180, 180);
  const radiusMiles = Number(form.elements.radiusMiles.value);
  const sourceLabel = form.elements.centerSource.selectedOptions[0]?.textContent?.trim() || "Custom coordinates";
  if (form.elements.centerSource.value === "none" && latitude === null && longitude === null && !form.elements.radiusMiles.value) {
    preview.dataset.state = "unbounded";
    preview.innerHTML = "<strong>Business filters only</strong><span>This campaign will use industry, city, state, ZIP, fit, qualification, contact basis, and suppression without a radius.</span>";
    return;
  }
  if (latitude === null || longitude === null || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    preview.dataset.state = "incomplete";
    preview.innerHTML = `<strong>${escapeHtml(sourceLabel)}</strong><span>Complete the center latitude, longitude, and radius to preview geographic coverage.</span>`;
    return;
  }
  const geofence = { latitude, longitude, radiusMiles };
  const located = (outreach?.prospects || []).map(prospect => outreachMapPosition(prospect, geofence)).filter(Boolean);
  const insideCount = located.filter(position => position.distanceMiles <= radiusMiles).length;
  preview.dataset.state = "ready";
  preview.innerHTML = `<strong>${escapeHtml(sourceLabel)}</strong><span>Coverage includes ${insideCount} of ${located.length} located business${located.length === 1 ? "" : "es"} inside a ${radiusMiles}-mile radius. Server qualification applies every other campaign filter.</span>`;
}

function renderCampaignCenterChoices(outreach) {
  const form = document.querySelector("#admin-create-campaign");
  const select = form?.elements.centerSource;
  if (!form || !select) return;
  const choices = campaignCenterChoices(outreach);
  const existingValue = select.value || "none";
  const hasCoordinateInput = [form.elements.centerLatitude.value, form.elements.centerLongitude.value, form.elements.radiusMiles.value]
    .some(value => String(value || "").trim());
  select.innerHTML = choices.map(choice => `<option value="${escapeAttr(choice.id)}">${escapeHtml(choice.label)}</option>`).join("");
  select.value = existingValue === "none" && hasCoordinateInput
    ? "custom"
    : choices.some(choice => choice.id === existingValue)
      ? existingValue
      : hasCoordinateInput ? "custom" : "none";

  const applyChoice = () => {
    const choice = choices.find(item => item.id === select.value);
    if (choice?.id === "none") {
      form.elements.centerLatitude.value = "";
      form.elements.centerLongitude.value = "";
      form.elements.radiusMiles.value = "";
    } else if (choice && choice.id !== "custom") {
      form.elements.centerLatitude.value = String(choice.latitude);
      form.elements.centerLongitude.value = String(choice.longitude);
      if (!form.elements.radiusMiles.value) form.elements.radiusMiles.value = "25";
    }
    renderCampaignCenterPreview(form, outreach);
  };
  select.onchange = applyChoice;
  [form.elements.centerLatitude, form.elements.centerLongitude].forEach(input => {
    input.oninput = () => {
      if (select.value !== "custom") select.value = "custom";
      renderCampaignCenterPreview(form, outreach);
    };
  });
  form.elements.radiusMiles.oninput = () => renderCampaignCenterPreview(form, outreach);
  if (select.value !== "none" && select.value !== "custom") applyChoice();
  else renderCampaignCenterPreview(form, outreach);
}

function campaignFormPayload(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const splitTargets = value => String(value || "").split(",").map(item => item.trim()).filter(Boolean);
  return {
    name: values.name,
    objective: values.objective,
    deliveryMode: values.deliveryMode,
    dailySendLimit: Number(values.dailySendLimit),
    targeting: {
      industries: splitTargets(values.industries),
      cities: splitTargets(values.cities),
      states: splitTargets(values.states),
      postalCodes: splitTargets(values.postalCodes),
      geofence: [values.centerLatitude, values.centerLongitude, values.radiusMiles].some(value => String(value || "").trim())
        ? { latitude: values.centerLatitude, longitude: values.centerLongitude, radiusMiles: values.radiusMiles }
        : null,
      minFitScore: Number(values.minFitScore)
    },
    sequence: [
      { delayDays: 0, subjectTemplate: values.subject1, bodyTemplate: values.body1 },
      { delayDays: Number(values.delay2), subjectTemplate: values.subject2, bodyTemplate: values.body2 }
    ]
  };
}

function campaignFormFingerprint(form) {
  return JSON.stringify(campaignFormPayload(form));
}

function invalidateCampaignAudiencePreview(form, { force = false, message = "Targeting or message content changed. Preview the audience again before saving this campaign draft." } = {}) {
  const preview = form?.querySelector("#admin-campaign-audience-preview");
  const createButton = form?.querySelector('button[type="submit"]');
  if (!form || !preview || !createButton) return;
  createButton.disabled = true;
  if (!force && !form.dataset.audiencePreviewFingerprint) return;
  delete form.dataset.audiencePreviewFingerprint;
  preview.dataset.state = "stale";
  preview.innerHTML = `<strong>Audience preview needs refresh</strong><span>${escapeHtml(message)}</span>`;
}

function renderCampaignAudiencePreview(form, preview) {
  const target = form?.querySelector("#admin-campaign-audience-preview");
  const createButton = form?.querySelector('button[type="submit"]');
  if (!target || !createButton) return;
  const matched = Number(preview?.matched || 0);
  const total = Number(preview?.totalProspects || 0);
  const excluded = Number(preview?.excluded || 0);
  const exclusions = (preview?.exclusions || []).map(item => `<li><strong>${Number(item.count || 0)}</strong><span>${escapeHtml(item.label || conditionLabel(item.reason))}</span></li>`).join("");
  const matches = (preview?.matches || []).slice(0, 8).map(item => {
    const location = [item.city, item.state].filter(Boolean).join(", ") || "Location not listed";
    const context = [location, item.industry || "Industry not listed", `fit ${Number(item.fitScore || 0)}`].join(" · ");
    return `<li><strong>${escapeHtml(item.organizationName)}</strong><span>${escapeHtml(context)}</span></li>`;
  }).join("");
  const sample = preview?.sample;
  const opening = sample?.sequence?.[0];
  const sampleMarkup = sample && opening ? `<div class="admin-campaign-sample">
    <span>Personalized opening for ${escapeHtml(sample.prospect.organizationName)}</span>
    <strong>${escapeHtml(opening.subject)}</strong>
    <blockquote>${escapeHtml(opening.body)}</blockquote>
  </div>` : '<div class="admin-campaign-sample admin-campaign-sample-empty"><span>No personalized sample is available until at least one business qualifies.</span></div>';
  const delivery = preview?.deliveryMode === "approved_sequence"
    ? `Approved automation · up to ${Number(preview.dailySendLimit || 0)} per day`
    : "Every message requires staff review";
  target.dataset.state = matched > 0 ? "ready" : "empty";
  target.innerHTML = `<header><div><strong>${matched} business${matched === 1 ? " qualifies" : "es qualify"}</strong><span>${excluded} excluded from ${total} reviewed</span></div><b>${escapeHtml(delivery)}</b></header>
    ${exclusions ? `<div class="admin-campaign-preview-section"><strong>Exclusion evidence</strong><ul class="admin-campaign-preview-metrics">${exclusions}</ul></div>` : ""}
    <div class="admin-campaign-preview-section"><strong>Qualified businesses</strong><ul class="admin-campaign-preview-matches">${matches || "<li><span>No businesses match every current filter.</span></li>"}</ul>${preview?.matchesTruncated ? '<span>Additional qualified businesses are included in the campaign total.</span>' : ""}</div>
    ${sampleMarkup}
    <small>Recipient addresses are withheld here. Eligibility, suppression, contact basis, and provider readiness are checked again at activation and immediately before delivery.</small>`;
  form.dataset.audiencePreviewFingerprint = campaignFormFingerprint(form);
  createButton.disabled = !adminCan("outreach:write");
}

function renderAdminOutreachCoverage(outreach) {
  const root = document.querySelector("#admin-outreach-targeting-map");
  if (!root) return;
  const campaigns = [...(outreach.campaigns || [])].sort((left, right) => {
    const statusOrder = { active: 0, draft: 1, paused: 2, complete: 3, archived: 4 };
    return (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9)
      || String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
  });
  if (!campaigns.length) {
    selectedOutreachCampaignId = null;
    root.removeAttribute("data-campaign-id");
    root.innerHTML = '<div class="admin-outreach-map-empty"><strong>No campaign coverage yet</strong><span>Create a campaign with a center point and radius to plot located businesses.</span></div>';
    return;
  }

  const geofencedCampaigns = campaigns.filter(campaign => {
    const geofence = campaign.targeting?.geofence;
    return geofence
      && validOutreachCoordinate(geofence.latitude, -90, 90) !== null
      && validOutreachCoordinate(geofence.longitude, -180, 180) !== null
      && Number(geofence.radiusMiles) > 0;
  });
  const selected = campaigns.find(campaign => campaign.id === selectedOutreachCampaignId)
    || geofencedCampaigns[0]
    || campaigns[0];
  selectedOutreachCampaignId = selected.id;
  root.dataset.campaignId = selected.id;
  const options = campaigns.map(campaign => `<option value="${escapeAttr(campaign.id)}" ${campaign.id === selected.id ? "selected" : ""}>${escapeHtml(campaign.name)} · ${escapeHtml(conditionLabel(campaign.status))}</option>`).join("");
  const geofence = selected.targeting?.geofence;
  const radiusMiles = Number(geofence?.radiusMiles);
  const hasGeofence = geofence
    && validOutreachCoordinate(geofence.latitude, -90, 90) !== null
    && validOutreachCoordinate(geofence.longitude, -180, 180) !== null
    && Number.isFinite(radiusMiles)
    && radiusMiles > 0;

  if (!hasGeofence) {
    root.innerHTML = `<header class="admin-outreach-map-heading">
      <div><span>Geographic targeting</span><strong id="admin-outreach-targeting-title">Campaign coverage</strong></div>
      <label><span>Campaign</span><select id="admin-outreach-map-campaign">${options}</select></label>
    </header>
    <div class="admin-outreach-map-empty"><strong>No radius configured</strong><span>${escapeHtml(selected.name)} uses non-geographic campaign filters.</span></div>`;
    root.querySelector("#admin-outreach-map-campaign")?.addEventListener("change", event => {
      selectedOutreachCampaignId = event.currentTarget.value;
      renderAdminOutreachCoverage(adminPartnerState?.outreach || outreach);
    });
    return;
  }

  const plotted = (outreach.prospects || []).map(prospect => {
    const position = outreachMapPosition(prospect, geofence);
    return position ? { prospect, ...position, inside: position.distanceMiles <= radiusMiles } : null;
  }).filter(Boolean).sort((left, right) => left.distanceMiles - right.distanceMiles || left.prospect.organizationName.localeCompare(right.prospect.organizationName));
  const plotLimitMiles = radiusMiles * 1.2;
  const visible = plotted.filter(item => Math.abs(item.northMiles) <= plotLimitMiles && Math.abs(item.eastMiles) <= plotLimitMiles);
  const insideCount = plotted.filter(item => item.inside).length;
  const matched = Number(selected.metrics?.matched || 0);
  const pointMarkup = visible.map(item => {
    const x = 50 + (item.eastMiles / plotLimitMiles) * 50;
    const y = 50 - (item.northMiles / plotLimitMiles) * 50;
    const atCenter = item.distanceMiles < 0.05;
    const label = `${item.prospect.organizationName}, ${item.distanceMiles.toFixed(1)} miles from campaign center, ${item.inside ? "inside" : "outside"} radius`;
    return `<span class="admin-outreach-map-point" data-outreach-map-prospect="${escapeAttr(item.prospect.id)}" data-inside="${item.inside}" data-at-center="${atCenter}" style="--plot-x:${x.toFixed(3)}%;--plot-y:${y.toFixed(3)}%" title="${escapeAttr(label)}" aria-hidden="true"><i></i><b>${escapeHtml(item.prospect.organizationName)}</b></span>`;
  }).join("");
  const prospectRows = plotted.slice(0, 8).map(item => `<li data-outreach-map-row="${escapeAttr(item.prospect.id)}" data-inside="${item.inside}"><span><i aria-hidden="true"></i><strong>${escapeHtml(item.prospect.organizationName)}</strong></span><span>${item.distanceMiles.toFixed(1)} mi · ${item.inside ? "inside radius" : "outside radius"} · fit ${Number(item.prospect.fitScore || 0)}/100</span></li>`).join("");
  const radiusDiameter = (radiusMiles / plotLimitMiles) * 100;
  const plotLabel = `${selected.name}: ${insideCount} located business${insideCount === 1 ? "" : "es"} inside the ${radiusMiles}-mile geographic radius; ${matched} prospect${matched === 1 ? "" : "s"} ${matched === 1 ? "matches" : "match"} all server campaign filters.`;
  root.innerHTML = `<header class="admin-outreach-map-heading">
      <div><span>Geographic targeting</span><strong id="admin-outreach-targeting-title">Campaign coverage</strong></div>
      <label><span>Campaign</span><select id="admin-outreach-map-campaign">${options}</select></label>
    </header>
    <div class="admin-outreach-map-summary" aria-live="polite">
      <div><strong>${radiusMiles} mi</strong><span>target radius</span></div>
      <div><strong>${insideCount}</strong><span>located inside</span></div>
      <div><strong>${matched}</strong><span>server matched</span></div>
      <div><strong>${plotted.length}</strong><span>located total</span></div>
    </div>
    <div class="admin-outreach-map-layout">
      <div class="admin-outreach-map-plot" role="img" aria-label="${escapeAttr(plotLabel)}">
        <span class="admin-outreach-map-radius" style="--radius-diameter:${radiusDiameter.toFixed(3)}%" aria-hidden="true"></span>
        <span class="admin-outreach-map-axis admin-outreach-map-axis-north" aria-hidden="true">N</span>
        <span class="admin-outreach-map-center" aria-hidden="true"><i></i><b>Campaign center</b></span>
        ${pointMarkup}
      </div>
      <div class="admin-outreach-map-detail">
        <div class="admin-outreach-map-legend" aria-label="Campaign coverage legend"><span data-kind="center"><i></i>Center</span><span data-kind="inside"><i></i>Inside radius</span><span data-kind="outside"><i></i>Outside radius</span></div>
        <ul class="admin-outreach-map-list" aria-label="Located outreach businesses">${prospectRows || '<li><span><strong>No located businesses</strong></span><span>Add coordinates to a prospect to include it here.</span></li>'}</ul>
        ${plotted.length > 8 ? `<span class="admin-outreach-map-more">${plotted.length - 8} additional located business${plotted.length - 8 === 1 ? "" : "es"}</span>` : ""}
        <p>Geography shows radius coverage. Server matching also enforces industry, city, state, ZIP, fit, qualification, contact basis, and suppression.</p>
      </div>
    </div>`;
  root.querySelector("#admin-outreach-map-campaign")?.addEventListener("change", event => {
    selectedOutreachCampaignId = event.currentTarget.value;
    renderAdminOutreachCoverage(adminPartnerState?.outreach || outreach);
  });
}

function renderAdminPartners(payload, outreach) {
  adminPartnerState = { payload, outreach };
  const summary = payload.summary;
  const activePaymentCount = (payload.payments || [])
    .filter(item => ["succeeded", "partially_refunded"].includes(item.status)).length;
  const paidInFullCount = Number(summary?.applications?.paid || 0);
  const boardProvidersDeferred = BOARD_DEMO_ACCESS.enabled;
  const automationPresentation = partnerAutomationPresentation(payload, summary?.operations?.draftsAwaitingReview);
  const kpis = document.querySelector("#admin-partner-kpis");
  const applications = document.querySelector("#admin-partner-applications");
  const followups = document.querySelector("#admin-partner-followups");
  const prospects = document.querySelector("#admin-outreach-prospects");
  const campaigns = document.querySelector("#admin-outreach-campaigns");
  const automationForm = document.querySelector("#admin-partner-automation");
  if (!kpis || !summary) return;
  const campaignForm = document.querySelector("#admin-create-campaign");
  if (campaignForm?.dataset.audiencePreviewFingerprint) {
    invalidateCampaignAudiencePreview(campaignForm, { force: true, message: "Outreach records refreshed. Preview again to use the latest qualification and suppression state." });
  }
  renderCampaignCenterChoices(outreach);
  renderAdminOutreachCoverage(outreach);
  kpis.innerHTML = [
    revenueKpiCard("Applications", `${summary.applications.total}`, `${summary.applications.vendors} vendors · ${summary.applications.sponsors} sponsors`),
    revenueKpiCard("Expected", adminMoney(summary.finance.amountExpectedCents, "$0.00"), `${adminMoney(summary.finance.balanceCents, "$0.00")} open`),
    revenueKpiCard(
      "Received",
      adminMoney(summary.finance.amountPaidCents, "$0.00"),
      `${activePaymentCount} active payment${activePaymentCount === 1 ? "" : "s"} · ${paidInFullCount} account${paidInFullCount === 1 ? "" : "s"} paid in full`
    ),
    revenueKpiCard(
      "QuickBooks",
      boardProvidersDeferred ? "Post-board" : payload.quickbooks?.canSyncPartnerInvoices ? "Ready" : "Not connected",
      boardProvidersDeferred
        ? `${summary.finance.invoicesPendingSync || 0} local invoice${summary.finance.invoicesPendingSync === 1 ? "" : "s"} awaiting connection`
        : `${summary.finance.invoicesSynced || 0} synced · ${summary.finance.invoicesPendingSync || 0} pending`
    ),
    revenueKpiCard(
      "Online invoices",
      boardProvidersDeferred ? "Post-board" : payload.stripePartnerPayments?.ready ? "Ready" : "Off",
      boardProvidersDeferred
        ? "Site-native receivables active"
        : `${(payload.paymentCheckouts || []).filter(item => item.status === "open").length} open checkout${(payload.paymentCheckouts || []).filter(item => item.status === "open").length === 1 ? "" : "s"}`
    ),
    revenueKpiCard("Work board", `${summary.operations.openTasks}`, `${summary.operations.overdueTasks} overdue · ${summary.operations.blockedTasks || 0} blocked`),
    revenueKpiCard("Staff routing", payload.staffDirectory?.ready ? "Ready" : "Needs review", `${payload.staffDirectory?.activeStaff || 0} active · ${payload.staffDirectory?.routedTeams || 0}/${payload.staffDirectory?.totalTeams || 0} teams`),
    revenueKpiCard("Vendor readiness", `${payload.vendorReadiness?.totals?.ready || 0}/${payload.vendorReadiness?.totals?.vendors || 0} ready`, `${payload.vendorReadiness?.totals?.requirementsMissing || 0} missing · ${payload.vendorReadiness?.totals?.requirementsAwaitingReview || 0} pending`),
    revenueKpiCard("Sponsor delivery", `${summary.fulfillment?.deliverables?.active || 0} active`, `${summary.fulfillment?.assets?.awaitingReview || 0} assets pending · ${summary.fulfillment?.deliverables?.awaitingPartnerReview || 0} sign-offs`),
    revenueKpiCard("Messaging", automationPresentation.label, automationPresentation.detail),
    revenueKpiCard(
      "Email delivery",
      payload.email?.ready && payload.email?.deliveryTracking?.ready ? "Tracked" : payload.email?.ready ? "Send only" : "Off",
      payload.email?.ready
        ? payload.email?.deliveryTracking?.ready
          ? `${payload.email.provider} sender + delivery events`
          : `${payload.email.provider} sender ready · tracking needs attention`
        : payload.email?.enabled ? payload.email?.reason || "Provider needs attention" : "Provider not configured"
    ),
    revenueKpiCard("Prospects", `${outreach.summary?.prospects || 0}`, `${outreach.summary?.qualified || 0} qualified · ${outreach.summary?.nextActionsOverdue || 0} overdue · ${outreach.summary?.unassigned || 0} unassigned`),
    revenueKpiCard("Campaigns", `${outreach.summary?.activeCampaigns || 0} active`, `${outreach.summary?.draftsAwaitingReview || 0} drafts · ${outreach.summary?.messagesSent || 0} sent · opt-out ${outreach.preferences?.ready ? "ready" : "off"}`)
  ].join("");
  renderAdminCommandSummary(payload, outreach);
  renderAdminPartnerActivity(payload, outreach);
  const staffStatus = document.querySelector("#admin-staff-directory-status");
  if (staffStatus) {
    const directory = payload.staffDirectory || {};
    staffStatus.textContent = directory.ready
      ? `${directory.source || "verified"} · ${directory.activeStaff || 0} active · ${directory.routedTeams || 0}/${directory.totalTeams || 0} routes ready`
      : directory.reason || `${directory.routedTeams || 0}/${directory.totalTeams || 0} routes ready`;
  }
  if (automationForm) {
    const automation = payload.automation || {};
    const modeSelect = automationForm.elements.mode;
    const status = automationForm.querySelector("#admin-partner-automation-status");
    const saveButton = automationForm.querySelector('button[type="submit"]');
    modeSelect.value = automation.mode || payload.automationMode || "review_first";
    status.textContent = automation.active
      ? `${automation.eligibleDrafts || 0} eligible drafts · ${automation.autoQueued || 0} queued automatically`
      : automation.blockedReason || "Review-first mode";
    saveButton.disabled = !adminCan("partners:write");
    automationForm.onsubmit = async event => {
      event.preventDefault();
      const requestedMode = modeSelect.value;
      if (requestedMode === "transactional_auto" && !window.confirm("Enable automatic delivery for applicant acknowledgments, partner key-date reminders, vendor workflow notices, and directory-backed task notifications?")) return;
      saveButton.disabled = true;
      try {
        const result = await adminFetch("/api/admin/partners/automation", {
          method: "PATCH",
          body: JSON.stringify({ mode: requestedMode })
        });
        await loadAdminPartners({ quiet: true });
        setAdminStatus(result.automation.active ? "Transactional partner automation is active." : "Partner messages require review before delivery.", "ok");
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        saveButton.disabled = !adminCan("partners:write");
      }
    };
  }
  renderAdminQuickBooksConnection(payload.quickbooks);
  populateTaskAssignmentDirectory(payload);
  renderAdminTaskBoard(payload);
  renderAdminMilestones(payload);
  renderAdminSponsorFulfillment(payload);
  renderAdminVendorReadiness(payload);
  renderAdminReceivables(payload);
  renderOutreachDiscoveryAvailability(outreach);
  const sponsorPackages = (adminConfigState?.config?.sponsorPackages ?? []).filter(item => item.active);
  applications.innerHTML = (payload.applications || []).map(application => {
    const applicationPayments = (payload.payments || []).filter(item => item.applicationId === application.id).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    const paid = applicationPayments.filter(item => ["succeeded", "partially_refunded"].includes(item.status)).reduce((sum, item) => sum + Math.max(0, item.amountCents - (item.refundedAmountCents || 0)), 0);
    const expected = application.expectedAmountCents || application.requestedAmountCents || 0;
    const invoice = (payload.invoices || []).find(item => item.applicationId === application.id && item.status !== "voided");
    const paymentCheckout = invoice ? (payload.paymentCheckouts || []).filter(item => item.invoiceId === invoice.id).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] : null;
    const canFinance = adminCan("finance:write");
    const isVendorInterest = application.type === "vendor" && application.intakeMode === "interest";
    const canCreateInvoice = canFinance && !invoice && expected > 0 && ["approved", "contracted", "invoiced", "partial"].includes(application.status);
    const canSyncInvoice = payload.quickbooks?.canSyncPartnerInvoices && invoice?.quickBooksItemId;
    const canReconcileInvoice = canFinance && payload.quickbooks?.canSyncPartnerInvoices && invoice?.status === "synced";
    return `<article data-partner-application="${escapeAttr(application.id)}">
      <header><div><strong>${escapeHtml(application.organizationName)}</strong><span>${escapeHtml(application.reference)} · ${escapeHtml(isVendorInterest ? "vendor interest" : application.type)}</span></div><b>${isVendorInterest ? "Amount pending" : `${adminMoney(paid, "$0.00")} / ${adminMoney(expected, "$0.00")}`}</b></header>
      <p>${escapeHtml(application.contactName)} · ${escapeHtml(application.contactEmail)}${application.offeringName ? ` · ${escapeHtml(application.offeringName)}` : application.packageName ? ` · ${escapeHtml(application.packageName)}` : ""}</p>
      <div class="admin-partner-row-actions">
        <select name="status" aria-label="${escapeAttr(`${application.organizationName} application status`)}">${partnerStatusOptions(application.status)}</select>
        <button type="button" class="button secondary" data-save-application="${escapeAttr(application.id)}">Save</button>
      </div>
      <div class="admin-portal-actions">
        ${BOARD_DEMO_ACCESS.enabled ? `<button type="button" class="button primary" data-open-demo-portal="${escapeAttr(application.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Open demo portal</button>` : ""}
        <button type="button" class="button secondary" data-rotate-portal="${escapeAttr(application.id)}" ${adminCan("partners:write") ? "" : "disabled"}>Copy new portal link</button>
      </div>
      ${isVendorInterest ? "" : `<div class="admin-payment-entry">
        <input name="paymentAmount" inputmode="decimal" placeholder="Payment $" aria-label="Payment amount" />
        <select name="paymentMethod" aria-label="Payment method"><option value="check">Check</option><option value="ach">ACH</option><option value="cash">Cash</option><option value="card">Card</option><option value="stripe">Stripe</option><option value="eventeny">Eventeny</option><option value="quickbooks">QuickBooks</option><option value="bank_transfer">Bank transfer</option><option value="manual">Manual</option><option value="other">Other</option></select>
        <input name="paymentReference" required maxlength="160" placeholder="Receipt / transaction reference" aria-label="Receipt or transaction reference" />
        <input name="paymentReceivedAt" type="datetime-local" aria-label="Payment received date" />
        <button type="button" class="button secondary" data-record-payment="${escapeAttr(application.id)}" ${canFinance ? "" : "disabled"}>Record payment</button>
      </div>`}
      ${invoice ? `<div class="admin-invoice-strip" data-partner-invoice="${escapeAttr(invoice.id)}">
        <div><strong>${adminMoney(invoice.amountCents, "$0.00")} invoice</strong><span>${escapeHtml(conditionLabel(invoice.status))} · due ${escapeHtml(new Date(invoice.dueAt).toLocaleDateString())}</span></div>
        ${invoice.lastError ? `<span class="admin-delivery-error">${escapeHtml(invoice.lastError)}</span>` : ""}
        ${invoice.lastQuickBooksReconciliationError ? `<span class="admin-delivery-error">${escapeHtml(invoice.lastQuickBooksReconciliationError)}</span>` : ""}
        <span>SandFest balance · ${adminMoney(invoice.balanceCents, "$0.00")} open</span>
        ${paymentCheckout ? `<span>Stripe checkout · ${escapeHtml(conditionLabel(paymentCheckout.status))}${paymentCheckout.expiresAt ? ` · ${escapeHtml(new Date(paymentCheckout.expiresAt).toLocaleString())}` : ""}</span>` : ""}
        ${invoice.quickBooksInvoiceId ? `<span>QuickBooks ${escapeHtml(invoice.quickBooksDocNumber || invoice.quickBooksInvoiceId)} · ${adminMoney(invoice.quickBooksBalanceCents, "not reported")} reported${invoice.quickBooksReconciledAt ? ` · checked ${escapeHtml(new Date(invoice.quickBooksReconciledAt).toLocaleString())}` : " · not refreshed"}</span>` : ""}
        <div class="admin-followup-actions">
          ${invoice.status === "draft" ? `<button type="button" class="button secondary" data-review-invoice="${escapeAttr(invoice.id)}" data-action="approve" ${canFinance ? "" : "disabled"}>Approve invoice</button>` : ""}
          ${["draft", "approved", "failed"].includes(invoice.status) ? `<button type="button" class="button secondary" data-review-invoice="${escapeAttr(invoice.id)}" data-action="void" ${canFinance ? "" : "disabled"}>Void</button>` : ""}
          ${["approved", "failed"].includes(invoice.status) ? `<button type="button" class="button primary" data-sync-invoice="${escapeAttr(invoice.id)}" ${canFinance && canSyncInvoice ? "" : "disabled"}>${invoice.status === "failed" ? "Retry QuickBooks" : "Queue QuickBooks"}</button>` : ""}
          ${invoice.status === "synced" ? `<button type="button" class="button secondary" data-reconcile-invoice="${escapeAttr(invoice.id)}" ${canReconcileInvoice && invoice.quickBooksReconciliationStatus !== "queued" ? "" : "disabled"}>${invoice.quickBooksReconciliationStatus === "queued" ? "Refresh queued" : invoice.quickBooksReconciliationStatus === "failed" ? "Retry refresh" : "Refresh QuickBooks"}</button>` : ""}
        </div>
      </div>` : canCreateInvoice ? `<button type="button" class="button primary admin-create-invoice" data-create-invoice="${escapeAttr(application.id)}">Create invoice draft</button>` : ""}
      ${applicationPayments.length ? `<div class="admin-payment-history"><strong>Payment history</strong>${applicationPayments.map(payment => `<div data-partner-payment="${escapeAttr(payment.id)}">
        <span><b>${adminMoney(payment.amountCents, "$0.00")}</b> · ${escapeHtml(conditionLabel(payment.method))} · ${escapeHtml(conditionLabel(payment.status))}${payment.externalRef ? ` · ${escapeHtml(payment.externalRef)}` : ""}</span>
        <small>${escapeHtml(new Date(payment.receivedAt).toLocaleString())} · ${adminMoney(payment.appliedAmountCents || 0, "$0.00")} applied${payment.unappliedAmountCents ? ` · ${adminMoney(payment.unappliedAmountCents, "$0.00")} unapplied` : ""}${payment.refundedAmountCents ? ` · ${adminMoney(payment.refundedAmountCents, "$0.00")} refunded` : ""}</small>
        ${["succeeded", "partially_refunded"].includes(payment.status) ? `<div class="admin-payment-reversal"><select name="reversalAction" aria-label="Reversal action"><option value="refund">Mark refunded</option><option value="void">Mark void</option></select><input name="reversalReason" maxlength="500" placeholder="Required reason" aria-label="Reversal reason" /><button type="button" class="button secondary" data-reverse-payment="${escapeAttr(payment.id)}" ${canFinance ? "" : "disabled"}>Record reversal</button></div>` : payment.reversalReason ? `<small>${escapeHtml(payment.reversalReason)}</small>` : ""}
      </div>`).join("")}</div>` : ""}
    </article>`;
  }).join("") || '<article class="empty-state"><span>No applications yet.</span></article>';
  const followupPriority = new Map([
    ["draft_ready", 0],
    ["failed", 1],
    ["approved", 2],
    ["queued", 3],
    ["sending", 4],
    ["pending", 5],
    ["sent", 6],
    ["dismissed", 7]
  ]);
  followups.innerHTML = [...(payload.followups || [])].sort((left, right) => {
    const priority = (followupPriority.get(left.status) ?? 99) - (followupPriority.get(right.status) ?? 99);
    if (priority) return priority;
    if (left.status === "sent" && right.status === "sent") {
      const milestonePriority = Number(right.kind === "milestone_reminder") - Number(left.kind === "milestone_reminder");
      if (milestonePriority) return milestonePriority;
    }
    return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
  }).map(item => {
    const deliveryStatus = item.deliveryStatus || (item.status === "sent" ? "accepted" : null);
    const deliveryAt = item.clickedAt || item.openedAt || item.deliveredAt || item.failedAt || item.acceptedAt || item.sentAt;
    const automationLabel = item.automationPolicy === "outreach_campaign_v1"
      ? "campaign-approved automation"
      : item.automationPolicy && item.kind === "milestone_reminder"
        ? "automatic key-date reminder"
        : item.automationPolicy ? "transactional automation" : "";
    return `<article data-followup="${escapeAttr(item.id)}" ${deliveryStatus ? `data-delivery-status="${escapeAttr(deliveryStatus)}"` : ""}>
      <header><strong>${escapeHtml(item.subject || conditionLabel(item.kind))}</strong><b>${escapeHtml(conditionLabel(deliveryStatus || item.status))}</b></header>
      <p>${escapeHtml(item.recipientLabel || item.recipient || (item.recipientAvailable ? "Recipient on file" : "Recipient unavailable"))}${item.campaignId ? ` · outreach sequence ${escapeHtml(item.sequenceStepId || "")}` : ""}${item.taskId ? " · delegated task" : ""}${automationLabel ? ` · ${escapeHtml(automationLabel)}` : ""}</p>
      ${item.body ? `<blockquote class="keyboard-scroll-region" tabindex="0" aria-label="${escapeAttr(`Message preview: ${item.subject || conditionLabel(item.kind)}`)}">${escapeHtml(item.body)}</blockquote>` : '<span>Draft worker pending</span>'}
      ${item.lastError ? `<span class="admin-delivery-error">${escapeHtml(item.lastError)}</span>` : ""}
      ${item.sentAt ? `<span>Provider accepted ${escapeHtml(new Date(item.sentAt).toLocaleString())}${item.providerMessageId ? ` · ${escapeHtml(item.providerMessageId)}` : ""}</span>` : ""}
      ${deliveryStatus && deliveryAt ? `<span>Delivery ${escapeHtml(conditionLabel(deliveryStatus))} · ${escapeHtml(new Date(deliveryAt).toLocaleString())}</span>` : ""}
      <div class="admin-followup-actions">
        ${item.status === "draft_ready" ? `<button type="button" class="button secondary" data-review-followup="${escapeAttr(item.id)}" data-action="approve">Approve</button>` : ""}
        ${["draft_ready", "approved", "failed"].includes(item.status) ? `<button type="button" class="button secondary" data-review-followup="${escapeAttr(item.id)}" data-action="dismiss">Dismiss</button>` : ""}
        ${["approved", "failed"].includes(item.status) ? `<button type="button" class="button primary" data-send-followup="${escapeAttr(item.id)}" ${payload.email?.ready ? "" : "disabled"}>${item.status === "failed" ? "Retry send" : "Queue send"}</button>` : ""}
      </div>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No follow-ups.</span></article>';
  const prospectNow = new Date();
  const prospectUrgency = { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, complete: 4 };
  prospects.innerHTML = [...(outreach.prospects || [])].sort((a, b) => {
    const stateDifference = prospectUrgency[prospectNextActionState(a, prospectNow)] - prospectUrgency[prospectNextActionState(b, prospectNow)];
    if (stateDifference) return stateDifference;
    const aDue = a.nextActionAt ? new Date(a.nextActionAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.nextActionAt ? new Date(b.nextActionAt).getTime() : Number.POSITIVE_INFINITY;
    return aDue - bDue || Number(b.fitScore || 0) - Number(a.fitScore || 0) || a.organizationName.localeCompare(b.organizationName);
  }).map(item => {
    const sourceUrl = safeExternalHref(item.sourceUrl);
    const invitation = item.sponsorInvitation;
    const invitationExpired = invitation && new Date(invitation.expiresAt).getTime() <= Date.now();
    const convertedApplication = item.convertedApplicationId
      ? (payload.applications || []).find(application => application.id === item.convertedApplicationId)
      : null;
    const invitationEligible = !item.suppressedAt
      && ["qualified", "contact_ready", "contacted", "engaged"].includes(item.status)
      && item.contactName
      && item.contactEmail
      && item.contactBasis
      && !item.convertedApplicationId;
    const selectedPackageId = invitation?.packageId || sponsorPackages[0]?.id || "";
    const packageOptions = sponsorPackages.length
      ? sponsorPackages.map(sponsorPackage => `<option value="${escapeAttr(sponsorPackage.id)}" ${sponsorPackage.id === selectedPackageId ? "selected" : ""}>${escapeHtml(sponsorPackage.name)} · ${escapeHtml(sponsorPackage.publicLabel || adminMoney(sponsorPackage.amount))}</option>`).join("")
      : '<option value="">No active sponsor packages</option>';
    const invitationSummary = convertedApplication
      ? `Linked to ${convertedApplication.reference}`
      : invitation
        ? `${invitation.packageName} · ${invitationExpired ? "expired" : `expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}`
        : invitationEligible
          ? "Ready for an invited sponsor application"
          : "Verify qualification, decision maker, business email, and contact basis";
    const nextActionState = prospectNextActionState(item, prospectNow);
    const nextActionSummary = nextActionState === "complete"
      ? `Pipeline ${conditionLabel(item.status)}`
      : item.nextActionAt
        ? `${conditionLabel(nextActionState)} · ${new Date(item.nextActionAt).toLocaleString()}`
        : "Follow-up not scheduled";
    return `<article data-outreach-prospect="${escapeAttr(item.id)}" data-due-state="${escapeAttr(nextActionState)}">
      <header><strong>${escapeHtml(item.organizationName)}</strong><b>${item.fitScore}/100 · ${escapeHtml(conditionLabel(nextActionState))}</b></header>
      <p>${escapeHtml([item.industry, item.city, item.state, item.postalCode, item.latitude != null && item.longitude != null ? `${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}` : "", item.contactEmail].filter(Boolean).join(" · "))}</p>
      <span>${escapeHtml(item.suppressionReason || item.fitReasons.join(" · ") || item.nextAction)}</span>
      <span class="admin-prospect-schedule-summary">${escapeHtml(item.ownerId ? `Owner ${item.ownerId} · ${nextActionSummary}` : `Unassigned · ${nextActionSummary}`)}</span>
      ${sourceUrl ? `<span class="admin-prospect-source"><a href="${escapeAttr(sourceUrl)}" target="_blank" rel="noreferrer noopener">Source record</a>${item.sourceLicense ? ` · ${escapeHtml(item.sourceLicense)}` : ""}</span>` : ""}
      <div class="admin-prospect-contact-controls">
        <input name="website" type="url" maxlength="500" value="${escapeAttr(item.website || "")}" placeholder="Website" aria-label="${escapeAttr(item.organizationName)} website" />
        <input name="contactName" maxlength="120" value="${escapeAttr(item.contactName || "")}" placeholder="Decision maker" aria-label="${escapeAttr(item.organizationName)} contact name" />
        <input name="contactEmail" type="email" maxlength="254" value="${escapeAttr(item.contactEmail || "")}" placeholder="Business email" aria-label="${escapeAttr(item.organizationName)} contact email" />
        <input name="nextAction" maxlength="300" value="${escapeAttr(item.nextAction || "")}" placeholder="Next action" aria-label="${escapeAttr(item.organizationName)} next action" />
      </div>
      <div class="admin-prospect-schedule-controls">
        <input name="ownerId" maxlength="100" list="admin-task-assignee-options" value="${escapeAttr(item.ownerId || "")}" placeholder="Follow-up owner" aria-label="${escapeAttr(item.organizationName)} follow-up owner" />
        <input name="nextActionAt" type="datetime-local" value="${escapeAttr(taskDateTimeInput(item.nextActionAt))}" aria-label="${escapeAttr(item.organizationName)} follow-up due date" />
      </div>
      <div class="admin-prospect-location-controls">
        <input name="industry" maxlength="100" value="${escapeAttr(item.industry || "")}" placeholder="Industry" aria-label="${escapeAttr(item.organizationName)} industry" />
        <input name="city" maxlength="100" value="${escapeAttr(item.city || "")}" placeholder="City" aria-label="${escapeAttr(item.organizationName)} city" />
        <input name="state" maxlength="40" value="${escapeAttr(item.state || "")}" placeholder="State" aria-label="${escapeAttr(item.organizationName)} state" />
        <input name="postalCode" inputmode="numeric" maxlength="10" value="${escapeAttr(item.postalCode || "")}" placeholder="ZIP" aria-label="${escapeAttr(item.organizationName)} ZIP code" />
        <input name="latitude" type="number" min="-90" max="90" step="any" value="${item.latitude ?? ""}" placeholder="Latitude" aria-label="${escapeAttr(item.organizationName)} latitude" />
        <input name="longitude" type="number" min="-180" max="180" step="any" value="${item.longitude ?? ""}" placeholder="Longitude" aria-label="${escapeAttr(item.organizationName)} longitude" />
        <label><input name="communityFit" type="checkbox" ${item.communityFit ? "checked" : ""} /> Community fit</label>
      </div>
      <div class="admin-prospect-controls">
        <select name="status" aria-label="${escapeAttr(item.organizationName)} status">${prospectStatusOptions(item.status)}</select>
        <select name="contactBasis" aria-label="${escapeAttr(item.organizationName)} contact basis">${contactBasisOptions(item.contactBasis)}</select>
        <button type="button" class="button secondary" data-save-prospect="${escapeAttr(item.id)}" ${adminCan("outreach:write") ? "" : "disabled"}>Save</button>
      </div>
      <div class="admin-sponsor-invitation-controls" data-state="${convertedApplication ? "converted" : invitationExpired ? "expired" : invitation ? "active" : "ready"}">
        <div><strong>Sponsor invitation</strong><span>${escapeHtml(invitationSummary)}</span></div>
        ${convertedApplication ? "" : `<select name="sponsorPackageId" aria-label="${escapeAttr(item.organizationName)} sponsor package" ${invitationEligible && sponsorPackages.length ? "" : "disabled"}>${packageOptions}</select>
        <div class="admin-sponsor-invitation-actions">
          ${invitation && !invitationExpired ? `<button type="button" class="button secondary" data-sponsor-invitation-action="open" data-prospect-id="${escapeAttr(item.id)}" ${adminCan("outreach:write") ? "" : "disabled"}>Open invitation</button><button type="button" class="button secondary" data-sponsor-invitation-action="copy" data-prospect-id="${escapeAttr(item.id)}" ${adminCan("outreach:write") ? "" : "disabled"}>Copy link</button>` : ""}
          <button type="button" class="button primary" data-sponsor-invitation-action="issue" data-prospect-id="${escapeAttr(item.id)}" ${adminCan("outreach:write") && invitationEligible && sponsorPackages.length ? "" : "disabled"}>${invitation ? "Replace invitation" : "Issue invitation"}</button>
          ${invitation ? `<button type="button" class="button secondary" data-sponsor-invitation-action="revoke" data-prospect-id="${escapeAttr(item.id)}" ${adminCan("outreach:write") ? "" : "disabled"}>Revoke</button>` : ""}
        </div>`}
      </div>
      ${item.suppressedAt
        ? `<button type="button" class="button secondary" data-restore-prospect="${escapeAttr(item.id)}" ${adminCan("outreach:write") ? "" : "disabled"}>Restore outreach</button>`
        : `<div class="admin-suppress-controls"><input name="suppressionReason" maxlength="300" placeholder="Suppression reason" aria-label="${escapeAttr(item.organizationName)} outreach suppression reason" /><button type="button" class="button secondary" data-suppress-prospect="${escapeAttr(item.id)}" ${adminCan("outreach:write") ? "" : "disabled"}>Suppress</button></div>`}
    </article>`;
  }).join("") || '<article class="empty-state"><span>No outreach targets.</span></article>';
  if (campaigns) campaigns.innerHTML = (outreach.campaigns || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(campaign => {
    const target = campaign.targeting || {};
    const geofence = target.geofence;
    const scope = [
      ...(target.industries || []),
      ...(target.cities || []),
      ...(target.states || []),
      ...(target.postalCodes || []).map(item => `ZIP ${item}`),
      geofence ? `${geofence.radiusMiles} mi around ${Number(geofence.latitude).toFixed(4)}, ${Number(geofence.longitude).toFixed(4)}` : ""
    ].filter(Boolean).join(" · ") || "All qualified prospects";
    const metrics = campaign.metrics || {};
    const funnel = metrics.funnel || {};
    const automation = campaign.automation || {};
    const automatedSequence = campaign.deliveryMode === "approved_sequence";
    return `<article data-outreach-campaign="${escapeAttr(campaign.id)}">
      <header><div><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(scope)}</span></div><b>${escapeHtml(conditionLabel(campaign.status))}</b></header>
      <p>${campaign.sequence?.length || 0} messages · fit ${target.minFitScore || 0}+ · ${metrics.matched || 0} matched · ${automatedSequence ? `campaign-approved, ${campaign.dailySendLimit || 25}/day` : "review every message"}</p>
      ${automatedSequence ? `<div class="admin-campaign-automation" data-state="${automation.active ? "active" : automation.blockedReason ? "blocked" : "ready"}"><strong>${automation.active ? "Automation active" : "Automation gated"}</strong><span>${automation.active ? `${automation.remainingToday ?? campaign.dailySendLimit ?? 25} approvals available today` : escapeHtml(automation.blockedReason || "Ready after activation")}</span></div>` : ""}
      <div class="admin-campaign-metrics"><span>${metrics.drafts || 0} drafts</span><span>${metrics.approved || 0} approved</span><span>${metrics.sent || 0} sent</span><span>${metrics.automated || 0} automated</span><span>${metrics.failed || 0} failed</span></div>
      <div class="admin-campaign-outcomes" data-campaign-outcomes="${escapeAttr(campaign.id)}" role="group" aria-label="${escapeAttr(`${campaign.name} outcome funnel`)}">
        <span data-outcome-stage="reached"><strong>${Number(funnel.reached || 0)}</strong><small>Reached</small></span>
        <span data-outcome-stage="delivered"><strong>${Number(funnel.delivered || 0)}</strong><small>Delivered</small></span>
        <span data-outcome-stage="opened"><strong>${Number(funnel.opened || 0)}</strong><small>Opened</small></span>
        <span data-outcome-stage="clicked"><strong>${Number(funnel.clicked || 0)}</strong><small>Clicked</small></span>
        <span data-outcome-stage="applications"><strong>${Number(funnel.applications || 0)}</strong><small>Applications</small></span>
      </div>
      <div class="admin-followup-actions">
        ${["draft", "paused"].includes(campaign.status) ? `<button type="button" class="button primary" data-campaign-action="activate" data-campaign-id="${escapeAttr(campaign.id)}" data-campaign-delivery-mode="${escapeAttr(campaign.deliveryMode || "review_first")}">${automatedSequence ? "Approve and activate" : "Activate"}</button>` : ""}
        ${campaign.status === "active" ? `<button type="button" class="button secondary" data-campaign-generate="${escapeAttr(campaign.id)}">Generate due drafts</button><button type="button" class="button secondary" data-campaign-action="pause" data-campaign-id="${escapeAttr(campaign.id)}">Pause</button><button type="button" class="button secondary" data-campaign-action="complete" data-campaign-id="${escapeAttr(campaign.id)}">Complete</button>` : ""}
        ${["draft", "paused", "complete"].includes(campaign.status) ? `<button type="button" class="button secondary" data-campaign-action="archive" data-campaign-id="${escapeAttr(campaign.id)}">Archive</button>` : ""}
      </div>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No outreach campaigns.</span></article>';
  applications.querySelectorAll("[data-save-application]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-partner-application]");
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(button.dataset.saveApplication)}`, {
        method: "PATCH", body: JSON.stringify({ status: card.querySelector('[name="status"]').value })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Application status saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  async function createFreshPartnerPortalAccess(applicationId) {
    const result = await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(applicationId)}/portal-access`, { method: "POST", body: "{}" });
    let url = result.portalAccess.url;
    if (BOARD_DEMO_ACCESS.enabled) {
      const boardUrl = new URL(url);
      boardUrl.searchParams.set("apiBase", adminApiBase());
      url = boardUrl.toString();
    }
    return { ...result, portalAccess: { ...result.portalAccess, url } };
  }
  applications.querySelectorAll("[data-open-demo-portal]").forEach(button => button.addEventListener("click", async () => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setAdminStatus("The partner portal window could not be opened.", "error");
      return;
    }
    popup.opener = null;
    button.disabled = true;
    try {
      const result = await createFreshPartnerPortalAccess(button.dataset.openDemoPortal);
      popup.location.replace(result.portalAccess.url);
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`Opened a fresh private demo portal for ${result.application.reference}. The previous link no longer works.`, "ok");
    } catch (error) {
      if (!popup.closed) popup.close();
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }));
  applications.querySelectorAll("[data-rotate-portal]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await createFreshPartnerPortalAccess(button.dataset.rotatePortal);
      const copied = await writeClipboardText(result.portalAccess.url);
      await loadAdminPartners({ quiet: true });
      setAdminStatus(copied
        ? `A new private portal link for ${result.application.reference} is on the clipboard. The previous link no longer works.`
        : BOARD_DEMO_ACCESS.enabled
          ? `A new private portal link for ${result.application.reference} was created, but the browser blocked clipboard access. Use Open demo portal to continue.`
          : `A new private portal link for ${result.application.reference} was created, but the browser blocked clipboard access. Allow clipboard access and rotate the link again before handing it off.`, copied ? "ok" : "warning");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  applications.querySelectorAll("[data-record-payment]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-partner-application]");
    const amount = Number(card.querySelector('[name="paymentAmount"]').value);
    if (!Number.isFinite(amount) || amount <= 0) { setAdminStatus("Enter a payment amount greater than zero.", "error"); return; }
    const referenceInput = card.querySelector('[name="paymentReference"]');
    const externalRef = referenceInput.value.trim();
    if (!externalRef) {
      setAdminStatus("Enter a receipt or transaction reference before recording this payment.", "error");
      referenceInput.focus();
      return;
    }
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(button.dataset.recordPayment)}/payments`, {
        method: "POST", body: JSON.stringify({
          amountCents: Math.round(amount * 100),
          method: card.querySelector('[name="paymentMethod"]').value,
          status: "succeeded",
          externalRef,
          receivedAt: card.querySelector('[name="paymentReceivedAt"]').value || undefined
        })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`Recorded ${adminMoney(Math.round(amount * 100))}.`, "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  applications.querySelectorAll("[data-reverse-payment]").forEach(button => button.addEventListener("click", async () => {
    const row = button.closest("[data-partner-payment]");
    const reason = row.querySelector('[name="reversalReason"]').value.trim();
    if (!reason) { setAdminStatus("Enter a reason before reversing a payment.", "error"); return; }
    button.disabled = true;
    try {
      const action = row.querySelector('[name="reversalAction"]').value;
      await adminFetch(`/api/admin/partners/payments/${encodeURIComponent(button.dataset.reversePayment)}/reverse`, {
        method: "POST",
        body: JSON.stringify({ action, reason })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(action === "refund" ? "Provider refund recorded and balances restored." : "Payment void recorded and balances restored.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  applications.querySelectorAll("[data-create-invoice]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(button.dataset.createInvoice)}/invoices`, { method: "POST", body: "{}" });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Invoice draft created from the approved application amount.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  applications.querySelectorAll("[data-review-invoice]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/invoices/${encodeURIComponent(button.dataset.reviewInvoice)}/review`, {
        method: "POST", body: JSON.stringify({ action: button.dataset.action })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(button.dataset.action === "approve" ? "Invoice approved. It has not been sent to QuickBooks yet." : "Invoice voided.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  applications.querySelectorAll("[data-sync-invoice]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/invoices/${encodeURIComponent(button.dataset.syncInvoice)}/sync`, { method: "POST" });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`QuickBooks sync queued as ${result.job.id}.`, "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  applications.querySelectorAll("[data-reconcile-invoice]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/invoices/${encodeURIComponent(button.dataset.reconcileInvoice)}/reconcile`, { method: "POST" });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`QuickBooks balance refresh queued as ${result.job.id}.`, "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  followups.querySelectorAll("[data-review-followup]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/followups/${encodeURIComponent(button.dataset.reviewFollowup)}/review`, {
        method: "POST", body: JSON.stringify({ action: button.dataset.action })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(button.dataset.action === "approve" ? "Message approved. It has not been sent yet." : "Message dismissed.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  followups.querySelectorAll("[data-send-followup]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/followups/${encodeURIComponent(button.dataset.sendFollowup)}/send`, { method: "POST" });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`Message queued for ${result.email.provider} delivery as ${result.job.id}.`, "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  prospects.querySelectorAll("[data-save-prospect]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-outreach-prospect]");
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/outreach/prospects/${encodeURIComponent(button.dataset.saveProspect)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: card.querySelector('[name="status"]').value,
          contactBasis: card.querySelector('[name="contactBasis"]').value,
          industry: card.querySelector('[name="industry"]').value,
          city: card.querySelector('[name="city"]').value,
          state: card.querySelector('[name="state"]').value,
          postalCode: card.querySelector('[name="postalCode"]').value,
          latitude: card.querySelector('[name="latitude"]').value || null,
          longitude: card.querySelector('[name="longitude"]').value || null,
          communityFit: card.querySelector('[name="communityFit"]').checked,
          website: card.querySelector('[name="website"]').value,
          contactName: card.querySelector('[name="contactName"]').value,
          contactEmail: card.querySelector('[name="contactEmail"]').value,
          ownerId: card.querySelector('[name="ownerId"]').value,
          nextAction: card.querySelector('[name="nextAction"]').value,
          nextActionAt: localDateTimeToIso(card.querySelector('[name="nextActionAt"]').value)
        })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Prospect qualification saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  prospects.querySelectorAll("[data-sponsor-invitation-action]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-outreach-prospect]");
    const action = button.dataset.sponsorInvitationAction;
    const prospectId = button.dataset.prospectId;
    const opensInvitation = action === "open";
    const popup = opensInvitation ? window.open("about:blank", "_blank") : null;
    if (opensInvitation && !popup) {
      setAdminStatus("The sponsor invitation window could not be opened.", "error");
      return;
    }
    if (popup) popup.opener = null;
    if (action === "issue" && card.querySelector('[data-sponsor-invitation-action="revoke"]') && !window.confirm("Replace this invitation? The current link will stop working and any unsent outreach will return to review.")) return;
    if (action === "revoke" && !window.confirm("Revoke this sponsor invitation and dismiss any unsent outreach that contains it?")) return;
    button.disabled = true;
    try {
      const packageId = card.querySelector('[name="sponsorPackageId"]')?.value || null;
      const result = await adminFetch(`/api/admin/outreach/prospects/${encodeURIComponent(prospectId)}/sponsor-invitation`, {
        method: "POST",
        body: JSON.stringify({ action: opensInvitation ? "copy" : action, packageId: action === "issue" ? packageId : undefined })
      });
      const invitationUrl = result.invitation?.url || "";
      const copied = !opensInvitation && invitationUrl ? await writeClipboardText(invitationUrl) : false;
      if (opensInvitation) {
        const publicUrl = new URL(invitationUrl);
        if (BOARD_DEMO_ACCESS.enabled) publicUrl.searchParams.set("apiBase", adminApiBase());
        popup.location.replace(publicUrl.toString());
      }
      await loadAdminPartners({ quiet: true });
      if (opensInvitation) setAdminStatus("Opened the sponsor invitation in a new window.", "ok");
      else if (action === "copy") setAdminStatus(copied ? "The current sponsor invitation is on the clipboard." : "The browser blocked clipboard access. Use Open invitation instead.", copied ? "ok" : "warning");
      else if (action === "revoke") setAdminStatus(`Sponsor invitation revoked${result.dismissedDrafts ? `; ${result.dismissedDrafts} unsent message${result.dismissedDrafts === 1 ? "" : "s"} dismissed` : ""}.`, "ok");
      else setAdminStatus(`Sponsor invitation issued${copied ? " and copied" : ". Use Open invitation or Copy link"}${result.refreshedDrafts ? `; ${result.refreshedDrafts} message${result.refreshedDrafts === 1 ? "" : "s"} returned to review` : ""}.`, "ok");
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setAdminStatus(error.message, "error");
    } finally { button.disabled = false; }
  }));
  prospects.querySelectorAll("[data-suppress-prospect]").forEach(button => button.addEventListener("click", async () => {
    const card = button.closest("[data-outreach-prospect]");
    const suppressionReason = card.querySelector('[name="suppressionReason"]').value.trim();
    if (!suppressionReason) { setAdminStatus("Enter a suppression reason.", "error"); return; }
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/outreach/prospects/${encodeURIComponent(button.dataset.suppressProspect)}`, { method: "PATCH", body: JSON.stringify({ suppressed: true, suppressionReason }) });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Prospect suppressed and unsent drafts dismissed.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  prospects.querySelectorAll("[data-restore-prospect]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/outreach/prospects/${encodeURIComponent(button.dataset.restoreProspect)}`, { method: "PATCH", body: JSON.stringify({ suppressed: false, status: "researching" }) });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Prospect restored to research.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  campaigns?.querySelectorAll("[data-campaign-action]").forEach(button => button.addEventListener("click", async () => {
    const action = button.dataset.campaignAction;
    if (action === "activate" && button.dataset.campaignDeliveryMode === "approved_sequence" && !window.confirm("Approve this campaign's current targeting, templates, and sequence for automatic delivery up to its daily limit?")) return;
    button.disabled = true;
    try {
      const lifecycle = await adminFetch(`/api/admin/outreach/campaigns/${encodeURIComponent(button.dataset.campaignId)}/${action}`, { method: "POST" });
      const generated = action === "activate" ? Number(lifecycle.generated || 0) : 0;
      await loadAdminPartners({ quiet: true });
      const automated = button.dataset.campaignDeliveryMode === "approved_sequence";
      const inFlightCopy = lifecycle.inFlightFollowups ? ` ${lifecycle.inFlightFollowups} already claimed delivery${lifecycle.inFlightFollowups === 1 ? " is" : "ies are"} still in flight.` : "";
      setAdminStatus(action === "activate" ? `Campaign activated with ${generated} due message${generated === 1 ? "" : "s"}${automated ? " eligible for bounded automation" : " ready for review"}.` : `Campaign ${action}d.${inFlightCopy}`, "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
  campaigns?.querySelectorAll("[data-campaign-generate]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/outreach/campaigns/${encodeURIComponent(button.dataset.campaignGenerate)}/generate`, { method: "POST" });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`${result.generated} due outreach draft${result.generated === 1 ? "" : "s"} generated.`, "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
}

async function loadAdminPartners({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-partners");
  if (button) {
    button.disabled = true;
    button.textContent = adminPartnerState?.payload ? "Refreshing partner workspace..." : "Loading partner workspace...";
  }
  try {
    const [partners, outreach] = await Promise.all([
      adminFetch("/api/admin/partners"),
      adminFetch("/api/admin/outreach")
    ]);
    renderAdminPartners(partners, outreach);
    if (!quiet) setAdminStatus(`Loaded ${partners.summary.applications.total} partner applications and ${outreach.summary.prospects} outreach targets.`, "ok");
    return { partners, outreach };
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = adminPartnerState?.payload ? "Refresh partner workspace" : "Load partner workspace";
    }
  }
}

function incidentDispatchAssignmentOptions(directory, assigneeType) {
  if (assigneeType === "team") {
    const teams = Array.isArray(directory?.teams) ? directory.teams : [];
    return teams.length
      ? teams.map(team => `<option value="${escapeAttr(team.id)}" data-name="${escapeAttr(team.name)}">${escapeHtml(team.name)}${team.notificationReady ? " · email routed" : " · assignment only"}</option>`).join("")
      : '<option value="">No teams available</option>';
  }
  if (assigneeType === "volunteer") {
    const volunteers = (Array.isArray(directory?.volunteers) ? directory.volunteers : [])
      .filter(volunteer => !["no_show", "withdrawn", "inactive"].includes(volunteer.status));
    return volunteers.length
      ? volunteers.map(volunteer => `<option value="${escapeAttr(volunteer.id)}" data-name="${escapeAttr(volunteer.name)}">${escapeHtml(volunteer.name)}${volunteer.emailAvailable ? " · email on file" : " · no email"}</option>`).join("")
      : '<option value="">No available volunteers</option>';
  }
  if (assigneeType === "staff") {
    const staff = (Array.isArray(directory?.staff) ? directory.staff : [])
      .filter(item => ["active", "on_call"].includes(item.status));
    return staff.length
      ? staff.map(item => `<option value="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}">${escapeHtml(item.name)}${item.emailAvailable ? " · email on file" : " · assignment only"}</option>`).join("")
      : '<option value="">No active staff available</option>';
  }
  return '<option value="">No assignments available</option>';
}

function renderIncidentDispatch(dispatch, incident, payload, canWrite) {
  const notification = dispatch.notification || {};
  const messageStatus = conditionLabel(notification.status || "not_requested");
  const statusOptions = ["assigned", "acknowledged", "en_route", "on_scene", "completed", "canceled"];
  const canReview = canWrite && notification.status === "draft_ready";
  const canDismiss = canWrite && ["draft_ready", "approved", "failed"].includes(notification.status);
  const canSend = canWrite && ["approved", "failed"].includes(notification.status) && payload.email?.ready;
  const emailDraft = notification.channel === "email" ? `
    <div class="admin-dispatch-message" data-dispatch-message>
      <div><strong>Operational email</strong><span data-status="${escapeAttr(notification.status)}">${escapeHtml(messageStatus)} · version ${notification.version || 1}</span></div>
      <label><span>Subject</span><input name="subject" maxlength="998" value="${escapeAttr(notification.subject || "")}" ${["queued", "sent", "canceled"].includes(notification.status) ? "disabled" : ""} /></label>
      <label><span>Message</span><textarea name="body" rows="5" maxlength="10000" ${["queued", "sent", "canceled"].includes(notification.status) ? "disabled" : ""}>${escapeHtml(notification.body || "")}</textarea></label>
      ${notification.lastError ? `<p class="admin-delivery-error">${escapeHtml(notification.lastError)}</p>` : ""}
      <div class="admin-dispatch-message-actions">
        ${canReview ? `<button class="button secondary" type="button" data-review-dispatch="approve" data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}">Approve draft</button>` : ""}
        ${canDismiss ? `<button class="button secondary" type="button" data-review-dispatch="dismiss" data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}">Dismiss draft</button>` : ""}
        ${["approved", "failed"].includes(notification.status) ? `<button class="button primary" type="button" data-send-dispatch data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}" ${canSend ? "" : "disabled"}>Queue email</button>` : ""}
        ${["approved", "failed"].includes(notification.status) && !payload.email?.ready ? '<span>Transactional email is not configured.</span>' : ""}
        ${notification.sentAt ? `<span>Sent ${escapeHtml(new Date(notification.sentAt).toLocaleString())}${notification.provider ? ` via ${escapeHtml(notification.provider)}` : ""}</span>` : ""}
      </div>
    </div>` : "";
  return `
    <div class="admin-dispatch-row" data-dispatch-control="${escapeAttr(dispatch.id)}">
      <div class="admin-dispatch-heading">
        <div><strong>${escapeHtml(dispatch.title)}</strong><span>${escapeHtml(dispatch.assigneeName)} · ${escapeHtml(conditionLabel(dispatch.assigneeType))}${dispatch.assigneeRole ? ` · ${escapeHtml(dispatch.assigneeRole)}` : ""}</span></div>
        <b data-status="${escapeAttr(dispatch.status)}">${escapeHtml(conditionLabel(dispatch.status))}</b>
      </div>
      <p>${escapeHtml(dispatch.instructions || "No additional instructions.")}</p>
      <div class="admin-dispatch-controls">
        <label><span>Status</span><select name="dispatchStatus" ${canWrite ? "" : "disabled"}>${statusOptions.map(value => `<option value="${value}" ${dispatch.status === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("")}</select></label>
        <label><span>Closeout or update note</span><input name="dispatchNote" maxlength="1000" ${canWrite ? "" : "disabled"} /></label>
        <button class="button secondary" type="button" data-save-dispatch="${escapeAttr(dispatch.id)}" data-incident-id="${escapeAttr(incident.id)}" ${canWrite ? "" : "disabled"}>Save dispatch</button>
      </div>
      ${emailDraft}
    </div>`;
}

function renderIncidentDispatchCreate(incident, payload, canWrite) {
  const active = ["open", "acknowledged", "responding", "monitoring"].includes(incident.status);
  if (!active) return "";
  return `
    <form class="admin-dispatch-create" data-create-dispatch="${escapeAttr(incident.id)}">
      <div class="admin-dispatch-section-heading"><strong>New dispatch</strong><span>Assign a responder and optionally prepare an email for review.</span></div>
      <label><span>Assignment</span><select name="assigneeType" ${canWrite ? "" : "disabled"}><option value="team">Team</option><option value="volunteer">Volunteer</option><option value="staff">Staff</option></select></label>
      <label data-dispatch-assignee-field><span>Assignee</span><select name="assigneeId" ${canWrite ? "" : "disabled"}>${incidentDispatchAssignmentOptions(payload.assignmentDirectory, "team")}</select></label>
      <label><span>Notification</span><select name="channel" ${canWrite ? "" : "disabled"}><option value="none">Assignment only</option><option value="email">Prepare email draft</option></select></label>
      <label class="admin-dispatch-wide"><span>Assignment title</span><input name="title" maxlength="180" placeholder="Respond to ${escapeAttr(incident.title)}" ${canWrite ? "" : "disabled"} /></label>
      <label class="admin-dispatch-wide"><span>Instructions</span><textarea name="instructions" rows="2" maxlength="2000" ${canWrite ? "" : "disabled"}></textarea></label>
      <label><span>Due</span><input name="dueAt" type="datetime-local" ${canWrite ? "" : "disabled"} /></label>
      <button class="button primary" type="submit" ${canWrite ? "" : "disabled"}>Create dispatch</button>
    </form>`;
}

function renderAdminConditions(payload) {
  adminConditionsState = payload;
  const container = document.querySelector("#admin-condition-cameras");
  const ingest = document.querySelector("#admin-condition-ingest");
  const feeds = document.querySelector("#admin-condition-feeds");
  const incidentKpis = document.querySelector("#admin-incident-kpis");
  const incidentSummary = document.querySelector("#admin-incident-summary");
  const incidentList = document.querySelector("#admin-incidents");
  const summary = payload.incidentSummary || {};
  const dispatchSummary = payload.dispatchSummary || {};
  if (incidentKpis) incidentKpis.innerHTML = [
    revenueKpiCard("Active", `${summary.active || 0}`, `${summary.open || 0} newly open`),
    revenueKpiCard("Responding", `${summary.responding || 0}`, `${summary.monitoring || 0} monitoring`),
    revenueKpiCard("Critical", `${summary.critical || 0}`, `${summary.unassigned || 0} without owner`),
    revenueKpiCard("Dispatches", `${dispatchSummary.active || 0}`, `${dispatchSummary.onScene || 0} on scene`),
    revenueKpiCard("Message review", `${dispatchSummary.draftsAwaitingReview || 0}`, `${dispatchSummary.failedMessages || 0} failed`),
    revenueKpiCard("Public review", `${summary.publicAlertRecommended || 0}`, `${summary.publicNotices || 0} approved notices`)
  ].join("");
  if (incidentSummary) incidentSummary.textContent = `${summary.active || 0} active · ${dispatchSummary.active || 0} responder assignments · ${dispatchSummary.draftsAwaitingReview || 0} messages awaiting review`;
  if (incidentList) {
    const activeStatuses = new Set(["open", "acknowledged", "responding", "monitoring"]);
    const incidents = (payload.incidents || []).filter(incident => {
      if (incidentBoardFilter === "all") return true;
      if (incidentBoardFilter === "active") return activeStatuses.has(incident.status);
      return incident.status === incidentBoardFilter;
    });
    const canWrite = adminCan("conditions:write");
    const disabled = canWrite ? "" : "disabled";
    const statusOptions = ["open", "acknowledged", "responding", "monitoring", "resolved", "dismissed"];
    const severityOptions = ["low", "moderate", "high", "critical"];
    const teamOptions = ["operations", "traffic", "guest-services", "safety", "medical", "security", "production", "volunteer-captains"];
    incidentList.innerHTML = incidents.length ? incidents.map(incident => {
      const dispatches = (payload.dispatches || []).filter(dispatch => dispatch.incidentId === incident.id);
      return `
      <article class="admin-incident-card" data-severity="${escapeAttr(incident.severity)}" data-status="${escapeAttr(incident.status)}">
        <header><div><strong>${escapeHtml(incident.title)}</strong><span>${escapeHtml(conditionLabel(incident.status))} · ${escapeHtml(conditionLabel(incident.sourceType))}${incident.cameraId ? ` · ${escapeHtml(incident.cameraId)}` : ""}</span></div><b>${escapeHtml(conditionLabel(incident.severity))}</b></header>
        <p>${escapeHtml(incident.summary || "No situation summary recorded.")}</p>
        <div class="admin-incident-flags">
          ${incident.publicAlertRecommended ? '<span data-state="recommended">Public notice review</span>' : ""}
          ${incident.publicImpact ? '<span data-state="public">Public notice approved</span>' : ""}
          <span>${escapeHtml(incident.ownerName || "Unassigned")} · ${escapeHtml(conditionLabel(incident.ownerTeam))}</span>
          <span>Updated ${escapeHtml(new Date(incident.updatedAt).toLocaleString())}</span>
        </div>
        <div class="admin-incident-controls" data-incident-control="${escapeAttr(incident.id)}">
          <label><span>Status</span><select name="status" ${disabled}>${statusOptions.map(value => `<option value="${value}" ${incident.status === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("")}</select></label>
          <label><span>Severity</span><select name="severity" ${disabled}>${severityOptions.map(value => `<option value="${value}" ${incident.severity === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("")}</select></label>
          <label><span>Team</span><select name="ownerTeam" ${disabled}>${teamOptions.map(value => `<option value="${value}" ${incident.ownerTeam === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("")}</select></label>
          <label><span>Owner</span><input name="ownerName" maxlength="120" value="${escapeAttr(incident.ownerName || "")}" ${disabled} /></label>
          <label class="admin-incident-public"><input name="publicImpact" type="checkbox" ${incident.publicImpact ? "checked" : ""} ${disabled} /><span>Approved public notice</span></label>
          <label class="admin-incident-note"><span>Update or resolution note</span><input name="note" maxlength="1000" ${disabled} /></label>
          <button class="button secondary" type="button" data-save-incident="${escapeAttr(incident.id)}" ${disabled}>Save incident</button>
        </div>
        <div class="admin-dispatch-section">
          <div class="admin-dispatch-section-heading"><strong>Responder dispatch</strong><span>${dispatches.length} assignment${dispatches.length === 1 ? "" : "s"}</span></div>
          ${dispatches.length ? dispatches.map(dispatch => renderIncidentDispatch(dispatch, incident, payload, canWrite)).join("") : '<p class="admin-dispatch-empty">No responders assigned yet.</p>'}
          ${renderIncidentDispatchCreate(incident, payload, canWrite)}
        </div>
      </article>`;
    }).join("") : '<article class="empty-state"><span>No incidents match this view.</span></article>';
    incidentList.querySelectorAll("[data-save-incident]").forEach(button => button.addEventListener("click", async () => {
      const controls = button.closest("[data-incident-control]");
      const status = controls.querySelector('[name="status"]').value;
      const note = controls.querySelector('[name="note"]').value.trim();
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/island-conditions/incidents/${encodeURIComponent(button.dataset.saveIncident)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status,
            severity: controls.querySelector('[name="severity"]').value,
            ownerTeam: controls.querySelector('[name="ownerTeam"]').value,
            ownerName: controls.querySelector('[name="ownerName"]').value,
            publicImpact: controls.querySelector('[name="publicImpact"]').checked,
            note,
            resolution: ["resolved", "dismissed"].includes(status) ? note : undefined
          })
        });
        await loadAdminConditions({ quiet: true });
        setAdminStatus("Incident updated.", "ok");
      } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = !adminCan("conditions:write"); }
    }));
    incidentList.querySelectorAll("[data-create-dispatch]").forEach(form => {
      const type = form.querySelector('[name="assigneeType"]');
      const assignee = form.querySelector('[name="assigneeId"]');
      const channel = form.querySelector('[name="channel"]');
      const syncAssignmentFields = ({ rebuildAssignees = false } = {}) => {
        if (rebuildAssignees) {
          const selectedAssignee = assignee.value;
          assignee.innerHTML = incidentDispatchAssignmentOptions(payload.assignmentDirectory, type.value);
          if ([...assignee.options].some(option => option.value === selectedAssignee)) assignee.value = selectedAssignee;
        }
      };
      type.addEventListener("change", () => syncAssignmentFields({ rebuildAssignees: true }));
      syncAssignmentFields({ rebuildAssignees: true });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const assigneeType = type.value;
        const selected = assignee.selectedOptions[0];
        const dueAt = form.querySelector('[name="dueAt"]').value;
        button.disabled = true;
        try {
          await adminFetch(`/api/admin/island-conditions/incidents/${encodeURIComponent(form.dataset.createDispatch)}/dispatches`, {
            method: "POST",
            body: JSON.stringify({
              assigneeType,
              assigneeId: assignee.value,
              assigneeName: selected?.dataset.name,
              channel: channel.value,
              title: form.querySelector('[name="title"]').value,
              instructions: form.querySelector('[name="instructions"]').value,
              dueAt: dueAt ? new Date(dueAt).toISOString() : null
            })
          });
          await loadAdminConditions({ quiet: true });
          setAdminStatus("Responder dispatch created.", "ok");
        } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = !adminCan("conditions:write"); }
      });
    });
    incidentList.querySelectorAll("[data-save-dispatch]").forEach(button => button.addEventListener("click", async () => {
      const row = button.closest("[data-dispatch-control]");
      const message = row.querySelector("[data-dispatch-message]");
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/island-conditions/incidents/${encodeURIComponent(button.dataset.incidentId)}/dispatches/${encodeURIComponent(button.dataset.saveDispatch)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: row.querySelector('[name="dispatchStatus"]').value,
            note: row.querySelector('[name="dispatchNote"]').value,
            subject: message?.querySelector('[name="subject"]')?.value,
            body: message?.querySelector('[name="body"]')?.value
          })
        });
        await loadAdminConditions({ quiet: true });
        setAdminStatus("Dispatch updated.", "ok");
      } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = !adminCan("conditions:write"); }
    }));
    incidentList.querySelectorAll("[data-review-dispatch]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/island-conditions/incidents/${encodeURIComponent(button.dataset.incidentId)}/dispatches/${encodeURIComponent(button.dataset.dispatchId)}/review`, {
          method: "POST",
          body: JSON.stringify({ action: button.dataset.reviewDispatch })
        });
        await loadAdminConditions({ quiet: true });
        setAdminStatus(button.dataset.reviewDispatch === "approve" ? "Dispatch email approved." : "Dispatch email dismissed.", "ok");
      } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = !adminCan("conditions:write"); }
    }));
    incidentList.querySelectorAll("[data-send-dispatch]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/island-conditions/incidents/${encodeURIComponent(button.dataset.incidentId)}/dispatches/${encodeURIComponent(button.dataset.dispatchId)}/send`, { method: "POST", body: "{}" });
        await loadAdminConditions({ quiet: true });
        setAdminStatus("Dispatch email queued for delivery.", "ok");
      } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = !adminCan("conditions:write") || !adminConditionsState?.email?.ready; }
    }));
  }
  if (!container) return;
  if (feeds) {
    const feedTime = value => {
      const timestamp = value ? new Date(value) : null;
      return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString() : "No successful observation";
    };
    const feedRow = (label, feed, observedAt) => {
      const state = feed?.freshness?.state || "unavailable";
      const synthetic = ["Board weather simulation", "Board ferry simulation"].includes(feed?.source);
      const lastAttempt = feed?.refreshAttemptedAt ? `Last attempt ${feedTime(feed.refreshAttemptedAt)}` : "No refresh attempt recorded";
      const detail = feed?.refreshError ? `Refresh failed: ${feed.refreshError}` : lastAttempt;
      const displayState = synthetic ? "Simulated · Current" : `${conditionLabel(feed?.status)} · ${conditionLabel(state)}`;
      return `<div class="admin-condition-feed" data-state="${escapeAttr(state)}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(displayState)}</span><small>Observed ${escapeHtml(feedTime(observedAt))} · ${escapeHtml(detail)}</small></div>`;
    };
    feeds.innerHTML = [
      feedRow(payload.weather?.source || "National Weather Service", payload.weather || {}, payload.weather?.observedAt),
      feedRow(payload.ferry?.source || "TxDOT ferry", payload.ferry || {}, payload.ferry?.checkedAt || payload.ferry?.observedAt)
    ].join("");
  }
  if (ingest) ingest.textContent = payload.ingest?.ready
    ? `${payload.ingest.mode === "per-camera" ? `${payload.ingest.credentialCount || 0} camera credentials across ${payload.ingest.cameraCount || 0} sources` : "Development ingest credential"} ready · ${payload.summary?.armedCameras || 0} armed · ${payload.summary?.healthyPipelines || 0} healthy · ${payload.summary?.offlinePipelines || 0} need attention`
    : `Signed ingest off · ${payload.summary?.standbyCameras || 0} sources in standby`;
  container.innerHTML = (payload.cameras || []).map(camera => {
    const health = camera.health;
    const syntheticPlayback = health?.agentId === "board-camera-playback";
    const healthDetail = health
      ? [
          health.agentId ? `agent ${health.agentId}` : null,
          health.framesPerSecond != null ? `${health.framesPerSecond} fps` : null,
          health.inferenceLatencyMs != null ? `${health.inferenceLatencyMs} ms inference` : null,
          health.droppedFramePct != null ? `${health.droppedFramePct}% dropped` : null
        ].filter(Boolean).join(" · ")
      : "No agent heartbeat";
    const cameraCredentialCount = payload.ingest?.mode === "shared-development"
      ? 1
      : (payload.ingest?.boundCameraIds || []).includes(camera.id)
        ? (payload.ingest?.rotatingCameraIds || []).includes(camera.id) ? 2 : 1
        : 0;
    const credentialDetail = cameraCredentialCount > 1
      ? "Credential ready · rotation overlap active"
      : cameraCredentialCount === 1
        ? "Credential ready"
        : "Credential required before arming";
    return `<article data-operational-status="${escapeAttr(camera.operationalStatus)}"${syntheticPlayback ? ' data-source-mode="playback"' : ""}>
    <header><strong>${escapeHtml(camera.name)}</strong><b>${escapeHtml(syntheticPlayback && camera.operationalStatus === "live" ? "Playback" : conditionLabel(camera.operationalStatus))}</b></header>
    <p>${escapeHtml(camera.zone)} · metric ${escapeHtml(syntheticPlayback && camera.freshness.state === "live" ? "simulated" : conditionLabel(camera.freshness.state))} · heartbeat ${escapeHtml(syntheticPlayback && camera.healthFreshness?.state === "live" ? "current" : conditionLabel(camera.healthFreshness?.state))}</p>
    <span>${camera.observation ? `${camera.observation.peopleCount || 0} people · ${camera.observation.flowPerMinute || 0}/min · ${camera.observation.estimatedWaitMinutes || 0}m wait` : "No current observation"}</span>
    <span class="admin-camera-health">${escapeHtml(healthDetail)}</span>
    <span class="admin-camera-credential" data-ready="${cameraCredentialCount > 0 ? "true" : "false"}">${escapeHtml(credentialDetail)}</span>
    ${health?.lastError ? `<span class="admin-camera-error">${escapeHtml(health.lastError)}</span>` : ""}
    <div class="admin-camera-config" data-camera-config="${escapeAttr(camera.id)}">
      <input name="sourceId" value="${escapeAttr(camera.sourceId || "")}" maxlength="100" placeholder="Source ID" aria-label="${escapeAttr(camera.name)} source ID" />
      <select name="status" aria-label="${escapeAttr(camera.name)} source status"><option value="awaiting_source" ${camera.status === "awaiting_source" ? "selected" : ""}>Awaiting source</option><option value="configured" ${camera.status === "configured" ? "selected" : ""}>Configured</option><option value="disabled" ${camera.status === "disabled" ? "selected" : ""}>Disabled</option></select>
      <input name="staleAfterMinutes" type="number" min="1" max="120" value="${escapeAttr(camera.staleAfterMinutes || 15)}" aria-label="${escapeAttr(camera.name)} stale minutes" />
      <input name="sourceUrl" value="${escapeAttr(camera.sourceUrl || "")}" maxlength="1000" placeholder="Public source URL" aria-label="${escapeAttr(camera.name)} public source URL" />
      <label class="admin-camera-arm"><input name="monitoringEnabled" type="checkbox" ${camera.monitoringEnabled ? "checked" : ""} /> Arm monitoring</label>
      <button type="button" class="button secondary" data-save-camera="${escapeAttr(camera.id)}" ${adminCan("conditions:write") ? "" : "disabled"}>Save source</button>
    </div>
  </article>`;
  }).join("");
  container.querySelectorAll("[data-save-camera]").forEach(button => button.addEventListener("click", async () => {
    const form = button.closest("[data-camera-config]");
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/island-conditions/cameras/${encodeURIComponent(button.dataset.saveCamera)}`, {
        method: "PATCH",
        body: JSON.stringify({
          sourceId: form.querySelector('[name="sourceId"]').value,
          status: form.querySelector('[name="status"]').value,
          staleAfterMinutes: Number(form.querySelector('[name="staleAfterMinutes"]').value),
          sourceUrl: form.querySelector('[name="sourceUrl"]').value,
          monitoringEnabled: form.querySelector('[name="monitoringEnabled"]').checked
        })
      });
      await loadAdminConditions({ quiet: true });
      setAdminStatus("Camera source saved.", "ok");
    } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
  }));
}

async function loadAdminConditions({ quiet = false } = {}) {
  const button = document.querySelector("#admin-load-conditions");
  if (button) {
    button.disabled = true;
    button.textContent = adminConditionsState ? "Refreshing island operations..." : "Loading island operations...";
  }
  try {
    const data = await adminFetch("/api/admin/island-conditions");
    if (!adminSessionState) await loadAdminSession();
    renderAdminConditions(data);
    if (!quiet) setAdminStatus(`Loaded ${data.summary.liveCameras} current condition sources and ${data.incidentSummary?.active || 0} active incidents.`, "ok");
    return data;
  } catch (error) {
    if (!quiet) setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = adminConditionsState ? "Refresh island operations" : "Load island operations";
    }
  }
}

async function loadAdminTransactions() {
  const button = document.querySelector("#admin-load-orders");
  const orderList = document.querySelector("#admin-order-list");
  const eventList = document.querySelector("#admin-payment-event-list");
  const fulfillmentList = document.querySelector("#admin-fulfillment-list");
  const auditList = document.querySelector("#admin-audit-list");
  const snapshotList = document.querySelector("#admin-snapshot-list");
  button.disabled = true;
  try {
    const [jobs, orders, events, fulfillment, audit, snapshots] = await Promise.all([
      adminFetch("/api/admin/jobs?limit=50"),
      adminFetch("/api/admin/orders?limit=12"),
      adminFetch("/api/admin/payment-events?limit=12"),
      adminFetch("/api/admin/fulfillment?limit=12"),
      adminFetch("/api/admin/audit?limit=12"),
      adminFetch("/api/admin/snapshots?limit=12")
    ]);
    renderAdminJobs(jobs);
    orderList.innerHTML = orders.pendingOrders.length
      ? orders.pendingOrders.map(orderRecordCard).join("")
      : '<article class="empty-state"><span>No pending checkout attempts yet.</span></article>';
    eventList.innerHTML = events.paymentEvents.length
      ? events.paymentEvents.map(paymentEventCard).join("")
      : '<article class="empty-state"><span>No payment events yet.</span></article>';
    fulfillmentList.innerHTML = fulfillment.fulfillment.length
      ? fulfillment.fulfillment.map(fulfillmentCard).join("")
      : '<article class="empty-state"><span>No fulfillment records yet.</span></article>';
    auditList.innerHTML = audit.audit.length
      ? audit.audit.map(auditCard).join("")
      : '<article class="empty-state"><span>No admin mutations recorded yet.</span></article>';
    snapshotList.innerHTML = snapshots.snapshots.length
      ? snapshots.snapshots.map(snapshotCard).join("")
      : '<article class="empty-state"><span>No config snapshots yet.</span></article>';
    bindFulfillmentButtons();
    bindBoardTicketRefundButtons();
    bindSnapshotButtons();
    if (adminSessionState) renderAdminSession(adminSessionState);
    setAdminStatus(`Loaded ${jobs.jobs.length} automation records, ${orders.pendingOrders.length} order records, ${events.paymentEvents.length} payment events, ${fulfillment.fulfillment.length} fulfillment records, ${audit.audit.length} audit entries, and ${snapshots.snapshots.length} snapshots.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function bindBoardTicketRefundButtons() {
  document.querySelectorAll("[data-refund-board-ticket]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Refund this local demonstration ticket order? No external payment will be touched.")) return;
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/board-demo/ticket-orders/${encodeURIComponent(button.dataset.refundBoardTicket)}/refund`, {
          method: "POST",
          body: JSON.stringify({ reason: "Refunded during the board presentation ticket lifecycle demonstration." })
        });
        setAdminStatus(`Refunded demo ticket order ${result.order.id}. Fulfillment and revenue were reversed.`, "ok");
        await Promise.all([loadAdminTransactions(), loadAdminRevenue({ quiet: true })]);
      } catch (error) {
        setAdminStatus(error.message, "error");
        button.disabled = false;
      }
    });
  });
}

function bindSnapshotButtons() {
  document.querySelectorAll("[data-restore-snapshot]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/snapshots/${encodeURIComponent(button.dataset.restoreSnapshot)}/restore`, {
          method: "POST",
          body: JSON.stringify({})
        });
        setAdminStatus(`Restored ${result.target.type} from snapshot ${result.snapshotId}. Run public sync/rebuild if public data changed.`, "ok");
        await loadAdminTransactions();
        if (result.target.type === "alert") await loadAdminAlert();
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function bindFulfillmentButtons() {
  document.querySelectorAll("[data-save-fulfillment]").forEach(button => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-fulfillment-id]");
      const status = card.querySelector("select").value;
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/fulfillment/${encodeURIComponent(button.dataset.saveFulfillment)}`, {
          method: "PATCH",
          body: JSON.stringify({ status, note: `Status changed to ${status} from admin console.` })
        });
        setAdminStatus(`Updated fulfillment ${result.fulfillment.id} to ${result.fulfillment.status}.`, "ok");
        await loadAdminTransactions();
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

function centsFromInput(value) {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function bindAdminSaveButtons() {
  adminTicketPolicyUi?.bindTicketPolicyEditor({
    adminFetch,
    getConfigState: () => adminConfigState,
    getSessionState: () => adminSessionState,
    loadDeployment: loadAdminDeployment,
    renderSession: renderAdminSession,
    setFormStatus
  });

  document.querySelectorAll("[data-save-ticket]").forEach(button => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-admin-ticket]");
      const id = button.dataset.saveTicket;
      const source = adminConfigState.tickets.products.find(product => product.id === id);
      const quantityMax = Number(card.querySelector('[name="quantityMax"]').value);
      const patch = {
        priceLabel: card.querySelector('[name="priceLabel"]').value,
        unitAmount: centsFromInput(card.querySelector('[name="unitAmount"]').value),
        stripePriceId: card.querySelector('[name="stripePriceId"]').value || null,
        quantity: {
          ...(source.quantity ?? {}),
          max: Number.isFinite(quantityMax) ? quantityMax : source.quantity?.max
        },
        requiresReview: card.querySelector('[name="requiresReview"]').checked
      };
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/tickets/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
        Object.assign(source, result.product);
        setAdminStatus(`Saved ticket config for ${result.product.name}. Public checkout availability is updated; the offline fallback changes with the next site release.`, "ok");
        renderAdminEditors();
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-save-sponsor]").forEach(button => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-admin-sponsor]");
      const id = button.dataset.saveSponsor;
      const source = adminConfigState.config.sponsorPackages.find(item => item.id === id);
      const patch = {
        publicLabel: card.querySelector('[name="publicLabel"]').value,
        amount: centsFromInput(card.querySelector('[name="amount"]').value),
        intakeMode: card.querySelector('[name="intakeMode"]').value,
        stripePriceId: card.querySelector('[name="stripePriceId"]').value || null,
        quickBooksItemId: card.querySelector('[name="quickBooksItemId"]').value || null,
        benefits: card.querySelector('[name="benefits"]').value.split("\n").map(item => item.trim()).filter(Boolean),
        active: card.querySelector('[name="active"]').checked,
        requiresApproval: card.querySelector('[name="requiresApproval"]').checked
      };
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/sponsor-packages/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
        Object.assign(source, result.sponsorPackage);
        setAdminStatus(`Saved sponsor config for ${result.sponsorPackage.name}.`, "ok");
        renderAdminEditors();
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-save-vendor-offering]").forEach(button => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-admin-vendor-offering]");
      const id = button.dataset.saveVendorOffering;
      const source = adminConfigState.config.vendorOfferings.find(item => item.id === id);
      const patch = {
        name: card.querySelector('[name="name"]').value,
        publicLabel: card.querySelector('[name="publicLabel"]').value,
        amount: centsFromInput(card.querySelector('[name="amount"]').value),
        categories: card.querySelector('[name="categories"]').value.split(",").map(item => item.trim().toLowerCase()).filter(Boolean),
        stripePriceId: card.querySelector('[name="stripePriceId"]').value || null,
        quickBooksItemId: card.querySelector('[name="quickBooksItemId"]').value || null,
        description: card.querySelector('[name="description"]').value,
        inclusions: card.querySelector('[name="inclusions"]').value.split("\n").map(item => item.trim()).filter(Boolean),
        active: card.querySelector('[name="active"]').checked,
        requiresApproval: card.querySelector('[name="requiresApproval"]').checked
      };
      button.disabled = true;
      try {
        const result = await adminFetch(`/api/admin/vendor-offerings/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
        Object.assign(source, result.vendorOffering);
        setAdminStatus(`Saved vendor offering ${result.vendorOffering.name}.`, "ok");
        renderAdminEditors();
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        button.disabled = !adminCan("finance:write");
      }
    });
  });
}

async function loadAdminWorkspace() {
  const button = document.querySelector("#admin-load-config");
  button.disabled = true;
  setAdminStatus("Loading admin config...", "idle");
  let loaded = false;
  try {
    await loadAdminSession();
    await loadAdminDeployment();
    if (adminCan("admin:read")) await loadAdminJobHealth();
    adminConfigState = await adminFetch("/api/admin/config");
    await loadAdminAlert();
    renderAdminEditors();
    if (adminCan("orders:read") && adminCan("payments:read") && adminCan("fulfillment:read") && adminCan("audit:read") && adminCan("snapshot:read")) {
      await loadAdminTransactions().catch(() => {});
    }
    if (adminCan("documents:read")) {
      await loadAdminDocuments({ quiet: true }).catch(() => {});
    }
    if (adminCan("revenue:read")) {
      await loadAdminRevenue({ quiet: true }).catch(() => {});
    }
    if (adminCan("budget:read")) {
      await loadAdminBudget({ quiet: true }).catch(() => {});
    }
    if (adminCan("fleet:read")) {
      await loadAdminFleet({ quiet: true }).catch(() => {});
    }
    if (adminCan("volunteers:read")) {
      await loadAdminVolunteers({ quiet: true }).catch(() => {});
    }
    if (adminCan("consent:read")) {
      await loadAdminConsent({ quiet: true }).catch(() => {});
    }
    if (adminCan("passport:read")) {
      await loadAdminPassport({ quiet: true }).catch(() => {});
    }
    if (adminCan("voting:read")) {
      await loadAdminVoting({ quiet: true }).catch(() => {});
    }
    if (adminCan("booths:read")) {
      await loadAdminBooths({ quiet: true }).catch(() => {});
    }
    if (adminCan("partners:read") && adminCan("outreach:read")) {
      await loadAdminPartners({ quiet: true }).catch(() => {});
    }
    if (adminCan("conditions:read")) {
      await loadAdminConditions({ quiet: true }).catch(() => {});
    }
    setAdminStatus(`Loaded ${adminConfigState.tickets.products.length} ticket products, ${adminConfigState.config.sponsorPackages.length} sponsor packages, and ${adminConfigState.config.vendorOfferings.length} vendor offerings.`, "ok");
    loaded = true;
    if (BOARD_DEMO_ACCESS.enabled) boardDemoWorkspaceLoaded = true;
    stabilizeRenderedHashTarget();
  } catch (error) {
    const localHint = ADMIN_AUTH_MODE === "token" ? " Confirm the local API is running and the token matches." : "";
    setAdminStatus(`${error.message}${localHint}`, "error");
  } finally {
    button.disabled = ADMIN_AUTH_MODE === "oidc" && !adminToken();
  }
  return loaded;
}

async function loadBoardDemoWorkspace() {
  if (!BOARD_DEMO_ACCESS.enabled || boardDemoWorkspaceLoaded) return boardDemoWorkspaceLoaded;
  if (boardDemoWorkspaceLoad) return boardDemoWorkspaceLoad;
  boardDemoWorkspaceLoad = loadAdminWorkspace().finally(() => {
    boardDemoWorkspaceLoad = null;
  });
  return boardDemoWorkspaceLoad;
}

async function waitForBoardDemoReset(previousGeneration, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${adminApiBase()}/health`, {
        cache: "no-store"
      }, 1_500);
      const health = response.ok ? await response.json() : null;
      if (health?.boardDemoRuntime === true
        && health?.boardDemoResetReady === true
        && health?.boardDemoGeneration
        && health.boardDemoGeneration !== previousGeneration) {
        return health;
      }
    } catch {
      // The local API is expected to be briefly unavailable during restoration.
    }
    await new Promise(resolve => window.setTimeout(resolve, 250));
  }
  throw new Error("The board demonstration did not return to its prepared state in time.");
}

async function resetBoardDemo(event) {
  if (!BOARD_DEMO_ACCESS.enabled) return;
  const button = event.currentTarget;
  const confirmed = window.confirm("Restore the prepared board demonstration? All changes made in this local demo session will be discarded.");
  if (!confirmed) return;
  button.disabled = true;
  button.dataset.state = "resetting";
  setAdminStatus("Restoring the prepared board demonstration...", "idle");
  try {
    const reset = await adminFetch("/api/admin/board-demo/reset", { method: "POST" });
    await waitForBoardDemoReset(reset.generation);
    window.location.reload();
  } catch (error) {
    setAdminStatus(error.message, "error");
    button.disabled = false;
    delete button.dataset.state;
  }
}

document.querySelector("#admin-load-config").addEventListener("click", loadAdminWorkspace);
document.querySelector("#admin-reset-board-demo")?.addEventListener("click", resetBoardDemo);
const adminCreateSponsorPackageForm = document.querySelector("#admin-create-sponsor-package");
adminCreateSponsorPackageForm?.elements.name.addEventListener("input", event => {
  const idInput = adminCreateSponsorPackageForm.elements.id;
  if (idInput.dataset.manuallyEdited === "true") return;
  idInput.value = event.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
});
adminCreateSponsorPackageForm?.elements.id.addEventListener("input", event => {
  event.currentTarget.dataset.manuallyEdited = event.currentTarget.value ? "true" : "false";
});
adminCreateSponsorPackageForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await adminFetch("/api/admin/sponsor-packages", {
      method: "POST",
      body: JSON.stringify({
        id: values.id,
        name: values.name,
        amount: centsFromInput(values.amount),
        publicLabel: values.publicLabel,
        stripePriceId: values.stripePriceId || null,
        quickBooksItemId: values.quickBooksItemId || null,
        benefits: values.benefits.split("\n").map(item => item.trim()).filter(Boolean),
        active: form.elements.active.checked,
        requiresApproval: form.elements.requiresApproval.checked
      })
    });
    adminConfigState.config.sponsorPackages.push(result.sponsorPackage);
    adminConfigState.config.lastUpdated = result.lastUpdated;
    form.reset();
    delete form.elements.id.dataset.manuallyEdited;
    renderAdminEditors();
    setAdminStatus(`Added ${result.sponsorPackage.name} to the public sponsor catalog.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("sponsor:write");
  }
});
const adminCreateVendorOfferingForm = document.querySelector("#admin-create-vendor-offering");
adminCreateVendorOfferingForm?.elements.name.addEventListener("input", event => {
  const idInput = adminCreateVendorOfferingForm.elements.id;
  if (idInput.dataset.manuallyEdited === "true") return;
  idInput.value = event.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
});
adminCreateVendorOfferingForm?.elements.id.addEventListener("input", event => {
  event.currentTarget.dataset.manuallyEdited = event.currentTarget.value ? "true" : "false";
});
adminCreateVendorOfferingForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await adminFetch("/api/admin/vendor-offerings", {
      method: "POST",
      body: JSON.stringify({
        id: values.get("id"),
        name: values.get("name"),
        amount: centsFromInput(values.get("amount")),
        intakeMode: values.get("intakeMode"),
        publicLabel: values.get("publicLabel"),
        stripePriceId: values.get("stripePriceId") || null,
        quickBooksItemId: values.get("quickBooksItemId") || null,
        categories: values.getAll("categories"),
        description: values.get("description"),
        inclusions: values.get("inclusions").split("\n").map(item => item.trim()).filter(Boolean),
        active: form.elements.active.checked,
        requiresApproval: form.elements.requiresApproval.checked
      })
    });
    adminConfigState.config.vendorOfferings.push(result.vendorOffering);
    adminConfigState.config.lastUpdated = result.lastUpdated;
    form.reset();
    delete form.elements.id.dataset.manuallyEdited;
    renderAdminEditors();
    setAdminStatus(`Added ${result.vendorOffering.name} to the public vendor intake.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("finance:write");
  }
});
document.querySelector("#admin-load-documents")?.addEventListener("click", () => loadAdminDocuments());
document.querySelector("#admin-launch-readiness")?.addEventListener("click", event => {
  const button = event.target.closest("[data-deployment-filter]");
  if (!button || !adminDeploymentState) return;
  adminDeploymentFilter = button.dataset.deploymentFilter === "all" ? "all" : "attention";
  renderAdminDeployment(adminDeploymentState);
});
document.querySelector("#admin-sync-deployment-tasks")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/deployment/tasks/sync", { method: "POST" });
    renderAdminDeployment(data.deployment);
    await loadAdminPartners({ quiet: true });
    const changed = [
      [data.sync.created, "created"],
      [data.sync.reopened, "reopened"],
      [data.sync.updated, "updated"],
      [data.sync.completed, "completed"],
      [data.sync.deduplicated, "duplicate closed"]
    ].filter(([count]) => count).map(([count, label]) => `${count} ${label}`);
    setAdminStatus(changed.length
      ? `Launch work board synchronized: ${changed.join(" · ")}. ${data.sync.active} active.`
      : `Launch work board is current with ${data.sync.active} active task${data.sync.active === 1 ? "" : "s"}.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("partners:write");
  }
});

function resetAdminDocumentReviewDue(form = document.querySelector("#admin-document-upload")) {
  if (!form?.elements.reviewDueAt) return;
  form.elements.reviewDueAt.value = isoToLocalDateTime(new Date(Date.now() + 3 * 86_400_000).toISOString());
}

resetAdminDocumentReviewDue();

document.querySelector('#admin-document-upload [name="file"]')?.addEventListener("change", event => {
  const file = event.currentTarget.files?.[0];
  const title = document.querySelector('#admin-document-upload [name="title"]');
  if (file && title && !title.value.trim()) title.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
});

document.querySelector("#admin-document-upload")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.file.files?.[0];
  const button = form.querySelector('button[type="submit"]');
  const status = document.querySelector("#admin-document-upload-status");
  if (!file) {
    setFormStatus(status, "Choose a document.", "error");
    return;
  }
  button.disabled = true;
  setFormStatus(status, "Uploading private document...", "idle");
  try {
    const response = await adminRawFetch("/api/admin/documents/upload", {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": file.name,
        "x-document-domain": form.elements.domain.value,
        "x-document-title": form.elements.title.value,
        "x-owner-team": form.elements.ownerTeam.value,
        "x-document-review-due-at": localDateTimeToIso(form.elements.reviewDueAt.value) || ""
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Document upload failed with ${response.status}`);
    setFormStatus(status, result.duplicate
      ? "That file is already in the intake queue."
      : result.extractionJob
        ? "Document added and queued for private text extraction."
        : "Document added to the private review queue.", "ok");
    form.reset();
    form.elements.ownerTeam.value = "operations";
    resetAdminDocumentReviewDue(form);
    await loadAdminDocuments({ quiet: true });
  } catch (error) {
    setFormStatus(status, error.message, "error");
  } finally {
    button.disabled = !adminCan("documents:write");
  }
});

document.querySelector("#admin-event-guide-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await publishAdminEventGuide(form);
    setAdminStatus(`Published ${data.guide.dateRange} from the reviewed official source.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("content:write");
  }
});

if (ADMIN_AUTH_MODE === "oidc") {
  document.querySelector("#admin-sign-in")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    setAdminStatus("Redirecting to secure sign-in...", "idle");
    try {
      await adminAuthClient.signIn();
    } catch (error) {
      setAdminStatus(error.message, "error");
      button.disabled = false;
    }
  });

  document.querySelector("#admin-sign-out")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    setAdminStatus("Signing out...", "idle");
    try {
      await adminAuthClient.signOut();
    } catch (error) {
      setAdminStatus(error.message, "error");
      button.disabled = false;
    }
  });
}

document.querySelector("#admin-publish-alert").addEventListener("click", async () => {
  const button = document.querySelector("#admin-publish-alert");
  button.disabled = true;
  try {
    const result = await saveAdminAlert(true);
    const sms = result.sms;
    const smsMessage = sms?.requested
      ? sms.queued > 0
        ? ` ${sms.queued} safety text${sms.queued === 1 ? "" : "s"} queued.`
        : ` Safety texts were not queued: ${sms.reason}`
      : "";
    setAdminStatus(`Published ${result.alert.severity} alert: ${result.alert.title}.${smsMessage}`, sms?.requested && sms.queued === 0 ? "error" : "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-clear-alert").addEventListener("click", async () => {
  const button = document.querySelector("#admin-clear-alert");
  button.disabled = true;
  try {
    const result = await saveAdminAlert(false);
    const suppressed = result.sms?.suppressed || 0;
    setAdminStatus(`Cleared the public emergency alert.${suppressed ? ` ${suppressed} queued safety text${suppressed === 1 ? " was" : "s were"} suppressed.` : ""}`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-load-orders").addEventListener("click", loadAdminTransactions);
document.querySelector("#admin-load-revenue").addEventListener("click", () => loadAdminRevenue());
document.querySelector("#admin-import-revenue")?.addEventListener("input", () => clearRevenueImportPreview());
document.querySelector("#admin-import-revenue")?.elements.file?.addEventListener("change", async event => {
  const form = event.currentTarget.form;
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    form.elements.csv.value = await file.text();
    clearRevenueImportPreview();
  } catch (error) {
    setAdminStatus(`Settlement CSV could not be read: ${error.message}`, "error");
  }
});
document.querySelector("#admin-import-revenue")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = revenueImportPayload(form);
    const result = await adminFetch("/api/admin/revenue/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "preview" })
    });
    revenueImportPreview = { previewHash: result.previewHash };
    renderRevenueImportResult(result);
    const commit = document.querySelector("#admin-commit-revenue-import");
    commit.hidden = false;
    commit.disabled = Number(result.summary?.importable || 0) < 1;
    commit.textContent = `Import ${result.summary?.importable || 0} valid row${result.summary?.importable === 1 ? "" : "s"}`;
    setAdminStatus(`Previewed ${result.summary?.rows || 0} settlement rows.`, result.summary?.invalid || result.summary?.duplicates ? "warning" : "ok");
  } catch (error) {
    clearRevenueImportPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#admin-commit-revenue-import")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!revenueImportPreview?.previewHash) return;
  button.disabled = true;
  try {
    const payload = revenueImportPayload(form);
    const result = await adminFetch("/api/admin/revenue/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "commit", previewHash: revenueImportPreview.previewHash })
    });
    renderRevenueImportResult(result, { committed: true });
    clearRevenueImportPreview({ keepResult: true });
    form.reset();
    await loadAdminRevenue({ quiet: true });
    setAdminStatus(`Imported ${result.summary?.imported || 0} settlement row${result.summary?.imported === 1 ? "" : "s"}; ${result.summary?.duplicates || 0} duplicate${result.summary?.duplicates === 1 ? "" : "s"} skipped.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (!button.hidden) button.disabled = false;
  }
});
document.querySelector("#admin-load-fleet")?.addEventListener("click", () => loadAdminFleet());
document.querySelector("#admin-fleet-checkout")?.addEventListener("click", () => adminFleetCheckout());
document.querySelector("#admin-fleet-checkin")?.addEventListener("click", () => adminFleetCheckin());
document.querySelector("#admin-load-volunteers")?.addEventListener("click", () => loadAdminVolunteers());
document.querySelector("#admin-import-volunteers")?.addEventListener("input", () => clearVolunteerImportPreview());
document.querySelector("#admin-import-volunteers")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = await volunteerImportPayload(form);
    const result = await adminFetch("/api/admin/volunteers/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "preview" })
    });
    volunteerImportPreview = { previewHash: result.previewHash };
    renderVolunteerImportResult(result);
    const valid = volunteerImportCount(result.summary, "valid");
    const commit = document.querySelector("#admin-commit-volunteer-import");
    commit.hidden = false;
    commit.disabled = valid < 1;
    commit.textContent = `Commit ${valid} valid record${valid === 1 ? "" : "s"}`;
    setAdminStatus(`Previewed ${valid} valid VolunteerLocal records${result.summary?.invalid ? ` with ${result.summary.invalid} issue${result.summary.invalid === 1 ? "" : "s"}` : ""}.`, result.summary?.invalid ? "warning" : "ok");
  } catch (error) {
    clearVolunteerImportPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("volunteers:write");
  }
});
document.querySelector("#admin-commit-volunteer-import")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!volunteerImportPreview?.previewHash) return;
  button.disabled = true;
  try {
    const payload = await volunteerImportPayload(form);
    const result = await adminFetch("/api/admin/volunteers/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "commit", previewHash: volunteerImportPreview.previewHash })
    });
    renderVolunteerImportResult(result, { committed: true });
    clearVolunteerImportPreview({ keepResult: true });
    form.reset();
    await loadAdminVolunteers({ quiet: true });
    const changed = volunteerImportCount(result.summary, "created") + volunteerImportCount(result.summary, "updated");
    setAdminStatus(result.replay ? "That VolunteerLocal export was already imported; no records were duplicated." : `Reconciled VolunteerLocal exports: ${changed} record${changed === 1 ? "" : "s"} changed.`, result.summary?.invalid ? "warning" : "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (!button.hidden) button.disabled = !adminCan("volunteers:write");
  }
});
document.querySelector("#admin-import-staff")?.addEventListener("input", () => clearStaffImportPreview());
document.querySelector("#admin-import-staff")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = await staffImportPayload(form);
    const result = await adminFetch("/api/admin/staff-directory/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "preview" })
    });
    staffImportPreview = { previewHash: result.previewHash };
    renderStaffImportResult(result);
    const commit = document.querySelector("#admin-commit-staff-import");
    commit.hidden = false;
    commit.disabled = result.commitAllowed === false || result.readiness?.ready !== true;
    commit.textContent = `Commit ${result.summary?.activeStaff || 0} active staff`;
    setAdminStatus(result.commitAllowed === false ? result.commitBlockReason : `Previewed ${result.summary?.activeStaff || 0} active staff and ${result.summary?.routedTeams || 0} notification routes.`, result.commitAllowed === false ? "warning" : "ok");
  } catch (error) {
    clearStaffImportPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("staff:write");
  }
});
document.querySelector("#admin-commit-staff-import")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!staffImportPreview?.previewHash) return;
  button.disabled = true;
  try {
    const payload = await staffImportPayload(form);
    const result = await adminFetch("/api/admin/staff-directory/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "commit", previewHash: staffImportPreview.previewHash })
    });
    renderStaffImportResult(result, { committed: true });
    clearStaffImportPreview({ keepResult: true });
    form.reset();
    await loadAdminPartners({ quiet: true });
    setAdminStatus(result.replay ? "That staff directory was already imported; no routes were duplicated." : `Activated ${result.summary?.activeStaff || 0} staff and ${result.summary?.routedTeams || 0} notification routes.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (!button.hidden) button.disabled = !adminCan("staff:write");
  }
});
document.querySelector("#admin-load-consent")?.addEventListener("click", () => loadAdminConsent());
document.querySelectorAll("[data-board-sms-preference]").forEach(button => button.addEventListener("click", async event => {
  const action = event.currentTarget.dataset.boardSmsPreference;
  const controls = document.querySelectorAll("[data-board-sms-preference]");
  const status = document.querySelector("#admin-board-sms-preference-status");
  controls.forEach(control => { control.disabled = true; });
  if (status) status.textContent = `Sending ${action} through the loopback SMS sandbox...`;
  try {
    const result = await adminFetch("/api/admin/board-demo/sms-preference", {
      method: "POST",
      body: JSON.stringify({ action })
    });
    await loadAdminConsent({ quiet: true });
    setAdminStatus(`Synthetic attendee ${result.boardDemoPreference?.state === "opted_in" ? "opted in" : "opted out"} through a signed loopback callback.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
    await loadAdminConsent({ quiet: true }).catch(() => {});
  }
}));
document.querySelector("#admin-load-passport")?.addEventListener("click", () => loadAdminPassport());
document.querySelector("#admin-load-voting")?.addEventListener("click", () => loadAdminVoting());
document.querySelector("#admin-load-booths")?.addEventListener("click", () => loadAdminBooths());
document.querySelector("#admin-import-booths")?.addEventListener("input", () => clearBoothImportPreview());
document.querySelector("#admin-import-booths")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = await boothImportPayload(form);
    const result = await adminFetch("/api/admin/booths/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "preview" })
    });
    boothImportPreview = { previewHash: result.previewHash };
    renderBoothImportResult(result);
    const valid = Number(result.summary?.booths?.valid || 0);
    const commit = document.querySelector("#admin-commit-booth-import");
    commit.hidden = false;
    commit.disabled = valid < 1;
    commit.textContent = `Commit ${valid} booth row${valid === 1 ? "" : "s"}`;
    setAdminStatus(`Previewed ${valid} Eventeny booth row${valid === 1 ? "" : "s"}${result.summary?.invalid ? ` with ${result.summary.invalid} issue${result.summary.invalid === 1 ? "" : "s"}` : ""}.`, result.summary?.invalid ? "warning" : "ok");
  } catch (error) {
    clearBoothImportPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("booths:write");
  }
});
document.querySelector("#admin-commit-booth-import")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!boothImportPreview?.previewHash) return;
  button.disabled = true;
  try {
    const payload = await boothImportPayload(form);
    const result = await adminFetch("/api/admin/booths/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "commit", previewHash: boothImportPreview.previewHash })
    });
    renderBoothImportResult(result, { committed: true });
    clearBoothImportPreview({ keepResult: true });
    form.reset();
    await loadAdminBooths({ quiet: true });
    const changed = Number(result.summary?.booths?.created || 0) + Number(result.summary?.booths?.updated || 0)
      + Number(result.summary?.vendors?.created || 0) + Number(result.summary?.vendors?.updated || 0)
      + Number(result.summary?.assignmentChanges || 0);
    setAdminStatus(result.replay ? "That Eventeny booth export was already imported; no records were duplicated." : `Reconciled Eventeny booths: ${changed} record${changed === 1 ? "" : "s"} changed.`, result.summary?.invalid ? "warning" : "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (!button.hidden) button.disabled = !adminCan("booths:write");
  }
});
document.querySelector("#admin-load-partners")?.addEventListener("click", () => loadAdminPartners());
document.querySelector("#admin-download-export")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const name = document.querySelector("#admin-export-type")?.value;
  if (!name) return;
  button.disabled = true;
  try {
    const fileName = await downloadAdminExport(name);
    setAdminStatus(`${fileName} is ready.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#admin-load-conditions")?.addEventListener("click", () => loadAdminConditions());
document.querySelector("#admin-incident-filter")?.addEventListener("change", event => {
  incidentBoardFilter = event.currentTarget.value;
  if (adminConditionsState) renderAdminConditions(adminConditionsState);
});
document.querySelector("#admin-create-incident")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await adminFetch("/api/admin/island-conditions/incidents", {
      method: "POST",
      body: JSON.stringify({ ...values, publicImpact: form.querySelector('[name="publicImpact"]').checked })
    });
    form.reset();
    await loadAdminConditions({ quiet: true });
    setAdminStatus("Incident opened.", "ok");
  } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = !adminCan("conditions:write"); }
});
document.querySelector("#admin-task-status-filter")?.addEventListener("change", event => {
  taskBoardFilters.status = event.currentTarget.value;
  if (adminPartnerState) renderAdminTaskBoard(adminPartnerState.payload);
});
document.querySelector("#admin-task-assignment-filter")?.addEventListener("change", event => {
  taskBoardFilters.assignment = event.currentTarget.value;
  if (adminPartnerState) renderAdminTaskBoard(adminPartnerState.payload);
});
document.querySelector("#admin-task-search")?.addEventListener("input", event => {
  taskBoardFilters.query = event.currentTarget.value.trim();
  if (adminPartnerState) renderAdminTaskBoard(adminPartnerState.payload);
});
document.querySelector('#admin-create-task [name="assigneeType"]')?.addEventListener("change", () => {
  populateTaskCreateOwners(adminPartnerState?.payload || {}, { preserve: false });
});

document.querySelector("#admin-create-task")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await adminFetch("/api/admin/partners/tasks", {
      method: "POST",
      body: JSON.stringify({ ...values, dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null })
    });
    form.reset();
    await loadAdminPartners({ quiet: true });
    setAdminStatus("Task delegated.", "ok");
  } catch (error) { setAdminStatus(error.message, "error"); } finally { button.disabled = false; }
});

document.querySelector("#admin-create-prospect")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    const data = await adminFetch("/api/admin/outreach/prospects", {
      method: "POST",
      body: JSON.stringify({
        ...values,
        latitude: values.latitude || null,
        longitude: values.longitude || null,
        communityFit: form.elements.communityFit.checked,
        nextActionAt: localDateTimeToIso(values.nextActionAt)
      })
    });
    form.reset();
    form.elements.state.value = "TX";
    await loadAdminPartners({ quiet: true });
    setAdminStatus(`Scored ${data.prospect.organizationName} at ${data.prospect.fitScore}/100.`, "ok");
  } catch (error) { setAdminStatus(error.message, "error"); }
});

document.querySelector("#admin-discover-businesses")?.addEventListener("input", event => {
  if (event.target.name === "discoveredSourceRef") {
    updateOutreachDiscoverySelection();
    return;
  }
  clearOutreachDiscoveryPreview();
});

document.querySelector("#admin-discover-businesses")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await adminFetch("/api/admin/outreach/discovery/preview", {
      method: "POST",
      body: JSON.stringify(outreachDiscoveryPayload(form))
    });
    outreachDiscoveryPreview = { previewToken: result.previewToken, expiresAt: result.expiresAt };
    renderOutreachDiscoveryResult(result);
    setAdminStatus(`Found ${result.candidates.length} business candidate${result.candidates.length === 1 ? "" : "s"} for staff review.`, "ok");
  } catch (error) {
    clearOutreachDiscoveryPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminPartnerState?.outreach?.discovery?.ready || !adminCan("outreach:write");
  }
});

document.querySelector("#admin-import-discovered-businesses")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!outreachDiscoveryPreview?.previewToken) return;
  const selectedSourceRefs = [...form.querySelectorAll('input[name="discoveredSourceRef"]:checked')].map(input => input.value);
  if (!selectedSourceRefs.length) return;
  button.disabled = true;
  try {
    const result = await adminFetch("/api/admin/outreach/discovery/import", {
      method: "POST",
      body: JSON.stringify({ previewToken: outreachDiscoveryPreview.previewToken, selectedSourceRefs })
    });
    clearOutreachDiscoveryPreview({ keepResult: true });
    renderOutreachDiscoveryResult(result, { imported: true });
    await loadAdminPartners({ quiet: true });
    setAdminStatus(`Imported ${result.summary.imported} business candidate${result.summary.imported === 1 ? "" : "s"}; contact research remains required.`, result.summary.invalid ? "warning" : "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
    updateOutreachDiscoverySelection();
  }
});

document.querySelector("#admin-import-partners")?.addEventListener("input", () => clearPartnerImportPreview());
document.querySelector("#admin-import-partners")?.elements.file?.addEventListener("change", async event => {
  const form = event.currentTarget.form;
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    form.elements.csv.value = await file.text();
    clearPartnerImportPreview();
  } catch (error) {
    setAdminStatus(`CSV could not be read: ${error.message}`, "error");
  }
});

document.querySelector("#admin-import-partners")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await adminFetch("/api/admin/partners/import", {
      method: "POST",
      body: JSON.stringify({ ...partnerImportPayload(form), mode: "preview" })
    });
    partnerImportPreview = { previewHash: result.previewHash };
    renderPartnerImportResult(result);
    const commit = document.querySelector("#admin-commit-partner-import");
    commit.hidden = false;
    commit.disabled = Number(result.summary?.importable || 0) < 1;
    commit.textContent = `Import ${result.summary?.importable || 0} application${result.summary?.importable === 1 ? "" : "s"}`;
    setAdminStatus(`Previewed ${result.summary?.rows || 0} Eventeny application rows.`, result.summary?.invalid || result.summary?.conflicts ? "warning" : "ok");
  } catch (error) {
    clearPartnerImportPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-commit-partner-import")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!partnerImportPreview?.previewHash) return;
  button.disabled = true;
  try {
    const result = await adminFetch("/api/admin/partners/import", {
      method: "POST",
      body: JSON.stringify({ ...partnerImportPayload(form), mode: "commit", previewHash: partnerImportPreview.previewHash })
    });
    renderPartnerImportResult(result, { committed: true });
    clearPartnerImportPreview({ keepResult: true });
    form.reset();
    await loadAdminPartners({ quiet: true });
    setAdminStatus(`Imported ${result.summary?.imported || 0} Eventeny application${result.summary?.imported === 1 ? "" : "s"}; ${result.summary?.duplicates || 0} duplicate${result.summary?.duplicates === 1 ? "" : "s"} skipped.`, result.summary?.conflicts || result.summary?.invalid ? "warning" : "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (!button.hidden) button.disabled = false;
  }
});

document.querySelector("#admin-import-prospects")?.addEventListener("input", () => clearOutreachImportPreview());
document.querySelector("#admin-import-prospects")?.elements.file?.addEventListener("change", async event => {
  const form = event.currentTarget.form;
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    form.elements.csv.value = await file.text();
    clearOutreachImportPreview();
  } catch (error) {
    setAdminStatus(`CSV could not be read: ${error.message}`, "error");
  }
});

document.querySelector("#admin-import-prospects")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = outreachImportPayload(form);
    const result = await adminFetch("/api/admin/outreach/prospects/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "preview" })
    });
    outreachImportPreview = { previewHash: result.previewHash };
    renderOutreachImportResult(result);
    const commit = document.querySelector("#admin-commit-prospect-import");
    commit.hidden = false;
    commit.disabled = Number(result.summary?.valid || 0) < 1;
    commit.textContent = `Import ${result.summary?.valid || 0} valid row${result.summary?.valid === 1 ? "" : "s"}`;
    setAdminStatus(`Previewed ${result.summary?.rows || 0} outreach rows.`, result.summary?.invalid ? "warning" : "ok");
  } catch (error) {
    clearOutreachImportPreview();
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-commit-prospect-import")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  if (!outreachImportPreview?.previewHash) return;
  button.disabled = true;
  try {
    const payload = outreachImportPayload(form);
    const result = await adminFetch("/api/admin/outreach/prospects/import", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "commit", previewHash: outreachImportPreview.previewHash })
    });
    renderOutreachImportResult(result, { committed: true });
    clearOutreachImportPreview({ keepResult: true });
    form.elements.file.value = "";
    form.elements.csv.value = "";
    await loadAdminPartners({ quiet: true });
    setAdminStatus(`Imported ${result.summary?.valid || 0} outreach target${result.summary?.valid === 1 ? "" : "s"}; ${result.summary?.duplicates || 0} duplicate${result.summary?.duplicates === 1 ? "" : "s"} skipped.`, "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    if (!button.hidden) button.disabled = false;
  }
});

document.querySelector("#admin-create-campaign")?.addEventListener("input", event => {
  invalidateCampaignAudiencePreview(event.currentTarget);
});

document.querySelector("#admin-create-campaign")?.addEventListener("change", event => {
  invalidateCampaignAudiencePreview(event.currentTarget);
});

document.querySelector("#admin-preview-campaign")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  const form = button.form;
  const preview = form.querySelector("#admin-campaign-audience-preview");
  if (!form.reportValidity()) return;
  button.disabled = true;
  preview.dataset.state = "loading";
  preview.innerHTML = "<strong>Checking the audience</strong><span>Applying qualification, contact, suppression, fit, business, and geographic rules on the server.</span>";
  try {
    const data = await adminFetch("/api/admin/outreach/campaigns/preview", {
      method: "POST",
      body: JSON.stringify(campaignFormPayload(form))
    });
    renderCampaignAudiencePreview(form, data.preview);
    setAdminStatus(`Campaign preview found ${data.preview.matched} qualified business${data.preview.matched === 1 ? "" : "es"}.`, data.preview.matched ? "ok" : "warning");
  } catch (error) {
    invalidateCampaignAudiencePreview(form, { force: true, message: error.message });
    preview.dataset.state = "error";
    preview.querySelector("strong").textContent = "Audience preview failed";
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = !adminCan("outreach:write");
  }
});

document.querySelector("#admin-create-campaign")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  if (!form.dataset.audiencePreviewFingerprint || form.dataset.audiencePreviewFingerprint !== campaignFormFingerprint(form)) {
    invalidateCampaignAudiencePreview(form, { force: true });
    setAdminStatus("Preview the current campaign audience before saving the draft.", "warning");
    return;
  }
  button.disabled = true;
  try {
    const data = await adminFetch("/api/admin/outreach/campaigns", {
      method: "POST",
      body: JSON.stringify(campaignFormPayload(form))
    });
    await loadAdminPartners({ quiet: true });
    invalidateCampaignAudiencePreview(form, { force: true, message: "Campaign draft saved. Change the campaign name or targeting, then preview again before creating another draft." });
    setAdminStatus(`${data.campaign.name} saved as a reviewable campaign draft.`, "ok");
  } catch (error) { setAdminStatus(error.message, "error"); } finally {
    button.disabled = !adminCan("outreach:write") || !form.dataset.audiencePreviewFingerprint;
  }
});

document.querySelector("#sponsor-inquiry-form")?.addEventListener("submit", event => {
  event.preventDefault();
  submitPartnerForm(event.currentTarget, "/api/public/sponsor-inquiries");
});
document.querySelector("#vendor-application-form")?.addEventListener("submit", event => {
  event.preventDefault();
  submitPartnerForm(event.currentTarget, "/api/public/vendor-applications");
});
if (import.meta.env.DEV && BOARD_DEMO_ACCESS.enabled) {
  document.querySelectorAll("[data-board-partner-preset]").forEach(button => button.addEventListener("click", () => {
    void fillBoardPartnerPreset(button.dataset.boardPartnerPreset);
  }));
}
document.querySelector("#partner-status-form")?.addEventListener("submit", event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  loadPartnerPortalStatus({ reference: values.reference.trim(), token: values.token.trim() }, { scroll: true });
});
document.querySelector("#partner-portal-recovery-form")?.addEventListener("submit", event => {
  event.preventDefault();
  submitPartnerPortalRecovery(event.currentTarget);
});
document.querySelector("#partner-status-forget")?.addEventListener("click", clearPartnerPortalView);
document.querySelector("#outreach-preferences-unsubscribe")?.addEventListener("click", unsubscribeOutreachPreference);
document.querySelector("#admin-command-signals")?.addEventListener("click", navigateAdminCommandSignal);
bindSponsorTierButtons();
bindSponsorPackageChoices();
bindVendorOfferingChoices();
document.querySelector("#refresh-island-conditions")?.addEventListener("click", () => loadIslandConditions({ force: true, preserveOnError: true }));

initSiteMode();
initMobileNavigation();
if (ADMIN_ENTRY) loadPublicBootstrap({ applyGuide: false }).catch(() => {});
if (!ADMIN_ENTRY) {
  initSculptors();
  const publicSponsorPackagesLoad = loadPublicSponsorPackages();
  const initialPublicLoads = [
    loadPublicBootstrap(),
    loadPublicTicketCatalog(),
    loadBooths(),
    loadIslandConditions(),
    publicSponsorPackagesLoad,
    loadPublicVendorOfferings(),
    loadPublicAlert()
  ];
  if (sculptorRosterVisible) initialPublicLoads.push(loadVoting());
  armPartnerBotProtection();
  const initialTaskPortalRequested = taskPortalRequested();
  if (initialTaskPortalRequested) initialPublicLoads.push(loadTaskPortalFromLocation({
    scroll: true,
    scrollBehavior: "auto"
  }));
  const initialPartnerPortalAccess = initialTaskPortalRequested ? null : partnerPortalAccessFromFragment() || savedPartnerPortalAccess();
  if (initialPartnerPortalAccess) initialPublicLoads.push(loadPartnerPortalStatus(initialPartnerPortalAccess, {
    scroll: true,
    scrollBehavior: "auto"
  }));
  const initialOutreachPreferenceAccess = outreachPreferenceAccessFromFragment();
  if (initialOutreachPreferenceAccess) initialPublicLoads.push(loadOutreachPreference(initialOutreachPreferenceAccess, { scroll: true }));
  const initialSponsorInvitationToken = sponsorInvitationTokenFromFragment();
  if (initialSponsorInvitationToken) initialPublicLoads.push(publicSponsorPackagesLoad.then(() => loadSponsorInvitation(initialSponsorInvitationToken, { scroll: true })));
  stabilizeRenderedHashTarget();
  Promise.allSettled(initialPublicLoads).then(() => scrollToRenderedHashTarget());
  const scheduleIslandConditionsRefresh = () => {
    window.setTimeout(async () => {
      if (!document.hidden) await loadIslandConditions({ preserveOnError: true });
      scheduleIslandConditionsRefresh();
    }, publicIslandConditionsRefreshDelay());
  };
  scheduleIslandConditionsRefresh();
  window.addEventListener("hashchange", () => {
    if (taskPortalRequested()) {
      loadTaskPortalFromLocation({ scroll: true });
      return;
    }
    const portalAccess = partnerPortalAccessFromFragment();
    if (portalAccess) {
      loadPartnerPortalStatus(portalAccess, { scroll: true });
      return;
    }
    const outreachAccess = outreachPreferenceAccessFromFragment();
    if (outreachAccess) {
      loadOutreachPreference(outreachAccess, { scroll: true });
      return;
    }
    const token = sponsorInvitationTokenFromFragment();
    if (token) publicSponsorPackagesLoad.then(() => loadSponsorInvitation(token, { scroll: true }));
  });
  window.setInterval(loadPublicAlert, 30000);
}

function updateNetworkStatus() {
  const status = document.querySelector("#network-status");
  if (!status) return;
  if (runtimeDataMode === "board_demo") {
    status.textContent = "Demo";
    status.dataset.state = "demo";
    return;
  }
  const online = navigator.onLine;
  status.textContent = online ? "Online" : "Offline";
  status.dataset.state = online ? "online" : "offline";
}

function recoverPublicConnectivity() {
  updateNetworkStatus();
  if (ADMIN_ENTRY) return;
  const recoveryLoads = [
    loadPublicBootstrap(),
    loadPublicTicketCatalog(),
    loadBooths(),
    loadIslandConditions({ force: true, preserveOnError: true }),
    loadPublicSponsorPackages(),
    loadPublicVendorOfferings(),
    loadPublicAlert()
  ];
  if (sculptorRosterVisible) recoveryLoads.push(loadVoting());
  if (taskPortalController?.hasAccess() || taskPortalRequested()) recoveryLoads.push(loadTaskPortalFromLocation());
  const portalAccess = activePartnerPortalAccess || savedPartnerPortalAccess();
  if (portalAccess) recoveryLoads.push(loadPartnerPortalStatus(portalAccess));
  Promise.allSettled(recoveryLoads);
}

function setupInstallAndOfflineSupport() {
  let installPrompt = null;
  const installButton = document.querySelector("#install-app-btn");

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installButton.disabled = true;
    await installPrompt.prompt();
    installPrompt = null;
    installButton.hidden = true;
    installButton.disabled = false;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
  });

  window.addEventListener("online", recoverPublicConnectivity);
  window.addEventListener("offline", updateNetworkStatus);
  updateNetworkStatus();

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(sitePath("sw.js")).catch(() => {
        const status = document.querySelector("#network-status");
        if (status && navigator.onLine) {
          status.textContent = "Web";
          status.dataset.state = "online";
        }
      });
    });
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations
        .filter(registration => registration.scope.startsWith(window.location.origin))
        .map(registration => registration.unregister())))
      .catch(() => {});
    if ("caches" in window) {
      caches.keys()
        .then(keys => Promise.all(keys.filter(key => key.startsWith("sandfest-public-")).map(key => caches.delete(key))))
        .catch(() => {});
    }
  }
}

if (!ADMIN_ENTRY) setupInstallAndOfflineSupport();

document.querySelectorAll("[data-zone]").forEach(button => {
  button.addEventListener("click", () => {
    const zone = zones.find(item => item.name === button.dataset.zone);
    const detail = document.querySelector("#zone-detail");
    detail.innerHTML = `<strong>${zone.name}</strong><span>${zone.detail}</span>`;
  });
});

document.querySelector("#simulate-btn").addEventListener("click", () => {
  document.querySelectorAll(".zone").forEach((button, index) => {
    const nextLoad = Math.min(96, zones[index].load + Math.round(Math.random() * 14));
    zones[index].load = nextLoad;
    button.querySelector("span").textContent = `${nextLoad}%`;
    button.style.setProperty("--load", `${nextLoad}%`);
  });
  addMessage("Ops signal: crowd load updated. Recommend deploying two floaters to North Gate and one ADA runner near Competition Corridor.", "ai");
});

if (!ADMIN_ENTRY) {
  startTideMotion();
  if (LIVE_BEACH_DEMO_ENABLED) startLiveBeach();
}

function startLiveBeach() {
  const stage = document.querySelector(".lb-stage");
  const canvas = document.querySelector("#lb-canvas");
  const svg = canvas?.querySelector(".lb-svg");
  const pinsGroup = document.querySelector("#lb-pins");
  const visitorEl = document.querySelector("#lb-visitor");
  const routeEl = document.querySelector("#lb-route");
  const popEl = document.querySelector("#lb-pop");
  const feedEl = document.querySelector("#lb-now-feed");
  const scrubInput = document.querySelector("#lb-scrub-input");
  const scrubFill = document.querySelector("#lb-scrub-fill");
  const scrubTicks = document.querySelector("#lb-scrub-ticks");
  const scrubReadout = document.querySelector("#lb-scrub-readout");
  const walkBtn = document.querySelector("#lb-walk-btn");
  const sunsetEl = document.querySelector("#lb-sunset");
  const minEl = document.querySelector("#lb-suggest-min");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!stage || !svg) return;

  const W = 1600;
  const H = 900;

  const px = (n) => Math.round(n * W);
  const py = (n) => Math.round(n * H);

  const crowdLabel = { light: "Light", moderate: "Moderate", packed: "Packed" };

  // Render pins
  const ns = "http://www.w3.org/2000/svg";
  sculptures.forEach((s) => {
    const cx = px(s.x);
    const cy = py(s.y);
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", `lb-pin lb-pin-${s.crowd}`);
    g.setAttribute("transform", `translate(${cx} ${cy})`);
    g.dataset.pinId = String(s.id);
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `Sculpture ${s.id}, ${s.title} by ${s.sculptor}, ${crowdLabel[s.crowd]} crowd`);

    const hitTarget = document.createElementNS(ns, "circle");
    hitTarget.setAttribute("class", "lb-pin-hit");
    hitTarget.setAttribute("r", "44");
    g.appendChild(hitTarget);

    const halo = document.createElementNS(ns, "circle");
    halo.setAttribute("class", "lb-pin-halo");
    halo.setAttribute("r", "30");
    g.appendChild(halo);

    const core = document.createElementNS(ns, "circle");
    core.setAttribute("class", "lb-pin-core");
    core.setAttribute("r", "20");
    g.appendChild(core);

    const num = document.createElementNS(ns, "text");
    num.setAttribute("class", "lb-pin-num");
    num.setAttribute("text-anchor", "middle");
    num.setAttribute("dy", "6");
    num.textContent = String(s.id);
    g.appendChild(num);

    pinsGroup.appendChild(g);
  });

  // Visitor position
  const visitor = liveBeachContext.visitor;
  visitorEl.setAttribute("transform", `translate(${px(visitor.x)} ${py(visitor.y)})`);

  // Draw route from visitor to suggested sculpture
  const drawRoute = (targetId) => {
    const target = sculptures.find(s => s.id === targetId);
    if (!target) return;
    const x1 = px(visitor.x), y1 = py(visitor.y);
    const x2 = px(target.x),  y2 = py(target.y);
    // Curve up over the sand toward the target
    const midX = (x1 + x2) / 2;
    const midY = Math.min(y1, y2) - 90;
    routeEl.setAttribute("d", `M${x1},${y1} Q${midX},${midY} ${x2},${y2}`);
  };
  drawRoute(liveBeachContext.suggestion.targetId);

  // Render the "now on the beach" feed
  const now = liveBeachContext.nowOnBeach;
  feedEl.innerHTML = now.map((card, idx) => `
    <li class="lb-now" data-pin="${card.pinId ?? ""}">
      <div class="lb-now-thumb lb-now-thumb-${idx}"></div>
      <div class="lb-now-body">
        <p class="lb-now-eyebrow">${card.kind}</p>
        <p class="lb-now-title"><em>${card.title}</em></p>
        <p class="lb-now-meta">${card.meta}</p>
        <p class="lb-now-caption">${card.caption}</p>
        ${card.pinId ? `<button class="lb-now-cta" type="button" data-pin="${card.pinId}">Take me there →</button>` : `<span class="lb-now-tag">Live</span>`}
      </div>
    </li>
  `).join("");

  feedEl.querySelectorAll(".lb-now-cta").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-pin"));
      drawRoute(id);
      flashPin(id);
    });
  });

  const flashPin = (id) => {
    const pin = pinsGroup.querySelector(`[data-pin-id="${id}"]`);
    if (!pin) return;
    pin.classList.remove("is-flashing");
    void pin.getBoundingClientRect();
    pin.classList.add("is-flashing");
    setTimeout(() => pin.classList.remove("is-flashing"), 1800);
  };

  // Pin hover popover
  const showPop = (s) => {
    const rect = canvas.getBoundingClientRect();
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = px(s.x);
    svgPoint.y = py(s.y);
    const screenMatrix = svg.getScreenCTM();
    const screenPoint = screenMatrix ? svgPoint.matrixTransform(screenMatrix) : null;
    const cx = screenPoint ? screenPoint.x - rect.left : px(s.x) / W * rect.width;
    const cy = screenPoint ? screenPoint.y - rect.top : py(s.y) / H * rect.height;
    popEl.querySelector(".lb-pop-num").textContent = `Sculpture #${s.id}`;
    popEl.querySelector(".lb-pop-flag").textContent = s.country;
    popEl.querySelector(".lb-pop-crowd").textContent = crowdLabel[s.crowd];
    popEl.querySelector(".lb-pop-crowd").setAttribute("data-crowd", s.crowd);
    popEl.querySelector(".lb-pop-title em").textContent = s.title;
    popEl.querySelector(".lb-pop-sculptor").textContent = s.sculptor;
    const dist = Math.hypot(s.x - visitor.x, s.y - visitor.y);
    const minutes = Math.max(1, Math.round(dist * 18));
    popEl.querySelector(".lb-pop-walk").textContent = `${minutes} min walk from you`;
    popEl.hidden = false;
    const margin = 8;
    const halfWidth = popEl.offsetWidth / 2;
    const clampedX = Math.min(rect.width - halfWidth - margin, Math.max(halfWidth + margin, cx));
    const clampedY = Math.min(rect.height - margin, Math.max(popEl.offsetHeight + margin, cy - 16));
    popEl.style.left = `${clampedX}px`;
    popEl.style.top = `${clampedY}px`;
  };
  const hidePop = () => { popEl.hidden = true; };

  pinsGroup.querySelectorAll(".lb-pin").forEach((g) => {
    const id = Number(g.dataset.pinId);
    const s = sculptures.find(x => x.id === id);
    g.addEventListener("pointerenter", () => showPop(s));
    g.addEventListener("pointerleave", () => {
      if (document.activeElement !== g) hidePop();
    });
    g.addEventListener("focus", () => showPop(s));
    g.addEventListener("blur",  hidePop);
    g.addEventListener("click", () => {
      g.focus({ preventScroll: true });
      showPop(s);
      drawRoute(id);
      flashPin(id);
    });
  });

  walkBtn?.addEventListener("click", () => {
    const id = liveBeachContext.suggestion.targetId;
    drawRoute(id);
    flashPin(id);
  });

  // Timeline scrubber
  const tl = liveBeachContext.timeline;
  scrubTicks.innerHTML = tl.map((t, i) => `<li${i % 3 === 0 ? ` class="is-major"` : ""} title="${t.hour} · ${t.label}"><span>${t.hour}</span></li>`).join("");

  const setScrub = (i) => {
    const item = tl[i];
    if (!item) return;
    scrubReadout.textContent = `${item.hour} · ${item.label}`;
    scrubFill.style.width = `${(i / (tl.length - 1)) * 100}%`;
    stage.dataset.preset = item.preset;
  };
  scrubInput.max = String(tl.length - 1);
  scrubInput.addEventListener("input", () => setScrub(Number(scrubInput.value)));
  setScrub(Number(scrubInput.value));

  // Live countdown for the suggestion
  let secondsLeft = liveBeachContext.suggestion.eventStartsInMin * 60;
  const tick = () => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    const min = Math.ceil(secondsLeft / 60);
    if (minEl) minEl.textContent = String(min);
    if (sunsetEl) {
      // Cosmetic sunset countdown.
      const total = 2 * 3600 + 47 * 60 - (Date.now() / 1000 % 60);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      sunsetEl.textContent = `${h}h ${m}m`;
    }
  };
  if (!reduceMotion) setInterval(tick, 1000);

  // Seagull flyby every ~22s
  const gull = document.querySelector("#lb-gull");
  if (gull && !reduceMotion) {
    const flyOnce = () => {
      const startY = 110 + Math.random() * 90;
      const endY   = 90  + Math.random() * 110;
      gull.animate(
        [
          { transform: `translate(-40px, ${startY}px) scale(1)`,                opacity: 0   },
          { transform: `translate(${W * 0.5}px, ${(startY + endY) / 2 - 28}px) scale(1)`, opacity: 0.85 },
          { transform: `translate(${W + 60}px, ${endY}px) scale(0.9)`,          opacity: 0   }
        ],
        { duration: 9000, easing: "ease-in-out" }
      );
    };
    setTimeout(flyOnce, 4000);
    setInterval(flyOnce, 22000);
  }

  // Reposition popover when canvas resizes
  let lastFocusedPin = null;
  pinsGroup.addEventListener("focusin", (e) => { lastFocusedPin = e.target.closest(".lb-pin"); });
  window.addEventListener("resize", () => {
    if (!popEl.hidden && lastFocusedPin) {
      const id = Number(lastFocusedPin.dataset.pinId);
      const s = sculptures.find(x => x.id === id);
      if (s) showPop(s);
    }
  });
}

function startTideMotion() {
  const canvas = document.querySelector("#tide-motion");
  const hero = document.querySelector(".hero");
  const toggle = document.querySelector("#motion-toggle");
  if (!canvas || !hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const context = canvas.getContext("2d");
  const pointer = { x: 0.68, y: 0.52, active: false };
  const particles = Array.from({ length: 72 }, (_, index) => ({
    seed: index * 19.37,
    x: Math.random(),
    y: Math.random(),
    radius: 0.6 + Math.random() * 2.2,
    speed: 0.12 + Math.random() * 0.38
  }));
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let animationFrame = 0;
  let paused = false;

  const resize = () => {
    const box = hero.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };

  const updatePointer = (event) => {
    const box = hero.getBoundingClientRect();
    pointer.x = (event.clientX - box.left) / box.width;
    pointer.y = (event.clientY - box.top) / box.height;
    pointer.active = true;
  };

  const leavePointer = () => {
    pointer.active = false;
  };

  const drawRibbon = (time, offset, color, alpha, amplitude, speed) => {
    const baseY = height * offset;
    context.beginPath();
    context.moveTo(0, height);
    context.lineTo(0, baseY);

    for (let x = 0; x <= width + 8; x += 8) {
      const normalized = x / width;
      const pull = pointer.active ? Math.max(0, 1 - Math.abs(normalized - pointer.x) * 2.8) : 0;
      const y = baseY
        + Math.sin(normalized * 8.4 + time * speed) * amplitude
        + Math.sin(normalized * 19 + time * speed * 0.72) * amplitude * 0.42
        - pull * 34;
      context.lineTo(x, y);
    }

    context.lineTo(width, height);
    context.closePath();
    context.fillStyle = rgba(color, alpha);
    context.fill();
  };

  const draw = (now) => {
    if (paused) return;
    const time = now * 0.001;
    context.clearRect(0, 0, width, height);

    const glowX = width * (pointer.active ? pointer.x : 0.72);
    const glowY = height * (pointer.active ? pointer.y : 0.48);
    const glow = context.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * 0.52);
    glow.addColorStop(0, "rgba(247, 183, 51, 0.22)");
    glow.addColorStop(0.42, "rgba(0, 109, 119, 0.12)");
    glow.addColorStop(1, "rgba(0, 109, 119, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    drawRibbon(time, 0.56, [0, 109, 119], 0.34, 22, 1.1);
    drawRibbon(time + 0.9, 0.66, [121, 188, 196], 0.28, 28, 0.86);
    drawRibbon(time + 1.8, 0.76, [244, 223, 172], 0.24, 18, 1.38);

    context.save();
    context.globalCompositeOperation = "screen";
    for (const particle of particles) {
      const drift = (time * particle.speed + particle.seed) % 1;
      const x = ((particle.x + drift * 0.14) % 1) * width;
      const y = ((particle.y + Math.sin(time * 0.8 + particle.seed) * 0.018) % 1) * height;
      const nearPointer = pointer.active ? Math.max(0, 1 - Math.hypot(pointer.x * width - x, pointer.y * height - y) / 240) : 0;
      context.beginPath();
      context.arc(x, y, particle.radius + nearPointer * 2.2, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 253, 247, ${0.18 + nearPointer * 0.42})`;
      context.fill();
    }
    context.restore();

    animationFrame = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener("resize", resize);
  hero.addEventListener("pointermove", updatePointer);
  hero.addEventListener("pointerleave", leavePointer);
  toggle?.addEventListener("click", () => {
    paused = !paused;
    toggle.textContent = paused ? "Resume motion" : "Pause motion";
    toggle.setAttribute("aria-pressed", String(!paused));
    if (!paused) animationFrame = requestAnimationFrame(draw);
  });
  animationFrame = requestAnimationFrame(draw);

  window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });
}

function rgba([red, green, blue], alpha) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Keep legacy board-demo operations markup out of the production visitor DOM.
// Event handlers are bound before this final prune so local demo behavior stays
// unchanged and production public initialization remains null-safe.
if (ADMIN_ENTRY) {
  if (ADMIN_AUTH_MODE === "oidc") await initializeAdminAuthentication();
  else if (BOARD_DEMO_ACCESS.enabled) await loadBoardDemoWorkspace();
}

if (ADMIN_ENTRY) {
  document.querySelectorAll('main > section[data-audience="public"], main > section[data-audience="all"]').forEach(section => section.remove());
  document.querySelector("#public-alert")?.remove();
} else if (!OPS_DEMO_ENABLED) {
  document.querySelectorAll('main > section[data-audience="ops"]').forEach(section => section.remove());
}

function scrollToRenderedHashTarget(options = {}) {
  const fragment = window.location.hash.slice(1).split("?")[0];
  let id = fragment;
  try { id = decodeURIComponent(fragment); } catch { /* keep the raw fragment */ }
  const target = id ? document.getElementById(id) : null;
  if (!target) return;

  const behavior = options?.behavior === "smooth" ? "smooth" : "instant";
  const scroll = () => {
    const mobilePrivateResult = window.matchMedia("(max-width: 720px)").matches
      ? target.id === "partner-status" && activePartnerPortalApplication
        ? document.querySelector("#partner-status-result")
        : target.id === "task-status" && taskPortalController?.activeTask()
          ? document.querySelector("#task-status-result")
          : null
      : null;
    const scrollTarget = mobilePrivateResult || target;
    scrollTarget.scrollIntoView({ behavior, block: "start" });
  };
  requestAnimationFrame(() => {
    scroll();
    requestAnimationFrame(() => {
      scroll();
      if (options?.focus) focusRenderedHashTarget(target);
    });
  });
}

function focusRenderedHashTarget(target) {
  const focusTarget = target.querySelector(":scope > .admin-task-board-heading > strong, :scope > strong, :scope > h1, :scope > h2, :scope > h3, :scope > h4") || target;
  const temporaryTabIndex = !focusTarget.hasAttribute("tabindex");
  if (temporaryTabIndex) focusTarget.setAttribute("tabindex", "-1");
  focusTarget.dataset.commandTargetFocus = "";
  focusTarget.focus({ preventScroll: true });
  focusTarget.addEventListener("blur", () => {
    delete focusTarget.dataset.commandTargetFocus;
    if (temporaryTabIndex) focusTarget.removeAttribute("tabindex");
  }, { once: true });
}

function stabilizeRenderedHashTarget(options = {}) {
  scrollToRenderedHashTarget(options);
  const root = document.querySelector("main");
  if (!root || typeof ResizeObserver !== "function" || !window.location.hash) return;

  const settleOptions = { ...options, focus: false };
  let animationFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => scrollToRenderedHashTarget(settleOptions));
  });
  observer.observe(root);
  window.setTimeout(() => {
    observer.disconnect();
    cancelAnimationFrame(animationFrame);
    scrollToRenderedHashTarget(settleOptions);
  }, 1500);
}

function navigateAdminCommandSignal(event) {
  const link = event.target instanceof Element ? event.target.closest("a[data-command-signal]") : null;
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const targetHash = link.getAttribute("href");
  if (!targetHash?.startsWith("#") || !document.querySelector(targetHash)) return;

  event.preventDefault();
  if (window.location.hash !== targetHash) window.history.pushState(null, "", targetHash);
  stabilizeRenderedHashTarget({ focus: true });
}

window.addEventListener("hashchange", () => {
  if (ADMIN_ENTRY) scrollToRenderedHashTarget({ behavior: "smooth" });
  else stabilizeRenderedHashTarget();
});
window.addEventListener("load", scrollToRenderedHashTarget);
scrollToRenderedHashTarget();

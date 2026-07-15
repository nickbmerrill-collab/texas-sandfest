const mediaManifest = await fetch("/assets/sandfest-media/media-manifest.json")
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);
const crawlSummary = await fetch("/data/crawl-summary.json")
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);
const incomingInventory = await fetch("/data/incoming-inventory.json")
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);
const ticketCatalog = await fetch("/data/ticket-products.json")
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);
const sculptorData = await fetch("/data/sculptors.json")
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);

const mediaAssets = mediaManifest?.assets ?? [];
const heroImage = mediaAssets.find(asset => asset.role === "hero")?.publicPath
  ?? "https://static.wixstatic.com/media/f800df_53497f8c3802433885cf16fd00de0b7b~mv2.jpg/v1/fill/w_2500,h_1666,al_c/f800df_53497f8c3802433885cf16fd00de0b7b~mv2.jpg";
const officialLogo = mediaAssets.find(asset => asset.role === "official_brand")?.publicPath;
const sponsorLogoAssets = mediaAssets.filter(asset => asset.category === "sponsor-logos").slice(0, 18);
const galleryAssets = mediaAssets
  .filter(asset => asset.category === "photos" && asset.role !== "hero")
  .slice(0, 8);
const featuredPhotoAssets = mediaAssets
  .filter(asset => asset.category === "photos" && asset.role !== "hero")
  .slice(8, 14);
const mapAssets = mediaAssets.filter(asset => asset.category === "maps").slice(0, 4);
const assetStats = mediaManifest
  ? [
      [mediaManifest.categories.logos ?? 0, "brand logos"],
      [mediaManifest.categories.photos ?? 0, "event photos"],
      [mediaManifest.categories["sponsor-logos"] ?? 0, "sponsor logos"],
      [mediaManifest.categories.maps ?? 0, "map assets"]
    ]
  : [];
const ticketProducts = ticketCatalog?.products ?? [];
const ticketCart = new Map();

const sculptors = sculptorData?.sculptors ?? [];
const sculptureEntries = sculptorData?.entries ?? [];
const sculpturePois = sculptorData?.pois ?? [];
const sculptorLegend = sculptorData?.legend ?? [];
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

const event = {
  name: "Texas SandFest",
  dates: "April 17-19, 2026",
  hours: "9:00 AM - 8:00 PM CDT",
  location: "On the beach, Port Aransas, TX 78373",
  mission: "The largest beach sand sculpture competition in the USA, raising money for local nonprofit organizations and scholarships.",
  phone: "361-267-2474",
  email: "info@texassandfest.org",
  office: "200 S. Alister Street, Suite E, Port Aransas, TX 78373"
};

const quickStats = [
  ["3", "festival days"],
  ["9", "core beach zones"],
  ["3", "surfaces planned"],
  ["24/7", "AI concierge"]
];

const schedule = [
  { day: "Friday", time: "9:00 AM", title: "Beach gates open", zone: "Entry + ticket exchange", type: "Visitor" },
  { day: "Friday", time: "10:00 AM", title: "Master sculptor showcase begins", zone: "Competition corridor", type: "Competition" },
  { day: "Friday", time: "2:00 PM", title: "Youth build activation", zone: "Family sand lab", type: "Family" },
  { day: "Saturday", time: "8:15 AM", title: "Volunteer captain briefing", zone: "Ops command", type: "Staff" },
  { day: "Saturday", time: "11:30 AM", title: "Peak crowd heat watch", zone: "Medical + shade", type: "Safety" },
  { day: "Saturday", time: "4:00 PM", title: "Sponsor reception window", zone: "VIP deck", type: "Sponsor" },
  { day: "Sunday", time: "10:30 AM", title: "Amateur awards prep", zone: "Main stage", type: "Competition" },
  { day: "Sunday", time: "6:30 PM", title: "Final beach sweep", zone: "All zones", type: "Operations" }
];

const zones = [
  { name: "North Gate", detail: "Ticket scan, ADA routing, wristband support", load: 82 },
  { name: "Competition Corridor", detail: "Master, semi-pro, amateur sculpture lines", load: 76 },
  { name: "Food Court", detail: "Vendor row, sanitation, payment help", load: 68 },
  { name: "Family Sand Lab", detail: "Youth activities and parent meetup point", load: 44 },
  { name: "Sponsor Harbor", detail: "VIP, sponsor check-in, hospitality", load: 51 },
  { name: "Command", detail: "Weather, incidents, volunteer dispatch", load: 37 }
];

// Live Beach — visitor-facing surface that fuses the ops crowd-zone data,
// the run-of-show, the sculpture map, and the Ask Sandy concierge into a
// single "you have a superpower" moment.
const sculptures = [
  { id: 1,  x: 0.06, y: 0.42, sculptor: "Diego Aponte",   country: "🇺🇸", title: "Gulf Saint",              crowd: "moderate", state: "carving" },
  { id: 2,  x: 0.12, y: 0.55, sculptor: "Inés Roca",      country: "🇦🇷", title: "Río de Memoria",          crowd: "packed",   state: "judging" },
  { id: 3,  x: 0.18, y: 0.40, sculptor: "Mira Patel",     country: "🇬🇧", title: "Lullaby of the Bell Tower", crowd: "packed",   state: "carving" },
  { id: 4,  x: 0.24, y: 0.58, sculptor: "Hugo Brandt",    country: "🇳🇱", title: "Long Shadow Lighthouse",  crowd: "moderate", state: "carving" },
  { id: 5,  x: 0.30, y: 0.43, sculptor: "Pablo Vera",     country: "🇪🇸", title: "Madrugada",               crowd: "moderate", state: "carving" },
  { id: 6,  x: 0.36, y: 0.56, sculptor: "Sasha Volkov",   country: "🇱🇻", title: "Snowbird Returning",      crowd: "light",    state: "carving" },
  { id: 7,  x: 0.42, y: 0.41, sculptor: "Olamide Diop",   country: "🇸🇳", title: "Dunes of the Drum",       crowd: "moderate", state: "talk" },
  { id: 8,  x: 0.48, y: 0.57, sculptor: "Theo Larsson",   country: "🇸🇪", title: "The Sleeping Captain",    crowd: "light",    state: "carving" },
  { id: 9,  x: 0.54, y: 0.44, sculptor: "Halima Asad",    country: "🇲🇦", title: "Caravan of Salt",         crowd: "light",    state: "carving" },
  { id: 10, x: 0.60, y: 0.55, sculptor: "Kalani Ho",      country: "🇺🇸", title: "Wave's Last Stand",       crowd: "moderate", state: "carving" },
  { id: 11, x: 0.66, y: 0.40, sculptor: "Esra Demir",     country: "🇹🇷", title: "Bridge of Wings",         crowd: "light",    state: "carving" },
  { id: 12, x: 0.72, y: 0.58, sculptor: "Lin Yuwei",      country: "🇹🇼", title: "Paper Boats",             crowd: "moderate", state: "carving" },
  { id: 13, x: 0.78, y: 0.42, sculptor: "Ada Reyes",      country: "🇵🇭", title: "Mother Reef",             crowd: "moderate", state: "carving" },
  { id: 14, x: 0.83, y: 0.56, sculptor: "Niño Suárez",    country: "🇲🇽", title: "The Whale's Lullaby",     crowd: "light",    state: "talk" },
  { id: 15, x: 0.89, y: 0.43, sculptor: "Kojiro Tan",     country: "🇯🇵", title: "Cloud Ferryman",          crowd: "light",    state: "carving" },
  { id: 16, x: 0.94, y: 0.55, sculptor: "Jelena Marek",   country: "🇭🇷", title: "Tidal Court",             crowd: "moderate", state: "carving" }
];

const liveBeachContext = {
  // The visitor's current pin on the beach. Origin of the suggested route.
  visitor: { x: 0.20, y: 0.62 },
  // Pulled from ops dashboard — coral blooms over packed clusters, mint over open sand.
  heatBlooms: [
    { x: 0.14, y: 0.50, intensity: 0.95, hue: "coral" },  // South plaza is busy
    { x: 0.34, y: 0.46, intensity: 0.55, hue: "mixed" },
    { x: 0.58, y: 0.50, intensity: 0.30, hue: "mint" },
    { x: 0.84, y: 0.50, intensity: 0.40, hue: "mint" }
  ],
  // The Ask Sandy recommendation right now — would normally come from a routing call
  // against the current crowd-zone density and run-of-show.
  suggestion: {
    targetId: 14,
    walkMinutes: 4,
    reason: "Skip the south plaza (busy). Niño Suárez is doing a live carving talk in 6 minutes, and the crowd is light.",
    eventStartsInMin: 6
  },
  nowOnBeach: [
    { kind: "Top sculpture",   title: "Mother Reef",        meta: "Ada Reyes · 🇵🇭", caption: "Time-lapse · 2h compressed → 18s",     pinId: 13 },
    { kind: "Main stage",      title: "Coastal Roots Trio", meta: "Live · Stage A",   caption: "Set ends in 14 min — encore likely",   pinId: null },
    { kind: "Shortest line",   title: "El Tiburón Tacos",   meta: "Food Court",       caption: "≈ 3 min wait · cash + Apple Pay",      pinId: null }
  ],
  // 24-frame timelapse from gates open → final sweep. Each entry is a relative density preset.
  timeline: [
    { hour: "9 AM",  label: "Gates open",       preset: "early"   },
    { hour: "10 AM", label: "First carve",      preset: "early"   },
    { hour: "11 AM", label: "Family band",      preset: "rising"  },
    { hour: "12 PM", label: "Lunch surge",      preset: "peak"    },
    { hour: "1 PM",  label: "Heat watch",       preset: "peak"    },
    { hour: "2 PM",  label: "Youth build",      preset: "rising"  },
    { hour: "3 PM",  label: "Sponsor hour",     preset: "balanced"},
    { hour: "4 PM",  label: "Master demos",     preset: "rising"  },
    { hour: "5 PM",  label: "Golden hour",      preset: "balanced"},
    { hour: "6 PM",  label: "Stage set #2",     preset: "peak"    },
    { hour: "7 PM",  label: "Sunset photos",    preset: "evening" },
    { hour: "8 PM",  label: "Final sweep",      preset: "evening" }
  ]
};

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

const sponsorTiers = [
  ["Whale", "$25k+", "Top visibility, main-stage recognition, VIP footprint"],
  ["Marlin", "$15k", "Beach signage, digital placement, hospitality support"],
  ["Sailfish", "$10k", "Category sponsorship and social media package"],
  ["Tarpon", "$5k", "On-site logo placement and web listing"],
  ["Trout", "$2.5k", "Community sponsor placement"],
  ["Flounder", "$1k", "Supporter listing"]
];

const surfaces = [
  {
    name: "Public Web",
    status: "Prototype started",
    role: "Primary visitor surface for tickets, schedules, policies, maps, sponsor visibility, and AI concierge."
  },
  {
    name: "Native iOS",
    status: "Planned",
    role: "On-site app for guests and staff with offline-friendly maps, push alerts, QR/ticket handoff, volunteer check-in, and incident capture."
  },
  {
    name: "Port A Local Co",
    status: "Future integration",
    role: "Destination layer for Port Aransas discovery, lodging/food/activity context, local offers, and year-round visitor retention."
  }
];

const dataDomains = [
  ["Content", "Canonical FAQs, policy records, schedule, maps, sponsor tiers, vendor requirements, volunteer rules."],
  ["Operations", "Zones, gates, shifts, incidents, lost party, ADA requests, weather alerts, shuttle status."],
  ["Commerce", "Eventeny ticket/app status, sponsor packages, vendor fees, raffle products, merchandise."],
  ["Finance", "QuickBooks invoices, payments, vendors, sponsor revenue, raffle reconciliation, donation reporting."],
  ["Community", "Nonprofit grants, scholarship impact, local partners, post-event reporting, Port A Local Co listings."]
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

const assetWorkflow = [
  ["Rights review", "Confirm source approval for official, sponsor, sculptor, and volunteer-facing images."],
  ["Sponsor matching", "Map each scraped logo to a sponsor account, tier, invoice status, and fulfillment checklist."],
  ["App curation", "Choose a small approved image set for web, iOS, push notifications, sponsor pages, and Port A Local Co."],
  ["Alt text", "Replace scraped filenames with reviewed captions and accessibility text before launch."]
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
  ["Connect Eventeny", "Export 2026 tickets, applications, sponsor records, vendor lists, and message threads."],
  ["Connect QuickBooks", "Add Intuit credentials, complete OAuth, then snapshot company info and open invoices."],
  ["Curate media", "Approve public-safe photo sets, sponsor logos, maps, captions, and App Store-safe imagery."],
  ["Normalize roles", "Define guest, volunteer, vendor, sponsor, board, finance, ops, and super-admin permissions."],
  ["Publish app feed", "Promote reviewed records into the shared bootstrap payload used by web and iOS."]
];

const knowledge = [
  {
    q: "tickets",
    a: "Texas SandFest 2026 runs April 17-19 on the beach in Port Aransas. Public ticketing is handled through Eventeny, with general admission, youth admission, VIP, and raffle-style offerings shown there."
  },
  {
    q: "volunteer",
    a: "Volunteer registration should route into role matching, shift preferences, waiver state, and captain assignment. The public site says online registration closes around April 6, 2026."
  },
  {
    q: "vendor",
    a: "Vendor flows should split food and non-food applicants, then track permit documents, booth footprint, power needs, load-in window, and final approval."
  },
  {
    q: "sponsor",
    a: "Sponsor work should track tier, benefit checklist, logo/assets, invoice state, on-site footprint, hospitality needs, and post-event impact reporting."
  },
  {
    q: "parking",
    a: "Parking should be treated as a live operations workflow: beach access status, shuttle options, ADA routing, weather/traffic alerts, and arrival-time recommendations."
  },
  {
    q: "accessibility",
    a: "The platform should expose ADA routes, gate assistance, restroom locations, shade/medical points, and a way to request help from staff."
  },
  {
    q: "ios",
    a: "The iOS app should be native SwiftUI with a shared API/content layer. First release should focus on offline-friendly schedule/map, push alerts, AI concierge, volunteer check-in, QR/ticket handoff, and staff incident capture."
  },
  {
    q: "port a",
    a: "Port A Local Co should consume SandFest as a local event and destination module: listings, restaurants, lodging, things to do, event guides, offers, and post-event retention. SandFest data should be exposed through versioned APIs, not copied page content."
  },
  {
    q: "quickbooks",
    a: "QuickBooks should own accounting truth: customers, vendors, invoices, payments, bills, and reports. SandFest should mirror status into sponsor/vendor/finance workflows while keeping operational fulfillment in the SandFest platform."
  }
];

const app = document.querySelector("#app");

function formatMoney(cents) {
  if (typeof cents !== "number") return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: ticketCatalog?.currency?.toUpperCase() ?? "USD"
  }).format(cents / 100);
}

function productPrice(product) {
  return formatMoney(product.unitAmount) ?? product.priceLabel ?? "Set in Stripe";
}

function ticketBadge(product) {
  if (product.requiresReview) return "Review gated";
  if (product.category === "vip") return "VIP";
  if (product.category === "sponsor") return "Sponsor";
  return "Stripe ready";
}

function moneyInput(cents) {
  if (typeof cents !== "number") return "";
  return (cents / 100).toFixed(2);
}

function adminMoney(cents, fallback = "Not set") {
  return formatMoney(cents) ?? fallback;
}

function defaultPublicApiBase() {
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return "http://127.0.0.1:8788";
  }
  return "https://api.heyelab.com/sandfest";
}

function publicApiBase() {
  const adminBaseInput = document.querySelector("#admin-api-base");
  return (adminBaseInput?.value || defaultPublicApiBase()).replace(/\/+$/, "");
}

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#top" aria-label="Texas SandFest home">
      ${officialLogo ? `<img class="brand-logo" src="${officialLogo}" alt="Texas SandFest logo" />` : `<span class="brand-mark">TSF</span>`}
      <span>Texas SandFest AI</span>
    </a>
    <nav>
      <a href="#live-beach">Live Beach</a>
      <a href="#concierge">Concierge</a>
      <a href="#tickets">Tickets</a>
      <a href="#sculptors-showcase">Sculptors</a>
      <a href="#operations">Ops</a>
      <a href="#media">Media</a>
      <a href="#admin">Admin</a>
      <a href="#sponsors">Sponsors</a>
      <a href="#surfaces">iOS</a>
      <a href="#port-a">Port A</a>
      <a href="#finance">Finance</a>
      <a href="#roadmap">Build</a>
    </nav>
    <div class="app-status-controls">
      <div class="site-mode-toggle" role="tablist" aria-label="Site mode">
        <button data-site-mode="public" type="button" role="tab">Visitor</button>
        <button data-site-mode="ops" type="button" role="tab">Operations</button>
      </div>
      <span id="network-status" class="network-status" data-state="online">Live</span>
      <button id="install-app-btn" class="install-app-btn" type="button" hidden>Install</button>
    </div>
    <a class="nav-cta" href="https://www.texassandfest.org/" target="_blank" rel="noreferrer">Official site</a>
  </header>

  <div id="public-alert" class="public-alert" hidden>
    <div>
      <span id="public-alert-severity">Alert</span>
      <strong id="public-alert-title"></strong>
      <p id="public-alert-message"></p>
    </div>
  </div>

  <main id="top">
    <section class="hero" style="--hero-image: url('${heroImage}')">
      <canvas id="tide-motion" class="tide-motion" aria-hidden="true"></canvas>
      <div class="hero-overlay"></div>
      <div class="hero-content">
        <p class="eyebrow">Port Aransas beach operations platform</p>
        <h1>${event.name}</h1>
        <p class="hero-copy">${event.mission}</p>
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
        <p>Live tide, crowd, and heat signals animate the beach layer.</p>
        <div class="motion-metrics">
          <span><b>82%</b> North Gate</span>
          <span><b>68%</b> Vendor Row</span>
          <span><b>Live</b> Tide Flow</span>
        </div>
        <button id="motion-toggle" class="motion-toggle" type="button" aria-pressed="true">Pause motion</button>
      </aside>
      <aside class="event-card" aria-label="Event snapshot">
        <span class="status-dot"></span>
        <strong>${event.dates}</strong>
        <span>${event.hours}</span>
        <span>${event.location}</span>
      </aside>
    </section>

    <section class="live-beach" id="live-beach" aria-label="Live Beach">
      <div class="lb-header">
        <div class="lb-eyebrow-row">
          <span class="lb-live-pill"><span class="lb-live-dot"></span>LIVE on the beach</span>
          <span class="lb-eyebrow">Live Beach · Mustang Island</span>
        </div>
        <h2 class="lb-headline">Walk the festival like you have a <em>superpower.</em></h2>
        <p class="lb-sub">One screen fuses live crowd density, the run of show, the sculpture map, and Sandy's routing. Hover a pin to learn the artist. Drag the timeline to see the day breathe.</p>
      </div>

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
              Sculpture <strong id="lb-suggest-num">#14</strong>
              <span class="lb-suggest-flag" id="lb-suggest-flag">🇲🇽</span>
            </p>
            <p class="lb-suggest-name">
              <em id="lb-suggest-title">The Whale's Lullaby</em>
              <span id="lb-suggest-sculptor">Niño Suárez</span>
            </p>
            <p class="lb-suggest-reason" id="lb-suggest-reason">Skip the south plaza (busy). Niño Suárez is doing a live carving talk in 6 minutes, and the crowd is light.</p>
            <div class="lb-suggest-chips">
              <span class="lb-chip lb-chip-walk"><span>↗</span> <strong id="lb-suggest-walk">4</strong> min walk</span>
              <span class="lb-chip lb-chip-soon"><span class="lb-pulse-dot"></span> Talk in <strong id="lb-suggest-min">6</strong> min</span>
            </div>
            <button id="lb-walk-btn" class="lb-walk-btn" type="button">Start walking →</button>
          </article>
          <dl class="lb-stat-grid">
            <div><dt>Tide</dt><dd>+2.4 ft <span class="lb-trend-up">↑</span></dd></div>
            <div><dt>Sunset</dt><dd id="lb-sunset">2h 47m</dd></div>
            <div><dt>Stage A next</dt><dd>Coastal Roots</dd></div>
            <div><dt>Air</dt><dd>78°F · NE 9</dd></div>
          </dl>
        </aside>

        <div class="lb-canvas" id="lb-canvas">
          <svg class="lb-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
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
          <span class="lb-scrub-readout" id="lb-scrub-readout">12 PM · Lunch surge</span>
        </div>
        <input id="lb-scrub-input" class="lb-scrub-input" type="range" min="0" max="11" value="3" step="1" aria-label="Drag to rewind or fast-forward the day"/>
        <div class="lb-scrub-track">
          <div class="lb-scrub-fill" id="lb-scrub-fill"></div>
          <ul class="lb-scrub-ticks" id="lb-scrub-ticks"></ul>
        </div>
      </div>

      <p class="lb-foot">
        Live Beach is a public-facing surface that fuses the ops crowd-zone API, run-of-show, sculpture map, and Ask Sandy concierge.
        <a href="#admin">A teaser of the operator view →</a>
      </p>
    </section>

    <section class="stats" aria-label="Platform snapshot">
      ${quickStats.map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("")}
    </section>

    <section class="section experience-section">
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
          <h2>Stripe checkout is staged for GA, VIP, Apple Pay, and sponsor packages.</h2>
          <p class="section-copy">This is wired as a real cart surface but guarded from live charging until Stripe keys, price IDs, webhooks, and approval rules are connected on the backend.</p>
        </div>
        <span class="checkout-status-pill">Apple Pay ready path</span>
      </div>
      <div class="ticketing-grid">
        <div class="ticket-product-grid">
          ${ticketProducts.map(product => `
            <article class="ticket-card ${product.requiresReview ? "ticket-card-review" : ""}">
              <div>
                <span>${ticketBadge(product)}</span>
                <strong>${product.name}</strong>
              </div>
              <p>${product.description}</p>
              <div class="ticket-card-footer">
                <b>${productPrice(product)}</b>
                ${product.requiresReview ? `
                  <button class="button secondary ticket-request" data-ticket-request="${product.id}" type="button">Request review</button>
                ` : `
                  <div class="ticket-stepper" aria-label="${product.name} quantity">
                    <button data-ticket-action="decrease" data-ticket-id="${product.id}" type="button" aria-label="Remove ${product.name}">-</button>
                    <span data-ticket-qty="${product.id}">0</span>
                    <button data-ticket-action="increase" data-ticket-id="${product.id}" type="button" aria-label="Add ${product.name}">+</button>
                  </div>
                `}
              </div>
              <code>${product.stripePriceId ?? product.checkoutMode}</code>
            </article>
          `).join("") || `
            <article class="ticket-card">
              <div>
                <span>Needs sync</span>
                <strong>No ticket products loaded</strong>
              </div>
              <p>Run npm run public:sync after updating data/processed/ticket-products.json.</p>
            </article>
          `}
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
          <button id="checkout-btn" class="button primary" type="button" disabled>Continue to Stripe</button>
          <p id="checkout-status" class="checkout-status">Checkout endpoint is staged at ${ticketCatalog?.checkoutEndpoint ?? "/api/stripe/create-checkout-session"}.</p>
          <div class="payment-rails">
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
          <p class="eyebrow">The sculptors</p>
          <h2>Meet the artists &mdash; and find them on the beach.</h2>
          <p class="section-copy">Browse the roster, filter by division, and tap a sculpture on the corridor map to see who's carving it and where, by beach marker.</p>
        </div>
        <span class="sculptor-count">${sculptors.length} sculptors</span>
      </div>
      <div class="sculptor-layout">
        <div class="corridor-map-wrap">
          <div class="corridor-map" id="corridor-map" role="group" aria-label="Competition corridor map with sculpture locations"></div>
          <div class="corridor-legend" id="corridor-legend"></div>
        </div>
        <aside class="sculptor-detail" id="sculptor-detail" aria-live="polite"></aside>
      </div>
      <div class="sculptor-filters" id="sculptor-filters"></div>
      <div class="sculptor-roster" id="sculptor-roster"></div>

      <div class="passport-panel" id="passport-panel">
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
    </section>

    <section class="section admin-config-section" id="admin-config">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Heyelab admin backend</p>
          <h2>Configure pricing, VIP, and sponsorships from one admin surface.</h2>
          <p class="section-copy">This console talks to the local admin API today and is shaped for deployment at sandfest-admin.heyelab.com with APIs served from api.heyelab.com/sandfest.</p>
        </div>
        <span id="admin-api-pill" class="checkout-status-pill">API not loaded</span>
      </div>
      <div class="admin-api-bar">
        <label>
          <span>API base</span>
          <input id="admin-api-base" value="${defaultPublicApiBase()}" autocomplete="off" />
        </label>
        <label>
          <span>Admin token</span>
          <input id="admin-api-token" type="password" value="dev-admin-token-change-me" autocomplete="off" />
        </label>
        <button id="admin-load-config" class="button primary" type="button">Load config</button>
      </div>
      <p id="admin-api-status" class="checkout-status">Start the backend with SANDFEST_ADMIN_API_TOKEN=dev-admin-token-change-me npm run api:dev, then load config.</p>
      <div class="admin-readiness-grid">
        <article>
          <strong>API subdomain</strong>
          <span>api.heyelab.com/sandfest</span>
        </article>
        <article>
          <strong>Admin app</strong>
          <span>sandfest-admin.heyelab.com</span>
        </article>
        <article>
          <strong>Stripe mode</strong>
          <span>Sandbox until keys and webhooks are approved</span>
        </article>
        <article>
          <strong>Price authority</strong>
          <span>Backend validates all amounts before checkout</span>
        </article>
        <article>
          <strong>Admin role</strong>
          <span id="admin-role-summary">Not loaded</span>
        </article>
        <article>
          <strong>Deployment</strong>
          <span id="admin-deployment-summary">Not checked</span>
        </article>
      </div>
      <div class="admin-alert-panel">
        <div class="editor-heading">
          <p class="eyebrow">Emergency alert</p>
          <h3>Public crowd message</h3>
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
      <div class="admin-order-monitor">
        <div class="editor-heading">
          <p class="eyebrow">Transaction + audit monitor</p>
          <h3>Orders, webhooks, fulfillment, and admin changes</h3>
        </div>
        <button id="admin-load-orders" class="button secondary" type="button">Refresh transactions</button>
        <div class="admin-order-grid">
          <div>
            <strong>Pending checkout attempts</strong>
            <div id="admin-order-list" class="admin-record-list">
              <article class="empty-state"><span>No order records loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Payment events</strong>
            <div id="admin-payment-event-list" class="admin-record-list">
              <article class="empty-state"><span>No payment events loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Fulfillment queue</strong>
            <div id="admin-fulfillment-list" class="admin-record-list">
              <article class="empty-state"><span>No fulfillment records loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Admin audit trail</strong>
            <div id="admin-audit-list" class="admin-record-list">
              <article class="empty-state"><span>No audit records loaded.</span></article>
            </div>
          </div>
          <div>
            <strong>Config snapshots</strong>
            <div id="admin-snapshot-list" class="admin-record-list">
              <article class="empty-state"><span>No snapshots loaded.</span></article>
            </div>
          </div>
        </div>
      </div>
      <div class="admin-revenue-panel">
        <div class="editor-heading">
          <p class="eyebrow">Revenue dashboard</p>
          <h3>Unified ticket, vendor, sponsor &amp; merch revenue</h3>
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
      </div>
      <div class="admin-fleet-panel">
        <div class="editor-heading">
          <p class="eyebrow">Fleet checkout</p>
          <h3>Golf carts, UTVs, generators &amp; equipment</h3>
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
            <div id="admin-fleet-assets" class="admin-fleet-rows"></div>
          </div>
          <div>
            <strong>Open checkouts</strong>
            <div id="admin-fleet-open" class="admin-fleet-rows"></div>
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
      <div class="admin-volunteers-panel">
        <div class="editor-heading">
          <p class="eyebrow">Volunteer coverage</p>
          <h3>Shift fill vs needed by zone</h3>
        </div>
        <button id="admin-load-volunteers" class="button secondary" data-requires-permission="volunteers:read" type="button">Load coverage</button>
        <p id="admin-volunteers-updated" class="admin-revenue-updated">Mirrors VolunteerLocal roster/shifts/hours into ops. Seeded until live export is wired.</p>
        <div id="admin-volunteers-kpis" class="admin-revenue-kpis">
          <article class="empty-state"><span>No volunteer coverage loaded.</span></article>
        </div>
        <div class="admin-volunteers-breakdown">
          <div>
            <strong>By zone</strong>
            <div id="admin-volunteers-zones" class="admin-volunteers-rows"></div>
          </div>
          <div>
            <strong>Understaffed shifts</strong>
            <div id="admin-volunteers-gaps" class="admin-volunteers-rows"></div>
          </div>
        </div>
      </div>
      <div class="admin-editor-layout">
        <div>
          <div class="editor-heading">
            <p class="eyebrow">Ticket pricing</p>
            <h3>GA, VIP, raffle gates</h3>
          </div>
          <div id="admin-ticket-editor" class="admin-editor-list">
            <article class="empty-state">
              <strong>No API config loaded</strong>
              <span>Use Load config to edit ticket products from the backend.</span>
            </article>
          </div>
        </div>
        <div>
          <div class="editor-heading">
            <p class="eyebrow">Sponsor packages</p>
            <h3>Tiers, benefits, finance mapping</h3>
          </div>
          <div id="admin-sponsor-editor" class="admin-editor-list">
            <article class="empty-state">
              <strong>No sponsor config loaded</strong>
              <span>Use Load config to edit Heyelab-hosted sponsorship settings.</span>
            </article>
          </div>
        </div>
      </div>
    </section>

    <section class="section media-section" id="media">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Scraped frontend media</p>
          <h2>Official site assets are now local and ready for product screens.</h2>
          <p class="section-copy">${mediaManifest ? `${mediaManifest.count} public images were downloaded, deduped, and classified from the Texas SandFest site.` : "Run npm run media:download to build the local frontend media manifest."}</p>
        </div>
      </div>
      <div class="media-gallery">
        ${galleryAssets.map(asset => `
          <figure>
            <img src="${asset.publicPath}" alt="${asset.alt || asset.name || "Texas SandFest media"}" loading="lazy" />
          </figure>
        `).join("")}
      </div>
      <div class="asset-dashboard">
        <div class="asset-stats">
          ${assetStats.map(([value, label]) => `
            <div>
              <strong>${value}</strong>
              <span>${label}</span>
            </div>
          `).join("")}
        </div>
        <div class="asset-workflow">
          ${assetWorkflow.map(([name, detail]) => `
            <article>
              <strong>${name}</strong>
              <span>${detail}</span>
            </article>
          `).join("")}
        </div>
      </div>
    </section>

    <section class="split" id="concierge">
      <div>
        <p class="eyebrow">AI engine</p>
        <h2>One assistant for guests, staff, vendors, sponsors, and city partners.</h2>
        <p class="section-copy">This prototype uses a local rules-backed knowledge layer today. The interface is intentionally shaped so it can be swapped to a retrieval-backed LLM with approved SandFest content, live ops state, and audit trails.</p>
        <div class="prompt-grid">
          <button data-prompt="Where do I buy tickets?">Tickets</button>
          <button data-prompt="How do I volunteer?">Volunteer</button>
          <button data-prompt="What should a sponsor dashboard track?">Sponsors</button>
          <button data-prompt="What do families need on-site?">Families</button>
          <button data-prompt="What should the iOS app do first?">iOS app</button>
          <button data-prompt="How does this integrate with Port A Local Co?">Port A Local Co</button>
          <button data-prompt="How should QuickBooks fit in?">QuickBooks</button>
        </div>
      </div>
      <div class="assistant-panel">
        <div class="assistant-header">
          <div>
            <strong>Ask Sandy</strong>
            <span>Trusted SandFest concierge</span>
          </div>
          <span class="live-pill">Prototype</span>
        </div>
        <div id="chat" class="chat-log">
          <div class="message ai">Ask me about tickets, volunteering, vendors, sponsors, parking, accessibility, schedules, or operations.</div>
        </div>
        <form id="ask-form" class="ask-form">
          <input id="ask-input" name="question" autocomplete="off" placeholder="Ask a SandFest question..." />
          <button class="button primary" type="submit">Ask</button>
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
        <p class="eyebrow">Maps + field imagery</p>
        <h2>Give guests clarity and staff shared context.</h2>
        <p class="section-copy">The map and photo assets should become reviewed records: each one needs a use case, source page, owner, and launch status before it appears in the public app.</p>
      </div>
      <div class="map-media-grid">
        ${[...mapAssets, ...featuredPhotoAssets].slice(0, 6).map(asset => `
          <figure>
            <img src="${asset.publicPath}" alt="${asset.alt || asset.name || "Texas SandFest visual asset"}" loading="lazy" />
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
      <div>
        <p class="eyebrow">Revenue + relationships</p>
        <h2>Sponsor tiers become an accountable delivery system.</h2>
        <p class="section-copy">The current public site already exposes marine-life tier language. This platform turns that into benefit tracking, asset intake, booth logistics, hospitality notes, and after-action reporting.</p>
      </div>
      <div class="tier-table">
        ${sponsorTiers.map(([tier, amount, promise]) => `
          <div>
            <strong>${tier}</strong>
            <span>${amount}</span>
            <p>${promise}</p>
          </div>
        `).join("")}
      </div>
      <div class="logo-wall" aria-label="Scraped sponsor logos">
        ${sponsorLogoAssets.map(asset => `
          <div>
            <img src="${asset.publicPath}" alt="${asset.alt || asset.name || "Sponsor logo"}" loading="lazy" />
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
      <div class="mobile-shell" aria-label="iOS app concept">
        <div class="phone-frame">
          <div class="phone-top"></div>
          <div class="phone-screen">
            <strong>SandFest Today</strong>
            <span>April 17, 2026</span>
            <button>Ask Sandy</button>
            <div class="phone-list">
              <p><b>9:00 AM</b> Gates open</p>
              <p><b>Marker 12.5</b> ADA parking</p>
              <p><b>Alert</b> North Gate queue rising</p>
            </div>
          </div>
        </div>
        <div>
          <p class="eyebrow">iOS first release</p>
          <h3>Build the field app around what breaks on the beach.</h3>
          <p class="section-copy">Cell signal, heat, crowds, shifting parking, volunteers, and policy questions make this a native app problem. The app should cache the event guide, map, schedule, and policy answers, then sync live changes when connectivity allows.</p>
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
        <p class="eyebrow">Port A Local Co integration</p>
        <h2>SandFest becomes the anchor event layer for the local destination platform.</h2>
        <p class="section-copy">The long-term path is to make SandFest a reusable event module inside Port A Local Co: visitors discover where to stay, eat, park, ride, shop, and return after the event. The integration should use shared APIs and canonical records so Port A Local Co gets curated event intelligence without inheriting operational chaos.</p>
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
      <h2>From prototype to production platform</h2>
      <div class="roadmap-grid">
        <article><strong>1. Content OS</strong><span>Canon event facts, FAQ, policies, maps, schedule, sponsor/vendor/volunteer documents.</span></article>
        <article><strong>2. AI Concierge</strong><span>RAG assistant with approved answers, escalation rules, multilingual support, and SMS/web widgets.</span></article>
        <article><strong>3. Ops Console</strong><span>Volunteer shifts, incidents, weather, crowd density, gate queues, lost party, ADA requests.</span></article>
        <article><strong>4. Native iOS</strong><span>Offline guide, push alerts, check-in, incident capture, staff tools, TestFlight-ready release train.</span></article>
        <article><strong>5. QuickBooks</strong><span>Connect accounting truth to sponsor invoices, vendor payments, raffle reconciliation, and impact reporting.</span></article>
        <article><strong>6. Partner Portals</strong><span>Sponsor CRM, vendor onboarding, nonprofit grants, city coordination, post-event impact.</span></article>
        <article><strong>7. Port A Local Co</strong><span>Expose SandFest as an event/destination module for local discovery, commerce, and retention.</span></article>
      </div>
    </section>
  </main>
`;

function answerQuestion(question) {
  const normalized = question.toLowerCase();
  const match = knowledge.find(item => normalized.includes(item.q));
  if (match) return match.a;
  if (normalized.includes("family") || normalized.includes("kids")) {
    return "Families need clear restroom/shade/medical markers, youth activity timing, lost-child escalation, stroller-friendly paths, and concise gate re-entry guidance.";
  }
  if (normalized.includes("schedule") || normalized.includes("time")) {
    return `The core event window is ${event.dates}, ${event.hours}. In production, this schedule should sync to a CMS so stage, competition, volunteer, and sponsor calendars all stay aligned.`;
  }
  return "I would answer that from the approved SandFest knowledge base, then route anything uncertain to staff. For the build, this becomes retrieval over official content plus live operations state.";
}

function addMessage(text, type) {
  const chat = document.querySelector("#chat");
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.textContent = text;
  chat.append(node);
  chat.scrollTop = chat.scrollHeight;
}

document.querySelector("#ask-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = document.querySelector("#ask-input");
  const question = input.value.trim();
  if (!question) return;
  addMessage(question, "user");
  addMessage(answerQuestion(question), "ai");
  input.value = "";
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    const question = button.dataset.prompt;
    addMessage(question, "user");
    addMessage(answerQuestion(question), "ai");
  });
});

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
  checkout.disabled = false;
}

document.querySelectorAll("[data-ticket-action]").forEach(button => {
  button.addEventListener("click", () => {
    const product = ticketProducts.find(item => item.id === button.dataset.ticketId);
    if (!product) return;
    const current = ticketCart.get(product.id) ?? 0;
    const max = product.quantity?.max ?? 12;
    const next = button.dataset.ticketAction === "increase"
      ? Math.min(current + 1, max)
      : Math.max(current - 1, 0);
    if (next === 0) ticketCart.delete(product.id);
    else ticketCart.set(product.id, next);
    renderTicketCart();
  });
});

document.querySelectorAll("[data-ticket-request]").forEach(button => {
  button.addEventListener("click", () => {
    const product = ticketProducts.find(item => item.id === button.dataset.ticketRequest);
    const status = document.querySelector("#checkout-status");
    status.textContent = `${product.name} is staged for admin review before checkout. Route this into Sponsor CRM, finance approval, or raffle compliance review before collecting payment.`;
  });
});

document.querySelector("#checkout-btn").addEventListener("click", async () => {
  const status = document.querySelector("#checkout-status");
  const button = document.querySelector("#checkout-btn");
  const payload = [...ticketCart.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  button.disabled = true;
  status.textContent = "Validating order with the SandFest API...";
  try {
    const response = await fetch(`${publicApiBase()}${ticketCatalog?.checkoutEndpoint ?? "/api/stripe/create-checkout-session"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Checkout request failed with ${response.status}`);
    if (data.checkoutUrl) {
      status.textContent = "Stripe Checkout session created. Redirecting...";
      window.location.href = data.checkoutUrl;
      return;
    }
    status.textContent = data.message || `Checkout validated and stored as ${data.order?.id ?? "a pending order"}. Stripe is not configured yet.`;
  } catch (error) {
    status.textContent = `${error.message}. Start npm run api:dev locally, then retry.`;
  } finally {
    renderTicketCart();
  }
});

renderTicketCart();

function adminApiBase() {
  return document.querySelector("#admin-api-base").value.replace(/\/+$/, "");
}

function adminToken() {
  return document.querySelector("#admin-api-token").value;
}

function setAdminStatus(message, state = "idle") {
  const status = document.querySelector("#admin-api-status");
  const pill = document.querySelector("#admin-api-pill");
  status.textContent = message;
  pill.textContent = state === "ok" ? "API connected" : state === "error" ? "Needs attention" : "API ready";
  pill.dataset.state = state;
}

function adminCan(permission) {
  const permissions = adminSessionState?.permissions ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}

function renderAdminSession(session) {
  adminSessionState = session;
  const summary = document.querySelector("#admin-role-summary");
  if (summary) {
    summary.textContent = `${session.role.replace("_", " ")} · ${session.permissions.includes("*") ? "all permissions" : `${session.permissions.length} permissions`}`;
  }
  document.querySelectorAll("[data-requires-permission]").forEach(node => {
    const allowed = adminCan(node.dataset.requiresPermission);
    node.disabled = !allowed;
    node.title = allowed ? "" : `Requires ${node.dataset.requiresPermission}`;
  });
}

async function loadAdminSession() {
  const data = await adminFetch("/api/admin/session");
  renderAdminSession(data.session);
  return data.session;
}

function renderAdminDeployment(deployment) {
  const summary = document.querySelector("#admin-deployment-summary");
  if (!summary) return;
  const state = deployment.ok ? "ready" : "blocked";
  summary.textContent = `${deployment.environment} · ${state} · ${deployment.warnings} warnings · ${deployment.errors} errors`;
  summary.dataset.state = deployment.ok ? "ok" : "error";
}

async function loadAdminDeployment() {
  const data = await adminFetch("/api/admin/deployment");
  renderAdminDeployment(data.deployment);
  return data.deployment;
}

async function adminFetch(path, options = {}) {
  const response = await fetch(`${adminApiBase()}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${adminToken()}`,
      ...(options.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data;
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
    const response = await fetch(`${publicApiBase()}/api/public/alert`, { cache: "no-store" });
    if (!response.ok) return;
    renderPublicAlert(await response.json());
  } catch {
    renderPublicAlert(null);
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
    expiresAt: localDateTimeToIso(document.querySelector("#admin-alert-expires").value)
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
  return data.alert;
}

function ticketAdminCard(product) {
  return `
    <article class="admin-edit-card" data-admin-ticket="${product.id}">
      <div class="admin-edit-title">
        <strong>${product.name}</strong>
        <span>${product.requiresReview ? "Review gated" : "Checkout enabled"}</span>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>Price label</span>
          <input name="priceLabel" value="${product.priceLabel ?? ""}" />
        </label>
        <label>
          <span>Amount</span>
          <input name="unitAmount" inputmode="decimal" placeholder="0.00" value="${moneyInput(product.unitAmount)}" />
        </label>
        <label>
          <span>Stripe Price ID</span>
          <input name="stripePriceId" value="${product.stripePriceId ?? ""}" />
        </label>
        <label>
          <span>Max qty</span>
          <input name="quantityMax" inputmode="numeric" value="${product.quantity?.max ?? ""}" />
        </label>
      </div>
      <label class="admin-check">
        <input name="requiresReview" type="checkbox" ${product.requiresReview ? "checked" : ""} />
        <span>Require admin review before checkout</span>
      </label>
      <p>${product.description}</p>
      <div class="admin-edit-actions">
        <span>${adminMoney(product.unitAmount, product.priceLabel ?? "Set in Stripe")}</span>
        <button class="button secondary" data-save-ticket="${product.id}" data-requires-permission="ticket:write" type="button">Save ticket</button>
      </div>
    </article>
  `;
}

function sponsorAdminCard(sponsorPackage) {
  return `
    <article class="admin-edit-card" data-admin-sponsor="${sponsorPackage.id}">
      <div class="admin-edit-title">
        <strong>${sponsorPackage.name}</strong>
        <span>${sponsorPackage.active ? "Active" : "Hidden"}</span>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>Public label</span>
          <input name="publicLabel" value="${sponsorPackage.publicLabel ?? ""}" />
        </label>
        <label>
          <span>Amount</span>
          <input name="amount" inputmode="decimal" value="${moneyInput(sponsorPackage.amount)}" />
        </label>
        <label>
          <span>Stripe ID</span>
          <input name="stripePriceId" value="${sponsorPackage.stripePriceId ?? ""}" />
        </label>
        <label>
          <span>QBO item</span>
          <input name="quickBooksItemId" value="${sponsorPackage.quickBooksItemId ?? ""}" />
        </label>
      </div>
      <label>
        <span>Benefits</span>
        <textarea name="benefits" rows="3">${(sponsorPackage.benefits ?? []).join("\n")}</textarea>
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
        <span>${adminMoney(sponsorPackage.amount, sponsorPackage.publicLabel ?? "Not set")}</span>
        <button class="button secondary" data-save-sponsor="${sponsorPackage.id}" data-requires-permission="sponsor:write" type="button">Save sponsor</button>
      </div>
    </article>
  `;
}

function renderAdminEditors() {
  const tickets = adminConfigState?.tickets?.products ?? [];
  const sponsors = adminConfigState?.config?.sponsorPackages ?? [];
  document.querySelector("#admin-ticket-editor").innerHTML = tickets.map(ticketAdminCard).join("");
  document.querySelector("#admin-sponsor-editor").innerHTML = sponsors.map(sponsorAdminCard).join("");
  if (adminSessionState) renderAdminSession(adminSessionState);
  bindAdminSaveButtons();
}

function orderRecordCard(item) {
  const order = item.record;
  const lines = order.lineItems?.map(line => `${line.quantity} x ${line.name}`).join(", ") ?? "No line items";
  return `
    <article class="admin-record-card">
      <div>
        <strong>${order.id ?? item.file}</strong>
        <span>${order.status ?? "unknown"}</span>
      </div>
      <p>${lines}</p>
      <code>${item.path}</code>
    </article>
  `;
}

function paymentEventCard(item) {
  const event = item.record;
  return `
    <article class="admin-record-card">
      <div>
        <strong>${event.type ?? event.id ?? item.file}</strong>
        <span>${event.fulfillmentStatus ?? "not_required"}</span>
      </div>
      <p>${event.checkoutSessionId ?? event.objectId ?? "No checkout session attached"} · ${event.verificationReason ?? "signature not checked"}</p>
      <code>${item.path}</code>
    </article>
  `;
}

function fulfillmentCard(item) {
  const fulfillment = item.record;
  const statusOptions = ["queued", "needs_review", "ready", "issued", "checked_in", "refunded", "voided"]
    .map(status => `<option value="${status}" ${status === fulfillment.status ? "selected" : ""}>${status.replace("_", " ")}</option>`)
    .join("");
  return `
    <article class="admin-record-card" data-fulfillment-id="${fulfillment.id}">
      <div>
        <strong>${fulfillment.name ?? fulfillment.productId ?? item.file}</strong>
        <span>${fulfillment.fulfillmentType ?? "manual_review"}</span>
      </div>
      <p>${fulfillment.orderId ?? "No order"} · ${fulfillment.holder?.email ?? "No holder email"}</p>
      <div class="fulfillment-actions">
        <select aria-label="Fulfillment status">${statusOptions}</select>
        <button class="button secondary" data-save-fulfillment="${fulfillment.id}" data-requires-permission="fulfillment:update" type="button">Update</button>
      </div>
      <code>${item.path}</code>
    </article>
  `;
}

function auditCard(item) {
  const audit = item.record;
  const target = audit.target ? `${audit.target.type}:${audit.target.id}` : "unknown target";
  const fields = audit.metadata?.changedFields?.length
    ? audit.metadata.changedFields.join(", ")
    : audit.metadata?.severity ?? "recorded";
  return `
    <article class="admin-record-card">
      <div>
        <strong>${audit.action ?? audit.id ?? item.file}</strong>
        <span>${target}</span>
      </div>
      <p>${fields} · ${audit.createdAt ?? "No timestamp"}</p>
      <code>${item.path}</code>
    </article>
  `;
}

function snapshotCard(item) {
  const snapshot = item.record;
  const target = snapshot.target ? `${snapshot.target.type}:${snapshot.target.id}` : "unknown target";
  return `
    <article class="admin-record-card" data-snapshot-file="${item.file}">
      <div>
        <strong>${snapshot.reason ?? snapshot.id ?? item.file}</strong>
        <span>${target}</span>
      </div>
      <p>${snapshot.createdAt ?? "No timestamp"}</p>
      <div class="snapshot-actions">
        <button class="button secondary" data-restore-snapshot="${item.file}" data-requires-permission="config:rollback" type="button">Restore</button>
      </div>
      <code>${item.path}</code>
    </article>
  `;
}

function pinColor(colorKey) {
  return legendColorByKey.get(colorKey) || "var(--gulf)";
}

function corridorPinMarkup(poi) {
  const xy = poi.illustratedMapXY || { x: 0.5, y: 0.5 };
  const entry = poi.entryId ? entriesById.get(poi.entryId) : null;
  const sculptor = entry ? sculptorsById.get(entry.sculptorId) : null;
  const isSculpture = poi.type === "sculpture";
  const label = entry ? entry.title : (poi.label || poi.type);
  const live = entry && entry.status === "sculpting";
  const title = sculptor
    ? `${entry.title} — ${sculptor.name} (marker ${poi.beachMarker})`
    : `${label} (marker ${poi.beachMarker})`;
  return `<button class="corridor-pin${isSculpture ? "" : " corridor-pin-amenity"}${live ? " is-live" : ""}" type="button"
     style="left:${(xy.x * 100).toFixed(1)}%;top:${(xy.y * 100).toFixed(1)}%;--pin:${pinColor(poi.colorKey)}"
     ${sculptor ? `data-sculptor="${sculptor.id}"` : ""} data-poi="${poi.id}"
     title="${title}" aria-label="${title}">
     <span class="corridor-pin-dot"></span>
     <span class="corridor-pin-label">${isSculpture ? poi.beachMarker : label}</span>
   </button>`;
}

function renderCorridorMap() {
  const map = document.querySelector("#corridor-map");
  if (!map) return;
  map.innerHTML = `
    <span class="corridor-water" aria-hidden="true"></span>
    <span class="corridor-sand" aria-hidden="true"></span>
    <span class="corridor-axis" aria-hidden="true">Gulf shoreline · North Gate → beach markers 12.5&ndash;14.5</span>
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
      <span class="sculptor-card-chip" style="--pin:${pinColor(sculptor.division)}">${divisionLabel(sculptor.division)}</span>
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
    <div class="sculptor-detail-head" style="--pin:${pinColor(sculptor.division)}">
      <span class="sculptor-detail-chip">${divisionLabel(sculptor.division)}</span>
      ${entry && entry.status === "sculpting"
        ? `<span class="sculptor-detail-live">&#9679; ${status}</span>`
        : (status ? `<span class="sculptor-detail-status">${status}</span>` : "")}
    </div>
    <h3>${sculptor.name}</h3>
    <p class="sculptor-detail-home">${sculptor.hometown ?? ""}${sculptor.returning ? " · Returning artist" : " · New this year"}</p>
    ${entry ? `<p class="sculptor-detail-entry"><strong>&ldquo;${entry.title}&rdquo;</strong> — beach marker ${entry.beachMarker}</p>` : ""}
    ${entry && entry.statement ? `<p class="sculptor-detail-statement">${entry.statement}</p>` : ""}
    <p class="sculptor-detail-bio">${sculptor.bio ?? ""}</p>
    ${sculptor.socials && sculptor.socials.instagram ? `<p class="sculptor-detail-social">${sculptor.socials.instagram}</p>` : ""}
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
const OPS_SECTION_IDS = new Set(["operations", "admin-config", "admin", "workflows", "surfaces", "finance", "roadmap"]);

function classifyAudiences() {
  document.querySelectorAll("main > section").forEach(sec => {
    if (sec.classList.contains("hero")) { sec.dataset.audience = "all"; return; }
    sec.dataset.audience = OPS_SECTION_IDS.has(sec.id) ? "ops" : "public";
  });
  document.querySelectorAll("header nav a").forEach(link => {
    const id = (link.getAttribute("href") || "").replace("#", "");
    link.dataset.audience = OPS_SECTION_IDS.has(id) ? "ops" : "public";
  });
}

function setSiteMode(mode) {
  const normalized = mode === "ops" ? "ops" : "public";
  document.body.classList.toggle("mode-ops", normalized === "ops");
  document.body.classList.toggle("mode-public", normalized === "public");
  document.querySelectorAll("[data-site-mode]").forEach(btn => {
    const active = btn.dataset.siteMode === normalized;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  try { localStorage.setItem("sandfest_site_mode", normalized); } catch { /* ignore */ }
}

function initSiteMode() {
  classifyAudiences();
  let saved = "public";
  try { saved = localStorage.getItem("sandfest_site_mode") || "public"; } catch { /* ignore */ }
  setSiteMode(saved);
  document.querySelectorAll("[data-site-mode]").forEach(btn => {
    btn.addEventListener("click", () => setSiteMode(btn.dataset.siteMode));
  });
}

const PASSPORT_KEY = "sandfest_passport_v1";
const passportCheckpoints = sculptureEntries.filter(e => sculptorsById.has(e.sculptorId));

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

function collectStamp(entryId) {
  const collected = readPassport();
  if (collected.has(entryId)) collected.delete(entryId);
  else collected.add(entryId);
  writePassport(collected);
  renderPassport();
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
      <button class="passport-stamp${done ? " is-collected" : ""}" type="button" data-collect="${entry.id}"
        aria-pressed="${done}" title="${done ? "Collected" : "Tap to collect (simulates the on-beach QR scan)"}">
        <span class="passport-stamp-mark" style="--pin:${pinColor(entry.division)}">${done ? "&#10003;" : entry.beachMarker}</span>
        <strong>${entry.title}</strong>
        <span class="passport-stamp-artist">${sculptor ? sculptor.name : ""}</span>
        <span class="passport-stamp-state">${done ? "Stamped" : "Scan at marker " + entry.beachMarker}</span>
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
  if (!document.querySelector("#corridor-map")) return;
  renderCorridorMap();
  renderSculptorFilters("all");
  renderSculptorRoster("all");
  defaultSculptorDetail();
  renderPassport();
  const resetBtn = document.querySelector("#passport-reset");
  if (resetBtn) resetBtn.addEventListener("click", resetPassport);
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
  if (!kpis || !s) return;
  kpis.innerHTML = [
    revenueKpiCard("Gross", adminMoney(s.totals.grossCents), `${s.totals.count} entries`),
    revenueKpiCard("Fees", adminMoney(s.totals.feeCents), `${s.totals.effectiveFeeRatePct}% of gross`),
    revenueKpiCard("Net", adminMoney(s.totals.netCents), s.spendPerAttendeeCents ? `${adminMoney(s.spendPerAttendeeCents)}/guest` : ""),
    revenueKpiCard("Reconciled", `${s.reconciliation.pctReconciled}%`, `${adminMoney(s.reconciliation.unreconciledNetCents)} pending`),
    revenueKpiCard("Tickets sold", `${s.tickets.sold}`, s.tickets.pctSold != null ? `${s.tickets.pctSold}% of ${s.tickets.capacity}` : "")
  ].join("");
  cats.innerHTML = Object.entries(s.byCategory).map(([k, v]) => revenueRow(k, v)).join("")
    || '<article class="empty-state"><span>No entries.</span></article>';
  sources.innerHTML = Object.entries(s.bySource).map(([k, v]) => revenueRow(k, v)).join("")
    || '<article class="empty-state"><span>No entries.</span></article>';
  updated.textContent = payload.lastUpdated
    ? `Ledger updated ${new Date(payload.lastUpdated).toLocaleString()} · ${payload.entries.length} entries · seeded sample until live feeds are wired.`
    : "Revenue loaded.";
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
    if (!quiet) setAdminStatus(`${error.message}. Revenue needs the revenue:read permission and a running backend.`, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
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
    return `
      <article data-fleet-asset="${asset.id}" class="fleet-asset-row status-${asset.status}">
        <div>
          <strong>${asset.label}</strong>
          <span>${asset.type.replace(/_/g, " ")} · ${asset.id}${asset.qrPayload ? ` · ${asset.qrPayload}` : ""}</span>
        </div>
        <b>${fleetStatusLabel(asset.status)}</b>
        <em>${who}</em>
        <i>${loc}</i>
      </article>`;
  }).join("") || '<article class="empty-state"><span>No assets.</span></article>';

  openEl.innerHTML = (payload.openCheckouts || []).map(co => `
    <article>
      <div>
        <strong>${co.assetId}</strong>
        <span>${co.checkedOutTo} · ${co.team || "unassigned"}</span>
      </div>
      <b>${co.startCondition || "—"}</b>
      <em>${co.startChargePct != null ? `${co.startChargePct}%` : "—"}</em>
      <i>${co.checkOutAt ? new Date(co.checkOutAt).toLocaleString() : ""}</i>
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
    if (!quiet) setAdminStatus(`${error.message}. Fleet needs the fleet:read permission and a running backend.`, "error");
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
    if (!quiet) setAdminStatus(`${error.message}. Coverage needs the volunteers:read permission and a running backend.`, "error");
    throw error;
  } finally {
    if (button) button.disabled = false;
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
    const [orders, events, fulfillment, audit, snapshots] = await Promise.all([
      adminFetch("/api/admin/orders?limit=12"),
      adminFetch("/api/admin/payment-events?limit=12"),
      adminFetch("/api/admin/fulfillment?limit=12"),
      adminFetch("/api/admin/audit?limit=12"),
      adminFetch("/api/admin/snapshots?limit=12")
    ]);
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
    bindSnapshotButtons();
    if (adminSessionState) renderAdminSession(adminSessionState);
    setAdminStatus(`Loaded ${orders.pendingOrders.length} order records, ${events.paymentEvents.length} payment events, ${fulfillment.fulfillment.length} fulfillment records, ${audit.audit.length} audit entries, and ${snapshots.snapshots.length} snapshots.`, "ok");
  } catch (error) {
    setAdminStatus(`${error.message}. Confirm the backend is running and the admin token is valid.`, "error");
  } finally {
    button.disabled = false;
  }
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
        setAdminStatus(`Saved ticket config for ${result.product.name}. Run npm run public:sync before rebuilding static assets.`, "ok");
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
}

document.querySelector("#admin-load-config").addEventListener("click", async () => {
  const button = document.querySelector("#admin-load-config");
  button.disabled = true;
  setAdminStatus("Loading admin config...", "idle");
  try {
    await loadAdminSession();
    await loadAdminDeployment();
    adminConfigState = await adminFetch("/api/admin/config");
    await loadAdminAlert();
    renderAdminEditors();
    if (adminCan("revenue:read")) {
      await loadAdminRevenue({ quiet: true }).catch(() => {});
    }
    if (adminCan("fleet:read")) {
      await loadAdminFleet({ quiet: true }).catch(() => {});
    }
    if (adminCan("volunteers:read")) {
      await loadAdminVolunteers({ quiet: true }).catch(() => {});
    }
    setAdminStatus(`Loaded ${adminConfigState.tickets.products.length} ticket products and ${adminConfigState.config.sponsorPackages.length} sponsor packages.`, "ok");
  } catch (error) {
    setAdminStatus(`${error.message}. Confirm npm run api:dev is running and the token matches SANDFEST_ADMIN_API_TOKEN.`, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-publish-alert").addEventListener("click", async () => {
  const button = document.querySelector("#admin-publish-alert");
  button.disabled = true;
  try {
    const alert = await saveAdminAlert(true);
    setAdminStatus(`Published ${alert.severity} alert: ${alert.title}.`, "ok");
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
    await saveAdminAlert(false);
    setAdminStatus("Cleared the public emergency alert.", "ok");
  } catch (error) {
    setAdminStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-load-orders").addEventListener("click", loadAdminTransactions);
document.querySelector("#admin-load-revenue").addEventListener("click", () => loadAdminRevenue());
document.querySelector("#admin-load-fleet")?.addEventListener("click", () => loadAdminFleet());
document.querySelector("#admin-fleet-checkout")?.addEventListener("click", () => adminFleetCheckout());
document.querySelector("#admin-fleet-checkin")?.addEventListener("click", () => adminFleetCheckin());
document.querySelector("#admin-load-volunteers")?.addEventListener("click", () => loadAdminVolunteers());

initSiteMode();
initSculptors();

loadPublicAlert();
window.setInterval(loadPublicAlert, 30000);

function updateNetworkStatus() {
  const status = document.querySelector("#network-status");
  if (!status) return;
  const online = navigator.onLine;
  status.textContent = online ? "Live" : "Offline";
  status.dataset.state = online ? "online" : "offline";
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

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  updateNetworkStatus();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        const status = document.querySelector("#network-status");
        if (status && navigator.onLine) {
          status.textContent = "Web";
          status.dataset.state = "online";
        }
      });
    });
  }
}

setupInstallAndOfflineSupport();

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

startTideMotion();
startLiveBeach();

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
  const showPop = (s, evt) => {
    const rect = canvas.getBoundingClientRect();
    const cx = px(s.x) / W * rect.width;
    const cy = py(s.y) / H * rect.height;
    popEl.querySelector(".lb-pop-num").textContent = `Sculpture #${s.id}`;
    popEl.querySelector(".lb-pop-flag").textContent = s.country;
    popEl.querySelector(".lb-pop-crowd").textContent = crowdLabel[s.crowd];
    popEl.querySelector(".lb-pop-crowd").setAttribute("data-crowd", s.crowd);
    popEl.querySelector(".lb-pop-title em").textContent = s.title;
    popEl.querySelector(".lb-pop-sculptor").textContent = s.sculptor;
    const dist = Math.hypot(s.x - visitor.x, s.y - visitor.y);
    const minutes = Math.max(1, Math.round(dist * 18));
    popEl.querySelector(".lb-pop-walk").textContent = `${minutes} min walk from you`;
    popEl.style.left = `${cx}px`;
    popEl.style.top  = `${cy - 16}px`;
    popEl.hidden = false;
  };
  const hidePop = () => { popEl.hidden = true; };

  pinsGroup.querySelectorAll(".lb-pin").forEach((g) => {
    const id = Number(g.dataset.pinId);
    const s = sculptures.find(x => x.id === id);
    g.addEventListener("pointerenter", (e) => showPop(s, e));
    g.addEventListener("pointerleave", hidePop);
    g.addEventListener("focus", () => showPop(s));
    g.addEventListener("blur",  hidePop);
    g.addEventListener("click", () => {
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

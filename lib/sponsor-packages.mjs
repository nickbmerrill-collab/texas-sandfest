const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STRIPE_PRICE_ID = /^price_[A-Za-z0-9_]+$/;
const MAX_AMOUNT_CENTS = 100_000_000;

export const DEFAULT_SPONSOR_PACKAGES = Object.freeze([
  Object.freeze({
    id: "flounder",
    name: "Flounder",
    amount: 125000,
    currency: "usd",
    publicLabel: "$1,250 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "8 three-day general admission wristbands",
      "Company logo on the Texas SandFest website and printed materials"
    ])
  }),
  Object.freeze({
    id: "trout",
    name: "Trout",
    amount: 250000,
    currency: "usd",
    publicLabel: "$2,500 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "4 VIP wristbands",
      "6 three-day general admission wristbands",
      "2 one-day VIP parking passes",
      "Name on a sand wall",
      "Company logo on the Texas SandFest website",
      "Sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "tarpon",
    name: "Tarpon",
    amount: 500000,
    currency: "usd",
    publicLabel: "$5,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "8 VIP wristbands",
      "10 three-day general admission wristbands",
      "4 one-day VIP parking passes",
      "Simplified logo on the west side of the Gallery near the Semi-Pro Sculptors",
      "Company logo on the Texas SandFest website",
      "Sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "sailfish",
    name: "Sailfish",
    amount: 1000000,
    currency: "usd",
    publicLabel: "$10,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "15 VIP wristbands",
      "20 three-day general admission wristbands",
      "6 one-day VIP parking passes",
      "Logo on the south side of Logo Mountain",
      "Company logo on the Texas SandFest website",
      "Sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "marlin",
    name: "Marlin",
    amount: 1500000,
    currency: "usd",
    publicLabel: "$15,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "25 VIP wristbands",
      "30 three-day general admission wristbands",
      "10 one-day VIP parking passes",
      "Logo on the mid-tier of Logo Mountain",
      "Company logo on the Texas SandFest website",
      "Sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "shark",
    name: "Shark",
    amount: 2500000,
    currency: "usd",
    publicLabel: "$25,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "36 VIP wristbands",
      "50 three-day general admission wristbands",
      "18 one-day VIP parking passes",
      "Logo on the top tier of Logo Mountain",
      "Company logo on the website, promotional materials, and event signage",
      "Half-page ad in the Texas SandFest magazine",
      "Sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "vip-tent-sponsor",
    name: "VIP Tent Sponsor",
    amount: 2500000,
    currency: "usd",
    publicLabel: "$25,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "Company signage in the VIP area",
      "36 VIP wristbands",
      "50 three-day general admission wristbands",
      "18 one-day VIP parking passes",
      "Logo on the top tier of Logo Mountain",
      "Company logo on VIP wristbands",
      "Company logo on the website, promotional materials, and event signage",
      "Half-page ad in the Texas SandFest magazine",
      "Logo on sponsor gift bags"
    ])
  }),
  Object.freeze({
    id: "whale",
    name: "Whale",
    amount: 5000000,
    currency: "usd",
    publicLabel: "$50,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "72 VIP wristbands",
      "100 three-day general admission wristbands",
      "36 one-day VIP parking passes",
      "Logo on the lower half of the east side of Logo Mountain",
      "Prominent display on the website, promotional materials, and event signage",
      "Full-page ad in the Texas SandFest magazine",
      "5 social media posts",
      "Premium sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "giant-squid",
    name: "Giant Squid",
    amount: 7500000,
    currency: "usd",
    publicLabel: "$75,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "100 VIP wristbands",
      "125 three-day general admission wristbands",
      "45 one-day VIP parking passes",
      "Logo on the top half of the east side of Logo Mountain",
      "Prominent display on the website, promotional materials, and event signage",
      "Full-page ad in the Texas SandFest magazine",
      "7 social media posts",
      "Premium sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "megalodon",
    name: "Megalodon",
    amount: 12500000,
    currency: "usd",
    publicLabel: "$125,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "150 VIP wristbands",
      "175 three-day general admission wristbands",
      "60 one-day VIP parking passes",
      "One 30-by-30-foot booth space with tent provided",
      "Logo on the full west side of Logo Mountain",
      "Prominent display on the website, promotional materials, and event signage",
      "Full-page ad in the Texas SandFest magazine",
      "10 social media posts",
      "Premium sponsor gift bag"
    ])
  }),
  Object.freeze({
    id: "the-kraken",
    name: "The Kraken",
    amount: 25000000,
    currency: "usd",
    publicLabel: "$250,000 sponsorship",
    active: true,
    requiresApproval: true,
    stripePriceId: null,
    quickBooksItemId: null,
    benefits: Object.freeze([
      "Presenting sponsor recognition",
      "225 VIP wristbands",
      "250 three-day general admission wristbands",
      "100 one-day VIP parking passes",
      "Two 30-by-30-foot booth spaces with tents provided",
      "One billboard, location to be determined",
      "Logo on the full north side of Logo Mountain",
      "Music Stage naming recognition",
      "Logo on Big Checks",
      "Prominent display on the website, promotional materials, and event signage",
      "Two full-page ads in the Texas SandFest magazine",
      "Full-page ad in the Port Aransas South Jetty SandFest guide",
      "15 social media posts",
      "Logo on sponsor gift bags",
      "Premium sponsor gift bag"
    ])
  })
]);

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function optionalText(value, max = 500) {
  return text(value, max) || null;
}

function stringList(value, maxItems = 20, maxLength = 200) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => text(item, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function amountInCents(value) {
  const amount = Number(value);
  return Number.isInteger(amount) ? amount : null;
}

function defaultPublicLabel(amount) {
  if (!Number.isInteger(amount) || amount < 1) return "";
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2
  }).format(amount / 100)} sponsorship`;
}

export function normalizeSponsorPackage(input = {}) {
  const amount = amountInCents(input.amount);
  return {
    id: text(input.id, 100).toLowerCase(),
    name: text(input.name, 120),
    amount,
    currency: text(input.currency || "usd", 3).toLowerCase(),
    publicLabel: text(input.publicLabel, 120) || defaultPublicLabel(amount),
    active: input.active !== false,
    requiresApproval: input.requiresApproval !== false,
    stripePriceId: optionalText(input.stripePriceId, 160),
    quickBooksItemId: optionalText(input.quickBooksItemId, 160),
    benefits: stringList(input.benefits, 20, 200)
  };
}

export function validateSponsorPackage(input = {}) {
  const sponsorPackage = normalizeSponsorPackage(input);
  const errors = [];
  if (!IDENTIFIER.test(sponsorPackage.id)) errors.push("Package ID must use lowercase letters, numbers, and hyphens.");
  if (!sponsorPackage.name) errors.push("Package name is required.");
  if (!Number.isInteger(sponsorPackage.amount) || sponsorPackage.amount < 1 || sponsorPackage.amount > MAX_AMOUNT_CENTS) {
    errors.push(`Package amount must be whole cents between 1 and ${MAX_AMOUNT_CENTS}.`);
  }
  if (sponsorPackage.currency !== "usd") errors.push("Sponsor packages currently support USD only.");
  if (!sponsorPackage.publicLabel) errors.push("Public package label is required.");
  if (!sponsorPackage.benefits.length) errors.push("Choose at least one package benefit.");
  if (input.active !== undefined && typeof input.active !== "boolean") errors.push("Package active state must be true or false.");
  if (input.requiresApproval !== undefined && typeof input.requiresApproval !== "boolean") errors.push("Package approval state must be true or false.");
  if (sponsorPackage.stripePriceId && (!STRIPE_PRICE_ID.test(sponsorPackage.stripePriceId) || sponsorPackage.stripePriceId.startsWith("price_replace"))) {
    errors.push("Stripe Price ID must be a non-placeholder price_ identifier.");
  }
  return { ok: errors.length === 0, errors, sponsorPackage };
}

export function sponsorPackageCatalog(config = {}) {
  const source = Array.isArray(config.sponsorPackages) ? config.sponsorPackages : [];
  const validations = source.map(validateSponsorPackage);
  const packages = validations.map(result => result.sponsorPackage);
  const ids = packages.map(item => item.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
  const activePackages = packages.filter((item, index) => validations[index].ok && item.active);
  const errors = validations.flatMap((result, index) => result.errors.map(error => `${packages[index].id || `package-${index + 1}`}: ${error}`));
  if (duplicateIds.length) errors.push(`Duplicate sponsor package IDs: ${duplicateIds.join(", ")}.`);
  if (!activePackages.length) errors.push("At least one active sponsor package is required.");
  return {
    ready: errors.length === 0,
    source: Array.isArray(config.sponsorPackages) ? "config" : "missing",
    packages,
    activePackages,
    errors
  };
}

export function resolveSponsorPackage(config, packageIdInput) {
  const catalog = sponsorPackageCatalog(config);
  const packageId = text(packageIdInput, 100).toLowerCase();
  const sponsorPackage = catalog.activePackages.find(item => item.id === packageId);
  if (!sponsorPackage) return { ok: false, error: "Choose an active sponsorship package.", catalog };
  return { ok: true, sponsorPackage, catalog };
}

export function publicSponsorPackage(input) {
  const sponsorPackage = normalizeSponsorPackage(input);
  return {
    id: sponsorPackage.id,
    name: sponsorPackage.name,
    amount: sponsorPackage.amount,
    currency: sponsorPackage.currency,
    publicLabel: sponsorPackage.publicLabel,
    requiresApproval: sponsorPackage.requiresApproval,
    benefits: sponsorPackage.benefits
  };
}

export function createSponsorPackageConfig(configInput = {}, input = {}) {
  const config = { ...configInput };
  const catalog = sponsorPackageCatalog(config);
  const candidate = validateSponsorPackage(input);
  if (!candidate.ok) return { ok: false, error: candidate.errors.join(" "), errors: candidate.errors };
  const existing = catalog.packages.find(item => item.id === candidate.sponsorPackage.id);
  if (existing && JSON.stringify(existing) === JSON.stringify(candidate.sponsorPackage)) {
    return {
      ok: true,
      replay: true,
      sponsorPackage: existing,
      config,
      catalog
    };
  }
  if (existing) {
    return { ok: false, conflict: true, error: "Sponsor package already exists." };
  }
  const sponsorPackages = [...catalog.packages, candidate.sponsorPackage];
  const nextCatalog = sponsorPackageCatalog({ ...config, sponsorPackages });
  if (!nextCatalog.ready) {
    return { ok: false, error: nextCatalog.errors.join(" "), errors: nextCatalog.errors };
  }
  return {
    ok: true,
    replay: false,
    sponsorPackage: candidate.sponsorPackage,
    config: { ...config, sponsorPackages },
    catalog: nextCatalog
  };
}

export function updateSponsorPackageConfig(configInput = {}, packageId, patch = {}) {
  const config = { ...configInput };
  const catalog = sponsorPackageCatalog(config);
  const index = catalog.packages.findIndex(item => item.id === text(packageId, 100).toLowerCase());
  if (index < 0) return { ok: false, error: "Sponsor package not found." };
  const candidate = validateSponsorPackage({ ...catalog.packages[index], ...patch, id: catalog.packages[index].id });
  if (!candidate.ok) return { ok: false, error: candidate.errors.join(" "), errors: candidate.errors };
  const sponsorPackages = catalog.packages.slice();
  sponsorPackages[index] = candidate.sponsorPackage;
  const nextCatalog = sponsorPackageCatalog({ ...config, sponsorPackages });
  if (!nextCatalog.ready) {
    return { ok: false, error: nextCatalog.errors.join(" "), errors: nextCatalog.errors };
  }
  return {
    ok: true,
    before: catalog.packages[index],
    sponsorPackage: candidate.sponsorPackage,
    config: { ...config, sponsorPackages },
    catalog: nextCatalog
  };
}

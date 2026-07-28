export const VENDOR_CATEGORIES = Object.freeze([
  "food",
  "retail",
  "artisan",
  "service",
  "nonprofit"
]);

const CATEGORY_SET = new Set(VENDOR_CATEGORIES);
const INTAKE_MODE_SET = new Set(["interest", "application"]);
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STRIPE_PRICE_ID = /^price_[A-Za-z0-9_]+$/;

export const DEFAULT_VENDOR_OFFERINGS = Object.freeze([
  Object.freeze({
    id: "food-beverage-booth",
    name: "Food vendor interest",
    amount: 0,
    currency: "usd",
    publicLabel: "Fee confirmed when applications open",
    active: true,
    requiresApproval: true,
    intakeMode: "interest",
    categories: Object.freeze(["food"]),
    description: "Join the interest list for future Texas SandFest food and nonalcoholic beverage vendor applications.",
    inclusions: Object.freeze(["Application opening notice", "Program updates", "Staff review when applications open"]),
    stripePriceId: null,
    quickBooksItemId: null
  }),
  Object.freeze({
    id: "marketplace-booth",
    name: "Non-food vendor interest",
    amount: 0,
    currency: "usd",
    publicLabel: "Fee confirmed when applications open",
    active: true,
    requiresApproval: true,
    intakeMode: "interest",
    categories: Object.freeze(["retail", "artisan", "service"]),
    description: "Join the interest list for future Texas SandFest retail, artisan, and service vendor applications.",
    inclusions: Object.freeze(["Application opening notice", "Program updates", "Staff review when applications open"]),
    stripePriceId: null,
    quickBooksItemId: null
  }),
  Object.freeze({
    id: "community-nonprofit-booth",
    name: "Nonprofit vendor interest",
    amount: 0,
    currency: "usd",
    publicLabel: "Fee confirmed when applications open",
    active: true,
    requiresApproval: true,
    intakeMode: "interest",
    categories: Object.freeze(["nonprofit"]),
    description: "Join the interest list for future Texas SandFest nonprofit and community vendor applications.",
    inclusions: Object.freeze(["Application opening notice", "Program updates", "Staff review when applications open"]),
    stripePriceId: null,
    quickBooksItemId: null
  })
]);

export const BOARD_DEMO_VENDOR_OFFERINGS = Object.freeze([
  Object.freeze({
    id: "food-beverage-booth",
    name: "Food and beverage booth",
    amount: 175000,
    currency: "usd",
    publicLabel: "$1,750 application fee",
    active: true,
    requiresApproval: true,
    intakeMode: "application",
    categories: Object.freeze(["food"]),
    description: "Synthetic board-demo marketplace space for prepared food and nonalcoholic beverage vendors.",
    inclusions: Object.freeze(["Marketplace booth footprint", "Vendor credentials", "Published booth listing"]),
    stripePriceId: null,
    quickBooksItemId: null
  }),
  Object.freeze({
    id: "marketplace-booth",
    name: "Marketplace booth",
    amount: 125000,
    currency: "usd",
    publicLabel: "$1,250 application fee",
    active: true,
    requiresApproval: true,
    intakeMode: "application",
    categories: Object.freeze(["retail", "artisan", "service"]),
    description: "Synthetic board-demo marketplace space for retailers, artists, makers, and service exhibitors.",
    inclusions: Object.freeze(["Marketplace booth footprint", "Vendor credentials", "Published booth listing"]),
    stripePriceId: null,
    quickBooksItemId: null
  }),
  Object.freeze({
    id: "community-nonprofit-booth",
    name: "Community nonprofit booth",
    amount: 50000,
    currency: "usd",
    publicLabel: "$500 application fee",
    active: true,
    requiresApproval: true,
    intakeMode: "application",
    categories: Object.freeze(["nonprofit"]),
    description: "Synthetic board-demo marketplace space reserved for eligible nonprofit organizations.",
    inclusions: Object.freeze(["Community booth footprint", "Vendor credentials", "Published booth listing"]),
    stripePriceId: null,
    quickBooksItemId: null
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
  if (!Number.isInteger(amount) || amount < 0) return "";
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2
  }).format(amount / 100)} application fee`;
}

export function normalizeVendorOffering(input = {}) {
  const amount = amountInCents(input.amount);
  const categories = stringList(input.categories, VENDOR_CATEGORIES.length, 40)
    .map(item => item.toLowerCase());
  return {
    id: text(input.id, 100).toLowerCase(),
    name: text(input.name, 120),
    amount,
    currency: text(input.currency || "usd", 3).toLowerCase(),
    publicLabel: text(input.publicLabel, 120) || defaultPublicLabel(amount),
    active: input.active !== false,
    requiresApproval: input.requiresApproval !== false,
    intakeMode: text(input.intakeMode || "application", 20).toLowerCase(),
    categories,
    description: text(input.description, 500),
    inclusions: stringList(input.inclusions, 20, 200),
    stripePriceId: optionalText(input.stripePriceId, 160),
    quickBooksItemId: optionalText(input.quickBooksItemId, 160)
  };
}

export function validateVendorOffering(input = {}) {
  const offering = normalizeVendorOffering(input);
  const errors = [];
  if (!IDENTIFIER.test(offering.id)) errors.push("Offering ID must use lowercase letters, numbers, and hyphens.");
  if (!offering.name) errors.push("Offering name is required.");
  if (!Number.isInteger(offering.amount) || offering.amount < 0 || offering.amount > 100_000_000) {
    errors.push("Offering amount must be whole cents between 0 and 100000000.");
  }
  if (offering.currency !== "usd") errors.push("Vendor offerings currently support USD only.");
  if (!offering.publicLabel) errors.push("Public fee label is required.");
  if (input.active !== undefined && typeof input.active !== "boolean") errors.push("Offering active state must be true or false.");
  if (input.requiresApproval !== undefined && typeof input.requiresApproval !== "boolean") errors.push("Offering approval state must be true or false.");
  if (!INTAKE_MODE_SET.has(offering.intakeMode)) errors.push("Vendor intake mode must be interest or application.");
  if (offering.intakeMode === "interest" && offering.amount !== 0) errors.push("Vendor interest offerings cannot create a financial obligation.");
  if (!offering.categories.length) errors.push("Choose at least one eligible vendor category.");
  const invalidCategories = offering.categories.filter(category => !CATEGORY_SET.has(category));
  if (invalidCategories.length) errors.push(`Unsupported vendor categories: ${invalidCategories.join(", ")}.`);
  if (!offering.description) errors.push("Public offering description is required.");
  if (!offering.inclusions.length) errors.push("Choose at least one offering inclusion.");
  if (offering.stripePriceId && (!STRIPE_PRICE_ID.test(offering.stripePriceId) || offering.stripePriceId.startsWith("price_replace"))) {
    errors.push("Stripe Price ID must be a non-placeholder price_ identifier.");
  }
  return { ok: errors.length === 0, errors, offering };
}

export function vendorOfferingCatalog(config = {}) {
  const source = Array.isArray(config.vendorOfferings)
    ? config.vendorOfferings
    : DEFAULT_VENDOR_OFFERINGS;
  const validations = source.map(validateVendorOffering);
  const offerings = validations.map(result => result.offering);
  const ids = offerings.map(item => item.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
  const activeOfferings = offerings.filter((item, index) => validations[index].ok && item.active);
  const coveredCategories = new Set(activeOfferings.flatMap(item => item.categories));
  const missingCategories = VENDOR_CATEGORIES.filter(category => !coveredCategories.has(category));
  const errors = validations.flatMap((result, index) => result.errors.map(error => `${offerings[index].id || `offering-${index + 1}`}: ${error}`));
  if (duplicateIds.length) errors.push(`Duplicate vendor offering IDs: ${duplicateIds.join(", ")}.`);
  if (!activeOfferings.length) errors.push("At least one active vendor offering is required.");
  if (missingCategories.length) errors.push(`Active offerings do not cover: ${missingCategories.join(", ")}.`);
  return {
    ready: errors.length === 0,
    source: Array.isArray(config.vendorOfferings) ? "config" : "defaults",
    offerings,
    activeOfferings,
    missingCategories,
    errors
  };
}

export function resolveVendorOffering(config, offeringIdInput, categoryInput) {
  const catalog = vendorOfferingCatalog(config);
  const offeringId = text(offeringIdInput, 100).toLowerCase();
  const category = text(categoryInput, 40).toLowerCase();
  if (!CATEGORY_SET.has(category)) return { ok: false, error: "Choose a supported vendor type." };
  const offering = catalog.activeOfferings.find(item => item.id === offeringId);
  if (!offering) return { ok: false, error: "Choose an active vendor offering." };
  if (!offering.categories.includes(category)) {
    return { ok: false, error: "The selected vendor offering is not available for this vendor type." };
  }
  return { ok: true, offering, catalog };
}

export function publicVendorOffering(input) {
  const offering = normalizeVendorOffering(input);
  return {
    id: offering.id,
    name: offering.name,
    amount: offering.amount,
    currency: offering.currency,
    publicLabel: offering.publicLabel,
    requiresApproval: offering.requiresApproval,
    intakeMode: offering.intakeMode,
    categories: offering.categories,
    description: offering.description,
    inclusions: offering.inclusions
  };
}

export function createVendorOfferingConfig(configInput = {}, input = {}) {
  const config = { ...configInput };
  const catalog = vendorOfferingCatalog(config);
  const candidate = validateVendorOffering(input);
  if (!candidate.ok) return { ok: false, error: candidate.errors.join(" "), errors: candidate.errors };
  const existing = catalog.offerings.find(item => item.id === candidate.offering.id);
  if (existing && JSON.stringify(existing) === JSON.stringify(candidate.offering)) {
    return {
      ok: true,
      replay: true,
      offering: existing,
      config,
      catalog
    };
  }
  if (existing) {
    return { ok: false, conflict: true, error: "Vendor offering already exists." };
  }
  const vendorOfferings = [...catalog.offerings, candidate.offering];
  const nextCatalog = vendorOfferingCatalog({ ...config, vendorOfferings });
  if (!nextCatalog.ready) {
    return { ok: false, error: nextCatalog.errors.join(" "), errors: nextCatalog.errors };
  }
  return {
    ok: true,
    replay: false,
    offering: candidate.offering,
    config: { ...config, vendorOfferings },
    catalog: nextCatalog
  };
}

export function updateVendorOfferingConfig(configInput = {}, offeringId, patch = {}) {
  const config = { ...configInput };
  const catalog = vendorOfferingCatalog(config);
  const index = catalog.offerings.findIndex(item => item.id === text(offeringId, 100).toLowerCase());
  if (index < 0) return { ok: false, error: "Vendor offering not found." };
  const candidate = validateVendorOffering({ ...catalog.offerings[index], ...patch, id: catalog.offerings[index].id });
  if (!candidate.ok) return { ok: false, error: candidate.errors.join(" "), errors: candidate.errors };
  const vendorOfferings = catalog.offerings.slice();
  vendorOfferings[index] = candidate.offering;
  const nextCatalog = vendorOfferingCatalog({ ...config, vendorOfferings });
  if (!nextCatalog.ready) {
    return { ok: false, error: nextCatalog.errors.join(" "), errors: nextCatalog.errors };
  }
  return {
    ok: true,
    before: catalog.offerings[index],
    offering: candidate.offering,
    config: { ...config, vendorOfferings },
    catalog: nextCatalog
  };
}

const APPLICATION_TYPES = new Set(["vendor", "sponsor"]);
const APPLICATION_STATUSES = new Set([
  "submitted", "under_review", "approved", "contracted", "invoiced",
  "partial", "paid", "active", "complete", "rejected", "withdrawn"
]);
const TASK_STATUSES = new Set(["open", "in_progress", "blocked", "done", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const TASK_ASSIGNMENT_TYPES = new Set(["unassigned", "staff", "volunteer", "team"]);
const BRAND_PROFILE_STATUSES = new Set(["draft", "submitted", "approved", "changes_requested"]);
const BRAND_ASSET_KINDS = new Set(["primary_logo", "alternate_logo", "brand_guidelines", "ad_creative", "event_photo", "other"]);
const BRAND_ASSET_STATUSES = new Set(["submitted", "under_review", "approved", "changes_requested", "rejected", "archived"]);
const DELIVERABLE_STATUSES = new Set(["planned", "awaiting_assets", "ready", "in_production", "scheduled", "published", "complete", "cancelled"]);
const PARTNER_REVIEW_STATUSES = new Set(["not_ready", "pending", "approved", "changes_requested"]);
const VENDOR_PROFILE_STATUSES = new Set(["draft", "submitted", "approved", "changes_requested"]);
const VENDOR_REQUIREMENT_STATUSES = new Set(["missing", "submitted", "under_review", "approved", "changes_requested", "waived", "expired"]);
const VENDOR_DOCUMENT_STATUSES = new Set(["submitted", "approved", "changes_requested", "superseded", "archived"]);
const VENDOR_ASSIGNMENT_STATUSES = new Set(["unassigned", "scheduled", "confirmed", "checked_in", "complete", "cancelled"]);
const VENDOR_POWER_NEEDS = new Set(["none", "15a", "20a", "30a", "50a"]);
const VENDOR_COOKING_METHODS = new Set(["none", "electric", "propane", "other"]);
const FOLLOWUP_STATUSES = new Set(["pending", "draft_ready", "approved", "queued", "sending", "sent", "dismissed", "failed"]);
const PARTNER_AUTOMATION_MODES = new Set(["review_first", "transactional_auto"]);
export const PARTNER_TRANSACTIONAL_AUTOMATION_POLICY = "partner_transactional_v1";
export const PARTNER_TRANSACTIONAL_FOLLOWUP_KINDS = Object.freeze([
  "application_received",
  "milestone_reminder",
  "vendor_profile_changes",
  "vendor_requirement_changes",
  "vendor_assignment_ready",
  "vendor_assignment_cancelled",
  "task_assignment",
  "task_overdue"
]);
const PARTNER_TRANSACTIONAL_FOLLOWUP_KIND_SET = new Set(PARTNER_TRANSACTIONAL_FOLLOWUP_KINDS);
const MILESTONE_STATUSES = new Set(["open", "completed", "cancelled"]);
const MILESTONE_TEAMS = new Set(["operations", "sponsor", "finance", "volunteer-captains", "traffic", "guest-services", "production"]);
const INVOICE_STATUSES = new Set(["draft", "approved", "queued", "synced", "failed", "voided"]);
const PAYMENT_INPUT_STATUSES = new Set(["succeeded", "pending", "failed"]);
const PAYMENT_METHODS = new Set(["manual", "check", "cash", "ach", "card", "stripe", "eventeny", "quickbooks", "bank_transfer", "other"]);
const PAYMENT_CHECKOUT_STATUSES = new Set(["creating", "open", "completed", "expired", "failed", "reconciliation_required"]);
const PROSPECT_STATUSES = new Set(["identified", "researching", "qualified", "contact_ready", "contacted", "engaged", "won", "lost", "do_not_contact"]);
const CAMPAIGN_STATUSES = new Set(["draft", "active", "paused", "complete", "archived"]);
const OUTREACH_CAMPAIGN_DELIVERY_MODES = new Set(["review_first", "approved_sequence"]);
export const OUTREACH_CAMPAIGN_AUTOMATION_POLICY = "outreach_campaign_v1";
const CONTACT_BASES = new Set(["inbound_request", "existing_relationship", "event_partner", "business_relevance", "referral"]);
const OUTREACH_ELIGIBLE_STATUSES = new Set(["qualified", "contact_ready", "contacted", "engaged"]);
const TEMPLATE_FIELDS = new Set(["organization", "contactName", "city", "state", "industry"]);
const SANDFEST_LOCATION = { latitude: 27.8339, longitude: -97.0611 };
const EARTH_RADIUS_MILES = 3958.8;

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function email(value) {
  const normalized = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function phone(value) {
  return text(value, 40).replace(/[^\d+() .-]/g, "");
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function iso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function httpsUrl(value, label = "URL", { required = false } = {}) {
  const candidate = text(value, 1000);
  if (!candidate) return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: null };
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe URL");
    parsed.hash = "";
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: `${label} must be a secure https:// URL.` };
  }
}

function color(value) {
  const candidate = text(value, 7).toUpperCase();
  return !candidate || /^#[0-9A-F]{6}$/.test(candidate) ? candidate || null : false;
}

function optionalDateTime(value, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || String(value).trim() === "") return { ok: true, value: null };
  const parsed = iso(value);
  return parsed ? { ok: true, value: parsed } : { ok: false, error: `${label} must be a valid date and time.` };
}

function taskDueAt(value) {
  return optionalDateTime(value, "Task due date");
}

function outreachNextActionAt(value) {
  return optionalDateTime(value, "Outreach follow-up date");
}

function taskAssignment(input = {}, current = {}) {
  const suppliedType = input.assigneeType === undefined ? current.assigneeType : text(input.assigneeType, 20).toLowerCase();
  const fallbackType = suppliedType || (input.assigneeId || current.assigneeId ? "staff" : input.assigneeRole || current.assigneeRole ? "team" : "unassigned");
  if (!TASK_ASSIGNMENT_TYPES.has(fallbackType)) return { ok: false, error: "Choose staff, volunteer, team, or unassigned." };
  if (fallbackType === "unassigned") {
    return { ok: true, assigneeType: "unassigned", assigneeId: null, assigneeName: null, assigneeRole: null };
  }
  const rawAssigneeId = input.assigneeId === undefined ? text(current.assigneeId, 100) : text(input.assigneeId, 100);
  const assigneeName = input.assigneeName === undefined ? text(current.assigneeName, 120) : text(input.assigneeName, 120);
  const assigneeRole = input.assigneeRole === undefined ? text(current.assigneeRole, 100) : text(input.assigneeRole, 100);
  const assigneeId = rawAssigneeId || (fallbackType === "team" ? assigneeRole : "");
  if (!assigneeId && !assigneeName) return { ok: false, error: "Choose an assignee for this task." };
  return {
    ok: true,
    assigneeType: fallbackType,
    assigneeId: assigneeId || null,
    assigneeName: assigneeName || assigneeId || null,
    assigneeRole: assigneeRole || null
  };
}

function calendarDay(value, timeZone = "America/Chicago") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function list(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.map(item => text(item, 160)).filter(Boolean).slice(0, max);
}

function optionalNumber(value, current = null) {
  if (value === undefined) return current == null ? null : Number(current);
  if (value === null || String(value).trim() === "") return null;
  return Number(value);
}

function outreachPostalCode(value, current = "") {
  const candidate = value === undefined ? text(current, 20).toUpperCase() : text(value, 20).toUpperCase();
  if (candidate && !/^\d{5}(?:-\d{4})?$/.test(candidate)) {
    return { ok: false, error: "Postal code must be a five-digit ZIP or ZIP+4." };
  }
  return { ok: true, value: candidate };
}

function outreachLocation(input = {}, current = {}) {
  const postalCode = outreachPostalCode(input.postalCode, current.postalCode);
  if (!postalCode.ok) return postalCode;
  const latitude = optionalNumber(input.latitude, current.latitude);
  const longitude = optionalNumber(input.longitude, current.longitude);
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }
  if ((latitude === null) !== (longitude === null)) {
    return { ok: false, error: "Latitude and longitude must be provided together." };
  }
  return {
    ok: true,
    city: input.city === undefined ? text(current.city, 100) : text(input.city, 100),
    state: input.state === undefined ? text(current.state, 40) : text(input.state, 40),
    postalCode: postalCode.value,
    latitude,
    longitude
  };
}

export function outreachDistanceMiles(latitudeA, longitudeA, latitudeB, longitudeB) {
  const source = [latitudeA, longitudeA, latitudeB, longitudeB];
  if (source.some(value => value === null || value === undefined || String(value).trim() === "")) return null;
  const coordinates = source.map(Number);
  if (!coordinates.every(Number.isFinite)) return null;
  const [latA, lngA, latB, lngB] = coordinates;
  if (Math.abs(latA) > 90 || Math.abs(latB) > 90 || Math.abs(lngA) > 180 || Math.abs(lngB) > 180) return null;
  const radians = value => value * Math.PI / 180;
  const latitudeDelta = radians(latB - latA);
  const longitudeDelta = radians(lngB - lngA);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function outreachFit(input, options = {}) {
  const geography = [text(input.city, 100), text(input.state, 40), text(input.postalCode, 20)].filter(Boolean).join(" ").toLowerCase();
  const industry = text(input.industry, 100).toLowerCase();
  const geoTargets = list(options.geoTargets ?? ["port aransas", "corpus christi", "rockport", "south texas"]);
  const industryTargets = list(options.industryTargets ?? ["hospitality", "banking", "real estate", "construction", "tourism", "food", "beverage"]);
  const coordinatesDistance = outreachDistanceMiles(input.latitude, input.longitude, SANDFEST_LOCATION.latitude, SANDFEST_LOCATION.longitude);
  const reasons = [];
  if (geoTargets.some(target => geography.includes(target.toLowerCase())) || (coordinatesDistance !== null && coordinatesDistance <= 100)) reasons.push("target geography");
  if (industryTargets.some(target => industry.includes(target.toLowerCase()))) reasons.push("target industry");
  if (input.communityFit === true) reasons.push("community fit");
  return {
    fitScore: Math.min(100, reasons.length * 30 + (input.contactEmail ? 10 : 0)),
    fitReasons: reasons
  };
}

function campaignGeofence(targeting = {}) {
  const source = targeting.geofence && typeof targeting.geofence === "object"
    ? targeting.geofence
    : {
        latitude: targeting.centerLatitude,
        longitude: targeting.centerLongitude,
        radiusMiles: targeting.radiusMiles
      };
  const latitude = optionalNumber(source.latitude);
  const longitude = optionalNumber(source.longitude);
  const radiusMiles = optionalNumber(source.radiusMiles);
  if (latitude === null && longitude === null && radiusMiles === null) return { ok: true, value: null };
  if (latitude === null || longitude === null || radiusMiles === null) {
    return { ok: false, error: "Campaign radius targeting requires center latitude, center longitude, and radius miles." };
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { ok: false, error: "Campaign center latitude must be between -90 and 90." };
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { ok: false, error: "Campaign center longitude must be between -180 and 180." };
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 500) return { ok: false, error: "Campaign radius must be greater than 0 and no more than 500 miles." };
  return { ok: true, value: { latitude, longitude, radiusMiles } };
}

function cleanId(value, prefix = "record") {
  const clean = text(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return clean || `${prefix}-${Date.now()}`;
}

export function emptyPartnerOperations(eventId = DEFAULT_EVENT_ID) {
  return {
    schemaVersion: 1,
    eventId,
    lastUpdated: null,
    automationMode: "review_first",
    applications: [],
    payments: [],
    paymentCheckouts: [],
    invoices: [],
    milestones: [],
    followups: [],
    tasks: [],
    brandProfiles: [],
    brandAssets: [],
    deliverables: [],
    vendorProfiles: [],
    vendorRequirements: [],
    vendorDocuments: [],
    vendorAssignments: [],
    prospects: [],
    campaigns: [],
    activity: []
  };
}

function normalizeOutreachCampaign(item) {
  const campaign = item && typeof item === "object" ? item : {};
  return {
    ...campaign,
    deliveryMode: OUTREACH_CAMPAIGN_DELIVERY_MODES.has(campaign.deliveryMode) ? campaign.deliveryMode : "review_first",
    dailySendLimit: Math.max(1, Math.min(100, Math.round(Number(campaign.dailySendLimit) || 25)))
  };
}

export function normalizePartnerOperations(input) {
  const base = input && typeof input === "object" ? input : {};
  const automationMode = base.automationMode === "enabled"
    ? "transactional_auto"
    : PARTNER_AUTOMATION_MODES.has(base.automationMode) ? base.automationMode : "review_first";
  return {
    ...emptyPartnerOperations(),
    ...base,
    applications: Array.isArray(base.applications) ? base.applications : [],
    payments: Array.isArray(base.payments) ? base.payments : [],
    paymentCheckouts: Array.isArray(base.paymentCheckouts) ? base.paymentCheckouts.map(item => ({
      ...item,
      status: PAYMENT_CHECKOUT_STATUSES.has(item?.status) ? item.status : "reconciliation_required"
    })) : [],
    invoices: Array.isArray(base.invoices) ? base.invoices : [],
    milestones: Array.isArray(base.milestones) ? base.milestones : [],
    followups: Array.isArray(base.followups) ? base.followups : [],
    tasks: Array.isArray(base.tasks) ? base.tasks : [],
    brandProfiles: Array.isArray(base.brandProfiles) ? base.brandProfiles : [],
    brandAssets: Array.isArray(base.brandAssets) ? base.brandAssets : [],
    deliverables: Array.isArray(base.deliverables) ? base.deliverables : [],
    vendorProfiles: Array.isArray(base.vendorProfiles) ? base.vendorProfiles : [],
    vendorRequirements: Array.isArray(base.vendorRequirements) ? base.vendorRequirements : [],
    vendorDocuments: Array.isArray(base.vendorDocuments) ? base.vendorDocuments : [],
    vendorAssignments: Array.isArray(base.vendorAssignments) ? base.vendorAssignments : [],
    prospects: Array.isArray(base.prospects) ? base.prospects : [],
    campaigns: Array.isArray(base.campaigns) ? base.campaigns.map(normalizeOutreachCampaign) : [],
    activity: Array.isArray(base.activity) ? base.activity.slice(-1000) : [],
    automationMode
  };
}

function activity(idFactory, type, entityType, entityId, at, actorId, detail = {}) {
  return { id: idFactory("activity"), type, entityType, entityId, at, actorId, detail };
}

function milestone(idFactory, applicationId, label, dueAt, at, assigneeTeam = "operations", metadata = {}) {
  return {
    id: idFactory("milestone"), applicationId, label, dueAt, status: "open",
    assigneeTeam,
    source: text(metadata.source, 40) || "application_intake",
    kind: text(metadata.kind, 40) || null,
    reminderLeadDays: 3,
    scheduleVersion: 1,
    notes: "",
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    createdAt: at,
    updatedAt: at
  };
}

function defaultDueDates(type, at) {
  const base = new Date(at);
  const addDays = days => new Date(base.getTime() + days * 86_400_000).toISOString();
  return type === "vendor"
    ? [
        ["Review application", addDays(3), "application_review", "operations"],
        ["Collect documents", addDays(14), "document_collection", "operations"],
        ["Payment due", addDays(30), "payment_due", "finance"]
      ]
    : [
        ["Qualify opportunity", addDays(2), "opportunity_qualification", "sponsor"],
        ["Confirm package", addDays(10), "package_confirmation", "sponsor"],
        ["Artwork due", addDays(30), "artwork_due", "sponsor"],
        ["Payment due", addDays(30), "payment_due", "finance"]
      ];
}

function vendorRequirementTemplates(category) {
  const universal = [
    ["vendor_agreement", "Signed vendor agreement"],
    ["w9", "IRS Form W-9"],
    ["insurance", "Certificate of insurance"]
  ];
  const categoryRequirements = {
    food: [
      ["health_permit", "Health department permit"],
      ["food_handler_certificates", "Food handler certificates"],
      ["fire_safety", "Cooking and fire safety plan"],
      ["menu", "Menu and public pricing"]
    ],
    retail: [["sales_tax_permit", "Texas sales tax permit"], ["product_catalog", "Product catalog or booth photos"]],
    artisan: [["sales_tax_permit", "Texas sales tax permit"], ["product_catalog", "Product catalog or booth photos"]],
    service: [["service_scope", "Service description and operating plan"]],
    nonprofit: [["nonprofit_verification", "Nonprofit verification"]]
  };
  return [...universal, ...(categoryRequirements[category] || [["operating_plan", "Vendor operating plan"]])];
}

export function createPartnerApplication(docInput, input, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const type = text(input?.type, 20).toLowerCase();
  const intakeIdempotencyKeyHash = text(options.idempotencyKeyHash, 64).toLowerCase();
  const intakeFingerprint = text(options.idempotencyFingerprint, 64).toLowerCase();
  if (intakeIdempotencyKeyHash || intakeFingerprint) {
    if (!/^[a-f0-9]{64}$/.test(intakeIdempotencyKeyHash) || !/^[a-f0-9]{64}$/.test(intakeFingerprint)) {
      return { ok: false, error: "Application idempotency metadata is invalid." };
    }
    const existing = doc.applications.find(item => item.intakeIdempotencyKeyHash === intakeIdempotencyKeyHash);
    if (existing) {
      if (existing.intakeFingerprint !== intakeFingerprint) {
        return {
          ok: false,
          conflict: true,
          error: "This submission key was already used with different application details."
        };
      }
      return {
        ok: true,
        changed: false,
        duplicate: true,
        application: existing,
        followup: doc.followups.find(item => item.applicationId === existing.id && item.kind === "application_received") ?? null,
        doc
      };
    }
  }
  const contactEmail = email(input?.contactEmail);
  const organizationName = text(input?.organizationName, 160);
  const contactName = text(input?.contactName, 120);
  if (!APPLICATION_TYPES.has(type)) return { ok: false, error: "Choose vendor or sponsor." };
  if (!organizationName) return { ok: false, error: "Organization name is required." };
  if (!contactName) return { ok: false, error: "Contact name is required." };
  if (!contactEmail) return { ok: false, error: "A valid contact email is required." };
  if (input?.website && !/^https?:\/\//i.test(text(input.website, 500))) {
    return { ok: false, error: "Website must begin with http:// or https://." };
  }

  const id = idFactory(type === "vendor" ? "vapp" : "sapp");
  const portalAccessIdFactory = options.portalAccessIdFactory ?? (() => crypto.randomUUID());
  const application = {
    id,
    eventId: options.eventId || doc.eventId || DEFAULT_EVENT_ID,
    reference: `TSF-${type === "vendor" ? "V" : "S"}-${id.replace(/\D/g, "").slice(-6).padStart(6, "0")}`,
    type,
    status: "submitted",
    organizationName,
    contactName,
    contactEmail,
    contactPhone: phone(input?.contactPhone),
    website: text(input?.website, 500),
    city: text(input?.city, 100),
    state: text(input?.state, 40),
    postalCode: text(input?.postalCode, 20),
    category: text(input?.category, 100),
    description: text(input?.description, 2000),
    packageId: text(input?.packageId, 100) || null,
    packageName: text(input?.packageName, 120) || null,
    offeringId: text(input?.offeringId, 100) || null,
    offeringName: text(input?.offeringName, 120) || null,
    outreachProspectId: text(input?.outreachProspectId, 120) || null,
    requestedAmountCents: cents(input?.requestedAmountCents),
    expectedAmountCents: cents(input?.expectedAmountCents),
    tags: list(input?.tags),
    source: text(input?.source, 80) || "website",
    sourceBatch: text(input?.sourceBatch, 120) || null,
    sourceRef: text(input?.sourceRef, 300) || null,
    sourceRow: Number.isSafeInteger(Number(input?.sourceRow)) && Number(input.sourceRow) > 0 ? Number(input.sourceRow) : null,
    sourceStatus: text(input?.sourceStatus, 100) || null,
    sourceReportedAmountCents: cents(input?.sourceReportedAmountCents),
    consentToContact: input?.consentToContact === true,
    contactPermissionBasis: text(input?.contactPermissionBasis, 100) || null,
    contactPermissionConfirmedAt: iso(input?.contactPermissionConfirmedAt),
    contactPermissionConfirmedBy: text(input?.contactPermissionConfirmedBy, 120) || null,
    portalAccessId: portalAccessIdFactory(),
    portalAccessVersion: 1,
    portalAccessIssuedAt: now,
    intakeIdempotencyKeyHash: intakeIdempotencyKeyHash || null,
    intakeFingerprint: intakeFingerprint || null,
    ownerId: null,
    createdAt: now,
    updatedAt: now
  };
  if (!application.consentToContact) return { ok: false, error: "Consent to contact is required to submit." };

  const dueDates = defaultDueDates(type, now).map(([label, dueAt, kind, assigneeTeam]) => milestone(
    idFactory,
    id,
    label,
    dueAt,
    now,
    assigneeTeam,
    { source: "application_intake", kind }
  ));
  const task = {
    id: idFactory("task"), title: `Review ${organizationName} ${type} application`,
    description: `Review ${application.reference} and assign an owner.`, status: "open", priority: "high",
    assigneeType: "team",
    assigneeId: type === "sponsor" ? "sponsor" : "operations",
    assigneeName: type === "sponsor" ? "Sponsor team" : "Operations team",
    assigneeRole: type === "sponsor" ? "sponsor_admin" : "ops_admin",
    relatedEntityType: "application", relatedEntityId: id, dueAt: dueDates[0].dueAt,
    createdAt: now, updatedAt: now, completedAt: null
  };
  const followup = options.createAcknowledgment === false ? null : {
    id: idFactory("followup"), applicationId: id, kind: "application_received",
    channel: "email", recipient: contactEmail, status: "pending", dueAt: now,
    subject: "", body: "", approvedBy: null, approvedAt: null, sentAt: null,
    queuedAt: null, provider: null, providerMessageId: null, deliveryAttempts: 0,
    lastAttemptAt: null, lastError: null, createdAt: now, updatedAt: now
  };
  const packageBenefits = type === "sponsor" ? list(input?.packageBenefits, 20) : [];
  const brandProfile = type === "sponsor" ? {
    id: idFactory("brand"),
    applicationId: id,
    displayName: organizationName,
    website: application.website || null,
    tagline: "",
    primaryColor: null,
    secondaryColor: null,
    instagramUrl: null,
    linkedinUrl: null,
    usageNotes: "",
    status: "draft",
    reviewNotes: "",
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: now,
    updatedAt: now
  } : null;
  const deliverables = packageBenefits.map(label => ({
    id: idFactory("deliverable"),
    applicationId: id,
    packageId: application.packageId,
    source: "package_benefit",
    label,
    description: "",
    status: "planned",
    ownerId: null,
    dueAt: null,
    proofUrl: null,
    proofNotes: "",
    proofVersion: 0,
    partnerReviewStatus: "not_ready",
    partnerReviewNotes: "",
    partnerReviewedAt: null,
    createdAt: now,
    updatedAt: now
  }));
  const vendorDocumentDueAt = dueDates.find(item => item.label === "Collect documents")?.dueAt ?? null;
  const vendorProfile = type === "vendor" ? {
    id: idFactory("vendor_profile"),
    applicationId: id,
    legalName: organizationName,
    boothName: organizationName,
    website: application.website || null,
    publicDescription: application.description,
    emergencyContactName: contactName,
    emergencyContactPhone: application.contactPhone,
    powerNeed: "none",
    waterRequired: false,
    cookingMethod: "none",
    vehicleLengthFeet: null,
    accessibilityNotes: "",
    operationalNotes: "",
    status: "draft",
    revision: 0,
    reviewNotes: "",
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: now,
    updatedAt: now
  } : null;
  const vendorRequirements = type === "vendor" ? vendorRequirementTemplates(application.category).map(([code, label]) => ({
    id: idFactory("vendor_requirement"),
    applicationId: id,
    code,
    label,
    required: true,
    status: "missing",
    dueAt: vendorDocumentDueAt,
    currentDocumentId: null,
    reviewNotes: "",
    expiresAt: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now
  })) : [];
  const vendorAssignment = type === "vendor" ? {
    id: idFactory("vendor_assignment"),
    applicationId: id,
    status: "unassigned",
    scheduleVersion: 0,
    boothNumber: null,
    zone: null,
    accessGate: null,
    loadInStart: null,
    loadInEnd: null,
    loadOutStart: null,
    loadOutEnd: null,
    parkingPasses: 0,
    staffWristbands: 0,
    instructions: "",
    partnerConfirmedAt: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now
  } : null;
  const next = {
    ...doc,
    lastUpdated: now,
    applications: [...doc.applications, application],
    milestones: [...doc.milestones, ...dueDates],
    tasks: [...doc.tasks, task],
    brandProfiles: brandProfile ? [...doc.brandProfiles, brandProfile] : doc.brandProfiles,
    deliverables: [...doc.deliverables, ...deliverables],
    vendorProfiles: vendorProfile ? [...doc.vendorProfiles, vendorProfile] : doc.vendorProfiles,
    vendorRequirements: [...doc.vendorRequirements, ...vendorRequirements],
    vendorAssignments: vendorAssignment ? [...doc.vendorAssignments, vendorAssignment] : doc.vendorAssignments,
    followups: followup ? [...doc.followups, followup] : doc.followups,
    activity: [...doc.activity, activity(idFactory, "application.created", "application", id, now, options.actorId ?? "public", { type })].slice(-1000)
  };
  return { ok: true, doc: next, application, task, followup, milestones: dueDates, brandProfile, deliverables, vendorProfile, vendorRequirements, vendorAssignment };
}

export function rotatePartnerPortalAccess(docInput, applicationId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.applications.findIndex(item => item.id === applicationId);
  if (index < 0) return { ok: false, error: "Application not found." };
  if (doc.followups.some(item => item.applicationId === applicationId && item.status === "sending")) {
    return { ok: false, error: "A portal message is currently being sent. Wait for delivery to finish before rotating access." };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const portalAccessIdFactory = options.portalAccessIdFactory ?? (() => crypto.randomUUID());
  const application = {
    ...doc.applications[index],
    portalAccessId: portalAccessIdFactory(),
    portalAccessVersion: Number(doc.applications[index].portalAccessVersion || 0) + 1,
    portalAccessIssuedAt: now,
    updatedAt: now
  };
  const applications = doc.applications.slice();
  applications[index] = application;
  const portalUrl = typeof options.portalUrlForApplication === "function"
    ? text(options.portalUrlForApplication(application), 1000)
    : "";
  let refreshedFollowups = 0;
  const followups = doc.followups.map(item => {
    if (item.applicationId !== applicationId || !portalUrl || !item.portalUrl || ["sending", "sent", "dismissed"].includes(item.status)) return item;
    if (item.status === "queued") {
      refreshedFollowups += 1;
      return {
        ...item,
        status: "dismissed",
        lastError: "Portal access rotated before delivery; generate and review a replacement draft.",
        updatedAt: now
      };
    }
    if (!item.body?.includes(item.portalUrl)) return item;
    refreshedFollowups += 1;
    return {
      ...item,
      body: item.body.split(item.portalUrl).join(portalUrl),
      portalUrl,
      status: item.status === "approved" ? "draft_ready" : item.status,
      approvedBy: item.status === "approved" ? null : item.approvedBy,
      approvedAt: item.status === "approved" ? null : item.approvedAt,
      updatedAt: now
    };
  });
  return {
    ok: true,
    changed: true,
    duplicate: false,
    application,
    refreshedFollowups,
    doc: {
      ...doc,
      lastUpdated: now,
      applications,
      followups,
      activity: [...doc.activity, activity(idFactory, "application.portal_access_rotated", "application", applicationId, now, options.actorId ?? "admin", { refreshedFollowups })].slice(-1000)
    }
  };
}

export function updatePartnerApplication(docInput, applicationId, patch, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const index = doc.applications.findIndex(item => item.id === applicationId);
  if (index < 0) return { ok: false, error: "Application not found." };
  const current = doc.applications[index];
  const status = patch.status == null ? current.status : text(patch.status, 40);
  if (!APPLICATION_STATUSES.has(status)) return { ok: false, error: "Invalid application status." };
  const application = {
    ...current,
    status,
    ownerId: patch.ownerId === undefined ? current.ownerId : text(patch.ownerId, 100) || null,
    expectedAmountCents: patch.expectedAmountCents === undefined ? current.expectedAmountCents : cents(patch.expectedAmountCents),
    packageId: patch.packageId === undefined ? current.packageId : text(patch.packageId, 100) || null,
    tags: patch.tags === undefined ? current.tags : list(patch.tags),
    updatedAt: now
  };
  const applications = doc.applications.slice();
  applications[index] = application;
  return {
    ok: true,
    application,
    doc: {
      ...doc, lastUpdated: now, applications,
      activity: [...doc.activity, activity(idFactory, "application.updated", "application", applicationId, now, options.actorId ?? "admin", { status })].slice(-1000)
    }
  };
}

function sponsorApplication(doc, applicationId) {
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  if (application.type !== "sponsor") return { ok: false, error: "Brand fulfillment is available for sponsor applications." };
  return { ok: true, application };
}

export function updatePartnerBrandProfile(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const sponsor = sponsorApplication(doc, applicationId);
  if (!sponsor.ok) return sponsor;
  const displayName = text(input.displayName, 160);
  if (!displayName) return { ok: false, error: "Sponsor display name is required." };
  const website = httpsUrl(input.website, "Sponsor website");
  const instagramUrl = httpsUrl(input.instagramUrl, "Instagram URL");
  const linkedinUrl = httpsUrl(input.linkedinUrl, "LinkedIn URL");
  if (!website.ok) return website;
  if (!instagramUrl.ok) return instagramUrl;
  if (!linkedinUrl.ok) return linkedinUrl;
  const primaryColor = color(input.primaryColor);
  const secondaryColor = color(input.secondaryColor);
  if (primaryColor === false || secondaryColor === false) return { ok: false, error: "Brand colors must use six-digit hex values such as #005B63." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const index = doc.brandProfiles.findIndex(item => item.applicationId === applicationId);
  const current = index >= 0 ? doc.brandProfiles[index] : null;
  const profile = {
    id: current?.id ?? idFactory("brand"),
    applicationId,
    displayName,
    website: website.value,
    tagline: text(input.tagline, 240),
    primaryColor,
    secondaryColor,
    instagramUrl: instagramUrl.value,
    linkedinUrl: linkedinUrl.value,
    usageNotes: text(input.usageNotes, 2000),
    status: "submitted",
    reviewNotes: "",
    submittedAt: now,
    approvedAt: null,
    approvedBy: null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };
  const brandProfiles = doc.brandProfiles.slice();
  if (index >= 0) brandProfiles[index] = profile;
  else brandProfiles.push(profile);
  return {
    ok: true,
    profile,
    doc: {
      ...doc,
      lastUpdated: now,
      brandProfiles,
      activity: [...doc.activity, activity(idFactory, "brand.profile_submitted", "application", applicationId, now, options.actorId ?? "partner", { profileId: profile.id })].slice(-1000)
    }
  };
}

export function reviewPartnerBrandProfile(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.brandProfiles.findIndex(item => item.applicationId === applicationId);
  if (index < 0) return { ok: false, error: "Brand profile not found." };
  const action = text(input.action, 40).toLowerCase();
  const status = action === "approve" ? "approved" : action === "request_changes" ? "changes_requested" : "";
  if (!BRAND_PROFILE_STATUSES.has(status)) return { ok: false, error: "Action must be approve or request_changes." };
  const reviewNotes = text(input.reviewNotes, 1000);
  if (status === "changes_requested" && !reviewNotes) return { ok: false, error: "Explain the requested brand profile changes." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const profile = {
    ...doc.brandProfiles[index],
    status,
    reviewNotes,
    approvedAt: status === "approved" ? now : null,
    approvedBy: status === "approved" ? options.actorId ?? "admin" : null,
    updatedAt: now
  };
  const brandProfiles = doc.brandProfiles.slice();
  brandProfiles[index] = profile;
  return {
    ok: true,
    profile,
    doc: {
      ...doc,
      lastUpdated: now,
      brandProfiles,
      activity: [...doc.activity, activity(idFactory, `brand.profile_${status}`, "application", applicationId, now, options.actorId ?? "admin", { profileId: profile.id })].slice(-1000)
    }
  };
}

export function createPartnerBrandAsset(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const sponsor = sponsorApplication(doc, applicationId);
  if (!sponsor.ok) return sponsor;
  const kind = text(input.kind, 40).toLowerCase();
  if (!BRAND_ASSET_KINDS.has(kind)) return { ok: false, error: "Choose a supported brand asset type." };
  const sourceType = input.storageKey ? "upload" : "external_url";
  const sourceUrl = sourceType === "external_url" ? httpsUrl(input.sourceUrl, "Asset URL", { required: true }) : { ok: true, value: null };
  if (!sourceUrl.ok) return sourceUrl;
  const storageKey = sourceType === "upload" ? text(input.storageKey, 500) : null;
  const checksumSha256 = sourceType === "upload" ? text(input.checksumSha256, 128).toLowerCase() : null;
  if (sourceType === "upload" && (!storageKey || !checksumSha256)) return { ok: false, error: "Uploaded asset storage metadata is incomplete." };
  const duplicate = doc.brandAssets.find(item => item.applicationId === applicationId && item.status !== "archived" && item.kind === kind && (
    sourceType === "upload" ? item.checksumSha256 === checksumSha256 : item.sourceUrl === sourceUrl.value
  ));
  if (duplicate) return { ok: true, duplicate: true, asset: duplicate, doc };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const asset = {
    id: text(input.id, 120) || idFactory("brand_asset"),
    applicationId,
    kind,
    label: text(input.label, 160) || text(input.fileName, 240) || kind.replace(/_/g, " "),
    sourceType,
    sourceUrl: sourceUrl.value,
    storageKey,
    fileName: text(input.fileName, 240) || null,
    contentType: text(input.contentType, 100) || null,
    sizeBytes: sourceType === "upload" ? Math.max(0, Math.round(Number(input.sizeBytes) || 0)) : null,
    checksumSha256,
    status: "submitted",
    reviewNotes: "",
    reviewedAt: null,
    reviewedBy: null,
    createdBy: options.actorId ?? "partner",
    createdAt: now,
    updatedAt: now
  };
  return {
    ok: true,
    duplicate: false,
    asset,
    doc: {
      ...doc,
      lastUpdated: now,
      brandAssets: [...doc.brandAssets, asset],
      activity: [...doc.activity, activity(idFactory, "brand.asset_submitted", "brand_asset", asset.id, now, options.actorId ?? "partner", { applicationId, kind, sourceType })].slice(-1000)
    }
  };
}

export function reviewPartnerBrandAsset(docInput, assetId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.brandAssets.findIndex(item => item.id === assetId);
  if (index < 0) return { ok: false, error: "Brand asset not found." };
  const status = text(input.status, 40).toLowerCase();
  if (!BRAND_ASSET_STATUSES.has(status) || status === "submitted") return { ok: false, error: "Choose under_review, approved, changes_requested, rejected, or archived." };
  const reviewNotes = text(input.reviewNotes, 1000);
  if (["changes_requested", "rejected"].includes(status) && !reviewNotes) return { ok: false, error: "Add a review note for requested changes or rejection." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const asset = {
    ...doc.brandAssets[index],
    status,
    reviewNotes,
    reviewedAt: now,
    reviewedBy: options.actorId ?? "admin",
    updatedAt: now
  };
  const brandAssets = doc.brandAssets.slice();
  brandAssets[index] = asset;
  return {
    ok: true,
    asset,
    doc: {
      ...doc,
      lastUpdated: now,
      brandAssets,
      activity: [...doc.activity, activity(idFactory, `brand.asset_${status}`, "brand_asset", assetId, now, options.actorId ?? "admin", { applicationId: asset.applicationId })].slice(-1000)
    }
  };
}

export function createPartnerDeliverable(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const sponsor = sponsorApplication(doc, applicationId);
  if (!sponsor.ok) return sponsor;
  const label = text(input.label, 160);
  if (!label) return { ok: false, error: "Deliverable label is required." };
  const due = taskDueAt(input.dueAt);
  if (!due.ok) return due;
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const deliverable = {
    id: idFactory("deliverable"),
    applicationId,
    packageId: sponsor.application.packageId,
    source: "custom",
    label,
    description: text(input.description, 1000),
    status: "planned",
    ownerId: text(input.ownerId, 100) || null,
    dueAt: due.value ?? null,
    proofUrl: null,
    proofNotes: "",
    proofVersion: 0,
    partnerReviewStatus: "not_ready",
    partnerReviewNotes: "",
    partnerReviewedAt: null,
    createdAt: now,
    updatedAt: now
  };
  return {
    ok: true,
    deliverable,
    doc: {
      ...doc,
      lastUpdated: now,
      deliverables: [...doc.deliverables, deliverable],
      activity: [...doc.activity, activity(idFactory, "deliverable.created", "deliverable", deliverable.id, now, options.actorId ?? "admin", { applicationId })].slice(-1000)
    }
  };
}

export function updatePartnerDeliverable(docInput, deliverableId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.deliverables.findIndex(item => item.id === deliverableId);
  if (index < 0) return { ok: false, error: "Deliverable not found." };
  const current = doc.deliverables[index];
  const status = input.status === undefined ? current.status : text(input.status, 40).toLowerCase();
  if (!DELIVERABLE_STATUSES.has(status)) return { ok: false, error: "Choose a valid deliverable status." };
  const due = taskDueAt(input.dueAt);
  if (!due.ok) return due;
  const proofUrl = input.proofUrl === undefined ? { ok: true, value: current.proofUrl } : httpsUrl(input.proofUrl, "Proof URL");
  if (!proofUrl.ok) return proofUrl;
  const proofNotes = input.proofNotes === undefined ? current.proofNotes : text(input.proofNotes, 1000);
  if (["published", "complete"].includes(status) && !proofUrl.value && !proofNotes) {
    return { ok: false, error: "Add a proof URL or proof note before publishing or completing a deliverable." };
  }
  const proofChanged = proofUrl.value !== current.proofUrl || proofNotes !== current.proofNotes;
  const hasProof = Boolean(proofUrl.value || proofNotes);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const deliverable = {
    ...current,
    label: input.label === undefined ? current.label : text(input.label, 160) || current.label,
    description: input.description === undefined ? current.description : text(input.description, 1000),
    status,
    ownerId: input.ownerId === undefined ? current.ownerId : text(input.ownerId, 100) || null,
    dueAt: due.value === undefined ? current.dueAt : due.value,
    proofUrl: proofUrl.value,
    proofNotes,
    proofVersion: proofChanged ? Number(current.proofVersion || 0) + 1 : Number(current.proofVersion || 0),
    partnerReviewStatus: proofChanged ? (hasProof ? "pending" : "not_ready") : current.partnerReviewStatus,
    partnerReviewNotes: proofChanged ? "" : current.partnerReviewNotes,
    partnerReviewedAt: proofChanged ? null : current.partnerReviewedAt,
    updatedAt: now,
    completedAt: status === "complete" ? current.completedAt || now : null
  };
  const deliverables = doc.deliverables.slice();
  deliverables[index] = deliverable;
  return {
    ok: true,
    deliverable,
    doc: {
      ...doc,
      lastUpdated: now,
      deliverables,
      activity: [...doc.activity, activity(idFactory, "deliverable.updated", "deliverable", deliverableId, now, options.actorId ?? "admin", { fromStatus: current.status, toStatus: status, proofVersion: deliverable.proofVersion })].slice(-1000)
    }
  };
}

export function reviewPartnerDeliverable(docInput, deliverableId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.deliverables.findIndex(item => item.id === deliverableId);
  if (index < 0) return { ok: false, error: "Deliverable not found." };
  const current = doc.deliverables[index];
  if (!current.proofVersion || (!current.proofUrl && !current.proofNotes)) return { ok: false, error: "This deliverable does not have proof ready for review." };
  const action = text(input.action, 40).toLowerCase();
  const partnerReviewStatus = action === "approve" ? "approved" : action === "request_changes" ? "changes_requested" : "";
  if (!PARTNER_REVIEW_STATUSES.has(partnerReviewStatus)) return { ok: false, error: "Action must be approve or request_changes." };
  const partnerReviewNotes = text(input.notes, 1000);
  if (partnerReviewStatus === "changes_requested" && !partnerReviewNotes) return { ok: false, error: "Explain the requested deliverable changes." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const deliverable = {
    ...current,
    partnerReviewStatus,
    partnerReviewNotes,
    partnerReviewedAt: now,
    updatedAt: now
  };
  const deliverables = doc.deliverables.slice();
  deliverables[index] = deliverable;
  return {
    ok: true,
    deliverable,
    doc: {
      ...doc,
      lastUpdated: now,
      deliverables,
      activity: [...doc.activity, activity(idFactory, `deliverable.partner_${partnerReviewStatus}`, "deliverable", deliverableId, now, options.actorId ?? "partner", { proofVersion: deliverable.proofVersion })].slice(-1000)
    }
  };
}

function vendorApplication(doc, applicationId) {
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  if (application.type !== "vendor") return { ok: false, error: "Vendor onboarding is available for vendor applications." };
  return { ok: true, application };
}

const ACTIVE_WORKFLOW_FOLLOWUP_STATUSES = new Set(["pending", "draft_ready", "approved", "queued", "sending", "failed"]);

function vendorWorkflowKey(kind, entityId) {
  return `${kind}:${entityId}`;
}

function dismissVendorWorkflowFollowups(doc, workflowKey, reason, options = {}) {
  const now = options.now ?? new Date().toISOString();
  let dismissed = 0;
  const followups = doc.followups.map(item => {
    if (item.workflowKey !== workflowKey || !ACTIVE_WORKFLOW_FOLLOWUP_STATUSES.has(item.status)) return item;
    if (item.status === "sending" && item.providerSubmissionStartedAt) return item;
    dismissed += 1;
    return {
      ...item,
      status: "dismissed",
      approvedBy: null,
      approvedAt: null,
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      providerSubmissionStartedAt: null,
      automationJobId: null,
      lastError: text(reason, 500) || "The vendor completed this workflow step before delivery.",
      updatedAt: now
    };
  });
  return dismissed ? { doc: { ...doc, lastUpdated: now, followups }, dismissed } : { doc, dismissed: 0 };
}

function upsertVendorWorkflowFollowup(doc, application, input, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const workflowKey = text(input.workflowKey, 240);
  const sourceVersion = text(input.sourceVersion, 500);
  const portalUrl = text(options.portalUrl, 1000);
  const portalCopy = portalUrl ? `\n\nReview the current status and respond here:\n${portalUrl}` : "";
  const subject = text(input.subject, 180);
  const body = `${text(input.body, 5000)}${portalCopy}`;
  const exact = [...doc.followups].reverse().find(item => item.workflowKey === workflowKey
    && item.sourceVersion === sourceVersion
    && item.subject === subject
    && item.body === body
    && item.status !== "dismissed");
  if (exact) return { ok: true, changed: false, followup: exact, doc };

  const activeSubmission = [...doc.followups].reverse().find(item => item.workflowKey === workflowKey
    && item.status === "sending"
    && item.providerSubmissionStartedAt);
  const followups = doc.followups.map(item => item.workflowKey === workflowKey
    && (item.status === "queued" || (item.status === "sending" && !item.providerSubmissionStartedAt))
    ? {
      ...item,
      status: "dismissed",
      approvedBy: null,
      approvedAt: null,
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      providerSubmissionStartedAt: null,
      automationJobId: null,
      lastError: "Workflow changed before delivery; review the replacement draft.",
      updatedAt: now
    }
    : item);
  let reusableIndex = -1;
  for (let index = followups.length - 1; index >= 0; index -= 1) {
    const item = followups[index];
    if (item.workflowKey === workflowKey && ["pending", "draft_ready", "approved", "failed"].includes(item.status)) {
      reusableIndex = index;
      break;
    }
  }
  const previous = reusableIndex >= 0 ? followups[reusableIndex] : null;
  const followup = {
    ...(previous || {}),
    id: previous?.id ?? idFactory("followup"),
    applicationId: application.id,
    kind: text(input.kind, 80),
    workflowKey,
    sourceVersion,
    channel: "email",
    recipient: application.contactEmail,
    status: activeSubmission ? "pending" : "draft_ready",
    blockedByFollowupId: activeSubmission?.id ?? null,
    dueAt: now,
    subject,
    body,
    portalUrl: portalUrl || null,
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    queuedAt: null,
    provider: null,
    providerMessageId: null,
    deliveryAttempts: 0,
    lastAttemptAt: null,
    lastError: activeSubmission ? "Waiting for the in-flight workflow notice to finish." : null,
    generatedAt: now,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  };
  if (reusableIndex >= 0) followups[reusableIndex] = followup;
  else followups.push(followup);
  return {
    ok: true,
    changed: true,
    followup,
    doc: {
      ...doc,
      lastUpdated: now,
      followups,
      activity: [...doc.activity, activity(idFactory, "followup.generated", "followup", followup.id, now, "automation", {
        applicationId: application.id,
        workflowKey,
        sourceVersion,
        blockedByFollowupId: followup.blockedByFollowupId
      })].slice(-1000)
    }
  };
}

function vendorLocalDateTime(value) {
  if (!value) return "not scheduled";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

export function updateVendorProfile(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const vendor = vendorApplication(doc, applicationId);
  if (!vendor.ok) return vendor;
  const legalName = text(input.legalName, 160);
  const boothName = text(input.boothName, 160);
  const publicDescription = text(input.publicDescription, 2000);
  const emergencyContactName = text(input.emergencyContactName, 120);
  const emergencyContactPhone = phone(input.emergencyContactPhone);
  if (!legalName || !boothName) return { ok: false, error: "Legal business name and public booth name are required." };
  if (!publicDescription) return { ok: false, error: "Add a public description of products or services." };
  if (!emergencyContactName || !emergencyContactPhone) return { ok: false, error: "Emergency contact name and phone are required." };
  const website = httpsUrl(input.website, "Vendor website");
  if (!website.ok) return website;
  const powerNeed = text(input.powerNeed, 20).toLowerCase() || "none";
  const cookingMethod = text(input.cookingMethod, 20).toLowerCase() || "none";
  if (!VENDOR_POWER_NEEDS.has(powerNeed)) return { ok: false, error: "Choose a supported electrical requirement." };
  if (!VENDOR_COOKING_METHODS.has(cookingMethod)) return { ok: false, error: "Choose a supported cooking method." };
  const rawVehicleLength = input.vehicleLengthFeet === null || String(input.vehicleLengthFeet ?? "").trim() === "" ? null : Number(input.vehicleLengthFeet);
  if (rawVehicleLength !== null && (!Number.isFinite(rawVehicleLength) || rawVehicleLength < 0 || rawVehicleLength > 80)) {
    return { ok: false, error: "Vehicle or trailer length must be between 0 and 80 feet." };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const index = doc.vendorProfiles.findIndex(item => item.applicationId === applicationId);
  const current = index >= 0 ? doc.vendorProfiles[index] : null;
  const profile = {
    id: current?.id ?? idFactory("vendor_profile"),
    applicationId,
    legalName,
    boothName,
    website: website.value,
    publicDescription,
    emergencyContactName,
    emergencyContactPhone,
    powerNeed,
    waterRequired: input.waterRequired === true || input.waterRequired === "true" || input.waterRequired === "on",
    cookingMethod,
    vehicleLengthFeet: rawVehicleLength === null ? null : Math.round(rawVehicleLength * 10) / 10,
    accessibilityNotes: text(input.accessibilityNotes, 1000),
    operationalNotes: text(input.operationalNotes, 2000),
    status: "submitted",
    revision: Number(current?.revision || 0) + 1,
    reviewNotes: "",
    submittedAt: now,
    approvedAt: null,
    approvedBy: null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };
  const vendorProfiles = doc.vendorProfiles.slice();
  if (index >= 0) vendorProfiles[index] = profile;
  else vendorProfiles.push(profile);
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    vendorProfiles,
    activity: [...doc.activity, activity(idFactory, "vendor.profile_submitted", "application", applicationId, now, options.actorId ?? "partner", { profileId: profile.id })].slice(-1000)
  };
  const dismissed = dismissVendorWorkflowFollowups(baseDoc, vendorWorkflowKey("vendor_profile", applicationId), "Vendor submitted a revised operating profile; the prior change request is stale.", { now });
  return {
    ok: true,
    profile,
    dismissedFollowups: dismissed.dismissed,
    doc: dismissed.doc
  };
}

export function reviewVendorProfile(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const vendor = vendorApplication(doc, applicationId);
  if (!vendor.ok) return vendor;
  const index = doc.vendorProfiles.findIndex(item => item.applicationId === applicationId);
  if (index < 0) return { ok: false, error: "Vendor profile not found." };
  const action = text(input.action, 40).toLowerCase();
  const status = action === "approve" ? "approved" : action === "request_changes" ? "changes_requested" : "";
  if (!VENDOR_PROFILE_STATUSES.has(status)) return { ok: false, error: "Action must be approve or request_changes." };
  const reviewNotes = text(input.reviewNotes, 1000);
  if (status === "changes_requested" && !reviewNotes) return { ok: false, error: "Explain the requested vendor profile changes." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const profile = {
    ...doc.vendorProfiles[index],
    status,
    reviewNotes,
    approvedAt: status === "approved" ? now : null,
    approvedBy: status === "approved" ? options.actorId ?? "admin" : null,
    updatedAt: now
  };
  const vendorProfiles = doc.vendorProfiles.slice();
  vendorProfiles[index] = profile;
  const application = vendor.application;
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    vendorProfiles,
    activity: [...doc.activity, activity(idFactory, `vendor.profile_${status}`, "application", applicationId, now, options.actorId ?? "admin", { profileId: profile.id })].slice(-1000)
  };
  const workflowKey = vendorWorkflowKey("vendor_profile", applicationId);
  const notification = status === "changes_requested"
    ? upsertVendorWorkflowFollowup(baseDoc, application, {
      kind: "vendor_profile_changes",
      workflowKey,
      sourceVersion: `revision:${profile.revision}:${status}:${reviewNotes}`,
      subject: `Texas SandFest vendor profile changes - ${application.reference}`,
      body: `Hello ${application.contactName},\n\nThe SandFest team reviewed ${profile.boothName}'s operating profile and needs the following update:\n\n${reviewNotes}\n\nPlease revise the profile in the private vendor portal.\n\nTexas SandFest`
    }, { ...options, now, idFactory })
    : dismissVendorWorkflowFollowups(baseDoc, workflowKey, "Vendor profile was approved before this notice was delivered.", { now });
  return {
    ok: true,
    profile,
    followup: notification.followup ?? null,
    followupChanged: notification.changed === true,
    dismissedFollowups: notification.dismissed ?? 0,
    doc: notification.doc
  };
}

export function createVendorDocument(docInput, applicationId, requirementId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const vendor = vendorApplication(doc, applicationId);
  if (!vendor.ok) return vendor;
  const requirementIndex = doc.vendorRequirements.findIndex(item => item.id === requirementId && item.applicationId === applicationId);
  if (requirementIndex < 0) return { ok: false, error: "Vendor requirement not found." };
  const sourceType = input.storageKey ? "upload" : "external_url";
  const sourceUrl = sourceType === "external_url" ? httpsUrl(input.sourceUrl, "Document URL", { required: true }) : { ok: true, value: null };
  if (!sourceUrl.ok) return sourceUrl;
  const storageKey = sourceType === "upload" ? text(input.storageKey, 500) : null;
  const checksumSha256 = sourceType === "upload" ? text(input.checksumSha256, 128).toLowerCase() : null;
  if (sourceType === "upload" && (!storageKey || !checksumSha256)) return { ok: false, error: "Uploaded document storage metadata is incomplete." };
  const duplicate = doc.vendorDocuments.find(item => item.requirementId === requirementId && !["superseded", "archived"].includes(item.status) && (
    sourceType === "upload" ? item.checksumSha256 === checksumSha256 : item.sourceUrl === sourceUrl.value
  ));
  if (duplicate) return { ok: true, duplicate: true, document: duplicate, doc };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const document = {
    id: text(input.id, 120) || idFactory("vendor_document"),
    applicationId,
    requirementId,
    label: text(input.label, 160) || doc.vendorRequirements[requirementIndex].label,
    sourceType,
    sourceUrl: sourceUrl.value,
    storageKey,
    fileName: text(input.fileName, 240) || null,
    contentType: text(input.contentType, 100) || null,
    sizeBytes: sourceType === "upload" ? Math.max(0, Math.round(Number(input.sizeBytes) || 0)) : null,
    checksumSha256,
    status: "submitted",
    submittedBy: options.actorId ?? "partner",
    createdAt: now,
    updatedAt: now
  };
  const vendorDocuments = doc.vendorDocuments.map(item => item.requirementId === requirementId && !["superseded", "archived"].includes(item.status)
    ? { ...item, status: "superseded", updatedAt: now }
    : item);
  vendorDocuments.push(document);
  const requirement = {
    ...doc.vendorRequirements[requirementIndex],
    status: "submitted",
    currentDocumentId: document.id,
    reviewNotes: "",
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: now
  };
  const vendorRequirements = doc.vendorRequirements.slice();
  vendorRequirements[requirementIndex] = requirement;
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    vendorDocuments,
    vendorRequirements,
    activity: [...doc.activity, activity(idFactory, "vendor.document_submitted", "vendor_document", document.id, now, options.actorId ?? "partner", { applicationId, requirementId, sourceType })].slice(-1000)
  };
  const dismissed = dismissVendorWorkflowFollowups(baseDoc, vendorWorkflowKey("vendor_requirement", requirementId), "Vendor submitted replacement evidence; the prior change request is stale.", { now });
  return {
    ok: true,
    duplicate: false,
    document,
    requirement,
    dismissedFollowups: dismissed.dismissed,
    doc: dismissed.doc
  };
}

export function reviewVendorRequirement(docInput, requirementId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.vendorRequirements.findIndex(item => item.id === requirementId);
  if (index < 0) return { ok: false, error: "Vendor requirement not found." };
  const current = doc.vendorRequirements[index];
  const status = text(input.status, 40).toLowerCase();
  if (!VENDOR_REQUIREMENT_STATUSES.has(status) || ["missing", "submitted"].includes(status)) {
    return { ok: false, error: "Choose under_review, approved, changes_requested, waived, or expired." };
  }
  if (["under_review", "approved", "changes_requested", "expired"].includes(status) && !current.currentDocumentId) {
    return { ok: false, error: "A vendor document is required for this review status." };
  }
  const reviewNotes = text(input.reviewNotes, 1000);
  if (["changes_requested", "waived", "expired"].includes(status) && !reviewNotes) return { ok: false, error: "Add a review note for this requirement decision." };
  let expiresAt = current.expiresAt ?? null;
  if (input.expiresAt !== undefined) {
    expiresAt = input.expiresAt ? iso(input.expiresAt) : null;
    if (input.expiresAt && !expiresAt) return { ok: false, error: "Requirement expiration must be a valid date." };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const requirement = {
    ...current,
    status,
    reviewNotes,
    expiresAt,
    reviewedAt: now,
    reviewedBy: options.actorId ?? "admin",
    updatedAt: now
  };
  const vendorRequirements = doc.vendorRequirements.slice();
  vendorRequirements[index] = requirement;
  const documentStatus = status === "approved" ? "approved" : status === "changes_requested" || status === "expired" ? "changes_requested" : null;
  const vendorDocuments = documentStatus ? doc.vendorDocuments.map(item => item.id === current.currentDocumentId ? { ...item, status: documentStatus, updatedAt: now } : item) : doc.vendorDocuments;
  const application = doc.applications.find(item => item.id === current.applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    vendorRequirements,
    vendorDocuments,
    activity: [...doc.activity, activity(idFactory, `vendor.requirement_${status}`, "vendor_requirement", requirementId, now, options.actorId ?? "admin", { applicationId: current.applicationId })].slice(-1000)
  };
  const workflowKey = vendorWorkflowKey("vendor_requirement", requirementId);
  const notification = ["changes_requested", "expired"].includes(status)
    ? upsertVendorWorkflowFollowup(baseDoc, application, {
      kind: "vendor_requirement_changes",
      workflowKey,
      sourceVersion: `${current.currentDocumentId}:${status}:${reviewNotes}:${expiresAt || ""}`,
      subject: `Texas SandFest vendor document update - ${application.reference}`,
      body: `Hello ${application.contactName},\n\nThe SandFest team reviewed ${current.label} for ${application.organizationName} and marked it ${status === "expired" ? "expired" : "for changes"}.\n\n${reviewNotes}\n\nPlease submit current evidence in the private vendor portal.\n\nTexas SandFest`
    }, { ...options, now, idFactory })
    : ["approved", "waived"].includes(status)
      ? dismissVendorWorkflowFollowups(baseDoc, workflowKey, `${current.label} was cleared before this notice was delivered.`, { now })
      : { doc: baseDoc, dismissed: 0 };
  return {
    ok: true,
    requirement,
    followup: notification.followup ?? null,
    followupChanged: notification.changed === true,
    dismissedFollowups: notification.dismissed ?? 0,
    doc: notification.doc
  };
}

export function updateVendorAssignment(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const vendor = vendorApplication(doc, applicationId);
  if (!vendor.ok) return vendor;
  const index = doc.vendorAssignments.findIndex(item => item.applicationId === applicationId);
  const current = index >= 0 ? doc.vendorAssignments[index] : null;
  const dateField = (name, fallback) => input[name] === undefined ? { ok: true, value: fallback } : taskDueAt(input[name]);
  const loadInStart = dateField("loadInStart", current?.loadInStart ?? null);
  const loadInEnd = dateField("loadInEnd", current?.loadInEnd ?? null);
  const loadOutStart = dateField("loadOutStart", current?.loadOutStart ?? null);
  const loadOutEnd = dateField("loadOutEnd", current?.loadOutEnd ?? null);
  for (const parsed of [loadInStart, loadInEnd, loadOutStart, loadOutEnd]) if (!parsed.ok) return { ok: false, error: "Vendor load-in and load-out times must be valid dates." };
  if (loadInStart.value && loadInEnd.value && new Date(loadInStart.value) >= new Date(loadInEnd.value)) return { ok: false, error: "Load-in end must be after load-in start." };
  if (loadOutStart.value && loadOutEnd.value && new Date(loadOutStart.value) >= new Date(loadOutEnd.value)) return { ok: false, error: "Load-out end must be after load-out start." };
  const boothNumber = input.boothNumber === undefined ? current?.boothNumber ?? null : text(input.boothNumber, 80) || null;
  const requestedStatus = input.status === undefined ? current?.status ?? "unassigned" : text(input.status, 40).toLowerCase();
  if (!VENDOR_ASSIGNMENT_STATUSES.has(requestedStatus)) return { ok: false, error: "Choose a valid vendor assignment status." };
  if (["scheduled", "confirmed", "checked_in", "complete"].includes(requestedStatus) && (!boothNumber || !loadInStart.value || !loadInEnd.value)) {
    return { ok: false, error: "Booth number and load-in window are required before scheduling a vendor." };
  }
  const count = value => Math.max(0, Math.min(50, Math.round(Number(value) || 0)));
  const scheduleChanged = Boolean(current) && [boothNumber, loadInStart.value, loadInEnd.value, loadOutStart.value, loadOutEnd.value]
    .some((value, itemIndex) => value !== [current.boothNumber, current.loadInStart, current.loadInEnd, current.loadOutStart, current.loadOutEnd][itemIndex]);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const finalStatus = scheduleChanged && requestedStatus === "confirmed" ? "scheduled" : requestedStatus;
  const enteringScheduled = finalStatus === "scheduled" && current?.status !== "scheduled";
  const scheduleVersion = Number(current?.scheduleVersion || 0) + (scheduleChanged || enteringScheduled ? 1 : 0);
  const assignment = {
    id: current?.id ?? idFactory("vendor_assignment"),
    applicationId,
    status: finalStatus,
    scheduleVersion,
    boothNumber,
    zone: input.zone === undefined ? current?.zone ?? null : text(input.zone, 120) || null,
    accessGate: input.accessGate === undefined ? current?.accessGate ?? null : text(input.accessGate, 120) || null,
    loadInStart: loadInStart.value,
    loadInEnd: loadInEnd.value,
    loadOutStart: loadOutStart.value,
    loadOutEnd: loadOutEnd.value,
    parkingPasses: input.parkingPasses === undefined ? current?.parkingPasses ?? 0 : count(input.parkingPasses),
    staffWristbands: input.staffWristbands === undefined ? current?.staffWristbands ?? 0 : count(input.staffWristbands),
    instructions: input.instructions === undefined ? current?.instructions ?? "" : text(input.instructions, 2000),
    partnerConfirmedAt: scheduleChanged ? null : current?.partnerConfirmedAt ?? null,
    updatedBy: options.actorId ?? "admin",
    createdAt: current?.createdAt ?? now,
    updatedAt: now
  };
  const vendorAssignments = doc.vendorAssignments.slice();
  if (index >= 0) vendorAssignments[index] = assignment;
  else vendorAssignments.push(assignment);
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    vendorAssignments,
    activity: [...doc.activity, activity(idFactory, "vendor.assignment_updated", "vendor_assignment", assignment.id, now, options.actorId ?? "admin", { applicationId, status: assignment.status, scheduleChanged, scheduleVersion })].slice(-1000)
  };
  const workflowKey = vendorWorkflowKey("vendor_assignment", applicationId);
  let notification = { doc: baseDoc, dismissed: 0 };
  if (assignment.status === "scheduled" && (scheduleChanged || enteringScheduled)) {
    notification = upsertVendorWorkflowFollowup(baseDoc, vendor.application, {
      kind: "vendor_assignment_ready",
      workflowKey,
      sourceVersion: `schedule:${scheduleVersion}`,
      subject: `Texas SandFest booth and load-in assignment - ${vendor.application.reference}`,
      body: `Hello ${vendor.application.contactName},\n\n${assignment.boothNumber} is assigned to ${vendor.application.organizationName}${assignment.zone ? ` in ${assignment.zone}` : ""}. Your load-in window is ${vendorLocalDateTime(assignment.loadInStart)} to ${vendorLocalDateTime(assignment.loadInEnd)}${assignment.accessGate ? ` through ${assignment.accessGate}` : ""}.\n\n${assignment.instructions || "Please review the assignment details."}\n\nConfirm this assignment in the private vendor portal.\n\nTexas SandFest`
    }, { ...options, now, idFactory });
  } else if (assignment.status === "cancelled" && current?.status !== "cancelled") {
    notification = upsertVendorWorkflowFollowup(baseDoc, vendor.application, {
      kind: "vendor_assignment_cancelled",
      workflowKey,
      sourceVersion: `cancelled:${scheduleVersion}`,
      subject: `Texas SandFest vendor assignment update - ${vendor.application.reference}`,
      body: `Hello ${vendor.application.contactName},\n\nThe current booth and load-in assignment for ${vendor.application.organizationName} is no longer active. The SandFest team will publish replacement details or contact you with next steps.\n\nTexas SandFest`
    }, { ...options, now, idFactory });
  }
  return {
    ok: true,
    assignment,
    followup: notification.followup ?? null,
    followupChanged: notification.changed === true,
    dismissedFollowups: notification.dismissed ?? 0,
    doc: notification.doc
  };
}

export function confirmVendorAssignment(docInput, applicationId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.vendorAssignments.findIndex(item => item.applicationId === applicationId);
  if (index < 0) return { ok: false, error: "Vendor assignment not found." };
  const current = doc.vendorAssignments[index];
  if (current.status !== "scheduled" || !current.boothNumber || !current.loadInStart || !current.loadInEnd) {
    return { ok: false, error: "The SandFest team must publish a complete booth and load-in assignment before confirmation." };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const assignment = { ...current, status: "confirmed", partnerConfirmedAt: now, updatedAt: now };
  const vendorAssignments = doc.vendorAssignments.slice();
  vendorAssignments[index] = assignment;
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    vendorAssignments,
    activity: [...doc.activity, activity(idFactory, "vendor.assignment_confirmed", "vendor_assignment", assignment.id, now, options.actorId ?? "partner", { applicationId })].slice(-1000)
  };
  const dismissed = dismissVendorWorkflowFollowups(baseDoc, vendorWorkflowKey("vendor_assignment", applicationId), "Vendor confirmed the current booth and load-in assignment.", { now });
  return {
    ok: true,
    assignment,
    dismissedFollowups: dismissed.dismissed,
    doc: dismissed.doc
  };
}

function activePaymentAmount(payment) {
  if (!["succeeded", "partially_refunded"].includes(payment?.status)) return 0;
  return Math.max(0, cents(payment.amountCents) - cents(payment.refundedAmountCents));
}

function activeAppliedPaymentAmount(payment) {
  return Math.min(cents(payment.appliedAmountCents), activePaymentAmount(payment));
}

function activeUnappliedPaymentAmount(payment) {
  return Math.max(0, activePaymentAmount(payment) - activeAppliedPaymentAmount(payment));
}

function checkoutExpiresAt(checkout, nowMs) {
  const expiresAt = new Date(checkout?.expiresAt || "").getTime();
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function beginPartnerPaymentCheckout(docInput, applicationId, invoiceId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  const invoice = doc.invoices.find(item => item.id === invoiceId && item.applicationId === applicationId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (!["approved", "queued", "synced", "failed"].includes(invoice.status)) {
    return { ok: false, error: "The invoice must be approved before online payment." };
  }
  const amountCents = Math.max(0, cents(invoice.balanceCents ?? invoice.amountCents));
  if (!amountCents) return { ok: false, error: "This invoice has no open balance." };
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, error: "Checkout time is invalid." };
  const current = doc.paymentCheckouts.find(item => item.invoiceId === invoice.id
    && item.amountCents === amountCents
    && ["creating", "open"].includes(item.status)
    && checkoutExpiresAt(item, nowMs));
  if (current) {
    return { ok: true, changed: false, duplicate: true, checkout: current, invoice, application, doc };
  }
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const expiresAt = options.expiresAt ?? new Date(nowMs + 30 * 60_000).toISOString();
  if (!iso(expiresAt) || new Date(expiresAt).getTime() <= nowMs) return { ok: false, error: "Checkout expiration must be in the future." };
  const paymentCheckouts = doc.paymentCheckouts.map(item => ["creating", "open"].includes(item.status) && !checkoutExpiresAt(item, nowMs)
    ? { ...item, status: "expired", checkoutUrl: null, updatedAt: now }
    : item);
  const checkout = {
    id: idFactory("partner_checkout"),
    applicationId,
    invoiceId: invoice.id,
    provider: "stripe",
    providerSessionId: null,
    paymentIntentId: null,
    providerEventId: null,
    amountCents,
    currency: String(invoice.currency || "usd").toLowerCase(),
    status: "creating",
    checkoutUrl: null,
    expiresAt,
    completedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
  paymentCheckouts.push(checkout);
  return {
    ok: true,
    changed: true,
    duplicate: false,
    checkout,
    invoice,
    application,
    doc: {
      ...doc,
      lastUpdated: now,
      paymentCheckouts,
      activity: [...doc.activity, activity(idFactory, "payment_checkout.created", "payment_checkout", checkout.id, now, options.actorId ?? "partner", {
        applicationId, invoiceId: invoice.id, amountCents
      })].slice(-1000)
    }
  };
}

export function activatePartnerPaymentCheckout(docInput, checkoutId, providerSession, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.paymentCheckouts.findIndex(item => item.id === checkoutId);
  if (index < 0) return { ok: false, error: "Payment checkout not found." };
  const current = doc.paymentCheckouts[index];
  if (current.status === "open" && current.providerSessionId === providerSession?.id && current.checkoutUrl) {
    return { ok: true, duplicate: true, checkout: current, doc };
  }
  if (current.status !== "creating") return { ok: false, error: "Payment checkout is not awaiting a Stripe session." };
  const providerSessionId = text(providerSession?.id, 160);
  const checkoutUrl = text(providerSession?.url, 2000);
  if (!providerSessionId || !/^https:\/\//i.test(checkoutUrl)) return { ok: false, error: "Stripe returned an invalid checkout session." };
  const now = options.now ?? new Date().toISOString();
  const expiresAt = providerSession?.expires_at
    ? new Date(Number(providerSession.expires_at) * 1000).toISOString()
    : current.expiresAt;
  const checkout = {
    ...current,
    providerSessionId,
    checkoutUrl,
    expiresAt,
    status: "open",
    lastError: null,
    updatedAt: now
  };
  const paymentCheckouts = doc.paymentCheckouts.slice();
  paymentCheckouts[index] = checkout;
  return { ok: true, duplicate: false, checkout, doc: { ...doc, lastUpdated: now, paymentCheckouts } };
}

export function failPartnerPaymentCheckout(docInput, checkoutId, error, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.paymentCheckouts.findIndex(item => item.id === checkoutId);
  if (index < 0) return { ok: false, error: "Payment checkout not found." };
  const now = options.now ?? new Date().toISOString();
  const checkout = {
    ...doc.paymentCheckouts[index],
    status: "failed",
    checkoutUrl: null,
    lastError: text(error, 500) || "Stripe checkout session creation failed.",
    updatedAt: now
  };
  const paymentCheckouts = doc.paymentCheckouts.slice();
  paymentCheckouts[index] = checkout;
  return { ok: true, checkout, doc: { ...doc, lastUpdated: now, paymentCheckouts } };
}

export function recordPartnerPayment(docInput, applicationId, input, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  const amountCents = cents(input?.amountCents);
  if (!amountCents) return { ok: false, error: "Payment amount must be greater than zero." };
  const method = text(input?.method, 40).toLowerCase() || "manual";
  if (!PAYMENT_METHODS.has(method)) return { ok: false, error: "Choose a supported payment method." };
  const status = text(input?.status, 40).toLowerCase() || "succeeded";
  if (!PAYMENT_INPUT_STATUSES.has(status)) return { ok: false, error: "Payment status must be succeeded, pending, or failed." };
  const now = options.now ?? new Date().toISOString();
  const receivedAt = input?.receivedAt === undefined || input.receivedAt === null || String(input.receivedAt).trim() === ""
    ? now
    : iso(input.receivedAt);
  if (!receivedAt) return { ok: false, error: "Payment received date must be a valid date and time." };
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const externalRef = text(input?.externalRef, 160) || null;
  if (externalRef) {
    const duplicate = doc.payments.find(item => item.applicationId === applicationId
      && String(item.method || "manual").toLowerCase() === method
      && String(item.externalRef || "").toLowerCase() === externalRef.toLowerCase());
    if (duplicate) {
      const totalPaid = successfulPaymentTotal(doc, applicationId);
      const reconciled = reconcilePaymentMilestones(doc, applicationId, totalPaid, { ...options, idFactory, now });
      return {
        ok: true,
        duplicate: true,
        payment: duplicate,
        totalPaidCents: totalPaid,
        completedPaymentMilestones: reconciled.completed,
        reopenedPaymentMilestones: reconciled.reopened,
        doc: reconciled.doc
      };
    }
  }
  const activeInvoice = resolvePaymentInvoice(doc, applicationId, input?.invoiceId);
  if (input?.invoiceId && !activeInvoice) return { ok: false, error: "Choose an active invoice for this application." };
  const availableBalance = activeInvoice ? localInvoiceBalance(doc, activeInvoice) : 0;
  const appliedAmountCents = status === "succeeded" ? Math.min(amountCents, availableBalance) : 0;
  const unappliedAmountCents = status === "succeeded" ? amountCents - appliedAmountCents : 0;
  const payment = {
    id: idFactory("payment"), applicationId, invoiceId: activeInvoice?.id ?? null, amountCents,
    appliedAmountCents, unappliedAmountCents, method, status, externalRef, receivedAt,
    reconciliationStatus: status !== "succeeded" ? status : unappliedAmountCents > 0 ? (appliedAmountCents > 0 ? "overpayment" : "unapplied") : "matched",
    notes: text(input?.notes, 500), createdAt: now, createdBy: options.actorId ?? "admin",
    providerEventId: text(input?.providerEventId, 160) || null,
    providerCheckoutId: text(input?.providerCheckoutId, 160) || null,
    paymentIntentId: text(input?.paymentIntentId, 160) || null,
    refundedAmountCents: 0,
    reversedAt: null, reversedBy: null, reversalReason: null
  };
  const payments = [...doc.payments, payment];
  const totalPaid = successfulPaymentTotal({ ...doc, payments }, applicationId);
  const nextStatus = applicationFinancialStatus(application, totalPaid, activeInvoice);
  const applications = doc.applications.map(item => item.id === applicationId ? { ...item, status: nextStatus, updatedAt: now } : item);
  const invoices = doc.invoices.map(item => item.id === activeInvoice?.id
    ? withLocalInvoiceBalance(item, availableBalance - appliedAmountCents, now)
    : item);
  const baseDoc = {
    ...doc, lastUpdated: now, applications, payments, invoices,
    activity: [...doc.activity, activity(idFactory, "payment.recorded", "payment", payment.id, now, options.actorId ?? "admin", {
      applicationId, invoiceId: payment.invoiceId, amountCents, appliedAmountCents, unappliedAmountCents, status
    })].slice(-1000)
  };
  const reconciled = reconcilePaymentMilestones(baseDoc, applicationId, totalPaid, { ...options, idFactory, now });
  return {
    ok: true, duplicate: false, payment, totalPaidCents: totalPaid,
    completedPaymentMilestones: reconciled.completed,
    reopenedPaymentMilestones: reconciled.reopened,
    doc: reconciled.doc
  };
}

function successfulPaymentTotal(doc, applicationId) {
  return doc.payments
    .filter(item => item.applicationId === applicationId)
    .reduce((sum, item) => sum + activePaymentAmount(item), 0);
}

function resolvePaymentInvoice(doc, applicationId, invoiceId) {
  if (invoiceId) return doc.invoices.find(item => item.id === invoiceId && item.applicationId === applicationId && item.status !== "voided") ?? null;
  return doc.invoices.find(item => item.applicationId === applicationId && item.status !== "voided") ?? null;
}

function localInvoiceBalance(doc, invoice) {
  if (!invoice) return 0;
  const allocations = doc.payments
    .filter(item => item.invoiceId === invoice.id)
    .reduce((sum, item) => sum + activeAppliedPaymentAmount(item), 0);
  return Math.max(0, cents(invoice.amountCents) - allocations);
}

function withLocalInvoiceBalance(invoice, balanceCents, now) {
  const nextBalance = Math.max(0, cents(balanceCents));
  return {
    ...invoice,
    allocatedPaymentCents: Math.max(0, cents(invoice.amountCents) - nextBalance),
    balanceCents: nextBalance,
    updatedAt: now
  };
}

function applicationFinancialStatus(application, totalPaidCents, invoice) {
  const expected = cents(application.expectedAmountCents || application.requestedAmountCents);
  if (expected > 0 && totalPaidCents >= expected) return "paid";
  if (totalPaidCents > 0) return "partial";
  if (invoice?.status === "synced") return "invoiced";
  if (["invoiced", "partial", "paid"].includes(application.status)) return invoice ? "approved" : application.status;
  return application.status;
}

export function reversePartnerPayment(docInput, paymentId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.payments.findIndex(item => item.id === paymentId);
  if (index < 0) return { ok: false, error: "Payment not found." };
  const current = doc.payments[index];
  if (!["succeeded", "partially_refunded"].includes(current.status)) return { ok: false, error: "Only active payments can be reversed." };
  const action = text(input.action, 20).toLowerCase();
  if (!new Set(["refund", "void"]).has(action)) return { ok: false, error: "Action must be refund or void." };
  const reason = text(input.reason, 500);
  if (!reason) return { ok: false, error: "A reversal reason is required." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const payment = {
    ...current,
    status: action === "refund" ? "refunded" : "voided",
    reconciliationStatus: action === "refund" ? "refunded" : "voided",
    refundedAmountCents: action === "refund" ? cents(current.amountCents) : cents(current.refundedAmountCents),
    reversedAt: now,
    reversedBy: options.actorId ?? "admin",
    reversalReason: reason
  };
  const payments = doc.payments.slice();
  payments[index] = payment;
  const invoiceIndex = doc.invoices.findIndex(item => item.id === current.invoiceId && item.status !== "voided");
  const invoices = doc.invoices.slice();
  let invoice = invoiceIndex >= 0 ? invoices[invoiceIndex] : null;
  if (invoice) {
    invoice = withLocalInvoiceBalance(invoice, localInvoiceBalance({ ...doc, payments }, invoice), now);
    invoices[invoiceIndex] = invoice;
  }
  const application = doc.applications.find(item => item.id === current.applicationId);
  const totalPaid = successfulPaymentTotal({ ...doc, payments }, current.applicationId);
  const applications = doc.applications.map(item => item.id === current.applicationId
    ? { ...item, status: applicationFinancialStatus(application, totalPaid, invoice), updatedAt: now }
    : item);
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    applications,
    payments,
    invoices,
    activity: [...doc.activity, activity(idFactory, `payment.${action}ed`, "payment", paymentId, now, options.actorId ?? "admin", {
      applicationId: current.applicationId, invoiceId: current.invoiceId, amountCents: current.amountCents, reason
    })].slice(-1000)
  };
  const reconciled = reconcilePaymentMilestones(baseDoc, current.applicationId, totalPaid, { ...options, idFactory, now });
  return {
    ok: true,
    payment,
    invoice,
    totalPaidCents: totalPaid,
    completedPaymentMilestones: reconciled.completed,
    reopenedPaymentMilestones: reconciled.reopened,
    doc: reconciled.doc
  };
}

function checkoutReconciliationException(doc, checkoutIndex, message, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const checkout = {
    ...doc.paymentCheckouts[checkoutIndex],
    status: "reconciliation_required",
    checkoutUrl: null,
    providerEventId: text(options.providerEventId, 160) || doc.paymentCheckouts[checkoutIndex].providerEventId,
    lastError: text(message, 500),
    updatedAt: now
  };
  const paymentCheckouts = doc.paymentCheckouts.slice();
  paymentCheckouts[checkoutIndex] = checkout;
  return { checkout, doc: { ...doc, lastUpdated: now, paymentCheckouts } };
}

export function reconcilePartnerStripePayment(docInput, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const checkoutId = text(input.checkoutId, 160);
  const providerSessionId = text(input.providerSessionId, 160);
  const checkoutIndex = doc.paymentCheckouts.findIndex(item => item.id === checkoutId
    && (!providerSessionId || !item.providerSessionId || item.providerSessionId === providerSessionId));
  if (checkoutIndex < 0) return { ok: false, error: "Partner payment checkout not found." };
  const checkout = doc.paymentCheckouts[checkoutIndex];
  const invoice = doc.invoices.find(item => item.id === checkout.invoiceId && item.applicationId === checkout.applicationId);
  if (!invoice) return { ok: false, error: "Partner payment invoice not found." };
  if ((input.applicationId && input.applicationId !== checkout.applicationId) || (input.invoiceId && input.invoiceId !== checkout.invoiceId)) {
    const exception = checkoutReconciliationException(doc, checkoutIndex, "Stripe checkout metadata did not match the approved partner invoice.", {
      ...options,
      providerEventId: input.providerEventId
    });
    return { ok: true, reconciled: false, error: exception.checkout.lastError, checkout: exception.checkout, doc: exception.doc };
  }
  const amountCents = cents(input.amountCents);
  const currency = text(input.currency, 10).toLowerCase();
  const paymentIntentId = text(input.paymentIntentId, 160) || providerSessionId;
  const providerEventId = text(input.providerEventId, 160);
  if (amountCents !== checkout.amountCents || currency !== checkout.currency) {
    const exception = checkoutReconciliationException(doc, checkoutIndex, "Stripe amount or currency did not match the approved invoice checkout.", { ...options, providerEventId });
    return { ok: true, reconciled: false, error: exception.checkout.lastError, checkout: exception.checkout, doc: exception.doc };
  }
  if (input.paymentStatus !== "paid") {
    const exception = checkoutReconciliationException(doc, checkoutIndex, "Stripe reported a completed checkout without paid status.", { ...options, providerEventId });
    return { ok: true, reconciled: false, error: exception.checkout.lastError, checkout: exception.checkout, doc: exception.doc };
  }
  const paymentResult = recordPartnerPayment(doc, checkout.applicationId, {
    invoiceId: checkout.invoiceId,
    amountCents,
    method: "stripe",
    status: "succeeded",
    externalRef: `stripe:${paymentIntentId}`,
    providerEventId,
    providerCheckoutId: providerSessionId,
    paymentIntentId,
    receivedAt: input.receivedAt,
    notes: `Stripe partner checkout ${checkout.id}`
  }, {
    actorId: options.actorId ?? "stripe-webhook",
    idFactory: options.idFactory,
    now: options.now
  });
  if (!paymentResult.ok) return paymentResult;
  const now = options.now ?? new Date().toISOString();
  const currentCheckoutIndex = paymentResult.doc.paymentCheckouts.findIndex(item => item.id === checkout.id);
  const completedCheckout = {
    ...paymentResult.doc.paymentCheckouts[currentCheckoutIndex],
    providerSessionId: providerSessionId || checkout.providerSessionId,
    paymentIntentId,
    providerEventId,
    status: "completed",
    checkoutUrl: null,
    completedAt: paymentResult.doc.paymentCheckouts[currentCheckoutIndex].completedAt || now,
    lastError: null,
    updatedAt: now
  };
  const paymentCheckouts = paymentResult.doc.paymentCheckouts.slice();
  paymentCheckouts[currentCheckoutIndex] = completedCheckout;
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  return {
    ok: true,
    reconciled: true,
    duplicate: paymentResult.duplicate === true,
    checkout: completedCheckout,
    payment: paymentResult.payment,
    invoice: paymentResult.doc.invoices.find(item => item.id === checkout.invoiceId),
    doc: {
      ...paymentResult.doc,
      lastUpdated: now,
      paymentCheckouts,
      activity: [...paymentResult.doc.activity, activity(idFactory, "payment_checkout.completed", "payment_checkout", checkout.id, now, options.actorId ?? "stripe-webhook", {
        applicationId: checkout.applicationId,
        invoiceId: checkout.invoiceId,
        paymentId: paymentResult.payment.id,
        providerEventId
      })].slice(-1000)
    }
  };
}

export function updatePartnerStripeCheckoutState(docInput, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const checkoutId = text(input.checkoutId, 160);
  const providerSessionId = text(input.providerSessionId, 160);
  const index = doc.paymentCheckouts.findIndex(item => item.id === checkoutId
    && (!providerSessionId || !item.providerSessionId || item.providerSessionId === providerSessionId));
  if (index < 0) return { ok: false, error: "Partner payment checkout not found." };
  const requestedStatus = text(input.status, 40).toLowerCase();
  if (!new Set(["expired", "failed"]).has(requestedStatus)) return { ok: false, error: "Stripe checkout state must be expired or failed." };
  const current = doc.paymentCheckouts[index];
  if (current.status === "completed") return { ok: true, duplicate: true, checkout: current, doc };
  const now = options.now ?? new Date().toISOString();
  const checkout = {
    ...current,
    providerSessionId: providerSessionId || current.providerSessionId,
    providerEventId: text(input.providerEventId, 160) || current.providerEventId,
    status: requestedStatus,
    checkoutUrl: null,
    lastError: text(input.error, 500) || (requestedStatus === "expired" ? "Stripe checkout expired before payment." : "Stripe payment failed."),
    updatedAt: now
  };
  const paymentCheckouts = doc.paymentCheckouts.slice();
  paymentCheckouts[index] = checkout;
  return { ok: true, duplicate: current.status === requestedStatus, checkout, doc: { ...doc, lastUpdated: now, paymentCheckouts } };
}

export function reconcilePartnerStripeRefund(docInput, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const paymentIntentId = text(input.paymentIntentId, 160);
  if (!paymentIntentId) return { ok: false, error: "Stripe refund is missing a PaymentIntent ID." };
  const index = doc.payments.findIndex(item => item.paymentIntentId === paymentIntentId || item.externalRef === `stripe:${paymentIntentId}`);
  if (index < 0) return { ok: false, error: "Partner Stripe payment not found." };
  const current = doc.payments[index];
  if (!["succeeded", "partially_refunded", "refunded"].includes(current.status)) return { ok: false, error: "Partner Stripe payment is not refundable." };
  const refundedAmountCents = cents(input.refundedAmountCents);
  if (refundedAmountCents > cents(current.amountCents)) return { ok: false, error: "Stripe refund exceeds the recorded payment." };
  if (refundedAmountCents <= cents(current.refundedAmountCents)) return { ok: true, duplicate: true, payment: current, doc };
  const now = options.now ?? new Date().toISOString();
  const fullyRefunded = refundedAmountCents === cents(current.amountCents);
  const payment = {
    ...current,
    status: fullyRefunded ? "refunded" : "partially_refunded",
    refundedAmountCents,
    reconciliationStatus: fullyRefunded ? "refunded" : "partially_refunded",
    providerEventId: text(input.providerEventId, 160) || current.providerEventId,
    reversedAt: fullyRefunded ? now : current.reversedAt,
    reversedBy: fullyRefunded ? options.actorId ?? "stripe-webhook" : current.reversedBy,
    reversalReason: text(input.reason, 500) || "Stripe refund",
    updatedAt: now
  };
  const payments = doc.payments.slice();
  payments[index] = payment;
  const invoiceIndex = doc.invoices.findIndex(item => item.id === current.invoiceId && item.status !== "voided");
  const invoices = doc.invoices.slice();
  let invoice = invoiceIndex >= 0 ? invoices[invoiceIndex] : null;
  if (invoice) {
    invoice = withLocalInvoiceBalance(invoice, localInvoiceBalance({ ...doc, payments }, invoice), now);
    invoices[invoiceIndex] = invoice;
  }
  const application = doc.applications.find(item => item.id === current.applicationId);
  const totalPaid = successfulPaymentTotal({ ...doc, payments }, current.applicationId);
  const applications = doc.applications.map(item => item.id === current.applicationId
    ? { ...item, status: applicationFinancialStatus(application, totalPaid, invoice), updatedAt: now }
    : item);
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    applications,
    payments,
    invoices,
    activity: [...doc.activity, activity(idFactory, "payment.stripe_refund_reconciled", "payment", payment.id, now, options.actorId ?? "stripe-webhook", {
      applicationId: current.applicationId,
      invoiceId: current.invoiceId,
      refundedAmountCents,
      providerEventId: text(input.providerEventId, 160)
    })].slice(-1000)
  };
  const reconciled = reconcilePaymentMilestones(baseDoc, current.applicationId, totalPaid, { ...options, idFactory, now });
  return {
    ok: true,
    duplicate: false,
    payment,
    invoice,
    totalPaidCents: totalPaid,
    completedPaymentMilestones: reconciled.completed,
    reopenedPaymentMilestones: reconciled.reopened,
    doc: reconciled.doc
  };
}

export function createPartnerInvoice(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  if (!["approved", "contracted", "invoiced", "partial"].includes(application.status)) {
    return { ok: false, error: "Approve the application before creating an invoice." };
  }
  const duplicate = doc.invoices.find(item => item.applicationId === applicationId && item.status !== "voided");
  if (duplicate) return { ok: false, error: "An active invoice already exists for this application." };
  const amountCents = cents(application.expectedAmountCents || application.requestedAmountCents);
  if (!amountCents) return { ok: false, error: "Set an approved application amount before creating an invoice." };

  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const defaultDueAt = new Date(new Date(now).getTime() + 30 * 86_400_000).toISOString();
  const dueAt = input.dueAt === undefined || input.dueAt === null || String(input.dueAt).trim() === "" ? defaultDueAt : iso(input.dueAt);
  if (!dueAt) return { ok: false, error: "Invoice due date must be a valid date and time." };
  let invoice = {
    id: idFactory("invoice"),
    applicationId,
    amountCents,
    currency: "usd",
    description: text(input.description, 500) || `Texas SandFest ${application.offeringName || application.packageName || `${application.type} package`} - ${application.organizationName}`,
    dueAt,
    status: "draft",
    quickBooksItemId: text(input.quickBooksItemId, 100) || null,
    quickBooksCustomerId: null,
    quickBooksInvoiceId: null,
    quickBooksDocNumber: null,
    quickBooksTotalCents: null,
    quickBooksBalanceCents: null,
    quickBooksProviderUpdatedAt: null,
    quickBooksReconciliationStatus: "not_synced",
    quickBooksReconciliationVersion: 0,
    quickBooksReconciledAt: null,
    quickBooksReconciliationAttempts: 0,
    lastQuickBooksReconciliationAttemptAt: null,
    lastQuickBooksReconciliationError: null,
    allocatedPaymentCents: 0,
    balanceCents: amountCents,
    approvedBy: null,
    approvedAt: null,
    queuedAt: null,
    syncedAt: null,
    syncAttempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
  let remainingBalance = amountCents;
  const payments = doc.payments.map(item => {
    if (item.applicationId !== applicationId || item.status !== "succeeded" || cents(item.unappliedAmountCents ?? item.amountCents) <= 0 || remainingBalance <= 0) return item;
    const available = cents(item.unappliedAmountCents ?? item.amountCents);
    const allocation = Math.min(available, remainingBalance);
    remainingBalance -= allocation;
    const appliedAmountCents = cents(item.appliedAmountCents) + allocation;
    const unappliedAmountCents = available - allocation;
    return {
      ...item,
      invoiceId: invoice.id,
      appliedAmountCents,
      unappliedAmountCents,
      reconciliationStatus: unappliedAmountCents > 0 ? "overpayment" : "matched"
    };
  });
  invoice = withLocalInvoiceBalance(invoice, remainingBalance, now);
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    payments,
    invoices: [...doc.invoices, invoice],
    activity: [...doc.activity, activity(idFactory, "invoice.created", "invoice", invoice.id, now, options.actorId ?? "admin", { applicationId, amountCents, dueAt })].slice(-1000)
  };
  const dueSynced = syncInvoicePaymentMilestone(baseDoc, applicationId, dueAt, { ...options, idFactory, now });
  const totalPaid = successfulPaymentTotal(dueSynced.doc, applicationId);
  const reconciled = reconcilePaymentMilestones(dueSynced.doc, applicationId, totalPaid, { ...options, idFactory, now });
  return {
    ok: true,
    invoice,
    paymentMilestone: reconciled.doc.milestones.find(item => item.id === dueSynced.milestone.id),
    paymentMilestoneCreated: dueSynced.created,
    completedPaymentMilestones: reconciled.completed,
    reopenedPaymentMilestones: reconciled.reopened,
    dismissedMilestoneFollowups: dueSynced.dismissedFollowups + reconciled.dismissedFollowups,
    doc: reconciled.doc
  };
}

export function reviewPartnerInvoice(docInput, invoiceId, action, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.invoices.findIndex(item => item.id === invoiceId);
  if (index < 0) return { ok: false, error: "Invoice not found." };
  const current = doc.invoices[index];
  if (!INVOICE_STATUSES.has(current.status)) return { ok: false, error: "Invoice has an invalid status." };
  if (action === "approve") {
    if (current.status !== "draft") return { ok: false, error: "Only draft invoices can be approved." };
  } else if (action === "void") {
    if (!["draft", "approved", "failed"].includes(current.status)) return { ok: false, error: "Synced or queued invoices must be handled in QuickBooks." };
  } else {
    return { ok: false, error: "Action must be approve or void." };
  }

  const now = options.now ?? new Date().toISOString();
  const invoice = {
    ...current,
    status: action === "approve" ? "approved" : "voided",
    approvedBy: action === "approve" ? options.actorId ?? "admin" : current.approvedBy,
    approvedAt: action === "approve" ? now : current.approvedAt,
    voidedBy: action === "void" ? options.actorId ?? "admin" : current.voidedBy ?? null,
    voidedAt: action === "void" ? now : current.voidedAt ?? null,
    lastError: null,
    updatedAt: now
  };
  const invoices = doc.invoices.slice();
  invoices[index] = invoice;
  return { ok: true, invoice, doc: { ...doc, lastUpdated: now, invoices } };
}

export function queuePartnerInvoiceSync(docInput, invoiceId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.invoices.findIndex(item => item.id === invoiceId);
  if (index < 0) return { ok: false, error: "Invoice not found." };
  const current = doc.invoices[index];
  if (!["approved", "failed"].includes(current.status)) return { ok: false, error: "Invoice must be approved before syncing." };
  const quickBooksItemId = text(options.quickBooksItemId, 100) || current.quickBooksItemId;
  if (!quickBooksItemId) return { ok: false, error: "Map this package to a QuickBooks item before syncing." };
  const now = options.now ?? new Date().toISOString();
  const invoice = { ...current, status: "queued", quickBooksItemId, queuedAt: now, lastError: null, updatedAt: now };
  const invoices = doc.invoices.slice();
  invoices[index] = invoice;
  return { ok: true, invoice, doc: { ...doc, lastUpdated: now, invoices } };
}

export function recordPartnerInvoiceSync(docInput, invoiceId, sync, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.invoices.findIndex(item => item.id === invoiceId);
  if (index < 0) return { ok: false, error: "Invoice not found." };
  const current = doc.invoices[index];
  if (current.status !== "queued") return { ok: false, error: "Invoice is not queued for sync." };
  const now = options.now ?? new Date().toISOString();
  const synced = sync?.ok === true;
  const terminal = options.terminal === true;
  const invoice = {
    ...current,
    status: synced ? "synced" : terminal ? "failed" : "queued",
    quickBooksCustomerId: synced ? text(sync.customerId, 100) || null : current.quickBooksCustomerId,
    quickBooksInvoiceId: synced ? text(sync.invoiceId, 100) || null : current.quickBooksInvoiceId,
    quickBooksDocNumber: synced ? text(sync.docNumber, 100) || null : current.quickBooksDocNumber,
    quickBooksTotalCents: synced ? cents(sync.totalCents ?? current.amountCents) : current.quickBooksTotalCents ?? null,
    quickBooksBalanceCents: synced ? cents(sync.balanceCents ?? current.amountCents) : current.quickBooksBalanceCents ?? null,
    quickBooksProviderUpdatedAt: synced ? iso(sync.providerUpdatedAt) : current.quickBooksProviderUpdatedAt ?? null,
    quickBooksReconciliationStatus: synced ? "complete" : current.quickBooksReconciliationStatus ?? "not_synced",
    quickBooksReconciledAt: synced ? iso(sync.syncedAt, now) : current.quickBooksReconciledAt ?? null,
    lastQuickBooksReconciliationError: synced ? null : current.lastQuickBooksReconciliationError ?? null,
    balanceCents: synced ? localInvoiceBalance(doc, current) : current.balanceCents,
    allocatedPaymentCents: synced ? cents(current.amountCents) - localInvoiceBalance(doc, current) : current.allocatedPaymentCents ?? 0,
    syncedAt: synced ? iso(sync.syncedAt, now) : current.syncedAt,
    syncAttempts: Number(current.syncAttempts || 0) + 1,
    lastAttemptAt: now,
    lastError: synced ? null : text(sync?.error || "QuickBooks sync failed.", 1000),
    updatedAt: now
  };
  const invoices = doc.invoices.slice();
  invoices[index] = invoice;
  const applications = synced
    ? doc.applications.map(item => item.id === current.applicationId && ["approved", "contracted"].includes(item.status)
      ? { ...item, status: "invoiced", updatedAt: now }
      : item)
    : doc.applications;
  return { ok: true, invoice, doc: { ...doc, lastUpdated: now, applications, invoices } };
}

export function queuePartnerInvoiceReconciliation(docInput, invoiceId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.invoices.findIndex(item => item.id === invoiceId);
  if (index < 0) return { ok: false, error: "Invoice not found." };
  const current = doc.invoices[index];
  if (current.status !== "synced" || !current.quickBooksInvoiceId) {
    return { ok: false, error: "Invoice must be synced to QuickBooks before refreshing it." };
  }
  if (current.quickBooksReconciliationStatus === "queued") {
    return { ok: false, error: "QuickBooks invoice refresh is already queued." };
  }
  const now = options.now ?? new Date().toISOString();
  const invoice = {
    ...current,
    quickBooksReconciliationStatus: "queued",
    quickBooksReconciliationVersion: Math.max(0, Number(current.quickBooksReconciliationVersion || 0)) + 1,
    lastQuickBooksReconciliationError: null,
    updatedAt: now
  };
  const invoices = doc.invoices.slice();
  invoices[index] = invoice;
  return { ok: true, invoice, doc: { ...doc, lastUpdated: now, invoices } };
}

export function recordPartnerInvoiceReconciliation(docInput, invoiceId, reconciliation, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.invoices.findIndex(item => item.id === invoiceId);
  if (index < 0) return { ok: false, error: "Invoice not found." };
  const current = doc.invoices[index];
  if (current.status !== "synced" || !current.quickBooksInvoiceId) {
    return { ok: false, error: "Invoice is not synced to QuickBooks." };
  }
  if (current.quickBooksReconciliationStatus !== "queued") {
    return { ok: false, error: "QuickBooks invoice refresh is not queued." };
  }
  const now = options.now ?? new Date().toISOString();
  const succeeded = reconciliation?.ok === true;
  const terminal = options.terminal === true;
  const invoice = {
    ...current,
    quickBooksDocNumber: succeeded ? text(reconciliation.docNumber, 100) || current.quickBooksDocNumber : current.quickBooksDocNumber,
    quickBooksTotalCents: succeeded ? cents(reconciliation.totalCents) : current.quickBooksTotalCents ?? null,
    quickBooksBalanceCents: succeeded ? cents(reconciliation.balanceCents) : current.quickBooksBalanceCents ?? null,
    quickBooksProviderUpdatedAt: succeeded ? iso(reconciliation.providerUpdatedAt) : current.quickBooksProviderUpdatedAt ?? null,
    quickBooksReconciliationStatus: succeeded ? "complete" : terminal ? "failed" : "queued",
    quickBooksReconciledAt: succeeded ? iso(reconciliation.reconciledAt, now) : current.quickBooksReconciledAt ?? null,
    quickBooksReconciliationAttempts: Math.max(0, Number(current.quickBooksReconciliationAttempts || 0)) + 1,
    lastQuickBooksReconciliationAttemptAt: now,
    lastQuickBooksReconciliationError: succeeded ? null : text(reconciliation?.error || "QuickBooks invoice refresh failed.", 1000),
    updatedAt: now
  };
  const invoices = doc.invoices.slice();
  invoices[index] = invoice;
  return { ok: true, invoice, doc: { ...doc, lastUpdated: now, invoices } };
}

export function createPartnerTask(docInput, input, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const title = text(input?.title, 180);
  if (!title) return { ok: false, error: "Task title is required." };
  const dueAt = taskDueAt(input?.dueAt);
  if (!dueAt.ok) return dueAt;
  const assignment = taskAssignment(input);
  if (!assignment.ok) return assignment;
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const task = {
    id: idFactory("task"), title, description: text(input?.description, 1000), status: "open",
    priority: TASK_PRIORITIES.has(input?.priority) ? input.priority : "normal",
    assigneeType: assignment.assigneeType,
    assigneeId: assignment.assigneeId,
    assigneeName: assignment.assigneeName,
    assigneeRole: assignment.assigneeRole,
    relatedEntityType: text(input?.relatedEntityType, 60) || null,
    relatedEntityId: text(input?.relatedEntityId, 100) || null,
    dueAt: dueAt.value ?? null,
    assignmentVersion: 1,
    scheduleVersion: 1,
    createdBy: text(options.actorId, 100) || "admin",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    blockedAt: null,
    completedAt: null,
    cancelledAt: null,
    reopenedAt: null
  };
  return {
    ok: true,
    task,
    doc: {
      ...doc,
      lastUpdated: now,
      tasks: [...doc.tasks, task],
      activity: [...doc.activity, activity(idFactory, "task.created", "task", task.id, now, task.createdBy, { assigneeType: task.assigneeType, priority: task.priority })].slice(-1000)
    }
  };
}

export function updatePartnerTask(docInput, taskId, patch, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.tasks.findIndex(item => item.id === taskId);
  if (index < 0) return { ok: false, error: "Task not found." };
  const current = doc.tasks[index];
  const status = patch.status ?? current.status;
  if (!TASK_STATUSES.has(status)) return { ok: false, error: "Invalid task status." };
  const priority = patch.priority ?? current.priority ?? "normal";
  if (!TASK_PRIORITIES.has(priority)) return { ok: false, error: "Invalid task priority." };
  const dueAt = taskDueAt(patch.dueAt);
  if (!dueAt.ok) return dueAt;
  const assignment = taskAssignment(patch, current);
  if (!assignment.ok) return assignment;
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const actorId = text(options.actorId, 100) || "admin";
  const nextTitle = patch.title === undefined ? current.title : text(patch.title, 180) || current.title;
  const nextDescription = patch.description === undefined ? current.description : text(patch.description, 1000);
  const nextDueAt = dueAt.value === undefined ? current.dueAt : dueAt.value;
  const assignmentChanged = assignment.assigneeType !== current.assigneeType
    || assignment.assigneeId !== current.assigneeId
    || assignment.assigneeName !== current.assigneeName
    || assignment.assigneeRole !== current.assigneeRole
    || nextTitle !== current.title
    || nextDescription !== current.description
    || priority !== current.priority
    || (status === "open" && ["done", "cancelled"].includes(current.status));
  const scheduleChanged = assignmentChanged || nextDueAt !== (current.dueAt ?? null);
  const task = {
    ...current,
    title: nextTitle,
    description: nextDescription,
    status,
    priority,
    assigneeType: assignment.assigneeType,
    assigneeId: assignment.assigneeId,
    assigneeName: assignment.assigneeName,
    assigneeRole: assignment.assigneeRole,
    dueAt: nextDueAt,
    assignmentVersion: assignmentChanged ? taskAssignmentVersion(current) + 1 : taskAssignmentVersion(current),
    scheduleVersion: scheduleChanged ? taskScheduleVersion(current) + 1 : taskScheduleVersion(current),
    updatedAt: now,
    startedAt: status === "in_progress" && current.status !== "in_progress" ? now : current.startedAt ?? null,
    blockedAt: status === "blocked" && current.status !== "blocked" ? now : current.blockedAt ?? null,
    completedAt: status === "done" ? current.completedAt ?? now : null,
    cancelledAt: status === "cancelled" ? current.cancelledAt ?? now : null,
    reopenedAt: status === "open" && ["done", "cancelled"].includes(current.status) ? now : current.reopenedAt ?? null
  };
  const tasks = doc.tasks.slice();
  tasks[index] = task;
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    tasks,
    activity: [...doc.activity, activity(idFactory, "task.updated", "task", taskId, now, actorId, {
      fromStatus: current.status,
      toStatus: status,
      assigneeType: task.assigneeType,
      assigneeId: task.assigneeId,
      assignmentChanged,
      scheduleChanged,
      assignmentVersion: task.assignmentVersion,
      scheduleVersion: task.scheduleVersion
    })].slice(-1000)
  };
  const terminal = ["done", "cancelled"].includes(status);
  const dismissed = terminal || assignmentChanged || scheduleChanged
    ? dismissTaskFollowups(baseDoc, taskId, terminal
      ? "Task completed or cancelled."
      : assignmentChanged ? "Task assignment changed." : "Task due date changed.", {
        now,
        actorId,
        kinds: terminal || assignmentChanged ? null : ["task_overdue"]
      })
    : { doc: baseDoc, dismissed: 0 };
  return {
    ok: true,
    task,
    dismissedFollowups: dismissed.dismissed,
    doc: dismissed.doc
  };
}

function taskAssignmentVersion(task) {
  return Math.max(1, Math.round(Number(task?.assignmentVersion || 1)));
}

function taskScheduleVersion(task) {
  return Math.max(1, Math.round(Number(task?.scheduleVersion || 1)));
}

function taskNotificationRecipient(task, options = {}) {
  const inactive = new Set(["no_show", "withdrawn", "inactive"]);
  const directory = task?.assigneeType === "volunteer" ? options.volunteers : options.taskRecipients;
  const recipient = Array.isArray(directory)
    ? directory.find(item => item.id === task.assigneeId
      && (!item.assigneeType || item.assigneeType === task.assigneeType))
    : null;
  if (!recipient || inactive.has(recipient.status)) return null;
  const recipientEmail = email(recipient.email);
  if (!recipientEmail) return null;
  return {
    id: recipient.id,
    email: recipientEmail,
    name: text(recipient.name, 120) || task.assigneeName || task.assigneeId,
    status: recipient.status
  };
}

function dismissTaskFollowups(doc, taskId, reason, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const active = new Set(["pending", "draft_ready", "approved", "queued", "sending", "failed"]);
  const kinds = Array.isArray(options.kinds) ? new Set(options.kinds) : null;
  let dismissed = 0;
  const followups = doc.followups.map(item => {
    if (item.taskId !== taskId || !active.has(item.status) || (kinds && !kinds.has(item.kind))) return item;
    if (item.status === "sending" && item.providerSubmissionStartedAt) return item;
    dismissed += 1;
    return {
      ...item,
      status: "dismissed",
      dismissedAt: now,
      dismissedBy: options.actorId ?? "automation",
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      providerSubmissionStartedAt: null,
      automationJobId: null,
      lastError: text(reason, 1000),
      updatedAt: now
    };
  });
  return dismissed ? { doc: { ...doc, lastUpdated: now, followups }, dismissed } : { doc, dismissed: 0 };
}

export function createOutreachProspect(docInput, input, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const organizationName = text(input?.organizationName, 160);
  if (!organizationName) return { ok: false, error: "Organization name is required." };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const contactEmail = email(input?.contactEmail);
  const website = text(input?.website, 500);
  if (website && !/^https?:\/\//i.test(website)) return { ok: false, error: "Website must begin with http:// or https://." };
  const duplicate = doc.prospects.find(item =>
    (contactEmail && String(item.contactEmail || "").toLowerCase() === contactEmail) ||
    (item.organizationName?.toLowerCase() === organizationName.toLowerCase() && text(item.city, 100).toLowerCase() === text(input?.city, 100).toLowerCase())
  );
  if (duplicate) return { ok: false, duplicate: true, existingProspect: duplicate, error: `Prospect already exists as ${duplicate.organizationName}.` };
  const location = outreachLocation(input);
  if (!location.ok) return location;
  const contactBasis = text(input?.contactBasis ?? input?.consentBasis, 80);
  if (contactBasis && !CONTACT_BASES.has(contactBasis)) return { ok: false, error: "Choose a valid contact basis." };
  const nextActionAt = outreachNextActionAt(input?.nextActionAt);
  if (!nextActionAt.ok) return nextActionAt;
  const prospectBase = {
    id: idFactory("prospect"), organizationName, website, industry: text(input?.industry, 100),
    city: location.city, state: location.state, postalCode: location.postalCode,
    latitude: location.latitude,
    longitude: location.longitude,
    contactName: text(input?.contactName, 120), contactEmail,
    status: PROSPECT_STATUSES.has(input?.status) ? input.status : "identified",
    communityFit: input?.communityFit === true,
    ownerId: text(input?.ownerId, 100) || null,
    nextAction: text(input?.nextAction, 300) || "Research decision maker",
    nextActionAt: nextActionAt.value ?? null,
    contactBasis: contactBasis || null, tags: list(input?.tags),
    source: text(input?.source, 80) || "manual",
    sourceBatch: text(input?.sourceBatch, 100) || null,
    sourceRow: Number.isInteger(Number(input?.sourceRow)) && Number(input.sourceRow) > 0 ? Number(input.sourceRow) : null,
    sourceRef: text(input?.sourceRef, 160) || null,
    sourceUrl: text(input?.sourceUrl, 500) || null,
    sourceLicense: text(input?.sourceLicense, 160) || null,
    sourceFetchedAt: iso(input?.sourceFetchedAt),
    suppressedAt: null, suppressionReason: null,
    createdAt: now, updatedAt: now
  };
  const prospect = { ...prospectBase, ...outreachFit(prospectBase, options) };
  return {
    ok: true,
    prospect,
    doc: {
      ...doc,
      lastUpdated: now,
      prospects: [...doc.prospects, prospect],
      activity: [...doc.activity, activity(idFactory, "outreach.prospect.created", "prospect", prospect.id, now, options.actorId ?? "admin", { fitScore: prospect.fitScore })].slice(-1000)
    }
  };
}

export function updateOutreachProspect(docInput, prospectId, patch, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.prospects.findIndex(item => item.id === prospectId);
  if (index < 0) return { ok: false, error: "Prospect not found." };
  const current = doc.prospects[index];
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const status = patch.status === undefined ? current.status : text(patch.status, 40);
  if (!PROSPECT_STATUSES.has(status)) return { ok: false, error: "Invalid prospect status." };
  const contactBasis = patch.contactBasis === undefined ? current.contactBasis : text(patch.contactBasis, 80) || null;
  if (contactBasis && !CONTACT_BASES.has(contactBasis)) return { ok: false, error: "Choose a valid contact basis." };
  const suppressing = patch.suppressed === true || status === "do_not_contact";
  const unsuppressing = patch.suppressed === false;
  const suppressionReason = suppressing ? text(patch.suppressionReason, 300) : current.suppressionReason;
  if (suppressing && !suppressionReason) return { ok: false, error: "A suppression reason is required." };
  const location = outreachLocation(patch, current);
  if (!location.ok) return location;
  const website = patch.website === undefined ? current.website : text(patch.website, 500);
  if (website && !/^https?:\/\//i.test(website)) return { ok: false, error: "Website must begin with http:// or https://." };
  const nextActionAt = outreachNextActionAt(patch.nextActionAt);
  if (!nextActionAt.ok) return nextActionAt;
  const prospectBase = {
    ...current,
    status: suppressing ? "do_not_contact" : unsuppressing && status === "do_not_contact" ? "researching" : status,
    industry: patch.industry === undefined ? current.industry : text(patch.industry, 100),
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    latitude: location.latitude,
    longitude: location.longitude,
    website,
    communityFit: patch.communityFit === undefined ? current.communityFit === true : patch.communityFit === true,
    contactName: patch.contactName === undefined ? current.contactName : text(patch.contactName, 120),
    contactEmail: patch.contactEmail === undefined ? current.contactEmail : email(patch.contactEmail),
    contactBasis,
    ownerId: patch.ownerId === undefined ? current.ownerId : text(patch.ownerId, 100) || null,
    nextAction: patch.nextAction === undefined ? current.nextAction : text(patch.nextAction, 300),
    nextActionAt: nextActionAt.value === undefined ? current.nextActionAt ?? null : nextActionAt.value,
    suppressedAt: suppressing ? current.suppressedAt || now : unsuppressing ? null : current.suppressedAt,
    suppressionReason: suppressing ? suppressionReason : unsuppressing ? null : current.suppressionReason,
    updatedAt: now
  };
  const prospect = { ...prospectBase, ...outreachFit(prospectBase, options) };
  if (patch.contactEmail !== undefined && patch.contactEmail && !prospect.contactEmail) return { ok: false, error: "Enter a valid contact email." };
  const prospects = doc.prospects.slice();
  prospects[index] = prospect;
  const prospectDoc = { ...doc, prospects };
  const activeFollowups = new Set(["pending", "draft_ready", "approved", "queued", "sending", "failed"]);
  const followups = doc.followups.map(item => {
    if (item.prospectId !== prospectId || !activeFollowups.has(item.status)) return item;
    if (item.status === "sending" && item.providerSubmissionStartedAt) return item;
    const campaign = doc.campaigns.find(candidate => candidate.id === item.campaignId);
    const stillMatches = campaign && matchOutreachProspects(prospectDoc, campaign).some(candidate => candidate.id === prospectId);
    const recipientMatches = String(item.recipient || "").toLowerCase() === String(prospect.contactEmail || "").toLowerCase();
    if (!suppressing && stillMatches && recipientMatches) return item;
    return {
      ...item,
      status: "dismissed",
      dismissedBy: options.actorId ?? "admin",
      dismissedAt: now,
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      providerSubmissionStartedAt: null,
      automationJobId: null,
      lastError: suppressing ? "Recipient suppressed before delivery." : "Prospect no longer matches the current campaign targeting or recipient.",
      updatedAt: now
    };
  });
  return {
    ok: true,
    prospect,
    doc: {
      ...doc,
      lastUpdated: now,
      prospects,
      followups,
      activity: [...doc.activity, activity(idFactory, suppressing ? "outreach.prospect.suppressed" : "outreach.prospect.updated", "prospect", prospectId, now, options.actorId ?? "admin", {
        status: prospect.status,
        ownerId: prospect.ownerId,
        nextActionAt: prospect.nextActionAt
      })].slice(-1000)
    }
  };
}

export function createOutreachSponsorInvitation(docInput, prospectId, sponsorPackage, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.prospects.findIndex(item => item.id === prospectId);
  if (index < 0) return { ok: false, error: "Prospect not found." };
  const current = doc.prospects[index];
  if (current.convertedApplicationId) return { ok: false, error: "Prospect is already linked to a sponsor application." };
  if (current.suppressedAt || !OUTREACH_ELIGIBLE_STATUSES.has(current.status)) {
    return { ok: false, error: "Qualify this prospect before creating a sponsor invitation." };
  }
  if (!current.contactName || !current.contactEmail || !current.contactBasis) {
    return { ok: false, error: "Verify the decision maker, business email, and contact basis first." };
  }
  const packageId = text(sponsorPackage?.id, 100);
  const packageName = text(sponsorPackage?.name, 120);
  if (!packageId || !packageName) return { ok: false, error: "Choose an active sponsorship package." };
  if (doc.followups.some(item => item.prospectId === prospectId && item.kind === "sponsor_outreach" && ["queued", "sending"].includes(item.status))) {
    return { ok: false, error: "A sponsor message is already queued. Wait for delivery to finish before replacing its invitation." };
  }
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, error: "Invitation issue time is invalid." };
  const ttlMs = Math.max(24 * 60 * 60 * 1000, Math.min(45 * 24 * 60 * 60 * 1000, Number(options.ttlMs) || 30 * 24 * 60 * 60 * 1000));
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const invitation = {
    packageId,
    packageName,
    version: Number(current.sponsorInvitation?.version || 0) + 1,
    issuedAt: now,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    issuedBy: text(options.actorId, 100) || "admin"
  };
  const prospect = { ...current, sponsorInvitation: invitation, updatedAt: now };
  const invitationUrl = text(options.invitationUrlForProspect?.(prospect), 2000);
  if (!invitationUrl) return { ok: false, providerNotReady: true, error: "Sponsor invitation links are not configured." };
  const prospects = doc.prospects.slice();
  prospects[index] = prospect;
  let refreshedDrafts = 0;
  const followups = doc.followups.map(item => {
    if (item.prospectId !== prospectId || item.kind !== "sponsor_outreach" || !["draft_ready", "approved", "failed"].includes(item.status)) return item;
    const withoutPrevious = item.sponsorInvitationUrl
      ? String(item.body || "").replace(`\n\nReview sponsorship options: ${item.sponsorInvitationUrl}`, "")
      : String(item.body || "");
    refreshedDrafts += 1;
    return {
      ...item,
      status: "draft_ready",
      body: text(`${withoutPrevious}\n\nReview sponsorship options: ${invitationUrl}`, 7500),
      sponsorInvitationUrl: invitationUrl,
      sponsorInvitationVersion: invitation.version,
      approvedBy: null,
      approvedAt: null,
      queuedAt: null,
      lastError: item.status === "draft_ready" ? null : "Sponsor invitation changed; message returned to review.",
      updatedAt: now
    };
  });
  return {
    ok: true,
    prospect,
    invitation,
    invitationUrl,
    refreshedDrafts,
    doc: {
      ...doc,
      lastUpdated: now,
      prospects,
      followups,
      activity: [...doc.activity, activity(idFactory, "outreach.sponsor_invitation.issued", "prospect", prospectId, now, options.actorId ?? "admin", { packageId, invitationVersion: invitation.version, refreshedDrafts })].slice(-1000)
    }
  };
}

export function revokeOutreachSponsorInvitation(docInput, prospectId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.prospects.findIndex(item => item.id === prospectId);
  if (index < 0) return { ok: false, error: "Prospect not found." };
  const current = doc.prospects[index];
  if (!current.sponsorInvitation) return { ok: true, changed: false, prospect: current, dismissedDrafts: 0, doc };
  if (doc.followups.some(item => item.prospectId === prospectId && item.kind === "sponsor_outreach" && ["queued", "sending"].includes(item.status))) {
    return { ok: false, error: "A sponsor message is already queued. Wait for delivery to finish before revoking its invitation." };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const prospect = { ...current, sponsorInvitation: null, updatedAt: now };
  const prospects = doc.prospects.slice();
  prospects[index] = prospect;
  let dismissedDrafts = 0;
  const followups = doc.followups.map(item => {
    if (item.prospectId !== prospectId || item.kind !== "sponsor_outreach" || !item.sponsorInvitationUrl || !["draft_ready", "approved", "failed"].includes(item.status)) return item;
    dismissedDrafts += 1;
    return { ...item, status: "dismissed", lastError: "Sponsor invitation revoked before delivery.", updatedAt: now };
  });
  return {
    ok: true,
    changed: true,
    prospect,
    dismissedDrafts,
    doc: {
      ...doc,
      lastUpdated: now,
      prospects,
      followups,
      activity: [...doc.activity, activity(idFactory, "outreach.sponsor_invitation.revoked", "prospect", prospectId, now, options.actorId ?? "admin", { dismissedDrafts })].slice(-1000)
    }
  };
}

export function createSponsorApplicationFromOutreachInvitation(docInput, prospectId, input, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const prospect = doc.prospects.find(item => item.id === prospectId);
  if (!prospect) return { ok: false, error: "Sponsor invitation is invalid." };
  if (prospect.convertedApplicationId) {
    const application = doc.applications.find(item => item.id === prospect.convertedApplicationId);
    return application ? { ok: true, changed: false, duplicate: true, application, followup: doc.followups.find(item => item.applicationId === application.id && item.kind === "application_received") ?? null, prospect, doc } : { ok: false, error: "Converted sponsor application could not be found." };
  }
  const invitation = prospect.sponsorInvitation;
  const now = options.now ?? new Date().toISOString();
  if (!invitation || invitation.packageId !== text(options.packageId, 100) || Number(invitation.version) !== Number(options.invitationVersion)) {
    return { ok: false, error: "Sponsor invitation is invalid or has been replaced." };
  }
  const expiresAtMs = new Date(invitation.expiresAt).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs) return { ok: false, error: "Sponsor invitation expired." };
  if (prospect.suppressedAt || !OUTREACH_ELIGIBLE_STATUSES.has(prospect.status)) return { ok: false, error: "Sponsor invitation is no longer active." };
  if (email(input?.contactEmail) !== email(prospect.contactEmail)) return { ok: false, error: "Use the business email that received this sponsor invitation." };
  if (text(input?.organizationName, 160).toLowerCase() !== text(prospect.organizationName, 160).toLowerCase()) return { ok: false, error: "Use the invited business name or ask SandFest staff to update the prospect record." };
  const created = createPartnerApplication(doc, {
    ...input,
    type: "sponsor",
    packageId: invitation.packageId,
    packageName: invitation.packageName,
    outreachProspectId: prospect.id,
    source: "outreach_invitation",
    tags: [...list(input?.tags), "outreach_conversion"]
  }, options);
  if (!created.ok) return created;
  const convertedAt = now;
  const convertedProspect = {
    ...prospect,
    status: "won",
    convertedApplicationId: created.application.id,
    convertedAt,
    nextAction: `Review sponsor application ${created.application.reference}`,
    sponsorInvitation: { ...invitation, convertedAt },
    updatedAt: now
  };
  const prospects = created.doc.prospects.map(item => item.id === prospect.id ? convertedProspect : item);
  const activeFollowups = new Set(["pending", "draft_ready", "approved", "queued", "failed"]);
  const followups = created.doc.followups.map(item => item.prospectId === prospect.id && item.kind === "sponsor_outreach" && activeFollowups.has(item.status)
    ? { ...item, status: "dismissed", lastError: "Prospect submitted a sponsor application.", updatedAt: now }
    : item);
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  return {
    ...created,
    changed: true,
    prospect: convertedProspect,
    doc: {
      ...created.doc,
      lastUpdated: now,
      prospects,
      followups,
      activity: [...created.doc.activity, activity(idFactory, "outreach.prospect.converted", "prospect", prospect.id, now, "public", { applicationId: created.application.id, packageId: invitation.packageId })].slice(-1000)
    }
  };
}

function templateError(value) {
  const matches = String(value || "").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g);
  const invalid = [...matches].map(match => match[1]).find(field => !TEMPLATE_FIELDS.has(field));
  return invalid ? `Unsupported template field: {{${invalid}}}.` : null;
}

function renderOutreachTemplate(value, prospect) {
  const fields = {
    organization: prospect.organizationName,
    contactName: prospect.contactName || "there",
    city: prospect.city || "the Coastal Bend",
    state: prospect.state || "Texas",
    industry: prospect.industry || "business"
  };
  return String(value || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, field) => fields[field] || "");
}

function normalizeCampaignSequence(input) {
  const source = Array.isArray(input) ? input : [];
  if (!source.length || source.length > 4) return { error: "Campaigns require one to four message steps." };
  const sequence = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const subjectTemplate = text(item.subjectTemplate, 180);
    const bodyTemplate = text(item.bodyTemplate, 5000);
    if (!subjectTemplate || !bodyTemplate) return { error: `Message ${index + 1} requires a subject and body.` };
    const invalid = templateError(subjectTemplate) || templateError(bodyTemplate);
    if (invalid) return { error: invalid };
    const delayDays = index === 0 ? 0 : Math.max(1, Math.min(90, Math.round(Number(item.delayDays) || 0)));
    sequence.push({ id: `step_${index + 1}`, order: index + 1, delayDays, subjectTemplate, bodyTemplate });
  }
  return { sequence };
}

export function createOutreachCampaign(docInput, input, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const name = text(input?.name, 160);
  if (!name) return { ok: false, error: "Campaign name is required." };
  if (doc.campaigns.some(item => item.name.toLowerCase() === name.toLowerCase() && item.status !== "archived")) {
    return { ok: false, error: "An active campaign already uses that name." };
  }
  const normalizedSequence = normalizeCampaignSequence(input?.sequence);
  if (normalizedSequence.error) return { ok: false, error: normalizedSequence.error };
  const geofence = campaignGeofence(input?.targeting);
  if (!geofence.ok) return geofence;
  const postalCodes = [];
  for (const value of list(input?.targeting?.postalCodes, 50)) {
    const parsed = outreachPostalCode(value);
    if (!parsed.ok) return parsed;
    if (!postalCodes.includes(parsed.value)) postalCodes.push(parsed.value);
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const campaign = {
    id: idFactory("campaign"),
    name,
    objective: text(input?.objective, 500),
    status: "draft",
    targeting: {
      industries: list(input?.targeting?.industries, 30).map(item => item.toLowerCase()),
      cities: list(input?.targeting?.cities, 30).map(item => item.toLowerCase()),
      states: list(input?.targeting?.states, 20).map(item => item.toLowerCase()),
      postalCodes,
      geofence: geofence.value,
      minFitScore: Math.max(0, Math.min(100, Math.round(Number(input?.targeting?.minFitScore) || 0)))
    },
    sequence: normalizedSequence.sequence,
    deliveryMode: OUTREACH_CAMPAIGN_DELIVERY_MODES.has(input?.deliveryMode) ? input.deliveryMode : "review_first",
    dailySendLimit: Math.max(1, Math.min(100, Math.round(Number(input?.dailySendLimit) || 25))),
    ownerId: text(input?.ownerId, 100) || null,
    approvedBy: null,
    approvedAt: null,
    activatedAt: null,
    pausedAt: null,
    completedAt: null,
    lastGeneratedAt: null,
    createdAt: now,
    updatedAt: now
  };
  return {
    ok: true,
    campaign,
    doc: {
      ...doc,
      lastUpdated: now,
      campaigns: [...doc.campaigns, campaign],
      activity: [...doc.activity, activity(idFactory, "outreach.campaign.created", "campaign", campaign.id, now, options.actorId ?? "admin")].slice(-1000)
    }
  };
}

export function matchOutreachProspects(docInput, campaignOrId) {
  const doc = normalizePartnerOperations(docInput);
  const campaign = typeof campaignOrId === "string" ? doc.campaigns.find(item => item.id === campaignOrId) : campaignOrId;
  if (!campaign) return [];
  const target = campaign.targeting || {};
  const industries = new Set((target.industries || []).map(item => String(item).toLowerCase()));
  const cities = new Set((target.cities || []).map(item => String(item).toLowerCase()));
  const states = new Set((target.states || []).map(item => String(item).toLowerCase()));
  const postalCodes = new Set((target.postalCodes || []).map(item => String(item).toUpperCase()));
  const geofence = target.geofence || null;
  return doc.prospects.filter(prospect => {
    if (!OUTREACH_ELIGIBLE_STATUSES.has(prospect.status)) return false;
    if (!prospect.contactEmail || !prospect.contactBasis || prospect.suppressedAt) return false;
    if (Number(prospect.fitScore || 0) < Number(target.minFitScore || 0)) return false;
    if (industries.size && ![...industries].some(value => String(prospect.industry || "").toLowerCase().includes(value))) return false;
    if (cities.size && !cities.has(String(prospect.city || "").toLowerCase())) return false;
    if (states.size && !states.has(String(prospect.state || "").toLowerCase())) return false;
    const prospectPostalCode = String(prospect.postalCode || "").toUpperCase();
    if (postalCodes.size && !postalCodes.has(prospectPostalCode) && !postalCodes.has(prospectPostalCode.slice(0, 5))) return false;
    if (geofence) {
      const distance = outreachDistanceMiles(prospect.latitude, prospect.longitude, geofence.latitude, geofence.longitude);
      if (distance === null || distance > Number(geofence.radiusMiles)) return false;
    }
    return true;
  });
}

export function updateOutreachCampaignStatus(docInput, campaignId, action, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.campaigns.findIndex(item => item.id === campaignId);
  if (index < 0) return { ok: false, error: "Campaign not found." };
  const current = doc.campaigns[index];
  if (!CAMPAIGN_STATUSES.has(current.status)) return { ok: false, error: "Campaign has an invalid status." };
  const transitions = {
    activate: { from: new Set(["draft", "paused"]), to: "active" },
    pause: { from: new Set(["active"]), to: "paused" },
    complete: { from: new Set(["active", "paused"]), to: "complete" },
    archive: { from: new Set(["draft", "paused", "complete"]), to: "archived" }
  };
  const transition = transitions[action];
  if (!transition || !transition.from.has(current.status)) return { ok: false, error: `Campaign cannot ${action || "change"} from ${current.status}.` };
  if (action === "activate" && matchOutreachProspects(doc, current).length === 0) {
    return { ok: false, error: "No eligible prospects match this campaign. Qualify a prospect and document its contact basis first." };
  }
  if (action === "activate" && current.deliveryMode === "approved_sequence" && options.providerReady !== true) {
    return { ok: false, providerNotReady: true, error: "Transactional email and delivery tracking must be ready before activating an automated outreach sequence." };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const campaign = {
    ...current,
    status: transition.to,
    approvedBy: action === "activate" ? options.actorId ?? "admin" : current.approvedBy,
    approvedAt: action === "activate" ? now : current.approvedAt,
    activatedAt: action === "activate" ? now : current.activatedAt,
    pausedAt: action === "pause" ? now : current.pausedAt,
    completedAt: action === "complete" ? now : current.completedAt,
    updatedAt: now
  };
  const campaigns = doc.campaigns.slice();
  campaigns[index] = campaign;
  let returnedToReview = 0;
  let dismissedFollowups = 0;
  let failedHeldForRetry = 0;
  const inFlightFollowups = doc.followups.filter(item => item.campaignId === campaignId && item.status === "sending").length;
  const activeUnsentStatuses = new Set(["pending", "draft_ready", "approved", "queued", "failed"]);
  const followups = action === "pause" || action === "complete" || action === "archive"
    ? doc.followups.map(item => {
      if (item.campaignId !== campaignId || !activeUnsentStatuses.has(item.status)) return item;
      if (action === "pause") {
        if (item.status === "draft_ready" || item.status === "pending") return item;
        if (item.status === "failed") {
          failedHeldForRetry += 1;
          return {
            ...item,
            approvedBy: null,
            approvedAt: null,
            automationPolicy: null,
            automationDecision: "manual_retry_required",
            automationApprovedAt: null,
            automationCampaignApprovedAt: null,
            automationJobId: null,
            updatedAt: now
          };
        }
        returnedToReview += 1;
        return {
          ...item,
          status: "draft_ready",
          approvedBy: null,
          approvedAt: null,
          automationPolicy: null,
          automationDecision: "returned_to_review",
          automationApprovedAt: null,
          automationCampaignApprovedAt: null,
          automationJobId: null,
          queuedAt: null,
          lastError: "Campaign paused before delivery.",
          updatedAt: now
        };
      }
      dismissedFollowups += 1;
      return {
        ...item,
        status: "dismissed",
        dismissedAt: now,
        dismissedBy: options.actorId ?? "admin",
        lastError: `Campaign ${action === "complete" ? "completed" : "archived"} before delivery.`,
        updatedAt: now
      };
    })
    : doc.followups;
  return {
    ok: true,
    campaign,
    returnedToReview,
    dismissedFollowups,
    failedHeldForRetry,
    inFlightFollowups,
    doc: {
      ...doc,
      lastUpdated: now,
      campaigns,
      followups,
      activity: [...doc.activity, activity(idFactory, `outreach.campaign.${action}`, "campaign", campaignId, now, options.actorId ?? "admin", { returnedToReview, dismissedFollowups, failedHeldForRetry, inFlightFollowups })].slice(-1000)
    }
  };
}

export function generateDueOutreachFollowups(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const campaigns = doc.campaigns.filter(item => item.status === "active" && (!options.campaignId || item.id === options.campaignId));
  const generated = [];
  for (const campaign of campaigns) {
    for (const prospect of matchOutreachProspects(doc, campaign)) {
      for (let index = 0; index < campaign.sequence.length; index += 1) {
        const step = campaign.sequence[index];
        const existing = [...doc.followups, ...generated].find(item => item.campaignId === campaign.id && item.prospectId === prospect.id && item.sequenceStepId === step.id);
        if (existing) continue;
        const previous = index === 0 ? null : [...doc.followups, ...generated].find(item => item.campaignId === campaign.id && item.prospectId === prospect.id && item.sequenceStepId === campaign.sequence[index - 1].id);
        if (index > 0) {
          if (!previous?.sentAt || previous.status !== "sent") break;
          const dueMs = new Date(previous.sentAt).getTime() + step.delayDays * 86_400_000;
          if (!Number.isFinite(dueMs) || dueMs > nowMs) break;
        }
        const preferenceUrl = options.preferenceUrlForProspect?.(prospect) || null;
        const sponsorInvitationUrl = options.sponsorInvitationUrlForProspect?.(prospect) || null;
        const renderedBody = text(renderOutreachTemplate(step.bodyTemplate, prospect), 5000);
        const invitationBody = sponsorInvitationUrl
          ? text(`${renderedBody}\n\nReview sponsorship options: ${sponsorInvitationUrl}`, 6500)
          : renderedBody;
        generated.push({
          id: idFactory("followup"),
          applicationId: null,
          prospectId: prospect.id,
          campaignId: campaign.id,
          sequenceStepId: step.id,
          kind: "sponsor_outreach",
          channel: "email",
          recipient: prospect.contactEmail,
          recipientName: prospect.contactName,
          contactBasis: prospect.contactBasis,
          status: "draft_ready",
          dueAt: now,
          subject: text(renderOutreachTemplate(step.subjectTemplate, prospect), 180),
          body: preferenceUrl
            ? text(`${invitationBody}\n\nManage sponsor outreach preferences: ${preferenceUrl}`, 7500)
            : invitationBody,
          sponsorInvitationUrl,
          sponsorInvitationVersion: sponsorInvitationUrl ? Number(prospect.sponsorInvitation?.version || 1) : null,
          approvedBy: null,
          approvedAt: null,
          sentAt: null,
          queuedAt: null,
          provider: null,
          providerMessageId: null,
          deliveryAttempts: 0,
          lastAttemptAt: null,
          lastError: null,
          generatedAt: now,
          createdAt: now,
          updatedAt: now
        });
        break;
      }
    }
  }
  if (!generated.length) return { ok: true, changed: false, generated: [], doc };
  const generatedCampaignIds = new Set(generated.map(item => item.campaignId));
  const nextCampaigns = doc.campaigns.map(item => generatedCampaignIds.has(item.id) ? { ...item, lastGeneratedAt: now, updatedAt: now } : item);
  const activityRecords = generated.map(item => activity(idFactory, "outreach.followup.generated", "followup", item.id, now, "automation", { campaignId: item.campaignId, prospectId: item.prospectId, sequenceStepId: item.sequenceStepId }));
  return {
    ok: true,
    changed: true,
    generated,
    doc: { ...doc, lastUpdated: now, campaigns: nextCampaigns, followups: [...doc.followups, ...generated], activity: [...doc.activity, ...activityRecords].slice(-1000) }
  };
}

export function outreachCampaignMetrics(docInput, campaign) {
  const doc = normalizePartnerOperations(docInput);
  const messages = doc.followups.filter(item => item.campaignId === campaign.id);
  return {
    matched: matchOutreachProspects(doc, campaign).length,
    drafts: messages.filter(item => item.status === "draft_ready").length,
    approved: messages.filter(item => ["approved", "queued", "sending"].includes(item.status)).length,
    inFlight: messages.filter(item => item.status === "sending").length,
    sent: messages.filter(item => item.status === "sent").length,
    automated: messages.filter(item => item.automationPolicy === OUTREACH_CAMPAIGN_AUTOMATION_POLICY).length,
    failed: messages.filter(item => item.status === "failed").length,
    dismissed: messages.filter(item => item.status === "dismissed").length
  };
}

function milestoneScheduleVersion(item) {
  return Math.max(1, Math.round(Number(item?.scheduleVersion || 1)));
}

function milestoneSourcePrefix(item) {
  return `schedule:${milestoneScheduleVersion(item)}:`;
}

function dismissMilestoneFollowups(doc, milestoneId, reason, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const active = new Set(["pending", "draft_ready", "approved", "queued", "failed"]);
  let dismissed = 0;
  const followups = doc.followups.map(item => {
    if (item.milestoneId !== milestoneId || !active.has(item.status)) return item;
    dismissed += 1;
    return {
      ...item,
      status: "dismissed",
      dismissedAt: now,
      dismissedBy: options.actorId ?? "automation",
      lastError: text(reason, 1000),
      updatedAt: now
    };
  });
  return dismissed ? { doc: { ...doc, lastUpdated: now, followups }, dismissed } : { doc, dismissed: 0 };
}

function isPaymentMilestone(item) {
  if (item?.kind === "payment_due") return true;
  return !item?.kind
    && !item?.source
    && text(item?.label, 160).toLowerCase() === "payment due";
}

function reconcilePaymentMilestones(docInput, applicationId, totalPaidCents, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { doc, completed: [], reopened: [], dismissedFollowups: 0 };
  const expectedAmountCents = cents(application.expectedAmountCents || application.requestedAmountCents);
  const paidInFull = expectedAmountCents > 0 && cents(totalPaidCents) >= expectedAmountCents;
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const actorId = options.actorId ?? "automation:payment_reconciliation";
  const automationActor = "automation:payment_reconciliation";
  const completed = [];
  const reopened = [];
  const milestones = doc.milestones.map(item => {
    if (item.applicationId !== applicationId || !isPaymentMilestone(item)) return item;
    if (paidInFull && item.status === "open") {
      completed.push(item.id);
      return {
        ...item,
        kind: "payment_due",
        source: item.source || "application_intake",
        status: "completed",
        completedAt: now,
        completedBy: automationActor,
        cancelledAt: null,
        cancelledBy: null,
        updatedAt: now
      };
    }
    if (!paidInFull && item.status === "completed" && item.completedBy === automationActor) {
      reopened.push(item.id);
      return {
        ...item,
        kind: "payment_due",
        source: item.source || "application_intake",
        status: "open",
        scheduleVersion: milestoneScheduleVersion(item) + 1,
        completedAt: null,
        completedBy: null,
        updatedAt: now
      };
    }
    return item;
  });
  if (!completed.length && !reopened.length) {
    return { doc, completed, reopened, dismissedFollowups: 0 };
  }
  const transitions = [
    ...completed.map(milestoneId => ({ milestoneId, transition: "completed" })),
    ...reopened.map(milestoneId => ({ milestoneId, transition: "reopened" }))
  ];
  let nextDoc = {
    ...doc,
    lastUpdated: now,
    milestones,
    activity: [
      ...doc.activity,
      ...transitions.map(item => activity(
        idFactory,
        "milestone.payment_reconciled",
        "milestone",
        item.milestoneId,
        now,
        actorId,
        { applicationId, transition: item.transition, expectedAmountCents, totalPaidCents: cents(totalPaidCents) }
      ))
    ].slice(-1000)
  };
  let dismissedFollowups = 0;
  for (const item of transitions) {
    const dismissed = dismissMilestoneFollowups(
      nextDoc,
      item.milestoneId,
      item.transition === "completed" ? "Payment received in full." : "Payment balance reopened after a reversal or refund.",
      { now, actorId: automationActor }
    );
    nextDoc = dismissed.doc;
    dismissedFollowups += dismissed.dismissed;
  }
  return { doc: nextDoc, completed, reopened, dismissedFollowups };
}

function syncInvoicePaymentMilestone(docInput, applicationId, dueAt, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const actorId = options.actorId ?? "admin";
  const current = doc.milestones.find(item => item.applicationId === applicationId && isPaymentMilestone(item));
  if (!current) {
    const created = milestone(idFactory, applicationId, "Payment due", dueAt, now, "finance", {
      source: "invoice",
      kind: "payment_due"
    });
    return {
      milestone: created,
      created: true,
      changed: true,
      dismissedFollowups: 0,
      doc: {
        ...doc,
        lastUpdated: now,
        milestones: [...doc.milestones, created],
        activity: [...doc.activity, activity(
          idFactory,
          "milestone.invoice_due_created",
          "milestone",
          created.id,
          now,
          actorId,
          { applicationId, dueAt }
        )].slice(-1000)
      }
    };
  }
  const changed = iso(current.dueAt) !== dueAt || current.kind !== "payment_due" || !current.source;
  if (!changed) return { milestone: current, created: false, changed: false, dismissedFollowups: 0, doc };
  const item = {
    ...current,
    source: current.source || "application_intake",
    kind: "payment_due",
    dueAt,
    scheduleVersion: iso(current.dueAt) !== dueAt ? milestoneScheduleVersion(current) + 1 : milestoneScheduleVersion(current),
    updatedAt: now
  };
  const milestones = doc.milestones.map(milestoneItem => milestoneItem.id === item.id ? item : milestoneItem);
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    milestones,
    activity: [...doc.activity, activity(
      idFactory,
      "milestone.invoice_due_synced",
      "milestone",
      item.id,
      now,
      actorId,
      { applicationId, previousDueAt: current.dueAt, dueAt, scheduleVersion: item.scheduleVersion }
    )].slice(-1000)
  };
  const dismissed = iso(current.dueAt) !== dueAt
    ? dismissMilestoneFollowups(baseDoc, item.id, "Invoice due date changed.", { now, actorId })
    : { doc: baseDoc, dismissed: 0 };
  return { milestone: item, created: false, changed: true, dismissedFollowups: dismissed.dismissed, doc: dismissed.doc };
}

function milestoneInput(input = {}, current = {}) {
  const label = input.label === undefined ? text(current.label, 160) : text(input.label, 160);
  if (!label) return { ok: false, error: "Milestone label is required." };
  const dueAt = input.dueAt === undefined ? iso(current.dueAt) : iso(input.dueAt);
  if (!dueAt) return { ok: false, error: "Milestone due date must be a valid date and time." };
  const status = input.status === undefined ? current.status || "open" : text(input.status, 20).toLowerCase();
  if (!MILESTONE_STATUSES.has(status)) return { ok: false, error: "Milestone status must be open, completed, or cancelled." };
  const assigneeTeam = input.assigneeTeam === undefined ? current.assigneeTeam || "operations" : text(input.assigneeTeam, 40).toLowerCase();
  if (!MILESTONE_TEAMS.has(assigneeTeam)) return { ok: false, error: "Choose a valid SandFest team for this milestone." };
  const reminderLeadDaysValue = input.reminderLeadDays === undefined ? Number(current.reminderLeadDays ?? 3) : Number(input.reminderLeadDays);
  if (!Number.isInteger(reminderLeadDaysValue) || reminderLeadDaysValue < 0 || reminderLeadDaysValue > 30) {
    return { ok: false, error: "Reminder lead time must be a whole number from 0 to 30 days." };
  }
  return {
    ok: true,
    label,
    dueAt,
    status,
    assigneeTeam,
    reminderLeadDays: reminderLeadDaysValue,
    notes: input.notes === undefined ? text(current.notes, 1000) : text(input.notes, 1000)
  };
}

export function createPartnerMilestone(docInput, applicationId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const application = doc.applications.find(item => item.id === applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  const parsed = milestoneInput({
    ...input,
    status: "open",
    assigneeTeam: input.assigneeTeam || (application.type === "sponsor" ? "sponsor" : "operations")
  });
  if (!parsed.ok) return parsed;
  const fields = {
    label: parsed.label,
    dueAt: parsed.dueAt,
    status: parsed.status,
    assigneeTeam: parsed.assigneeTeam,
    reminderLeadDays: parsed.reminderLeadDays,
    notes: parsed.notes
  };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const item = {
    id: idFactory("milestone"),
    applicationId,
    source: "custom",
    ...fields,
    scheduleVersion: 1,
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    createdAt: now,
    updatedAt: now
  };
  return {
    ok: true,
    milestone: item,
    doc: {
      ...doc,
      lastUpdated: now,
      milestones: [...doc.milestones, item],
      activity: [...doc.activity, activity(idFactory, "milestone.created", "milestone", item.id, now, options.actorId ?? "admin", { applicationId, dueAt: item.dueAt })].slice(-1000)
    }
  };
}

export function updatePartnerMilestone(docInput, milestoneId, input = {}, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.milestones.findIndex(item => item.id === milestoneId);
  if (index < 0) return { ok: false, error: "Milestone not found." };
  const current = doc.milestones[index];
  const parsed = milestoneInput(input, current);
  if (!parsed.ok) return parsed;
  const fields = {
    label: parsed.label,
    dueAt: parsed.dueAt,
    status: parsed.status,
    assigneeTeam: parsed.assigneeTeam,
    reminderLeadDays: parsed.reminderLeadDays,
    notes: parsed.notes
  };
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const actorId = options.actorId ?? "admin";
  const scheduleChanged = parsed.dueAt !== iso(current.dueAt)
    || parsed.label !== current.label
    || parsed.reminderLeadDays !== Number(current.reminderLeadDays ?? 3)
    || (parsed.status === "open" && current.status !== "open");
  const item = {
    ...current,
    ...fields,
    scheduleVersion: scheduleChanged ? milestoneScheduleVersion(current) + 1 : milestoneScheduleVersion(current),
    completedAt: parsed.status === "completed" ? current.completedAt ?? now : null,
    completedBy: parsed.status === "completed" ? current.completedBy ?? actorId : null,
    cancelledAt: parsed.status === "cancelled" ? current.cancelledAt ?? now : null,
    cancelledBy: parsed.status === "cancelled" ? current.cancelledBy ?? actorId : null,
    updatedAt: now
  };
  const milestones = doc.milestones.slice();
  milestones[index] = item;
  const baseDoc = {
    ...doc,
    lastUpdated: now,
    milestones,
    activity: [...doc.activity, activity(idFactory, "milestone.updated", "milestone", milestoneId, now, actorId, {
      fromStatus: current.status,
      toStatus: item.status,
      dueAt: item.dueAt,
      scheduleChanged,
      scheduleVersion: item.scheduleVersion
    })].slice(-1000)
  };
  const invalidate = scheduleChanged || item.status !== "open";
  const dismissed = invalidate
    ? dismissMilestoneFollowups(baseDoc, milestoneId, item.status === "completed"
      ? "Milestone completed."
      : item.status === "cancelled" ? "Milestone cancelled." : "Milestone schedule changed.", { now, actorId })
    : { doc: baseDoc, dismissed: 0 };
  return { ok: true, milestone: item, dismissedFollowups: dismissed.dismissed, doc: dismissed.doc };
}

export function summarizePartnerMilestones(docInput, now = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const nowMs = new Date(now).getTime();
  const open = doc.milestones.filter(item => item.status === "open");
  return {
    generatedAt: now,
    totals: {
      total: doc.milestones.length,
      open: open.length,
      overdue: open.filter(item => item.dueAt && new Date(item.dueAt).getTime() < nowMs).length,
      dueSoon: open.filter(item => {
        const dueMs = new Date(item.dueAt).getTime();
        return Number.isFinite(dueMs) && dueMs >= nowMs && dueMs <= nowMs + Number(item.reminderLeadDays ?? 3) * 86_400_000;
      }).length,
      completed: doc.milestones.filter(item => item.status === "completed").length,
      cancelled: doc.milestones.filter(item => item.status === "cancelled").length
    }
  };
}

export function resolveFollowupRecipient(docInput, followupId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const followup = doc.followups.find(item => item.id === followupId);
  if (!followup) return { ok: false, error: "Follow-up not found." };
  if (followup.taskId) {
    const task = doc.tasks.find(item => item.id === followup.taskId);
    if (!task) return { ok: false, error: "Task not found for follow-up." };
    if (!["open", "in_progress", "blocked"].includes(task.status)) return { ok: false, error: "The task is no longer active." };
    const expectedSource = followup.kind === "task_assignment"
      ? `assignment:${taskAssignmentVersion(task)}`
      : `schedule:${taskScheduleVersion(task)}:`;
    const currentSource = String(followup.sourceVersion || "");
    if (followup.kind === "task_assignment" ? currentSource !== expectedSource : !currentSource.startsWith(expectedSource)) {
      return { ok: false, error: "The task notification is stale after an assignment or due-date change." };
    }
    const recipient = taskNotificationRecipient(task, options);
    if (!recipient) return { ok: false, error: "The current task assignee does not have an available directory email." };
    if (recipient.email !== String(followup.recipient || "").toLowerCase()) {
      return { ok: false, error: "The task assignee email changed after this notification was created." };
    }
    return { ok: true, followup, recipient: task, toName: recipient.name };
  }
  if (followup.prospectId) {
    const prospect = doc.prospects.find(item => item.id === followup.prospectId);
    if (!prospect) return { ok: false, error: "Prospect not found for follow-up." };
    if (prospect.suppressedAt || prospect.status === "do_not_contact") return { ok: false, error: "Prospect is suppressed from outreach." };
    if (!prospect.contactBasis) return { ok: false, error: "Prospect contact basis is missing." };
    if (String(prospect.contactEmail || "").toLowerCase() !== String(followup.recipient || "").toLowerCase()) return { ok: false, error: "Follow-up recipient no longer matches the prospect contact." };
    const campaign = doc.campaigns.find(item => item.id === followup.campaignId);
    if (!campaign) return { ok: false, error: "Campaign not found for follow-up." };
    if (options.requireActiveCampaign && campaign.status !== "active") return { ok: false, error: "Campaign must be active before review or queueing." };
    if (!matchOutreachProspects(doc, campaign).some(item => item.id === prospect.id)) {
      return { ok: false, error: "Prospect no longer matches the campaign targeting." };
    }
    return { ok: true, followup, recipient: prospect, toName: prospect.contactName || prospect.organizationName };
  }
  const application = doc.applications.find(item => item.id === followup.applicationId);
  if (!application) return { ok: false, error: "Application not found for follow-up." };
  if (followup.milestoneId) {
    const currentMilestone = doc.milestones.find(item => item.id === followup.milestoneId);
    if (!currentMilestone || currentMilestone.status !== "open") return { ok: false, error: "The milestone is no longer open." };
    if (!String(followup.sourceVersion || "").startsWith(milestoneSourcePrefix(currentMilestone))) {
      return { ok: false, error: "The milestone reminder is stale after a schedule change." };
    }
  }
  if (application.consentToContact !== true) return { ok: false, error: "Application does not permit contact." };
  if (String(application.contactEmail || "").toLowerCase() !== String(followup.recipient || "").toLowerCase()) return { ok: false, error: "Follow-up recipient no longer matches the application contact." };
  return { ok: true, followup, recipient: application, toName: application.contactName };
}

function automatedApproval(followup) {
  return followup.approvedBy === `automation:${PARTNER_TRANSACTIONAL_AUTOMATION_POLICY}`
    && followup.automationPolicy === PARTNER_TRANSACTIONAL_AUTOMATION_POLICY;
}

function outreachAutomatedApproval(followup, campaign) {
  return followup.approvedBy === `automation:${OUTREACH_CAMPAIGN_AUTOMATION_POLICY}`
    && followup.automationPolicy === OUTREACH_CAMPAIGN_AUTOMATION_POLICY
    && followup.automationCampaignApprovedAt === campaign?.approvedAt;
}

function outreachCampaignDailyCounts(doc, campaign, now) {
  const today = calendarDay(now);
  const messages = doc.followups.filter(item => item.campaignId === campaign.id);
  const automatedMessages = messages.filter(item => item.automationPolicy === OUTREACH_CAMPAIGN_AUTOMATION_POLICY);
  const sentToday = messages.filter(item => item.status === "sent" && calendarDay(item.sentAt) === today).length;
  const queuedPending = messages.filter(item => ["queued", "sending"].includes(item.status)).length;
  const queuedToday = messages.filter(item => ["queued", "sending"].includes(item.status) && calendarDay(item.queuedAt) === today).length;
  const failedToday = messages.filter(item => item.status === "failed" && calendarDay(item.lastAttemptAt) === today).length;
  const approvedPending = automatedMessages.filter(item => item.status === "approved" && outreachAutomatedApproval(item, campaign)).length;
  return { sentToday, queuedPending, queuedToday, failedToday, approvedPending };
}

export function outreachCampaignAutomationReadiness(docInput, campaignOrId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const campaign = typeof campaignOrId === "string" ? doc.campaigns.find(item => item.id === campaignOrId) : normalizeOutreachCampaign(campaignOrId);
  if (!campaign?.id) return { enabled: false, active: false, providerReady: options.providerReady === true, blockedReason: "Campaign not found." };
  const enabled = campaign.deliveryMode === "approved_sequence";
  const providerReady = options.providerReady === true;
  const now = options.now ?? new Date().toISOString();
  const counts = outreachCampaignDailyCounts(doc, campaign, now);
  const sendSlotsToday = Math.max(0, campaign.dailySendLimit - counts.sentToday - counts.queuedPending - counts.failedToday);
  return {
    mode: campaign.deliveryMode,
    policy: OUTREACH_CAMPAIGN_AUTOMATION_POLICY,
    enabled,
    active: enabled && campaign.status === "active" && providerReady,
    providerReady,
    dailySendLimit: campaign.dailySendLimit,
    ...counts,
    sendSlotsToday,
    remainingToday: Math.max(0, sendSlotsToday - counts.approvedPending),
    blockedReason: !enabled
      ? "Campaign messages require individual review."
      : campaign.status !== "active"
        ? "Campaign must be active before its approved sequence can run."
        : providerReady ? null : "Transactional email and delivery tracking must be ready before campaign automation can run."
  };
}

export function partnerAutomationReadiness(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const providerReady = options.providerReady === true;
  const enabled = doc.automationMode === "transactional_auto";
  return {
    mode: doc.automationMode,
    enabled,
    active: enabled && providerReady,
    providerReady,
    policy: PARTNER_TRANSACTIONAL_AUTOMATION_POLICY,
    eligibleKinds: [...PARTNER_TRANSACTIONAL_FOLLOWUP_KINDS],
    eligibleDrafts: doc.followups.filter(item => item.status === "draft_ready" && PARTNER_TRANSACTIONAL_FOLLOWUP_KIND_SET.has(item.kind)).length,
    autoApproved: doc.followups.filter(item => item.status === "approved" && automatedApproval(item)).length,
    autoQueued: doc.followups.filter(item => item.status === "queued" && item.automationPolicy === PARTNER_TRANSACTIONAL_AUTOMATION_POLICY).length,
    blockedReason: !enabled
      ? "Transactional automation is in review-first mode."
      : providerReady ? null : "Transactional email and delivery tracking must be ready before automation can run."
  };
}

export function setPartnerAutomationMode(docInput, modeInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const mode = text(modeInput, 40).toLowerCase();
  if (!PARTNER_AUTOMATION_MODES.has(mode)) {
    return { ok: false, error: "Automation mode must be review_first or transactional_auto." };
  }
  if (mode === "transactional_auto" && options.providerReady !== true) {
    return { ok: false, providerNotReady: true, error: "Transactional email and delivery tracking must be ready before enabling automation." };
  }
  if (doc.automationMode === mode) {
    return { ok: true, changed: false, returnedToReview: 0, doc, automation: partnerAutomationReadiness(doc, options) };
  }
  const now = options.now ?? new Date().toISOString();
  const actorId = text(options.actorId, 100) || "admin";
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  let returnedToReview = 0;
  const followups = mode === "review_first"
    ? doc.followups.map(item => {
      if (item.status !== "approved" || !automatedApproval(item)) return item;
      returnedToReview += 1;
      return {
        ...item,
        status: "draft_ready",
        approvedBy: null,
        approvedAt: null,
        automationDecision: "returned_to_review",
        updatedAt: now
      };
    })
    : doc.followups;
  const next = {
    ...doc,
    automationMode: mode,
    lastUpdated: now,
    followups,
    activity: [...doc.activity, activity(
      idFactory,
      "automation.mode_changed",
      "partner_automation",
      PARTNER_TRANSACTIONAL_AUTOMATION_POLICY,
      now,
      actorId,
      { fromMode: doc.automationMode, toMode: mode, returnedToReview }
    )].slice(-1000)
  };
  return {
    ok: true,
    changed: true,
    returnedToReview,
    doc: next,
    automation: partnerAutomationReadiness(next, options)
  };
}

export function applyTransactionalFollowupAutomation(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const readiness = partnerAutomationReadiness(doc, options);
  if (!readiness.active) {
    return { ok: true, changed: false, approved: [], skipped: [], doc, automation: readiness };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const maxBatch = Math.max(1, Math.min(100, Number(options.maxBatch || 25)));
  const approved = [];
  const skipped = [];
  const followups = doc.followups.map(item => {
    if (approved.length >= maxBatch || item.status !== "draft_ready" || !PARTNER_TRANSACTIONAL_FOLLOWUP_KIND_SET.has(item.kind)) return item;
    if (!item.subject || !item.body) {
      skipped.push({ id: item.id, reason: "Message content is not ready." });
      return item;
    }
    const recipient = resolveFollowupRecipient(doc, item.id, options);
    if (!recipient.ok) {
      skipped.push({ id: item.id, reason: recipient.error });
      return item;
    }
    const next = {
      ...item,
      status: "approved",
      approvedBy: `automation:${PARTNER_TRANSACTIONAL_AUTOMATION_POLICY}`,
      approvedAt: now,
      automationPolicy: PARTNER_TRANSACTIONAL_AUTOMATION_POLICY,
      automationDecision: "approved",
      automationApprovedAt: now,
      updatedAt: now
    };
    approved.push(next);
    return next;
  });
  if (!approved.length) {
    return { ok: true, changed: false, approved, skipped, doc, automation: readiness };
  }
  const activityRecords = approved.map(item => activity(
    idFactory,
    "followup.auto_approved",
    "followup",
    item.id,
    now,
    `automation:${PARTNER_TRANSACTIONAL_AUTOMATION_POLICY}`,
    { applicationId: item.applicationId, kind: item.kind, policy: PARTNER_TRANSACTIONAL_AUTOMATION_POLICY }
  ));
  const next = {
    ...doc,
    lastUpdated: now,
    followups,
    activity: [...doc.activity, ...activityRecords].slice(-1000)
  };
  return {
    ok: true,
    changed: true,
    approved,
    skipped,
    doc: next,
    automation: partnerAutomationReadiness(next, options)
  };
}

export function applyOutreachCampaignAutomation(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  if (options.providerReady !== true) {
    return { ok: true, changed: false, approved: [], skipped: [], doc };
  }
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const maxBatch = Math.max(1, Math.min(100, Number(options.maxBatch || 25)));
  const approved = [];
  const skipped = [];
  const followups = doc.followups.slice();
  for (const campaign of doc.campaigns.filter(item => item.status === "active" && item.deliveryMode === "approved_sequence")) {
    const workingDoc = { ...doc, followups };
    const readiness = outreachCampaignAutomationReadiness(workingDoc, campaign, { ...options, now });
    let remaining = Math.min(readiness.remainingToday, maxBatch - approved.length);
    if (remaining <= 0) continue;
    const candidates = followups
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.campaignId === campaign.id && item.kind === "sponsor_outreach" && item.status === "draft_ready")
      .sort((left, right) => String(left.item.dueAt || left.item.createdAt || "").localeCompare(String(right.item.dueAt || right.item.createdAt || "")));
    for (const { item, index } of candidates) {
      if (remaining <= 0 || approved.length >= maxBatch) break;
      if (!item.subject || !item.body) {
        skipped.push({ id: item.id, reason: "Message content is not ready." });
        continue;
      }
      const recipient = resolveFollowupRecipient(workingDoc, item.id, { ...options, requireActiveCampaign: true });
      if (!recipient.ok) {
        skipped.push({ id: item.id, reason: recipient.error });
        continue;
      }
      const next = {
        ...item,
        status: "approved",
        approvedBy: `automation:${OUTREACH_CAMPAIGN_AUTOMATION_POLICY}`,
        approvedAt: now,
        automationPolicy: OUTREACH_CAMPAIGN_AUTOMATION_POLICY,
        automationDecision: "campaign_approved",
        automationApprovedAt: now,
        automationCampaignApprovedAt: campaign.approvedAt,
        updatedAt: now
      };
      followups[index] = next;
      approved.push(next);
      remaining -= 1;
    }
  }
  if (!approved.length) return { ok: true, changed: false, approved, skipped, doc };
  const activityRecords = approved.map(item => activity(
    idFactory,
    "outreach.followup.auto_approved",
    "followup",
    item.id,
    now,
    `automation:${OUTREACH_CAMPAIGN_AUTOMATION_POLICY}`,
    { campaignId: item.campaignId, prospectId: item.prospectId, sequenceStepId: item.sequenceStepId, policy: OUTREACH_CAMPAIGN_AUTOMATION_POLICY }
  ));
  return {
    ok: true,
    changed: true,
    approved,
    skipped,
    doc: { ...doc, lastUpdated: now, followups, activity: [...doc.activity, ...activityRecords].slice(-1000) }
  };
}

export function automatedFollowupQueueCandidates(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const maxBatch = Math.max(1, Math.min(100, Number(options.maxBatch || 100)));
  const candidates = doc.automationMode === "transactional_auto"
    ? doc.followups.filter(item => item.status === "approved" && automatedApproval(item))
    : [];
  const now = options.now ?? new Date().toISOString();
  for (const campaign of doc.campaigns.filter(item => item.status === "active" && item.deliveryMode === "approved_sequence")) {
    const readiness = outreachCampaignAutomationReadiness(doc, campaign, { ...options, now });
    if (!readiness.active) continue;
    const campaignCandidates = doc.followups
      .filter(item => item.campaignId === campaign.id && item.status === "approved" && outreachAutomatedApproval(item, campaign))
      .sort((left, right) => String(left.approvedAt || "").localeCompare(String(right.approvedAt || "")))
      .slice(0, readiness.sendSlotsToday);
    candidates.push(...campaignCandidates);
  }
  return candidates.slice(0, maxBatch);
}

export function prepareFollowupDraft(docInput, followupId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.followups.findIndex(item => item.id === followupId);
  if (index < 0) return { ok: false, error: "Follow-up not found." };
  const current = doc.followups[index];
  if (!FOLLOWUP_STATUSES.has(current.status) || !["pending", "failed"].includes(current.status)) {
    return { ok: true, changed: false, followup: current, doc };
  }
  const application = doc.applications.find(item => item.id === current.applicationId);
  if (!application) return { ok: false, error: "Application not found for follow-up." };
  const now = options.now ?? new Date().toISOString();
  const typeLabel = application.type === "vendor" ? "vendor" : "sponsorship";
  const offeringCopy = application.type === "vendor" && application.offeringName
    ? ` The selected offering is ${application.offeringName}${application.expectedAmountCents > 0 ? ` (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(application.expectedAmountCents / 100)})` : ""}, subject to application approval.`
    : "";
  const portalUrl = text(options.portalUrl, 1000);
  const portalCopy = portalUrl ? `\n\nTrack the application, payment progress, and key dates here:\n${portalUrl}` : "";
  const followup = {
    ...current,
    status: "draft_ready",
    subject: `Texas SandFest ${typeLabel} application ${application.reference}`,
    body: `Hello ${application.contactName},\n\nThank you for your interest in Texas SandFest. We received ${application.organizationName}'s ${typeLabel} application (${application.reference}).${offeringCopy} Our team will review it and follow up with next steps.${portalCopy}\n\nTexas SandFest`,
    portalUrl: portalUrl || null,
    updatedAt: now
  };
  const followups = doc.followups.slice();
  followups[index] = followup;
  return { ok: true, changed: true, followup, doc: { ...doc, lastUpdated: now, followups } };
}

function milestoneReminderPhase(dueMs, nowMs, leadDays) {
  if (dueMs > nowMs) return dueMs <= nowMs + leadDays * 86_400_000 ? { phase: "upcoming", daysOverdue: 0 } : null;
  const daysOverdue = Math.max(0, Math.floor((nowMs - dueMs) / 86_400_000));
  if (daysOverdue === 0) return { phase: "due", daysOverdue: 0 };
  return { phase: `overdue_week_${Math.floor((daysOverdue - 1) / 7) + 1}`, daysOverdue };
}

export function generateDueTaskFollowups(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, error: "Task follow-up time is invalid." };
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const activeTaskStatuses = new Set(["open", "in_progress", "blocked"]);
  const activeFollowupStatuses = new Set(["pending", "draft_ready", "approved", "queued", "failed"]);
  const generated = [];

  const build = (task, recipient, kind, sourceVersion, subject, body, detail = {}) => ({
    id: idFactory("followup"),
    taskId: task.id,
    kind,
    sourceVersion,
    channel: "email",
    recipient: recipient.email,
    taskAssigneeType: task.assigneeType,
    taskAssigneeId: task.assigneeId,
    taskAssigneeName: recipient.name,
    status: "draft_ready",
    dueAt: now,
    subject,
    body,
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    queuedAt: null,
    provider: null,
    providerMessageId: null,
    deliveryAttempts: 0,
    lastAttemptAt: null,
    lastError: null,
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
    ...detail
  });

  for (const task of doc.tasks) {
    if (!activeTaskStatuses.has(task.status) || !task.assigneeId || task.assigneeType === "unassigned") continue;
    const recipient = taskNotificationRecipient(task, options);
    if (!recipient) continue;
    const candidates = () => [...doc.followups, ...generated].filter(item => item.taskId === task.id);
    const assignmentSource = `assignment:${taskAssignmentVersion(task)}`;
    if (!candidates().some(item => item.kind === "task_assignment" && item.sourceVersion === assignmentSource)) {
      const dueCopy = task.dueAt
        ? ` It is due ${new Date(task.dueAt).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}.`
        : " It does not yet have a due date.";
      const detailCopy = task.description ? `\n\nDetails: ${task.description}` : "";
      generated.push(build(
        task,
        recipient,
        "task_assignment",
        assignmentSource,
        `Texas SandFest task assigned - ${task.title}`,
        `Hello ${recipient.name},\n\nYou have been assigned the ${text(task.priority, 20) || "normal"}-priority Texas SandFest task “${task.title}”.${dueCopy}${detailCopy}\n\nPlease coordinate with the SandFest operations team to acknowledge, start, or update this work.\n\nTexas SandFest`
      ));
    }

    const dueMs = new Date(task.dueAt || "").getTime();
    if (!Number.isFinite(dueMs) || dueMs >= nowMs) continue;
    const currentAssignment = candidates().find(item => item.kind === "task_assignment" && item.sourceVersion === assignmentSource);
    const assignmentNoticeAt = new Date(currentAssignment?.sentAt || currentAssignment?.createdAt || "").getTime();
    if (Number.isFinite(assignmentNoticeAt) && nowMs - assignmentNoticeAt < 86_400_000) continue;
    const daysOverdue = Math.max(1, Math.ceil((nowMs - dueMs) / 86_400_000));
    const reminderPhase = `overdue_week_${Math.floor((daysOverdue - 1) / 7) + 1}`;
    const schedulePrefix = `schedule:${taskScheduleVersion(task)}:`;
    const sourceVersion = `${schedulePrefix}phase:${reminderPhase}`;
    const currentCandidates = candidates();
    if (currentCandidates.some(item => item.kind === "task_overdue" && item.sourceVersion === sourceVersion)) continue;
    if (currentCandidates.some(item => item.kind === "task_overdue"
      && activeFollowupStatuses.has(item.status)
      && String(item.sourceVersion || "").startsWith(schedulePrefix))) continue;
    const detailCopy = task.description ? `\n\nDetails: ${task.description}` : "";
    generated.push(build(
      task,
      recipient,
      "task_overdue",
      sourceVersion,
      `Texas SandFest overdue task - ${task.title}`,
      `Hello ${recipient.name},\n\nThe Texas SandFest task “${task.title}” is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue. It remains ${text(task.status, 20).replace(/_/g, " ")} and ${text(task.priority, 20) || "normal"} priority.${detailCopy}\n\nPlease update the SandFest operations team with progress, a blocker, or a revised completion plan.\n\nTexas SandFest`,
      { reminderPhase, daysOverdue }
    ));
  }

  if (!generated.length) return { ok: true, changed: false, generated: [], doc };
  const activityRecords = generated.map(item => activity(
    idFactory,
    "task.followup.generated",
    "followup",
    item.id,
    now,
    "automation",
    { taskId: item.taskId, kind: item.kind, sourceVersion: item.sourceVersion }
  ));
  return {
    ok: true,
    changed: true,
    generated,
    doc: {
      ...doc,
      lastUpdated: now,
      followups: [...doc.followups, ...generated],
      activity: [...doc.activity, ...activityRecords].slice(-1000)
    }
  };
}

export function generateDuePartnerFollowups(docInput, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const now = options.now ?? new Date().toISOString();
  const nowMs = new Date(now).getTime();
  const defaultLeadDays = Math.max(0, Math.min(30, Number(options.leadDays ?? 3)));
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const terminalApplications = new Set(["complete", "rejected", "withdrawn"]);
  const activeFollowupStatuses = new Set(["pending", "draft_ready", "approved", "queued", "failed"]);
  const generated = [];

  for (const due of doc.milestones) {
    if (due.status !== "open" || !due.dueAt) continue;
    const dueMs = new Date(due.dueAt).getTime();
    if (!Number.isFinite(dueMs)) continue;
    const configuredLeadDays = Number(due.reminderLeadDays);
    const leadDays = Number.isInteger(configuredLeadDays) ? Math.max(0, Math.min(30, configuredLeadDays)) : defaultLeadDays;
    const reminder = milestoneReminderPhase(dueMs, nowMs, leadDays);
    if (!reminder) continue;
    const application = doc.applications.find(item => item.id === due.applicationId);
    if (!application || application.consentToContact !== true || terminalApplications.has(application.status)) continue;
    if (isPaymentMilestone(due)) {
      const expectedAmountCents = cents(application.expectedAmountCents || application.requestedAmountCents);
      if (expectedAmountCents > 0 && successfulPaymentTotal(doc, application.id) >= expectedAmountCents) continue;
    }
    const sourceVersion = `${milestoneSourcePrefix(due)}phase:${reminder.phase}`;
    const candidates = [...doc.followups, ...generated].filter(item => item.milestoneId === due.id);
    if (candidates.some(item => item.sourceVersion === sourceVersion)) continue;
    if (candidates.some(item => activeFollowupStatuses.has(item.status) && String(item.sourceVersion || "").startsWith(milestoneSourcePrefix(due)))) continue;
    const portalUrl = typeof options.portalUrlForApplication === "function"
      ? text(options.portalUrlForApplication(application), 1000)
      : "";
    const portalCopy = portalUrl ? `\n\nTrack payment progress and key dates here:\n${portalUrl}` : "";
    const overdue = reminder.daysOverdue > 0;
    const dueLabel = new Date(due.dueAt).toLocaleDateString("en-US", { timeZone: "America/Chicago" });
    const followup = {
      id: idFactory("followup"),
      applicationId: application.id,
      milestoneId: due.id,
      kind: "milestone_reminder",
      sourceVersion,
      reminderPhase: reminder.phase,
      daysOverdue: reminder.daysOverdue,
      channel: "email",
      recipient: application.contactEmail,
      status: "draft_ready",
      dueAt: now,
      subject: `Texas SandFest ${due.label.toLowerCase()} ${overdue ? "follow-up" : "reminder"} - ${application.reference}`,
      body: `Hello ${application.contactName},\n\nThis is a ${overdue ? `follow-up about the overdue` : "reminder for"} ${due.label.toLowerCase()} for ${application.organizationName}'s Texas SandFest ${application.type} application (${application.reference}). Our current target date is ${dueLabel}.${overdue ? ` This item is ${reminder.daysOverdue} day${reminder.daysOverdue === 1 ? "" : "s"} overdue.` : ""} Please reply if you have already completed this step or need help from the SandFest team.${portalCopy}\n\nTexas SandFest`,
      portalUrl: portalUrl || null,
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      queuedAt: null,
      provider: null,
      providerMessageId: null,
      deliveryAttempts: 0,
      lastAttemptAt: null,
      lastError: null,
      generatedAt: now,
      createdAt: now,
      updatedAt: now
    };
    generated.push(followup);
  }

  if (!generated.length) return { ok: true, changed: false, generated: [], doc };
  const activityRecords = generated.map(item => activity(
    idFactory,
    "followup.generated",
    "followup",
    item.id,
    now,
    "automation",
    { applicationId: item.applicationId, milestoneId: item.milestoneId, sourceVersion: item.sourceVersion }
  ));
  return {
    ok: true,
    changed: true,
    generated,
    doc: {
      ...doc,
      lastUpdated: now,
      followups: [...doc.followups, ...generated],
      activity: [...doc.activity, ...activityRecords].slice(-1000)
    }
  };
}

export function reviewFollowup(docInput, followupId, action, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.followups.findIndex(item => item.id === followupId);
  if (index < 0) return { ok: false, error: "Follow-up not found." };
  const current = doc.followups[index];
  const now = options.now ?? new Date().toISOString();
  if (action === "approve") {
    if (current.status !== "draft_ready") return { ok: false, error: "Only ready drafts can be approved." };
    const recipient = resolveFollowupRecipient(doc, followupId, {
      ...options,
      requireActiveCampaign: Boolean(current.prospectId)
    });
    if (!recipient.ok) return recipient;
  } else if (action === "dismiss") {
    if (!["draft_ready", "approved", "failed"].includes(current.status)) return { ok: false, error: "Follow-up cannot be dismissed in its current state." };
  } else {
    return { ok: false, error: "Action must be approve or dismiss." };
  }
  const followup = {
    ...current,
    status: action === "approve" ? "approved" : "dismissed",
    approvedBy: action === "approve" ? options.actorId ?? "admin" : current.approvedBy,
    approvedAt: action === "approve" ? now : current.approvedAt,
    dismissedBy: action === "dismiss" ? options.actorId ?? "admin" : current.dismissedBy ?? null,
    dismissedAt: action === "dismiss" ? now : current.dismissedAt ?? null,
    updatedAt: now
  };
  const followups = doc.followups.slice();
  followups[index] = followup;
  return { ok: true, followup, doc: { ...doc, lastUpdated: now, followups } };
}

export function queueFollowupDelivery(docInput, followupId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.followups.findIndex(item => item.id === followupId);
  if (index < 0) return { ok: false, error: "Follow-up not found." };
  const current = doc.followups[index];
  if (!["approved", "failed"].includes(current.status)) return { ok: false, error: "Follow-up must be approved before delivery." };
  const recipient = resolveFollowupRecipient(doc, followupId, {
    ...options,
    requireActiveCampaign: Boolean(current.prospectId)
  });
  if (!recipient.ok) return recipient;
  const now = options.now ?? new Date().toISOString();
  const campaign = current.campaignId ? doc.campaigns.find(item => item.id === current.campaignId) : null;
  if (campaign?.deliveryMode === "approved_sequence") {
    const readiness = outreachCampaignAutomationReadiness(doc, campaign, { providerReady: true, now });
    const currentReservation = outreachAutomatedApproval(current, campaign) ? 1 : 0;
    const otherApprovedReservations = Math.max(0, readiness.approvedPending - currentReservation);
    if (readiness.sendSlotsToday - otherApprovedReservations <= 0) {
      return { ok: false, dailyLimitReached: true, error: `Campaign daily delivery limit of ${campaign.dailySendLimit} has been reached.` };
    }
  }
  const automationJobId = text(options.automationJobId, 100) || null;
  const existingIdempotencyKey = text(current.deliveryIdempotencyKey, 100);
  const deliveryIdempotencyKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existingIdempotencyKey)
    ? existingIdempotencyKey
    : crypto.randomUUID();
  const followup = {
    ...current,
    status: "queued",
    queuedAt: now,
    deliveryIdempotencyKey,
    deliveryClaimId: null,
    deliveryClaimedAt: null,
    providerSubmissionStartedAt: null,
    lastError: null,
    ...(automationJobId ? { automationJobId, automationQueuedAt: now } : {}),
    updatedAt: now
  };
  const followups = doc.followups.slice();
  followups[index] = followup;
  return { ok: true, followup, doc: { ...doc, lastUpdated: now, followups } };
}

export function claimFollowupDelivery(docInput, followupId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.followups.findIndex(item => item.id === followupId);
  if (index < 0) return { ok: false, error: "Follow-up not found." };
  const current = doc.followups[index];
  if (current.status !== "queued") {
    return { ok: false, canceled: ["draft_ready", "dismissed", "failed"].includes(current.status), status: current.status, error: `Follow-up is ${current.status}, not queued.` };
  }
  const deliveryClaimId = text(options.deliveryClaimId, 100);
  if (!deliveryClaimId) return { ok: false, error: "Delivery claim ID is required." };
  if (current.automationJobId && current.automationJobId !== deliveryClaimId) {
    return { ok: false, canceled: true, status: current.status, error: "Automated delivery job no longer owns this follow-up." };
  }
  const recipient = resolveFollowupRecipient(doc, followupId, {
    ...options,
    requireActiveCampaign: Boolean(current.prospectId)
  });
  if (!recipient.ok) return recipient;
  const now = options.now ?? new Date().toISOString();
  const followup = {
    ...current,
    status: "sending",
    deliveryClaimId,
    deliveryClaimedAt: now,
    providerSubmissionStartedAt: null,
    updatedAt: now
  };
  const followups = doc.followups.slice();
  followups[index] = followup;
  return { ok: true, followup, recipient: recipient.recipient, toName: recipient.toName, doc: { ...doc, lastUpdated: now, followups } };
}

export function beginFollowupProviderSubmission(docInput, followupId, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.followups.findIndex(item => item.id === followupId);
  if (index < 0) return { ok: false, canceled: true, status: "missing", error: "Follow-up not found." };
  const current = doc.followups[index];
  if (current.status !== "sending") {
    return { ok: false, canceled: ["draft_ready", "dismissed", "failed"].includes(current.status), status: current.status, error: `Follow-up is ${current.status}, not sending.` };
  }
  const deliveryClaimId = text(options.deliveryClaimId, 100);
  if (!deliveryClaimId || deliveryClaimId !== current.deliveryClaimId) {
    return { ok: false, canceled: true, status: current.status, error: "Delivery claim no longer owns this follow-up." };
  }
  if (current.providerSubmissionStartedAt) {
    return { ok: false, outcomeUnknown: true, status: current.status, error: "Provider submission already started; verify delivery before retrying." };
  }
  const recipient = resolveFollowupRecipient(doc, followupId, {
    ...options,
    requireActiveCampaign: Boolean(current.prospectId)
  });
  const now = options.now ?? new Date().toISOString();
  if (!recipient.ok) {
    const campaign = current.campaignId ? doc.campaigns.find(item => item.id === current.campaignId) : null;
    const returnToReview = campaign?.status === "paused";
    const followup = {
      ...current,
      status: returnToReview ? "draft_ready" : "dismissed",
      approvedBy: null,
      approvedAt: null,
      automationPolicy: null,
      automationDecision: returnToReview ? "returned_to_review" : "delivery_eligibility_revoked",
      automationApprovedAt: null,
      automationCampaignApprovedAt: null,
      automationJobId: null,
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      providerSubmissionStartedAt: null,
      dismissedAt: returnToReview ? current.dismissedAt : now,
      dismissedBy: returnToReview ? current.dismissedBy : options.actorId ?? "worker",
      lastError: recipient.error,
      updatedAt: now
    };
    const followups = doc.followups.slice();
    followups[index] = followup;
    return { ok: true, canceled: true, status: followup.status, followup, doc: { ...doc, lastUpdated: now, followups } };
  }
  const followup = {
    ...current,
    providerSubmissionStartedAt: now,
    updatedAt: now
  };
  const followups = doc.followups.slice();
  followups[index] = followup;
  return { ok: true, changed: true, followup, recipient: recipient.recipient, toName: recipient.toName, doc: { ...doc, lastUpdated: now, followups } };
}

export function recordFollowupDelivery(docInput, followupId, delivery, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  const index = doc.followups.findIndex(item => item.id === followupId);
  if (index < 0) return { ok: false, error: "Follow-up not found." };
  const current = doc.followups[index];
  if (!["queued", "sending"].includes(current.status)) return { ok: false, error: "Follow-up is not queued or sending." };
  const deliveryClaimId = text(options.deliveryClaimId, 100);
  if (current.status === "sending" && (!deliveryClaimId || deliveryClaimId !== current.deliveryClaimId)) {
    return { ok: false, error: "Delivery claim no longer owns this follow-up." };
  }
  const now = options.now ?? new Date().toISOString();
  const sent = delivery?.sent === true;
  const outreachRetryReady = !current.prospectId || resolveFollowupRecipient(doc, current.id, { requireActiveCampaign: true }).ok;
  const terminal = options.terminal === true || (!sent && !outreachRetryReady);
  if (current.status === "sending" && !current.providerSubmissionStartedAt && (sent || !terminal)) {
    return { ok: false, error: "Provider submission has not started." };
  }
  const followup = {
    ...current,
    status: sent ? "sent" : terminal ? "failed" : "queued",
    provider: delivery?.provider ?? current.provider,
    providerMessageId: sent ? delivery?.providerMessageId ?? null : current.providerMessageId,
    deliveryStatus: sent ? "accepted" : current.deliveryStatus ?? null,
    deliveryEvents: Array.isArray(current.deliveryEvents) ? current.deliveryEvents : [],
    acceptedAt: sent ? now : current.acceptedAt ?? null,
    deliveryAttempts: Number(current.deliveryAttempts || 0) + 1,
    lastAttemptAt: now,
    deliveryClaimId: null,
    deliveryClaimedAt: null,
    providerSubmissionStartedAt: sent || terminal ? current.providerSubmissionStartedAt : null,
    deliveryOutcomeUnknown: options.unknownOutcome === true,
    lastError: sent ? null : String(delivery?.error || delivery?.reason || "Delivery failed").slice(0, 1000),
    sentAt: sent ? now : current.sentAt,
    updatedAt: now
  };
  let followups = doc.followups.slice();
  followups[index] = followup;
  if (["sent", "failed"].includes(followup.status)) {
    followups = followups.map(item => item.status === "pending" && item.blockedByFollowupId === current.id
      ? {
        ...item,
        status: "draft_ready",
        blockedByFollowupId: null,
        lastError: null,
        updatedAt: now
      }
      : item);
  }
  const prospects = sent && current.prospectId
    ? doc.prospects.map(item => item.id === current.prospectId
      ? {
        ...item,
        status: ["qualified", "contact_ready"].includes(item.status) ? "contacted" : item.status,
        lastContactedAt: now,
        updatedAt: now
      }
      : item)
    : doc.prospects;
  return { ok: true, followup, doc: { ...doc, lastUpdated: now, followups, prospects } };
}

export function summarizeTaskBoard(docInput, now = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const nowMs = new Date(now).getTime();
  const today = calendarDay(now);
  const activeStatuses = new Set(["open", "in_progress", "blocked"]);
  const active = doc.tasks.filter(item => activeStatuses.has(item.status));
  const overdue = active.filter(item => item.dueAt && new Date(item.dueAt).getTime() < nowMs);
  const dueToday = active.filter(item => item.dueAt && calendarDay(item.dueAt) === today);
  const workload = new Map();
  for (const task of active) {
    const assigneeType = TASK_ASSIGNMENT_TYPES.has(task.assigneeType) ? task.assigneeType : task.assigneeId ? "staff" : task.assigneeRole ? "team" : "unassigned";
    const assigneeId = task.assigneeId || task.assigneeRole || "unassigned";
    const key = `${assigneeType}:${assigneeId}`;
    const row = workload.get(key) ?? {
      key,
      assigneeType,
      assigneeId: assigneeId === "unassigned" ? null : assigneeId,
      assigneeName: task.assigneeName || task.assigneeId || task.assigneeRole || "Unassigned",
      open: 0,
      overdue: 0,
      urgent: 0
    };
    row.open += 1;
    if (task.dueAt && new Date(task.dueAt).getTime() < nowMs) row.overdue += 1;
    if (task.priority === "urgent") row.urgent += 1;
    workload.set(key, row);
  }
  return {
    generatedAt: now,
    totals: {
      total: doc.tasks.length,
      active: active.length,
      open: doc.tasks.filter(item => item.status === "open").length,
      inProgress: doc.tasks.filter(item => item.status === "in_progress").length,
      blocked: doc.tasks.filter(item => item.status === "blocked").length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      unassigned: active.filter(item => (!item.assigneeId && !item.assigneeName) || item.assigneeType === "unassigned").length,
      completed: doc.tasks.filter(item => item.status === "done").length,
      cancelled: doc.tasks.filter(item => item.status === "cancelled").length
    },
    byPriority: {
      urgent: active.filter(item => item.priority === "urgent").length,
      high: active.filter(item => item.priority === "high").length,
      normal: active.filter(item => !item.priority || item.priority === "normal").length,
      low: active.filter(item => item.priority === "low").length
    },
    workload: [...workload.values()].sort((a, b) => b.overdue - a.overdue || b.urgent - a.urgent || b.open - a.open || a.assigneeName.localeCompare(b.assigneeName))
  };
}

export function summarizeSponsorFulfillment(docInput, now = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const nowMs = new Date(now).getTime();
  const active = doc.deliverables.filter(item => !["complete", "cancelled"].includes(item.status));
  return {
    profiles: {
      total: doc.brandProfiles.length,
      submitted: doc.brandProfiles.filter(item => item.status === "submitted").length,
      approved: doc.brandProfiles.filter(item => item.status === "approved").length,
      changesRequested: doc.brandProfiles.filter(item => item.status === "changes_requested").length
    },
    assets: {
      total: doc.brandAssets.filter(item => item.status !== "archived").length,
      awaitingReview: doc.brandAssets.filter(item => ["submitted", "under_review"].includes(item.status)).length,
      approved: doc.brandAssets.filter(item => item.status === "approved").length,
      changesRequested: doc.brandAssets.filter(item => item.status === "changes_requested").length
    },
    deliverables: {
      total: doc.deliverables.length,
      active: active.length,
      overdue: active.filter(item => item.dueAt && new Date(item.dueAt).getTime() < nowMs).length,
      awaitingPartnerReview: doc.deliverables.filter(item => item.partnerReviewStatus === "pending").length,
      changesRequested: doc.deliverables.filter(item => item.partnerReviewStatus === "changes_requested").length,
      partnerApproved: doc.deliverables.filter(item => item.partnerReviewStatus === "approved").length,
      complete: doc.deliverables.filter(item => item.status === "complete").length
    }
  };
}

export function summarizeVendorReadiness(docInput, now = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const vendors = doc.applications.filter(item => item.type === "vendor").map(application => {
    const profile = doc.vendorProfiles.find(item => item.applicationId === application.id) ?? null;
    const requirements = doc.vendorRequirements.filter(item => item.applicationId === application.id && item.required !== false);
    const assignment = doc.vendorAssignments.find(item => item.applicationId === application.id) ?? null;
    const approvedRequirements = requirements.filter(item => ["approved", "waived"].includes(item.status)).length;
    const changesRequested = requirements.filter(item => ["changes_requested", "expired"].includes(item.status)).length;
    const missing = requirements.filter(item => item.status === "missing").length;
    const pendingReview = requirements.filter(item => ["submitted", "under_review"].includes(item.status)).length;
    const profileReady = profile?.status === "approved";
    const complianceReady = requirements.length > 0 && approvedRequirements === requirements.length;
    const assignmentReady = ["confirmed", "checked_in", "complete"].includes(assignment?.status);
    const status = profileReady && complianceReady && assignmentReady
      ? "ready"
      : changesRequested > 0 ? "changes_requested"
        : missing > 0 || !profile ? "blocked" : "in_progress";
    return {
      applicationId: application.id,
      reference: application.reference,
      organizationName: application.organizationName,
      category: application.category,
      status,
      profileStatus: profile?.status ?? "missing",
      compliance: { required: requirements.length, approved: approvedRequirements, missing, pendingReview, changesRequested },
      assignmentStatus: assignment?.status ?? "unassigned",
      boothNumber: assignment?.boothNumber ?? null,
      loadInStart: assignment?.loadInStart ?? null
    };
  });
  const requirements = doc.vendorRequirements;
  return {
    generatedAt: now,
    totals: {
      vendors: vendors.length,
      ready: vendors.filter(item => item.status === "ready").length,
      blocked: vendors.filter(item => item.status === "blocked").length,
      changesRequested: vendors.filter(item => item.status === "changes_requested").length,
      profilesAwaitingReview: doc.vendorProfiles.filter(item => item.status === "submitted").length,
      assignmentsUnconfirmed: vendors.filter(item => !["confirmed", "checked_in", "complete"].includes(item.assignmentStatus)).length,
      requirementsMissing: requirements.filter(item => item.status === "missing").length,
      requirementsAwaitingReview: requirements.filter(item => ["submitted", "under_review"].includes(item.status)).length,
      requirementsChangesRequested: requirements.filter(item => ["changes_requested", "expired"].includes(item.status)).length,
      requirementsApproved: requirements.filter(item => ["approved", "waived"].includes(item.status)).length
    },
    vendors
  };
}

export function summarizePartnerOperations(docInput, now = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const successfulPayments = doc.payments.filter(item => ["succeeded", "partially_refunded"].includes(item.status));
  const amountPaidCents = successfulPayments.reduce((sum, item) => sum + activePaymentAmount(item), 0);
  const amountExpectedCents = doc.applications.reduce((sum, item) => sum + cents(item.expectedAmountCents || item.requestedAmountCents), 0);
  const receivables = summarizePartnerReceivables(doc, now);
  const taskBoard = summarizeTaskBoard(doc, now);
  const milestoneSummary = summarizePartnerMilestones(doc, now);
  const fulfillment = summarizeSponsorFulfillment(doc, now);
  const vendorReadiness = summarizeVendorReadiness(doc, now);
  const outreachActive = doc.prospects.filter(item => !item.suppressedAt && !["won", "lost", "do_not_contact"].includes(item.status));
  const outreachNowMs = new Date(now).getTime();
  const outreachToday = calendarDay(now);
  const outreachScheduled = outreachActive.filter(item => item.nextActionAt && Number.isFinite(new Date(item.nextActionAt).getTime()));
  return {
    applications: {
      total: doc.applications.length,
      vendors: doc.applications.filter(item => item.type === "vendor").length,
      sponsors: doc.applications.filter(item => item.type === "sponsor").length,
      submitted: doc.applications.filter(item => item.status === "submitted").length,
      paid: doc.applications.filter(item => item.status === "paid").length
    },
    finance: {
      amountExpectedCents,
      amountPaidCents,
      balanceCents: Math.max(0, amountExpectedCents - amountPaidCents),
      invoiceDrafts: doc.invoices.filter(item => item.status === "draft").length,
      invoicesPendingSync: doc.invoices.filter(item => ["approved", "queued", "failed"].includes(item.status)).length,
      invoicesSynced: doc.invoices.filter(item => item.status === "synced").length,
      overdueCents: receivables.totals.overdueCents,
      unappliedCents: receivables.totals.unappliedCents,
      reconciliationExceptions: receivables.exceptions.length
    },
    operations: {
      openTasks: taskBoard.totals.active,
      overdueTasks: taskBoard.totals.overdue,
      dueTodayTasks: taskBoard.totals.dueToday,
      blockedTasks: taskBoard.totals.blocked,
      unassignedTasks: taskBoard.totals.unassigned,
      upcomingMilestones: milestoneSummary.totals.open,
      overdueMilestones: milestoneSummary.totals.overdue,
      dueSoonMilestones: milestoneSummary.totals.dueSoon,
      draftsAwaitingReview: doc.followups.filter(item => item.status === "draft_ready").length
    },
    fulfillment,
    vendorReadiness: vendorReadiness.totals,
    outreach: {
      prospects: doc.prospects.length,
      qualified: doc.prospects.filter(item => ["qualified", "contact_ready", "contacted", "engaged", "won"].includes(item.status)).length,
      won: doc.prospects.filter(item => item.status === "won").length,
      suppressed: doc.prospects.filter(item => item.suppressedAt || item.status === "do_not_contact").length,
      campaigns: doc.campaigns.length,
      activeCampaigns: doc.campaigns.filter(item => item.status === "active").length,
      draftsAwaitingReview: doc.followups.filter(item => item.kind === "sponsor_outreach" && item.status === "draft_ready").length,
      messagesSent: doc.followups.filter(item => item.kind === "sponsor_outreach" && item.status === "sent").length,
      nextActionsScheduled: outreachScheduled.length,
      nextActionsOverdue: outreachScheduled.filter(item => new Date(item.nextActionAt).getTime() < outreachNowMs).length,
      nextActionsDueToday: outreachScheduled.filter(item => calendarDay(item.nextActionAt) === outreachToday).length,
      nextActionsUnscheduled: outreachActive.filter(item => !item.nextActionAt || !Number.isFinite(new Date(item.nextActionAt).getTime())).length,
      unassigned: outreachActive.filter(item => !item.ownerId).length
    },
    automationMode: doc.automationMode
  };
}

export function summarizePartnerReceivables(docInput, now = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const generatedAt = iso(now, new Date().toISOString());
  const nowMs = new Date(generatedAt).getTime();
  const billableStatuses = new Set(["approved", "contracted", "invoiced", "partial", "paid", "active", "complete"]);
  const aging = { currentCents: 0, days1To30Cents: 0, days31To60Cents: 0, days61To90Cents: 0, days90PlusCents: 0, unbilledCents: 0 };
  const exceptions = [];

  const accounts = doc.applications
    .filter(application => !["rejected", "withdrawn"].includes(application.status))
    .map(application => {
      const expectedAmountCents = cents(application.expectedAmountCents || application.requestedAmountCents);
      const payments = doc.payments.filter(item => item.applicationId === application.id && ["succeeded", "partially_refunded"].includes(item.status));
      const paidAmountCents = payments.reduce((sum, item) => sum + activePaymentAmount(item), 0);
      const unappliedAmountCents = payments.reduce((sum, item) => sum + activeUnappliedPaymentAmount(item), 0);
      const invoice = doc.invoices.find(item => item.applicationId === application.id && item.status !== "voided") ?? null;
      const invoiceBalanceCents = invoice ? localInvoiceBalance(doc, invoice) : 0;
      const balanceCents = Math.max(0, expectedAmountCents - paidAmountCents);
      const creditCents = Math.max(0, paidAmountCents - expectedAmountCents);
      const billable = billableStatuses.has(application.status);
      let daysOverdue = 0;
      let agingBucket = balanceCents === 0 && expectedAmountCents > 0 ? "paid" : billable ? "unbilled" : "pipeline";
      if (invoice && invoiceBalanceCents > 0) {
        const dueMs = new Date(invoice.dueAt).getTime();
        daysOverdue = Number.isFinite(dueMs) && dueMs < nowMs ? Math.max(1, Math.ceil((nowMs - dueMs) / 86_400_000)) : 0;
        agingBucket = daysOverdue === 0 ? "current"
          : daysOverdue <= 30 ? "1_30"
            : daysOverdue <= 60 ? "31_60"
              : daysOverdue <= 90 ? "61_90"
                : "90_plus";
        const agingKey = agingBucket === "current" ? "currentCents"
          : agingBucket === "1_30" ? "days1To30Cents"
            : agingBucket === "31_60" ? "days31To60Cents"
              : agingBucket === "61_90" ? "days61To90Cents"
                : "days90PlusCents";
        aging[agingKey] += invoiceBalanceCents;
      } else if (billable && balanceCents > 0) {
        aging.unbilledCents += balanceCents;
      }

      const providerBalanceCents = invoice?.quickBooksBalanceCents === null || invoice?.quickBooksBalanceCents === undefined
        ? null
        : cents(invoice.quickBooksBalanceCents);
      const providerTotalCents = invoice?.quickBooksTotalCents === null || invoice?.quickBooksTotalCents === undefined
        ? null
        : cents(invoice.quickBooksTotalCents);
      const providerMismatch = providerBalanceCents !== null && providerBalanceCents !== invoiceBalanceCents;
      const providerAmountMismatch = providerTotalCents !== null && invoice && providerTotalCents !== cents(invoice.amountCents);
      const quickBooksReconciliationStatus = invoice?.quickBooksReconciliationStatus ?? (invoice?.status === "synced" ? "stale" : "not_synced");
      const quickBooksReconciledMs = new Date(invoice?.quickBooksReconciledAt || 0).getTime();
      const quickBooksReconciliationStale = invoice?.status === "synced"
        && !["queued", "failed"].includes(quickBooksReconciliationStatus)
        && (!Number.isFinite(quickBooksReconciledMs) || nowMs - quickBooksReconciledMs > 86_400_000);
      let reconciliationStatus = balanceCents === 0 ? "paid" : invoice ? "matched" : billable ? "unbilled" : "pipeline";
      if (unappliedAmountCents > 0) reconciliationStatus = creditCents > 0 ? "overpayment" : "unapplied";
      if (providerMismatch) reconciliationStatus = "quickbooks_mismatch";

      if (unappliedAmountCents > 0) exceptions.push({
        id: `unapplied:${application.id}`,
        type: creditCents > 0 ? "overpayment" : "unapplied_payment",
        severity: "high",
        applicationId: application.id,
        invoiceId: invoice?.id ?? null,
        amountCents: unappliedAmountCents,
        message: `${application.organizationName} has ${creditCents > 0 ? "an overpayment" : "unapplied funds"}.`
      });
      if (billable && balanceCents > 0 && !invoice) exceptions.push({
        id: `unbilled:${application.id}`,
        type: "unbilled_balance",
        severity: "high",
        applicationId: application.id,
        invoiceId: null,
        amountCents: balanceCents,
        message: `${application.organizationName} has an approved balance without an invoice.`
      });
      if (providerMismatch) exceptions.push({
        id: `quickbooks:${invoice.id}`,
        type: "quickbooks_mismatch",
        severity: "high",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: Math.abs(providerBalanceCents - invoiceBalanceCents),
        message: `${application.organizationName} local and QuickBooks balances differ.`
      });
      if (providerAmountMismatch) exceptions.push({
        id: `quickbooks-amount:${invoice.id}`,
        type: "quickbooks_amount_mismatch",
        severity: "high",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: Math.abs(providerTotalCents - cents(invoice.amountCents)),
        message: `${application.organizationName} invoice total differs from QuickBooks.`
      });
      if (quickBooksReconciliationStatus === "queued") exceptions.push({
        id: `quickbooks-refresh:${invoice.id}`,
        type: "quickbooks_refresh_pending",
        severity: "normal",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: 0,
        message: `${application.organizationName} QuickBooks balance refresh is queued.`
      });
      if (quickBooksReconciliationStatus === "failed") exceptions.push({
        id: `quickbooks-refresh:${invoice.id}`,
        type: "quickbooks_refresh_failed",
        severity: "high",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: 0,
        message: `${application.organizationName} QuickBooks balance refresh failed.`
      });
      if (quickBooksReconciliationStale) exceptions.push({
        id: `quickbooks-stale:${invoice.id}`,
        type: "quickbooks_refresh_stale",
        severity: "normal",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: 0,
        message: `${application.organizationName} QuickBooks balance has not been refreshed in the last 24 hours.`
      });
      if (daysOverdue > 0) exceptions.push({
        id: `overdue:${invoice.id}`,
        type: "overdue_invoice",
        severity: daysOverdue > 60 ? "high" : "normal",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: invoiceBalanceCents,
        message: `${application.organizationName} is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`
      });
      if (invoice && ["queued", "failed"].includes(invoice.status)) exceptions.push({
        id: `sync:${invoice.id}`,
        type: invoice.status === "failed" ? "invoice_sync_failed" : "invoice_sync_pending",
        severity: invoice.status === "failed" ? "high" : "normal",
        applicationId: application.id,
        invoiceId: invoice.id,
        amountCents: invoiceBalanceCents,
        message: `${application.organizationName} invoice sync is ${invoice.status}.`
      });

      return {
        applicationId: application.id,
        reference: application.reference,
        organizationName: application.organizationName,
        type: application.type,
        applicationStatus: application.status,
        expectedAmountCents,
        paidAmountCents,
        balanceCents,
        creditCents,
        unappliedAmountCents,
        invoice: invoice ? {
          id: invoice.id,
          status: invoice.status,
          dueAt: invoice.dueAt,
          balanceCents: invoiceBalanceCents,
          quickBooksTotalCents: providerTotalCents,
          quickBooksBalanceCents: providerBalanceCents,
          quickBooksDocNumber: invoice.quickBooksDocNumber ?? null,
          quickBooksReconciliationStatus,
          quickBooksReconciledAt: invoice.quickBooksReconciledAt ?? null
        } : null,
        daysOverdue,
        agingBucket,
        reconciliationStatus
      };
    })
    .filter(account => account.expectedAmountCents > 0 || account.paidAmountCents > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceCents - a.balanceCents || a.organizationName.localeCompare(b.organizationName));

  const activeAccounts = accounts.filter(account => billableStatuses.has(account.applicationStatus));
  return {
    generatedAt,
    totals: {
      expectedCents: accounts.reduce((sum, item) => sum + item.expectedAmountCents, 0),
      collectedCents: accounts.reduce((sum, item) => sum + item.paidAmountCents, 0),
      outstandingCents: activeAccounts.reduce((sum, item) => sum + item.balanceCents, 0),
      pipelineCents: accounts.filter(item => !billableStatuses.has(item.applicationStatus)).reduce((sum, item) => sum + item.balanceCents, 0),
      overdueCents: aging.days1To30Cents + aging.days31To60Cents + aging.days61To90Cents + aging.days90PlusCents,
      unappliedCents: accounts.reduce((sum, item) => sum + item.unappliedAmountCents, 0),
      creditCents: accounts.reduce((sum, item) => sum + item.creditCents, 0),
      accounts: accounts.length,
      exceptions: exceptions.length
    },
    aging,
    accounts,
    exceptions: exceptions.sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1) || b.amountCents - a.amountCents)
  };
}
import { DEFAULT_EVENT_ID } from "./event-context.mjs";

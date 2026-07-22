import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { normalizeConsent } from "./consent.mjs";
import { planEventRollover, ROLLOVER_DOCUMENT_KEYS } from "./event-rollover.mjs";
import { recordCameraObservation } from "./island-conditions.mjs";
import { boardDemoSyntheticConditions } from "./board-conditions.mjs";
import {
  beginIncomingDocumentExtraction,
  completeIncomingDocumentExtraction,
  createIncomingDocument,
  defaultIncomingDocumentReviewDueAt,
  emptyIncomingDocumentIntake,
  incomingDocumentStorageConfig,
  saveIncomingDocumentUpload,
  updateIncomingDocument
} from "./incoming-documents.mjs";
import { extractDocumentText } from "./document-extraction.mjs";
import { syncIncomingDocumentReviewTask } from "./document-review-routing.mjs";
import { partnerAssetStorageConfig, savePartnerAssetUpload } from "./partner-assets.mjs";
import {
  beginFollowupProviderSubmission,
  claimFollowupDelivery,
  confirmVendorAssignment,
  createOutreachCampaign,
  createOutreachProspect,
  createPartnerApplication,
  createPartnerBrandAsset,
  createPartnerInvoice,
  createPartnerMilestone,
  createPartnerTask,
  emptyPartnerOperations,
  prepareFollowupDraft,
  queueFollowupDelivery,
  recordFollowupDelivery,
  recordPartnerPayment,
  reviewFollowup,
  reviewPartnerBrandAsset,
  reviewPartnerBrandProfile,
  reviewPartnerInvoice,
  reviewVendorProfile,
  reviewVendorRequirement,
  updateOutreachProspect,
  updateOutreachCampaignStatus,
  updatePartnerApplication,
  updatePartnerBrandProfile,
  updatePartnerDeliverable,
  updatePartnerMilestone,
  updateVendorAssignment,
  updateVendorProfile
} from "./partner-ops.mjs";
import { issuePartnerPortalToken, partnerPortalConfig, partnerPortalUrl } from "./partner-portal.mjs";
import { platformDocumentFilePath } from "./platform-data.mjs";
import { readJsonFile, updateJsonFile, writeJsonFileAtomic } from "./safe-json-store.mjs";
import { normalizeRuntimeOwnerId } from "./runtime-root.mjs";
import { partnerCatalogDigest } from "./partner-catalog-publication.mjs";
import { DEFAULT_SPONSOR_PACKAGES, publicSponsorPackage } from "./sponsor-packages.mjs";
import { BOARD_DEMO_VENDOR_OFFERINGS, publicVendorOffering } from "./vendor-offerings.mjs";
import {
  createBudgetLine,
  createExpenseRequest,
  emptyBudgetControl,
  transitionExpense
} from "./budget-control.mjs";
import {
  createGuestServicesCase,
  emptyGuestServices,
  updateGuestServicesCase
} from "./guest-services.mjs";

const CONFIG_FILES = [
  ["data", "config", "admin-config.json"],
  ["data", "config", "emergency-alert.json"],
  ["data", "processed", "app-bootstrap.json"],
  ["data", "processed", "ticket-products.json"]
];

const BOARD_MESSAGE_MODES = new Set(["review_first", "local_automation"]);

export const BOARD_RUNTIME_SCHEMA_VERSION = 11;
export const BOARD_RUNTIME_LABEL = "Board demonstration | Synthetic 2027 data | No external messages, charges, or live-provider calls";

function requiredRuntimeOwnerId(value) {
  const ownerId = normalizeRuntimeOwnerId(value);
  if (!ownerId) throw new Error("Board runtime owner ID must contain 16 to 128 safe characters.");
  return ownerId;
}

export async function claimBoardRuntimeOwnership(runtimeRoot, ownerId, now = new Date().toISOString()) {
  const target = path.resolve(runtimeRoot);
  const markerPath = path.join(target, "board-runtime.json");
  return updateJsonFile(markerPath, marker => {
    if (marker?.kind !== "synthetic-board-demonstration") {
      throw new Error("Only a recognized synthetic board runtime can be claimed by the supervisor.");
    }
    return {
      ...marker,
      runtimeOwnerId: requiredRuntimeOwnerId(ownerId),
      ownershipClaimedAt: now
    };
  }, { fallback: null });
}

const BOARD_TICKET_PRICES = new Map([
  ["general-admission-3-day", 3000],
  ["vip-wristband-friday", 12500],
  ["vip-wristband-saturday", 12500],
  ["vip-wristband-sunday", 12500]
]);

function requireResult(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${result?.error || "unknown failure"}`);
  return result;
}

function boardSponsorPackage(id) {
  const sponsorPackage = DEFAULT_SPONSOR_PACKAGES.find(item => item.id === id);
  if (!sponsorPackage) throw new Error(`Board sponsor package not found: ${id}`);
  return sponsorPackage;
}

function idFactory() {
  let sequence = 0;
  return prefix => `demo_${prefix}_${String(++sequence).padStart(4, "0")}`;
}

function consentDemo(eventId, now) {
  return {
    _note: "Synthetic consent for the loopback-only board SMS sandbox. The reserved 555-01xx number cannot receive an external message.",
    eventId,
    lastUpdated: now,
    records: [normalizeConsent({
      id: "demo_consent_safety_0001",
      eventId,
      email: "safety.attendee@example.com",
      phone: "+13615550188",
      emailMarketing: { optedIn: false, at: null, source: null },
      smsMarketing: { optedIn: false, at: null, source: null },
      smsSafety: { optedIn: true, at: now, source: "checkout" },
      orderId: "demo_order_safety_0001",
      source: "checkout",
      createdAt: now,
      updatedAt: now
    }, { now })]
  };
}

function guestServicesDemo(eventId, now) {
  let doc = emptyGuestServices(eventId);
  let sequence = 0;
  const idFactory = prefix => `demo_${prefix}_${String(++sequence).padStart(4, "0")}`;
  const samples = [
    {
      category: "lost_item",
      title: "Blue canvas tote near the Family Sand Lab",
      details: "A blue canvas tote with sunscreen and a child's red hat was last seen beside the Family Sand Lab seating area.",
      location: "Family Sand Lab",
      festivalDay: "Saturday",
      contactName: "Avery Morgan",
      contactEmail: "avery.morgan@example.com",
      contactPhone: "+13615550141",
      contactPreference: "email",
      consentToContact: true
    },
    {
      category: "accessibility",
      title: "Beach wheelchair pickup guidance",
      details: "Please confirm the accessible pickup point and the best entrance for a beach wheelchair reservation.",
      location: "North Gate",
      festivalDay: "Saturday",
      contactName: "Jamie Rivera",
      contactEmail: "jamie.rivera@example.com",
      contactPhone: "+13615550142",
      contactPreference: "phone",
      consentToContact: true
    },
    {
      category: "ticketing",
      title: "Saturday wristband replacement",
      details: "The mobile ticket is available, but the original Saturday wristband was damaged after entry.",
      location: "North Gate",
      festivalDay: "Saturday",
      contactName: "Taylor Brooks",
      contactEmail: "taylor.brooks@example.com",
      contactPhone: "+13615550143",
      contactPreference: "email",
      consentToContact: true
    }
  ];
  for (const [index, input] of samples.entries()) {
    const created = requireResult(createGuestServicesCase(doc, input, {
      eventId,
      idFactory,
      referenceFactory: () => `TSF-GS-DEMO${index + 1}`,
      accessTokenFactory: ({ id, reference }) => `tsfg_demo_${id}_${reference}`,
      idempotencyKeyHash: `demo${String(index + 1).padStart(60, "0")}`,
      idempotencyFingerprint: `sample${String(index + 1).padStart(58, "0")}`,
      now
    }), `Create Guest Services demo case ${index + 1}`);
    doc = created.doc;
  }
  const accessibility = doc.cases.find(item => item.category === "accessibility");
  const progressed = requireResult(updateGuestServicesCase(doc, accessibility.id, {
    status: "in_progress",
    assignedTeam: "guest-services",
    priority: "high",
    publicMessage: "Guest Services confirmed the North Gate accessibility pickup point and is preparing arrival guidance.",
    publishUpdate: true
  }, { eventId, actorId: "board-demo", idFactory, now }), "Update Guest Services accessibility demo");
  doc = progressed.doc;
  const ticketing = doc.cases.find(item => item.category === "ticketing");
  return requireResult(updateGuestServicesCase(doc, ticketing.id, {
    status: "resolved",
    assignedTeam: "ticketing",
    priority: "normal",
    publicMessage: "Ticketing confirmed the replacement process at North Gate. Bring the mobile ticket and photo ID.",
    publishUpdate: true
  }, { eventId, actorId: "board-demo", idFactory, now }), "Resolve Guest Services ticketing demo").doc;
}

function ticketCatalogDemo(catalog, eventId, now) {
  return {
    ...catalog,
    _note: "Synthetic ticket prices for the loopback-only board payment sandbox. They are not approved public prices and no external payment is sent.",
    lastUpdated: now,
    checkoutPolicy: {
      eventId,
      version: "board-demo-2027-v1",
      status: "approved",
      acknowledgment: "I acknowledge the demonstration ticket terms, refund policy, filming notice, and service-animal policy.",
      notices: [
        {
          id: "ticket_terms",
          label: "Demonstration ticket terms",
          summary: "This local walkthrough creates synthetic ticket, payment, fulfillment, and accounting records only. It sends no external charge."
        },
        {
          id: "refund_policy",
          label: "Demonstration refund policy",
          summary: "Operations can reverse the local payment to demonstrate refund, fulfillment, and revenue reconciliation without contacting a provider."
        },
        {
          id: "filming_notice",
          label: "Demonstration filming notice",
          summary: "The production checkout can require the board-approved filming and photography notice before a customer continues to payment."
        },
        {
          id: "service_animals",
          label: "Demonstration service-animal policy",
          summary: "The production checkout can require the board-approved service-animal entry policy before a customer continues to payment."
        }
      ],
      approvedAt: now,
      approvedBy: "board-demo",
      updatedAt: now
    },
    products: (catalog.products || []).map(product => {
      const unitAmount = BOARD_TICKET_PRICES.get(product.id);
      if (!unitAmount) return product;
      return {
        ...product,
        unitAmount,
        priceLabel: `$${(unitAmount / 100).toFixed(2)} demo price`,
        stripePriceId: `price_board_demo_${product.id.replace(/[^a-z0-9]+/gi, "_")}`,
        active: true,
        requiresReview: false
      };
    })
  };
}

function budgetControlDemo(eventId, now) {
  const makeId = idFactory();
  let doc = emptyBudgetControl(eventId);
  const lineIds = new Map();
  const lineSeeds = [
    ["Beach infrastructure", "production", 14_000_000, "Structures, utilities, rentals, and beach build-out."],
    ["Artist program", "operations", 9_500_000, "Artist travel, lodging, materials, and competition support."],
    ["Traffic and public safety", "traffic", 8_000_000, "Traffic control, security, medical, and public safety support."],
    ["Marketing and media", "sponsor", 6_200_000, "Campaign production, media, signage, and sponsor promotion."],
    ["Guest services", "guest-services", 3_800_000, "Shuttles, accessibility, information, and visitor amenities."],
    ["Community grants", "finance", 11_500_000, "Synthetic allocation for nonprofit grants and scholarships."]
  ];
  for (const [name, ownerTeam, budgetCents, notes] of lineSeeds) {
    const result = requireResult(createBudgetLine(doc, { name, ownerTeam, budgetCents, notes }, {
      actorId: "board-demo",
      idFactory: makeId,
      now
    }), `Create ${name} budget`);
    doc = result.doc;
    lineIds.set(name, result.line.id);
  }

  const expenseSeeds = [
    ["Beach infrastructure", "Coastal Event Rentals", "Staging, power distribution, and beach structures", 7_850_000, "2026-10-15", "paid", "RAMP-DEMO-1001"],
    ["Artist program", "Sand Arts Travel Desk", "Artist travel and lodging deposits", 3_750_000, "2026-11-01", "paid", "RAMP-DEMO-1002"],
    ["Traffic and public safety", "Gulf Safety Services", "Event weekend safety and medical staffing", 4_200_000, "2027-02-15", "approved", null],
    ["Marketing and media", "Coastal Creative Studio", "Campaign production and sponsor media package", 2_840_000, "2027-01-31", "approved", null],
    ["Guest services", "Island Shuttle Cooperative", "Festival shuttle reservation and accessibility support", 2_200_000, "2027-02-01", "submitted", null],
    ["Community grants", "SandFest Community Partners", "First nonprofit grant and scholarship allocation", 7_000_000, "2027-03-15", "submitted", null],
    ["Beach infrastructure", "Coastal Event Rentals", "Optional contingency tent expansion", 1_850_000, "2027-03-01", "rejected", null]
  ];
  for (const [lineName, vendorName, description, amountCents, dueDate, status, paymentReference] of expenseSeeds) {
    let result = requireResult(createExpenseRequest(doc, {
      budgetLineId: lineIds.get(lineName),
      vendorName,
      description,
      amountCents,
      dueDate
    }, {
      actorId: "board-demo",
      idFactory: makeId,
      now
    }), `Create ${description}`);
    doc = result.doc;
    if (status === "approved" || status === "paid") {
      result = requireResult(transitionExpense(doc, result.expense.id, "approve", {}, { actorId: "board-demo-finance", now }), `Approve ${description}`);
      doc = result.doc;
    }
    if (status === "paid") {
      result = requireResult(transitionExpense(doc, result.expense.id, "mark_paid", {
        paymentMethod: "ramp",
        paymentReference,
        paidAt: now
      }, { actorId: "board-demo-finance", now }), `Pay ${description}`);
      doc = result.doc;
    }
    if (status === "rejected") {
      result = requireResult(transitionExpense(doc, result.expense.id, "reject", {
        note: "Deferred until the site footprint is finalized."
      }, { actorId: "board-demo-finance", now }), `Reject ${description}`);
      doc = result.doc;
    }
  }
  return {
    ...doc,
    _note: "Synthetic board-demo budget and expense approvals. No vendor payment or external accounting entry was created."
  };
}

function partnerDemo(eventId, now, { messageMode = "review_first", publicSiteUrl = "http://127.0.0.1:5175", partnerPortalSecret = null } = {}) {
  if (!BOARD_MESSAGE_MODES.has(messageMode)) throw new Error(`Unsupported board message mode: ${messageMode}.`);
  const makeId = idFactory();
  const options = { idFactory: makeId, eventId, now };
  const marlinPackage = boardSponsorPackage("marlin");
  const sailfishPackage = boardSponsorPackage("sailfish");
  let doc = emptyPartnerOperations(eventId);

  const sponsor = requireResult(createPartnerApplication(doc, {
    type: "sponsor",
    organizationName: "Gulf Shore Credit Union",
    contactName: "Jordan Lee",
    contactEmail: "jordan.lee@example.com",
    contactPhone: "361-555-0130",
    website: "https://example.com/gulf-shore",
    city: "Corpus Christi",
    state: "TX",
    postalCode: "78401",
    packageId: marlinPackage.id,
    packageName: marlinPackage.name,
    packageBenefits: [...marlinPackage.benefits],
    expectedAmountCents: marlinPackage.amount,
    source: "board_demo",
    consentToContact: true
  }, { ...options, portalAccessIdFactory: () => "demo-sponsor-portal" }), "Create sponsor demo");
  doc = sponsor.doc;

  const vendor = requireResult(createPartnerApplication(doc, {
    type: "vendor",
    organizationName: "Coastal Bites",
    contactName: "Taylor Morgan",
    contactEmail: "taylor.morgan@example.com",
    contactPhone: "361-555-0164",
    website: "https://example.com/coastal-bites",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    category: "food",
    offeringId: "food-beverage-booth",
    offeringName: "Food and beverage booth",
    description: "Gulf-inspired tacos and cold nonalcoholic drinks.",
    expectedAmountCents: 175000,
    source: "board_demo",
    consentToContact: true
  }, { ...options, portalAccessIdFactory: () => "demo-vendor-portal" }), "Create vendor demo");
  doc = vendor.doc;

  const sponsorStandby = requireResult(createPartnerApplication(doc, {
    type: "sponsor",
    organizationName: "Port Aransas Marine Supply",
    contactName: "Casey Hall",
    contactEmail: "casey.hall@example.com",
    contactPhone: "361-555-0142",
    website: "https://example.com/port-aransas-marine",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    packageId: sailfishPackage.id,
    packageName: sailfishPackage.name,
    packageBenefits: [...sailfishPackage.benefits],
    expectedAmountCents: sailfishPackage.amount,
    source: "board_demo",
    consentToContact: true
  }, { ...options, portalAccessIdFactory: () => "demo-sponsor-standby-portal" }), "Create standby sponsor demo");
  doc = sponsorStandby.doc;

  const vendorStandby = requireResult(createPartnerApplication(doc, {
    type: "vendor",
    organizationName: "Island Art Market",
    contactName: "Riley Chen",
    contactEmail: "riley.chen@example.com",
    contactPhone: "361-555-0171",
    website: "https://example.com/island-art-market",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    category: "artisan",
    offeringId: "marketplace-booth",
    offeringName: "Marketplace booth",
    description: "Coastal art, prints, and handmade festival keepsakes.",
    expectedAmountCents: 125000,
    source: "board_demo",
    consentToContact: true
  }, { ...options, portalAccessIdFactory: () => "demo-vendor-standby-portal" }), "Create standby vendor demo");
  doc = vendorStandby.doc;

  const vendorInterest = requireResult(createPartnerApplication(doc, {
    type: "vendor",
    intakeMode: "interest",
    organizationName: "Mustang Island Coffee Co",
    contactName: "Cameron Brooks",
    contactEmail: "cameron.brooks@example.com",
    contactPhone: "361-555-0182",
    website: "https://example.com/mustang-island-coffee",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    category: "service",
    offeringId: "marketplace-booth",
    offeringName: "Non-food vendor interest",
    description: "Locally roasted coffee and festival hospitality service.",
    expectedAmountCents: 0,
    source: "board_demo",
    consentToContact: true
  }, { ...options, portalAccessIdFactory: () => "demo-vendor-interest-portal" }), "Create vendor interest demo");
  doc = vendorInterest.doc;

  const portalConfig = partnerPortalConfig({
    SANDFEST_ENV: "development",
    SANDFEST_PUBLIC_SITE_URL: publicSiteUrl,
    ...(partnerPortalSecret ? { SANDFEST_PARTNER_PORTAL_SECRET: partnerPortalSecret } : {})
  });
  const portalUrlForApplication = application => {
    const token = issuePartnerPortalToken(application, { config: portalConfig });
    return token ? partnerPortalUrl(application, token, { config: portalConfig }) : null;
  };

  doc = requireResult(updatePartnerApplication(doc, sponsor.application.id, {
    status: "approved",
    ownerId: "sponsor-team"
  }, { ...options, actorId: "board-demo", portalUrlForApplication }), "Approve sponsor demo").doc;

  const invoice = requireResult(createPartnerInvoice(doc, sponsor.application.id, {
    dueAt: "2027-03-15T17:00:00.000Z",
    quickBooksItemId: "demo-sponsor-item"
  }, { ...options, actorId: "finance-demo" }), "Create sponsor invoice");
  doc = invoice.doc;
  doc = requireResult(reviewPartnerInvoice(doc, invoice.invoice.id, "approve", {
    ...options,
    actorId: "finance-demo"
  }), "Approve sponsor invoice").doc;
  doc = requireResult(recordPartnerPayment(doc, sponsor.application.id, {
    amountCents: 1000000,
    method: "ach",
    externalRef: "DEMO-ACH-2027-001",
    receivedAt: now
  }, options), "Record sponsor payment").doc;

  const brandProfile = requireResult(updatePartnerBrandProfile(doc, sponsor.application.id, {
    displayName: "Gulf Shore Credit Union",
    website: "https://example.com/gulf-shore",
    tagline: "Rooted on the Texas coast",
    primaryColor: "#006B63",
    secondaryColor: "#F4B942",
    usageNotes: "Use the full-color mark on light backgrounds."
  }, { ...options, actorId: `partner:${sponsor.application.id}` }), "Submit sponsor brand profile");
  doc = brandProfile.doc;
  doc = requireResult(reviewPartnerBrandProfile(doc, sponsor.application.id, { action: "approve" }, {
    ...options,
    actorId: "sponsor-demo"
  }), "Approve sponsor brand profile").doc;
  const sponsorProof = doc.deliverables.find(item => item.applicationId === sponsor.application.id);
  const approvedSponsorApplication = doc.applications.find(item => item.id === sponsor.application.id);
  const portalToken = issuePartnerPortalToken(approvedSponsorApplication, { config: portalConfig });
  doc = requireResult(updatePartnerDeliverable(doc, sponsorProof.id, {
    status: "published",
    ownerId: "sponsor-team",
    dueAt: "2027-03-20T17:00:00.000Z",
    proofUrl: "https://www.texassandfest.org/sponsors/gulf-shore-credit-union",
    proofNotes: "Homepage sponsor placement is ready for approval."
  }, {
    ...options,
    actorId: "sponsor-demo",
    portalUrl: partnerPortalUrl(approvedSponsorApplication, portalToken, { config: portalConfig })
  }), "Publish sponsor deliverable proof").doc;

  doc = requireResult(updateVendorProfile(doc, vendor.application.id, {
    legalName: "Coastal Bites LLC",
    boothName: "Coastal Bites",
    website: "https://example.com/coastal-bites",
    publicDescription: "Fresh Gulf-inspired tacos and cold drinks.",
    emergencyContactName: "Taylor Morgan",
    emergencyContactPhone: "361-555-0164",
    powerNeed: "30a",
    waterRequired: true,
    cookingMethod: "propane",
    vehicleLengthFeet: 24,
    operationalNotes: "One refrigerated trailer; south service gate access."
  }, { ...options, actorId: `partner:${vendor.application.id}` }), "Submit vendor profile").doc;
  doc = requireResult(reviewVendorProfile(doc, vendor.application.id, { action: "approve" }, {
    ...options,
    actorId: "vendor-demo"
  }), "Approve vendor profile").doc;
  for (const requirement of doc.vendorRequirements.filter(item => item.applicationId === vendor.application.id)) {
    doc = requireResult(reviewVendorRequirement(doc, requirement.id, {
      status: "waived",
      reviewNotes: "Synthetic board-demonstration clearance; no live compliance document was accepted."
    }, { ...options, actorId: "vendor-demo" }), `Clear ${requirement.label}`).doc;
  }
  doc = requireResult(updateVendorAssignment(doc, vendor.application.id, {
    status: "scheduled",
    boothNumber: "F-14",
    zone: "South marketplace",
    accessGate: "South service gate",
    loadInStart: "2027-04-15T13:00:00.000Z",
    loadInEnd: "2027-04-15T15:00:00.000Z",
    loadOutStart: "2027-04-18T19:30:00.000Z",
    loadOutEnd: "2027-04-18T21:30:00.000Z",
    parkingPasses: 1,
    staffWristbands: 4,
    instructions: "Use the south service gate and stage the refrigerated trailer inside the marked F-14 footprint."
  }, { ...options, actorId: "vendor-demo" }), "Schedule vendor assignment").doc;
  doc = requireResult(confirmVendorAssignment(doc, vendor.application.id, {
    ...options,
    actorId: `partner:${vendor.application.id}`
  }), "Confirm vendor assignment").doc;

  for (const followupId of [sponsor.followup.id, vendor.followup.id, sponsorStandby.followup.id, vendorStandby.followup.id, vendorInterest.followup.id]) {
    doc = requireResult(prepareFollowupDraft(doc, followupId, {
      now,
      portalUrl: "https://www.texassandfest.org/#partner-status"
    }), "Prepare review-first acknowledgment").doc;
  }

  doc = requireResult(createPartnerTask(doc, {
    title: "Confirm south gate staffing plan",
    description: "Coordinate volunteer coverage with traffic and vendor load-in teams.",
    assigneeType: "volunteer",
    assigneeId: "vol_001",
    assigneeName: "Alex Rivera",
    assigneeRole: "gate",
    priority: "urgent",
    dueAt: "2027-03-15T17:00:00.000Z"
  }, { ...options, actorId: "board-demo" }), "Create delegated task").doc;
  doc = requireResult(createPartnerTask(doc, {
    title: "Review vendor load-in briefing",
    description: "Confirm the F-14 service-gate route and publish the final staff briefing.",
    assigneeType: "staff",
    assigneeId: "staff_operations",
    assigneeName: "Jamie Torres",
    assigneeRole: "ops_admin",
    priority: "high",
    dueAt: "2027-03-20T17:00:00.000Z"
  }, { ...options, actorId: "board-demo" }), "Create staff task").doc;

  const prospect = requireResult(createOutreachProspect(doc, {
    organizationName: "Island Harbor Hotel",
    contactName: "Morgan Reyes",
    contactEmail: "morgan.reyes@example.com",
    industry: "hospitality",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8339,
    longitude: -97.0611
  }, options), "Create outreach prospect");
  doc = prospect.doc;
  doc = requireResult(updateOutreachProspect(doc, prospect.prospect.id, {
    status: "contact_ready",
    contactBasis: "business_relevance",
    ownerId: "sponsor",
    nextAction: "Issue the reviewed Tarpon sponsor invitation",
    nextActionAt: new Date(new Date(now).getTime() + 3 * 86_400_000).toISOString()
  }, { ...options, actorId: "sponsor-demo" }), "Qualify outreach prospect").doc;
  const outreachCampaign = requireResult(createOutreachCampaign(doc, {
    name: "2027 coastal hospitality partners",
    objective: "Introduce the 2027 sponsor program to businesses serving festival visitors.",
    deliveryMode: "approved_sequence",
    dailySendLimit: 5,
    targeting: {
      industries: ["hospitality"],
      cities: ["Port Aransas"],
      states: ["TX"],
      postalCodes: ["78373"],
      geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 25 },
      minFitScore: 60
    },
    sequence: [
      { delayDays: 0, subjectTemplate: "A SandFest partnership for {{organization}}", bodyTemplate: "Hello {{contactName}},\n\nWe would like to explore a 2027 partnership in {{city}}." },
      { delayDays: 7, subjectTemplate: "Following up with {{organization}}", bodyTemplate: "Hello {{contactName}},\n\nMay we answer any Texas SandFest sponsorship questions?" }
    ]
  }, { ...options, actorId: "sponsor-demo" }), "Create outreach campaign");
  doc = outreachCampaign.doc;
  if (messageMode === "local_automation") {
    doc = requireResult(updateOutreachCampaignStatus(doc, outreachCampaign.campaign.id, "activate", {
      ...options,
      actorId: "sponsor-demo",
      providerReady: true
    }), "Approve local outreach automation").doc;
  }

  const reviewProspect = requireResult(createOutreachProspect(doc, {
    organizationName: "Coastal Bend Community Bank",
    contactName: "Avery Martinez",
    contactEmail: "avery.martinez@example.com",
    industry: "banking",
    city: "Corpus Christi",
    state: "TX",
    postalCode: "78418",
    latitude: 27.6506,
    longitude: -97.2914
  }, options), "Create review-first outreach prospect");
  doc = reviewProspect.doc;
  doc = requireResult(updateOutreachProspect(doc, reviewProspect.prospect.id, {
    status: "contact_ready",
    contactBasis: "business_relevance",
    ownerId: "sponsor",
    nextAction: "Review the opening community partnership note",
    nextActionAt: new Date(new Date(now).getTime() + 86_400_000).toISOString()
  }, { ...options, actorId: "sponsor-demo" }), "Qualify review-first outreach prospect").doc;
  const reviewCampaign = requireResult(createOutreachCampaign(doc, {
    name: "2027 Coastal Bend community partners",
    objective: "Review a locally relevant sponsor introduction before any provider delivery.",
    deliveryMode: "review_first",
    dailySendLimit: 10,
    targeting: {
      industries: ["banking"],
      cities: ["Corpus Christi"],
      states: ["TX"],
      postalCodes: ["78418"],
      geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 30 },
      minFitScore: 60
    },
    sequence: [
      { delayDays: 0, subjectTemplate: "A community partnership for {{organization}}", bodyTemplate: "Hello {{contactName}},\n\nWe would like to share a reviewed Texas SandFest community partnership opportunity serving {{city}}." }
    ]
  }, { ...options, actorId: "sponsor-demo" }), "Create review-first outreach campaign");
  doc = reviewCampaign.doc;
  doc = requireResult(updateOutreachCampaignStatus(doc, reviewCampaign.campaign.id, "activate", {
    ...options,
    actorId: "sponsor-demo",
    providerReady: true
  }), "Activate review-first outreach campaign").doc;

  const dueDates = {
    "Qualify opportunity": "2026-10-15T17:00:00.000Z",
    "Confirm package": "2027-01-15T17:00:00.000Z",
    "Artwork due": "2027-02-15T17:00:00.000Z",
    "Review application": "2026-09-15T17:00:00.000Z",
    "Collect documents": "2027-02-28T17:00:00.000Z",
    "Payment due": "2027-03-15T17:00:00.000Z"
  };
  for (const milestone of [...doc.milestones]) {
    const dueAt = dueDates[milestone.label];
    if (!dueAt) continue;
    doc = requireResult(updatePartnerMilestone(doc, milestone.id, { dueAt }, {
      ...options,
      actorId: "board-demo"
    }), "Schedule partner milestone").doc;
  }
  const sponsorCreativeMilestone = requireResult(createPartnerMilestone(doc, sponsor.application.id, {
    label: "Sponsor homepage creative approval",
    dueAt: new Date(new Date(now).getTime() + 2 * 86_400_000).toISOString(),
    assigneeTeam: "sponsor",
    reminderLeadDays: 3,
    notes: "Approve the final homepage logo placement and sponsor proof before publication."
  }, { ...options, actorId: "sponsor-demo" }), "Create automatic sponsor creative follow-up");
  doc = sponsorCreativeMilestone.doc;

  if (messageMode === "local_automation") {
    const providerVerificationId = "demo_followup_provider_verification";
    const providerVerificationClaimId = "job_board_provider_verification";
    const application = doc.applications.find(item => item.id === sponsorStandby.application.id);
    if (!application) throw new Error("Board provider-verification sponsor is unavailable.");
    doc = {
      ...doc,
      lastUpdated: now,
      followups: [...doc.followups, {
        id: providerVerificationId,
        applicationId: application.id,
        kind: "provider_verification_demo",
        workflowKey: `board-provider-verification:${application.id}`,
        sourceVersion: "board-provider-verification-v1",
        channel: "email",
        recipient: application.contactEmail,
        status: "draft_ready",
        dueAt: now,
        subject: `Provider verification required - ${application.organizationName}`,
        body: `Hello ${application.contactName},\n\nThis synthetic board-demo message represents a provider handoff whose final outcome could not be trusted. Operations must verify the provider result before any retry.\n\nTexas SandFest`,
        deliveryIdempotencyKey: "00000000-0000-4000-8000-000000000157",
        deliveryAttempts: 0,
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        queuedAt: null,
        provider: null,
        providerMessageId: null,
        createdAt: now,
        updatedAt: now
      }]
    };
    doc = requireResult(reviewFollowup(doc, providerVerificationId, "approve", {
      ...options,
      actorId: "board-demo-communications"
    }), "Approve provider-verification demo").doc;
    doc = requireResult(queueFollowupDelivery(doc, providerVerificationId, { now }), "Queue provider-verification demo").doc;
    doc = requireResult(claimFollowupDelivery(doc, providerVerificationId, {
      deliveryClaimId: providerVerificationClaimId,
      now
    }), "Claim provider-verification demo").doc;
    doc = requireResult(beginFollowupProviderSubmission(doc, providerVerificationId, {
      deliveryClaimId: providerVerificationClaimId,
      now
    }), "Begin provider-verification demo").doc;
    doc = requireResult(recordFollowupDelivery(doc, providerVerificationId, {
      sent: false,
      provider: "worker",
      error: "Synthetic provider response was interrupted after submission began."
    }, {
      deliveryClaimId: providerVerificationClaimId,
      terminal: true,
      unknownOutcome: true,
      now
    }), "Record unknown provider-verification outcome").doc;
  }

  return {
    ...doc,
    _note: "Synthetic 2027 board demonstration data. Messages stay in the local sandbox and no real payments are sent.",
    lastUpdated: now,
    automationMode: messageMode === "local_automation" ? "transactional_auto" : "review_first"
  };
}

async function sponsorBrandAssetDemo(sourceRoot, runtimeRoot, doc, eventId, now) {
  const application = doc.applications.find(item => item.organizationName === "Gulf Shore Credit Union" && item.type === "sponsor");
  if (!application) throw new Error("Board sponsor application is unavailable for branding.");
  const storageConfig = partnerAssetStorageConfig(runtimeRoot, { SANDFEST_ENV: "development" });
  const options = { eventId, now, idFactory: idFactory() };
  const fixtures = [
    {
      id: "demo_brand_asset_gulf_shore_primary",
      kind: "primary_logo",
      label: "Gulf Shore Credit Union primary emblem",
      fileName: "gulf-shore-credit-union-emblem.png"
    },
    {
      id: "demo_brand_asset_gulf_shore_horizontal",
      kind: "alternate_logo",
      label: "Gulf Shore Credit Union horizontal logo",
      fileName: "gulf-shore-credit-union-logo.png"
    }
  ];
  let next = doc;
  for (const fixture of fixtures) {
    const buffer = await readFile(path.join(sourceRoot, "docs", "board-demo-assets", fixture.fileName));
    const saved = requireResult(await savePartnerAssetUpload(runtimeRoot, {
      applicationId: application.id,
      assetId: fixture.id,
      fileName: fixture.fileName,
      contentType: "image/png",
      buffer
    }, { config: storageConfig }), `Store ${fixture.label}`);
    const created = requireResult(createPartnerBrandAsset(next, application.id, {
      id: fixture.id,
      kind: fixture.kind,
      label: fixture.label,
      ...saved
    }, { ...options, actorId: `partner:${application.id}` }), `Submit ${fixture.label}`);
    next = requireResult(reviewPartnerBrandAsset(created.doc, created.asset.id, { status: "approved" }, {
      ...options,
      actorId: "sponsor-demo"
    }), `Approve ${fixture.label}`).doc;
  }
  return next;
}

function revenueDemo(eventId, now) {
  return {
    _note: "Synthetic current-event imports for the board demonstration. Site-native partner payments are merged by the revenue API.",
    eventId,
    lastUpdated: now,
    currency: "usd",
    expectedAttendance: 100000,
    ticketCapacity: 40000,
    entries: [
      {
        id: "demo_revenue_stripe_tickets",
        eventId,
        date: now,
        source: "stripe",
        category: "ticket",
        grossCents: 450000,
        feeCents: 13350,
        quantity: 100,
        reconciled: true,
        qbClass: "Tickets",
        qbAccount: "Ticket Revenue",
        externalRef: "demo-stripe-ticket-batch-2027",
        note: "Synthetic 2027 ticket batch",
        entryType: "receipt",
        origin: "imported",
        importBatchId: "demo_import_stripe_tickets",
        importedAt: now,
        importedBy: "board-demo"
      },
      {
        id: "demo_revenue_eventeny_vendor",
        eventId,
        date: now,
        source: "eventeny",
        category: "vendor_fee",
        grossCents: 175000,
        feeCents: 10325,
        quantity: 1,
        reconciled: false,
        qbClass: "Vendor Fees",
        qbAccount: "Vendor Booth Revenue",
        externalRef: "demo-eventeny-vendor-batch-2027",
        note: "Synthetic 2027 vendor settlement",
        entryType: "receipt",
        origin: "imported",
        importBatchId: "demo_import_eventeny_vendor",
        importedAt: now,
        importedBy: "board-demo"
      },
      {
        id: "demo_revenue_square_merch",
        eventId,
        date: now,
        source: "square",
        category: "merch",
        grossCents: 125000,
        feeCents: 3750,
        quantity: 50,
        reconciled: true,
        qbClass: "Merch",
        qbAccount: "Merchandise Revenue",
        externalRef: "demo-square-merch-batch-2027",
        note: "Synthetic 2027 merchandise settlement",
        entryType: "receipt",
        origin: "imported",
        importBatchId: "demo_import_square_merch",
        importedAt: now,
        importedBy: "board-demo"
      }
    ],
    imports: [
      {
        id: "demo_import_stripe_tickets",
        eventId,
        source: "stripe",
        fileName: "stripe-ticket-settlement-demo.csv",
        previewHash: "a".repeat(64),
        importedAt: now,
        importedBy: "board-demo",
        rows: 1,
        imported: 1,
        duplicates: 0,
        invalid: 0,
        grossCents: 450000,
        feeCents: 13350,
        netCents: 436650
      },
      {
        id: "demo_import_eventeny_vendor",
        eventId,
        source: "eventeny",
        fileName: "eventeny-vendor-settlement-demo.csv",
        previewHash: "b".repeat(64),
        importedAt: now,
        importedBy: "board-demo",
        rows: 1,
        imported: 1,
        duplicates: 0,
        invalid: 0,
        grossCents: 175000,
        feeCents: 10325,
        netCents: 164675
      },
      {
        id: "demo_import_square_merch",
        eventId,
        source: "square",
        fileName: "square-merch-settlement-demo.csv",
        previewHash: "c".repeat(64),
        importedAt: now,
        importedBy: "board-demo",
        rows: 1,
        imported: 1,
        duplicates: 0,
        invalid: 0,
        grossCents: 125000,
        feeCents: 3750,
        netCents: 121250
      }
    ]
  };
}

async function incomingDocumentDemo(sourceRoot, runtimeRoot, eventId, now) {
  const storageConfig = incomingDocumentStorageConfig(runtimeRoot, {
    SANDFEST_ENV: "development",
    SANDFEST_INCOMING_DOCUMENT_DIR: path.join(runtimeRoot, "private", "incoming-documents")
  });
  const fixtures = [
    {
      id: "demo_document_board_priorities",
      domain: "docs",
      title: "2027 board priorities",
      fileName: "2027-board-priorities.txt",
      contentType: "text/plain",
      ownerTeam: "operations",
      reviewDueAt: "2026-10-01T17:00:00.000Z",
      status: "approved",
      notes: "Reviewed for the board operating packet.",
      body: "Texas SandFest 2027 board priorities\n\n1. Partner revenue and fulfillment\n2. Event-day staffing and delegation\n3. Island arrival conditions\n4. Controlled document intake\n"
    },
    {
      id: "demo_document_vendor_load_in",
      domain: "eventeny",
      title: "Vendor load-in matrix",
      fileName: "vendor-load-in-matrix.csv",
      contentType: "text/csv",
      ownerTeam: "operations",
      reviewDueAt: "2027-01-15T17:00:00.000Z",
      status: "in_review",
      notes: "Confirm south gate windows with Traffic.",
      body: "vendor,booth,gate,load_in_start,load_in_end\nCoastal Bites,F-14,South,2027-04-15 08:00,2027-04-15 09:00\n"
    },
    {
      id: "demo_document_sponsor_benefits",
      domain: "finance",
      title: "Sponsor benefit approvals",
      fileName: "sponsor-benefit-approvals.json",
      contentType: "application/json",
      ownerTeam: "finance",
      reviewDueAt: "2027-01-20T17:00:00.000Z",
      status: "received",
      notes: null,
      body: `${JSON.stringify({ eventId, sponsor: "Gulf Shore Credit Union", package: "Marlin", approvedBudgetCents: boardSponsorPackage("marlin").amount }, null, 2)}\n`
    },
    {
      id: "demo_document_board_platform_briefing",
      domain: "docs",
      title: "SandFest board platform briefing",
      fileName: "SandFest-Board-Platform-Briefing.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ownerTeam: "operations",
      reviewDueAt: "2027-01-22T18:00:00.000Z",
      status: "received",
      notes: null,
      sourcePath: ["docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"],
      extract: true
    }
  ];
  let doc = emptyIncomingDocumentIntake(eventId);
  for (const fixture of fixtures) {
    const buffer = fixture.sourcePath
      ? await readFile(path.join(sourceRoot, ...fixture.sourcePath))
      : Buffer.from(fixture.body, "utf8");
    const saved = await saveIncomingDocumentUpload(runtimeRoot, {
      documentId: fixture.id,
      eventId,
      fileName: fixture.fileName,
      contentType: fixture.contentType,
      buffer
    }, { config: storageConfig });
    requireResult(saved, `Store ${fixture.title}`);
    const created = requireResult(createIncomingDocument(doc, {
      ...saved,
      id: fixture.id,
      domain: fixture.domain,
      title: fixture.title,
      ownerTeam: fixture.ownerTeam,
      reviewDueAt: fixture.reviewDueAt || defaultIncomingDocumentReviewDueAt(now)
    }, { eventId, actorId: "board-demo", now }), `Register ${fixture.title}`);
    doc = created.doc;
    if (fixture.extract) {
      const started = requireResult(beginIncomingDocumentExtraction(doc, fixture.id, {
        extractionVersion: created.document.extractionVersion,
        jobId: "board-runtime-preparation"
      }, { eventId, now }), `Start extraction for ${fixture.title}`);
      const extracted = requireResult(await extractDocumentText(buffer, started.document), `Extract ${fixture.title}`);
      doc = requireResult(completeIncomingDocumentExtraction(started.doc, fixture.id, {
        ...extracted,
        extractionVersion: started.document.extractionVersion
      }, { eventId, now }), `Complete extraction for ${fixture.title}`).doc;
    }
    if (fixture.status !== "received" || fixture.notes) {
      doc = requireResult(updateIncomingDocument(doc, fixture.id, {
        status: fixture.status,
        ownerTeam: fixture.ownerTeam,
        notes: fixture.notes
      }, { eventId, actorId: "board-demo", now }), `Review ${fixture.title}`).doc;
    }
  }
  return { ...doc, _note: "Private documents prepared for the loopback-only board demonstration." };
}

function shiftDemo(source, eventId) {
  const dates = { Friday: "2027-04-16", Saturday: "2027-04-17", Sunday: "2027-04-18" };
  const withDate = (value, date) => value && value.includes("T") ? `${date}T${value.split("T")[1]}` : value;
  return (source.shifts || []).map(shift => {
    const date = dates[shift.day] || "2027-04-16";
    return {
      ...shift,
      eventId,
      startsAt: withDate(shift.startsAt, date),
      endsAt: withDate(shift.endsAt, date)
    };
  });
}

export function boardDemoEngagement(roster, { eventId, hunt = {}, now = new Date().toISOString() } = {}) {
  if (roster?.meta?.source !== "fictional_board_demo" || roster?.meta?.eventId !== eventId) {
    throw new Error("Board engagement requires the current fictional board-demo roster.");
  }
  const sculptors = new Map((roster.sculptors || []).map(item => [item.id, item]));
  const entries = (roster.entries || []).map((entry, index) => ({
    id: entry.id,
    title: entry.title,
    sculptorName: sculptors.get(entry.sculptorId)?.name || "Demonstration artist",
    division: entry.division,
    beachMarker: entry.beachMarker,
    eligible: true,
    order: index + 1
  }));
  const huntId = hunt.id || `sculpture-passport-${String(eventId || "").match(/\d{4}$/)?.[0] || "demo"}`;
  const checkpoints = entries.map((entry, index) => ({
    id: `cp_${entry.id}`,
    huntId,
    label: entry.title,
    kind: "sculpture",
    linkedRecord: { type: "sculptureEntry", id: entry.id },
    mapMarkerId: roster.entries?.[index]?.poiId || null,
    code: `TSF-DEMO-${String(index + 1).padStart(4, "0")}`,
    unlockContent: `${entry.sculptorName}: ${roster.entries?.[index]?.statement || "Board demonstration sculpture."}`,
    points: 10,
    order: index + 1,
    beachMarker: entry.beachMarker,
    sculptorName: entry.sculptorName,
    entryId: entry.id,
    division: entry.division
  }));
  return {
    passportHunt: {
      _note: "Synthetic Sculpture Passport for the loopback-only board demonstration.",
      lastUpdated: now,
      hunt: {
        ...hunt,
        id: huntId,
        eventId,
        active: true,
        description: "Board demonstration mode for the 2027 Sculpture Passport."
      },
      checkpoints
    },
    passportCompletions: {
      _note: "Synthetic passport progress for the loopback-only board demonstration.",
      lastUpdated: now,
      completions: checkpoints.slice(0, 4).map((checkpoint, index) => ({
        id: `demo_completion_${index + 1}`,
        huntId,
        checkpointId: checkpoint.id,
        attendeeRef: index < 3 ? "demo_attendee_001" : "demo_attendee_002",
        at: now,
        method: "qr_scan",
        pointsAwarded: checkpoint.points
      }))
    },
    voting: {
      _note: "Synthetic People's Choice ballot for the loopback-only board demonstration.",
      lastUpdated: now,
      eventId,
      publicationStatus: "sample",
      source: "fictional_board_demo",
      votingOpen: true,
      title: "People's Choice demonstration",
      description: "Synthetic ballot showing the planned voting workflow.",
      entries: entries.map(({ order, ...entry }) => entry),
      votes: entries.slice(0, 4).map((entry, index) => ({
        id: `demo_vote_${index + 1}`,
        eventId,
        entryId: entry.id,
        attendeeRef: `demo_voter_${String(index + 1).padStart(3, "0")}`,
        channel: "web",
        at: now
      }))
    }
  };
}

function engagementDemo(documents, roster, eventId, now) {
  const engagement = boardDemoEngagement(roster, {
    eventId,
    hunt: documents.passportHunt.hunt,
    now
  });
  documents.passportHunt = {
    ...engagement.passportHunt
  };
  documents.passportCompletions = engagement.passportCompletions;
  documents.voting = engagement.voting;
}

function operationsDemo(documents, sourceDocuments, eventId, now) {
  documents.staffDirectory = {
    ...documents.staffDirectory,
    eventId,
    source: "board_demo",
    lastUpdated: now,
    verifiedAt: now,
    staff: (documents.staffDirectory.staff || []).map(item => ({ ...item, eventId, status: "active" }))
  };
  const shifts = shiftDemo(sourceDocuments.volunteers, eventId);
  const checkedInVolunteerId = shifts[0]?.filledVolunteerIds?.[0] || null;
  documents.volunteers = {
    ...documents.volunteers,
    volunteers: documents.volunteers.volunteers.map((volunteer, index) => ({
      ...volunteer,
      status: volunteer.id === checkedInVolunteerId ? "checked_in" : index < 10 ? "confirmed" : "invited"
    })),
    shifts,
    hourLogs: checkedInVolunteerId ? [{
      id: "demo_attendance_001",
      eventId,
      volunteerId: checkedInVolunteerId,
      shiftId: shifts[0].id,
      checkInAt: now,
      checkOutAt: null,
      hours: 0,
      verifiedBy: "board-demo-volunteer-captain",
      method: "captain",
      notes: "Synthetic active shift for the board attendance walkthrough.",
      source: "sandfest_live"
    }] : []
  };

  const asset = documents.fleet.assets[0];
  if (asset) {
    documents.fleet = {
      ...documents.fleet,
      assets: documents.fleet.assets.map(item => item.id === asset.id ? { ...item, status: "checked_out" } : item),
      checkouts: [{
        id: "demo_checkout_001",
        assetId: asset.id,
        eventId,
        checkedOutTo: "Board Demo - Site Operations",
        team: "site-ops",
        checkOutAt: now,
        checkInAt: null,
        startCondition: "good",
        endCondition: null,
        startChargePct: 96,
        endChargePct: null,
        damageReport: null,
        signatureBy: "board-demo",
        method: "demo"
      }],
      locations: [{
        id: "demo_location_001",
        assetId: asset.id,
        at: now,
        lat: 27.8402,
        lng: -97.0605,
        beachMarker: "12.5",
        source: "board-demo"
      }]
    };
  }

  const metrics = [
    ["ferry-loading", { vehicleCount: 42, queueLength: 18, estimatedWaitMinutes: 14 }],
    ["ferry-stacking", { vehicleCount: 31, queueLength: 12, estimatedWaitMinutes: 10 }],
    ["harbor-island-entrance", { vehicleCount: 24, flowPerMinute: 11 }],
    ["harbor-island-stacking", { vehicleCount: 19, queueLength: 7 }],
    ["north-gate", { peopleCount: 126, occupancyPct: 58, flowPerMinute: 22, queueLength: 16 }],
    ["south-gate", { peopleCount: 84, occupancyPct: 41, flowPerMinute: 17, queueLength: 9 }],
    ["food-court", { peopleCount: 210, occupancyPct: 67, queueLength: 14 }],
    ["competition-corridor", { peopleCount: 168, occupancyPct: 62, flowPerMinute: 20 }]
  ];
  let conditions = boardDemoSyntheticConditions(documents.islandConditions, now);
  for (const [cameraId, observation] of metrics) {
    const recorded = recordCameraObservation(conditions, cameraId, {
      ...observation,
      observedAt: now
    }, {
      idFactory: prefix => `demo_${prefix}_${cameraId}`,
      now,
      source: "board-simulation"
    });
    if (recorded.ok) conditions = recorded.doc;
  }
  documents.islandConditions = conditions;
}

async function readSourceDocuments(sourceRoot) {
  return Object.fromEntries(await Promise.all(ROLLOVER_DOCUMENT_KEYS.map(async key => [
    key,
    await readJsonFile(platformDocumentFilePath(sourceRoot, key), null)
  ])));
}

export async function prepareBoardRuntime({ sourceRoot, targetRoot, eventId, now = new Date().toISOString(), replace = false, messageMode = "review_first", runtimeOwnerId = null, publicSiteUrl = "http://127.0.0.1:5175", partnerPortalSecret = null } = {}) {
  const source = path.resolve(sourceRoot || ".");
  const target = path.resolve(targetRoot || path.join(source, ".sandfest-runtime", "board-2027"));
  if (source === target || target === path.parse(target).root) throw new Error("Board runtime target must be an isolated directory.");

  const bootstrap = await readJsonFile(path.join(source, "data", "processed", "app-bootstrap.json"), null);
  const targetEventId = eventId || bootstrap?.guide?.id;
  const sourceDocuments = await readSourceDocuments(source);
  const demoRoster = await readJsonFile(path.join(source, "src", "board-demo", "sculptors-demo.json"), null);
  const demoSchedule = await readJsonFile(path.join(source, "src", "board-demo", "schedule-demo.json"), null);
  if (!Array.isArray(demoSchedule) || !demoSchedule.length) throw new Error("Board demonstration schedule is missing.");
  const sourceEventId = sourceDocuments.fleet?.eventId;
  const rollover = planEventRollover({
    fromEventId: sourceEventId,
    toEventId: targetEventId,
    guide: bootstrap?.guide,
    documents: sourceDocuments,
    now
  });
  if (!rollover.ok) throw new Error(rollover.error);

  const documents = structuredClone(rollover.documents);
  documents.guestServices = guestServicesDemo(targetEventId, now);
  documents.partnerOps = partnerDemo(targetEventId, now, { messageMode, publicSiteUrl, partnerPortalSecret });
  documents.budgetControl = budgetControlDemo(targetEventId, now);
  documents.consent = consentDemo(targetEventId, now);
  const revenue = revenueDemo(targetEventId, now);
  engagementDemo(documents, demoRoster, targetEventId, now);
  operationsDemo(documents, sourceDocuments, targetEventId, now);

  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    documents.partnerOps = await sponsorBrandAssetDemo(source, temporary, documents.partnerOps, targetEventId, now);
    documents.incomingDocuments = await incomingDocumentDemo(source, temporary, targetEventId, now);
    let documentTaskSequence = 0;
    const documentTaskIdFactory = prefix => `demo_document_${prefix}_${String(++documentTaskSequence).padStart(4, "0")}`;
    for (const record of documents.incomingDocuments.documents) {
      documents.partnerOps = requireResult(syncIncomingDocumentReviewTask(documents.partnerOps, record, {
        actorId: "board-demo",
        idFactory: documentTaskIdFactory,
        now
      }), `Route ${record.title}`).doc;
    }
    for (const segments of CONFIG_FILES) {
      let value = await readJsonFile(path.join(source, ...segments), null);
      if (value == null) throw new Error(`Missing board runtime source: ${segments.join("/")}`);
      if (segments.at(-1) === "app-bootstrap.json") {
        value = {
          ...value,
          schedule: structuredClone(demoSchedule),
          schedulePublication: {
            status: "board_demo",
            eventId: targetEventId,
            sourceUrl: null,
            sourceCheckedAt: null,
            publishedAt: null,
            publishedBy: null,
            heldAt: null,
            heldBy: null,
            holdReason: null,
            lastUpdated: now
          },
          runtime: {
            mode: "board_demo",
            label: BOARD_RUNTIME_LABEL
          }
        };
      } else if (segments.at(-1) === "admin-config.json") {
        const sponsorItems = DEFAULT_SPONSOR_PACKAGES.map(publicSponsorPackage);
        const vendorItems = BOARD_DEMO_VENDOR_OFFERINGS.map(publicVendorOffering);
        value = {
          ...value,
          lastUpdated: now,
          vendorOfferings: structuredClone(BOARD_DEMO_VENDOR_OFFERINGS),
          sponsorPackagePublication: {
            status: "board_demo",
            eventId: targetEventId,
            catalogDigest: partnerCatalogDigest("sponsor", sponsorItems),
            sourceUrl: null,
            sourceCheckedAt: null,
            publishedAt: null,
            publishedBy: null,
            heldAt: null,
            heldBy: null,
            holdReason: null,
            lastUpdated: now
          },
          vendorOfferingPublication: {
            status: "board_demo",
            eventId: targetEventId,
            catalogDigest: partnerCatalogDigest("vendor", vendorItems),
            sourceUrl: null,
            sourceCheckedAt: null,
            publishedAt: null,
            publishedBy: null,
            heldAt: null,
            heldBy: null,
            holdReason: null,
            lastUpdated: now
          }
        };
      } else if (segments.at(-1) === "ticket-products.json") {
        value = ticketCatalogDemo(value, targetEventId, now);
      }
      await writeJsonFileAtomic(path.join(temporary, ...segments), value);
    }
    await writeJsonFileAtomic(platformDocumentFilePath(temporary, "revenue"), revenue);
    for (const [key, value] of Object.entries(documents)) {
      await writeJsonFileAtomic(platformDocumentFilePath(temporary, key), value);
    }
    await writeJsonFileAtomic(platformDocumentFilePath(temporary, "workerStatus"), {
      service: "sandfest-worker",
      state: "idle",
      heartbeatAt: null,
      note: "Start the isolated worker to populate runtime health."
    });
    const normalizedRuntimeOwnerId = runtimeOwnerId == null ? "" : requiredRuntimeOwnerId(runtimeOwnerId);
    await writeJsonFileAtomic(path.join(temporary, "board-runtime.json"), {
      kind: "synthetic-board-demonstration",
      schemaVersion: BOARD_RUNTIME_SCHEMA_VERSION,
      runtimeLabel: BOARD_RUNTIME_LABEL,
      eventId: targetEventId,
      generatedAt: now,
      ...(normalizedRuntimeOwnerId ? { runtimeOwnerId: normalizedRuntimeOwnerId, ownershipClaimedAt: now } : {}),
      sourceEventId,
      archiveDigest: rollover.archiveDigest,
      messageMode,
      safeguards: [
        "isolated_runtime_root",
        messageMode === "local_automation" ? "loopback_approved_message_automation" : "review_first_messages",
        "no_external_provider_sends",
        "loopback_ticket_payment_sandbox",
        "synthetic_contacts",
        "reserved_sms_recipient",
        "synthetic_conditions"
      ]
    });

    if (replace) await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  return {
    ok: true,
    targetRoot: target,
    eventId: targetEventId,
    generatedAt: now,
    applications: documents.partnerOps.applications.length,
    invoices: documents.partnerOps.invoices.length,
    payments: documents.partnerOps.payments.length,
    budgetLines: documents.budgetControl.budgetLines.length,
    expenses: documents.budgetControl.expenses.length,
    tasks: documents.partnerOps.tasks.length,
    prospects: documents.partnerOps.prospects.length,
    safetySmsRecipients: documents.consent.records.filter(record => record.smsSafety?.optedIn && record.phone).length,
    cameras: documents.islandConditions.cameras.length,
    volunteerShifts: documents.volunteers.shifts.length,
    guestServiceCases: documents.guestServices.cases.length,
    documents: documents.incomingDocuments.documents.length
  };
}

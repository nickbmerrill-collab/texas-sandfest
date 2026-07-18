import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { normalizeConsent } from "./consent.mjs";
import { planEventRollover, ROLLOVER_DOCUMENT_KEYS } from "./event-rollover.mjs";
import { recordCameraObservation } from "./island-conditions.mjs";
import {
  createIncomingDocument,
  emptyIncomingDocumentIntake,
  incomingDocumentStorageConfig,
  saveIncomingDocumentUpload,
  updateIncomingDocument
} from "./incoming-documents.mjs";
import {
  createOutreachCampaign,
  createOutreachProspect,
  createPartnerApplication,
  createPartnerBrandAsset,
  createPartnerInvoice,
  createPartnerTask,
  emptyPartnerOperations,
  prepareFollowupDraft,
  recordPartnerPayment,
  reviewPartnerBrandAsset,
  reviewPartnerBrandProfile,
  reviewPartnerInvoice,
  updateOutreachProspect,
  updatePartnerApplication,
  updatePartnerBrandProfile,
  updatePartnerMilestone,
  updateVendorProfile
} from "./partner-ops.mjs";
import { platformDocumentFilePath } from "./platform-data.mjs";
import { readJsonFile, writeJsonFileAtomic } from "./safe-json-store.mjs";

const CONFIG_FILES = [
  ["data", "config", "admin-config.json"],
  ["data", "config", "emergency-alert.json"],
  ["data", "processed", "app-bootstrap.json"],
  ["data", "processed", "ticket-products.json"]
];

function requireResult(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${result?.error || "unknown failure"}`);
  return result;
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

function partnerDemo(eventId, now) {
  const makeId = idFactory();
  const options = { idFactory: makeId, eventId, now };
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
    packageId: "marlin",
    packageName: "Marlin",
    packageBenefits: ["Beach signage", "Digital placement", "Hospitality credentials"],
    expectedAmountCents: 2500000,
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
    packageId: "tarpon",
    packageName: "Tarpon",
    packageBenefits: ["Digital placement", "Hospitality credentials"],
    expectedAmountCents: 1000000,
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

  doc = requireResult(updatePartnerApplication(doc, sponsor.application.id, {
    status: "approved",
    ownerId: "sponsor-team"
  }, { ...options, actorId: "board-demo" }), "Approve sponsor demo").doc;

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
  const brandAsset = requireResult(createPartnerBrandAsset(doc, sponsor.application.id, {
    kind: "primary_logo",
    label: "Primary horizontal logo",
    sourceUrl: "https://example.com/assets/gulf-shore-logo.svg"
  }, { ...options, actorId: `partner:${sponsor.application.id}` }), "Submit sponsor brand asset");
  doc = brandAsset.doc;
  doc = requireResult(reviewPartnerBrandAsset(doc, brandAsset.asset.id, { status: "approved" }, {
    ...options,
    actorId: "sponsor-demo"
  }), "Approve sponsor brand asset").doc;

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

  for (const followupId of [sponsor.followup.id, vendor.followup.id, sponsorStandby.followup.id, vendorStandby.followup.id]) {
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
  doc = requireResult(createOutreachCampaign(doc, {
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
  }, { ...options, actorId: "sponsor-demo" }), "Create outreach campaign").doc;

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

  return {
    ...doc,
    _note: "Synthetic 2027 board demonstration data. Messages stay in the local sandbox and no real payments are sent.",
    lastUpdated: now,
    automationMode: "review_first"
  };
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

async function incomingDocumentDemo(runtimeRoot, eventId, now) {
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
      status: "received",
      notes: null,
      body: `${JSON.stringify({ eventId, sponsor: "Gulf Shore Credit Union", package: "Marlin", approvedBudgetCents: 2500000 }, null, 2)}\n`
    }
  ];
  let doc = emptyIncomingDocumentIntake(eventId);
  for (const fixture of fixtures) {
    const saved = await saveIncomingDocumentUpload(runtimeRoot, {
      documentId: fixture.id,
      eventId,
      fileName: fixture.fileName,
      contentType: fixture.contentType,
      buffer: Buffer.from(fixture.body, "utf8")
    }, { config: storageConfig });
    requireResult(saved, `Store ${fixture.title}`);
    const created = requireResult(createIncomingDocument(doc, {
      ...saved,
      id: fixture.id,
      domain: fixture.domain,
      title: fixture.title,
      ownerTeam: fixture.ownerTeam
    }, { eventId, actorId: "board-demo", now }), `Register ${fixture.title}`);
    doc = created.doc;
    if (fixture.status !== "received" || fixture.notes) {
      doc = requireResult(updateIncomingDocument(doc, fixture.id, {
        status: fixture.status,
        ownerTeam: fixture.ownerTeam,
        notes: fixture.notes
      }, { eventId, actorId: "board-demo", now }), `Review ${fixture.title}`).doc;
    }
  }
  return { ...doc, _note: "Synthetic private documents for the loopback-only board demonstration." };
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
  documents.volunteers = {
    ...documents.volunteers,
    volunteers: documents.volunteers.volunteers.map((volunteer, index) => ({
      ...volunteer,
      status: index < 10 ? "confirmed" : "invited"
    })),
    shifts: shiftDemo(sourceDocuments.volunteers, eventId)
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
  let conditions = documents.islandConditions;
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

export async function prepareBoardRuntime({ sourceRoot, targetRoot, eventId, now = new Date().toISOString(), replace = false } = {}) {
  const source = path.resolve(sourceRoot || ".");
  const target = path.resolve(targetRoot || path.join(source, ".sandfest-runtime", "board-2027"));
  if (source === target || target === path.parse(target).root) throw new Error("Board runtime target must be an isolated directory.");

  const bootstrap = await readJsonFile(path.join(source, "data", "processed", "app-bootstrap.json"), null);
  const targetEventId = eventId || bootstrap?.guide?.id;
  const sourceDocuments = await readSourceDocuments(source);
  const demoRoster = await readJsonFile(path.join(source, "src", "board-demo", "sculptors-demo.json"), null);
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
  documents.partnerOps = partnerDemo(targetEventId, now);
  documents.consent = consentDemo(targetEventId, now);
  const revenue = revenueDemo(targetEventId, now);
  engagementDemo(documents, demoRoster, targetEventId, now);
  operationsDemo(documents, sourceDocuments, targetEventId, now);

  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    documents.incomingDocuments = await incomingDocumentDemo(temporary, targetEventId, now);
    for (const segments of CONFIG_FILES) {
      let value = await readJsonFile(path.join(source, ...segments), null);
      if (value == null) throw new Error(`Missing board runtime source: ${segments.join("/")}`);
      if (segments.at(-1) === "app-bootstrap.json") {
        value = {
          ...value,
          runtime: {
            mode: "board_demo",
            label: "Board demonstration | Synthetic 2027 data | No external messages or payments are sent"
          }
        };
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
    await writeJsonFileAtomic(path.join(temporary, "board-runtime.json"), {
      kind: "synthetic-board-demonstration",
      eventId: targetEventId,
      generatedAt: now,
      sourceEventId,
      archiveDigest: rollover.archiveDigest,
      safeguards: ["isolated_runtime_root", "review_first_messages", "no_external_provider_sends", "synthetic_contacts", "reserved_sms_recipient"]
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
    tasks: documents.partnerOps.tasks.length,
    prospects: documents.partnerOps.prospects.length,
    safetySmsRecipients: documents.consent.records.filter(record => record.smsSafety?.optedIn && record.phone).length,
    cameras: documents.islandConditions.cameras.length,
    volunteerShifts: documents.volunteers.shifts.length,
    documents: documents.incomingDocuments.documents.length
  };
}

import { createHash } from "node:crypto";
import { emptyPartnerOperations } from "./partner-ops.mjs";
import { emptySmsOperations } from "./sms-operations.mjs";
import { parseEventId } from "./event-context.mjs";
import { emptyIncomingDocumentIntake } from "./incoming-documents.mjs";

export const ROLLOVER_DOCUMENT_KEYS = [
  "fleet",
  "volunteers",
  "staffDirectory",
  "consent",
  "passportHunt",
  "passportCompletions",
  "voting",
  "booths",
  "partnerOps",
  "incomingDocuments",
  "islandConditions",
  "smsOperations"
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function retag(items, eventId, transform = item => item) {
  return Array.isArray(items) ? items.map(item => transform({ ...item, eventId })) : [];
}

function huntIdFor(year) {
  return `sculpture-passport-${year}`;
}

function resetDocument(key, input, { eventId, year, guide, now }) {
  const doc = clone(input) || {};
  switch (key) {
  case "fleet":
    return {
      ...doc,
      eventId,
      lastUpdated: now,
      assets: retag(doc.assets, eventId, asset => ({
        ...asset,
        status: asset.status === "maintenance" ? "maintenance" : "available"
      })),
      checkouts: [],
      locations: []
    };
  case "volunteers":
    return {
      ...doc,
      eventId,
      lastUpdated: now,
      source: "event-rollover",
      volunteers: retag(doc.volunteers, eventId, volunteer => ({ ...volunteer, status: "invited" })),
      shifts: [],
      hourLogs: []
    };
  case "staffDirectory":
    return {
      ...doc,
      eventId,
      lastUpdated: now,
      verifiedAt: null,
      source: "event-rollover",
      staff: retag(doc.staff, eventId),
      teamRoutes: Array.isArray(doc.teamRoutes) ? doc.teamRoutes : []
    };
  case "consent":
    return { ...doc, eventId, lastUpdated: now, records: [] };
  case "passportHunt": {
    const huntId = huntIdFor(year);
    return {
      ...doc,
      lastUpdated: now,
      hunt: {
        ...(doc.hunt || {}),
        id: huntId,
        eventId,
        startsAt: `${guide.startDate}T${guide.dailyOpen || "09:00"}:00-05:00`,
        endsAt: `${guide.endDate}T${guide.dailyClose || "19:30"}:00-05:00`,
        active: false
      },
      checkpoints: Array.isArray(doc.checkpoints)
        ? doc.checkpoints.map(item => ({ ...item, huntId }))
        : []
    };
  }
  case "passportCompletions":
    return { ...doc, lastUpdated: now, completions: [] };
  case "voting":
    return { ...doc, eventId, lastUpdated: now, votingOpen: false, votes: [] };
  case "booths":
    return {
      ...doc,
      eventId,
      lastUpdated: now,
      source: "event-rollover",
      booths: retag(doc.booths, eventId),
      vendors: retag(doc.vendors, eventId)
    };
  case "partnerOps":
    return { ...emptyPartnerOperations(eventId), lastUpdated: now };
  case "incomingDocuments":
    return { ...emptyIncomingDocumentIntake(eventId), lastUpdated: now };
  case "islandConditions":
    return {
      ...doc,
      eventId,
      lastUpdated: now,
      cameras: Array.isArray(doc.cameras)
        ? doc.cameras.map(camera => ({
            ...camera,
            eventId,
            observation: null,
            health: null,
            operationalStatus: "offline"
          }))
        : [],
      observations: [],
      incidents: [],
      dispatches: []
    };
  case "smsOperations":
    return { ...emptySmsOperations(eventId), lastUpdated: now };
  default:
    throw new Error(`Unsupported rollover document: ${key}`);
  }
}

function documentEventId(key, doc) {
  if (key === "passportHunt") return doc?.hunt?.eventId ?? null;
  if (key === "passportCompletions") return null;
  return doc?.eventId ?? null;
}

function isEmptyTargetDocument(key, doc, targetEventId) {
  if (doc?.eventId !== targetEventId) return false;
  if (key === "partnerOps") {
    return [
      "applications", "payments", "paymentCheckouts", "invoices", "milestones", "followups", "tasks",
      "brandProfiles", "brandAssets", "deliverables", "vendorProfiles", "vendorRequirements",
      "vendorDocuments", "vendorAssignments", "prospects", "campaigns", "activity"
    ].every(field => !Array.isArray(doc[field]) || doc[field].length === 0);
  }
  if (key === "incomingDocuments") {
    return !Array.isArray(doc.documents) || doc.documents.length === 0;
  }
  if (key === "smsOperations") {
    return ["campaigns", "messages", "preferenceEvents"]
      .every(field => !Array.isArray(doc[field]) || doc[field].length === 0);
  }
  return false;
}

export function eventArchiveDigest(documents) {
  return createHash("sha256").update(canonicalJson(documents)).digest("hex");
}

export function planEventRollover({ fromEventId, toEventId, guide, documents, now = new Date().toISOString() } = {}) {
  const from = parseEventId(fromEventId);
  const to = parseEventId(toEventId);
  if (!from || !to) return { ok: false, error: "Both event ids must use texas-sandfest-YYYY." };
  if (from.id === to.id) return { ok: false, error: "Source and target event ids must differ." };
  if (guide?.id !== to.id || Number(String(guide?.startDate || "").slice(0, 4)) !== to.year) {
    return { ok: false, error: "Target event id must match the published guide id and start-date year." };
  }
  const sourceDocuments = documents && typeof documents === "object" ? documents : {};
  const missing = ROLLOVER_DOCUMENT_KEYS.filter(key => sourceDocuments[key] == null);
  if (missing.length) return { ok: false, error: `Rollover source is missing: ${missing.join(", ")}.` };
  const mismatches = ROLLOVER_DOCUMENT_KEYS
    .filter(key => key !== "passportCompletions")
    .map(key => ({ key, eventId: documentEventId(key, sourceDocuments[key]) }))
    .filter(item => item.eventId !== from.id && !isEmptyTargetDocument(item.key, sourceDocuments[item.key], to.id));
  if (mismatches.length) {
    return {
      ok: false,
      error: `Rollover source context mismatch: ${mismatches.map(item => `${item.key}=${item.eventId || "missing"}`).join(", ")}.`,
      mismatches
    };
  }
  const nextDocuments = Object.fromEntries(
    ROLLOVER_DOCUMENT_KEYS.map(key => [key, resetDocument(key, sourceDocuments[key], {
      eventId: to.id,
      year: to.year,
      guide,
      now
    })])
  );
  return {
    ok: true,
    fromEventId: from.id,
    toEventId: to.id,
    now,
    archiveDigest: eventArchiveDigest(sourceDocuments),
    documents: nextDocuments,
    summary: {
      archivedDocuments: ROLLOVER_DOCUMENT_KEYS.length,
      carriedFleetAssets: nextDocuments.fleet.assets.length,
      carriedVolunteerProfiles: nextDocuments.volunteers.volunteers.length,
      carriedPassportCheckpoints: nextDocuments.passportHunt.checkpoints.length,
      carriedBooths: nextDocuments.booths.booths.length,
      resetConsentRecords: sourceDocuments.consent.records?.length || 0,
      resetPassportCompletions: sourceDocuments.passportCompletions.completions?.length || 0,
      resetVotes: sourceDocuments.voting.votes?.length || 0,
      resetPartnerApplications: sourceDocuments.partnerOps.applications?.length || 0,
      resetIncomingDocuments: sourceDocuments.incomingDocuments.documents?.length || 0,
      resetIncidents: sourceDocuments.islandConditions.incidents?.length || 0,
      resetSmsCampaigns: sourceDocuments.smsOperations.campaigns?.length || 0
    }
  };
}

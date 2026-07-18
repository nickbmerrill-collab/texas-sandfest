import { createServer } from "node:http";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../lib/load-env.mjs";
import { resolveRuntimeRoot, runtimeRootProfile } from "../lib/runtime-root.mjs";
import { createStorage } from "../lib/storage.mjs";
import { authMode, authModeIsJwt, resolveSession } from "../lib/auth.mjs";
import { buildRevenueLedgerView, partnerRevenueEntries, summarizeLedger } from "../lib/revenue.mjs";
import {
  applyRevenueImport,
  parseRevenueCsv,
  revenueImportPreviewHash
} from "../lib/revenue-import.mjs";
import {
  appendPassportCompletion,
  listPassportCompletions,
  readPlatformDoc,
  readVotingBallot,
  updatePlatformDoc,
  upsertVote,
  writePlatformDoc
} from "../lib/platform-data.mjs";
import { createRateLimiter } from "../lib/rate-limit.mjs";
import { normalizeRequestId, redactAuditValue, safeErrorResponse } from "../lib/security.mjs";
import { turnstileConfig, verifyTurnstileToken } from "../lib/turnstile.mjs";
import { eventGuideReadiness, publicEventGuide, publishEventGuide } from "../lib/event-guide.mjs";
import { eventContextConfig, eventContextReadiness } from "../lib/event-context.mjs";
import { recoveryReadiness } from "../lib/recovery-readiness.mjs";
import { enqueueJob, getQueueHealth, listJobs } from "../lib/job-queue.mjs";
import {
  applyCheckin,
  applyCheckout,
  appendLocation,
  enrichAssets,
  normalizeAsset,
  normalizeCheckout,
  normalizeLocation,
  parseAssetQrPayload,
  summarizeFleet
} from "../lib/fleet.mjs";
import {
  enrichShifts,
  normalizeHourLog,
  normalizeShift,
  normalizeVolunteer,
  summarizeVolunteers
} from "../lib/volunteers.mjs";
import {
  applyVolunteerLocalImport,
  parseVolunteerLocalBundle,
  volunteerLocalBundleHash,
  volunteerLocalImportPreviewHash,
  volunteerLocalMirrorFingerprint
} from "../lib/volunteer-import.mjs";
import {
  SANDFEST_TASK_TEAMS,
  normalizeStaffDirectory,
  publicStaffAssignmentDirectory,
  staffDirectoryReadiness,
  staffTaskRecipients
} from "../lib/staff-directory.mjs";
import {
  applySmsConsentKeyword,
  consentFromCheckout,
  mergeConsentRecords,
  normalizeConsent,
  recipientsForChannel,
  smsPreferenceAction,
  summarizeConsent,
  validateCheckoutConsent
} from "../lib/consent.mjs";
import {
  parseTwilioForm,
  publicSmsReadiness,
  smsConfigFromEnv,
  twilioValidationUrl,
  verifyTwilioFormRequest
} from "../lib/sms.mjs";
import {
  attachSmsJobs,
  createSmsAlertCampaign,
  emptySmsOperations,
  normalizeSmsOperations,
  recordSmsPreferenceEvent,
  recordSmsStatusCallback,
  recordSmsSubmission,
  smsOperationsAdminPayload,
  smsRecipientHash,
  suppressSmsCampaignsForAlert
} from "../lib/sms-operations.mjs";
import {
  applyStamp,
  normalizeCheckpoint,
  normalizeCompletion,
  normalizeHunt,
  progressForAttendee,
  publicCheckpoint,
  summarizePassport
} from "../lib/passport.mjs";
import {
  applyVote,
  normalizeBallotEntry,
  normalizeVote,
  publicVotingPublication,
  summarizeVoting,
  tallyVotes,
  voteForAttendee
} from "../lib/voting.mjs";
import {
  enrichBooths,
  normalizeBooth,
  normalizeVendor,
  publicBoothPins,
  summarizeBooths
} from "../lib/booths.mjs";
import {
  applyEventenyBoothImport,
  eventenyBoothBundleHash,
  eventenyBoothImportPreviewHash,
  eventenyBoothMirrorFingerprint,
  parseEventenyBoothCsv
} from "../lib/booth-import.mjs";
import {
  createPartnerBrandAsset,
  createPartnerDeliverable,
  createOutreachCampaign,
  createOutreachProspect,
  createOutreachSponsorInvitation,
  createSponsorApplicationFromOutreachInvitation,
  createPartnerApplication,
  createPartnerInvoice,
  createPartnerMilestone,
  createPartnerTask,
  createVendorDocument,
  activatePartnerPaymentCheckout,
  beginPartnerPaymentCheckout,
  emptyPartnerOperations,
  failPartnerPaymentCheckout,
  generateDueOutreachFollowups,
  normalizePartnerOperations,
  outreachCampaignAutomationReadiness,
  outreachCampaignMetrics,
  partnerAutomationReadiness,
  queueFollowupDelivery,
  queuePartnerInvoiceReconciliation,
  queuePartnerInvoiceSync,
  reconcilePartnerStripePayment,
  reconcilePartnerStripeRefund,
  recordPartnerPayment,
  recordPartnerInvoiceReconciliation,
  reversePartnerPayment,
  confirmVendorAssignment,
  rotatePartnerPortalAccess,
  reviewFollowup,
  reviewPartnerBrandAsset,
  reviewPartnerBrandProfile,
  reviewPartnerDeliverable,
  reviewPartnerInvoice,
  reviewVendorProfile,
  reviewVendorRequirement,
  revokeOutreachSponsorInvitation,
  setPartnerAutomationMode,
  summarizePartnerOperations,
  summarizePartnerMilestones,
  summarizePartnerReceivables,
  summarizeSponsorFulfillment,
  summarizeVendorReadiness,
  summarizeTaskBoard,
  updateOutreachCampaignStatus,
  updateOutreachProspect,
  updatePartnerApplication,
  updatePartnerBrandProfile,
  updatePartnerDeliverable,
  updatePartnerTask,
  updatePartnerMilestone,
  updatePartnerStripeCheckoutState,
  updateVendorAssignment,
  updateVendorProfile
} from "../lib/partner-ops.mjs";
import { syncDeploymentCheckTasks } from "../lib/deployment-task-sync.mjs";
import {
  adminPartnerPortalAccess,
  findPartnerPortalApplication,
  issuePartnerPortalToken,
  partnerPortalConfig,
  partnerPortalPath,
  partnerPortalUrl,
  publicPartnerPortalStatus
} from "../lib/partner-portal.mjs";
import {
  findOutreachPreferenceProspect,
  outreachPreferencesConfig,
  outreachPreferenceUrlForProspect,
  publicOutreachPreference,
  publicOutreachPreferencesReadiness
} from "../lib/outreach-preferences.mjs";
import {
  publicSponsorInvitation,
  publicSponsorInvitationReadiness,
  sponsorInvitationConfig,
  sponsorInvitationUrlForProspect,
  verifySponsorInvitationToken
} from "../lib/sponsor-invitations.mjs";
import {
  createSponsorPackageConfig,
  publicSponsorPackage,
  resolveSponsorPackage,
  sponsorPackageCatalog,
  updateSponsorPackageConfig
} from "../lib/sponsor-packages.mjs";
import {
  createVendorOfferingConfig,
  publicVendorOffering,
  resolveVendorOffering,
  updateVendorOfferingConfig,
  vendorOfferingCatalog
} from "../lib/vendor-offerings.mjs";
import {
  deletePartnerAssetUpload,
  partnerAssetDownloadName,
  partnerAssetStorageConfig,
  readPartnerAssetUpload,
  savePartnerAssetUpload
} from "../lib/partner-assets.mjs";
import {
  adminIncomingDocument,
  createIncomingDocument,
  defaultIncomingDocumentReviewDueAt,
  deleteIncomingDocumentUpload,
  emptyIncomingDocumentIntake,
  incomingDocumentDownloadName,
  incomingDocumentStorageConfig,
  normalizeIncomingDocumentIntake,
  readIncomingDocumentUpload,
  requestIncomingDocumentExtraction,
  saveIncomingDocumentUpload,
  summarizeIncomingDocuments,
  updateIncomingDocument,
  verifyIncomingDocumentBytes
} from "../lib/incoming-documents.mjs";
import {
  documentExtractionSourceConfig,
  verifyDocumentExtractionSourceAuthorization
} from "../lib/document-extraction-source.mjs";
import {
  incomingDocumentReviewTaskView,
  syncIncomingDocumentReviewTask
} from "../lib/document-review-routing.mjs";
import { approvedPublicSponsorAsset, publicSponsorShowcase } from "../lib/sponsor-showcase.mjs";
import { publicTicketCatalog } from "../lib/ticket-catalog.mjs";
import { emailConfigFromEnv, publicEmailReadiness } from "../lib/email.mjs";
import {
  applyBrevoDeliveryEvents,
  brevoWebhookConfig,
  normalizeBrevoWebhookEvents,
  verifyBrevoWebhookAuthorization
} from "../lib/brevo-webhook.mjs";
import { quickBooksReadiness } from "../lib/quickbooks/client.mjs";
import {
  createIncidentDispatch,
  createOperationsIncident,
  evaluateCameraHealthIncident,
  evaluateCameraObservationIncident,
  failedFeedRefreshNeedsRetry,
  fetchPortAransasFerryStatus,
  fetchPortAransasWeather,
  weatherForecastNeedsRefresh,
  normalizeIslandConditions,
  publicIslandConditions,
  queueIncidentDispatchMessage,
  recordCameraHeartbeat,
  recordCameraObservation,
  recordIncidentDispatchDelivery,
  reviewIncidentDispatchMessage,
  summarizeIslandConditions,
  updateIncidentDispatch,
  updateOperationsIncident,
  updateCameraSource
} from "../lib/island-conditions.mjs";
import {
  cameraCredentialReadiness,
  cameraIngestConfig,
  publicCameraIngestReadiness,
  verifyCameraIngestSignature
} from "../lib/camera-ingest.mjs";
import {
  cameraModelApproval,
  verifyCameraModelPayload
} from "../lib/camera-model-approval.mjs";
import {
  createStripePartnerCheckoutSession,
  publicStripePartnerPaymentsReadiness,
  stripePartnerEventContext,
  stripePartnerPaymentsConfig
} from "../lib/stripe-partner-payments.mjs";
import {
  applyOutreachProspectImport,
  normalizeOutreachImportDefaults,
  parseOutreachProspectCsv
} from "../lib/outreach-import.mjs";
import {
  applyEventenyPartnerImport,
  eventenyPartnerCatalogFingerprint,
  eventenyPartnerImportPreviewHash,
  parseEventenyPartnerCsv
} from "../lib/partner-import.mjs";
import {
  applyOutreachDiscoveryImport,
  discoverOutreachBusinesses,
  issueOutreachDiscoveryPreview,
  outreachDiscoveryConfig,
  publicOutreachDiscoveryReadiness,
  verifyOutreachDiscoveryPreview
} from "../lib/outreach-discovery.mjs";
import {
  milestonesCalendarExport,
  outreachProspectsExport,
  partnerDirectoryExport,
  paymentsExport,
  receivablesExport,
  tasksExport
} from "../lib/operations-export.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const RUNTIME_ROOT = runtimeRootProfile(CODE_ROOT, ROOT);
const PARTNER_ASSET_STORAGE = partnerAssetStorageConfig(ROOT);
const INCOMING_DOCUMENT_STORAGE = incomingDocumentStorageConfig(ROOT);
const DOCUMENT_EXTRACTION_SOURCE = documentExtractionSourceConfig();
const OUTREACH_PREFERENCES = outreachPreferencesConfig();
const TURNSTILE = turnstileConfig(process.env);
const BREVO_WEBHOOK = brevoWebhookConfig(process.env);
const PORT = Number(process.env.PORT || process.env.SANDFEST_API_PORT || 8788);
const SANDFEST_ENV = process.env.SANDFEST_ENV || "development";
const OUTREACH_DISCOVERY = outreachDiscoveryConfig(process.env, { production: SANDFEST_ENV === "production" });
const SPONSOR_INVITATIONS = sponsorInvitationConfig(process.env);
const EVENT_CONTEXT = eventContextConfig(process.env);
const CURRENT_EVENT_ID = EVENT_CONTEXT.eventId;
const BOARD_DEMO_RUNTIME = await (async () => {
  if (SANDFEST_ENV === "production" || !RUNTIME_ROOT.isolated) return false;
  try {
    const marker = JSON.parse(await readFile(path.join(ROOT, "board-runtime.json"), "utf8"));
    return marker.kind === "synthetic-board-demonstration" && marker.eventId === CURRENT_EVENT_ID;
  } catch {
    return false;
  }
})();
const BOARD_DEMO_FEED_FIXTURE_BASE = (() => {
  const value = String(process.env.SANDFEST_BOARD_FEED_FIXTURE_BASE_URL || "").trim();
  if (!value) return null;
  if (SANDFEST_ENV === "production" || !BOARD_DEMO_RUNTIME) {
    throw new Error("SANDFEST_BOARD_FEED_FIXTURE_BASE_URL is restricted to an isolated board demo runtime.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SANDFEST_BOARD_FEED_FIXTURE_BASE_URL must be an absolute loopback URL.");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash) {
    throw new Error("SANDFEST_BOARD_FEED_FIXTURE_BASE_URL must use HTTP on 127.0.0.1 without credentials, query, or fragment.");
  }
  return url.toString().replace(/\/+$/, "");
})();
const BOARD_DEMO_FEED_FIXTURE_PATHS = new Map([
  ["https://api.weather.gov/gridpoints/CRP/123,36/forecast/hourly", "/nws/forecast"],
  ["https://api.weather.gov/alerts/active?point=27.8339,-97.0611", "/nws/alerts"],
  ["https://its.txdot.gov/its/DistrictIts/GetDmsListByDistrict?districtCode=CRP", "/txdot/ferry"]
]);
function boardDemoFeedFetch(input, init) {
  const fixturePath = BOARD_DEMO_FEED_FIXTURE_PATHS.get(String(input));
  if (!BOARD_DEMO_FEED_FIXTURE_BASE || !fixturePath) {
    throw new Error("Board feed fixture received an unexpected upstream URL.");
  }
  return fetch(`${BOARD_DEMO_FEED_FIXTURE_BASE}${fixturePath}`, init);
}
const API_PREFIX = String(process.env.SANDFEST_API_PREFIX || "").replace(/\/$/, "");
const RATE_LIMIT_WINDOW_MS = Number(process.env.SANDFEST_RATE_LIMIT_WINDOW_MS || 60_000);
const ADMIN_RATE_LIMIT = Number(process.env.SANDFEST_ADMIN_RATE_LIMIT || 120);
const CHECKOUT_RATE_LIMIT = Number(process.env.SANDFEST_CHECKOUT_RATE_LIMIT || 30);
const PUBLIC_RATE_LIMIT = Number(process.env.SANDFEST_PUBLIC_RATE_LIMIT || 1200);
// Tighter bucket for unauthenticated public writes (stamps/votes) at festival scale.
const PUBLIC_WRITE_RATE_LIMIT = Number(process.env.SANDFEST_PUBLIC_WRITE_RATE_LIMIT || 60);
const PARTNER_STATUS_RATE_LIMIT = Number(process.env.SANDFEST_PARTNER_STATUS_RATE_LIMIT || 30);
const CAMERA_INGEST_RATE_LIMIT = Number(process.env.CAMERA_INGEST_RATE_LIMIT || 600);
const SMS_WEBHOOK_RATE_LIMIT = Number(process.env.SANDFEST_SMS_WEBHOOK_RATE_LIMIT || 1200);
const configuredSmsMaxRecipients = Number(process.env.SANDFEST_SMS_MAX_RECIPIENTS || 500);
const SMS_MAX_RECIPIENTS = Number.isFinite(configuredSmsMaxRecipients)
  ? Math.min(5000, Math.max(1, Math.round(configuredSmsMaxRecipients)))
  : 500;
const EVENT_GUIDE_SOURCE_MAX_AGE_DAYS = Math.max(1, Number(process.env.SANDFEST_EVENT_GUIDE_SOURCE_MAX_AGE_DAYS || 90));
const OPERATIONAL_EVENT_DOCUMENT_KEYS = [
  "fleet",
  "volunteers",
  "staffDirectory",
  "consent",
  "passportHunt",
  "voting",
  "booths",
  "partnerOps",
  "incomingDocuments",
  "islandConditions",
  "smsOperations"
];
const MAX_BODY_BYTES = Number(process.env.SANDFEST_MAX_BODY_BYTES || 262_144); // 256 KiB
const LARGE_CSV_IMPORT_BODY_BYTES = 5_500_000;
const ADMIN_TOKEN = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";
const rateLimiter = await createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS });
if (rateLimiter.kind === "memory") {
  setInterval(() => rateLimiter.prune?.(), RATE_LIMIT_WINDOW_MS).unref?.();
}
const REQUIRE_TICKET_VOTE = process.env.SANDFEST_REQUIRE_TICKET_VOTE === "true";
const ADMIN_ACTOR_ID = process.env.SANDFEST_ADMIN_ACTOR_ID || "local-admin";
const ADMIN_ROLE = process.env.SANDFEST_ADMIN_ROLE || "super_admin";
const CONFIG_PATH_OVERRIDE = process.env.SANDFEST_ADMIN_CONFIG_PATH
  ? path.resolve(process.env.SANDFEST_ADMIN_CONFIG_PATH)
  : null;
const ALERT_PATH_OVERRIDE = process.env.SANDFEST_ALERT_CONFIG_PATH
  ? path.resolve(process.env.SANDFEST_ALERT_CONFIG_PATH)
  : null;
const AUDIT_DIR_OVERRIDE = process.env.SANDFEST_AUDIT_DIR
  ? path.resolve(process.env.SANDFEST_AUDIT_DIR)
  : null;
const ORDER_DIR_OVERRIDE = process.env.SANDFEST_ORDER_DIR ? path.resolve(process.env.SANDFEST_ORDER_DIR) : null;
const PAYMENT_EVENT_DIR_OVERRIDE = process.env.SANDFEST_PAYMENT_EVENT_DIR ? path.resolve(process.env.SANDFEST_PAYMENT_EVENT_DIR) : null;
const FULFILLMENT_DIR_OVERRIDE = process.env.SANDFEST_FULFILLMENT_DIR ? path.resolve(process.env.SANDFEST_FULFILLMENT_DIR) : null;
const storage = await createStorage({
  root: ROOT,
  auditDir: AUDIT_DIR_OVERRIDE,
  orderDir: ORDER_DIR_OVERRIDE,
  paymentEventDir: PAYMENT_EVENT_DIR_OVERRIDE,
  fulfillmentDir: FULFILLMENT_DIR_OVERRIDE,
  configPaths: {
    ...(CONFIG_PATH_OVERRIDE ? { "admin-config": CONFIG_PATH_OVERRIDE } : {}),
    ...(ALERT_PATH_OVERRIDE ? { "emergency-alert": ALERT_PATH_OVERRIDE } : {})
  }
});
const STRIPE_ENABLED = process.env.STRIPE_TICKETING_ENABLED === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Math.max(30, Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300));
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || "http://127.0.0.1:4173/tickets/success?session_id={CHECKOUT_SESSION_ID}";
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || "http://127.0.0.1:4173/#tickets";
const STRIPE_API_BASE_URL = String(process.env.STRIPE_API_BASE_URL || "https://api.stripe.com").replace(/\/+$/, "");
const STRIPE_PARTNER_PAYMENTS = stripePartnerPaymentsConfig();
const ALLOWED_ORIGINS = (process.env.SANDFEST_CORS_ORIGINS || [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "https://www.texassandfest.org",
  "https://texassandfest.org"
].join(",")).split(",").map(origin => origin.trim()).filter(Boolean);

const patchableTicketFields = new Set([
  "name",
  "priceLabel",
  "unitAmount",
  "stripePriceId",
  "requiresReview",
  "description",
  "quantity",
  "checkoutMode",
  "fulfillment",
  "terms",
  "active"
]);

const patchableSponsorFields = new Set([
  "name",
  "amount",
  "publicLabel",
  "active",
  "requiresApproval",
  "stripePriceId",
  "quickBooksItemId",
  "benefits"
]);
const creatableSponsorFields = new Set(["id", ...patchableSponsorFields]);

const patchableVendorOfferingFields = new Set([
  "name",
  "amount",
  "publicLabel",
  "active",
  "requiresApproval",
  "categories",
  "description",
  "inclusions",
  "stripePriceId",
  "quickBooksItemId"
]);
const creatableVendorOfferingFields = new Set(["id", ...patchableVendorOfferingFields]);

const fulfillmentStatuses = new Set([
  "queued",
  "needs_review",
  "ready",
  "issued",
  "checked_in",
  "refunded",
  "voided"
]);

const TASK_TEAMS = SANDFEST_TASK_TEAMS;
const ASSIGNABLE_VOLUNTEER_STATUSES = new Set(["confirmed", "checked_in"]);

const alertSeverities = new Set([
  "info",
  "watch",
  "warning",
  "critical",
  "clear"
]);

const rolePermissions = {
  super_admin: ["*"],
  ops_admin: [
    "admin:read",
    "content:write",
    "documents:read",
    "documents:write",
    "alert:read",
    "alert:write",
    "orders:read",
    "payments:read",
    "revenue:read",
    "fleet:read",
    "fleet:write",
    "volunteers:read",
    "volunteers:write",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "booths:write",
    "partners:read",
    "partners:write",
    "outreach:read",
    "outreach:write",
    "conditions:read",
    "conditions:write",
    "fulfillment:read",
    "fulfillment:update",
    "audit:read",
    "snapshot:read"
  ],
  ticketing_admin: [
    "admin:read",
    "alert:read",
    "ticket:write",
    "orders:read",
    "payments:read",
    "revenue:read",
    "consent:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ],
  sponsor_admin: [
    "admin:read",
    "alert:read",
    "sponsor:write",
    "partners:read",
    "partners:write",
    "outreach:read",
    "outreach:write",
    "orders:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ],
  finance_admin: [
    "admin:read",
    "alert:read",
    "orders:read",
    "payments:read",
    "revenue:read",
    "revenue:write",
    "fleet:read",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "partners:read",
    "documents:read",
    "finance:write",
    "conditions:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ],
  viewer: [
    "admin:read",
    "alert:read",
    "orders:read",
    "payments:read",
    "revenue:read",
    "fleet:read",
    "volunteers:read",
    "consent:read",
    "passport:read",
    "voting:read",
    "booths:read",
    "partners:read",
    "outreach:read",
    "conditions:read",
    "fulfillment:read",
    "audit:read",
    "snapshot:read"
  ]
};

function checkStatus(ok, message, severity = "error") {
  return {
    ok,
    severity: ok ? "ok" : severity,
    message
  };
}

const DEPLOYMENT_CHECK_PRESENTATION = Object.freeze({
  environment: ["Runtime environment", "Platform"],
  capabilityPolicy: ["Required capabilities", "Platform"],
  dataPlane: ["Durable data plane", "Platform"],
  backupRecovery: ["Backup and recovery", "Platform"],
  authMode: ["Authentication mode", "Access"],
  authJwks: ["JWKS endpoint", "Access"],
  authIssuer: ["Token issuer", "Access"],
  adminToken: ["Admin credential", "Access"],
  adminRole: ["Admin role", "Access"],
  adminActor: ["Audit actor", "Access"],
  cors: ["Allowed web origins", "Access"],
  publicApiBase: ["Public API address", "Access"],
  adminBase: ["Admin app address", "Access"],
  eventGuide: ["Published event guide", "Program data"],
  currentEvent: ["Current event context", "Program data"],
  staffDirectory: ["Staff directory and routing", "Program data"],
  sponsorPackages: ["Sponsor package catalog", "Program data"],
  vendorOfferings: ["Vendor offering catalog", "Program data"],
  rateLimits: ["Request limits", "Platform"],
  rateLimitBackend: ["Shared rate limiter", "Platform"],
  partnerIntakeBotProtection: ["Partner intake protection", "Partners"],
  partnerPortal: ["Private partner portal", "Partners"],
  outreachPreferences: ["Outreach preferences", "Partners"],
  outreachDiscovery: ["Regional business discovery", "Partners"],
  sponsorInvitations: ["Sponsor invitations", "Partners"],
  partnerAssetStorage: ["Partner asset storage", "Partners"],
  documentIngestion: ["Private document intake", "Partners"],
  stripeSecret: ["Stripe API credential", "Revenue"],
  stripeWebhook: ["Stripe webhook", "Revenue"],
  stripeUrls: ["Stripe return addresses", "Revenue"],
  stripeApiOrigin: ["Stripe API origin", "Revenue"],
  stripeTicketing: ["Ticket checkout", "Revenue"],
  stripePartnerPayments: ["Partner invoice payments", "Revenue"],
  quickBooksInvoices: ["QuickBooks invoices", "Revenue"],
  sms: ["Safety SMS", "Communications"],
  transactionalEmail: ["Transactional email", "Communications"],
  cameraIngest: ["Camera metric fleet", "Field operations"],
  cameraModelApproval: ["Camera detector approval", "Field operations"]
});

function presentDeploymentChecks(checks) {
  return Object.fromEntries(Object.entries(checks).map(([id, check]) => {
    const [label, group] = DEPLOYMENT_CHECK_PRESENTATION[id] || [id, "Other"];
    return [id, { id, label, group, ...check }];
  }));
}

function summarizeDeploymentGroups(checks) {
  const groups = new Map();
  Object.values(checks).forEach(check => {
    const summary = groups.get(check.group) || { group: check.group, total: 0, passing: 0, warnings: 0, errors: 0 };
    summary.total += 1;
    if (check.ok) summary.passing += 1;
    else if (check.severity === "warning") summary.warnings += 1;
    else summary.errors += 1;
    groups.set(check.group, summary);
  });
  return [...groups.values()];
}

const KNOWN_REQUIRED_CAPABILITIES = new Set([
  "stripe_ticketing",
  "stripe_partner_payments",
  "transactional_email",
  "quickbooks_invoices",
  "camera_ingest",
  "staff_directory",
  "outreach_discovery",
  "sms_safety",
  "document_ingestion"
]);
const DEFAULT_PRODUCTION_CAPABILITIES = [...KNOWN_REQUIRED_CAPABILITIES];

function requiredCapabilityPolicy(production) {
  const configured = String(process.env.SANDFEST_REQUIRED_CAPABILITIES || "").trim();
  const requested = configured.toLowerCase() === "none"
    ? []
    : configured
      ? configured.split(",").map(value => value.trim()).filter(Boolean)
      : production ? DEFAULT_PRODUCTION_CAPABILITIES : [];
  const required = new Set(requested);
  const unknown = [...required].filter(value => !KNOWN_REQUIRED_CAPABILITIES.has(value));
  return { required, unknown };
}

// Enterprise platform docs: atomic file store or Postgres (lib/platform-data.mjs).
async function readRevenueLedger() {
  const ledger = await readPlatformDoc(ROOT, "revenue", null);
  if (!ledger) {
    return { eventId: CURRENT_EVENT_ID, lastUpdated: null, currency: "usd", expectedAttendance: null, ticketCapacity: null, entries: [], imports: [] };
  }
  return {
    eventId: ledger.eventId ?? null,
    lastUpdated: ledger.lastUpdated ?? null,
    currency: ledger.currency ?? "usd",
    expectedAttendance: ledger.expectedAttendance ?? null,
    ticketCapacity: ledger.ticketCapacity ?? null,
    entries: Array.isArray(ledger.entries) ? ledger.entries : [],
    imports: Array.isArray(ledger.imports) ? ledger.imports : []
  };
}

function emptyFleetDoc() {
  return {
    lastUpdated: null,
    eventId: CURRENT_EVENT_ID,
    assets: [],
    checkouts: [],
    locations: []
  };
}

function normalizeFleetDoc(ledger) {
  if (!ledger || typeof ledger !== "object") return emptyFleetDoc();
  return {
    lastUpdated: ledger.lastUpdated ?? null,
    eventId: ledger.eventId ?? CURRENT_EVENT_ID,
    assets: Array.isArray(ledger.assets) ? ledger.assets.map(normalizeAsset) : [],
    checkouts: Array.isArray(ledger.checkouts) ? ledger.checkouts.map(normalizeCheckout) : [],
    locations: Array.isArray(ledger.locations) ? ledger.locations.map(normalizeLocation) : []
  };
}

async function readFleetLedger() {
  return normalizeFleetDoc(await readPlatformDoc(ROOT, "fleet", null));
}

async function writeFleetLedger(ledger) {
  const payload = {
    _note: "Fleet/asset checkout ledger (lib/fleet.mjs). Atomic/Postgres via platform-data.",
    lastUpdated: new Date().toISOString(),
    eventId: ledger.eventId ?? CURRENT_EVENT_ID,
    assets: ledger.assets ?? [],
    checkouts: ledger.checkouts ?? [],
    locations: ledger.locations ?? []
  };
  // Mutex / row-lock path so concurrent checkouts cannot clobber each other.
  await updatePlatformDoc(ROOT, "fleet", () => payload, { fallback: payload });
  return payload;
}

function fleetDashboardPayload(ledger) {
  const summary = summarizeFleet(ledger.assets, ledger.checkouts, ledger.locations, {
    eventId: ledger.eventId,
    generatedAt: ledger.lastUpdated
  });
  const assets = enrichAssets(ledger.assets, ledger.checkouts, ledger.locations);
  const openCheckouts = assets
    .filter(a => a.activeCheckout)
    .map(a => a.activeCheckout);
  return {
    lastUpdated: ledger.lastUpdated,
    eventId: ledger.eventId,
    summary,
    assets,
    openCheckouts,
    checkouts: ledger.checkouts,
    locations: ledger.locations.slice(-50)
  };
}

async function readVolunteerMirror() {
  const mirror = await readPlatformDoc(ROOT, "volunteers", null);
  if (!mirror) {
    return {
      lastUpdated: null,
      eventId: CURRENT_EVENT_ID,
      source: "empty",
      zoneLabels: {},
      volunteers: [],
      shifts: [],
      hourLogs: [],
      imports: []
    };
  }
  return {
    lastUpdated: mirror.lastUpdated ?? null,
    eventId: mirror.eventId ?? CURRENT_EVENT_ID,
    source: mirror.source ?? "seed",
    zoneLabels: mirror.zoneLabels ?? {},
    volunteers: Array.isArray(mirror.volunteers) ? mirror.volunteers.map(normalizeVolunteer) : [],
    shifts: Array.isArray(mirror.shifts) ? mirror.shifts.map(normalizeShift) : [],
    hourLogs: Array.isArray(mirror.hourLogs) ? mirror.hourLogs.map(normalizeHourLog) : [],
    imports: Array.isArray(mirror.imports) ? mirror.imports.slice(-100) : []
  };
}

async function readStaffDirectory() {
  return normalizeStaffDirectory(await readPlatformDoc(ROOT, "staffDirectory", null), { eventId: CURRENT_EVENT_ID });
}

function volunteerDashboardPayload(mirror) {
  const summary = summarizeVolunteers(mirror.volunteers, mirror.shifts, mirror.hourLogs, {
    eventId: mirror.eventId,
    source: mirror.source,
    generatedAt: mirror.lastUpdated,
    zoneLabels: mirror.zoneLabels
  });
  return {
    lastUpdated: mirror.lastUpdated,
    eventId: mirror.eventId,
    source: mirror.source,
    summary,
    // Flat coverage rows for iOS VolunteerCoverage tiles (id/zone/filled/needed).
    coverage: summary.zones.map(z => ({
      id: z.id,
      zone: z.zone,
      filled: z.filled,
      needed: z.needed,
      fillPct: z.fillPct,
      status: z.status,
      openGaps: z.openGaps
    })),
    shifts: enrichShifts(mirror.shifts),
    volunteers: mirror.volunteers,
    hourLogs: mirror.hourLogs,
    imports: (mirror.imports || []).slice(-20).reverse()
  };
}

function volunteerImportResponse(result) {
  return {
    replay: result.replay === true,
    changed: result.changed === true,
    summary: result.summary,
    errors: (result.errors || []).slice(0, 100),
    importRecord: result.importRecord || null
  };
}

function boothImportResponse(result) {
  return {
    replay: result.replay === true,
    changed: result.changed === true,
    summary: result.summary,
    errors: (result.errors || []).slice(0, 100),
    importRecord: result.importRecord || null
  };
}

async function mutateVolunteerMirror(parsed, options = {}) {
  let result = null;
  const fallback = {
    eventId: CURRENT_EVENT_ID,
    lastUpdated: null,
    source: "empty",
    zoneLabels: {},
    volunteers: [],
    shifts: [],
    hourLogs: [],
    imports: []
  };
  await updatePlatformDoc(ROOT, "volunteers", current => {
    const currentDoc = current || fallback;
    const bundleHash = volunteerLocalBundleHash(options.bundle, { eventId: CURRENT_EVENT_ID });
    const previousImport = (Array.isArray(currentDoc.imports) ? currentDoc.imports : [])
      .find(item => item.previewHash === options.expectedPreviewHash);
    if (previousImport && previousImport.bundleHash === bundleHash) {
      result = applyVolunteerLocalImport(currentDoc, parsed, {
        ...options,
        bundleHash,
        previewHash: options.expectedPreviewHash,
        commit: true
      });
      return currentDoc;
    }
    const currentPreviewHash = volunteerLocalImportPreviewHash(options.bundle, {
      eventId: CURRENT_EVENT_ID,
      mirrorFingerprint: volunteerLocalMirrorFingerprint(currentDoc)
    });
    if (options.expectedPreviewHash !== currentPreviewHash) {
      result = {
        ok: false,
        previewMismatch: true,
        error: "The export bundle or volunteer mirror changed. Preview the reconciliation again before committing."
      };
      return currentDoc;
    }
    result = applyVolunteerLocalImport(currentDoc, parsed, { ...options, bundleHash, previewHash: currentPreviewHash, commit: true });
    return result?.ok ? result.doc : currentDoc;
  }, { fallback });
  return result;
}

async function mutateBoothMap(parsed, options = {}) {
  let result = null;
  const fallback = {
    eventId: CURRENT_EVENT_ID,
    lastUpdated: null,
    source: "empty",
    booths: [],
    vendors: [],
    imports: []
  };
  await updatePlatformDoc(ROOT, "booths", current => {
    const currentDoc = current || fallback;
    const bundleHash = eventenyBoothBundleHash(options.bundle, { eventId: CURRENT_EVENT_ID });
    const previousImport = (Array.isArray(currentDoc.imports) ? currentDoc.imports : [])
      .find(item => item.previewHash === options.expectedPreviewHash);
    if (previousImport && previousImport.bundleHash === bundleHash) {
      result = applyEventenyBoothImport(currentDoc, parsed, {
        ...options,
        bundleHash,
        previewHash: options.expectedPreviewHash,
        commit: true
      });
      return currentDoc;
    }
    const currentPreviewHash = eventenyBoothImportPreviewHash(options.bundle, {
      eventId: CURRENT_EVENT_ID,
      mirrorFingerprint: eventenyBoothMirrorFingerprint(currentDoc)
    });
    if (options.expectedPreviewHash !== currentPreviewHash) {
      result = {
        ok: false,
        previewMismatch: true,
        error: "The export or booth mirror changed. Preview the reconciliation again before committing."
      };
      return currentDoc;
    }
    result = applyEventenyBoothImport(currentDoc, parsed, {
      ...options,
      bundleHash,
      previewHash: currentPreviewHash,
      commit: true
    });
    return result?.ok ? result.doc : currentDoc;
  }, { fallback });
  return result;
}

async function enrichTaskAssignment(input) {
  const assignmentType = String(input?.assigneeType ?? "").trim().toLowerCase();
  if (!assignmentType || assignmentType === "unassigned") return { ok: true, input };
  const assigneeId = String(input?.assigneeId ?? "").trim();
  if (assignmentType === "volunteer") {
    const mirror = await readVolunteerMirror();
    const volunteer = mirror.volunteers.find(item => item.id === assigneeId);
    if (!volunteer) return { ok: false, error: "Choose a volunteer from the current roster." };
    if (!ASSIGNABLE_VOLUNTEER_STATUSES.has(volunteer.status)) {
      return { ok: false, error: `${volunteer.name} is not currently available for assignment.` };
    }
    return {
      ok: true,
      input: {
        ...input,
        assigneeType: "volunteer",
        assigneeId: volunteer.id,
        assigneeName: volunteer.name,
        assigneeRole: volunteer.roles.join(", ") || null
      }
    };
  }
  if (assignmentType === "team") {
    const team = TASK_TEAMS.find(item => item.id === assigneeId);
    if (!team) return { ok: false, error: "Choose a SandFest team from the assignment directory." };
    return { ok: true, input: { ...input, assigneeType: "team", assigneeId: team.id, assigneeName: team.name } };
  }
  if (assignmentType === "staff") {
    const directory = await readStaffDirectory();
    const staff = directory.staff.find(item => item.id === assigneeId);
    if (!staff || !["active", "on_call"].includes(staff.status)) {
      return { ok: false, error: "Choose an active staff member from the assignment directory." };
    }
    return { ok: true, input: { ...input, assigneeType: "staff", assigneeId: staff.id, assigneeName: staff.name, assigneeRole: staff.roles.join(", ") || null } };
  }
  return { ok: false, error: "Choose staff, volunteer, team, or unassigned." };
}

async function enrichIncidentDispatchAssignment(input) {
  const assignment = await enrichTaskAssignment(input);
  if (!assignment.ok) return assignment;
  if (!assignment.input.assigneeType || assignment.input.assigneeType === "unassigned") {
    return { ok: false, error: "Choose a staff member, volunteer, or team for incident dispatch." };
  }
  const channel = input?.channel === "email" ? "email" : "none";
  let recipientEmail = String(input?.recipientEmail || "").trim().toLowerCase();
  if (assignment.input.assigneeType === "volunteer") {
    const mirror = await readVolunteerMirror();
    const volunteer = mirror.volunteers.find(item => item.id === assignment.input.assigneeId);
    recipientEmail = String(volunteer?.email || "").trim().toLowerCase();
  } else {
    const context = await taskRecipientContext();
    recipientEmail = String(context.taskRecipients.find(item => item.assigneeType === assignment.input.assigneeType && item.id === assignment.input.assigneeId)?.email || "").trim().toLowerCase();
  }
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, error: "The selected assignment needs a valid email before a message draft can be created." };
  }
  return { ok: true, input: { ...assignment.input, channel, recipientEmail: channel === "email" ? recipientEmail : null } };
}

async function incidentAssignmentDirectory(session) {
  const volunteers = hasPermission(session, "volunteers:read")
    ? (await readVolunteerMirror()).volunteers.filter(volunteer => ASSIGNABLE_VOLUNTEER_STATUSES.has(volunteer.status))
    : [];
  const staffDirectory = publicStaffAssignmentDirectory(await readStaffDirectory(), { eventId: CURRENT_EVENT_ID });
  return {
    teams: staffDirectory.teams,
    staff: staffDirectory.staff,
    volunteers: volunteers.map(volunteer => ({
      id: volunteer.id,
      name: volunteer.name,
      status: volunteer.status,
      roles: volunteer.roles,
      emailAvailable: Boolean(volunteer.email)
    }))
  };
}

async function taskRecipientContext() {
  const mirror = await readVolunteerMirror();
  const staffDirectory = await readStaffDirectory();
  return { volunteers: mirror.volunteers || [], taskRecipients: staffTaskRecipients(staffDirectory, { eventId: CURRENT_EVENT_ID }) };
}

function incidentDispatchResponse(dispatch) {
  if (!dispatch) return dispatch;
  const { recipient: _recipient, ...notification } = dispatch.notification || {};
  return {
    ...dispatch,
    notification: {
      ...notification,
      recipientAvailable: Boolean(dispatch.notification?.recipient)
    }
  };
}

async function readConsentLedger() {
  const ledger = await readPlatformDoc(ROOT, "consent", null);
  if (!ledger) return { lastUpdated: null, eventId: CURRENT_EVENT_ID, records: [] };
  return {
    lastUpdated: ledger.lastUpdated ?? null,
    eventId: ledger.eventId ?? CURRENT_EVENT_ID,
    records: Array.isArray(ledger.records) ? ledger.records.map(r => normalizeConsent(r)) : []
  };
}

async function readSmsOperations() {
  return normalizeSmsOperations(
    await readPlatformDoc(ROOT, "smsOperations", emptySmsOperations(CURRENT_EVENT_ID)),
    { eventId: CURRENT_EVENT_ID }
  );
}

async function mutateSmsOperations(mutator) {
  let result = null;
  await updatePlatformDoc(ROOT, "smsOperations", current => {
    result = mutator(normalizeSmsOperations(current, { eventId: CURRENT_EVENT_ID }));
    return result?.doc || current;
  }, { fallback: emptySmsOperations(CURRENT_EVENT_ID) });
  return result;
}

async function appendConsentRecord(record) {
  const next = await updatePlatformDoc(
    ROOT,
    "consent",
    doc => {
      const ledger = doc && typeof doc === "object"
        ? { eventId: doc.eventId ?? CURRENT_EVENT_ID, records: Array.isArray(doc.records) ? doc.records.slice() : [] }
        : { eventId: CURRENT_EVENT_ID, records: [] };
      const idx = ledger.records.findIndex(r =>
        (record.email && r.email === record.email) ||
        (record.phone && r.phone === record.phone && record.phone)
      );
      if (idx === -1) {
        ledger.records.push(record);
      } else {
        ledger.records[idx] = mergeConsentRecords(ledger.records[idx], record);
      }
      return {
        _note: "Consent ledger (lib/consent.mjs). Atomic/Postgres via platform-data.",
        lastUpdated: new Date().toISOString(),
        eventId: ledger.eventId,
        records: ledger.records
      };
    },
    { fallback: { eventId: CURRENT_EVENT_ID, records: [] } }
  );
  return record;
}

async function readPassportHunt() {
  const doc = await readPlatformDoc(ROOT, "passportHunt", null);
  if (!doc) {
    return {
      lastUpdated: null,
      hunt: normalizeHunt({ active: false }),
      checkpoints: []
    };
  }
  return {
    lastUpdated: doc.lastUpdated ?? null,
    hunt: normalizeHunt(doc.hunt || {}),
    checkpoints: Array.isArray(doc.checkpoints) ? doc.checkpoints.map(normalizeCheckpoint) : []
  };
}

async function readPassportCompletions(huntId = null) {
  const currentHuntId = huntId || (await readPassportHunt()).hunt.id;
  const completions = await listPassportCompletions(ROOT, { huntId: currentHuntId });
  return {
    lastUpdated: null,
    completions: completions.map(normalizeCompletion)
  };
}

async function writePassportCompletions(completions) {
  // Prefer append path for new stamps; bulk write used only for legacy full replace.
  await writePlatformDoc(ROOT, "passportCompletions", {
    _note: "Sculpture Passport completions. Prefer hunt_completions table when Postgres is on.",
    lastUpdated: new Date().toISOString(),
    completions: completions ?? []
  });
  return { lastUpdated: new Date().toISOString(), completions };
}

async function readPeoplesChoice() {
  const doc = await readVotingBallot(ROOT);
  return {
    lastUpdated: doc.lastUpdated ?? null,
    eventId: doc.eventId ?? CURRENT_EVENT_ID,
    publicationStatus: doc.publicationStatus ?? "unpublished",
    source: doc.source ?? null,
    votingOpen: doc.votingOpen === true,
    title: doc.title ?? "People's Choice",
    description: doc.description ?? "",
    entries: Array.isArray(doc.entries) ? doc.entries.map(normalizeBallotEntry) : [],
    votes: Array.isArray(doc.votes) ? doc.votes.map(normalizeVote) : []
  };
}

async function writePeoplesChoice(doc) {
  const payload = {
    _note: "People's Choice ballot + votes (lib/voting.mjs).",
    lastUpdated: new Date().toISOString(),
    eventId: doc.eventId ?? CURRENT_EVENT_ID,
    publicationStatus: doc.publicationStatus ?? "unpublished",
    source: doc.source ?? null,
    votingOpen: doc.votingOpen === true,
    title: doc.title ?? "People's Choice",
    description: doc.description ?? "",
    entries: doc.entries ?? [],
    votes: doc.votes ?? []
  };
  await writePlatformDoc(ROOT, "voting", payload);
  return payload;
}

async function readBoothMap() {
  const doc = await readPlatformDoc(ROOT, "booths", null);
  if (!doc) {
    return {
      lastUpdated: null,
      eventId: CURRENT_EVENT_ID,
      source: "empty",
      booths: [],
      vendors: [],
      imports: []
    };
  }
  return {
    lastUpdated: doc.lastUpdated ?? null,
    eventId: doc.eventId ?? CURRENT_EVENT_ID,
    source: doc.source ?? "seed",
    booths: Array.isArray(doc.booths) ? doc.booths.map(normalizeBooth) : [],
    vendors: Array.isArray(doc.vendors) ? doc.vendors.map(normalizeVendor) : [],
    imports: Array.isArray(doc.imports) ? doc.imports.slice(-100) : []
  };
}

async function readPartnerOperations() {
  return normalizePartnerOperations(
    await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations(CURRENT_EVENT_ID))
  );
}

function buildOperationsExport(name, doc, now = new Date().toISOString()) {
  switch (name) {
    case "partners.csv":
      return partnerDirectoryExport(doc, CURRENT_EVENT_ID);
    case "receivables.csv":
      return receivablesExport(doc, CURRENT_EVENT_ID, now);
    case "payments.csv":
      return paymentsExport(doc, CURRENT_EVENT_ID);
    case "tasks.csv":
      return tasksExport(doc, CURRENT_EVENT_ID);
    case "outreach.csv":
      return outreachProspectsExport(doc, CURRENT_EVENT_ID);
    case "milestones.ics":
      return milestonesCalendarExport(doc, CURRENT_EVENT_ID, now);
    default:
      return null;
  }
}

function operationsExportPermission(name) {
  if (["receivables.csv", "payments.csv"].includes(name)) return "payments:read";
  if (name === "outreach.csv") return "outreach:read";
  return "partners:read";
}

function adminPartnerApplicationView(application) {
  const {
    portalAccessId,
    portalAccessVersion,
    portalAccessIssuedAt,
    ...safe
  } = application;
  return {
    ...safe,
    portalAccess: adminPartnerPortalAccess({ portalAccessId, portalAccessVersion, portalAccessIssuedAt })
  };
}

function adminPartnerFollowupView(followup) {
  if (!followup) return followup;
  const { deliveryClaimId, deliveryIdempotencyKey, ...deliverySafe } = followup;
  if (!followup.taskId) return deliverySafe;
  const { recipient, ...safe } = deliverySafe;
  return {
    ...safe,
    recipientAvailable: Boolean(recipient),
    recipientLabel: followup.taskAssigneeName || followup.taskAssigneeId || "Task assignee"
  };
}

async function readWorkerStatus() {
  const status = await readPlatformDoc(ROOT, "workerStatus", null);
  const ageMs = status?.heartbeatAt ? Date.now() - new Date(status.heartbeatAt).getTime() : Number.POSITIVE_INFINITY;
  return {
    ...(status || { service: "sandfest-worker", state: "unknown", heartbeatAt: null }),
    ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
    healthy: status?.state === "running" && ageMs <= Math.max(30_000, Number(status?.pollMs || 2000) * 5)
  };
}

async function mutatePartnerOperations(mutator) {
  let result = null;
  await updatePlatformDoc(ROOT, "partnerOps", current => {
    const doc = normalizePartnerOperations(current);
    if (doc.eventId !== CURRENT_EVENT_ID) {
      result = {
        ok: false,
        eventContextMismatch: true,
        error: `Partner operations are assigned to ${doc.eventId}; complete rollover to ${CURRENT_EVENT_ID} before accepting changes.`
      };
      return doc;
    }
    result = mutator(doc);
    return result?.ok ? result.doc : doc;
  }, { fallback: emptyPartnerOperations(CURRENT_EVENT_ID) });
  return result;
}

async function syncDeploymentTasks(checks, actorId, now = new Date().toISOString()) {
  let result = null;
  await updatePlatformDoc(ROOT, "partnerOps", current => {
    const doc = normalizePartnerOperations(current);
    if (doc.eventId !== CURRENT_EVENT_ID) {
      result = {
        ok: false,
        eventContextMismatch: true,
        error: `Partner operations are assigned to ${doc.eventId}; complete rollover to ${CURRENT_EVENT_ID} before accepting changes.`
      };
      return undefined;
    }
    result = syncDeploymentCheckTasks(doc, checks, {
      actorId,
      idFactory: prefix => `${prefix}_${randomUUID()}`,
      now
    });
    return result?.ok && result.changed ? result.doc : undefined;
  }, { fallback: emptyPartnerOperations(CURRENT_EVENT_ID) });
  return result;
}

async function syncDocumentReviewTask(document, actorId, now = new Date().toISOString()) {
  return mutatePartnerOperations(doc => syncIncomingDocumentReviewTask(doc, document, {
    actorId,
    now
  }));
}

async function enqueueIncomingDocumentExtraction(document) {
  if (document?.extractionStatus !== "queued") return null;
  return enqueueJob(ROOT, {
    type: "document.extract",
    payload: {
      documentId: document.id,
      eventId: document.eventId,
      checksumSha256: document.checksumSha256,
      extractionVersion: document.extractionVersion
    },
    maxAttempts: 3,
    idempotencyKey: `${document.eventId}:${document.id}:${document.checksumSha256}:${document.extractionVersion}`
  });
}

function publicPartnerStatus(doc, application) {
  const status = publicPartnerPortalStatus(doc, application);
  status.finance.onlinePayment = publicStripePartnerPaymentsReadiness(STRIPE_PARTNER_PAYMENTS);
  return status;
}

function currentPartnerPortalUrl(application) {
  if (!application) return null;
  const config = partnerPortalConfig();
  if (!config.ready) return null;
  const token = issuePartnerPortalToken(application, { config });
  return token ? partnerPortalUrl(application, token, { config }) : null;
}

async function quickBooksItemForApplication(application) {
  const config = await storage.config.read("admin-config");
  if (application?.type === "sponsor") {
    const sponsorPackage = sponsorPackageCatalog(config).packages.find(item => item.id === application.packageId);
    return sponsorPackage?.quickBooksItemId || process.env.QB_SPONSOR_ITEM_ID || null;
  }
  const vendorOffering = vendorOfferingCatalog(config).offerings.find(item => item.id === application?.offeringId);
  if (vendorOffering?.quickBooksItemId) return vendorOffering.quickBooksItemId;
  return process.env.QB_VENDOR_ITEM_ID || null;
}

let islandConditionsRefreshPromise = null;

async function readIslandConditions({ refreshWeather = false, refreshFerry = false } = {}) {
  let doc = normalizeIslandConditions(
    await readPlatformDoc(ROOT, "islandConditions", null)
  );
  const now = new Date().toISOString();
  const refreshAge = feed => {
    const lastAttempt = feed?.refreshAttemptedAt || feed?.observedAt;
    const timestamp = lastAttempt ? new Date(lastAttempt).getTime() : Number.NaN;
    return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
  };
  const ferryOverrideUntil = doc.ferry?.manualOverrideUntil ? new Date(doc.ferry.manualOverrideUntil).getTime() : Number.NaN;
  const ferryOverrideActive = Number.isFinite(ferryOverrideUntil) && ferryOverrideUntil > Date.now();
  const dueWeather = refreshWeather && weatherForecastNeedsRefresh(doc.weather, now);
  const dueFerry = refreshFerry
    && !ferryOverrideActive
    && (failedFeedRefreshNeedsRetry(doc.ferry, now) || refreshAge(doc.ferry) > 2 * 60_000);
  if (dueWeather || dueFerry) {
    if (!islandConditionsRefreshPromise) {
      islandConditionsRefreshPromise = (async () => {
        const fetchImpl = BOARD_DEMO_FEED_FIXTURE_BASE ? boardDemoFeedFetch : fetch;
        const [weatherResult, ferryResult] = await Promise.all([
          dueWeather ? fetchPortAransasWeather({ now, fetchImpl }).then(value => ({ value })).catch(error => ({ error })) : null,
          dueFerry ? fetchPortAransasFerryStatus({ now, fetchImpl }).then(value => ({ value })).catch(error => ({ error })) : null
        ]);
        return updatePlatformDoc(ROOT, "islandConditions", current => {
          const next = normalizeIslandConditions(current);
          let succeeded = false;
          if (weatherResult?.value) {
            next.weather = { ...weatherResult.value, refreshAttemptedAt: now, refreshError: null };
            succeeded = true;
          } else if (weatherResult?.error) {
            next.weather = { ...next.weather, refreshAttemptedAt: now, refreshError: String(weatherResult.error.message || weatherResult.error).slice(0, 300) };
          }
          if (ferryResult?.value) {
            next.ferry = { ...next.ferry, ...ferryResult.value, manualOverrideUntil: null, refreshAttemptedAt: now, refreshError: null };
            succeeded = true;
          } else if (ferryResult?.error) {
            next.ferry = { ...next.ferry, refreshAttemptedAt: now, refreshError: String(ferryResult.error.message || ferryResult.error).slice(0, 300) };
          }
          return { ...next, lastUpdated: succeeded ? now : next.lastUpdated };
        }, { fallback: doc });
      })();
    }
    const refreshPromise = islandConditionsRefreshPromise;
    try {
      doc = await refreshPromise;
    } finally {
      if (islandConditionsRefreshPromise === refreshPromise) islandConditionsRefreshPromise = null;
    }
  }
  return normalizeIslandConditions(doc);
}

async function deploymentProfile() {
  const production = SANDFEST_ENV === "production";
  const adminBase = process.env.SANDFEST_ADMIN_BASE_URL || "";
  const publicApiBase = process.env.SANDFEST_API_PUBLIC_BASE_URL || "";
  const corsOrigins = new Set(ALLOWED_ORIGINS);
  const mode = authMode();
  const jwt = authModeIsJwt();
  const jwksUrl = process.env.SANDFEST_AUTH_JWKS_URL || "";
  const issuer = process.env.SANDFEST_AUTH_ISSUER || "";
  const capabilityPolicy = requiredCapabilityPolicy(production);
  const [ticketCatalog, eventBootstrap, adminConfigResult, ...operationalDocValues] = await Promise.all([
    storage.config.read("ticket-products"),
    storage.config.read("app-bootstrap"),
    storage.config.read("admin-config")
      .then(value => ({ value, error: null }))
      .catch(error => ({ value: null, error })),
    ...OPERATIONAL_EVENT_DOCUMENT_KEYS.map(key => readPlatformDoc(ROOT, key, null))
  ]);
  const operationalDocs = OPERATIONAL_EVENT_DOCUMENT_KEYS.map((key, index) => ({
    key,
    eventId: key === "passportHunt"
      ? operationalDocValues[index]?.hunt?.eventId ?? null
      : operationalDocValues[index]?.eventId ?? null
  }));
  const guideReadiness = eventGuideReadiness(eventBootstrap.guide, {
    maxSourceAgeDays: EVENT_GUIDE_SOURCE_MAX_AGE_DAYS
  });
  const currentEventReadiness = eventContextReadiness({
    config: EVENT_CONTEXT,
    guide: eventBootstrap.guide,
    operationalDocs
  });
  const staffDirectoryDocument = operationalDocValues[OPERATIONAL_EVENT_DOCUMENT_KEYS.indexOf("staffDirectory")];
  const staffReadiness = staffDirectoryReadiness(staffDirectoryDocument, { eventId: CURRENT_EVENT_ID, production });
  const checkoutProducts = (ticketCatalog?.products || []).filter(item => item.active !== false && item.requiresReview !== true);
  const invalidCheckoutProducts = checkoutProducts.filter(item => !/^price_[A-Za-z0-9_]+$/.test(item.stripePriceId || "")
    || item.stripePriceId.startsWith("price_replace")
    || !Number.isInteger(item.unitAmount)
    || item.unitAmount < 1);
  const recovery = recoveryReadiness(process.env);
  const vendorCatalog = adminConfigResult.error
    ? {
        ready: false,
        activeOfferings: [],
        missingCategories: [],
        errors: [`Admin config could not be read: ${adminConfigResult.error.message}`]
      }
    : vendorOfferingCatalog(adminConfigResult.value);
  const stripeTicketingReady = STRIPE_ENABLED
    && STRIPE_SECRET_KEY.startsWith("sk_")
    && STRIPE_WEBHOOK_SECRET.startsWith("whsec_")
    && STRIPE_SUCCESS_URL.startsWith("https://")
    && STRIPE_CANCEL_URL.startsWith("https://")
    && (!production || STRIPE_API_BASE_URL === "https://api.stripe.com")
    && checkoutProducts.length > 0
    && invalidCheckoutProducts.length === 0;
  const sponsorCatalog = sponsorPackageCatalog(adminConfigResult.value || {});
  const checks = {
    environment: checkStatus(["development", "staging", "production"].includes(SANDFEST_ENV), `SANDFEST_ENV=${SANDFEST_ENV}`),
    capabilityPolicy: checkStatus(
      capabilityPolicy.unknown.length === 0,
      capabilityPolicy.unknown.length
        ? `Unknown required capabilities: ${capabilityPolicy.unknown.join(", ")}.`
        : capabilityPolicy.required.size
          ? `Required capabilities: ${[...capabilityPolicy.required].join(", ")}.`
          : "No optional integrations are required for this environment."
    ),
    dataPlane: checkStatus(
      !production || storage.kind === "postgres",
      production ? "Production requires Postgres for durable records and background work." : `Development data plane: ${storage.kind}.`,
      production ? "error" : "warning"
    ),
    backupRecovery: checkStatus(
      recovery.ready,
      recovery.ready
        ? `${recovery.provider} recovery is ready; oldest restore drill ${recovery.oldestRestoreDrillAgeDays} day${recovery.oldestRestoreDrillAgeDays === 1 ? "" : "s"} ago.`
        : recovery.reason,
      production ? "error" : "warning"
    ),
    authMode: checkStatus(
      !production || jwt,
      production ? "Production requires SANDFEST_AUTH_MODE=jwt with a JWKS URL." : `Auth mode: ${mode}.`,
      production ? "error" : "warning"
    ),
    authJwks: checkStatus(
      !jwt || jwksUrl.startsWith("https://"),
      jwt ? "JWT mode requires SANDFEST_AUTH_JWKS_URL to be an HTTPS URL." : "JWKS URL not required in bearer-token mode.",
      "error"
    ),
    authIssuer: checkStatus(
      !jwt || Boolean(issuer),
      jwt ? "JWT mode requires SANDFEST_AUTH_ISSUER for issuer pinning." : "Issuer pinning not required in bearer-token mode.",
      jwt ? "error" : "warning"
    ),
    adminToken: checkStatus(
      jwt || (ADMIN_TOKEN.length >= 32 && ADMIN_TOKEN !== "dev-admin-token-change-me" && !ADMIN_TOKEN.includes("replace-with")),
      jwt ? "Bearer token unused in JWT mode." : production ? "SANDFEST_ADMIN_API_TOKEN must be a long production secret." : "Using a local/dev admin token.",
      production && !jwt ? "error" : "warning"
    ),
    adminRole: checkStatus(jwt || Boolean(rolePermissions[ADMIN_ROLE]), jwt ? "Role resolved from JWT claim." : `SANDFEST_ADMIN_ROLE=${ADMIN_ROLE}`),
    adminActor: checkStatus(
      jwt || ADMIN_ACTOR_ID !== "local-admin" || !production,
      jwt ? "Actor resolved from JWT claim." : production ? "SANDFEST_ADMIN_ACTOR_ID must identify the deployed actor/provider." : `SANDFEST_ADMIN_ACTOR_ID=${ADMIN_ACTOR_ID}`,
      production && !jwt ? "error" : "warning"
    ),
    cors: checkStatus(
      corsOrigins.has("https://www.texassandfest.org") && corsOrigins.has("https://texassandfest.org") && (!adminBase || corsOrigins.has(adminBase)),
      "CORS includes Texas SandFest origins and admin base URL."
    ),
    publicApiBase: checkStatus(
      !production || publicApiBase.startsWith("https://"),
      production ? "SANDFEST_API_PUBLIC_BASE_URL must be HTTPS." : "Public API base can be local in development.",
      production ? "error" : "warning"
    ),
    eventGuide: checkStatus(
      guideReadiness.ready,
      guideReadiness.reason,
      production ? "error" : "warning"
    ),
    currentEvent: checkStatus(
      currentEventReadiness.ready,
      currentEventReadiness.reason,
      production ? "error" : "warning"
    ),
    staffDirectory: checkStatus(
      staffReadiness.ready,
      staffReadiness.ready
        ? `${staffReadiness.activeStaff} active staff and ${staffReadiness.routedTeams}/${staffReadiness.totalTeams} team notification routes are ready.`
        : staffReadiness.reason,
      production || capabilityPolicy.required.has("staff_directory") ? "error" : "warning"
    ),
    sponsorPackages: checkStatus(
      sponsorCatalog.ready,
      sponsorCatalog.ready
        ? `${sponsorCatalog.activePackages.length} active sponsor packages have trusted pricing and fulfillment benefits.`
        : sponsorCatalog.errors.join(" "),
      production ? "error" : "warning"
    ),
    vendorOfferings: checkStatus(
      vendorCatalog.ready,
      vendorCatalog.ready
        ? `${vendorCatalog.activeOfferings.length} active vendor offerings cover every public vendor type.`
        : vendorCatalog.errors.join(" "),
      production ? "error" : "warning"
    ),
    adminBase: checkStatus(
      !production || adminBase.startsWith("https://"),
      production ? "SANDFEST_ADMIN_BASE_URL must be HTTPS." : "Admin base can be local in development.",
      production ? "error" : "warning"
    ),
    stripeSecret: checkStatus(
      !STRIPE_ENABLED || STRIPE_SECRET_KEY.startsWith("sk_"),
      "Stripe ticketing enabled requires STRIPE_SECRET_KEY.",
      "error"
    ),
    stripeWebhook: checkStatus(
      !STRIPE_ENABLED || STRIPE_WEBHOOK_SECRET.startsWith("whsec_"),
      "Stripe ticketing enabled requires STRIPE_WEBHOOK_SECRET.",
      "error"
    ),
    stripeUrls: checkStatus(
      !STRIPE_ENABLED || (STRIPE_SUCCESS_URL.startsWith("https://") && STRIPE_CANCEL_URL.startsWith("https://")),
      production ? "Stripe success/cancel URLs must be HTTPS." : "Stripe success/cancel URLs may be local until sandbox is enabled.",
      production || STRIPE_ENABLED ? "error" : "warning"
    ),
    stripeApiOrigin: checkStatus(
      !STRIPE_ENABLED || !production || STRIPE_API_BASE_URL === "https://api.stripe.com",
      production ? "Stripe ticketing must use the official Stripe API origin." : `Stripe ticketing API origin: ${STRIPE_API_BASE_URL}.`,
      production && STRIPE_ENABLED ? "error" : "warning"
    ),
    stripeTicketing: checkStatus(
      !capabilityPolicy.required.has("stripe_ticketing") || stripeTicketingReady,
      stripeTicketingReady
        ? `Stripe ticketing is ready for ${checkoutProducts.length} checkout product${checkoutProducts.length === 1 ? "" : "s"}.`
        : capabilityPolicy.required.has("stripe_ticketing")
          ? `Required Stripe ticketing is not ready${invalidCheckoutProducts.length ? `; set trusted amounts and Stripe Price IDs for: ${invalidCheckoutProducts.map(item => item.id).join(", ")}` : "."}`
          : "Stripe ticketing is optional in this environment.",
      capabilityPolicy.required.has("stripe_ticketing") ? "error" : "warning"
    ),
    stripePartnerPayments: checkStatus(
      (!capabilityPolicy.required.has("stripe_partner_payments") && !STRIPE_PARTNER_PAYMENTS.enabled) || STRIPE_PARTNER_PAYMENTS.ready,
      STRIPE_PARTNER_PAYMENTS.ready
        ? "Stripe partner invoice checkout and webhook reconciliation are ready."
        : capabilityPolicy.required.has("stripe_partner_payments")
          ? `Required partner online payments are not ready. ${STRIPE_PARTNER_PAYMENTS.reason}`
          : STRIPE_PARTNER_PAYMENTS.reason,
      capabilityPolicy.required.has("stripe_partner_payments") || STRIPE_PARTNER_PAYMENTS.enabled ? "error" : "warning"
    ),
    rateLimits: checkStatus(
      ADMIN_RATE_LIMIT > 0 && CHECKOUT_RATE_LIMIT > 0 && PUBLIC_RATE_LIMIT > 0 && PARTNER_STATUS_RATE_LIMIT > 0,
      `Rate limits admin=${ADMIN_RATE_LIMIT}/min checkout=${CHECKOUT_RATE_LIMIT}/min public=${PUBLIC_RATE_LIMIT}/min partner-status=${PARTNER_STATUS_RATE_LIMIT}/min.`
    ),
    rateLimitBackend: checkStatus(
      !production || rateLimiter.kind === "redis" || rateLimiter.kind === "upstash",
      production
        ? `Production requires a reachable shared Redis rate limiter; active backend is ${rateLimiter.kind}.`
        : `Development rate-limit backend: ${rateLimiter.kind}.`,
      production ? "error" : "warning"
    ),
    partnerIntakeBotProtection: checkStatus(
      TURNSTILE.ready,
      TURNSTILE.reason,
      production || TURNSTILE.enabled ? "error" : "warning"
    ),
    partnerPortal: (() => {
      const portal = partnerPortalConfig();
      return checkStatus(
        portal.ready,
        portal.ready ? "Secure partner status portal is ready." : portal.reason,
        production ? "error" : "warning"
      );
    })(),
    outreachPreferences: checkStatus(
      OUTREACH_PREFERENCES.ready,
      OUTREACH_PREFERENCES.ready ? "Recipient-controlled sponsor outreach preferences are ready." : OUTREACH_PREFERENCES.reason,
      production ? "error" : "warning"
    ),
    outreachDiscovery: (() => {
      const required = capabilityPolicy.required.has("outreach_discovery");
      return checkStatus(
        (!required && !OUTREACH_DISCOVERY.enabled) || OUTREACH_DISCOVERY.ready,
        OUTREACH_DISCOVERY.ready
          ? `${OUTREACH_DISCOVERY.provider} regional business discovery is ready.`
          : required
            ? `Required regional business discovery is not ready. ${OUTREACH_DISCOVERY.reason}`
            : OUTREACH_DISCOVERY.reason,
        required || OUTREACH_DISCOVERY.enabled ? "error" : "warning"
      );
    })(),
    sponsorInvitations: checkStatus(
      SPONSOR_INVITATIONS.ready,
      SPONSOR_INVITATIONS.ready ? "Consent-preserving sponsor invitation links are ready." : SPONSOR_INVITATIONS.reason,
      production ? "error" : "warning"
    ),
    partnerAssetStorage: checkStatus(
      PARTNER_ASSET_STORAGE.ready,
      PARTNER_ASSET_STORAGE.ready ? `Private partner document storage is ready (${Math.round(PARTNER_ASSET_STORAGE.maxBytes / 1024 / 1024)} MB per file).` : PARTNER_ASSET_STORAGE.reason,
      production ? "error" : "warning"
    ),
    documentIngestion: (() => {
      const required = capabilityPolicy.required.has("document_ingestion");
      const extractionReady = !production || DOCUMENT_EXTRACTION_SOURCE.secretReady;
      const ready = INCOMING_DOCUMENT_STORAGE.ready && extractionReady;
      return checkStatus(
        (!required && !production) || ready,
        ready
          ? `Private document intake and authenticated worker extraction are ready (${Math.round(INCOMING_DOCUMENT_STORAGE.maxBytes / 1024 / 1024)} MB per file).`
          : required
            ? `Required document intake is not ready. ${INCOMING_DOCUMENT_STORAGE.reason || "SANDFEST_DOCUMENT_EXTRACTION_SECRET must be shared with the worker."}`
            : INCOMING_DOCUMENT_STORAGE.reason || "Document extraction authentication is not configured.",
        required || production ? "error" : "warning"
      );
    })(),
    sms: (() => {
      const sms = smsConfigFromEnv(process.env);
      const required = capabilityPolicy.required.has("sms_safety");
      return checkStatus(
        (!required && !sms.enabled) || sms.ready,
        sms.ready
          ? "Consent-safe Twilio safety messaging and signed callbacks are ready."
          : required
            ? `Required safety SMS is not ready. ${sms.reason}`
            : sms.reason,
        required || sms.enabled ? "error" : "warning"
      );
    })(),
    transactionalEmail: (() => {
      const email = emailConfigFromEnv();
      const required = capabilityPolicy.required.has("transactional_email");
      const ready = email.ready && BREVO_WEBHOOK.ready;
      const reason = !email.ready ? email.reason : BREVO_WEBHOOK.reason;
      return checkStatus(
        (!required && !email.enabled) || ready,
        ready ? "Brevo transactional email and authenticated delivery tracking are ready." : required ? `Required transactional email is not ready. ${reason}` : reason,
        required || email.enabled ? "error" : "warning"
      );
    })(),
    quickBooksInvoices: (() => {
      const quickbooks = quickBooksReadiness();
      const required = capabilityPolicy.required.has("quickbooks_invoices");
      return checkStatus(
        (!required && !quickbooks.invoiceSyncEnabled) || quickbooks.canSyncPartnerInvoices,
        quickbooks.canSyncPartnerInvoices ? "QuickBooks partner invoice sync is ready." : required ? `Required QuickBooks invoice sync is not ready. ${quickbooks.reason}` : quickbooks.reason,
        required || quickbooks.invoiceSyncEnabled ? "error" : "warning"
      );
    })(),
    cameraIngest: (() => {
      const ingest = cameraIngestConfig();
      const required = capabilityPolicy.required.has("camera_ingest");
      return checkStatus(
        (!required && !ingest.enabled) || ingest.ready,
        ingest.ready ? "Signed camera metric ingestion is ready." : required ? `Required camera metric ingestion is not ready. ${ingest.reason}` : ingest.reason,
        required || ingest.enabled ? "error" : "warning"
      );
    })(),
    cameraModelApproval: (() => {
      const ingest = cameraIngestConfig();
      const required = capabilityPolicy.required.has("camera_ingest");
      const approval = cameraModelApproval();
      const applicable = production && (required || ingest.enabled);
      return checkStatus(
        !applicable || approval.ready,
        approval.ready
          ? `Camera detector ${approval.modelName} ${approval.modelVersion} is approval-bound to ${approval.sha256.slice(0, 12)}... under ${approval.licenseReference}.`
          : applicable
            ? approval.reason
            : "Camera model approval is enforced when camera ingestion is deployed in production.",
        applicable ? "error" : "warning"
      );
    })()
  };
  const values = Object.values(checks);
  const errors = values.filter(check => !check.ok && check.severity === "error");
  const warnings = values.filter(check => !check.ok && check.severity === "warning");
  const presentedChecks = presentDeploymentChecks(checks);
  return {
    environment: SANDFEST_ENV,
    production,
    requiredCapabilities: [...capabilityPolicy.required],
    ok: errors.length === 0,
    errors: errors.length,
    warnings: warnings.length,
    checks: presentedChecks,
    groups: summarizeDeploymentGroups(presentedChecks)
  };
}

function clampLimit(value, fallback = 50) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : fallback;
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return null;
  if (SANDFEST_ENV !== "production" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    return origin;
  }
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function partnerIntakeIdempotency(request, type, body = {}) {
  const header = Array.isArray(request.headers["idempotency-key"])
    ? request.headers["idempotency-key"][0]
    : request.headers["idempotency-key"];
  const key = String(header || "").trim();
  if (!key) return { ok: true, idempotencyKeyHash: null, idempotencyFingerprint: null };
  if (key.length < 16 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return { ok: false, error: "Idempotency-Key must be 16 to 200 URL-safe characters." };
  }
  const normalize = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
  const canonical = {
    type,
    organizationName: normalize(body.organizationName, 160),
    contactName: normalize(body.contactName, 120),
    contactEmail: normalize(body.contactEmail, 254).toLowerCase(),
    contactPhone: normalize(body.contactPhone, 40),
    website: normalize(body.website, 500),
    city: normalize(body.city, 100),
    state: normalize(body.state, 40).toUpperCase(),
    postalCode: normalize(body.postalCode, 20),
    category: normalize(body.category, 100).toLowerCase(),
    vendorOfferingId: normalize(body.vendorOfferingId, 100).toLowerCase(),
    description: normalize(body.description),
    packageId: normalize(body.packageId, 100),
    requestedAmountCents: Number.isFinite(Number(body.requestedAmountCents)) ? Math.round(Number(body.requestedAmountCents)) : null,
    tags: Array.isArray(body.tags) ? body.tags.map(item => normalize(item, 160)).filter(Boolean).sort() : [],
    consentToContact: body.consentToContact === true
  };
  const digest = value => createHash("sha256").update(value).digest("hex");
  return {
    ok: true,
    idempotencyKeyHash: digest(key),
    idempotencyFingerprint: digest(JSON.stringify(canonical))
  };
}

function outreachImportPreviewHash(csv, defaultsInput = {}) {
  const defaults = normalizeOutreachImportDefaults(defaultsInput);
  const canonical = {
    csv: String(csv ?? "").replace(/\r\n?/g, "\n"),
    defaults
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function outreachImportResponse(result) {
  return {
    summary: result.summary,
    duplicates: result.duplicates.slice(0, 100),
    errors: result.errors.slice(0, 100),
    sample: result.created.slice(0, 10).map(item => ({
      id: item.id,
      organizationName: item.organizationName,
      city: item.city,
      state: item.state,
      postalCode: item.postalCode,
      fitScore: item.fitScore,
      status: item.status
    }))
  };
}

function eventenyPartnerImportResponse(result) {
  return {
    summary: result.summary,
    duplicates: result.duplicates.slice(0, 100),
    conflicts: result.conflicts.slice(0, 100),
    errors: result.errors.slice(0, 100),
    sample: result.created.slice(0, 10).map(item => ({
      id: item.id,
      reference: item.reference,
      organizationName: item.organizationName,
      type: item.type,
      packageName: item.packageName,
      offeringName: item.offeringName,
      sourceStatus: item.sourceStatus,
      sourceReportedAmountCents: item.sourceReportedAmountCents,
      expectedAmountCents: item.expectedAmountCents
    }))
  };
}

function revenueImportResponse(result) {
  return {
    replay: result.replay === true,
    summary: result.summary,
    importRecord: result.importRecord || null,
    duplicates: result.duplicates.slice(0, 100),
    errors: result.errors.slice(0, 100),
    sample: result.entries.slice(0, 10).map(entry => ({
      id: entry.id,
      externalRef: entry.externalRef,
      date: entry.date,
      source: entry.source,
      category: entry.category,
      entryType: entry.entryType,
      grossCents: entry.grossCents,
      feeCents: entry.feeCents,
      netCents: entry.netCents
    }))
  };
}

function incomingDocumentAuditView(record) {
  const { textPreview: _textPreview, ...metadata } = adminIncomingDocument(record);
  return metadata;
}

async function mutateRevenueLedger(parsed, options = {}) {
  let result = null;
  const fallback = {
    eventId: CURRENT_EVENT_ID,
    lastUpdated: null,
    currency: "usd",
    expectedAttendance: null,
    ticketCapacity: null,
    entries: [],
    imports: []
  };
  await updatePlatformDoc(ROOT, "revenue", current => {
    result = applyRevenueImport(current || fallback, parsed, { ...options, commit: true });
    return result?.ok ? result.doc : current;
  }, { fallback });
  return result;
}

function sendJson(request, response, status, payload, headers = {}) {
  const requestId = request.requestId || `req_${randomUUID()}`;
  const responsePayload = status >= 400 && !Object.hasOwn(payload, "requestId")
    ? { ...payload, requestId }
    : payload;
  const origin = allowedOrigin(request);
  const responseHeaders = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,idempotency-key,x-partner-reference,x-partner-token,x-file-name,x-asset-kind,x-asset-label,x-requirement-id,x-document-label,x-document-domain,x-document-title,x-owner-team,x-document-review-due-at",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "vary": "origin",
    "cache-control": "no-store",
    ...headers
  };
  if (SANDFEST_ENV === "production") {
    responseHeaders["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  if (origin) responseHeaders["access-control-allow-origin"] = origin;
  response.writeHead(status, responseHeaders);
  response.end(request.method === "HEAD" ? undefined : JSON.stringify(responsePayload, null, 2));
}

function sendTwiml(request, response, status = 200) {
  const requestId = request.requestId || `req_${randomUUID()}`;
  response.writeHead(status, {
    "content-type": "text/xml; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId
  });
  response.end("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
}

function sendBinary(request, response, status, buffer, { contentType, fileName, publicAsset = false } = {}) {
  const requestId = request.requestId || `req_${randomUUID()}`;
  const origin = allowedOrigin(request);
  const downloadName = String(fileName || "brand-asset").replace(/[\r\n"\\/]+/g, "-").slice(0, 180);
  const headers = {
    "content-type": contentType || "application/octet-stream",
    "content-length": String(buffer.length),
    "content-disposition": `${publicAsset ? "inline" : "attachment"}; filename="${downloadName}"`,
    "access-control-expose-headers": "content-disposition,x-request-id",
    "cache-control": publicAsset ? "public, max-age=86400, immutable" : "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-request-id": requestId,
    "vary": "origin"
  };
  if (publicAsset) headers["cross-origin-resource-policy"] = "cross-origin";
  if (SANDFEST_ENV === "production") {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  if (origin) headers["access-control-allow-origin"] = origin;
  response.writeHead(status, headers);
  response.end(request.method === "HEAD" ? undefined : buffer);
}

function publicCacheHeaders(seconds = 60) {
  return {
    "cache-control": `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=300`
  };
}

function requestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress ?? "unknown";
}

function rateLimitProfile(pathname, method) {
  if (method === "OPTIONS") return null;
  if (method === "POST" && pathname === "/api/webhooks/brevo") return { name: "brevo-webhook", limit: PUBLIC_RATE_LIMIT };
  if (method === "POST" && pathname.startsWith("/api/webhooks/twilio/")) return { name: "twilio-webhook", limit: SMS_WEBHOOK_RATE_LIMIT };
  if (pathname === "/api/stripe/create-checkout-session") return { name: "checkout", limit: CHECKOUT_RATE_LIMIT };
  if (method === "POST" && ["/api/public/partner-status", "/api/public/partner-payment-checkout", "/api/public/outreach-preferences"].includes(pathname)) {
    return { name: "partner-status", limit: PARTNER_STATUS_RATE_LIMIT };
  }
  // Unauthenticated write paths get a stricter bucket (festival abuse protection).
  if (
    method === "POST" &&
    (
      pathname === "/api/public/passport/stamp" ||
      pathname === "/api/public/voting" ||
      pathname === "/api/public/vendor-applications" ||
      pathname === "/api/public/sponsor-inquiries" ||
      pathname === "/api/public/outreach-preferences/unsubscribe" ||
      pathname === "/api/public/partner-brand-profile" ||
      pathname === "/api/public/partner-brand-assets" ||
      pathname === "/api/public/partner-brand-assets/upload" ||
      pathname.startsWith("/api/public/partner-deliverables/") ||
      pathname === "/api/public/partner-vendor-profile" ||
      pathname === "/api/public/partner-vendor-documents" ||
      pathname === "/api/public/partner-vendor-documents/upload" ||
      pathname === "/api/public/partner-vendor-assignment/confirm"
    )
  ) {
    return { name: "public-write", limit: PUBLIC_WRITE_RATE_LIMIT };
  }
  if (pathname.startsWith("/api/admin")) return { name: "admin", limit: ADMIN_RATE_LIMIT };
  if (pathname.startsWith("/api/ingest/cameras")) return { name: "camera-ingest", limit: CAMERA_INGEST_RATE_LIMIT };
  if (pathname.startsWith("/api/public")) return { name: "public", limit: PUBLIC_RATE_LIMIT };
  return null;
}

async function checkRateLimit(request, response, pathname, method) {
  const profile = rateLimitProfile(pathname, method);
  if (!profile) return true;
  const key = `${profile.name}:${requestIp(request)}`;
  const result = await rateLimiter.check(key, profile.limit);
  response.setHeader("x-ratelimit-limit", String(profile.limit));
  response.setHeader("x-ratelimit-remaining", String(result.remaining));
  response.setHeader("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
  response.setHeader("x-ratelimit-backend", rateLimiter.kind || "memory");
  if (result.allowed) return true;
  sendJson(request, response, 429, {
    error: `Rate limit exceeded for ${profile.name} requests.`,
    retryAfterSeconds: result.retryAfterSeconds
  }, {
    "retry-after": String(result.retryAfterSeconds)
  });
  return false;
}

async function adminSession(request) {
  if (request.adminSession) return request.adminSession;
  const session = await resolveSession(request, { rolePermissions });
  if (session) request.adminSession = session;
  return session;
}

function hasPermission(session, permission) {
  return Boolean(session?.permissions?.includes("*") || session?.permissions?.includes(permission));
}

async function requirePermission(request, response, permission) {
  const session = await adminSession(request);
  if (!session) {
    sendJson(request, response, 401, { error: "Unauthorized admin API request." });
    return null;
  }
  if (!hasPermission(session, permission)) {
    sendJson(request, response, 403, {
      error: `Admin role ${session.role} is missing permission: ${permission}`,
      requiredPermission: permission,
      session
    });
    return null;
  }
  request.adminSession = session;
  return session;
}

async function requireAdmin(request, response) {
  return requirePermission(request, response, "admin:read");
}

async function readBody(request, maxBytes = MAX_BODY_BYTES) {
  const body = await readRawBody(request, maxBytes);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function readRawBody(request, maxBytes = MAX_BODY_BYTES) {
  return (await readBufferBody(request, maxBytes)).toString("utf8");
}

async function readSignedCameraPayload(request, response, label, cameraId) {
  const config = cameraIngestConfig();
  if (!config.ready) {
    sendJson(request, response, 503, { error: config.reason, ingest: publicCameraIngestReadiness(config) });
    return null;
  }
  const rawBody = await readRawBody(request);
  const verification = verifyCameraIngestSignature({
    rawBody,
    timestamp: request.headers["x-sandfest-timestamp"],
    signature: request.headers["x-sandfest-signature"],
    keyId: request.headers["x-sandfest-camera-key-id"],
    cameraId
  }, { config });
  if (!verification.verified) {
    sendJson(request, response, 401, { error: "Camera ingest authentication failed." });
    return null;
  }
  try {
    const body = JSON.parse(rawBody);
    if (SANDFEST_ENV === "production") {
      const modelVerification = verifyCameraModelPayload(body, cameraModelApproval());
      if (!modelVerification.verified) {
        sendJson(request, response, 409, {
          error: "Camera model is not approved for production ingestion.",
          reason: modelVerification.reason
        });
        return null;
      }
      return { body, verification, modelVerification };
    }
    return { body, verification, modelVerification: null };
  } catch {
    sendJson(request, response, 400, { error: `Camera ${label} body must be valid JSON.` });
    return null;
  }
}

async function readBufferBody(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > maxBytes) {
    const err = new Error(`Request body exceeds ${maxBytes} bytes.`);
    err.statusCode = 413;
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      const err = new Error(`Request body exceeds ${maxBytes} bytes.`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function filterPatch(input, allowedFields) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => allowedFields.has(key))
  );
}

function updateById(items, id, patch) {
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], ...patch };
  return items[index];
}

function alertIsActive(alert) {
  if (!alert?.active) return false;
  if (!alert.expiresAt) return true;
  const expiresAt = Date.parse(alert.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function publicAlertPayload(alert) {
  const active = alertIsActive(alert);
  return {
    id: alert.id,
    active,
    severity: active ? alert.severity : "clear",
    title: active ? alert.title : "",
    message: active ? alert.message : "",
    audience: alert.audience ?? ["public"],
    updatedAt: alert.updatedAt,
    expiresAt: alert.expiresAt ?? null
  };
}

function sanitizeAlertPatch(input, current) {
  const next = { ...current };
  if (Object.hasOwn(input, "active")) next.active = Boolean(input.active);
  if (Object.hasOwn(input, "severity")) {
    if (!alertSeverities.has(input.severity)) {
      return { error: `Invalid alert severity: ${input.severity}` };
    }
    next.severity = input.severity;
  }
  if (Object.hasOwn(input, "title")) next.title = String(input.title ?? "").trim().slice(0, 120);
  if (Object.hasOwn(input, "message")) next.message = String(input.message ?? "").trim().slice(0, 600);
  if (Object.hasOwn(input, "audience")) {
    next.audience = Array.isArray(input.audience)
      ? input.audience.map(item => String(item).trim()).filter(Boolean).slice(0, 8)
      : ["public"];
  }
  if (Object.hasOwn(input, "expiresAt")) {
    if (input.expiresAt === null || input.expiresAt === "") {
      next.expiresAt = null;
    } else {
      const expiresAt = Date.parse(input.expiresAt);
      if (!Number.isFinite(expiresAt)) return { error: "Alert expiresAt must be an ISO date or null." };
      next.expiresAt = new Date(expiresAt).toISOString();
    }
  }
  if (next.active && (!next.title || !next.message)) {
    return { error: "Active alerts require a title and message." };
  }
  if (next.severity === "clear") next.active = false;
  next.id = next.active ? `alert_${randomUUID()}` : current.id || "alert_none";
  next.updatedAt = new Date().toISOString();
  next.source = "admin";
  return { alert: next };
}

function adminActor(request) {
  const session = request.adminSession;
  return {
    id: session?.id ?? "unknown",
    role: session?.role ?? "unknown",
    permissions: session?.permissions ?? [],
    type: session?.auth ?? "bearer-token",
    issuer: session?.issuer ?? null,
    tokenId: session?.tokenId ?? null,
    ip: request.socket.remoteAddress ?? null,
    userAgent: String(request.headers["user-agent"] || "").slice(0, 500) || null
  };
}

async function writeAuditRecord(request, action, target, before, after, metadata = {}) {
  const id = `audit_${randomUUID()}`;
  const record = {
    id,
    eventId: CURRENT_EVENT_ID,
    action,
    target,
    actor: adminActor(request),
    requestId: request.requestId ?? null,
    before: redactAuditValue(before),
    after: redactAuditValue(after),
    metadata: redactAuditValue(metadata),
    createdAt: new Date().toISOString()
  };
  await storage.audit.write(record);
  return record;
}

async function writeIncidentTransitionAudit(request, cameraId, kind, result) {
  if (!result?.incident || !["opened", "escalated", "reopened", "monitoring"].includes(result.action)) return;
  await writeAuditRecord(
    request,
    `conditions.incident.${result.action}`,
    { type: "conditions_incident", id: result.incident.id },
    null,
    result.incident,
    { automated: true, cameraId, signalKind: kind }
  );
}

async function writeConfigSnapshot(request, target, data, reason) {
  const id = `snap_${randomUUID()}`;
  const record = {
    id,
    eventId: CURRENT_EVENT_ID,
    target,
    reason,
    actor: adminActor(request),
    requestId: request.requestId ?? null,
    data,
    createdAt: new Date().toISOString()
  };
  await storage.snapshots.write(record);
  return record;
}

function snapshotTargetKey(target) {
  switch (target?.type) {
  case "alert":
    return "emergency-alert";
  case "ticketCatalog":
    return "ticket-products";
  case "adminConfig":
    return "admin-config";
  case "appBootstrap":
    return "app-bootstrap";
  default:
    return null;
  }
}

function validateCheckoutItems(products, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Cart must include at least one line item." };
  }
  if (items.length > 20) return { error: "Cart cannot include more than 20 distinct ticket products." };

  const lines = [];
  const seenProductIds = new Set();
  for (const item of items) {
    const product = products.find(entry => entry.id === item.productId);
    const quantity = Number(item.quantity);
    if (!product) return { error: `Unknown ticket product: ${item.productId}` };
    if (seenProductIds.has(product.id)) return { error: `${product.name} appears more than once in the cart.` };
    seenProductIds.add(product.id);
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `Invalid quantity for ${product.name}.` };
    if (product.active === false) return { error: `${product.name} is not currently active.` };
    if (quantity < (product.quantity?.min ?? 1)) return { error: `${product.name} is below the minimum quantity.` };
    if (quantity > (product.quantity?.max ?? 12)) return { error: `${product.name} exceeds the maximum quantity.` };
    if (product.requiresReview) return { error: `${product.name} requires admin review before checkout.` };
    if (!/^price_[A-Za-z0-9_]+$/.test(product.stripePriceId || "") || product.stripePriceId.startsWith("price_replace")) {
      return { error: `${product.name} needs a real Stripe Price ID before checkout.` };
    }
    if (!Number.isInteger(product.unitAmount) || product.unitAmount < 1) {
      return { error: `${product.name} needs a trusted unit amount before checkout.` };
    }
    lines.push({
      productId: product.id,
      name: product.name,
      quantity,
      stripePriceId: product.stripePriceId,
      unitAmount: product.unitAmount,
      fulfillment: product.fulfillment
    });
  }

  return { lines };
}

function ticketCheckoutIdempotency(request, body = {}) {
  const header = Array.isArray(request.headers["idempotency-key"])
    ? request.headers["idempotency-key"][0]
    : request.headers["idempotency-key"];
  const key = String(header || "").trim();
  if (key.length < 16 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return { ok: false, error: "Idempotency-Key must be 16 to 200 URL-safe characters." };
  }
  const canonical = {
    items: (Array.isArray(body.items) ? body.items : []).map(item => ({
      productId: String(item?.productId || "").trim(),
      quantity: Number(item?.quantity)
    })).sort((a, b) => a.productId.localeCompare(b.productId)),
    customer: {
      email: String(body.customer?.email ?? body.email ?? "").trim().toLowerCase(),
      phone: String(body.customer?.phone ?? body.phone ?? "").trim()
    },
    consent: {
      emailMarketing: body.consent?.emailMarketing === true,
      smsMarketing: body.consent?.smsMarketing === true,
      smsSafety: body.consent?.smsSafety === true
    }
  };
  const hash = value => createHash("sha256").update(value).digest("hex");
  const idempotencyKeyHash = hash(key);
  return {
    ok: true,
    key,
    idempotencyKeyHash,
    idempotencyFingerprint: hash(JSON.stringify(canonical)),
    orderId: `order_${idempotencyKeyHash.slice(0, 32)}`
  };
}

function publicTicketOrder(order) {
  return {
    id: order.id,
    status: order.status,
    lineItems: order.lineItems.map(line => ({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity
    })),
    totals: order.totals,
    consent: order.consent,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function stripeReady() {
  return STRIPE_ENABLED
    && STRIPE_SECRET_KEY.startsWith("sk_")
    && STRIPE_WEBHOOK_SECRET.startsWith("whsec_")
    && STRIPE_SUCCESS_URL.startsWith("https://")
    && STRIPE_CANCEL_URL.startsWith("https://")
    && (SANDFEST_ENV !== "production" || STRIPE_API_BASE_URL === "https://api.stripe.com");
}

async function createStripeCheckoutSession(lines, order, idempotencyKeyHash) {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", STRIPE_SUCCESS_URL);
  body.set("cancel_url", STRIPE_CANCEL_URL);
  body.set("client_reference_id", order.id);
  body.set("metadata[event_id]", CURRENT_EVENT_ID);
  body.set("metadata[order_id]", order.id);
  body.set("payment_intent_data[metadata][event_id]", CURRENT_EVENT_ID);
  body.set("payment_intent_data[metadata][order_id]", order.id);
  if (order.customer.email) body.set("customer_email", order.customer.email);
  if (order.customer.phone) body.set("phone_number_collection[enabled]", "true");
  lines.forEach((line, index) => {
    body.set(`line_items[${index}][price]`, line.stripePriceId);
    body.set(`line_items[${index}][quantity]`, String(line.quantity));
  });

  const response = await fetch(`${STRIPE_API_BASE_URL}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "idempotency-key": `sandfest-ticket-${idempotencyKeyHash}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "Stripe Checkout Session creation failed.");
  }
  if (!/^cs_[A-Za-z0-9_]+$/.test(data.id || "") || !/^https:\/\/checkout\.stripe\.com\//.test(data.url || "")) {
    throw new Error("Stripe returned an invalid Checkout Session.");
  }
  return data;
}

async function handleCreateCheckoutSession(request, response) {
  const body = await readBody(request);
  const idempotency = ticketCheckoutIdempotency(request, body);
  if (!idempotency.ok) {
    sendJson(request, response, 400, { error: idempotency.error });
    return;
  }
  const tickets = await storage.config.read("ticket-products");
  const validation = validateCheckoutItems(tickets.products, body.items);
  if (validation.error) {
    sendJson(request, response, 400, { error: validation.error });
    return;
  }

  // Consent is optional, but if any box is checked we require contact fields.
  const consentCheck = validateCheckoutConsent(body);
  if (consentCheck.error) {
    sendJson(request, response, 400, { error: consentCheck.error });
    return;
  }

  const existingEnvelope = await storage.orders.findByIdempotencyKeyHash(idempotency.idempotencyKeyHash);
  const existing = existingEnvelope?.record || null;
  if (existing && existing.idempotencyFingerprint !== idempotency.idempotencyFingerprint) {
    sendJson(request, response, 409, { error: "Idempotency-Key was already used for a different ticket order." });
    return;
  }
  if (existing?.stripeCheckoutSessionId && existing?.checkoutUrl) {
    sendJson(request, response, 200, {
      ok: true,
      duplicate: true,
      orderId: existing.id,
      checkoutSessionId: existing.stripeCheckoutSessionId,
      checkoutUrl: existing.checkoutUrl
    });
    return;
  }
  if (existing && ["paid", "partially_refunded", "refunded"].includes(existing.status)) {
    sendJson(request, response, 409, { error: "This ticket order has already been processed." });
    return;
  }

  const orderId = idempotency.orderId;
  const now = new Date().toISOString();
  const consentRecord = consentFromCheckout(body, {
    orderId,
    eventId: CURRENT_EVENT_ID,
    idFactory: () => `consent_${idempotency.idempotencyKeyHash.slice(0, 32)}`,
    now
  });
  // Only persist a consent row when the buyer left any contact + opt-in signal
  // (or contact alone for fulfillment). Always attach the shape to the order.
  const hasContact = Boolean(consentRecord.email || consentRecord.phone);
  const hasOptIn = consentRecord.emailMarketing.optedIn
    || consentRecord.smsMarketing.optedIn
    || consentRecord.smsSafety.optedIn;
  if (hasContact && hasOptIn) {
    await appendConsentRecord(consentRecord);
  }

  const order = {
    id: orderId,
    eventId: CURRENT_EVENT_ID,
    status: stripeReady() ? "creating_checkout_session" : "checkout_not_configured",
    provider: "stripe",
    idempotencyKeyHash: idempotency.idempotencyKeyHash,
    idempotencyFingerprint: idempotency.idempotencyFingerprint,
    lineItems: validation.lines,
    customer: {
      email: consentRecord.email ?? body.customer?.email ?? null,
      phone: consentRecord.phone ?? body.customer?.phone ?? null
    },
    consent: {
      emailMarketing: consentRecord.emailMarketing.optedIn,
      smsMarketing: consentRecord.smsMarketing.optedIn,
      smsSafety: consentRecord.smsSafety.optedIn,
      consentId: hasContact && hasOptIn ? consentRecord.id : null
    },
    totals: {
      knownAmount: validation.lines.reduce((sum, line) => sum + (line.unitAmount ?? 0) * line.quantity, 0),
      currency: tickets.currency ?? "usd"
    },
    createdAt: now,
    updatedAt: now
  };

  await storage.orders.write(order, { prefix: "ticket-order" });

  if (!stripeReady()) {
    await storage.orders.write(order, { prefix: "ticket-order" });
    sendJson(request, response, 202, {
      ok: false,
      code: "stripe_not_configured",
      message: "Stripe checkout is validated but not enabled. Add sandbox keys, real Stripe Price IDs, and STRIPE_TICKETING_ENABLED=true.",
      order: publicTicketOrder(order)
    });
    return;
  }

  try {
    const session = await createStripeCheckoutSession(validation.lines, order, idempotency.idempotencyKeyHash);
    order.status = "checkout_session_created";
    order.stripeCheckoutSessionId = session.id;
    order.checkoutUrl = session.url;
    order.updatedAt = new Date().toISOString();
    await storage.orders.write(order, { prefix: "ticket-order" });
    sendJson(request, response, 200, {
      ok: true,
      duplicate: false,
      orderId,
      checkoutSessionId: session.id,
      checkoutUrl: session.url
    });
  } catch (error) {
    order.status = "checkout_session_failed";
    order.error = error.message;
    order.updatedAt = new Date().toISOString();
    await storage.orders.write(order, { prefix: "ticket-order" });
    sendJson(request, response, 502, { error: error.message, orderId });
  }
}

async function createFulfillmentRecords(order, eventRecord, object) {
  const records = [];
  for (const line of order.lineItems) {
    const quantity = Math.max(1, Number(line.quantity) || 1);
    for (let index = 1; index <= quantity; index += 1) {
      const stableKey = `${order.id}:${eventRecord.checkoutSessionId}:${line.productId}:${index}`;
      const id = `ful_${createHash("sha256").update(stableKey).digest("hex").slice(0, 32)}`;
      const record = {
        id,
        orderId: order.id,
        eventId: order.eventId,
        checkoutSessionId: eventRecord.checkoutSessionId,
        paymentIntentId: eventRecord.paymentIntentId,
        productId: line.productId,
        name: line.name,
        fulfillmentType: line.fulfillment || "manual_review",
        status: line.fulfillment === "sponsor_crm" || line.fulfillment === "raffle_ticket_registry" ? "needs_review" : "queued",
        holder: {
          email: order.customer?.email ?? object.customer_details?.email ?? object.customer_email ?? null,
          name: object.customer_details?.name ?? null
        },
        sourceEventId: eventRecord.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notes: []
      };
      await storage.fulfillment.write(record);
      records.push(record);
    }
  }
  return records;
}

function isFulfillmentEvent(type) {
  return ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(type);
}

const TICKET_ORDER_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded"
]);

function stripeObjectSummary(object = {}) {
  return {
    id: typeof object.id === "string" ? object.id : null,
    status: typeof object.status === "string" ? object.status : null,
    paymentStatus: typeof object.payment_status === "string" ? object.payment_status : null,
    amountTotal: Number.isInteger(object.amount_total) ? object.amount_total : null,
    amountRefunded: Number.isInteger(object.amount_refunded) ? object.amount_refunded : null,
    currency: typeof object.currency === "string" ? object.currency.toLowerCase() : null
  };
}

async function locateTicketOrder(event) {
  const object = event.data?.object || {};
  const metadataOrderId = String(object.metadata?.order_id || object.client_reference_id || "").trim();
  const checkoutSessionId = event.type?.startsWith("checkout.session") ? String(object.id || "") : "";
  const paymentIntentId = typeof object.payment_intent === "string"
    ? object.payment_intent
    : event.type?.startsWith("payment_intent.")
      ? String(object.id || "")
      : "";
  const [byId, bySession, byPaymentIntent] = await Promise.all([
    metadataOrderId ? storage.orders.findById(metadataOrderId) : null,
    checkoutSessionId ? storage.orders.findByCheckoutSession(checkoutSessionId) : null,
    paymentIntentId ? storage.orders.findByPaymentIntent(paymentIntentId) : null
  ]);
  const envelopes = [byId, bySession, byPaymentIntent].filter(Boolean);
  const orderIds = new Set(envelopes.map(item => item.record.id));
  if (orderIds.size > 1) {
    return { order: null, object, error: "Stripe event identifiers resolve to different ticket orders." };
  }
  return {
    order: envelopes[0]?.record || null,
    object,
    checkoutSessionId,
    paymentIntentId,
    metadataOrderId,
    error: null
  };
}

function ticketOrderEventMismatch(order, event, located) {
  const object = located.object;
  if (!order) return "No stored ticket order matches the Stripe event.";
  if (order.eventId !== CURRENT_EVENT_ID) return "Stripe event resolved to a ticket order from another event.";
  if (located.metadataOrderId && located.metadataOrderId !== order.id) return "Stripe order metadata does not match the stored ticket order.";
  if (located.checkoutSessionId && located.checkoutSessionId !== order.stripeCheckoutSessionId) return "Stripe Checkout Session does not match the stored ticket order.";
  if (object.metadata?.event_id && object.metadata.event_id !== order.eventId) return "Stripe event metadata does not match the ticket order event.";
  if (event.type === "charge.refunded" && located.paymentIntentId && located.paymentIntentId !== order.paymentIntentId) return "Stripe refund does not match the ticket order payment.";
  return null;
}

async function reconcileTicketStripeEvent(event, eventRecord) {
  if (!TICKET_ORDER_EVENT_TYPES.has(event.type)) return { status: "not_required", fulfillmentRecordIds: [] };
  const located = await locateTicketOrder(event);
  const mismatch = located.error || ticketOrderEventMismatch(located.order, event, located);
  if (mismatch) {
    return { status: "order_not_matched", error: mismatch, fulfillmentRecordIds: [] };
  }
  const order = located.order;
  const object = located.object;
  const now = new Date().toISOString();

  if (isFulfillmentEvent(event.type)) {
    const expectedAmount = Number(order.totals?.knownAmount);
    const amountTotal = Number(object.amount_total);
    const currency = String(object.currency || "").toLowerCase();
    if (!Number.isInteger(expectedAmount) || amountTotal !== expectedAmount || currency !== String(order.totals?.currency || "").toLowerCase()) {
      const reviewOrder = {
        ...order,
        status: "payment_review_required",
        paymentIntentId: located.paymentIntentId || order.paymentIntentId || null,
        lastPaymentEventId: eventRecord.id,
        lastError: "Stripe amount or currency did not match the stored ticket order.",
        updatedAt: now
      };
      await storage.orders.write(reviewOrder, { prefix: "ticket-order" });
      return { status: "order_mismatch", order: reviewOrder, error: reviewOrder.lastError, fulfillmentRecordIds: [] };
    }
    const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required" || event.type === "checkout.session.async_payment_succeeded";
    if (!paid) {
      const awaitingOrder = {
        ...order,
        status: "awaiting_async_payment",
        paymentIntentId: located.paymentIntentId || order.paymentIntentId || null,
        lastPaymentEventId: eventRecord.id,
        updatedAt: now
      };
      await storage.orders.write(awaitingOrder, { prefix: "ticket-order" });
      return { status: "awaiting_payment", order: awaitingOrder, fulfillmentRecordIds: [] };
    }
    const existingFulfillment = await storage.fulfillment.findByCheckoutSession(order.stripeCheckoutSessionId);
    const fulfillmentRecords = existingFulfillment.length
      ? existingFulfillment.map(item => item.record)
      : await createFulfillmentRecords(order, eventRecord, object);
    const paidOrder = {
      ...order,
      status: "paid",
      paymentIntentId: located.paymentIntentId || order.paymentIntentId || null,
      paidAt: order.paidAt || now,
      lastPaymentEventId: eventRecord.id,
      fulfillmentRecordIds: fulfillmentRecords.map(item => item.id),
      lastError: null,
      updatedAt: now
    };
    await storage.orders.write(paidOrder, { prefix: "ticket-order" });
    return {
      status: existingFulfillment.length ? "already_fulfilled" : "fulfilled",
      order: paidOrder,
      fulfillmentRecordIds: paidOrder.fulfillmentRecordIds
    };
  }

  if (["checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.payment_failed"].includes(event.type)) {
    const failedOrder = {
      ...order,
      status: event.type === "checkout.session.expired" ? "checkout_expired" : "payment_failed",
      paymentIntentId: located.paymentIntentId || order.paymentIntentId || null,
      lastPaymentEventId: eventRecord.id,
      lastError: String(object.last_payment_error?.message || "Stripe reported that ticket payment did not complete.").slice(0, 500),
      updatedAt: now
    };
    await storage.orders.write(failedOrder, { prefix: "ticket-order" });
    return { status: failedOrder.status, order: failedOrder, fulfillmentRecordIds: [] };
  }

  if (event.type === "charge.refunded") {
    const amountRefunded = Number(object.amount_refunded);
    const expectedAmount = Number(order.totals?.knownAmount);
    const currency = String(object.currency || "").toLowerCase();
    if (!Number.isInteger(amountRefunded) || amountRefunded < 1 || amountRefunded > expectedAmount || currency !== String(order.totals?.currency || "").toLowerCase()) {
      const reviewOrder = {
        ...order,
        status: "refund_review_required",
        lastPaymentEventId: eventRecord.id,
        lastError: "Stripe refund amount or currency did not match the stored ticket order.",
        updatedAt: now
      };
      await storage.orders.write(reviewOrder, { prefix: "ticket-order" });
      return { status: "refund_mismatch", order: reviewOrder, error: reviewOrder.lastError, fulfillmentRecordIds: order.fulfillmentRecordIds || [] };
    }
    const fullRefund = amountRefunded === expectedAmount;
    const fulfillment = await storage.fulfillment.findByCheckoutSession(order.stripeCheckoutSessionId);
    for (const item of fulfillment) {
      await storage.fulfillment.update({
        ...item.record,
        status: fullRefund ? "refunded" : "needs_review",
        updatedAt: now,
        notes: [...(item.record.notes || []), {
          at: now,
          text: fullRefund ? "Stripe reported a full ticket-order refund." : "Stripe reported a partial ticket-order refund; allocation requires review."
        }]
      });
    }
    const refundedOrder = {
      ...order,
      status: fullRefund ? "refunded" : "partially_refunded",
      refundedAmountCents: amountRefunded,
      refundedAt: fullRefund ? now : order.refundedAt || null,
      lastPaymentEventId: eventRecord.id,
      lastError: null,
      updatedAt: now
    };
    await storage.orders.write(refundedOrder, { prefix: "ticket-order" });
    return {
      status: refundedOrder.status,
      order: refundedOrder,
      fulfillmentRecordIds: fulfillment.map(item => item.record.id)
    };
  }

  return { status: "not_required", fulfillmentRecordIds: [] };
}

function verifyStripeSignature(rawBody, signatureHeader, nowMs = Date.now()) {
  if (!STRIPE_WEBHOOK_SECRET) return { verified: false, reason: "webhook_secret_not_configured" };
  if (!signatureHeader) return { verified: false, reason: "missing_signature" };
  const parts = signatureHeader.split(",").map(part => part.trim().split("=")).filter(([key, value]) => key && value);
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!/^\d+$/.test(timestamp || "") || signatures.length === 0) return { verified: false, reason: "malformed_signature" };
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - Number(timestamp));
  if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) return { verified: false, reason: "timestamp_outside_tolerance", ageSeconds };
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const verified = signatures.some(signature => {
    const receivedBuffer = Buffer.from(signature);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  });
  return { verified, reason: verified ? "ok" : "signature_mismatch", ageSeconds };
}

async function reconcilePartnerStripeEvent(event, context) {
  if (!context) return null;
  const now = new Date().toISOString();
  const commonOptions = {
    actorId: "stripe-webhook",
    idFactory: prefix => `${prefix}_${randomUUID()}`,
    now
  };
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return mutatePartnerOperations(doc => reconcilePartnerStripePayment(doc, {
      ...context,
      paymentStatus: event.type === "checkout.session.async_payment_succeeded" ? "paid" : context.paymentStatus,
      receivedAt: now
    }, commonOptions));
  }
  if (["checkout.session.expired", "checkout.session.async_payment_failed", "payment_intent.payment_failed"].includes(event.type)) {
    return mutatePartnerOperations(doc => updatePartnerStripeCheckoutState(doc, {
      ...context,
      status: event.type === "checkout.session.expired" ? "expired" : "failed",
      error: context.failureMessage
    }, commonOptions));
  }
  if (event.type === "charge.refunded") {
    return mutatePartnerOperations(doc => reconcilePartnerStripeRefund(doc, {
      ...context,
      reason: "Stripe charge refund"
    }, commonOptions));
  }
  return null;
}

function twilioIntegrationSession(kind) {
  return {
    id: `twilio-${kind}`,
    role: "integration",
    permissions: [],
    auth: "webhook",
    issuer: "twilio",
    tokenId: null
  };
}

async function handleTwilioStatusWebhook(request, response, url) {
  const config = smsConfigFromEnv(process.env);
  if (!config.authToken || !config.statusCallbackUrl) {
    sendJson(request, response, 503, { error: "Twilio status callback verification is not configured." });
    return;
  }
  const rawBody = await readRawBody(request);
  const params = parseTwilioForm(rawBody);
  const validationUrl = twilioValidationUrl(config.statusCallbackUrl, request.url);
  const verified = verifyTwilioFormRequest({
    signature: request.headers["x-twilio-signature"],
    url: validationUrl,
    params
  }, { config });
  if (!verified) {
    sendJson(request, response, 401, { error: "Twilio webhook signature verification failed." });
    return;
  }

  const result = await mutateSmsOperations(doc => recordSmsStatusCallback(doc, {
    messageId: url.searchParams.get("message"),
    providerMessageSid: params.MessageSid,
    status: params.MessageStatus,
    errorCode: params.ErrorCode,
    error: params.ErrorMessage
  }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID }));
  request.adminSession = twilioIntegrationSession("status");
  await writeAuditRecord(request, "sms.delivery.webhook", {
    type: "smsDeliveryWebhook",
    id: url.searchParams.get("campaign") || "twilio"
  }, null, null, {
    matched: result?.ok === true,
    duplicate: result?.duplicate === true,
    ignoredRegression: result?.ignoredRegression === true,
    status: String(params.MessageStatus || "unknown").slice(0, 30)
  });
  // A verified but unmatched callback is acknowledged so Twilio does not retry
  // indefinitely; the aggregate audit event remains available for review.
  sendTwiml(request, response);
}

async function handleTwilioPreferenceWebhook(request, response, channel) {
  const config = smsConfigFromEnv(process.env);
  const configuredUrl = channel === "smsSafety"
    ? config.safetyInboundWebhookUrl
    : config.marketingInboundWebhookUrl;
  if (!config.authToken || !configuredUrl) {
    sendJson(request, response, 503, { error: "Twilio inbound webhook verification is not configured for this channel." });
    return;
  }
  const rawBody = await readRawBody(request);
  const params = parseTwilioForm(rawBody);
  const validationUrl = twilioValidationUrl(configuredUrl, request.url);
  const verified = verifyTwilioFormRequest({
    signature: request.headers["x-twilio-signature"],
    url: validationUrl,
    params
  }, { config });
  if (!verified) {
    sendJson(request, response, 401, { error: "Twilio webhook signature verification failed." });
    return;
  }

  const action = smsPreferenceAction(params.OptOutType, params.Body);
  if (!action) {
    sendTwiml(request, response);
    return;
  }
  const recipientHash = smsRecipientHash(CURRENT_EVENT_ID, params.From);
  const preview = recordSmsPreferenceEvent(await readSmsOperations(), {
    providerMessageSid: params.MessageSid,
    channel,
    action,
    recipientHash
  }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID });
  let consentResult = { ok: true, action, changed: 0 };
  if (!preview.duplicate) {
    const now = new Date().toISOString();
    await updatePlatformDoc(ROOT, "consent", current => {
      consentResult = applySmsConsentKeyword(current, {
        channel,
        phone: params.From,
        optOutType: params.OptOutType,
        body: params.Body,
        eventId: CURRENT_EVENT_ID
      }, {
        now,
        idFactory: prefix => `${prefix}_${randomUUID()}`
      });
      return consentResult.ok ? consentResult.doc : current;
    }, { fallback: { eventId: CURRENT_EVENT_ID, lastUpdated: null, records: [] } });
    if (consentResult.ok) {
      await mutateSmsOperations(doc => recordSmsPreferenceEvent(doc, {
        providerMessageSid: params.MessageSid,
        channel,
        action,
        recipientHash
      }, { now, eventId: CURRENT_EVENT_ID }));
    }
  }

  request.adminSession = twilioIntegrationSession("preference");
  await writeAuditRecord(request, "sms.preference.webhook", {
    type: "smsPreferenceWebhook",
    id: channel
  }, null, null, {
    action,
    channel,
    duplicate: preview.duplicate === true,
    changed: consentResult.changed || 0,
    accepted: consentResult.ok === true
  });
  // Twilio Advanced Opt-Out supplies the confirmation, so the application
  // intentionally returns empty TwiML instead of sending a duplicate reply.
  sendTwiml(request, response);
}

async function handleStripeWebhook(request, response) {
  const rawBody = await readRawBody(request);
  const signature = request.headers["stripe-signature"];
  const verification = verifyStripeSignature(rawBody, signature);
  if (!STRIPE_WEBHOOK_SECRET) {
    sendJson(request, response, 503, { error: "Stripe webhook verification is not configured." });
    return;
  }
  if (!verification.verified) {
    sendJson(request, response, 400, { error: `Invalid Stripe webhook signature: ${verification.reason}` });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody || "{}");
  } catch {
    sendJson(request, response, 400, { error: "Stripe webhook body must be valid JSON." });
    return;
  }
  if (!/^evt_[A-Za-z0-9_]+$/.test(event.id || "")) {
    sendJson(request, response, 400, { error: "Stripe webhook event ID is invalid." });
    return;
  }
  if (STRIPE_SECRET_KEY.startsWith("sk_live_") && event.livemode !== true) {
    sendJson(request, response, 400, { error: "Live Stripe configuration rejected a test-mode event." });
    return;
  }
  const eventId = event.id;
  const existingEvent = await storage.paymentEvents.findById(eventId);
  if (existingEvent) {
    sendJson(request, response, 200, {
      received: true,
      duplicate: true,
      record: existingEvent.record
    });
    return;
  }

  const partnerContext = stripePartnerEventContext(event);
  const partnerFlow = Boolean(partnerContext?.checkoutId);
  const partnerResult = await reconcilePartnerStripeEvent(event, partnerContext);
  const object = event.data?.object || {};
  const record = {
    id: eventId,
    provider: "stripe",
    type: event.type ?? "unknown",
    verified: verification.verified,
    verificationReason: verification.reason,
    receivedAt: new Date().toISOString(),
    objectId: object.id ?? null,
    checkoutSessionId: event.type?.startsWith("checkout.session") ? object.id ?? null : null,
    paymentIntentId: typeof object.payment_intent === "string"
      ? object.payment_intent
      : event.type?.startsWith("payment_intent.") ? object.id ?? null : null,
    fulfillmentStatus: "not_required",
    objectSummary: stripeObjectSummary(object),
    partnerReconciliation: partnerResult
      ? {
        status: partnerResult.ok && partnerResult.reconciled !== false
          ? (partnerResult.duplicate ? "duplicate" : "reconciled")
          : partnerResult.ok ? "review_required" : "not_matched",
        checkoutId: partnerResult.checkout?.id ?? partnerContext?.checkoutId ?? null,
        applicationId: partnerResult.checkout?.applicationId ?? partnerContext?.applicationId ?? null,
        invoiceId: partnerResult.checkout?.invoiceId ?? partnerContext?.invoiceId ?? null,
        paymentId: partnerResult.payment?.id ?? null,
        error: partnerResult.error ?? null
      }
      : null,
    ticketReconciliation: null
  };

  if (!partnerFlow) {
    const ticketResult = await reconcileTicketStripeEvent(event, record);
    record.fulfillmentStatus = ticketResult.status;
    record.fulfillmentRecordIds = ticketResult.fulfillmentRecordIds || [];
    record.ticketReconciliation = {
      status: ticketResult.status,
      orderId: ticketResult.order?.id || null,
      error: ticketResult.error || null
    };
  } else {
    record.fulfillmentRecordIds = [];
  }

  await storage.paymentEvents.write(record);
  if (partnerResult?.ok && partnerResult.payment && !partnerResult.duplicate) {
    await writeAuditRecord(request, event.type === "charge.refunded" ? "partner.payment.stripe_refund" : "partner.payment.stripe_reconcile", {
      type: "payment",
      id: partnerResult.payment.id
    }, null, partnerResult.payment, {
      providerEventId: eventId,
      checkoutId: partnerResult.checkout?.id ?? null,
      invoiceId: partnerResult.payment.invoiceId,
      duplicate: partnerResult.duplicate === true
    });
  }
  sendJson(request, response, 200, { received: true, duplicate: false, record });
}

async function handleFulfillmentPatch(request, response, fulfillmentId) {
  if (!(await requirePermission(request, response, "fulfillment:update"))) return;
  const body = await readBody(request);
  const status = body.status;
  if (!fulfillmentStatuses.has(status)) {
    sendJson(request, response, 400, { error: `Invalid fulfillment status: ${status}` });
    return;
  }
  const found = await storage.fulfillment.findById(fulfillmentId);
  if (!found) {
    sendJson(request, response, 404, { error: `Fulfillment record not found: ${fulfillmentId}` });
    return;
  }
  const record = {
    ...found.record,
    status,
    updatedAt: new Date().toISOString(),
    notes: [
      ...(found.record.notes ?? []),
      ...(body.note ? [{ at: new Date().toISOString(), text: body.note }] : [])
    ]
  };
  await storage.fulfillment.update(record);
  await writeAuditRecord(request, "fulfillment.status.update", {
    type: "fulfillment",
    id: fulfillmentId
  }, {
    status: found.record.status,
    notes: found.record.notes ?? []
  }, {
    status: record.status,
    notes: record.notes
  }, {
    storagePath: found.path
  });
  sendJson(request, response, 200, { fulfillment: record });
}

async function handleAdminTicketPatch(request, response, productId) {
  if (!(await requirePermission(request, response, "ticket:write"))) return;
  const patch = filterPatch(await readBody(request), patchableTicketFields);
  const tickets = await storage.config.read("ticket-products");
  const before = tickets.products.find(item => item.id === productId);
  const product = updateById(tickets.products, productId, patch);
  if (!product) {
    sendJson(request, response, 404, { error: `Ticket product not found: ${productId}` });
    return;
  }
  tickets.lastUpdated = new Date().toISOString();
  await writeConfigSnapshot(request, { type: "ticketCatalog", id: "ticket-products" }, {
    ...tickets,
    products: tickets.products.map(item => item.id === productId ? before : item)
  }, `Before ticket update: ${productId}`);
  await storage.config.write("ticket-products", tickets);
  await writeAuditRecord(request, "ticket.update", {
    type: "ticket",
    id: productId
  }, before, product, {
    changedFields: Object.keys(patch)
  });
  sendJson(request, response, 200, { product, lastUpdated: tickets.lastUpdated });
}

async function handleAdminSponsorPatch(request, response, sponsorId) {
  if (!(await requirePermission(request, response, "sponsor:write"))) return;
  const patch = filterPatch(await readBody(request), patchableSponsorFields);
  let result;
  await storage.config.update("admin-config", async config => {
    result = updateSponsorPackageConfig(config, sponsorId, patch);
    if (!result.ok) return undefined;
    result.config.lastUpdated = new Date().toISOString();
    await writeConfigSnapshot(request, { type: "adminConfig", id: "admin-config" }, config, `Before sponsor package update: ${sponsorId}`);
    return result.config;
  });
  if (!result.ok) {
    sendJson(request, response, result.error === "Sponsor package not found." ? 404 : 400, {
      error: result.error,
      errors: result.errors
    });
    return;
  }
  await writeAuditRecord(request, "sponsor-package.update", {
    type: "sponsorPackage",
    id: sponsorId
  }, result.before, result.sponsorPackage, {
    changedFields: Object.keys(patch)
  });
  sendJson(request, response, 200, {
    sponsorPackage: result.sponsorPackage,
    readiness: {
      ready: result.catalog.ready,
      activePackages: result.catalog.activePackages.length
    },
    lastUpdated: result.config.lastUpdated
  });
}

async function handleAdminSponsorCreate(request, response) {
  if (!(await requirePermission(request, response, "sponsor:write"))) return;
  const input = filterPatch(await readBody(request), creatableSponsorFields);
  let result;
  await storage.config.update("admin-config", async config => {
    result = createSponsorPackageConfig(config, input);
    if (!result.ok) return undefined;
    result.config.lastUpdated = new Date().toISOString();
    await writeConfigSnapshot(request, { type: "adminConfig", id: "admin-config" }, config, `Before sponsor package creation: ${result.sponsorPackage.id}`);
    return result.config;
  });
  if (!result.ok) {
    sendJson(request, response, result.conflict ? 409 : 400, {
      error: result.error,
      errors: result.errors
    });
    return;
  }
  await writeAuditRecord(request, "sponsor-package.create", {
    type: "sponsorPackage",
    id: result.sponsorPackage.id
  }, null, result.sponsorPackage, {
    changedFields: Object.keys(input)
  });
  sendJson(request, response, 201, {
    sponsorPackage: result.sponsorPackage,
    readiness: {
      ready: result.catalog.ready,
      activePackages: result.catalog.activePackages.length
    },
    lastUpdated: result.config.lastUpdated
  });
}

async function handleAdminVendorOfferingPatch(request, response, offeringId) {
  if (!(await requirePermission(request, response, "finance:write"))) return;
  const patch = filterPatch(await readBody(request), patchableVendorOfferingFields);
  let result;
  await storage.config.update("admin-config", async config => {
    result = updateVendorOfferingConfig(config, offeringId, patch);
    if (!result.ok) return undefined;
    result.config.lastUpdated = new Date().toISOString();
    await writeConfigSnapshot(request, { type: "adminConfig", id: "admin-config" }, config, `Before vendor offering update: ${offeringId}`);
    return result.config;
  });
  if (!result.ok) {
    sendJson(request, response, result.error === "Vendor offering not found." ? 404 : 400, {
      error: result.error,
      errors: result.errors
    });
    return;
  }
  await writeAuditRecord(request, "vendor-offering.update", {
    type: "vendorOffering",
    id: offeringId
  }, result.before, result.offering, {
    changedFields: Object.keys(patch)
  });
  sendJson(request, response, 200, {
    vendorOffering: result.offering,
    readiness: {
      ready: result.catalog.ready,
      activeOfferings: result.catalog.activeOfferings.length,
      missingCategories: result.catalog.missingCategories
    },
    lastUpdated: result.config.lastUpdated
  });
}

async function handleAdminVendorOfferingCreate(request, response) {
  if (!(await requirePermission(request, response, "finance:write"))) return;
  const input = filterPatch(await readBody(request), creatableVendorOfferingFields);
  let result;
  await storage.config.update("admin-config", async config => {
    result = createVendorOfferingConfig(config, input);
    if (!result.ok) return undefined;
    result.config.lastUpdated = new Date().toISOString();
    await writeConfigSnapshot(request, { type: "adminConfig", id: "admin-config" }, config, `Before vendor offering creation: ${result.offering.id}`);
    return result.config;
  });
  if (!result.ok) {
    sendJson(request, response, result.conflict ? 409 : 400, {
      error: result.error,
      errors: result.errors
    });
    return;
  }
  await writeAuditRecord(request, "vendor-offering.create", {
    type: "vendorOffering",
    id: result.offering.id
  }, null, result.offering, {
    changedFields: Object.keys(input)
  });
  sendJson(request, response, 201, {
    vendorOffering: result.offering,
    readiness: {
      ready: result.catalog.ready,
      activeOfferings: result.catalog.activeOfferings.length,
      missingCategories: result.catalog.missingCategories
    },
    lastUpdated: result.config.lastUpdated
  });
}

async function handleAdminEventGuidePublish(request, response) {
  const session = await requirePermission(request, response, "content:write");
  if (!session) return;
  const body = await readBody(request);
  if (body.publish !== true) {
    sendJson(request, response, 400, { error: "Confirm publish=true before replacing public event facts." });
    return;
  }
  const bootstrap = await storage.config.read("app-bootstrap");
  const before = bootstrap.guide ?? {};
  const result = publishEventGuide(before, { ...body.guide, id: CURRENT_EVENT_ID }, {
    actorId: session.actorId,
    now: new Date().toISOString()
  });
  if (!result.ok) {
    sendJson(request, response, 400, { error: result.error, errors: result.errors });
    return;
  }
  const updated = { ...bootstrap, guide: result.guide };
  await writeConfigSnapshot(request, { type: "appBootstrap", id: "app-bootstrap" }, bootstrap, "Before public event guide publish");
  await storage.config.write("app-bootstrap", updated);
  await writeAuditRecord(request, "content.event-guide.publish", { type: "eventGuide", id: result.guide.id }, before, result.guide, {
    sourceUrl: result.guide.sourceUrl,
    sourceCheckedAt: result.guide.sourceCheckedAt
  });
  sendJson(request, response, 200, {
    guide: publicEventGuide(result.guide),
    readiness: eventGuideReadiness(result.guide, { maxSourceAgeDays: EVENT_GUIDE_SOURCE_MAX_AGE_DAYS })
  });
}

async function handleRequest(request, response) {
  request.requestId = normalizeRequestId(request.headers["x-request-id"]);
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const rawPathname = url.pathname.replace(/\/+$/, "") || "/";
  const pathname = API_PREFIX && (rawPathname === API_PREFIX || rawPathname.startsWith(`${API_PREFIX}/`))
    ? rawPathname.slice(API_PREFIX.length) || "/"
    : rawPathname;
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (!(await checkRateLimit(request, response, pathname, method))) return;

  try {
    if (method === "GET" && pathname === "/health") {
      const deployment = await deploymentProfile();
      const eventGuideReady = deployment.checks.eventGuide?.ok === true;
      const currentEventReady = deployment.checks.currentEvent?.ok === true;
      sendJson(request, response, 200, {
        ok: true,
        service: "sandfest-admin-api",
        owner: "heyelab",
        environment: deployment.environment,
        deploymentReady: deployment.ok,
        deploymentWarnings: deployment.warnings,
        deploymentErrors: deployment.errors,
        eventGuideReady,
        currentEventId: CURRENT_EVENT_ID,
        currentEventReady,
        adminRole: authModeIsJwt() ? "jwt-claims" : ADMIN_ROLE,
        authMode: authMode(),
        stripeReady: stripeReady(),
        safetySmsReady: smsConfigFromEnv().ready,
        transactionalEmailReady: emailConfigFromEnv().ready && BREVO_WEBHOOK.ready,
        transactionalEmailWebhookReady: BREVO_WEBHOOK.ready,
        quickBooksInvoiceSyncReady: quickBooksReadiness().canSyncPartnerInvoices,
        cameraIngestReady: cameraIngestConfig().ready,
        backupRecoveryReady: recoveryReadiness(process.env).ready,
        partnerPortalReady: partnerPortalConfig().ready,
        publicSiteUrl: partnerPortalConfig().publicBaseUrl,
        documentIngestionReady: deployment.checks.documentIngestion?.ok === true,
        outreachPreferencesReady: OUTREACH_PREFERENCES.ready,
        stripePartnerPaymentsReady: STRIPE_PARTNER_PAYMENTS.ready,
        rateLimitBackend: rateLimiter.kind,
        runtimeDataMode: RUNTIME_ROOT.mode,
        storage: storage.kind === "postgres" ? "postgres" : "local-file-prototype",
        uptimeSeconds: Math.round(process.uptime()),
        time: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && pathname === "/ready") {
      const checks = {
        appBootstrap: true,
        tickets: true,
        adminConfig: true,
        alertConfig: true,
        auditWritable: true,
        snapshotsWritable: true,
        ordersWritable: true,
        storage: storage.kind,
        worker: true,
        queue: true
      };
      try {
        const [, , adminConfig, , , , , worker, queue] = await Promise.all([
          storage.config.read("app-bootstrap"),
          storage.config.read("ticket-products"),
          storage.config.read("admin-config"),
          storage.config.read("emergency-alert"),
          storage.audit.list(1),
          storage.snapshots.list(1),
          storage.orders.list(1),
          readWorkerStatus(),
          getQueueHealth(ROOT)
        ]);
        const vendorCatalog = vendorOfferingCatalog(adminConfig);
        checks.vendorOfferings = vendorCatalog.ready;
        checks.vendorOfferingStatus = {
          activeOfferings: vendorCatalog.activeOfferings.length,
          missingCategories: vendorCatalog.missingCategories,
          errors: vendorCatalog.errors
        };
        checks.worker = SANDFEST_ENV !== "production" || worker.healthy;
        checks.workerStatus = worker;
        checks.queue = SANDFEST_ENV !== "production" || queue.operational;
        checks.queueStatus = queue;
        if (!checks.worker) checks.error = "Background worker heartbeat is missing or stale.";
        if (!checks.queue) checks.error = "Background job queue has expired claims or unhandled terminal failures.";
        if (!checks.vendorOfferings) checks.error = `Vendor offering catalog is not ready. ${vendorCatalog.errors.join(" ")}`;
      } catch (error) {
        checks.error = error.message;
      }
      const deployment = await deploymentProfile();
      checks.deployment = deployment.ok;
      const ok = !checks.error && deployment.ok;
      sendJson(request, response, ok ? 200 : 503, {
        ok,
        service: "sandfest-admin-api",
        checks,
        deployment,
        time: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && pathname === "/api/public/bootstrap") {
      const bootstrap = await storage.config.read("app-bootstrap");
      sendJson(request, response, 200, { ...bootstrap, guide: publicEventGuide(bootstrap.guide) }, publicCacheHeaders(120));
      return;
    }

    if (method === "GET" && pathname === "/api/public/tickets") {
      sendJson(request, response, 200, publicTicketCatalog(
        await storage.config.read("ticket-products"),
        { checkoutEnabled: stripeReady() }
      ), publicCacheHeaders(60));
      return;
    }

    if (method === "GET" && pathname === "/api/public/sponsors") {
      const [config, partners] = await Promise.all([
        storage.config.read("admin-config"),
        readPartnerOperations()
      ]);
      const catalog = sponsorPackageCatalog(config);
      sendJson(request, response, 200, {
        lastUpdated: [config.lastUpdated, partners.lastUpdated].filter(Boolean).sort().at(-1) || null,
        sponsorPackages: catalog.activePackages.map(publicSponsorPackage),
        sponsors: publicSponsorShowcase(partners)
      }, publicCacheHeaders(120));
      return;
    }

    const publicSponsorAssetMatch = pathname.match(/^\/api\/public\/sponsor-showcase\/assets\/([^/]+)$/);
    if (method === "GET" && publicSponsorAssetMatch) {
      const partners = await readPartnerOperations();
      const asset = approvedPublicSponsorAsset(partners, decodeURIComponent(publicSponsorAssetMatch[1]));
      if (!asset) {
        sendJson(request, response, 404, { error: "Sponsor logo not found." });
        return;
      }
      const stored = await readPartnerAssetUpload(ROOT, asset.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: "Sponsor logo not found." });
        return;
      }
      sendBinary(request, response, 200, stored.buffer, {
        contentType: asset.contentType,
        fileName: partnerAssetDownloadName(asset),
        publicAsset: true
      });
      return;
    }

    if (method === "GET" && pathname === "/api/public/vendors") {
      const config = await storage.config.read("admin-config");
      const catalog = vendorOfferingCatalog(config);
      sendJson(request, response, 200, {
        lastUpdated: config.lastUpdated,
        vendorOfferings: catalog.activeOfferings.map(publicVendorOffering)
      }, publicCacheHeaders(120));
      return;
    }

    if (method === "POST" && pathname === "/api/public/sponsor-invitation") {
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = verifySponsorInvitationToken(doc, body.token, { config: SPONSOR_INVITATIONS });
      if (!access.ok) {
        sendJson(request, response, access.expired ? 410 : 404, { error: access.error });
        return;
      }
      const config = await storage.config.read("admin-config");
      const resolvedPackage = resolveSponsorPackage(config, access.invitation.packageId);
      if (!resolvedPackage.ok) {
        sendJson(request, response, 409, { error: "The recommended sponsor package is no longer available. Ask the SandFest team for a new invitation." });
        return;
      }
      const sponsorPackage = resolvedPackage.sponsorPackage;
      let portalAccess = null;
      if (access.converted && access.prospect.convertedApplicationId) {
        const application = doc.applications.find(item => item.id === access.prospect.convertedApplicationId);
        const portalConfig = partnerPortalConfig();
        const portalToken = application ? issuePartnerPortalToken(application, { config: portalConfig }) : null;
        if (application && portalToken) {
          portalAccess = {
            reference: application.reference,
            token: portalToken,
            path: partnerPortalPath(application, portalToken),
            url: partnerPortalUrl(application, portalToken, { config: portalConfig })
          };
        }
      }
      sendJson(request, response, 200, {
        invitation: publicSponsorInvitation(access.prospect, sponsorPackage),
        converted: access.converted === true,
        portalAccess
      });
      return;
    }

    if (method === "GET" && pathname === "/api/public/alert") {
      sendJson(request, response, 200, publicAlertPayload(await storage.config.read("emergency-alert")), publicCacheHeaders(15));
      return;
    }

    // Sculpture Passport — public hunt definition + stamp + progress.
    if (method === "GET" && pathname === "/api/public/passport") {
      const huntDoc = await readPassportHunt();
      sendJson(request, response, 200, {
        lastUpdated: huntDoc.lastUpdated,
        hunt: huntDoc.hunt,
        checkpoints: huntDoc.checkpoints.map(publicCheckpoint)
      }, publicCacheHeaders(60));
      return;
    }

    if (method === "GET" && pathname === "/api/public/passport/progress") {
      const attendeeRef = String(url.searchParams.get("attendeeRef") || "").trim();
      if (!attendeeRef || attendeeRef.length < 4) {
        sendJson(request, response, 400, { error: "Query attendeeRef is required (min 4 chars)." });
        return;
      }
      const huntDoc = await readPassportHunt();
      const completionDoc = await readPassportCompletions(huntDoc.hunt.id);
      sendJson(request, response, 200, {
        progress: progressForAttendee(
          huntDoc.checkpoints,
          completionDoc.completions,
          attendeeRef,
          huntDoc.hunt.id
        )
      }, {
        "cache-control": "no-store"
      });
      return;
    }

    if (method === "POST" && pathname === "/api/public/passport/stamp") {
      const body = await readBody(request);
      const huntDoc = await readPassportHunt();
      const completionDoc = await readPassportCompletions(huntDoc.hunt.id);
      const result = applyStamp({
        hunt: huntDoc.hunt,
        checkpoints: huntDoc.checkpoints,
        completions: completionDoc.completions
      }, body, {
        idFactory: () => `hc_${randomUUID()}`,
        now: new Date().toISOString()
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      if (!result.alreadyStamped) {
        // Append-only path: unique constraint safe under concurrency (Postgres).
        await appendPassportCompletion(ROOT, result.completion);
      }
      const completions = await listPassportCompletions(ROOT, { huntId: huntDoc.hunt.id });
      const progress = progressForAttendee(
        huntDoc.checkpoints,
        completions,
        result.completion.attendeeRef,
        huntDoc.hunt.id
      );
      sendJson(request, response, result.alreadyStamped ? 200 : 201, {
        ok: true,
        alreadyStamped: result.alreadyStamped,
        completion: result.completion,
        checkpoint: result.checkpoint,
        progress
      });
      return;
    }

    // People's Choice voting
    if (method === "GET" && pathname === "/api/public/voting") {
      const doc = await readPeoplesChoice();
      const publication = publicVotingPublication(doc, {
        eventId: CURRENT_EVENT_ID,
        allowSample: BOARD_DEMO_RUNTIME
      });
      const tally = tallyVotes(publication.entries, publication.votes);
      sendJson(request, response, 200, {
        lastUpdated: doc.lastUpdated,
        eventId: doc.eventId,
        votingOpen: publication.votingOpen,
        title: doc.title,
        description: doc.description,
        entries: publication.entries,
        leaderboard: tally.leaderboard,
        totals: { totalVotes: tally.totalVotes, uniqueVoters: tally.uniqueVoters }
      }, publicCacheHeaders(30));
      return;
    }

    if (method === "GET" && pathname === "/api/public/voting/me") {
      const attendeeRef = String(url.searchParams.get("attendeeRef") || "").trim();
      if (!attendeeRef || attendeeRef.length < 4) {
        sendJson(request, response, 400, { error: "Query attendeeRef is required." });
        return;
      }
      const doc = await readPeoplesChoice();
      const publication = publicVotingPublication(doc, {
        eventId: CURRENT_EVENT_ID,
        allowSample: BOARD_DEMO_RUNTIME
      });
      sendJson(request, response, 200, {
        vote: publication.visible ? voteForAttendee(publication.votes, attendeeRef) : null,
        votingOpen: publication.votingOpen
      }, { "cache-control": "no-store" });
      return;
    }

    if (method === "POST" && pathname === "/api/public/voting") {
      const body = await readBody(request);
      const doc = await readPeoplesChoice();
      const publication = publicVotingPublication(doc, {
        eventId: CURRENT_EVENT_ID,
        allowSample: BOARD_DEMO_RUNTIME
      });
      if (!publication.visible) {
        sendJson(request, response, 409, { error: "People's Choice ballot is not published." });
        return;
      }
      const result = applyVote({
        eventId: doc.eventId,
        votingOpen: publication.votingOpen,
        entries: publication.entries,
        votes: publication.votes
      }, body, {
        idFactory: () => `vote_${randomUUID()}`,
        now: new Date().toISOString(),
        requireTicket: REQUIRE_TICKET_VOTE || Boolean(body.requireTicket)
      });
      if (!result.ok) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      let votes = result.votes;
      if (result.changed) {
        votes = await upsertVote(ROOT, result.vote, {
          eventId: doc.eventId,
          publicationStatus: doc.publicationStatus,
          source: doc.source,
          votingOpen: publication.votingOpen,
          title: doc.title,
          description: doc.description,
          entries: publication.entries
        });
      }
      const tally = tallyVotes(publication.entries, votes);
      sendJson(request, response, result.changed ? 201 : 200, {
        ok: true,
        changed: result.changed,
        vote: result.vote,
        leaderboard: tally.leaderboard,
        totals: { totalVotes: tally.totalVotes, uniqueVoters: tally.uniqueVoters }
      });
      return;
    }

    // Public booth / vendor map (Eventeny CSV mirror)
    if (method === "GET" && pathname === "/api/public/booths") {
      const map = await readBoothMap();
      sendJson(request, response, 200, {
        lastUpdated: map.lastUpdated,
        eventId: map.eventId,
        source: map.source,
        pins: publicBoothPins(map.booths, map.vendors),
        summary: summarizeBooths(map.booths, map.vendors)
      }, publicCacheHeaders(60));
      return;
    }

    if (method === "GET" && pathname === "/api/public/island-conditions") {
      const doc = await readIslandConditions({ refreshWeather: true, refreshFerry: true });
      const payload = publicIslandConditions(doc);
      sendJson(request, response, 200, payload, publicCacheHeaders(60));
      return;
    }

    const cameraHeartbeatMatch = pathname.match(/^\/api\/ingest\/cameras\/([^/]+)\/heartbeat$/);
    if (method === "POST" && cameraHeartbeatMatch) {
      const cameraId = decodeURIComponent(cameraHeartbeatMatch[1]);
      const signed = await readSignedCameraPayload(request, response, "heartbeat", cameraId);
      if (!signed) return;
      let result = null;
      let incidentResult = null;
      const now = new Date().toISOString();
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = recordCameraHeartbeat(current, cameraId, signed.body, {
          now,
          requireConfigured: true,
          requireMonitoringEnabled: true,
          requireHeartbeatId: true,
          requireSourceMatch: true
        });
        if (!result.ok || !result.changed) return result.ok ? result.doc : normalizeIslandConditions(current);
        incidentResult = evaluateCameraHealthIncident(result.doc, cameraId, result.health, {
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now
        });
        return incidentResult.ok ? incidentResult.doc : result.doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        const status = result?.error === "Camera not found." ? 404 : result?.error === "Camera monitoring is not armed." ? 409 : 400;
        sendJson(request, response, status, { error: result?.error || "Camera heartbeat could not be recorded." });
        return;
      }
      await writeIncidentTransitionAudit(request, cameraId, "health", incidentResult);
      sendJson(request, response, result.duplicate ? 200 : 201, {
        ok: true,
        duplicate: result.duplicate,
        health: result.health,
        incidentAction: incidentResult?.action ?? null,
        incident: incidentResult?.incident ? {
          id: incidentResult.incident.id,
          status: incidentResult.incident.status,
          severity: incidentResult.incident.severity
        } : null
      });
      return;
    }

    const cameraIngestMatch = pathname.match(/^\/api\/ingest\/cameras\/([^/]+)\/observations$/);
    if (method === "POST" && cameraIngestMatch) {
      const cameraId = decodeURIComponent(cameraIngestMatch[1]);
      const signed = await readSignedCameraPayload(request, response, "observation", cameraId);
      if (!signed) return;
      let result = null;
      let incidentResult = null;
      const now = new Date().toISOString();
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = recordCameraObservation(current, cameraId, signed.body, {
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now,
          source: "signed-local-inference",
          requireConfigured: true,
          requireMonitoringEnabled: true,
          requireEventId: true,
          requireSourceMatch: true
        });
        if (!result.ok || !result.changed) return result.ok ? result.doc : normalizeIslandConditions(current);
        incidentResult = evaluateCameraObservationIncident(result.doc, cameraId, result.observation, {
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now
        });
        return incidentResult.ok ? incidentResult.doc : result.doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        const status = result?.error === "Camera not found." ? 404 : result?.error === "Camera monitoring is not armed." ? 409 : 400;
        sendJson(request, response, status, { error: result?.error || "Camera observation could not be recorded." });
        return;
      }
      await writeIncidentTransitionAudit(request, cameraId, "condition", incidentResult);
      sendJson(request, response, result.duplicate ? 200 : 201, {
        ok: true,
        duplicate: result.duplicate,
        observation: result.observation,
        incidentAction: incidentResult?.action ?? null,
        incident: incidentResult?.incident ? {
          id: incidentResult.incident.id,
          status: incidentResult.incident.status,
          severity: incidentResult.incident.severity
        } : null
      });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-status") {
      const config = partnerPortalConfig();
      if (!config.ready) {
        sendJson(request, response, 503, { error: "Partner status is temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      sendJson(request, response, 200, { application: publicPartnerStatus(doc, access.application) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/outreach-preferences") {
      if (!OUTREACH_PREFERENCES.ready) {
        sendJson(request, response, 503, { error: "Outreach preferences are temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findOutreachPreferenceProspect(doc, body.prospectId, body.token, { config: OUTREACH_PREFERENCES });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      sendJson(request, response, 200, { preference: publicOutreachPreference(access.prospect) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/outreach-preferences/unsubscribe") {
      if (!OUTREACH_PREFERENCES.ready) {
        sendJson(request, response, 503, { error: "Outreach preferences are temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      let accessError = null;
      let duplicate = false;
      const result = await mutatePartnerOperations(doc => {
        const access = findOutreachPreferenceProspect(doc, body.prospectId, body.token, { config: OUTREACH_PREFERENCES });
        if (!access.ok) {
          accessError = access.error;
          return doc;
        }
        if (access.prospect.suppressedAt || access.prospect.status === "do_not_contact") {
          duplicate = true;
          return { ok: true, prospect: access.prospect, doc };
        }
        return updateOutreachProspect(doc, access.prospect.id, {
          suppressed: true,
          suppressionReason: "Recipient unsubscribed through public outreach preferences"
        }, {
          actorId: "public-unsubscribe",
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now: new Date().toISOString()
        });
      });
      if (accessError || !result?.ok) {
        sendJson(request, response, accessError ? 404 : 400, { error: accessError || result?.error || "Outreach preference could not be updated." });
        return;
      }
      if (!duplicate) {
        await writeAuditRecord(request, "outreach.prospect.public_unsubscribe", { type: "prospect", id: result.prospect.id }, null, {
          status: result.prospect.status,
          suppressedAt: result.prospect.suppressedAt
        });
      }
      sendJson(request, response, 200, { duplicate, preference: publicOutreachPreference(result.prospect) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-payment-checkout") {
      const portalConfig = partnerPortalConfig();
      if (!portalConfig.ready) {
        sendJson(request, response, 503, { error: "Partner portal is temporarily unavailable." });
        return;
      }
      if (!STRIPE_PARTNER_PAYMENTS.ready) {
        sendJson(request, response, 503, { error: "Online invoice payment is temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      const currentDoc = await readPartnerOperations();
      const access = findPartnerPortalApplication(currentDoc, body.reference, body.token, { config: portalConfig });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const invoiceId = String(body.invoiceId || "").trim();
      const reservation = await mutatePartnerOperations(doc => beginPartnerPaymentCheckout(doc, access.application.id, invoiceId, {
        actorId: `partner:${access.application.reference}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!reservation?.ok) {
        const status = reservation?.error === "Invoice not found." ? 404 : reservation?.error === "This invoice has no open balance." ? 409 : 400;
        sendJson(request, response, status, { error: reservation?.error || "Invoice checkout could not be created." });
        return;
      }
      if (reservation.duplicate) {
        if (reservation.checkout.status === "open" && reservation.checkout.checkoutUrl) {
          sendJson(request, response, 200, {
            duplicate: true,
            checkout: {
              id: reservation.checkout.id,
              status: reservation.checkout.status,
              checkoutUrl: reservation.checkout.checkoutUrl,
              expiresAt: reservation.checkout.expiresAt
            }
          });
          return;
        }
        sendJson(request, response, 409, { error: "A payment checkout is already being prepared. Please retry shortly." });
        return;
      }
      try {
        const session = await createStripePartnerCheckoutSession({
          checkout: reservation.checkout,
          invoice: reservation.invoice,
          application: reservation.application
        }, { config: STRIPE_PARTNER_PAYMENTS });
        const activated = await mutatePartnerOperations(doc => activatePartnerPaymentCheckout(doc, reservation.checkout.id, session, {
          now: new Date().toISOString()
        }));
        if (!activated?.ok) throw new Error(activated?.error || "Stripe checkout state could not be saved.");
        await writeAuditRecord(request, "partner.payment_checkout.created", { type: "payment_checkout", id: activated.checkout.id }, null, {
          applicationId: activated.checkout.applicationId,
          invoiceId: activated.checkout.invoiceId,
          amountCents: activated.checkout.amountCents,
          providerSessionId: activated.checkout.providerSessionId,
          expiresAt: activated.checkout.expiresAt
        });
        sendJson(request, response, 201, {
          duplicate: false,
          checkout: {
            id: activated.checkout.id,
            status: activated.checkout.status,
            checkoutUrl: activated.checkout.checkoutUrl,
            expiresAt: activated.checkout.expiresAt
          }
        });
      } catch (error) {
        await mutatePartnerOperations(doc => failPartnerPaymentCheckout(doc, reservation.checkout.id, error.message, {
          now: new Date().toISOString()
        }));
        sendJson(request, response, 502, { error: "Stripe could not prepare this invoice payment. Please try again." });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-brand-profile") {
      const config = partnerPortalConfig();
      if (!config.ready) {
        sendJson(request, response, 503, { error: "Partner portal is temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const result = await mutatePartnerOperations(current => updatePartnerBrandProfile(current, access.application.id, body.profile || body, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Brand profile could not be submitted." });
        return;
      }
      sendJson(request, response, 200, { application: publicPartnerStatus(result.doc, access.application) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-brand-assets") {
      const config = partnerPortalConfig();
      if (!config.ready) {
        sendJson(request, response, 503, { error: "Partner portal is temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const result = await mutatePartnerOperations(current => createPartnerBrandAsset(current, access.application.id, body.asset || body, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Brand asset could not be submitted." });
        return;
      }
      const publicAsset = publicPartnerStatus(result.doc, access.application).branding?.assets.find(item => item.id === result.asset.id);
      sendJson(request, response, result.duplicate ? 200 : 201, { duplicate: result.duplicate, asset: publicAsset });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-brand-assets/upload") {
      const config = partnerPortalConfig();
      if (!config.ready || !PARTNER_ASSET_STORAGE.ready) {
        sendJson(request, response, 503, { error: config.reason || PARTNER_ASSET_STORAGE.reason || "Partner asset uploads are temporarily unavailable." });
        return;
      }
      const reference = String(request.headers["x-partner-reference"] || "");
      const token = String(request.headers["x-partner-token"] || "");
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, reference, token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      if (access.application.type !== "sponsor") {
        sendJson(request, response, 400, { error: "Brand fulfillment is available for sponsor applications." });
        return;
      }
      const assetId = `brand_asset_${randomUUID()}`;
      const buffer = await readBufferBody(request, PARTNER_ASSET_STORAGE.maxBytes);
      const saved = await savePartnerAssetUpload(ROOT, {
        applicationId: access.application.id,
        assetId,
        buffer,
        contentType: request.headers["content-type"],
        fileName: request.headers["x-file-name"]
      }, { config: PARTNER_ASSET_STORAGE });
      if (!saved.ok) {
        sendJson(request, response, 400, { error: saved.error });
        return;
      }
      const result = await mutatePartnerOperations(current => createPartnerBrandAsset(current, access.application.id, {
        id: assetId,
        kind: request.headers["x-asset-kind"],
        label: request.headers["x-asset-label"],
        ...saved
      }, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok || result.duplicate) await deletePartnerAssetUpload(ROOT, saved.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Brand asset could not be submitted." });
        return;
      }
      const publicAsset = publicPartnerStatus(result.doc, access.application).branding?.assets.find(item => item.id === result.asset.id);
      sendJson(request, response, result.duplicate ? 200 : 201, { duplicate: result.duplicate, asset: publicAsset });
      return;
    }

    const partnerAssetContentMatch = pathname.match(/^\/api\/public\/partner-brand-assets\/([^/]+)\/content$/);
    if (method === "POST" && partnerAssetContentMatch) {
      const config = partnerPortalConfig();
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const assetId = decodeURIComponent(partnerAssetContentMatch[1]);
      const asset = doc.brandAssets.find(item => item.id === assetId && item.applicationId === access.application.id && item.sourceType === "upload" && item.status !== "archived");
      if (!asset) {
        sendJson(request, response, 404, { error: "Brand asset not found." });
        return;
      }
      const stored = await readPartnerAssetUpload(ROOT, asset.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: stored.error });
        return;
      }
      sendBinary(request, response, 200, stored.buffer, { contentType: asset.contentType, fileName: partnerAssetDownloadName(asset) });
      return;
    }

    const partnerDeliverableReviewMatch = pathname.match(/^\/api\/public\/partner-deliverables\/([^/]+)\/review$/);
    if (method === "POST" && partnerDeliverableReviewMatch) {
      const config = partnerPortalConfig();
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const deliverableId = decodeURIComponent(partnerDeliverableReviewMatch[1]);
      const deliverable = doc.deliverables.find(item => item.id === deliverableId && item.applicationId === access.application.id);
      if (!deliverable) {
        sendJson(request, response, 404, { error: "Deliverable not found." });
        return;
      }
      const result = await mutatePartnerOperations(current => reviewPartnerDeliverable(current, deliverableId, body, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Deliverable review could not be saved." });
        return;
      }
      sendJson(request, response, 200, { application: publicPartnerStatus(result.doc, access.application) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-vendor-profile") {
      const config = partnerPortalConfig();
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const result = await mutatePartnerOperations(current => updateVendorProfile(current, access.application.id, body.profile || body, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Vendor profile could not be submitted." });
        return;
      }
      sendJson(request, response, 200, { application: publicPartnerStatus(result.doc, access.application) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-vendor-documents") {
      const config = partnerPortalConfig();
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const requirementId = String(body.requirementId || body.document?.requirementId || "");
      const result = await mutatePartnerOperations(current => createVendorDocument(current, access.application.id, requirementId, body.document || body, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Vendor requirement not found." ? 404 : 400, { error: result?.error || "Vendor document could not be submitted." });
        return;
      }
      sendJson(request, response, result.duplicate ? 200 : 201, { duplicate: result.duplicate, application: publicPartnerStatus(result.doc, access.application) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-vendor-documents/upload") {
      const config = partnerPortalConfig();
      if (!config.ready || !PARTNER_ASSET_STORAGE.ready) {
        sendJson(request, response, 503, { error: config.reason || PARTNER_ASSET_STORAGE.reason || "Partner document uploads are temporarily unavailable." });
        return;
      }
      const reference = String(request.headers["x-partner-reference"] || "");
      const token = String(request.headers["x-partner-token"] || "");
      const requirementId = String(request.headers["x-requirement-id"] || "");
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, reference, token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      if (access.application.type !== "vendor") {
        sendJson(request, response, 400, { error: "Vendor onboarding is available for vendor applications." });
        return;
      }
      const documentId = `vendor_document_${randomUUID()}`;
      const buffer = await readBufferBody(request, PARTNER_ASSET_STORAGE.maxBytes);
      const saved = await savePartnerAssetUpload(ROOT, {
        applicationId: access.application.id,
        assetId: documentId,
        buffer,
        contentType: request.headers["content-type"],
        fileName: request.headers["x-file-name"]
      }, { config: PARTNER_ASSET_STORAGE });
      if (!saved.ok) {
        sendJson(request, response, 400, { error: saved.error });
        return;
      }
      const result = await mutatePartnerOperations(current => createVendorDocument(current, access.application.id, requirementId, {
        id: documentId,
        label: request.headers["x-document-label"],
        ...saved
      }, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok || result.duplicate) await deletePartnerAssetUpload(ROOT, saved.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Vendor requirement not found." ? 404 : 400, { error: result?.error || "Vendor document could not be submitted." });
        return;
      }
      sendJson(request, response, result.duplicate ? 200 : 201, { duplicate: result.duplicate, application: publicPartnerStatus(result.doc, access.application) });
      return;
    }

    const partnerVendorDocumentContentMatch = pathname.match(/^\/api\/public\/partner-vendor-documents\/([^/]+)\/content$/);
    if (method === "POST" && partnerVendorDocumentContentMatch) {
      const config = partnerPortalConfig();
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const documentId = decodeURIComponent(partnerVendorDocumentContentMatch[1]);
      const document = doc.vendorDocuments.find(item => item.id === documentId && item.applicationId === access.application.id && item.sourceType === "upload" && !["superseded", "archived"].includes(item.status));
      if (!document) {
        sendJson(request, response, 404, { error: "Vendor document not found." });
        return;
      }
      const stored = await readPartnerAssetUpload(ROOT, document.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: stored.error });
        return;
      }
      sendBinary(request, response, 200, stored.buffer, { contentType: document.contentType, fileName: partnerAssetDownloadName(document) });
      return;
    }

    if (method === "POST" && pathname === "/api/public/partner-vendor-assignment/confirm") {
      const config = partnerPortalConfig();
      const body = await readBody(request);
      const doc = await readPartnerOperations();
      const access = findPartnerPortalApplication(doc, body.reference, body.token, { config });
      if (!access.ok) {
        sendJson(request, response, 404, { error: access.error });
        return;
      }
      const result = await mutatePartnerOperations(current => confirmVendorAssignment(current, access.application.id, {
        actorId: `partner:${access.application.id}`,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Vendor assignment could not be confirmed." });
        return;
      }
      sendJson(request, response, 200, { application: publicPartnerStatus(result.doc, access.application) });
      return;
    }

    if (method === "POST" && (pathname === "/api/public/vendor-applications" || pathname === "/api/public/sponsor-inquiries")) {
      const portalConfig = partnerPortalConfig();
      if (!portalConfig.ready) {
        sendJson(request, response, 503, { error: "Partner applications are temporarily unavailable." });
        return;
      }
      const body = await readBody(request);
      const type = pathname.endsWith("vendor-applications") ? "vendor" : "sponsor";
      const idempotency = partnerIntakeIdempotency(request, type, body);
      if (!idempotency.ok) {
        sendJson(request, response, 400, { error: idempotency.error });
        return;
      }
      const botVerification = await verifyTurnstileToken({
        token: body.botToken,
        action: type === "vendor" ? "vendor_application" : "sponsor_inquiry",
        remoteIp: requestIp(request),
        idempotencyKey: idempotency.idempotencyKeyHash || idempotency.idempotencyFingerprint
      }, { config: TURNSTILE });
      if (!botVerification.ok) {
        sendJson(request, response, botVerification.unavailable ? 503 : 400, { error: botVerification.error });
        return;
      }
      let expectedAmountCents = 0;
      let sponsorPackage = null;
      let vendorOffering = null;
      let sponsorInvitationAccess = null;
      const config = await storage.config.read("admin-config");
      if (type === "sponsor") {
        if (body.sponsorInvitationToken) {
          const doc = await readPartnerOperations();
          sponsorInvitationAccess = verifySponsorInvitationToken(doc, body.sponsorInvitationToken, { config: SPONSOR_INVITATIONS });
          if (!sponsorInvitationAccess.ok) {
            sendJson(request, response, sponsorInvitationAccess.expired ? 410 : 400, { error: sponsorInvitationAccess.error });
            return;
          }
          if (body.packageId !== sponsorInvitationAccess.invitation.packageId) {
            sendJson(request, response, 400, { error: "The selected package does not match this sponsor invitation." });
            return;
          }
        }
        const resolvedPackage = resolveSponsorPackage(config, sponsorInvitationAccess?.invitation.packageId || body.packageId);
        if (!resolvedPackage.ok) {
          sendJson(request, response, 400, { error: "Choose an active sponsorship package." });
          return;
        }
        sponsorPackage = resolvedPackage.sponsorPackage;
        expectedAmountCents = sponsorPackage.amount;
      } else {
        const resolvedOffering = resolveVendorOffering(config, body.vendorOfferingId, body.category);
        if (!resolvedOffering.ok) {
          sendJson(request, response, 400, { error: resolvedOffering.error });
          return;
        }
        vendorOffering = resolvedOffering.offering;
        expectedAmountCents = vendorOffering.amount;
      }
      const applicationInput = {
        ...body,
        type,
        requestedAmountCents: 0,
        expectedAmountCents,
        packageId: sponsorPackage?.id,
        packageName: sponsorPackage?.name,
        packageBenefits: sponsorPackage?.benefits,
        offeringId: vendorOffering?.id,
        offeringName: vendorOffering?.name,
        source: sponsorInvitationAccess ? "outreach_invitation" : "website"
      };
      delete applicationInput.sponsorInvitationToken;
      const applicationOptions = {
        eventId: CURRENT_EVENT_ID,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        idempotencyKeyHash: idempotency.idempotencyKeyHash,
        idempotencyFingerprint: idempotency.idempotencyFingerprint,
        now: new Date().toISOString()
      };
      const result = await mutatePartnerOperations(doc => sponsorInvitationAccess
        ? createSponsorApplicationFromOutreachInvitation(doc, sponsorInvitationAccess.prospect.id, applicationInput, {
          ...applicationOptions,
          packageId: sponsorInvitationAccess.invitation.packageId,
          invitationVersion: sponsorInvitationAccess.invitation.version
        })
        : createPartnerApplication(doc, applicationInput, applicationOptions));
      if (!result?.ok) {
        const status = result?.retryable ? 503 : (result?.conflict || result?.eventContextMismatch ? 409 : 400);
        sendJson(request, response, status, { error: result?.error || "Application could not be submitted." });
        return;
      }
      let followupJob = null;
      if (!result.duplicate && result.followup) {
        try {
          followupJob = await enqueueJob(ROOT, {
            type: "partner.followup.prepare",
            payload: { followupId: result.followup.id }
          });
        } catch {
          // Intake is durable even if the draft worker queue needs operator recovery.
        }
      }
      const portalToken = issuePartnerPortalToken(result.application, { config: portalConfig });
      sendJson(request, response, result.duplicate ? 200 : 201, {
        ok: true,
        duplicate: result.duplicate,
        application: {
          id: result.application.id,
          reference: result.application.reference,
          type: result.application.type,
          status: result.application.status,
          organizationName: result.application.organizationName,
          createdAt: result.application.createdAt
        },
        portalAccess: {
          token: portalToken,
          path: partnerPortalPath(result.application, portalToken),
          url: partnerPortalUrl(result.application, portalToken, { config: portalConfig })
        },
        nextStep: "The SandFest team will review the application and follow up using the contact information provided.",
        acknowledgment: result.duplicate ? "already_received" : followupJob ? "draft_queued" : "awaiting_staff_review",
        outreachConversion: Boolean(sponsorInvitationAccess)
      });
      return;
    }

    if (method === "POST" && pathname === "/api/webhooks/twilio/status") {
      await handleTwilioStatusWebhook(request, response, url);
      return;
    }

    if (method === "POST" && pathname === "/api/webhooks/twilio/inbound/smsSafety") {
      await handleTwilioPreferenceWebhook(request, response, "smsSafety");
      return;
    }

    if (method === "POST" && pathname === "/api/webhooks/twilio/inbound/smsMarketing") {
      await handleTwilioPreferenceWebhook(request, response, "smsMarketing");
      return;
    }

    if (method === "POST" && pathname === "/api/webhooks/brevo") {
      if (!BREVO_WEBHOOK.enabled) {
        sendJson(request, response, 404, { error: "Webhook endpoint is not enabled." });
        return;
      }
      if (!verifyBrevoWebhookAuthorization(request.headers, BREVO_WEBHOOK)) {
        sendJson(request, response, 401, { error: "Webhook authentication failed." });
        return;
      }
      const rawBody = await readRawBody(request);
      let webhookPayload;
      try {
        webhookPayload = rawBody.trim() ? JSON.parse(rawBody) : {};
      } catch {
        sendJson(request, response, 400, { error: "Brevo webhook body must be valid JSON." });
        return;
      }
      const normalized = normalizeBrevoWebhookEvents(webhookPayload);
      if (!normalized.ok) {
        sendJson(request, response, 400, { error: normalized.error });
        return;
      }
      const result = await mutatePartnerOperations(doc => applyBrevoDeliveryEvents(doc, normalized.events, {
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.eventContextMismatch ? 409 : 400, { error: result?.error || "Delivery events could not be recorded." });
        return;
      }
      request.adminSession = {
        id: "brevo-webhook",
        role: "integration",
        permissions: [],
        auth: "webhook",
        issuer: "brevo",
        tokenId: null
      };
      const counts = {
        received: result.received,
        matched: result.matched,
        unmatched: result.unmatched,
        duplicates: result.duplicates,
        suppressed: result.suppressed,
        dismissed: result.dismissed,
        pending: result.pending
      };
      await writeAuditRecord(request, "email.delivery.webhook", { type: "emailDeliveryWebhook", id: "brevo" }, null, null, counts);
      sendJson(request, response, 200, counts);
      return;
    }

    if (method === "POST" && pathname === "/api/stripe/create-checkout-session") {
      await handleCreateCheckoutSession(request, response);
      return;
    }

    if (method === "POST" && pathname === "/api/stripe/webhook") {
      await handleStripeWebhook(request, response);
      return;
    }

    if (method === "GET" && pathname === "/api/admin/config") {
      if (!(await requireAdmin(request, response))) return;
      const [config, tickets, bootstrap] = await Promise.all([
        storage.config.read("admin-config"),
        storage.config.read("ticket-products"),
        storage.config.read("app-bootstrap")
      ]);
      const sponsorCatalog = sponsorPackageCatalog(config);
      const vendorCatalog = vendorOfferingCatalog(config);
      sendJson(request, response, 200, {
        config: { ...config, sponsorPackages: sponsorCatalog.packages, vendorOfferings: vendorCatalog.offerings },
        sponsorPackageReadiness: {
          ready: sponsorCatalog.ready,
          source: sponsorCatalog.source,
          activePackages: sponsorCatalog.activePackages.length,
          errors: sponsorCatalog.errors
        },
        vendorOfferingReadiness: {
          ready: vendorCatalog.ready,
          source: vendorCatalog.source,
          activeOfferings: vendorCatalog.activeOfferings.length,
          missingCategories: vendorCatalog.missingCategories,
          errors: vendorCatalog.errors
        },
        tickets,
        bootstrap,
        eventGuideReadiness: eventGuideReadiness(bootstrap.guide, { maxSourceAgeDays: EVENT_GUIDE_SOURCE_MAX_AGE_DAYS })
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/session") {
      const session = await requireAdmin(request, response);
      if (!session) return;
      sendJson(request, response, 200, { session });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/deployment") {
      const session = await requireAdmin(request, response);
      if (!session) return;
      sendJson(request, response, 200, { deployment: await deploymentProfile() });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/deployment/tasks/sync") {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const deployment = await deploymentProfile();
      const result = await syncDeploymentTasks(deployment.checks, session.id);
      if (!result?.ok) {
        sendJson(request, response, result?.eventContextMismatch ? 409 : 400, { error: result?.error || "Launch work items could not be synchronized." });
        return;
      }
      const { doc: _doc, tasks: _tasks, ...sync } = result;
      await writeAuditRecord(request, "deployment.tasks.sync", { type: "deployment", id: deployment.environment }, null, {
        changed: sync.changed,
        created: sync.created,
        updated: sync.updated,
        reopened: sync.reopened,
        completed: sync.completed,
        deduplicated: sync.deduplicated,
        active: sync.active,
        taskIds: sync.taskIds
      });
      sendJson(request, response, 200, { deployment, sync });
      return;
    }

    const internalDocumentExtractionMatch = pathname.match(/^\/api\/internal\/documents\/([^/]+)\/extraction-source$/);
    if (method === "GET" && internalDocumentExtractionMatch) {
      if (!verifyDocumentExtractionSourceAuthorization(request.headers, { config: DOCUMENT_EXTRACTION_SOURCE })) {
        sendJson(request, response, 401, { error: "Document extraction source authentication failed." });
        return;
      }
      const documentId = decodeURIComponent(internalDocumentExtractionMatch[1]);
      const eventId = String(url.searchParams.get("eventId") || "");
      const checksum = String(url.searchParams.get("checksum") || "");
      const extractionVersion = Math.max(0, Math.round(Number(url.searchParams.get("version")) || 0));
      const doc = normalizeIncomingDocumentIntake(
        await readPlatformDoc(ROOT, "incomingDocuments", emptyIncomingDocumentIntake(CURRENT_EVENT_ID)),
        { eventId: CURRENT_EVENT_ID }
      );
      const record = doc.documents.find(item => item.id === documentId);
      if (!record || record.eventId !== eventId || record.checksumSha256 !== checksum || record.extractionVersion !== extractionVersion) {
        sendJson(request, response, 404, { error: "Document extraction source is unavailable for this request." });
        return;
      }
      if (!["queued", "extracting"].includes(record.extractionStatus)) {
        sendJson(request, response, 409, { error: `Document extraction is ${record.extractionStatus}.` });
        return;
      }
      const stored = await readIncomingDocumentUpload(ROOT, record.storageKey, { config: INCOMING_DOCUMENT_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: stored.error });
        return;
      }
      const verified = verifyIncomingDocumentBytes(record, stored.buffer);
      if (!verified.ok) {
        await writeAuditRecord(request, "document.integrity_failure", { type: "incomingDocument", id: record.id }, null, null, verified);
        sendJson(request, response, 409, { error: verified.error });
        return;
      }
      await writeAuditRecord(request, "document.extraction.source_read", { type: "incomingDocument", id: record.id }, null, null, {
        checksumSha256: record.checksumSha256,
        extractionVersion: record.extractionVersion,
        sizeBytes: record.sizeBytes
      });
      sendBinary(request, response, 200, stored.buffer, {
        contentType: record.contentType,
        fileName: incomingDocumentDownloadName(record)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/documents") {
      if (!(await requirePermission(request, response, "documents:read"))) return;
      const [incomingDocumentData, partnerOperationsData] = await Promise.all([
        readPlatformDoc(ROOT, "incomingDocuments", emptyIncomingDocumentIntake(CURRENT_EVENT_ID)),
        readPartnerOperations()
      ]);
      const doc = normalizeIncomingDocumentIntake(incomingDocumentData, { eventId: CURRENT_EVENT_ID });
      const partnerOperations = normalizePartnerOperations(partnerOperationsData);
      if (doc.eventId !== CURRENT_EVENT_ID) {
        sendJson(request, response, 409, { error: `Document intake belongs to ${doc.eventId}; expected ${CURRENT_EVENT_ID}.` });
        return;
      }
      const status = String(url.searchParams.get("status") || "").trim();
      const domain = String(url.searchParams.get("domain") || "").trim();
      const documents = doc.documents
        .filter(record => !status || record.status === status)
        .filter(record => !domain || record.domain === domain)
        .sort((left, right) => String(right.uploadedAt || "").localeCompare(String(left.uploadedAt || "")))
        .slice(0, clampLimit(url.searchParams.get("limit"), 200))
        .map(record => ({
          ...adminIncomingDocument(record),
          reviewTask: incomingDocumentReviewTaskView(partnerOperations, record.id)
        }));
      sendJson(request, response, 200, {
        documents,
        summary: summarizeIncomingDocuments(doc, { eventId: CURRENT_EVENT_ID, now: new Date().toISOString() }),
        storage: {
          ready: INCOMING_DOCUMENT_STORAGE.ready,
          maxBytes: INCOMING_DOCUMENT_STORAGE.maxBytes,
          allowedTypes: INCOMING_DOCUMENT_STORAGE.allowedTypes,
          reason: INCOMING_DOCUMENT_STORAGE.reason
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/documents/upload") {
      const session = await requirePermission(request, response, "documents:write");
      if (!session) return;
      if (!INCOMING_DOCUMENT_STORAGE.ready) {
        sendJson(request, response, 503, { error: INCOMING_DOCUMENT_STORAGE.reason || "Document intake storage is unavailable." });
        return;
      }
      const header = name => String(Array.isArray(request.headers[name]) ? request.headers[name][0] : request.headers[name] || "").trim();
      const documentId = `incoming_document_${randomUUID()}`;
      const now = new Date().toISOString();
      const reviewDueAt = header("x-document-review-due-at") || defaultIncomingDocumentReviewDueAt(now);
      const buffer = await readBufferBody(request, INCOMING_DOCUMENT_STORAGE.maxBytes);
      const saved = await saveIncomingDocumentUpload(ROOT, {
        documentId,
        eventId: CURRENT_EVENT_ID,
        fileName: header("x-file-name"),
        contentType: request.headers["content-type"],
        buffer
      }, { config: INCOMING_DOCUMENT_STORAGE });
      if (!saved.ok) {
        sendJson(request, response, 400, { error: saved.error });
        return;
      }
      let result = null;
      try {
        await updatePlatformDoc(ROOT, "incomingDocuments", current => {
          result = createIncomingDocument(current, {
            ...saved,
            id: documentId,
            domain: header("x-document-domain"),
            title: header("x-document-title"),
            ownerTeam: header("x-owner-team") || "operations",
            reviewDueAt
          }, {
            eventId: CURRENT_EVENT_ID,
            actorId: session.id,
            now
          });
          return result?.ok ? result.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
        }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      } catch (error) {
        await deleteIncomingDocumentUpload(ROOT, saved.storageKey, { config: INCOMING_DOCUMENT_STORAGE });
        throw error;
      }
      if (!result?.ok || result.duplicate) {
        await deleteIncomingDocumentUpload(ROOT, saved.storageKey, { config: INCOMING_DOCUMENT_STORAGE });
      }
      if (!result?.ok) {
        sendJson(request, response, result.eventContextMismatch ? 409 : 400, { error: result.error || "Document could not be registered." });
        return;
      }
      const reviewTaskResult = await syncDocumentReviewTask(result.document, session.id, now);
      if (!reviewTaskResult?.ok) {
        await writeAuditRecord(request, "document.review_task.sync_failed", { type: "incomingDocument", id: result.document.id }, null, null, {
          reason: reviewTaskResult?.error || "Document review task could not be synchronized."
        });
        sendJson(request, response, reviewTaskResult?.eventContextMismatch ? 409 : 503, {
          error: "The document is stored, but its review task could not be synchronized. Retry the upload to repair routing.",
          duplicate: result.duplicate,
          document: adminIncomingDocument(result.document)
        });
        return;
      }
      let extractionJob = null;
      try {
        extractionJob = await enqueueIncomingDocumentExtraction(result.document);
      } catch (error) {
        await writeAuditRecord(request, "document.extraction.queue_failed", { type: "incomingDocument", id: result.document.id }, null, null, {
          reason: String(error?.message || error).slice(0, 500),
          extractionVersion: result.document.extractionVersion
        });
        sendJson(request, response, 503, {
          error: "The document is stored, but text extraction could not be queued. Retry the upload to repair extraction routing.",
          duplicate: result.duplicate,
          document: {
            ...adminIncomingDocument(result.document),
            reviewTask: incomingDocumentReviewTaskView(reviewTaskResult.doc, result.document.id)
          }
        });
        return;
      }
      if (!result.duplicate) {
        await writeAuditRecord(request, "document.upload", { type: "incomingDocument", id: result.document.id }, null, incomingDocumentAuditView(result.document), {
          domain: result.document.domain,
          sizeBytes: result.document.sizeBytes,
          checksumSha256: result.document.checksumSha256
        });
      }
      sendJson(request, response, result.duplicate ? 200 : 201, {
        duplicate: result.duplicate,
        document: {
          ...adminIncomingDocument(result.document),
          reviewTask: incomingDocumentReviewTaskView(reviewTaskResult.doc, result.document.id)
        },
        extractionJob: extractionJob ? { id: extractionJob.id, status: extractionJob.status } : null,
        summary: summarizeIncomingDocuments(result.doc, { eventId: CURRENT_EVENT_ID, now })
      });
      return;
    }

    const adminDocumentContentMatch = pathname.match(/^\/api\/admin\/documents\/([^/]+)\/content$/);
    if (method === "GET" && adminDocumentContentMatch) {
      if (!(await requirePermission(request, response, "documents:read"))) return;
      const documentId = decodeURIComponent(adminDocumentContentMatch[1]);
      const doc = normalizeIncomingDocumentIntake(
        await readPlatformDoc(ROOT, "incomingDocuments", emptyIncomingDocumentIntake(CURRENT_EVENT_ID)),
        { eventId: CURRENT_EVENT_ID }
      );
      const record = doc.documents.find(item => item.id === documentId);
      if (!record) {
        sendJson(request, response, 404, { error: "Document not found." });
        return;
      }
      const stored = await readIncomingDocumentUpload(ROOT, record.storageKey, { config: INCOMING_DOCUMENT_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: stored.error });
        return;
      }
      const verified = verifyIncomingDocumentBytes(record, stored.buffer);
      if (!verified.ok) {
        await writeAuditRecord(request, "document.integrity_failure", { type: "incomingDocument", id: record.id }, null, null, verified);
        sendJson(request, response, 409, { error: verified.error });
        return;
      }
      await writeAuditRecord(request, "document.download", { type: "incomingDocument", id: record.id }, null, null, {
        domain: record.domain,
        sizeBytes: record.sizeBytes,
        checksumSha256: record.checksumSha256
      });
      sendBinary(request, response, 200, stored.buffer, {
        contentType: record.contentType,
        fileName: incomingDocumentDownloadName(record)
      });
      return;
    }

    const adminDocumentExtractionRetryMatch = pathname.match(/^\/api\/admin\/documents\/([^/]+)\/extraction\/retry$/);
    if (method === "POST" && adminDocumentExtractionRetryMatch) {
      const session = await requirePermission(request, response, "documents:write");
      if (!session) return;
      const documentId = decodeURIComponent(adminDocumentExtractionRetryMatch[1]);
      const now = new Date().toISOString();
      let result = null;
      await updatePlatformDoc(ROOT, "incomingDocuments", current => {
        result = requestIncomingDocumentExtraction(current, documentId, {
          eventId: CURRENT_EVENT_ID,
          actorId: session.id,
          now,
          force: true
        });
        return result?.ok ? result.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
      }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Document not found." ? 404 : 400, { error: result?.error || "Document extraction could not be queued." });
        return;
      }
      let extractionJob;
      try {
        extractionJob = await enqueueIncomingDocumentExtraction(result.document);
      } catch (error) {
        await writeAuditRecord(request, "document.extraction.queue_failed", { type: "incomingDocument", id: result.document.id }, incomingDocumentAuditView(result.before), incomingDocumentAuditView(result.document), {
          reason: String(error?.message || error).slice(0, 500),
          extractionVersion: result.document.extractionVersion
        });
        sendJson(request, response, 503, { error: "Text extraction could not be queued. Retry this action." });
        return;
      }
      await writeAuditRecord(request, "document.extraction.retry", { type: "incomingDocument", id: result.document.id }, incomingDocumentAuditView(result.before), incomingDocumentAuditView(result.document), {
        extractionVersion: result.document.extractionVersion,
        jobId: extractionJob.id
      });
      sendJson(request, response, 202, {
        document: adminIncomingDocument(result.document),
        extractionJob: { id: extractionJob.id, status: extractionJob.status },
        summary: summarizeIncomingDocuments(result.doc, { eventId: CURRENT_EVENT_ID, now })
      });
      return;
    }

    const adminDocumentMatch = pathname.match(/^\/api\/admin\/documents\/([^/]+)$/);
    if (method === "PATCH" && adminDocumentMatch) {
      const session = await requirePermission(request, response, "documents:write");
      if (!session) return;
      const documentId = decodeURIComponent(adminDocumentMatch[1]);
      const body = await readBody(request);
      const now = new Date().toISOString();
      let result = null;
      await updatePlatformDoc(ROOT, "incomingDocuments", current => {
        result = updateIncomingDocument(current, documentId, body, {
          eventId: CURRENT_EVENT_ID,
          actorId: session.id,
          now
        });
        return result?.ok ? result.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
      }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      if (!result?.ok) {
        sendJson(request, response, result?.eventContextMismatch ? 409 : result?.error === "Document not found." ? 404 : 400, { error: result?.error || "Document review could not be saved." });
        return;
      }
      const reviewTaskResult = await syncDocumentReviewTask(result.document, session.id, now);
      if (!reviewTaskResult?.ok) {
        await writeAuditRecord(request, "document.review_task.sync_failed", { type: "incomingDocument", id: result.document.id }, null, null, {
          reason: reviewTaskResult?.error || "Document review task could not be synchronized."
        });
        sendJson(request, response, reviewTaskResult?.eventContextMismatch ? 409 : 503, {
          error: "The document review was saved, but its delegated task could not be synchronized. Retry Save review to repair routing.",
          document: adminIncomingDocument(result.document)
        });
        return;
      }
      if (result.changed) {
        await writeAuditRecord(request, "document.review", { type: "incomingDocument", id: result.document.id }, incomingDocumentAuditView(result.before), incomingDocumentAuditView(result.document));
      }
      sendJson(request, response, 200, {
        changed: result.changed,
        document: {
          ...adminIncomingDocument(result.document),
          reviewTask: incomingDocumentReviewTaskView(reviewTaskResult.doc, result.document.id)
        },
        summary: summarizeIncomingDocuments(result.doc, { eventId: CURRENT_EVENT_ID, now })
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/alert") {
      if (!(await requirePermission(request, response, "alert:read"))) return;
      sendJson(request, response, 200, { alert: await storage.config.read("emergency-alert") });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/revenue") {
      if (!(await requirePermission(request, response, "revenue:read"))) return;
      const [ledger, partnerOperations] = await Promise.all([
        readRevenueLedger(),
        readPartnerOperations()
      ]);
      const view = buildRevenueLedgerView(ledger, partnerOperations, { eventId: CURRENT_EVENT_ID });
      const summary = summarizeLedger(view.entries, {
        currency: view.currency,
        expectedAttendance: view.expectedAttendance,
        ticketCapacity: view.ticketCapacity,
        generatedAt: view.lastUpdated
      });
      sendJson(request, response, 200, {
        eventId: view.eventId,
        lastUpdated: view.lastUpdated,
        summary,
        sources: view.sources,
        imports: ledger.imports
          .filter(item => item?.eventId === CURRENT_EVENT_ID)
          .slice(-20)
          .reverse(),
        entries: view.entries
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/revenue/import") {
      const session = await requirePermission(request, response, "revenue:write");
      if (!session) return;
      const body = await readBody(request);
      const mode = String(body.mode || "").trim().toLowerCase();
      if (!new Set(["preview", "commit"]).has(mode)) {
        sendJson(request, response, 400, { error: "Choose preview or commit for the settlement import." });
        return;
      }
      const defaults = { source: body.source, eventId: CURRENT_EVENT_ID };
      const parsed = parseRevenueCsv(body.csv, defaults);
      if (!parsed.ok) {
        sendJson(request, response, 400, { error: parsed.error });
        return;
      }
      const previewHash = revenueImportPreviewHash(body.csv, defaults);
      const partnerOperations = await readPartnerOperations();
      const existingPartnerEntries = partnerRevenueEntries(partnerOperations, { eventId: CURRENT_EVENT_ID });
      if (mode === "preview") {
        const result = applyRevenueImport(await readRevenueLedger(), parsed, {
          actorId: session.id,
          batchId: `preview_${previewHash.slice(0, 12)}`,
          eventId: CURRENT_EVENT_ID,
          source: parsed.defaults.source,
          previewHash,
          fileName: body.fileName,
          existingEntries: existingPartnerEntries,
          now: new Date().toISOString(),
          idFactory: (_entry, row) => `preview_revenue_row_${row}`
        });
        sendJson(request, response, 200, { previewHash, ...revenueImportResponse(result) });
        return;
      }
      if (String(body.previewHash || "") !== previewHash) {
        sendJson(request, response, 409, { error: "The CSV or provider changed. Preview the settlement again before committing." });
        return;
      }
      const batchId = `revenue_import_${randomUUID()}`;
      const result = await mutateRevenueLedger(parsed, {
        actorId: session.id,
        batchId,
        eventId: CURRENT_EVENT_ID,
        source: parsed.defaults.source,
        previewHash,
        fileName: body.fileName,
        existingEntries: existingPartnerEntries,
        now: new Date().toISOString(),
        idFactory: () => `revenue_entry_${randomUUID()}`
      });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Settlement could not be imported." });
        return;
      }
      if (!result.replay) {
        await writeAuditRecord(request, "revenue.import.commit", {
          type: "revenue_import",
          id: result.importRecord?.id || batchId
        }, null, result.importRecord, {
          eventId: CURRENT_EVENT_ID,
          source: parsed.defaults.source,
          previewHash: previewHash.slice(0, 16),
          summary: result.summary
        });
      }
      sendJson(request, response, result.changed ? 201 : 200, {
        batchId: result.importRecord?.id || batchId,
        previewHash,
        ...revenueImportResponse(result)
      });
      return;
    }

    // Fleet / equipment checkout (Phase 1). See docs/research/04-fleet-asset-tracking.md.
    if (method === "GET" && pathname === "/api/admin/fleet") {
      if (!(await requirePermission(request, response, "fleet:read"))) return;
      const ledger = await readFleetLedger();
      sendJson(request, response, 200, fleetDashboardPayload(ledger));
      return;
    }

    const fleetAssetMatch = pathname.match(/^\/api\/admin\/fleet\/assets\/([^/]+)$/);
    if (method === "GET" && fleetAssetMatch) {
      if (!(await requirePermission(request, response, "fleet:read"))) return;
      const assetId = decodeURIComponent(fleetAssetMatch[1]);
      const ledger = await readFleetLedger();
      const assets = enrichAssets(ledger.assets, ledger.checkouts, ledger.locations);
      const asset = assets.find(a => a.id === assetId);
      if (!asset) {
        sendJson(request, response, 404, { error: `Asset not found: ${assetId}` });
        return;
      }
      const history = ledger.checkouts
        .filter(c => c.assetId === assetId)
        .sort((a, b) => String(b.checkOutAt).localeCompare(String(a.checkOutAt)));
      const locations = ledger.locations
        .filter(l => l.assetId === assetId)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 20);
      sendJson(request, response, 200, { asset, history, locations });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/resolve-qr") {
      if (!(await requirePermission(request, response, "fleet:read"))) return;
      const body = await readBody(request);
      const assetId = parseAssetQrPayload(body.payload ?? body.qr ?? body.code);
      if (!assetId) {
        sendJson(request, response, 400, { error: "Unrecognized asset QR payload. Expected tsf:asset:<id>." });
        return;
      }
      const ledger = await readFleetLedger();
      const assets = enrichAssets(ledger.assets, ledger.checkouts, ledger.locations);
      const asset = assets.find(a => a.id === assetId);
      if (!asset) {
        sendJson(request, response, 404, { error: `Asset not found for QR: ${assetId}`, assetId });
        return;
      }
      sendJson(request, response, 200, { assetId, asset });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/checkout") {
      if (!(await requirePermission(request, response, "fleet:write"))) return;
      const body = await readBody(request);
      const assetId = body.assetId || parseAssetQrPayload(body.payload ?? body.qr);
      let before = null;
      let result = null;
      const next = await updatePlatformDoc(ROOT, "fleet", current => {
        const ledger = normalizeFleetDoc(current);
        before = ledger.assets.find(a => a.id === assetId) ?? null;
        result = applyCheckout(ledger, {
          ...body,
          assetId,
          signatureBy: body.signatureBy ?? request.adminSession?.id ?? null,
          method: body.method || "ios_scan"
        }, {
          idFactory: () => `co_${randomUUID()}`,
          now: new Date().toISOString()
        });
        if (!result.ok) return ledger;
        return {
          _note: "Fleet/asset checkout ledger (lib/fleet.mjs).",
          lastUpdated: new Date().toISOString(),
          eventId: ledger.eventId,
          assets: result.assets,
          checkouts: result.checkouts,
          locations: ledger.locations
        };
      }, { fallback: emptyFleetDoc() });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Checkout failed." });
        return;
      }
      await writeAuditRecord(request, "fleet.checkout", {
        type: "asset",
        id: result.asset.id
      }, before, result.asset, {
        checkoutId: result.checkout.id,
        checkedOutTo: result.checkout.checkedOutTo,
        team: result.checkout.team
      });
      sendJson(request, response, 200, {
        asset: enrichAssets([result.asset], result.checkouts, next.locations)[0],
        checkout: result.checkout,
        summary: summarizeFleet(next.assets, next.checkouts, next.locations, {
          eventId: next.eventId,
          generatedAt: next.lastUpdated
        })
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/checkin") {
      if (!(await requirePermission(request, response, "fleet:write"))) return;
      const body = await readBody(request);
      const assetId = body.assetId || parseAssetQrPayload(body.payload ?? body.qr);
      let before = null;
      let result = null;
      const next = await updatePlatformDoc(ROOT, "fleet", current => {
        const ledger = normalizeFleetDoc(current);
        before = ledger.assets.find(a => a.id === (assetId || body.assetId)) ?? null;
        result = applyCheckin(ledger, {
          ...body,
          assetId,
          signatureBy: body.signatureBy ?? request.adminSession?.id ?? null,
          method: body.method || "ios_scan"
        }, {
          now: new Date().toISOString()
        });
        if (!result.ok) return ledger;
        return {
          _note: "Fleet/asset checkout ledger (lib/fleet.mjs).",
          lastUpdated: new Date().toISOString(),
          eventId: ledger.eventId,
          assets: result.assets,
          checkouts: result.checkouts,
          locations: ledger.locations
        };
      }, { fallback: emptyFleetDoc() });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Check-in failed." });
        return;
      }
      await writeAuditRecord(request, "fleet.checkin", {
        type: "asset",
        id: result.checkout.assetId
      }, before, result.asset, {
        checkoutId: result.checkout.id,
        endCondition: result.checkout.endCondition,
        damageReport: result.checkout.damageReport
      });
      sendJson(request, response, 200, {
        asset: result.asset
          ? enrichAssets([result.asset], result.checkouts, next.locations)[0]
          : null,
        checkout: result.checkout,
        summary: summarizeFleet(next.assets, next.checkouts, next.locations, {
          eventId: next.eventId,
          generatedAt: next.lastUpdated
        })
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/fleet/locations") {
      if (!(await requirePermission(request, response, "fleet:write"))) return;
      const body = await readBody(request);
      let result = null;
      let notFound = false;
      const next = await updatePlatformDoc(ROOT, "fleet", current => {
        const ledger = normalizeFleetDoc(current);
        const assetId = String(body.assetId ?? "").trim();
        if (assetId && !ledger.assets.some(a => a.id === assetId)) {
          notFound = true;
          return ledger;
        }
        result = appendLocation(ledger.locations, body, {
          idFactory: () => `loc_${randomUUID()}`,
          now: new Date().toISOString()
        });
        if (!result.ok) return ledger;
        return {
          _note: "Fleet/asset checkout ledger (lib/fleet.mjs).",
          lastUpdated: new Date().toISOString(),
          eventId: ledger.eventId,
          assets: ledger.assets,
          checkouts: ledger.checkouts,
          locations: result.locations.slice(-500)
        };
      }, { fallback: emptyFleetDoc() });
      if (notFound) {
        sendJson(request, response, 404, { error: `Asset not found: ${String(body.assetId ?? "").trim()}` });
        return;
      }
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Location update failed." });
        return;
      }
      sendJson(request, response, 200, {
        location: result.location,
        lastUpdated: next.lastUpdated
      });
      return;
    }

    // Volunteer mirror / coverage (Phase 1). Buy VolunteerLocal; mirror into ops.
    if (method === "GET" && pathname === "/api/admin/volunteers") {
      if (!(await requirePermission(request, response, "volunteers:read"))) return;
      const mirror = await readVolunteerMirror();
      sendJson(request, response, 200, volunteerDashboardPayload(mirror));
      return;
    }

    if (method === "GET" && pathname === "/api/admin/volunteers/coverage") {
      if (!(await requirePermission(request, response, "volunteers:read"))) return;
      const mirror = await readVolunteerMirror();
      const payload = volunteerDashboardPayload(mirror);
      sendJson(request, response, 200, {
        lastUpdated: payload.lastUpdated,
        source: payload.source,
        summary: payload.summary,
        coverage: payload.coverage,
        understaffed: payload.summary.understaffed
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/volunteers/import") {
      const session = await requirePermission(request, response, "volunteers:write");
      if (!session) return;
      const body = await readBody(request, LARGE_CSV_IMPORT_BODY_BYTES);
      const mode = String(body.mode || "").trim().toLowerCase();
      if (!new Set(["preview", "commit"]).has(mode)) {
        sendJson(request, response, 400, { error: "Choose preview or commit for the VolunteerLocal import." });
        return;
      }
      if (body.currentEventConfirmed !== true) {
        sendJson(request, response, 400, { error: `Confirm that every selected file belongs to ${CURRENT_EVENT_ID}.` });
        return;
      }
      const bundle = {
        rosterCsv: body.rosterCsv,
        shiftsCsv: body.shiftsCsv,
        hoursCsv: body.hoursCsv
      };
      const parseDefaults = { eventId: CURRENT_EVENT_ID };
      const parsed = parseVolunteerLocalBundle(bundle, parseDefaults);
      if (!parsed.ok) {
        sendJson(request, response, 400, { error: parsed.error });
        return;
      }
      const fileNames = {
        roster: String(body.fileNames?.roster || "").trim().slice(0, 300) || null,
        shifts: String(body.fileNames?.shifts || "").trim().slice(0, 300) || null,
        hours: String(body.fileNames?.hours || "").trim().slice(0, 300) || null
      };
      if (mode === "preview") {
        const current = await readVolunteerMirror();
        const previewHash = volunteerLocalImportPreviewHash(bundle, {
          eventId: CURRENT_EVENT_ID,
          mirrorFingerprint: volunteerLocalMirrorFingerprint(current)
        });
        const result = applyVolunteerLocalImport(current, parsed, {
          actorId: session.id,
          previewHash,
          batchId: `preview_${previewHash.slice(0, 12)}`,
          fileNames,
          now: new Date().toISOString()
        });
        if (!result.ok) {
          sendJson(request, response, 400, { error: result.error });
          return;
        }
        sendJson(request, response, 200, { previewHash, ...volunteerImportResponse(result) });
        return;
      }
      const batchId = `volunteerlocal_import_${randomUUID()}`;
      const result = await mutateVolunteerMirror(parsed, {
        actorId: session.id,
        expectedPreviewHash: String(body.previewHash || ""),
        bundle,
        batchId,
        fileNames,
        now: new Date().toISOString()
      });
      if (!result?.ok) {
        sendJson(request, response, result?.previewMismatch ? 409 : 400, { error: result?.error || "VolunteerLocal data could not be imported." });
        return;
      }
      if (!result.replay) {
        await writeAuditRecord(request, "volunteers.import.commit", {
          type: "volunteerlocal_import",
          id: result.importRecord?.id || batchId
        }, null, result.importRecord, {
          eventId: CURRENT_EVENT_ID,
          previewHash: String(body.previewHash || "").slice(0, 16),
          summary: result.summary
        });
      }
      sendJson(request, response, result.changed ? 201 : 200, {
        batchId: result.importRecord?.id || batchId,
        previewHash: String(body.previewHash || ""),
        ...volunteerImportResponse(result)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/consent") {
      if (!(await requirePermission(request, response, "consent:read"))) return;
      const ledger = await readConsentLedger();
      const summary = summarizeConsent(ledger.records, {
        eventId: ledger.eventId,
        generatedAt: ledger.lastUpdated
      });
      const sms = smsConfigFromEnv(process.env);
      sendJson(request, response, 200, {
        lastUpdated: ledger.lastUpdated,
        summary,
        sms: publicSmsReadiness(sms),
        // Do not dump full PII lists to every admin UI load — counts + sample size only.
        recordCount: ledger.records.length,
        safetyRecipientCount: recipientsForChannel(ledger.records, "smsSafety").length,
        marketingEmailCount: recipientsForChannel(ledger.records, "emailMarketing").length,
        marketingSmsCount: recipientsForChannel(ledger.records, "smsMarketing").length
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/sms") {
      if (!(await requirePermission(request, response, "consent:read"))) return;
      const [operations, ledger] = await Promise.all([readSmsOperations(), readConsentLedger()]);
      const consentEventReady = ledger.eventId === CURRENT_EVENT_ID;
      sendJson(request, response, 200, {
        readiness: publicSmsReadiness(smsConfigFromEnv(process.env)),
        consentEventReady,
        eligibleSafetyRecipients: consentEventReady ? recipientsForChannel(ledger.records, "smsSafety").length : 0,
        ...smsOperationsAdminPayload(operations, { eventId: CURRENT_EVENT_ID })
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/passport") {
      if (!(await requirePermission(request, response, "passport:read"))) return;
      const huntDoc = await readPassportHunt();
      const completionDoc = await readPassportCompletions(huntDoc.hunt.id);
      const summary = summarizePassport(huntDoc.checkpoints, completionDoc.completions, huntDoc.hunt, {
        generatedAt: completionDoc.lastUpdated || huntDoc.lastUpdated
      });
      sendJson(request, response, 200, {
        lastUpdated: completionDoc.lastUpdated || huntDoc.lastUpdated,
        hunt: huntDoc.hunt,
        summary,
        checkpoints: huntDoc.checkpoints.map(publicCheckpoint)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/voting") {
      if (!(await requirePermission(request, response, "voting:read"))) return;
      const doc = await readPeoplesChoice();
      sendJson(request, response, 200, {
        lastUpdated: doc.lastUpdated,
        summary: summarizeVoting(doc.entries, doc.votes, {
          eventId: doc.eventId,
          votingOpen: doc.votingOpen,
          generatedAt: doc.lastUpdated
        }),
        votingOpen: doc.votingOpen,
        title: doc.title
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/booths") {
      if (!(await requirePermission(request, response, "booths:read"))) return;
      const map = await readBoothMap();
      sendJson(request, response, 200, {
        lastUpdated: map.lastUpdated,
        source: map.source,
        summary: summarizeBooths(map.booths, map.vendors),
        booths: enrichBooths(map.booths, map.vendors),
        imports: map.imports.slice().reverse()
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/booths/import") {
      const session = await requirePermission(request, response, "booths:write");
      if (!session) return;
      const body = await readBody(request, LARGE_CSV_IMPORT_BODY_BYTES);
      const mode = String(body.mode || "").trim().toLowerCase();
      if (!new Set(["preview", "commit"]).has(mode)) {
        sendJson(request, response, 400, { error: "Choose preview or commit for the Eventeny booth import." });
        return;
      }
      if (body.currentEventConfirmed !== true) {
        sendJson(request, response, 400, { error: `Confirm that the selected export belongs to ${CURRENT_EVENT_ID}.` });
        return;
      }
      const bundle = { csv: body.csv };
      const parsed = parseEventenyBoothCsv(bundle.csv, { eventId: CURRENT_EVENT_ID });
      if (!parsed.ok) {
        sendJson(request, response, 400, { error: parsed.error });
        return;
      }
      const fileName = String(body.fileName || "").trim().slice(0, 300) || null;
      if (mode === "preview") {
        const current = await readBoothMap();
        const previewHash = eventenyBoothImportPreviewHash(bundle, {
          eventId: CURRENT_EVENT_ID,
          mirrorFingerprint: eventenyBoothMirrorFingerprint(current)
        });
        const result = applyEventenyBoothImport(current, parsed, {
          actorId: session.id,
          previewHash,
          batchId: `preview_${previewHash.slice(0, 12)}`,
          fileName,
          now: new Date().toISOString()
        });
        if (!result.ok) {
          sendJson(request, response, 400, { error: result.error });
          return;
        }
        sendJson(request, response, 200, { previewHash, ...boothImportResponse(result) });
        return;
      }
      const batchId = `eventeny_booths_${randomUUID()}`;
      const result = await mutateBoothMap(parsed, {
        actorId: session.id,
        expectedPreviewHash: String(body.previewHash || ""),
        bundle,
        batchId,
        fileName,
        now: new Date().toISOString()
      });
      if (!result?.ok) {
        sendJson(request, response, result?.previewMismatch ? 409 : 400, { error: result?.error || "Eventeny booth data could not be imported." });
        return;
      }
      if (!result.replay) {
        await writeAuditRecord(request, "booths.import.commit", {
          type: "eventeny_booth_import",
          id: result.importRecord?.id || batchId
        }, null, result.importRecord, {
          eventId: CURRENT_EVENT_ID,
          previewHash: String(body.previewHash || "").slice(0, 16),
          summary: result.summary
        });
      }
      sendJson(request, response, result.changed ? 201 : 200, {
        batchId: result.importRecord?.id || batchId,
        previewHash: String(body.previewHash || ""),
        ...boothImportResponse(result)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/partners") {
      const session = await requirePermission(request, response, "partners:read");
      if (!session) return;
      const doc = await readPartnerOperations();
      const volunteerDirectory = hasPermission(session, "volunteers:read")
        ? (await readVolunteerMirror()).volunteers
          .filter(item => ASSIGNABLE_VOLUNTEER_STATUSES.has(item.status))
          .map(item => ({ id: item.id, name: item.name, roles: item.roles, status: item.status }))
        : [];
      const rawStaffDirectory = await readStaffDirectory();
      const staffDirectory = publicStaffAssignmentDirectory(rawStaffDirectory, { eventId: CURRENT_EVENT_ID });
      const email = emailConfigFromEnv();
      sendJson(request, response, 200, {
        lastUpdated: doc.lastUpdated,
        automationMode: doc.automationMode,
        automation: partnerAutomationReadiness(doc, { providerReady: email.ready && BREVO_WEBHOOK.ready }),
        summary: summarizePartnerOperations(doc),
        receivables: summarizePartnerReceivables(doc),
        taskBoard: summarizeTaskBoard(doc),
        assignmentDirectory: { teams: staffDirectory.teams, staff: staffDirectory.staff, volunteers: volunteerDirectory },
        staffDirectory: staffDirectoryReadiness(rawStaffDirectory, { eventId: CURRENT_EVENT_ID, production: SANDFEST_ENV === "production" }),
        applications: doc.applications.map(adminPartnerApplicationView),
        payments: doc.payments,
        paymentCheckouts: doc.paymentCheckouts,
        invoices: doc.invoices,
        milestones: doc.milestones,
        milestoneSummary: summarizePartnerMilestones(doc),
        followups: doc.followups.map(adminPartnerFollowupView),
        tasks: doc.tasks,
        brandProfiles: doc.brandProfiles,
        brandAssets: doc.brandAssets,
        deliverables: doc.deliverables,
        fulfillment: summarizeSponsorFulfillment(doc),
        vendorProfiles: doc.vendorProfiles,
        vendorRequirements: doc.vendorRequirements,
        vendorDocuments: doc.vendorDocuments,
        vendorAssignments: doc.vendorAssignments,
        vendorReadiness: summarizeVendorReadiness(doc),
        activity: doc.activity.slice(-200).reverse(),
        email: publicEmailReadiness(email),
        stripePartnerPayments: publicStripePartnerPaymentsReadiness(STRIPE_PARTNER_PAYMENTS),
        quickbooks: quickBooksReadiness()
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/partners/import") {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const body = await readBody(request);
      const mode = String(body.mode || "").trim().toLowerCase();
      if (!new Set(["preview", "commit"]).has(mode)) {
        sendJson(request, response, 400, { error: "Choose preview or commit for the Eventeny application import." });
        return;
      }
      const config = await storage.config.read("admin-config");
      const defaults = {
        eventId: CURRENT_EVENT_ID,
        defaultType: body.defaultType,
        transactionalContactConfirmed: body.transactionalContactConfirmed === true,
        catalogFingerprint: eventenyPartnerCatalogFingerprint(config)
      };
      const parsed = parseEventenyPartnerCsv(body.csv, defaults);
      if (!parsed.ok) {
        sendJson(request, response, 400, { error: parsed.error });
        return;
      }
      const previewHash = eventenyPartnerImportPreviewHash(body.csv, defaults);
      const commonOptions = {
        actorId: session.id,
        config,
        now: new Date().toISOString()
      };
      if (mode === "preview") {
        const result = applyEventenyPartnerImport(await readPartnerOperations(), parsed, {
          ...commonOptions,
          sourceBatch: `preview_${previewHash.slice(0, 12)}`,
          idFactory: prefix => `preview_${prefix}_${randomUUID()}`
        });
        sendJson(request, response, 200, { previewHash, ...eventenyPartnerImportResponse(result) });
        return;
      }
      if (String(body.previewHash || "") !== previewHash) {
        sendJson(request, response, 409, { error: "The CSV, event, application defaults, or active partner catalog changed. Preview the import again before committing." });
        return;
      }
      const batchId = `eventeny_partner_import_${randomUUID()}`;
      const result = await mutatePartnerOperations(doc => applyEventenyPartnerImport(doc, parsed, {
        ...commonOptions,
        commit: true,
        sourceBatch: batchId,
        idFactory: prefix => `${prefix}_${randomUUID()}`
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Eventeny applications could not be imported." });
        return;
      }
      await writeAuditRecord(request, "partner.application.import", {
        type: "partner_application_import",
        id: batchId
      }, null, {
        batchId,
        fileName: String(body.fileName || "").trim().slice(0, 300) || null,
        summary: result.summary
      });
      sendJson(request, response, result.changed ? 201 : 200, {
        batchId,
        previewHash,
        ...eventenyPartnerImportResponse(result)
      });
      return;
    }

    if (method === "PATCH" && pathname === "/api/admin/partners/automation") {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const body = await readBody(request);
      const email = emailConfigFromEnv();
      const automationProviderReady = email.ready && BREVO_WEBHOOK.ready;
      const beforeDoc = await readPartnerOperations();
      const result = await mutatePartnerOperations(doc => setPartnerAutomationMode(doc, body.mode, {
        actorId: session.id,
        providerReady: automationProviderReady,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.providerNotReady ? 409 : 400, {
          error: result?.error || "Partner automation could not be updated.",
          automation: partnerAutomationReadiness(beforeDoc, { providerReady: automationProviderReady }),
          email: publicEmailReadiness(email)
        });
        return;
      }
      await writeAuditRecord(
        request,
        "partner.automation.update",
        { type: "partnerAutomation", id: result.automation.policy },
        { mode: beforeDoc.automationMode },
        { mode: result.doc.automationMode },
        { returnedToReview: result.returnedToReview }
      );
      sendJson(request, response, 200, {
        changed: result.changed,
        returnedToReview: result.returnedToReview,
        automation: result.automation,
        email: publicEmailReadiness(email)
      });
      return;
    }

    const operationsExportMatch = pathname.match(/^\/api\/admin\/exports\/(partners\.csv|receivables\.csv|payments\.csv|tasks\.csv|outreach\.csv|milestones\.ics)$/);
    if (method === "GET" && operationsExportMatch) {
      const name = operationsExportMatch[1];
      const session = await requirePermission(request, response, operationsExportPermission(name));
      if (!session) return;
      const exported = buildOperationsExport(name, await readPartnerOperations());
      await writeAuditRecord(request, "operations.export.download", { type: "operationsExport", id: name }, null, null, {
        format: exported.format,
        rowCount: exported.rowCount
      });
      sendBinary(request, response, 200, exported.body, {
        contentType: exported.contentType,
        fileName: exported.fileName
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/outreach") {
      if (!(await requirePermission(request, response, "outreach:read"))) return;
      const doc = await readPartnerOperations();
      const outreachAutomationProviderReady = emailConfigFromEnv().ready && BREVO_WEBHOOK.ready;
      sendJson(request, response, 200, {
        lastUpdated: doc.lastUpdated,
        summary: summarizePartnerOperations(doc).outreach,
        prospects: doc.prospects,
        campaigns: doc.campaigns.map(campaign => ({
          ...campaign,
          metrics: outreachCampaignMetrics(doc, campaign),
          automation: outreachCampaignAutomationReadiness(doc, campaign, { providerReady: outreachAutomationProviderReady })
        })),
        followups: doc.followups.map(adminPartnerFollowupView),
        preferences: publicOutreachPreferencesReadiness(OUTREACH_PREFERENCES),
        discovery: publicOutreachDiscoveryReadiness(OUTREACH_DISCOVERY),
        sponsorInvitations: publicSponsorInvitationReadiness(SPONSOR_INVITATIONS)
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/outreach/discovery/preview") {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const body = await readBody(request);
      let discovery;
      try {
        discovery = await discoverOutreachBusinesses(body, { config: OUTREACH_DISCOVERY });
      } catch (error) {
        sendJson(request, response, 502, { error: error?.message || "Business discovery provider failed." });
        return;
      }
      if (!discovery.ok) {
        sendJson(request, response, OUTREACH_DISCOVERY.ready ? 400 : 503, {
          error: discovery.error,
          discovery: publicOutreachDiscoveryReadiness(OUTREACH_DISCOVERY)
        });
        return;
      }
      const preview = issueOutreachDiscoveryPreview(discovery, { config: OUTREACH_DISCOVERY });
      if (!preview.ok) {
        sendJson(request, response, 503, { error: preview.error });
        return;
      }
      await writeAuditRecord(request, "outreach.discovery.preview", { type: "outreach_discovery", id: OUTREACH_DISCOVERY.provider }, null, null, {
        provider: OUTREACH_DISCOVERY.provider,
        endpointHost: discovery.provider?.endpointHost || null,
        attemptCount: discovery.provider?.attemptCount || 1,
        categories: discovery.query.categories,
        radiusMiles: discovery.query.radiusMiles,
        candidateCount: discovery.candidates.length
      });
      sendJson(request, response, 200, {
        query: discovery.query,
        candidates: discovery.candidates,
        provider: discovery.provider || null,
        previewToken: preview.previewToken,
        expiresAt: preview.expiresAt,
        discovery: publicOutreachDiscoveryReadiness(OUTREACH_DISCOVERY)
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/outreach/discovery/import") {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const body = await readBody(request);
      const preview = verifyOutreachDiscoveryPreview(body.previewToken, { config: OUTREACH_DISCOVERY });
      if (!preview.ok) {
        sendJson(request, response, preview.expired ? 410 : 409, { error: preview.error });
        return;
      }
      const batchId = `outreach_discovery_${randomUUID()}`;
      const result = await mutatePartnerOperations(doc => applyOutreachDiscoveryImport(doc, preview.payload, body.selectedSourceRefs, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString(),
        batchId
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Selected businesses could not be imported." });
        return;
      }
      await writeAuditRecord(request, "outreach.discovery.import", { type: "outreach_discovery_import", id: batchId }, null, null, {
        provider: preview.payload.provider,
        batchId,
        summary: result.summary
      });
      sendJson(request, response, result.changed ? 201 : 200, {
        batchId,
        summary: result.summary,
        prospects: result.created,
        duplicates: result.duplicates,
        errors: result.errors
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/outreach/prospects/import") {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const body = await readBody(request);
      const mode = String(body.mode || "").trim().toLowerCase();
      if (!new Set(["preview", "commit"]).has(mode)) {
        sendJson(request, response, 400, { error: "Choose preview or commit for the prospect import." });
        return;
      }
      const parsed = parseOutreachProspectCsv(body.csv, body.defaults);
      if (!parsed.ok) {
        sendJson(request, response, 400, { error: parsed.error });
        return;
      }
      const previewHash = outreachImportPreviewHash(body.csv, body.defaults);
      if (mode === "preview") {
        const result = applyOutreachProspectImport(await readPartnerOperations(), parsed, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now: new Date().toISOString(),
          sourceBatch: `preview_${previewHash.slice(0, 12)}`
        });
        sendJson(request, response, 200, { previewHash, ...outreachImportResponse(result) });
        return;
      }
      if (String(body.previewHash || "") !== previewHash) {
        sendJson(request, response, 409, { error: "The CSV or import defaults changed. Preview the import again before committing." });
        return;
      }
      const batchId = `outreach_import_${randomUUID()}`;
      const result = await mutatePartnerOperations(doc => applyOutreachProspectImport(doc, parsed, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString(),
        sourceBatch: batchId
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Prospects could not be imported." });
        return;
      }
      await writeAuditRecord(request, "outreach.prospect.import", { type: "outreach_import", id: batchId }, null, {
        batchId,
        summary: result.summary
      });
      sendJson(request, response, result.changed ? 201 : 200, {
        batchId,
        previewHash,
        ...outreachImportResponse(result)
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/outreach/prospects") {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const body = await readBody(request);
      const result = await mutatePartnerOperations(doc => createOutreachProspect(doc, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Prospect could not be created." });
        return;
      }
      await writeAuditRecord(request, "outreach.prospect.create", { type: "prospect", id: result.prospect.id }, null, result.prospect);
      sendJson(request, response, 201, { prospect: result.prospect });
      return;
    }

    const outreachProspectMatch = pathname.match(/^\/api\/admin\/outreach\/prospects\/([^/]+)$/);
    if (method === "PATCH" && outreachProspectMatch) {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const prospectId = decodeURIComponent(outreachProspectMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.prospects.find(item => item.id === prospectId) ?? null;
      const result = await mutatePartnerOperations(doc => updateOutreachProspect(doc, prospectId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Prospect not found." ? 404 : 400, { error: result?.error || "Prospect could not be updated." });
        return;
      }
      await writeAuditRecord(request, result.prospect.suppressedAt ? "outreach.prospect.suppress" : "outreach.prospect.update", { type: "prospect", id: prospectId }, before, result.prospect);
      sendJson(request, response, 200, { prospect: result.prospect });
      return;
    }

    const outreachInvitationMatch = pathname.match(/^\/api\/admin\/outreach\/prospects\/([^/]+)\/sponsor-invitation$/);
    if (method === "POST" && outreachInvitationMatch) {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const prospectId = decodeURIComponent(outreachInvitationMatch[1]);
      const body = await readBody(request);
      const action = String(body.action || "issue").trim().toLowerCase();
      if (!new Set(["issue", "copy", "revoke"]).has(action)) {
        sendJson(request, response, 400, { error: "Choose issue, copy, or revoke for the sponsor invitation." });
        return;
      }
      if (action === "copy") {
        const doc = await readPartnerOperations();
        const prospect = doc.prospects.find(item => item.id === prospectId);
        if (!prospect) {
          sendJson(request, response, 404, { error: "Prospect not found." });
          return;
        }
        if (!prospect.sponsorInvitation || prospect.convertedApplicationId) {
          sendJson(request, response, 400, { error: prospect.convertedApplicationId ? "Prospect is already linked to a sponsor application." : "Issue a sponsor invitation first." });
          return;
        }
        const invitationUrl = sponsorInvitationUrlForProspect(prospect, { config: SPONSOR_INVITATIONS });
        const token = invitationUrl ? new URLSearchParams(new URL(invitationUrl).hash.split("?")[1] || "").get("token") : null;
        const access = verifySponsorInvitationToken(doc, token, { config: SPONSOR_INVITATIONS });
        if (!access.ok) {
          sendJson(request, response, access.expired ? 410 : 400, { error: access.error || "Sponsor invitation is no longer active." });
          return;
        }
        await writeAuditRecord(request, "outreach.sponsor_invitation.copy", { type: "prospect", id: prospectId }, null, null, {
          packageId: prospect.sponsorInvitation.packageId,
          invitationVersion: prospect.sponsorInvitation.version
        });
        sendJson(request, response, 200, {
          changed: false,
          prospect,
          invitation: {
            packageId: prospect.sponsorInvitation.packageId,
            packageName: prospect.sponsorInvitation.packageName,
            version: prospect.sponsorInvitation.version,
            issuedAt: prospect.sponsorInvitation.issuedAt,
            expiresAt: prospect.sponsorInvitation.expiresAt,
            url: invitationUrl
          },
          refreshedDrafts: 0,
          dismissedDrafts: 0
        });
        return;
      }
      let sponsorPackage = null;
      if (action === "issue") {
        const config = await storage.config.read("admin-config");
        const resolvedPackage = resolveSponsorPackage(config, body.packageId);
        if (!resolvedPackage.ok) {
          sendJson(request, response, 400, { error: "Choose an active sponsorship package." });
          return;
        }
        sponsorPackage = resolvedPackage.sponsorPackage;
      }
      const result = await mutatePartnerOperations(doc => action === "issue"
        ? createOutreachSponsorInvitation(doc, prospectId, sponsorPackage, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now: new Date().toISOString(),
          invitationUrlForProspect: prospect => sponsorInvitationUrlForProspect(prospect, { config: SPONSOR_INVITATIONS })
        })
        : revokeOutreachSponsorInvitation(doc, prospectId, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now: new Date().toISOString()
        }));
      if (!result?.ok) {
        sendJson(request, response, result?.providerNotReady ? 503 : result?.error === "Prospect not found." ? 404 : 400, { error: result?.error || "Sponsor invitation could not be updated." });
        return;
      }
      await writeAuditRecord(request, `outreach.sponsor_invitation.${action === "issue" ? "issue" : "revoke"}`, { type: "prospect", id: prospectId }, null, null, {
        packageId: sponsorPackage?.id || null,
        invitationVersion: result.invitation?.version || null,
        refreshedDrafts: result.refreshedDrafts || 0,
        dismissedDrafts: result.dismissedDrafts || 0
      });
      sendJson(request, response, 200, {
        changed: result.changed !== false,
        prospect: result.prospect,
        invitation: result.invitation ? {
          packageId: result.invitation.packageId,
          packageName: result.invitation.packageName,
          version: result.invitation.version,
          issuedAt: result.invitation.issuedAt,
          expiresAt: result.invitation.expiresAt,
          url: result.invitationUrl
        } : null,
        refreshedDrafts: result.refreshedDrafts || 0,
        dismissedDrafts: result.dismissedDrafts || 0
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/outreach/campaigns") {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const body = await readBody(request);
      const result = await mutatePartnerOperations(doc => createOutreachCampaign(doc, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Campaign could not be created." });
        return;
      }
      await writeAuditRecord(request, "outreach.campaign.create", { type: "campaign", id: result.campaign.id }, null, result.campaign);
      sendJson(request, response, 201, { campaign: result.campaign });
      return;
    }

    const outreachCampaignActionMatch = pathname.match(/^\/api\/admin\/outreach\/campaigns\/([^/]+)\/(activate|pause|complete|archive)$/);
    if (method === "POST" && outreachCampaignActionMatch) {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const campaignId = decodeURIComponent(outreachCampaignActionMatch[1]);
      const action = outreachCampaignActionMatch[2];
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.campaigns.find(item => item.id === campaignId) ?? null;
      const outreachAutomationProviderReady = emailConfigFromEnv().ready && BREVO_WEBHOOK.ready;
      const now = new Date().toISOString();
      const result = await mutatePartnerOperations(doc => {
        const lifecycle = updateOutreachCampaignStatus(doc, campaignId, action, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now,
          providerReady: outreachAutomationProviderReady
        });
        if (!lifecycle.ok || action !== "activate") return lifecycle;
        const generation = generateDueOutreachFollowups(lifecycle.doc, {
          campaignId,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now,
          preferenceUrlForProspect: prospect => outreachPreferenceUrlForProspect(prospect, { config: OUTREACH_PREFERENCES }),
          sponsorInvitationUrlForProspect: prospect => sponsorInvitationUrlForProspect(prospect, { config: SPONSOR_INVITATIONS })
        });
        return { ...lifecycle, doc: generation.doc, generated: generation.generated };
      });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Campaign not found." ? 404 : result?.providerNotReady ? 409 : 400, { error: result?.error || "Campaign status could not be changed." });
        return;
      }
      await writeAuditRecord(request, `outreach.campaign.${action}`, { type: "campaign", id: campaignId }, before, result.campaign, {
        returnedToReview: result.returnedToReview,
        dismissedFollowups: result.dismissedFollowups,
        failedHeldForRetry: result.failedHeldForRetry,
        inFlightFollowups: result.inFlightFollowups,
        generated: result.generated?.length || 0
      });
      sendJson(request, response, 200, {
        campaign: result.campaign,
        returnedToReview: result.returnedToReview,
        dismissedFollowups: result.dismissedFollowups,
        failedHeldForRetry: result.failedHeldForRetry,
        inFlightFollowups: result.inFlightFollowups,
        generated: result.generated?.length || 0,
        automation: outreachCampaignAutomationReadiness(result.doc, result.campaign, { providerReady: outreachAutomationProviderReady })
      });
      return;
    }

    const outreachCampaignGenerateMatch = pathname.match(/^\/api\/admin\/outreach\/campaigns\/([^/]+)\/generate$/);
    if (method === "POST" && outreachCampaignGenerateMatch) {
      const session = await requirePermission(request, response, "outreach:write");
      if (!session) return;
      const campaignId = decodeURIComponent(outreachCampaignGenerateMatch[1]);
      const beforeDoc = await readPartnerOperations();
      if (!beforeDoc.campaigns.some(item => item.id === campaignId)) {
        sendJson(request, response, 404, { error: "Campaign not found." });
        return;
      }
      const result = await mutatePartnerOperations(doc => generateDueOutreachFollowups(doc, {
        campaignId,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString(),
        preferenceUrlForProspect: prospect => outreachPreferenceUrlForProspect(prospect, { config: OUTREACH_PREFERENCES }),
        sponsorInvitationUrlForProspect: prospect => sponsorInvitationUrlForProspect(prospect, { config: SPONSOR_INVITATIONS })
      }));
      await writeAuditRecord(request, "outreach.campaign.generate", { type: "campaign", id: campaignId }, null, { generated: result.generated.length });
      sendJson(request, response, 200, { generated: result.generated.length, followups: result.generated });
      return;
    }

    const partnerApplicationMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)$/);
    if (method === "PATCH" && partnerApplicationMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const applicationId = decodeURIComponent(partnerApplicationMatch[1]);
      const body = await readBody(request);
      if (Object.hasOwn(body, "expectedAmountCents") && !hasPermission(session, "finance:write")) {
        sendJson(request, response, 403, {
          error: "Changing an approved application amount requires finance:write.",
          requiredPermission: "finance:write"
        });
        return;
      }
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.applications.find(item => item.id === applicationId) ?? null;
      const result = await mutatePartnerOperations(doc => updatePartnerApplication(doc, applicationId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Application could not be updated." });
        return;
      }
      await writeAuditRecord(
        request,
        "partner.application.update",
        { type: "application", id: applicationId },
        before ? adminPartnerApplicationView(before) : null,
        adminPartnerApplicationView(result.application)
      );
      sendJson(request, response, 200, { application: adminPartnerApplicationView(result.application) });
      return;
    }

    const partnerPortalAccessMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/portal-access$/);
    if (method === "POST" && partnerPortalAccessMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const portalConfig = partnerPortalConfig();
      if (!portalConfig.ready) {
        sendJson(request, response, 503, { error: portalConfig.reason || "Partner portal is unavailable." });
        return;
      }
      const applicationId = decodeURIComponent(partnerPortalAccessMatch[1]);
      const result = await mutatePartnerOperations(doc => rotatePartnerPortalAccess(doc, applicationId, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        portalAccessIdFactory: () => randomUUID(),
        portalUrlForApplication: application => {
          const token = issuePartnerPortalToken(application, { config: portalConfig });
          return partnerPortalUrl(application, token, { config: portalConfig });
        },
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Portal access could not be rotated." });
        return;
      }
      const token = issuePartnerPortalToken(result.application, { config: portalConfig });
      const portalAccess = {
        token,
        path: partnerPortalPath(result.application, token),
        url: partnerPortalUrl(result.application, token, { config: portalConfig }),
        ...adminPartnerPortalAccess(result.application)
      };
      await writeAuditRecord(
        request,
        "partner.portal_access.rotate",
        { type: "application", id: applicationId },
        null,
        { issuedAt: portalAccess.issuedAt, version: portalAccess.version, refreshedFollowups: result.refreshedFollowups }
      );
      sendJson(request, response, 200, { application: adminPartnerApplicationView(result.application), portalAccess });
      return;
    }

    const partnerPaymentMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/payments$/);
    if (method === "POST" && partnerPaymentMatch) {
      const session = await requirePermission(request, response, "finance:write");
      if (!session) return;
      const applicationId = decodeURIComponent(partnerPaymentMatch[1]);
      const body = await readBody(request);
      const result = await mutatePartnerOperations(doc => recordPartnerPayment(doc, applicationId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Payment could not be recorded." });
        return;
      }
      if (!result.duplicate) {
        await writeAuditRecord(request, "partner.payment.record", { type: "payment", id: result.payment.id }, null, result.payment, { applicationId, totalPaidCents: result.totalPaidCents });
      }
      sendJson(request, response, result.duplicate ? 200 : 201, { payment: result.payment, totalPaidCents: result.totalPaidCents, duplicate: result.duplicate === true });
      return;
    }

    const partnerPaymentReverseMatch = pathname.match(/^\/api\/admin\/partners\/payments\/([^/]+)\/reverse$/);
    if (method === "POST" && partnerPaymentReverseMatch) {
      const session = await requirePermission(request, response, "finance:write");
      if (!session) return;
      const paymentId = decodeURIComponent(partnerPaymentReverseMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.payments.find(item => item.id === paymentId) ?? null;
      const result = await mutatePartnerOperations(doc => reversePartnerPayment(doc, paymentId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Payment not found." ? 404 : 400, { error: result?.error || "Payment could not be reversed." });
        return;
      }
      await writeAuditRecord(request, `partner.payment.${body.action === "refund" ? "refund" : "void"}`, { type: "payment", id: paymentId }, before, result.payment, {
        applicationId: result.payment.applicationId,
        invoiceId: result.payment.invoiceId,
        totalPaidCents: result.totalPaidCents
      });
      sendJson(request, response, 200, { payment: result.payment, invoice: result.invoice, totalPaidCents: result.totalPaidCents });
      return;
    }

    const partnerBrandProfileReviewMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/brand-profile\/review$/);
    if (method === "POST" && partnerBrandProfileReviewMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const applicationId = decodeURIComponent(partnerBrandProfileReviewMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.brandProfiles.find(item => item.applicationId === applicationId) ?? null;
      const result = await mutatePartnerOperations(doc => reviewPartnerBrandProfile(doc, applicationId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Brand profile not found." ? 404 : 400, { error: result?.error || "Brand profile review could not be saved." });
        return;
      }
      await writeAuditRecord(request, `partner.brand_profile.${result.profile.status}`, { type: "application", id: applicationId }, before, result.profile);
      sendJson(request, response, 200, { profile: result.profile });
      return;
    }

    const partnerBrandAssetMatch = pathname.match(/^\/api\/admin\/partners\/brand-assets\/([^/]+)$/);
    if (method === "PATCH" && partnerBrandAssetMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const assetId = decodeURIComponent(partnerBrandAssetMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.brandAssets.find(item => item.id === assetId) ?? null;
      const result = await mutatePartnerOperations(doc => reviewPartnerBrandAsset(doc, assetId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Brand asset not found." ? 404 : 400, { error: result?.error || "Brand asset review could not be saved." });
        return;
      }
      await writeAuditRecord(request, `partner.brand_asset.${result.asset.status}`, { type: "brand_asset", id: assetId }, before, result.asset);
      sendJson(request, response, 200, { asset: result.asset });
      return;
    }

    const adminBrandAssetContentMatch = pathname.match(/^\/api\/admin\/partners\/brand-assets\/([^/]+)\/content$/);
    if (method === "GET" && adminBrandAssetContentMatch) {
      if (!(await requirePermission(request, response, "partners:read"))) return;
      const assetId = decodeURIComponent(adminBrandAssetContentMatch[1]);
      const doc = await readPartnerOperations();
      const asset = doc.brandAssets.find(item => item.id === assetId && item.sourceType === "upload" && item.status !== "archived");
      if (!asset) {
        sendJson(request, response, 404, { error: "Uploaded brand asset not found." });
        return;
      }
      const stored = await readPartnerAssetUpload(ROOT, asset.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: stored.error });
        return;
      }
      sendBinary(request, response, 200, stored.buffer, { contentType: asset.contentType, fileName: partnerAssetDownloadName(asset) });
      return;
    }

    const partnerDeliverableCreateMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/deliverables$/);
    if (method === "POST" && partnerDeliverableCreateMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const applicationId = decodeURIComponent(partnerDeliverableCreateMatch[1]);
      const body = await readBody(request);
      const result = await mutatePartnerOperations(doc => createPartnerDeliverable(doc, applicationId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Deliverable could not be created." });
        return;
      }
      await writeAuditRecord(request, "partner.deliverable.create", { type: "deliverable", id: result.deliverable.id }, null, result.deliverable);
      sendJson(request, response, 201, { deliverable: result.deliverable });
      return;
    }

    const partnerDeliverableMatch = pathname.match(/^\/api\/admin\/partners\/deliverables\/([^/]+)$/);
    if (method === "PATCH" && partnerDeliverableMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const deliverableId = decodeURIComponent(partnerDeliverableMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.deliverables.find(item => item.id === deliverableId) ?? null;
      const result = await mutatePartnerOperations(doc => updatePartnerDeliverable(doc, deliverableId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Deliverable not found." ? 404 : 400, { error: result?.error || "Deliverable could not be updated." });
        return;
      }
      await writeAuditRecord(request, "partner.deliverable.update", { type: "deliverable", id: deliverableId }, before, result.deliverable);
      sendJson(request, response, 200, { deliverable: result.deliverable });
      return;
    }

    const vendorProfileReviewMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/vendor-profile\/review$/);
    if (method === "POST" && vendorProfileReviewMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const applicationId = decodeURIComponent(vendorProfileReviewMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.vendorProfiles.find(item => item.applicationId === applicationId) ?? null;
      const result = await mutatePartnerOperations(doc => {
        const application = doc.applications.find(item => item.id === applicationId);
        return reviewVendorProfile(doc, applicationId, body, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          portalUrl: currentPartnerPortalUrl(application),
          now: new Date().toISOString()
        });
      });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Vendor profile not found." ? 404 : 400, { error: result?.error || "Vendor profile review could not be saved." });
        return;
      }
      await writeAuditRecord(request, `partner.vendor_profile.${result.profile.status}`, { type: "application", id: applicationId }, before, result.profile);
      sendJson(request, response, 200, { profile: result.profile, followup: result.followup, notificationDrafted: result.followupChanged });
      return;
    }

    const vendorRequirementMatch = pathname.match(/^\/api\/admin\/partners\/vendor-requirements\/([^/]+)$/);
    if (method === "PATCH" && vendorRequirementMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const requirementId = decodeURIComponent(vendorRequirementMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.vendorRequirements.find(item => item.id === requirementId) ?? null;
      const result = await mutatePartnerOperations(doc => {
        const requirement = doc.vendorRequirements.find(item => item.id === requirementId);
        const application = doc.applications.find(item => item.id === requirement?.applicationId);
        return reviewVendorRequirement(doc, requirementId, body, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          portalUrl: currentPartnerPortalUrl(application),
          now: new Date().toISOString()
        });
      });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Vendor requirement not found." ? 404 : 400, { error: result?.error || "Vendor requirement review could not be saved." });
        return;
      }
      await writeAuditRecord(request, `partner.vendor_requirement.${result.requirement.status}`, { type: "vendor_requirement", id: requirementId }, before, result.requirement);
      sendJson(request, response, 200, { requirement: result.requirement, followup: result.followup, notificationDrafted: result.followupChanged });
      return;
    }

    const adminVendorDocumentContentMatch = pathname.match(/^\/api\/admin\/partners\/vendor-documents\/([^/]+)\/content$/);
    if (method === "GET" && adminVendorDocumentContentMatch) {
      if (!(await requirePermission(request, response, "partners:read"))) return;
      const documentId = decodeURIComponent(adminVendorDocumentContentMatch[1]);
      const doc = await readPartnerOperations();
      const document = doc.vendorDocuments.find(item => item.id === documentId && item.sourceType === "upload" && !["superseded", "archived"].includes(item.status));
      if (!document) {
        sendJson(request, response, 404, { error: "Uploaded vendor document not found." });
        return;
      }
      const stored = await readPartnerAssetUpload(ROOT, document.storageKey, { config: PARTNER_ASSET_STORAGE });
      if (!stored.ok) {
        sendJson(request, response, 404, { error: stored.error });
        return;
      }
      sendBinary(request, response, 200, stored.buffer, { contentType: document.contentType, fileName: partnerAssetDownloadName(document) });
      return;
    }

    const vendorAssignmentMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/vendor-assignment$/);
    if (method === "PATCH" && vendorAssignmentMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const applicationId = decodeURIComponent(vendorAssignmentMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.vendorAssignments.find(item => item.applicationId === applicationId) ?? null;
      const result = await mutatePartnerOperations(doc => {
        const application = doc.applications.find(item => item.id === applicationId);
        return updateVendorAssignment(doc, applicationId, body, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          portalUrl: currentPartnerPortalUrl(application),
          now: new Date().toISOString()
        });
      });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Vendor assignment could not be saved." });
        return;
      }
      await writeAuditRecord(request, "partner.vendor_assignment.update", { type: "vendor_assignment", id: result.assignment.id }, before, result.assignment);
      sendJson(request, response, 200, { assignment: result.assignment, followup: result.followup, notificationDrafted: result.followupChanged });
      return;
    }

    const partnerInvoiceCreateMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/invoices$/);
    if (method === "POST" && partnerInvoiceCreateMatch) {
      const session = await requirePermission(request, response, "finance:write");
      if (!session) return;
      const applicationId = decodeURIComponent(partnerInvoiceCreateMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const application = beforeDoc.applications.find(item => item.id === applicationId);
      if (!application) {
        sendJson(request, response, 404, { error: "Application not found." });
        return;
      }
      const quickBooksItemId = await quickBooksItemForApplication(application);
      const result = await mutatePartnerOperations(doc => createPartnerInvoice(doc, applicationId, {
        dueAt: body.dueAt,
        description: body.description,
        quickBooksItemId
      }, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Invoice could not be created." });
        return;
      }
      await writeAuditRecord(request, "partner.invoice.create", { type: "invoice", id: result.invoice.id }, null, result.invoice);
      sendJson(request, response, 201, { invoice: result.invoice, quickbooks: quickBooksReadiness() });
      return;
    }

    const partnerInvoiceReviewMatch = pathname.match(/^\/api\/admin\/partners\/invoices\/([^/]+)\/review$/);
    if (method === "POST" && partnerInvoiceReviewMatch) {
      const session = await requirePermission(request, response, "finance:write");
      if (!session) return;
      const invoiceId = decodeURIComponent(partnerInvoiceReviewMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.invoices.find(item => item.id === invoiceId) ?? null;
      const result = await mutatePartnerOperations(doc => reviewPartnerInvoice(doc, invoiceId, body.action, {
        actorId: session.id,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Invoice not found." ? 404 : 400, { error: result?.error || "Invoice could not be reviewed." });
        return;
      }
      await writeAuditRecord(request, `partner.invoice.${body.action}`, { type: "invoice", id: invoiceId }, before, result.invoice);
      sendJson(request, response, 200, { invoice: result.invoice, quickbooks: quickBooksReadiness() });
      return;
    }

    const partnerInvoiceSyncMatch = pathname.match(/^\/api\/admin\/partners\/invoices\/([^/]+)\/sync$/);
    if (method === "POST" && partnerInvoiceSyncMatch) {
      const session = await requirePermission(request, response, "finance:write");
      if (!session) return;
      const invoiceId = decodeURIComponent(partnerInvoiceSyncMatch[1]);
      const readiness = quickBooksReadiness();
      if (!readiness.canSyncPartnerInvoices) {
        sendJson(request, response, 409, { error: readiness.reason || "QuickBooks invoice sync is not ready.", quickbooks: readiness });
        return;
      }
      const beforeDoc = await readPartnerOperations();
      const invoice = beforeDoc.invoices.find(item => item.id === invoiceId);
      const application = invoice ? beforeDoc.applications.find(item => item.id === invoice.applicationId) : null;
      const quickBooksItemId = application ? await quickBooksItemForApplication(application) : null;
      const result = await mutatePartnerOperations(doc => queuePartnerInvoiceSync(doc, invoiceId, {
        now: new Date().toISOString(),
        quickBooksItemId
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Invoice not found." ? 404 : 400, { error: result?.error || "Invoice could not be queued." });
        return;
      }
      let job;
      try {
        job = await enqueueJob(ROOT, { type: "quickbooks.partner_invoice.sync", payload: { invoiceId }, maxAttempts: 5 });
      } catch (error) {
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const doc = normalizePartnerOperations(current);
          const invoices = doc.invoices.map(item => item.id === invoiceId ? {
            ...item, status: "failed", lastError: `Queue failure: ${String(error.message).slice(0, 500)}`, updatedAt: new Date().toISOString()
          } : item);
          return { ...doc, lastUpdated: new Date().toISOString(), invoices };
        }, { fallback: emptyPartnerOperations() });
        throw error;
      }
      await writeAuditRecord(request, "partner.invoice.queue", { type: "invoice", id: invoiceId }, null, result.invoice, { jobId: job.id, provider: "quickbooks" });
      sendJson(request, response, 202, { invoice: result.invoice, job: { id: job.id, status: job.status }, quickbooks: readiness });
      return;
    }

    const partnerInvoiceReconcileMatch = pathname.match(/^\/api\/admin\/partners\/invoices\/([^/]+)\/reconcile$/);
    if (method === "POST" && partnerInvoiceReconcileMatch) {
      const session = await requirePermission(request, response, "finance:write");
      if (!session) return;
      const invoiceId = decodeURIComponent(partnerInvoiceReconcileMatch[1]);
      const readiness = quickBooksReadiness();
      if (!readiness.canSyncPartnerInvoices) {
        sendJson(request, response, 409, { error: readiness.reason || "QuickBooks invoice reconciliation is not ready.", quickbooks: readiness });
        return;
      }
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.invoices.find(item => item.id === invoiceId) ?? null;
      const result = await mutatePartnerOperations(doc => queuePartnerInvoiceReconciliation(doc, invoiceId, {
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Invoice not found." ? 404 : 400, { error: result?.error || "Invoice could not be refreshed." });
        return;
      }
      const reconciliationVersion = result.invoice.quickBooksReconciliationVersion;
      let job;
      try {
        job = await enqueueJob(ROOT, {
          type: "quickbooks.partner_invoice.reconcile",
          payload: { invoiceId, reconciliationVersion },
          maxAttempts: 5,
          idempotencyKey: `${invoiceId}:${reconciliationVersion}`
        });
      } catch (error) {
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const recorded = recordPartnerInvoiceReconciliation(current, invoiceId, {
            ok: false,
            error: `Queue failure: ${String(error.message).slice(0, 500)}`
          }, { terminal: true });
          return recorded.ok ? recorded.doc : normalizePartnerOperations(current);
        }, { fallback: emptyPartnerOperations() });
        throw error;
      }
      await writeAuditRecord(request, "partner.invoice.reconcile.queue", { type: "invoice", id: invoiceId }, before, result.invoice, {
        jobId: job.id,
        provider: "quickbooks",
        reconciliationVersion
      });
      sendJson(request, response, 202, { invoice: result.invoice, job: { id: job.id, status: job.status }, quickbooks: readiness });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/partners/tasks") {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const body = await readBody(request);
      const assignment = await enrichTaskAssignment(body);
      if (!assignment.ok) {
        sendJson(request, response, 400, { error: assignment.error });
        return;
      }
      const result = await mutatePartnerOperations(doc => createPartnerTask(doc, assignment.input, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Task could not be created." });
        return;
      }
      await writeAuditRecord(request, "partner.task.create", { type: "task", id: result.task.id }, null, result.task);
      sendJson(request, response, 201, { task: result.task });
      return;
    }

    const partnerTaskMatch = pathname.match(/^\/api\/admin\/partners\/tasks\/([^/]+)$/);
    if (method === "PATCH" && partnerTaskMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const taskId = decodeURIComponent(partnerTaskMatch[1]);
      const body = await readBody(request);
      const assignment = await enrichTaskAssignment(body);
      if (!assignment.ok) {
        sendJson(request, response, 400, { error: assignment.error });
        return;
      }
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.tasks.find(item => item.id === taskId) ?? null;
      const result = await mutatePartnerOperations(doc => updatePartnerTask(doc, taskId, assignment.input, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Task not found." ? 404 : 400, { error: result?.error || "Task could not be updated." });
        return;
      }
      await writeAuditRecord(request, "partner.task.update", { type: "task", id: taskId }, before, result.task);
      sendJson(request, response, 200, { task: result.task });
      return;
    }

    const partnerMilestoneCreateMatch = pathname.match(/^\/api\/admin\/partners\/applications\/([^/]+)\/milestones$/);
    if (method === "POST" && partnerMilestoneCreateMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const applicationId = decodeURIComponent(partnerMilestoneCreateMatch[1]);
      const body = await readBody(request);
      const result = await mutatePartnerOperations(doc => createPartnerMilestone(doc, applicationId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Application not found." ? 404 : 400, { error: result?.error || "Milestone could not be created." });
        return;
      }
      await writeAuditRecord(request, "partner.milestone.create", { type: "milestone", id: result.milestone.id }, null, result.milestone, { applicationId });
      sendJson(request, response, 201, { milestone: result.milestone });
      return;
    }

    const partnerMilestoneMatch = pathname.match(/^\/api\/admin\/partners\/milestones\/([^/]+)$/);
    if (method === "PATCH" && partnerMilestoneMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const milestoneId = decodeURIComponent(partnerMilestoneMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.milestones.find(item => item.id === milestoneId) ?? null;
      const result = await mutatePartnerOperations(doc => updatePartnerMilestone(doc, milestoneId, body, {
        actorId: session.id,
        idFactory: prefix => `${prefix}_${randomUUID()}`,
        now: new Date().toISOString()
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Milestone not found." ? 404 : 400, { error: result?.error || "Milestone could not be updated." });
        return;
      }
      await writeAuditRecord(request, "partner.milestone.update", { type: "milestone", id: milestoneId }, before, result.milestone, { dismissedFollowups: result.dismissedFollowups });
      sendJson(request, response, 200, { milestone: result.milestone, dismissedFollowups: result.dismissedFollowups });
      return;
    }

    const partnerFollowupReviewMatch = pathname.match(/^\/api\/admin\/partners\/followups\/([^/]+)\/review$/);
    if (method === "POST" && partnerFollowupReviewMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const followupId = decodeURIComponent(partnerFollowupReviewMatch[1]);
      const body = await readBody(request);
      const beforeDoc = await readPartnerOperations();
      const before = beforeDoc.followups.find(item => item.id === followupId) ?? null;
      const recipientContext = await taskRecipientContext();
      const result = await mutatePartnerOperations(doc => reviewFollowup(doc, followupId, body.action, {
        actorId: session.id,
        now: new Date().toISOString(),
        ...recipientContext
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Follow-up not found." ? 404 : 400, { error: result?.error || "Follow-up could not be reviewed." });
        return;
      }
      await writeAuditRecord(request, `partner.followup.${body.action}`, { type: "followup", id: followupId }, adminPartnerFollowupView(before), adminPartnerFollowupView(result.followup));
      sendJson(request, response, 200, { followup: adminPartnerFollowupView(result.followup), email: publicEmailReadiness() });
      return;
    }

    const partnerFollowupSendMatch = pathname.match(/^\/api\/admin\/partners\/followups\/([^/]+)\/send$/);
    if (method === "POST" && partnerFollowupSendMatch) {
      const session = await requirePermission(request, response, "partners:write");
      if (!session) return;
      const followupId = decodeURIComponent(partnerFollowupSendMatch[1]);
      const email = emailConfigFromEnv();
      if (!email.ready) {
        sendJson(request, response, 409, { error: email.reason || "Transactional email is not ready.", email: publicEmailReadiness(email) });
        return;
      }
      const recipientContext = await taskRecipientContext();
      const result = await mutatePartnerOperations(doc => queueFollowupDelivery(doc, followupId, {
        now: new Date().toISOString(),
        ...recipientContext
      }));
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Follow-up not found." ? 404 : 400, { error: result?.error || "Follow-up could not be queued." });
        return;
      }
      let job;
      try {
        job = await enqueueJob(ROOT, { type: "partner.followup.send", payload: { followupId }, maxAttempts: 5 });
      } catch (error) {
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const doc = normalizePartnerOperations(current);
          const followups = doc.followups.map(item => item.id === followupId ? {
            ...item, status: "failed", lastError: `Queue failure: ${String(error.message).slice(0, 500)}`, updatedAt: new Date().toISOString()
          } : item);
          return { ...doc, lastUpdated: new Date().toISOString(), followups };
        }, { fallback: emptyPartnerOperations() });
        throw error;
      }
      await writeAuditRecord(request, "partner.followup.queue", { type: "followup", id: followupId }, null, adminPartnerFollowupView(result.followup), { jobId: job.id, provider: email.provider });
      sendJson(request, response, 202, { followup: adminPartnerFollowupView(result.followup), job: { id: job.id, status: job.status }, email: publicEmailReadiness(email) });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/island-conditions") {
      const session = await requirePermission(request, response, "conditions:read");
      if (!session) return;
      const conditions = summarizeIslandConditions(await readIslandConditions({ refreshWeather: true, refreshFerry: true }));
      sendJson(request, response, 200, {
        ...conditions,
        dispatches: conditions.dispatches.map(incidentDispatchResponse),
        ingest: publicCameraIngestReadiness(),
        email: publicEmailReadiness(),
        assignmentDirectory: await incidentAssignmentDirectory(session)
      });
      return;
    }

    const cameraSourceMatch = pathname.match(/^\/api\/admin\/island-conditions\/cameras\/([^/]+)$/);
    if (method === "PATCH" && cameraSourceMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const cameraId = decodeURIComponent(cameraSourceMatch[1]);
      const body = await readBody(request);
      if (body.monitoringEnabled === true) {
        const ingestConfig = cameraIngestConfig();
        const credential = cameraCredentialReadiness(ingestConfig, cameraId);
        if (!credential.ready) {
          sendJson(request, response, 409, {
            error: credential.reason || "Configure a camera-bound ingest credential before arming this source.",
            ingest: publicCameraIngestReadiness(ingestConfig)
          });
          return;
        }
      }
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = updateCameraSource(current, cameraId, body, {
          actorId: session.id,
          now: new Date().toISOString()
        });
        return result.ok ? result.doc : normalizeIslandConditions(current);
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Camera not found." ? 404 : 400, { error: result?.error || "Camera source could not be updated." });
        return;
      }
      await writeAuditRecord(request, "conditions.camera.update", { type: "camera", id: cameraId }, null, result.camera);
      sendJson(request, response, 200, { camera: result.camera, ingest: publicCameraIngestReadiness() });
      return;
    }

    const cameraMetricMatch = pathname.match(/^\/api\/admin\/island-conditions\/cameras\/([^/]+)\/observations$/);
    if (method === "POST" && cameraMetricMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const cameraId = decodeURIComponent(cameraMetricMatch[1]);
      const body = await readBody(request);
      let result = null;
      let incidentResult = null;
      const now = new Date().toISOString();
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = recordCameraObservation(current, cameraId, body, {
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now
        });
        if (!result.ok || !result.changed) return result.ok ? result.doc : normalizeIslandConditions(current);
        incidentResult = evaluateCameraObservationIncident(result.doc, cameraId, result.observation, {
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now
        });
        return incidentResult.ok ? incidentResult.doc : result.doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, 404, { error: result?.error || "Observation could not be recorded." });
        return;
      }
      await writeAuditRecord(request, "conditions.observation.create", { type: "camera", id: cameraId }, null, result.observation);
      await writeIncidentTransitionAudit(request, cameraId, "condition", incidentResult);
      sendJson(request, response, 201, {
        observation: result.observation,
        incidentAction: incidentResult?.action ?? null,
        incident: incidentResult?.incident ?? null
      });
      return;
    }

    if (method === "POST" && pathname === "/api/admin/island-conditions/incidents") {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const body = await readBody(request);
      const now = new Date().toISOString();
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = createOperationsIncident(current, {
          ...body,
          sourceType: "operator",
          sourceId: body.sourceId || `operator-${randomUUID()}`
        }, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now
        });
        return result.ok ? result.doc : normalizeIslandConditions(current);
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, 400, { error: result?.error || "Incident could not be created." });
        return;
      }
      if (result.changed) await writeAuditRecord(request, "conditions.incident.create", { type: "conditions_incident", id: result.incident.id }, null, result.incident);
      sendJson(request, response, result.changed ? 201 : 200, { incident: result.incident, duplicate: result.duplicate === true });
      return;
    }

    const incidentMatch = pathname.match(/^\/api\/admin\/island-conditions\/incidents\/([^/]+)$/);
    if (method === "PATCH" && incidentMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const incidentId = decodeURIComponent(incidentMatch[1]);
      const body = await readBody(request);
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = updateOperationsIncident(current, incidentId, body, {
          actorId: session.id,
          now: new Date().toISOString()
        });
        return result.ok ? result.doc : normalizeIslandConditions(current);
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Incident not found." ? 404 : 400, { error: result?.error || "Incident could not be updated." });
        return;
      }
      if (result.changed) await writeAuditRecord(request, "conditions.incident.update", { type: "conditions_incident", id: result.incident.id }, result.before, result.incident);
      sendJson(request, response, 200, { incident: result.incident, changed: result.changed });
      return;
    }

    const dispatchCreateMatch = pathname.match(/^\/api\/admin\/island-conditions\/incidents\/([^/]+)\/dispatches$/);
    if (method === "POST" && dispatchCreateMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const incidentId = decodeURIComponent(dispatchCreateMatch[1]);
      const body = await readBody(request);
      const assignment = await enrichIncidentDispatchAssignment(body);
      if (!assignment.ok) {
        sendJson(request, response, 400, { error: assignment.error });
        return;
      }
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        result = createIncidentDispatch(current, incidentId, assignment.input, {
          actorId: session.id,
          idFactory: prefix => `${prefix}_${randomUUID()}`,
          now: new Date().toISOString()
        });
        return result.ok ? result.doc : normalizeIslandConditions(current);
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Incident not found." ? 404 : 400, { error: result?.error || "Dispatch could not be created." });
        return;
      }
      if (result.changed) await writeAuditRecord(request, "conditions.dispatch.create", { type: "incident_dispatch", id: result.dispatch.id }, null, result.dispatch, { incidentId });
      sendJson(request, response, result.changed ? 201 : 200, { dispatch: incidentDispatchResponse(result.dispatch), incident: result.incident, duplicate: result.duplicate === true, email: publicEmailReadiness() });
      return;
    }

    const dispatchMatch = pathname.match(/^\/api\/admin\/island-conditions\/incidents\/([^/]+)\/dispatches\/([^/]+)$/);
    if (method === "PATCH" && dispatchMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const incidentId = decodeURIComponent(dispatchMatch[1]);
      const dispatchId = decodeURIComponent(dispatchMatch[2]);
      const body = await readBody(request);
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        const doc = normalizeIslandConditions(current);
        const target = doc.dispatches.find(item => item.id === dispatchId);
        result = target && target.incidentId !== incidentId
          ? { ok: false, error: "Dispatch does not belong to this incident." }
          : updateIncidentDispatch(doc, dispatchId, body, { actorId: session.id, now: new Date().toISOString() });
        return result.ok ? result.doc : doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Dispatch not found." ? 404 : 400, { error: result?.error || "Dispatch could not be updated." });
        return;
      }
      await writeAuditRecord(request, "conditions.dispatch.update", { type: "incident_dispatch", id: dispatchId }, result.before, result.dispatch, { incidentId });
      sendJson(request, response, 200, { dispatch: incidentDispatchResponse(result.dispatch) });
      return;
    }

    const dispatchReviewMatch = pathname.match(/^\/api\/admin\/island-conditions\/incidents\/([^/]+)\/dispatches\/([^/]+)\/review$/);
    if (method === "POST" && dispatchReviewMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const incidentId = decodeURIComponent(dispatchReviewMatch[1]);
      const dispatchId = decodeURIComponent(dispatchReviewMatch[2]);
      const body = await readBody(request);
      const recipientContext = await taskRecipientContext();
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        const doc = normalizeIslandConditions(current);
        const target = doc.dispatches.find(item => item.id === dispatchId);
        result = target && target.incidentId !== incidentId
          ? { ok: false, error: "Dispatch does not belong to this incident." }
          : reviewIncidentDispatchMessage(doc, dispatchId, body.action, { actorId: session.id, now: new Date().toISOString(), ...recipientContext });
        return result.ok ? result.doc : doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Dispatch not found." ? 404 : 400, { error: result?.error || "Dispatch message could not be reviewed." });
        return;
      }
      await writeAuditRecord(request, `conditions.dispatch.message.${body.action}`, { type: "incident_dispatch", id: dispatchId }, result.before, result.dispatch, { incidentId });
      sendJson(request, response, 200, { dispatch: incidentDispatchResponse(result.dispatch), email: publicEmailReadiness() });
      return;
    }

    const dispatchSendMatch = pathname.match(/^\/api\/admin\/island-conditions\/incidents\/([^/]+)\/dispatches\/([^/]+)\/send$/);
    if (method === "POST" && dispatchSendMatch) {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const incidentId = decodeURIComponent(dispatchSendMatch[1]);
      const dispatchId = decodeURIComponent(dispatchSendMatch[2]);
      const email = emailConfigFromEnv();
      if (!email.ready) {
        sendJson(request, response, 409, { error: email.reason || "Transactional email is not ready.", email: publicEmailReadiness(email) });
        return;
      }
      const recipientContext = await taskRecipientContext();
      let result = null;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        const doc = normalizeIslandConditions(current);
        const target = doc.dispatches.find(item => item.id === dispatchId);
        result = target && target.incidentId !== incidentId
          ? { ok: false, error: "Dispatch does not belong to this incident." }
          : queueIncidentDispatchMessage(doc, dispatchId, { actorId: session.id, now: new Date().toISOString(), ...recipientContext });
        return result.ok ? result.doc : doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (!result?.ok) {
        sendJson(request, response, result?.error === "Dispatch not found." ? 404 : 400, { error: result?.error || "Dispatch email could not be queued." });
        return;
      }
      let job;
      try {
        job = await enqueueJob(ROOT, { type: "incident.dispatch.send", payload: { incidentId, dispatchId }, maxAttempts: 5 });
      } catch (error) {
        await updatePlatformDoc(ROOT, "islandConditions", current => {
          const failed = recordIncidentDispatchDelivery(current, dispatchId, { sent: false, provider: email.provider, error: `Queue failure: ${String(error.message).slice(0, 500)}` }, { terminal: true });
          return failed.ok ? failed.doc : normalizeIslandConditions(current);
        }, { fallback: normalizeIslandConditions(null) });
        throw error;
      }
      await writeAuditRecord(request, "conditions.dispatch.message.queue", { type: "incident_dispatch", id: dispatchId }, null, result.dispatch, { incidentId, jobId: job.id, provider: email.provider });
      sendJson(request, response, 202, { dispatch: incidentDispatchResponse(result.dispatch), job: { id: job.id, status: job.status }, email: publicEmailReadiness(email) });
      return;
    }

    if (method === "PATCH" && pathname === "/api/admin/island-conditions/ferry") {
      const session = await requirePermission(request, response, "conditions:write");
      if (!session) return;
      const body = await readBody(request);
      const now = new Date().toISOString();
      const manualOverrideUntil = new Date(new Date(now).getTime() + 15 * 60_000).toISOString();
      const estimatedWaitMinutes = Number(body.estimatedWaitMinutes);
      const operatingFerries = Number(body.operatingFerries);
      if (!Number.isFinite(estimatedWaitMinutes) || estimatedWaitMinutes < 0 || estimatedWaitMinutes > 600) {
        sendJson(request, response, 400, { error: "estimatedWaitMinutes must be between 0 and 600." });
        return;
      }
      const updated = await updatePlatformDoc(ROOT, "islandConditions", current => {
        const doc = normalizeIslandConditions(current);
        return {
          ...doc,
          lastUpdated: now,
          ferry: {
            ...doc.ferry,
            status: "observed",
            estimatedWaitMinutes: Math.round(estimatedWaitMinutes),
            operatingFerries: Number.isFinite(operatingFerries) ? Math.max(0, Math.round(operatingFerries)) : doc.ferry.operatingFerries,
            observedAt: now,
            checkedAt: now,
            directions: [],
            manualOverrideUntil,
            source: String(body.source || "operator").slice(0, 100),
            notes: String(body.notes || "").slice(0, 500)
          }
        };
      }, { fallback: normalizeIslandConditions(null) });
      await writeAuditRecord(request, "conditions.ferry.update", { type: "ferry", id: "port-aransas" }, null, updated.ferry);
      sendJson(request, response, 200, { ferry: updated.ferry });
      return;
    }

    if (method === "PATCH" && pathname === "/api/admin/alert") {
      if (!(await requirePermission(request, response, "alert:write"))) return;
      const body = await readBody(request);
      const current = await storage.config.read("emergency-alert");
      const result = sanitizeAlertPatch(body, current);
      if (result.error) {
        sendJson(request, response, 400, { error: result.error });
        return;
      }
      await writeConfigSnapshot(request, { type: "alert", id: current.id || "alert_none" }, current, `Before ${result.alert.active ? "alert publish" : "alert clear"}`);
      await storage.config.write("emergency-alert", result.alert);

      let smsResult = null;
      if (!result.alert.active && current?.id) {
        const suppressed = await mutateSmsOperations(doc => suppressSmsCampaignsForAlert(doc, current.id, {
          now: new Date().toISOString(),
          eventId: CURRENT_EVENT_ID
        }));
        if (suppressed?.suppressed) {
          smsResult = { requested: false, queued: 0, suppressed: suppressed.suppressed, reason: "alert_cleared" };
        }
      }

      // Safety SMS is an explicit operator action. Publishing an alert alone
      // never initiates a provider send.
      const wantSms = result.alert.active && body.sendSms === true;
      if (wantSms) {
        const publicAudience = !Array.isArray(result.alert.audience) || result.alert.audience.includes("public");
        const sms = smsConfigFromEnv(process.env);
        if (!publicAudience) {
          smsResult = { requested: true, queued: 0, reason: "Alert audience does not include the public." };
        } else if (!sms.ready) {
          smsResult = { requested: true, queued: 0, reason: sms.reason };
        } else {
          const ledger = await readConsentLedger();
          if (ledger.eventId !== CURRENT_EVENT_ID) {
            smsResult = { requested: true, eligible: 0, queued: 0, reason: `Consent ledger is assigned to ${ledger.eventId}; expected ${CURRENT_EVENT_ID}.` };
          } else {
            const limit = Math.min(SMS_MAX_RECIPIENTS, Math.max(1, Number(body.smsLimit) || SMS_MAX_RECIPIENTS));
            const recipients = recipientsForChannel(ledger.records, "smsSafety").slice(0, limit);
            if (recipients.length === 0) {
              smsResult = { requested: true, eligible: 0, queued: 0, reason: "No recipients currently have active safety SMS consent." };
            } else {
              const campaignResult = await mutateSmsOperations(doc => createSmsAlertCampaign(doc, {
                alert: result.alert,
                recipients,
                limit
              }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID }));
              if (!campaignResult?.ok) {
                smsResult = { requested: true, eligible: recipients.length, queued: 0, reason: campaignResult?.error || "SMS campaign could not be created." };
              } else {
                const assignments = [];
                const failedMessages = [];
                for (let offset = 0; offset < campaignResult.messages.length; offset += 25) {
                  const batch = campaignResult.messages.slice(offset, offset + 25);
                  const jobs = await Promise.all(batch.map(async message => {
                    try {
                      const job = await enqueueJob(ROOT, {
                        type: "sms.alert.send",
                        payload: {
                          campaignId: campaignResult.campaign.id,
                          messageId: message.id,
                          consentRecordId: message.consentRecordId,
                          alert: {
                            id: result.alert.id,
                            severity: result.alert.severity,
                            title: result.alert.title,
                            message: result.alert.message,
                            updatedAt: result.alert.updatedAt
                          }
                        },
                        idempotencyKey: `${campaignResult.campaign.id}:${message.id}`
                      });
                      return { messageId: message.id, jobId: job.id };
                    } catch (error) {
                      failedMessages.push({ messageId: message.id, error: error?.message || "SMS queue write failed." });
                      return null;
                    }
                  }));
                  assignments.push(...jobs.filter(Boolean));
                }
                if (assignments.length) {
                  await mutateSmsOperations(doc => attachSmsJobs(doc, assignments, {
                    now: new Date().toISOString(),
                    eventId: CURRENT_EVENT_ID
                  }));
                }
                if (failedMessages.length) {
                  await mutateSmsOperations(doc => {
                    let next = doc;
                    for (const failure of failedMessages) {
                      next = recordSmsSubmission(next, failure.messageId, {
                        ok: false,
                        skipped: true,
                        error: failure.error
                      }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID }).doc;
                    }
                    return { ok: true, doc: next };
                  });
                }
                smsResult = {
                  requested: true,
                  campaignId: campaignResult.campaign.id,
                  eligible: recipients.length,
                  queued: assignments.length,
                  suppressed: failedMessages.length,
                  duplicate: campaignResult.duplicate === true,
                  reason: failedMessages.length ? "Some messages could not be queued." : "queued_for_worker"
                };
              }
            }
          }
        }
      }

      await writeAuditRecord(request, result.alert.active ? "alert.publish" : "alert.clear", {
        type: "alert",
        id: result.alert.id
      }, current, result.alert, {
        severity: result.alert.severity,
        sms: smsResult
          ? {
              requested: smsResult.requested === true,
              campaignId: smsResult.campaignId ?? null,
              eligible: smsResult.eligible ?? 0,
              queued: smsResult.queued ?? 0,
              suppressed: smsResult.suppressed ?? 0,
              reason: smsResult.reason
            }
          : null
      });
      sendJson(request, response, 200, { alert: result.alert, sms: smsResult });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/jobs") {
      if (!(await requirePermission(request, response, "admin:read"))) return;
      sendJson(request, response, 200, {
        summary: await getQueueHealth(ROOT),
        jobs: await listJobs(ROOT, { limit: clampLimit(url.searchParams.get("limit"), 50) })
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/audit") {
      if (!(await requirePermission(request, response, "audit:read"))) return;
      sendJson(request, response, 200, {
        audit: await storage.audit.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/snapshots") {
      if (!(await requirePermission(request, response, "snapshot:read"))) return;
      sendJson(request, response, 200, {
        snapshots: await storage.snapshots.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    const snapshotRestoreMatch = pathname.match(/^\/api\/admin\/snapshots\/([^/]+)\/restore$/);
    if (method === "POST" && snapshotRestoreMatch) {
      if (!(await requirePermission(request, response, "config:rollback"))) return;
      const snapshotRef = decodeURIComponent(snapshotRestoreMatch[1]);
      if (snapshotRef.includes("/") || snapshotRef.includes("..")) {
        sendJson(request, response, 400, { error: "Invalid snapshot reference." });
        return;
      }
      const snapshotEnvelope = await storage.snapshots.findByRef(snapshotRef);
      if (!snapshotEnvelope) {
        sendJson(request, response, 404, { error: `Snapshot not found: ${snapshotRef}` });
        return;
      }
      const snapshot = snapshotEnvelope.record;
      const targetKey = snapshotTargetKey(snapshot.target);
      if (!targetKey) {
        sendJson(request, response, 400, { error: `Snapshot target cannot be restored: ${snapshot.target?.type}` });
        return;
      }
      const before = await storage.config.read(targetKey);
      await writeConfigSnapshot(request, snapshot.target, before, `Before restoring snapshot ${snapshot.id}`);
      await storage.config.write(targetKey, snapshot.data);
      await writeAuditRecord(request, "config.rollback", snapshot.target, before, snapshot.data, {
        snapshotId: snapshot.id,
        snapshotRef
      });
      sendJson(request, response, 200, { restored: true, snapshotId: snapshot.id, target: snapshot.target });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/orders") {
      if (!(await requirePermission(request, response, "orders:read"))) return;
      sendJson(request, response, 200, {
        pendingOrders: await storage.orders.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/payment-events") {
      if (!(await requirePermission(request, response, "payments:read"))) return;
      sendJson(request, response, 200, {
        paymentEvents: await storage.paymentEvents.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    if (method === "GET" && pathname === "/api/admin/fulfillment") {
      if (!(await requirePermission(request, response, "fulfillment:read"))) return;
      sendJson(request, response, 200, {
        fulfillment: await storage.fulfillment.list(clampLimit(url.searchParams.get("limit")))
      });
      return;
    }

    const fulfillmentMatch = pathname.match(/^\/api\/admin\/fulfillment\/([^/]+)$/);
    if (method === "PATCH" && fulfillmentMatch) {
      await handleFulfillmentPatch(request, response, decodeURIComponent(fulfillmentMatch[1]));
      return;
    }

    const ticketMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)$/);
    if (method === "PATCH" && ticketMatch) {
      await handleAdminTicketPatch(request, response, decodeURIComponent(ticketMatch[1]));
      return;
    }

    if (method === "POST" && pathname === "/api/admin/sponsor-packages") {
      await handleAdminSponsorCreate(request, response);
      return;
    }

    const sponsorMatch = pathname.match(/^\/api\/admin\/sponsor-packages\/([^/]+)$/);
    if (method === "PATCH" && sponsorMatch) {
      await handleAdminSponsorPatch(request, response, decodeURIComponent(sponsorMatch[1]));
      return;
    }

    if (method === "POST" && pathname === "/api/admin/vendor-offerings") {
      await handleAdminVendorOfferingCreate(request, response);
      return;
    }

    const vendorOfferingMatch = pathname.match(/^\/api\/admin\/vendor-offerings\/([^/]+)$/);
    if (method === "PATCH" && vendorOfferingMatch) {
      await handleAdminVendorOfferingPatch(request, response, decodeURIComponent(vendorOfferingMatch[1]));
      return;
    }

    if (method === "POST" && pathname === "/api/admin/event-guide/publish") {
      await handleAdminEventGuidePublish(request, response);
      return;
    }

    sendJson(request, response, 404, { error: "Route not found." });
  } catch (error) {
    const failure = safeErrorResponse(error, { production: SANDFEST_ENV === "production" });
    console.error(JSON.stringify({
      event: "request.error",
      requestId: request.requestId,
      method,
      pathname,
      status: failure.status,
      error: {
        name: String(error?.name || "Error"),
        message: String(error?.message || error || "Unknown error"),
        stack: SANDFEST_ENV === "production" ? undefined : error?.stack
      }
    }));
    sendJson(request, response, failure.status, { error: failure.message });
  }
}

const server = createServer(handleRequest);
// Festival-scale keep-alive / backlog (tune via env on large hosts).
server.keepAliveTimeout = Number(process.env.SANDFEST_KEEPALIVE_MS || 65_000);
server.headersTimeout = Number(process.env.SANDFEST_HEADERS_TIMEOUT_MS || 70_000);
server.maxHeadersCount = 100;

const listenHost = process.env.SANDFEST_API_HOST || (SANDFEST_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
server.listen(PORT, listenHost, () => {
  const dataMode = process.env.SANDFEST_DATABASE_URL ? "postgres+platform" : "file-atomic";
  console.log(`SandFest admin API listening on http://${listenHost}:${PORT} (storage: ${storage.kind}, data: ${dataMode}, auth: ${authMode()})`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, closing SandFest admin API.`);
  server.close(async () => {
    try {
      await rateLimiter.close?.();
      await storage.close();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

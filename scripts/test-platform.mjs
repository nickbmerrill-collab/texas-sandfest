#!/usr/bin/env node
// Full platform verification suite — pure lib checks + optional live API smoke.
// Usage:
//   node scripts/test-platform.mjs
//   SANDFEST_API_PORT=8806 node scripts/test-platform.mjs --api
//   (with API already running) node scripts/test-platform.mjs --api --base http://127.0.0.1:8806

import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import twilio from "twilio";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boardDemoAccessConfig } from "../lib/board-demo-access.mjs";
import {
  boardDemoCheckEndpoints,
  boardDemoLoopbackUrl,
  boardDemoPresentationLinks,
  evaluateBoardDemoReadiness
} from "../lib/board-demo-readiness.mjs";
import { boardDemoAccessPlugin } from "../vite.config.js";
import { buildRevenueLedgerView, partnerRevenueEntries, summarizeLedger, ticketRevenueEntries } from "../lib/revenue.mjs";
import {
  createBudgetLine,
  createExpenseRequest,
  emptyBudgetControl,
  summarizeBudgetControl,
  transitionExpense,
  updateBudgetLine
} from "../lib/budget-control.mjs";
import {
  applyRevenueImport,
  parseRevenueCsv,
  REVENUE_IMPORT_MAX_ROWS,
  revenueImportPreviewHash
} from "../lib/revenue-import.mjs";
import { applyCheckout, applyCheckin, summarizeFleet, parseAssetQrPayload } from "../lib/fleet.mjs";
import { summarizeVolunteers } from "../lib/volunteers.mjs";
import {
  VOLUNTEERLOCAL_IMPORT_MAX_ROWS,
  applyVolunteerLocalImport,
  parseVolunteerLocalBundle,
  volunteerLocalBundleHash,
  volunteerLocalImportPreviewHash,
  volunteerLocalMirrorFingerprint
} from "../lib/volunteer-import.mjs";
import {
  normalizeStaffDirectory,
  publicStaffAssignmentDirectory,
  staffDirectoryReadiness,
  staffTaskRecipients
} from "../lib/staff-directory.mjs";
import {
  STAFF_DIRECTORY_IMPORT_MAX_ROWS,
  applyStaffDirectoryImport,
  parseStaffDirectoryImport,
  staffDirectoryFingerprint,
  staffDirectoryImportPreviewHash
} from "../lib/staff-directory-import.mjs";
import {
  applySmsConsentKeyword,
  consentFromCheckout,
  mergeConsentRecords,
  summarizeConsent,
  validateCheckoutConsent
} from "../lib/consent.mjs";
import {
  publicSmsReadiness,
  sendSms,
  smsConfigFromEnv,
  smsStatusCallbackUrl,
  verifyTwilioFormRequest
} from "../lib/sms.mjs";
import {
  beginSmsSubmission,
  createSmsAlertCampaign,
  emptySmsOperations,
  recordSmsPreferenceEvent,
  recordSmsStatusCallback,
  recordSmsSubmission,
  smsOperationsAdminPayload,
  suppressSmsCampaignsForAlert
} from "../lib/sms-operations.mjs";
import { applyStamp, DEFAULT_HUNT_ID, normalizeHunt, parsePassportPayload, summarizePassport } from "../lib/passport.mjs";
import { applyVote, tallyVotes, summarizeVoting, normalizeTicketRef, publicVotingPublication } from "../lib/voting.mjs";
import { claimNextJobs, completeJob, enqueueJob, getQueueHealth, listJobs, markTerminalJobHandled } from "../lib/job-queue.mjs";
import {
  adminJobDisplayRows,
  adminJobView,
  jobResolutionNote,
  prioritizedAdminJobViews,
  validAdminJobId
} from "../lib/job-operations.mjs";
import { publicBoothPins, summarizeBooths } from "../lib/booths.mjs";
import {
  EVENTENY_BOOTH_IMPORT_MAX_ROWS,
  applyEventenyBoothImport,
  eventenyBoothBundleHash,
  eventenyBoothImportPreviewHash,
  eventenyBoothMirrorFingerprint,
  parseEventenyBoothCsv
} from "../lib/booth-import.mjs";
import { applyOutreachProspectImport, parseOutreachProspectCsv } from "../lib/outreach-import.mjs";
import {
  deploymentTaskSyncIntervalMs,
  syncDeploymentCheckTasks
} from "../lib/deployment-task-sync.mjs";
import {
  EVENTENY_PARTNER_IMPORT_MAX_ROWS,
  applyEventenyPartnerImport,
  eventenyPartnerCatalogFingerprint,
  eventenyPartnerImportPreviewHash,
  parseEventenyPartnerCsv,
  resolveEventenyPartnerSelection
} from "../lib/partner-import.mjs";
import {
  applyOutreachDiscoveryImport,
  buildOverpassQuery,
  discoverOutreachBusinesses,
  issueOutreachDiscoveryPreview,
  normalizeOutreachDiscoveryQuery,
  normalizeOverpassCandidates,
  outreachDiscoveryConfig,
  verifyOutreachDiscoveryPreview
} from "../lib/outreach-discovery.mjs";
import {
  OUTREACH_CAMPAIGN_AUTOMATION_POLICY,
  PARTNER_INITIAL_REMINDER_GRACE_MS,
  PARTNER_PORTAL_RECOVERY_WINDOW_MS,
  PARTNER_TRANSACTIONAL_AUTOMATION_POLICY,
  PARTNER_TRANSACTIONAL_FOLLOWUP_KINDS,
  applyOutreachCampaignAutomation,
  applyTransactionalFollowupAutomation,
  automatedFollowupQueueCandidates,
  beginFollowupProviderSubmission,
  claimFollowupDelivery,
  createPartnerBrandAsset,
  createPartnerDeliverable,
  createOutreachCampaign,
  createOutreachProspect,
  createOutreachSponsorInvitation,
  createPartnerApplication,
  createSponsorApplicationFromOutreachInvitation,
  createPartnerInvoice,
  createPartnerMilestone,
  createPartnerTask,
  createVendorDocument,
  confirmVendorAssignment,
  activatePartnerPaymentCheckout,
  beginPartnerPaymentCheckout,
  emptyPartnerOperations,
  editFollowupDraft,
  generateDueOutreachFollowups,
  generateDuePartnerFollowups,
  generateDueTaskFollowups,
  generatePartnerPaymentFollowups,
  generateVendorApplicationOpeningFollowups,
  matchOutreachProspects,
  outreachDistanceMiles,
  outreachCampaignAutomationReadiness,
  outreachCampaignMetrics,
  partnerAutomationReadiness,
  previewOutreachCampaign,
  prepareFollowupDraft,
  queueFollowupDelivery,
  queuePartnerInvoiceReconciliation,
  queuePartnerInvoiceSync,
  reconcilePartnerStripePayment,
  reconcilePartnerStripeRefund,
  releaseAutomatedFollowupApproval,
  recordFollowupDelivery,
  recordPartnerInvoiceReconciliation,
  recordPartnerInvoiceSync,
  recordPartnerPayment,
  requestPartnerPortalRecovery,
  requestTaskAssignmentNotice,
  reversePartnerPayment,
  reviewFollowup,
  reviewPartnerBrandAsset,
  reviewPartnerBrandProfile,
  reviewPartnerDeliverable,
  reviewPartnerInvoice,
  reviewVendorProfile,
  reviewVendorRequirement,
  revokeOutreachSponsorInvitation,
  rotatePartnerPortalAccess,
  setPartnerAutomationMode,
  summarizePartnerOperations,
  summarizePartnerMilestones,
  summarizePartnerReceivables,
  summarizeSponsorFulfillment,
  summarizeTaskNotifications,
  summarizeVendorReadiness,
  summarizeTaskBoard,
  updateOutreachCampaignStatus,
  updateOutreachProspect,
  updatePartnerApplication,
  updatePartnerBrandProfile,
  updatePartnerContactPreference,
  updatePartnerDeliverable,
  updatePartnerTask,
  updatePartnerTaskFromAssignee,
  updatePartnerMilestone,
  updateVendorAssignment,
  updateVendorProfile
} from "../lib/partner-ops.mjs";
import {
  findPartnerPortalApplication,
  issuePartnerPortalToken,
  partnerPortalConfig,
  partnerPortalPath,
  publicPartnerPortalStatus,
  verifyPartnerPortalToken
} from "../lib/partner-portal.mjs";
import {
  forgetMatchingPartnerPortalAccess,
  partnerPortalSafeHash,
  shouldForgetPartnerPortalAccess,
  taskPortalSafeHash
} from "../lib/partner-portal-session.mjs";
import {
  findTaskPortalTask,
  issueTaskPortalToken,
  publicTaskPortalStatus,
  taskPortalConfig,
  taskPortalPath,
  taskPortalUrlForTask,
  verifyTaskPortalToken
} from "../lib/task-portal.mjs";
import {
  findOutreachPreferenceProspect,
  issueOutreachPreferenceToken,
  outreachPreferencesConfig,
  outreachPreferencePath,
  outreachPreferenceUrlForProspect,
  publicOutreachPreference,
  verifyOutreachPreferenceToken
} from "../lib/outreach-preferences.mjs";
import {
  issueSponsorInvitationToken,
  publicSponsorInvitation,
  sponsorInvitationConfig,
  sponsorInvitationUrlForProspect,
  verifySponsorInvitationToken
} from "../lib/sponsor-invitations.mjs";
import {
  createSponsorPackageConfig,
  DEFAULT_SPONSOR_PACKAGES,
  publicSponsorPackage,
  resolveSponsorPackage,
  sponsorPackageCatalog,
  updateSponsorPackageConfig
} from "../lib/sponsor-packages.mjs";
import {
  BOARD_DEMO_VENDOR_OFFERINGS,
  createVendorOfferingConfig,
  DEFAULT_VENDOR_OFFERINGS,
  publicVendorOffering,
  resolveVendorOffering,
  updateVendorOfferingConfig,
  vendorOfferingCatalog
} from "../lib/vendor-offerings.mjs";
import { partnerContactNotice } from "../lib/partner-consent.mjs";
import {
  deletePartnerAssetUpload,
  partnerAssetStorageConfig,
  readPartnerAssetUpload,
  savePartnerAssetUpload,
  validatePartnerAssetUpload
} from "../lib/partner-assets.mjs";
import {
  adminIncomingDocument,
  beginIncomingDocumentExtraction,
  completeIncomingDocumentExtraction,
  createIncomingDocument,
  defaultIncomingDocumentReviewDueAt,
  deleteIncomingDocumentUpload,
  emptyIncomingDocumentIntake,
  incomingDocumentStorageConfig,
  readIncomingDocumentUpload,
  requestIncomingDocumentExtraction,
  saveIncomingDocumentUpload,
  summarizeIncomingDocuments,
  updateIncomingDocument,
  validateIncomingDocumentUpload,
  verifyIncomingDocumentBytes
} from "../lib/incoming-documents.mjs";
import { extractDocumentText } from "../lib/document-extraction.mjs";
import {
  documentExtractionSourceConfig,
  verifyDocumentExtractionSourceAuthorization
} from "../lib/document-extraction-source.mjs";
import {
  incomingDocumentReviewTaskView,
  syncIncomingDocumentReviewTask,
  syncIncomingDocumentReviewTasks
} from "../lib/document-review-routing.mjs";
import {
  incomingDocumentRecoveryReferences,
  partnerAssetRecoveryReferences,
  platformAssetRecoveryReferences,
  verifyPartnerAssetRecovery
} from "../lib/asset-recovery.mjs";
import { approvedPublicSponsorAsset, publicSponsorShowcase } from "../lib/sponsor-showcase.mjs";
import { emailConfigFromEnv, publicEmailReadiness, sendTransactionalEmail } from "../lib/email.mjs";
import {
  boardEmailSandboxConfig,
  boardEmailSandboxRecipientAllowed,
  startBoardEmailSandbox
} from "../lib/board-email-sandbox.mjs";
import {
  boardSmsSandboxConfig,
  boardSmsSandboxRecipientAllowed,
  startBoardSmsSandbox
} from "../lib/board-sms-sandbox.mjs";
import {
  applyBrevoDeliveryEvents,
  brevoWebhookConfig,
  normalizeBrevoWebhookEvents,
  verifyBrevoWebhookAuthorization
} from "../lib/brevo-webhook.mjs";
import { quickBooksReadiness, reconcilePartnerInvoiceFromQuickBooks, syncPartnerInvoiceToQuickBooks } from "../lib/quickbooks/client.mjs";
import {
  normalizeSiteMode,
  resolveInitialSiteMode,
  siteModeForHash
} from "../lib/site-mode.mjs";
import {
  PUBLIC_FIELD_MEDIA,
  PUBLIC_GALLERY_MEDIA,
  selectPublicMediaAssets
} from "../lib/public-media-selection.mjs";
import {
  createIncidentDispatch,
  createOperationsIncident,
  deriveCameraCondition,
  evaluateCameraHealthIncident,
  evaluateCameraObservationIncident,
  failedFeedRefreshNeedsRetry,
  freshness,
  islandConditionsLiveFeedsEnabled,
  normalizeNwsForecast,
  normalizeTxdotFerryStatus,
  publicIslandConditionsRefreshDelay,
  publicIslandConditions,
  queueIncidentDispatchMessage,
  recordCameraHeartbeat,
  recordCameraObservation,
  recordIncidentDispatchDelivery,
  resolveIncidentDispatchRecipient,
  reviewIncidentDispatchMessage,
  summarizeIslandConditions,
  summarizeIncidentDispatches,
  summarizeOperationsIncidents,
  updateIncidentDispatch,
  updateOperationsIncident,
  updateCameraSource,
  weatherForecastNeedsRefresh
} from "../lib/island-conditions.mjs";
import {
  cameraCredentialReadiness,
  cameraIngestConfig,
  publicCameraIngestReadiness,
  signCameraPayload,
  verifyCameraIngestSignature
} from "../lib/camera-ingest.mjs";
import {
  BOARD_CAMERA_PROFILES,
  boardCameraPlaybackRetryDelay,
  boardCameraHeartbeat,
  boardCameraObservation,
  boardCameraSourceId,
  retryableBoardCameraPlaybackError,
  runBoardCameraPlayback,
  verifyBoardCameraPlaybackTarget
} from "../lib/board-camera-playback.mjs";
import {
  buildStripePartnerCheckoutRequest,
  stripePartnerEventContext,
  stripePartnerPaymentsConfig
} from "../lib/stripe-partner-payments.mjs";
import { escapeHtml } from "../lib/html-escape.mjs";
import { updateJsonFile } from "../lib/safe-json-store.mjs";
import { normalizeRequestId, redactAuditValue, safeErrorResponse } from "../lib/security.mjs";
import { recoveryReadiness } from "../lib/recovery-readiness.mjs";
import {
  REQUIRED_TICKET_POLICY_NOTICES,
  publicTicketCatalog,
  ticketCheckoutPolicyReadiness,
  validateTicketPolicyAcceptance
} from "../lib/ticket-catalog.mjs";
import {
  budgetAllocationsExport,
  csvCell,
  expenseRegisterExport,
  milestonesCalendarExport,
  outreachProspectsExport,
  partnerDirectoryExport,
  paymentsExport,
  receivablesExport,
  tasksExport
} from "../lib/operations-export.mjs";
import { TURNSTILE_SITEVERIFY_URL, turnstileConfig, verifyTurnstileToken } from "../lib/turnstile.mjs";
import { eventGuideReadiness, normalizeEventGuide, publicEventGuide, publishEventGuide } from "../lib/event-guide.mjs";
import { publicAppBootstrap, publicAppBootstrapSafety } from "../lib/public-bootstrap.mjs";
import {
  answerPublicConcierge,
  parsePublicConciergeQuestion,
  publicConciergeNeedsConditions,
  publicConciergeResponseSafety
} from "../lib/public-concierge.mjs";
import { publicMediaManifest, publicMediaManifestSafety } from "../lib/public-media-manifest.mjs";
import { DEFAULT_EVENT_ID, eventContextConfig, eventContextReadiness } from "../lib/event-context.mjs";
import { publicSculptorRosterPublication } from "../lib/public-roster.mjs";
import { boardDemoEngagement } from "../lib/board-runtime.mjs";
import { boardDemoSyntheticConditions } from "../lib/board-conditions.mjs";
import { boardPartnerFormPreset } from "../src/board-demo/partner-form-presets.js";
import { developmentPublicApiBase } from "../src/dev-public-api-base.js";
import { taskAssignmentNoticeAction } from "../src/admin-operations-ui.js";
import { eventArchiveDigest, planEventRollover, ROLLOVER_DOCUMENT_KEYS } from "../lib/event-rollover.mjs";
import {
  cleanAuthCallbackUrl,
  createAdminAuthClient,
  isSigninCallback,
  isSignoutCallback,
  isUsableOidcUser,
  normalizeAdminAuthConfig,
  oidcManagerSettings
} from "../src/admin-auth.js";
import { validateAdminBuildEnvironment, validatePublicBuildEnvironment } from "../vite.config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wantApi = process.argv.includes("--api");
const baseArg = process.argv.find(a => a.startsWith("--base="));
let API_BASE = baseArg ? baseArg.slice(7) : null;
const TOKEN = process.env.SANDFEST_ADMIN_API_TOKEN || "dev-admin-token-change-me";
const SMOKE_CAMERA_SECRET = "platform-smoke-camera-secret-0123456789abcdef0123456789abcdef";
const SMOKE_CAMERA_NEXT_SECRET = "platform-smoke-next-camera-secret-0123456789abcdef0123456789";
const SMOKE_SOUTH_CAMERA_SECRET = "platform-smoke-south-camera-secret-0123456789abcdef012345678";
const SMOKE_CAMERA_KEY_ID = "north-gate-v1";
const SMOKE_CAMERA_NEXT_KEY_ID = "north-gate-v2";
const SMOKE_CAMERA_KEYS = JSON.stringify({
  [SMOKE_CAMERA_KEY_ID]: { cameraId: "north-gate", secret: SMOKE_CAMERA_SECRET },
  [SMOKE_CAMERA_NEXT_KEY_ID]: { cameraId: "north-gate", secret: SMOKE_CAMERA_NEXT_SECRET },
  "south-gate-v1": { cameraId: "south-gate", secret: SMOKE_SOUTH_CAMERA_SECRET }
});
const SMOKE_STRIPE_WEBHOOK_SECRET = "whsec_platform_partner_smoke";
const SMOKE_DOCUMENT_EXTRACTION_SECRET = "platform-smoke-document-extraction-secret-0123456789";
const SMOKE_BREVO_WEBHOOK_TOKEN = "platform-smoke-brevo-webhook-token-0123456789";

let passed = 0;
let failed = 0;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function startStripeMock() {
  const requests = [];
  let partnerSessionNumber = 0;
  let ticketSessionNumber = 0;
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const body = new URLSearchParams(rawBody);
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      const partner = Boolean(body.get("metadata[partner_checkout_id]"));
      if (partner) partnerSessionNumber += 1;
      else ticketSessionNumber += 1;
      const id = partner
        ? `cs_partner_api_${String(partnerSessionNumber).padStart(3, "0")}`
        : `cs_ticket_api_${String(ticketSessionNumber).padStart(3, "0")}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id,
        object: "checkout.session",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        expires_at: Number(body.get("expires_at"))
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function startTurnstileMock() {
  const requests = [];
  const redeemed = new Map();
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      requests.push({ method: request.method, url: request.url, body });
      const actions = {
        "valid-vendor-token": "vendor_application",
        "valid-vendor-mismatch-token": "vendor_application",
        "valid-vendor-interest-token": "vendor_application",
        "valid-sponsor-token": "sponsor_inquiry",
        "valid-invited-sponsor-mismatch-token": "sponsor_inquiry",
        "valid-invited-sponsor-token": "sponsor_inquiry"
      };
      const action = actions[body.response];
      const priorRetryKey = redeemed.get(body.response);
      const replaySafe = !priorRetryKey || priorRetryKey === body.idempotency_key;
      if (action && !priorRetryKey) redeemed.set(body.response, body.idempotency_key);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(action && replaySafe ? {
        success: true,
        hostname: "www.texassandfest.org",
        action,
        challenge_ts: "2026-07-16T12:00:00.000Z"
      } : {
        success: false,
        "error-codes": [action ? "timeout-or-duplicate" : "invalid-input-response"]
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/siteverify`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function startTwilioMock() {
  const requests = [];
  let sequence = 0;
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      sequence += 1;
      const sid = `SM_platform_${String(sequence).padStart(3, "0")}`;
      requests.push({ method: request.method, url: request.url, headers: request.headers, body, responseSid: sid });
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        sid,
        status: "queued"
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

async function startQuickBooksMock() {
  const requests = [];
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      if (request.method !== "POST" || body.get("grant_type") !== "authorization_code" || body.get("code") !== "quickbooks-private-code") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "quickbooks-private-access-token",
        refresh_token: "quickbooks-private-refresh-token",
        expires_in: 3600,
        x_refresh_token_expires_in: 8_726_400
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    tokenUrl: `http://127.0.0.1:${port}/oauth/tokens`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

function ok(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
}

console.log("\n=== Pure library suite ===\n");

{
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const queryBase = developmentPublicApiBase({
    location: { search: "?apiBase=http%3A%2F%2F127.0.0.1%3A8806", hostname: "127.0.0.1", port: "5175" },
    storage
  });
  const savedBase = developmentPublicApiBase({ location: { search: "", hostname: "localhost", port: "5175" }, storage });
  values.clear();
  const loopbackDefault = developmentPublicApiBase({ location: { search: "", hostname: "127.0.0.1", port: "5175" }, storage });
  const remoteDefault = developmentPublicApiBase({ location: { search: "", hostname: "preview.example", port: "5175" }, storage });
  ok("development API overrides stay local and deterministic", queryBase === "http://127.0.0.1:8806"
    && savedBase === queryBase
    && loopbackDefault === "http://127.0.0.1:8806"
    && remoteDefault === "https://sandfest-api.heyelab.com");
}

// Local board demos must open on the audience named by their URL, regardless
// of the previously viewed surface. Production visitor builds remain public.
{
  ok("site mode aliases normalize", normalizeSiteMode("Visitor") === "public" && normalizeSiteMode("operations") === "ops" && normalizeSiteMode("other") == null);
  ok("public and operations deep links select their audience", siteModeForHash("#sponsors") === "public"
    && siteModeForHash("#media") === "public"
    && siteModeForHash("#experience") === "ops"
    && siteModeForHash("#port-a") === "ops"
    && siteModeForHash("#operations") === "ops"
    && siteModeForHash("#admin-partners") === "ops"
    && siteModeForHash("#admin-budget") === "ops"
    && siteModeForHash("#admin-system-monitor") === "ops");
  ok("site mode URL overrides saved demo state", resolveInitialSiteMode({ opsDemoEnabled: true, queryMode: "visitor", hash: "#operations", savedMode: "ops" }) === "public");
  ok("site mode deep link overrides saved demo state", resolveInitialSiteMode({ opsDemoEnabled: true, hash: "#sponsors", savedMode: "ops" }) === "public" && resolveInitialSiteMode({ opsDemoEnabled: true, hash: "#finance", savedMode: "public" }) === "ops" && resolveInitialSiteMode({ opsDemoEnabled: true, hash: "#admin-budget", savedMode: "public" }) === "ops" && resolveInitialSiteMode({ opsDemoEnabled: true, hash: "#admin-revenue", savedMode: "public" }) === "ops");
  ok("production visitor and admin modes fail closed", resolveInitialSiteMode({ opsDemoEnabled: false, queryMode: "ops", savedMode: "ops" }) === "public" && resolveInitialSiteMode({ adminEntry: true, opsDemoEnabled: true, queryMode: "visitor" }) === "ops");
  const boardDemoAccess = boardDemoAccessConfig({
    development: true,
    authMode: "token",
    apiBase: "http://127.0.0.1:8806",
    token: "board-demo-local-admin-token-change-me"
  });
  ok("board demo access requires development loopback", boardDemoAccess.enabled
    && !boardDemoAccessConfig({ development: false, authMode: "token", apiBase: "http://127.0.0.1:8806", token: boardDemoAccess.token }).enabled
    && !boardDemoAccessConfig({ development: true, authMode: "oidc", apiBase: "http://127.0.0.1:8806", token: boardDemoAccess.token }).enabled
    && !boardDemoAccessConfig({ development: true, authMode: "token", apiBase: "https://sandfest-api.heyelab.com", token: boardDemoAccess.token }).enabled
    && !boardDemoAccessConfig({ development: true, authMode: "token", apiBase: "http://127.0.0.1.evil.example:8806", token: boardDemoAccess.token }).enabled);
  const sponsorPreset = boardPartnerFormPreset("sponsor", "preset-1234");
  const vendorPreset = boardPartnerFormPreset("vendor", "preset-5678");
  let invalidPresetRejected = false;
  try {
    boardPartnerFormPreset("sponsor", "bad id");
  } catch {
    invalidPresetRejected = true;
  }
  ok("board partner presets stay fictional and consent-neutral", sponsorPreset.fields.contactEmail === "morgan.sponsor.preset-1234@example.com"
    && sponsorPreset.fields.contactPhone === "+13615550131"
    && sponsorPreset.fields.packageId === "tarpon"
    && sponsorPreset.fields.website.endsWith(".example/")
    && vendorPreset.fields.contactEmail === "casey.vendor.preset-5678@example.com"
    && vendorPreset.fields.contactPhone === "+13615550132"
    && vendorPreset.fields.vendorOfferingId === "marketplace-booth"
    && vendorPreset.fields.website.endsWith(".example/")
    && !Object.hasOwn(sponsorPreset.fields, "consentToContact")
    && !Object.hasOwn(vendorPreset.fields, "consentToContact")
    && invalidPresetRejected);
  const boardDemoPlugin = boardDemoAccessPlugin({ SANDFEST_BOARD_DEMO_ADMIN_TOKEN: boardDemoAccess.token });
  const injectedBoardDemoHtml = boardDemoPlugin.transformIndexHtml();
  let remoteBindRejected = false;
  try {
    boardDemoPlugin.configureServer({ config: { server: { host: "0.0.0.0" } } });
  } catch {
    remoteBindRejected = true;
  }
  ok("board demo web injection is serve-only and loopback-bound", boardDemoPlugin.apply === "serve"
    && injectedBoardDemoHtml[0]?.children.includes(boardDemoAccess.token)
    && remoteBindRejected
    && boardDemoAccessPlugin({}) === null);
  const boardPackageScripts = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).scripts;
  const boardPublicOriginContract = "${SANDFEST_BOARD_PUBLIC_SITE_URL:-http://127.0.0.1:5175}";
  ok("board API and workers share one configurable public origin", ["board:api", "board:worker", "board:worker:watch"]
    .every(name => String(boardPackageScripts[name] || "").includes(`SANDFEST_PUBLIC_SITE_URL=${boardPublicOriginContract}`)));
  const alternateBoardEndpoints = boardDemoCheckEndpoints({
    SANDFEST_BOARD_PUBLIC_SITE_URL: "http://127.0.0.1:5176",
    SANDFEST_BOARD_API_BASE: "http://127.0.0.1:8816",
    SANDFEST_BOARD_EMAIL_BASE: "http://127.0.0.1:8817",
    SANDFEST_BOARD_SMS_BASE: "http://127.0.0.1:8818"
  });
  const explicitBoardEndpoints = boardDemoCheckEndpoints({
    SANDFEST_BOARD_PUBLIC_SITE_URL: "http://127.0.0.1:5176",
    SANDFEST_BOARD_WEB_URL: "http://localhost:5190/?apiBase=http://127.0.0.1:8890&mode=visitor"
  });
  let remoteBoardPublicSiteRejected = false;
  try {
    boardDemoCheckEndpoints({ SANDFEST_BOARD_PUBLIC_SITE_URL: "https://example.com" });
  } catch {
    remoteBoardPublicSiteRejected = true;
  }
  ok("board preflight follows the shared public origin by default", alternateBoardEndpoints.webOrigin === "http://127.0.0.1:5176"
    && new URL(alternateBoardEndpoints.webUrl).searchParams.get("apiBase") === "http://127.0.0.1:8816"
    && explicitBoardEndpoints.webOrigin === "http://localhost:5190"
    && remoteBoardPublicSiteRejected);

  const readyBoardState = {
    web: { ok: true, status: 200, html: "<script>globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__ = 'hidden';</script>" },
    webOrigin: "http://127.0.0.1:5175",
    health: {
      ok: true,
      service: "sandfest-admin-api",
      publicSiteUrl: "http://127.0.0.1:5175",
      ticketCheckoutReady: true,
      ticketCheckoutEnvironment: "board_sandbox",
      partnerPaymentCheckoutReady: true,
      partnerPaymentCheckoutEnvironment: "board_sandbox"
    },
    bootstrap: { guide: { id: "texas-sandfest-2027" }, runtime: { mode: "board_demo" } },
    tickets: {
      checkoutEnvironment: "board_sandbox",
      products: Array.from({ length: 4 }, (_, index) => ({ id: `demo_ticket_${index + 1}`, availableForCheckout: true }))
    },
    ready: { ok: true, checks: { workerStatus: { healthy: true }, queueStatus: { operational: true, unhandledFailed: 0 } } },
    emailSandbox: { ok: true, service: "sandfest-board-email-sandbox", mode: "board_demo" },
    smsSandbox: { ok: true, service: "sandfest-board-sms-sandbox", mode: "board_demo" },
    partners: {
      automationMode: "review_first",
      automation: { providerReady: true, active: false },
      summary: {
        applications: { total: 5, vendors: 3, sponsors: 2 },
        finance: { amountExpectedCents: 3_800_000, amountPaidCents: 1_000_000, balanceCents: 2_800_000 },
        operations: { dueSoonMilestones: 1 },
        outreach: { prospects: 2, qualified: 2, campaigns: 2, draftsAwaitingReview: 1, nextActionsScheduled: 2, unassigned: 0 }
      },
      invoices: [{ id: "demo_invoice", status: "approved" }],
      payments: [{ id: "demo_payment", status: "succeeded" }],
      milestones: Array.from({ length: 9 }, (_, index) => ({
        id: `demo_milestone_${index + 1}`,
        applicationId: `demo_application_${index % 5}`,
        dueAt: `2027-0${(index % 4) + 1}-15T17:00:00.000Z`
      })),
      followups: [
        ...Array.from({ length: 5 }, (_, index) => ({ id: `demo_ack_${index + 1}`, kind: "application_received", status: "draft_ready" })),
        ...Array.from({ length: 3 }, (_, index) => ({ id: `demo_task_notice_${index + 1}`, kind: "task_assignment", status: "draft_ready", body: `https://board.example/#task-status?task=task_${index + 1}&token=tsft_demo_${index + 1}` })),
        { id: "demo_milestone_reminder", kind: "milestone_reminder", status: "draft_ready", milestoneId: "demo_milestone_1" },
        { id: "demo_payment_received", kind: "payment_received", status: "draft_ready", paymentId: "demo_payment" },
        { id: "demo_sponsor_proof_review", kind: "sponsor_deliverable_review", status: "draft_ready", deliverableId: "demo_deliverable" },
        { id: "demo_vendor_opening", kind: "vendor_applications_open", status: "draft_ready", offeringId: "marketplace-booth" },
        { id: "demo_review_outreach", kind: "sponsor_outreach", status: "draft_ready", campaignId: "demo_review_campaign", automationPolicy: null }
      ],
      tasks: [
        { id: "demo_staff_task", assigneeType: "staff", assigneeId: "staff_operations" },
        { id: "demo_volunteer_task", assigneeType: "volunteer", assigneeId: "vol_001" },
        { id: "demo_team_task", assigneeType: "team", assigneeId: "operations" }
      ],
      taskBoard: { totals: { active: 3, unassigned: 0 } },
      fulfillment: {
        profiles: { approved: 1 },
        assets: { approved: 2 },
        deliverables: { total: 5 }
      },
      vendorReadiness: { totals: { vendors: 2, interests: 1, ready: 1, blocked: 1 } },
      staffDirectory: { ready: true, routedTeams: 7, totalTeams: 7 },
      email: { ready: true }
    },
    budget: {
      eventId: "texas-sandfest-2027",
      currency: "usd",
      summary: {
        totals: { budgetCents: 53_000_000, committedCents: 18_640_000, submittedCents: 9_200_000 },
        counts: {
          budgetLines: 6,
          expenses: 7,
          pendingApprovals: 2,
          byStatus: { submitted: 2, approved: 2, paid: 2, rejected: 1, voided: 0 }
        }
      }
    },
    budgetExport: { ok: true, status: 200, contentType: "text/csv; charset=utf-8", body: "Annual budget,Remaining after pipeline" },
    expenseExport: { ok: true, status: 200, contentType: "text/csv; charset=utf-8", body: "Vendor or payee,Payment reference" },
    documents: {
      summary: { total: 4, extractionReady: 4, extractionQueued: 0, extractionNeedsReview: 0 },
      documents: [{
        id: "demo_document_board_platform_briefing",
        title: "SandFest board platform briefing",
        extractionStatus: "ready",
        extractedCharacterCount: 5_507,
        extractedChunkCount: 6,
        textPreview: "TEXAS SANDFEST board platform briefing"
      }]
    },
    sponsors: {
      sponsors: [{
        displayName: "Gulf Shore Credit Union",
        packageName: "Marlin",
        primaryColor: "#006B63",
        secondaryColor: "#F4B942",
        logo: {
          path: "/api/public/sponsor-showcase/assets/demo_brand_asset_gulf_shore_primary",
          contentType: "image/png"
        }
      }]
    },
    sponsorLogo: { ok: true, status: 200, contentType: "image/png" },
    conditions: {
      weather: { status: "live", freshness: { state: "live" } },
      ferry: { status: "live", freshness: { state: "live" } },
      cameras: Array.from({ length: 8 }, (_, index) => ({ id: `camera-${index + 1}` })),
      summary: { configuredCameras: 8, armedCameras: 8, liveCameras: 8, healthyPipelines: 8, offlinePipelines: 0 }
    }
  };
  const readyBoardReport = evaluateBoardDemoReadiness(readyBoardState);
  const localAutomationBoardState = structuredClone(readyBoardState);
  localAutomationBoardState.emailSandbox.acceptedMessages = 9;
  localAutomationBoardState.emailSandbox.deliveryCallbacks = 9;
  localAutomationBoardState.emailSandbox.callbackFailures = 0;
  localAutomationBoardState.partners.automationMode = "transactional_auto";
  localAutomationBoardState.partners.automation.active = true;
  localAutomationBoardState.partners.followups = [
    ...localAutomationBoardState.partners.followups.map((item, index) => item.kind === "sponsor_outreach" ? item : ({
        ...item,
        status: "sent",
        deliveryStatus: "delivered",
        automationPolicy: "partner_transactional_v1",
        provider: "brevo",
        providerMessageId: `board-mail-${String(index + 1).padStart(32, "0")}`,
        deliveredAt: "2026-07-16T12:00:00.000Z",
        deliveryEvents: [{
          provider: "brevo",
          providerEventId: `board_${String(index + 1).padStart(64, "0")}`,
          type: "delivered",
          status: "delivered"
        }]
      })),
    {
      id: "demo_campaign_delivery",
      kind: "outreach_sequence",
      status: "sent",
      deliveryStatus: "delivered",
      automationPolicy: "outreach_campaign_v1",
      provider: "brevo",
      providerMessageId: `board-mail-${"9".repeat(32)}`,
      deliveredAt: "2026-07-16T12:00:00.000Z",
      deliveryEvents: [{
        provider: "brevo",
        providerEventId: `board_${"9".repeat(64)}`,
        type: "delivered",
        status: "delivered"
      }]
    }
  ];
  const localAutomationBoardReport = evaluateBoardDemoReadiness(localAutomationBoardState);
  const restartedLocalAutomationBoardState = structuredClone(localAutomationBoardState);
  restartedLocalAutomationBoardState.emailSandbox.acceptedMessages = 0;
  restartedLocalAutomationBoardState.emailSandbox.deliveryCallbacks = 0;
  const restartedLocalAutomationBoardReport = evaluateBoardDemoReadiness(restartedLocalAutomationBoardState);
  const missingLocalCampaignProof = structuredClone(localAutomationBoardState);
  missingLocalCampaignProof.partners.followups = missingLocalCampaignProof.partners.followups
    .filter(item => item.automationPolicy !== "outreach_campaign_v1");
  const missingLocalCampaignReport = evaluateBoardDemoReadiness(missingLocalCampaignProof);
  const missingReviewFirstProof = structuredClone(localAutomationBoardState);
  missingReviewFirstProof.partners.followups = missingReviewFirstProof.partners.followups
    .filter(item => !(item.kind === "sponsor_outreach" && item.status === "draft_ready" && !item.automationPolicy));
  missingReviewFirstProof.partners.summary.outreach.draftsAwaitingReview = 0;
  const missingReviewFirstReport = evaluateBoardDemoReadiness(missingReviewFirstProof);
  const missingAutomaticKeyDateProof = structuredClone(localAutomationBoardState);
  missingAutomaticKeyDateProof.partners.followups = missingAutomaticKeyDateProof.partners.followups
    .filter(item => item.kind !== "milestone_reminder");
  const missingAutomaticKeyDateReport = evaluateBoardDemoReadiness(missingAutomaticKeyDateProof);
  const missingPaymentConfirmationProof = structuredClone(localAutomationBoardState);
  missingPaymentConfirmationProof.partners.followups = missingPaymentConfirmationProof.partners.followups
    .filter(item => item.kind !== "payment_received");
  const missingPaymentConfirmationReport = evaluateBoardDemoReadiness(missingPaymentConfirmationProof);
  const missingSponsorProofReview = structuredClone(localAutomationBoardState);
  missingSponsorProofReview.partners.followups = missingSponsorProofReview.partners.followups
    .filter(item => item.kind !== "sponsor_deliverable_review");
  const missingSponsorProofReviewReport = evaluateBoardDemoReadiness(missingSponsorProofReview);
  const missingVendorOpening = structuredClone(localAutomationBoardState);
  missingVendorOpening.partners.followups = missingVendorOpening.partners.followups
    .filter(item => item.kind !== "vendor_applications_open");
  const missingVendorOpeningReport = evaluateBoardDemoReadiness(missingVendorOpening);
  const missingDurableDeliveryProof = structuredClone(localAutomationBoardState);
  delete missingDurableDeliveryProof.partners.followups.at(-1).deliveryEvents;
  const missingDurableDeliveryReport = evaluateBoardDemoReadiness(missingDurableDeliveryProof);
  const syntheticBoardConditions = publicIslandConditions(
    boardDemoSyntheticConditions({ eventId: DEFAULT_EVENT_ID }, "2026-07-16T12:00:00.000Z"),
    "2026-07-16T12:00:00.000Z"
  );
  ok("board demo conditions stay current, directional, and visibly synthetic without a network", syntheticBoardConditions.weather.source === "Board weather simulation"
    && syntheticBoardConditions.weather.freshness.state === "live"
    && syntheticBoardConditions.ferry.source === "Board ferry simulation"
    && syntheticBoardConditions.ferry.freshness.state === "live"
    && syntheticBoardConditions.ferry.directions.length === 2);
  const failedBoardReport = evaluateBoardDemoReadiness({
    ...readyBoardState,
    web: { ok: true, status: 200, html: "<main>ordinary development server</main>" },
    health: { ...readyBoardState.health, publicSiteUrl: "http://127.0.0.1:5176" },
    conditions: { ...readyBoardState.conditions, summary: { ...readyBoardState.conditions.summary, liveCameras: 0, healthyPipelines: 0, offlinePipelines: 8 } }
  });
  const readyBoardCameraCheck = readyBoardReport.checks.find(item => item.id === "camera_fleet");
  ok("board demo readiness accepts the complete local stack", readyBoardReport.ok
    && readyBoardReport.passed === readyBoardReport.total
    && readyBoardReport.total === 9
    && readyBoardCameraCheck?.detail.includes("synthetic playback")
    && readyBoardCameraCheck?.detail.includes("current")
    && !readyBoardCameraCheck?.detail.includes("live"));
  ok("board demo readiness requires loopback delivery proof in automatic mode", localAutomationBoardReport.ok
    && localAutomationBoardReport.checks.find(item => item.id === "operations")?.detail.includes("locally delivered messages")
    && localAutomationBoardReport.checks.find(item => item.id === "operations")?.detail.includes("vendor opening")
    && missingLocalCampaignReport.checks.find(item => item.id === "operations")?.ok === false
    && missingReviewFirstReport.checks.find(item => item.id === "operations")?.ok === false
    && missingAutomaticKeyDateReport.checks.find(item => item.id === "operations")?.ok === false
    && missingPaymentConfirmationReport.checks.find(item => item.id === "operations")?.ok === false
    && missingSponsorProofReviewReport.checks.find(item => item.id === "operations")?.ok === false
    && missingVendorOpeningReport.checks.find(item => item.id === "operations")?.ok === false
    && missingDurableDeliveryReport.checks.find(item => item.id === "operations")?.ok === false);
  ok("board demo readiness survives a fresh sandbox process when durable delivery proof is present", restartedLocalAutomationBoardReport.ok);
  const directionalCameraIds = ["harbor-island-entrance", "harbor-island-stacking", "ferry-loading", "ferry-stacking"];
  const partialFerryConditions = {
    ...readyBoardState.conditions,
    ferry: {
      status: "partial",
      freshness: { state: "live" },
      directions: [
        { id: "to-port-aransas", status: "unavailable" },
        { id: "to-aransas-pass", status: "live" }
      ]
    },
    cameras: Array.from({ length: 8 }, (_, index) => ({
      id: directionalCameraIds[index] || `camera-${index + 1}`,
      operationalStatus: "live",
      freshness: { state: "live" },
      observation: { observedAt: "2026-07-16T12:00:00.000Z" }
    }))
  };
  const partialFerryReport = evaluateBoardDemoReadiness({ ...readyBoardState, conditions: partialFerryConditions });
  const uncoveredFerryReport = evaluateBoardDemoReadiness({
    ...readyBoardState,
    conditions: {
      ...partialFerryConditions,
      cameras: partialFerryConditions.cameras.filter(camera => !camera.id.startsWith("harbor-island-"))
    }
  });
  const cameraOnlyFerryReport = evaluateBoardDemoReadiness({
    ...readyBoardState,
    conditions: {
      ...partialFerryConditions,
      ferry: { ...partialFerryConditions.ferry, status: "camera_estimate" }
    }
  });
  ok("board demo readiness requires signed camera coverage for partial ferry data", partialFerryReport.ok
    && uncoveredFerryReport.checks.find(item => item.id === "island_feeds")?.ok === false
    && cameraOnlyFerryReport.checks.find(item => item.id === "island_feeds")?.ok === false);
  ok("board demo readiness diagnoses origin, ordinary web, and stopped playback", !failedBoardReport.ok
    && failedBoardReport.checks.find(item => item.id === "auto_session")?.ok === false
    && failedBoardReport.checks.find(item => item.id === "public_links")?.ok === false
    && failedBoardReport.checks.find(item => item.id === "camera_fleet")?.ok === false
    && !JSON.stringify(failedBoardReport).includes(boardDemoAccess.token));
  const missingBriefingReport = evaluateBoardDemoReadiness({ ...readyBoardState, documents: { summary: {}, documents: [] } });
  ok("board demo readiness requires the extracted briefing without exposing private metadata", !missingBriefingReport.ok
    && missingBriefingReport.checks.find(item => item.id === "operations")?.ok === false
    && !JSON.stringify(readyBoardReport).includes("storageKey"));
  const missingSponsorBrandReport = evaluateBoardDemoReadiness({ ...readyBoardState, sponsors: { sponsors: [] }, sponsorLogo: { ok: false, status: 404 } });
  ok("board demo readiness requires rendered sponsor branding", !missingSponsorBrandReport.ok
    && missingSponsorBrandReport.checks.find(item => item.id === "operations")?.ok === false);
  const missingWorkflowReports = [
    state => { state.partners.payments = []; },
    state => { state.budget.summary.counts.pendingApprovals = 0; },
    state => { state.expenseExport.ok = false; },
    state => { state.partners.milestones = []; },
    state => { state.partners.followups = []; },
    state => { state.partners.tasks = state.partners.tasks.filter(item => item.assigneeType !== "staff"); },
    state => { state.partners.fulfillment.profiles.approved = 0; },
    state => { state.partners.vendorReadiness.totals.ready = 0; },
    state => { state.partners.summary.outreach.prospects = 0; }
  ].map(mutate => {
    const state = structuredClone(readyBoardState);
    mutate(state);
    return evaluateBoardDemoReadiness(state);
  });
  ok("board demo readiness requires budget, finance, key dates, messaging, delegation, fulfillment, vendor, and outreach proof", missingWorkflowReports.every(report => (
    report.ok === false && report.checks.find(item => item.id === "operations")?.ok === false
  )));
  let remoteBoardCheckRejected = false;
  try {
    boardDemoLoopbackUrl("http://127.0.0.1.evil.example:8806", "test URL");
  } catch {
    remoteBoardCheckRejected = true;
  }
  ok("board demo preflight endpoints stay exact-loopback", boardDemoLoopbackUrl("http://127.0.0.1:8806").hostname === "127.0.0.1" && remoteBoardCheckRejected);
  const presentationLinks = boardDemoPresentationLinks({
    SANDFEST_BOARD_PUBLIC_SITE_URL: "http://127.0.0.1:5199",
    SANDFEST_BOARD_API_BASE: "http://127.0.0.1:8899"
  });
  ok("board demo handoff links follow the supervisor-selected ports", presentationLinks.visitor === "http://127.0.0.1:5199/?apiBase=http%3A%2F%2F127.0.0.1%3A8899&mode=visitor"
    && presentationLinks.operations === "http://127.0.0.1:5199/admin.html?apiBase=http%3A%2F%2F127.0.0.1%3A8899");
}

// Public imagery is editorially selected so imported logos or source-order
// changes cannot leak into the visitor gallery.
{
  const sampleAssets = [...PUBLIC_GALLERY_MEDIA, ...PUBLIC_FIELD_MEDIA].map((item, index) => ({
    name: item.name,
    alt: "",
    category: "photos",
    publicPath: `/photos/${index}.jpg`
  }));
  const gallery = selectPublicMediaAssets(sampleAssets, PUBLIC_GALLERY_MEDIA);
  const field = selectPublicMediaAssets(sampleAssets, PUBLIC_FIELD_MEDIA);
  ok("public media selection resolves every curated photograph", gallery.length === 8 && field.length === 2);
  ok("public media selection preserves editorial order", gallery.map(asset => asset.name).join("|") === PUBLIC_GALLERY_MEDIA.map(item => item.name).join("|"));
  ok("public media selection supplies meaningful alternative text", [...gallery, ...field].every(asset => asset.alt && !/^DSC/i.test(asset.alt)));
  ok("public media selection ignores unrelated imported assets", selectPublicMediaAssets([{ name: "Sponsor Logo.png" }], PUBLIC_GALLERY_MEDIA).length === 0);
}

// Private portal capabilities leave the URL before network work begins. A
// definitive rejection clears only the matching saved capability so a stale
// response cannot erase a newer link; transient provider errors remain retryable.
{
  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key)
  };
  const key = "partner-portal";
  const stale = { reference: "TSF-V-000001", token: "tsfp_stale" };
  const current = { reference: "TSF-V-000001", token: "tsfp_current" };
  storage.setItem(key, JSON.stringify(current));
  const preservedNewer = !forgetMatchingPartnerPortalAccess(storage, key, stale) && storage.getItem(key) != null;
  const removedCurrent = forgetMatchingPartnerPortalAccess(storage, key, current) && storage.getItem(key) == null;
  ok("private portal fragment capabilities are concealed", partnerPortalSafeHash("#partner-status?reference=TSF-V-000001&token=private") === "#partner-status" && taskPortalSafeHash("#task-status?task=task_1&token=private") === "#task-status" && partnerPortalSafeHash("#sponsors") == null && taskPortalSafeHash("#sponsors") == null);
  ok("partner portal rejection classification preserves outage retries", shouldForgetPartnerPortalAccess(404) && shouldForgetPartnerPortalAccess(401) && !shouldForgetPartnerPortalAccess(429) && !shouldForgetPartnerPortalAccess(503) && !shouldForgetPartnerPortalAccess(0));
  ok("partner portal forgets only the rejected saved capability", preservedNewer && removedCurrent);
}

// Browser admin authentication
{
  const env = {
    VITE_SANDFEST_AUTH_MODE: "oidc",
    VITE_SANDFEST_AUTH_ISSUER: "https://auth.heyelab.com/",
    VITE_SANDFEST_AUTH_CLIENT_ID: "sandfest-admin",
    VITE_SANDFEST_AUTH_REDIRECT_URI: "https://sandfest-admin.heyelab.com/",
    VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI: "https://sandfest-admin.heyelab.com/",
    VITE_SANDFEST_AUTH_SCOPES: "openid profile email",
    VITE_SANDFEST_AUTH_AUDIENCE: "https://sandfest-api.heyelab.com",
    VITE_SANDFEST_API_BASE_URL: "https://sandfest-api.heyelab.com",
    SANDFEST_DEPLOYMENT_ENV: "production"
  };
  const config = normalizeAdminAuthConfig(env, "https://sandfest-admin.heyelab.com/?code=hidden");
  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
    key: index => [...memory.keys()][index] ?? null,
    get length() { return memory.size; }
  };
  const settings = oidcManagerSettings(config, storage);
  const callback = "https://sandfest-admin.heyelab.com/?apiBase=https%3A%2F%2Flocal.test&code=secret&state=abc&session_state=idp#admin-config";
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  let insecureRejected = false;
  let tokenProductionRejected = false;
  let missingClientRejected = false;
  try {
    normalizeAdminAuthConfig({ ...env, VITE_SANDFEST_AUTH_ISSUER: "http://auth.heyelab.com/" }, env.VITE_SANDFEST_AUTH_REDIRECT_URI);
  } catch { insecureRejected = true; }
  try {
    validateAdminBuildEnvironment({ ...env, VITE_SANDFEST_AUTH_MODE: "token" }, "admin");
  } catch { tokenProductionRejected = true; }
  try {
    validateAdminBuildEnvironment({ ...env, VITE_SANDFEST_AUTH_CLIENT_ID: "" }, "admin");
  } catch { missingClientRejected = true; }
  validateAdminBuildEnvironment(env, "admin");

  let cleanedCallback = null;
  let callbackUrl = null;
  class FakeUserManager {
    constructor(managerSettings) {
      this.settings = managerSettings;
      this.events = {
        addUserLoaded() {},
        addUserUnloaded() {},
        addAccessTokenExpired() {}
      };
    }
    async signinRedirectCallback(url) {
      callbackUrl = url;
      return { access_token: "callback-access-token", expires_at: Date.now() / 1_000 + 300, expired: false };
    }
    async signoutRedirectCallback() {}
    async getUser() { return null; }
    async clearStaleState() {}
    async removeUser() {}
  }
  const callbackWindow = {
    location: {
      href: "https://sandfest-admin.heyelab.com/?code=authorization-code&state=validated-state",
      assign() {}
    },
    history: { replaceState: (_state, _title, url) => { cleanedCallback = url; } },
    document: { title: "SandFest Ops Console" },
    sessionStorage: storage
  };
  const callbackClient = createAdminAuthClient({ env, windowObject: callbackWindow, ManagerClass: FakeUserManager });
  const callbackState = await callbackClient.initialize();

  ok("admin OIDC config pins issuer, client, redirect, and audience", config.issuer === env.VITE_SANDFEST_AUTH_ISSUER && config.clientId === "sandfest-admin" && config.redirectUri === env.VITE_SANDFEST_AUTH_REDIRECT_URI && config.audience === env.VITE_SANDFEST_AUTH_AUDIENCE);
  ok("admin OIDC uses authorization code with PKCE enabled", settings.response_type === "code" && settings.disablePKCE !== true && settings.automaticSilentRenew === false && settings.extraQueryParams.audience === env.VITE_SANDFEST_AUTH_AUDIENCE);
  ok("admin OIDC state and user records use supplied session storage", settings.stateStore && settings.userStore && settings.stateStore !== settings.userStore);
  ok("admin auth recognizes signin and signout callbacks", isSigninCallback(callback) && isSignoutCallback("https://sandfest-admin.heyelab.com/?state=logout") && !isSignoutCallback(callback));
  ok("admin auth removes callback secrets while preserving unrelated URL state", cleanAuthCallbackUrl(callback) === "/?apiBase=https%3A%2F%2Flocal.test#admin-config");
  ok("admin auth rejects expired or nearly expired access tokens", isUsableOidcUser({ access_token: "active", expires_at: now / 1_000 + 60, expired: false }, now) && !isUsableOidcUser({ access_token: "expired", expires_at: now / 1_000 + 2, expired: false }, now));
  ok("admin auth rejects insecure issuer URLs", insecureRejected);
  ok("production admin build rejects token mode and missing client registration", tokenProductionRejected && missingClientRejected);
  ok("admin OIDC callback establishes an in-memory access token", callbackState.authenticated && callbackState.callbackHandled && callbackClient.accessToken() === "callback-access-token" && callbackUrl.includes("authorization-code"));
  ok("admin OIDC callback removes authorization data from browser history", cleanedCallback === "/");
}

// Public partner-intake bot protection
{
  const productionEnv = {
    SANDFEST_ENV: "production",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org",
    SANDFEST_TURNSTILE_SECRET_KEY: "turnstile-production-secret-0123456789"
  };
  const config = turnstileConfig(productionEnv);
  const disabled = turnstileConfig({ SANDFEST_ENV: "development" });
  const missing = turnstileConfig({ SANDFEST_ENV: "production", SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org" });
  const unsafeEndpoint = turnstileConfig({ ...productionEnv, SANDFEST_TURNSTILE_SITEVERIFY_URL: "https://verify-proxy.example.com" });
  let verificationRequest = null;
  const verified = await verifyTurnstileToken({
    token: "valid-turnstile-token",
    action: "vendor_application",
    remoteIp: "203.0.113.8",
    idempotencyKey: "partner-intake-key-0001"
  }, {
    config,
    fetchImpl: async (url, init) => {
      verificationRequest = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        success: true,
        hostname: "www.texassandfest.org",
        action: "vendor_application",
        challenge_ts: "2026-07-16T12:00:00.000Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const wrongAction = await verifyTurnstileToken({ token: "wrong-action-token", action: "sponsor_inquiry" }, {
    config,
    fetchImpl: async () => new Response(JSON.stringify({ success: true, hostname: "www.texassandfest.org", action: "vendor_application" }), { status: 200 })
  });
  const failedChallenge = await verifyTurnstileToken({ token: "expired-token", action: "vendor_application" }, {
    config,
    fetchImpl: async () => new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), { status: 200 })
  });
  const unavailable = await verifyTurnstileToken({ token: "provider-error", action: "vendor_application" }, {
    config,
    fetchImpl: async () => { throw new Error("provider offline"); }
  });
  let missingPublicKeyRejected = false;
  let testPublicKeyRejected = false;
  try {
    validatePublicBuildEnvironment({ SANDFEST_DEPLOYMENT_ENV: "production" }, "public");
  } catch { missingPublicKeyRejected = true; }
  try {
    validatePublicBuildEnvironment({ SANDFEST_DEPLOYMENT_ENV: "production", VITE_SANDFEST_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }, "public");
  } catch { testPublicKeyRejected = true; }
  validatePublicBuildEnvironment({
    SANDFEST_DEPLOYMENT_ENV: "production",
    SANDFEST_BUILD_VERIFICATION: "true",
    VITE_SANDFEST_TURNSTILE_SITE_KEY: "1x00000000000000000000AA"
  }, "public");

  ok("Turnstile is optional locally and mandatory in production", !disabled.enabled && disabled.ready && missing.enabled && !missing.ready);
  ok("Turnstile production config pins official verification and public hostname", config.ready && config.siteverifyUrl === TURNSTILE_SITEVERIFY_URL && config.expectedHostname === "www.texassandfest.org" && !unsafeEndpoint.ready);
  ok("Turnstile validates token, hostname, action, IP, and retry identity", verified.ok && verificationRequest.url === TURNSTILE_SITEVERIFY_URL && verificationRequest.body.secret === productionEnv.SANDFEST_TURNSTILE_SECRET_KEY && verificationRequest.body.remoteip === "203.0.113.8" && /^[0-9a-f-]{36}$/.test(verificationRequest.body.idempotency_key));
  ok("Turnstile rejects wrong-action and expired challenges", !wrongAction.ok && wrongAction.errorCodes.includes("action-mismatch") && !failedChallenge.ok && failedChallenge.errorCodes.includes("timeout-or-duplicate"));
  ok("Turnstile fails closed when Siteverify is unavailable", !unavailable.ok && unavailable.unavailable === true);
  ok("production public build requires a real Turnstile site key", missingPublicKeyRejected && testPublicKeyRejected);
}

// Public sculptor roster publication authority
{
  const records = {
    sculptors: [{ id: "sculptor-1", name: "Reviewed Artist", entryId: "entry-1" }],
    entries: [{ id: "entry-1", sculptorId: "sculptor-1", title: "Reviewed Entry" }],
    pois: [{ id: "poi-1", entryId: "entry-1", type: "sculpture" }]
  };
  const sample = {
    meta: {
      eventId: DEFAULT_EVENT_ID,
      publicationStatus: "sample",
      source: "fictional_board_demo"
    },
    ...records
  };
  const published = {
    meta: {
      eventId: DEFAULT_EVENT_ID,
      publicationStatus: "published",
      source: "official_website",
      sourceUrl: "https://www.texassandfest.org/sculptors",
      sourceCheckedAt: "2026-07-17T12:00:00.000Z",
      reviewedAt: "2026-07-17T12:05:00.000Z",
      reviewedBy: "content-team",
      publishedAt: "2026-07-17T12:10:00.000Z"
    },
    ...records
  };
  const unpublished = publicSculptorRosterPublication({
    meta: { eventId: DEFAULT_EVENT_ID, publicationStatus: "unpublished" },
    sculptors: [],
    entries: [],
    pois: []
  });
  const samplePublic = publicSculptorRosterPublication(sample);
  const sampleLocal = publicSculptorRosterPublication(sample, { allowSample: true });
  const validPublished = publicSculptorRosterPublication(published);
  const validIsoVariants = publicSculptorRosterPublication({
    ...published,
    meta: {
      ...published.meta,
      sourceCheckedAt: "2026-07-17T12:00:00Z",
      reviewedAt: "2026-07-17T07:05:00-05:00",
      publishedAt: "2026-07-17T12:10:00.12Z"
    }
  });
  const weakPublished = publicSculptorRosterPublication({
    ...published,
    meta: { ...published.meta, source: "placeholder", reviewedAt: null }
  });
  const brokenReference = publicSculptorRosterPublication({
    ...published,
    entries: [{ ...published.entries[0], sculptorId: "missing-sculptor" }]
  });

  ok("unpublished sculptor roster fails closed", !unpublished.visible && unpublished.mode === "unpublished" && unpublished.counts.sculptors === 0);
  ok("fictional sculptor roster is local-demo only", !samplePublic.visible && sampleLocal.visible && sampleLocal.mode === "demo");
  ok("published sculptor roster requires reviewed source authority", validPublished.visible && validIsoVariants.visible && validPublished.mode === "published" && !weakPublished.visible && weakPublished.issues.length === 2);
  ok("published sculptor roster validates record references", !brokenReference.visible && brokenReference.issues.some(issue => issue.includes("missing sculptor")));
}

// Governed public event guide
{
  const guide = {
    id: "texas-sandfest-2027",
    name: "Texas SandFest",
    startDate: "2027-04-16",
    endDate: "2027-04-18",
    dailyOpen: "09:00",
    dailyClose: "19:30",
    location: "On the beach, Port Aransas, TX 78373",
    mission: "The largest beach sand sculpture competition in the USA.",
    phone: "361-267-2474",
    email: "info@texassandfest.org",
    address: "200 S. Alister Street, Suite E, Port Aransas, TX 78373",
    sourceUrl: "https://www.texassandfest.org/knowbeforeyougo",
    sourceCheckedAt: "2026-07-16T12:00:00.000Z"
  };
  const normalized = normalizeEventGuide(guide);
  const published = publishEventGuide({}, guide, {
    actorId: "content-test",
    now: "2026-07-17T12:00:00.000Z"
  });
  const invalid = publishEventGuide(guide, {
    startDate: "2027-04-19",
    endDate: "2027-04-18",
    dailyClose: "08:30",
    sourceUrl: "http://example.com/event",
    sourceCheckedAt: "2026-07-18T12:00:00.000Z"
  }, { actorId: "content-test", now: "2026-07-17T12:00:00.000Z" });
  const wrongYear = publishEventGuide(guide, { id: "texas-sandfest-2026" }, {
    actorId: "content-test",
    now: "2026-07-17T12:00:00.000Z"
  });
  const ready = eventGuideReadiness(published.guide, {
    now: "2026-07-18T12:00:00.000Z",
    maxSourceAgeDays: 90
  });
  const stale = eventGuideReadiness(published.guide, {
    now: "2026-11-01T12:00:00.000Z",
    maxSourceAgeDays: 90
  });
  const past = eventGuideReadiness({ ...published.guide, endDate: "2026-04-18" }, {
    now: "2026-07-18T12:00:00.000Z",
    maxSourceAgeDays: 90
  });
  const publicGuide = publicEventGuide(published.guide);
  ok("event guide derives canonical dates and hours", normalized.dateRange === "April 16-18, 2027" && normalized.hours === "9:00 AM - 7:30 PM daily");
  ok("event guide publish records actor and timestamp", published.ok && published.guide.publishedBy === "content-test" && published.guide.status === "published");
  ok("event guide rejects invalid dates, hours, source, and future review", !invalid.ok && invalid.errors.length === 4);
  ok("event guide rejects an id from a different event year", !wrongYear.ok && wrongYear.errors.includes("Event id and start-date year must match."));
  ok("event guide readiness requires current upcoming facts", ready.ready && ready.sourceAgeDays === 2 && !stale.ready && stale.missing.includes("source") && !past.ready && past.missing.includes("upcoming"));
  ok("public event guide hides publishing identity", !("publishedBy" in publicGuide) && !("status" in publicGuide) && publicGuide.sourceUrl === guide.sourceUrl);
}

// Public bootstrap projection
{
  const internalBootstrap = {
    guide: {
      id: "texas-sandfest-2027",
      publishedBy: "staff-private-id"
    },
    schedule: [
      { id: "gates", day: "Friday", time: "9:00 AM", title: "Beach gates open", zone: "North Gate", category: "Visitor", internalOwner: "operations" },
      { id: "briefing", day: "Friday", time: "8:15 AM", title: "Volunteer captain briefing", zone: "Command", category: "Staff" }
    ],
    zones: [{ id: "north-gate", name: "North Gate", marker: "12.5", summary: "Guest entrance.", status: "busy" }],
    alert: { id: "none", active: false, audience: ["public", "staff"] },
    sponsors: [{ invoiceStatus: "overdue" }],
    vendors: [{ complianceStatus: "blocked" }],
    coverage: [{ zone: "South", gap: 4 }],
    financeSignals: [{ quickBooksStatus: "needs_match" }],
    runtime: { mode: "board_demo", label: "Synthetic board data", storageRoot: "/private/runtime" }
  };
  const projected = publicAppBootstrap(internalBootstrap);
  const boardProjected = publicAppBootstrap(internalBootstrap, { includeBoardRuntime: true });
  const serialized = JSON.stringify(projected);

  ok("public bootstrap exposes only approved root collections", JSON.stringify(Object.keys(projected).sort()) === JSON.stringify(["alert", "guide", "schedule", "zones"]));
  ok("public bootstrap excludes staff schedule and operational zone state", projected.schedule.length === 1 && projected.schedule[0].title === "Beach gates open" && !Object.hasOwn(projected.zones[0], "status"));
  ok("public bootstrap excludes publishing identity and private operations", !Object.hasOwn(projected.guide, "publishedBy") && !/(sponsors|vendors|coverage|financeSignals|invoiceStatus|quickBooksStatus)/.test(serialized));
  ok("public bootstrap policy rejects unprojected internal data", !publicAppBootstrapSafety(internalBootstrap).ready && publicAppBootstrapSafety(internalBootstrap).errors.some(error => error.includes("Unexpected public bootstrap keys")));
  ok("board runtime label requires explicit projection and validation", !Object.hasOwn(projected, "runtime") && boardProjected.runtime?.mode === "board_demo" && publicAppBootstrapSafety(boardProjected, { allowBoardRuntime: true }).ready && !publicAppBootstrapSafety(boardProjected).ready);
}

// Public media manifest projection
{
  const internalManifest = {
    generatedAt: "2026-07-18T12:00:00.000Z",
    source: "https://www.texassandfest.org/",
    failures: [{ error: "private fetch detail" }],
    assets: [{
      id: "hero",
      category: "photos",
      role: "hero",
      name: "SandFest hero",
      alt: "Sand sculpture on the beach",
      sourcePage: "https://www.texassandfest.org/",
      originalUrl: "https://upstream.example.test/original.jpg",
      publicPath: "/assets/sandfest-media/photos/hero.jpg",
      file: "/Users/operator/private/hero.jpg",
      contentType: "image/jpeg",
      bytes: 1200,
      transform: { width: 1200, height: 800 }
    }]
  };
  const projected = publicMediaManifest(internalManifest);
  ok("public media manifest omits local and upstream implementation fields", publicMediaManifestSafety(projected).ready && !/(file|originalUrl|failures|\/Users\/)/.test(JSON.stringify(projected)));
  ok("public media manifest policy rejects internal source records", !publicMediaManifestSafety(internalManifest).ready);
}

// Governed public concierge
{
  const context = {
    bootstrap: {
      guide: {
        name: "Texas SandFest",
        dateRange: "April 16-18, 2027",
        hours: "9:00 AM - 7:30 PM daily",
        location: "On the beach, Port Aransas, TX 78373",
        email: "info@texassandfest.org",
        phone: "361-267-2474",
        sourceUrl: "https://www.texassandfest.org/knowbeforeyougo",
        sourceCheckedAt: "2026-07-18T12:00:00.000Z"
      },
      schedule: [{ day: "Friday", time: "9:00 AM", title: "Beach gates open" }],
      zones: [
        { id: "north-gate", name: "North Gate", marker: "12.5", summary: "Guest Relations, ticket scan, ADA parking, wristbands." },
        { id: "south-gate", name: "South Entrance", marker: "Access Road 1A", summary: "Shuttle drop-off, south beer tent, food and vendor access." }
      ]
    },
    tickets: {
      lastUpdated: "2026-07-18T12:00:00.000Z",
      currency: "usd",
      products: [
        { name: "Adult day pass", unitAmount: 1500, availableForCheckout: true },
        { name: "VIP day pass", unitAmount: null, priceLabel: "Set in Stripe", availableForCheckout: false }
      ]
    },
    sponsors: {
      lastUpdated: "2026-07-18T12:00:00.000Z",
      sponsorPackages: [{ name: "Gulf Partner", amount: 500000, currency: "usd" }]
    },
    vendors: {
      lastUpdated: "2026-07-18T12:00:00.000Z",
      vendorOfferings: [{ name: "Food vendor", amount: 65000, currency: "usd" }]
    },
    islandConditions: {
      lastUpdated: "2026-07-18T12:00:00.000Z",
      weather: { status: "live", temperatureF: 86, shortForecast: "Sunny", source: "National Weather Service", sourceUrl: "https://weather.gov/", observedAt: "2026-07-18T12:00:00.000Z", alerts: [] },
      ferry: { status: "normal", source: "TxDOT Ferry Operations", sourceUrl: "https://www.txdot.gov/discover/ferry-boat-schedules/ferry-webcam-harbor-side.html", observedAt: "2026-07-18T12:00:00.000Z", directions: [{ label: "Aransas Pass to Port Aransas", status: "normal", estimatedWaitMinutes: 12 }], operatingFerries: 4 },
      cameras: [{ name: "North Gate", zone: "North Gate", operationalStatus: "live", level: "moderate", observation: { estimatedWaitMinutes: 6 } }]
    }
  };
  const ticketResult = answerPublicConcierge("Where can I buy tickets?", context);
  const ferryResult = answerPublicConcierge("How long is the ferry line?", context);
  const sponsorResult = answerPublicConcierge("What should a sponsor dashboard track?", context);
  const accessibilityResult = answerPublicConcierge("What accessibility guidance is available?", context);
  const missingAccessibilityResult = answerPublicConcierge("What accessibility guidance is available?", {
    ...context,
    bootstrap: { ...context.bootstrap, zones: [] }
  });
  const parkingResult = answerPublicConcierge("Is parking information available?", context);
  const missingParkingResult = answerPublicConcierge("Is parking information available?", {
    ...context,
    bootstrap: { ...context.bootstrap, zones: [] }
  });
  const vendorResult = answerPublicConcierge("How do vendors apply?", context);
  const vendorInterestResult = answerPublicConcierge("How do vendors apply?", {
    ...context,
    vendors: {
      ...context.vendors,
      vendorOfferings: [{ name: "Food vendor interest", amount: 0, publicLabel: "Fee confirmed when applications open", intakeMode: "interest" }]
    }
  });
  const mixedVendorResult = answerPublicConcierge("How do vendors apply?", {
    ...context,
    vendors: {
      ...context.vendors,
      vendorOfferings: [
        { name: "Food vendor interest", amount: 0, publicLabel: "Fee confirmed when applications open", intakeMode: "interest" },
        { name: "Marketplace booth", amount: 125000, currency: "usd", intakeMode: "application" }
      ]
    }
  });
  const emergencyResult = answerPublicConcierge("My child is missing. Is this an emergency?", context);
  const unknownResult = answerPublicConcierge("Can I bring a telescope? private@example.com", context);
  const { ok: ticketOk, ...ticketPayload } = ticketResult;
  const { ok: unknownOk, ...unknownPayload } = unknownResult;
  ok("public concierge validates and bounds questions", !parsePublicConciergeQuestion("x").ok && !parsePublicConciergeQuestion("x".repeat(281)).ok && parsePublicConciergeQuestion("When is SandFest?").topic === "schedule");
  ok("public concierge routes live-condition topics", publicConciergeNeedsConditions("weather") && publicConciergeNeedsConditions("ferry") && !publicConciergeNeedsConditions("tickets"));
  ok("public concierge answers ticket questions from current catalog", ticketOk && ticketPayload.topic === "tickets" && ticketPayload.answer.includes("Adult day pass ($15)") && ticketPayload.answer.includes("VIP day pass (price pending)") && !ticketPayload.answer.includes("Stripe") && ticketPayload.sources.some(item => item.href === "#tickets"));
  ok("public concierge answers ferry questions from current public conditions", ferryResult.ok && ferryResult.topic === "ferry" && ferryResult.answer.includes("about 12 minutes") && ferryResult.sources.some(item => item.href.startsWith("https://www.txdot.gov/")));
  ok("public concierge replaces internal sponsor roadmap claims with public packages", sponsorResult.ok && sponsorResult.topic === "sponsor" && sponsorResult.answer.includes("Gulf Partner ($5,000)") && !sponsorResult.answer.toLowerCase().includes("dashboard"));
  ok("public concierge answers accessibility from approved public zones", accessibilityResult.ok && accessibilityResult.topic === "accessibility" && accessibilityResult.confidence === "high" && !accessibilityResult.escalated && accessibilityResult.answer.includes("North Gate at marker 12.5") && accessibilityResult.answer.includes("ADA parking") && !accessibilityResult.answer.includes(".).") && accessibilityResult.sources.some(item => item.href === "#operations"));
  ok("public concierge escalates accessibility without approved locations", missingAccessibilityResult.ok && missingAccessibilityResult.topic === "accessibility" && missingAccessibilityResult.confidence === "low" && missingAccessibilityResult.escalated && !missingAccessibilityResult.answer.includes("North Gate"));
  ok("public concierge answers parking from approved arrival zones", parkingResult.ok && parkingResult.topic === "parking" && parkingResult.confidence === "medium" && parkingResult.escalated && parkingResult.answer.includes("North Gate at marker 12.5") && parkingResult.answer.includes("South Entrance at marker Access Road 1A") && parkingResult.answer.includes("not included in this feed") && parkingResult.sources.some(item => item.href === "#operations"));
  ok("public concierge escalates parking without approved locations", missingParkingResult.ok && missingParkingResult.topic === "parking" && missingParkingResult.confidence === "low" && missingParkingResult.escalated && !missingParkingResult.answer.includes("North Gate"));
  ok("public concierge follows application-open vendor catalog wording", vendorResult.ok && vendorResult.topic === "vendor" && vendorResult.answer.includes("vendor application") && !vendorResult.answer.includes("interest list"));
  ok("public concierge follows interest-only vendor catalog wording", vendorInterestResult.ok && vendorInterestResult.topic === "vendor" && vendorInterestResult.answer.includes("join the interest list") && vendorInterestResult.answer.includes("when applications open") && !vendorInterestResult.answer.includes("use the vendor application"));
  ok("public concierge explains mixed vendor intake without overpromising", mixedVendorResult.ok && mixedVendorResult.topic === "vendor" && mixedVendorResult.answer.includes("Some programs are accepting applications while others are collecting interest") && mixedVendorResult.answer.includes("see the current path"));
  ok("public concierge routes urgent safety questions to emergency help", emergencyResult.ok && emergencyResult.topic === "emergency" && emergencyResult.escalated && emergencyResult.answer.includes("Call 911") && emergencyResult.answer.includes("cannot dispatch"));
  ok("public concierge escalates unsupported questions without echoing input", unknownOk && unknownPayload.escalated && !JSON.stringify(unknownPayload).includes("private@example.com") && publicConciergeResponseSafety(unknownPayload).ready);
  ok("public concierge safety rejects private implementation fields", !publicConciergeResponseSafety({ ...ticketPayload, storageRoot: "/private/runtime" }).ready);
}

// Annual event context and archive-first rollover
{
  const guide = {
    id: DEFAULT_EVENT_ID,
    startDate: "2027-04-16",
    endDate: "2027-04-18",
    dailyOpen: "09:00",
    dailyClose: "19:30"
  };
  const config = eventContextConfig({ SANDFEST_EVENT_ID: DEFAULT_EVENT_ID });
  const incomingDocumentSeed = JSON.parse(await readFile(path.join(ROOT, "data", "processed", "incoming-documents.json"), "utf8"));
  const aligned = eventContextReadiness({
    config,
    guide,
    operationalDocs: [
      { key: "fleet", eventId: DEFAULT_EVENT_ID },
      { key: "partnerOps", eventId: DEFAULT_EVENT_ID }
    ]
  });
  const mismatched = eventContextReadiness({
    config,
    guide,
    operationalDocs: [{ key: "fleet", eventId: "texas-sandfest-2026" }, { key: "partnerOps", eventId: null }]
  });
  const invalidConfig = eventContextConfig({ SANDFEST_EVENT_ID: "sandfest-next" });
  const from = "texas-sandfest-2026";
  const documents = {
    budgetControl: { ...emptyBudgetControl(from), budgetLines: [{ id: "line-1", eventId: from }], expenses: [{ id: "expense-1", eventId: from }] },
    fleet: { eventId: from, assets: [{ id: "cart-1", eventId: from, status: "checked_out" }], checkouts: [{ id: "co-1" }], locations: [{ id: "loc-1" }] },
    volunteers: { eventId: from, volunteers: [{ id: "vol-1", eventId: from, status: "confirmed" }], shifts: [{ id: "shift-1" }], hourLogs: [{ id: "hours-1" }] },
    staffDirectory: { eventId: from, source: "manual_verified", staff: [{ id: "staff-1", eventId: from, status: "active", name: "Staff One", email: "staff@example.com" }], teamRoutes: [] },
    consent: { eventId: from, records: [{ id: "consent-1" }] },
    passportHunt: { hunt: { id: "sculpture-passport-2026", eventId: from }, checkpoints: [{ id: "cp-1", huntId: "sculpture-passport-2026" }] },
    passportCompletions: { completions: [{ id: "hc-1" }] },
    voting: { eventId: from, votingOpen: true, entries: [{ id: "entry-1" }], votes: [{ id: "vote-1" }] },
    booths: { eventId: from, booths: [{ id: "booth-1", eventId: from }], vendors: [{ id: "vendor-1", eventId: from }] },
    partnerOps: { ...emptyPartnerOperations(from), applications: [{ id: "app-1" }] },
    incomingDocuments: { ...emptyIncomingDocumentIntake(from), documents: [{ id: "doc-1", eventId: from }] },
    islandConditions: { eventId: from, cameras: [{ id: "cam-1", observation: { peopleCount: 20 } }], observations: [{ id: "obs-1" }], incidents: [{ id: "incident-1" }], dispatches: [{ id: "dispatch-1" }] },
    smsOperations: { ...emptySmsOperations(from), campaigns: [{ id: "sms-campaign-1" }], messages: [{ id: "sms-message-1" }], preferenceEvents: [{ id: "sms-preference-1" }] }
  };
  const rollover = planEventRollover({
    fromEventId: from,
    toEventId: DEFAULT_EVENT_ID,
    guide,
    documents,
    now: "2026-07-17T01:00:00.000Z"
  });
  const rejectedRollover = planEventRollover({
    fromEventId: from,
    toEventId: DEFAULT_EVENT_ID,
    guide,
    documents: { ...documents, fleet: { ...documents.fleet, eventId: DEFAULT_EVENT_ID } }
  });
  ok("current event context validates explicit annual namespace", config.valid && config.explicit && config.eventId === DEFAULT_EVENT_ID && aligned.ready);
  ok("private document seed uses the current annual namespace", incomingDocumentSeed.eventId === DEFAULT_EVENT_ID && incomingDocumentSeed.documents.length === 0);
  ok("current event context reports stale and missing operational documents", !mismatched.ready && mismatched.mismatchedDocs.length === 2 && !invalidConfig.valid);
  ok("event rollover covers every governed operational document", rollover.ok && Object.keys(rollover.documents).length === ROLLOVER_DOCUMENT_KEYS.length && /^[a-f0-9]{64}$/.test(rollover.archiveDigest));
  ok("event archive digest is stable across object key order", eventArchiveDigest({ b: 2, a: { d: 4, c: 3 } }) === eventArchiveDigest({ a: { c: 3, d: 4 }, b: 2 }));
  ok("event rollover carries reusable setup and resets season activity", rollover.documents.budgetControl.budgetLines.length === 0 && rollover.documents.budgetControl.expenses.length === 0 && rollover.documents.fleet.assets[0].status === "available" && rollover.documents.fleet.checkouts.length === 0 && rollover.documents.volunteers.shifts.length === 0 && rollover.documents.consent.records.length === 0 && rollover.documents.passportHunt.hunt.id === "sculpture-passport-2027" && rollover.documents.passportHunt.hunt.active === false && rollover.documents.voting.votes.length === 0 && rollover.documents.partnerOps.eventId === DEFAULT_EVENT_ID && rollover.documents.incomingDocuments.documents.length === 0 && rollover.documents.islandConditions.incidents.length === 0 && rollover.documents.smsOperations.campaigns.length === 0);
  ok("event rollover refuses mixed source context", !rejectedRollover.ok && rejectedRollover.mismatches?.[0]?.key === "fleet");
}

// Security boundaries
{
  const generatedRequestId = normalizeRequestId("not valid/request/id", { idFactory: () => "fixed-id" });
  const preservedRequestId = normalizeRequestId("edge.trace:123");
  const redacted = redactAuditValue({
    token: "partner-capability",
    nested: {
      refreshToken: "oauth-refresh",
      clientSecret: "oauth-secret",
      tokenId: "jwt-id",
      contactEmail: "operations@example.com"
    },
    items: [{ authorization: "Bearer secret", status: "approved" }]
  });
  const productionFailure = safeErrorResponse(new Error("database password=do-not-return"), { production: true });
  const oversizedFailure = safeErrorResponse(Object.assign(new Error("Request body exceeds 256 KiB."), { statusCode: 413 }), { production: true });
  ok("request IDs are bounded and normalized", generatedRequestId === "req_fixed-id" && preservedRequestId === "edge.trace:123");
  ok("audit payload secrets are recursively redacted", redacted.token === "[REDACTED]" && redacted.nested.refreshToken === "[REDACTED]" && redacted.nested.clientSecret === "[REDACTED]" && redacted.items[0].authorization === "[REDACTED]" && redacted.nested.tokenId === "jwt-id" && redacted.nested.contactEmail === "operations@example.com");
  ok("production errors hide internal details", productionFailure.status === 500 && productionFailure.message === "Internal server error." && !productionFailure.message.includes("password"));
  ok("expected body-limit errors remain actionable", oversizedFailure.status === 413 && oversizedFailure.message.includes("256 KiB"));
}

// Governed operations exports
{
  const eventId = DEFAULT_EVENT_ID;
  const applicationId = "sapp_export_1";
  const invoiceId = "invoice_export_1";
  const doc = {
    ...emptyPartnerOperations(eventId),
    applications: [{
      id: applicationId,
      eventId,
      reference: "TSF-S-900001",
      type: "sponsor",
      status: "approved",
      organizationName: "=SUM(A1:A2) Coastal Bank",
      contactName: "Avery Rivera",
      contactEmail: "avery.export@example.com",
      contactPhone: "361-555-0100",
      city: "Port Aransas",
      state: "TX",
      postalCode: "78373",
      expectedAmountCents: 10_000,
      portalAccessId: "must-not-export",
      intakeIdempotencyKeyHash: "must-not-export",
      createdAt: "2026-07-16T12:00:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z"
    }],
    invoices: [{
      id: invoiceId,
      applicationId,
      amountCents: 10_000,
      status: "approved",
      dueAt: "2026-07-20T12:00:00.000Z",
      quickBooksDocNumber: "QB-1001",
      quickBooksBalanceCents: 7_500
    }],
    payments: [{
      id: "payment_export_1",
      applicationId,
      invoiceId,
      amountCents: 2_500,
      appliedAmountCents: 2_500,
      unappliedAmountCents: 0,
      refundedAmountCents: 0,
      method: "ach",
      status: "succeeded",
      reconciliationStatus: "matched",
      externalRef: "ACH-EXPORT-1",
      receivedAt: "2026-07-16T12:00:00.000Z"
    }],
    tasks: [{
      id: "task_export_1",
      title: "Confirm sponsor signage",
      description: "+Do not execute this cell",
      status: "open",
      priority: "high",
      assigneeType: "team",
      assigneeId: "sponsor",
      assigneeName: "Sponsor team",
      dueAt: "2026-07-19T12:00:00.000Z"
    }],
    followups: [{
      id: "followup_task_export_1",
      taskId: "task_export_1",
      kind: "task_assignment",
      status: "sent",
      deliveryStatus: "delivered",
      recipient: "private-volunteer@example.com",
      updatedAt: "2026-07-16T13:00:00.000Z"
    }],
    prospects: [{
      id: "prospect_export_1",
      organizationName: "@Regional Business",
      industry: "banking",
      city: "Corpus Christi",
      state: "TX",
      postalCode: "78401",
      contactName: "Jordan Lee",
      contactEmail: "jordan.export@example.com",
      status: "qualified",
      fitScore: 88,
      contactBasis: "business_relevance",
      ownerId: "sponsor_lead",
      nextAction: "Review invitation",
      nextActionAt: "2026-07-20T15:00:00.000Z"
    }],
    milestones: [{
      id: "milestone_export_1",
      applicationId,
      label: "Approve the complete sponsor hospitality roster and production placement schedule for the festival operations team",
      dueAt: "2026-07-21T17:00:00.000Z",
      status: "open",
      assigneeTeam: "sponsor",
      reminderLeadDays: 3,
      scheduleVersion: 2
    }]
  };
  const partners = partnerDirectoryExport(doc, eventId);
  const receivables = receivablesExport(doc, eventId, "2026-07-22T12:00:00.000Z");
  const payments = paymentsExport(doc, eventId);
  const tasks = tasksExport(doc, eventId);
  const outreach = outreachProspectsExport(doc, eventId);
  const calendar = milestonesCalendarExport(doc, eventId, "2026-07-16T12:00:00.000Z");
  const budgetDoc = {
    ...emptyBudgetControl(eventId),
    budgetLines: [{
      id: "budget_export_1",
      eventId,
      name: "=Beach operations",
      ownerTeam: "operations",
      budgetCents: 100_000,
      notes: "Annual operating allocation",
      active: true,
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z"
    }, {
      id: "budget_old_event",
      eventId: "texas-sandfest-2026",
      name: "Prior event allocation",
      ownerTeam: "finance",
      budgetCents: 999_999,
      active: true
    }],
    expenses: [{
      id: "expense_export_submitted",
      eventId,
      budgetLineId: "budget_export_1",
      vendorName: "Coastal Services",
      description: "+Do not execute this description",
      amountCents: 25_000,
      dueDate: "2026-07-20",
      status: "submitted",
      requestedBy: "ops_1",
      submittedAt: "2026-07-03T12:00:00.000Z",
      createdAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-07-03T12:00:00.000Z"
    }, {
      id: "expense_export_paid",
      eventId,
      budgetLineId: "budget_export_1",
      vendorName: "Island Rentals",
      description: "Gate equipment rental",
      amountCents: 40_000,
      dueDate: "2026-07-21",
      status: "paid",
      requestedBy: "ops_2",
      submittedAt: "2026-07-04T12:00:00.000Z",
      approvedAt: "2026-07-05T12:00:00.000Z",
      approvedBy: "finance_1",
      paidAt: "2026-07-06T12:00:00.000Z",
      paidBy: "finance_2",
      paymentMethod: "ach",
      paymentReference: "ACH-EXPENSE-1",
      overBudgetOverride: true,
      resolutionNote: "Approved for event operations",
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z"
    }, {
      id: "expense_old_event",
      eventId: "texas-sandfest-2026",
      budgetLineId: "budget_old_event",
      vendorName: "Prior Event Vendor",
      description: "Prior event expense",
      amountCents: 50_000,
      dueDate: "2025-07-20",
      status: "paid"
    }]
  };
  const budget = budgetAllocationsExport(budgetDoc, eventId);
  const expenses = expenseRegisterExport(budgetDoc, eventId);
  const partnerCsv = partners.body.toString("utf8");
  const calendarText = calendar.body.toString("utf8");
  const budgetCsv = budget.body.toString("utf8");
  const expenseCsv = expenses.body.toString("utf8");
  ok("CSV exports neutralize spreadsheet formulas", csvCell("=2+2") === '"\'=2+2"' && partnerCsv.includes('"\'=SUM(A1:A2) Coastal Bank"') && tasks.body.toString("utf8").includes('"\'+Do not execute this cell"'));
  ok("task export includes notification state without recipient", tasks.body.toString("utf8").includes("Notification status") && tasks.body.toString("utf8").includes("delivered") && !tasks.body.toString("utf8").includes("private-volunteer@example.com"));
  ok("partner export excludes capability and idempotency secrets", partners.rowCount === 1 && partnerCsv.includes("avery.export@example.com") && !partnerCsv.includes("must-not-export") && !partnerCsv.includes("portalAccess"));
  ok("finance exports preserve ledger amounts and references", receivables.rowCount === 1 && receivables.body.toString("utf8").includes('"75.00"') && payments.rowCount === 1 && payments.body.toString("utf8").includes("ACH-EXPORT-1"));
  ok("accounting exports preserve allocation and expense evidence", budget.rowCount === 1 && budget.fileName === `${eventId}-budget-allocations.csv` && budgetCsv.includes('"1000.00"') && budgetCsv.includes('"400.00"') && budgetCsv.includes('"650.00"') && expenses.rowCount === 2 && expenses.fileName === `${eventId}-expense-register.csv` && expenseCsv.includes("ACH-EXPENSE-1") && expenseCsv.includes("Over-budget override"));
  ok("accounting exports are current-event and spreadsheet safe", budgetCsv.includes('"\'=Beach operations"') && expenseCsv.includes('"\'+Do not execute this description"') && !budgetCsv.includes("Prior event allocation") && !expenseCsv.includes("Prior Event Vendor"));
  ok("outreach export preserves suppression-ready pipeline fields", outreach.rowCount === 1 && outreach.body.toString("utf8").includes("Contact basis") && outreach.body.toString("utf8").includes("Next action due at") && outreach.body.toString("utf8").includes("2026-07-20T15:00:00.000Z") && outreach.body.toString("utf8").includes('"\'@Regional Business"'));
  ok("key-date calendar is importable and contact-minimized", calendar.rowCount === 1 && calendarText.includes("BEGIN:VCALENDAR") && calendarText.includes("BEGIN:VEVENT") && calendarText.includes("SEQUENCE:1") && !calendarText.includes("avery.export@example.com") && calendarText.split("\r\n").every(line => Buffer.byteLength(line, "utf8") <= 75));
}

// Backup and restore readiness
{
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const ready = recoveryReadiness({
    SANDFEST_BACKUP_PROVIDER: "render-managed",
    SANDFEST_DATABASE_RECOVERY_WINDOW_DAYS: "3",
    SANDFEST_ASSET_SNAPSHOT_RETENTION_DAYS: "7",
    SANDFEST_DATABASE_RESTORE_DRILL_AT: "2026-07-15T12:00:00.000Z",
    SANDFEST_ASSET_RESTORE_DRILL_AT: "2026-07-14T12:00:00.000Z",
    SANDFEST_RESTORE_DRILL_MAX_AGE_DAYS: "90"
  }, { now });
  const stale = recoveryReadiness({
    SANDFEST_BACKUP_PROVIDER: "render-managed",
    SANDFEST_DATABASE_RECOVERY_WINDOW_DAYS: "3",
    SANDFEST_ASSET_SNAPSHOT_RETENTION_DAYS: "7",
    SANDFEST_DATABASE_RESTORE_DRILL_AT: "2026-01-01T00:00:00.000Z",
    SANDFEST_ASSET_RESTORE_DRILL_AT: "2026-01-01T00:00:00.000Z",
    SANDFEST_RESTORE_DRILL_MAX_AGE_DAYS: "90"
  }, { now });
  const incomplete = recoveryReadiness({
    SANDFEST_BACKUP_PROVIDER: "render-managed",
    SANDFEST_DATABASE_RECOVERY_WINDOW_DAYS: "2",
    SANDFEST_ASSET_SNAPSHOT_RETENTION_DAYS: "6",
    SANDFEST_DATABASE_RESTORE_DRILL_AT: "2026-07-17T12:00:00.000Z",
    SANDFEST_ASSET_RESTORE_DRILL_AT: "2026-07-17T12:00:00.000Z"
  }, { now });
  ok("managed recovery readiness requires current drill evidence", ready.ready && ready.databaseRestoreDrillAgeDays === 1 && ready.assetRestoreDrillAgeDays === 2 && ready.checks.databaseRecoveryWindow && ready.checks.assetSnapshots);
  ok("stale restore evidence fails closed", !stale.ready && !stale.checks.databaseRestoreDrill && !stale.checks.assetRestoreDrill && stale.reason.includes("older than 90 days"));
  ok("recovery retention and future timestamps fail closed", !incomplete.ready && !incomplete.checks.databaseRecoveryWindow && !incomplete.checks.assetSnapshots && incomplete.reason.includes("cannot be in the future"));
}

// Revenue
{
  const ledger = await readJson("data/processed/revenue-ledger.json");
  const s = summarizeLedger(ledger.entries, {
    expectedAttendance: ledger.expectedAttendance,
    ticketCapacity: ledger.ticketCapacity
  });
  ok("revenue summarize", s.totals.count > 0 && s.totals.netCents > 0, `${s.totals.count} entries`);
  const partnerOperations = {
    eventId: "texas-sandfest-2027",
    lastUpdated: "2026-07-17T05:00:00.000Z",
    applications: [
      { id: "sponsor_revenue", eventId: "texas-sandfest-2027", type: "sponsor", organizationName: "Revenue Sponsor", packageName: "Marlin" },
      { id: "vendor_revenue", eventId: "texas-sandfest-2027", type: "vendor", organizationName: "Revenue Vendor", category: "food" }
    ],
    payments: [
      { id: "payment_revenue", applicationId: "sponsor_revenue", amountCents: 1000000, method: "ach", status: "succeeded", externalRef: "ACH-REVENUE-1", receivedAt: "2026-07-16T12:00:00.000Z", reconciliationStatus: "matched" },
      { id: "payment_refund", applicationId: "vendor_revenue", amountCents: 250000, method: "stripe", status: "refunded", paymentIntentId: "pi_revenue_refund", receivedAt: "2026-07-16T13:00:00.000Z", refundedAmountCents: 250000, reversedAt: "2026-07-17T05:00:00.000Z", reversalReason: "Duplicate settlement", reconciliationStatus: "refunded" },
      { id: "payment_pending", applicationId: "sponsor_revenue", amountCents: 50000, method: "check", status: "pending", externalRef: "CHECK-PENDING" }
    ]
  };
  const partnerEntries = partnerRevenueEntries(partnerOperations, { eventId: "texas-sandfest-2027" });
  const currentView = buildRevenueLedgerView(ledger, partnerOperations, { eventId: "texas-sandfest-2027" });
  const currentSummary = summarizeLedger(currentView.entries);
  ok("partner revenue projects receipts and reversals", partnerEntries.length === 3 && partnerEntries.some(entry => entry.entryType === "refund" && entry.grossCents === -250000) && !partnerEntries.some(entry => entry.sourceRecordId === "payment_pending"));
  ok("revenue excludes stale event imports", currentView.sources.imported.entries === 0 && currentView.sources.imported.excludedEntries === ledger.entries.length && currentView.sources.partnerOperations.entries === 3);
  ok("revenue summary separates gross receipts from refunds", currentSummary.totals.grossCents === 1250000 && currentSummary.totals.refundCents === 250000 && currentSummary.totals.netCents === 1000000);
  const ticketOrders = [
    { record: { id: "order_revenue_paid", eventId: "texas-sandfest-2027", status: "paid", provider: "stripe", checkoutEnvironment: "stripe", stripeCheckoutSessionId: "cs_revenue_paid", paymentIntentId: "pi_revenue_paid", totals: { knownAmount: 9000, currency: "usd" }, lineItems: [{ name: "GA", quantity: 2 }], createdAt: "2026-07-16T14:00:00.000Z", paidAt: "2026-07-16T14:05:00.000Z", updatedAt: "2026-07-16T14:05:00.000Z" } },
    { record: { id: "order_revenue_refunded", eventId: "texas-sandfest-2027", status: "refunded", provider: "stripe", checkoutEnvironment: "board_sandbox", stripeCheckoutSessionId: "cs_revenue_refund", paymentIntentId: "pi_revenue_refund", totals: { knownAmount: 3000, currency: "usd" }, lineItems: [{ name: "GA", quantity: 1 }], refundedAmountCents: 3000, createdAt: "2026-07-16T15:00:00.000Z", paidAt: "2026-07-16T15:05:00.000Z", refundedAt: "2026-07-16T15:10:00.000Z", updatedAt: "2026-07-16T15:10:00.000Z" } }
  ];
  const ticketEntries = ticketRevenueEntries(ticketOrders, { eventId: "texas-sandfest-2027" });
  const ticketView = buildRevenueLedgerView({}, {}, { eventId: "texas-sandfest-2027", ticketOrders });
  const ticketSummary = summarizeLedger(ticketView.entries);
  ok("ticket orders project receipts and full-refund reversals", ticketEntries.length === 3 && ticketEntries.some(entry => entry.origin === "board_ticket_sandbox" && entry.entryType === "refund" && entry.quantity === -1));
  ok("ticket revenue updates net sales without counting refunded admissions", ticketView.sources.ticketOrders.entries === 3 && ticketSummary.totals.grossCents === 12000 && ticketSummary.totals.refundCents === 3000 && ticketSummary.totals.netCents === 9000 && ticketSummary.tickets.sold === 2);

  const settlementCsv = `transaction_id,transaction_date,revenue_category,gross,fees,net,qty,payout_id,payout_date,reconciled,entry_type,note
evt_settlement_1,2026-07-16,tickets,"$1,250.00",36.55,"$1,213.45",25,payout_eventeny_1,2026-07-17,yes,receipt,Advance admission
evt_settlement_refund,2026-07-17,ticket,25.00,0.00,-25.00,1,payout_eventeny_1,2026-07-17,no,refund,Ticket refund`;
  const importDefaults = { source: "eventeny", eventId: "texas-sandfest-2027" };
  const parsedSettlement = parseRevenueCsv(settlementCsv, importDefaults);
  ok("revenue CSV aliases and exact dollars parse", parsedSettlement.ok && parsedSettlement.rows.length === 2 && parsedSettlement.rows[0].entry.grossCents === 125000 && parsedSettlement.rows[0].entry.feeCents === 3655 && parsedSettlement.rows[0].entry.netCents === 121345);
  ok("revenue CSV normalizes refund signs and quantity", parsedSettlement.rows[1].entry.entryType === "refund" && parsedSettlement.rows[1].entry.grossCents === -2500 && parsedSettlement.rows[1].entry.netCents === -2500 && parsedSettlement.rows[1].entry.quantity === -1);
  const invalidSettlement = parseRevenueCsv(`external_ref,date,source,event_id,category,gross_amount,fee_amount,net_amount,entry_type
bad_source,2026-07-16,square,texas-sandfest-2027,merch,10.00,0.30,9.70,receipt
bad_event,2026-07-16,eventeny,texas-sandfest-2026,ticket,10.00,0.30,9.70,receipt
bad_category,2026-07-16,eventeny,texas-sandfest-2027,donation,10.00,0.30,9.70,receipt
bad_date,07/16/2026,eventeny,texas-sandfest-2027,ticket,10.00,0.30,9.70,receipt
bad_money,2026-07-16,eventeny,texas-sandfest-2027,ticket,10.001,0.30,9.70,receipt`, importDefaults);
  ok("revenue CSV rejects mixed context and malformed values", invalidSettlement.ok && invalidSettlement.rows.length === 0 && invalidSettlement.errors.length === 5);
  const previewHash = revenueImportPreviewHash(settlementCsv, importDefaults);
  ok("revenue import hash binds provider and event", /^[a-f0-9]{64}$/.test(previewHash) && previewHash !== revenueImportPreviewHash(settlementCsv, { ...importDefaults, source: "square" }) && previewHash !== revenueImportPreviewHash(`${settlementCsv}\n`, importDefaults));
  const previewImport = applyRevenueImport({
    eventId: "texas-sandfest-2026",
    entries: [{ id: "legacy_revenue", source: "stripe", entryType: "receipt", externalRef: "legacy_ref", grossCents: 1000 }]
  }, parsedSettlement, {
    eventId: importDefaults.eventId,
    source: importDefaults.source,
    previewHash,
    existingEntries: [{ id: "partner_duplicate", source: "eventeny", entryType: "receipt", externalRef: "EVT_SETTLEMENT_1", origin: "partner_operations" }],
    now: "2026-07-17T06:00:00.000Z",
    idFactory: (_entry, row) => `preview_${row}`
  });
  ok("revenue import previews site-native duplicates", previewImport.ok && previewImport.summary.importable === 1 && previewImport.summary.duplicates === 1 && previewImport.duplicates[0].origin === "partner_operations");
  const committedImport = applyRevenueImport({
    eventId: "texas-sandfest-2026",
    entries: [{ id: "legacy_revenue", source: "stripe", entryType: "receipt", externalRef: "legacy_ref", grossCents: 1000 }]
  }, parsedSettlement, {
    commit: true,
    actorId: "finance-test",
    batchId: "revenue_import_test",
    eventId: importDefaults.eventId,
    source: importDefaults.source,
    previewHash,
    fileName: "eventeny-settlement.csv",
    now: "2026-07-17T06:00:00.000Z",
    idFactory: (_entry, row) => `revenue_row_${row}`
  });
  const replayedImport = applyRevenueImport(committedImport.doc, parsedSettlement, {
    commit: true,
    actorId: "finance-test",
    batchId: "revenue_import_replay",
    eventId: importDefaults.eventId,
    source: importDefaults.source,
    previewHash,
    now: "2026-07-17T06:05:00.000Z"
  });
  ok("revenue import preserves historical event scope", committedImport.doc.eventId === importDefaults.eventId && committedImport.doc.entries.find(entry => entry.id === "legacy_revenue")?.eventId === "texas-sandfest-2026" && committedImport.doc.entries.filter(entry => entry.eventId === importDefaults.eventId).length === 2);
  ok("revenue import records bounded batch provenance", committedImport.changed && committedImport.importRecord?.fileName === "eventeny-settlement.csv" && committedImport.doc.imports.length === 1 && committedImport.importRecord.imported === 2);
  ok("revenue import replay is idempotent", replayedImport.replay && !replayedImport.changed && replayedImport.doc.entries.length === committedImport.doc.entries.length && replayedImport.doc.imports.length === 1);
  const oversizedSettlement = `external_ref,date,category,gross_cents\n${Array.from({ length: REVENUE_IMPORT_MAX_ROWS + 1 }, (_, index) => `row_${index},2026-07-16,merch,100`).join("\n")}`;
  ok("revenue import enforces row ceiling", parseRevenueCsv(oversizedSettlement, importDefaults).ok === false);
}

// Budget control
{
  const eventId = "texas-sandfest-2027";
  const now = "2026-07-20T12:00:00.000Z";
  let sequence = 0;
  const idFactory = prefix => `${prefix}_${++sequence}`;
  const firstLine = createBudgetLine(emptyBudgetControl(eventId), {
    name: "Beach infrastructure",
    ownerTeam: "production",
    budgetCents: 100_000,
    notes: "Structures and utilities"
  }, { actorId: "finance-1", idFactory, now });
  const secondLine = createBudgetLine(firstLine.doc, {
    name: "Guest services",
    ownerTeam: "guest-services",
    budgetCents: 50_000
  }, { actorId: "finance-1", idFactory, now });
  const duplicateLine = createBudgetLine(secondLine.doc, {
    name: "beach infrastructure",
    ownerTeam: "operations",
    budgetCents: 10_000
  }, { actorId: "finance-1", idFactory, now });
  ok("budget lines require accountable, unique whole-cent allocations", firstLine.ok && secondLine.ok
    && duplicateLine.ok === false && duplicateLine.code === "DUPLICATE_BUDGET_LINE");
  const missingChangeNote = updateBudgetLine(secondLine.doc, firstLine.line.id, { budgetCents: 110_000 }, { actorId: "finance-2", now });
  const changedLine = updateBudgetLine(secondLine.doc, firstLine.line.id, {
    budgetCents: 110_000,
    changeNote: "Board approved the revised infrastructure allocation."
  }, { actorId: "finance-2", now: "2026-07-20T12:01:00.000Z" });
  ok("budget allocation changes require an audited reason", missingChangeNote.ok === false && changedLine.ok && changedLine.line.budgetCents === 110_000
    && changedLine.line.createdBy === "finance-1" && changedLine.line.lastChangedBy === "finance-2"
    && changedLine.line.lastChangeNote === "Board approved the revised infrastructure allocation.");
  const archivedLine = updateBudgetLine(changedLine.doc, secondLine.line.id, { active: false }, { actorId: "finance-2", now });
  const reusedName = createBudgetLine(archivedLine.doc, {
    name: "Guest services",
    ownerTeam: "operations",
    budgetCents: 60_000
  }, { actorId: "finance-2", idFactory, now });
  const editedArchive = updateBudgetLine(reusedName.doc, secondLine.line.id, {
    notes: "Historical guest-services allocation retained for reference."
  }, { actorId: "finance-2", now });
  const duplicateReactivation = updateBudgetLine(editedArchive.doc, secondLine.line.id, { active: true }, { actorId: "finance-2", now });
  ok("archived allocations remain editable while duplicate active names stay blocked", archivedLine.ok && reusedName.ok
    && editedArchive.ok && editedArchive.line.active === false
    && duplicateReactivation.ok === false && duplicateReactivation.code === "DUPLICATE_BUDGET_LINE");

  const submitted = createExpenseRequest(changedLine.doc, {
    budgetLineId: firstLine.line.id,
    vendorName: "Coastal Rentals",
    description: "Beach staging reservation",
    amountCents: 70_000,
    dueDate: "2027-02-01"
  }, { actorId: "ops-1", idFactory, now: "2026-07-20T12:02:00.000Z" });
  const approved = transitionExpense(submitted.doc, submitted.expense.id, "approve", {}, { actorId: "finance-2", now: "2026-07-20T12:03:00.000Z" });
  const invalidPaymentDate = transitionExpense(approved.doc, submitted.expense.id, "mark_paid", {
    paymentMethod: "ramp",
    paymentReference: "RAMP-TEST-INVALID",
    paidAt: "not-a-date"
  }, { actorId: "finance-2", now: "2026-07-20T12:04:00.000Z" });
  const paid = transitionExpense(approved.doc, submitted.expense.id, "mark_paid", {
    paymentMethod: "ramp",
    paymentReference: "RAMP-TEST-1001"
  }, { actorId: "finance-2", now: "2026-07-20T12:04:00.000Z" });
  ok("expense requests preserve approval and payment evidence", submitted.ok && approved.ok && paid.ok
    && invalidPaymentDate.ok === false && paid.expense.status === "paid" && paid.expense.paymentReference === "RAMP-TEST-1001");

  const oversized = createExpenseRequest(paid.doc, {
    budgetLineId: firstLine.line.id,
    vendorName: "Expansion Vendor",
    description: "Additional beach structures",
    amountCents: 60_000,
    dueDate: "2027-03-01"
  }, { actorId: "ops-1", idFactory, now: "2026-07-20T12:05:00.000Z" });
  const blockedApproval = transitionExpense(oversized.doc, oversized.expense.id, "approve", {}, { actorId: "finance-2", now });
  const shortOverride = transitionExpense(oversized.doc, oversized.expense.id, "approve", {
    allowOverBudget: true,
    note: "Approved"
  }, { actorId: "finance-2", now });
  const overridden = transitionExpense(oversized.doc, oversized.expense.id, "approve", {
    allowOverBudget: true,
    note: "Executive budget exception approved for required structures."
  }, { actorId: "finance-2", now: "2026-07-20T12:06:00.000Z" });
  const summary = summarizeBudgetControl(overridden.doc);
  ok("over-budget commitments fail closed without an explicit noted override", blockedApproval.code === "OVER_BUDGET"
    && shortOverride.ok === false && overridden.ok && overridden.expense.overBudgetOverride === true
    && summary.counts.overBudgetLines === 1 && summary.totals.committedCents === 130_000);

  const rejectedRequest = createExpenseRequest(overridden.doc, {
    budgetLineId: secondLine.line.id,
    vendorName: "Visitor Amenities",
    description: "Optional hospitality upgrade",
    amountCents: 12_000,
    dueDate: "2027-03-15"
  }, { actorId: "ops-2", idFactory, now });
  const rejectedWithoutNote = transitionExpense(rejectedRequest.doc, rejectedRequest.expense.id, "reject", {}, { actorId: "finance-2", now });
  const rejected = transitionExpense(rejectedRequest.doc, rejectedRequest.expense.id, "reject", {
    note: "Deferred until final attendance forecast is approved."
  }, { actorId: "finance-2", now });
  ok("rejections require a durable resolution note", rejectedWithoutNote.ok === false && rejected.ok && rejected.expense.status === "rejected");
}

// Fleet
{
  const fleet = await readJson("data/processed/fleet.json");
  const s = summarizeFleet(fleet.assets, fleet.checkouts, fleet.locations);
  ok("fleet summarize", s.totals.assets >= 10, `${s.totals.assets} assets`);
  ok("fleet QR parse", parseAssetQrPayload("tsf:asset:cart-02") === "cart-02");
  const out = applyCheckout(fleet, { assetId: "cart-02", checkedOutTo: "Test", team: "ops" }, { idFactory: () => "co_t" });
  ok("fleet checkout", out.ok && out.asset.status === "checked_out");
  const inn = applyCheckin({ assets: out.assets, checkouts: out.checkouts }, { assetId: "cart-02", endCondition: "good" });
  ok("fleet checkin", inn.ok && inn.asset.status === "available");
}

// Volunteers
{
  const m = await readJson("data/processed/volunteer-mirror.json");
  const s = summarizeVolunteers(m.volunteers, m.shifts, m.hourLogs, { zoneLabels: m.zoneLabels });
  ok("volunteers summarize", s.totals.volunteers > 0 && s.zones.length > 0, `${s.totals.openGaps} gaps`);

  const bundle = {
    rosterCsv: `volunteer_id,event_id,name,email,status,waiver_signed,sms_consent,roles,updated_at
VL-100,${DEFAULT_EVENT_ID},Taylor Reed,taylor@example.com,active,yes,no,gate|traffic,2027-01-10T15:00:00Z
VL-101,${DEFAULT_EVENT_ID},Morgan Lee,morgan@example.com,pending,,,guest services,
VL-102,texas-sandfest-2026,Wrong Event,wrong-event@example.com,active,yes,yes,gate,`,
    shiftsCsv: `shift_id,event_id,role,zone,location_name,start_time,end_time,needed,volunteer_ids,captain_id
SHIFT-100,${DEFAULT_EVENT_ID},gate,north_gate,North Gate,2027-04-09T08:00:00-05:00,2027-04-09T12:00:00-05:00,3,VL-100|VL-101,VL-100`,
    hoursCsv: `hour_log_id,event_id,volunteer_id,shift_id,check_in,check_out,notes
HOURS-100,${DEFAULT_EVENT_ID},VL-100,SHIFT-100,2027-04-09T08:00:00-05:00,2027-04-09T12:00:00-05:00,Opening shift`
  };
  const defaults = { eventId: DEFAULT_EVENT_ID };
  const parsed = parseVolunteerLocalBundle(bundle, defaults);
  const existing = {
    eventId: DEFAULT_EVENT_ID,
    lastUpdated: "2027-01-01T00:00:00.000Z",
    zoneLabels: { legacy: "Legacy zone" },
    volunteers: [{ id: "local_keep", eventId: DEFAULT_EVENT_ID, name: "Local Keep", email: "local@example.com", roles: ["operations"], status: "confirmed", source: "manual", waiverSigned: false, smsConsent: false }],
    shifts: [],
    hourLogs: [],
    imports: []
  };
  const bundleHash = volunteerLocalBundleHash(bundle, defaults);
  const previewHash = volunteerLocalImportPreviewHash(bundle, {
    ...defaults,
    mirrorFingerprint: volunteerLocalMirrorFingerprint(existing)
  });
  const preview = applyVolunteerLocalImport(existing, parsed, {
    previewHash,
    batchId: "preview_volunteers",
    now: "2027-01-12T00:00:00.000Z"
  });
  const committed = applyVolunteerLocalImport(existing, parsed, {
    commit: true,
    previewHash,
    batchId: "volunteerlocal_import_test",
    actorId: "ops-test",
    bundleHash,
    fileNames: { roster: "roster.csv", shifts: "shifts.csv", hours: "hours.csv" },
    now: "2027-01-12T00:00:00.000Z"
  });
  const replayed = applyVolunteerLocalImport(committed.doc, parsed, {
    commit: true,
    previewHash,
    batchId: "volunteerlocal_import_replay",
    now: "2027-01-12T01:00:00.000Z"
  });
  const taylor = committed.doc.volunteers.find(item => item.externalId === "VL-100");
  const morgan = committed.doc.volunteers.find(item => item.externalId === "VL-101");
  ok("VolunteerLocal bundle parses roster, shifts, and hours", parsed.ok && parsed.roster.rows.length === 2 && parsed.shifts.rows.length === 1 && parsed.hours.rows.length === 1 && parsed.errors.length === 1);
  ok("VolunteerLocal preview is non-mutating and reports partial issues", preview.ok && existing.volunteers.length === 1 && preview.summary.volunteers.created === 2 && preview.summary.invalid === 1);
  ok("VolunteerLocal commit preserves local records and explicit consent", committed.ok && committed.doc.volunteers.some(item => item.id === "local_keep") && taylor?.waiverSigned === true && taylor?.smsConsent === false && morgan?.waiverSigned === false && morgan?.smsConsent === false);
  ok("VolunteerLocal shift and hours resolve stable mirror IDs", committed.doc.shifts[0]?.filledVolunteerIds.includes(taylor.id) && committed.doc.shifts[0]?.captainId === taylor.id && committed.doc.hourLogs[0]?.volunteerId === taylor.id && committed.doc.hourLogs[0]?.shiftId === committed.doc.shifts[0]?.id && committed.doc.hourLogs[0]?.hours === 4);
  ok("VolunteerLocal commit records bounded provenance", committed.importRecord?.provider === "volunteerlocal" && committed.importRecord?.files.roster === "roster.csv" && committed.importRecord?.bundleHash === bundleHash && committed.doc.imports.length === 1 && !JSON.stringify(committed.importRecord).includes("taylor@example.com"));
  ok("VolunteerLocal replay is idempotent", replayed.replay && !replayed.changed && replayed.doc.volunteers.length === committed.doc.volunteers.length && replayed.doc.imports.length === 1);
  const changedMirrorHash = volunteerLocalImportPreviewHash(bundle, {
    ...defaults,
    mirrorFingerprint: volunteerLocalMirrorFingerprint({ ...existing, lastUpdated: "2027-01-02T00:00:00.000Z" })
  });
  ok("VolunteerLocal preview binds the current mirror state", changedMirrorHash !== previewHash);
  const missingWaiver = parseVolunteerLocalBundle({ rosterCsv: `volunteer_id,name\nVL-200,No Assumption` }, defaults);
  ok("VolunteerLocal missing consent never fabricates permission", missingWaiver.ok && missingWaiver.roster.rows[0].volunteer.waiverSigned === false && missingWaiver.roster.rows[0].volunteer.smsConsent === false);
  const oversizedRoster = `volunteer_id,name\n${Array.from({ length: VOLUNTEERLOCAL_IMPORT_MAX_ROWS + 1 }, (_, index) => `VL-${index},Volunteer ${index}`).join("\n")}`;
  ok("VolunteerLocal import enforces row ceiling", parseVolunteerLocalBundle({ rosterCsv: oversizedRoster }, defaults).ok === false);
}

// Staff and team notification routing
{
  const input = await readJson("data/processed/staff-directory.json");
  const directory = normalizeStaffDirectory(input, { eventId: "texas-sandfest-2026" });
  const recipients = staffTaskRecipients(directory, { eventId: "texas-sandfest-2026" });
  const publicDirectory = publicStaffAssignmentDirectory(directory, { eventId: "texas-sandfest-2026" });
  const development = staffDirectoryReadiness(directory, { eventId: "texas-sandfest-2026", production: false });
  const production = staffDirectoryReadiness(directory, { eventId: "texas-sandfest-2026", production: true });
  const verifiedProduction = staffDirectoryReadiness({ ...directory, source: "manual_verified", verifiedAt: "2026-07-17T00:00:00.000Z" }, { eventId: "texas-sandfest-2026", production: true, now: "2026-07-18T00:00:00.000Z" });
  const mismatchedStaffEvent = staffDirectoryReadiness({
    ...directory,
    staff: directory.staff.map((item, index) => index === 0 ? { ...item, eventId: "texas-sandfest-2025" } : item)
  }, { eventId: "texas-sandfest-2026", production: false });
  ok("staff directory routes every operating team", development.ready && development.activeStaff === 7 && development.routedTeams === development.totalTeams && recipients.some(item => item.assigneeType === "team" && item.id === "operations"));
  ok("staff assignment directory is privacy minimized", publicDirectory.staff.length === 7 && publicDirectory.staff.every(item => !Object.hasOwn(item, "email")) && publicDirectory.teams.every(item => item.notificationReady));
  ok("seed staff directory cannot satisfy production", !production.ready && production.errors.some(item => item.includes("not production verified")));
  ok("current verified staff directory satisfies production", verifiedProduction.ready);
  ok("staff directory rejects mixed annual scope", !mismatchedStaffEvent.ready && mismatchedStaffEvent.eventMismatchStaff.includes("staff_operations"));

  const importEventId = "texas-sandfest-2027";
  const staffCsv = `staff_id,event_id,name,work_email,status,role,team,notification_team
staff_operations,${importEventId},Jamie Torres,jamie.torres@staff.example,active,ops_admin,operations,operations
staff_sponsor,${importEventId},Morgan Ellis,morgan.ellis@staff.example,active,sponsor_admin,sponsor,sponsor
staff_finance,${importEventId},Riley Chen,riley.chen@staff.example,active,finance_admin,finance,finance
staff_volunteers,${importEventId},Casey Patel,casey.patel@staff.example,active,volunteer_captain,volunteer-captains,volunteer-captains
staff_traffic,${importEventId},Avery Brooks,avery.brooks@staff.example,on_call,traffic_lead,traffic,traffic
staff_guest_services,${importEventId},Taylor Nguyen,taylor.nguyen@staff.example,active,guest_services_lead,guest-services,guest-services
staff_production,${importEventId},Jordan Davis,jordan.davis@staff.example,active,production_lead,production,production`;
  const importOptions = {
    eventId: importEventId,
    source: "manual_verified",
    fileName: "staff-directory.csv",
    now: "2027-01-12T00:00:00.000Z"
  };
  const parsedImport = parseStaffDirectoryImport(staffCsv, importOptions);
  const currentImportDirectory = {
    ...directory,
    eventId: importEventId,
    staff: directory.staff.map(item => ({ ...item, eventId: importEventId }))
  };
  const preview = applyStaffDirectoryImport(currentImportDirectory, parsedImport, { now: importOptions.now });
  const committed = applyStaffDirectoryImport(currentImportDirectory, parsedImport, {
    commit: true,
    expectedPreviewHash: preview.previewHash,
    actorId: "staff-import-test",
    batchId: "staff_import_test",
    now: importOptions.now
  });
  const replay = applyStaffDirectoryImport(committed.doc, parsedImport, {
    commit: true,
    expectedPreviewHash: preview.previewHash,
    actorId: "staff-import-test",
    now: "2027-01-12T01:00:00.000Z"
  });
  const staleCommit = applyStaffDirectoryImport({ ...currentImportDirectory, lastUpdated: "2027-01-11T00:00:00.000Z" }, parsedImport, {
    commit: true,
    expectedPreviewHash: preview.previewHash,
    now: importOptions.now
  });
  const rolloverPreview = applyStaffDirectoryImport(directory, parsedImport, { now: importOptions.now });
  const rolloverCommit = applyStaffDirectoryImport(directory, parsedImport, {
    commit: true,
    expectedPreviewHash: rolloverPreview.previewHash,
    now: importOptions.now
  });
  const duplicateRoute = parseStaffDirectoryImport(`${staffCsv}\nstaff_extra,${importEventId},Extra Staff,extra@staff.example,active,ops_admin,operations,operations`, importOptions);
  const oversizedStaffCsv = `id,name,email,notification_team\n${Array.from({ length: STAFF_DIRECTORY_IMPORT_MAX_ROWS + 1 }, (_, index) => `staff_${index},Staff ${index},staff${index}@staff.example,operations`).join("\n")}`;
  ok("staff import parses a complete private directory", parsedImport.ok && parsedImport.summary.activeStaff === 7 && parsedImport.summary.routedTeams === 7 && parsedImport.publicDirectory.staff.every(item => !("email" in item)));
  ok("staff import preview is non-mutating and state-bound", preview.ok && preview.commitAllowed && /^[a-f0-9]{64}$/.test(preview.previewHash) && currentImportDirectory.source === directory.source && staffDirectoryImportPreviewHash(staffCsv, { ...importOptions, directoryFingerprint: staffDirectoryFingerprint(currentImportDirectory, { eventId: importEventId }) }) === preview.previewHash);
  ok("staff import commit is private, audited, and idempotent", committed.ok && committed.doc.source === "manual_verified" && committed.doc.imports.length === 1 && committed.importRecord.actorId === "staff-import-test" && !JSON.stringify({ publicDirectory: committed.publicDirectory, importRecord: committed.importRecord }).includes("@staff.example") && replay.replay && replay.doc.imports.length === 1);
  ok("staff import rejects stale previews and annual replacement", staleCommit.previewMismatch && rolloverPreview.commitAllowed === false && rolloverCommit.rolloverRequired);
  ok("staff import rejects duplicate routing and oversized files", duplicateRoute.ok === false && duplicateRoute.error.includes("exactly one owner") && parseStaffDirectoryImport(oversizedStaffCsv, importOptions).ok === false);
}

// Consent + SMS
{
  const bad = validateCheckoutConsent({ consent: { emailMarketing: true } });
  ok("consent requires email", Boolean(bad.error));
  const rec = consentFromCheckout(
    { email: "a@b.com", phone: "5125551212", consent: { smsSafety: true } },
    { idFactory: () => "c1", now: "2026-07-17T10:00:00.000Z" }
  );
  ok("consent from checkout", rec.smsSafety.optedIn && rec.phone === "+15125551212");
  const ledger = await readJson("data/processed/consent-ledger.json");
  ok("consent ledger", summarizeConsent(ledger.records).totals.records >= 1);
  const stopped = applySmsConsentKeyword({ eventId: DEFAULT_EVENT_ID, records: [rec] }, {
    channel: "smsSafety",
    phone: rec.phone,
    optOutType: "STOP"
  }, { now: "2026-07-17T11:00:00.000Z" });
  const staleCheckout = consentFromCheckout(
    { phone: rec.phone, consent: { smsSafety: true } },
    { idFactory: () => "c2", now: "2026-07-17T10:30:00.000Z" }
  );
  const staleMerge = mergeConsentRecords(stopped.doc.records[0], staleCheckout);
  const started = applySmsConsentKeyword(stopped.doc, {
    channel: "smsSafety",
    phone: rec.phone,
    optOutType: "START"
  }, { now: "2026-07-17T12:00:00.000Z" });
  ok("SMS STOP wins over stale checkout evidence", stopped.ok && !staleMerge.smsSafety.optedIn && staleMerge.smsSafety.optedOutAt === "2026-07-17T11:00:00.000Z");
  ok("SMS START restores only the selected channel", started.doc.records[0].smsSafety.optedIn && !started.doc.records[0].smsMarketing.optedIn);

  const disabled = smsConfigFromEnv({ SMS_ENABLED: "false" });
  ok("sms idle when disabled", !disabled.ready);
  const skip = await sendSms("+15125551212", "hi", { config: disabled });
  ok("sms skip", skip.skipped === true);
  const config = smsConfigFromEnv({
    SMS_ENABLED: "true",
    TWILIO_ACCOUNT_SID: "AC_test",
    TWILIO_AUTH_TOKEN: "test-secret",
    TWILIO_FROM_NUMBER: "+15125550000",
    TWILIO_API_BASE_URL: "http://127.0.0.1:9999",
    TWILIO_STATUS_CALLBACK_URL: "http://127.0.0.1:8806/api/webhooks/twilio/status",
    TWILIO_SAFETY_INBOUND_WEBHOOK_URL: "http://127.0.0.1:8806/api/webhooks/twilio/inbound/smsSafety"
  });
  const productionMisconfigured = smsConfigFromEnv({
    SMS_ENABLED: "true",
    NODE_ENV: "production",
    TWILIO_ACCOUNT_SID: "AC_test",
    TWILIO_AUTH_TOKEN: "test-secret",
    TWILIO_FROM_NUMBER: "+15125550000",
    TWILIO_API_BASE_URL: "https://example.test",
    TWILIO_STATUS_CALLBACK_URL: "https://example.test/api/webhooks/twilio/status",
    TWILIO_SAFETY_INBOUND_WEBHOOK_URL: "https://example.test/api/webhooks/twilio/inbound/smsSafety"
  });
  const readinessJson = JSON.stringify(publicSmsReadiness(config));
  ok("SMS readiness requires callbacks and official production transport", config.ready && !productionMisconfigured.ready);
  ok("public SMS readiness omits credentials and identifies local sandbox mode", publicSmsReadiness(config).providerMode === "sandbox" && !readinessJson.includes("test-secret") && !readinessJson.includes("+15125550000"));
  const callbackUrl = smsStatusCallbackUrl(config, { campaignId: "campaign-1", messageId: "message-1" });
  let submittedForm = null;
  const sent = await sendSms(rec.phone, "Safety test", {
    config,
    statusCallbackUrl: callbackUrl,
    fetchImpl: async (_url, request) => {
      submittedForm = Object.fromEntries(request.body);
      return { ok: true, status: 201, json: async () => ({ sid: "SM_test", status: "queued" }) };
    }
  });
  ok("SMS submission includes a traceable status callback", sent.ok && sent.sid === "SM_test" && submittedForm.StatusCallback === callbackUrl && submittedForm.To === rec.phone);
  const signatureParams = { MessageSid: "SM_test", MessageStatus: "delivered" };
  const signature = twilio.getExpectedTwilioSignature("test-secret", callbackUrl, signatureParams);
  ok("Twilio form signatures verify against the configured public URL", verifyTwilioFormRequest({ signature, url: callbackUrl, params: signatureParams }, { config }));

  const campaignResult = createSmsAlertCampaign(emptySmsOperations(DEFAULT_EVENT_ID), {
    alert: { id: "alert-1", updatedAt: "2026-07-17T13:00:00.000Z", title: "Weather delay", severity: "warning" },
    recipients: [{ id: rec.id, phone: rec.phone }]
  }, { now: "2026-07-17T13:00:00.000Z", eventId: DEFAULT_EVENT_ID });
  const messageId = campaignResult.messages[0].id;
  const beginning = beginSmsSubmission(campaignResult.doc, messageId, { now: "2026-07-17T13:00:01.000Z" });
  const submitted = recordSmsSubmission(beginning.doc, messageId, { ok: true, status: "queued", sid: "SM_test" }, { now: "2026-07-17T13:00:02.000Z" });
  const mismatchedSid = recordSmsStatusCallback(submitted.doc, { messageId, providerMessageSid: "SM_other", status: "delivered" }, { now: "2026-07-17T13:00:30.000Z" });
  const delivered = recordSmsStatusCallback(submitted.doc, { messageId, providerMessageSid: "SM_test", status: "delivered" }, { now: "2026-07-17T13:01:00.000Z" });
  const regressed = recordSmsStatusCallback(delivered.doc, { messageId, providerMessageSid: "SM_test", status: "sent" }, { now: "2026-07-17T13:02:00.000Z" });
  const earlyDelivered = recordSmsStatusCallback(beginning.doc, { messageId, providerMessageSid: "SM_early", status: "delivered" }, { now: "2026-07-17T13:00:01.500Z" });
  const lateSubmission = recordSmsSubmission(earlyDelivered.doc, messageId, { ok: true, status: "queued", sid: "SM_early" }, { now: "2026-07-17T13:00:02.000Z" });
  const preference = recordSmsPreferenceEvent(regressed.doc, { providerMessageSid: "SM_inbound", channel: "smsSafety", action: "STOP", recipientHash: campaignResult.messages[0].recipientHash });
  const preferenceDuplicate = recordSmsPreferenceEvent(preference.doc, { providerMessageSid: "SM_inbound", channel: "smsSafety", action: "STOP", recipientHash: campaignResult.messages[0].recipientHash });
  const privacyJson = JSON.stringify(preference.doc);
  ok("SMS delivery lifecycle is durable and monotonic", delivered.ok && delivered.message.status === "delivered" && regressed.ignoredRegression && regressed.message.status === "delivered");
  ok("SMS early delivery callback survives late provider acceptance", lateSubmission.ignoredRegression && lateSubmission.message.status === "delivered" && lateSubmission.message.providerStatus === "delivered" && lateSubmission.message.providerMessageSid === "SM_early" && lateSubmission.message.submittedAt === "2026-07-17T13:00:02.000Z");
  ok("SMS status callback binds local message and provider SID", !mismatchedSid.ok && mismatchedSid.error.includes("did not match"));
  ok("SMS preference events are idempotent", !preference.duplicate && preferenceDuplicate.duplicate);
  ok("SMS operations retain no phone number or message body", !privacyJson.includes(rec.phone) && privacyJson.includes("Weather delay") && !privacyJson.includes("Safety test"));
  const adminPayload = smsOperationsAdminPayload(preference.doc);
  ok("SMS admin payload is aggregate-only", adminPayload.summary.messages.delivered === 1 && !JSON.stringify(adminPayload).includes("SM_test"));

  const queuedCampaign = createSmsAlertCampaign(emptySmsOperations(DEFAULT_EVENT_ID), {
    alert: { id: "alert-2", updatedAt: "2026-07-17T14:00:00.000Z", title: "Gate update", severity: "info" },
    recipients: [{ id: rec.id, phone: rec.phone }]
  }, { now: "2026-07-17T14:00:00.000Z", eventId: DEFAULT_EVENT_ID });
  const suppressed = suppressSmsCampaignsForAlert(queuedCampaign.doc, "alert-2", { now: "2026-07-17T14:01:00.000Z" });
  ok("clearing an alert suppresses queued SMS", suppressed.suppressed === 1 && suppressed.doc.messages[0].status === "suppressed");
  const staleSmsContext = createSmsAlertCampaign(emptySmsOperations("texas-sandfest-2026"), {
    alert: { id: "alert-stale", title: "Stale", severity: "warning" },
    recipients: [{ id: rec.id, phone: rec.phone }]
  }, { eventId: DEFAULT_EVENT_ID });
  ok("SMS campaign rejects stale annual context", !staleSmsContext.ok && staleSmsContext.eventContextMismatch);
}

// Passport
{
  const demoRoster = await readJson("src/board-demo/sculptors-demo.json");
  const engagement = boardDemoEngagement(demoRoster, {
    eventId: DEFAULT_EVENT_ID,
    hunt: { id: DEFAULT_HUNT_ID, eventId: DEFAULT_EVENT_ID, active: true },
    now: "2026-07-18T00:00:00.000Z"
  });
  const hunt = engagement.passportHunt;
  const comps = engagement.passportCompletions;
  const closedHunt = await readJson("data/processed/sculpture-passport.json");
  ok("passport defaults use current event context", normalizeHunt({}).id === DEFAULT_HUNT_ID && normalizeHunt({}).eventId === DEFAULT_EVENT_ID);
  ok("repository passport seed contains no unpublished checkpoints", closedHunt.hunt?.active === false && closedHunt.checkpoints?.length === 0);
  ok("passport parse", parsePassportPayload("tsf:cp:cp_ent_tidal_guardian", hunt.checkpoints)?.label === "Tidal Guardian");
  const stamp = applyStamp({
    hunt: hunt.hunt,
    checkpoints: hunt.checkpoints,
    completions: comps.completions
  }, { attendeeRef: "suite_tester", payload: hunt.checkpoints[0].code, method: "qr_scan" }, { idFactory: () => "hc_suite" });
  ok("passport stamp", stamp.ok && !stamp.alreadyStamped, stamp.checkpoint?.label);
  const dup = applyStamp({
    hunt: hunt.hunt,
    checkpoints: hunt.checkpoints,
    completions: stamp.completions
  }, { attendeeRef: "suite_tester", payload: "tsf:entry:ent_tidal_guardian" });
  ok("passport idempotent", dup.alreadyStamped === true);
  ok("passport summary", summarizePassport(hunt.checkpoints, stamp.completions, hunt.hunt).totals.checkpoints === 6);
}

// Voting
{
  const demoRoster = await readJson("src/board-demo/sculptors-demo.json");
  const doc = boardDemoEngagement(demoRoster, {
    eventId: DEFAULT_EVENT_ID,
    hunt: { id: DEFAULT_HUNT_ID, eventId: DEFAULT_EVENT_ID },
    now: "2026-07-18T00:00:00.000Z"
  }).voting;
  const closedBallot = await readJson("data/processed/peoples-choice.json");
  const closedPublication = publicVotingPublication(closedBallot);
  const demoPublication = publicVotingPublication(doc, { allowSample: true });
  const publishedPublication = publicVotingPublication({
    ...doc,
    publicationStatus: "published",
    source: "reviewed_current_roster"
  });
  const weakPublishedPublication = publicVotingPublication({
    ...doc,
    publicationStatus: "published",
    source: "placeholder_fixture"
  });
  ok("repository ballot seed contains no unpublished artists", !closedPublication.visible && closedBallot.votingOpen === false && closedBallot.entries?.length === 0);
  ok("public voting requires reviewed or board-demo publication", demoPublication.visible && demoPublication.mode === "demo" && publishedPublication.visible && publishedPublication.mode === "published" && !weakPublishedPublication.visible && !publicVotingPublication(doc).visible);
  const vote = applyVote(doc, { attendeeRef: "suite_voter", entryId: "ent_tidal_guardian", channel: "web" }, { idFactory: () => "v_suite" });
  ok("voting cast", vote.ok && vote.changed);
  const tally = tallyVotes(doc.entries, vote.votes);
  ok("voting tally", tally.totalVotes >= 1 && tally.leaderboard.length === doc.entries.length);
  ok("voting summary", summarizeVoting(doc.entries, vote.votes).totals.totalVotes >= 1);
  ok("ticket ref parse", normalizeTicketRef("tsf:t:WB-29F4-7B0A") === "tsf:t:WB-29F4-7B0A");
  const needTicket = applyVote(doc, { attendeeRef: "suite_voter2", entryId: "ent_tidal_guardian" }, { requireTicket: true });
  ok("ticket required", !needTicket.ok);
  const withTicket = applyVote(doc, {
    attendeeRef: "suite_voter3",
    entryId: "ent_tidal_guardian",
    ticketRef: "tsf:t:WB-TEST-001"
  }, { idFactory: () => "v_tix", requireTicket: true });
  ok("ticket-linked vote", withTicket.ok && withTicket.vote.ticketRef === "tsf:t:WB-TEST-001");
}

// Job queue (file mode)
{
  const projectedFailure = adminJobView({
    id: "job_projection-probe",
    type: "partner.followup.send",
    status: "failed",
    attempts: 5,
    maxAttempts: 5,
    payload: { recipient: "private.person@example.com", accessToken: "secret-token" },
    lastError: "Provider rejected private.person@example.com with secret-token",
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:05:00.000Z"
  });
  const projectedJson = JSON.stringify(projectedFailure);
  ok("admin job projection is actionable and privacy minimized", projectedFailure.label === "Partner message delivery"
    && projectedFailure.workspaceHref === "#admin-partner-followups-workspace"
    && projectedFailure.requiresAcknowledgement
    && !projectedJson.includes("private.person@example.com")
    && !projectedJson.includes("secret-token")
    && !projectedJson.includes("payload")
    && !projectedJson.includes("lastError"));
  const projectedCompletions = [
    adminJobView({ id: "job_complete-0001", type: "partner.followup.send", status: "done", attempts: 1, maxAttempts: 5, updatedAt: "2026-07-18T12:01:00.000Z" }),
    adminJobView({ id: "job_complete-0002", type: "partner.followup.send", status: "done", attempts: 1, maxAttempts: 5, updatedAt: "2026-07-18T12:02:00.000Z" }),
    adminJobView({ id: "job_complete-0003", type: "document.extract", status: "done", attempts: 1, maxAttempts: 5, updatedAt: "2026-07-18T12:03:00.000Z" })
  ];
  const displayRows = adminJobDisplayRows([...projectedCompletions, projectedFailure]);
  const partnerCompletion = displayRows.find(item => item.label === "Partner message delivery" && item.status === "done");
  const displayRowsJson = JSON.stringify(displayRows);
  ok("completed automation is grouped without hiding actionable work", displayRows.length === 3
    && displayRows[0].requiresAcknowledgement === true
    && partnerCompletion?.displayKind === "completed_group"
    && partnerCompletion?.completedCount === 2
    && partnerCompletion?.updatedAt === "2026-07-18T12:02:00.000Z"
    && !displayRowsJson.includes("job_complete-0001")
    && !displayRowsJson.includes("job_complete-0002"));
  const prioritizedJobs = prioritizedAdminJobViews(
    [projectedCompletions[0], projectedFailure],
    [projectedFailure]
  );
  ok("unhandled automation failures stay ahead of recent history", prioritizedJobs.length === 2
    && prioritizedJobs[0].id === projectedFailure.id
    && prioritizedJobs.filter(item => item.id === projectedFailure.id).length === 1);
  ok("job acknowledgment validates notes and opaque references", !jobResolutionNote("too short").ok
    && jobResolutionNote("Retried in the partner workflow.").ok
    && validAdminJobId("job_01234567-89ab-cdef")
    && !validAdminJobId("../../private/job_secret"));

  const dir = await mkdtemp(path.join(tmpdir(), "sandfest-jobs-"));
  const invalidHandled = await markTerminalJobHandled(dir, "../../private/job_secret");
  ok("queue acknowledgment refuses path-shaped job references", !invalidHandled.ok && invalidHandled.reason === "invalid_job_id");
  const leaseMs = 10_000;
  const job = await enqueueJob(dir, { type: "quickbooks.sync_stub", payload: { orderId: "order_x" }, maxAttempts: 3 });
  ok("enqueue job", job.id.startsWith("job_"));
  const firstClaimAt = Date.now() + 100;
  const claimed = await claimNextJobs(dir, { limit: 5, types: ["quickbooks.sync_stub"], workerId: "suite-worker-a", leaseMs, now: firstClaimAt });
  ok("claim job", claimed.length === 1 && claimed[0].id === job.id && claimed[0].lockedBy === "suite-worker-a" && claimed[0].leaseToken);
  const beforeExpiry = await claimNextJobs(dir, { limit: 5, workerId: "suite-worker-b", leaseMs, now: firstClaimAt + leaseMs - 1 });
  ok("active job lease prevents duplicate claim", beforeExpiry.length === 0);
  const recovered = await claimNextJobs(dir, { limit: 5, workerId: "suite-worker-b", leaseMs, now: firstClaimAt + leaseMs + 1 });
  ok("expired job lease is recovered", recovered.length === 1 && recovered[0].id === job.id && recovered[0].attempts === 2 && recovered[0].leaseToken !== claimed[0].leaseToken);
  const staleCompletion = await completeJob(dir, claimed[0], { now: firstClaimAt + leaseMs + 2 });
  ok("expired worker cannot complete reclaimed job", staleCompletion.ok === false && staleCompletion.reason === "claim_lost");
  const queueDuringClaim = await getQueueHealth(dir, { now: firstClaimAt + leaseMs + 2, leaseMs });
  const publicJobs = await listJobs(dir, { limit: 5, leaseMs });
  ok("queue health reports active recovery", queueDuringClaim.running === 1 && queueDuringClaim.staleRunning === 0 && queueDuringClaim.operational === true);
  ok("admin job view hides lease token", publicJobs.length === 1 && !("leaseToken" in publicJobs[0]) && publicJobs[0].leaseExpiresAt);
  const completion = await completeJob(dir, recovered[0], { now: firstClaimAt + leaseMs + 3 });
  ok("current lease completes job", completion.ok === true && completion.status === "done");
  const again = await claimNextJobs(dir, { limit: 5, leaseMs, now: firstClaimAt + leaseMs + 4 });
  ok("job completed", again.every(j => j.id !== job.id));

  const idempotentPayload = {
    type: "partner.followup.send",
    payload: { followupId: "followup_idempotent" },
    idempotencyKey: "partner_transactional_v1:followup_idempotent:2026-07-16T12:00:00.000Z"
  };
  const [idempotentA, idempotentB] = await Promise.all([
    enqueueJob(dir, idempotentPayload),
    enqueueJob(dir, idempotentPayload)
  ]);
  ok("idempotent enqueue converges", idempotentA.id === idempotentB.id && idempotentA.id.startsWith("job_"));
  const idempotentClaim = await claimNextJobs(dir, { limit: 5, types: ["partner.followup.send"], workerId: "suite-idempotency", leaseMs });
  ok("idempotent job claims once", idempotentClaim.length === 1 && idempotentClaim[0].id === idempotentA.id);
  await completeJob(dir, idempotentClaim[0]);
  const idempotentReplay = await enqueueJob(dir, idempotentPayload);
  const idempotentRecords = (await listJobs(dir, { limit: 20 })).filter(item => item.id === idempotentA.id);
  ok("completed idempotent job cannot be rescheduled", idempotentReplay.id === idempotentA.id && idempotentReplay.status === "done" && idempotentRecords.length === 1 && idempotentRecords[0].status === "done");

  const terminal = await enqueueJob(dir, { type: "terminal.crash", maxAttempts: 1 });
  const terminalClaimAt = Date.now() + 100;
  const terminalClaim = await claimNextJobs(dir, { limit: 5, types: ["terminal.crash"], workerId: "suite-worker-a", leaseMs, now: terminalClaimAt });
  const terminalRetry = await claimNextJobs(dir, { limit: 5, types: ["terminal.crash"], workerId: "suite-worker-b", leaseMs, now: terminalClaimAt + leaseMs + 1 });
  const terminalHealth = await getQueueHealth(dir, { now: terminalClaimAt + leaseMs + 1, leaseMs });
  const newestTerminalJob = await listJobs(dir, { limit: 1, leaseMs });
  ok("expired final attempt becomes terminal", terminalClaim[0]?.id === terminal.id && terminalRetry.length === 0 && terminalHealth.failed === 1 && terminalHealth.unhandledFailed === 1 && !terminalHealth.operational && terminalHealth.needsAttention);
  ok("file queue lists the newest terminal failure first", newestTerminalJob[0]?.id === terminal.id && newestTerminalJob[0]?.status === "failed");
  const handled = await markTerminalJobHandled(dir, terminal.id, { now: terminalClaimAt + leaseMs + 2 });
  const handledHealth = await getQueueHealth(dir, { now: terminalClaimAt + leaseMs + 2, leaseMs });
  ok("terminal workflow reconciliation is recorded", handled.ok === true && handledHealth.failed === 1 && handledHealth.unhandledFailed === 0 && handledHealth.operational && !handledHealth.needsAttention);
  await rm(dir, { recursive: true, force: true });
}

// Booths
{
  const map = await readJson("data/processed/booth-map.json");
  const pins = publicBoothPins(map.booths, map.vendors);
  ok("booth public pins", pins.length >= 5, `${pins.length} pins`);
  ok("booth summarize", summarizeBooths(map.booths, map.vendors).totals.booths >= 5);
  const sample = await readFile(path.join(ROOT, "data/raw/eventeny-booths-sample.csv"), "utf8");
  const parsed = parseEventenyBoothCsv(sample, { eventId: DEFAULT_EVENT_ID });
  ok("booth CSV parse", parsed.ok && parsed.rows.length === 3 && parsed.rows.every(item => item.booth.eventId === DEFAULT_EVENT_ID && item.vendor?.eventId === DEFAULT_EVENT_ID));

  const importCsv = `booth_id,event_id,vendor_id,eventeny_id,business_name,category,type,zone,booth_status,vendor_status,public,coi_status,map_x,map_y,fee,source_updated_at
B-IMPORT-1,${DEFAULT_EVENT_ID},EV-V-IMPORT-1,EV-V-IMPORT-1,"Imported, Vendor",retail,exhibitor,Vendor Row,assigned,approved,,,12,24,1250.00,2026-07-17T08:00:00-05:00
B-IMPORT-OPEN,${DEFAULT_EVENT_ID},,,,,vendor,Vendor Row,open,,,,30,40,,
B-IMPORT-OLD,texas-sandfest-2026,EV-V-OLD,EV-V-OLD,Old Event Vendor,retail,vendor,Vendor Row,assigned,approved,yes,approved,50,60,500.00,`;
  const parsedImport = parseEventenyBoothCsv(importCsv, { eventId: DEFAULT_EVENT_ID });
  const importedVendor = parsedImport.rows?.find(item => item.vendor)?.vendor;
  ok("Eventeny booth parser is event-scoped and quote-safe", parsedImport.ok && parsedImport.rows.length === 2 && parsedImport.errors.length === 1 && importedVendor?.businessName === "Imported, Vendor");
  ok("Eventeny booth import defaults fail private and incomplete", importedVendor?.public === false && importedVendor?.documents?.[0]?.status === "missing" && importedVendor?.boothFeeCents === 125000);
  const current = {
    eventId: DEFAULT_EVENT_ID,
    lastUpdated: "2026-07-16T00:00:00.000Z",
    source: "manual_verified",
    booths: [{ id: "B-KEEP", eventId: DEFAULT_EVENT_ID, status: "assigned", assignedApplicationId: "V-KEEP", illustratedMapXY: { x: 5, y: 5 } }],
    vendors: [{ id: "V-KEEP", eventId: DEFAULT_EVENT_ID, businessName: "Keep Vendor", status: "approved", boothId: "B-KEEP", public: true }],
    imports: []
  };
  const bundle = { csv: importCsv };
  const previewHash = eventenyBoothImportPreviewHash(bundle, { eventId: DEFAULT_EVENT_ID, mirrorFingerprint: eventenyBoothMirrorFingerprint(current) });
  const preview = applyEventenyBoothImport(current, parsedImport, { previewHash, batchId: "preview_booths" });
  ok("Eventeny booth preview preserves absent local records without mutation", preview.ok && preview.summary.booths.created === 2 && preview.summary.vendors.created === 1 && preview.summary.invalid === 1 && current.booths.length === 1 && preview.doc.booths.some(item => item.id === "B-KEEP"));
  const committed = applyEventenyBoothImport(current, parsedImport, { commit: true, previewHash, bundleHash: eventenyBoothBundleHash(bundle, { eventId: DEFAULT_EVENT_ID }), batchId: "eventeny_booths_test", fileName: "eventeny-booths.csv", now: "2026-07-17T13:00:00.000Z" });
  const replay = applyEventenyBoothImport(committed.doc, parsedImport, { commit: true, previewHash, bundleHash: eventenyBoothBundleHash(bundle, { eventId: DEFAULT_EVENT_ID }), batchId: "eventeny_booths_replay" });
  ok("Eventeny booth commit and replay are idempotent", committed.ok && committed.doc.imports.length === 1 && replay.replay === true && replay.doc.booths.filter(item => item.id === "B-IMPORT-1").length === 1);
  ok("Eventeny booth preview binds current mirror state", eventenyBoothImportPreviewHash(bundle, { eventId: DEFAULT_EVENT_ID, mirrorFingerprint: eventenyBoothMirrorFingerprint(committed.doc) }) !== previewHash);
  const oversizedBoothCsv = `booth_id\n${Array.from({ length: EVENTENY_BOOTH_IMPORT_MAX_ROWS + 1 }, (_, index) => `B-${index}`).join("\n")}`;
  ok("Eventeny booth import enforces row ceiling", parseEventenyBoothCsv(oversizedBoothCsv, { eventId: DEFAULT_EVENT_ID }).ok === false);
}

// Partner intake, payments, follow-ups, tasks, and outreach
{
  const eventId = DEFAULT_EVENT_ID;
  const config = {
    vendorOfferings: [{
      id: "marketplace-booth",
      name: "Marketplace booth",
      amount: 125000,
      currency: "usd",
      publicLabel: "$1,250 application fee",
      active: true,
      requiresApproval: true,
      categories: ["retail", "artisan", "service"],
      description: "Festival marketplace booth.",
      inclusions: ["Booth footprint"]
    }],
    sponsorPackages: [{ id: "tarpon", name: "Tarpon", amount: 500000, active: true, benefits: ["Web listing"] }]
  };
  const defaults = {
    eventId,
    transactionalContactConfirmed: true,
    catalogFingerprint: eventenyPartnerCatalogFingerprint(config)
  };
  const csv = `submission_id,application_type,company_name,primary_contact,email,category,vendor_offering,sponsorship_tier,status,total,event
EV-V-001,exhibitor,Island Goods,Vendor Contact,vendor-import@example.com,retail,Marketplace booth,,Approved,100.00,${eventId}
EV-S-001,sponsorship,Coastal Credit,Sponsor Contact,sponsor-import@example.com,,,Tarpon,Accepted,9999.00,${eventId}
EV-S-002,sponsor,Unknown Tier Inc,Unknown Contact,unknown-import@example.com,,,Missing,Submitted,10.00,${eventId}
EV-V-OLD,vendor,Old Event Vendor,Old Contact,old-import@example.com,retail,Marketplace booth,,Approved,100.00,texas-sandfest-2026`;
  const parsed = parseEventenyPartnerCsv(csv, defaults);
  let importSequence = 0;
  const options = {
    actorId: "eventeny_import_admin",
    config,
    commit: true,
    idFactory: prefix => `${prefix}_eventeny_${++importSequence}`,
    now: "2026-07-17T14:00:00.000Z",
    sourceBatch: "eventeny_batch_1"
  };
  const imported = applyEventenyPartnerImport(emptyPartnerOperations(eventId), parsed, options);
  const replayed = applyEventenyPartnerImport(imported.doc, parsed, options);
  const changed = parseEventenyPartnerCsv(csv.replace("Island Goods", "Island Goods LLC"), defaults);
  const conflicted = applyEventenyPartnerImport(imported.doc, changed, options);
  const importedVendor = imported.doc.applications.find(item => item.sourceRef === "eventeny/application/EV-V-001");
  const importedSponsor = imported.doc.applications.find(item => item.sourceRef === "eventeny/application/EV-S-001");
  ok("Eventeny application CSV validation", parsed.ok && parsed.totalRows === 4 && parsed.errors.length === 1 && parsed.rows.length === 3);
  ok("Eventeny import requires transactional contact attestation", !parseEventenyPartnerCsv(csv, { eventId }).ok);
  ok("Eventeny import trusts active catalog pricing", imported.summary.imported === 2 && imported.summary.invalid === 2 && importedVendor?.expectedAmountCents === 125000 && importedVendor?.sourceReportedAmountCents === 10000 && importedSponsor?.expectedAmountCents === 500000);
  const unsafeSponsorSelection = resolveEventenyPartnerSelection({
    ...config,
    sponsorPackages: [{ ...config.sponsorPackages[0], amount: 0 }]
  }, { type: "sponsor", packageName: "Tarpon" });
  ok("Eventeny sponsor import rejects invalid catalog pricing", unsafeSponsorSelection.ok === false);
  ok("Eventeny import seeds workflows without duplicate acknowledgment", imported.doc.tasks.length === 2 && imported.doc.milestones.length === 7 && imported.doc.followups.length === 0 && imported.doc.vendorProfiles.length === 1 && imported.doc.vendorRequirements.length > 0 && imported.doc.brandProfiles.length === 1);
  ok("Eventeny import preserves review-first provenance", importedVendor?.status === "submitted" && importedVendor?.sourceStatus === "Approved" && importedVendor?.sourceBatch === "eventeny_batch_1" && importedVendor?.sourceRow === 2 && importedVendor?.contactPermissionBasis === "eventeny_application" && imported.doc.activity.every(item => item.actorId === "eventeny_import_admin"));
  ok("Eventeny application replay is idempotent", replayed.summary.imported === 0 && replayed.summary.duplicates === 2 && replayed.doc.applications.length === 2 && replayed.doc.tasks.length === 2);
  ok("Eventeny changed application requires manual review", conflicted.summary.conflicts === 1 && conflicted.summary.duplicates === 1 && conflicted.doc.applications.length === 2);
  ok("Eventeny preview hash binds catalog and defaults", eventenyPartnerImportPreviewHash(csv, defaults) !== eventenyPartnerImportPreviewHash(csv, { ...defaults, defaultType: "vendor" }) && eventenyPartnerImportPreviewHash(csv, defaults) !== eventenyPartnerImportPreviewHash(csv, { ...defaults, catalogFingerprint: "f".repeat(64) }));
  const oversizedCsv = `application_id,type,business_name,contact_name,contact_email\n${Array.from({ length: EVENTENY_PARTNER_IMPORT_MAX_ROWS + 1 }, (_, index) => `EV-${index},vendor,Business ${index},Contact ${index},contact${index}@example.com`).join("\n")}`;
  ok("Eventeny application import enforces row ceiling", !parseEventenyPartnerCsv(oversizedCsv, { ...defaults, defaultType: "vendor" }).ok);
}

{
  let sequence = 0;
  const idFactory = prefix => `${prefix}_${++sequence}`;
  const now = "2026-07-16T12:00:00.000Z";
  const applicationInput = {
    type: "sponsor",
    organizationName: "Gulf Coast Bank",
    contactName: "Avery Rivera",
    contactEmail: "avery@example.com",
    contactPhone: "361-555-0100",
    packageId: "marlin",
    packageName: "Marlin",
    packageBenefits: ["Beach signage", "Digital placement", "Hospitality support"],
    expectedAmountCents: 2500000,
    consentToContact: true
  };
  const intakeIdempotencyOptions = {
    idempotencyKeyHash: "a".repeat(64),
    idempotencyFingerprint: "b".repeat(64)
  };
  const created = createPartnerApplication(emptyPartnerOperations(), applicationInput, { idFactory, portalAccessIdFactory: () => "portal_access_1", now, ...intakeIdempotencyOptions });
  const duplicateApplication = createPartnerApplication(created.doc, applicationInput, { idFactory, now, ...intakeIdempotencyOptions });
  const conflictingApplication = createPartnerApplication(created.doc, { ...applicationInput, organizationName: "Different Bank" }, { idFactory, now, ...intakeIdempotencyOptions, idempotencyFingerprint: "c".repeat(64) });
  ok("partner application", created.ok && created.doc.tasks.length === 1 && created.doc.followups.length === 1 && created.application.portalAccessVersion === 1);
  let collisionSequence = 0;
  const collidingIds = ["sapp_1000001", "sapp_2"];
  const collisionIdFactory = prefix => prefix === "sapp" && collidingIds.length
    ? collidingIds.shift()
    : `${prefix}_collision_${++collisionSequence}`;
  const collisionRecovered = createPartnerApplication(created.doc, {
    ...applicationInput,
    organizationName: "Second Coast Bank",
    contactEmail: "second-coast@example.com"
  }, { idFactory: collisionIdFactory, portalAccessIdFactory: () => "portal_access_2", now });
  const collisionExhausted = createPartnerApplication(created.doc, {
    ...applicationInput,
    organizationName: "Exhausted Reference Bank",
    contactEmail: "exhausted-reference@example.com"
  }, { idFactory: () => "sapp_1", now });
  ok("partner application reference collision retries inside the transaction", collisionRecovered.ok && collisionRecovered.application.id === "sapp_2" && collisionRecovered.application.reference === "TSF-S-000002" && new Set(collisionRecovered.doc.applications.map(item => item.reference)).size === 2);
  ok("partner application reference allocation fails closed", !collisionExhausted.ok && collisionExhausted.retryable === true && collisionExhausted.doc === undefined);
  const intakePaymentMilestone = created.doc.milestones.find(item => item.kind === "payment_due");
  ok("partner application idempotency", duplicateApplication.ok && duplicateApplication.duplicate && duplicateApplication.application.id === created.application.id && duplicateApplication.doc.applications.length === 1 && duplicateApplication.doc.tasks.length === 1 && duplicateApplication.doc.milestones.length === 4 && duplicateApplication.doc.followups.length === 1);
  ok("sponsor payment key date is finance owned", intakePaymentMilestone?.label === "Payment due" && intakePaymentMilestone?.assigneeTeam === "finance" && intakePaymentMilestone?.source === "application_intake");
  ok("partner application idempotency conflict", !conflictingApplication.ok && conflictingApplication.conflict === true);
  ok("sponsor package fulfillment seeded", created.doc.brandProfiles.length === 1 && created.doc.deliverables.length === 3 && created.doc.deliverables.every(item => item.source === "package_benefit"));
  const portalConfig = partnerPortalConfig({
    SANDFEST_ENV: "production",
    SANDFEST_PARTNER_PORTAL_SECRET: "0123456789abcdef0123456789abcdef",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org"
  });
  const portalToken = issuePartnerPortalToken(created.application, { config: portalConfig });
  const portalUrl = `https://www.texassandfest.org${partnerPortalPath(created.application, portalToken)}`;
  const legacyCollisionApplication = {
    ...created.application,
    id: "sapp_legacy_collision",
    organizationName: "Legacy Reference Partner",
    portalAccessId: "portal_access_legacy_collision"
  };
  const legacyCollisionToken = issuePartnerPortalToken(legacyCollisionApplication, { config: portalConfig });
  const legacyCollisionAccess = findPartnerPortalApplication({
    ...created.doc,
    applications: [...created.doc.applications, legacyCollisionApplication]
  }, created.application.reference, legacyCollisionToken, { config: portalConfig });
  ok("partner portal production configuration", portalConfig.ready && portalConfig.publicBaseUrl === "https://www.texassandfest.org");
  ok("partner portal capability token", portalToken?.startsWith("tsfp_") && verifyPartnerPortalToken(created.application, portalToken, { config: portalConfig }) && !verifyPartnerPortalToken(created.application, `${portalToken}x`, { config: portalConfig }));
  ok("partner portal fragment link", partnerPortalPath(created.application, portalToken).startsWith("/#partner-status?") && portalUrl.includes("#partner-status?"));
  ok("partner portal resolves a legacy duplicate reference by capability", legacyCollisionAccess.ok && legacyCollisionAccess.application.id === legacyCollisionApplication.id);
  const preferenceFollowup = created.doc.followups[0];
  const preferenceDoc = {
    ...created.doc,
    followups: [
      preferenceFollowup,
      ...["draft_ready", "approved", "queued", "failed", "sending", "sending", "sent"].map((status, index) => ({
        ...preferenceFollowup,
        id: `followup_preference_${index + 1}`,
        status,
        providerSubmissionStartedAt: status === "sending" && index === 4 ? now : null,
        sentAt: status === "sent" ? now : null
      }))
    ]
  };
  const contactOptOutAt = "2026-07-16T12:01:00.000Z";
  const contactOptOut = updatePartnerContactPreference(preferenceDoc, created.application.id, {
    consentToContact: false,
    expectedVersion: 1
  }, { actorId: `partner:${created.application.id}`, idFactory, noticeVersion: partnerContactNotice("sponsor").version, now: contactOptOutAt });
  const contactOptOutReplay = updatePartnerContactPreference(contactOptOut.doc, created.application.id, {
    consentToContact: false,
    expectedVersion: 1
  }, { actorId: `partner:${created.application.id}`, idFactory, noticeVersion: partnerContactNotice("sponsor").version, now: contactOptOutAt });
  const staleContactOptIn = updatePartnerContactPreference(contactOptOut.doc, created.application.id, {
    consentToContact: true,
    expectedVersion: 1
  }, { actorId: `partner:${created.application.id}`, idFactory, noticeVersion: partnerContactNotice("sponsor").version, now: "2026-07-16T12:02:00.000Z" });
  const unversionedContactOptIn = updatePartnerContactPreference(contactOptOut.doc, created.application.id, {
    consentToContact: true
  }, { actorId: `partner:${created.application.id}`, idFactory, noticeVersion: partnerContactNotice("sponsor").version, now: "2026-07-16T12:02:00.000Z" });
  const blockedAfterOptOutDoc = {
    ...contactOptOut.doc,
    followups: [...contactOptOut.doc.followups, { ...preferenceFollowup, id: "followup_after_opt_out", status: "approved" }]
  };
  const blockedAfterOptOut = queueFollowupDelivery(blockedAfterOptOutDoc, "followup_after_opt_out", { now: contactOptOutAt });
  const contactOptInAt = "2026-07-16T12:03:00.000Z";
  const contactOptIn = updatePartnerContactPreference(contactOptOut.doc, created.application.id, {
    consentToContact: true,
    expectedVersion: 2
  }, { actorId: `partner:${created.application.id}`, idFactory, noticeVersion: partnerContactNotice("sponsor").version, now: contactOptInAt });
  const optOutPublicPortal = publicPartnerPortalStatus(contactOptOut.doc, contactOptOut.application, { now: contactOptOutAt });
  ok("partner portal contact opt-out dismisses only unsent messages", contactOptOut.ok
    && contactOptOut.changed
    && contactOptOut.dismissedFollowups === 6
    && contactOptOut.application.consentToContact === false
    && contactOptOut.application.consentWithdrawnAt === contactOptOutAt
    && contactOptOut.application.consentPreferenceVersion === 2
    && contactOptOut.doc.followups.filter(item => item.status === "dismissed").length === 6
    && contactOptOut.doc.followups.some(item => item.status === "sending" && item.providerSubmissionStartedAt)
    && contactOptOut.doc.followups.some(item => item.status === "sent"));
  ok("partner portal contact preference is idempotent and conflict safe", contactOptOutReplay.ok
    && contactOptOutReplay.replay
    && !contactOptOutReplay.changed
    && !staleContactOptIn.ok
    && staleContactOptIn.conflict
    && !unversionedContactOptIn.ok
    && unversionedContactOptIn.error.includes("version is required")
    && !blockedAfterOptOut.ok
    && blockedAfterOptOut.error.includes("does not permit contact"));
  ok("partner portal contact re-enrollment captures current notice", contactOptIn.ok
    && contactOptIn.application.consentToContact === true
    && contactOptIn.application.consentCapturedAt === contactOptInAt
    && contactOptIn.application.consentWithdrawnAt === null
    && contactOptIn.application.consentPreferenceVersion === 3
    && contactOptIn.application.consentNoticeVersion === partnerContactNotice("sponsor").version
    && contactOptIn.doc.followups.filter(item => item.status === "dismissed").length === 6);
  ok("partner portal contact preference projection is private", optOutPublicPortal.contactPreference?.allowed === false
    && optOutPublicPortal.contactPreference?.version === 2
    && !Object.hasOwn(optOutPublicPortal, "contactEmail")
    && !JSON.stringify(contactOptOut.doc.activity.at(-1)).includes(applicationInput.contactEmail)
    && !JSON.stringify(contactOptOut.doc.activity.at(-1)).includes(portalToken));
  const recovery = requestPartnerPortalRecovery(created.doc, {
    reference: created.application.reference.toLowerCase(),
    contactEmail: applicationInput.contactEmail.toUpperCase()
  }, { idFactory, now, portalUrlForApplication: () => portalUrl });
  const missedRecovery = requestPartnerPortalRecovery(created.doc, {
    reference: created.application.reference,
    contactEmail: "wrong@example.com"
  }, { idFactory, now, portalUrlForApplication: () => portalUrl });
  const duplicateRecovery = requestPartnerPortalRecovery(recovery.doc, {
    reference: created.application.reference,
    contactEmail: applicationInput.contactEmail
  }, { idFactory, now: "2026-07-16T12:14:59.999Z", portalUrlForApplication: () => portalUrl });
  const nextRecovery = requestPartnerPortalRecovery(recovery.doc, {
    reference: created.application.reference,
    contactEmail: applicationInput.contactEmail
  }, { idFactory, now: new Date(Date.parse(now) + PARTNER_PORTAL_RECOVERY_WINDOW_MS).toISOString(), portalUrlForApplication: () => portalUrl });
  const changedRecoveryRecipient = queueFollowupDelivery({
    ...recovery.doc,
    applications: recovery.doc.applications.map(item => item.id === created.application.id
      ? { ...item, contactEmail: "changed@example.com" }
      : item)
  }, recovery.followup.id, { now });
  const recoveryActivity = recovery.doc.activity.at(-1);
  ok("partner portal recovery creates approved current-link delivery", recovery.ok && recovery.changed && recovery.matched && recovery.followup.status === "approved" && recovery.followup.body.includes(portalUrl) && recovery.followup.recipient === applicationInput.contactEmail);
  ok("partner portal recovery misses without mutation", missedRecovery.ok && !missedRecovery.matched && !missedRecovery.changed && missedRecovery.followup === null && missedRecovery.doc.followups.length === created.doc.followups.length);
  ok("partner portal recovery enforces a sliding cooldown", duplicateRecovery.duplicate && duplicateRecovery.followup.id === recovery.followup.id && nextRecovery.changed && nextRecovery.followup.id !== recovery.followup.id);
  ok("partner portal recovery revalidates recipient before queue", !changedRecoveryRecipient.ok && changedRecoveryRecipient.error.includes("no longer matches"));
  ok("partner portal recovery activity is privacy minimized", recoveryActivity.type === "application.portal_access_requested" && !JSON.stringify(recoveryActivity).includes(applicationInput.contactEmail) && !JSON.stringify(recoveryActivity).includes(portalToken));
  const immediateMilestoneReminder = generateDuePartnerFollowups(created.doc, { idFactory, now, leadDays: 3, portalUrlForApplication: () => portalUrl });
  const expeditedMilestone = updatePartnerMilestone(created.doc, created.doc.milestones.find(item => item.kind === "opportunity_qualification").id, {
    dueAt: new Date(Date.parse(now) + 86_400_000).toISOString()
  }, { idFactory, actorId: "admin_1", now });
  const expeditedMilestoneReminder = generateDuePartnerFollowups(expeditedMilestone.doc, { idFactory, now, leadDays: 3, portalUrlForApplication: () => portalUrl });
  const reminderNow = new Date(Date.parse(now) + PARTNER_INITIAL_REMINDER_GRACE_MS).toISOString();
  const scheduled = generateDuePartnerFollowups(created.doc, { idFactory, now: reminderNow, leadDays: 3, portalUrlForApplication: () => portalUrl });
  const scheduledAgain = generateDuePartnerFollowups(scheduled.doc, { idFactory, now: reminderNow, leadDays: 3 });
  ok("new intake acknowledgment has a reminder grace period", !immediateMilestoneReminder.changed && immediateMilestoneReminder.generated.length === 0);
  ok("staff-rescheduled intake milestone bypasses the initial grace period", expeditedMilestoneReminder.generated.length === 1 && expeditedMilestoneReminder.generated[0].sourceVersion === "schedule:2:phase:upcoming");
  ok("scheduled milestone draft after intake grace", scheduled.changed && scheduled.generated.length === 1 && scheduled.generated[0].status === "draft_ready" && scheduled.generated[0].sourceVersion === "schedule:1:phase:upcoming" && scheduled.generated[0].body.includes(portalUrl));
  ok("scheduled milestone idempotency", !scheduledAgain.changed && scheduledAgain.generated.length === 0);
  const milestoneApproved = reviewFollowup(scheduled.doc, scheduled.generated[0].id, "approve", { actorId: "admin_1", now: reminderNow });
  const milestoneQueued = queueFollowupDelivery(milestoneApproved.doc, scheduled.generated[0].id, { now: reminderNow });
  const claimedMilestoneReminder = claimFollowupDelivery(milestoneQueued.doc, scheduled.generated[0].id, { deliveryClaimId: "job_milestone_reminder", now: reminderNow });
  const rescheduledBeforeMilestoneHandoff = updatePartnerMilestone(claimedMilestoneReminder.doc, scheduled.generated[0].milestoneId, { dueAt: "2026-08-02T12:00:00.000Z" }, { idFactory, actorId: "admin_1", now: reminderNow });
  const begunMilestoneReminder = beginFollowupProviderSubmission(claimedMilestoneReminder.doc, scheduled.generated[0].id, { deliveryClaimId: "job_milestone_reminder", now: reminderNow });
  const completedAfterMilestoneHandoff = updatePartnerMilestone(begunMilestoneReminder.doc, scheduled.generated[0].milestoneId, { status: "completed" }, { idFactory, actorId: "admin_1", now: reminderNow });
  const milestoneSent = recordFollowupDelivery(milestoneQueued.doc, scheduled.generated[0].id, { sent: true, provider: "brevo", providerMessageId: "msg_milestone_1" }, { now: reminderNow });
  const overdueMilestone = generateDuePartnerFollowups(milestoneSent.doc, { idFactory, now: "2026-07-23T12:00:00.000Z", portalUrlForApplication: () => portalUrl });
  const overdueReminder = overdueMilestone.generated.find(item => item.milestoneId === scheduled.generated[0].milestoneId);
  const overdueMilestoneAgain = generateDuePartnerFollowups(overdueMilestone.doc, { idFactory, now: "2026-07-30T12:00:00.000Z" });
  const inFlightMilestoneDoc = {
    ...overdueMilestone.doc,
    followups: overdueMilestone.doc.followups.map(item => item.id === overdueReminder?.id
      ? { ...item, status: "sending", deliveryClaimId: "job_milestone_overdue", deliveryClaimedAt: now }
      : item)
  };
  const inFlightMilestoneAgain = generateDuePartnerFollowups(inFlightMilestoneDoc, { idFactory, now: "2026-07-30T12:00:00.000Z" });
  ok("milestone overdue escalation", overdueReminder?.reminderPhase === "overdue_week_1" && overdueReminder?.daysOverdue === 5);
  ok("milestone escalation does not pile up", overdueMilestoneAgain.generated.length === 0 && inFlightMilestoneAgain.generated.length === 0);
  ok("milestone changes cancel only an unstarted notification handoff", rescheduledBeforeMilestoneHandoff.ok && rescheduledBeforeMilestoneHandoff.dismissedFollowups === 1 && rescheduledBeforeMilestoneHandoff.doc.followups.find(item => item.id === scheduled.generated[0].id)?.status === "dismissed" && rescheduledBeforeMilestoneHandoff.doc.followups.find(item => item.id === scheduled.generated[0].id)?.deliveryClaimId === null && completedAfterMilestoneHandoff.ok && completedAfterMilestoneHandoff.dismissedFollowups === 0 && completedAfterMilestoneHandoff.doc.followups.find(item => item.id === scheduled.generated[0].id)?.status === "sending");
  const completedMilestone = updatePartnerMilestone(overdueMilestone.doc, scheduled.generated[0].milestoneId, { status: "completed" }, { idFactory, actorId: "admin_1", now: "2026-07-23T13:00:00.000Z" });
  ok("milestone completion dismisses reminder", completedMilestone.ok && completedMilestone.milestone.completedBy === "admin_1" && completedMilestone.dismissedFollowups === 1 && completedMilestone.doc.followups.find(item => item.id === overdueReminder.id).status === "dismissed");
  const rescheduledMilestone = updatePartnerMilestone(scheduled.doc, scheduled.generated[0].milestoneId, { dueAt: "2026-08-01T12:00:00.000Z" }, { idFactory, actorId: "admin_1", now });
  const staleMilestoneDoc = { ...rescheduledMilestone.doc, followups: rescheduledMilestone.doc.followups.map(item => item.id === scheduled.generated[0].id ? { ...item, status: "draft_ready" } : item) };
  const staleMilestoneReview = reviewFollowup(staleMilestoneDoc, scheduled.generated[0].id, "approve", { actorId: "admin_1", now });
  ok("milestone reschedule invalidates stale reminder", rescheduledMilestone.milestone.scheduleVersion === 2 && rescheduledMilestone.dismissedFollowups === 1 && !staleMilestoneReview.ok && staleMilestoneReview.error.includes("stale"));
  const customMilestone = createPartnerMilestone(created.doc, created.application.id, { label: "Hospitality roster due", dueAt: "2026-08-10T17:00:00.000Z", assigneeTeam: "guest-services", reminderLeadDays: 5 }, { idFactory, actorId: "admin_1", now });
  const milestoneSummary = summarizePartnerMilestones(customMilestone.doc, now);
  const invalidMilestone = createPartnerMilestone(created.doc, created.application.id, { label: "Bad date", dueAt: "invalid", reminderLeadDays: 31 }, { idFactory, now });
  ok("custom partner milestone", customMilestone.ok && customMilestone.milestone.assigneeTeam === "guest-services" && customMilestone.milestone.reminderLeadDays === 5 && milestoneSummary.totals.open === 5);
  ok("milestone input validation", !invalidMilestone.ok);
  const drafted = prepareFollowupDraft(created.doc, created.followup.id, { now, portalUrl });
  ok("follow-up review draft", drafted.ok && drafted.followup.status === "draft_ready" && !drafted.followup.sentAt && drafted.followup.body.includes(portalUrl));
  const reviewFirstAutomation = applyTransactionalFollowupAutomation(drafted.doc, { providerReady: true, now });
  const blockedAutomation = setPartnerAutomationMode(drafted.doc, "transactional_auto", { providerReady: false, actorId: "admin_1", now, idFactory });
  const genericAutomationKinds = PARTNER_TRANSACTIONAL_FOLLOWUP_KINDS.filter(kind => kind !== "vendor_applications_open");
  const automationDrafts = genericAutomationKinds.map((kind, index) => ({
    ...drafted.followup,
    id: `followup_auto_${index + 1}`,
    kind,
    ...(kind === "application_approved" ? { sourceVersion: "decision:1:approved" } : {}),
    ...(kind === "sponsor_brand_changes" ? { brandProfileId: "automation_brand_profile", sourceVersion: `review:${now}` } : {}),
    ...(kind === "sponsor_deliverable_review" ? { deliverableId: "automation_deliverable", sourceVersion: "proof:1" } : {}),
    status: "draft_ready",
    approvedBy: null,
    approvedAt: null,
    automationPolicy: null,
    automationDecision: null
  }));
  const automationInput = {
    ...drafted.doc,
    applications: drafted.doc.applications.map(item => item.id === created.application.id
      ? { ...item, status: "approved", decisionStatus: "approved", decisionVersion: 1, decisionAt: now }
      : item),
    brandProfiles: [...drafted.doc.brandProfiles, {
      id: "automation_brand_profile",
      applicationId: created.application.id,
      status: "changes_requested",
      updatedAt: now
    }],
    deliverables: [...drafted.doc.deliverables, {
      id: "automation_deliverable",
      applicationId: created.application.id,
      status: "published",
      proofUrl: "https://www.texassandfest.org/sponsors/automation-proof",
      proofNotes: "",
      proofVersion: 1,
      partnerReviewStatus: "pending"
    }],
    followups: [
      ...automationDrafts,
      { ...drafted.followup, id: "followup_outreach_review_gate", kind: "sponsor_outreach", status: "draft_ready" },
      { ...drafted.followup, id: "followup_stale_recipient", kind: "vendor_profile_changes", recipient: "stale@example.com", status: "draft_ready" }
    ]
  };
  const enabledAutomation = setPartnerAutomationMode(automationInput, "transactional_auto", { providerReady: true, actorId: "admin_1", now, idFactory });
  const automated = applyTransactionalFollowupAutomation(enabledAutomation.doc, {
    providerReady: true,
    now: "2026-07-16T12:01:00.000Z",
    idFactory
  });
  const automationReadiness = partnerAutomationReadiness(automated.doc, { providerReady: true });
  const queueCandidates = automatedFollowupQueueCandidates(automated.doc);
  ok("transactional automation defaults to review", !reviewFirstAutomation.changed && reviewFirstAutomation.approved.length === 0);
  ok("transactional automation requires email provider", !blockedAutomation.ok && blockedAutomation.providerNotReady === true);
  ok("transactional automation approves bounded message kinds", enabledAutomation.ok && automated.approved.length === genericAutomationKinds.length && automated.approved.every(item => item.approvedBy === `automation:${PARTNER_TRANSACTIONAL_AUTOMATION_POLICY}`));
  ok("sponsor outreach remains review gated", automated.doc.followups.find(item => item.id === "followup_outreach_review_gate")?.status === "draft_ready");
  ok("transactional automation revalidates recipients", automated.doc.followups.find(item => item.id === "followup_stale_recipient")?.status === "draft_ready" && automated.skipped.some(item => item.id === "followup_stale_recipient"));
  ok("automation readiness is privacy safe", automationReadiness.active && automationReadiness.eligibleKinds.length === PARTNER_TRANSACTIONAL_FOLLOWUP_KINDS.length && !JSON.stringify(automationReadiness).includes("avery@example.com"));
  ok("automation queue candidates are explicit", queueCandidates.length === genericAutomationKinds.length && queueCandidates.every(item => item.status === "approved"));
  const returnedToReview = setPartnerAutomationMode(automated.doc, "review_first", { providerReady: true, actorId: "admin_1", now: "2026-07-16T12:02:00.000Z", idFactory });
  ok("disabling automation returns unqueued approvals to review", returnedToReview.ok && returnedToReview.returnedToReview === genericAutomationKinds.length && returnedToReview.doc.followups.filter(item => item.automationDecision === "returned_to_review").every(item => item.status === "draft_ready"));
  const automationQueued = queueFollowupDelivery(automated.doc, queueCandidates[0].id, { now, automationJobId: "job_automation_inflight" });
  const disabledWithQueued = setPartnerAutomationMode(automationQueued.doc, "review_first", { providerReady: true, actorId: "admin_1", now: "2026-07-16T12:03:00.000Z", idFactory });
  ok("disabling automation preserves an in-flight delivery", automationQueued.ok && disabledWithQueued.doc.followups.find(item => item.id === queueCandidates[0].id)?.status === "queued" && disabledWithQueued.returnedToReview === genericAutomationKinds.length - 1);
  ok("legacy automation mode migrates safely", partnerAutomationReadiness({ ...emptyPartnerOperations(), automationMode: "enabled" }, { providerReady: true }).mode === "transactional_auto");
  const refreshedDraft = rotatePartnerPortalAccess(drafted.doc, created.application.id, {
    idFactory,
    portalAccessIdFactory: () => "portal_access_refreshed",
    actorId: "admin_1",
    now,
    portalUrlForApplication: application => {
      const token = issuePartnerPortalToken(application, { config: portalConfig });
      return `https://www.texassandfest.org${partnerPortalPath(application, token)}`;
    }
  });
  ok("portal rotation refreshes unsent drafts", refreshedDraft.ok && refreshedDraft.refreshedFollowups === 1 && refreshedDraft.doc.followups[0].portalUrl !== portalUrl && !refreshedDraft.doc.followups[0].body.includes(portalUrl));
  const approved = reviewFollowup(drafted.doc, created.followup.id, "approve", { actorId: "admin_1", now });
  ok("follow-up approval", approved.ok && approved.followup.status === "approved" && approved.followup.approvedBy === "admin_1");
  const refreshedApproved = rotatePartnerPortalAccess(approved.doc, created.application.id, {
    idFactory,
    portalAccessIdFactory: () => "portal_access_after_approval",
    actorId: "admin_1",
    now,
    portalUrlForApplication: application => `https://www.texassandfest.org${partnerPortalPath(application, issuePartnerPortalToken(application, { config: portalConfig }))}`
  });
  ok("portal rotation revokes stale draft approval", refreshedApproved.doc.followups[0].status === "draft_ready" && refreshedApproved.doc.followups[0].approvedBy === null);
  const queued = queueFollowupDelivery(approved.doc, created.followup.id, { now });
  ok("follow-up queue gate", queued.ok && queued.followup.status === "queued");
  const refreshedQueued = rotatePartnerPortalAccess(queued.doc, created.application.id, {
    idFactory,
    portalAccessIdFactory: () => "portal_access_after_queue",
    actorId: "admin_1",
    now,
    portalUrlForApplication: application => `https://www.texassandfest.org${partnerPortalPath(application, issuePartnerPortalToken(application, { config: portalConfig }))}`
  });
  ok("portal rotation cancels stale queued delivery", refreshedQueued.doc.followups[0].status === "dismissed" && refreshedQueued.doc.followups[0].lastError.includes("rotated"));
  const retrying = recordFollowupDelivery(queued.doc, created.followup.id, { sent: false, provider: "brevo", error: "temporary" }, { now });
  ok("follow-up retry state", retrying.ok && retrying.followup.status === "queued" && retrying.followup.deliveryAttempts === 1);
  const terminal = recordFollowupDelivery(retrying.doc, created.followup.id, { sent: false, provider: "brevo", error: "final" }, { now, terminal: true });
  ok("follow-up terminal failure", terminal.ok && terminal.followup.status === "failed" && terminal.followup.lastError === "final");
  const delivered = recordFollowupDelivery(queued.doc, created.followup.id, { sent: true, provider: "brevo", providerMessageId: "msg_test" }, { now });
  ok("follow-up delivery proof", delivered.ok && delivered.followup.status === "sent" && delivered.followup.providerMessageId === "msg_test");
  const accepted = updatePartnerApplication(delivered.doc, created.application.id, { status: "approved" }, {
    idFactory,
    actorId: "admin_1",
    now,
    portalUrlForApplication: () => portalUrl
  });
  const acceptedReview = reviewFollowup(accepted.doc, accepted.followup.id, "approve", { actorId: "admin_1", now });
  const contractedAfterApproval = updatePartnerApplication(accepted.doc, created.application.id, { status: "contracted" }, { idFactory, actorId: "admin_1", now });
  const reopenedDecision = updatePartnerApplication(accepted.doc, created.application.id, { status: "under_review" }, { idFactory, actorId: "admin_1", now });
  const rejectedDecision = updatePartnerApplication(reopenedDecision.doc, created.application.id, { status: "rejected" }, {
    idFactory,
    actorId: "admin_1",
    now,
    portalUrlForApplication: () => portalUrl
  });
  const rejectedAutomationMode = setPartnerAutomationMode(rejectedDecision.doc, "transactional_auto", { providerReady: true, actorId: "admin_1", now, idFactory });
  const rejectedAutomation = applyTransactionalFollowupAutomation(rejectedAutomationMode.doc, { providerReady: true, now, idFactory });
  ok("application approval creates a versioned portal notice", accepted.ok && accepted.followup?.kind === "application_approved" && accepted.followup.status === "draft_ready" && accepted.followup.sourceVersion === "decision:1:approved" && accepted.followup.body.includes(portalUrl) && accepted.application.decisionStatus === "approved" && accepted.application.decisionVersion === 1 && acceptedReview.ok);
  ok("downstream approved states preserve one decision notice", contractedAfterApproval.ok && contractedAfterApproval.followup === null && contractedAfterApproval.application.decisionStatus === "approved" && contractedAfterApproval.application.decisionVersion === 1 && contractedAfterApproval.doc.followups.filter(item => item.kind === "application_approved").length === 1);
  ok("reopening an application dismisses its unsent decision notice", reopenedDecision.ok && reopenedDecision.dismissedFollowups === 1 && reopenedDecision.application.decisionStatus === null && reopenedDecision.application.decisionVersion === 2 && reopenedDecision.doc.followups.find(item => item.id === accepted.followup.id)?.status === "dismissed");
  ok("non-approval notices always require staff review", rejectedDecision.ok && rejectedDecision.followup?.kind === "application_rejected" && rejectedDecision.followup.manualReviewRequiredAt === now && rejectedDecision.followup.sourceVersion === "decision:3:rejected" && rejectedAutomation.approved.length === 0 && rejectedAutomation.doc.followups.find(item => item.id === rejectedDecision.followup.id)?.status === "draft_ready");
  const invalidPaymentMethod = recordPartnerPayment(accepted.doc, created.application.id, { amountCents: 100, method: "crypto" }, { idFactory, now });
  const invalidPaymentDate = recordPartnerPayment(accepted.doc, created.application.id, { amountCents: 100, method: "check", receivedAt: "not-a-date" }, { idFactory, now });
  const missingPaymentReference = recordPartnerPayment(accepted.doc, created.application.id, { amountCents: 100, method: "check" }, { idFactory, now });
  ok("partner payment validation", !invalidPaymentMethod.ok && !invalidPaymentDate.ok && !missingPaymentReference.ok && missingPaymentReference.error.includes("reference is required"));
  const prepaid = recordPartnerPayment(accepted.doc, created.application.id, { amountCents: 500000, method: "check", externalRef: "CHECK-100" }, { idFactory, now });
  ok("partner prepayment is unapplied", prepaid.ok && prepaid.payment.unappliedAmountCents === 500000 && prepaid.payment.invoiceId === null);
  const invoiceDraft = createPartnerInvoice(prepaid.doc, created.application.id, { quickBooksItemId: "77", dueAt: now }, { idFactory, actorId: "finance_1", now });
  ok("partner invoice allocates prepayment", invoiceDraft.ok && invoiceDraft.invoice.amountCents === 2500000 && invoiceDraft.invoice.balanceCents === 2000000 && invoiceDraft.doc.payments[0].invoiceId === invoiceDraft.invoice.id);
  ok("invoice date controls payment milestone", invoiceDraft.paymentMilestone?.dueAt === invoiceDraft.invoice.dueAt && invoiceDraft.paymentMilestone?.kind === "payment_due" && invoiceDraft.paymentMilestone?.scheduleVersion === 2);
  const invoiceApproved = reviewPartnerInvoice(invoiceDraft.doc, invoiceDraft.invoice.id, "approve", { actorId: "finance_1", now });
  ok("partner invoice approval", invoiceApproved.ok && invoiceApproved.invoice.approvedBy === "finance_1");
  const partnerCheckout = beginPartnerPaymentCheckout(invoiceApproved.doc, created.application.id, invoiceDraft.invoice.id, {
    idFactory,
    actorId: `partner:${created.application.reference}`,
    now,
    expiresAt: "2026-07-16T12:30:00.000Z"
  });
  const repeatedPartnerCheckout = beginPartnerPaymentCheckout(partnerCheckout.doc, created.application.id, invoiceDraft.invoice.id, {
    idFactory,
    now: "2026-07-16T12:01:00.000Z"
  });
  ok("partner Stripe checkout reservation", partnerCheckout.ok && partnerCheckout.checkout.amountCents === 2000000 && partnerCheckout.checkout.status === "creating" && repeatedPartnerCheckout.duplicate);
  const stripePartnerConfig = stripePartnerPaymentsConfig({
    SANDFEST_ENV: "production",
    STRIPE_PARTNER_PAYMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_partner",
    STRIPE_WEBHOOK_SECRET: "whsec_partner",
    STRIPE_PARTNER_SUCCESS_URL: "https://www.texassandfest.org/#partner-payment-success?session_id={CHECKOUT_SESSION_ID}",
    STRIPE_PARTNER_CANCEL_URL: "https://www.texassandfest.org/#partner-status"
  });
  const partnerCheckoutBody = buildStripePartnerCheckoutRequest({
    checkout: partnerCheckout.checkout,
    invoice: invoiceApproved.invoice,
    application: created.application,
    config: stripePartnerConfig
  });
  ok("partner Stripe server amount contract", stripePartnerConfig.ready && partnerCheckoutBody.get("line_items[0][price_data][unit_amount]") === "2000000" && partnerCheckoutBody.get("metadata[partner_invoice_id]") === invoiceDraft.invoice.id && partnerCheckoutBody.get("customer_email") === created.application.contactEmail);
  const unsafeStripePartnerConfig = stripePartnerPaymentsConfig({
    SANDFEST_ENV: "production",
    STRIPE_PARTNER_PAYMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_partner",
    STRIPE_WEBHOOK_SECRET: "whsec_partner",
    STRIPE_PARTNER_SUCCESS_URL: "https://www.texassandfest.org/#paid",
    STRIPE_PARTNER_CANCEL_URL: "https://www.texassandfest.org/#partner-status",
    STRIPE_API_BASE_URL: "https://stripe-proxy.example.com"
  });
  ok("partner Stripe production origin gate", !unsafeStripePartnerConfig.ready && unsafeStripePartnerConfig.missing.some(item => item.includes("official Stripe origin")));
  const activatedPartnerCheckout = activatePartnerPaymentCheckout(partnerCheckout.doc, partnerCheckout.checkout.id, {
    id: "cs_partner_001",
    url: "https://checkout.stripe.com/c/pay/cs_partner_001",
    expires_at: Date.parse("2026-07-16T12:30:00.000Z") / 1000
  }, { now: "2026-07-16T12:01:00.000Z" });
  const publicCheckout = publicPartnerPortalStatus(activatedPartnerCheckout.doc, created.application, { now: "2026-07-16T12:01:00.000Z" }).finance.checkout;
  ok("partner portal secure checkout", activatedPartnerCheckout.ok && activatedPartnerCheckout.checkout.status === "open" && publicCheckout?.checkoutUrl.startsWith("https://checkout.stripe.com/") && !("providerSessionId" in publicCheckout));
  const stripeEvent = {
    id: "evt_partner_paid_001",
    type: "checkout.session.completed",
    data: { object: {
      id: "cs_partner_001",
      payment_intent: "pi_partner_001",
      amount_total: 2000000,
      currency: "usd",
      payment_status: "paid",
      metadata: {
        sandfest_flow: "partner_invoice",
        partner_checkout_id: partnerCheckout.checkout.id,
        partner_application_id: created.application.id,
        partner_invoice_id: invoiceDraft.invoice.id
      }
    } }
  };
  const stripeContext = stripePartnerEventContext(stripeEvent);
  const mismatchedStripePayment = reconcilePartnerStripePayment(activatedPartnerCheckout.doc, { ...stripeContext, amountCents: 1 }, { idFactory, actorId: "stripe-webhook", now });
  ok("partner Stripe amount mismatch fails closed", mismatchedStripePayment.ok && !mismatchedStripePayment.reconciled && mismatchedStripePayment.checkout.status === "reconciliation_required" && mismatchedStripePayment.doc.payments.length === 1);
  const stripePaid = reconcilePartnerStripePayment(activatedPartnerCheckout.doc, stripeContext, { idFactory, actorId: "stripe-webhook", now });
  const stripePaidAgain = reconcilePartnerStripePayment(stripePaid.doc, stripeContext, { idFactory, actorId: "stripe-webhook", now });
  const stripePaidMilestone = stripePaid.doc.milestones.find(item => item.kind === "payment_due");
  ok("partner Stripe payment reconciliation", stripePaid.ok && stripePaid.reconciled && stripePaid.payment.method === "stripe" && stripePaid.invoice.balanceCents === 0 && stripePaid.doc.applications[0].status === "paid");
  ok("Stripe payment completes payment key date", stripePaidMilestone?.status === "completed" && stripePaidMilestone?.completedBy === "automation:payment_reconciliation");
  ok("partner Stripe payment idempotency", stripePaidAgain.ok && stripePaidAgain.duplicate && stripePaidAgain.doc.payments.length === 2);
  const boardPartnerCheckout = beginPartnerPaymentCheckout(partnerCheckout.doc, created.application.id, invoiceDraft.invoice.id, {
    idFactory,
    actorId: `partner:${created.application.reference}`,
    now,
    expiresAt: "2026-07-16T12:30:00.000Z",
    provider: "board_sandbox"
  });
  const boardPartnerPayment = reconcilePartnerStripePayment(boardPartnerCheckout.doc, {
    checkoutId: boardPartnerCheckout.checkout.id,
    applicationId: created.application.id,
    invoiceId: invoiceDraft.invoice.id,
    providerSessionId: "cs_board_partner_001",
    paymentIntentId: "pi_board_partner_001",
    providerEventId: "evt_board_partner_001",
    amountCents: 2000000,
    currency: "usd",
    paymentStatus: "paid",
    receivedAt: now
  }, {
    idFactory,
    actorId: "board-payment-sandbox",
    now,
    paymentMethod: "card",
    paymentReferencePrefix: "board",
    paymentNotes: `Local board payment sandbox checkout ${boardPartnerCheckout.checkout.id}`
  });
  ok("board partner checkout uses the real reconciliation contract", !boardPartnerCheckout.duplicate
    && boardPartnerCheckout.doc.paymentCheckouts.length === 2
    && boardPartnerCheckout.checkout.provider === "board_sandbox"
    && boardPartnerPayment.ok
    && boardPartnerPayment.reconciled
    && boardPartnerPayment.payment.method === "card"
    && boardPartnerPayment.payment.externalRef === "board:pi_board_partner_001"
    && boardPartnerPayment.invoice.balanceCents === 0
    && boardPartnerPayment.doc.milestones.find(item => item.kind === "payment_due")?.status === "completed");
  const stripeRefunded = reconcilePartnerStripeRefund(stripePaid.doc, {
    paymentIntentId: "pi_partner_001",
    refundedAmountCents: 250000,
    providerEventId: "evt_partner_refund_001",
    reason: "Partial package adjustment"
  }, { idFactory, actorId: "stripe-webhook", now });
  const refundedPortal = publicPartnerPortalStatus(stripeRefunded.doc, created.application);
  const stripeRefundedMilestone = stripeRefunded.doc.milestones.find(item => item.kind === "payment_due");
  ok("partner Stripe partial refund ledger", stripeRefunded.ok && stripeRefunded.payment.status === "partially_refunded" && stripeRefunded.invoice.balanceCents === 250000 && stripeRefunded.totalPaidCents === 2250000 && refundedPortal.finance.paidAmountCents === 2250000 && refundedPortal.finance.balanceCents === 250000);
  ok("Stripe refund reopens payment key date", stripeRefundedMilestone?.status === "open" && stripeRefundedMilestone?.completedAt === null && stripeRefunded.reopenedPaymentMilestones?.includes(stripeRefundedMilestone?.id));
  const invoiceQueued = queuePartnerInvoiceSync(invoiceApproved.doc, invoiceDraft.invoice.id, { now });
  ok("partner invoice queue gate", invoiceQueued.ok && invoiceQueued.invoice.status === "queued");
  const invoiceRetry = recordPartnerInvoiceSync(invoiceQueued.doc, invoiceDraft.invoice.id, { ok: false, error: "temporary" }, { now });
  ok("partner invoice retry state", invoiceRetry.ok && invoiceRetry.invoice.status === "queued" && invoiceRetry.invoice.syncAttempts === 1);
  const invoiceSynced = recordPartnerInvoiceSync(invoiceQueued.doc, invoiceDraft.invoice.id, {
    ok: true, customerId: "42", invoiceId: "99", docNumber: "1007", totalCents: 2500000, balanceCents: 2500000, syncedAt: now
  }, { now });
  ok("partner invoice sync proof", invoiceSynced.ok && invoiceSynced.invoice.status === "synced" && invoiceSynced.invoice.balanceCents === 2000000 && invoiceSynced.invoice.quickBooksBalanceCents === 2500000 && invoiceSynced.invoice.quickBooksReconciliationStatus === "complete");
  const reconciliationQueued = queuePartnerInvoiceReconciliation(invoiceSynced.doc, invoiceDraft.invoice.id, { now });
  const reconciliationDuplicate = queuePartnerInvoiceReconciliation(reconciliationQueued.doc, invoiceDraft.invoice.id, { now });
  const reconciliationRetry = recordPartnerInvoiceReconciliation(reconciliationQueued.doc, invoiceDraft.invoice.id, { ok: false, error: "temporary" }, { now });
  const reconciliationRecorded = recordPartnerInvoiceReconciliation(reconciliationRetry.doc, invoiceDraft.invoice.id, {
    ok: true,
    invoiceId: "99",
    docNumber: "1007",
    totalCents: 2400000,
    balanceCents: 1800000,
    providerUpdatedAt: "2026-07-16T11:58:00.000Z",
    reconciledAt: now
  }, { now });
  ok("partner invoice reconciliation queue is versioned", reconciliationQueued.ok && reconciliationQueued.invoice.quickBooksReconciliationVersion === 1 && !reconciliationDuplicate.ok);
  ok("partner invoice reconciliation retries safely", reconciliationRetry.ok && reconciliationRetry.invoice.quickBooksReconciliationStatus === "queued" && reconciliationRetry.invoice.quickBooksReconciliationAttempts === 1);
  ok("partner invoice reconciliation records provider truth only", reconciliationRecorded.ok && reconciliationRecorded.invoice.quickBooksReconciliationStatus === "complete" && reconciliationRecorded.invoice.quickBooksBalanceCents === 1800000 && reconciliationRecorded.invoice.quickBooksTotalCents === 2400000 && reconciliationRecorded.invoice.balanceCents === 2000000);
  const agedDoc = { ...reconciliationRecorded.doc, invoices: reconciliationRecorded.doc.invoices.map(item => ({ ...item, dueAt: "2026-05-31T12:00:00.000Z" })) };
  const aged = summarizePartnerReceivables(agedDoc, "2026-07-15T12:00:00.000Z");
  ok("receivables aging and QuickBooks exception", aged.aging.days31To60Cents === 2000000 && aged.totals.overdueCents === 2000000 && aged.exceptions.some(item => item.type === "quickbooks_mismatch") && aged.exceptions.some(item => item.type === "quickbooks_amount_mismatch"));
  const paymentReminderDrafts = generateDuePartnerFollowups(invoiceSynced.doc, { idFactory, now, portalUrlForApplication: () => portalUrl });
  const paymentReminder = paymentReminderDrafts.generated.find(item => item.milestoneId === invoiceDraft.paymentMilestone.id);
  ok("open invoice schedules payment follow-up", paymentReminder?.kind === "milestone_reminder" && paymentReminder?.status === "draft_ready");
  const partial = recordPartnerPayment(paymentReminderDrafts.doc, created.application.id, { amountCents: 1000000, method: "ach", externalRef: "ACH-200" }, { idFactory, now });
  ok("partner payment allocation", partial.ok && partial.payment.appliedAmountCents === 1000000 && partial.doc.invoices[0].balanceCents === 1000000 && partial.doc.applications[0].status === "partial");
  const paymentNotices = generatePartnerPaymentFollowups(partial.doc, { idFactory, now, portalUrlForApplication: () => portalUrl });
  const paymentReceipt = paymentNotices.generated.find(item => item.paymentId === partial.payment.id);
  const repeatedPaymentNotices = generatePartnerPaymentFollowups(paymentNotices.doc, { idFactory, now, portalUrlForApplication: () => portalUrl });
  const legacyPaymentNotices = generatePartnerPaymentFollowups({
    ...partial.doc,
    payments: partial.doc.payments.map(item => ({ ...item, noticePolicyVersion: undefined }))
  }, { idFactory, now, portalUrlForApplication: () => portalUrl });
  ok("partner payment receipt is current, private, and idempotent", paymentReceipt?.kind === "payment_received"
    && paymentReceipt.status === "draft_ready"
    && paymentReceipt.subject.includes("payment received")
    && paymentReceipt.body.includes("$10,000.00")
    && paymentReceipt.body.includes("current invoice balance")
    && paymentReceipt.body.includes(portalUrl)
    && !paymentReceipt.body.includes("ACH-200")
    && repeatedPaymentNotices.generated.length === 0);
  ok("payment notices do not backfill legacy ledger entries", legacyPaymentNotices.generated.length === 0);
  const paymentNoticeReversal = reversePartnerPayment(paymentNotices.doc, partial.payment.id, { action: "refund", reason: "Private finance correction" }, { idFactory, actorId: "finance_1", now: "2026-07-16T12:05:00.000Z" });
  const stalePaymentReceiptDoc = {
    ...paymentNoticeReversal.doc,
    followups: paymentNoticeReversal.doc.followups.map(item => item.id === paymentReceipt.id ? { ...item, status: "draft_ready" } : item)
  };
  const stalePaymentReceiptReview = reviewFollowup(stalePaymentReceiptDoc, paymentReceipt.id, "approve", { actorId: "finance_1", now });
  const paymentAdjustments = generatePartnerPaymentFollowups(stalePaymentReceiptDoc, { idFactory, now: "2026-07-16T12:05:00.000Z", portalUrlForApplication: () => portalUrl });
  const paymentAdjustment = paymentAdjustments.generated.find(item => item.paymentId === partial.payment.id);
  ok("payment reversal invalidates receipt and creates a safe adjustment notice", !stalePaymentReceiptReview.ok
    && stalePaymentReceiptReview.error.includes("stale")
    && paymentAdjustments.doc.followups.find(item => item.id === paymentReceipt.id)?.status === "dismissed"
    && paymentAdjustment?.kind === "payment_adjustment"
    && paymentAdjustment.body.includes("$10,000.00")
    && !paymentAdjustment.body.includes("Private finance correction")
    && !paymentAdjustment.body.includes("ACH-200"));
  const duplicatePayment = recordPartnerPayment(partial.doc, created.application.id, { amountCents: 1000000, method: "ach", externalRef: "ach-200" }, { idFactory, now });
  const conflictingPayment = recordPartnerPayment(partial.doc, created.application.id, { amountCents: 900000, method: "ach", externalRef: "ACH-200" }, { idFactory, now });
  ok("partner payment reference idempotency", duplicatePayment.ok && duplicatePayment.duplicate && duplicatePayment.doc.payments.length === 2 && duplicatePayment.totalPaidCents === 1500000 && !conflictingPayment.ok && conflictingPayment.conflict);
  const overpaid = recordPartnerPayment(partial.doc, created.application.id, { amountCents: 1100000, method: "ach", externalRef: "ACH-201" }, { idFactory, now });
  const overpaidSummary = summarizePartnerReceivables(overpaid.doc, now);
  const overpaidMilestone = overpaid.doc.milestones.find(item => item.kind === "payment_due");
  ok("partner overpayment exception", overpaid.ok && overpaid.payment.unappliedAmountCents === 100000 && overpaid.doc.invoices[0].balanceCents === 0 && overpaidSummary.totals.creditCents === 100000 && overpaidSummary.exceptions.some(item => item.type === "overpayment"));
  ok("full payment closes key date and reminder", overpaidMilestone?.status === "completed" && overpaid.doc.followups.find(item => item.id === paymentReminder.id)?.status === "dismissed");
  const reversed = reversePartnerPayment(overpaid.doc, overpaid.payment.id, { action: "refund", reason: "Duplicate bank settlement" }, { idFactory, actorId: "finance_1", now });
  const reversedMilestone = reversed.doc.milestones.find(item => item.kind === "payment_due");
  ok("partner payment reversal", reversed.ok && reversed.payment.status === "refunded" && reversed.invoice.balanceCents === 1000000 && reversed.totalPaidCents === 1500000 && reversed.doc.applications[0].status === "partial");
  ok("payment reversal reopens key date", reversedMilestone?.status === "open" && reversedMilestone?.scheduleVersion === overpaidMilestone.scheduleVersion + 1 && reversed.reopenedPaymentMilestones?.includes(reversedMilestone?.id));
  const paid = recordPartnerPayment(reversed.doc, created.application.id, { amountCents: 1000000, method: "ach", externalRef: "ACH-202" }, { idFactory, now });
  const paidMilestone = paid.doc.milestones.find(item => item.kind === "payment_due");
  ok("partner payment ledger", paid.ok && paid.totalPaidCents === 2500000 && paid.doc.invoices[0].balanceCents === 0 && paid.doc.applications[0].status === "paid" && paidMilestone?.status === "completed");
  const defensivePaidDoc = {
    ...paid.doc,
    milestones: paid.doc.milestones.map(item => item.id === paidMilestone.id ? { ...item, status: "open", completedAt: null, completedBy: null } : item)
  };
  const defensivePaidReminder = generateDuePartnerFollowups(defensivePaidDoc, { idFactory, now, portalUrlForApplication: () => portalUrl });
  ok("paid balance cannot generate payment reminder", !defensivePaidReminder.generated.some(item => item.milestoneId === paidMilestone.id));
  const access = findPartnerPortalApplication(paid.doc, created.application.reference.toLowerCase(), portalToken, { config: portalConfig });
  const publicStatus = publicPartnerPortalStatus(paid.doc, access.application);
  ok("partner portal public finance", access.ok && publicStatus.finance.paymentStatus === "paid" && publicStatus.finance.balanceCents === 0 && publicStatus.milestones.length === 4 && publicStatus.milestones.some(item => item.label === "Payment due" && item.status === "completed"));
  ok("partner portal privacy", !("contactEmail" in publicStatus) && !("ownerId" in publicStatus) && !("portalAccessId" in publicStatus) && !("quickBooksInvoiceId" in (publicStatus.finance.invoice || {})));
  const rotated = rotatePartnerPortalAccess(paid.doc, created.application.id, { idFactory, portalAccessIdFactory: () => "portal_access_2", actorId: "admin_1", now });
  const rotatedToken = issuePartnerPortalToken(rotated.application, { config: portalConfig });
  ok("partner portal access rotation", rotated.ok && rotated.application.portalAccessVersion === 2 && !verifyPartnerPortalToken(rotated.application, portalToken, { config: portalConfig }) && verifyPartnerPortalToken(rotated.application, rotatedToken, { config: portalConfig }));
  const brandProfile = updatePartnerBrandProfile(paid.doc, created.application.id, {
    displayName: "Gulf Coast Bank",
    website: "https://gulfcoast.example/",
    tagline: "Banking for the coast",
    primaryColor: "#005B63",
    secondaryColor: "#F7B733",
    instagramUrl: "https://instagram.com/gulfcoastbank",
    linkedinUrl: "https://linkedin.com/company/gulfcoastbank",
    usageNotes: "Keep clear space around the mark."
  }, { actorId: `partner:${created.application.id}`, idFactory, now });
  ok("sponsor brand profile submission", brandProfile.ok && brandProfile.profile.status === "submitted" && brandProfile.profile.primaryColor === "#005B63");
  ok("unapproved sponsor branding stays private", publicSponsorShowcase(brandProfile.doc).length === 0);
  const sponsorProfileChanges = reviewPartnerBrandProfile(brandProfile.doc, created.application.id, {
    action: "request_changes",
    reviewNotes: "Please add the approved community campaign tagline."
  }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  const duplicateSponsorProfileChanges = reviewPartnerBrandProfile(sponsorProfileChanges.doc, created.application.id, {
    action: "request_changes",
    reviewNotes: "Please add the approved community campaign tagline."
  }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  ok("sponsor brand profile change draft", sponsorProfileChanges.ok && sponsorProfileChanges.followupChanged && sponsorProfileChanges.followup.kind === "sponsor_brand_changes" && sponsorProfileChanges.followup.brandProfileId === brandProfile.profile.id && sponsorProfileChanges.followup.body.includes(portalUrl) && !sponsorProfileChanges.followup.body.includes(created.application.contactEmail));
  ok("sponsor brand profile draft idempotency", duplicateSponsorProfileChanges.ok && !duplicateSponsorProfileChanges.followupChanged && duplicateSponsorProfileChanges.doc.followups.filter(item => item.kind === "sponsor_brand_changes").length === 1);
  const revisedBrandProfile = updatePartnerBrandProfile(sponsorProfileChanges.doc, created.application.id, {
    displayName: "Gulf Coast Bank",
    website: "https://gulfcoast.example/",
    tagline: "Banking for the coast and community",
    primaryColor: "#005B63",
    secondaryColor: "#F7B733",
    instagramUrl: "https://instagram.com/gulfcoastbank",
    linkedinUrl: "https://linkedin.com/company/gulfcoastbank",
    usageNotes: "Keep clear space around the mark."
  }, { actorId: `partner:${created.application.id}`, idFactory, now });
  const staleProfileNoticeDoc = {
    ...revisedBrandProfile.doc,
    followups: revisedBrandProfile.doc.followups.map(item => item.id === sponsorProfileChanges.followup.id ? { ...item, status: "draft_ready" } : item)
  };
  const staleProfileNotice = reviewFollowup(staleProfileNoticeDoc, sponsorProfileChanges.followup.id, "approve", { actorId: "sponsor_admin_1", now });
  ok("sponsor brand profile resubmission dismisses stale draft", revisedBrandProfile.dismissedFollowups === 1 && revisedBrandProfile.doc.followups.find(item => item.id === sponsorProfileChanges.followup.id)?.status === "dismissed" && !staleProfileNotice.ok && staleProfileNotice.error.includes("no longer actionable"));
  const approvedBrandProfile = reviewPartnerBrandProfile(revisedBrandProfile.doc, created.application.id, { action: "approve" }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  ok("sponsor brand profile approval", approvedBrandProfile.ok && approvedBrandProfile.profile.status === "approved" && approvedBrandProfile.profile.approvedBy === "sponsor_admin_1");
  const invalidBrandProfile = updatePartnerBrandProfile(approvedBrandProfile.doc, created.application.id, { displayName: "Gulf Coast Bank", primaryColor: "teal" }, { idFactory, now });
  ok("sponsor brand profile validation", !invalidBrandProfile.ok && invalidBrandProfile.error.includes("six-digit"));
  const brandAsset = createPartnerBrandAsset(approvedBrandProfile.doc, created.application.id, {
    kind: "primary_logo",
    label: "Primary horizontal logo",
    sourceUrl: "https://assets.gulfcoast.example/primary-logo.svg"
  }, { actorId: `partner:${created.application.id}`, idFactory, now });
  const duplicateBrandAsset = createPartnerBrandAsset(brandAsset.doc, created.application.id, {
    kind: "primary_logo",
    sourceUrl: "https://assets.gulfcoast.example/primary-logo.svg"
  }, { actorId: `partner:${created.application.id}`, idFactory, now });
  ok("sponsor brand asset idempotency", brandAsset.ok && !brandAsset.duplicate && duplicateBrandAsset.duplicate && duplicateBrandAsset.doc.brandAssets.length === 1);
  const changedBrandAsset = reviewPartnerBrandAsset(brandAsset.doc, brandAsset.asset.id, { status: "changes_requested", reviewNotes: "Please provide a transparent-background version." }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  const duplicateBrandAssetChanges = reviewPartnerBrandAsset(changedBrandAsset.doc, brandAsset.asset.id, { status: "changes_requested", reviewNotes: "Please provide a transparent-background version." }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  ok("sponsor brand asset review", changedBrandAsset.ok && changedBrandAsset.asset.status === "changes_requested" && changedBrandAsset.asset.reviewNotes.includes("transparent") && changedBrandAsset.followupChanged && changedBrandAsset.followup.kind === "sponsor_brand_changes" && changedBrandAsset.followup.brandAssetId === brandAsset.asset.id && changedBrandAsset.followup.body.includes(portalUrl));
  ok("sponsor brand asset draft idempotency", duplicateBrandAssetChanges.ok && !duplicateBrandAssetChanges.followupChanged && duplicateBrandAssetChanges.doc.followups.filter(item => item.brandAssetId === brandAsset.asset.id).length === 1);
  const replacementBrandAsset = createPartnerBrandAsset(changedBrandAsset.doc, created.application.id, {
    kind: "primary_logo",
    label: "Transparent primary logo",
    sourceUrl: "https://assets.gulfcoast.example/primary-logo-transparent.svg"
  }, { actorId: `partner:${created.application.id}`, idFactory, now });
  const staleAssetNoticeDoc = {
    ...replacementBrandAsset.doc,
    followups: replacementBrandAsset.doc.followups.map(item => item.id === changedBrandAsset.followup.id ? { ...item, status: "draft_ready" } : item)
  };
  const staleAssetNotice = reviewFollowup(staleAssetNoticeDoc, changedBrandAsset.followup.id, "approve", { actorId: "sponsor_admin_1", now });
  ok("sponsor replacement asset dismisses stale draft", replacementBrandAsset.dismissedFollowups === 1 && replacementBrandAsset.doc.followups.find(item => item.id === changedBrandAsset.followup.id)?.status === "dismissed" && !staleAssetNotice.ok && staleAssetNotice.error.includes("no longer actionable"));
  const deliverable = updatePartnerDeliverable(changedBrandAsset.doc, created.deliverables[0].id, {
    status: "published",
    ownerId: "sponsor_admin_1",
    dueAt: "2026-08-01T17:00:00.000Z",
    proofUrl: "https://www.texassandfest.org/sponsors/gulf-coast-bank",
    proofNotes: "Sponsor listing is live."
  }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  ok("sponsor deliverable proof gate", deliverable.ok && deliverable.deliverable.proofVersion === 1 && deliverable.deliverable.partnerReviewStatus === "pending" && deliverable.followupChanged && deliverable.followup.kind === "sponsor_deliverable_review" && deliverable.followup.deliverableId === deliverable.deliverable.id && deliverable.followup.body.includes(portalUrl) && !deliverable.followup.body.includes(deliverable.deliverable.proofUrl));
  const signedOff = reviewPartnerDeliverable(deliverable.doc, deliverable.deliverable.id, { action: "approve" }, { actorId: `partner:${created.application.id}`, idFactory, now });
  ok("sponsor deliverable sign-off", signedOff.ok && signedOff.deliverable.partnerReviewStatus === "approved" && signedOff.deliverable.partnerReviewedAt === now && signedOff.dismissedFollowups === 1 && signedOff.doc.followups.find(item => item.id === deliverable.followup.id)?.status === "dismissed");
  const revisedProof = updatePartnerDeliverable(signedOff.doc, deliverable.deliverable.id, { proofNotes: "Sponsor listing and homepage logo are live." }, { actorId: "sponsor_admin_1", idFactory, portalUrl, now });
  const staleProofNoticeDoc = {
    ...revisedProof.doc,
    followups: revisedProof.doc.followups.map(item => item.id === deliverable.followup.id ? { ...item, status: "draft_ready" } : item)
  };
  const staleProofNotice = reviewFollowup(staleProofNoticeDoc, deliverable.followup.id, "approve", { actorId: "sponsor_admin_1", now });
  ok("sponsor proof revision resets sign-off and notice", revisedProof.ok && revisedProof.deliverable.proofVersion === 2 && revisedProof.deliverable.partnerReviewStatus === "pending" && revisedProof.followupChanged && revisedProof.followup.sourceVersion === "proof:2" && !staleProofNotice.ok && staleProofNotice.error.includes("stale"));
  const noProof = updatePartnerDeliverable(changedBrandAsset.doc, created.deliverables[1].id, { status: "complete" }, { actorId: "sponsor_admin_1", idFactory, now });
  ok("sponsor completion requires proof", !noProof.ok && noProof.error.includes("proof"));
  const customDeliverable = createPartnerDeliverable(revisedProof.doc, created.application.id, { label: "VIP welcome banner", dueAt: "2026-08-05T17:00:00.000Z" }, { actorId: "sponsor_admin_1", idFactory, now });
  const fulfillmentSummary = summarizeSponsorFulfillment(customDeliverable.doc, now);
  ok("sponsor fulfillment summary", customDeliverable.ok && fulfillmentSummary.deliverables.total === 4 && fulfillmentSummary.deliverables.awaitingPartnerReview === 1 && fulfillmentSummary.assets.changesRequested === 1);
  const publicBranding = publicPartnerPortalStatus(customDeliverable.doc, created.application).branding;
  ok("partner portal brand fulfillment", publicBranding.profile.status === "approved" && publicBranding.assets.length === 1 && publicBranding.deliverables.length === 4);
  ok("partner portal brand privacy", !("storageKey" in publicBranding.assets[0]) && !("checksumSha256" in publicBranding.assets[0]) && !("ownerId" in publicBranding.deliverables[0]));
  const uploadDir = await mkdtemp(path.join(tmpdir(), "sandfest-brand-assets-"));
  const uploadConfig = partnerAssetStorageConfig(ROOT, { SANDFEST_ENV: "development", SANDFEST_PARTNER_ASSET_DIR: uploadDir, SANDFEST_PARTNER_ASSET_MAX_BYTES: "1024" });
  const pngBytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("sandfest-test")]);
  const storedAsset = await savePartnerAssetUpload(ROOT, { applicationId: created.application.id, assetId: "asset_upload_test", buffer: pngBytes, contentType: "image/png", fileName: "logo.png" }, { config: uploadConfig });
  const readAsset = storedAsset.ok ? await readPartnerAssetUpload(ROOT, storedAsset.storageKey, { config: uploadConfig }) : { ok: false };
  ok("private sponsor asset storage", storedAsset.ok && readAsset.ok && readAsset.buffer.equals(pngBytes) && storedAsset.checksumSha256.length === 64);
  const publicLogoAsset = storedAsset.ok ? createPartnerBrandAsset(customDeliverable.doc, created.application.id, {
    id: "asset_upload_test",
    kind: "primary_logo",
    label: "Approved public logo",
    ...storedAsset
  }, { actorId: `partner:${created.application.id}`, idFactory, now }) : { ok: false };
  const approvedPublicLogo = publicLogoAsset.ok ? reviewPartnerBrandAsset(publicLogoAsset.doc, publicLogoAsset.asset.id, { status: "approved" }, { actorId: "sponsor_admin_1", idFactory, now }) : { ok: false };
  const sponsorShowcase = approvedPublicLogo.ok ? publicSponsorShowcase(approvedPublicLogo.doc) : [];
  const sponsorShowcaseJson = JSON.stringify(sponsorShowcase);
  ok("approved sponsor branding publishes safely", sponsorShowcase.length === 1 && sponsorShowcase[0].displayName === "Gulf Coast Bank" && sponsorShowcase[0].logo?.path.endsWith("/asset_upload_test") && approvedPublicSponsorAsset(approvedPublicLogo.doc, "asset_upload_test")?.storageKey === storedAsset.storageKey && !sponsorShowcaseJson.includes("storageKey") && !sponsorShowcaseJson.includes("contactEmail") && !sponsorShowcaseJson.includes("checksum") && !sponsorShowcaseJson.includes("approvedBy"));
  ok("brand asset content validation", !validatePartnerAssetUpload({ buffer: Buffer.from("not-a-png"), contentType: "image/png", fileName: "fake.png" }, { maxBytes: 1024 }).ok);
  const recoveryPdf = Buffer.from("%PDF-1.4\nSandFest recovery proof\n%%EOF\n");
  const recoveryReferences = partnerAssetRecoveryReferences({
    brandAssets: [
      {
        id: "recovery-brand-upload",
        sourceType: "upload",
        storageKey: "sponsor/recovery-logo.png",
        sizeBytes: pngBytes.length,
        checksumSha256: createHash("sha256").update(pngBytes).digest("hex")
      },
      { id: "recovery-brand-external", sourceType: "external_url", sourceUrl: "https://assets.example/recovery-logo.svg" }
    ],
    vendorDocuments: [
      {
        id: "recovery-vendor-upload",
        sourceType: "upload",
        storageKey: "vendor/recovery-agreement.pdf",
        sizeBytes: recoveryPdf.length,
        checksumSha256: createHash("sha256").update(recoveryPdf).digest("hex")
      },
      {
        id: "recovery-vendor-upload-history",
        sourceType: "upload",
        storageKey: "vendor/recovery-agreement.pdf",
        sizeBytes: recoveryPdf.length,
        checksumSha256: createHash("sha256").update(recoveryPdf).digest("hex")
      }
    ]
  });
  const recoveryFiles = new Map([
    ["sponsor/recovery-logo.png", pngBytes],
    ["vendor/recovery-agreement.pdf", recoveryPdf]
  ]);
  const verifiedRecovery = await verifyPartnerAssetRecovery(recoveryReferences, async storageKey => ({ ok: true, buffer: recoveryFiles.get(storageKey) }));
  ok("asset recovery manifest selects uploads and deduplicates storage", recoveryReferences.ok && recoveryReferences.references.length === 2 && recoveryReferences.counts.uploadRecords === 3 && recoveryReferences.counts.externalReferences === 1 && recoveryReferences.references.find(item => item.storageKey.startsWith("vendor/"))?.sources.length === 2);
  ok("asset recovery verifies complete size and checksum manifest", verifiedRecovery.ok && verifiedRecovery.counts.verified === 2 && verifiedRecovery.counts.bytes === pngBytes.length + recoveryPdf.length && /^[a-f0-9]{64}$/.test(verifiedRecovery.manifestSha256));
  const missingRecovery = await verifyPartnerAssetRecovery(recoveryReferences, async storageKey => storageKey.startsWith("vendor/") ? { ok: false, reason: "missing" } : { ok: true, buffer: pngBytes });
  ok("asset recovery detects missing restored files", !missingRecovery.ok && missingRecovery.counts.missing === 1 && missingRecovery.counts.verified === 1);
  const mismatchedRecovery = await verifyPartnerAssetRecovery(recoveryReferences, async storageKey => ({ ok: true, buffer: storageKey.startsWith("vendor/") ? Buffer.alloc(recoveryPdf.length, 1) : pngBytes }));
  ok("asset recovery detects checksum corruption", !mismatchedRecovery.ok && mismatchedRecovery.counts.mismatched === 1 && mismatchedRecovery.issues.some(item => item.type === "mismatch" && item.sizeMatches && !item.checksumMatches));
  const invalidRecoveryReferences = partnerAssetRecoveryReferences({
    brandAssets: [{ id: "bad-key", sourceType: "upload", storageKey: "../escape.png", sizeBytes: 10, checksumSha256: "bad" }],
    vendorDocuments: [
      { ...recoveryReferences.references[0], id: "valid-key", sourceType: "upload" },
      { ...recoveryReferences.references[0], id: "conflict", sourceType: "upload", sizeBytes: recoveryReferences.references[0].sizeBytes + 1 }
    ]
  });
  const emptyRecovery = await verifyPartnerAssetRecovery(partnerAssetRecoveryReferences({}), async () => ({ ok: false, reason: "missing" }));
  ok("asset recovery rejects invalid metadata and conflicting storage keys", !invalidRecoveryReferences.ok && invalidRecoveryReferences.invalid.length === 2);
  ok("asset recovery requires a meaningful restored file set", !emptyRecovery.ok && emptyRecovery.counts.referenced === 0 && emptyRecovery.issues.some(item => item.type === "minimum_files"));
  if (storedAsset.ok) await deletePartnerAssetUpload(ROOT, storedAsset.storageKey, { config: uploadConfig });
  await rm(uploadDir, { recursive: true, force: true });
  const incomingDir = await mkdtemp(path.join(tmpdir(), "sandfest-incoming-documents-"));
  const incomingConfig = incomingDocumentStorageConfig(ROOT, {
    SANDFEST_ENV: "development",
    SANDFEST_INCOMING_DOCUMENT_DIR: incomingDir,
    SANDFEST_INCOMING_DOCUMENT_MAX_BYTES: "4096"
  });
  const incomingProductionMissing = incomingDocumentStorageConfig(ROOT, { SANDFEST_ENV: "production" });
  const incomingText = Buffer.from("Texas SandFest board packet\nReviewed source facts\n", "utf8");
  const storedIncoming = await saveIncomingDocumentUpload(ROOT, {
    documentId: "incoming_test_1",
    eventId: DEFAULT_EVENT_ID,
    fileName: "board-packet.txt",
    contentType: "text/plain",
    buffer: incomingText
  }, { config: incomingConfig });
  const readIncoming = storedIncoming.ok
    ? await readIncomingDocumentUpload(ROOT, storedIncoming.storageKey, { config: incomingConfig })
    : { ok: false };
  const incomingReviewDueAt = defaultIncomingDocumentReviewDueAt(now);
  const createdIncoming = storedIncoming.ok ? createIncomingDocument(emptyIncomingDocumentIntake(DEFAULT_EVENT_ID), {
    ...storedIncoming,
    id: "incoming_test_1",
    domain: "docs",
    title: "Board packet",
    ownerTeam: "operations",
    reviewDueAt: incomingReviewDueAt
  }, { eventId: DEFAULT_EVENT_ID, actorId: "ops_1", now }) : { ok: false };
  const duplicateIncoming = createdIncoming.ok ? createIncomingDocument(createdIncoming.doc, {
    ...storedIncoming,
    id: "incoming_test_2",
    domain: "finance",
    title: "Duplicate packet",
    ownerTeam: "finance"
  }, { eventId: DEFAULT_EVENT_ID, actorId: "finance_1", now }) : { ok: false };
  const routedIncoming = createdIncoming.ok ? syncIncomingDocumentReviewTask(emptyPartnerOperations(DEFAULT_EVENT_ID), createdIncoming.document, {
    actorId: "ops_1",
    idFactory,
    now
  }) : { ok: false };
  const changesRequestedIncoming = createdIncoming.ok ? updateIncomingDocument(createdIncoming.doc, createdIncoming.document.id, {
    status: "changes_requested",
    ownerTeam: "finance",
    reviewDueAt: "2026-07-15T12:00:00.000Z",
    notes: "Confirm the source totals."
  }, { eventId: DEFAULT_EVENT_ID, actorId: "finance_1", now }) : { ok: false };
  const reroutedIncoming = routedIncoming.ok && changesRequestedIncoming.ok
    ? syncIncomingDocumentReviewTask(routedIncoming.doc, changesRequestedIncoming.document, { actorId: "finance_1", idFactory, now })
    : { ok: false };
  const incomingAttentionSummary = changesRequestedIncoming.ok
    ? summarizeIncomingDocuments(changesRequestedIncoming.doc, { eventId: DEFAULT_EVENT_ID, now })
    : {};
  const reviewedIncoming = changesRequestedIncoming.ok ? updateIncomingDocument(changesRequestedIncoming.doc, createdIncoming.document.id, {
    status: "approved",
    notes: "Reviewed against the board source packet."
  }, { eventId: DEFAULT_EVENT_ID, actorId: "ops_1", now }) : { ok: false };
  const completedIncomingTask = reroutedIncoming.ok && reviewedIncoming.ok
    ? syncIncomingDocumentReviewTask(reroutedIncoming.doc, reviewedIncoming.document, { actorId: "ops_1", idFactory, now })
    : { ok: false };
  const repairedIncomingTasks = createdIncoming.ok
    ? syncIncomingDocumentReviewTasks(emptyPartnerOperations(DEFAULT_EVENT_ID), createdIncoming.doc.documents, { actorId: "worker", idFactory, now })
    : { ok: false };
  const repeatedIncomingRepair = repairedIncomingTasks.ok
    ? syncIncomingDocumentReviewTasks(repairedIncomingTasks.doc, createdIncoming.doc.documents, { actorId: "worker", idFactory, now })
    : { ok: false };
  const incomingSummary = reviewedIncoming.ok ? summarizeIncomingDocuments(reviewedIncoming.doc, { eventId: DEFAULT_EVENT_ID, now }) : {};
  const incomingAdminJson = reviewedIncoming.ok ? JSON.stringify(adminIncomingDocument(reviewedIncoming.document)) : "";
  const verifiedIncoming = readIncoming.ok && reviewedIncoming.ok
    ? verifyIncomingDocumentBytes(reviewedIncoming.document, readIncoming.buffer)
    : { ok: false };
  const incomingRecovery = reviewedIncoming.ok ? incomingDocumentRecoveryReferences(reviewedIncoming.doc) : { ok: false, references: [] };
  const platformRecovery = reviewedIncoming.ok ? platformAssetRecoveryReferences({ brandAssets: [], vendorDocuments: [] }, reviewedIncoming.doc) : { ok: false, references: [] };
  const verifiedPlatformRecovery = await verifyPartnerAssetRecovery(platformRecovery, async storageKey => ({
    ok: storageKey === `incoming-documents/${storedIncoming.storageKey}`,
    buffer: storageKey === `incoming-documents/${storedIncoming.storageKey}` ? incomingText : null
  }));
  const invalidIncomingJson = validateIncomingDocumentUpload({
    fileName: "broken.json",
    contentType: "application/json",
    buffer: Buffer.from("{not-json}", "utf8")
  }, { maxBytes: 4096 });
  const genericZip = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x00,
    0x00, 0x00, 0x6e, 0x6f, 0x74, 0x2d, 0x6f, 0x66, 0x66, 0x69, 0x63, 0x65,
    0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x6e, 0x6f, 0x74, 0x2d, 0x6f, 0x66, 0x66, 0x69, 0x63, 0x65,
    0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x39, 0x00,
    0x00, 0x00, 0x29, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);
  const minimalOfficeZip = entryNames => {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const entryName of entryNames) {
      const name = Buffer.from(entryName, "utf8");
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(name.length, 26);
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(name.length, 28);
      centralHeader.writeUInt32LE(localOffset, 42);
      localParts.push(localHeader, name);
      centralParts.push(centralHeader, name);
      localOffset += localHeader.length + name.length;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entryNames.length, 8);
    end.writeUInt16LE(entryNames.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(localOffset, 16);
    return Buffer.concat([...localParts, centralDirectory, end]);
  };
  const minimalDocx = minimalOfficeZip(["[Content_Types].xml", "word/document.xml"]);
  const minimalXlsx = minimalOfficeZip(["[Content_Types].xml", "xl/workbook.xml"]);
  const minimalPptx = minimalOfficeZip(["[Content_Types].xml", "ppt/presentation.xml"]);
  const boardBriefingBytes = await readFile(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  const validatedBoardBriefing = validateIncomingDocumentUpload({
    fileName: "SandFest-Board-Platform-Briefing.pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: boardBriefingBytes
  }, { maxBytes: 1024 * 1024 });
  const createdBoardBriefing = validatedBoardBriefing.ok ? createIncomingDocument(emptyIncomingDocumentIntake(DEFAULT_EVENT_ID), {
    ...validatedBoardBriefing,
    id: "incoming_board_briefing",
    domain: "docs",
    title: "SandFest board platform briefing",
    ownerTeam: "operations"
  }, { eventId: DEFAULT_EVENT_ID, actorId: "ops_1", now }) : { ok: false };
  const begunBoardBriefing = createdBoardBriefing.ok ? beginIncomingDocumentExtraction(createdBoardBriefing.doc, createdBoardBriefing.document.id, {
    extractionVersion: createdBoardBriefing.document.extractionVersion,
    jobId: "job_board_briefing"
  }, { eventId: DEFAULT_EVENT_ID, now }) : { ok: false };
  const extractedBoardBriefing = await extractDocumentText(boardBriefingBytes, createdBoardBriefing.document || {});
  const completedBoardBriefing = begunBoardBriefing.ok && extractedBoardBriefing.ok ? completeIncomingDocumentExtraction(begunBoardBriefing.doc, begunBoardBriefing.document.id, {
    ...extractedBoardBriefing,
    extractionVersion: begunBoardBriefing.document.extractionVersion
  }, { eventId: DEFAULT_EVENT_ID, now }) : { ok: false };
  const retriedBoardBriefing = completedBoardBriefing.ok ? requestIncomingDocumentExtraction(completedBoardBriefing.doc, completedBoardBriefing.document.id, {
    eventId: DEFAULT_EVENT_ID,
    actorId: "ops_1",
    now,
    force: true
  }) : { ok: false };
  const boardBriefingAdminJson = completedBoardBriefing.ok ? JSON.stringify(adminIncomingDocument(completedBoardBriefing.document)) : "";
  const boardBriefingSummary = completedBoardBriefing.ok ? summarizeIncomingDocuments(completedBoardBriefing.doc, { eventId: DEFAULT_EVENT_ID, now }) : {};
  const productionExtractionSource = documentExtractionSourceConfig({
    SANDFEST_ENV: "production",
    SANDFEST_DOCUMENT_EXTRACTION_SECRET: SMOKE_DOCUMENT_EXTRACTION_SECRET,
    SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL: "https://api.example.test/sandfest"
  });
  const unsafeProductionExtractionSource = documentExtractionSourceConfig({
    SANDFEST_ENV: "production",
    SANDFEST_DOCUMENT_EXTRACTION_SECRET: SMOKE_DOCUMENT_EXTRACTION_SECRET,
    SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL: "http://api.example.test/sandfest"
  });
  ok("document intake storage fails closed in production", incomingConfig.ready && !incomingProductionMissing.ready && incomingProductionMissing.reason.includes("SANDFEST_INCOMING_DOCUMENT_DIR"));
  ok("document intake validates, stores, and previews text", storedIncoming.ok && readIncoming.ok && readIncoming.buffer.equals(incomingText) && storedIncoming.extractionStatus === "preview_ready" && storedIncoming.textPreview.includes("board packet"));
  ok("document intake records and deduplicates checksums", createdIncoming.ok && !createdIncoming.duplicate && duplicateIncoming.ok && duplicateIncoming.duplicate && duplicateIncoming.document.id === createdIncoming.document.id && duplicateIncoming.doc.documents.length === 1);
  ok("document intake review lifecycle and summary", reviewedIncoming.ok && reviewedIncoming.document.status === "approved" && reviewedIncoming.document.reviewedBy === "ops_1" && incomingSummary.total === 1 && incomingSummary.byStatus.approved === 1 && incomingAttentionSummary.overdue === 1);
  ok("document intake creates accountable review work", routedIncoming.ok && routedIncoming.created && routedIncoming.task?.assigneeType === "team" && routedIncoming.task?.assigneeId === "operations" && routedIncoming.task?.dueAt === incomingReviewDueAt && incomingDocumentReviewTaskView(routedIncoming.doc, createdIncoming.document.id)?.status === "open");
  ok("document review state synchronizes task ownership and lifecycle", reroutedIncoming.ok && reroutedIncoming.task?.status === "blocked" && reroutedIncoming.task?.priority === "high" && reroutedIncoming.task?.assigneeId === "finance" && completedIncomingTask.ok && completedIncomingTask.task?.status === "done");
  ok("document review repair is complete and idempotent", repairedIncomingTasks.ok && repairedIncomingTasks.summary.created === 1 && repeatedIncomingRepair.ok && !repeatedIncomingRepair.changed && repeatedIncomingRepair.summary.unchanged === 1 && repeatedIncomingRepair.doc.tasks.length === 1);
  ok("document intake admin payload hides storage paths", !incomingAdminJson.includes("storageKey") && incomingAdminJson.includes(storedIncoming.checksumSha256));
  ok("document intake download integrity proof", verifiedIncoming.ok && !verifyIncomingDocumentBytes(reviewedIncoming.document, Buffer.from("tampered")).ok);
  ok("document intake is included in the restore manifest", incomingRecovery.ok && incomingRecovery.references[0]?.storageKey === `incoming-documents/${storedIncoming.storageKey}` && platformRecovery.counts.incomingDocuments === 1 && verifiedPlatformRecovery.ok && verifiedPlatformRecovery.counts.incomingDocuments === 1);
  ok("document intake rejects mismatched structured content", !invalidIncomingJson.ok && !validateIncomingDocumentUpload({ fileName: "fake.pdf", contentType: "application/pdf", buffer: Buffer.from("not a pdf") }, { maxBytes: 4096 }).ok);
  ok("document intake rejects generic ZIP files renamed as Office documents", !validateIncomingDocumentUpload({ fileName: "fake.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: genericZip }, { maxBytes: 4096 }).ok);
  ok("document intake distinguishes Office package families", validateIncomingDocumentUpload({ fileName: "packet.docx", buffer: minimalDocx }, { maxBytes: 4096 }).ok && validateIncomingDocumentUpload({ fileName: "ledger.xlsx", buffer: minimalXlsx }, { maxBytes: 4096 }).ok && validateIncomingDocumentUpload({ fileName: "briefing.pptx", buffer: minimalPptx }, { maxBytes: 4096 }).ok && !validateIncomingDocumentUpload({ fileName: "renamed.docx", buffer: minimalXlsx }, { maxBytes: 4096 }).ok);
  ok("binary document extraction is checksum-bound and chunked", validatedBoardBriefing.ok && createdBoardBriefing.document?.extractionStatus === "queued" && begunBoardBriefing.ok && extractedBoardBriefing.ok && extractedBoardBriefing.text.includes("TEXAS SANDFEST") && extractedBoardBriefing.chunkCount > 0 && completedBoardBriefing.document?.extractionStatus === "ready" && completedBoardBriefing.document?.extractedCharacterCount > 5_000 && completedBoardBriefing.document?.extractedChunkCount > 0);
  ok("document extraction metadata is private and retry-versioned", !boardBriefingAdminJson.includes("extractionChunks") && boardBriefingAdminJson.includes("TEXAS SANDFEST") && boardBriefingSummary.extractionReady === 1 && retriedBoardBriefing.ok && retriedBoardBriefing.document.extractionStatus === "queued" && retriedBoardBriefing.document.extractionVersion === completedBoardBriefing.document.extractionVersion + 1 && retriedBoardBriefing.document.extractedChunkCount === 0);
  ok("document extraction source requires production HTTPS and a shared secret", productionExtractionSource.remoteReady && !unsafeProductionExtractionSource.remoteReady && verifyDocumentExtractionSourceAuthorization({ authorization: `Bearer ${SMOKE_DOCUMENT_EXTRACTION_SECRET}` }, { config: productionExtractionSource }) && !verifyDocumentExtractionSourceAuthorization({ authorization: "Bearer wrong-secret" }, { config: productionExtractionSource }));
  if (storedIncoming.ok) await deleteIncomingDocumentUpload(ROOT, storedIncoming.storageKey, { config: incomingConfig });
  await rm(incomingDir, { recursive: true, force: true });
  const approvedTicketPolicy = {
    eventId: DEFAULT_EVENT_ID,
    version: "2027-test-v1",
    status: "approved",
    acknowledgment: "I acknowledge all current ticket purchase and festival entry policies.",
    notices: REQUIRED_TICKET_POLICY_NOTICES.map(item => ({ ...item, summary: `${item.label} is complete and approved for the current platform test event.` })),
    approvedAt: "2026-07-19T12:00:00.000Z",
    approvedBy: "ticketing_test",
    updatedAt: "2026-07-19T12:00:00.000Z"
  };
  const safeTicketCatalog = publicTicketCatalog({
    currency: "usd",
    checkoutEndpoint: "/unsafe-override",
    checkoutPolicy: approvedTicketPolicy,
    products: [{
      id: "ga-test",
      name: "GA Test",
      unitAmount: 4500,
      stripePriceId: "price_private_config_001",
      active: true,
      requiresReview: false,
      quantity: { min: 1, max: 4 }
    }]
  }, { checkoutEnabled: true, eventId: DEFAULT_EVENT_ID });
  const acceptedTicketPolicy = validateTicketPolicyAcceptance({ checkoutPolicy: approvedTicketPolicy }, {
    accepted: true,
    version: safeTicketCatalog.checkoutPolicy.version,
    digest: safeTicketCatalog.checkoutPolicy.digest
  }, { eventId: DEFAULT_EVENT_ID });
  const staleTicketPolicy = validateTicketPolicyAcceptance({ checkoutPolicy: approvedTicketPolicy }, {
    accepted: true,
    version: "2027-test-v0",
    digest: safeTicketCatalog.checkoutPolicy.digest
  }, { eventId: DEFAULT_EVENT_ID });
  ok("ticket checkout policy requires current-event approval and complete notices", ticketCheckoutPolicyReadiness({ checkoutPolicy: approvedTicketPolicy }, { eventId: DEFAULT_EVENT_ID }).ready && safeTicketCatalog.checkoutPolicy.notices.length === 4);
  ok("ticket checkout policy acceptance binds version and digest", acceptedTicketPolicy.ok && acceptedTicketPolicy.evidence.noticeIds.length === 4 && !staleTicketPolicy.ok && staleTicketPolicy.code === "policy_version_changed");
  ok("public ticket catalog derives checkout readiness", safeTicketCatalog.checkoutEndpoint === "/api/stripe/create-checkout-session" && safeTicketCatalog.products[0].availableForCheckout === true);
  ok("public ticket catalog hides provider configuration", !JSON.stringify(safeTicketCatalog).includes("stripePriceId") && !JSON.stringify(safeTicketCatalog).includes("price_private_config_001"));
  ok("public ticket catalog fails closed without approved policies or a ready checkout integration", publicTicketCatalog({
    products: [{
      id: "ga-test",
      name: "GA Test",
      unitAmount: 4500,
      stripePriceId: "price_private_config_001",
      active: true
    }]
  }, { checkoutEnabled: true, eventId: DEFAULT_EVENT_ID }).products[0].availableForCheckout === false && publicTicketCatalog({
    checkoutPolicy: { ...approvedTicketPolicy, status: "draft", approvedAt: null, approvedBy: null },
    products: [{ id: "ga-test", name: "GA Test", unitAmount: 4500, stripePriceId: "price_private_config_001", active: true }]
  }, { checkoutEnabled: true, eventId: DEFAULT_EVENT_ID }).products[0].availableForCheckout === false);
  const sponsorConfig = {
    sponsorPackages: [
      { id: "tarpon", name: "Tarpon", amount: 500000, currency: "usd", publicLabel: "$5k", active: true, requiresApproval: true, benefits: ["Web listing"], stripePriceId: null, quickBooksItemId: "77" },
      { id: "marlin", name: "Marlin", amount: 1500000, currency: "usd", publicLabel: "$15k", active: true, requiresApproval: true, benefits: ["Beach signage"] }
    ]
  };
  const defaultSponsorCatalog = sponsorPackageCatalog(sponsorConfig);
  const resolvedSponsorPackage = resolveSponsorPackage(sponsorConfig, "TARPON");
  const invalidSponsorAmount = updateSponsorPackageConfig(sponsorConfig, "tarpon", { amount: 0 });
  const invalidSponsorBenefits = updateSponsorPackageConfig(sponsorConfig, "tarpon", { benefits: [] });
  const invalidSponsorStripe = updateSponsorPackageConfig(sponsorConfig, "tarpon", { stripePriceId: "price_replace_me" });
  const lastSponsorTierDisabled = updateSponsorPackageConfig({ sponsorPackages: [sponsorConfig.sponsorPackages[0]] }, "tarpon", { active: false });
  const updatedSponsorPackage = updateSponsorPackageConfig(sponsorConfig, "tarpon", { amount: 550000, stripePriceId: "price_tarpon_2027", quickBooksItemId: "88" });
  const createdSponsorPackage = createSponsorPackageConfig(sponsorConfig, {
    id: "community-partner",
    name: "Community Partner",
    amount: 750000,
    benefits: ["Festival website", "Community stage recognition"]
  });
  const duplicateSponsorPackage = createSponsorPackageConfig(createdSponsorPackage.config, {
    id: "community-partner",
    name: "Duplicate Community Partner",
    amount: 800000,
    benefits: ["Duplicate benefit"]
  });
  const publicSponsorTier = publicSponsorPackage(updatedSponsorPackage.sponsorPackage);
  const checkedInAdminConfig = await readJson("data/config/admin-config.json");
  const defaultSponsorAmounts = Object.fromEntries(DEFAULT_SPONSOR_PACKAGES.map(item => [item.id, item.amount]));
  ok("sponsor package catalog authority", defaultSponsorCatalog.ready && defaultSponsorCatalog.activePackages.length === 2 && resolvedSponsorPackage.ok && resolvedSponsorPackage.sponsorPackage.amount === 500000);
  ok("current sponsorship program is complete and price-anchored", DEFAULT_SPONSOR_PACKAGES.length === 11 && defaultSponsorAmounts.flounder === 125000 && defaultSponsorAmounts.marlin === 1500000 && defaultSponsorAmounts.whale === 5000000 && defaultSponsorAmounts["the-kraken"] === 25000000);
  ok("checked-in sponsor config matches the public fallback catalog", JSON.stringify(checkedInAdminConfig.sponsorPackages) === JSON.stringify(DEFAULT_SPONSOR_PACKAGES));
  ok("sponsor package catalog rejects unsafe pricing and fulfillment", !invalidSponsorAmount.ok && invalidSponsorAmount.error.includes("amount") && !invalidSponsorBenefits.ok && invalidSponsorBenefits.error.includes("benefit") && !invalidSponsorStripe.ok && invalidSponsorStripe.error.includes("Stripe Price ID"));
  ok("sponsor package catalog keeps one public tier active", !lastSponsorTierDisabled.ok && lastSponsorTierDisabled.error.includes("At least one active"));
  ok("sponsor package creation validates and rejects duplicate IDs", createdSponsorPackage.ok && createdSponsorPackage.sponsorPackage.publicLabel === "$7,500 sponsorship" && !duplicateSponsorPackage.ok && duplicateSponsorPackage.conflict === true);
  ok("public sponsor package hides accounting mappings", updatedSponsorPackage.ok && publicSponsorTier.amount === 550000 && !Object.hasOwn(publicSponsorTier, "quickBooksItemId") && !Object.hasOwn(publicSponsorTier, "stripePriceId"));
  const defaultVendorCatalog = vendorOfferingCatalog({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS });
  const artisanOffering = resolveVendorOffering({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, "marketplace-booth", "artisan");
  const categoryMismatch = resolveVendorOffering({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, "food-beverage-booth", "artisan");
  const unsafeCatalogChange = updateVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, "food-beverage-booth", { active: false });
  const publicOffering = publicVendorOffering(DEFAULT_VENDOR_OFFERINGS[0]);
  const createdVendorOffering = createVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, {
    id: "premium-marketplace-booth",
    name: "Premium marketplace booth",
    amount: 250000,
    categories: ["retail", "artisan"],
    description: "Expanded marketplace booth for larger retail and artisan activations.",
    inclusions: ["Expanded booth footprint", "Published booth listing"]
  });
  const duplicateVendorOffering = createVendorOfferingConfig(createdVendorOffering.config, {
    id: "premium-marketplace-booth",
    name: "Duplicate premium booth",
    amount: 260000,
    categories: ["retail"],
    description: "Duplicate offering.",
    inclusions: ["Duplicate inclusion"]
  });
  const invalidVendorCents = createVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, {
    id: "fractional-fee",
    name: "Fractional fee",
    amount: 100.5,
    categories: ["service"],
    description: "Invalid fractional cent fee.",
    inclusions: ["Service booth"]
  });
  const invalidVendorProvider = createVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, {
    id: "placeholder-provider",
    name: "Placeholder provider",
    amount: 10000,
    categories: ["service"],
    description: "Invalid provider mapping.",
    inclusions: ["Service booth"],
    stripePriceId: "price_replace_me"
  });
  const invalidVendorState = createVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, {
    id: "invalid-active-state",
    name: "Invalid active state",
    amount: 10000,
    categories: ["service"],
    description: "Invalid active state.",
    inclusions: ["Service booth"],
    active: "false"
  });
  const invalidVendorInclusions = createVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, {
    id: "missing-inclusions",
    name: "Missing inclusions",
    amount: 10000,
    categories: ["service"],
    description: "Missing public inclusions.",
    inclusions: []
  });
  ok("vendor offering catalog coverage", defaultVendorCatalog.ready && defaultVendorCatalog.activeOfferings.length === 3 && defaultVendorCatalog.missingCategories.length === 0);
  ok("production vendor intake is interest-only until applications open", DEFAULT_VENDOR_OFFERINGS.every(item => item.intakeMode === "interest" && item.amount === 0) && JSON.stringify(checkedInAdminConfig.vendorOfferings) === JSON.stringify(DEFAULT_VENDOR_OFFERINGS));
  ok("vendor offering category authority", artisanOffering.ok && artisanOffering.offering.amount === 0 && artisanOffering.offering.intakeMode === "interest" && !categoryMismatch.ok && categoryMismatch.error.includes("not available"));
  ok("vendor offering catalog cannot strand a category", !unsafeCatalogChange.ok && unsafeCatalogChange.error.includes("food"));
  ok("vendor offering creation validates and rejects duplicate IDs", createdVendorOffering.ok && createdVendorOffering.offering.publicLabel === "$2,500 application fee" && !duplicateVendorOffering.ok && duplicateVendorOffering.conflict === true);
  ok("vendor offering pricing and provider mappings fail closed", !invalidVendorCents.ok && invalidVendorCents.error.includes("whole cents") && !invalidVendorProvider.ok && invalidVendorProvider.error.includes("Stripe Price ID"));
  ok("vendor offering state and inclusions fail closed", !invalidVendorState.ok && invalidVendorState.error.includes("active state") && !invalidVendorInclusions.ok && invalidVendorInclusions.error.includes("inclusion"));
  const invalidPricedInterest = updateVendorOfferingConfig({ vendorOfferings: DEFAULT_VENDOR_OFFERINGS }, "marketplace-booth", { amount: 100, intakeMode: "interest" });
  ok("vendor interest cannot create a financial obligation", !invalidPricedInterest.ok && invalidPricedInterest.error.includes("cannot create a financial obligation"));
  ok("public vendor offering exposes intake mode but hides accounting mappings", publicOffering.intakeMode === "interest" && !Object.hasOwn(publicOffering, "quickBooksItemId") && !Object.hasOwn(publicOffering, "stripePriceId"));
  const vendorInterestNotice = partnerContactNotice("vendor", "interest");
  const vendorInterest = createPartnerApplication(emptyPartnerOperations(), {
    type: "vendor",
    intakeMode: "interest",
    organizationName: "Island Interest Co",
    contactName: "Morgan Lee",
    contactEmail: "morgan@island-interest.example",
    category: "service",
    offeringId: "marketplace-booth",
    offeringName: "Non-food vendor interest",
    expectedAmountCents: 0,
    consentToContact: true,
    consentNoticeVersion: vendorInterestNotice.version,
    consentCapturedAt: now
  }, { idFactory, portalAccessIdFactory: () => "vendor_interest_portal_1", now });
  const vendorInterestDraft = prepareFollowupDraft(vendorInterest.doc, vendorInterest.followup.id, { now, portalUrl: "https://www.texassandfest.org/#partner-status" });
  const vendorInterestReadiness = summarizeVendorReadiness(vendorInterest.doc, now);
  const vendorInterestPortal = publicPartnerPortalStatus(vendorInterest.doc, vendorInterest.application, { now });
  const pricedVendorInterest = createPartnerApplication(emptyPartnerOperations(), {
    ...vendorInterest.application,
    id: undefined,
    reference: undefined,
    portalAccessId: undefined,
    expectedAmountCents: 100
  }, { idFactory, now });
  const repricedVendorInterest = updatePartnerApplication(vendorInterest.doc, vendorInterest.application.id, { expectedAmountCents: 100 }, { idFactory, now });
  const invoicedVendorInterest = createPartnerInvoice(vendorInterest.doc, vendorInterest.application.id, {}, { idFactory, now });
  const paidVendorInterest = recordPartnerPayment(vendorInterest.doc, vendorInterest.application.id, { amountCents: 100, method: "check", externalRef: "INTEREST-CHECK-1" }, { idFactory, now });
  ok("vendor interest stores versioned contact consent", vendorInterest.ok && vendorInterest.application.intakeMode === "interest" && vendorInterest.application.consentNoticeVersion === vendorInterestNotice.version && vendorInterest.application.consentCapturedAt === now);
  ok("vendor interest seeds review without application obligations", vendorInterest.milestones.length === 1 && vendorInterest.milestones[0].kind === "interest_review" && vendorInterest.task.title.includes("vendor interest") && vendorInterest.vendorProfile === null && vendorInterest.vendorRequirements.length === 0 && vendorInterest.vendorAssignment === null);
  ok("vendor interest acknowledgment and portal stay non-financial", vendorInterestDraft.followup.subject.includes("vendor interest") && !vendorInterestDraft.followup.subject.includes("application") && vendorInterestDraft.followup.body.includes("fees and availability will be confirmed") && vendorInterestPortal.intakeMode === "interest" && vendorInterestPortal.finance.paymentStatus === "not_applicable" && vendorInterestPortal.vendorOnboarding === null);
  ok("vendor interest is excluded from booth readiness", vendorInterestReadiness.totals.interests === 1 && vendorInterestReadiness.totals.vendors === 0 && vendorInterestReadiness.totals.blocked === 0);
  ok("vendor interest rejects pricing, invoicing, and payments", !pricedVendorInterest.ok && !repricedVendorInterest.ok && !invoicedVendorInterest.ok && !paidVendorInterest.ok && [pricedVendorInterest, repricedVendorInterest, invoicedVendorInterest, paidVendorInterest].every(item => item.error.includes("Vendor interest")));
  const vendorOpeningUrl = "https://www.texassandfest.org/?vendorOffering=marketplace-booth&vendorCategory=service#vendor-application-form";
  const applicationUrlForInterest = () => vendorOpeningUrl;
  const vendorOpening = generateVendorApplicationOpeningFollowups(vendorInterest.doc, BOARD_DEMO_VENDOR_OFFERINGS, {
    applicationUrlForInterest,
    idFactory,
    now
  });
  const vendorOpeningAgain = generateVendorApplicationOpeningFollowups(vendorOpening.doc, BOARD_DEMO_VENDOR_OFFERINGS, {
    applicationUrlForInterest,
    idFactory,
    now
  });
  const openingNotice = vendorOpening.generated[0];
  const openingAutomationEnabled = setPartnerAutomationMode(vendorOpening.doc, "transactional_auto", {
    providerReady: true,
    actorId: "admin_1",
    idFactory,
    now
  });
  const automatedOpening = applyTransactionalFollowupAutomation(openingAutomationEnabled.doc, {
    providerReady: true,
    vendorOfferings: BOARD_DEMO_VENDOR_OFFERINGS,
    applicationUrlForInterest,
    idFactory,
    now
  });
  const changedOpeningRecipientDoc = {
    ...automatedOpening.doc,
    applications: automatedOpening.doc.applications.map(item => item.id === vendorInterest.application.id
      ? { ...item, contactEmail: "new-contact@island-interest.example" }
      : item)
  };
  const changedOpeningRecipient = queueFollowupDelivery(changedOpeningRecipientDoc, openingNotice.id, {
    vendorOfferings: BOARD_DEMO_VENDOR_OFFERINGS,
    applicationUrlForInterest,
    now
  });
  const changedOpeningUrl = queueFollowupDelivery(automatedOpening.doc, openingNotice.id, {
    vendorOfferings: BOARD_DEMO_VENDOR_OFFERINGS,
    applicationUrlForInterest: () => "https://vendors.texassandfest.org/#vendor-application-form",
    now
  });
  const closedOpeningReview = reviewFollowup(vendorOpening.doc, openingNotice.id, "approve", {
    vendorOfferings: DEFAULT_VENDOR_OFFERINGS,
    applicationUrlForInterest,
    actorId: "admin_1",
    now
  });
  const repricedOfferings = BOARD_DEMO_VENDOR_OFFERINGS.map(item => item.id === "marketplace-booth"
    ? { ...item, amount: item.amount + 10000, publicLabel: "$1,350 application fee" }
    : item);
  const repricedOpening = generateVendorApplicationOpeningFollowups(vendorOpening.doc, repricedOfferings, {
    applicationUrlForInterest,
    idFactory,
    now: "2026-07-16T13:00:00.000Z"
  });
  const sentOpeningDoc = {
    ...vendorOpening.doc,
    followups: vendorOpening.doc.followups.map(item => item.id === openingNotice.id ? { ...item, status: "sent", sentAt: now } : item)
  };
  const openingAfterSentTermsChange = generateVendorApplicationOpeningFollowups(sentOpeningDoc, repricedOfferings, {
    applicationUrlForInterest,
    idFactory,
    now: "2026-07-16T13:00:00.000Z"
  });
  const categoryClosedOfferings = BOARD_DEMO_VENDOR_OFFERINGS.map(item => item.id === "marketplace-booth"
    ? { ...item, categories: ["retail", "artisan"] }
    : item);
  const categoryClosedOpening = generateVendorApplicationOpeningFollowups(vendorOpening.doc, categoryClosedOfferings, {
    applicationUrlForInterest,
    idFactory,
    now: "2026-07-16T13:00:00.000Z"
  });
  ok("vendor opening notice is explicit and privacy-minimized", vendorOpening.generated.length === 1
    && openingNotice.status === "draft_ready"
    && openingNotice.body.includes("has not been converted into an application")
    && openingNotice.body.includes("submit a new application")
    && openingNotice.body.includes("$1,250 application fee")
    && openingNotice.applicationUrl === vendorOpeningUrl
    && !openingNotice.applicationUrl.includes(vendorInterest.application.contactEmail)
    && !openingNotice.applicationUrl.includes(vendorInterest.application.reference)
    && !JSON.stringify(vendorOpening.doc.activity.at(-1)).includes(vendorInterest.application.contactEmail));
  ok("vendor opening notice generation is idempotent", !vendorOpeningAgain.changed && vendorOpeningAgain.generated.length === 0);
  ok("vendor opening notice participates in transactional automation", openingAutomationEnabled.ok
    && automatedOpening.approved.length === 1
    && automatedOpening.approved[0].id === openingNotice.id
    && automatedOpening.approved[0].automationPolicy === PARTNER_TRANSACTIONAL_AUTOMATION_POLICY);
  ok("vendor opening notice revalidates catalog and recipient before queue", !closedOpeningReview.ok
    && closedOpeningReview.error.includes("no longer open")
    && !changedOpeningRecipient.ok
    && changedOpeningRecipient.error.includes("no longer matches")
    && !changedOpeningUrl.ok
    && changedOpeningUrl.error.includes("link changed"));
  ok("vendor opening changes replace only unsent notice versions", repricedOpening.generated.length === 1
    && repricedOpening.dismissedFollowups === 1
    && repricedOpening.doc.followups.find(item => item.id === openingNotice.id)?.status === "dismissed"
    && openingAfterSentTermsChange.generated.length === 1
    && openingAfterSentTermsChange.doc.followups.find(item => item.id === openingNotice.id)?.status === "sent");
  ok("vendor opening category removal dismisses without retargeting", categoryClosedOpening.generated.length === 0
    && categoryClosedOpening.dismissedFollowups === 1
    && categoryClosedOpening.doc.followups.find(item => item.id === openingNotice.id)?.status === "dismissed");
  const vendorCreated = createPartnerApplication(emptyPartnerOperations(), {
    type: "vendor",
    organizationName: "Coastal Tacos",
    contactName: "Taylor Morgan",
    contactEmail: "taylor@coastaltacos.example",
    contactPhone: "361-555-0199",
    website: "https://coastaltacos.example",
    category: "food",
    offeringId: "food-beverage-booth",
    offeringName: "Food and beverage booth",
    expectedAmountCents: 175000,
    description: "Fresh tacos and nonalcoholic drinks.",
    consentToContact: true
  }, { idFactory, portalAccessIdFactory: () => "vendor_portal_access_1", now });
  ok("vendor compliance checklist seeded", vendorCreated.ok && vendorCreated.application.offeringId === "food-beverage-booth" && vendorCreated.application.expectedAmountCents === 175000 && vendorCreated.vendorRequirements.length === 7 && vendorCreated.vendorRequirements.some(item => item.code === "health_permit") && vendorCreated.vendorAssignment.status === "unassigned");
  const vendorAcknowledgment = prepareFollowupDraft(vendorCreated.doc, vendorCreated.followup.id, { now });
  ok("vendor acknowledgment includes selected offering", vendorAcknowledgment.ok && vendorAcknowledgment.followup.body.includes("Food and beverage booth") && vendorAcknowledgment.followup.body.includes("$1,750.00"));
  const vendorPortalToken = issuePartnerPortalToken(vendorCreated.application, { config: portalConfig });
  const vendorPortalUrl = `https://www.texassandfest.org${partnerPortalPath(vendorCreated.application, vendorPortalToken)}`;
  const vendorProfileInput = {
    legalName: "Coastal Tacos LLC",
    boothName: "Coastal Tacos",
    website: "https://coastaltacos.example/",
    publicDescription: "Fresh Gulf-inspired tacos and cold drinks.",
    emergencyContactName: "Taylor Morgan",
    emergencyContactPhone: "361-555-0199",
    powerNeed: "30a",
    waterRequired: true,
    cookingMethod: "propane",
    vehicleLengthFeet: 24,
    operationalNotes: "One refrigerated trailer."
  };
  const vendorProfile = updateVendorProfile(vendorCreated.doc, vendorCreated.application.id, vendorProfileInput, { actorId: `partner:${vendorCreated.application.id}`, idFactory, now });
  ok("vendor operational profile", vendorProfile.ok && vendorProfile.profile.status === "submitted" && vendorProfile.profile.waterRequired && vendorProfile.profile.vehicleLengthFeet === 24);
  const profileChanges = reviewVendorProfile(vendorProfile.doc, vendorCreated.application.id, { action: "request_changes", reviewNotes: "Clarify the refrigerated trailer footprint." }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  const duplicateProfileChanges = reviewVendorProfile(profileChanges.doc, vendorCreated.application.id, { action: "request_changes", reviewNotes: "Clarify the refrigerated trailer footprint." }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  ok("vendor profile change draft", profileChanges.ok && profileChanges.followupChanged && profileChanges.followup.status === "draft_ready" && profileChanges.followup.kind === "vendor_profile_changes" && profileChanges.followup.body.includes(vendorPortalUrl));
  ok("vendor profile draft idempotency", duplicateProfileChanges.ok && !duplicateProfileChanges.followupChanged && duplicateProfileChanges.doc.followups.filter(item => item.kind === "vendor_profile_changes").length === 1);
  const approvedProfileChanges = reviewFollowup(profileChanges.doc, profileChanges.followup.id, "approve", { actorId: "vendor_admin_1", now });
  const queuedProfileChanges = queueFollowupDelivery(approvedProfileChanges.doc, profileChanges.followup.id, { now });
  const claimedProfileChanges = claimFollowupDelivery(queuedProfileChanges.doc, profileChanges.followup.id, { deliveryClaimId: "job_vendor_workflow", now });
  const replacedBeforeVendorHandoff = reviewVendorProfile(claimedProfileChanges.doc, vendorCreated.application.id, { action: "request_changes", reviewNotes: "Confirm the trailer tongue is included in the footprint." }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  const begunProfileChanges = beginFollowupProviderSubmission(claimedProfileChanges.doc, profileChanges.followup.id, { deliveryClaimId: "job_vendor_workflow", now });
  const replacedAfterVendorHandoff = reviewVendorProfile(begunProfileChanges.doc, vendorCreated.application.id, { action: "request_changes", reviewNotes: "Confirm the trailer tongue and service clearance." }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  const completedVendorHandoff = recordFollowupDelivery(replacedAfterVendorHandoff.doc, profileChanges.followup.id, { sent: true, provider: "brevo", providerMessageId: "msg_vendor_workflow" }, { deliveryClaimId: "job_vendor_workflow", now });
  const preHandoffReplacement = replacedBeforeVendorHandoff.doc.followups.find(item => item.workflowKey === profileChanges.followup.workflowKey && item.id !== profileChanges.followup.id);
  const blockedVendorReplacement = replacedAfterVendorHandoff.doc.followups.find(item => item.workflowKey === profileChanges.followup.workflowKey && item.id !== profileChanges.followup.id);
  const releasedVendorReplacement = completedVendorHandoff.doc.followups.find(item => item.id === blockedVendorReplacement?.id);
  ok("vendor workflow change cancels an unstarted handoff", replacedBeforeVendorHandoff.followupChanged && replacedBeforeVendorHandoff.doc.followups.find(item => item.id === profileChanges.followup.id)?.status === "dismissed" && preHandoffReplacement?.status === "draft_ready");
  ok("vendor workflow serializes replacement behind provider handoff", replacedAfterVendorHandoff.followupChanged && replacedAfterVendorHandoff.doc.followups.find(item => item.id === profileChanges.followup.id)?.status === "sending" && blockedVendorReplacement?.status === "pending" && blockedVendorReplacement?.blockedByFollowupId === profileChanges.followup.id && completedVendorHandoff.ok && releasedVendorReplacement?.status === "draft_ready" && releasedVendorReplacement?.blockedByFollowupId === null);
  const revisedVendorProfile = updateVendorProfile(profileChanges.doc, vendorCreated.application.id, { ...vendorProfileInput, operationalNotes: "One refrigerated trailer with a 24-foot total footprint." }, { actorId: `partner:${vendorCreated.application.id}`, idFactory, now });
  ok("vendor profile submission dismisses stale draft", revisedVendorProfile.dismissedFollowups === 1 && revisedVendorProfile.doc.followups.find(item => item.kind === "vendor_profile_changes").status === "dismissed");
  const approvedVendorProfile = reviewVendorProfile(revisedVendorProfile.doc, vendorCreated.application.id, { action: "approve" }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  ok("vendor profile review", approvedVendorProfile.ok && approvedVendorProfile.profile.status === "approved");
  const agreementRequirement = approvedVendorProfile.doc.vendorRequirements.find(item => item.code === "vendor_agreement");
  const firstVendorDocument = createVendorDocument(approvedVendorProfile.doc, vendorCreated.application.id, agreementRequirement.id, {
    label: "Signed agreement v1",
    sourceUrl: "https://files.coastaltacos.example/agreement-v1.pdf"
  }, { actorId: `partner:${vendorCreated.application.id}`, idFactory, now });
  const replacementVendorDocument = createVendorDocument(firstVendorDocument.doc, vendorCreated.application.id, agreementRequirement.id, {
    label: "Signed agreement v2",
    sourceUrl: "https://files.coastaltacos.example/agreement-v2.pdf"
  }, { actorId: `partner:${vendorCreated.application.id}`, idFactory, now });
  ok("vendor document replacement", replacementVendorDocument.ok && replacementVendorDocument.doc.vendorDocuments.length === 2 && replacementVendorDocument.doc.vendorDocuments[0].status === "superseded" && replacementVendorDocument.requirement.currentDocumentId === replacementVendorDocument.document.id);
  const agreementChanges = reviewVendorRequirement(replacementVendorDocument.doc, agreementRequirement.id, { status: "changes_requested", reviewNotes: "Add the legal signer title." }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  ok("vendor requirement change draft", agreementChanges.ok && agreementChanges.followupChanged && agreementChanges.followup.kind === "vendor_requirement_changes" && agreementChanges.followup.body.includes("legal signer title"));
  const finalVendorDocument = createVendorDocument(agreementChanges.doc, vendorCreated.application.id, agreementRequirement.id, {
    label: "Signed agreement final",
    sourceUrl: "https://files.coastaltacos.example/agreement-final.pdf"
  }, { actorId: `partner:${vendorCreated.application.id}`, idFactory, now });
  ok("vendor evidence dismisses stale draft", finalVendorDocument.dismissedFollowups === 1 && finalVendorDocument.doc.followups.find(item => item.kind === "vendor_requirement_changes").status === "dismissed");
  const approvedAgreement = reviewVendorRequirement(finalVendorDocument.doc, agreementRequirement.id, { status: "approved", expiresAt: "2027-07-16T12:00:00.000Z" }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  ok("vendor requirement approval", approvedAgreement.ok && approvedAgreement.requirement.status === "approved" && approvedAgreement.doc.vendorDocuments.at(-1).status === "approved");
  const missingRequirement = approvedAgreement.doc.vendorRequirements.find(item => item.code === "w9");
  const invalidRequirementApproval = reviewVendorRequirement(approvedAgreement.doc, missingRequirement.id, { status: "approved" }, { actorId: "vendor_admin_1", idFactory, now });
  ok("vendor requirement evidence gate", !invalidRequirementApproval.ok && invalidRequirementApproval.error.includes("document"));
  let vendorReadyDoc = approvedAgreement.doc;
  for (const requirement of vendorReadyDoc.vendorRequirements.filter(item => item.status === "missing")) {
    const waived = reviewVendorRequirement(vendorReadyDoc, requirement.id, { status: "waived", reviewNotes: "Pure-suite readiness waiver." }, { actorId: "vendor_admin_1", idFactory, now });
    vendorReadyDoc = waived.doc;
  }
  const scheduledVendor = updateVendorAssignment(vendorReadyDoc, vendorCreated.application.id, {
    status: "scheduled",
    boothNumber: "F-12",
    zone: "Food court south",
    accessGate: "South service gate",
    loadInStart: "2026-08-14T12:00:00.000Z",
    loadInEnd: "2026-08-14T13:00:00.000Z",
    loadOutStart: "2026-08-17T02:00:00.000Z",
    loadOutEnd: "2026-08-17T03:00:00.000Z",
    parkingPasses: 2,
    staffWristbands: 4,
    instructions: "Check in with the food court captain before driving onto the beach."
  }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  const confirmedVendor = confirmVendorAssignment(scheduledVendor.doc, vendorCreated.application.id, { actorId: `partner:${vendorCreated.application.id}`, idFactory, now });
  const vendorReadiness = summarizeVendorReadiness(confirmedVendor.doc, now);
  ok("vendor assignment change draft", scheduledVendor.followupChanged && scheduledVendor.followup.kind === "vendor_assignment_ready" && scheduledVendor.followup.body.includes("South service gate"));
  ok("vendor assignment confirmation", scheduledVendor.ok && confirmedVendor.ok && confirmedVendor.assignment.status === "confirmed" && confirmedVendor.assignment.partnerConfirmedAt === now && confirmedVendor.dismissedFollowups === 1);
  ok("vendor readiness evidence", vendorReadiness.totals.ready === 1 && vendorReadiness.vendors[0].compliance.approved === 7 && vendorReadiness.vendors[0].boothNumber === "F-12");
  const vendorPublic = publicPartnerPortalStatus(confirmedVendor.doc, vendorCreated.application).vendorOnboarding;
  ok("partner portal vendor onboarding", vendorPublic.profile.status === "approved" && vendorPublic.requirements.length === 7 && vendorPublic.assignment.status === "confirmed");
  const vendorPublicDocument = vendorPublic.requirements.find(item => item.document)?.document;
  ok("partner portal vendor document privacy", vendorPublicDocument && !("storageKey" in vendorPublicDocument) && !("checksumSha256" in vendorPublicDocument) && !("reviewedBy" in vendorPublic.requirements[0]));
  const rescheduledVendor = updateVendorAssignment(confirmedVendor.doc, vendorCreated.application.id, { status: "confirmed", boothNumber: "F-13" }, { actorId: "vendor_admin_1", idFactory, portalUrl: vendorPortalUrl, now });
  ok("vendor reschedule resets confirmation", rescheduledVendor.ok && rescheduledVendor.assignment.status === "scheduled" && rescheduledVendor.assignment.partnerConfirmedAt === null && rescheduledVendor.followupChanged && rescheduledVendor.followup.sourceVersion === "schedule:2");
  const task = createPartnerTask(paid.doc, {
    title: "Collect sponsor logo",
    description: "Confirm print-ready art and usage approval.",
    assigneeType: "volunteer",
    assigneeId: "vol_001",
    assigneeName: "Alex Rivera",
    assigneeRole: "gate",
    priority: "urgent",
    dueAt: "2026-07-16T11:00:00.000Z"
  }, { actorId: "ops_1", idFactory, now: "2026-07-14T12:00:00.000Z" });
  ok("delegated volunteer task", task.ok && task.task.assigneeType === "volunteer" && task.task.assigneeName === "Alex Rivera" && task.task.createdBy === "ops_1" && task.task.assignmentVersion === 1 && task.task.scheduleVersion === 1);
  const taskPortal = taskPortalConfig({
    SANDFEST_ENV: "production",
    SANDFEST_TASK_PORTAL_SECRET: "0123456789abcdef0123456789abcdef-task",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org"
  });
  const taskPortalToken = issueTaskPortalToken(task.task, { config: taskPortal });
  const taskPortalUrl = taskPortalUrlForTask(task.task, { config: taskPortal });
  const taskPortalAccess = findTaskPortalTask(task.doc, task.task.id, taskPortalToken, { config: taskPortal });
  const privateTaskStatus = publicTaskPortalStatus(task.task);
  ok("task portal production capability", taskPortal.ready && taskPortalToken?.startsWith("tsft_") && verifyTaskPortalToken(task.task, taskPortalToken, { config: taskPortal }) && taskPortalAccess.ok && taskPortalPath(task.task, taskPortalToken).startsWith("/#task-status?") && taskPortalUrl.includes("#task-status?task="));
  ok("task portal projection is assignment-safe", privateTaskStatus.assignee.name === "Alex Rivera" && privateTaskStatus.allowedActions.includes("acknowledge") && !("assigneeId" in privateTaskStatus.assignee) && !("assignmentVersion" in privateTaskStatus) && !JSON.stringify(privateTaskStatus).includes(taskPortalToken));
  const taskVolunteers = [{ id: "vol_001", name: "Alex Rivera", email: "alex@example.com", status: "confirmed" }];
  const assignmentNotice = generateDueTaskFollowups(task.doc, { idFactory, volunteers: taskVolunteers, taskPortalUrlForTask: assignedTask => taskPortalUrlForTask(assignedTask, { config: taskPortal }), now: "2026-07-14T12:00:00.000Z" });
  const assignmentNoticeAgain = generateDueTaskFollowups(assignmentNotice.doc, { idFactory, volunteers: taskVolunteers, now: "2026-07-14T12:05:00.000Z" });
  const staleAssignmentReview = reviewFollowup(assignmentNotice.doc, assignmentNotice.generated[0].id, "approve", {
    actorId: "ops_1",
    volunteers: [{ ...taskVolunteers[0], email: "changed@example.com" }],
    now: "2026-07-14T12:10:00.000Z"
  });
  const approvedAssignmentNotice = reviewFollowup(assignmentNotice.doc, assignmentNotice.generated[0].id, "approve", { actorId: "ops_1", volunteers: taskVolunteers, now: "2026-07-14T12:10:00.000Z" });
  const queuedAssignmentNotice = queueFollowupDelivery(approvedAssignmentNotice.doc, assignmentNotice.generated[0].id, { volunteers: taskVolunteers, now: "2026-07-14T12:15:00.000Z" });
  const sentAssignmentNotice = recordFollowupDelivery(queuedAssignmentNotice.doc, assignmentNotice.generated[0].id, { sent: true, provider: "brevo", providerMessageId: "task-assignment-1" }, { now: "2026-07-14T12:16:00.000Z" });
  ok("volunteer assignment notification is retry safe", assignmentNotice.generated.length === 1 && assignmentNotice.generated[0].kind === "task_assignment" && assignmentNotice.generated[0].recipient === "alex@example.com" && assignmentNotice.generated[0].body.includes(taskPortalUrl) && assignmentNoticeAgain.generated.length === 0);
  ok("volunteer notification revalidates directory email", !staleAssignmentReview.ok && staleAssignmentReview.error.includes("email changed") && approvedAssignmentNotice.ok && sentAssignmentNotice.followup.status === "sent");
  const requestedAssignmentResend = requestTaskAssignmentNotice(sentAssignmentNotice.doc, task.task.id, {
    actorId: "ops_1",
    requestId: "notice-request-0001",
    volunteers: taskVolunteers,
    idFactory,
    now: "2026-07-14T12:17:00.000Z"
  });
  const replayedAssignmentResend = requestTaskAssignmentNotice(requestedAssignmentResend.doc, task.task.id, {
    actorId: "ops_1",
    requestId: "notice-request-0001",
    volunteers: taskVolunteers,
    idFactory,
    now: "2026-07-14T12:18:00.000Z"
  });
  const resentAssignmentNotice = generateDueTaskFollowups(requestedAssignmentResend.doc, {
    idFactory,
    volunteers: taskVolunteers,
    taskPortalUrlForTask: assignedTask => taskPortalUrlForTask(assignedTask, { config: taskPortal }),
    now: "2026-07-14T12:17:00.000Z"
  });
  const approvedResentAssignmentNotice = reviewFollowup(resentAssignmentNotice.doc, resentAssignmentNotice.generated[0].id, "approve", {
    actorId: "ops_1",
    volunteers: taskVolunteers,
    now: "2026-07-14T12:18:00.000Z"
  });
  const duplicatePendingResend = requestTaskAssignmentNotice(resentAssignmentNotice.doc, task.task.id, {
    actorId: "ops_1",
    requestId: "notice-request-0002",
    volunteers: taskVolunteers,
    idFactory,
    now: "2026-07-14T12:19:00.000Z"
  });
  ok("staff can reissue the current secure task notice", requestedAssignmentResend.ok && requestedAssignmentResend.task.assignmentNoticeVersion === 1 && resentAssignmentNotice.generated.length === 1 && resentAssignmentNotice.generated[0].sourceVersion === "assignment:1:notice:1" && resentAssignmentNotice.generated[0].body.includes(taskPortalUrl) && approvedResentAssignmentNotice.ok);
  ok("task notice resend requests are idempotent and suppress active duplicates", replayedAssignmentResend.replay === true && replayedAssignmentResend.task.assignmentNoticeVersion === 1 && !duplicatePendingResend.ok && duplicatePendingResend.conflict === true);
  const visibleTaskNoticeSummary = summarizeTaskNotifications(task.task, [
    {
      taskId: task.task.id,
      kind: "task_assignment",
      sourceVersion: "assignment:0",
      status: "sent",
      deliveryStatus: "delivered",
      recipient: "revoked-assignee@example.com",
      updatedAt: "2026-07-14T12:30:00.000Z"
    },
    {
      taskId: task.task.id,
      kind: "task_assignment",
      sourceVersion: "assignment:1",
      status: "sent",
      deliveryStatus: "delivered",
      deliveredAt: "2026-07-14T12:16:00.000Z",
      updatedAt: "2026-07-14T12:16:00.000Z"
    },
    {
      taskId: task.task.id,
      kind: "task_assignment",
      sourceVersion: "assignment:1:notice:1",
      status: "failed",
      updatedAt: "2026-07-14T12:20:00.000Z"
    },
    {
      taskId: task.task.id,
      kind: "task_overdue",
      status: "sent",
      deliveryStatus: "delivered",
      deliveredAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z"
    }
  ]);
  const visibleTaskNoticeAction = taskAssignmentNoticeAction(task.task, "volunteer", visibleTaskNoticeSummary);
  const unassignedTaskNoticeSummary = summarizeTaskNotifications({ ...task.task, assigneeType: "unassigned", assigneeId: null }, []);
  ok("task notice history summarizes only the current assignment", visibleTaskNoticeSummary.count === 2
    && visibleTaskNoticeSummary.latestStatus === "failed"
    && visibleTaskNoticeSummary.assignmentLabel.includes("2 issued · latest failed")
    && visibleTaskNoticeSummary.followupLabel.includes("task overdue · delivered")
    && visibleTaskNoticeAction.label === "Resend notice"
    && unassignedTaskNoticeSummary.assignmentLabel === "Assignment notices · not configured"
    && !JSON.stringify(visibleTaskNoticeSummary).includes("revoked-assignee@example.com"));
  const acknowledgedTask = updatePartnerTaskFromAssignee(task.doc, task.task.id, { action: "acknowledge", note: "I have the art checklist." }, { idFactory, now: "2026-07-14T12:20:00.000Z" });
  const acknowledgedReplay = updatePartnerTaskFromAssignee(acknowledgedTask.doc, task.task.id, { action: "acknowledge" }, { idFactory, now: "2026-07-14T12:21:00.000Z" });
  const startedByAssignee = updatePartnerTaskFromAssignee(acknowledgedTask.doc, task.task.id, { action: "start" }, { idFactory, now: "2026-07-14T12:25:00.000Z" });
  const missingBlocker = updatePartnerTaskFromAssignee(startedByAssignee.doc, task.task.id, { action: "block" }, { idFactory, now: "2026-07-14T12:30:00.000Z" });
  const blockedByAssignee = updatePartnerTaskFromAssignee(startedByAssignee.doc, task.task.id, { action: "block", note: "Waiting for the vector logo." }, { idFactory, now: "2026-07-14T12:31:00.000Z" });
  const completedByAssignee = updatePartnerTaskFromAssignee(blockedByAssignee.doc, task.task.id, { action: "complete", note: "Print-ready art is approved." }, { idFactory, now: "2026-07-14T12:40:00.000Z" });
  const completionReplay = updatePartnerTaskFromAssignee(completedByAssignee.doc, task.task.id, { action: "complete" }, { idFactory, now: "2026-07-14T12:41:00.000Z" });
  const completedTaskStatus = publicTaskPortalStatus(completedByAssignee.task);
  ok("assignee task lifecycle is durable and idempotent", acknowledgedTask.task.acknowledgedAt === "2026-07-14T12:20:00.000Z" && acknowledgedReplay.replay && startedByAssignee.task.status === "in_progress" && !missingBlocker.ok && blockedByAssignee.task.status === "blocked" && completedByAssignee.task.status === "done" && completionReplay.replay && completedTaskStatus.allowedActions.length === 0 && completedTaskStatus.updates.length === 4);
  ok("assignee activity excludes private note text", completedByAssignee.doc.activity.at(-1).type === "task.assignee_updated" && completedByAssignee.doc.activity.at(-1).detail.noteProvided === true && !JSON.stringify(completedByAssignee.doc.activity.at(-1)).includes("Print-ready art"));
  const reassignedTask = updatePartnerTask(acknowledgedTask.doc, task.task.id, { assigneeType: "staff", assigneeId: "staff_operations", assigneeName: "Jamie Torres" }, { actorId: "ops_1", idFactory, now: "2026-07-14T12:45:00.000Z" });
  const staleTaskPortalAccess = findTaskPortalTask(reassignedTask.doc, task.task.id, taskPortalToken, { config: taskPortal });
  const reassignedTaskStatus = publicTaskPortalStatus(reassignedTask.task);
  ok("task reassignment revokes stale access and resets acknowledgement", !staleTaskPortalAccess.ok && reassignedTask.task.assignmentVersion === 2 && reassignedTask.task.assignmentNoticeVersion === 0 && reassignedTask.task.acknowledgedAt === null && reassignedTaskStatus.updates.length === 0);
  const overdueTaskNotice = generateDueTaskFollowups(sentAssignmentNotice.doc, { idFactory, volunteers: taskVolunteers, now });
  const overdueTaskNoticeAgain = generateDueTaskFollowups(overdueTaskNotice.doc, { idFactory, volunteers: taskVolunteers, now: "2026-07-23T12:00:00.000Z" });
  const inFlightOverdueTaskDoc = {
    ...overdueTaskNotice.doc,
    followups: overdueTaskNotice.doc.followups.map(item => item.kind === "task_overdue"
      ? { ...item, status: "sending", deliveryClaimId: "job_task_overdue", deliveryClaimedAt: now }
      : item)
  };
  const inFlightOverdueTaskAgain = generateDueTaskFollowups(inFlightOverdueTaskDoc, { idFactory, volunteers: taskVolunteers, now: "2026-07-23T12:00:00.000Z" });
  ok("overdue volunteer task escalates once per active notice", overdueTaskNotice.generated.length === 1 && overdueTaskNotice.generated[0].kind === "task_overdue" && overdueTaskNotice.generated[0].reminderPhase === "overdue_week_1" && overdueTaskNoticeAgain.generated.length === 0);
  ok("in-flight overdue task notice blocks overlapping escalation", inFlightOverdueTaskAgain.generated.length === 0);
  const blockedTask = updatePartnerTask(overdueTaskNotice.doc, task.task.id, {
    status: "blocked",
    assigneeType: "team",
    assigneeId: "sponsor",
    assigneeName: "Sponsor team",
    priority: "high"
  }, { actorId: "ops_1", idFactory, now });
  ok("delegated task blocked state", blockedTask.ok && blockedTask.task.blockedAt === now && blockedTask.task.assigneeType === "team" && blockedTask.task.priority === "high" && blockedTask.task.assignmentVersion === 2 && blockedTask.task.scheduleVersion === 2 && blockedTask.dismissedFollowups === 1 && blockedTask.doc.followups.find(item => item.kind === "task_overdue")?.status === "dismissed");
  const staffTaskRecipients = [
    { id: "sponsor", assigneeType: "team", name: "Morgan Ellis", email: "morgan.ellis@example.com", status: "active" },
    { id: "staff_operations", assigneeType: "staff", name: "Jamie Torres", email: "jamie.torres@example.com", status: "active" }
  ];
  const teamAssignmentNotice = generateDueTaskFollowups(blockedTask.doc, { idFactory, taskRecipients: staffTaskRecipients, now });
  const generatedTeamAssignment = teamAssignmentNotice.generated.find(item => item.taskId === task.task.id && item.kind === "task_assignment");
  const teamAssignmentApproved = reviewFollowup(teamAssignmentNotice.doc, generatedTeamAssignment?.id, "approve", { actorId: "ops_1", taskRecipients: staffTaskRecipients, now });
  const queuedTeamAssignment = queueFollowupDelivery(teamAssignmentApproved.doc, generatedTeamAssignment?.id, { taskRecipients: staffTaskRecipients, now });
  const claimedTeamAssignment = claimFollowupDelivery(queuedTeamAssignment.doc, generatedTeamAssignment?.id, { deliveryClaimId: "job_task_assignment", taskRecipients: staffTaskRecipients, now });
  const reassignedBeforeTaskHandoff = updatePartnerTask(claimedTeamAssignment.doc, task.task.id, {
    assigneeType: "staff",
    assigneeId: "staff_operations",
    assigneeName: "Jamie Torres"
  }, { actorId: "ops_1", idFactory, now });
  const begunTeamAssignment = beginFollowupProviderSubmission(claimedTeamAssignment.doc, generatedTeamAssignment?.id, { deliveryClaimId: "job_task_assignment", taskRecipients: staffTaskRecipients, now });
  const completedAfterTaskHandoff = updatePartnerTask(begunTeamAssignment.doc, task.task.id, { status: "done" }, { actorId: "ops_1", idFactory, now });
  ok("team task notification resolves accountable owner", generatedTeamAssignment?.recipient === "morgan.ellis@example.com" && teamAssignmentApproved.ok);
  ok("task reassignment cancels an unstarted notification handoff", reassignedBeforeTaskHandoff.ok && reassignedBeforeTaskHandoff.dismissedFollowups === 1 && reassignedBeforeTaskHandoff.doc.followups.find(item => item.id === generatedTeamAssignment?.id)?.status === "dismissed" && reassignedBeforeTaskHandoff.doc.followups.find(item => item.id === generatedTeamAssignment?.id)?.deliveryClaimId === null);
  ok("task completion preserves a started notification handoff", completedAfterTaskHandoff.ok && completedAfterTaskHandoff.dismissedFollowups === 0 && completedAfterTaskHandoff.doc.followups.find(item => item.id === generatedTeamAssignment?.id)?.status === "sending" && completedAfterTaskHandoff.doc.followups.find(item => item.id === generatedTeamAssignment?.id)?.providerSubmissionStartedAt === now);
  const staffTask = createPartnerTask(paid.doc, {
    title: "Confirm staff briefing",
    assigneeType: "staff",
    assigneeId: "staff_operations",
    assigneeName: "Jamie Torres",
    priority: "high",
    dueAt: "2026-07-18T12:00:00.000Z"
  }, { actorId: "ops_1", idFactory, now });
  const staffAssignmentNotice = generateDueTaskFollowups(staffTask.doc, { idFactory, taskRecipients: staffTaskRecipients, now });
  const generatedStaffAssignment = staffAssignmentNotice.generated.find(item => item.taskId === staffTask.task.id && item.kind === "task_assignment");
  ok("staff task notification uses governed directory", generatedStaffAssignment?.taskAssigneeType === "staff" && generatedStaffAssignment?.recipient === "jamie.torres@example.com");
  const taskSummary = summarizeTaskBoard(blockedTask.doc, now);
  ok("task board workload summary", taskSummary.totals.active === 2 && taskSummary.totals.overdue === 1 && taskSummary.totals.blocked === 1 && taskSummary.workload.some(item => item.assigneeId === "sponsor" && item.overdue === 1));
  const done = updatePartnerTask(blockedTask.doc, task.task.id, { status: "done" }, { actorId: "ops_1", idFactory, now });
  ok("delegated task lifecycle", done.ok && done.task.completedAt === now && done.doc.activity.at(-1).type === "task.updated");
  const invalidTaskDate = createPartnerTask(done.doc, { title: "Bad date", dueAt: "not-a-date" }, { idFactory, now });
  ok("task date validation", !invalidTaskDate.ok && invalidTaskDate.error.includes("valid date"));
  const launchChecks = {
    backupRecovery: {
      id: "backupRecovery",
      label: "Backup and recovery",
      group: "Platform",
      ok: false,
      severity: "warning",
      message: "Record a current restore drill."
    },
    stripePartnerPayments: {
      id: "stripePartnerPayments",
      label: "Partner invoice payments",
      group: "Revenue",
      ok: false,
      severity: "error",
      message: "Configure Stripe partner invoice checkout."
    }
  };
  const launchCreated = syncDeploymentCheckTasks(emptyPartnerOperations(), launchChecks, {
    actorId: "ops_1",
    idFactory,
    now: "2026-07-18T12:00:00.000Z"
  });
  const backupLaunchTask = launchCreated.tasks.find(item => item.relatedEntityId === "backupRecovery");
  const paymentLaunchTask = launchCreated.tasks.find(item => item.relatedEntityId === "stripePartnerPayments");
  ok("launch gates create accountable team tasks", launchCreated.ok && launchCreated.created === 2 && launchCreated.active === 2 && backupLaunchTask?.assigneeId === "operations" && backupLaunchTask?.priority === "high" && backupLaunchTask?.dueAt === "2026-08-01T12:00:00.000Z" && paymentLaunchTask?.assigneeId === "finance" && paymentLaunchTask?.priority === "urgent" && paymentLaunchTask?.dueAt === "2026-07-21T12:00:00.000Z");
  const launchReplay = syncDeploymentCheckTasks(launchCreated.doc, launchChecks, {
    actorId: "ops_1",
    idFactory,
    now: "2026-07-19T12:00:00.000Z"
  });
  ok("launch task sync replay is idempotent", launchReplay.ok && !launchReplay.changed && launchReplay.created === 0 && launchReplay.active === 2 && launchReplay.tasks.length === 2 && launchReplay.tasks.every(item => item.updatedAt === "2026-07-18T12:00:00.000Z"));
  const launchEscalated = syncDeploymentCheckTasks(launchReplay.doc, {
    ...launchChecks,
    backupRecovery: { ...launchChecks.backupRecovery, severity: "error", message: "Restore drill is now a launch blocker." }
  }, { actorId: "ops_1", idFactory, now: "2026-07-19T12:00:00.000Z" });
  const escalatedBackupTask = launchEscalated.tasks.find(item => item.relatedEntityId === "backupRecovery");
  ok("launch warning escalation advances priority and deadline", launchEscalated.updated === 1 && escalatedBackupTask?.priority === "urgent" && escalatedBackupTask?.dueAt === "2026-07-22T12:00:00.000Z");
  const launchCompleted = syncDeploymentCheckTasks(launchEscalated.doc, Object.fromEntries(Object.entries(launchChecks).map(([id, check]) => [id, { ...check, ok: true, severity: "ok" }])), {
    actorId: "ops_1",
    idFactory,
    now: "2026-07-20T12:00:00.000Z"
  });
  ok("passing launch gates complete active tasks", launchCompleted.completed === 2 && launchCompleted.active === 0 && launchCompleted.tasks.every(item => item.status === "done" && item.completedAt === "2026-07-20T12:00:00.000Z"));
  const launchRegressed = syncDeploymentCheckTasks(launchCompleted.doc, {
    ...launchChecks,
    stripePartnerPayments: { ...launchChecks.stripePartnerPayments, ok: true, severity: "ok" }
  }, { actorId: "ops_1", idFactory, now: "2026-07-22T12:00:00.000Z" });
  const reopenedBackupTask = launchRegressed.tasks.find(item => item.relatedEntityId === "backupRecovery");
  ok("regressed launch gate reopens its original task", launchRegressed.reopened === 1 && launchRegressed.active === 1 && reopenedBackupTask?.id === backupLaunchTask?.id && reopenedBackupTask?.status === "open" && reopenedBackupTask?.reopenedAt === "2026-07-22T12:00:00.000Z" && reopenedBackupTask?.dueAt === "2026-08-05T12:00:00.000Z");
  const invalidLaunchSyncIntervals = ["soon", -1, 1_000, 86_400_001].every(value => {
    try {
      deploymentTaskSyncIntervalMs(value, { production: true });
      return false;
    } catch {
      return true;
    }
  });
  ok("launch task automation interval is production-safe", deploymentTaskSyncIntervalMs(undefined, { production: false }) === 0 && deploymentTaskSyncIntervalMs(undefined, { production: true }) === 900_000 && deploymentTaskSyncIntervalMs("3600000", { production: true }) === 3_600_000 && deploymentTaskSyncIntervalMs("0", { production: true }) === 0 && invalidLaunchSyncIntervals);
  const prospect = createOutreachProspect(done.doc, {
    organizationName: "Island Hotel",
    industry: "hospitality",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8339,
    longitude: -97.0611,
    contactName: "Jordan Lee",
    contactEmail: "partnerships@example.com",
    ownerId: "sponsor_lead",
    nextAction: "Prepare a reviewed sponsor invitation",
    nextActionAt: "2026-07-17T15:00:00.000Z"
  }, { idFactory, now });
  ok("geographic prospect scoring", prospect.ok && prospect.prospect.fitScore >= 60 && prospect.prospect.fitReasons.length === 2 && prospect.prospect.ownerId === "sponsor_lead");
  const qualified = updateOutreachProspect(prospect.doc, prospect.prospect.id, {
    status: "contact_ready",
    contactBasis: "business_relevance"
  }, { actorId: "sponsor_1", idFactory, now });
  ok("outreach qualification gate", qualified.ok && qualified.prospect.status === "contact_ready" && qualified.prospect.contactBasis === "business_relevance");
  const scheduledOutreachSummary = summarizePartnerOperations(qualified.doc, now).outreach;
  const overdueOutreachSummary = summarizePartnerOperations(qualified.doc, "2026-07-18T12:00:00.000Z").outreach;
  const invalidOutreachSchedule = updateOutreachProspect(qualified.doc, prospect.prospect.id, { nextActionAt: "not-a-date" }, { actorId: "sponsor_1", idFactory, now });
  ok("outreach ownership and schedule summary", scheduledOutreachSummary.nextActionsScheduled === 1 && scheduledOutreachSummary.nextActionsOverdue === 0 && scheduledOutreachSummary.unassigned === 0 && overdueOutreachSummary.nextActionsOverdue === 1);
  ok("outreach schedule validation", !invalidOutreachSchedule.ok && invalidOutreachSchedule.error.includes("follow-up date"));
  const sponsorPackage = {
    id: "marlin",
    name: "Marlin",
    publicLabel: "$25,000",
    amount: 2500000,
    active: true,
    benefits: ["Beach signage", "Digital placement", "Hospitality support"]
  };
  const sponsorInviteConfig = sponsorInvitationConfig({
    SANDFEST_ENV: "production",
    SANDFEST_SPONSOR_INVITATION_SECRET: "0123456789abcdef0123456789abcdef",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org"
  });
  const invalidSponsorInviteConfig = sponsorInvitationConfig({
    SANDFEST_ENV: "production",
    SANDFEST_PUBLIC_SITE_URL: "http://www.texassandfest.org"
  });
  const invitationUrlForProspect = invitedProspect => sponsorInvitationUrlForProspect(invitedProspect, { config: sponsorInviteConfig });
  const issuedInvitation = createOutreachSponsorInvitation(qualified.doc, prospect.prospect.id, sponsorPackage, {
    actorId: "sponsor_1",
    idFactory,
    now,
    invitationUrlForProspect
  });
  const invitationToken = new URLSearchParams(new URL(issuedInvitation.invitationUrl).hash.split("?")[1]).get("token");
  const invitationAccess = verifySponsorInvitationToken(issuedInvitation.doc, invitationToken, { config: sponsorInviteConfig, now: new Date(now).getTime() });
  const invitationPublic = publicSponsorInvitation(issuedInvitation.prospect, sponsorPackage);
  ok("sponsor invitation production configuration", sponsorInviteConfig.ready && !invalidSponsorInviteConfig.ready && invalidSponsorInviteConfig.missing.length === 2);
  ok("sponsor invitation capability", issuedInvitation.ok && invitationToken?.startsWith("tsfi1.") && invitationAccess.ok && !verifySponsorInvitationToken(issuedInvitation.doc, `${invitationToken}x`, { config: sponsorInviteConfig }).ok);
  ok("sponsor invitation public prefill", invitationPublic.organizationName === "Island Hotel" && invitationPublic.contactEmail === "partnerships@example.com" && invitationPublic.packageId === "marlin" && invitationPublic.expiresAt === issuedInvitation.invitation.expiresAt);
  const approvedInvitationDraftDoc = {
    ...issuedInvitation.doc,
    followups: [{
      id: "followup_invitation_review",
      prospectId: prospect.prospect.id,
      kind: "sponsor_outreach",
      status: "approved",
      body: `Hello Jordan\n\nReview sponsorship options: ${issuedInvitation.invitationUrl}`,
      sponsorInvitationUrl: issuedInvitation.invitationUrl,
      sponsorInvitationVersion: issuedInvitation.invitation.version,
      approvedBy: "sponsor_1",
      approvedAt: now,
      createdAt: now,
      updatedAt: now
    }]
  };
  const rotatedInvitation = createOutreachSponsorInvitation(approvedInvitationDraftDoc, prospect.prospect.id, sponsorPackage, {
    actorId: "sponsor_1",
    idFactory,
    now: "2026-07-16T13:00:00.000Z",
    invitationUrlForProspect
  });
  const rotatedSponsorInvitationToken = new URLSearchParams(new URL(rotatedInvitation.invitationUrl).hash.split("?")[1]).get("token");
  ok("sponsor invitation rotation returns outreach to review", rotatedInvitation.ok && rotatedInvitation.invitation.version === 2 && rotatedInvitation.refreshedDrafts === 1 && rotatedInvitation.doc.followups[0].status === "draft_ready" && rotatedInvitation.doc.followups[0].approvedBy === null && !rotatedInvitation.doc.followups[0].body.includes(issuedInvitation.invitationUrl));
  ok("sponsor invitation rotation revokes old token", !verifySponsorInvitationToken(rotatedInvitation.doc, invitationToken, { config: sponsorInviteConfig }).ok && verifySponsorInvitationToken(rotatedInvitation.doc, rotatedSponsorInvitationToken, { config: sponsorInviteConfig }).ok);
  const queuedInvitationDoc = { ...rotatedInvitation.doc, followups: rotatedInvitation.doc.followups.map(item => ({ ...item, status: "queued" })) };
  const blockedInvitationRotation = createOutreachSponsorInvitation(queuedInvitationDoc, prospect.prospect.id, sponsorPackage, { now, invitationUrlForProspect });
  const blockedInvitationRevoke = revokeOutreachSponsorInvitation(queuedInvitationDoc, prospect.prospect.id, { now });
  ok("queued outreach protects sponsor invitation", !blockedInvitationRotation.ok && !blockedInvitationRevoke.ok && blockedInvitationRotation.error.includes("queued"));
  const revokedInvitation = revokeOutreachSponsorInvitation(rotatedInvitation.doc, prospect.prospect.id, { actorId: "sponsor_1", idFactory, now: "2026-07-16T14:00:00.000Z" });
  ok("sponsor invitation revocation dismisses unsent outreach", revokedInvitation.ok && revokedInvitation.dismissedDrafts === 1 && revokedInvitation.doc.followups[0].status === "dismissed" && !verifySponsorInvitationToken(revokedInvitation.doc, rotatedSponsorInvitationToken, { config: sponsorInviteConfig }).ok);
  const invitedApplicationInput = {
    type: "sponsor",
    organizationName: "Island Hotel",
    contactName: "Jordan Lee",
    contactEmail: "partnerships@example.com",
    contactPhone: "361-555-0115",
    website: "https://islandhotel.example",
    packageId: sponsorPackage.id,
    packageName: sponsorPackage.name,
    packageBenefits: sponsorPackage.benefits,
    expectedAmountCents: sponsorPackage.amount,
    description: "Host visiting sculptors and sponsor hospitality.",
    consentToContact: true
  };
  const mismatchedInvitation = createSponsorApplicationFromOutreachInvitation(issuedInvitation.doc, prospect.prospect.id, { ...invitedApplicationInput, contactEmail: "other@example.com" }, {
    packageId: sponsorPackage.id,
    invitationVersion: issuedInvitation.invitation.version,
    idFactory,
    now
  });
  const conversionClaimDoc = {
    ...issuedInvitation.doc,
    followups: [{
      ...approvedInvitationDraftDoc.followups[0],
      recipient: prospect.prospect.contactEmail,
      subject: "Texas SandFest sponsor invitation",
      status: "sending",
      deliveryClaimId: "job_conversion_outreach",
      deliveryClaimedAt: now,
      providerSubmissionStartedAt: null,
      automationJobId: "job_conversion_outreach"
    }]
  };
  const convertedBeforeOutreachHandoff = createSponsorApplicationFromOutreachInvitation(conversionClaimDoc, prospect.prospect.id, invitedApplicationInput, {
    packageId: sponsorPackage.id,
    invitationVersion: issuedInvitation.invitation.version,
    portalAccessIdFactory: () => "portal_conversion_before_handoff",
    idFactory,
    now
  });
  const conversionStartedDoc = {
    ...conversionClaimDoc,
    followups: conversionClaimDoc.followups.map(item => ({ ...item, providerSubmissionStartedAt: now }))
  };
  const convertedAfterOutreachHandoff = createSponsorApplicationFromOutreachInvitation(conversionStartedDoc, prospect.prospect.id, invitedApplicationInput, {
    packageId: sponsorPackage.id,
    invitationVersion: issuedInvitation.invitation.version,
    portalAccessIdFactory: () => "portal_conversion_after_handoff",
    idFactory,
    now
  });
  const convertedInvitation = createSponsorApplicationFromOutreachInvitation(issuedInvitation.doc, prospect.prospect.id, invitedApplicationInput, {
    packageId: sponsorPackage.id,
    invitationVersion: issuedInvitation.invitation.version,
    portalAccessIdFactory: () => "portal_invited_sponsor",
    idFactory,
    now
  });
  const replayedInvitation = createSponsorApplicationFromOutreachInvitation(convertedInvitation.doc, prospect.prospect.id, invitedApplicationInput, {
    packageId: sponsorPackage.id,
    invitationVersion: issuedInvitation.invitation.version,
    idFactory,
    now
  });
  const convertedAccess = verifySponsorInvitationToken(convertedInvitation.doc, invitationToken, { config: sponsorInviteConfig, now: new Date(now).getTime() });
  ok("sponsor invitation identity gate", !mismatchedInvitation.ok && mismatchedInvitation.error.includes("business email"));
  ok("sponsor conversion cancels only an unstarted outreach handoff", convertedBeforeOutreachHandoff.ok && convertedBeforeOutreachHandoff.doc.followups.find(item => item.id === approvedInvitationDraftDoc.followups[0].id)?.status === "dismissed" && convertedBeforeOutreachHandoff.doc.followups.find(item => item.id === approvedInvitationDraftDoc.followups[0].id)?.deliveryClaimId === null && convertedAfterOutreachHandoff.ok && convertedAfterOutreachHandoff.doc.followups.find(item => item.id === approvedInvitationDraftDoc.followups[0].id)?.status === "sending" && convertedAfterOutreachHandoff.doc.followups.find(item => item.id === approvedInvitationDraftDoc.followups[0].id)?.providerSubmissionStartedAt === now);
  ok("sponsor invitation conversion seeds operations", convertedInvitation.ok && convertedInvitation.application.outreachProspectId === prospect.prospect.id && convertedInvitation.prospect.status === "won" && convertedInvitation.prospect.convertedApplicationId === convertedInvitation.application.id && convertedInvitation.doc.applications.length === issuedInvitation.doc.applications.length + 1 && convertedInvitation.doc.brandProfiles.length === issuedInvitation.doc.brandProfiles.length + 1 && convertedInvitation.doc.deliverables.length === issuedInvitation.doc.deliverables.length + sponsorPackage.benefits.length && convertedInvitation.doc.milestones.length === issuedInvitation.doc.milestones.length + 4 && convertedInvitation.doc.tasks.length === issuedInvitation.doc.tasks.length + 1 && convertedInvitation.doc.followups.some(item => item.applicationId === convertedInvitation.application.id && item.kind === "application_received"));
  ok("sponsor invitation conversion is replay safe", replayedInvitation.ok && replayedInvitation.duplicate && replayedInvitation.application.id === convertedInvitation.application.id && replayedInvitation.doc.applications.length === convertedInvitation.doc.applications.length);
  ok("converted sponsor invitation recovers portal handoff", convertedAccess.ok && convertedAccess.converted && convertedAccess.prospect.convertedApplicationId === convertedInvitation.application.id);
  const campaign = createOutreachCampaign(issuedInvitation.doc, {
    name: "Coastal hospitality partners",
    objective: "Introduce the 2026 sponsor program.",
    targeting: {
      industries: ["hospitality"],
      cities: ["Port Aransas"],
      states: ["TX"],
      postalCodes: ["78373"],
      geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 25 },
      minFitScore: 60
    },
    sequence: [
      { delayDays: 0, subjectTemplate: "A SandFest partnership for {{organization}}", bodyTemplate: "Hello {{contactName}},\n\nWe would like to explore a partnership in {{city}}." },
      { delayDays: 7, subjectTemplate: "Following up with {{organization}}", bodyTemplate: "Hello {{contactName}},\n\nMay we answer any SandFest sponsorship questions?" }
    ]
  }, { actorId: "sponsor_1", idFactory, now });
  const farProspect = createOutreachProspect(qualified.doc, {
    organizationName: "Austin Technology Group",
    industry: "software",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    latitude: 30.2672,
    longitude: -97.7431,
    contactEmail: "partners@austin-tech.example",
    contactBasis: "business_relevance",
    status: "contact_ready"
  }, { idFactory, now });
  const radiusCampaign = createOutreachCampaign(farProspect.doc, {
    name: "Port Aransas radius",
    targeting: { geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 25 } },
    sequence: [{ delayDays: 0, subjectTemplate: "Local partnership", bodyTemplate: "Hello {{contactName}}" }]
  }, { actorId: "sponsor_1", idFactory, now });
  const radiusPreview = previewOutreachCampaign(farProspect.doc, {
    name: "Port Aransas radius preview",
    targeting: { geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 25 } },
    sequence: [{ delayDays: 0, subjectTemplate: "A partnership for {{organization}}", bodyTemplate: "Hello {{contactName}} in {{city}}" }]
  }, { actorId: "sponsor_1", now });
  const invalidGeofence = createOutreachCampaign(qualified.doc, {
    name: "Invalid radius",
    targeting: { geofence: { latitude: 27.8339, radiusMiles: 25 } },
    sequence: [{ delayDays: 0, subjectTemplate: "Invalid", bodyTemplate: "Invalid" }]
  }, { actorId: "sponsor_1", idFactory, now });
  const correctedProspectLocation = updateOutreachProspect(farProspect.doc, farProspect.prospect.id, {
    industry: "hospitality",
    city: "Port Aransas",
    postalCode: "78373",
    latitude: 27.84,
    longitude: -97.06,
    communityFit: true
  }, { actorId: "sponsor_1", idFactory, now });
  const invalidProspectLocation = createOutreachProspect(qualified.doc, {
    organizationName: "Incomplete Coordinates",
    contactEmail: "location@example.com",
    postalCode: "bad-zip",
    latitude: 27.8
  }, { idFactory, now });
  ok("outreach campaign targeting", campaign.ok && campaign.campaign.targeting.postalCodes[0] === "78373" && campaign.campaign.deliveryMode === "review_first" && campaign.campaign.dailySendLimit === 25 && matchOutreachProspects(campaign.doc, campaign.campaign).length === 1);
  ok("outreach radius targeting", radiusCampaign.ok && matchOutreachProspects(radiusCampaign.doc, radiusCampaign.campaign).map(item => item.id).join() === prospect.prospect.id && outreachDistanceMiles(27.8339, -97.0611, 30.2672, -97.7431) > 150);
  ok("outreach campaign preflight is exact, personalized, private, and mutation-free", radiusPreview.ok && radiusPreview.preview.totalProspects === 2 && radiusPreview.preview.matched === 1 && radiusPreview.preview.excluded === 1 && radiusPreview.preview.exclusions.length === 1 && radiusPreview.preview.exclusions[0].reason === "outside_radius" && radiusPreview.preview.matches[0].organizationName === "Island Hotel" && !("contactEmail" in radiusPreview.preview.matches[0]) && radiusPreview.preview.sample.sequence[0].subject === "A partnership for Island Hotel" && radiusPreview.preview.sample.sequence[0].body === "Hello Jordan Lee in Port Aransas" && farProspect.doc.campaigns.length === 0);
  ok("outreach geofence validation", !invalidGeofence.ok && invalidGeofence.error.includes("requires center"));
  ok("outreach location correction", correctedProspectLocation.ok && correctedProspectLocation.prospect.fitScore === 100 && correctedProspectLocation.prospect.fitReasons.length === 3 && !invalidProspectLocation.ok);
  const activated = updateOutreachCampaignStatus(campaign.doc, campaign.campaign.id, "activate", { actorId: "sponsor_1", idFactory, now });
  ok("outreach campaign approval", activated.ok && activated.campaign.status === "active" && activated.campaign.approvedBy === "sponsor_1");
  const preferenceConfig = outreachPreferencesConfig({
    SANDFEST_ENV: "production",
    SANDFEST_OUTREACH_PREFERENCES_SECRET: "0123456789abcdef0123456789abcdef",
    SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org"
  });
  const preferenceToken = issueOutreachPreferenceToken(prospect.prospect, { config: preferenceConfig });
  const preferenceUrl = outreachPreferenceUrlForProspect(prospect.prospect, { config: preferenceConfig });
  const preferenceAccess = findOutreachPreferenceProspect(activated.doc, prospect.prospect.id, preferenceToken, { config: preferenceConfig });
  ok("outreach preference capability", preferenceConfig.ready && preferenceToken?.startsWith("tsfu_") && verifyOutreachPreferenceToken(prospect.prospect, preferenceToken, { config: preferenceConfig }) && !verifyOutreachPreferenceToken({ ...prospect.prospect, contactEmail: "changed@example.com" }, preferenceToken, { config: preferenceConfig }) && preferenceAccess.ok);
  ok("outreach preference privacy link", outreachPreferencePath(prospect.prospect, preferenceToken).startsWith("/#outreach-preferences?") && new URL(preferenceUrl).search === "" && new URL(preferenceUrl).hash.includes("token=tsfu_") && publicOutreachPreference(prospect.prospect).organizationName === "Island Hotel");
  const campaignDraft = generateDueOutreachFollowups(activated.doc, { idFactory, now, preferenceUrlForProspect: () => preferenceUrl, sponsorInvitationUrlForProspect: invitationUrlForProspect });
  const campaignDraftAgain = generateDueOutreachFollowups(campaignDraft.doc, { idFactory, now });
  ok("outreach personalized draft", campaignDraft.generated.length === 1 && campaignDraft.generated[0].subject.includes("Island Hotel") && campaignDraft.generated[0].status === "draft_ready" && campaignDraft.generated[0].body.includes(preferenceUrl) && campaignDraft.generated[0].body.includes(issuedInvitation.invitationUrl));
  ok("outreach draft idempotency", campaignDraftAgain.generated.length === 0);
  const editedDraftAt = "2026-07-16T12:00:01.000Z";
  const editedCampaignDraft = editFollowupDraft(campaignDraft.doc, campaignDraft.generated[0].id, {
    subject: "A reviewed SandFest partnership for Island Hotel",
    body: campaignDraft.generated[0].body.replace("Hello Jordan Lee", "Hello Jordan,\n\nOur sponsorship team reviewed this note for you."),
    expectedUpdatedAt: campaignDraft.generated[0].updatedAt
  }, { actorId: "sponsor_1", idFactory, now: editedDraftAt });
  const staleCampaignEdit = editFollowupDraft(editedCampaignDraft.doc, campaignDraft.generated[0].id, {
    subject: "Stale edit",
    body: editedCampaignDraft.followup.body,
    expectedUpdatedAt: campaignDraft.generated[0].updatedAt
  }, { actorId: "sponsor_2", idFactory, now: "2026-07-16T12:00:02.000Z" });
  const missingPreferenceEdit = editFollowupDraft(campaignDraft.doc, campaignDraft.generated[0].id, {
    subject: campaignDraft.generated[0].subject,
    body: campaignDraft.generated[0].body.replace(preferenceUrl, ""),
    expectedUpdatedAt: campaignDraft.generated[0].updatedAt
  }, { actorId: "sponsor_1", idFactory, now: editedDraftAt });
  const editedAutoApproval = applyOutreachCampaignAutomation({
    ...editedCampaignDraft.doc,
    campaigns: editedCampaignDraft.doc.campaigns.map(item => item.id === campaign.campaign.id ? { ...item, deliveryMode: "approved_sequence" } : item)
  }, { idFactory, now: editedDraftAt, providerReady: true });
  const approvedEditedDraft = reviewFollowup(editedCampaignDraft.doc, editedCampaignDraft.followup.id, "approve", { actorId: "sponsor_1", now: editedDraftAt });
  const lockedApprovedEdit = editFollowupDraft(approvedEditedDraft.doc, approvedEditedDraft.followup.id, {
    subject: approvedEditedDraft.followup.subject,
    body: approvedEditedDraft.followup.body,
    expectedUpdatedAt: approvedEditedDraft.followup.updatedAt
  }, { actorId: "sponsor_1", idFactory, now: editedDraftAt });
  const emptySubjectEdit = editFollowupDraft(campaignDraft.doc, campaignDraft.generated[0].id, {
    subject: "",
    body: campaignDraft.generated[0].body,
    expectedUpdatedAt: campaignDraft.generated[0].updatedAt
  }, { actorId: "sponsor_1", idFactory, now: editedDraftAt });
  ok("staff can edit a ready message without approving it", editedCampaignDraft.ok && editedCampaignDraft.changed && editedCampaignDraft.followup.status === "draft_ready" && editedCampaignDraft.followup.editVersion === 1 && editedCampaignDraft.followup.editedBy === "sponsor_1" && editedCampaignDraft.doc.activity.at(-1)?.type === "followup.edited" && !JSON.stringify(editedCampaignDraft.doc.activity.at(-1)).includes(editedCampaignDraft.followup.body));
  ok("message edits are conflict-safe and preserve private links", !staleCampaignEdit.ok && staleCampaignEdit.conflict === true && !missingPreferenceEdit.ok && missingPreferenceEdit.error.includes("private action"));
  ok("message edit validation locks approved drafts and empty content", approvedEditedDraft.ok && !lockedApprovedEdit.ok && lockedApprovedEdit.conflict === true && !emptySubjectEdit.ok && emptySubjectEdit.error.includes("subject is required"));
  ok("edited messages remain under human review", editedAutoApproval.approved.length === 0 && editedAutoApproval.doc.followups.find(item => item.id === editedCampaignDraft.followup.id)?.status === "draft_ready");
  const automatedProspect = createOutreachProspect(campaignDraft.doc, {
    organizationName: "Harbor Lodging Group",
    contactName: "Taylor Morgan",
    contactEmail: "partnerships@harbor-lodging.example",
    contactBasis: "business_relevance",
    status: "contact_ready",
    industry: "lodging",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.834,
    longitude: -97.061
  }, { idFactory, now });
  const automatedCampaign = createOutreachCampaign(automatedProspect.doc, {
    name: "Approved lodging sequence",
    deliveryMode: "approved_sequence",
    dailySendLimit: 1,
    targeting: { industries: ["lodging"], cities: ["Port Aransas"], states: ["TX"] },
    sequence: [{ delayDays: 0, subjectTemplate: "SandFest and {{organization}}", bodyTemplate: "Hello {{contactName}}, may we share our sponsor program?" }]
  }, { actorId: "sponsor_1", idFactory, now });
  const blockedAutomatedActivation = updateOutreachCampaignStatus(automatedCampaign.doc, automatedCampaign.campaign.id, "activate", { actorId: "sponsor_1", idFactory, now });
  const activatedAutomatedCampaign = updateOutreachCampaignStatus(automatedCampaign.doc, automatedCampaign.campaign.id, "activate", { actorId: "sponsor_1", idFactory, now, providerReady: true });
  const generatedAutomatedCampaign = generateDueOutreachFollowups(activatedAutomatedCampaign.doc, { idFactory, now });
  const appliedAutomatedCampaign = applyOutreachCampaignAutomation(generatedAutomatedCampaign.doc, { idFactory, now, providerReady: true });
  const automatedReadiness = outreachCampaignAutomationReadiness(appliedAutomatedCampaign.doc, activatedAutomatedCampaign.campaign, { now, providerReady: true });
  const campaignQueueCandidates = automatedFollowupQueueCandidates(appliedAutomatedCampaign.doc, { maxBatch: 10, now, providerReady: true });
  const providerBlockedCampaignCandidates = automatedFollowupQueueCandidates(appliedAutomatedCampaign.doc, { maxBatch: 10, now, providerReady: false });
  const reservedManualId = `${appliedAutomatedCampaign.approved[0].id}_reserved_manual`;
  const reservedManualDoc = {
    ...appliedAutomatedCampaign.doc,
    followups: [...appliedAutomatedCampaign.doc.followups, { ...appliedAutomatedCampaign.approved[0], id: reservedManualId, approvedBy: "sponsor_1", automationPolicy: null, automationCampaignApprovedAt: null }]
  };
  const blockedByAutomatedReservation = queueFollowupDelivery(reservedManualDoc, reservedManualId, { now });
  const queuedAutomatedReservation = queueFollowupDelivery(appliedAutomatedCampaign.doc, appliedAutomatedCampaign.approved[0].id, { now, automationJobId: "job_reserved_campaign" });
  const capacityRaceManualId = `${appliedAutomatedCampaign.approved[0].id}_capacity_race`;
  const capacityRaceDoc = {
    ...appliedAutomatedCampaign.doc,
    followups: [...appliedAutomatedCampaign.doc.followups, {
      ...appliedAutomatedCampaign.approved[0],
      id: capacityRaceManualId,
      status: "queued",
      approvedBy: "sponsor_1",
      automationPolicy: null,
      automationCampaignApprovedAt: null,
      queuedAt: now
    }]
  };
  const rejectedCapacityRace = queueFollowupDelivery(capacityRaceDoc, appliedAutomatedCampaign.approved[0].id, { now, automationJobId: "job_capacity_race" });
  const releasedCapacityRace = releaseAutomatedFollowupApproval(capacityRaceDoc, appliedAutomatedCampaign.approved[0].id, rejectedCapacityRace.error, {
    actorId: "worker",
    automationPolicy: OUTREACH_CAMPAIGN_AUTOMATION_POLICY,
    decision: "daily_capacity_released",
    idFactory,
    now
  });
  const manualCampaignDoc = {
    ...appliedAutomatedCampaign.doc,
    followups: appliedAutomatedCampaign.doc.followups.map(item => item.id === appliedAutomatedCampaign.approved[0].id
      ? { ...item, approvedBy: "sponsor_1", automationPolicy: null, automationCampaignApprovedAt: null }
      : item)
  };
  const manuallyQueuedCampaign = queueFollowupDelivery(manualCampaignDoc, appliedAutomatedCampaign.approved[0].id, { now });
  const claimedCampaignDelivery = claimFollowupDelivery(manuallyQueuedCampaign.doc, appliedAutomatedCampaign.approved[0].id, { deliveryClaimId: "job_campaign_claim", now });
  const begunCampaignDelivery = beginFollowupProviderSubmission(claimedCampaignDelivery.doc, appliedAutomatedCampaign.approved[0].id, { deliveryClaimId: "job_campaign_claim", now });
  const terminalClaimRecovery = recordFollowupDelivery(claimedCampaignDelivery.doc, appliedAutomatedCampaign.approved[0].id, { sent: false, provider: "worker", error: "Delivery job expired before provider handoff." }, { deliveryClaimId: "job_campaign_claim", terminal: true, now });
  const pausedAfterProviderStart = updateOutreachCampaignStatus(begunCampaignDelivery.doc, automatedCampaign.campaign.id, "pause", { actorId: "sponsor_1", idFactory, now });
  const recordedClaimedDelivery = recordFollowupDelivery(pausedAfterProviderStart.doc, appliedAutomatedCampaign.approved[0].id, { sent: true, provider: "brevo", providerMessageId: "msg_claimed_campaign" }, { deliveryClaimId: "job_campaign_claim", now });
  const failedClaimedDelivery = recordFollowupDelivery(pausedAfterProviderStart.doc, appliedAutomatedCampaign.approved[0].id, { sent: false, provider: "brevo", error: "Provider unavailable." }, { deliveryClaimId: "job_campaign_claim", now });
  const suppressedClaimedDelivery = updateOutreachProspect(claimedCampaignDelivery.doc, claimedCampaignDelivery.followup.prospectId, { status: "do_not_contact", suppressed: true, suppressionReason: "Recipient unsubscribed" }, { actorId: "sponsor_1", idFactory, now });
  const lateSuppressedDelivery = recordFollowupDelivery(suppressedClaimedDelivery.doc, appliedAutomatedCampaign.approved[0].id, { sent: true, provider: "brevo", providerMessageId: "msg_too_late" }, { deliveryClaimId: "job_campaign_claim", now });
  const suppressedAfterProviderStart = updateOutreachProspect(begunCampaignDelivery.doc, begunCampaignDelivery.followup.prospectId, { status: "do_not_contact", suppressed: true, suppressionReason: "Recipient unsubscribed after provider handoff" }, { actorId: "sponsor_1", idFactory, now });
  const recordedAfterProviderStart = recordFollowupDelivery(suppressedAfterProviderStart.doc, appliedAutomatedCampaign.approved[0].id, { sent: true, provider: "brevo", providerMessageId: "msg_handoff_started" }, { deliveryClaimId: "job_campaign_claim", now });
  const pausedBeforeProviderStart = updateOutreachCampaignStatus(claimedCampaignDelivery.doc, automatedCampaign.campaign.id, "pause", { actorId: "sponsor_1", idFactory, now });
  const canceledProviderStart = beginFollowupProviderSubmission(pausedBeforeProviderStart.doc, appliedAutomatedCampaign.approved[0].id, { deliveryClaimId: "job_campaign_claim", now });
  const completedBeforeProviderStart = updateOutreachCampaignStatus(claimedCampaignDelivery.doc, automatedCampaign.campaign.id, "complete", { actorId: "sponsor_1", idFactory, now });
  const canceledCompletedProviderStart = beginFollowupProviderSubmission(completedBeforeProviderStart.doc, appliedAutomatedCampaign.approved[0].id, { deliveryClaimId: "job_campaign_claim", now });
  const archivedBeforeProviderStart = updateOutreachCampaignStatus(pausedBeforeProviderStart.doc, automatedCampaign.campaign.id, "archive", { actorId: "sponsor_1", idFactory, now });
  const canceledArchivedProviderStart = beginFollowupProviderSubmission(archivedBeforeProviderStart.doc, appliedAutomatedCampaign.approved[0].id, { deliveryClaimId: "job_campaign_claim", now });
  const pausedBeforeDeliveryClaim = updateOutreachCampaignStatus(manuallyQueuedCampaign.doc, automatedCampaign.campaign.id, "pause", { actorId: "sponsor_1", idFactory, now });
  const blockedDeliveryClaim = claimFollowupDelivery(pausedBeforeDeliveryClaim.doc, appliedAutomatedCampaign.approved[0].id, { deliveryClaimId: "job_campaign_stale", now });
  const manualOverflowId = `${appliedAutomatedCampaign.approved[0].id}_overflow`;
  const manualOverflowDoc = {
    ...manuallyQueuedCampaign.doc,
    followups: [...manuallyQueuedCampaign.doc.followups, { ...appliedAutomatedCampaign.approved[0], id: manualOverflowId, approvedBy: "sponsor_1", automationPolicy: null, automationCampaignApprovedAt: null }]
  };
  const manuallyQueuedOverflow = queueFollowupDelivery(manualOverflowDoc, manualOverflowId, { now });
  const carriedQueueDoc = {
    ...appliedAutomatedCampaign.doc,
    followups: appliedAutomatedCampaign.doc.followups.map(item => item.id === appliedAutomatedCampaign.approved[0].id
      ? { ...item, status: "queued", queuedAt: "2026-05-14T23:59:00.000Z" }
      : item)
  };
  const carriedQueueReadiness = outreachCampaignAutomationReadiness(carriedQueueDoc, automatedCampaign.campaign.id, { now: "2026-05-15T01:00:00.000Z", providerReady: true });
  const pausedAutomatedCampaign = updateOutreachCampaignStatus(appliedAutomatedCampaign.doc, automatedCampaign.campaign.id, "pause", { actorId: "sponsor_1", idFactory, now });
  const failedCampaignDoc = {
    ...appliedAutomatedCampaign.doc,
    followups: appliedAutomatedCampaign.doc.followups.map(item => item.id === appliedAutomatedCampaign.approved[0].id
      ? { ...item, status: "failed", lastAttemptAt: now, lastError: "Provider rejected delivery." }
      : item)
  };
  const failedCampaignReadiness = outreachCampaignAutomationReadiness(failedCampaignDoc, automatedCampaign.campaign.id, { now, providerReady: true });
  const pausedFailedCampaign = updateOutreachCampaignStatus(failedCampaignDoc, automatedCampaign.campaign.id, "pause", { actorId: "sponsor_1", idFactory, now });
  const resumedFailedCampaign = updateOutreachCampaignStatus(pausedFailedCampaign.doc, automatedCampaign.campaign.id, "activate", { actorId: "sponsor_1", idFactory, now, providerReady: true });
  const reappliedFailedCampaign = applyOutreachCampaignAutomation(resumedFailedCampaign.doc, { idFactory, now, providerReady: true });
  ok("campaign automation requires delivery readiness", !blockedAutomatedActivation.ok && blockedAutomatedActivation.providerNotReady === true && activatedAutomatedCampaign.ok);
  ok("campaign approval automates one bounded message", generatedAutomatedCampaign.generated.length === 1 && appliedAutomatedCampaign.approved.length === 1 && appliedAutomatedCampaign.approved[0].automationPolicy === OUTREACH_CAMPAIGN_AUTOMATION_POLICY && automatedReadiness.dailySendLimit === 1 && automatedReadiness.remainingToday === 0 && campaignQueueCandidates.length === 1);
  ok("campaign automation fails closed and carries queued capacity", providerBlockedCampaignCandidates.length === 0 && carriedQueueReadiness.queuedPending === 1 && carriedQueueReadiness.remainingToday === 0);
  ok("campaign auto-approval reserves daily queue capacity", !blockedByAutomatedReservation.ok && blockedByAutomatedReservation.dailyLimitReached === true && queuedAutomatedReservation.ok && queuedAutomatedReservation.followup.status === "queued");
  ok("campaign capacity race releases the automated approval", !rejectedCapacityRace.ok && rejectedCapacityRace.dailyLimitReached === true && releasedCapacityRace.ok && releasedCapacityRace.followup.status === "draft_ready" && releasedCapacityRace.followup.approvedBy === null && releasedCapacityRace.followup.automationPolicy === null && releasedCapacityRace.followup.automationDecision === "daily_capacity_released" && releasedCapacityRace.doc.activity.at(-1)?.type === "followup.automation_released");
  ok("campaign daily cap includes manual delivery", manuallyQueuedCampaign.ok && !manuallyQueuedOverflow.ok && manuallyQueuedOverflow.dailyLimitReached === true && outreachCampaignAutomationReadiness(manuallyQueuedCampaign.doc, automatedCampaign.campaign.id, { now, providerReady: true }).remainingToday === 0);
  ok("campaign pause and send use an atomic provider handoff", claimedCampaignDelivery.ok && begunCampaignDelivery.ok && begunCampaignDelivery.followup.providerSubmissionStartedAt === now && pausedAfterProviderStart.inFlightFollowups === 1 && pausedAfterProviderStart.doc.followups.find(item => item.id === claimedCampaignDelivery.followup.id)?.status === "sending" && recordedClaimedDelivery.ok && recordedClaimedDelivery.followup.status === "sent" && failedClaimedDelivery.ok && failedClaimedDelivery.followup.status === "failed" && canceledProviderStart.ok && canceledProviderStart.canceled === true && canceledProviderStart.followup.status === "draft_ready" && !blockedDeliveryClaim.ok && blockedDeliveryClaim.canceled === true);
  ok("campaign terminal states dismiss an unstarted handoff", canceledCompletedProviderStart.ok && canceledCompletedProviderStart.canceled === true && canceledCompletedProviderStart.followup.status === "dismissed" && canceledArchivedProviderStart.ok && canceledArchivedProviderStart.canceled === true && canceledArchivedProviderStart.followup.status === "dismissed");
  ok("terminal recovery clears a pre-handoff delivery claim", terminalClaimRecovery.ok && terminalClaimRecovery.followup.status === "failed" && terminalClaimRecovery.followup.deliveryClaimId === null && terminalClaimRecovery.followup.providerSubmissionStartedAt === null);
  ok("outreach suppression revokes an in-flight claim", suppressedClaimedDelivery.ok && suppressedClaimedDelivery.doc.followups.find(item => item.id === claimedCampaignDelivery.followup.id)?.status === "dismissed" && !lateSuppressedDelivery.ok);
  ok("outreach suppression preserves a started provider handoff", suppressedAfterProviderStart.ok && suppressedAfterProviderStart.prospect.status === "do_not_contact" && suppressedAfterProviderStart.doc.followups.find(item => item.id === begunCampaignDelivery.followup.id)?.status === "sending" && recordedAfterProviderStart.ok && recordedAfterProviderStart.followup.status === "sent");
  ok("campaign pause returns unsent automation to review", pausedAutomatedCampaign.ok && pausedAutomatedCampaign.returnedToReview === 1 && pausedAutomatedCampaign.doc.followups.find(item => item.id === appliedAutomatedCampaign.approved[0].id)?.status === "draft_ready" && automatedFollowupQueueCandidates(pausedAutomatedCampaign.doc, { now }).length === 0);
  ok("campaign pause holds failed delivery for manual retry", failedCampaignReadiness.failedToday === 1 && failedCampaignReadiness.remainingToday === 0 && pausedFailedCampaign.failedHeldForRetry === 1 && pausedFailedCampaign.doc.followups.find(item => item.id === appliedAutomatedCampaign.approved[0].id)?.status === "failed" && resumedFailedCampaign.ok && reappliedFailedCampaign.approved.length === 0);
  const movedOutsideCampaign = updateOutreachProspect(campaignDraft.doc, prospect.prospect.id, {
    city: "Austin",
    postalCode: "78701",
    latitude: 30.2672,
    longitude: -97.7431
  }, { actorId: "sponsor_1", idFactory, now });
  const staleGeofenceDoc = {
    ...movedOutsideCampaign.doc,
    followups: movedOutsideCampaign.doc.followups.map(item => item.id === campaignDraft.generated[0].id ? { ...item, status: "draft_ready" } : item)
  };
  const staleGeofenceReview = reviewFollowup(staleGeofenceDoc, campaignDraft.generated[0].id, "approve", { actorId: "sponsor_1", now });
  ok("outreach geofence invalidates stale draft", movedOutsideCampaign.doc.followups.find(item => item.id === campaignDraft.generated[0].id).status === "dismissed" && !staleGeofenceReview.ok && staleGeofenceReview.error.includes("targeting"));
  const outreachApproved = reviewFollowup(campaignDraft.doc, campaignDraft.generated[0].id, "approve", { actorId: "sponsor_1", now });
  const outreachQueued = queueFollowupDelivery(outreachApproved.doc, campaignDraft.generated[0].id, { now });
  const outreachSent = recordFollowupDelivery(outreachQueued.doc, campaignDraft.generated[0].id, { sent: true, provider: "brevo", providerMessageId: "msg_outreach_1" }, { now });
  const campaignOutcomeEvidence = {
    ...outreachSent.doc,
    followups: outreachSent.doc.followups.flatMap(item => item.id === campaignDraft.generated[0].id ? [
      {
        ...item,
        deliveryStatus: "clicked",
        deliveredAt: "2026-07-16T12:01:00.000Z",
        openedAt: "2026-07-16T12:02:00.000Z",
        clickedAt: "2026-07-16T12:03:00.000Z"
      },
      {
        ...item,
        id: "followup_same_campaign_second_step",
        sequenceStepId: "step_2",
        deliveryStatus: "accepted",
        deliveredAt: null,
        openedAt: null,
        clickedAt: null
      }
    ] : [item])
  };
  const convertedCampaignOutcome = createSponsorApplicationFromOutreachInvitation(campaignOutcomeEvidence, prospect.prospect.id, invitedApplicationInput, {
    packageId: sponsorPackage.id,
    invitationVersion: issuedInvitation.invitation.version,
    portalAccessIdFactory: () => "portal_campaign_outcome",
    idFactory,
    now
  });
  const campaignOutcomeMetrics = outreachCampaignMetrics(convertedCampaignOutcome.doc, campaign.campaign);
  ok("campaign outcome funnel is cumulative, unique, converted, and aggregate-only", convertedCampaignOutcome.ok
    && campaignOutcomeMetrics.funnel.enrolled === 1
    && campaignOutcomeMetrics.funnel.reached === 1
    && campaignOutcomeMetrics.funnel.delivered === 1
    && campaignOutcomeMetrics.funnel.opened === 1
    && campaignOutcomeMetrics.funnel.clicked === 1
    && campaignOutcomeMetrics.funnel.applications === 1
    && campaignOutcomeMetrics.funnel.deliveryFailures === 0
    && !JSON.stringify(campaignOutcomeMetrics).includes(prospect.prospect.contactEmail));
  const weekLater = "2026-07-23T12:00:00.000Z";
  const secondDraft = generateDueOutreachFollowups(outreachSent.doc, { idFactory, now: weekLater });
  ok("outreach sequence timing", secondDraft.generated.length === 1 && secondDraft.generated[0].sequenceStepId === "step_2" && outreachSent.doc.prospects[0].status === "contacted");
  const suppressed = updateOutreachProspect(secondDraft.doc, prospect.prospect.id, { suppressed: true, suppressionReason: "Requested no further contact" }, { actorId: "sponsor_1", idFactory, now: weekLater });
  const blockedQueue = reviewFollowup(suppressed.doc, secondDraft.generated[0].id, "approve", { actorId: "sponsor_1", now: weekLater });
  ok("outreach suppression cancels drafts", suppressed.ok && suppressed.prospect.status === "do_not_contact" && suppressed.doc.followups.find(item => item.id === secondDraft.generated[0].id).status === "dismissed" && !blockedQueue.ok);
  const summary = summarizePartnerOperations(suppressed.doc, weekLater);
  ok("partner operations summary", summary.finance.amountPaidCents === 2500000 && summary.finance.invoicesSynced === 1 && summary.outreach.prospects === 1 && summary.outreach.campaigns === 1 && summary.outreach.suppressed === 1);
  const invalid = createPartnerApplication(emptyPartnerOperations(), { type: "vendor", organizationName: "Missing Contact" });
  ok("partner validation", !invalid.ok && Boolean(invalid.error));
}

// Review-first bulk outreach import with standard CSV quoting and no overwrites
{
  let sequence = 0;
  const idFactory = prefix => `${prefix}_import_${++sequence}`;
  const now = "2026-07-16T12:00:00.000Z";
  const csv = `business_name,industry,city,state,zip,email,community_fit,owner_id,next_action,next_action_at
"Coastal ""Boardwalk"" Resort",hospitality,Port Aransas,TX,78373,partners@boardwalk.example,yes,sponsor_lead,"Call after
the board review",2026-07-20T15:00:00Z
Boardwalk Duplicate,hospitality,Port Aransas,TX,78373,partners@boardwalk.example,no,sponsor_lead,Duplicate email,2026-07-21T15:00:00Z
Invalid ZIP,banking,Corpus Christi,TX,invalid,bank@example.com,no,finance,Fix location,2026-07-22T15:00:00Z
Research First,construction,Corpus Christi,,78401,,,,Find decision maker,`;
  const parsed = parseOutreachProspectCsv(csv, { state: "TX", contactBasis: "business_relevance", status: "contact_ready" });
  ok("outreach CSV parser", parsed.ok && parsed.totalRows === 4 && parsed.rows[0].input.organizationName === "Coastal \"Boardwalk\" Resort" && parsed.rows[0].input.nextAction.includes("board review") && parsed.rows[0].input.ownerId === "sponsor_lead" && parsed.rows[0].input.nextActionAt === "2026-07-20T15:00:00Z");
  const imported = applyOutreachProspectImport(emptyPartnerOperations(), parsed, { actorId: "outreach_admin", idFactory, now, sourceBatch: "batch_1" });
  ok("outreach CSV preview", imported.ok && imported.summary.valid === 2 && imported.summary.duplicates === 1 && imported.summary.invalid === 1 && imported.summary.contactReady === 1);
  ok("outreach CSV provenance", imported.created.every(item => item.source === "csv_import" && item.sourceBatch === "batch_1" && item.sourceRow > 1) && imported.created[0].nextActionAt === "2026-07-20T15:00:00.000Z");
  const replayed = applyOutreachProspectImport(imported.doc, parsed, { actorId: "outreach_admin", idFactory, now, sourceBatch: "batch_2" });
  ok("outreach CSV duplicate safety", replayed.summary.valid === 0 && replayed.summary.duplicates === 3 && replayed.doc.prospects.length === 2);
  const malformed = parseOutreachProspectCsv('organization_name,email\n"Unclosed,contact@example.com');
  ok("outreach CSV malformed rejection", !malformed.ok && malformed.error.includes("could not be parsed"));
  const oversized = parseOutreachProspectCsv(`organization_name\n${Array.from({ length: 501 }, (_, index) => `Business ${index + 1}`).join("\n")}`);
  ok("outreach CSV row limit", !oversized.ok && oversized.error.includes("maximum import"));
}

// Review-first regional business discovery with signed, short-lived previews
{
  let sequence = 0;
  const idFactory = prefix => `${prefix}_discovery_${++sequence}`;
  const fixtureConfig = outreachDiscoveryConfig({
    SANDFEST_ENV: "development",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    OUTREACH_DISCOVERY_SECRET: "platform-outreach-discovery-secret-0123456789"
  });
  const productionFixture = outreachDiscoveryConfig({
    SANDFEST_ENV: "production",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "fixture",
    OUTREACH_DISCOVERY_SECRET: "platform-outreach-discovery-secret-0123456789"
  });
  const insecureProvider = outreachDiscoveryConfig({
    SANDFEST_ENV: "production",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "openstreetmap",
    OUTREACH_DISCOVERY_SECRET: "platform-osm-discovery-secret-0123456789",
    OUTREACH_DISCOVERY_USER_AGENT: "TexasSandFest-PlatformTests/1.0",
    OUTREACH_DISCOVERY_CONTACT: "ops@texassandfest.org",
    OUTREACH_DISCOVERY_OVERPASS_URLS: "https://primary.example/api/interpreter,http://insecure.example/api/interpreter"
  });
  ok("outreach discovery provider safety", fixtureConfig.ready && !productionFixture.ready && productionFixture.reason.includes("not allowed") && !insecureProvider.ready && insecureProvider.reason.includes("HTTPS"));
  const normalized = normalizeOutreachDiscoveryQuery({
    location: "Port Aransas, TX",
    radiusMiles: 25,
    limit: 10,
    categories: ["financial", "retail"]
  });
  const unsupportedCategory = normalizeOutreachDiscoveryQuery({ location: "Port Aransas, TX", radiusMiles: 25, limit: 10, categories: ["financial", 'nwr["amenity"]'] });
  const invalidCoordinates = normalizeOutreachDiscoveryQuery({ latitude: 27.8, radiusMiles: 10, categories: ["retail"] });
  const query = buildOverpassQuery({ ...normalized.query, latitude: 27.8339, longitude: -97.0611 });
  ok("outreach discovery query validation", normalized.ok && normalized.query.categories.join() === "financial,retail" && !unsupportedCategory.ok && !invalidCoordinates.ok && query.includes('nwr["amenity"~"^(bank|credit_union|bureau_de_change)$"]') && !query.includes('nwr["amenity"]\n'));
  const osmCandidates = normalizeOverpassCandidates({ elements: [{
    type: "node",
    id: 42,
    lat: 27.84,
    lon: -97.064,
    tags: { name: "Harbor Community Bank", amenity: "bank", website: "https://bank.example", "addr:city": "Port Aransas", "addr:state": "TX", "addr:postcode": "78373" }
  }] }, { ...normalized.query, latitude: 27.8339, longitude: -97.0611 });
  ok("outreach discovery provider normalization", osmCandidates.length === 1 && osmCandidates[0].sourceRef === "node/42" && osmCandidates[0].sourceUrl.endsWith("/node/42") && osmCandidates[0].industry === "financial");
  const osmConfig = outreachDiscoveryConfig({
    SANDFEST_ENV: "production",
    OUTREACH_DISCOVERY_ENABLED: "true",
    OUTREACH_DISCOVERY_PROVIDER: "openstreetmap",
    OUTREACH_DISCOVERY_SECRET: "platform-osm-discovery-secret-0123456789",
    OUTREACH_DISCOVERY_USER_AGENT: "TexasSandFest-PlatformTests/1.0",
    OUTREACH_DISCOVERY_CONTACT: "ops@texassandfest.org",
    OUTREACH_DISCOVERY_OVERPASS_URLS: "https://primary.example/api/interpreter,https://fallback.example/api/interpreter"
  });
  const providerRequests = [];
  const providerDiscovery = await discoverOutreachBusinesses({
    location: "Pure Adapter Test, TX",
    radiusMiles: 25,
    limit: 10,
    categories: ["financial"]
  }, {
    config: osmConfig,
    fetchImpl: async (url, options = {}) => {
      providerRequests.push({ url: String(url), options });
      if (String(url).includes("nominatim")) {
        return new Response(JSON.stringify([{ lat: "27.8339", lon: "-97.0611", display_name: "Port Aransas, Texas", address: { city: "Port Aransas", state: "Texas", postcode: "78373" } }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(url).includes("primary.example")) return new Response("upstream busy", { status: 504 });
      return new Response(JSON.stringify({ elements: [{ type: "node", id: 43, lat: 27.84, lon: -97.064, tags: { name: "Provider Test Bank", amenity: "bank" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: "2026-07-17T12:00:00.000Z"
  });
  let oversizedProviderRejected = false;
  try {
    await discoverOutreachBusinesses({ latitude: 27.8339, longitude: -97.0611, radiusMiles: 25, limit: 10, categories: ["financial"] }, {
      config: osmConfig,
      fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-length": "2000001" } })
    });
  } catch (error) {
    oversizedProviderRejected = error.message.includes("safety limit");
  }
  let exhaustedProviderDetail = "";
  try {
    await discoverOutreachBusinesses({ latitude: 27.8339, longitude: -97.0611, radiusMiles: 25, limit: 10, categories: ["financial"] }, {
      config: osmConfig,
      fetchImpl: async () => new Response("upstream busy", { status: 503 })
    });
  } catch (error) {
    exhaustedProviderDetail = error.message;
  }
  ok("outreach discovery provider identity and bounds", osmConfig.ready && providerDiscovery.candidates.length === 1 && new URL(providerRequests[0].url).searchParams.get("email") === "ops@texassandfest.org" && providerRequests.every(item => item.options.headers["user-agent"].includes("ops@texassandfest.org")) && oversizedProviderRejected);
  ok("outreach discovery endpoint failover", providerDiscovery.provider?.endpointHost === "fallback.example" && providerDiscovery.provider?.attemptCount === 2 && providerDiscovery.provider?.failedEndpointHosts?.join() === "primary.example" && exhaustedProviderDetail.includes("primary.example") && exhaustedProviderDetail.includes("fallback.example"));
  const discovery = await discoverOutreachBusinesses({
    location: "Port Aransas, TX 78373",
    radiusMiles: 25,
    limit: 10,
    categories: ["lodging", "financial", "retail"]
  }, { config: fixtureConfig, now: "2026-07-17T12:00:00.000Z" });
  const issuedAt = Date.parse("2026-07-17T12:00:00.000Z");
  const preview = issueOutreachDiscoveryPreview(discovery, { config: fixtureConfig, now: issuedAt });
  const tamperedToken = `${preview.previewToken.slice(0, -1)}${preview.previewToken.endsWith("a") ? "b" : "a"}`;
  ok("outreach discovery signed preview", discovery.ok && discovery.candidates.length === 3 && preview.ok && verifyOutreachDiscoveryPreview(preview.previewToken, { config: fixtureConfig, now: issuedAt + 1_000 }).ok && !verifyOutreachDiscoveryPreview(tamperedToken, { config: fixtureConfig, now: issuedAt + 1_000 }).ok && verifyOutreachDiscoveryPreview(preview.previewToken, { config: fixtureConfig, now: issuedAt + 16 * 60 * 1000 }).expired);
  const imported = applyOutreachDiscoveryImport(emptyPartnerOperations(), preview.payload, [discovery.candidates[0].sourceRef], {
    actorId: "outreach_admin",
    idFactory,
    now: "2026-07-17T12:01:00.000Z",
    batchId: "discovery_batch_1"
  });
  const replayed = applyOutreachDiscoveryImport(imported.doc, preview.payload, [discovery.candidates[0].sourceRef], {
    actorId: "outreach_admin",
    idFactory,
    now: "2026-07-17T12:02:00.000Z",
    batchId: "discovery_batch_2"
  });
  const discoveredCampaign = createOutreachCampaign(imported.doc, {
    name: "Discovered coastal businesses",
    targeting: { states: ["TX"], minFitScore: 0 },
    sequence: [{ delayDays: 0, subjectTemplate: "SandFest partnership", bodyTemplate: "Hello {{contactName}}" }]
  }, { actorId: "outreach_admin", idFactory, now: "2026-07-17T12:03:00.000Z" });
  ok("outreach discovery import provenance", imported.ok && imported.created.length === 1 && imported.created[0].status === "identified" && imported.created[0].contactBasis === null && imported.created[0].sourceRef === discovery.candidates[0].sourceRef && imported.created[0].sourceUrl && imported.created[0].sourceFetchedAt === "2026-07-17T12:00:00.000Z");
  ok("outreach discovery review and replay gates", matchOutreachProspects(discoveredCampaign.doc, discoveredCampaign.campaign).length === 0 && replayed.summary.imported === 0 && replayed.summary.duplicates === 1);
  const invalidWebsite = updateOutreachProspect(imported.doc, imported.created[0].id, { website: "javascript:alert(1)" }, { actorId: "outreach_admin", idFactory, now: "2026-07-17T12:04:00.000Z" });
  const researched = updateOutreachProspect(imported.doc, imported.created[0].id, {
    website: "https://verified.example.com",
    contactName: "Jordan Lee",
    contactEmail: "jordan@verified.example.com",
    contactBasis: "business_relevance",
    status: "contact_ready"
  }, { actorId: "outreach_admin", idFactory, now: "2026-07-17T12:04:00.000Z" });
  ok("outreach discovery contact research", !invalidWebsite.ok && researched.ok && researched.prospect.website === "https://verified.example.com" && researched.prospect.contactName === "Jordan Lee");
}

// QuickBooks partner invoice contract and idempotent write IDs
{
  const env = {
    QB_ENVIRONMENT: "sandbox",
    QB_INVOICE_SYNC_ENABLED: "true",
    QB_CLIENT_ID: "client",
    QB_CLIENT_SECRET: "secret",
    QB_REDIRECT_URI: "http://127.0.0.1/callback",
    QB_REALM_ID: "realm-1",
    QB_REFRESH_TOKEN: "refresh",
    QB_MINOR_VERSION: "75"
  };
  ok("QuickBooks invoice readiness gate", quickBooksReadiness(env).canSyncPartnerInvoices === true);
  const requests = [];
  const tokenRotations = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    requests.push({ href, options });
    if (href.includes("/tokens/bearer")) return new Response(JSON.stringify({ access_token: "access", refresh_token: "rotated-private-token" }), { status: 200 });
    if (href.includes("/query")) return new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 });
    if (href.includes("/customer")) return new Response(JSON.stringify({ Customer: { Id: "42", DisplayName: "Gulf Coast Bank" } }), { status: 200 });
    if (href.includes("/invoice/99")) return new Response(JSON.stringify({ Invoice: { Id: "99", DocNumber: "1007", TotalAmt: 15000, Balance: 12000, MetaData: { LastUpdatedTime: "2026-07-16T13:00:00.000Z" } } }), { status: 200 });
    if (href.includes("/invoice")) return new Response(JSON.stringify({ Invoice: { Id: "99", DocNumber: "1007", TotalAmt: 15000, Balance: 15000 } }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const result = await syncPartnerInvoiceToQuickBooks({
    application: {
      id: "sapp_12345678-1234-1234-1234-123456789abc",
      type: "sponsor",
      reference: "TSF-S-000001",
      organizationName: "Gulf Coast Bank",
      contactName: "Avery Rivera",
      contactEmail: "avery@example.com",
      city: "Corpus Christi",
      state: "TX",
      postalCode: "78401"
    },
    invoice: {
      id: "invoice_12345678-1234-1234-1234-123456789abc",
      amountCents: 1500000,
      quickBooksItemId: "77",
      description: "Marlin sponsor package",
      createdAt: "2026-07-16T12:00:00.000Z",
      approvedAt: "2026-07-16T12:00:00.000Z",
      dueAt: "2026-08-15T12:00:00.000Z"
    }
  }, { fetchImpl, onTokenRefresh: token => tokenRotations.push(token.refresh_token) }, env);
  const customerRequest = requests.find(item => item.href.includes("/customer"));
  const invoiceRequest = requests.find(item => item.href.includes("/invoice"));
  const invoiceBody = JSON.parse(invoiceRequest.options.body);
  ok("QuickBooks customer create", result.customerCreated && result.customerId === "42" && customerRequest.href.includes("requestid=sf-customer-"));
  ok("QuickBooks invoice create", result.invoiceId === "99" && invoiceRequest.href.includes("requestid=sf-invoice-") && invoiceBody.Line[0].SalesItemLineDetail.ItemRef.value === "77");
  ok("QuickBooks server amount contract", invoiceBody.Line[0].Amount === 15000 && invoiceBody.CustomerRef.value === "42");
  ok("QuickBooks refresh-token rotation callback precedes accounting writes", tokenRotations.length === 1 && tokenRotations[0] === "rotated-private-token" && !JSON.stringify(result).includes("rotated-private-token"));
  const reconciliation = await reconcilePartnerInvoiceFromQuickBooks({
    invoice: { id: "invoice_12345678-1234-1234-1234-123456789abc", quickBooksInvoiceId: "99" }
  }, { fetchImpl, onTokenRefresh: token => tokenRotations.push(token.refresh_token) }, env);
  const reconciliationRequest = requests.find(item => item.href.includes("/invoice/99"));
  ok("QuickBooks invoice reconciliation reads provider truth", reconciliationRequest.options.method === undefined && reconciliation.totalCents === 1500000 && reconciliation.balanceCents === 1200000 && reconciliation.providerUpdatedAt === "2026-07-16T13:00:00.000Z");
  ok("QuickBooks reconciliation persists rotation without exposing it", tokenRotations.length === 2 && !JSON.stringify(reconciliation).includes("rotated-private-token"));
}

// Transactional email provider gate and Brevo request contract
{
  const disabled = emailConfigFromEnv({ TRANSACTIONAL_EMAIL_ENABLED: "false" });
  ok("transactional email disabled by default", !disabled.ready && publicEmailReadiness(disabled).enabled === false);
  const missing = emailConfigFromEnv({ TRANSACTIONAL_EMAIL_ENABLED: "true", BREVO_API_KEY: "x" });
  ok("transactional email requires sender", !missing.ready && missing.reason.includes("BREVO_SENDER_EMAIL"));
  const productionOverride = emailConfigFromEnv({
    SANDFEST_ENV: "production",
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY: "test-secret",
    BREVO_SENDER_EMAIL: "partners@texassandfest.org",
    BREVO_API_ENDPOINT: "http://127.0.0.1:9998/v3/smtp/email"
  });
  ok("transactional email production origin gate", !productionOverride.ready && productionOverride.reason.includes("official production endpoint"));
  let request = null;
  const config = emailConfigFromEnv({
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_API_KEY: "test-secret",
    BREVO_SENDER_EMAIL: "partners@texassandfest.org",
    BREVO_SENDER_NAME: "Texas SandFest",
    BREVO_REPLY_TO_EMAIL: "info@texassandfest.org"
  });
  const result = await sendTransactionalEmail({
    toEmail: "vendor@example.com",
    toName: "Vendor Contact",
    subject: "Application received",
    textContent: "Thank you for applying.",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    listUnsubscribeUrl: "https://www.texassandfest.org/#outreach-preferences?prospect=p_1&token=tsfu_test"
  }, {
    config,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ messageId: "brevo_msg_1" }), { status: 201, headers: { "content-type": "application/json" } });
    }
  });
  const body = JSON.parse(request.options.body);
  const duplicate = await sendTransactionalEmail({
    toEmail: "vendor@example.com",
    subject: "Application received",
    textContent: "Thank you for applying.",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000"
  }, {
    config,
    fetchImpl: async () => new Response(JSON.stringify({ code: "duplicate_parameter", message: "Idempotency key already used" }), { status: 400, headers: { "content-type": "application/json" } })
  });
  ok("Brevo delivery contract", result.sent && result.providerMessageId === "brevo_msg_1" && request.url.endsWith("/v3/smtp/email"));
  ok("Brevo sender and recipient", body.sender.email === "partners@texassandfest.org" && body.to[0].email === "vendor@example.com");
  ok("Brevo API key header", request.options.headers["api-key"] === "test-secret");
  ok("Brevo list unsubscribe header", body.headers?.["List-Unsubscribe"] === "<https://www.texassandfest.org/#outreach-preferences?prospect=p_1&token=tsfu_test>");
  ok("Brevo idempotency header", body.headers?.["Idempotency-Key"] === "123e4567-e89b-42d3-a456-426614174000");
  ok("Brevo duplicate idempotency response fails closed", !duplicate.sent && duplicate.duplicate === true && duplicate.providerCode === "duplicate_parameter");
}

// Loopback-only board email sandbox
{
  const apiKey = "board-sandbox-test-api-key-0123456789";
  const webhookToken = "board-sandbox-test-webhook-token-0123456789";
  const port = await freePort();
  const webhookEvents = [];
  const config = boardEmailSandboxConfig({
    SANDFEST_BOARD_EMAIL_SANDBOX: "true",
    SANDFEST_BOARD_EMAIL_PORT: String(port),
    SANDFEST_BOARD_EMAIL_DELIVERY_DELAY_MS: "10",
    BOARD_BREVO_API_KEY: apiKey,
    BREVO_WEBHOOK_TOKEN: webhookToken,
    SANDFEST_BOARD_EMAIL_WEBHOOK_URL: "http://127.0.0.1:8806/api/webhooks/brevo"
  }, {
    fetchImpl: async (url, options) => {
      webhookEvents.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const production = boardEmailSandboxConfig({
    SANDFEST_ENV: "production",
    SANDFEST_BOARD_EMAIL_SANDBOX: "true",
    BOARD_BREVO_API_KEY: apiKey,
    BREVO_WEBHOOK_TOKEN: webhookToken,
    SANDFEST_BOARD_EMAIL_WEBHOOK_URL: "http://127.0.0.1:8806/api/webhooks/brevo"
  });
  const remote = boardEmailSandboxConfig({
    SANDFEST_BOARD_EMAIL_SANDBOX: "true",
    BOARD_BREVO_API_KEY: apiKey,
    BREVO_WEBHOOK_TOKEN: webhookToken,
    SANDFEST_BOARD_EMAIL_WEBHOOK_URL: "https://api.example.com/api/webhooks/brevo"
  });
  ok("board email sandbox is reserved-domain and development only", config.ready && !production.ready && !remote.ready && boardEmailSandboxRecipientAllowed("applicant@example.com") && boardEmailSandboxRecipientAllowed("vendor@sandfest.example") && !boardEmailSandboxRecipientAllowed("person@gmail.com"));
  const sandbox = await startBoardEmailSandbox({ config });
  try {
    const sandboxEmailConfig = {
      provider: "brevo",
      ready: true,
      apiKey,
      senderEmail: "sandbox@texassandfest.example",
      senderName: "Texas SandFest Board Demo",
      replyToEmail: "reply@texassandfest.example",
      endpoint: `${sandbox.url}/v3/smtp/email`
    };
    const delivery = await sendTransactionalEmail({
      toEmail: "vendor@example.com",
      toName: "Synthetic Vendor",
      subject: "Board sandbox delivery",
      textContent: "This message remains on the local board-demo machine.",
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000"
    }, { config: sandboxEmailConfig });
    const deliveryReplay = await sendTransactionalEmail({
      toEmail: "vendor@example.com",
      toName: "Synthetic Vendor",
      subject: "Board sandbox delivery",
      textContent: "This message remains on the local board-demo machine.",
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000"
    }, { config: sandboxEmailConfig });
    const reissuedDelivery = await sendTransactionalEmail({
      toEmail: "vendor@example.com",
      toName: "Synthetic Vendor",
      subject: "Board sandbox delivery",
      textContent: "This message remains on the local board-demo machine.",
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174001"
    }, { config: sandboxEmailConfig });
    const rejectedRealRecipient = await fetch(`${sandbox.url}/v3/smtp/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({ sender: { email: "sandbox@texassandfest.example" }, to: [{ email: "person@gmail.com" }], subject: "Reject", textContent: "Reject" })
    });
    const rejectedAttachment = await fetch(`${sandbox.url}/v3/smtp/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({ sender: { email: "sandbox@texassandfest.example" }, to: [{ email: "vendor@example.com" }], subject: "Reject", textContent: "Reject", attachment: [{ name: "file.pdf", content: "AA==" }] })
    });
    for (let attempt = 0; attempt < 30 && webhookEvents.length < 2; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const health = await fetch(`${sandbox.url}/health`).then(response => response.json());
    ok("board email sandbox returns Brevo acceptance and authenticated delivery", delivery.sent && delivery.providerMessageId?.startsWith("board-mail-") && webhookEvents.length === 2 && webhookEvents[0].headers.authorization === `Bearer ${webhookToken}` && webhookEvents[0].body.event === "delivered" && webhookEvents[0].body["message-id"] === delivery.providerMessageId && health.acceptedMessages === 2 && health.deliveryCallbacks === 2);
    ok("board email sandbox converges retries but delivers reissued messages", deliveryReplay.providerMessageId === delivery.providerMessageId && reissuedDelivery.providerMessageId !== delivery.providerMessageId);
    ok("board email sandbox rejects real recipients and attachments", rejectedRealRecipient.status === 422 && rejectedAttachment.status === 422 && health.recipientPolicy === "reserved-example-domains-only");
  } finally {
    await sandbox.close();
  }
}

// Loopback-only board SMS sandbox
{
  const accountSid = "AC00000000000000000000000000000001";
  const authToken = "board-sandbox-twilio-auth-token-0123456789";
  const fromNumber = "+13615550100";
  const recipient = "+13615550188";
  const port = await freePort();
  const callbackEvents = [];
  const config = boardSmsSandboxConfig({
    SANDFEST_BOARD_SMS_SANDBOX: "true",
    SANDFEST_BOARD_SMS_PORT: String(port),
    SANDFEST_BOARD_SMS_DELIVERY_DELAY_MS: "10",
    BOARD_TWILIO_ACCOUNT_SID: accountSid,
    BOARD_TWILIO_AUTH_TOKEN: authToken,
    BOARD_TWILIO_FROM_NUMBER: fromNumber,
    SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL: "http://127.0.0.1:8806/api/webhooks/twilio/inbound/smsSafety"
  }, {
    fetchImpl: async (url, options) => {
      callbackEvents.push({
        url,
        headers: options.headers,
        params: Object.fromEntries(options.body)
      });
      return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });
    }
  });
  const production = boardSmsSandboxConfig({
    SANDFEST_ENV: "production",
    SANDFEST_BOARD_SMS_SANDBOX: "true",
    BOARD_TWILIO_ACCOUNT_SID: accountSid,
    BOARD_TWILIO_AUTH_TOKEN: authToken,
    BOARD_TWILIO_FROM_NUMBER: fromNumber
  });
  const remote = boardSmsSandboxConfig({
    SANDFEST_BOARD_SMS_SANDBOX: "true",
    BOARD_TWILIO_ACCOUNT_SID: accountSid,
    BOARD_TWILIO_AUTH_TOKEN: authToken,
    BOARD_TWILIO_FROM_NUMBER: fromNumber,
    SANDFEST_BOARD_SMS_INBOUND_WEBHOOK_URL: "https://api.example.com/api/webhooks/twilio/inbound/smsSafety"
  });
  ok("board SMS sandbox is reserved-number and development only", config.ready && !production.ready && !remote.ready && boardSmsSandboxRecipientAllowed(recipient) && !boardSmsSandboxRecipientAllowed("+15125551212"));
  const sandbox = await startBoardSmsSandbox({ config });
  try {
    const smsConfig = smsConfigFromEnv({
      SMS_ENABLED: "true",
      TWILIO_ACCOUNT_SID: accountSid,
      TWILIO_AUTH_TOKEN: authToken,
      TWILIO_FROM_NUMBER: fromNumber,
      TWILIO_API_BASE_URL: sandbox.url,
      TWILIO_STATUS_CALLBACK_URL: "http://127.0.0.1:8806/api/webhooks/twilio/status",
      TWILIO_SAFETY_INBOUND_WEBHOOK_URL: "http://127.0.0.1:8806/api/webhooks/twilio/inbound/smsSafety"
    });
    const callbackUrl = smsStatusCallbackUrl(smsConfig, { campaignId: "board-campaign", messageId: "board-message" });
    const delivery = await sendSms(recipient, "SandFest safety sandbox delivery", { config: smsConfig, statusCallbackUrl: callbackUrl });
    const rejectedRealRecipient = await sendSms("+15125551212", "This must be rejected", { config: smsConfig, statusCallbackUrl: callbackUrl });
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const preferenceResponse = await fetch(`${sandbox.url}/simulate/inbound`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basicAuth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ From: recipient, Body: "STOP", SimulationId: "platform-stop-1" })
    });
    const repeatedPreferenceResponse = await fetch(`${sandbox.url}/simulate/inbound`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basicAuth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ From: recipient, Body: "STOP", SimulationId: "platform-stop-2" })
    });
    for (let attempt = 0; attempt < 30 && callbackEvents.length < 3; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const health = await fetch(`${sandbox.url}/health`).then(response => response.json());
    const signedCallbacks = callbackEvents.every(event => verifyTwilioFormRequest({
      signature: event.headers["x-twilio-signature"],
      url: event.url,
      params: event.params
    }, { config: smsConfig }));
    const statusEvent = callbackEvents.find(event => event.params.MessageStatus === "delivered");
    const preferenceEvents = callbackEvents.filter(event => event.params.OptOutType === "STOP");
    ok("board SMS sandbox returns Twilio acceptance and signed delivery", delivery.ok && delivery.sid?.startsWith("SM") && statusEvent?.params.MessageSid === delivery.sid && signedCallbacks && health.acceptedMessages === 1 && health.deliveryCallbacks === 1);
    ok("board SMS sandbox simulates repeatable signed STOP without exposing message data", preferenceResponse.status === 201
      && repeatedPreferenceResponse.status === 201
      && preferenceEvents.length === 2
      && preferenceEvents.every(event => event.params.From === recipient)
      && new Set(preferenceEvents.map(event => event.params.MessageSid)).size === 2
      && health.preferenceCallbacks === 2
      && health.callbackFailures === 0
      && !JSON.stringify(health).includes(recipient));
    ok("board SMS sandbox rejects non-reserved recipients", !rejectedRealRecipient.ok && rejectedRealRecipient.httpStatus === 422 && health.recipientPolicy === "reserved-555-01xx-only");
  } finally {
    await sandbox.close();
  }
}

// Authenticated Brevo delivery outcomes, replay safety, and outreach suppression
{
  const token = "brevo-webhook-test-token-0123456789abcdef";
  const config = brevoWebhookConfig({
    SANDFEST_ENV: "production",
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_WEBHOOK_TOKEN: token,
    SANDFEST_API_PUBLIC_BASE_URL: "https://sandfest-api.heyelab.com"
  });
  const missing = brevoWebhookConfig({
    SANDFEST_ENV: "production",
    TRANSACTIONAL_EMAIL_ENABLED: "true",
    BREVO_WEBHOOK_TOKEN: "short",
    SANDFEST_API_PUBLIC_BASE_URL: "http://127.0.0.1:8806"
  });
  ok("Brevo webhook production readiness", config.ready && config.url === "https://sandfest-api.heyelab.com/api/webhooks/brevo" && !missing.ready);
  ok("Brevo webhook bearer authentication", verifyBrevoWebhookAuthorization({ authorization: `Bearer ${token}` }, config) && !verifyBrevoWebhookAuthorization({ authorization: "Bearer wrong-token" }, config));

  const payloads = [
    { event: "delivered", email: "partner@example.com", id: 701, date: "2026-07-16T12:01:00.000Z", "message-id": "<brevo-message-1>", subject: "Local partnership" },
    { event: "uniqueOpened", email: "partner@example.com", id: 702, ts_event: 1784203380, "message-id": "brevo-message-1", subject: "Local partnership" },
    { event: "click", email: "partner@example.com", id: 703, ts_event: 1784203440, "message-id": "brevo-message-1", subject: "Local partnership" }
  ];
  const normalized = normalizeBrevoWebhookEvents(payloads);
  const single = normalizeBrevoWebhookEvents(payloads[0]);
  const oversized = normalizeBrevoWebhookEvents(Array.from({ length: 101 }, () => payloads[0]));
  const malformed = normalizeBrevoWebhookEvents({ event: "delivered", email: "not-an-email", id: 1, date: "invalid" });
  ok("Brevo single and batch normalization", normalized.ok && normalized.events.map(item => item.deliveryStatus).join(",") === "delivered,opened,clicked" && single.ok && single.events.length === 1);
  ok("Brevo malformed and oversized batches rejected", !oversized.ok && !malformed.ok);

  const base = {
    ...emptyPartnerOperations("texas-sandfest-2027"),
    prospects: [{
      id: "prospect_delivery_test",
      organizationName: "Delivery Test Partner",
      contactName: "Avery",
      contactEmail: "partner@example.com",
      contactBasis: "business_relevance",
      status: "contacted",
      industry: "hospitality",
      city: "Port Aransas",
      state: "TX",
      postalCode: "78373",
      latitude: null,
      longitude: null,
      communityFit: true,
      fitScore: 85,
      fitReasons: ["local business"],
      suppressedAt: null,
      suppressionReason: null,
      createdAt: "2026-07-16T11:00:00.000Z",
      updatedAt: "2026-07-16T11:00:00.000Z"
    }],
    followups: [
      {
        id: "followup_delivery_test",
        prospectId: "prospect_delivery_test",
        campaignId: "campaign_delivery_test",
        sequenceStepId: "step_1",
        kind: "sponsor_outreach",
        recipient: "partner@example.com",
        subject: "Local partnership",
        status: "sent",
        provider: "brevo",
        providerMessageId: "<brevo-message-1>",
        deliveryStatus: "accepted",
        sentAt: "2026-07-16T12:00:00.000Z",
        createdAt: "2026-07-16T11:00:00.000Z",
        updatedAt: "2026-07-16T12:00:00.000Z"
      },
      {
        id: "followup_delivery_next",
        prospectId: "prospect_delivery_test",
        campaignId: "campaign_delivery_test",
        sequenceStepId: "step_2",
        kind: "sponsor_outreach",
        recipient: "partner@example.com",
        subject: "A second message",
        status: "approved",
        createdAt: "2026-07-16T11:30:00.000Z",
        updatedAt: "2026-07-16T11:30:00.000Z"
      }
    ]
  };
  const applied = applyBrevoDeliveryEvents(base, normalized.events, { now: "2026-07-16T12:05:00.000Z" });
  const tracked = applied.doc.followups.find(item => item.id === "followup_delivery_test");
  const replayed = applyBrevoDeliveryEvents(applied.doc, normalized.events, { now: "2026-07-16T12:06:00.000Z" });
  ok("Brevo delivery progression persists", applied.matched === 3 && tracked.deliveryStatus === "clicked" && tracked.deliveredAt && tracked.openedAt && tracked.clickedAt && tracked.deliveryEvents.length === 3);
  ok("Brevo delivery replay is idempotent", replayed.duplicates === 3 && replayed.matched === 0 && replayed.doc.followups.find(item => item.id === tracked.id).deliveryEvents.length === 3);

  const bounce = normalizeBrevoWebhookEvents({ event: "hardBounce", email: "partner@example.com", id: 704, date: "2026-07-16T12:07:00.000Z", "message-id": "brevo-message-1", subject: "Local partnership" });
  const bounced = applyBrevoDeliveryEvents(replayed.doc, bounce.events, { now: "2026-07-16T12:08:00.000Z" });
  const suppressedProspect = bounced.doc.prospects.find(item => item.id === "prospect_delivery_test");
  const canceledNext = bounced.doc.followups.find(item => item.id === "followup_delivery_next");
  ok("Brevo hard bounce suppresses future outreach", bounced.suppressed === 1 && suppressedProspect.status === "do_not_contact" && suppressedProspect.suppressionReason.includes("hard bounce") && canceledNext.status === "dismissed");

  const early = normalizeBrevoWebhookEvents({ event: "delivered", email: "race@example.com", id: 705, date: "2026-07-16T12:09:00.000Z", "message-id": "brevo-race-1", subject: "Race proof" });
  const held = applyBrevoDeliveryEvents(emptyPartnerOperations("texas-sandfest-2027"), early.events, { now: "2026-07-16T12:09:01.000Z" });
  const withSendProof = {
    ...held.doc,
    followups: [{ id: "followup_race", recipient: "race@example.com", subject: "Race proof", status: "sent", provider: "brevo", providerMessageId: "brevo-race-1", sentAt: "2026-07-16T12:09:02.000Z" }]
  };
  const reconciled = applyBrevoDeliveryEvents(withSendProof, [], { now: "2026-07-16T12:09:03.000Z" });
  ok("Brevo early event reconciles after send proof", held.unmatched === 1 && held.pending === 1 && reconciled.matched === 1 && reconciled.pending === 0 && reconciled.doc.followups[0].deliveryStatus === "delivered");
  ok("Brevo receipts minimize unmatched event data", !JSON.stringify(held.doc.brevoWebhookReceipts).includes("race@example.com") && !JSON.stringify(held.doc.brevoWebhookReceipts).includes("brevo-race-1"));
}

// Island weather, ferry, traffic, crowd, and line conditions
{
  const playbackIds = BOARD_CAMERA_PROFILES.map(profile => profile.id);
  const playbackObservation = boardCameraObservation(BOARD_CAMERA_PROFILES[4], {
    cycle: 3,
    runId: "pure-test",
    observedAt: "2026-07-16T12:00:00.000Z"
  });
  const playbackHeartbeat = boardCameraHeartbeat(BOARD_CAMERA_PROFILES[4], {
    cycle: 3,
    runId: "pure-test",
    observedAt: "2026-07-16T12:00:00.000Z"
  });
  const refusesNonBoard = await verifyBoardCameraPlaybackTarget({
    apiBase: "http://127.0.0.1:8806",
    fetchImpl: async () => new Response(JSON.stringify({ runtime: { mode: "production" } }), { status: 200, headers: { "content-type": "application/json" } })
  }).then(() => false, () => true);
  const refusesRemote = await verifyBoardCameraPlaybackTarget({ apiBase: "https://api.example.com" }).then(() => false, () => true);
  const transientPlaybackError = await verifyBoardCameraPlaybackTarget({
    apiBase: "http://127.0.0.1:8806",
    fetchImpl: async () => new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503, headers: { "content-type": "application/json" } })
  }).then(() => null, error => error);
  const playbackCalls = [];
  const playbackSleeps = [];
  const playbackRetries = [];
  const playbackVerifications = [];
  let playbackSuccessfulTicks = 0;
  const resilientPlayback = await runBoardCameraPlayback({
    apiBase: "http://127.0.0.1:8806",
    adminToken: "board-test-token",
    ingestSecret: "board-test-camera-secret-0123456789abcdef",
    runId: "resilience-test",
    intervalMs: 2_000,
    retryBaseMs: 250,
    retryMaxMs: 1_000,
    shouldStop: () => playbackSuccessfulTicks >= 2,
    verifyTargetImpl: async ({ apiBase }) => {
      playbackVerifications.push(apiBase);
      return { apiBase, runtime: { mode: "board_demo", label: "Synthetic board runtime" } };
    },
    tickImpl: async options => {
      playbackCalls.push({ cycle: options.cycle, configure: options.configure });
      if (playbackCalls.length === 2) throw new TypeError("fetch failed");
      return {
        ok: true,
        cycle: options.cycle,
        cameras: 8,
        heartbeats: options.heartbeat ? 8 : 0,
        observedAt: "2026-07-16T12:00:00.000Z",
        observations: BOARD_CAMERA_PROFILES.map(profile => ({ cameraId: profile.id, level: "low" }))
      };
    },
    sleepImpl: async ms => { playbackSleeps.push(ms); },
    onVerified: async detail => { playbackVerifications.push(detail.recovered ? "recovered" : "initial"); },
    onRetry: async detail => { playbackRetries.push({ delayMs: detail.delayMs, cycle: detail.cycle }); },
    onTick: async () => { playbackSuccessfulTicks += 1; }
  });
  ok("board camera playback covers the production fleet", playbackIds.length === 8 && new Set(playbackIds).size === 8 && playbackIds.includes("ferry-loading") && playbackIds.includes("competition-corridor"));
  ok("board camera playback is metrics-only and retry-stable", playbackObservation.eventId === "board-pure-test-north-gate-3" && playbackObservation.sourceId === boardCameraSourceId("north-gate") && playbackObservation.peopleCount > 0 && !JSON.stringify(playbackObservation).includes("rtsp") && !JSON.stringify(playbackObservation).includes("image") && playbackHeartbeat.heartbeatId === "board-pure-test-north-gate-health-3" && playbackHeartbeat.status === "healthy");
  ok("board camera playback refuses production and remote targets", refusesNonBoard && refusesRemote);
  ok("board camera playback retries only transient failures", retryableBoardCameraPlaybackError(transientPlaybackError) && transientPlaybackError?.status === 503 && !retryableBoardCameraPlaybackError(new Error("invalid camera secret")) && boardCameraPlaybackRetryDelay(1, { baseMs: 250, maxMs: 1_000 }) === 250 && boardCameraPlaybackRetryDelay(4, { baseMs: 250, maxMs: 1_000 }) === 1_000);
  ok("board camera playback recovers without advancing the failed cycle", resilientPlayback.successfulTicks === 2 && resilientPlayback.cycle === 2 && playbackCalls.map(item => item.cycle).join(",") === "0,1,1" && playbackCalls.map(item => item.configure).join(",") === "true,false,true" && playbackRetries.length === 1 && playbackRetries[0].delayMs === 250 && playbackRetries[0].cycle === 1 && playbackVerifications.filter(item => item === "http://127.0.0.1:8806").length === 2 && playbackVerifications.includes("recovered") && playbackSleeps.join(",") === "2000,250,2000");
  const low = deriveCameraCondition({ occupancyPct: 20, queueLength: 2, estimatedWaitMinutes: 3 });
  const high = deriveCameraCondition({ occupancyPct: 72, queueLength: 4, estimatedWaitMinutes: 8 });
  ok("camera condition levels", low.level === "low" && high.level === "high");
  ok("condition freshness", freshness("2026-07-16T11:55:00.000Z", "2026-07-16T12:00:00.000Z", 10).state === "live");
  ok("live Island Conditions providers require explicit enablement", !islandConditionsLiveFeedsEnabled({}) && islandConditionsLiveFeedsEnabled({ SANDFEST_ISLAND_CONDITIONS_LIVE_FEEDS_ENABLED: "true" }));
  ok("explicit board official mode enables provider acceptance", islandConditionsLiveFeedsEnabled({}, { boardMode: "official" }));
  const seed = await readJson("data/processed/island-conditions.json");
  const observed = recordCameraObservation(seed, "north-gate", {
    occupancyPct: 70,
    peopleCount: 180,
    flowPerMinute: 28,
    observedAt: "2026-07-16T11:58:00.000Z"
  }, { idFactory: prefix => `${prefix}_test`, now: "2026-07-16T12:00:00.000Z" });
  const conditions = summarizeIslandConditions(observed.doc, "2026-07-16T12:00:00.000Z");
  ok("eight-camera conditions separate fresh signals from live pipelines", conditions.cameras.length === 8 && conditions.summary.freshObservations === 1 && conditions.summary.liveCameras === 0);
  const configured = updateCameraSource(seed, "north-gate", {
    sourceId: "local-north-gate-1",
    status: "configured",
    staleAfterMinutes: 3,
    monitoringEnabled: true
  }, { actorId: "ops_1", now: "2026-07-16T12:00:00.000Z" });
  ok("camera source configuration", configured.ok && configured.camera.sourceId === "local-north-gate-1" && configured.camera.monitoringEnabled && configured.camera.privacyMode === "metrics_only");
  const heartbeat = recordCameraHeartbeat(configured.doc, "north-gate", {
    heartbeatId: "north-heartbeat-0001",
    sourceId: "local-north-gate-1",
    observedAt: "2026-07-16T11:59:30.000Z",
    status: "healthy",
    agentId: "beach-agent-a",
    framesPerSecond: 12.5,
    inferenceLatencyMs: 48,
    droppedFramePct: 0.8,
    agentVersion: "2026.07"
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireMonitoringEnabled: true, requireHeartbeatId: true, requireSourceMatch: true });
  const repeatedHeartbeat = recordCameraHeartbeat(heartbeat.doc, "north-gate", {
    heartbeatId: "north-heartbeat-0001",
    sourceId: "local-north-gate-1",
    observedAt: "2026-07-16T11:59:45.000Z",
    status: "degraded"
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireMonitoringEnabled: true, requireHeartbeatId: true, requireSourceMatch: true });
  ok("camera heartbeat idempotency", heartbeat.ok && heartbeat.health.status === "healthy" && repeatedHeartbeat.duplicate && repeatedHeartbeat.health.status === "healthy");
  const signedObservation = recordCameraObservation(configured.doc, "north-gate", {
    eventId: "north-evt-0001",
    sourceId: "local-north-gate-1",
    observedAt: "2026-07-16T11:59:00.000Z",
    peopleCount: 120,
    occupancyPct: 64,
    confidence: 0.91,
    modelName: "yolo11n"
  }, {
    now: "2026-07-16T12:00:00.000Z",
    idFactory: prefix => `${prefix}_signed`,
    requireConfigured: true,
    requireMonitoringEnabled: true, requireEventId: true,
    requireSourceMatch: true,
    source: "signed-local-inference"
  });
  const duplicateObservation = recordCameraObservation(signedObservation.doc, "north-gate", {
    eventId: "north-evt-0001",
    sourceId: "local-north-gate-1",
    observedAt: "2026-07-16T11:59:00.000Z",
    peopleCount: 999
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireEventId: true, requireSourceMatch: true });
  ok("camera observation idempotency", signedObservation.ok && duplicateObservation.duplicate && duplicateObservation.observation.peopleCount === 120);
  const healthyObservation = recordCameraObservation(heartbeat.doc, "north-gate", {
    eventId: "north-evt-healthy",
    sourceId: "local-north-gate-1",
    observedAt: "2026-07-16T11:59:45.000Z",
    peopleCount: 120,
    occupancyPct: 64
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireMonitoringEnabled: true, requireEventId: true, requireSourceMatch: true });
  const healthyConditions = summarizeIslandConditions(healthyObservation.doc, "2026-07-16T12:00:00.000Z");
  ok("camera operational health", healthyConditions.cameras.find(camera => camera.id === "north-gate")?.operationalStatus === "live" && healthyConditions.summary.armedCameras === 1 && healthyConditions.summary.liveCameras === 1 && healthyConditions.summary.healthyPipelines === 1);
  const degradedHeartbeat = recordCameraHeartbeat(healthyObservation.doc, "north-gate", {
    heartbeatId: "north-heartbeat-0002",
    sourceId: "local-north-gate-1",
    observedAt: "2026-07-16T12:00:00.000Z",
    status: "degraded",
    agentId: "beach-agent-a",
    framesPerSecond: 4.1,
    lastError: "Frame rate below target."
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireMonitoringEnabled: true, requireHeartbeatId: true, requireSourceMatch: true });
  const degradedConditions = summarizeIslandConditions(degradedHeartbeat.doc, "2026-07-16T12:00:00.000Z");
  const offlineConditions = summarizeIslandConditions(healthyObservation.doc, "2026-07-16T12:05:00.000Z");
  ok("camera degraded and offline states", degradedConditions.cameras.find(camera => camera.id === "north-gate")?.operationalStatus === "degraded" && degradedConditions.summary.degradedPipelines === 1 && offlineConditions.cameras.find(camera => camera.id === "north-gate")?.operationalStatus === "offline" && offlineConditions.summary.offlinePipelines === 1);
  const publicConditions = publicIslandConditions(healthyObservation.doc, "2026-07-16T12:00:00.000Z");
  const publicNorth = publicConditions.cameras.find(camera => camera.id === "north-gate");
  ok("camera public privacy contract", !("sourceId" in publicNorth) && !("health" in publicNorth) && !("monitoringEnabled" in publicNorth) && !("modelName" in publicNorth.observation) && !("modelSha256" in publicNorth.observation) && publicNorth.observation.peopleCount === 120);
  const stalePublicNorth = publicIslandConditions(healthyObservation.doc, "2026-07-16T12:05:00.000Z").cameras.find(camera => camera.id === "north-gate");
  const standbyPublicNorth = publicIslandConditions(observed.doc, "2026-07-16T12:00:00.000Z").cameras.find(camera => camera.id === "north-gate");
  ok("camera public metrics fail closed when stale or unarmed", stalePublicNorth.level === "unknown" && stalePublicNorth.observation === null && standbyPublicNorth.observation === null);
  const ferryFallbackSeed = {
    ...seed,
    ferry: {
      status: "awaiting_observation",
      route: "Port Aransas Ferry",
      source: "TxDOT / DriveTexas",
      sourceUrl: "https://www.txdot.gov/discover/ferry-boat-schedules.html",
      observedAt: null,
      estimatedWaitMinutes: null,
      operatingFerries: null
    }
  };
  const armedFerry = updateCameraSource(ferryFallbackSeed, "ferry-loading", {
    sourceId: "txdot-ferry-loading",
    status: "configured",
    monitoringEnabled: true
  }, { actorId: "ops_1", now: "2026-07-16T12:00:00.000Z" });
  const healthyFerry = recordCameraHeartbeat(armedFerry.doc, "ferry-loading", {
    heartbeatId: "ferry-heartbeat-0001",
    sourceId: "txdot-ferry-loading",
    observedAt: "2026-07-16T11:59:30.000Z",
    status: "healthy"
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireMonitoringEnabled: true, requireHeartbeatId: true, requireSourceMatch: true });
  const ferryObserved = recordCameraObservation(healthyFerry.doc, "ferry-loading", {
    eventId: "ferry-evt-0001",
    sourceId: "txdot-ferry-loading",
    observedAt: "2026-07-16T11:59:00.000Z",
    vehicleCount: 48,
    queueLength: 22,
    estimatedWaitMinutes: 17
  }, { now: "2026-07-16T12:00:00.000Z", requireConfigured: true, requireMonitoringEnabled: true, requireEventId: true, requireSourceMatch: true });
  const ferryEstimate = summarizeIslandConditions(ferryObserved.doc, "2026-07-16T12:00:00.000Z").ferry;
  ok("ferry camera estimate", ferryEstimate.status === "camera_estimate" && ferryEstimate.estimatedWaitMinutes === 17 && ferryEstimate.freshness.state === "live");
  const nws = normalizeNwsForecast({ properties: { periods: [{
    temperature: 84, windSpeed: "9 mph", windDirection: "E", shortForecast: "Expired",
    probabilityOfPrecipitation: { value: 5 }, startTime: "2026-07-16T10:00:00.000Z", endTime: "2026-07-16T11:00:00.000Z"
  }, {
    temperature: 88, windSpeed: "12 mph", windDirection: "SE", shortForecast: "Sunny",
    probabilityOfPrecipitation: { value: 10 }, startTime: "2026-07-16T12:00:00.000Z", endTime: "2026-07-16T13:00:00.000Z"
  }] } }, { features: [] }, "2026-07-16T12:00:00.000Z");
  ok("NWS forecast skips expired periods", nws.temperatureF === 88 && nws.status === "live" && nws.validFrom === "2026-07-16T12:00:00.000Z" && nws.validUntil === "2026-07-16T13:00:00.000Z");
  const staleNws = normalizeNwsForecast({ properties: { periods: [{
    temperature: 84, endTime: "2026-07-16T11:00:00.000Z"
  }] } }, { features: [
    { id: "alert-expired", properties: { event: "Expired Heat Advisory", severity: "Moderate", expires: "2026-07-16T11:59:00.000Z" } },
    { id: "alert-current", properties: { event: "Current Heat Advisory", severity: "Moderate", expires: "2026-07-16T13:00:00.000Z" } },
    { id: "alert-no-expiry", properties: { event: "Beach Hazards Statement", severity: "Minor" } }
  ] }, "2026-07-16T12:00:00.000Z");
  ok("NWS expired forecast fails closed while preserving active alerts", staleNws.status === "unavailable" && staleNws.alerts.length === 2 && staleNws.alerts[0]?.event === "Current Heat Advisory" && staleNws.alerts[1]?.event === "Beach Hazards Statement");
  ok("expired persisted weather bypasses the refresh interval", weatherForecastNeedsRefresh({ observedAt: "2026-07-16T11:58:00.000Z", validUntil: "2026-07-16T11:59:00.000Z" }, "2026-07-16T12:00:00.000Z") && !weatherForecastNeedsRefresh({ observedAt: "2026-07-16T11:58:00.000Z", validUntil: "2026-07-16T13:00:00.000Z" }, "2026-07-16T12:00:00.000Z") && !weatherForecastNeedsRefresh({ observedAt: "2026-07-16T11:58:00.000Z", validUntil: null }, "2026-07-16T12:00:00.000Z"));
  const failedFeed = { refreshAttemptedAt: "2026-07-16T11:59:55.000Z", refreshError: "upstream timeout" };
  ok("failed live feed refreshes use a bounded retry interval", !failedFeedRefreshNeedsRetry(failedFeed, "2026-07-16T12:00:00.000Z") && failedFeedRefreshNeedsRetry(failedFeed, "2026-07-16T12:00:05.000Z") && !weatherForecastNeedsRefresh({ ...failedFeed, validUntil: "2026-07-16T11:59:00.000Z" }, "2026-07-16T12:00:00.000Z") && weatherForecastNeedsRefresh({ ...failedFeed, validUntil: "2026-07-16T11:59:00.000Z" }, "2026-07-16T12:00:05.000Z"));
  ok("public condition refresh cadence is cache-aligned and jittered", publicIslandConditionsRefreshDelay(0) === 60_000 && publicIslandConditionsRefreshDelay(0.5) === 67_500 && publicIslandConditionsRefreshDelay(1) === 75_000 && publicIslandConditionsRefreshDelay(2) === 75_000);
  const stalePublicWeather = publicIslandConditions({
    ...seed,
    weather: {
      status: "live",
      observedAt: "2026-07-16T11:58:00.000Z",
      validUntil: "2026-07-16T11:59:00.000Z",
      temperatureF: 99,
      shortForecast: "Expired period",
      alerts: []
    }
  }, "2026-07-16T12:00:00.000Z").weather;
  ok("public Island Conditions hides expired weather values", stalePublicWeather.status === "stale" && stalePublicWeather.freshness.state === "stale" && stalePublicWeather.temperatureF == null && stalePublicWeather.shortForecast == null);
  const publicWeatherAlertFreshness = publicIslandConditions({
    ...seed,
    weather: {
      status: "live",
      observedAt: "2026-07-16T10:00:00.000Z",
      validUntil: "2026-07-16T11:00:00.000Z",
      alerts: [
        { id: "expired", event: "Expired alert", expiresAt: "2026-07-16T11:59:00.000Z", internal: "not public" },
        { id: "future", event: "Current alert", expiresAt: "2026-07-16T13:00:00.000Z", internal: "not public" },
        { id: "unknown-expiry", event: "Old alert without expiry", internal: "not public" }
      ]
    }
  }, "2026-07-16T12:00:00.000Z").weather.alerts;
  ok("public Island Conditions expires stale NWS alerts independently", publicWeatherAlertFreshness.length === 1 && publicWeatherAlertFreshness[0]?.id === "future" && !("internal" in publicWeatherAlertFreshness[0]));
  const ferryFreshnessFixture = {
    ...seed,
    ferry: {
      status: "live",
      route: "Port Aransas Ferry",
      source: "TxDOT Corpus Christi DMS",
      sourceUrl: "https://its.txdot.gov/its/District/CRP/dms-messages",
      observedAt: "2026-07-16T11:30:00.000Z",
      checkedAt: "2026-07-16T11:30:00.000Z",
      estimatedWaitMinutes: 45,
      operatingFerries: 4,
      directions: [{
        id: "to-port-aransas",
        label: "To Port Aransas",
        status: "service_interruption",
        observedAt: "2026-07-16T11:30:00.000Z",
        estimatedWaitMinutes: null,
        notice: "FERRY SERVICE SUSPENDED"
      }]
    }
  };
  const stalePublicFerry = publicIslandConditions(ferryFreshnessFixture, "2026-07-16T12:00:00.000Z").ferry;
  const currentPublicFerry = publicIslandConditions(ferryFreshnessFixture, "2026-07-16T11:40:00.000Z").ferry;
  ok("public Island Conditions hides expired ferry values", stalePublicFerry.status === "stale" && stalePublicFerry.freshness.state === "stale" && stalePublicFerry.estimatedWaitMinutes == null && stalePublicFerry.operatingFerries == null && stalePublicFerry.directions[0]?.status === "stale" && stalePublicFerry.directions[0]?.notice == null && stalePublicFerry.observedAt === "2026-07-16T11:30:00.000Z");
  ok("public Island Conditions preserves current ferry values", currentPublicFerry.status === "live" && currentPublicFerry.estimatedWaitMinutes === 45 && currentPublicFerry.operatingFerries === 4 && currentPublicFerry.directions[0]?.status === "service_interruption" && currentPublicFerry.directions[0]?.notice === "FERRY SERVICE SUSPENDED");
  const txdotPayload = {
    roadwayDmses: {
      SH361AransasPass: [
        {
          icd_Id: "CRP-SH361 at New Port Golf", name: "SH361 at New Port Golf", hasMessages: true,
          statusDescription: "Device Online", messagePages: [{ pageNo: 0, lines: ["FERRY WAIT TO", "ARANSAS PASS", "15 MINUTES"] }]
        },
        {
          icd_Id: "CRP-SH361 at Dale Miller Brdg", name: "SH361 at Dale Miller Bridge", hasMessages: true,
          statusDescription: "Device Online", messagePages: [{ pageNo: 0, lines: ["FERRY WAIT TO", "PORT ARANSAS", "45 MINUTES"] }]
        }
      ],
      IH37: [{
        icd_Id: "CRP-unrelated", name: "Unrelated sign", hasMessages: true,
        statusDescription: "Device Online", messagePages: [{ pageNo: 0, lines: ["FERRY WAIT TO", "PORT ARANSAS", "99 MINUTES"] }]
      }]
    }
  };
  const txdot = normalizeTxdotFerryStatus(txdotPayload, "2026-07-16T12:00:00.000Z");
  ok("TxDOT directional ferry waits", txdot.status === "live" && txdot.estimatedWaitMinutes === 45 && txdot.directions[0].estimatedWaitMinutes === 45 && txdot.directions[1].estimatedWaitMinutes === 15);
  const closedPayload = structuredClone(txdotPayload);
  closedPayload.roadwayDmses.SH361AransasPass[1].messagePages[0].lines = ["PORT ARANSAS", "FERRY SERVICE", "SUSPENDED"];
  const closed = normalizeTxdotFerryStatus(closedPayload, "2026-07-16T12:00:00.000Z");
  ok("TxDOT ferry interruption fails closed", closed.status === "service_interruption" && closed.estimatedWaitMinutes === 15 && closed.directions[0].estimatedWaitMinutes == null);
  const missing = normalizeTxdotFerryStatus({ roadwayDmses: { SH361AransasPass: [] } }, "2026-07-16T12:00:00.000Z");
  ok("TxDOT unknown sign state remains unavailable", missing.status === "unavailable" && missing.estimatedWaitMinutes == null && missing.observedAt == null);
}

// Camera signals become owned incidents without automatic public publication or resolution.
{
  const seed = await readJson("data/processed/island-conditions.json");
  let sequence = 0;
  const idFactory = prefix => `${prefix}_incident_test_${++sequence}`;
  const critical = evaluateCameraObservationIncident(seed, "north-gate", {
    observedAt: "2026-07-16T12:00:00.000Z",
    level: "critical",
    peopleCount: 420,
    occupancyPct: 92,
    queueLength: 22,
    estimatedWaitMinutes: 34
  }, { idFactory, now: "2026-07-16T12:00:00.000Z" });
  ok("critical camera signal opens incident", critical.ok && critical.action === "opened" && critical.incident.status === "open" && critical.incident.severity === "critical" && critical.incident.publicAlertRecommended);
  const repeatedCritical = evaluateCameraObservationIncident(critical.doc, "north-gate", {
    observedAt: "2026-07-16T12:01:00.000Z",
    level: "critical",
    occupancyPct: 94,
    queueLength: 24,
    estimatedWaitMinutes: 36
  }, { idFactory, now: "2026-07-16T12:01:00.000Z" });
  ok("active camera incident is deduplicated", repeatedCritical.doc.incidents.filter(item => item.sourceType === "camera_condition" && item.sourceId === "north-gate").length === 1);

  const firstHigh = evaluateCameraObservationIncident(seed, "food-court", {
    observedAt: "2026-07-16T12:00:00.000Z", level: "high", occupancyPct: 70, queueLength: 10
  }, { idFactory, now: "2026-07-16T12:00:00.000Z" });
  const secondHigh = evaluateCameraObservationIncident(firstHigh.doc, "food-court", {
    observedAt: "2026-07-16T12:02:00.000Z", level: "high", occupancyPct: 72, queueLength: 11
  }, { idFactory, now: "2026-07-16T12:02:00.000Z" });
  ok("high camera signal uses debounce", !firstHigh.incident && firstHigh.action === "signal-recorded" && secondHigh.action === "opened" && secondHigh.incident.severity === "high");

  let recovered = repeatedCritical;
  for (let index = 0; index < 3; index += 1) {
    recovered = evaluateCameraObservationIncident(recovered.doc, "north-gate", {
      observedAt: `2026-07-16T12:0${index + 2}:00.000Z`, level: "low", occupancyPct: 18, queueLength: 2, estimatedWaitMinutes: 3
    }, { idFactory, now: `2026-07-16T12:0${index + 2}:00.000Z` });
  }
  ok("camera recovery requires three signals and human close", recovered.action === "monitoring" && recovered.incident.status === "monitoring" && !recovered.incident.resolvedAt);
  const reopened = evaluateCameraObservationIncident(recovered.doc, "north-gate", {
    observedAt: "2026-07-16T12:06:00.000Z", level: "critical", occupancyPct: 96, queueLength: 27, estimatedWaitMinutes: 40
  }, { idFactory, now: "2026-07-16T12:06:00.000Z" });
  ok("critical regression reopens response", reopened.action === "reopened" && reopened.incident.status === "responding");
  const rejectedClose = updateOperationsIncident(reopened.doc, reopened.incident.id, { status: "resolved" }, { actorId: "ops_1", now: "2026-07-16T12:07:00.000Z" });
  const resolved = updateOperationsIncident(reopened.doc, reopened.incident.id, { status: "resolved", resolution: "Traffic team reopened the secondary lane." }, { actorId: "ops_1", now: "2026-07-16T12:07:00.000Z" });
  ok("incident close requires operator resolution", !rejectedClose.ok && resolved.ok && resolved.incident.status === "resolved" && resolved.incident.resolvedBy === "ops_1");

  const healthError = evaluateCameraHealthIncident(seed, "south-gate", {
    observedAt: "2026-07-16T12:00:00.000Z", status: "error", lastError: "Inference process exited."
  }, { idFactory, now: "2026-07-16T12:00:00.000Z" });
  ok("camera pipeline error opens private incident", healthError.action === "opened" && healthError.incident.sourceType === "camera_health" && !healthError.incident.publicAlertRecommended);
  let healthy = healthError;
  for (let index = 0; index < 3; index += 1) {
    healthy = evaluateCameraHealthIncident(healthy.doc, "south-gate", {
      observedAt: `2026-07-16T12:0${index + 1}:00.000Z`, status: "healthy", framesPerSecond: 12
    }, { idFactory, now: `2026-07-16T12:0${index + 1}:00.000Z` });
  }
  ok("camera pipeline recovery enters monitoring", healthy.action === "monitoring" && healthy.incident.status === "monitoring");

  const manual = createOperationsIncident(seed, {
    sourceType: "operator",
    sourceId: "operator-demo-access",
    title: "South access route adjustment",
    summary: "Traffic team is routing arrivals through the north approach.",
    severity: "moderate",
    ownerTeam: "traffic",
    ownerName: "Traffic desk",
    publicImpact: true
  }, { actorId: "ops_1", idFactory, now: "2026-07-16T12:00:00.000Z" });
  const publicPayload = publicIslandConditions(manual.doc, "2026-07-16T12:00:00.000Z");
  const notice = publicPayload.notices[0];
  const incidentSummary = summarizeOperationsIncidents(manual.doc);
  ok("operator incident and summary", manual.ok && incidentSummary.active === 1 && incidentSummary.publicNotices === 1);
  ok("public incident notice is privacy minimized", notice?.title === manual.incident.title && !Object.hasOwn(notice, "ownerName") && !Object.hasOwn(notice, "timeline") && !Object.hasOwn(notice, "sourceType"));
}

// Incident dispatch assignments and reviewed delivery stay durable and idempotent.
{
  const seed = await readJson("data/processed/island-conditions.json");
  let sequence = 0;
  const idFactory = prefix => `${prefix}_dispatch_test_${++sequence}`;
  const incident = createOperationsIncident(seed, {
    sourceType: "operator",
    sourceId: "dispatch-pure-test",
    title: "South gate pedestrian backup",
    summary: "Open the secondary pedestrian lane.",
    severity: "high",
    ownerTeam: "traffic"
  }, { actorId: "ops_1", idFactory, now: "2026-07-16T12:00:00.000Z" });
  const dispatched = createIncidentDispatch(incident.doc, incident.incident.id, {
    assigneeType: "team",
    assigneeId: "traffic",
    assigneeName: "Traffic and parking",
    title: "Open secondary pedestrian lane",
    instructions: "Place two volunteers at the lane split and report queue depth.",
    channel: "email",
    recipientEmail: "traffic@texassandfest.org"
  }, { actorId: "ops_1", idFactory, now: "2026-07-16T12:01:00.000Z" });
  const duplicate = createIncidentDispatch(dispatched.doc, incident.incident.id, {
    assigneeType: "team",
    assigneeId: "traffic",
    assigneeName: "Traffic and parking",
    channel: "email",
    recipientEmail: "traffic@texassandfest.org"
  }, { actorId: "ops_1", idFactory, now: "2026-07-16T12:02:00.000Z" });
  ok("incident dispatch assignment is idempotent", dispatched.ok && dispatched.dispatch.notification.status === "draft_ready" && duplicate.duplicate && duplicate.doc.dispatches.length === 1);
  ok("incident dispatch assigns owner", dispatched.incident.ownerName === "Traffic and parking" && dispatched.incident.ownerTeam === "traffic");

  const dispatchTaskRecipients = [{ id: "traffic", assigneeType: "team", name: "Avery Brooks", email: "traffic@texassandfest.org", status: "active" }];
  const changedTeamRoute = reviewIncidentDispatchMessage(dispatched.doc, dispatched.dispatch.id, "approve", { actorId: "ops_2", taskRecipients: [{ ...dispatchTaskRecipients[0], email: "changed@texassandfest.org" }], now: "2026-07-16T12:03:00.000Z" });
  const approved = reviewIncidentDispatchMessage(dispatched.doc, dispatched.dispatch.id, "approve", { actorId: "ops_2", taskRecipients: dispatchTaskRecipients, now: "2026-07-16T12:03:00.000Z" });
  const edited = updateIncidentDispatch(approved.doc, dispatched.dispatch.id, {
    subject: "[SandFest high] South gate lane response",
    body: `${approved.dispatch.notification.body}\n\nUse radio channel 3.`
  }, { actorId: "ops_2", now: "2026-07-16T12:04:00.000Z" });
  ok("dispatch message edit resets approval", approved.dispatch.notification.status === "approved" && edited.dispatch.notification.status === "draft_ready" && edited.dispatch.notification.version === 2 && !edited.dispatch.notification.approvedAt);
  ok("dispatch team recipient is revalidated", !changedTeamRoute.ok && changedTeamRoute.error.includes("email changed"));
  const reapproved = reviewIncidentDispatchMessage(edited.doc, dispatched.dispatch.id, "approve", { actorId: "ops_2", taskRecipients: dispatchTaskRecipients, now: "2026-07-16T12:05:00.000Z" });
  const queued = queueIncidentDispatchMessage(reapproved.doc, dispatched.dispatch.id, { actorId: "ops_2", taskRecipients: dispatchTaskRecipients, now: "2026-07-16T12:06:00.000Z" });
  const retrying = recordIncidentDispatchDelivery(queued.doc, dispatched.dispatch.id, { sent: false, provider: "brevo", error: "temporary failure" }, { terminal: false, now: "2026-07-16T12:07:00.000Z" });
  const sent = recordIncidentDispatchDelivery(retrying.doc, dispatched.dispatch.id, { sent: true, provider: "brevo", providerMessageId: "dispatch_msg_1" }, { now: "2026-07-16T12:08:00.000Z" });
  ok("dispatch delivery retry and proof", queued.dispatch.notification.status === "queued" && retrying.dispatch.notification.status === "queued" && sent.dispatch.notification.status === "sent" && sent.dispatch.notification.providerMessageId === "dispatch_msg_1" && sent.dispatch.notification.deliveryAttempts === 2);

  const volunteerIncident = createOperationsIncident(seed, {
    sourceType: "operator", sourceId: "volunteer-dispatch-test", title: "Guest services line support", severity: "moderate"
  }, { actorId: "ops_1", idFactory, now: "2026-07-16T12:00:00.000Z" });
  const volunteerDispatch = createIncidentDispatch(volunteerIncident.doc, volunteerIncident.incident.id, {
    assigneeType: "volunteer",
    assigneeId: "vol_1",
    assigneeName: "Jamie Volunteer",
    channel: "email",
    recipientEmail: "jamie@example.com"
  }, { actorId: "ops_1", idFactory, now: "2026-07-16T12:01:00.000Z" });
  const validVolunteer = resolveIncidentDispatchRecipient(volunteerDispatch.doc, volunteerDispatch.dispatch.id, { volunteers: [{ id: "vol_1", name: "Jamie Volunteer", email: "jamie@example.com", status: "active" }] });
  const changedVolunteer = resolveIncidentDispatchRecipient(volunteerDispatch.doc, volunteerDispatch.dispatch.id, { volunteers: [{ id: "vol_1", name: "Jamie Volunteer", email: "new@example.com", status: "active" }] });
  ok("dispatch volunteer recipient is revalidated", validVolunteer.ok && !changedVolunteer.ok && changedVolunteer.error.includes("email changed"));

  const closed = updateOperationsIncident(volunteerDispatch.doc, volunteerIncident.incident.id, {
    status: "resolved",
    resolution: "Guest services line returned to normal."
  }, { actorId: "ops_1", now: "2026-07-16T12:09:00.000Z" });
  const closedDispatch = closed.doc.dispatches.find(item => item.id === volunteerDispatch.dispatch.id);
  const summary = summarizeIncidentDispatches(closed.doc);
  ok("incident close cancels active dispatch and draft", closed.canceledDispatches === 1 && closedDispatch.status === "canceled" && closedDispatch.notification.status === "canceled" && summary.active === 0);
}

// Signed local camera metric ingestion
{
  const sharedDevelopmentConfig = cameraIngestConfig({
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_SECRET: "0123456789abcdef0123456789abcdef",
    CAMERA_INGEST_MAX_SKEW_SECONDS: "300"
  });
  const productionSharedConfig = cameraIngestConfig({
    SANDFEST_ENV: "production",
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_SECRET: "0123456789abcdef0123456789abcdef"
  });
  const config = cameraIngestConfig({
    SANDFEST_ENV: "production",
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_KEYS: SMOKE_CAMERA_KEYS,
    CAMERA_INGEST_REQUIRED_CAMERA_IDS: "north-gate,south-gate",
    CAMERA_INGEST_MAX_SKEW_SECONDS: "300"
  });
  const incompleteProductionConfig = cameraIngestConfig({
    SANDFEST_ENV: "production",
    CAMERA_INGEST_ENABLED: "true",
    CAMERA_INGEST_KEYS: SMOKE_CAMERA_KEYS
  });
  const readiness = publicCameraIngestReadiness(config);
  const rawBody = JSON.stringify({ eventId: "camera-event-1", peopleCount: 42 });
  const timestamp = String(Date.parse("2026-07-16T12:00:00.000Z") / 1000);
  const signature = signCameraPayload(rawBody, timestamp, SMOKE_CAMERA_SECRET, { keyId: SMOKE_CAMERA_KEY_ID });
  const verified = verifyCameraIngestSignature({ rawBody, timestamp, signature: `sha256=${signature}`, keyId: SMOKE_CAMERA_KEY_ID, cameraId: "north-gate" }, {
    config,
    nowMs: Date.parse("2026-07-16T12:01:00.000Z")
  });
  const stale = verifyCameraIngestSignature({ rawBody, timestamp, signature, keyId: SMOKE_CAMERA_KEY_ID, cameraId: "north-gate" }, {
    config,
    nowMs: Date.parse("2026-07-16T12:10:00.000Z")
  });
  const crossCamera = verifyCameraIngestSignature({ rawBody, timestamp, signature, keyId: SMOKE_CAMERA_KEY_ID, cameraId: "south-gate" }, {
    config,
    nowMs: Date.parse("2026-07-16T12:01:00.000Z")
  });
  const rotationSignature = signCameraPayload(rawBody, timestamp, SMOKE_CAMERA_NEXT_SECRET, { keyId: SMOKE_CAMERA_NEXT_KEY_ID });
  const rotationVerified = verifyCameraIngestSignature({ rawBody, timestamp, signature: rotationSignature, keyId: SMOKE_CAMERA_NEXT_KEY_ID, cameraId: "north-gate" }, {
    config,
    nowMs: Date.parse("2026-07-16T12:01:00.000Z")
  });
  const unknownKey = verifyCameraIngestSignature({ rawBody, timestamp, signature, keyId: "north-gate-unknown", cameraId: "north-gate" }, {
    config,
    nowMs: Date.parse("2026-07-16T12:01:00.000Z")
  });
  const missingKey = verifyCameraIngestSignature({ rawBody, timestamp, signature, cameraId: "north-gate" }, {
    config,
    nowMs: Date.parse("2026-07-16T12:01:00.000Z")
  });
  ok("camera shared credential remains development-only", sharedDevelopmentConfig.ready && sharedDevelopmentConfig.mode === "shared-development" && !productionSharedConfig.ready);
  ok("camera per-source production readiness", config.ready && config.mode === "per-camera" && cameraCredentialReadiness(config, "north-gate").keyCount === 2 && !cameraCredentialReadiness(config, "food-court").ready);
  ok("camera production readiness requires full fleet coverage", !incompleteProductionConfig.ready && incompleteProductionConfig.missingCameraIds.includes("food-court"));
  ok("camera public readiness is secret-free", readiness.credentialCount === 3 && readiness.cameraCount === 2 && readiness.requiredCameraCount === 2 && readiness.missingCameraIds.length === 0 && readiness.rotatingCameraIds.includes("north-gate") && !JSON.stringify(readiness).includes(SMOKE_CAMERA_SECRET));
  ok("camera HMAC verification", verified.verified && verified.ageSeconds === 60);
  ok("camera HMAC replay window", !stale.verified && stale.reason === "timestamp_outside_window");
  ok("camera credential is route-bound", !crossCamera.verified && crossCamera.reason === "credential_camera_mismatch");
  ok("camera rotation overlap verifies", rotationVerified.verified && rotationVerified.keyId === SMOKE_CAMERA_NEXT_KEY_ID);
  ok("camera unknown and missing keys fail closed", unknownKey.reason === "unknown_key_id" && missingKey.reason === "missing_key_id");
}

// Enterprise hardening helpers
{
  ok("html escape", escapeHtml(`<img src=x onerror=alert(1)>`) === "&lt;img src=x onerror=alert(1)&gt;");
  const dir = await mkdtemp(path.join(tmpdir(), "sandfest-lock-"));
  const file = path.join(dir, "counter.json");
  await Promise.all(
    Array.from({ length: 20 }, () =>
      updateJsonFile(file, cur => {
        const n = (cur && cur.n) || 0;
        return { n: n + 1 };
      }, { fallback: { n: 0 } })
    )
  );
  const final = JSON.parse(await readFile(file, "utf8"));
  ok("atomic mutex counter", final.n === 20, `got ${final.n}`);
  await writeFile(file, '{"n":0}\n', "utf8");
  const safeJsonModule = pathToFileURL(path.join(ROOT, "lib", "safe-json-store.mjs")).href;
  const childSource = `
    import { updateJsonFile } from ${JSON.stringify(safeJsonModule)};
    const file = process.env.SANDFEST_SAFE_JSON_TEST_FILE;
    const increments = Number(process.env.SANDFEST_SAFE_JSON_TEST_INCREMENTS);
    for (let index = 0; index < increments; index += 1) {
      await updateJsonFile(file, async current => {
        await new Promise(resolve => setTimeout(resolve, 2));
        return { n: Number(current?.n || 0) + 1 };
      }, { fallback: { n: 0 } });
    }
  `;
  const runCounter = increments => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
      cwd: ROOT,
      env: {
        ...process.env,
        SANDFEST_SAFE_JSON_TEST_FILE: file,
        SANDFEST_SAFE_JSON_TEST_INCREMENTS: String(increments)
      },
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Safe JSON counter exited ${code}: ${stderr}`)));
  });
  await Promise.all(Array.from({ length: 4 }, () => runCounter(25)));
  const interprocessFinal = JSON.parse(await readFile(file, "utf8"));
  ok("interprocess file mutex counter", interprocessFinal.n === 100, `got ${interprocessFinal.n}`);
  await mkdir(`${file}.lock`);
  await writeFile(path.join(`${file}.lock`, "owner.json"), JSON.stringify({ pid: 2_147_483_647, token: "stale-test" }), "utf8");
  await updateJsonFile(file, current => ({ n: current.n + 1 }));
  const recoveredFinal = JSON.parse(await readFile(file, "utf8"));
  ok("interprocess file mutex recovers a dead owner", recoveredFinal.n === 101, `got ${recoveredFinal.n}`);
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nPure suite: ${passed} passed, ${failed} failed\n`);

if (!wantApi) {
  if (failed) process.exit(1);
  console.log("Skip live API (pass --api to smoke-test endpoints).\n");
  process.exit(0);
}

// Live API smoke
console.log("=== Live API smoke ===\n");
let child = null;
let isolatedRuntimeRoot = null;
let isolatedJobQueueDir = null;
let isolatedAuditDir = null;
let isolatedPartnerAssetDir = null;
let isolatedIncomingDocumentDir = null;
let isolatedCommerceDir = null;
let stripeMock = null;
let turnstileMock = null;
let twilioMock = null;
let quickBooksMock = null;
let apiChildEnv = null;
if (!API_BASE) {
  const port = process.env.SANDFEST_API_PORT || String(await freePort());
  API_BASE = `http://127.0.0.1:${port}`;
  isolatedJobQueueDir = await mkdtemp(path.join(tmpdir(), "sandfest-api-smoke-jobs-"));
  isolatedAuditDir = await mkdtemp(path.join(tmpdir(), "sandfest-api-smoke-audit-"));
  isolatedPartnerAssetDir = await mkdtemp(path.join(tmpdir(), "sandfest-api-smoke-brand-assets-"));
  isolatedIncomingDocumentDir = await mkdtemp(path.join(tmpdir(), "sandfest-api-smoke-incoming-documents-"));
  isolatedCommerceDir = await mkdtemp(path.join(tmpdir(), "sandfest-api-smoke-commerce-"));
  isolatedRuntimeRoot = await mkdtemp(path.join(tmpdir(), "sandfest-api-smoke-runtime-"));
  await cp(path.join(ROOT, "data"), path.join(isolatedRuntimeRoot, "data"), { recursive: true });
  const isolatedAdminConfigPath = path.join(isolatedRuntimeRoot, "data", "config", "admin-config.json");
  const isolatedAdminConfig = JSON.parse(await readFile(isolatedAdminConfigPath, "utf8"));
  isolatedAdminConfig.vendorOfferings = structuredClone(BOARD_DEMO_VENDOR_OFFERINGS);
  await writeFile(isolatedAdminConfigPath, `${JSON.stringify(isolatedAdminConfig, null, 2)}\n`);
  const isolatedPartnerPath = path.join(isolatedRuntimeRoot, "data", "processed", "partner-operations.json");
  const isolatedSmsPath = path.join(isolatedRuntimeRoot, "data", "processed", "sms-operations.json");
  const isolatedConsentPath = path.join(isolatedRuntimeRoot, "data", "processed", "consent-ledger.json");
  const isolatedVolunteerPath = path.join(isolatedRuntimeRoot, "data", "processed", "volunteer-mirror.json");
  const isolatedBoothPath = path.join(isolatedRuntimeRoot, "data", "processed", "booth-map.json");
  const isolatedIncomingDocumentPath = path.join(isolatedRuntimeRoot, "data", "processed", "incoming-documents.json");
  const isolatedPassportPath = path.join(isolatedRuntimeRoot, "data", "processed", "sculpture-passport.json");
  const isolatedPassportCompletionsPath = path.join(isolatedRuntimeRoot, "data", "processed", "passport-completions.json");
  const isolatedVotingPath = path.join(isolatedRuntimeRoot, "data", "processed", "peoples-choice.json");
  const isolatedConsent = JSON.parse(await readFile(isolatedConsentPath, "utf8"));
  const isolatedVolunteers = JSON.parse(await readFile(isolatedVolunteerPath, "utf8"));
  const isolatedBooths = JSON.parse(await readFile(isolatedBoothPath, "utf8"));
  const apiDemoRoster = await readJson("src/board-demo/sculptors-demo.json");
  const apiEngagement = boardDemoEngagement(apiDemoRoster, {
    eventId: DEFAULT_EVENT_ID,
    hunt: {
      id: DEFAULT_HUNT_ID,
      eventId: DEFAULT_EVENT_ID,
      name: "Sculpture Passport API fixture",
      startsAt: "2027-04-16T09:00:00-05:00",
      endsAt: "2027-04-18T19:30:00-05:00",
      active: true
    },
    now: "2026-07-18T00:00:00.000Z"
  });
  await Promise.all([
    writeFile(isolatedPartnerPath, `${JSON.stringify(emptyPartnerOperations(DEFAULT_EVENT_ID), null, 2)}\n`, "utf8"),
    writeFile(isolatedSmsPath, `${JSON.stringify(emptySmsOperations(DEFAULT_EVENT_ID), null, 2)}\n`, "utf8"),
    writeFile(isolatedConsentPath, `${JSON.stringify({
      ...isolatedConsent,
      eventId: DEFAULT_EVENT_ID,
      records: (isolatedConsent.records || []).map(record => ({ ...record, eventId: DEFAULT_EVENT_ID }))
    }, null, 2)}\n`, "utf8"),
    writeFile(isolatedVolunteerPath, `${JSON.stringify({
      ...isolatedVolunteers,
      eventId: DEFAULT_EVENT_ID,
      volunteers: (isolatedVolunteers.volunteers || []).map(item => ({ ...item, eventId: DEFAULT_EVENT_ID })),
      shifts: (isolatedVolunteers.shifts || []).map(item => ({ ...item, eventId: DEFAULT_EVENT_ID })),
      hourLogs: (isolatedVolunteers.hourLogs || []).map(item => ({ ...item, eventId: DEFAULT_EVENT_ID }))
    }, null, 2)}\n`, "utf8"),
    writeFile(isolatedBoothPath, `${JSON.stringify({
      ...isolatedBooths,
      eventId: DEFAULT_EVENT_ID,
      booths: (isolatedBooths.booths || []).map(item => ({ ...item, eventId: DEFAULT_EVENT_ID })),
      vendors: (isolatedBooths.vendors || []).map(item => ({ ...item, eventId: DEFAULT_EVENT_ID })),
      imports: []
    }, null, 2)}\n`, "utf8"),
    writeFile(isolatedIncomingDocumentPath, `${JSON.stringify(emptyIncomingDocumentIntake(DEFAULT_EVENT_ID), null, 2)}\n`, "utf8"),
    writeFile(isolatedPassportPath, `${JSON.stringify(apiEngagement.passportHunt, null, 2)}\n`, "utf8"),
    writeFile(isolatedPassportCompletionsPath, `${JSON.stringify({ ...apiEngagement.passportCompletions, completions: [] }, null, 2)}\n`, "utf8"),
    writeFile(isolatedVotingPath, `${JSON.stringify({
      ...apiEngagement.voting,
      publicationStatus: "published",
      source: "reviewed_current_roster",
      votes: []
    }, null, 2)}\n`, "utf8")
  ]);
  stripeMock = await startStripeMock();
  turnstileMock = await startTurnstileMock();
  twilioMock = await startTwilioMock();
  quickBooksMock = await startQuickBooksMock();
  apiChildEnv = {
      ...process.env,
      NODE_ENV: "test",
      SANDFEST_ENV: "development",
      SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS: "3600000",
      SANDFEST_API_PORT: port,
      SANDFEST_RUNTIME_ROOT: isolatedRuntimeRoot,
      SANDFEST_ADMIN_API_TOKEN: TOKEN,
      SANDFEST_ADMIN_RATE_LIMIT: "1000",
      SANDFEST_PUBLIC_WRITE_RATE_LIMIT: "500",
      SANDFEST_PARTNER_STATUS_RATE_LIMIT: "200",
      CAMERA_INGEST_ENABLED: "true",
      CAMERA_INGEST_KEYS: SMOKE_CAMERA_KEYS,
      CAMERA_INGEST_SECRET: "",
      STRIPE_TICKETING_ENABLED: "true",
      STRIPE_PARTNER_PAYMENTS_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_platform_partner",
      STRIPE_WEBHOOK_SECRET: SMOKE_STRIPE_WEBHOOK_SECRET,
      STRIPE_SUCCESS_URL: "https://www.texassandfest.org/tickets/success?session_id={CHECKOUT_SESSION_ID}",
      STRIPE_CANCEL_URL: "https://www.texassandfest.org/#tickets",
      STRIPE_PARTNER_SUCCESS_URL: "https://www.texassandfest.org/#partner-payment-success?session_id={CHECKOUT_SESSION_ID}",
      STRIPE_PARTNER_CANCEL_URL: "https://www.texassandfest.org/#partner-status",
      STRIPE_API_BASE_URL: stripeMock.baseUrl,
      TRANSACTIONAL_EMAIL_ENABLED: "false",
      SMS_ENABLED: "true",
      TWILIO_ACCOUNT_SID: "AC_platform_smoke",
      TWILIO_AUTH_TOKEN: "platform-twilio-auth-secret",
      TWILIO_FROM_NUMBER: "+15125550000",
      TWILIO_API_BASE_URL: twilioMock.baseUrl,
      TWILIO_STATUS_CALLBACK_URL: `${API_BASE}/api/webhooks/twilio/status`,
      TWILIO_SAFETY_INBOUND_WEBHOOK_URL: `${API_BASE}/api/webhooks/twilio/inbound/smsSafety`,
      TWILIO_MARKETING_INBOUND_WEBHOOK_URL: `${API_BASE}/api/webhooks/twilio/inbound/smsMarketing`,
      BREVO_WEBHOOK_TOKEN: SMOKE_BREVO_WEBHOOK_TOKEN,
      SANDFEST_PARTNER_PORTAL_SECRET: "platform-smoke-partner-portal-secret-0123456789",
      SANDFEST_OUTREACH_PREFERENCES_SECRET: "platform-smoke-outreach-preferences-secret-0123456789",
      SANDFEST_DOCUMENT_EXTRACTION_SECRET: SMOKE_DOCUMENT_EXTRACTION_SECRET,
      OUTREACH_DISCOVERY_ENABLED: "true",
      OUTREACH_DISCOVERY_PROVIDER: "fixture",
      QB_ENVIRONMENT: "sandbox",
      QB_INVOICE_SYNC_ENABLED: "false",
      QB_CLIENT_ID: "platform-smoke-quickbooks-client",
      QB_CLIENT_SECRET: "platform-smoke-quickbooks-secret",
      QB_REDIRECT_URI: `${API_BASE}/api/integrations/quickbooks/callback`,
      QB_TOKEN_ENCRYPTION_KEY: "platform-smoke-quickbooks-encryption-key-0123456789",
      QB_TOKEN_URL: quickBooksMock.tokenUrl,
      QB_REALM_ID: "",
      QB_REFRESH_TOKEN: "",
      SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org",
      SANDFEST_TURNSTILE_ENABLED: "true",
      SANDFEST_TURNSTILE_SECRET_KEY: "turnstile-smoke-secret-0123456789",
      SANDFEST_TURNSTILE_HOSTNAME: "www.texassandfest.org",
      SANDFEST_TURNSTILE_SITEVERIFY_URL: turnstileMock.url,
      SANDFEST_JOB_QUEUE_DIR: isolatedJobQueueDir,
      SANDFEST_AUDIT_DIR: isolatedAuditDir,
      SANDFEST_ORDER_DIR: path.join(isolatedCommerceDir, "orders"),
      SANDFEST_PAYMENT_EVENT_DIR: path.join(isolatedCommerceDir, "payment-events"),
      SANDFEST_FULFILLMENT_DIR: path.join(isolatedCommerceDir, "fulfillment"),
      SANDFEST_PARTNER_ASSET_DIR: isolatedPartnerAssetDir,
      SANDFEST_INCOMING_DOCUMENT_DIR: isolatedIncomingDocumentDir
  };
  child = spawn("node", ["scripts/admin-api-server.mjs"], {
    cwd: ROOT,
    env: apiChildEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("API start timeout")), 8000);
    child.stdout.on("data", buf => {
      if (String(buf).includes("listening")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.stderr.on("data", buf => process.stderr.write(buf));
    child.on("exit", code => reject(new Error(`API exited ${code}`)));
  });
}

async function hit(method, pathName, body, auth = false, extraHeaders = {}) {
  const headers = { "content-type": "application/json", ...extraHeaders };
  if (auth) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function hitRaw(method, pathName, body, headers = {}, auth = false) {
  const requestHeaders = { ...headers };
  if (auth) requestHeaders.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}${pathName}`, { method, headers: requestHeaders, body });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

async function hitTwilioForm(pathName, params, publicUrl, { signature = null } = {}) {
  const body = new URLSearchParams(params).toString();
  const signed = signature || twilio.getExpectedTwilioSignature(
    "platform-twilio-auth-secret",
    publicUrl,
    Object.fromEntries(new URLSearchParams(body))
  );
  return hitRaw("POST", pathName, body, {
    "content-type": "application/x-www-form-urlencoded",
    "x-twilio-signature": signed
  });
}

async function runSmokeWorkerOnce(environment = {}) {
  const worker = spawn("node", ["scripts/worker.mjs"], {
    cwd: ROOT,
    env: { ...apiChildEnv, SANDFEST_WORKER_ONCE: "true", SANDFEST_WORKER_BATCH: "25", ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  worker.stdout.on("data", chunk => { stdout += String(chunk); });
  worker.stderr.on("data", chunk => { stderr += String(chunk); });
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.kill("SIGKILL");
      reject(new Error("Worker smoke timeout"));
    }, 15_000);
    worker.once("exit", code => {
      clearTimeout(timeout);
      resolve(code);
    });
    worker.once("error", reject);
  });
  return { exitCode, stdout, stderr };
}

try {
  if (child) {
    await writeFile(path.join(isolatedRuntimeRoot, "data", "processed", "consent-ledger.json"), `${JSON.stringify({
      _note: "Isolated API smoke consent ledger.",
      eventId: DEFAULT_EVENT_ID,
      lastUpdated: null,
      records: []
    }, null, 2)}\n`);
  }
  const health = await hit("GET", "/health");
  const invalidRequestId = "x".repeat(200);
  const requestIdProbe = await hitRaw("GET", "/health", undefined, { "x-request-id": invalidRequestId });
  const unavailableBoardReset = await hit("POST", "/api/admin/board-demo/reset", null, true);
  const unavailableBoardSmsPreference = await hit("POST", "/api/admin/board-demo/sms-preference", { action: "STOP" }, true);
  ok("GET /health", health.status === 200 || health.status === 404 || health.data);
  ok("health exposes the active rate-limit backend", health.status === 200 && health.data.rateLimitBackend === "memory");
  ok("API replaces invalid request IDs", requestIdProbe.status === 200 && /^req_[A-Za-z0-9-]+$/.test(requestIdProbe.headers.get("x-request-id") || "") && requestIdProbe.headers.get("x-request-id") !== invalidRequestId);
  ok("ordinary development API hides presentation reset", health.data.boardDemoResetReady === false && unavailableBoardReset.status === 404);
  ok("ordinary development API hides board SMS preference simulation", unavailableBoardSmsPreference.status === 404);
  const readiness = await hit("GET", "/ready");
  const deployment = await hit("GET", "/api/admin/deployment", null, true);
  const queueStatus = await hit("GET", "/api/admin/jobs?limit=12", null, true);
  ok("GET /ready queue health", readiness.status === 200 && readiness.data.checks?.queue === true && readiness.data.checks?.queueStatus?.staleRunning === 0);
  ok("deployment exposes data plane gate", deployment.status === 200 && deployment.data.deployment?.checks?.dataPlane?.ok === true);
  const deploymentChecks = Object.values(deployment.data.deployment?.checks || {});
  const deploymentGroups = deployment.data.deployment?.groups || [];
  const failingDeploymentChecks = deploymentChecks.filter(check => !check.ok);
  let automaticDeploymentTaskWorkspace = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    automaticDeploymentTaskWorkspace = await hit("GET", "/api/admin/partners", null, true);
    const activeLaunchTasks = (automaticDeploymentTaskWorkspace.data.tasks || []).filter(task => task.relatedEntityType === "deployment_check" && ["open", "in_progress", "blocked"].includes(task.status));
    if (activeLaunchTasks.length === failingDeploymentChecks.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const deploymentAfterAutomaticSync = await hit("GET", "/api/admin/deployment", null, true);
  const unauthenticatedDeploymentTaskSync = await hit("POST", "/api/admin/deployment/tasks/sync");
  const deploymentTaskSync = await hit("POST", "/api/admin/deployment/tasks/sync", null, true);
  const deploymentTaskReplay = await hit("POST", "/api/admin/deployment/tasks/sync", null, true);
  const deploymentTaskWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const launchTasksApi = (deploymentTaskWorkspace.data.tasks || []).filter(task => task.relatedEntityType === "deployment_check" && ["open", "in_progress", "blocked"].includes(task.status));
  ok("deployment task sync requires task delegation permission", unauthenticatedDeploymentTaskSync.status === 401);
  ok("automatic deployment sync creates one task per failing gate", launchTasksApi.length === failingDeploymentChecks.length && new Set(launchTasksApi.map(task => task.relatedEntityId)).size === failingDeploymentChecks.length);
  ok("manual deployment task sync converges with automatic state", deploymentTaskSync.status === 200 && deploymentTaskSync.data.sync?.created === 0 && deploymentTaskSync.data.sync?.active === failingDeploymentChecks.length);
  ok("deployment task API replay is idempotent", deploymentTaskReplay.status === 200 && deploymentTaskReplay.data.sync?.changed === false && deploymentTaskReplay.data.sync?.created === 0 && deploymentTaskReplay.data.sync?.active === failingDeploymentChecks.length);
  ok("deployment exposes healthy automatic launch work evidence", deploymentAfterAutomaticSync.data.deployment?.checks?.deploymentTaskSync?.ok === true
    && deploymentAfterAutomaticSync.data.deployment?.checks?.deploymentTaskSync?.message.includes("healthy")
    && deploymentAfterAutomaticSync.data.deployment?.checks?.deploymentTaskSync?.message.includes("60 minutes")
    && deploymentAfterAutomaticSync.data.deployment?.automation?.deploymentTaskSync?.ready === true
    && Boolean(deploymentAfterAutomaticSync.data.deployment?.automation?.deploymentTaskSync?.lastSuccessAt));
  ok("deployment exposes labeled and grouped launch checks", deploymentChecks.length >= 35
    && deploymentChecks.every(check => check.id && check.label && check.label !== check.id && check.group && check.group !== "Other" && check.message && ["ok", "warning", "error"].includes(check.severity))
    && new Set(deploymentChecks.map(check => check.group)).size >= 6
    && deploymentGroups.reduce((total, group) => total + group.total, 0) === deploymentChecks.length
    && deploymentGroups.every(group => group.group && group.passing + group.warnings + group.errors === group.total));
  ok("deployment exposes configured outreach discovery gate", deployment.data.deployment?.checks?.outreachDiscovery?.ok === true && deployment.data.deployment?.checks?.outreachDiscovery?.message.includes("fixture"));
  ok("deployment exposes sponsor package integrity gate", deployment.data.deployment?.checks?.sponsorPackages?.ok === true && deployment.data.deployment?.checks?.sponsorPackages?.message.includes("active sponsor packages"));
  ok("admin queue health summary", queueStatus.status === 200 && queueStatus.data.summary?.operational === true && Array.isArray(queueStatus.data.jobs));
  if (child) {
    const previousQueueDir = process.env.SANDFEST_JOB_QUEUE_DIR;
    process.env.SANDFEST_JOB_QUEUE_DIR = isolatedJobQueueDir;
    try {
      const privateQueueRecipient = "queue.private@example.com";
      const terminalApiJob = await enqueueJob(isolatedRuntimeRoot, {
        type: "queue.terminal.api_probe",
        payload: { followupId: "followup_queue_probe", recipient: privateQueueRecipient },
        maxAttempts: 1
      });
      const [terminalApiClaim] = await claimNextJobs(isolatedRuntimeRoot, {
        limit: 1,
        types: ["queue.terminal.api_probe"],
        workerId: "platform-api-terminal-probe"
      });
      await completeJob(isolatedRuntimeRoot, terminalApiClaim, { error: `Provider rejected ${privateQueueRecipient}` });
      await new Promise(resolve => setTimeout(resolve, 5));
      const recentApiJob = await enqueueJob(isolatedRuntimeRoot, {
        type: "queue.recent.api_probe",
        payload: { probe: true },
        maxAttempts: 1
      });
      const [recentApiClaim] = await claimNextJobs(isolatedRuntimeRoot, {
        limit: 1,
        types: ["queue.recent.api_probe"],
        workerId: "platform-api-recent-probe"
      });
      await completeJob(isolatedRuntimeRoot, recentApiClaim);
      const buriedFailureStatus = await hit("GET", "/api/admin/jobs?limit=1", null, true);
      const failedQueueStatus = await hit("GET", "/api/admin/jobs?limit=50", null, true);
      const failedQueueJob = failedQueueStatus.data.jobs?.find(item => item.id === terminalApiJob.id);
      const failedQueueJson = JSON.stringify(failedQueueStatus.data || {});
      const unauthenticatedQueueAcknowledgement = await hit("POST", `/api/admin/jobs/${terminalApiJob.id}/acknowledge`, {
        resolutionNote: "Reviewed in the partner workflow."
      });
      const invalidQueueAcknowledgement = await hit("POST", "/api/admin/jobs/%2E%2E%2Fprivate%2Fjob_secret/acknowledge", {
        resolutionNote: "Reviewed in the partner workflow."
      }, true);
      const malformedQueueAcknowledgement = await hit("POST", "/api/admin/jobs/job_%ZZ/acknowledge", {
        resolutionNote: "Reviewed in the partner workflow."
      }, true);
      const shortQueueAcknowledgement = await hit("POST", `/api/admin/jobs/${terminalApiJob.id}/acknowledge`, {
        resolutionNote: "Reviewed"
      }, true);
      const queueAcknowledgement = await hit("POST", `/api/admin/jobs/${terminalApiJob.id}/acknowledge`, {
        resolutionNote: "Retried from the owning partner message workflow."
      }, true);
      const duplicateQueueAcknowledgement = await hit("POST", `/api/admin/jobs/${terminalApiJob.id}/acknowledge`, {
        resolutionNote: "Duplicate acknowledgement should not be accepted."
      }, true);
      const acknowledgedQueueStatus = await hit("GET", "/api/admin/jobs?limit=50", null, true);
      const acknowledgedQueueJob = acknowledgedQueueStatus.data.jobs?.find(item => item.id === terminalApiJob.id);
      const acknowledgementAudit = await hit("GET", "/api/admin/audit?limit=50", null, true);
      const acknowledgementAuditRecord = acknowledgementAudit.data.audit?.find(item => item.record?.action === "automation.job.acknowledge")?.record;
      const projectedQueueSafe = failedQueueStatus.status === 200
        && failedQueueStatus.data.summary?.unhandledFailed === 1
        && failedQueueJob?.label === "Background automation"
        && failedQueueJob?.requiresAcknowledgement === true
        && failedQueueStatus.data.displayRows?.some(item => item.id === terminalApiJob.id && item.displayKind === "job")
        && !failedQueueJson.includes(privateQueueRecipient)
        && !failedQueueJson.includes("payload")
        && !failedQueueJson.includes("lastError")
        && !failedQueueJson.includes("lockedBy");
      ok("admin job API withholds payloads and raw provider errors", projectedQueueSafe, projectedQueueSafe ? "" : JSON.stringify({
        status: failedQueueStatus.status,
        summary: failedQueueStatus.data.summary,
        failedQueueJob,
        error: failedQueueStatus.data.error
      }));
      const buriedFailureVisible = buriedFailureStatus.status === 200
        && buriedFailureStatus.data.jobs?.[0]?.id === terminalApiJob.id
        && buriedFailureStatus.data.jobs?.some(item => item.id === recentApiJob.id)
        && buriedFailureStatus.data.jobs?.filter(item => item.id === terminalApiJob.id).length === 1;
      ok("admin job API keeps an older unhandled failure ahead of recent success", buriedFailureVisible, buriedFailureVisible ? "" : JSON.stringify(buriedFailureStatus.data));
      const acknowledgementProtected = unauthenticatedQueueAcknowledgement.status === 401
        && invalidQueueAcknowledgement.status === 400
        && malformedQueueAcknowledgement.status === 400
        && shortQueueAcknowledgement.status === 400
        && queueAcknowledgement.status === 200
        && queueAcknowledgement.data.summary?.unhandledFailed === 0
        && duplicateQueueAcknowledgement.status === 409;
      ok("automation failure acknowledgment is protected, validated, and conflict safe", acknowledgementProtected, acknowledgementProtected ? "" : JSON.stringify({
        unauthenticated: unauthenticatedQueueAcknowledgement,
        invalid: invalidQueueAcknowledgement,
        malformed: malformedQueueAcknowledgement,
        short: shortQueueAcknowledgement,
        acknowledged: queueAcknowledgement,
        duplicate: duplicateQueueAcknowledgement
      }));
      const acknowledgementRecorded = acknowledgedQueueStatus.data.summary?.operational === true
        && acknowledgedQueueJob?.requiresAcknowledgement === false
        && Boolean(acknowledgedQueueJob?.failureHandledAt)
        && acknowledgementAuditRecord?.target?.id === terminalApiJob.id
        && acknowledgementAuditRecord?.metadata?.resolutionNote === "Retried from the owning partner message workflow."
        && !JSON.stringify(acknowledgementAuditRecord).includes(privateQueueRecipient);
      ok("automation acknowledgment clears the queue incident and writes a safe audit record", acknowledgementRecorded, acknowledgementRecorded ? "" : JSON.stringify({
        status: acknowledgedQueueStatus.data.summary,
        acknowledgedQueueJob,
        acknowledgementAuditRecord
      }));
    } finally {
      if (previousQueueDir === undefined) delete process.env.SANDFEST_JOB_QUEUE_DIR;
      else process.env.SANDFEST_JOB_QUEUE_DIR = previousQueueDir;
    }
  }
  ok("deployment exposes current event guide gate", health.data.eventGuideReady === true && deployment.data.deployment?.checks?.eventGuide?.ok === true);
  ok("deployment identifies operational documents awaiting 2027 rollover", health.data.currentEventId === DEFAULT_EVENT_ID && health.data.currentEventReady === false && deployment.data.deployment?.checks?.currentEvent?.severity === "warning" && deployment.data.deployment?.checks?.currentEvent?.message.includes("fleet=texas-sandfest-2026"));

  const initialPublicBootstrap = await hit("GET", "/api/public/bootstrap");
  const unauthenticatedGuidePublish = await hit("POST", "/api/admin/event-guide/publish", { publish: true, guide: {} });
  const invalidGuidePublish = await hit("POST", "/api/admin/event-guide/publish", {
    publish: true,
    guide: { startDate: "2027-04-19", endDate: "2027-04-18" }
  }, true);
  const sourceCheckedAt = new Date(Date.now() - 1_000).toISOString();
  const validGuidePublish = await hit("POST", "/api/admin/event-guide/publish", {
    publish: true,
    guide: {
      startDate: "2027-04-16",
      endDate: "2027-04-18",
      dailyOpen: "09:00",
      dailyClose: "19:30",
      location: "On the beach, Port Aransas, TX 78373",
      mission: "The largest beach sand sculpture competition in the USA, supporting local nonprofits and scholarships.",
      phone: "361-267-2474",
      email: "info@texassandfest.org",
      address: "200 S. Alister Street, Suite E, Port Aransas, TX 78373",
      sourceUrl: "https://www.texassandfest.org/knowbeforeyougo",
      sourceCheckedAt
    }
  }, true);
  const publishedPublicBootstrap = await hit("GET", "/api/public/bootstrap");
  const publishedAdminConfig = await hit("GET", "/api/admin/config", null, true);
  ok("public bootstrap exposes only governed visitor data", initialPublicBootstrap.status === 200
    && initialPublicBootstrap.data.guide?.dateRange === "April 16-18, 2027"
    && publicAppBootstrapSafety(initialPublicBootstrap.data).ready
    && JSON.stringify(Object.keys(initialPublicBootstrap.data).sort()) === JSON.stringify(["alert", "guide", "schedule", "zones"])
    && initialPublicBootstrap.data.schedule?.every(item => item.category !== "Staff")
    && initialPublicBootstrap.data.zones?.every(item => !Object.hasOwn(item, "status")));
  ok("event guide publish requires staff authentication", unauthenticatedGuidePublish.status === 401);
  ok("event guide publish rejects invalid dates", invalidGuidePublish.status === 400 && invalidGuidePublish.data.errors?.includes("Event end date cannot precede the start date."));
  ok("event guide publish updates public and admin readiness", validGuidePublish.status === 200 && validGuidePublish.data.readiness?.ready === true && publishedPublicBootstrap.data.guide?.sourceCheckedAt === sourceCheckedAt && !("publishedBy" in publishedPublicBootstrap.data.guide) && publishedAdminConfig.data.eventGuideReadiness?.ready === true);

  const conciergeTicketApi = await hitRaw("POST", "/api/public/concierge", JSON.stringify({ question: "Where can I buy tickets?" }), { "content-type": "application/json" });
  const conciergeSponsorApi = await hit("POST", "/api/public/concierge", { question: "What sponsorship packages are open?" });
  const conciergeAccessibilityApi = await hit("POST", "/api/public/concierge", { question: "What accessibility guidance is available?" });
  const conciergeParkingApi = await hit("POST", "/api/public/concierge", { question: "Is parking information available?" });
  const conciergeUnsupportedApi = await hit("POST", "/api/public/concierge", { question: "Can I bring a telescope? private@example.com" });
  const conciergeInvalidApi = await hit("POST", "/api/public/concierge", { question: "x".repeat(281) });
  ok("public concierge API returns source-cited current ticket data", conciergeTicketApi.status === 200
    && conciergeTicketApi.data.topic === "tickets"
    && conciergeTicketApi.data.sources?.some(item => item.href === "#tickets")
    && publicConciergeResponseSafety(conciergeTicketApi.data).ready
    && conciergeTicketApi.headers.get("cache-control") === "no-store"
    && conciergeTicketApi.headers.get("x-ratelimit-limit"));
  ok("public concierge API uses public sponsor packages instead of internal workflow claims", conciergeSponsorApi.status === 200
    && conciergeSponsorApi.data.topic === "sponsor"
    && conciergeSponsorApi.data.sources?.some(item => item.href === "#sponsors")
    && !/invoiceStatus|quickBooksItemId|stripePriceId/i.test(JSON.stringify(conciergeSponsorApi.data)));
  ok("public concierge API cites approved accessibility locations", conciergeAccessibilityApi.status === 200
    && conciergeAccessibilityApi.data.topic === "accessibility"
    && conciergeAccessibilityApi.data.confidence === "high"
    && conciergeAccessibilityApi.data.escalated === false
    && conciergeAccessibilityApi.data.answer?.includes("North Gate at marker 12.5")
    && conciergeAccessibilityApi.data.answer?.includes("ADA parking")
    && conciergeAccessibilityApi.data.sources?.some(item => item.href === "#operations")
    && publicConciergeResponseSafety(conciergeAccessibilityApi.data).ready);
  ok("public concierge API cites approved parking and shuttle locations", conciergeParkingApi.status === 200
    && conciergeParkingApi.data.topic === "parking"
    && conciergeParkingApi.data.confidence === "medium"
    && conciergeParkingApi.data.escalated === true
    && conciergeParkingApi.data.answer?.includes("North Gate at marker 12.5")
    && conciergeParkingApi.data.answer?.includes("South Entrance at marker Access Road 1A")
    && conciergeParkingApi.data.sources?.some(item => item.href === "#operations")
    && publicConciergeResponseSafety(conciergeParkingApi.data).ready);
  ok("public concierge API neither stores nor echoes unsupported questions", conciergeUnsupportedApi.status === 200
    && conciergeUnsupportedApi.data.escalated === true
    && !JSON.stringify(conciergeUnsupportedApi.data).includes("private@example.com"));
  ok("public concierge API rejects oversized questions", conciergeInvalidApi.status === 400 && conciergeInvalidApi.data.error?.includes("280"));

  const apiDocumentBytes = Buffer.from("Board packet source\nOwner: Operations\n", "utf8");
  const apiDocumentReviewDueAt = "2027-01-20T18:00:00.000Z";
  const documentUploadPreflightApi = await hitRaw("OPTIONS", "/api/admin/documents/upload", undefined, {
    origin: "https://www.texassandfest.org",
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization,content-type,x-document-review-due-at"
  });
  const unauthenticatedDocumentsApi = await hitRaw("GET", "/api/admin/documents");
  const unauthenticatedDocumentUploadApi = await hitRaw("POST", "/api/admin/documents/upload", apiDocumentBytes, {
    "content-type": "text/plain",
    "x-file-name": "board-source.txt",
    "x-document-domain": "docs",
    "x-document-title": "Board source",
    "x-owner-team": "operations",
    "x-document-review-due-at": apiDocumentReviewDueAt
  });
  const documentUploadApi = await hitRaw("POST", "/api/admin/documents/upload", apiDocumentBytes, {
    "content-type": "text/plain",
    "x-file-name": "board-source.txt",
    "x-document-domain": "docs",
    "x-document-title": "Board source",
    "x-document-review-due-at": apiDocumentReviewDueAt
  }, true);
  const documentReplayApi = await hitRaw("POST", "/api/admin/documents/upload", apiDocumentBytes, {
    "content-type": "text/plain",
    "x-file-name": "board-source-copy.txt",
    "x-document-domain": "finance",
    "x-document-title": "Duplicate board source",
    "x-owner-team": "finance",
    "x-document-review-due-at": "2027-02-01T18:00:00.000Z"
  }, true);
  const documentListApi = await hit("GET", "/api/admin/documents", null, true);
  const documentIdApi = documentUploadApi.data.document?.id;
  const documentReviewApi = await hit("PATCH", `/api/admin/documents/${encodeURIComponent(documentIdApi || "missing")}`, {
    status: "approved",
    ownerTeam: "operations",
    notes: "Reviewed against the board packet."
  }, true);
  const documentTaskWorkspaceApi = await hit("GET", "/api/admin/partners", null, true);
  const documentReviewTasksApi = documentTaskWorkspaceApi.data.tasks?.filter(item => item.relatedEntityType === "incoming_document" && item.relatedEntityId === documentIdApi) || [];
  const documentDownloadApi = await hitRaw("GET", `/api/admin/documents/${encodeURIComponent(documentIdApi || "missing")}/content`, undefined, {}, true);
  const invalidDocumentUploadApi = await hitRaw("POST", "/api/admin/documents/upload", Buffer.from("not a pdf"), {
    "content-type": "application/pdf",
    "x-file-name": "false-packet.pdf",
    "x-document-domain": "docs",
    "x-document-title": "False packet"
  }, true);
  const apiBoardBriefingBytes = await readFile(path.join(ROOT, "docs", "presentations", "SandFest-Board-Platform-Briefing.pptx"));
  const boardBriefingUploadApi = await hitRaw("POST", "/api/admin/documents/upload", apiBoardBriefingBytes, {
    "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "x-file-name": "SandFest-Board-Platform-Briefing.pptx",
    "x-document-domain": "docs",
    "x-document-title": "SandFest board platform briefing",
    "x-owner-team": "operations",
    "x-document-review-due-at": apiDocumentReviewDueAt
  }, true);
  const extractionSourcePathApi = `/api/internal/documents/${encodeURIComponent(boardBriefingUploadApi.data.document?.id || "missing")}/extraction-source?${new URLSearchParams({
    eventId: boardBriefingUploadApi.data.document?.eventId || "",
    checksum: boardBriefingUploadApi.data.document?.checksumSha256 || "",
    version: String(boardBriefingUploadApi.data.document?.extractionVersion || "")
  })}`;
  const staleExtractionSourcePathApi = `/api/internal/documents/${encodeURIComponent(boardBriefingUploadApi.data.document?.id || "missing")}/extraction-source?${new URLSearchParams({
    eventId: boardBriefingUploadApi.data.document?.eventId || "",
    checksum: "0".repeat(64),
    version: String(boardBriefingUploadApi.data.document?.extractionVersion || "")
  })}`;
  const unauthenticatedExtractionSourceApi = await hitRaw("GET", extractionSourcePathApi);
  const staleExtractionSourceApi = await hitRaw("GET", staleExtractionSourcePathApi, undefined, {
    authorization: `Bearer ${SMOKE_DOCUMENT_EXTRACTION_SECRET}`
  });
  const extractionSourceApi = await hitRaw("GET", extractionSourcePathApi, undefined, {
    authorization: `Bearer ${SMOKE_DOCUMENT_EXTRACTION_SECRET}`
  });
  const remoteExtractionWorkerEnvironment = {
    SANDFEST_INCOMING_DOCUMENT_DIR: "",
    SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL: API_BASE
  };
  const boardBriefingWorkerApi = await runSmokeWorkerOnce(remoteExtractionWorkerEnvironment);
  const documentsAfterExtractionApi = await hit("GET", "/api/admin/documents", null, true);
  const extractedBoardBriefingApi = documentsAfterExtractionApi.data.documents?.find(item => item.id === boardBriefingUploadApi.data.document?.id);
  const boardBriefingRetryApi = await hit("POST", `/api/admin/documents/${encodeURIComponent(extractedBoardBriefingApi?.id || "missing")}/extraction/retry`, null, true);
  const boardBriefingRetryWorkerApi = await runSmokeWorkerOnce(remoteExtractionWorkerEnvironment);
  const documentsAfterRetryApi = await hit("GET", "/api/admin/documents", null, true);
  const retriedBoardBriefingApi = documentsAfterRetryApi.data.documents?.find(item => item.id === extractedBoardBriefingApi?.id);
  ok("document intake API requires dedicated staff authentication", unauthenticatedDocumentsApi.status === 401 && unauthenticatedDocumentUploadApi.status === 401);
  ok("document intake upload CORS permits the review deadline", documentUploadPreflightApi.status === 204 && documentUploadPreflightApi.headers.get("access-control-allow-origin") === "https://www.texassandfest.org" && documentUploadPreflightApi.headers.get("access-control-allow-headers")?.includes("x-document-review-due-at"));
  ok("document intake API stores private metadata and preview", documentUploadApi.status === 201 && documentUploadApi.data.document?.textPreview.includes("Board packet source") && !("storageKey" in (documentUploadApi.data.document || {})) && documentUploadApi.data.document?.checksumSha256?.length === 64 && documentUploadApi.data.document?.reviewDueAt === apiDocumentReviewDueAt);
  ok("document intake API is checksum-idempotent", documentReplayApi.status === 200 && documentReplayApi.data.duplicate === true && documentReplayApi.data.document?.id === documentIdApi && documentReplayApi.data.document?.reviewTask?.id === documentUploadApi.data.document?.reviewTask?.id && documentListApi.data.summary?.total === 1);
  ok("document intake API routes one due-dated work-board task", documentListApi.data.documents?.[0]?.reviewTask?.status === "open" && documentListApi.data.documents?.[0]?.reviewTask?.assigneeId === "operations" && documentListApi.data.documents?.[0]?.reviewTask?.dueAt === apiDocumentReviewDueAt && documentReviewTasksApi.length === 1);
  ok("document intake API governs review and task lifecycle", documentReviewApi.status === 200 && documentReviewApi.data.document?.status === "approved" && documentReviewApi.data.document?.reviewedBy === "local-admin" && documentReviewApi.data.document?.reviewTask?.status === "done" && documentReviewTasksApi[0]?.status === "done" && documentReviewApi.data.summary?.byStatus?.approved === 1);
  ok("document intake API verifies controlled downloads", documentDownloadApi.status === 200 && documentDownloadApi.data.equals(apiDocumentBytes) && documentDownloadApi.headers.get("content-disposition")?.includes("board-source.txt") && documentDownloadApi.headers.get("cache-control") === "private, no-store");
  ok("document intake API rejects spoofed file types", invalidDocumentUploadApi.status === 400 && invalidDocumentUploadApi.data.error?.includes("do not match"));
  ok("binary upload queues checksum-bound private extraction", boardBriefingUploadApi.status === 201 && boardBriefingUploadApi.data.document?.extractionStatus === "queued" && boardBriefingUploadApi.data.document?.extractionSupported === true && boardBriefingUploadApi.data.extractionJob?.status === "queued" && !JSON.stringify(boardBriefingUploadApi.data.document).includes("extractionChunks"));
  ok("worker source route is bearer-protected and request-bound", unauthenticatedExtractionSourceApi.status === 401 && staleExtractionSourceApi.status === 404 && extractionSourceApi.status === 200 && extractionSourceApi.data.equals(apiBoardBriefingBytes) && extractionSourceApi.headers.get("cache-control") === "private, no-store");
  ok("worker extracts the real board briefing", boardBriefingWorkerApi.exitCode === 0 && extractedBoardBriefingApi?.extractionStatus === "ready" && extractedBoardBriefingApi?.textPreview?.includes("TEXAS SANDFEST") && extractedBoardBriefingApi?.extractedCharacterCount > 5_000 && extractedBoardBriefingApi?.extractedChunkCount > 0 && documentsAfterExtractionApi.data.summary?.extractionReady === 2);
  ok("admin extraction retry creates a new version", boardBriefingRetryApi.status === 202 && boardBriefingRetryApi.data.document?.extractionStatus === "queued" && boardBriefingRetryApi.data.document?.extractionVersion === 2 && boardBriefingRetryApi.data.extractionJob?.status === "queued" && boardBriefingRetryWorkerApi.exitCode === 0 && retriedBoardBriefingApi?.extractionStatus === "ready" && retriedBoardBriefingApi?.extractionVersion === 2 && retriedBoardBriefingApi?.extractionAttempts === 2);

  if (child) {
    const productionProbePort = String(await freePort());
    const productionProbeQueue = await mkdtemp(path.join(tmpdir(), "sandfest-production-file-probe-"));
    const malformedProductionConfig = path.join(productionProbeQueue, "malformed-admin-config.json");
    await writeFile(malformedProductionConfig, "{not-valid-json", "utf8");
    let productionProbeChild = null;
    try {
      const productionCameraSecret = "production-probe-camera-secret-at-least-32-characters";
      const productionCameraKeyId = "north-gate-production-probe";
      const productionModelSha256 = "a".repeat(64);
      productionProbeChild = spawn("node", ["scripts/admin-api-server.mjs"], {
        cwd: ROOT,
        env: {
          ...process.env,
          SANDFEST_ENV: "production",
          SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS: "0",
          SANDFEST_AUTH_MODE: "bearer-token",
          SANDFEST_DATABASE_URL: "",
          SANDFEST_API_PORT: productionProbePort,
          SANDFEST_ADMIN_API_TOKEN: TOKEN,
          SANDFEST_PARTNER_PORTAL_SECRET: "production-file-probe-partner-secret-0123456789",
          SANDFEST_OUTREACH_PREFERENCES_SECRET: "production-file-probe-outreach-secret-0123456789",
          SANDFEST_PUBLIC_SITE_URL: "https://www.texassandfest.org",
          SANDFEST_PARTNER_ASSET_DIR: isolatedPartnerAssetDir,
          SANDFEST_INCOMING_DOCUMENT_DIR: isolatedIncomingDocumentDir,
          SANDFEST_JOB_QUEUE_DIR: productionProbeQueue,
          SANDFEST_ADMIN_CONFIG_PATH: malformedProductionConfig,
          SANDFEST_REQUIRED_CAPABILITIES: "transactional_email,camera_ingest,outreach_discovery",
          TRANSACTIONAL_EMAIL_ENABLED: "false",
          CAMERA_INGEST_ENABLED: "true",
          CAMERA_INGEST_KEYS: JSON.stringify({
            [productionCameraKeyId]: {
              cameraId: "north-gate",
              secret: productionCameraSecret
            }
          }),
          CAMERA_INGEST_REQUIRED_CAMERA_IDS: "north-gate",
          CAMERA_MODEL_APPROVAL_STATUS: "approved",
          CAMERA_MODEL_NAME: "production-probe-model.onnx",
          CAMERA_MODEL_VERSION: "production-probe-2026.07",
          CAMERA_MODEL_SHA256: productionModelSha256,
          CAMERA_MODEL_LICENSE_REFERENCE: "CAMERA-LICENSE-REVIEW-2026-001",
          CAMERA_MODEL_APPROVED_BY: "SandFest test technology committee",
          CAMERA_MODEL_APPROVED_AT: new Date(Date.now() - 60_000).toISOString(),
          CAMERA_MODEL_DECISION_REFERENCE: "CAMERA-MODEL-DECISION-2026-001",
          OUTREACH_DISCOVERY_ENABLED: "false"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Production file-mode probe timed out:\n${output}`)), 8_000);
        const onData = buffer => {
          output += String(buffer);
          if (output.includes("listening")) {
            clearTimeout(timeout);
            resolve();
          }
        };
        productionProbeChild.stdout.on("data", onData);
        productionProbeChild.stderr.on("data", onData);
        productionProbeChild.once("error", reject);
        productionProbeChild.once("exit", code => reject(new Error(`Production file-mode probe exited ${code}:\n${output}`)));
      });
      const response = await fetch(`http://127.0.0.1:${productionProbePort}/api/admin/deployment`, {
        headers: { authorization: `Bearer ${TOKEN}` }
      });
      const data = await response.json();
      const productionErrorResponse = await fetch(`http://127.0.0.1:${productionProbePort}/api/public/sponsors`, {
        headers: { "x-request-id": "production-error-probe" }
      });
      const productionError = await productionErrorResponse.json();
      const mismatchedModelBody = JSON.stringify({
        heartbeatId: "production-model-mismatch-heartbeat",
        sourceId: "production-probe-source",
        observedAt: new Date().toISOString(),
        status: "healthy",
        modelName: "production-probe-model.onnx",
        modelVersion: "production-probe-2026.07",
        modelSha256: "b".repeat(64)
      });
      const mismatchedModelTimestamp = String(Math.floor(Date.now() / 1000));
      const mismatchedModelResponse = await fetch(
        `http://127.0.0.1:${productionProbePort}/api/ingest/cameras/north-gate/heartbeat`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-sandfest-timestamp": mismatchedModelTimestamp,
            "x-sandfest-camera-key-id": productionCameraKeyId,
            "x-sandfest-signature": `sha256=${signCameraPayload(
              mismatchedModelBody,
              mismatchedModelTimestamp,
              productionCameraSecret,
              { keyId: productionCameraKeyId }
            )}`
          },
          body: mismatchedModelBody
        }
      );
      const mismatchedModel = await mismatchedModelResponse.json();
      ok("production rejects file data plane", response.status === 200 && data.deployment?.checks?.dataPlane?.ok === false && data.deployment?.checks?.dataPlane?.severity === "error" && data.deployment?.ok === false);
      ok("production rejects disabled required capabilities", data.deployment?.checks?.transactionalEmail?.ok === false && data.deployment?.checks?.cameraIngest?.ok === true && data.deployment?.checks?.outreachDiscovery?.ok === false && data.deployment?.checks?.outreachDiscovery?.severity === "error" && data.deployment?.requiredCapabilities?.length === 3);
      ok("production requires artifact-bound camera model approval", data.deployment?.checks?.cameraModelApproval?.ok === true && data.deployment?.checks?.cameraModelApproval?.message.includes(productionModelSha256.slice(0, 12)));
      ok("production ingest rejects detector bytes outside the approval", mismatchedModelResponse.status === 409 && mismatchedModel.reason === "camera_model_checksum_mismatch");
      ok("production requires partner intake bot verification", data.deployment?.checks?.partnerIntakeBotProtection?.ok === false && data.deployment?.checks?.partnerIntakeBotProtection?.severity === "error");
      ok("production requires current recovery evidence", data.deployment?.checks?.backupRecovery?.ok === false && data.deployment?.checks?.backupRecovery?.severity === "error");
      ok("production rejects disabled launch work automation", data.deployment?.checks?.deploymentTaskSync?.ok === false && data.deployment?.checks?.deploymentTaskSync?.severity === "error" && data.deployment?.automation?.deploymentTaskSync?.enabled === false);
      ok("production rejects unreadable sponsor package config", data.deployment?.checks?.sponsorPackages?.ok === false && data.deployment?.checks?.sponsorPackages?.severity === "error");
      ok("production requires a shared rate-limit backend", data.deployment?.checks?.rateLimitBackend?.ok === false && data.deployment?.checks?.rateLimitBackend?.severity === "error" && data.deployment?.checks?.rateLimitBackend?.message.includes("memory"));
      ok("production rejects stale operational event context", data.deployment?.checks?.currentEvent?.ok === false && data.deployment?.checks?.currentEvent?.severity === "error");
      ok("production API hides unexpected error details", productionErrorResponse.status === 500 && productionError.error === "Internal server error." && productionError.requestId === "production-error-probe" && !JSON.stringify(productionError).includes("JSON"));
      ok("production API advertises HTTPS-only transport", productionErrorResponse.headers.get("strict-transport-security") === "max-age=31536000; includeSubDomains");
    } finally {
      await stopChild(productionProbeChild);
      await rm(productionProbeQueue, { recursive: true, force: true });
    }
  }

  const routes = [
    ["GET", "/api/public/passport", false],
    ["GET", "/api/public/voting", false],
    ["GET", "/api/public/booths", false],
    ["GET", "/api/public/island-conditions", false],
    ["GET", "/api/admin/revenue", true],
    ["GET", "/api/admin/budget", true],
    ["GET", "/api/admin/fleet", true],
    ["GET", "/api/admin/volunteers", true],
    ["GET", "/api/admin/consent", true],
    ["GET", "/api/admin/sms", true],
    ["GET", "/api/admin/passport", true],
    ["GET", "/api/admin/voting", true],
    ["GET", "/api/admin/booths", true],
    ["GET", "/api/admin/partners", true],
    ["GET", "/api/admin/outreach", true],
    ["GET", "/api/admin/island-conditions", true]
  ];
  for (const [method, p, auth] of routes) {
    const r = await hit(method, p, null, auth);
    ok(`${method} ${p}`, r.status === 200, `status ${r.status}`);
  }

  const unauth = await hit("GET", "/api/admin/fleet", null, false);
  ok("admin 401 without token", unauth.status === 401);

  const volunteerRosterCsvApi = `volunteer_id,event_id,name,email,status,waiver_signed,sms_consent,roles
VL-API-1,${DEFAULT_EVENT_ID},API Volunteer Lead,api-volunteer@example.com,active,yes,no,gate|traffic
VL-API-WRONG,texas-sandfest-2026,Wrong Event Volunteer,wrong-volunteer@example.com,active,yes,yes,gate`;
  const volunteerShiftsCsvApi = `shift_id,event_id,role,zone,start_time,end_time,needed,volunteer_ids,captain_id
SHIFT-API-1,${DEFAULT_EVENT_ID},gate,north_gate,2027-04-09T08:00:00-05:00,2027-04-09T12:00:00-05:00,2,VL-API-1,VL-API-1`;
  const volunteerHoursCsvApi = `hour_log_id,event_id,volunteer_id,shift_id,check_in,check_out
HOURS-API-1,${DEFAULT_EVENT_ID},VL-API-1,SHIFT-API-1,2027-04-09T08:00:00-05:00,2027-04-09T12:00:00-05:00`;
  const volunteerImportPayloadApi = {
    rosterCsv: volunteerRosterCsvApi,
    shiftsCsv: volunteerShiftsCsvApi,
    hoursCsv: volunteerHoursCsvApi,
    fileNames: { roster: "volunteerlocal-roster.csv", shifts: "volunteerlocal-shifts.csv", hours: "volunteerlocal-hours.csv" },
    currentEventConfirmed: true
  };
  const unauthenticatedVolunteerImportApi = await hit("POST", "/api/admin/volunteers/import", { ...volunteerImportPayloadApi, mode: "preview" });
  const unattestedVolunteerImportApi = await hit("POST", "/api/admin/volunteers/import", { ...volunteerImportPayloadApi, mode: "preview", currentEventConfirmed: false }, true);
  const volunteersBeforePreviewApi = await hit("GET", "/api/admin/volunteers", null, true);
  const volunteerImportPreviewApi = await hit("POST", "/api/admin/volunteers/import", { ...volunteerImportPayloadApi, mode: "preview" }, true);
  const volunteersAfterPreviewApi = await hit("GET", "/api/admin/volunteers", null, true);
  const staleVolunteerImportApi = await hit("POST", "/api/admin/volunteers/import", {
    ...volunteerImportPayloadApi,
    mode: "commit",
    rosterCsv: `${volunteerRosterCsvApi}\n`,
    previewHash: volunteerImportPreviewApi.data.previewHash
  }, true);
  const volunteerImportCommitApi = await hit("POST", "/api/admin/volunteers/import", {
    ...volunteerImportPayloadApi,
    mode: "commit",
    previewHash: volunteerImportPreviewApi.data.previewHash
  }, true);
  const volunteerImportReplayApi = await hit("POST", "/api/admin/volunteers/import", {
    ...volunteerImportPayloadApi,
    mode: "commit",
    previewHash: volunteerImportPreviewApi.data.previewHash
  }, true);
  const volunteersAfterCommitApi = await hit("GET", "/api/admin/volunteers", null, true);
  const volunteerTaskDirectoryApi = await hit("GET", "/api/admin/partners", null, true);
  const importedVolunteerApi = volunteersAfterCommitApi.data.volunteers?.find(item => item.externalId === "VL-API-1");
  const importedShiftApi = volunteersAfterCommitApi.data.shifts?.find(item => item.externalId === "SHIFT-API-1");
  ok("VolunteerLocal API import requires authentication and event attestation", unauthenticatedVolunteerImportApi.status === 401 && unattestedVolunteerImportApi.status === 400);
  ok("VolunteerLocal API preview is non-mutating", volunteerImportPreviewApi.status === 200 && volunteerImportPreviewApi.data.summary?.volunteers?.created === 1 && volunteerImportPreviewApi.data.summary?.shifts?.created === 1 && volunteerImportPreviewApi.data.summary?.hourLogs?.created === 1 && volunteerImportPreviewApi.data.summary?.invalid === 1 && /^[a-f0-9]{64}$/.test(volunteerImportPreviewApi.data.previewHash || "") && volunteersBeforePreviewApi.data.volunteers?.length === volunteersAfterPreviewApi.data.volunteers?.length && !volunteersAfterPreviewApi.data.volunteers?.some(item => item.externalId === "VL-API-1"));
  ok("VolunteerLocal API preview hash fails closed", staleVolunteerImportApi.status === 409);
  ok("VolunteerLocal API commit reconciles roster coverage and hours", volunteerImportCommitApi.status === 201 && importedVolunteerApi?.waiverSigned === true && importedVolunteerApi?.smsConsent === false && importedShiftApi?.filledVolunteerIds.includes(importedVolunteerApi?.id) && volunteersAfterCommitApi.data.hourLogs?.some(item => item.externalId === "HOURS-API-1" && item.volunteerId === importedVolunteerApi?.id) && volunteersAfterCommitApi.data.imports?.[0]?.files?.roster === "volunteerlocal-roster.csv");
  ok("VolunteerLocal API replay is idempotent", volunteerImportReplayApi.status === 200 && volunteerImportReplayApi.data.replay === true && volunteersAfterCommitApi.data.volunteers?.filter(item => item.externalId === "VL-API-1").length === 1 && volunteersAfterCommitApi.data.imports?.length === 1);
  ok("VolunteerLocal import feeds governed task assignment directory", volunteerTaskDirectoryApi.data.assignmentDirectory?.volunteers?.some(item => item.id === importedVolunteerApi?.id && item.name === "API Volunteer Lead" && !("email" in item)) && !volunteerTaskDirectoryApi.data.assignmentDirectory?.volunteers?.some(item => item.id === "vol_006"));

  const staffCsvApi = `staff_id,event_id,name,work_email,status,role,team,notification_team
staff_operations,${DEFAULT_EVENT_ID},Jamie Torres,jamie.torres@staff.example,active,ops_admin,operations,operations
staff_sponsor,${DEFAULT_EVENT_ID},Morgan Ellis,morgan.ellis@staff.example,active,sponsor_admin,sponsor,sponsor
staff_finance,${DEFAULT_EVENT_ID},Riley Chen,riley.chen@staff.example,active,finance_admin,finance,finance
staff_volunteers,${DEFAULT_EVENT_ID},Casey Patel,casey.patel@staff.example,active,volunteer_captain,volunteer-captains,volunteer-captains
staff_traffic,${DEFAULT_EVENT_ID},Avery Brooks,avery.brooks@staff.example,on_call,traffic_lead,traffic,traffic
staff_guest_services,${DEFAULT_EVENT_ID},Taylor Nguyen,taylor.nguyen@staff.example,active,guest_services_lead,guest-services,guest-services
staff_production,${DEFAULT_EVENT_ID},Jordan Davis,jordan.davis@staff.example,active,production_lead,production,production`;
  const staffImportPayloadApi = {
    contents: staffCsvApi,
    fileName: "staff-directory-api.csv",
    source: "manual_verified",
    currentEventConfirmed: true
  };
  const unauthenticatedStaffImportApi = await hit("POST", "/api/admin/staff-directory/import", { ...staffImportPayloadApi, mode: "preview" });
  const unattestedStaffImportApi = await hit("POST", "/api/admin/staff-directory/import", { ...staffImportPayloadApi, mode: "preview", currentEventConfirmed: false }, true);
  const staffBeforePreviewApi = await hit("GET", "/api/admin/partners", null, true);
  const staffImportPreviewApi = await hit("POST", "/api/admin/staff-directory/import", { ...staffImportPayloadApi, mode: "preview" }, true);
  const staffAfterPreviewApi = await hit("GET", "/api/admin/partners", null, true);
  const staffRolloverCommitApi = await hit("POST", "/api/admin/staff-directory/import", {
    ...staffImportPayloadApi,
    mode: "commit",
    previewHash: staffImportPreviewApi.data.previewHash
  }, true);
  ok("staff directory API requires permission and event attestation", unauthenticatedStaffImportApi.status === 401 && unattestedStaffImportApi.status === 400);
  ok("staff directory API preview remains private and non-mutating", staffImportPreviewApi.status === 200 && staffImportPreviewApi.data.commitAllowed === false && staffImportPreviewApi.data.summary?.activeStaff === 7 && staffImportPreviewApi.data.summary?.routedTeams === 7 && /^[a-f0-9]{64}$/.test(staffImportPreviewApi.data.previewHash || "") && !JSON.stringify(staffImportPreviewApi.data).includes("@staff.example") && JSON.stringify(staffBeforePreviewApi.data.assignmentDirectory?.staff) === JSON.stringify(staffAfterPreviewApi.data.assignmentDirectory?.staff));
  ok("staff directory API blocks archive-bypassing annual replacement", staffRolloverCommitApi.status === 409 && staffRolloverCommitApi.data.error?.includes("archive-first rollover"));

  const boothCsvApi = `booth_id,event_id,vendor_id,eventeny_id,business_name,category,type,zone,booth_status,vendor_status,public,coi_status,map_x,map_y,fee
B-API-IMPORT,${DEFAULT_EVENT_ID},EV-V-API-IMPORT,EV-V-API-IMPORT,API Private Vendor,retail,vendor,api-zone,assigned,approved,,,15,25,900.00
B-API-WRONG,texas-sandfest-2026,EV-V-WRONG,EV-V-WRONG,Wrong Event Booth,retail,vendor,api-zone,assigned,approved,yes,approved,20,30,500.00`;
  const boothImportPayloadApi = { csv: boothCsvApi, fileName: "eventeny-booths-api.csv", currentEventConfirmed: true };
  const unauthenticatedBoothImportApi = await hit("POST", "/api/admin/booths/import", { ...boothImportPayloadApi, mode: "preview" });
  const unattestedBoothImportApi = await hit("POST", "/api/admin/booths/import", { ...boothImportPayloadApi, mode: "preview", currentEventConfirmed: false }, true);
  const boothsBeforePreviewApi = await hit("GET", "/api/admin/booths", null, true);
  const boothImportPreviewApi = await hit("POST", "/api/admin/booths/import", { ...boothImportPayloadApi, mode: "preview" }, true);
  const boothsAfterPreviewApi = await hit("GET", "/api/admin/booths", null, true);
  const staleBoothImportApi = await hit("POST", "/api/admin/booths/import", { ...boothImportPayloadApi, csv: `${boothCsvApi}\n`, mode: "commit", previewHash: boothImportPreviewApi.data.previewHash }, true);
  const boothImportCommitApi = await hit("POST", "/api/admin/booths/import", { ...boothImportPayloadApi, mode: "commit", previewHash: boothImportPreviewApi.data.previewHash }, true);
  const boothImportReplayApi = await hit("POST", "/api/admin/booths/import", { ...boothImportPayloadApi, mode: "commit", previewHash: boothImportPreviewApi.data.previewHash }, true);
  const boothsAfterCommitApi = await hit("GET", "/api/admin/booths", null, true);
  const importedBoothApi = boothsAfterCommitApi.data.booths?.find(item => item.id === "B-API-IMPORT");
  ok("Eventeny booth API requires authentication and event attestation", unauthenticatedBoothImportApi.status === 401 && unattestedBoothImportApi.status === 400);
  ok("Eventeny booth API preview is non-mutating", boothImportPreviewApi.status === 200 && boothImportPreviewApi.data.summary?.booths?.created === 1 && boothImportPreviewApi.data.summary?.vendors?.created === 1 && boothImportPreviewApi.data.summary?.invalid === 1 && /^[a-f0-9]{64}$/.test(boothImportPreviewApi.data.previewHash || "") && boothsBeforePreviewApi.data.booths?.length === boothsAfterPreviewApi.data.booths?.length && !boothsAfterPreviewApi.data.booths?.some(item => item.id === "B-API-IMPORT"), JSON.stringify({ status: boothImportPreviewApi.status, summary: boothImportPreviewApi.data.summary, before: boothsBeforePreviewApi.data.booths?.length, after: boothsAfterPreviewApi.data.booths?.length, error: boothImportPreviewApi.data.error }));
  ok("Eventeny booth API preview hash fails closed", staleBoothImportApi.status === 409);
  ok("Eventeny booth API commit keeps unapproved listings private", boothImportCommitApi.status === 201 && importedBoothApi?.vendor?.public === false && importedBoothApi?.docsReady === false && !publicBoothPins([importedBoothApi], [importedBoothApi.vendor]).some(item => item.id === "B-API-IMPORT") && boothsAfterCommitApi.data.imports?.[0]?.fileName === "eventeny-booths-api.csv", JSON.stringify({ status: boothImportCommitApi.status, error: boothImportCommitApi.data.error, booth: importedBoothApi, imports: boothsAfterCommitApi.data.imports?.length }));
  ok("Eventeny booth API replay is idempotent", boothImportReplayApi.status === 200 && boothImportReplayApi.data.replay === true && boothsAfterCommitApi.data.booths?.filter(item => item.id === "B-API-IMPORT").length === 1 && boothsAfterCommitApi.data.imports?.length === 1, JSON.stringify({ status: boothImportReplayApi.status, replay: boothImportReplayApi.data.replay, error: boothImportReplayApi.data.error, booths: boothsAfterCommitApi.data.booths?.filter(item => item.id === "B-API-IMPORT").length, imports: boothsAfterCommitApi.data.imports?.length }));

  const initialTicketCatalogApi = await hit("GET", "/api/public/tickets");
  const initialGaTicket = initialTicketCatalogApi.data.products?.find(item => item.id === "general-admission-3-day");
  ok("public ticket catalog is provider-private and policy-gated", initialTicketCatalogApi.status === 200 && initialTicketCatalogApi.data.checkoutPolicy?.ready === false && initialGaTicket?.availableForCheckout === false && !JSON.stringify(initialTicketCatalogApi.data).includes("stripePriceId") && !JSON.stringify(initialTicketCatalogApi.data).includes("price_replace"));
  const ticketPolicyNoticesApi = REQUIRED_TICKET_POLICY_NOTICES.map(item => ({
    id: item.id,
    summary: `${item.label} is reviewed and approved for the current API checkout test.`
  }));
  const incompleteTicketPolicyApi = await hit("PATCH", "/api/admin/ticket-policy", {
    action: "approve",
    version: "2027-api-v1",
    acknowledgment: "Too short",
    notices: ticketPolicyNoticesApi
  }, true);
  const approvedTicketPolicyApi = await hit("PATCH", "/api/admin/ticket-policy", {
    action: "approve",
    version: "2027-api-v1",
    acknowledgment: "I acknowledge the current ticket terms, refund policy, filming notice, and service-animal policy.",
    notices: ticketPolicyNoticesApi
  }, true);
  const policyReadyAdminConfigApi = await hit("GET", "/api/admin/config", null, true);
  ok("ticket policy approval rejects incomplete text and records current readiness", incompleteTicketPolicyApi.status === 400 && approvedTicketPolicyApi.status === 200 && approvedTicketPolicyApi.data.readiness?.ready === true && policyReadyAdminConfigApi.data.ticketPolicyReadiness?.ready === true && approvedTicketPolicyApi.data.policy?.approvedBy === "local-admin");
  const configuredGaTicket = await hit("PATCH", "/api/admin/tickets/general-admission-3-day", {
    unitAmount: 4500,
    priceLabel: "$45.00",
    stripePriceId: "price_platform_ga_2027",
    active: true,
    requiresReview: false
  }, true);
  const readyTicketCatalogApi = await hit("GET", "/api/public/tickets");
  const readyGaTicket = readyTicketCatalogApi.data.products?.find(item => item.id === "general-admission-3-day");
  ok("staff ticket configuration enables public checkout safely", configuredGaTicket.status === 200 && readyTicketCatalogApi.data.checkoutPolicy?.ready === true && readyTicketCatalogApi.data.checkoutPolicy?.notices?.length === 4 && readyGaTicket?.unitAmount === 4500 && readyGaTicket?.availableForCheckout === true && !Object.hasOwn(readyGaTicket, "stripePriceId"));
  const ticketCheckoutPayload = {
    items: [{ productId: "general-admission-3-day", quantity: 2 }],
    customer: { email: "ticket-buyer@example.com", phone: "361-555-0188" },
    email: "ticket-buyer@example.com",
    phone: "361-555-0188",
    consent: { emailMarketing: false, smsMarketing: false, smsSafety: true },
    policyAcceptance: {
      accepted: true,
      version: readyTicketCatalogApi.data.checkoutPolicy.version,
      digest: readyTicketCatalogApi.data.checkoutPolicy.digest
    }
  };
  const missingTicketRetryKey = await hit("POST", "/api/stripe/create-checkout-session", ticketCheckoutPayload);
  const missingTicketPolicyAcceptance = await hit("POST", "/api/stripe/create-checkout-session", {
    ...ticketCheckoutPayload,
    policyAcceptance: undefined
  }, false, { "idempotency-key": "ticket-platform-missing-policy-0001" });
  const staleTicketPolicyAcceptance = await hit("POST", "/api/stripe/create-checkout-session", {
    ...ticketCheckoutPayload,
    policyAcceptance: { ...ticketCheckoutPayload.policyAcceptance, version: "2027-api-v0" }
  }, false, { "idempotency-key": "ticket-platform-stale-policy-0001" });
  const ticketRetryKey = "ticket-platform-smoke-retry-0001";
  const ticketCheckoutApi = await hit("POST", "/api/stripe/create-checkout-session", ticketCheckoutPayload, false, { "idempotency-key": ticketRetryKey });
  const ticketCheckoutReplayApi = await hit("POST", "/api/stripe/create-checkout-session", ticketCheckoutPayload, false, { "idempotency-key": ticketRetryKey });
  const ticketCheckoutConflictApi = await hit("POST", "/api/stripe/create-checkout-session", {
    ...ticketCheckoutPayload,
    items: [{ productId: "general-admission-3-day", quantity: 1 }]
  }, false, { "idempotency-key": ticketRetryKey });
  const ticketStripeRequests = stripeMock?.requests.filter(item => item.body.get("metadata[order_id]") === ticketCheckoutApi.data.orderId) || [];
  const ticketStripeRequest = ticketStripeRequests[0];
  ok("ticket checkout requires a browser retry key", missingTicketRetryKey.status === 400 && missingTicketRetryKey.data.error?.includes("Idempotency-Key"));
  ok("ticket checkout requires the exact approved policy", missingTicketPolicyAcceptance.status === 400 && missingTicketPolicyAcceptance.data.code === "policy_acceptance_required" && staleTicketPolicyAcceptance.status === 400 && staleTicketPolicyAcceptance.data.code === "policy_version_changed");
  ok("ticket checkout trusts server catalog and creates one Stripe session", ticketCheckoutApi.status === 200 && ticketCheckoutApi.data.checkoutUrl?.startsWith("https://checkout.stripe.com/") && ticketStripeRequests.length === 1 && ticketStripeRequest?.body.get("line_items[0][price]") === "price_platform_ga_2027" && ticketStripeRequest?.body.get("line_items[0][quantity]") === "2" && ticketStripeRequest?.body.get("customer_email") === "ticket-buyer@example.com" && ticketStripeRequest?.body.get("metadata[ticket_policy_version]") === "2027-api-v1" && ticketStripeRequest?.body.get("metadata[ticket_policy_digest]") === readyTicketCatalogApi.data.checkoutPolicy.digest && ticketStripeRequest?.headers["idempotency-key"]?.startsWith("sandfest-ticket-"));
  ok("ticket checkout replay returns the original session", ticketCheckoutReplayApi.status === 200 && ticketCheckoutReplayApi.data.duplicate === true && ticketCheckoutReplayApi.data.checkoutSessionId === ticketCheckoutApi.data.checkoutSessionId && ticketStripeRequests.length === 1);
  ok("ticket checkout retry key rejects a changed cart", ticketCheckoutConflictApi.status === 409 && ticketCheckoutConflictApi.data.error?.includes("different ticket order"));

  if (child) {
    const alertPayload = {
      active: true,
      severity: "warning",
      title: "Lightning hold",
      message: "Please move toward the marked shelter routes.",
      audience: ["public"],
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
    };
    const smsEligibility = await hit("GET", "/api/admin/sms", null, true);
    const eligibleSafetyRecipients = smsEligibility.data.eligibleSafetyRecipients;
    const jobsBeforeSms = await hit("GET", "/api/admin/jobs?limit=100", null, true);
    const publishWithoutSms = await hit("PATCH", "/api/admin/alert", alertPayload, true);
    const jobsAfterNoSms = await hit("GET", "/api/admin/jobs?limit=100", null, true);
    const smsJobsBefore = (jobsBeforeSms.data.jobs || []).filter(job => job.type === "sms.alert.send").length;
    const smsJobsAfterNoSend = (jobsAfterNoSms.data.jobs || []).filter(job => job.type === "sms.alert.send").length;
    ok("publishing a public alert does not implicitly send SMS", publishWithoutSms.status === 200 && publishWithoutSms.data.sms == null && smsJobsAfterNoSend === smsJobsBefore);

    const publishWithSms = await hit("PATCH", "/api/admin/alert", { ...alertPayload, sendSms: true }, true);
    const queuedJobs = await hit("GET", "/api/admin/jobs?limit=100", null, true);
    const serializedJobs = JSON.stringify(queuedJobs.data.jobs || []);
    ok("explicit safety SMS publish creates consent-reference jobs", publishWithSms.status === 200 && eligibleSafetyRecipients > 0 && publishWithSms.data.sms?.queued === eligibleSafetyRecipients && (queuedJobs.data.jobs || []).filter(job => job.type === "sms.alert.send").length === eligibleSafetyRecipients);
    ok("SMS jobs contain no destination phone", !serializedJobs.includes("+13615550188") && !serializedJobs.includes("361-555-0188") && !serializedJobs.includes("recipientPhones"));

    const workerResult = await runSmokeWorkerOnce();
    const providerRequest = twilioMock.requests.at(-1);
    const callbackUrl = providerRequest?.body.get("StatusCallback");
    ok("SMS worker revalidates and submits eligible provider messages", workerResult.exitCode === 0 && twilioMock.requests.length === eligibleSafetyRecipients && callbackUrl?.includes("campaign=") && callbackUrl?.includes("message="), workerResult.stderr || workerResult.stdout);

    const callback = new URL(callbackUrl);
    const callbackPath = `${callback.pathname}${callback.search}`;
    const callbackParams = { MessageSid: providerRequest.responseSid, MessageStatus: "delivered" };
    const invalidTwilioCallback = await hitTwilioForm(callbackPath, callbackParams, callbackUrl, { signature: "invalid" });
    const deliveredTwilioCallback = await hitTwilioForm(callbackPath, callbackParams, callbackUrl);
    const deliveredSmsAdmin = await hit("GET", "/api/admin/sms", null, true);
    ok("Twilio status callback rejects invalid signatures", invalidTwilioCallback.status === 401);
    ok("signed Twilio delivery callback updates aggregate campaign proof", deliveredTwilioCallback.status === 200 && deliveredSmsAdmin.data.summary?.messages?.delivered === 1 && !JSON.stringify(deliveredSmsAdmin.data).includes(providerRequest.responseSid));

    const inboundUrl = `${API_BASE}/api/webhooks/twilio/inbound/smsSafety`;
    const beforeStop = await hit("GET", "/api/admin/sms", null, true);
    const stopParams = {
      From: "+13615550188",
      To: "+15125550000",
      MessageSid: "SM_platform_stop_001",
      Body: "STOP",
      OptOutType: "STOP"
    };
    const stoppedSms = await hitTwilioForm("/api/webhooks/twilio/inbound/smsSafety", stopParams, inboundUrl);
    const afterStop = await hit("GET", "/api/admin/sms", null, true);
    const startParams = { ...stopParams, MessageSid: "SM_platform_start_001", Body: "START", OptOutType: "START" };
    const startedSms = await hitTwilioForm("/api/webhooks/twilio/inbound/smsSafety", startParams, inboundUrl);
    const afterStart = await hit("GET", "/api/admin/sms", null, true);
    ok("signed STOP updates only the safety consent list", stoppedSms.status === 200 && afterStop.data.eligibleSafetyRecipients === beforeStop.data.eligibleSafetyRecipients - 1 && afterStop.data.summary?.preferences?.STOP === 1);
    ok("signed START restores safety consent without duplicate app reply", startedSms.status === 200 && afterStart.data.eligibleSafetyRecipients === beforeStop.data.eligibleSafetyRecipients && startedSms.data.toString("utf8").includes("<Response></Response>"));

    const cancellableAlert = await hit("PATCH", "/api/admin/alert", {
      ...alertPayload,
      title: "Gate hold",
      sendSms: true
    }, true);
    const clearAlert = await hit("PATCH", "/api/admin/alert", {
      active: false,
      severity: "clear",
      title: "",
      message: "",
      audience: ["public"],
      expiresAt: null
    }, true);
    const providerCountBeforeCanceledWorker = twilioMock.requests.length;
    const canceledWorker = await runSmokeWorkerOnce();
    const canceledSmsAdmin = await hit("GET", "/api/admin/sms", null, true);
    ok("clearing an alert suppresses its queued SMS before provider submission", cancellableAlert.data.sms?.queued === eligibleSafetyRecipients && clearAlert.data.sms?.suppressed === eligibleSafetyRecipients && canceledWorker.exitCode === 0 && twilioMock.requests.length === providerCountBeforeCanceledWorker && canceledSmsAdmin.data.summary?.messages?.suppressed >= eligibleSafetyRecipients);
  }

  const ticketPaidEvent = {
    id: "evt_ticket_api_paid_001",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: {
      id: ticketCheckoutApi.data.checkoutSessionId,
      client_reference_id: ticketCheckoutApi.data.orderId,
      metadata: { order_id: ticketCheckoutApi.data.orderId, event_id: DEFAULT_EVENT_ID },
      payment_intent: "pi_ticket_api_paid_001",
      amount_total: 9000,
      currency: "usd",
      payment_status: "paid",
      customer_details: { email: "ticket-buyer@example.com", name: "Ticket Buyer" }
    } }
  };
  const ticketPaidRaw = JSON.stringify(ticketPaidEvent);
  const unsignedTicketWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(ticketPaidRaw), { "content-type": "application/json" });
  const ticketPaidTimestamp = Math.floor(Date.now() / 1000);
  const ticketPaidSignature = createHmac("sha256", SMOKE_STRIPE_WEBHOOK_SECRET).update(`${ticketPaidTimestamp}.${ticketPaidRaw}`).digest("hex");
  const ticketPaidWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(ticketPaidRaw), {
    "content-type": "application/json",
    "stripe-signature": `t=${ticketPaidTimestamp},v1=${ticketPaidSignature}`
  });
  const ticketPaidWebhookReplay = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(ticketPaidRaw), {
    "content-type": "application/json",
    "stripe-signature": `t=${ticketPaidTimestamp},v1=${ticketPaidSignature}`
  });
  const ticketOrdersAfterPayment = await hit("GET", "/api/admin/orders?limit=20", null, true);
  const ticketFulfillmentAfterPayment = await hit("GET", "/api/admin/fulfillment?limit=20", null, true);
  const paidTicketOrder = ticketOrdersAfterPayment.data.pendingOrders?.find(item => item.record?.id === ticketCheckoutApi.data.orderId)?.record;
  const paidTicketFulfillment = ticketFulfillmentAfterPayment.data.fulfillment?.filter(item => item.record?.orderId === ticketCheckoutApi.data.orderId) || [];
  ok("ticket webhook requires a valid Stripe signature", unsignedTicketWebhook.status === 400 && unsignedTicketWebhook.data.error?.includes("missing_signature"));
  ok("signed ticket payment fulfills the stored accepted-policy order", ticketPaidWebhook.status === 200 && ticketPaidWebhook.data.record?.ticketReconciliation?.status === "fulfilled" && paidTicketOrder?.status === "paid" && paidTicketOrder?.paymentIntentId === "pi_ticket_api_paid_001" && paidTicketOrder?.policyAcceptance?.version === "2027-api-v1" && paidTicketOrder?.policyAcceptance?.digest === readyTicketCatalogApi.data.checkoutPolicy.digest && paidTicketFulfillment.length === 2 && paidTicketFulfillment.every(item => item.record?.productId === "general-admission-3-day"));
  ok("ticket fulfillment replay is idempotent and payment evidence is minimized", ticketPaidWebhookReplay.status === 200 && ticketPaidWebhookReplay.data.duplicate === true && !Object.hasOwn(ticketPaidWebhook.data.record || {}, "raw") && paidTicketFulfillment.length === 2);

  const ticketPartialRefundEvent = {
    id: "evt_ticket_api_partial_refund_001",
    type: "charge.refunded",
    livemode: false,
    data: { object: {
      id: "ch_ticket_api_partial_refund_001",
      payment_intent: "pi_ticket_api_paid_001",
      amount: 9000,
      amount_refunded: 3000,
      currency: "usd"
    } }
  };
  const ticketPartialRefundRaw = JSON.stringify(ticketPartialRefundEvent);
  const ticketPartialRefundTimestamp = Math.floor(Date.now() / 1000);
  const ticketPartialRefundSignature = createHmac("sha256", SMOKE_STRIPE_WEBHOOK_SECRET).update(`${ticketPartialRefundTimestamp}.${ticketPartialRefundRaw}`).digest("hex");
  const ticketPartialRefundWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(ticketPartialRefundRaw), {
    "content-type": "application/json",
    "stripe-signature": `t=${ticketPartialRefundTimestamp},v1=${ticketPartialRefundSignature}`
  });
  const ticketOrdersAfterPartialRefund = await hit("GET", "/api/admin/orders?limit=20", null, true);
  const ticketFulfillmentAfterPartialRefund = await hit("GET", "/api/admin/fulfillment?limit=20", null, true);
  const partialTicketOrder = ticketOrdersAfterPartialRefund.data.pendingOrders?.find(item => item.record?.id === ticketCheckoutApi.data.orderId)?.record;
  const partialTicketFulfillment = ticketFulfillmentAfterPartialRefund.data.fulfillment?.filter(item => item.record?.orderId === ticketCheckoutApi.data.orderId) || [];
  ok("signed partial ticket refund enters allocation review", ticketPartialRefundWebhook.status === 200 && ticketPartialRefundWebhook.data.record?.ticketReconciliation?.status === "partially_refunded" && partialTicketOrder?.status === "partially_refunded" && partialTicketOrder?.refundedAmountCents === 3000 && partialTicketFulfillment.length === 2 && partialTicketFulfillment.every(item => item.record?.status === "needs_review"));

  const ticketRefundEvent = {
    id: "evt_ticket_api_refund_001",
    type: "charge.refunded",
    livemode: false,
    data: { object: {
      id: "ch_ticket_api_refund_001",
      payment_intent: "pi_ticket_api_paid_001",
      amount: 9000,
      amount_refunded: 9000,
      currency: "usd"
    } }
  };
  const ticketRefundRaw = JSON.stringify(ticketRefundEvent);
  const ticketRefundTimestamp = Math.floor(Date.now() / 1000);
  const ticketRefundSignature = createHmac("sha256", SMOKE_STRIPE_WEBHOOK_SECRET).update(`${ticketRefundTimestamp}.${ticketRefundRaw}`).digest("hex");
  const ticketRefundWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(ticketRefundRaw), {
    "content-type": "application/json",
    "stripe-signature": `t=${ticketRefundTimestamp},v1=${ticketRefundSignature}`
  });
  const ticketOrdersAfterRefund = await hit("GET", "/api/admin/orders?limit=20", null, true);
  const ticketFulfillmentAfterRefund = await hit("GET", "/api/admin/fulfillment?limit=20", null, true);
  const ticketRevenueAfterRefund = await hit("GET", "/api/admin/revenue", null, true);
  const refundedTicketOrder = ticketOrdersAfterRefund.data.pendingOrders?.find(item => item.record?.id === ticketCheckoutApi.data.orderId)?.record;
  const refundedTicketFulfillment = ticketFulfillmentAfterRefund.data.fulfillment?.filter(item => item.record?.orderId === ticketCheckoutApi.data.orderId) || [];
  const refundedTicketRevenue = ticketRevenueAfterRefund.data.entries?.filter(item => item.sourceRecordId === ticketCheckoutApi.data.orderId) || [];
  ok("signed ticket refund closes the order and fulfillment", ticketRefundWebhook.status === 200 && ticketRefundWebhook.data.record?.ticketReconciliation?.status === "refunded" && refundedTicketOrder?.status === "refunded" && refundedTicketOrder?.refundedAmountCents === 9000 && refundedTicketFulfillment.length === 2 && refundedTicketFulfillment.every(item => item.record?.status === "refunded"));
  ok("site-native ticket orders flow into revenue and reverse cleanly", ticketRevenueAfterRefund.status === 200 && refundedTicketRevenue.length === 2 && refundedTicketRevenue.some(item => item.entryType === "receipt" && item.grossCents === 9000 && item.quantity === 2) && refundedTicketRevenue.some(item => item.entryType === "refund" && item.grossCents === -9000 && item.quantity === -2) && ticketRevenueAfterRefund.data.sources?.ticketOrders?.entries >= 2);

  const revenueImportCsvApi = `external_ref,date,category,gross_amount,fee_amount,net_amount,quantity,payout_id,payout_date,reconciled,entry_type
api_square_settlement_1,2026-07-16,merch,100.00,3.00,97.00,2,square_payout_api_1,2026-07-17,yes,receipt
api_square_invalid,2026-07-16,merch,20.00,1.00,20.00,1,square_payout_api_1,2026-07-17,no,receipt`;
  const unauthenticatedRevenueImportApi = await hit("POST", "/api/admin/revenue/import", { mode: "preview", source: "square", csv: revenueImportCsvApi });
  const revenueImportPreviewApi = await hit("POST", "/api/admin/revenue/import", { mode: "preview", source: "square", fileName: "square-api.csv", csv: revenueImportCsvApi }, true);
  const revenueBeforeCommitApi = await hit("GET", "/api/admin/revenue", null, true);
  const staleRevenueImportApi = await hit("POST", "/api/admin/revenue/import", {
    mode: "commit",
    source: "square",
    fileName: "square-api.csv",
    csv: `${revenueImportCsvApi}\n`,
    previewHash: revenueImportPreviewApi.data.previewHash
  }, true);
  const revenueImportCommitApi = await hit("POST", "/api/admin/revenue/import", {
    mode: "commit",
    source: "square",
    fileName: "square-api.csv",
    csv: revenueImportCsvApi,
    previewHash: revenueImportPreviewApi.data.previewHash
  }, true);
  const revenueImportReplayApi = await hit("POST", "/api/admin/revenue/import", {
    mode: "commit",
    source: "square",
    fileName: "square-api.csv",
    csv: revenueImportCsvApi,
    previewHash: revenueImportPreviewApi.data.previewHash
  }, true);
  const revenueAfterCommitApi = await hit("GET", "/api/admin/revenue", null, true);
  const committedRevenueEntryApi = revenueAfterCommitApi.data.entries?.find(item => item.externalRef === "api_square_settlement_1");
  ok("revenue CSV API requires finance write authentication", unauthenticatedRevenueImportApi.status === 401);
  ok("revenue CSV API preview is non-mutating", revenueImportPreviewApi.status === 200 && revenueImportPreviewApi.data.summary?.importable === 1 && revenueImportPreviewApi.data.summary?.invalid === 1 && /^[a-f0-9]{64}$/.test(revenueImportPreviewApi.data.previewHash || "") && !revenueBeforeCommitApi.data.entries?.some(item => item.externalRef === "api_square_settlement_1"));
  ok("revenue CSV API preview gate", staleRevenueImportApi.status === 409);
  ok("revenue CSV API commit persists current-event provenance", revenueImportCommitApi.status === 201 && revenueImportCommitApi.data.summary?.imported === 1 && committedRevenueEntryApi?.eventId === DEFAULT_EVENT_ID && committedRevenueEntryApi?.importBatchId === revenueImportCommitApi.data.batchId && revenueAfterCommitApi.data.imports?.[0]?.fileName === "square-api.csv");
  ok("revenue CSV API replay is idempotent", revenueImportReplayApi.status === 200 && revenueImportReplayApi.data.replay === true && revenueAfterCommitApi.data.entries?.filter(item => item.externalRef === "api_square_settlement_1").length === 1 && revenueAfterCommitApi.data.imports?.length === 1);
  ok("revenue dashboard includes committed settlement", revenueAfterCommitApi.data.sources?.imported?.entries === 1
    && revenueAfterCommitApi.data.sources?.ticketOrders?.entries === 2
    && revenueAfterCommitApi.data.summary?.totals?.grossCents === 19000
    && revenueAfterCommitApi.data.summary?.totals?.refundCents === 9000
    && revenueAfterCommitApi.data.summary?.totals?.feeCents === 300
    && revenueAfterCommitApi.data.summary?.totals?.netCents === 9700);

  const unauthenticatedBudgetApi = await hit("GET", "/api/admin/budget");
  const emptyBudgetApi = await hit("GET", "/api/admin/budget", null, true);
  const unauthenticatedBudgetLineApi = await hit("POST", "/api/admin/budget/lines", {
    name: "API beach operations",
    ownerTeam: "operations",
    budgetCents: 50_000
  });
  const budgetLineApi = await hit("POST", "/api/admin/budget/lines", {
    name: "API beach operations",
    ownerTeam: "operations",
    budgetCents: 50_000,
    notes: "API workflow verification"
  }, true);
  const duplicateBudgetLineApi = await hit("POST", "/api/admin/budget/lines", {
    name: "api BEACH operations",
    ownerTeam: "finance",
    budgetCents: 10_000
  }, true);
  const budgetLineUpdateWithoutNoteApi = await hit("PATCH", `/api/admin/budget/lines/${budgetLineApi.data.line?.id}`, {
    budgetCents: 52_000
  }, true);
  const budgetLineUpdateApi = await hit("PATCH", `/api/admin/budget/lines/${budgetLineApi.data.line?.id}`, {
    budgetCents: 50_000,
    active: true,
    changeNote: "No amount change required for API verification."
  }, true);
  const paidExpenseRequestApi = await hit("POST", "/api/admin/budget/expenses", {
    budgetLineId: budgetLineApi.data.line?.id,
    vendorName: "API Private Staging Vendor",
    description: "API staging reservation for beach operations",
    amountCents: 30_000,
    dueDate: "2027-02-15"
  }, true);
  const paidExpenseApprovalApi = await hit("POST", `/api/admin/budget/expenses/${paidExpenseRequestApi.data.expense?.id}/approve`, {}, true);
  const paidExpensePaymentApi = await hit("POST", `/api/admin/budget/expenses/${paidExpenseRequestApi.data.expense?.id}/mark-paid`, {
    paymentMethod: "ach",
    paymentReference: "PRIVATE-ACH-API-1001"
  }, true);
  const overBudgetExpenseRequestApi = await hit("POST", "/api/admin/budget/expenses", {
    budgetLineId: budgetLineApi.data.line?.id,
    vendorName: "API Private Safety Vendor",
    description: "API additional safety structures for the beach",
    amountCents: 25_000,
    dueDate: "2027-03-01"
  }, true);
  const overBudgetBlockedApi = await hit("POST", `/api/admin/budget/expenses/${overBudgetExpenseRequestApi.data.expense?.id}/approve`, {}, true);
  const overBudgetApprovedApi = await hit("POST", `/api/admin/budget/expenses/${overBudgetExpenseRequestApi.data.expense?.id}/approve`, {
    allowOverBudget: true,
    note: "Executive exception approved for required safety capacity."
  }, true);
  const repeatedBudgetTransitionApi = await hit("POST", `/api/admin/budget/expenses/${overBudgetExpenseRequestApi.data.expense?.id}/approve`, {}, true);
  const persistedBudgetApi = await hit("GET", "/api/admin/budget", null, true);
  ok("budget API requires finance authentication", unauthenticatedBudgetApi.status === 401 && unauthenticatedBudgetLineApi.status === 401);
  ok("budget API starts current event without sample finance records", emptyBudgetApi.status === 200 && emptyBudgetApi.data.eventId === DEFAULT_EVENT_ID && emptyBudgetApi.data.summary?.counts?.budgetLines === 0);
  ok("budget allocation API enforces uniqueness and noted changes", budgetLineApi.status === 201 && duplicateBudgetLineApi.status === 409
    && budgetLineUpdateWithoutNoteApi.status === 400 && budgetLineUpdateApi.status === 200 && budgetLineUpdateApi.data.line?.createdBy && budgetLineUpdateApi.data.line?.lastChangedBy);
  ok("expense API persists approval and payment evidence", paidExpenseRequestApi.status === 201 && paidExpenseApprovalApi.status === 200
    && paidExpensePaymentApi.status === 200 && paidExpensePaymentApi.data.expense?.status === "paid" && paidExpensePaymentApi.data.expense?.paymentReference === "PRIVATE-ACH-API-1001");
  ok("budget approval fails closed and records explicit overrides", overBudgetBlockedApi.status === 409 && overBudgetBlockedApi.data.code === "OVER_BUDGET"
    && overBudgetApprovedApi.status === 200 && overBudgetApprovedApi.data.expense?.overBudgetOverride === true && repeatedBudgetTransitionApi.status === 409);
  ok("budget summary reconciles paid and committed spend", persistedBudgetApi.status === 200
    && persistedBudgetApi.data.summary?.totals?.budgetCents === 50_000
    && persistedBudgetApi.data.summary?.totals?.paidCents === 30_000
    && persistedBudgetApi.data.summary?.totals?.committedCents === 55_000
    && persistedBudgetApi.data.summary?.counts?.overBudgetLines === 1
    && persistedBudgetApi.data.summary?.counts?.pendingApprovals === 0
    && persistedBudgetApi.data.expenses?.length === 2);

  const eventenyPartnerEmailApi = "eventeny-vendor-api@example.com";
  const eventenyPartnerCsvApi = `application_id,type,business_name,contact_name,contact_email,category,offering_id,package_id,status,reported_amount,event_id
API-EVENTENY-V-1,vendor,API Eventeny Vendor,Vendor Import Contact,${eventenyPartnerEmailApi},retail,marketplace-booth,,Approved,100.00,${DEFAULT_EVENT_ID}
API-EVENTENY-S-1,sponsor,API Eventeny Sponsor,Sponsor Import Contact,eventeny-sponsor-api@example.com,,,tarpon,Accepted,9999.00,${DEFAULT_EVENT_ID}`;
  const eventenyImportPayloadApi = {
    csv: eventenyPartnerCsvApi,
    fileName: "eventeny-applications-api.csv",
    defaultType: "",
    transactionalContactConfirmed: true
  };
  const unauthenticatedPartnerImportApi = await hit("POST", "/api/admin/partners/import", { ...eventenyImportPayloadApi, mode: "preview" });
  const unattestedPartnerImportApi = await hit("POST", "/api/admin/partners/import", { ...eventenyImportPayloadApi, mode: "preview", transactionalContactConfirmed: false }, true);
  const partnerImportBeforeApi = await hit("GET", "/api/admin/partners", null, true);
  const partnerImportPreviewApi = await hit("POST", "/api/admin/partners/import", { ...eventenyImportPayloadApi, mode: "preview" }, true);
  const partnerImportAfterPreviewApi = await hit("GET", "/api/admin/partners", null, true);
  const stalePartnerImportApi = await hit("POST", "/api/admin/partners/import", {
    ...eventenyImportPayloadApi,
    mode: "commit",
    csv: `${eventenyPartnerCsvApi}\n`,
    previewHash: partnerImportPreviewApi.data.previewHash
  }, true);
  const partnerImportCommitApi = await hit("POST", "/api/admin/partners/import", {
    ...eventenyImportPayloadApi,
    mode: "commit",
    previewHash: partnerImportPreviewApi.data.previewHash
  }, true);
  const partnerImportReplayApi = await hit("POST", "/api/admin/partners/import", {
    ...eventenyImportPayloadApi,
    mode: "commit",
    previewHash: partnerImportPreviewApi.data.previewHash
  }, true);
  const changedPartnerImportPreviewApi = await hit("POST", "/api/admin/partners/import", {
    ...eventenyImportPayloadApi,
    mode: "preview",
    csv: eventenyPartnerCsvApi.replace("API Eventeny Vendor", "API Eventeny Vendor LLC")
  }, true);
  const partnerImportAfterCommitApi = await hit("GET", "/api/admin/partners", null, true);
  const importedEventenyVendorApi = partnerImportAfterCommitApi.data.applications?.find(item => item.sourceRef === "eventeny/application/API-EVENTENY-V-1");
  const importedEventenySponsorApi = partnerImportAfterCommitApi.data.applications?.find(item => item.sourceRef === "eventeny/application/API-EVENTENY-S-1");
  const eventenyApplicationIdsApi = new Set([importedEventenyVendorApi?.id, importedEventenySponsorApi?.id].filter(Boolean));
  ok("Eventeny application import requires partner write authentication and attestation", unauthenticatedPartnerImportApi.status === 401 && unattestedPartnerImportApi.status === 400);
  ok("Eventeny application preview is non-mutating", partnerImportPreviewApi.status === 200 && partnerImportPreviewApi.data.summary?.importable === 2 && /^[a-f0-9]{64}$/.test(partnerImportPreviewApi.data.previewHash || "") && partnerImportAfterPreviewApi.data.applications?.length === partnerImportBeforeApi.data.applications?.length && !JSON.stringify(partnerImportPreviewApi.data).includes(eventenyPartnerEmailApi));
  ok("Eventeny application commit rejects stale preview", stalePartnerImportApi.status === 409);
  ok("Eventeny application commit persists trusted workflows", partnerImportCommitApi.status === 201 && partnerImportCommitApi.data.summary?.imported === 2 && importedEventenyVendorApi?.status === "submitted" && importedEventenyVendorApi?.sourceStatus === "Approved" && importedEventenyVendorApi?.sourceBatch === partnerImportCommitApi.data.batchId && importedEventenyVendorApi?.expectedAmountCents === 125000 && importedEventenySponsorApi?.expectedAmountCents === 500000 && partnerImportAfterCommitApi.data.tasks?.filter(item => eventenyApplicationIdsApi.has(item.relatedEntityId)).length === 2 && partnerImportAfterCommitApi.data.vendorProfiles?.some(item => item.applicationId === importedEventenyVendorApi?.id) && partnerImportAfterCommitApi.data.brandProfiles?.some(item => item.applicationId === importedEventenySponsorApi?.id));
  ok("Eventeny application import avoids duplicate acknowledgment", !partnerImportAfterCommitApi.data.followups?.some(item => eventenyApplicationIdsApi.has(item.applicationId) && item.kind === "application_received"));
  ok("Eventeny application replay is idempotent", partnerImportReplayApi.status === 200 && partnerImportReplayApi.data.summary?.imported === 0 && partnerImportReplayApi.data.summary?.duplicates === 2 && partnerImportAfterCommitApi.data.applications?.filter(item => eventenyApplicationIdsApi.has(item.id)).length === 2);
  ok("Eventeny changed application is held for review", changedPartnerImportPreviewApi.status === 200 && changedPartnerImportPreviewApi.data.summary?.conflicts === 1 && changedPartnerImportPreviewApi.data.summary?.duplicates === 1 && changedPartnerImportPreviewApi.data.summary?.importable === 0);

  const unauthenticatedAutomation = await hit("PATCH", "/api/admin/partners/automation", { mode: "transactional_auto" });
  ok("partner automation policy requires authentication", unauthenticatedAutomation.status === 401);
  if (child) {
    const blockedAutomaticMode = await hit("PATCH", "/api/admin/partners/automation", { mode: "transactional_auto" }, true);
    const restoredReviewMode = await hit("PATCH", "/api/admin/partners/automation", { mode: "review_first" }, true);
    const automationWorkspace = await hit("GET", "/api/admin/partners", null, true);
    ok("partner automation fails closed without email", blockedAutomaticMode.status === 409 && blockedAutomaticMode.data.automation?.providerReady === false && blockedAutomaticMode.data.automation?.mode === "review_first");
    ok("partner automation review-first recovery", restoredReviewMode.status === 200 && restoredReviewMode.data.automation?.mode === "review_first" && automationWorkspace.data.automation?.active === false && !JSON.stringify(automationWorkspace.data.automation).includes("@"));
  }

  const webhookRecipient = "webhook-private-recipient@example.com";
  const webhookEvent = {
    event: "delivered",
    email: webhookRecipient,
    id: 9001,
    date: "2026-07-16T12:30:00.000Z",
    "message-id": "platform-smoke-unmatched-message",
    subject: "Platform webhook smoke"
  };
  const webhookWithoutAuth = await hit("POST", "/api/webhooks/brevo", webhookEvent);
  const webhookWrongAuth = await hit("POST", "/api/webhooks/brevo", webhookEvent, false, { authorization: "Bearer wrong-webhook-token" });
  const webhookAccepted = await hit("POST", "/api/webhooks/brevo", webhookEvent, false, { authorization: `Bearer ${SMOKE_BREVO_WEBHOOK_TOKEN}` });
  const webhookReplay = await hit("POST", "/api/webhooks/brevo", webhookEvent, false, { authorization: `Bearer ${SMOKE_BREVO_WEBHOOK_TOKEN}` });
  const webhookMalformed = await hit("POST", "/api/webhooks/brevo", { event: "delivered", email: "bad", id: 9002 }, false, { authorization: `Bearer ${SMOKE_BREVO_WEBHOOK_TOKEN}` });
  const webhookInvalidJson = await hitRaw("POST", "/api/webhooks/brevo", "{", {
    "content-type": "application/json",
    authorization: `Bearer ${SMOKE_BREVO_WEBHOOK_TOKEN}`
  });
  ok("Brevo webhook requires its integration bearer", webhookWithoutAuth.status === 401 && webhookWrongAuth.status === 401);
  ok("Brevo webhook accepts and deduplicates valid events", webhookAccepted.status === 200 && webhookAccepted.data.unmatched === 1 && webhookAccepted.data.pending === 1 && webhookReplay.status === 200 && webhookReplay.data.duplicates === 1 && webhookReplay.data.unmatched === 0);
  ok("Brevo webhook rejects malformed payloads", webhookMalformed.status === 400 && webhookInvalidJson.status === 400);

  if (child) {
    const armedCamera = await hit("PATCH", "/api/admin/island-conditions/cameras/north-gate", {
      sourceId: "api-north-gate-1",
      status: "configured",
      staleAfterMinutes: 5,
      monitoringEnabled: true
    }, true);
    const uncredentialedCamera = await hit("PATCH", "/api/admin/island-conditions/cameras/food-court", {
      sourceId: "api-food-court-1",
      status: "configured",
      monitoringEnabled: true
    }, true);
    const heartbeatBody = JSON.stringify({
      heartbeatId: "api-heartbeat-0001",
      sourceId: "api-north-gate-1",
      observedAt: new Date().toISOString(),
      status: "healthy",
      agentId: "api-beach-agent",
      framesPerSecond: 11.8,
      inferenceLatencyMs: 52,
      droppedFramePct: 0.5,
      agentVersion: "test-2026.07"
    });
    const heartbeatTimestamp = String(Math.floor(Date.now() / 1000));
    const heartbeatSignature = signCameraPayload(heartbeatBody, heartbeatTimestamp, SMOKE_CAMERA_SECRET, { keyId: SMOKE_CAMERA_KEY_ID });
    const heartbeatHeaders = {
      "content-type": "application/json",
      "x-sandfest-timestamp": heartbeatTimestamp,
      "x-sandfest-camera-key-id": SMOKE_CAMERA_KEY_ID,
      "x-sandfest-signature": `sha256=${heartbeatSignature}`
    };
    const firstHeartbeat = await hitRaw("POST", "/api/ingest/cameras/north-gate/heartbeat", Buffer.from(heartbeatBody), heartbeatHeaders);
    const replayedHeartbeat = await hitRaw("POST", "/api/ingest/cameras/north-gate/heartbeat", Buffer.from(heartbeatBody), heartbeatHeaders);
    const metricBody = JSON.stringify({
      eventId: "api-camera-event-0001",
      sourceId: "api-north-gate-1",
      observedAt: new Date().toISOString(),
      peopleCount: 84,
      flowPerMinute: 19,
      occupancyPct: 57,
      confidence: 0.9,
      modelName: "private-model-name"
    });
    const metricTimestamp = String(Math.floor(Date.now() / 1000));
    const metricSignature = signCameraPayload(metricBody, metricTimestamp, SMOKE_CAMERA_NEXT_SECRET, { keyId: SMOKE_CAMERA_NEXT_KEY_ID });
    const metric = await hitRaw("POST", "/api/ingest/cameras/north-gate/observations", Buffer.from(metricBody), {
      "content-type": "application/json",
      "x-sandfest-timestamp": metricTimestamp,
      "x-sandfest-camera-key-id": SMOKE_CAMERA_NEXT_KEY_ID,
      "x-sandfest-signature": `sha256=${metricSignature}`
    });
    const crossCamera = await hitRaw("POST", "/api/ingest/cameras/south-gate/observations", Buffer.from(metricBody), {
      "content-type": "application/json",
      "x-sandfest-timestamp": metricTimestamp,
      "x-sandfest-camera-key-id": SMOKE_CAMERA_NEXT_KEY_ID,
      "x-sandfest-signature": `sha256=${metricSignature}`
    });
    const adminCameraState = await hit("GET", "/api/admin/island-conditions", null, true);
    const publicCameraState = await hit("GET", "/api/public/island-conditions");
    const adminNorth = adminCameraState.data.cameras?.find(camera => camera.id === "north-gate");
    const publicNorth = publicCameraState.data.cameras?.find(camera => camera.id === "north-gate");
    ok("camera source activation gate", armedCamera.status === 200 && armedCamera.data.camera?.monitoringEnabled === true);
    ok("camera source requires its own credential", uncredentialedCamera.status === 409 && uncredentialedCamera.data.ingest?.mode === "per-camera");
    ok("camera credential cannot cross routes", crossCamera.status === 401 && crossCamera.data.error === "Camera ingest authentication failed.");
    ok("signed camera heartbeat replay", firstHeartbeat.status === 201 && replayedHeartbeat.status === 200 && replayedHeartbeat.data.duplicate === true);
    ok("signed camera metric after heartbeat", metric.status === 201 && adminNorth?.operationalStatus === "live" && adminNorth?.health?.agentId === "api-beach-agent");
    ok("camera rotation readiness is admin-visible and secret-free", adminCameraState.data.ingest?.credentialCount === 3 && adminCameraState.data.ingest?.rotatingCameraIds?.includes("north-gate") && !JSON.stringify(adminCameraState.data.ingest).includes(SMOKE_CAMERA_SECRET));
    ok("camera agent internals remain private", publicNorth?.operationalStatus === "live" && publicNorth?.observation?.peopleCount === 84 && !("health" in (publicNorth || {})) && !("modelName" in (publicNorth?.observation || {})) && !("modelSha256" in (publicNorth?.observation || {})));

    async function postSignedMetric(eventId, metrics) {
      const raw = JSON.stringify({ eventId, sourceId: "api-north-gate-1", observedAt: new Date().toISOString(), ...metrics });
      const signedAt = String(Math.floor(Date.now() / 1000));
      return hitRaw("POST", "/api/ingest/cameras/north-gate/observations", Buffer.from(raw), {
        "content-type": "application/json",
        "x-sandfest-timestamp": signedAt,
        "x-sandfest-camera-key-id": SMOKE_CAMERA_KEY_ID,
        "x-sandfest-signature": `sha256=${signCameraPayload(raw, signedAt, SMOKE_CAMERA_SECRET, { keyId: SMOKE_CAMERA_KEY_ID })}`
      });
    }
    const criticalMetric = await postSignedMetric("api-camera-critical-0002", { peopleCount: 410, occupancyPct: 91, queueLength: 23, estimatedWaitMinutes: 35 });
    const criticalReplay = await postSignedMetric("api-camera-critical-0002", { peopleCount: 410, occupancyPct: 91, queueLength: 23, estimatedWaitMinutes: 35 });
    const incidentState = await hit("GET", "/api/admin/island-conditions", null, true);
    const cameraIncident = incidentState.data.incidents?.find(item => item.sourceType === "camera_condition" && item.sourceId === "north-gate");
    ok("signed critical metric opens one incident", criticalMetric.status === 201 && criticalMetric.data.incidentAction === "opened" && criticalReplay.status === 200 && incidentState.data.incidents?.filter(item => item.sourceId === "north-gate" && item.sourceType === "camera_condition").length === 1);
    const assignedIncident = await hit("PATCH", `/api/admin/island-conditions/incidents/${cameraIncident?.id}`, {
      status: "responding",
      ownerTeam: "traffic",
      ownerName: "API traffic desk",
      publicImpact: true,
      note: "Secondary arrival lane opened."
    }, true);
    const publicIncidentState = await hit("GET", "/api/public/island-conditions");
    const publicNotice = publicIncidentState.data.notices?.find(item => item.id === cameraIncident?.id);
    ok("operator approves privacy-safe public notice", assignedIncident.status === 200 && publicNotice?.severity === "critical" && !("ownerName" in (publicNotice || {})) && !("timeline" in (publicNotice || {})));
    await postSignedMetric("api-camera-recovery-0003", { peopleCount: 40, occupancyPct: 15, queueLength: 2, estimatedWaitMinutes: 2 });
    await postSignedMetric("api-camera-recovery-0004", { peopleCount: 35, occupancyPct: 14, queueLength: 1, estimatedWaitMinutes: 2 });
    const recoveryMetric = await postSignedMetric("api-camera-recovery-0005", { peopleCount: 32, occupancyPct: 12, queueLength: 1, estimatedWaitMinutes: 1 });
    const recoveredState = await hit("GET", "/api/admin/island-conditions", null, true);
    ok("camera recovery moves incident to monitoring", recoveryMetric.data.incidentAction === "monitoring" && recoveredState.data.incidents?.find(item => item.id === cameraIncident?.id)?.status === "monitoring");

    const unauthorizedIncident = await hit("POST", "/api/admin/island-conditions/incidents", { title: "Unauthorized incident" });
    const manualIncident = await hit("POST", "/api/admin/island-conditions/incidents", {
      title: "Manual beach access incident",
      summary: "Operator verification in progress.",
      severity: "moderate",
      ownerTeam: "operations"
    }, true);
    const dispatchPath = `/api/admin/island-conditions/incidents/${manualIncident.data.incident?.id}/dispatches`;
    const dispatchInput = {
      assigneeType: "team",
      assigneeId: "traffic",
      channel: "email",
      title: "Verify south beach access",
      instructions: "Confirm the access lane and report to command."
    };
    const unauthorizedDispatch = await hit("POST", dispatchPath, dispatchInput);
    const createdDispatch = await hit("POST", dispatchPath, dispatchInput, true);
    const repeatedDispatch = await hit("POST", dispatchPath, dispatchInput, true);
    const dispatchId = createdDispatch.data.dispatch?.id;
    const editedDispatch = await hit("PATCH", `${dispatchPath}/${dispatchId}`, {
      status: "acknowledged",
      subject: "SandFest access verification",
      body: "Please verify the south beach access lane and report to command."
    }, true);
    const approvedDispatch = await hit("POST", `${dispatchPath}/${dispatchId}/review`, { action: "approve" }, true);
    const disabledDispatchSend = await hit("POST", `${dispatchPath}/${dispatchId}/send`, {}, true);
    const dispatchWorkspace = await hit("GET", "/api/admin/island-conditions", null, true);
    const persistedDispatch = dispatchWorkspace.data.dispatches?.find(item => item.id === dispatchId);
    ok("incident dispatch routes enforce auth and idempotency", unauthorizedDispatch.status === 401 && createdDispatch.status === 201 && repeatedDispatch.status === 200 && repeatedDispatch.data.duplicate === true && dispatchWorkspace.data.dispatches?.filter(item => item.id === dispatchId).length === 1);
    ok("incident dispatch review and readiness gate", editedDispatch.status === 200 && editedDispatch.data.dispatch?.notification?.status === "draft_ready" && approvedDispatch.data.dispatch?.notification?.status === "approved" && disabledDispatchSend.status === 409);
    ok("incident dispatch uses governed team route", createdDispatch.data.dispatch?.assigneeName === "Traffic and parking" && createdDispatch.data.dispatch?.notification?.recipientAvailable === true);
    ok("incident dispatch response minimizes contacts", persistedDispatch?.notification?.recipientAvailable === true && !("recipient" in (persistedDispatch?.notification || {})) && !dispatchWorkspace.data.assignmentDirectory?.staff?.some(item => "email" in item) && !dispatchWorkspace.data.assignmentDirectory?.volunteers?.some(item => "email" in item));
    const rejectedResolution = await hit("PATCH", `/api/admin/island-conditions/incidents/${manualIncident.data.incident?.id}`, { status: "resolved" }, true);
    const acceptedResolution = await hit("PATCH", `/api/admin/island-conditions/incidents/${manualIncident.data.incident?.id}`, { status: "resolved", resolution: "Access confirmed and route restored." }, true);
    const closedDispatchWorkspace = await hit("GET", "/api/admin/island-conditions", null, true);
    const canceledDispatch = closedDispatchWorkspace.data.dispatches?.find(item => item.id === dispatchId);
    const publicAfterDispatch = await hit("GET", "/api/public/island-conditions");
    ok("manual incident routes enforce auth and lifecycle", unauthorizedIncident.status === 401 && manualIncident.status === 201 && rejectedResolution.status === 400 && acceptedResolution.status === 200 && acceptedResolution.data.incident?.status === "resolved");
    ok("incident close cancels dispatch and keeps public payload private", canceledDispatch?.status === "canceled" && canceledDispatch?.notification?.status === "canceled" && !("dispatches" in publicAfterDispatch.data));
  }

  const operatorFerry = await hit("PATCH", "/api/admin/island-conditions/ferry", {
    estimatedWaitMinutes: 23,
    operatingFerries: 4,
    source: "API test operator",
    notes: "Verified by the traffic desk."
  }, true);
  const publicOperatorFerry = await hit("GET", "/api/public/island-conditions");
  const adminOperatorFerry = await hit("GET", "/api/admin/island-conditions", null, true);
  ok("operator ferry override", operatorFerry.status === 200 && operatorFerry.data.ferry?.estimatedWaitMinutes === 23 && operatorFerry.data.ferry?.directions?.length === 0 && operatorFerry.data.ferry?.manualOverrideUntil);
  ok("operator ferry override is public and bounded", publicOperatorFerry.data.ferry?.status === "observed" && publicOperatorFerry.data.ferry?.estimatedWaitMinutes === 23 && publicOperatorFerry.data.ferry?.directions?.length === 0 && !("manualOverrideUntil" in (publicOperatorFerry.data.ferry || {})) && adminOperatorFerry.data.ferry?.manualOverrideUntil);

  const stamp = await hit("POST", "/api/public/passport/stamp", {
    attendeeRef: "suite_api_device",
    payload: "tsf:cp:cp_ent_dune_dragon",
    method: "qr_scan"
  });
  ok("POST passport stamp", stamp.status === 200 || stamp.status === 201, `status ${stamp.status}`);

  const vote = await hit("POST", "/api/public/voting", {
    attendeeRef: "suite_api_voter",
    entryId: "ent_lace_tide",
    channel: "web"
  });
  ok("POST voting", vote.status === 200 || vote.status === 201, `status ${vote.status}`);

  const publicSponsorCatalogApi = await hit("GET", "/api/public/sponsors");
  const publicTarponPackage = publicSponsorCatalogApi.data.sponsorPackages?.find(item => item.id === "tarpon");
  ok("GET public sponsor packages", publicSponsorCatalogApi.status === 200 && publicTarponPackage?.amount === 500000 && publicTarponPackage?.benefits?.includes("8 VIP wristbands") && !Object.hasOwn(publicTarponPackage || {}, "quickBooksItemId") && !Object.hasOwn(publicTarponPackage || {}, "stripePriceId"));
  if (child) {
    const sponsorPackageCreateBody = {
      id: "community-champion",
      name: "Community Champion",
      amount: 750000,
      benefits: ["Community stage recognition"],
      stripePriceId: "price_api_community_champion",
      quickBooksItemId: "api-community-champion-item"
    };
    const concurrentSponsorCreates = await Promise.all([
      hit("POST", "/api/admin/sponsor-packages", sponsorPackageCreateBody, true),
      hit("POST", "/api/admin/sponsor-packages", sponsorPackageCreateBody, true)
    ]);
    const invalidSponsorAmountPatch = await hit("PATCH", "/api/admin/sponsor-packages/tarpon", { amount: 0 }, true);
    const invalidSponsorBenefitPatch = await hit("PATCH", "/api/admin/sponsor-packages/tarpon", { benefits: [] }, true);
    const sponsorPackagePatch = await hit("PATCH", "/api/admin/sponsor-packages/tarpon", {
      quickBooksItemId: "api-sponsor-tarpon-item",
      stripePriceId: "price_api_sponsor_tarpon"
    }, true);
    const publicSponsorCatalogAfterPatch = await hit("GET", "/api/public/sponsors");
    const publicTarponAfterPatch = publicSponsorCatalogAfterPatch.data.sponsorPackages?.find(item => item.id === "tarpon");
    const publicCommunityChampion = publicSponsorCatalogAfterPatch.data.sponsorPackages?.find(item => item.id === "community-champion");
    ok("admin sponsor package creation is atomic", concurrentSponsorCreates.map(item => item.status).sort((a, b) => a - b).join(",") === "201,409" && publicCommunityChampion?.amount === 750000);
    ok("admin sponsor package validation", invalidSponsorAmountPatch.status === 400 && invalidSponsorAmountPatch.data.error?.includes("amount") && invalidSponsorBenefitPatch.status === 400 && invalidSponsorBenefitPatch.data.error?.includes("benefit") && publicTarponAfterPatch?.amount === 500000);
    ok("admin sponsor package accounting mapping stays private", sponsorPackagePatch.status === 200 && sponsorPackagePatch.data.readiness?.ready === true && sponsorPackagePatch.data.sponsorPackage?.quickBooksItemId === "api-sponsor-tarpon-item" && !Object.hasOwn(publicTarponAfterPatch || {}, "quickBooksItemId") && !Object.hasOwn(publicTarponAfterPatch || {}, "stripePriceId") && !Object.hasOwn(publicCommunityChampion || {}, "quickBooksItemId") && !Object.hasOwn(publicCommunityChampion || {}, "stripePriceId"));
  }
  const publicVendorCatalogApi = await hit("GET", "/api/public/vendors");
  const publicMarketplaceOffering = publicVendorCatalogApi.data.vendorOfferings?.find(item => item.id === "marketplace-booth");
  ok("GET public vendor offerings", publicVendorCatalogApi.status === 200 && publicMarketplaceOffering?.amount === 125000 && publicMarketplaceOffering?.categories?.includes("artisan") && !Object.hasOwn(publicMarketplaceOffering || {}, "quickBooksItemId"));
  if (child) {
    const vendorOfferingCreateBody = {
      id: "premium-marketplace-booth",
      name: "Premium marketplace booth",
      amount: 250000,
      categories: ["retail", "artisan"],
      description: "Expanded marketplace booth for larger retail and artisan activations.",
      inclusions: ["Expanded booth footprint", "Published booth listing"],
      stripePriceId: "price_api_premium_marketplace",
      quickBooksItemId: "api-premium-marketplace-item"
    };
    const concurrentVendorOfferingCreates = await Promise.all([
      hit("POST", "/api/admin/vendor-offerings", vendorOfferingCreateBody, true),
      hit("POST", "/api/admin/vendor-offerings", vendorOfferingCreateBody, true)
    ]);
    const invalidVendorOfferingCreate = await hit("POST", "/api/admin/vendor-offerings", {
      ...vendorOfferingCreateBody,
      id: "invalid-vendor-fee",
      amount: 100.5
    }, true);
    const invalidVendorOfferingPatch = await hit("PATCH", "/api/admin/vendor-offerings/marketplace-booth", { categories: [] }, true);
    const vendorOfferingPatch = await hit("PATCH", "/api/admin/vendor-offerings/marketplace-booth", { quickBooksItemId: "api-vendor-marketplace-item" }, true);
    const publicVendorCatalogAfterPatch = await hit("GET", "/api/public/vendors");
    const publicPremiumMarketplace = publicVendorCatalogAfterPatch.data.vendorOfferings?.find(item => item.id === "premium-marketplace-booth");
    ok("admin vendor offering creation is atomic", concurrentVendorOfferingCreates.map(item => item.status).sort((a, b) => a - b).join(",") === "201,409" && invalidVendorOfferingCreate.status === 400 && publicPremiumMarketplace?.amount === 250000);
    ok("admin vendor offering validation", invalidVendorOfferingPatch.status === 400 && invalidVendorOfferingPatch.data.error?.includes("category"));
    ok("admin vendor offering accounting mapping stays private", vendorOfferingPatch.status === 200 && vendorOfferingPatch.data.vendorOffering?.quickBooksItemId === "api-vendor-marketplace-item" && !Object.hasOwn(publicVendorCatalogAfterPatch.data.vendorOfferings?.find(item => item.id === "marketplace-booth") || {}, "quickBooksItemId") && !Object.hasOwn(publicPremiumMarketplace || {}, "quickBooksItemId") && !Object.hasOwn(publicPremiumMarketplace || {}, "stripePriceId"));
  }
  const apiIntakeBody = {
    organizationName: "Platform API Portal Test",
    contactName: "Portal Test",
    contactEmail: "portal-test@example.com",
    category: "artisan",
    vendorOfferingId: "marketplace-booth",
    expectedAmountCents: 999999,
    consentToContact: true,
    botToken: "valid-vendor-token"
  };
  if (child) {
    const rejectedBotIntake = await hit("POST", "/api/public/vendor-applications", { ...apiIntakeBody, botToken: "invalid-token" }, false, { "idempotency-key": "platform-api-vendor-bot-reject-0001" });
    const mismatchedVendorOffering = await hit("POST", "/api/public/vendor-applications", { ...apiIntakeBody, vendorOfferingId: "food-beverage-booth", botToken: "valid-vendor-mismatch-token" }, false, { "idempotency-key": "platform-api-vendor-offering-reject-0001" });
    ok("POST partner intake rejects invalid bot challenge", rejectedBotIntake.status === 400 && rejectedBotIntake.data.error?.includes("verification"));
    ok("POST vendor intake rejects category-offering mismatch", mismatchedVendorOffering.status === 400 && mismatchedVendorOffering.data.error?.includes("not available"));
  }
  const intakeHeaders = { "idempotency-key": "platform-api-vendor-intake-0001" };
  const partnerIntake = await hit("POST", "/api/public/vendor-applications", apiIntakeBody, false, intakeHeaders);
  const repeatedPartnerIntake = await hit("POST", "/api/public/vendor-applications", apiIntakeBody, false, intakeHeaders);
  const conflictingPartnerIntake = await hit("POST", "/api/public/vendor-applications", { ...apiIntakeBody, organizationName: "Changed Portal Test" }, false, intakeHeaders);
  const invalidKeyIntake = await hit("POST", "/api/public/vendor-applications", apiIntakeBody, false, { "idempotency-key": "short" });
  ok("POST partner intake returns portal access", partnerIntake.status === 201 && partnerIntake.data.portalAccess?.token?.startsWith("tsfp_"), `status=${partnerIntake.status} error=${partnerIntake.data.error || "none"}`);
  if (child) {
    const unavailableRecovery = await hit("POST", "/api/public/partner-portal-recovery", {
      reference: partnerIntake.data.application?.reference,
      contactEmail: apiIntakeBody.contactEmail,
      botToken: "valid-portal-recovery-token"
    }, false, { "idempotency-key": "platform-api-portal-recovery-0001" });
    ok("partner portal recovery fails closed without transactional email", unavailableRecovery.status === 503 && !JSON.stringify(unavailableRecovery.data).includes(apiIntakeBody.contactEmail));
  }
  ok("POST partner intake replay", repeatedPartnerIntake.status === 200 && repeatedPartnerIntake.data.duplicate === true && repeatedPartnerIntake.data.application?.id === partnerIntake.data.application?.id && repeatedPartnerIntake.data.portalAccess?.token === partnerIntake.data.portalAccess?.token && repeatedPartnerIntake.data.acknowledgment === "already_received");
  ok("POST partner intake idempotency conflict", conflictingPartnerIntake.status === 409 && invalidKeyIntake.status === 400);
  const idempotentPartnerWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const pricedVendorApplication = idempotentPartnerWorkspace.data.applications?.find(item => item.id === partnerIntake.data.application?.id);
  ok("POST partner intake creates one current-event workflow", idempotentPartnerWorkspace.data.applications?.filter(item => item.id === partnerIntake.data.application?.id && item.eventId === DEFAULT_EVENT_ID).length === 1 && idempotentPartnerWorkspace.data.tasks?.filter(item => item.relatedEntityId === partnerIntake.data.application?.id).length === 1 && idempotentPartnerWorkspace.data.milestones?.filter(item => item.applicationId === partnerIntake.data.application?.id).length === 3 && idempotentPartnerWorkspace.data.followups?.filter(item => item.applicationId === partnerIntake.data.application?.id && item.kind === "application_received").length === 1);
  ok("vendor intake derives trusted offering fee", pricedVendorApplication?.offeringId === "marketplace-booth" && pricedVendorApplication?.offeringName === "Marketplace booth" && pricedVendorApplication?.expectedAmountCents === 125000 && pricedVendorApplication?.requestedAmountCents === 0);
  const partnerStatus = await hit("POST", "/api/public/partner-status", {
    reference: partnerIntake.data.application?.reference,
    token: partnerIntake.data.portalAccess?.token
  });
  ok("POST partner status", partnerStatus.status === 200 && partnerStatus.data.application?.organizationName === "Platform API Portal Test" && partnerStatus.data.application?.offeringName === "Marketplace booth" && partnerStatus.data.application?.finance?.expectedAmountCents === 125000);
  ok("partner status API privacy", !("contactEmail" in (partnerStatus.data.application || {})) && !("portalAccessId" in (partnerStatus.data.application || {})));
  const rotatedPortal = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(partnerIntake.data.application?.id)}/portal-access`, {}, true);
  const staleStatus = await hit("POST", "/api/public/partner-status", {
    reference: partnerIntake.data.application?.reference,
    token: partnerIntake.data.portalAccess?.token
  });
  const currentStatus = await hit("POST", "/api/public/partner-status", {
    reference: partnerIntake.data.application?.reference,
    token: rotatedPortal.data.portalAccess?.token
  });
  ok("partner portal rotation endpoint", rotatedPortal.status === 200 && staleStatus.status === 404 && currentStatus.status === 200);

  const vendorAccess = { reference: partnerIntake.data.application?.reference, token: rotatedPortal.data.portalAccess?.token };
  const apiVendorProfileInput = {
    legalName: "Platform API Portal Test LLC",
    boothName: "Platform API Portal Test",
    website: "https://platform-vendor.example/",
    publicDescription: "Handmade coastal goods and event merchandise.",
    emergencyContactName: "Portal Test",
    emergencyContactPhone: "361-555-0110",
    powerNeed: "20a",
    waterRequired: false,
    cookingMethod: "none",
    vehicleLengthFeet: 18,
    operationalNotes: "One enclosed trailer."
  };
  const vendorProfileApi = await hit("POST", "/api/public/partner-vendor-profile", {
    ...vendorAccess,
    profile: apiVendorProfileInput
  });
  const vendorAgreementApi = vendorProfileApi.data.application?.vendorOnboarding?.requirements?.find(item => item.code === "vendor_agreement");
  ok("POST vendor operational profile", vendorProfileApi.status === 200 && vendorProfileApi.data.application?.vendorOnboarding?.profile?.status === "submitted" && vendorAgreementApi?.status === "missing");
  const apiVendorPdf = Buffer.from("%PDF-1.4\nSandFest vendor agreement test\n%%EOF\n");
  const vendorDocumentApi = await hitRaw("POST", "/api/public/partner-vendor-documents/upload", apiVendorPdf, {
    "content-type": "application/pdf",
    "x-partner-reference": vendorAccess.reference,
    "x-partner-token": vendorAccess.token,
    "x-requirement-id": vendorAgreementApi?.id,
    "x-file-name": "signed-vendor-agreement.pdf",
    "x-document-label": "Signed vendor agreement"
  });
  const uploadedVendorDocument = vendorDocumentApi.data.application?.vendorOnboarding?.requirements?.find(item => item.id === vendorAgreementApi?.id)?.document;
  ok("POST private vendor document", vendorDocumentApi.status === 201 && uploadedVendorDocument?.sourceType === "upload" && !("storageKey" in (uploadedVendorDocument || {})));
  const vendorAdminWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const vendorApplicationApi = vendorAdminWorkspace.data.applications?.find(item => item.id === partnerIntake.data.application?.id);
  const vendorProfileChangesApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(vendorApplicationApi?.id)}/vendor-profile/review`, { action: "request_changes", reviewNotes: "Clarify trailer placement." }, true);
  const vendorDraftWorkspaceApi = await hit("GET", "/api/admin/partners", null, true);
  const vendorProfileDraftApi = vendorDraftWorkspaceApi.data.followups?.find(item => item.kind === "vendor_profile_changes" && item.applicationId === vendorApplicationApi?.id);
  ok("admin vendor profile change draft", vendorProfileChangesApi.status === 200 && vendorProfileChangesApi.data.notificationDrafted === true && vendorProfileDraftApi?.status === "draft_ready" && vendorProfileDraftApi?.body.includes(rotatedPortal.data.portalAccess?.url));
  const vendorProfileRevisionApi = await hit("POST", "/api/public/partner-vendor-profile", { ...vendorAccess, profile: { ...apiVendorProfileInput, operationalNotes: "One enclosed trailer placed within the assigned footprint." } });
  const vendorProfileApprovalApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(vendorApplicationApi?.id)}/vendor-profile/review`, { action: "approve" }, true);
  const vendorRequirementChangesApi = await hit("PATCH", `/api/admin/partners/vendor-requirements/${encodeURIComponent(vendorAgreementApi?.id)}`, { status: "changes_requested", reviewNotes: "Add the signer title." }, true);
  const vendorRequirementApprovalApi = await hit("PATCH", `/api/admin/partners/vendor-requirements/${encodeURIComponent(vendorAgreementApi?.id)}`, { status: "approved", expiresAt: "2027-07-16T12:00:00.000Z" }, true);
  const vendorAssignmentApi = await hit("PATCH", `/api/admin/partners/applications/${encodeURIComponent(vendorApplicationApi?.id)}/vendor-assignment`, {
    status: "scheduled",
    boothNumber: "A-17",
    zone: "Artisan row",
    accessGate: "South service gate",
    loadInStart: "2026-08-14T12:00:00.000Z",
    loadInEnd: "2026-08-14T13:00:00.000Z",
    loadOutStart: "2026-08-17T02:00:00.000Z",
    loadOutEnd: "2026-08-17T03:00:00.000Z",
    parkingPasses: 1,
    staffWristbands: 3,
    instructions: "Check in with the artisan-row captain."
  }, true);
  const vendorAssignmentConfirmationApi = await hit("POST", "/api/public/partner-vendor-assignment/confirm", vendorAccess);
  ok("admin vendor workflow notification drafts", vendorProfileRevisionApi.status === 200 && vendorRequirementChangesApi.data.notificationDrafted === true && vendorAssignmentApi.data.notificationDrafted === true);
  ok("admin vendor review and assignment", vendorProfileApprovalApi.status === 200 && vendorRequirementApprovalApi.status === 200 && vendorAssignmentApi.status === 200 && vendorAssignmentConfirmationApi.data.application?.vendorOnboarding?.assignment?.status === "confirmed");
  const vendorDocumentDownloadApi = await hitRaw("POST", `/api/public/partner-vendor-documents/${encodeURIComponent(uploadedVendorDocument?.id)}/content`, Buffer.from(JSON.stringify(vendorAccess)), { "content-type": "application/json" });
  ok("private vendor document download", vendorDocumentDownloadApi.status === 200 && Buffer.isBuffer(vendorDocumentDownloadApi.data) && vendorDocumentDownloadApi.data.equals(apiVendorPdf));
  const vendorWorkspaceUpdatedApi = await hit("GET", "/api/admin/partners", null, true);
  ok("vendor readiness API summary", vendorWorkspaceUpdatedApi.data.vendorReadiness?.vendors?.some(item => item.applicationId === vendorApplicationApi?.id && item.assignmentStatus === "confirmed" && item.compliance.approved === 1) && vendorWorkspaceUpdatedApi.data.vendorDocuments?.some(item => item.id === uploadedVendorDocument?.id && item.status === "approved"));
  const vendorWorkflowNoticesApi = vendorWorkspaceUpdatedApi.data.followups?.filter(item => item.applicationId === vendorApplicationApi?.id && item.workflowKey?.startsWith("vendor_")) || [];
  ok("vendor workflow notices dismiss when resolved", vendorWorkflowNoticesApi.length === 3 && vendorWorkflowNoticesApi.every(item => item.status === "dismissed") && vendorWorkflowNoticesApi.every(item => !item.sentAt));

  if (child && stripeMock) {
    const payableVendor = await hit("PATCH", `/api/admin/partners/applications/${encodeURIComponent(vendorApplicationApi?.id)}`, {
      status: "approved"
    }, true);
    const vendorInvoice = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(vendorApplicationApi?.id)}/invoices`, {
      dueAt: "2026-08-15T17:00:00.000Z",
      description: "Platform API vendor booth fee"
    }, true);
    const vendorInvoiceWorkspace = await hit("GET", "/api/admin/partners", null, true);
    const vendorPaymentMilestone = vendorInvoiceWorkspace.data.milestones?.find(item => item.applicationId === vendorApplicationApi?.id && item.kind === "payment_due");
    const approvedVendorInvoice = await hit("POST", `/api/admin/partners/invoices/${encodeURIComponent(vendorInvoice.data.invoice?.id)}/review`, { action: "approve" }, true);
    const checkoutRequest = { ...vendorAccess, invoiceId: vendorInvoice.data.invoice?.id };
    const partnerCheckoutApi = await hit("POST", "/api/public/partner-payment-checkout", checkoutRequest);
    const repeatedPartnerCheckoutApi = await hit("POST", "/api/public/partner-payment-checkout", checkoutRequest);
    const partnerStripeRequests = stripeMock.requests.filter(item => item.body.get("metadata[partner_checkout_id]"));
    const stripeRequest = partnerStripeRequests.at(-1);
    ok("partner checkout API uses offering-priced invoice", payableVendor.status === 200 && vendorInvoice.data.invoice?.amountCents === 125000 && vendorInvoice.data.invoice?.quickBooksItemId === "api-vendor-marketplace-item" && approvedVendorInvoice.status === 200 && partnerCheckoutApi.status === 201 && partnerCheckoutApi.data.checkout?.checkoutUrl.startsWith("https://checkout.stripe.com/") && stripeRequest?.body.get("line_items[0][price_data][unit_amount]") === "125000" && stripeRequest?.body.get("metadata[partner_invoice_id]") === vendorInvoice.data.invoice?.id);
    ok("partner invoice API synchronizes payment key date", vendorPaymentMilestone?.dueAt === vendorInvoice.data.invoice?.dueAt && vendorPaymentMilestone?.assigneeTeam === "finance");
    ok("partner checkout API reuses open session", repeatedPartnerCheckoutApi.status === 200 && repeatedPartnerCheckoutApi.data.duplicate === true && repeatedPartnerCheckoutApi.data.checkout?.id === partnerCheckoutApi.data.checkout?.id && partnerStripeRequests.length === 1);
    const partnerPaidEvent = {
      id: "evt_partner_api_paid_001",
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_partner_api_001",
        payment_intent: "pi_partner_api_001",
        amount_total: 125000,
        currency: "usd",
        payment_status: "paid",
        metadata: {
          sandfest_flow: "partner_invoice",
          partner_checkout_id: partnerCheckoutApi.data.checkout?.id,
          partner_application_id: vendorApplicationApi?.id,
          partner_invoice_id: vendorInvoice.data.invoice?.id
        }
      } }
    };
    const paidRaw = JSON.stringify(partnerPaidEvent);
    const paidTimestamp = String(Math.floor(Date.now() / 1000));
    const paidSignature = createHmac("sha256", SMOKE_STRIPE_WEBHOOK_SECRET).update(`${paidTimestamp}.${paidRaw}`).digest("hex");
    const paidWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(paidRaw), {
      "content-type": "application/json",
      "stripe-signature": `t=${paidTimestamp},v1=${paidSignature}`
    });
    const repeatedPaidWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(paidRaw), {
      "content-type": "application/json",
      "stripe-signature": `t=${paidTimestamp},v1=${paidSignature}`
    });
    const stalePaidEvent = JSON.stringify({ ...partnerPaidEvent, id: "evt_partner_api_stale_001" });
    const stalePaidTimestamp = String(Math.floor(Date.now() / 1000) - 900);
    const stalePaidSignature = createHmac("sha256", SMOKE_STRIPE_WEBHOOK_SECRET).update(`${stalePaidTimestamp}.${stalePaidEvent}`).digest("hex");
    const stalePaidWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(stalePaidEvent), {
      "content-type": "application/json",
      "stripe-signature": `t=${stalePaidTimestamp},v1=${stalePaidSignature}`
    });
    const paidPartnerWorkspace = await hit("GET", "/api/admin/partners", null, true);
    const paidPartnerPortal = await hit("POST", "/api/public/partner-status", vendorAccess);
    const partnerPayment = paidPartnerWorkspace.data.payments?.find(item => item.paymentIntentId === "pi_partner_api_001");
    const reconciledInvoice = paidPartnerWorkspace.data.invoices?.find(item => item.id === vendorInvoice.data.invoice?.id);
    const completedCheckout = paidPartnerWorkspace.data.paymentCheckouts?.find(item => item.id === partnerCheckoutApi.data.checkout?.id);
    const paidVendorMilestone = paidPartnerWorkspace.data.milestones?.find(item => item.id === vendorPaymentMilestone?.id);
    const partnerFulfillment = await hit("GET", "/api/admin/fulfillment", null, true);
    ok("signed partner webhook reconciles receivable", paidWebhook.status === 200 && paidWebhook.data.record?.partnerReconciliation?.status === "reconciled" && partnerPayment?.amountCents === 125000 && partnerPayment?.status === "succeeded" && reconciledInvoice?.balanceCents === 0 && completedCheckout?.status === "completed" && paidPartnerPortal.data.application?.finance?.paymentStatus === "paid");
    ok("signed partner webhook completes payment key date", paidVendorMilestone?.status === "completed" && paidVendorMilestone?.completedBy === "automation:payment_reconciliation");
    ok("partner webhook replay is idempotent", repeatedPaidWebhook.status === 200 && repeatedPaidWebhook.data.duplicate === true && paidPartnerWorkspace.data.payments?.filter(item => item.paymentIntentId === "pi_partner_api_001").length === 1);
    ok("stale Stripe webhook is rejected", stalePaidWebhook.status === 400 && stalePaidWebhook.data.error?.includes("timestamp_outside_tolerance"));
    ok("partner payment skips ticket fulfillment", !partnerFulfillment.data.fulfillment?.some(item => (item.record || item).checkoutSessionId === "cs_partner_api_001"));
    const partnerRefundEvent = {
      id: "evt_partner_api_refund_001",
      type: "charge.refunded",
      data: { object: {
        id: "ch_partner_api_001",
        payment_intent: "pi_partner_api_001",
        amount: 125000,
        amount_refunded: 25000,
        currency: "usd",
        metadata: { sandfest_flow: "partner_invoice" }
      } }
    };
    const refundRaw = JSON.stringify(partnerRefundEvent);
    const refundTimestamp = String(Math.floor(Date.now() / 1000));
    const refundSignature = createHmac("sha256", SMOKE_STRIPE_WEBHOOK_SECRET).update(`${refundTimestamp}.${refundRaw}`).digest("hex");
    const refundWebhook = await hitRaw("POST", "/api/stripe/webhook", Buffer.from(refundRaw), {
      "content-type": "application/json",
      "stripe-signature": `t=${refundTimestamp},v1=${refundSignature}`
    });
    const refundedPartnerWorkspace = await hit("GET", "/api/admin/partners", null, true);
    const refundedPartnerPayment = refundedPartnerWorkspace.data.payments?.find(item => item.paymentIntentId === "pi_partner_api_001");
    const refundedVendorInvoice = refundedPartnerWorkspace.data.invoices?.find(item => item.id === vendorInvoice.data.invoice?.id);
    const refundedVendorMilestone = refundedPartnerWorkspace.data.milestones?.find(item => item.id === vendorPaymentMilestone?.id);
    ok("Stripe partial refund restores receivable", refundWebhook.status === 200 && refundWebhook.data.record?.partnerReconciliation?.status === "reconciled" && refundedPartnerPayment?.status === "partially_refunded" && refundedPartnerPayment?.refundedAmountCents === 25000 && refundedVendorInvoice?.balanceCents === 25000);
    ok("Stripe partial refund reopens payment key date", refundedVendorMilestone?.status === "open" && refundedVendorMilestone?.scheduleVersion === paidVendorMilestone.scheduleVersion + 1);
  }

  const sponsorIntakeBody = {
    organizationName: "Platform Brand Sponsor",
    contactName: "Brand Test",
    contactEmail: "brand-test@example.com",
    website: "https://brand-sponsor.example",
    packageId: "tarpon",
    consentToContact: true,
    botToken: "valid-sponsor-token"
  };
  const sponsorIntakeHeaders = { "idempotency-key": "platform-api-sponsor-intake-0001" };
  const sponsorIntake = await hit("POST", "/api/public/sponsor-inquiries", sponsorIntakeBody, false, sponsorIntakeHeaders);
  const repeatedSponsorIntake = await hit("POST", "/api/public/sponsor-inquiries", sponsorIntakeBody, false, sponsorIntakeHeaders);
  const sponsorAccess = { reference: sponsorIntake.data.application?.reference, token: sponsorIntake.data.portalAccess?.token };
  ok("POST sponsor seeds package deliverables", sponsorIntake.status === 201 && sponsorAccess.token?.startsWith("tsfp_") && repeatedSponsorIntake.status === 200 && repeatedSponsorIntake.data.duplicate === true && repeatedSponsorIntake.data.application?.id === sponsorIntake.data.application?.id && repeatedSponsorIntake.data.portalAccess?.token === sponsorAccess.token);
  if (child) {
    ok("partner intake calls Siteverify for vendor and sponsor actions", turnstileMock.requests.some(item => item.body.response === "valid-vendor-token") && turnstileMock.requests.some(item => item.body.response === "valid-sponsor-token") && turnstileMock.requests.every(item => item.body.secret === "turnstile-smoke-secret-0123456789"));
  }
  const submittedProfile = await hit("POST", "/api/public/partner-brand-profile", {
    ...sponsorAccess,
    profile: {
      displayName: "Platform Brand Sponsor",
      website: "https://brand-sponsor.example/",
      tagline: "Coastal service",
      primaryColor: "#005B63",
      secondaryColor: "#F7B733",
      usageNotes: "Use the primary mark on light backgrounds."
    }
  });
  ok("POST sponsor brand profile", submittedProfile.status === 200 && submittedProfile.data.application?.branding?.profile?.status === "submitted");
  const apiPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("api-brand-test")]);
  const uploadedAsset = await hitRaw("POST", "/api/public/partner-brand-assets/upload", apiPng, {
    "content-type": "image/png",
    "x-partner-reference": sponsorAccess.reference,
    "x-partner-token": sponsorAccess.token,
    "x-file-name": "platform-brand-logo.png",
    "x-asset-kind": "primary_logo",
    "x-asset-label": "Primary logo"
  });
  ok("POST private sponsor asset upload", uploadedAsset.status === 201 && uploadedAsset.data.asset?.sourceType === "upload" && !("storageKey" in (uploadedAsset.data.asset || {})));
  const hiddenSponsorShowcase = await hit("GET", "/api/public/sponsors");
  ok("unapproved sponsor is absent from public API", !hiddenSponsorShowcase.data.sponsors?.some(item => item.displayName === "Platform Brand Sponsor"));
  const sponsorWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const sponsorApplication = sponsorWorkspace.data.applications?.find(item => item.id === sponsorIntake.data.application?.id);
  const sponsorApplicationApproval = await hit("PATCH", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}`, { status: "approved" }, true);
  const sponsorProfileChangeReview = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/brand-profile/review`, {
    action: "request_changes",
    reviewNotes: "Add the approved community campaign wording."
  }, true);
  const resubmittedProfile = await hit("POST", "/api/public/partner-brand-profile", {
    ...sponsorAccess,
    profile: {
      displayName: "Platform Brand Sponsor",
      website: "https://brand-sponsor.example/",
      tagline: "Coastal service for the community",
      primaryColor: "#005B63",
      secondaryColor: "#F7B733",
      usageNotes: "Use the primary mark on light backgrounds."
    }
  });
  const sponsorProfileReview = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/brand-profile/review`, { action: "approve" }, true);
  const sponsorAssetChangeReview = await hit("PATCH", `/api/admin/partners/brand-assets/${encodeURIComponent(uploadedAsset.data.asset?.id)}`, {
    status: "changes_requested",
    reviewNotes: "Confirm this is the transparent-background master."
  }, true);
  const sponsorAssetReview = await hit("PATCH", `/api/admin/partners/brand-assets/${encodeURIComponent(uploadedAsset.data.asset?.id)}`, { status: "approved" }, true);
  const reviewedSponsorWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const profileChangeNoticeApi = reviewedSponsorWorkspace.data.followups?.find(item => item.id === sponsorProfileChangeReview.data.followup?.id);
  const assetChangeNoticeApi = reviewedSponsorWorkspace.data.followups?.find(item => item.id === sponsorAssetChangeReview.data.followup?.id);
  ok("sponsor brand review API drafts private guidance", sponsorProfileChangeReview.status === 200 && sponsorProfileChangeReview.data.notificationDrafted === true && sponsorProfileChangeReview.data.followup?.kind === "sponsor_brand_changes" && sponsorProfileChangeReview.data.followup?.body.includes("#partner-status?") && sponsorAssetChangeReview.status === 200 && sponsorAssetChangeReview.data.notificationDrafted === true && sponsorAssetChangeReview.data.followup?.brandAssetId === uploadedAsset.data.asset?.id);
  ok("resolved sponsor brand reviews dismiss stale guidance", resubmittedProfile.status === 200 && profileChangeNoticeApi?.status === "dismissed" && sponsorApplicationApproval.status === 200 && sponsorProfileReview.status === 200 && sponsorProfileReview.data.profile?.status === "approved" && sponsorAssetReview.status === 200 && sponsorAssetReview.data.asset?.status === "approved" && assetChangeNoticeApi?.status === "dismissed");
  const publicSponsorShowcaseApi = await hit("GET", "/api/public/sponsors");
  const publicSponsorApi = publicSponsorShowcaseApi.data.sponsors?.find(item => item.displayName === "Platform Brand Sponsor");
  const publicSponsorLogoApi = await hitRaw("GET", publicSponsorApi?.logo?.path, undefined);
  ok("approved sponsor publishes to public API", publicSponsorApi?.tagline === "Coastal service for the community" && publicSponsorApi?.logo?.contentType === "image/png" && !("applicationId" in publicSponsorApi) && !("contactEmail" in publicSponsorApi));
  ok("approved sponsor logo is public and immutable", publicSponsorLogoApi.status === 200 && Buffer.isBuffer(publicSponsorLogoApi.data) && publicSponsorLogoApi.data.equals(apiPng) && publicSponsorLogoApi.headers.get("cache-control") === "public, max-age=86400, immutable" && publicSponsorLogoApi.headers.get("content-disposition")?.startsWith("inline;"));
  const sponsorDeliverable = sponsorWorkspace.data.deliverables?.find(item => item.applicationId === sponsorApplication?.id);
  const publishedDeliverable = await hit("PATCH", `/api/admin/partners/deliverables/${encodeURIComponent(sponsorDeliverable?.id)}`, {
    status: "published",
    dueAt: "2026-08-01T17:00:00.000Z",
    proofUrl: "https://www.texassandfest.org/sponsors/platform-brand-sponsor",
    proofNotes: "Sponsor listing is live."
  }, true);
  const partnerSignoff = await hit("POST", `/api/public/partner-deliverables/${encodeURIComponent(sponsorDeliverable?.id)}/review`, {
    ...sponsorAccess,
    action: "approve"
  });
  const signedOffSponsorWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const proofReviewNoticeApi = signedOffSponsorWorkspace.data.followups?.find(item => item.id === publishedDeliverable.data.followup?.id);
  ok("sponsor deliverable proof and sign-off API", publishedDeliverable.status === 200 && publishedDeliverable.data.deliverable?.partnerReviewStatus === "pending" && publishedDeliverable.data.notificationDrafted === true && publishedDeliverable.data.followup?.kind === "sponsor_deliverable_review" && publishedDeliverable.data.followup?.body.includes("#partner-status?") && partnerSignoff.status === 200 && partnerSignoff.data.application?.branding?.deliverables?.find(item => item.id === sponsorDeliverable?.id)?.partnerReviewStatus === "approved" && proofReviewNoticeApi?.status === "dismissed");
  const downloadedAsset = await hitRaw("POST", `/api/public/partner-brand-assets/${encodeURIComponent(uploadedAsset.data.asset?.id)}/content`, Buffer.from(JSON.stringify(sponsorAccess)), { "content-type": "application/json" });
  ok("private sponsor asset download", downloadedAsset.status === 200 && Buffer.isBuffer(downloadedAsset.data) && downloadedAsset.data.equals(apiPng) && downloadedAsset.headers.get("cache-control") === "private, no-store");
  const updatedSponsorWorkspace = await hit("GET", "/api/admin/partners", null, true);
  ok("sponsor fulfillment API summary", updatedSponsorWorkspace.data.fulfillment?.profiles?.approved === 1 && updatedSponsorWorkspace.data.fulfillment?.assets?.approved === 1 && updatedSponsorWorkspace.data.deliverables?.filter(item => item.applicationId === sponsorApplication?.id).length === 6);

  const sponsorMilestone = updatedSponsorWorkspace.data.milestones?.find(item => item.applicationId === sponsorApplication?.id);
  const rescheduledMilestoneApi = await hit("PATCH", `/api/admin/partners/milestones/${encodeURIComponent(sponsorMilestone?.id)}`, {
    dueAt: "2026-09-01T17:00:00.000Z",
    assigneeTeam: "finance",
    reminderLeadDays: 5,
    notes: "Confirm the package handoff with finance."
  }, true);
  const customMilestoneApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/milestones`, {
    label: "Hospitality roster due",
    dueAt: "2026-09-15T17:00:00.000Z",
    assigneeTeam: "guest-services",
    reminderLeadDays: 4,
    notes: "Collect attendee names and dietary needs."
  }, true);
  const invalidMilestoneApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/milestones`, {
    label: "Invalid date",
    dueAt: "not-a-date",
    assigneeTeam: "sponsor"
  }, true);
  const milestoneWorkspaceApi = await hit("GET", "/api/admin/partners", null, true);
  const persistedCustomMilestone = milestoneWorkspaceApi.data.milestones?.find(item => item.id === customMilestoneApi.data.milestone?.id);
  ok("admin milestone create and reschedule API", rescheduledMilestoneApi.status === 200 && rescheduledMilestoneApi.data.milestone?.scheduleVersion === 2 && rescheduledMilestoneApi.data.milestone?.assigneeTeam === "finance" && customMilestoneApi.status === 201 && persistedCustomMilestone?.assigneeTeam === "guest-services" && !("ok" in (persistedCustomMilestone || {})));
  ok("admin milestone validation and summary API", invalidMilestoneApi.status === 400 && milestoneWorkspaceApi.data.milestoneSummary?.totals?.open >= 7);
  const completedMilestoneApi = await hit("PATCH", `/api/admin/partners/milestones/${encodeURIComponent(customMilestoneApi.data.milestone?.id)}`, { status: "completed" }, true);
  const completedMilestoneWorkspaceApi = await hit("GET", "/api/admin/partners", null, true);
  ok("admin milestone completion API", completedMilestoneApi.status === 200 && completedMilestoneApi.data.milestone?.status === "completed" && completedMilestoneApi.data.milestone?.completedBy && completedMilestoneWorkspaceApi.data.milestoneSummary?.totals?.completed >= 1);

  const approvedSponsor = await hit("PATCH", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}`, { status: "approved" }, true);
  const invoiceApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/invoices`, { dueAt: "2026-08-15T17:00:00.000Z" }, true);
  const invoicedSponsorWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const sponsorPaymentMilestoneApi = invoicedSponsorWorkspace.data.milestones?.find(item => item.applicationId === sponsorApplication?.id && item.kind === "payment_due");
  ok("finance creates approved invoice", approvedSponsor.status === 200 && invoiceApi.status === 201 && invoiceApi.data.invoice?.balanceCents === invoiceApi.data.invoice?.amountCents && sponsorPaymentMilestoneApi?.dueAt === invoiceApi.data.invoice?.dueAt && sponsorPaymentMilestoneApi?.assigneeTeam === "finance");
  const quickBooksReconciliationGateApi = await hit("POST", `/api/admin/partners/invoices/${encodeURIComponent(invoiceApi.data.invoice?.id)}/reconcile`, null, true);
  ok("QuickBooks reconciliation API is credential gated", quickBooksReconciliationGateApi.status === 409 && quickBooksReconciliationGateApi.data.quickbooks?.canSyncPartnerInvoices === false);
  const unauthenticatedQuickBooksStatusApi = await hit("GET", "/api/admin/integrations/quickbooks");
  const initialQuickBooksStatusApi = await hit("GET", "/api/admin/integrations/quickbooks", null, true);
  const quickBooksAuthorizationApi = await hit("POST", "/api/admin/integrations/quickbooks/authorize", null, true);
  const quickBooksAuthorizationUrlApi = new URL(quickBooksAuthorizationApi.data.authorizationUrl);
  const quickBooksStateApi = quickBooksAuthorizationUrlApi.searchParams.get("state");
  const quickBooksCodeApi = "quickbooks-private-code";
  const quickBooksRealmApi = "quickbooks-private-realm";
  const quickBooksCallbackApi = await hitRaw("GET", `/api/integrations/quickbooks/callback?state=${encodeURIComponent(quickBooksStateApi)}&code=${encodeURIComponent(quickBooksCodeApi)}&realmId=${encodeURIComponent(quickBooksRealmApi)}`);
  const quickBooksCallbackTextApi = quickBooksCallbackApi.data.toString("utf8");
  const quickBooksReplayApi = await hitRaw("GET", `/api/integrations/quickbooks/callback?state=${encodeURIComponent(quickBooksStateApi)}&code=${encodeURIComponent(quickBooksCodeApi)}&realmId=${encodeURIComponent(quickBooksRealmApi)}`);
  const canceledQuickBooksAuthorizationApi = await hit("POST", "/api/admin/integrations/quickbooks/authorize", null, true);
  const canceledQuickBooksStateApi = new URL(canceledQuickBooksAuthorizationApi.data.authorizationUrl).searchParams.get("state");
  const canceledQuickBooksCallbackApi = await hitRaw("GET", `/api/integrations/quickbooks/callback?error=access_denied&error_description=${encodeURIComponent("private provider detail")}&state=${encodeURIComponent(canceledQuickBooksStateApi)}`);
  const canceledQuickBooksReplayApi = await hitRaw("GET", `/api/integrations/quickbooks/callback?state=${encodeURIComponent(canceledQuickBooksStateApi)}&code=${encodeURIComponent(quickBooksCodeApi)}&realmId=${encodeURIComponent(quickBooksRealmApi)}`);
  const connectedQuickBooksStatusApi = await hit("GET", "/api/admin/integrations/quickbooks", null, true);
  const connectedQuickBooksWorkspaceApi = await hit("GET", "/api/admin/partners", null, true);
  ok("QuickBooks connection controls require admin permission", unauthenticatedQuickBooksStatusApi.status === 401);
  ok("QuickBooks OAuth begins without exposing credentials", initialQuickBooksStatusApi.status === 200 && initialQuickBooksStatusApi.data.quickbooks?.oauthReady && !initialQuickBooksStatusApi.data.quickbooks?.connected && quickBooksAuthorizationApi.status === 201 && quickBooksStateApi?.length >= 40 && !JSON.stringify(quickBooksAuthorizationApi.data).includes("platform-smoke-quickbooks-secret"));
  ok("QuickBooks callback stores connection behind hardened HTML", quickBooksCallbackApi.status === 200 && quickBooksCallbackApi.headers.get("content-type")?.startsWith("text/html") && quickBooksCallbackApi.headers.get("content-security-policy")?.includes("default-src 'none'") && quickBooksCallbackApi.headers.get("cache-control") === "no-store" && quickBooksCallbackTextApi.includes("QuickBooks is connected") && !quickBooksCallbackTextApi.includes(quickBooksStateApi) && !quickBooksCallbackTextApi.includes(quickBooksCodeApi) && !quickBooksCallbackTextApi.includes(quickBooksRealmApi) && !quickBooksCallbackTextApi.includes("quickbooks-private-refresh-token"));
  ok("QuickBooks callback state is one-time", quickBooksReplayApi.status === 400);
  ok("QuickBooks provider cancellation consumes state without echoing details", canceledQuickBooksCallbackApi.status === 400 && canceledQuickBooksCallbackApi.data.toString("utf8").includes("was not connected") && !canceledQuickBooksCallbackApi.data.toString("utf8").includes("private provider detail") && canceledQuickBooksReplayApi.status === 400);
  ok("QuickBooks encrypted connection activates accounting API access", connectedQuickBooksStatusApi.data.quickbooks?.connected && connectedQuickBooksStatusApi.data.quickbooks?.canCallAccountingApi && !connectedQuickBooksStatusApi.data.quickbooks?.canSyncPartnerInvoices && connectedQuickBooksStatusApi.data.quickbooks?.credentialSource === "encrypted_store" && connectedQuickBooksWorkspaceApi.data.quickbooks?.canCallAccountingApi && !JSON.stringify(connectedQuickBooksStatusApi.data).includes(quickBooksRealmApi) && !JSON.stringify(connectedQuickBooksStatusApi.data).includes("ciphertext"));
  const rejectedQuickBooksDisconnectApi = await hit("POST", "/api/admin/integrations/quickbooks/disconnect", { confirm: false }, true);
  const quickBooksDisconnectApi = await hit("POST", "/api/admin/integrations/quickbooks/disconnect", { confirm: true }, true);
  ok("QuickBooks disconnect is confirmed and clears local credentials", rejectedQuickBooksDisconnectApi.status === 400 && quickBooksDisconnectApi.status === 200 && quickBooksDisconnectApi.data.changed && !quickBooksDisconnectApi.data.quickbooks?.connected);
  const missingPaymentReferenceApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/payments`, {
    amountCents: 100000,
    method: "check",
    receivedAt: "2026-07-16T15:00:00.000Z"
  }, true);
  ok("payment API requires an accounting reference", missingPaymentReferenceApi.status === 400 && missingPaymentReferenceApi.data.error?.includes("reference is required"));
  const paymentApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/payments`, {
    amountCents: 100000,
    method: "check",
    externalRef: "API-CHECK-100",
    receivedAt: "2026-07-16T15:00:00.000Z"
  }, true);
  const duplicatePaymentApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/payments`, {
    amountCents: 100000,
    method: "check",
    externalRef: "api-check-100"
  }, true);
  const conflictingPaymentApi = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(sponsorApplication?.id)}/payments`, {
    amountCents: 90000,
    method: "check",
    externalRef: "API-CHECK-100"
  }, true);
  const paidWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const persistedInvoice = paidWorkspace.data.invoices?.find(item => item.id === invoiceApi.data.invoice?.id);
  ok("payment API allocates and deduplicates", paymentApi.status === 201 && paymentApi.data.payment?.appliedAmountCents === 100000 && duplicatePaymentApi.status === 200 && duplicatePaymentApi.data.duplicate === true && conflictingPaymentApi.status === 409 && persistedInvoice?.balanceCents === persistedInvoice?.amountCents - 100000);
  ok("receivables API exposes account", paidWorkspace.data.receivables?.accounts?.some(item => item.applicationId === sponsorApplication?.id && item.paidAmountCents === 100000 && item.reconciliationStatus === "matched"));
  const reversedPaymentApi = await hit("POST", `/api/admin/partners/payments/${encodeURIComponent(paymentApi.data.payment?.id)}/reverse`, { action: "void", reason: "API verification reversal" }, true);
  const reversedWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const restoredInvoice = reversedWorkspace.data.invoices?.find(item => item.id === invoiceApi.data.invoice?.id);
  ok("payment reversal API restores balance", reversedPaymentApi.status === 200 && reversedPaymentApi.data.payment?.status === "voided" && restoredInvoice?.balanceCents === restoredInvoice?.amountCents && reversedWorkspace.data.receivables?.accounts?.find(item => item.applicationId === sponsorApplication?.id)?.paidAmountCents === 0);

  const staffTaskApi = await hit("POST", "/api/admin/partners/tasks", {
    title: "Confirm operations briefing",
    description: "Review the opening checklist with command.",
    assigneeType: "staff",
    assigneeId: "staff_operations",
    priority: "high",
    dueAt: "2026-07-17T12:30:00.000Z"
  }, true);
  ok("POST governed staff task assignment", staffTaskApi.status === 201 && staffTaskApi.data.task?.assigneeName === "Jamie Torres" && staffTaskApi.data.task?.assigneeRole === "ops_admin");
  const delegatedTask = await hit("POST", "/api/admin/partners/tasks", {
    title: "Brief the volunteer gate lead",
    description: "Confirm radio channel and opening checklist.",
    assigneeType: "volunteer",
    assigneeId: "vol_001",
    priority: "high",
    dueAt: "2026-07-17T13:00:00.000Z"
  }, true);
  ok("POST volunteer task assignment", delegatedTask.status === 201 && delegatedTask.data.task?.assigneeName === "Alex Rivera");
  const taskNoticeRequestId = "api-task-notice-request-0001";
  const requestedTaskNoticeApi = await hit("POST", `/api/admin/partners/tasks/${encodeURIComponent(delegatedTask.data.task?.id)}/assignment-notice`, { requestId: taskNoticeRequestId }, true);
  const replayedTaskNoticeApi = await hit("POST", `/api/admin/partners/tasks/${encodeURIComponent(delegatedTask.data.task?.id)}/assignment-notice`, { requestId: taskNoticeRequestId }, true);
  const duplicateTaskNoticeApi = await hit("POST", `/api/admin/partners/tasks/${encodeURIComponent(delegatedTask.data.task?.id)}/assignment-notice`, { requestId: "api-task-notice-request-0002" }, true);
  ok("assignment notice API queues a secure current-task message", requestedTaskNoticeApi.status === 202 && requestedTaskNoticeApi.data.task?.assignmentNoticeVersion === 1 && !("lastAssignmentNoticeRequestId" in requestedTaskNoticeApi.data.task) && requestedTaskNoticeApi.data.notice?.status === "draft_ready" && requestedTaskNoticeApi.data.notice?.sourceVersion === "assignment:1:notice:1");
  ok("assignment notice API is idempotent and rejects active duplicates", replayedTaskNoticeApi.status === 200 && replayedTaskNoticeApi.data.replay === true && duplicateTaskNoticeApi.status === 409);
  const apiTaskPortalConfig = taskPortalConfig(apiChildEnv);
  const apiTaskToken = issueTaskPortalToken(delegatedTask.data.task, { config: apiTaskPortalConfig });
  const taskPortalStatusApi = await hit("POST", "/api/public/task-status", { taskId: delegatedTask.data.task?.id, token: apiTaskToken });
  const invalidTaskPortalApi = await hit("POST", "/api/public/task-status", { taskId: delegatedTask.data.task?.id, token: `${apiTaskToken}invalid` });
  const acknowledgedTaskApi = await hit("POST", "/api/public/task-status/update", { taskId: delegatedTask.data.task?.id, token: apiTaskToken, action: "acknowledge", note: "Gate briefing received." });
  const startedTaskApi = await hit("POST", "/api/public/task-status/update", { taskId: delegatedTask.data.task?.id, token: apiTaskToken, action: "start" });
  const rejectedBlockerApi = await hit("POST", "/api/public/task-status/update", { taskId: delegatedTask.data.task?.id, token: apiTaskToken, action: "block" });
  const blockedTaskApi = await hit("POST", "/api/public/task-status/update", { taskId: delegatedTask.data.task?.id, token: apiTaskToken, action: "block", note: "Radio inventory is short by two units." });
  const completedTaskApi = await hit("POST", "/api/public/task-status/update", { taskId: delegatedTask.data.task?.id, token: apiTaskToken, action: "complete", note: "Radios reassigned and briefing complete." });
  const completedTaskReplayApi = await hit("POST", "/api/public/task-status/update", { taskId: delegatedTask.data.task?.id, token: apiTaskToken, action: "complete" });
  ok("public task portal authenticates without enumerating assignments", taskPortalStatusApi.status === 200 && taskPortalStatusApi.data.task?.assignee?.name === "Alex Rivera" && !("assigneeId" in taskPortalStatusApi.data.task.assignee) && invalidTaskPortalApi.status === 404 && invalidTaskPortalApi.data.error === "Task assignment not found or access link invalid.");
  ok("public task portal persists the assignee lifecycle", acknowledgedTaskApi.status === 200 && acknowledgedTaskApi.data.task?.acknowledgedAt && startedTaskApi.data.task?.status === "in_progress" && rejectedBlockerApi.status === 400 && blockedTaskApi.data.task?.status === "blocked" && blockedTaskApi.data.task?.updates?.at(-1)?.note.includes("Radio inventory") && completedTaskApi.data.task?.status === "done" && completedTaskApi.data.task?.allowedActions?.length === 0 && completedTaskReplayApi.data.replay === true);
  const advancedTask = await hit("PATCH", `/api/admin/partners/tasks/${encodeURIComponent(delegatedTask.data.task?.id)}`, {
    status: "blocked",
    assigneeType: "team",
    assigneeId: "operations",
    priority: "urgent"
  }, true);
  const staleTaskPortalApi = await hit("POST", "/api/public/task-status", { taskId: delegatedTask.data.task?.id, token: apiTaskToken });
  const taskWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const taskAuditApi = await hit("GET", "/api/admin/audit?limit=200", null, true);
  const assigneeAudit = taskAuditApi.data.audit?.find(item => item.record?.action === "task.assignee.block")?.record;
  const assignmentNoticeAudit = taskAuditApi.data.audit?.find(item => item.record?.action === "partner.task.assignment_notice.request")?.record;
  ok("PATCH task lifecycle", advancedTask.status === 200 && advancedTask.data.task?.status === "blocked" && advancedTask.data.task?.assigneeName === "Operations team");
  ok("task board API summary", taskWorkspace.data.taskBoard?.totals?.blocked === 1 && taskWorkspace.data.assignmentDirectory?.volunteers?.some(item => item.id === "vol_001" && !("email" in item)) && staleTaskPortalApi.status === 404 && taskWorkspace.data.tasks?.find(item => item.id === delegatedTask.data.task?.id)?.acknowledgedAt === null);
  ok("task assignee audit is capability- and note-minimized", assigneeAudit?.actor?.type === "capability-link" && assigneeAudit.metadata?.noteProvided === true && !JSON.stringify(assigneeAudit).includes(apiTaskToken) && !JSON.stringify(assigneeAudit).includes("Radio inventory"));
  ok("assignment notice request is audited without capability disclosure", assignmentNoticeAudit?.target?.id === delegatedTask.data.task?.id && assignmentNoticeAudit.metadata?.assignmentNoticeVersion === 1 && !JSON.stringify(assignmentNoticeAudit).includes(apiTaskToken));
  const staffDirectoryApiOk = taskWorkspace.data.staffDirectory?.ready === false
    && taskWorkspace.data.staffDirectory?.routedTeams === 7
    && taskWorkspace.data.staffDirectory?.errors?.some(item => item.includes("does not match texas-sandfest-2027"))
    && taskWorkspace.data.assignmentDirectory?.staff?.some(item => item.id === "staff_operations" && item.emailAvailable === true && !("email" in item))
    && taskWorkspace.data.assignmentDirectory?.teams?.every(item => item.notificationReady === true);
  ok(
    "staff assignment directory API reports rollover gate and stays private",
    staffDirectoryApiOk,
    staffDirectoryApiOk ? "" : JSON.stringify({ readiness: taskWorkspace.data.staffDirectory, assignmentDirectory: taskWorkspace.data.assignmentDirectory })
  );

  const geoProspectApi = await hit("POST", "/api/admin/outreach/prospects", {
    organizationName: "API Port Aransas Hotel",
    contactName: "Geo Test",
    contactEmail: "geo-api@example.com",
    industry: "api preview lodging",
    city: "Port Aransas",
    state: "TX",
    postalCode: "78373",
    latitude: 27.8339,
    longitude: -97.0611,
    communityFit: true,
    contactBasis: "business_relevance",
    status: "contact_ready",
    ownerId: "sponsor_lead",
    nextAction: "Review the Tarpon sponsor invitation",
    nextActionAt: "2027-01-15T15:00:00.000Z"
  }, true);
  const invalidGeoProspectApi = await hit("POST", "/api/admin/outreach/prospects", {
    organizationName: "Invalid API Coordinates",
    contactEmail: "invalid-geo-api@example.com",
    latitude: 27.8
  }, true);
  const invalidScheduleProspectApi = await hit("POST", "/api/admin/outreach/prospects", {
    organizationName: "Invalid API Follow-up",
    contactEmail: "invalid-schedule-api@example.com",
    nextActionAt: "not-a-date"
  }, true);
  const geoCampaignPayloadApi = {
    name: "API Port Aransas geofence",
    targeting: {
      industries: ["api preview lodging"],
      postalCodes: ["78373"],
      geofence: { latitude: 27.8339, longitude: -97.0611, radiusMiles: 25 },
      minFitScore: 60
    },
    sequence: [{ delayDays: 0, subjectTemplate: "A local partnership for {{organization}}", bodyTemplate: "Hello {{contactName}}" }]
  };
  const unauthenticatedGeoCampaignPreviewApi = await hit("POST", "/api/admin/outreach/campaigns/preview", geoCampaignPayloadApi);
  const geoCampaignPreviewApi = await hit("POST", "/api/admin/outreach/campaigns/preview", geoCampaignPayloadApi, true);
  const outreachAfterPreviewApi = await hit("GET", "/api/admin/outreach", null, true);
  const geoCampaignApi = await hit("POST", "/api/admin/outreach/campaigns", geoCampaignPayloadApi, true);
  const invalidGeoCampaignApi = await hit("POST", "/api/admin/outreach/campaigns", {
    name: "Invalid API geofence",
    targeting: { geofence: { latitude: 27.8339, radiusMiles: 25 } },
    sequence: [{ delayDays: 0, subjectTemplate: "Invalid", bodyTemplate: "Invalid" }]
  }, true);
  const invalidGeoCampaignPreviewApi = await hit("POST", "/api/admin/outreach/campaigns/preview", {
    name: "Invalid API geofence preview",
    targeting: { geofence: { latitude: 27.8339, radiusMiles: 25 } },
    sequence: [{ delayDays: 0, subjectTemplate: "Invalid", bodyTemplate: "Invalid" }]
  }, true);
  const activatedGeoCampaignApi = await hit("POST", `/api/admin/outreach/campaigns/${encodeURIComponent(geoCampaignApi.data.campaign?.id)}/activate`, {}, true);
  const generatedGeoCampaignApi = await hit("POST", `/api/admin/outreach/campaigns/${encodeURIComponent(geoCampaignApi.data.campaign?.id)}/generate`, {}, true);
  const geoOutreachWorkspaceApi = await hit("GET", "/api/admin/outreach", null, true);
  const geoCampaignWorkspaceApi = geoOutreachWorkspaceApi.data.campaigns?.find(item => item.id === geoCampaignApi.data.campaign?.id);
  const geoDraftApi = geoOutreachWorkspaceApi.data.followups?.find(item => item.campaignId === geoCampaignApi.data.campaign?.id);
  ok("campaign preflight API is authorized, private, personalized, and mutation-free", unauthenticatedGeoCampaignPreviewApi.status === 401 && geoCampaignPreviewApi.status === 200 && geoCampaignPreviewApi.data.preview?.matched === 1 && geoCampaignPreviewApi.data.preview?.matches?.[0]?.id === geoProspectApi.data.prospect?.id && !("contactEmail" in geoCampaignPreviewApi.data.preview.matches[0]) && geoCampaignPreviewApi.data.preview.sample?.sequence?.[0]?.subject === "A local partnership for API Port Aransas Hotel" && !outreachAfterPreviewApi.data.campaigns?.some(item => item.name === geoCampaignPayloadApi.name) && invalidGeoCampaignPreviewApi.status === 400);
  ok("geofenced outreach API", geoProspectApi.status === 201 && geoCampaignApi.status === 201 && activatedGeoCampaignApi.status === 200 && activatedGeoCampaignApi.data.generated === 1 && generatedGeoCampaignApi.data.generated === 0 && geoCampaignWorkspaceApi?.metrics?.matched === 1 && geoCampaignWorkspaceApi?.metrics?.funnel?.enrolled === 1 && geoCampaignWorkspaceApi?.metrics?.funnel?.reached === 0 && geoCampaignWorkspaceApi?.metrics?.funnel?.applications === 0 && geoCampaignWorkspaceApi?.targeting?.postalCodes?.[0] === "78373");
  ok("outreach accountability API", geoProspectApi.data.prospect?.ownerId === "sponsor_lead" && geoProspectApi.data.prospect?.nextActionAt === "2027-01-15T15:00:00.000Z" && geoOutreachWorkspaceApi.data.summary?.nextActionsScheduled >= 1);
  ok("geofenced outreach API validation", invalidGeoProspectApi.status === 400 && invalidScheduleProspectApi.status === 400 && invalidScheduleProspectApi.data.error?.includes("follow-up date") && invalidGeoCampaignApi.status === 400);
  const invitedSponsorProspectApi = await hit("POST", "/api/admin/outreach/prospects", {
    organizationName: "API Coastal Community Bank",
    contactName: "Morgan Sponsor",
    contactEmail: "morgan@api-coastal-bank.example",
    website: "https://api-coastal-bank.example",
    industry: "banking",
    city: "Corpus Christi",
    state: "TX",
    postalCode: "78401",
    contactBasis: "business_relevance",
    status: "contact_ready"
  }, true);
  const invitedProspectIdApi = invitedSponsorProspectApi.data.prospect?.id;
  const unauthenticatedInvitationApi = await hit("POST", `/api/admin/outreach/prospects/${encodeURIComponent(invitedProspectIdApi)}/sponsor-invitation`, { action: "issue", packageId: "tarpon" });
  const firstInvitationApi = await hit("POST", `/api/admin/outreach/prospects/${encodeURIComponent(invitedProspectIdApi)}/sponsor-invitation`, { action: "issue", packageId: "tarpon" }, true);
  const copiedInvitationApi = await hit("POST", `/api/admin/outreach/prospects/${encodeURIComponent(invitedProspectIdApi)}/sponsor-invitation`, { action: "copy" }, true);
  const replacedInvitationApi = await hit("POST", `/api/admin/outreach/prospects/${encodeURIComponent(invitedProspectIdApi)}/sponsor-invitation`, { action: "issue", packageId: "tarpon" }, true);
  const invitationTokenFromUrl = value => {
    const hash = value ? new URL(value).hash : "";
    return new URLSearchParams(hash.slice(hash.indexOf("?") + 1)).get("token");
  };
  const firstInvitationTokenApi = invitationTokenFromUrl(firstInvitationApi.data.invitation?.url);
  const sponsorInvitationTokenApi = invitationTokenFromUrl(replacedInvitationApi.data.invitation?.url);
  const replacedOldInvitationApi = await hit("POST", "/api/public/sponsor-invitation", { token: firstInvitationTokenApi });
  const publicInvitationApi = await hit("POST", "/api/public/sponsor-invitation", { token: sponsorInvitationTokenApi });
  const tamperedInvitationApi = await hit("POST", "/api/public/sponsor-invitation", { token: `${sponsorInvitationTokenApi}x` });
  ok("sponsor invitation API authentication and rotation", invitedSponsorProspectApi.status === 201 && unauthenticatedInvitationApi.status === 401 && firstInvitationApi.status === 200 && copiedInvitationApi.data.invitation?.url === firstInvitationApi.data.invitation?.url && replacedInvitationApi.data.invitation?.version === firstInvitationApi.data.invitation?.version + 1 && replacedOldInvitationApi.status === 404);
  ok("sponsor invitation API public prefill", publicInvitationApi.status === 200 && publicInvitationApi.data.invitation?.organizationName === "API Coastal Community Bank" && publicInvitationApi.data.invitation?.contactEmail === "morgan@api-coastal-bank.example" && publicInvitationApi.data.invitation?.packageId === "tarpon" && tamperedInvitationApi.status === 404);
  const invitedSponsorCampaignApi = await hit("POST", "/api/admin/outreach/campaigns", {
    name: "API invited sponsor conversion",
    targeting: { industries: ["banking"], postalCodes: ["78401"], minFitScore: 0 },
    sequence: [{ delayDays: 0, subjectTemplate: "A SandFest sponsor invitation", bodyTemplate: "Hello {{contactName}}" }]
  }, true);
  const activatedInvitedSponsorCampaignApi = await hit("POST", `/api/admin/outreach/campaigns/${encodeURIComponent(invitedSponsorCampaignApi.data.campaign?.id)}/activate`, {}, true);
  const generatedInvitationDraftApi = await hit("POST", `/api/admin/outreach/campaigns/${encodeURIComponent(invitedSponsorCampaignApi.data.campaign?.id)}/generate`, {}, true);
  const invitedWorkspaceBeforeConversionApi = await hit("GET", "/api/admin/outreach", null, true);
  const invitedDraftApi = invitedWorkspaceBeforeConversionApi.data.followups?.find(item => item.campaignId === invitedSponsorCampaignApi.data.campaign?.id && item.prospectId === invitedProspectIdApi);
  const invitationIntakeBodyApi = {
    organizationName: "API Coastal Community Bank",
    contactName: "Morgan Sponsor",
    contactEmail: "morgan@api-coastal-bank.example",
    website: "https://api-coastal-bank.example",
    packageId: "tarpon",
    description: "Support sculpture access and community hospitality.",
    consentToContact: true,
    sponsorInvitationToken: sponsorInvitationTokenApi,
    botToken: "valid-invited-sponsor-token"
  };
  const mismatchedInvitationIntakeApi = await hit("POST", "/api/public/sponsor-inquiries", { ...invitationIntakeBodyApi, contactEmail: "other@example.com", botToken: "valid-invited-sponsor-mismatch-token" }, false, { "idempotency-key": "platform-api-invited-sponsor-mismatch-0001" });
  const convertedInvitationIntakeApi = await hit("POST", "/api/public/sponsor-inquiries", invitationIntakeBodyApi, false, { "idempotency-key": "platform-api-invited-sponsor-0001" });
  const convertedInvitationLookupApi = await hit("POST", "/api/public/sponsor-invitation", { token: sponsorInvitationTokenApi });
  const invitedWorkspaceAfterConversionApi = await hit("GET", "/api/admin/partners", null, true);
  const invitedOutreachAfterConversionApi = await hit("GET", "/api/admin/outreach", null, true);
  const convertedInvitedProspectApi = invitedOutreachAfterConversionApi.data.prospects?.find(item => item.id === invitedProspectIdApi);
  const convertedInvitedCampaignApi = invitedOutreachAfterConversionApi.data.campaigns?.find(item => item.id === invitedSponsorCampaignApi.data.campaign?.id);
  const convertedInvitedApplicationApi = invitedWorkspaceAfterConversionApi.data.applications?.find(item => item.id === convertedInvitationIntakeApi.data.application?.id);
  const dismissedInvitedDraftApi = invitedWorkspaceAfterConversionApi.data.followups?.find(item => item.id === invitedDraftApi?.id);
  ok("sponsor invitation API injects reviewed outreach link", activatedInvitedSponsorCampaignApi.data.generated === 1 && generatedInvitationDraftApi.data.generated === 0 && invitedDraftApi?.status === "draft_ready" && invitedDraftApi?.body.includes(replacedInvitationApi.data.invitation?.url) && invitedDraftApi?.body.includes("#outreach-preferences?"));
  ok("sponsor invitation API identity gate", mismatchedInvitationIntakeApi.status === 400 && mismatchedInvitationIntakeApi.data.error?.includes("business email"));
  ok("sponsor invitation API converts into operations", convertedInvitationIntakeApi.status === 201 && convertedInvitationIntakeApi.data.outreachConversion === true && convertedInvitationIntakeApi.data.portalAccess?.token?.startsWith("tsfp_") && convertedInvitedProspectApi?.status === "won" && convertedInvitedProspectApi?.convertedApplicationId === convertedInvitedApplicationApi?.id && convertedInvitedApplicationApi?.outreachProspectId === invitedProspectIdApi && convertedInvitedApplicationApi?.source === "outreach_invitation" && invitedWorkspaceAfterConversionApi.data.brandProfiles?.some(item => item.applicationId === convertedInvitedApplicationApi?.id) && invitedWorkspaceAfterConversionApi.data.deliverables?.some(item => item.applicationId === convertedInvitedApplicationApi?.id) && dismissedInvitedDraftApi?.status === "dismissed" && convertedInvitedCampaignApi?.metrics?.funnel?.reached === 0 && convertedInvitedCampaignApi?.metrics?.funnel?.applications === 0);
  ok("converted sponsor invitation recovers private portal", convertedInvitationLookupApi.status === 200 && convertedInvitationLookupApi.data.converted === true && convertedInvitationLookupApi.data.portalAccess?.reference === convertedInvitedApplicationApi?.reference && convertedInvitationLookupApi.data.portalAccess?.token?.startsWith("tsfp_"));
  const revocableSponsorProspectApi = await hit("POST", "/api/admin/outreach/prospects", {
    organizationName: "API Revocable Sponsor",
    contactName: "Revoke Test",
    contactEmail: "revoke@api-sponsor.example",
    industry: "retail",
    city: "Rockport",
    state: "TX",
    postalCode: "78382",
    contactBasis: "business_relevance",
    status: "contact_ready"
  }, true);
  const revocableProspectIdApi = revocableSponsorProspectApi.data.prospect?.id;
  const revocableInvitationApi = await hit("POST", `/api/admin/outreach/prospects/${encodeURIComponent(revocableProspectIdApi)}/sponsor-invitation`, { action: "issue", packageId: "tarpon" }, true);
  const revokedInvitationApi = await hit("POST", `/api/admin/outreach/prospects/${encodeURIComponent(revocableProspectIdApi)}/sponsor-invitation`, { action: "revoke" }, true);
  const revokedInvitationLookupApi = await hit("POST", "/api/public/sponsor-invitation", { token: invitationTokenFromUrl(revocableInvitationApi.data.invitation?.url) });
  ok("sponsor invitation API revocation", revocableInvitationApi.status === 200 && revokedInvitationApi.status === 200 && revokedInvitationApi.data.invitation === null && revokedInvitationLookupApi.status === 404);
  const movedGeoProspectApi = await hit("PATCH", `/api/admin/outreach/prospects/${encodeURIComponent(geoProspectApi.data.prospect?.id)}`, {
    city: "Austin",
    postalCode: "78701",
    latitude: 30.2672,
    longitude: -97.7431
  }, true);
  const movedGeoWorkspaceApi = await hit("GET", "/api/admin/outreach", null, true);
  const movedGeoCampaignApi = movedGeoWorkspaceApi.data.campaigns?.find(item => item.id === geoCampaignApi.data.campaign?.id);
  const dismissedGeoDraftApi = movedGeoWorkspaceApi.data.followups?.find(item => item.id === geoDraftApi?.id);
  ok("geofence change dismisses stale API draft", movedGeoProspectApi.status === 200 && movedGeoProspectApi.data.prospect?.postalCode === "78701" && movedGeoCampaignApi?.metrics?.matched === 0 && dismissedGeoDraftApi?.status === "dismissed");
  const geoPreferenceUrlApi = geoDraftApi?.body?.match(/https:\/\/\S+#outreach-preferences\?\S+/)?.[0];
  const geoPreferenceHashApi = geoPreferenceUrlApi ? new URL(geoPreferenceUrlApi).hash : "";
  const geoPreferenceParamsApi = new URLSearchParams(geoPreferenceHashApi.slice(geoPreferenceHashApi.indexOf("?") + 1));
  const geoPreferenceAccessApi = { prospectId: geoPreferenceParamsApi.get("prospect"), token: geoPreferenceParamsApi.get("token") };
  const invalidPreferenceApi = await hit("POST", "/api/public/outreach-preferences", { ...geoPreferenceAccessApi, token: `${geoPreferenceAccessApi.token}x` });
  const currentPreferenceApi = await hit("POST", "/api/public/outreach-preferences", geoPreferenceAccessApi);
  const unsubscribePreferenceApi = await hit("POST", "/api/public/outreach-preferences/unsubscribe", geoPreferenceAccessApi);
  const repeatUnsubscribePreferenceApi = await hit("POST", "/api/public/outreach-preferences/unsubscribe", geoPreferenceAccessApi);
  const suppressedPreferenceWorkspaceApi = await hit("GET", "/api/admin/outreach", null, true);
  const suppressedPreferenceProspectApi = suppressedPreferenceWorkspaceApi.data.prospects?.find(item => item.id === geoProspectApi.data.prospect?.id);
  ok("outreach preference API privacy", Boolean(geoPreferenceUrlApi) && invalidPreferenceApi.status === 404 && currentPreferenceApi.status === 200 && currentPreferenceApi.data.preference?.organizationName === "API Port Aransas Hotel" && !("contactEmail" in (currentPreferenceApi.data.preference || {})) && suppressedPreferenceWorkspaceApi.data.preferences?.ready === true);
  ok("outreach public unsubscribe is durable and idempotent", unsubscribePreferenceApi.status === 200 && unsubscribePreferenceApi.data.preference?.status === "unsubscribed" && repeatUnsubscribePreferenceApi.data.duplicate === true && suppressedPreferenceProspectApi?.status === "do_not_contact" && suppressedPreferenceProspectApi?.suppressionReason.includes("public outreach preferences"));

  const unauthenticatedDiscoveryApi = await hit("POST", "/api/admin/outreach/discovery/preview", {
    location: "Port Aransas, TX 78373", radiusMiles: 25, limit: 10, categories: ["lodging", "financial"]
  });
  const discoveryPreviewApi = await hit("POST", "/api/admin/outreach/discovery/preview", {
    location: "Port Aransas, TX 78373", radiusMiles: 25, limit: 10, categories: ["lodging", "financial"]
  }, true);
  const selectedDiscoveryCandidateApi = discoveryPreviewApi.data.candidates?.[0];
  const tamperedDiscoveryTokenApi = `${discoveryPreviewApi.data.previewToken?.slice(0, -1)}${discoveryPreviewApi.data.previewToken?.endsWith("a") ? "b" : "a"}`;
  const rejectedDiscoveryImportApi = await hit("POST", "/api/admin/outreach/discovery/import", {
    previewToken: tamperedDiscoveryTokenApi,
    selectedSourceRefs: [selectedDiscoveryCandidateApi?.sourceRef]
  }, true);
  const discoveryImportApi = await hit("POST", "/api/admin/outreach/discovery/import", {
    previewToken: discoveryPreviewApi.data.previewToken,
    selectedSourceRefs: [selectedDiscoveryCandidateApi?.sourceRef]
  }, true);
  const discoveryReplayApi = await hit("POST", "/api/admin/outreach/discovery/import", {
    previewToken: discoveryPreviewApi.data.previewToken,
    selectedSourceRefs: [selectedDiscoveryCandidateApi?.sourceRef]
  }, true);
  const discoveryCampaignApi = await hit("POST", "/api/admin/outreach/campaigns", {
    name: "API discovered business review gate",
    targeting: { industries: [selectedDiscoveryCandidateApi?.industry], states: ["TX"], minFitScore: 0 },
    sequence: [{ delayDays: 0, subjectTemplate: "Regional SandFest partnership", bodyTemplate: "Hello {{contactName}}" }]
  }, true);
  const discoveryWorkspaceBeforeResearchApi = await hit("GET", "/api/admin/outreach", null, true);
  const discoveredProspectApi = discoveryWorkspaceBeforeResearchApi.data.prospects?.find(item => item.id === discoveryImportApi.data.prospects?.[0]?.id);
  const discoveryCampaignBeforeResearchApi = discoveryWorkspaceBeforeResearchApi.data.campaigns?.find(item => item.id === discoveryCampaignApi.data.campaign?.id);
  ok("outreach discovery API authentication and signed preview", unauthenticatedDiscoveryApi.status === 401 && discoveryPreviewApi.status === 200 && discoveryPreviewApi.data.discovery?.provider === "fixture" && discoveryPreviewApi.data.candidates?.length === 2 && discoveryPreviewApi.data.previewToken?.startsWith("od1.") && rejectedDiscoveryImportApi.status === 409);
  ok("outreach discovery API imports selected provenance only", discoveryImportApi.status === 201 && discoveryImportApi.data.summary?.selected === 1 && discoveryImportApi.data.summary?.imported === 1 && discoveredProspectApi?.sourceRef === selectedDiscoveryCandidateApi?.sourceRef && discoveredProspectApi?.sourceUrl && discoveredProspectApi?.status === "identified" && discoveredProspectApi?.contactBasis === null);
  ok("outreach discovery API review and replay gates", discoveryReplayApi.status === 200 && discoveryReplayApi.data.summary?.duplicates === 1 && discoveryCampaignBeforeResearchApi?.metrics?.matched === 0);
  const researchedDiscoveryProspectApi = await hit("PATCH", `/api/admin/outreach/prospects/${encodeURIComponent(discoveredProspectApi?.id)}`, {
    website: "https://api-verified-business.example.com",
    contactName: "API Discovery Contact",
    contactEmail: "discovery-contact@api-verified-business.example.com",
    contactBasis: "business_relevance",
    status: "contact_ready",
    nextAction: "Board sponsorship review"
  }, true);
  const discoveryWorkspaceAfterResearchApi = await hit("GET", "/api/admin/outreach", null, true);
  const discoveryCampaignAfterResearchApi = discoveryWorkspaceAfterResearchApi.data.campaigns?.find(item => item.id === discoveryCampaignApi.data.campaign?.id);
  ok("outreach discovery API contact research", researchedDiscoveryProspectApi.status === 200 && researchedDiscoveryProspectApi.data.prospect?.contactName === "API Discovery Contact" && researchedDiscoveryProspectApi.data.prospect?.website === "https://api-verified-business.example.com" && discoveryCampaignAfterResearchApi?.metrics?.matched === 1);

  const importCsvApi = `business_name,industry,city,state,zip,email,community_fit
API Imported Bank,banking,Corpus Christi,TX,78401,partners@api-bank.example,yes
API Invalid ZIP,banking,Corpus Christi,TX,bad,invalid@api-bank.example,no`;
  const importDefaultsApi = { state: "TX", contactBasis: "business_relevance", status: "contact_ready", communityFit: false };
  const importPreviewApi = await hit("POST", "/api/admin/outreach/prospects/import", { mode: "preview", csv: importCsvApi, defaults: importDefaultsApi }, true);
  const staleImportApi = await hit("POST", "/api/admin/outreach/prospects/import", { mode: "commit", csv: `${importCsvApi}\n`, defaults: importDefaultsApi, previewHash: importPreviewApi.data.previewHash }, true);
  const importCommitApi = await hit("POST", "/api/admin/outreach/prospects/import", { mode: "commit", csv: importCsvApi, defaults: importDefaultsApi, previewHash: importPreviewApi.data.previewHash }, true);
  const importReplayApi = await hit("POST", "/api/admin/outreach/prospects/import", { mode: "commit", csv: importCsvApi, defaults: importDefaultsApi, previewHash: importPreviewApi.data.previewHash }, true);
  const importedOutreachApi = await hit("GET", "/api/admin/outreach", null, true);
  const importedProspectApi = importedOutreachApi.data.prospects?.find(item => item.organizationName === "API Imported Bank");
  ok("outreach CSV API preview", importPreviewApi.status === 200 && importPreviewApi.data.summary?.valid === 1 && importPreviewApi.data.summary?.invalid === 1 && /^[a-f0-9]{64}$/.test(importPreviewApi.data.previewHash || ""));
  ok("outreach CSV API preview gate", staleImportApi.status === 409);
  ok("outreach CSV API commit", importCommitApi.status === 201 && importCommitApi.data.summary?.valid === 1 && importedProspectApi?.source === "csv_import" && importedProspectApi?.sourceBatch === importCommitApi.data.batchId);
  ok("outreach CSV API replay safety", importReplayApi.status === 200 && importReplayApi.data.summary?.valid === 0 && importReplayApi.data.summary?.duplicates === 1);
  const apiInterestOffering = await hit("POST", "/api/admin/vendor-offerings", {
    id: "api-vendor-interest",
    name: "API vendor interest",
    amount: 0,
    publicLabel: "Fee confirmed when applications open",
    intakeMode: "interest",
    categories: ["service"],
    description: "Register interest in a future Texas SandFest service-vendor opportunity.",
    inclusions: ["Application-opening notice", "Operations review"]
  }, true);
  const apiInterestIntake = await hit("POST", "/api/public/vendor-applications", {
    organizationName: "API Vendor Interest Test",
    contactName: "Interest Contact",
    contactEmail: "interest-contact@example.com",
    category: "service",
    vendorOfferingId: "api-vendor-interest",
    intakeMode: "application",
    consentNoticeVersion: "forged-client-version",
    consentToContact: true,
    botToken: "valid-vendor-interest-token"
  }, false, { "idempotency-key": "platform-api-vendor-interest-0001" });
  const apiInterestApplicationId = apiInterestIntake.data.application?.id;
  const apiInterestReprice = await hit("PATCH", `/api/admin/partners/applications/${encodeURIComponent(apiInterestApplicationId)}`, { expectedAmountCents: 100 }, true);
  const apiInterestInvoice = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(apiInterestApplicationId)}/invoices`, {}, true);
  const apiInterestPayment = await hit("POST", `/api/admin/partners/applications/${encodeURIComponent(apiInterestApplicationId)}/payments`, { amountCents: 100, method: "check", externalRef: "API-INTEREST-CHECK-1" }, true);
  const apiInterestWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const storedApiInterest = apiInterestWorkspace.data.applications?.find(item => item.id === apiInterestIntake.data.application?.id);
  const apiInterestMilestones = apiInterestWorkspace.data.milestones?.filter(item => item.applicationId === storedApiInterest?.id) || [];
  const apiInterestStatus = await hit("POST", "/api/public/partner-status", {
    reference: apiInterestIntake.data.application?.reference,
    token: apiInterestIntake.data.portalAccess?.token
  });
  const apiInterestNotice = partnerContactNotice("vendor", "interest");
  const apiInterestDetail = JSON.stringify({
    offeringStatus: apiInterestOffering.status,
    offeringMode: apiInterestOffering.data.vendorOffering?.intakeMode,
    intakeStatus: apiInterestIntake.status,
    intakeMode: storedApiInterest?.intakeMode,
    consentVersion: storedApiInterest?.consentNoticeVersion,
    milestoneKinds: apiInterestMilestones.map(item => item.kind),
    portalStatus: apiInterestStatus.status,
    portalPaymentStatus: apiInterestStatus.data.application?.finance?.paymentStatus
  });
  ok("public vendor interest derives mode and versioned consent server-side", apiInterestOffering.status === 201 && apiInterestIntake.status === 201 && apiInterestIntake.data.application?.intakeMode === "interest" && storedApiInterest?.expectedAmountCents === 0 && storedApiInterest?.consentNoticeVersion === apiInterestNotice.version && storedApiInterest?.consentCapturedAt && storedApiInterest?.consentNoticeVersion !== "forged-client-version", apiInterestDetail);
  ok("public vendor interest creates review work without onboarding obligations", apiInterestMilestones.length === 1 && apiInterestMilestones[0]?.kind === "interest_review" && apiInterestWorkspace.data.tasks?.filter(item => item.relatedEntityId === storedApiInterest?.id).length === 1 && !apiInterestWorkspace.data.vendorProfiles?.some(item => item.applicationId === storedApiInterest?.id) && !apiInterestWorkspace.data.vendorRequirements?.some(item => item.applicationId === storedApiInterest?.id) && !apiInterestWorkspace.data.vendorAssignments?.some(item => item.applicationId === storedApiInterest?.id), apiInterestDetail);
  ok("public vendor interest portal is non-financial", apiInterestStatus.status === 200 && apiInterestStatus.data.application?.intakeMode === "interest" && apiInterestStatus.data.application?.finance?.paymentStatus === "not_applicable" && apiInterestStatus.data.application?.vendorOnboarding === null && apiInterestWorkspace.data.vendorReadiness?.totals?.interests >= 1, apiInterestDetail);
  ok("vendor interest finance endpoints fail closed", apiInterestReprice.status === 400 && apiInterestInvoice.status === 400 && apiInterestPayment.status === 400 && [apiInterestReprice, apiInterestInvoice, apiInterestPayment].every(item => item.data.error?.includes("Vendor interest")), apiInterestDetail);
  const apiInterestAccess = {
    reference: apiInterestIntake.data.application?.reference,
    token: apiInterestIntake.data.portalAccess?.token
  };
  const rejectedContactPreference = await hit("POST", "/api/public/partner-contact-preferences", {
    ...apiInterestAccess,
    token: `${apiInterestAccess.token}x`,
    consentToContact: false,
    expectedVersion: 1
  });
  const pausedContactPreference = await hit("POST", "/api/public/partner-contact-preferences", {
    ...apiInterestAccess,
    consentToContact: false,
    expectedVersion: 1
  });
  const replayedContactPreference = await hit("POST", "/api/public/partner-contact-preferences", {
    ...apiInterestAccess,
    consentToContact: false,
    expectedVersion: 1
  });
  const staleContactPreference = await hit("POST", "/api/public/partner-contact-preferences", {
    ...apiInterestAccess,
    consentToContact: true,
    expectedVersion: 1
  });
  const unversionedContactPreference = await hit("POST", "/api/public/partner-contact-preferences", {
    ...apiInterestAccess,
    consentToContact: true
  });
  const resumedContactPreference = await hit("POST", "/api/public/partner-contact-preferences", {
    ...apiInterestAccess,
    consentToContact: true,
    expectedVersion: 2
  });
  const resumedContactStatus = await hit("POST", "/api/public/partner-status", apiInterestAccess);
  const contactPreferenceWorkspace = await hit("GET", "/api/admin/partners", null, true);
  const storedContactPreference = contactPreferenceWorkspace.data.applications?.find(item => item.id === apiInterestApplicationId);
  const dismissedContactMessages = contactPreferenceWorkspace.data.followups?.filter(item => item.applicationId === apiInterestApplicationId && item.status === "dismissed") || [];
  ok("partner email preferences require a valid private capability", rejectedContactPreference.status === 404 && !JSON.stringify(rejectedContactPreference.data).includes("interest-contact@example.com"));
  ok("partner email opt-out is immediate and idempotent", pausedContactPreference.status === 200 && pausedContactPreference.data.application?.contactPreference?.allowed === false && pausedContactPreference.data.application?.contactPreference?.version === 2 && pausedContactPreference.data.dismissedFollowups >= 1 && replayedContactPreference.status === 200 && replayedContactPreference.data.replay === true && replayedContactPreference.data.dismissedFollowups === 0);
  ok("partner email re-enrollment is conflict safe", staleContactPreference.status === 409 && unversionedContactPreference.status === 400 && resumedContactPreference.status === 200 && resumedContactPreference.data.application?.contactPreference?.allowed === true && resumedContactPreference.data.application?.contactPreference?.version === 3 && resumedContactStatus.data.application?.contactPreference?.allowed === true && storedContactPreference?.consentNoticeVersion === apiInterestNotice.version && dismissedContactMessages.length >= 1);
  const unauthenticatedExportApi = await hitRaw("GET", "/api/admin/exports/partners.csv");
  const [partnerExportApi, receivablesExportApi, paymentsExportApi, budgetExportApi, expensesExportApi, tasksExportApi, outreachExportApi, calendarExportApi] = await Promise.all([
    hitRaw("GET", "/api/admin/exports/partners.csv", undefined, { origin: "http://127.0.0.1:5173" }, true),
    hitRaw("GET", "/api/admin/exports/receivables.csv", undefined, {}, true),
    hitRaw("GET", "/api/admin/exports/payments.csv", undefined, {}, true),
    hitRaw("GET", "/api/admin/exports/budget.csv", undefined, {}, true),
    hitRaw("GET", "/api/admin/exports/expenses.csv", undefined, {}, true),
    hitRaw("GET", "/api/admin/exports/tasks.csv", undefined, {}, true),
    hitRaw("GET", "/api/admin/exports/outreach.csv", undefined, {}, true),
    hitRaw("GET", "/api/admin/exports/milestones.ics", undefined, {}, true)
  ]);
  const partnerExportTextApi = partnerExportApi.data.toString("utf8");
  const receivablesExportTextApi = receivablesExportApi.data.toString("utf8");
  const paymentsExportTextApi = paymentsExportApi.data.toString("utf8");
  const budgetExportTextApi = budgetExportApi.data.toString("utf8");
  const expensesExportTextApi = expensesExportApi.data.toString("utf8");
  const calendarExportTextApi = calendarExportApi.data.toString("utf8");
  ok("operations exports require staff authentication", unauthenticatedExportApi.status === 401);
  ok("partner, task, and outreach CSV exports download", partnerExportApi.status === 200 && tasksExportApi.status === 200 && outreachExportApi.status === 200 && partnerExportApi.headers.get("content-type")?.startsWith("text/csv") && partnerExportApi.headers.get("content-disposition")?.includes(`${DEFAULT_EVENT_ID}-partners.csv`) && partnerExportApi.headers.get("access-control-expose-headers")?.includes("content-disposition") && partnerExportTextApi.includes("Organization") && !partnerExportTextApi.includes("portalAccessId") && !partnerExportTextApi.includes("intakeIdempotencyKeyHash"));
  ok("receivables export uses server records", receivablesExportApi.status === 200 && receivablesExportTextApi.includes("Outstanding amount") && receivablesExportTextApi.includes("Platform API Portal Test"), `status=${receivablesExportApi.status} account=${receivablesExportTextApi.includes("Platform API Portal Test")}`);
  ok("payment ledger export preserves provider references", paymentsExportApi.status === 200 && paymentsExportTextApi.includes("Payment intent ID") && paymentsExportTextApi.includes("pi_partner_api_001"), `status=${paymentsExportApi.status} paymentIntent=${paymentsExportTextApi.includes("pi_partner_api_001")}`);
  ok("accounting exports use current budget records", budgetExportApi.status === 200 && expensesExportApi.status === 200 && budgetExportApi.headers.get("content-disposition")?.includes(`${DEFAULT_EVENT_ID}-budget-allocations.csv`) && expensesExportApi.headers.get("content-disposition")?.includes(`${DEFAULT_EVENT_ID}-expense-register.csv`) && budgetExportTextApi.includes("Annual budget") && budgetExportTextApi.includes("Remaining after pipeline") && expensesExportTextApi.includes("API Private Staging Vendor") && expensesExportTextApi.includes("PRIVATE-ACH-API-1001"));
  ok("key date calendar export is importable", calendarExportApi.status === 200 && calendarExportApi.headers.get("content-type")?.startsWith("text/calendar") && calendarExportApi.headers.get("content-disposition")?.includes(`${DEFAULT_EVENT_ID}-partner-key-dates.ics`) && calendarExportTextApi.includes("BEGIN:VCALENDAR") && calendarExportTextApi.includes("BEGIN:VEVENT"));
  const [ordersMonitorApi, paymentEventsMonitorApi, fulfillmentMonitorApi, auditApi, snapshotsMonitorApi] = await Promise.all([
    hit("GET", "/api/admin/orders?limit=500", null, true),
    hit("GET", "/api/admin/payment-events?limit=500", null, true),
    hit("GET", "/api/admin/fulfillment?limit=500", null, true),
    hit("GET", "/api/admin/audit?limit=500", null, true),
    hit("GET", "/api/admin/snapshots?limit=500", null, true)
  ]);
  const monitorResponses = [ordersMonitorApi, paymentEventsMonitorApi, fulfillmentMonitorApi, auditApi, snapshotsMonitorApi];
  const nonSnapshotEnvelopes = [
    ...(ordersMonitorApi.data.pendingOrders || []),
    ...(paymentEventsMonitorApi.data.paymentEvents || []),
    ...(fulfillmentMonitorApi.data.fulfillment || []),
    ...(auditApi.data.audit || [])
  ];
  const snapshotEnvelopes = snapshotsMonitorApi.data.snapshots || [];
  const monitorEnvelopes = [...nonSnapshotEnvelopes, ...snapshotEnvelopes];
  ok(
    "transaction monitor APIs withhold internal storage locations",
    monitorResponses.every(item => item.status === 200)
      && monitorEnvelopes.length > 0
      && monitorEnvelopes.every(item => !Object.prototype.hasOwnProperty.call(item, "path"))
      && nonSnapshotEnvelopes.every(item => !Object.prototype.hasOwnProperty.call(item, "file"))
      && snapshotEnvelopes.length > 0
      && snapshotEnvelopes.every(item => item.file && !item.file.includes("/") && !item.file.includes("..")),
    `statuses=${monitorResponses.map(item => item.status).join(",")} records=${monitorEnvelopes.length} snapshots=${snapshotEnvelopes.length}`
  );
  const serializedAudit = JSON.stringify(auditApi.data.audit || []);
  ok("admin audit never stores bearer credential fragments", auditApi.status === 200 && !serializedAudit.includes("tokenHint") && !serializedAudit.includes(TOKEN));
  const contactPreferenceAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action === "partner.contact_preference.update");
  ok("partner email preference audit is aggregate-only", contactPreferenceAuditApi.length === 2 && contactPreferenceAuditApi.some(item => item.record?.after?.allowed === false) && contactPreferenceAuditApi.some(item => item.record?.after?.allowed === true) && !JSON.stringify(contactPreferenceAuditApi).includes(apiInterestAccess.token) && !JSON.stringify(contactPreferenceAuditApi).includes("interest-contact@example.com"));
  ok("QuickBooks OAuth audit contains no authorization secrets", auditApi.data.audit?.some(item => item.record?.action === "accounting.quickbooks.authorize") && auditApi.data.audit?.some(item => item.record?.action === "accounting.quickbooks.connect") && auditApi.data.audit?.some(item => item.record?.action === "accounting.quickbooks.disconnect") && !serializedAudit.includes(quickBooksStateApi) && !serializedAudit.includes(quickBooksCodeApi) && !serializedAudit.includes(quickBooksRealmApi) && !serializedAudit.includes("quickbooks-private-refresh-token"));
  ok("Brevo webhook audit is aggregate-only", auditApi.data.audit?.some(item => item.record?.action === "email.delivery.webhook") && !serializedAudit.includes(webhookRecipient) && !serializedAudit.includes(SMOKE_BREVO_WEBHOOK_TOKEN));
  const smsAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action?.startsWith("sms."));
  ok("Twilio webhook audit is aggregate-only", smsAuditApi.some(item => item.record?.action === "sms.delivery.webhook") && smsAuditApi.some(item => item.record?.action === "sms.preference.webhook") && !JSON.stringify(smsAuditApi).includes("+13615550188") && !JSON.stringify(smsAuditApi).includes("platform-twilio-auth-secret"));
  ok("event guide publish is audited", auditApi.data.audit?.some(item => item.record?.action === "content.event-guide.publish"));
  ok("launch task synchronization is aggregate audited", auditApi.data.audit?.some(item => item.record?.action === "deployment.tasks.sync" && item.record?.after?.active === failingDeploymentChecks.length));
  ok("automatic launch task audit identifies the system actor", auditApi.data.audit?.some(item => item.record?.action === "deployment.tasks.sync" && item.record?.actor?.type === "system" && item.record?.actor?.id === "deployment-readiness" && item.record?.metadata?.automated === true && item.record?.after?.created === failingDeploymentChecks.length));
  const documentAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action?.startsWith("document."));
  ok("private document lifecycle is audited without file contents", documentAuditApi.some(item => item.record?.action === "document.upload") && documentAuditApi.some(item => item.record?.action === "document.review") && documentAuditApi.some(item => item.record?.action === "document.download") && documentAuditApi.some(item => item.record?.action === "document.extraction.source_read") && documentAuditApi.some(item => item.record?.action === "document.extraction.retry") && !JSON.stringify(documentAuditApi).includes("Board packet source"));
  ok("revenue settlement commit is audited", auditApi.data.audit?.some(item => item.record?.action === "revenue.import.commit" && item.record?.after?.source === "square" && item.record?.after?.imported === 1));
  const budgetAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action?.startsWith("budget."));
  const serializedBudgetAuditApi = JSON.stringify(budgetAuditApi);
  ok("budget lifecycle is audited without private vendor or payment references", budgetAuditApi.some(item => item.record?.action === "budget.line.create")
    && budgetAuditApi.some(item => item.record?.action === "budget.line.update")
    && budgetAuditApi.some(item => item.record?.action === "budget.expense.submit")
    && budgetAuditApi.some(item => item.record?.action === "budget.expense.approve" && item.record?.metadata?.overBudgetOverride === true)
    && budgetAuditApi.some(item => item.record?.action === "budget.expense.mark_paid")
    && !serializedBudgetAuditApi.includes("API Private") && !serializedBudgetAuditApi.includes("PRIVATE-ACH-API-1001"));
  const eventenyPartnerImportAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action === "partner.application.import");
  ok("Eventeny application import audit is aggregate-only", eventenyPartnerImportAuditApi.length >= 1 && eventenyPartnerImportAuditApi.some(item => item.record?.after?.fileName === "eventeny-applications-api.csv" && item.record?.after?.summary?.imported === 2) && !JSON.stringify(eventenyPartnerImportAuditApi).includes(eventenyPartnerEmailApi) && !JSON.stringify(eventenyPartnerImportAuditApi).includes("Vendor Import Contact"));
  const boothImportAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action === "booths.import.commit");
  ok("Eventeny booth import audit is aggregate-only", boothImportAuditApi.some(item => item.record?.after?.fileName === "eventeny-booths-api.csv" && item.record?.after?.summary?.booths?.valid === 1) && !JSON.stringify(boothImportAuditApi).includes("API Private Vendor"));
  const discoveryAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action?.startsWith("outreach.discovery."));
  ok("outreach discovery audit is aggregate-only", discoveryAuditApi.some(item => item.record?.action === "outreach.discovery.preview") && discoveryAuditApi.some(item => item.record?.action === "outreach.discovery.import") && !JSON.stringify(discoveryAuditApi).includes(selectedDiscoveryCandidateApi?.organizationName));
  const sponsorInvitationAuditApi = (auditApi.data.audit || []).filter(item => item.record?.action?.startsWith("outreach.sponsor_invitation."));
  const serializedSponsorInvitationAuditApi = JSON.stringify(sponsorInvitationAuditApi);
  ok("sponsor invitation audit is aggregate-only", sponsorInvitationAuditApi.some(item => item.record?.action === "outreach.sponsor_invitation.issue") && sponsorInvitationAuditApi.some(item => item.record?.action === "outreach.sponsor_invitation.copy") && sponsorInvitationAuditApi.some(item => item.record?.action === "outreach.sponsor_invitation.revoke") && !serializedSponsorInvitationAuditApi.includes("tsfi1.") && !serializedSponsorInvitationAuditApi.includes("morgan@api-coastal-bank.example"));
  ok("operations export downloads are audited", auditApi.data.audit?.filter(item => item.record?.action === "operations.export.download").length >= 8);
  ok("new admin audit records use current event context", auditApi.data.audit?.filter(item => item.record?.createdAt?.startsWith(new Date().toISOString().slice(0, 10))).every(item => item.record?.eventId === DEFAULT_EVENT_ID));
} finally {
  if (child) {
    await stopChild(child);
    await rm(isolatedRuntimeRoot, { recursive: true, force: true });
    await rm(isolatedJobQueueDir, { recursive: true, force: true });
    await rm(isolatedAuditDir, { recursive: true, force: true });
    await rm(isolatedPartnerAssetDir, { recursive: true, force: true });
    await rm(isolatedIncomingDocumentDir, { recursive: true, force: true });
    await rm(isolatedCommerceDir, { recursive: true, force: true });
    await stripeMock?.close();
    await turnstileMock?.close();
    await twilioMock?.close();
    await quickBooksMock?.close();
  }
}

console.log(`\nTotal: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

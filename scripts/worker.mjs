#!/usr/bin/env node
// Background worker for enterprise async jobs (SMS fan-out, QuickBooks hooks).
// Usage:
//   node scripts/worker.mjs
//   SANDFEST_WORKER_ONCE=true node scripts/worker.mjs

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../lib/load-env.mjs";
import { RUNTIME_OWNERSHIP_ERROR_CODE, resolveRuntimeRoot, withRuntimeOwnership } from "../lib/runtime-root.mjs";
import { eventContextConfig } from "../lib/event-context.mjs";
import { claimNextJobs, completeJob, enqueueJob, jobQueueConfig, listJobs, markTerminalJobHandled } from "../lib/job-queue.mjs";
import { normalizeConsent } from "../lib/consent.mjs";
import { sendSms, smsConfigFromEnv, smsStatusCallbackUrl } from "../lib/sms.mjs";
import {
  beginSmsSubmission,
  emptySmsOperations,
  normalizeSmsOperations,
  recordSmsSubmission,
  smsRecipientHash
} from "../lib/sms-operations.mjs";
import { readPlatformDoc, updatePlatformDoc, writePlatformDoc } from "../lib/platform-data.mjs";
import {
  OUTREACH_CAMPAIGN_AUTOMATION_POLICY,
  PARTNER_TRANSACTIONAL_AUTOMATION_POLICY,
  applyOutreachCampaignAutomation,
  applyTransactionalFollowupAutomation,
  automatedFollowupQueueCandidates,
  beginFollowupProviderSubmission,
  claimFollowupDelivery,
  emptyPartnerOperations,
  generateDueOutreachFollowups,
  generateDuePartnerFollowups,
  generateDueTaskFollowups,
  normalizePartnerOperations,
  prepareFollowupDraft,
  queueFollowupDelivery,
  releaseAutomatedFollowupApproval,
  recordFollowupDelivery,
  recordPartnerInvoiceReconciliation,
  recordPartnerInvoiceSync
} from "../lib/partner-ops.mjs";
import { emailConfigFromEnv, sendTransactionalEmail } from "../lib/email.mjs";
import { applyBrevoDeliveryEvents, brevoWebhookConfig } from "../lib/brevo-webhook.mjs";
import { reconcilePartnerInvoiceFromQuickBooks, syncPartnerInvoiceToQuickBooks } from "../lib/quickbooks/client.mjs";
import {
  loadQuickBooksRuntimeCredentials,
  persistQuickBooksTokenRotation
} from "../lib/quickbooks/credentials.mjs";
import { issuePartnerPortalToken, partnerPortalConfig, partnerPortalUrl } from "../lib/partner-portal.mjs";
import {
  appendOutreachPreferenceFooter,
  outreachPreferencesConfig,
  outreachPreferenceUrlForProspect
} from "../lib/outreach-preferences.mjs";
import { sponsorInvitationConfig, sponsorInvitationUrlForProspect } from "../lib/sponsor-invitations.mjs";
import { normalizeStaffDirectory, staffTaskRecipients } from "../lib/staff-directory.mjs";
import {
  normalizeIslandConditions,
  recordIncidentDispatchDelivery,
  resolveIncidentDispatchRecipient
} from "../lib/island-conditions.mjs";
import {
  beginIncomingDocumentExtraction,
  completeIncomingDocumentExtraction,
  emptyIncomingDocumentIntake,
  failIncomingDocumentExtraction,
  incomingDocumentStorageConfig,
  normalizeIncomingDocumentIntake,
  readIncomingDocumentUpload,
  verifyIncomingDocumentBytes
} from "../lib/incoming-documents.mjs";
import { syncIncomingDocumentReviewTasks } from "../lib/document-review-routing.mjs";
import { extractDocumentText } from "../lib/document-extraction.mjs";
import {
  documentExtractionSourceConfig,
  fetchDocumentExtractionSource
} from "../lib/document-extraction-source.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const CURRENT_EVENT_ID = eventContextConfig(process.env).eventId;
const POLL_MS = Number(process.env.SANDFEST_WORKER_POLL_MS || 2000);
const ONCE = process.env.SANDFEST_WORKER_ONCE === "true";
const BATCH = Number(process.env.SANDFEST_WORKER_BATCH || 10);
const QUEUE = jobQueueConfig();
const portalConfig = partnerPortalConfig();
const outreachPreferenceConfig = outreachPreferencesConfig();
const sponsorInvitationLinkConfig = sponsorInvitationConfig();
const incomingDocumentStorage = incomingDocumentStorageConfig(ROOT);
const extractionSource = documentExtractionSourceConfig();

function currentPartnerOperations(input) {
  const doc = normalizePartnerOperations(input);
  if (doc.eventId !== CURRENT_EVENT_ID) {
    throw new Error(`Partner operations are assigned to ${doc.eventId}; worker expects ${CURRENT_EVENT_ID}.`);
  }
  return doc;
}

function statusPortalUrl(application) {
  const token = issuePartnerPortalToken(application, { config: portalConfig });
  return token ? partnerPortalUrl(application, token, { config: portalConfig }) : null;
}

function outreachPreferencesUrl(prospect) {
  return outreachPreferenceUrlForProspect(prospect, { config: outreachPreferenceConfig });
}

async function readRecipientContext() {
  const [volunteerMirror, staffDirectoryInput] = await Promise.all([
    readPlatformDoc(ROOT, "volunteers", { volunteers: [] }),
    readPlatformDoc(ROOT, "staffDirectory", null)
  ]);
  const staffDirectory = normalizeStaffDirectory(staffDirectoryInput, { eventId: CURRENT_EVENT_ID });
  return {
    volunteers: volunteerMirror?.volunteers || [],
    taskRecipients: staffTaskRecipients(staffDirectory, { eventId: CURRENT_EVENT_ID })
  };
}

function sponsorInviteUrl(prospect) {
  return sponsorInvitationUrlForProspect(prospect, { config: sponsorInvitationLinkConfig });
}

async function writeHeartbeat(state, detail = {}) {
  await writePlatformDoc(ROOT, "workerStatus", {
    service: "sandfest-worker",
    state,
    pid: process.pid,
    heartbeatAt: new Date().toISOString(),
    pollMs: POLL_MS,
    batchSize: BATCH,
    workerId: QUEUE.workerId,
    jobLeaseMs: QUEUE.leaseMs,
    ...detail
  });
}

async function handleJob(job) {
  switch (job.type) {
  case "sms.alert_fanout": {
    // Legacy bulk jobs carried raw destinations. They are intentionally retired
    // instead of being replayed through the consent-safe per-message pipeline.
    console.warn(`[worker] retired legacy SMS fan-out job=${job.id} without provider submission`);
    return { ok: true, retired: true, reason: "legacy_bulk_sms_job" };
  }
  case "sms.alert.send": {
    const messageId = String(job.payload?.messageId || "");
    const campaignId = String(job.payload?.campaignId || "");
    let begin = null;
    await updatePlatformDoc(ROOT, "smsOperations", current => {
      begin = beginSmsSubmission(current, messageId, {
        now: new Date().toISOString(),
        eventId: CURRENT_EVENT_ID
      });
      return begin.ok ? begin.doc : normalizeSmsOperations(current, { eventId: CURRENT_EVENT_ID });
    }, { fallback: emptySmsOperations(CURRENT_EVENT_ID) });
    if (!begin?.ok) {
      if (begin?.deliveryUnknown) {
        let reconciled = null;
        await updatePlatformDoc(ROOT, "smsOperations", current => {
          reconciled = recordSmsSubmission(current, messageId, {
            ok: false,
            unknownOutcome: true,
            error: begin.error
          }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID });
          return reconciled.ok ? reconciled.doc : normalizeSmsOperations(current, { eventId: CURRENT_EVENT_ID });
        }, { fallback: emptySmsOperations(CURRENT_EVENT_ID) });
        return { ok: true, deliveryUnknown: true, messageId };
      }
      if (begin?.terminal) return { ok: true, terminal: true, status: begin.message?.status, messageId };
      throw new Error(begin?.error || "SMS submission could not begin.");
    }
    if (begin.duplicate) return { ok: true, duplicate: true, status: begin.message.status, messageId };

    const consentLedger = await readPlatformDoc(ROOT, "consent", { records: [] });
    const consent = (consentLedger?.records || [])
      .map(record => normalizeConsent(record))
      .find(record => record.id === job.payload?.consentRecordId);
    const consentActive = Boolean(
      consent?.smsSafety?.optedIn
      && consent.phone
      && smsRecipientHash(CURRENT_EVENT_ID, consent.phone) === begin.message.recipientHash
    );
    const config = smsConfigFromEnv();
    const alert = job.payload?.alert || {};
    const text = `SandFest ${String(alert.severity || "alert").toUpperCase()}: ${String(alert.title || "Festival alert").trim()}. ${String(alert.message || "").trim()}`.slice(0, 320);
    const callbackUrl = smsStatusCallbackUrl(config, { campaignId, messageId });
    const delivery = consentActive
      ? await withRuntimeOwnership(ROOT, () => sendSms(consent.phone, text, { config, statusCallbackUrl: callbackUrl }))
      : { ok: false, skipped: true, status: "suppressed", error: "Safety SMS consent is no longer active." };
    let recorded = null;
    await updatePlatformDoc(ROOT, "smsOperations", current => {
      recorded = recordSmsSubmission(current, messageId, delivery, {
        now: new Date().toISOString(),
        eventId: CURRENT_EVENT_ID
      });
      return recorded.ok ? recorded.doc : normalizeSmsOperations(current, { eventId: CURRENT_EVENT_ID });
    }, { fallback: emptySmsOperations(CURRENT_EVENT_ID) });
    if (!recorded?.ok) throw new Error(recorded?.error || "SMS delivery evidence could not be recorded.");
    console.log(`[worker] sms.alert.send job=${job.id} campaign=${campaignId} status=${recorded.message.status}`);
    return { ok: delivery.ok, messageId, campaignId, status: recorded.message.status };
  }
  case "quickbooks.sync_stub": {
    // Placeholder until QB credentials arrive — marks job done so pipeline is testable.
    console.log(`[worker] quickbooks.sync_stub job=${job.id} payload keys=${Object.keys(job.payload || {}).join(",")}`);
    return { ok: true, stub: true };
  }
  case "quickbooks.partner_invoice.sync": {
    const doc = normalizePartnerOperations(await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations()));
    const invoice = doc.invoices.find(item => item.id === job.payload.invoiceId);
    if (!invoice) throw new Error("Partner invoice not found.");
    if (invoice.status === "synced") return { ok: true, alreadySynced: true, invoiceId: invoice.id };
    if (invoice.status !== "queued") throw new Error(`Partner invoice is ${invoice.status}, not queued.`);
    const application = doc.applications.find(item => item.id === invoice.applicationId);
    if (!application) throw new Error("Application not found for partner invoice.");
    const runtime = await loadQuickBooksRuntimeCredentials(ROOT);
    const sync = await withRuntimeOwnership(ROOT, () => syncPartnerInvoiceToQuickBooks({ application, invoice }, {
      runtimeEnv: runtime.env,
      onTokenRefresh: token => persistQuickBooksTokenRotation(ROOT, runtime, token)
    }));
    let recorded = null;
    await updatePlatformDoc(ROOT, "partnerOps", current => {
      recorded = recordPartnerInvoiceSync(current, invoice.id, sync);
      return recorded.ok ? recorded.doc : normalizePartnerOperations(current);
    }, { fallback: doc });
    if (!recorded?.ok) throw new Error(recorded?.error || "QuickBooks invoice synced but local proof could not be recorded.");
    console.log(`[worker] quickbooks.partner_invoice.sync job=${job.id} invoice=${invoice.id} qbo=${sync.invoiceId}`);
    return { ok: true, invoiceId: invoice.id, quickBooksInvoiceId: sync.invoiceId, docNumber: sync.docNumber };
  }
  case "quickbooks.partner_invoice.reconcile": {
    const doc = normalizePartnerOperations(await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations()));
    const invoice = doc.invoices.find(item => item.id === job.payload.invoiceId);
    if (!invoice) throw new Error("Partner invoice not found.");
    if (invoice.status !== "synced" || invoice.quickBooksReconciliationStatus !== "queued") {
      throw new Error("Partner invoice is not queued for QuickBooks refresh.");
    }
    if (Number(invoice.quickBooksReconciliationVersion || 0) !== Number(job.payload.reconciliationVersion || 0)) {
      throw new Error("Partner invoice refresh version is stale.");
    }
    const runtime = await loadQuickBooksRuntimeCredentials(ROOT);
    const reconciliation = await withRuntimeOwnership(ROOT, () => reconcilePartnerInvoiceFromQuickBooks({ invoice }, {
      runtimeEnv: runtime.env,
      onTokenRefresh: token => persistQuickBooksTokenRotation(ROOT, runtime, token)
    }));
    let recorded = null;
    await updatePlatformDoc(ROOT, "partnerOps", current => {
      recorded = recordPartnerInvoiceReconciliation(current, invoice.id, reconciliation);
      return recorded.ok ? recorded.doc : normalizePartnerOperations(current);
    }, { fallback: doc });
    if (!recorded?.ok) throw new Error(recorded?.error || "QuickBooks invoice refreshed but local proof could not be recorded.");
    console.log(`[worker] quickbooks.partner_invoice.reconcile job=${job.id} invoice=${invoice.id} balance=${reconciliation.balanceCents}`);
    return { ok: true, invoiceId: invoice.id, balanceCents: reconciliation.balanceCents, reconciledAt: reconciliation.reconciledAt };
  }
  case "document.extract": {
    const documentId = String(job.payload?.documentId || "");
    const eventId = String(job.payload?.eventId || "");
    const checksumSha256 = String(job.payload?.checksumSha256 || "");
    const extractionVersion = Math.max(0, Math.round(Number(job.payload?.extractionVersion) || 0));
    if (!documentId || eventId !== CURRENT_EVENT_ID || !checksumSha256 || !extractionVersion) {
      return { ok: true, canceled: true, reason: "invalid_or_stale_document_extraction_job" };
    }

    let begun = null;
    await updatePlatformDoc(ROOT, "incomingDocuments", current => {
      begun = beginIncomingDocumentExtraction(current, documentId, {
        extractionVersion,
        jobId: job.id
      }, {
        eventId: CURRENT_EVENT_ID,
        now: new Date().toISOString()
      });
      return begun.ok ? begun.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
    }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
    if (!begun?.ok) {
      if (begun?.canceled || begun?.stale) return { ok: true, canceled: true, status: begun.status, documentId };
      throw new Error(begun?.error || "Document extraction could not begin.");
    }
    if (begun.document.checksumSha256 !== checksumSha256) {
      let failed = null;
      await updatePlatformDoc(ROOT, "incomingDocuments", current => {
        failed = failIncomingDocumentExtraction(current, documentId, "Document checksum changed after extraction was queued.", {
          eventId: CURRENT_EVENT_ID,
          extractionVersion,
          terminal: true,
          now: new Date().toISOString()
        });
        return failed.ok ? failed.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
      }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      return { ok: true, failed: true, integrityFailure: true, documentId };
    }

    const stored = extractionSource.remoteReady
      ? await fetchDocumentExtractionSource(begun.document, { config: extractionSource })
      : extractionSource.production
        ? { ok: false, error: "Production document extraction requires an authenticated API source." }
        : await readIncomingDocumentUpload(ROOT, begun.document.storageKey, { config: incomingDocumentStorage });
    if (!stored.ok) {
      const terminal = Number(job.attempts || 1) >= Number(job.maxAttempts || 3);
      let failed = null;
      await updatePlatformDoc(ROOT, "incomingDocuments", current => {
        failed = failIncomingDocumentExtraction(current, documentId, stored.error, {
          eventId: CURRENT_EVENT_ID,
          extractionVersion,
          terminal,
          now: new Date().toISOString()
        });
        return failed.ok ? failed.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
      }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      if (terminal) return { ok: true, failed: true, documentId, error: stored.error };
      throw new Error(stored.error || "Document extraction source is unavailable.");
    }
    const verified = verifyIncomingDocumentBytes(begun.document, stored.buffer);
    if (!verified.ok) {
      let failed = null;
      await updatePlatformDoc(ROOT, "incomingDocuments", current => {
        failed = failIncomingDocumentExtraction(current, documentId, verified.error, {
          eventId: CURRENT_EVENT_ID,
          extractionVersion,
          terminal: true,
          now: new Date().toISOString()
        });
        return failed.ok ? failed.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
      }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      return { ok: true, failed: true, integrityFailure: true, documentId };
    }

    const extracted = await extractDocumentText(stored.buffer, begun.document);
    if (!extracted.ok) {
      const terminal = Number(job.attempts || 1) >= Number(job.maxAttempts || 3);
      let failed = null;
      await updatePlatformDoc(ROOT, "incomingDocuments", current => {
        failed = failIncomingDocumentExtraction(current, documentId, extracted.error, {
          eventId: CURRENT_EVENT_ID,
          extractionVersion,
          terminal,
          now: new Date().toISOString()
        });
        return failed.ok ? failed.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
      }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
      if (terminal) return { ok: true, failed: true, documentId, error: extracted.error };
      throw new Error(extracted.error || "Document extraction failed.");
    }

    let completed = null;
    await updatePlatformDoc(ROOT, "incomingDocuments", current => {
      completed = completeIncomingDocumentExtraction(current, documentId, {
        ...extracted,
        extractionVersion
      }, {
        eventId: CURRENT_EVENT_ID,
        now: new Date().toISOString()
      });
      return completed.ok ? completed.doc : normalizeIncomingDocumentIntake(current, { eventId: CURRENT_EVENT_ID });
    }, { fallback: emptyIncomingDocumentIntake(CURRENT_EVENT_ID) });
    if (!completed?.ok) {
      if (completed?.canceled || completed?.stale) return { ok: true, canceled: true, documentId };
      throw new Error(completed?.error || "Document extraction result could not be recorded.");
    }
    console.log(`[worker] document.extract job=${job.id} document=${documentId} status=${completed.document.extractionStatus} chunks=${completed.document.extractedChunkCount}`);
    return {
      ok: true,
      documentId,
      status: completed.document.extractionStatus,
      characters: completed.document.extractedCharacterCount,
      chunks: completed.document.extractedChunkCount
    };
  }
  case "partner.followup.prepare": {
    let result = null;
    await updatePlatformDoc(ROOT, "partnerOps", current => {
      const doc = normalizePartnerOperations(current);
      const followup = doc.followups.find(item => item.id === job.payload.followupId);
      const application = doc.applications.find(item => item.id === followup?.applicationId);
      result = prepareFollowupDraft(doc, job.payload.followupId, {
        portalUrl: application ? statusPortalUrl(application) : null
      });
      return result.ok ? result.doc : normalizePartnerOperations(current);
    }, { fallback: emptyPartnerOperations() });
    if (!result?.ok) throw new Error(result?.error || "Follow-up draft could not be prepared.");
    console.log(`[worker] partner.followup.prepare job=${job.id} followup=${job.payload.followupId} changed=${result.changed}`);
    return { ok: true, changed: result.changed, followupId: job.payload.followupId, status: result.followup.status };
  }
  case "partner.followup.send": {
    let doc = normalizePartnerOperations(await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations()));
    let followup = doc.followups.find(item => item.id === job.payload.followupId);
    if (!followup) throw new Error("Follow-up not found.");
    if (followup.status === "sent") return { ok: true, alreadySent: true, followupId: followup.id };
    if (followup.status === "sending") {
      if (followup.deliveryClaimId !== job.id) {
        return { ok: true, canceled: true, followupId: followup.id, status: followup.status };
      }
      if (followup.providerSubmissionStartedAt) {
        let unknown = null;
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          unknown = recordFollowupDelivery(current, followup.id, {
            sent: false,
            provider: "worker",
            error: "A previous worker stopped after starting provider submission; verify the provider before a manual retry."
          }, { terminal: true, unknownOutcome: true, deliveryClaimId: job.id });
          return unknown.ok ? unknown.doc : normalizePartnerOperations(current);
        }, { fallback: doc });
        if (!unknown?.ok) throw new Error(unknown?.error || "Unknown email outcome could not be recorded.");
        return { ok: true, deliveryUnknown: true, followupId: followup.id, status: unknown.followup.status };
      }
    }
    const recipientContext = await readRecipientContext();
    if (job.payload.automated === true && followup.status === "approved") {
      const automationPolicy = String(followup.automationPolicy || "");
      if (![PARTNER_TRANSACTIONAL_AUTOMATION_POLICY, OUTREACH_CAMPAIGN_AUTOMATION_POLICY].includes(automationPolicy)
        || job.payload.automationPolicy !== automationPolicy
        || followup.approvedBy !== `automation:${automationPolicy}`) {
        throw new Error("Automated send job does not match an automation-approved follow-up.");
      }
      let queued = null;
      let released = null;
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        const currentDoc = currentPartnerOperations(current);
        const currentFollowup = currentDoc.followups.find(item => item.id === job.payload.followupId);
        if (currentFollowup?.status !== "approved") return currentDoc;
        const now = new Date().toISOString();
        queued = queueFollowupDelivery(currentDoc, currentFollowup.id, {
          now,
          automationJobId: job.id,
          ...recipientContext
        });
        if (queued.ok) return queued.doc;
        released = releaseAutomatedFollowupApproval(currentDoc, currentFollowup.id, queued.error, {
          now,
          actorId: "worker",
          automationPolicy,
          decision: queued.dailyLimitReached ? "daily_capacity_released" : "queue_rejected"
        });
        return released.ok ? released.doc : currentDoc;
      }, { fallback: doc });
      if (queued && !queued.ok && !released?.ok) throw new Error(queued.error || "Automated follow-up could not be queued.");
      doc = normalizePartnerOperations(await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations()));
      followup = doc.followups.find(item => item.id === job.payload.followupId);
    }
    if (["draft_ready", "dismissed", "failed"].includes(followup?.status)) {
      return { ok: true, canceled: true, followupId: followup.id, status: followup.status };
    }
    if (!["queued", "sending"].includes(followup.status)) throw new Error(`Follow-up is ${followup.status}, not queued or sending.`);
    if (followup.status === "queued") {
      let claimed = null;
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        claimed = claimFollowupDelivery(current, followup.id, {
          ...recipientContext,
          deliveryClaimId: job.id,
          now: new Date().toISOString()
        });
        return claimed.ok ? claimed.doc : normalizePartnerOperations(current);
      }, { fallback: doc });
      if (!claimed?.ok) {
        if (claimed?.canceled || claimed?.status === "sent") {
          return { ok: true, canceled: claimed.status !== "sent", alreadySent: claimed.status === "sent", followupId: followup.id, status: claimed.status };
        }
        throw new Error(claimed?.error || "Follow-up delivery could not be claimed.");
      }
      doc = claimed.doc;
      followup = claimed.followup;
    }
    let begun = null;
    await updatePlatformDoc(ROOT, "partnerOps", current => {
      begun = beginFollowupProviderSubmission(current, followup.id, {
        ...recipientContext,
        deliveryClaimId: job.id,
        actorId: "worker",
        now: new Date().toISOString()
      });
      return begun.ok ? begun.doc : normalizePartnerOperations(current);
    }, { fallback: doc });
    if (!begun?.ok) {
      if (begun?.canceled || begun?.status === "sent") {
        return { ok: true, canceled: begun.status !== "sent", alreadySent: begun.status === "sent", followupId: followup.id, status: begun.status };
      }
      throw new Error(begun?.error || "Provider submission could not be started.");
    }
    if (begun.canceled) return { ok: true, canceled: true, followupId: followup.id, status: begun.status };
    followup = begun.followup;
    const preferenceUrl = followup.prospectId ? outreachPreferencesUrl(begun.recipient) : null;
    const delivery = await withRuntimeOwnership(ROOT, () => sendTransactionalEmail({
      toEmail: followup.recipient,
      toName: begun.toName,
      subject: followup.subject,
      textContent: preferenceUrl ? appendOutreachPreferenceFooter(followup.body, preferenceUrl) : followup.body,
      listUnsubscribeUrl: preferenceUrl,
      idempotencyKey: followup.deliveryIdempotencyKey,
      tags: ["sandfest-partner", `followup-${followup.id}`]
    }, { config: emailConfigFromEnv() }));
    if (!delivery.sent && !delivery.duplicate) {
      const error = new Error(delivery.error || delivery.reason || "Transactional email was not sent.");
      error.delivery = delivery;
      throw error;
    }
    let recorded = null;
    try {
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        recorded = recordFollowupDelivery(current, followup.id, delivery.duplicate ? {
          ...delivery,
          error: "Brevo already accepted this idempotency key; verify provider delivery before a manual retry."
        } : delivery, {
          terminal: delivery.duplicate === true,
          unknownOutcome: delivery.duplicate === true,
          deliveryClaimId: job.id
        });
        if (!recorded.ok) return normalizePartnerOperations(current);
        const reconciled = applyBrevoDeliveryEvents(recorded.doc, []);
        recorded = { ...recorded, doc: reconciled.doc, followup: reconciled.doc.followups.find(item => item.id === followup.id) };
        return reconciled.doc;
      }, { fallback: doc });
    } catch (error) {
      error.delivery = delivery;
      throw error;
    }
    if (!recorded?.ok) {
      const error = new Error(recorded?.error || "Email outcome could not be recorded.");
      error.delivery = delivery;
      throw error;
    }
    if (delivery.duplicate) return { ok: true, deliveryUnknown: true, followupId: followup.id, status: recorded.followup.status };
    console.log(`[worker] partner.followup.send job=${job.id} followup=${followup.id} provider=${delivery.provider} message=${delivery.providerMessageId || "accepted"}`);
    return { ok: true, followupId: followup.id, provider: delivery.provider, providerMessageId: delivery.providerMessageId };
  }
  case "incident.dispatch.send": {
    const doc = normalizeIslandConditions(await readPlatformDoc(ROOT, "islandConditions", null));
    const dispatch = doc.dispatches.find(item => item.id === job.payload.dispatchId);
    if (!dispatch) throw new Error("Incident dispatch not found.");
    if (dispatch.notification.status === "sent") return { ok: true, alreadySent: true, dispatchId: dispatch.id };
    if (dispatch.status === "canceled" || dispatch.notification.status === "canceled") {
      return { ok: true, canceled: true, dispatchId: dispatch.id };
    }
    if (dispatch.notification.status !== "queued") throw new Error(`Incident dispatch message is ${dispatch.notification.status}, not queued.`);
    const recipientContext = await readRecipientContext();
    const resolved = resolveIncidentDispatchRecipient(doc, dispatch.id, recipientContext);
    if (!resolved.ok) throw new Error(resolved.error);
    const delivery = await withRuntimeOwnership(ROOT, () => sendTransactionalEmail({
      toEmail: resolved.recipient,
      toName: resolved.toName,
      subject: dispatch.notification.subject,
      textContent: dispatch.notification.body,
      tags: ["sandfest-operations", "incident-dispatch"]
    }, { config: emailConfigFromEnv() }));
    if (!delivery.sent) {
      const error = new Error(delivery.error || delivery.reason || "Incident dispatch email was not sent.");
      error.delivery = delivery;
      throw error;
    }
    let recorded = null;
    await updatePlatformDoc(ROOT, "islandConditions", current => {
      recorded = recordIncidentDispatchDelivery(current, dispatch.id, delivery);
      return recorded.ok ? recorded.doc : normalizeIslandConditions(current);
    }, { fallback: doc });
    if (!recorded?.ok) throw new Error(recorded?.error || "Dispatch email sent but delivery proof could not be recorded.");
    console.log(`[worker] incident.dispatch.send job=${job.id} dispatch=${dispatch.id} provider=${delivery.provider} message=${delivery.providerMessageId || "accepted"}`);
    return { ok: true, dispatchId: dispatch.id, provider: delivery.provider, providerMessageId: delivery.providerMessageId };
  }
  default:
    throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function scheduleAutomatedFollowups(candidates, recipientContext = {}) {
  let queued = 0;
  let failed = 0;
  for (const candidate of candidates.slice(0, BATCH)) {
    try {
      const automationPolicy = candidate.automationPolicy;
      if (![PARTNER_TRANSACTIONAL_AUTOMATION_POLICY, OUTREACH_CAMPAIGN_AUTOMATION_POLICY].includes(automationPolicy)) {
        throw new Error("Follow-up does not carry a supported automation policy.");
      }
      const job = await enqueueJob(ROOT, {
        type: "partner.followup.send",
        payload: {
          followupId: candidate.id,
          automated: true,
          automationPolicy
        },
        maxAttempts: 5,
        idempotencyKey: `${automationPolicy}:${candidate.id}:${candidate.approvedAt}`
      });
      if (!["queued", "running"].includes(job.status)) {
        throw new Error(`Automation job ${job.id} is ${job.status}; a fresh approval is required before retrying.`);
      }
      let result = null;
      let released = null;
      let outcome = "stale";
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        const doc = currentPartnerOperations(current);
        const followup = doc.followups.find(item => item.id === candidate.id);
        if (followup?.status === "queued" && followup.automationJobId === job.id) {
          outcome = "already_queued";
          return doc;
        }
        if (followup?.status !== "approved") {
          outcome = followup?.status || "missing";
          return doc;
        }
        const now = new Date().toISOString();
        result = queueFollowupDelivery(doc, candidate.id, {
          now,
          automationJobId: job.id,
          ...recipientContext
        });
        if (result.ok) {
          outcome = "queued";
          return result.doc;
        }
        released = releaseAutomatedFollowupApproval(doc, candidate.id, result.error, {
          now,
          actorId: "worker",
          automationPolicy,
          decision: result.dailyLimitReached ? "daily_capacity_released" : "queue_rejected"
        });
        outcome = released.ok ? "released" : "rejected";
        return released.ok ? released.doc : doc;
      }, { fallback: emptyPartnerOperations(CURRENT_EVENT_ID) });
      if (result && !result.ok && !released?.ok) throw new Error(result.error || "Automated follow-up could not be queued.");
      if (["queued", "already_queued"].includes(outcome)) queued += 1;
    } catch (error) {
      failed += 1;
      console.error(`[worker] automated follow-up schedule failed id=${candidate.id}: ${error.message}`);
    }
  }
  return { queued, failed };
}

async function reconcileTerminalQueueFailures() {
  const failedJobs = (await listJobs(ROOT, { limit: 1000, statuses: ["failed"], unhandledOnly: true }))
    .filter(job => job.lastError?.startsWith("Worker lease expired"));
  for (const job of failedJobs) {
    let recognized = false;
    if (job.type === "sms.alert.send" && job.payload?.messageId) {
      recognized = true;
      let reconciled = null;
      await updatePlatformDoc(ROOT, "smsOperations", current => {
        const doc = normalizeSmsOperations(current, { eventId: CURRENT_EVENT_ID });
        const message = doc.messages.find(item => item.id === job.payload.messageId);
        if (!message || ["delivered", "read", "failed", "undelivered", "canceled", "delivery_unknown", "suppressed"].includes(message.status)) {
          return doc;
        }
        reconciled = recordSmsSubmission(doc, job.payload.messageId, {
          ok: false,
          unknownOutcome: true,
          error: job.lastError
        }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID });
        return reconciled.ok ? reconciled.doc : doc;
      }, { fallback: emptySmsOperations(CURRENT_EVENT_ID) });
      if (reconciled?.ok) console.warn(`[worker] reconciled expired SMS job=${job.id} as delivery_unknown`);
    }
    if (job.type === "partner.followup.send" && job.payload?.followupId) {
      recognized = true;
      let reconciled = false;
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        const doc = normalizePartnerOperations(current);
        const followup = doc.followups.find(item => item.id === job.payload.followupId);
        if (!followup) return doc;
        const result = followup.status === "approved" && job.payload.automated === true
          ? releaseAutomatedFollowupApproval(doc, job.payload.followupId, job.lastError, {
            actorId: "worker",
            automationPolicy: job.payload.automationPolicy,
            decision: "terminal_job_released"
          })
          : ["queued", "sending"].includes(followup.status)
            ? recordFollowupDelivery(doc, job.payload.followupId, {
              sent: false,
              provider: "worker",
              error: job.lastError
            }, {
              terminal: true,
              unknownOutcome: followup.status === "sending",
              deliveryClaimId: followup.status === "sending" ? job.id : undefined
            })
            : null;
        if (!result) return doc;
        reconciled = result.ok;
        return result.ok ? result.doc : doc;
      }, { fallback: emptyPartnerOperations() });
      if (reconciled) console.warn(`[worker] reconciled expired terminal follow-up job=${job.id}`);
    }
    if (job.type === "incident.dispatch.send" && job.payload?.dispatchId) {
      recognized = true;
      let reconciled = false;
      await updatePlatformDoc(ROOT, "islandConditions", current => {
        const doc = normalizeIslandConditions(current);
        const dispatch = doc.dispatches.find(item => item.id === job.payload.dispatchId);
        if (dispatch?.notification?.status !== "queued") return doc;
        const result = recordIncidentDispatchDelivery(doc, job.payload.dispatchId, {
          sent: false,
          provider: "worker",
          error: job.lastError
        }, { terminal: true });
        reconciled = result.ok;
        return result.ok ? result.doc : doc;
      }, { fallback: normalizeIslandConditions(null) });
      if (reconciled) console.warn(`[worker] reconciled expired terminal dispatch job=${job.id}`);
    }
    if (job.type === "quickbooks.partner_invoice.sync" && job.payload?.invoiceId) {
      recognized = true;
      let reconciled = false;
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        const doc = normalizePartnerOperations(current);
        if (doc.invoices.find(item => item.id === job.payload.invoiceId)?.status !== "queued") return doc;
        const result = recordPartnerInvoiceSync(doc, job.payload.invoiceId, {
          ok: false,
          error: job.lastError
        }, { terminal: true });
        reconciled = result.ok;
        return result.ok ? result.doc : doc;
      }, { fallback: emptyPartnerOperations() });
      if (reconciled) console.warn(`[worker] reconciled expired terminal invoice job=${job.id}`);
    }
    if (job.type === "quickbooks.partner_invoice.reconcile" && job.payload?.invoiceId) {
      recognized = true;
      let reconciled = false;
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        const doc = normalizePartnerOperations(current);
        const invoice = doc.invoices.find(item => item.id === job.payload.invoiceId);
        if (invoice?.quickBooksReconciliationStatus !== "queued") return doc;
        if (Number(invoice.quickBooksReconciliationVersion || 0) !== Number(job.payload.reconciliationVersion || 0)) return doc;
        const result = recordPartnerInvoiceReconciliation(doc, job.payload.invoiceId, {
          ok: false,
          error: job.lastError
        }, { terminal: true });
        reconciled = result.ok;
        return result.ok ? result.doc : doc;
      }, { fallback: emptyPartnerOperations() });
      if (reconciled) console.warn(`[worker] reconciled expired terminal QuickBooks refresh job=${job.id}`);
    }
    if (recognized) await markTerminalJobHandled(ROOT, job.id);
  }
}

async function tick() {
  let generatedDrafts = 0;
  let generatedMilestoneDrafts = 0;
  let generatedOutreachDrafts = 0;
  let generatedTaskDrafts = 0;
  let reconciledDocumentReviewTasks = 0;
  let autoApproved = 0;
  let autoSkipped = 0;
  let automationCandidates = [];
  const email = emailConfigFromEnv();
  const automationProviderReady = email.ready && brevoWebhookConfig().ready;
  const partnerSeed = currentPartnerOperations(
    await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations(CURRENT_EVENT_ID))
  );
  const incomingDocuments = normalizeIncomingDocumentIntake(
    await readPlatformDoc(ROOT, "incomingDocuments", emptyIncomingDocumentIntake(CURRENT_EVENT_ID)),
    { eventId: CURRENT_EVENT_ID }
  );
  if (incomingDocuments.eventId !== CURRENT_EVENT_ID) {
    throw new Error(`Document intake is assigned to ${incomingDocuments.eventId}; worker expects ${CURRENT_EVENT_ID}.`);
  }
  const recipientContext = await readRecipientContext();
  await updatePlatformDoc(ROOT, "partnerOps", current => {
    const routed = syncIncomingDocumentReviewTasks(currentPartnerOperations(current), incomingDocuments.documents, {
      actorId: "worker",
      idFactory: prefix => `${prefix}_${randomUUID()}`
    });
    if (!routed.ok) throw new Error(routed.error || "Document review task reconciliation failed.");
    reconciledDocumentReviewTasks = routed.summary.created + routed.summary.updated;
    const tasks = generateDueTaskFollowups(routed.doc, {
      ...recipientContext,
      idFactory: prefix => `${prefix}_${randomUUID()}`
    });
    const milestones = generateDuePartnerFollowups(tasks.doc, {
      leadDays: 3,
      portalUrlForApplication: statusPortalUrl
    });
    const outreach = generateDueOutreachFollowups(milestones.doc, {
      preferenceUrlForProspect: outreachPreferencesUrl,
      sponsorInvitationUrlForProspect: sponsorInviteUrl
    });
    const outreachAutomated = applyOutreachCampaignAutomation(outreach.doc, {
      providerReady: automationProviderReady,
      maxBatch: BATCH,
      idFactory: prefix => `${prefix}_${randomUUID()}`,
      ...recipientContext
    });
    const automated = applyTransactionalFollowupAutomation(outreachAutomated.doc, {
      providerReady: automationProviderReady,
      maxBatch: BATCH,
      idFactory: prefix => `${prefix}_${randomUUID()}`,
      ...recipientContext
    });
    generatedTaskDrafts = tasks.generated.length;
    generatedMilestoneDrafts = milestones.generated.length;
    generatedOutreachDrafts = outreach.generated.length;
    generatedDrafts = generatedTaskDrafts + generatedMilestoneDrafts + generatedOutreachDrafts;
    autoApproved = outreachAutomated.approved.length + automated.approved.length;
    autoSkipped = outreachAutomated.skipped.length + automated.skipped.length;
    automationCandidates = automatedFollowupQueueCandidates(automated.doc, {
      maxBatch: BATCH,
      providerReady: automationProviderReady
    });
    return automated.doc;
  }, { fallback: partnerSeed });
  if (generatedTaskDrafts) console.log(`[worker] generated ${generatedTaskDrafts} task notification draft(s)`);
  if (reconciledDocumentReviewTasks) console.log(`[worker] reconciled ${reconciledDocumentReviewTasks} document review task(s)`);
  if (generatedMilestoneDrafts) console.log(`[worker] generated ${generatedMilestoneDrafts} milestone follow-up draft(s)`);
  if (generatedOutreachDrafts) console.log(`[worker] generated ${generatedOutreachDrafts} outreach draft(s)`);
  const campaignAutomationCandidates = automationCandidates.filter(item => item.automationPolicy === OUTREACH_CAMPAIGN_AUTOMATION_POLICY).length;
  const transactionalAutomationCandidates = automationCandidates.filter(item => item.automationPolicy === PARTNER_TRANSACTIONAL_AUTOMATION_POLICY).length;
  const automated = await scheduleAutomatedFollowups(automationCandidates, recipientContext);
  if (autoApproved || automated.queued || automated.failed) {
    if (campaignAutomationCandidates) {
      console.log(`[worker] outreach campaign automation policy=${OUTREACH_CAMPAIGN_AUTOMATION_POLICY} candidates=${campaignAutomationCandidates}`);
    }
    if (transactionalAutomationCandidates) {
      console.log(`[worker] transactional automation policy=${PARTNER_TRANSACTIONAL_AUTOMATION_POLICY} candidates=${transactionalAutomationCandidates}`);
    }
    console.log(`[worker] message automation approved=${autoApproved} queued=${automated.queued} skipped=${autoSkipped} failed=${automated.failed}`);
  }
  const jobs = await claimNextJobs(ROOT, { limit: BATCH, workerId: QUEUE.workerId, leaseMs: QUEUE.leaseMs });
  await reconcileTerminalQueueFailures();
  for (const job of jobs) {
    try {
      await handleJob(job);
      const completion = await completeJob(ROOT, job);
      if (!completion.ok) console.warn(`[worker] job ${job.id} completion ignored: ${completion.reason}`);
    } catch (error) {
      console.error(`[worker] job ${job.id} error:`, error.message);
      let terminalHandled = true;
      if (job.type === "sms.alert.send" && job.payload?.messageId) {
        await updatePlatformDoc(ROOT, "smsOperations", current => {
          const doc = normalizeSmsOperations(current, { eventId: CURRENT_EVENT_ID });
          const message = doc.messages.find(item => item.id === job.payload.messageId);
          if (!message || ["delivered", "read", "failed", "undelivered", "canceled", "delivery_unknown", "suppressed"].includes(message.status)) {
            return doc;
          }
          const result = recordSmsSubmission(doc, job.payload.messageId, {
            ok: false,
            unknownOutcome: message.status === "sending",
            error: error.message
          }, { now: new Date().toISOString(), eventId: CURRENT_EVENT_ID });
          return result.ok ? result.doc : doc;
        }, { fallback: emptySmsOperations(CURRENT_EVENT_ID) });
      }
      if (job.type === "partner.followup.send" && job.payload?.followupId) {
        let partnerFailureHandled = false;
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const doc = normalizePartnerOperations(current);
          const followup = doc.followups.find(item => item.id === job.payload.followupId);
          if (!followup || ["draft_ready", "dismissed", "failed", "sent"].includes(followup.status)) {
            partnerFailureHandled = true;
            return doc;
          }
          const terminal = job.attempts >= job.maxAttempts;
          const result = terminal && followup.status === "approved" && job.payload.automated === true
            ? releaseAutomatedFollowupApproval(doc, job.payload.followupId, error.message, {
              actorId: "worker",
              automationPolicy: job.payload.automationPolicy,
              decision: "terminal_job_released"
            })
            : recordFollowupDelivery(doc, job.payload.followupId, error.delivery || {
              sent: false,
              provider: "brevo",
              error: error.message
            }, { terminal, deliveryClaimId: job.id });
          partnerFailureHandled = result.ok;
          return result.ok ? result.doc : normalizePartnerOperations(current);
        }, { fallback: emptyPartnerOperations() });
        terminalHandled = partnerFailureHandled;
      }
      if (job.type === "incident.dispatch.send" && job.payload?.dispatchId) {
        await updatePlatformDoc(ROOT, "islandConditions", current => {
          const result = recordIncidentDispatchDelivery(current, job.payload.dispatchId, error.delivery || {
            sent: false,
            provider: "brevo",
            error: error.message
          }, { terminal: job.attempts >= job.maxAttempts });
          return result.ok ? result.doc : normalizeIslandConditions(current);
        }, { fallback: normalizeIslandConditions(null) });
      }
      if (job.type === "quickbooks.partner_invoice.sync" && job.payload?.invoiceId) {
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const result = recordPartnerInvoiceSync(current, job.payload.invoiceId, {
            ok: false,
            error: error.message
          }, { terminal: job.attempts >= job.maxAttempts });
          return result.ok ? result.doc : normalizePartnerOperations(current);
        }, { fallback: emptyPartnerOperations() });
      }
      if (job.type === "quickbooks.partner_invoice.reconcile" && job.payload?.invoiceId) {
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const doc = normalizePartnerOperations(current);
          const invoice = doc.invoices.find(item => item.id === job.payload.invoiceId);
          if (Number(invoice?.quickBooksReconciliationVersion || 0) !== Number(job.payload.reconciliationVersion || 0)) return doc;
          const result = recordPartnerInvoiceReconciliation(doc, job.payload.invoiceId, {
            ok: false,
            error: error.message
          }, { terminal: job.attempts >= job.maxAttempts });
          return result.ok ? result.doc : doc;
        }, { fallback: emptyPartnerOperations() });
      }
      const completion = await completeJob(ROOT, job, { error: error.message, terminalHandled });
      if (!completion.ok) console.warn(`[worker] job ${job.id} failure update ignored: ${completion.reason}`);
    }
  }
  return {
    jobs: jobs.length,
    generatedDrafts,
    generatedTaskDrafts,
    reconciledDocumentReviewTasks,
    generatedMilestoneDrafts,
    generatedOutreachDrafts,
    autoApproved,
    autoQueued: automated.queued,
    autoFailed: automated.failed
  };
}

console.log(`[worker] started root=${ROOT} event=${CURRENT_EVENT_ID} worker=${QUEUE.workerId} poll=${POLL_MS}ms lease=${QUEUE.leaseMs}ms once=${ONCE}`);
try {
  await writeHeartbeat("running", { once: ONCE });
} catch (error) {
  if (error?.code !== RUNTIME_OWNERSHIP_ERROR_CODE) throw error;
  console.warn(`[worker] ${error.message}`);
  process.exit(0);
}

if (ONCE) {
  try {
    const result = await tick();
    await writeHeartbeat("stopped", {
      once: true,
      lastBatchSize: result.jobs,
      lastGeneratedDrafts: result.generatedDrafts,
      lastGeneratedTaskDrafts: result.generatedTaskDrafts,
      lastReconciledDocumentReviewTasks: result.reconciledDocumentReviewTasks,
      lastGeneratedOutreachDrafts: result.generatedOutreachDrafts,
      lastAutoApproved: result.autoApproved,
      lastAutoQueued: result.autoQueued,
      lastAutoFailed: result.autoFailed
    });
    console.log(`[worker] processed ${result.jobs} job(s), generated ${result.generatedDrafts} draft(s)`);
    process.exit(0);
  } catch (error) {
    if (error?.code !== RUNTIME_OWNERSHIP_ERROR_CODE) throw error;
    console.warn(`[worker] ${error.message}`);
    process.exit(0);
  }
}

let stopped = false;
let ownershipRevoked = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

while (!stopped) {
  try {
    const processed = await tick();
    await writeHeartbeat("running", { lastBatchSize: processed.jobs, lastGeneratedDrafts: processed.generatedDrafts, lastGeneratedTaskDrafts: processed.generatedTaskDrafts, lastReconciledDocumentReviewTasks: processed.reconciledDocumentReviewTasks, lastGeneratedOutreachDrafts: processed.generatedOutreachDrafts });
  } catch (error) {
    if (error?.code === RUNTIME_OWNERSHIP_ERROR_CODE) {
      ownershipRevoked = true;
      stopped = true;
      console.warn(`[worker] ${error.message}`);
      continue;
    }
    console.error("[worker] tick failed:", error.message);
  }
  await new Promise(r => setTimeout(r, POLL_MS));
}

console.log("[worker] stopped");
if (!ownershipRevoked) {
  try {
    await writeHeartbeat("stopped");
  } catch (error) {
    if (error?.code !== RUNTIME_OWNERSHIP_ERROR_CODE) throw error;
    console.warn(`[worker] ${error.message}`);
  }
}

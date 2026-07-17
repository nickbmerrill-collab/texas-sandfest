#!/usr/bin/env node
// Background worker for enterprise async jobs (SMS fan-out, QuickBooks hooks).
// Usage:
//   node scripts/worker.mjs
//   SANDFEST_WORKER_ONCE=true node scripts/worker.mjs

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../lib/load-env.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";
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
  claimFollowupDelivery,
  emptyPartnerOperations,
  generateDueOutreachFollowups,
  generateDuePartnerFollowups,
  generateDueTaskFollowups,
  normalizePartnerOperations,
  prepareFollowupDraft,
  queueFollowupDelivery,
  recordFollowupDelivery,
  recordPartnerInvoiceReconciliation,
  recordPartnerInvoiceSync
} from "../lib/partner-ops.mjs";
import { emailConfigFromEnv, sendTransactionalEmail } from "../lib/email.mjs";
import { applyBrevoDeliveryEvents, brevoWebhookConfig } from "../lib/brevo-webhook.mjs";
import { reconcilePartnerInvoiceFromQuickBooks, syncPartnerInvoiceToQuickBooks } from "../lib/quickbooks/client.mjs";
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
      ? await sendSms(consent.phone, text, { config, statusCallbackUrl: callbackUrl })
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
    const sync = await syncPartnerInvoiceToQuickBooks({ application, invoice });
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
    const reconciliation = await reconcilePartnerInvoiceFromQuickBooks({ invoice });
    let recorded = null;
    await updatePlatformDoc(ROOT, "partnerOps", current => {
      recorded = recordPartnerInvoiceReconciliation(current, invoice.id, reconciliation);
      return recorded.ok ? recorded.doc : normalizePartnerOperations(current);
    }, { fallback: doc });
    if (!recorded?.ok) throw new Error(recorded?.error || "QuickBooks invoice refreshed but local proof could not be recorded.");
    console.log(`[worker] quickbooks.partner_invoice.reconcile job=${job.id} invoice=${invoice.id} balance=${reconciliation.balanceCents}`);
    return { ok: true, invoiceId: invoice.id, balanceCents: reconciliation.balanceCents, reconciledAt: reconciliation.reconciledAt };
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
      let unknown = null;
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        unknown = recordFollowupDelivery(current, followup.id, {
          sent: false,
          provider: "worker",
          error: "A previous worker stopped after claiming delivery; verify the provider before a manual retry."
        }, { terminal: true, unknownOutcome: true, deliveryClaimId: job.id });
        return unknown.ok ? unknown.doc : normalizePartnerOperations(current);
      }, { fallback: doc });
      if (!unknown?.ok) throw new Error(unknown?.error || "Unknown email outcome could not be recorded.");
      return { ok: true, deliveryUnknown: true, followupId: followup.id, status: unknown.followup.status };
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
      await updatePlatformDoc(ROOT, "partnerOps", current => {
        const currentDoc = currentPartnerOperations(current);
        const currentFollowup = currentDoc.followups.find(item => item.id === job.payload.followupId);
        if (currentFollowup?.status !== "approved") return currentDoc;
        queued = queueFollowupDelivery(currentDoc, currentFollowup.id, {
          now: new Date().toISOString(),
          automationJobId: job.id,
          ...recipientContext
        });
        return queued.ok ? queued.doc : currentDoc;
      }, { fallback: doc });
      if (queued && !queued.ok) throw new Error(queued.error || "Automated follow-up could not be queued.");
      doc = normalizePartnerOperations(await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations()));
      followup = doc.followups.find(item => item.id === job.payload.followupId);
    }
    if (job.payload.automated === true && ["draft_ready", "dismissed", "failed"].includes(followup?.status)) {
      return { ok: true, canceled: true, followupId: followup.id, status: followup.status };
    }
    if (followup.status !== "queued") throw new Error(`Follow-up is ${followup.status}, not queued.`);
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
    const preferenceUrl = followup.prospectId ? outreachPreferencesUrl(claimed.recipient) : null;
    const delivery = await sendTransactionalEmail({
      toEmail: followup.recipient,
      toName: claimed.toName,
      subject: followup.subject,
      textContent: preferenceUrl ? appendOutreachPreferenceFooter(followup.body, preferenceUrl) : followup.body,
      listUnsubscribeUrl: preferenceUrl,
      idempotencyKey: followup.deliveryIdempotencyKey,
      tags: ["sandfest-partner", `followup-${followup.id}`]
    }, { config: emailConfigFromEnv() });
    if (!delivery.sent) {
      if (delivery.duplicate) {
        let unknown = null;
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          unknown = recordFollowupDelivery(current, followup.id, {
            ...delivery,
            error: "Brevo already accepted this idempotency key; verify provider delivery before a manual retry."
          }, { terminal: true, unknownOutcome: true, deliveryClaimId: job.id });
          return unknown.ok ? unknown.doc : normalizePartnerOperations(current);
        }, { fallback: doc });
        if (!unknown?.ok) {
          const error = new Error(unknown?.error || "Duplicate provider outcome could not be recorded.");
          error.delivery = delivery;
          throw error;
        }
        return { ok: true, deliveryUnknown: true, followupId: followup.id, status: unknown.followup.status };
      }
      const error = new Error(delivery.error || delivery.reason || "Transactional email was not sent.");
      error.delivery = delivery;
      throw error;
    }
    let recorded = null;
    await updatePlatformDoc(ROOT, "partnerOps", current => {
      recorded = recordFollowupDelivery(current, followup.id, delivery, { deliveryClaimId: job.id });
      if (!recorded.ok) return normalizePartnerOperations(current);
      const reconciled = applyBrevoDeliveryEvents(recorded.doc, []);
      recorded = { ...recorded, doc: reconciled.doc, followup: reconciled.doc.followups.find(item => item.id === followup.id) };
      return reconciled.doc;
    }, { fallback: doc });
    if (!recorded?.ok) {
      const error = new Error(recorded?.error || "Email sent but delivery state could not be recorded.");
      error.delivery = delivery;
      throw error;
    }
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
    const delivery = await sendTransactionalEmail({
      toEmail: resolved.recipient,
      toName: resolved.toName,
      subject: dispatch.notification.subject,
      textContent: dispatch.notification.body,
      tags: ["sandfest-operations", "incident-dispatch"]
    }, { config: emailConfigFromEnv() });
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
        result = queueFollowupDelivery(doc, candidate.id, {
          now: new Date().toISOString(),
          automationJobId: job.id,
          ...recipientContext
        });
        outcome = result.ok ? "queued" : "rejected";
        return result.ok ? result.doc : doc;
      }, { fallback: emptyPartnerOperations(CURRENT_EVENT_ID) });
      if (result && !result.ok) throw new Error(result.error || "Automated follow-up could not be queued.");
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
        if (!followup || !["queued", "sending"].includes(followup.status)) return doc;
        const result = recordFollowupDelivery(doc, job.payload.followupId, {
          sent: false,
          provider: "worker",
          error: job.lastError
        }, {
          terminal: true,
          unknownOutcome: followup.status === "sending",
          deliveryClaimId: followup.status === "sending" ? job.id : undefined
        });
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
  let autoApproved = 0;
  let autoSkipped = 0;
  let automationCandidates = [];
  const email = emailConfigFromEnv();
  const automationProviderReady = email.ready && brevoWebhookConfig().ready;
  const partnerSeed = currentPartnerOperations(
    await readPlatformDoc(ROOT, "partnerOps", emptyPartnerOperations(CURRENT_EVENT_ID))
  );
  const recipientContext = await readRecipientContext();
  await updatePlatformDoc(ROOT, "partnerOps", current => {
    const tasks = generateDueTaskFollowups(currentPartnerOperations(current), {
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
        await updatePlatformDoc(ROOT, "partnerOps", current => {
          const result = recordFollowupDelivery(current, job.payload.followupId, error.delivery || {
            sent: false,
            provider: "brevo",
            error: error.message
          }, { terminal: job.attempts >= job.maxAttempts, deliveryClaimId: job.id });
          return result.ok ? result.doc : normalizePartnerOperations(current);
        }, { fallback: emptyPartnerOperations() });
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
      const completion = await completeJob(ROOT, job, { error: error.message, terminalHandled: true });
      if (!completion.ok) console.warn(`[worker] job ${job.id} failure update ignored: ${completion.reason}`);
    }
  }
  return {
    jobs: jobs.length,
    generatedDrafts,
    generatedTaskDrafts,
    generatedMilestoneDrafts,
    generatedOutreachDrafts,
    autoApproved,
    autoQueued: automated.queued,
    autoFailed: automated.failed
  };
}

console.log(`[worker] started root=${ROOT} event=${CURRENT_EVENT_ID} worker=${QUEUE.workerId} poll=${POLL_MS}ms lease=${QUEUE.leaseMs}ms once=${ONCE}`);
await writeHeartbeat("running", { once: ONCE });

if (ONCE) {
  const result = await tick();
  await writeHeartbeat("stopped", {
    once: true,
    lastBatchSize: result.jobs,
    lastGeneratedDrafts: result.generatedDrafts,
    lastGeneratedTaskDrafts: result.generatedTaskDrafts,
    lastGeneratedOutreachDrafts: result.generatedOutreachDrafts,
    lastAutoApproved: result.autoApproved,
    lastAutoQueued: result.autoQueued,
    lastAutoFailed: result.autoFailed
  });
  console.log(`[worker] processed ${result.jobs} job(s), generated ${result.generatedDrafts} draft(s)`);
  process.exit(0);
}

let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

while (!stopped) {
  try {
    const processed = await tick();
    await writeHeartbeat("running", { lastBatchSize: processed.jobs, lastGeneratedDrafts: processed.generatedDrafts, lastGeneratedTaskDrafts: processed.generatedTaskDrafts, lastGeneratedOutreachDrafts: processed.generatedOutreachDrafts });
  } catch (error) {
    console.error("[worker] tick failed:", error.message);
  }
  await new Promise(r => setTimeout(r, POLL_MS));
}

console.log("[worker] stopped");
await writeHeartbeat("stopped");

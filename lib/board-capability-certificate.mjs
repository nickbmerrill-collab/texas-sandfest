export const BOARD_CAPABILITY_CERTIFICATE_SCHEMA_VERSION = 1;
export const BOARD_CAPABILITY_READINESS = "12/12";
export const BOARD_CAPABILITY_BROWSER_CHECKS = 14;
export const BOARD_CAPABILITY_CERTIFICATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const BOARD_CAPABILITY_CERTIFICATE_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export const BOARD_CAPABILITY_JOURNEYS = Object.freeze([
  {
    id: "signups",
    label: "Vendor and sponsor intake",
    script: "scripts/prove-board-signups.mjs",
    command: "npm run board:prove:signups",
    timeoutMs: 120_000,
    capabilities: ["vendor_signup", "sponsor_signup", "automatic_acknowledgments", "private_partner_status"]
  },
  {
    id: "guest_services",
    label: "Guest Services case lifecycle",
    script: "scripts/prove-board-guest-services.mjs",
    command: "npm run board:prove:guest-services",
    timeoutMs: 180_000,
    capabilities: ["guest_services", "retry_safe_intake", "private_case_status"]
  },
  {
    id: "vendor",
    label: "Vendor onboarding and readiness",
    script: "scripts/prove-board-vendor-journey.mjs",
    command: "npm run board:prove:vendor",
    timeoutMs: 240_000,
    capabilities: ["vendor_profile", "compliance_documents", "booth_assignment", "vendor_automation"]
  },
  {
    id: "sponsor",
    label: "Sponsor conversion and branding",
    script: "scripts/prove-board-sponsor-journey.mjs",
    command: "npm run board:prove:sponsor",
    timeoutMs: 180_000,
    capabilities: ["sponsor_invitation", "sponsor_branding", "public_sponsor_showcase"]
  },
  {
    id: "outreach",
    label: "Geofenced sponsor outreach",
    script: "scripts/prove-board-outreach-journey.mjs",
    command: "npm run board:prove:outreach",
    timeoutMs: 180_000,
    capabilities: ["regional_discovery", "geofenced_outreach", "campaign_delivery", "recipient_opt_out"]
  },
  {
    id: "tickets",
    label: "Ticket payment and refund lifecycle",
    script: "scripts/prove-board-ticket-lifecycle.mjs",
    command: "npm run board:prove:tickets",
    timeoutMs: 180_000,
    capabilities: ["ticket_checkout", "payment_reconciliation", "fulfillment", "refunds"]
  },
  {
    id: "operations",
    label: "Accounting, receivables, dates, and exports",
    script: "scripts/prove-board-operations.mjs",
    command: "npm run board:prove:operations",
    timeoutMs: 180_000,
    capabilities: ["budget_control", "payment_tracking", "receivables", "key_dates", "accounting_exports"]
  },
  {
    id: "delegation",
    label: "Staff and volunteer delegation",
    script: "scripts/prove-board-delegation-journey.mjs",
    command: "npm run board:prove:delegation",
    timeoutMs: 180_000,
    capabilities: ["task_delegation", "assignment_delivery", "private_assignee_updates"]
  },
  {
    id: "incident",
    label: "Island Conditions incident response",
    script: "scripts/prove-board-incident-journey.mjs",
    command: "npm run board:prove:incident",
    timeoutMs: 180_000,
    capabilities: ["camera_metrics", "public_conditions_notice", "team_dispatch", "incident_closeout"]
  },
  {
    id: "documents",
    label: "Private document ingestion",
    script: "scripts/prove-board-documents.mjs",
    command: "npm run board:prove:documents",
    timeoutMs: 180_000,
    capabilities: ["private_upload", "document_extraction", "delegated_review", "governed_download"]
  }
]);

export const BOARD_CAPABILITY_DEFERRED_GATES = Object.freeze([
  "live_payment_and_accounting_providers",
  "live_email_and_sms_providers",
  "live_weather_and_ferry_feeds",
  "live_webcam_edge_agents",
  "production_identity_and_bot_protection",
  "public_dns_and_recovery_cutover"
]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function exactReset(report) {
  requireValue(report?.reset?.preflight === BOARD_CAPABILITY_READINESS, "The journey did not restore 12/12 readiness.");
}

function evidenceFor(id, report) {
  switch (id) {
    case "signups":
      requireValue(report.submissions?.length === 2, "The signup journey did not submit both partner types.");
      requireValue(report.automation?.delivered === 2 && report.automation?.provider === "brevo" && report.automation?.sandboxAuthenticated === true, "Signup acknowledgments were not authenticated and delivered.");
      requireValue(report.automation?.acceptedMessages >= 2 && report.automation?.deliveryCallbacks >= 2, "Signup provider acceptance or callback evidence is incomplete.");
      requireValue(report.automation?.callbackFailures === 0, "Signup delivery callbacks contain failures.");
      requireValue(report.operations?.applicationCount === 7 && report.operations?.deliveredAcknowledgments === 2, "Operations did not reconcile both signups and acknowledgments.");
      return {
        applicationsSubmitted: 2,
        acknowledgmentsDelivered: 2,
        operationsApplicationsObserved: 7,
        callbackFailures: 0
      };
    case "guest_services":
      requireValue(report.request?.category === "accessibility" && report.request?.priority === "high" && report.request?.assignedTeam === "guest-services", "Guest Services routing is incomplete.");
      requireValue(report.request?.replayed === true && report.request?.invalidCapabilityDenied === true, "Guest Services intake or private access was not retry safe.");
      requireValue(report.resolution?.resolved === true && report.resolution?.publicUpdates === 3 && report.resolution?.internalUpdates === 2, "Guest Services did not close the visitor and staff loops.");
      requireValue(report.audit?.records === 2, "Guest Services audit evidence is incomplete.");
      return {
        category: report.request.category,
        retrySafe: true,
        invalidPrivateAccessDenied: true,
        publicUpdates: 3,
        internalUpdatesWithheld: 2,
        auditRecords: 2
      };
    case "vendor":
      requireValue(report.application?.status === "approved" && report.profile?.status === "approved", "Vendor application and profile approval are incomplete.");
      requireValue(report.compliance?.approved === 5 && report.compliance?.required === 5 && report.compliance?.verifiedBytes > 0, "Vendor compliance proof is incomplete.");
      requireValue(report.assignment?.status === "confirmed" && report.assignment?.partnerConfirmed === true, "Vendor assignment was not confirmed.");
      requireValue(report.notices?.delivered === 3 && report.readiness?.status === "ready", "Vendor automation or final readiness is incomplete.");
      requireValue(report.audit?.records >= 10, "Vendor audit evidence is incomplete.");
      return {
        applicationApproved: true,
        profileRevision: report.profile.revision,
        complianceApproved: report.compliance.approved,
        complianceRequired: report.compliance.required,
        privateBytesVerified: report.compliance.verifiedBytes,
        noticesDelivered: report.notices.delivered,
        assignmentConfirmed: true,
        auditRecords: report.audit.records
      };
    case "sponsor":
      requireValue(report.invitation?.packageId === "tarpon", "The sponsor invitation did not retain its selected tier.");
      requireValue(report.application?.type === "sponsor" && report.application?.outreachConversion === true, "Sponsor invitation conversion is incomplete.");
      requireValue(report.review?.applicationStatus === "approved" && report.review?.profileStatus === "approved" && report.review?.assetStatus === "approved", "Sponsor application or branding approval is incomplete.");
      requireValue(report.showcase?.sponsorCount === 2 && report.showcase?.logoBytes > 0, "The approved sponsor did not reach the public showcase.");
      requireValue(report.audit?.records >= 4, "Sponsor audit evidence is incomplete.");
      return {
        packageId: report.invitation?.packageId,
        outreachConverted: true,
        applicationApproved: true,
        brandingApproved: true,
        publicSponsorsObserved: report.showcase.sponsorCount,
        publicLogoBytesVerified: report.showcase.logoBytes,
        auditRecords: report.audit.records
      };
    case "outreach":
      requireValue(report.discovery?.provider === "fixture" && report.discovery?.researchRequired === true, "Regional discovery did not preserve its research gate.");
      requireValue(report.qualification?.status === "contact_ready" && report.qualification?.nextActionScheduled === true, "The outreach prospect was not qualified and scheduled.");
      requireValue(report.campaign?.matched === 1 && report.campaign?.radiusMiles === 2 && report.campaign?.dailySendLimit === 1, "Campaign scope is not exact and bounded.");
      requireValue(report.delivery?.deliveryStatus === "delivered" && report.delivery?.sandboxAuthenticated === true, "Outreach delivery was not authenticated.");
      requireValue(report.preference?.status === "unsubscribed" && report.preference?.replayed === true, "Recipient suppression was not durable and retry safe.");
      requireValue(report.audit?.records === 7, "Outreach audit evidence is incomplete.");
      return {
        discoveryProvider: "fixture",
        researchGatePreserved: true,
        qualified: true,
        businessesMatched: 1,
        radiusMiles: 2,
        dailySendLimit: 1,
        delivered: true,
        recipientSuppressed: true,
        auditRecords: 7
      };
    case "tickets":
      requireValue(report.purchase?.status === "paid" && report.purchase?.quantity === 2 && report.purchase?.fulfillmentCount === 2, "Ticket purchase or fulfillment proof is incomplete.");
      requireValue(report.refund?.status === "refunded" && report.refund?.refundedAmountCents === report.purchase?.amountCents && report.refund?.fulfillmentRefunded === 2, "Ticket refund did not reconcile the full purchase.");
      requireValue(report.audit?.records === 1, "Ticket audit evidence is incomplete.");
      return {
        admissionsPurchased: report.purchase.quantity,
        paidAmountCents: report.purchase.amountCents,
        fulfillmentsCreated: report.purchase.fulfillmentCount,
        refundedAmountCents: report.refund.refundedAmountCents,
        fulfillmentsReversed: report.refund.fulfillmentRefunded,
        auditRecords: 1
      };
    case "operations":
      requireValue(report.accounting?.expenseStatus === "paid" && report.payment?.amountCents === 500_000, "Accounting and receivables proof is incomplete.");
      requireValue(report.delegation?.assigneeType === "volunteer" && report.keyDate?.status === "open", "Operations delegation or key-date proof is incomplete.");
      requireValue(report.deliveries?.delivered === 3, "Operations automation delivery is incomplete.");
      requireValue(report.exports?.files === 5 && report.exports?.calendarEvents === 17, "Finance and calendar export proof is incomplete.");
      requireValue(report.audit?.records === 11 && report.audit?.exports === 5, "Operations audit evidence is incomplete.");
      return {
        expensePaid: true,
        sponsorPaymentCents: report.payment.amountCents,
        volunteerTaskDelegated: true,
        keyDateCreated: true,
        messagesDelivered: report.deliveries.delivered,
        exportsParsed: report.exports.files,
        calendarEventsParsed: report.exports.calendarEvents,
        auditRecords: report.audit.records
      };
    case "delegation":
      requireValue(report.delegation?.assigneeType === "volunteer" && report.delegation?.priority === "high", "Volunteer delegation was not created as expected.");
      requireValue(report.delivery?.deliveryStatus === "delivered" && report.delivery?.sandboxAuthenticated === true && report.delivery?.privateAccessDelivered === true, "Assignment delivery is incomplete.");
      requireValue(report.portal?.acknowledged === true && report.portal?.started === true && report.portal?.blocked === true && report.portal?.completed === true && report.portal?.replayed === true, "The private assignee lifecycle is incomplete.");
      requireValue(report.audit?.records === 4, "Delegation audit evidence is incomplete.");
      return {
        assigneeType: "volunteer",
        priority: "high",
        privateAssignmentDelivered: true,
        lifecycleUpdates: report.portal.updates,
        replaySafe: true,
        auditRecords: report.audit.records
      };
    case "incident":
      requireValue(report.camera?.severity === "critical" && report.camera?.replayed === true, "The camera threshold was not retry safe.");
      requireValue(report.notice?.visible === true && report.notice?.privateProjection === true, "The public incident notice is incomplete or privacy expanding.");
      requireValue(report.dispatch?.assigneeType === "team" && report.dispatch?.assigneeName === "Traffic and parking" && report.dispatch?.status === "completed", "Incident team dispatch is incomplete.");
      requireValue(report.delivery?.provider === "brevo" && report.delivery?.sandboxAuthenticated === true && report.delivery?.recipientConcealed === true, "Incident delivery evidence is incomplete.");
      requireValue(report.recovery?.status === "monitoring" && report.recovery?.automatic === true && report.resolution?.status === "resolved", "Incident recovery and closeout are incomplete.");
      requireValue(report.audit?.records === 11 && report.audit?.private === true, "Incident audit evidence is incomplete.");
      return {
        cameraLane: report.camera.cameraId,
        severity: report.camera.severity,
        retrySafe: true,
        publicNoticePrivacySafe: true,
        dispatchCompleted: true,
        authenticatedDelivery: true,
        automaticRecovery: true,
        manuallyResolved: true,
        auditRecords: report.audit.records
      };
    case "documents":
      requireValue(report.document?.reviewTaskStatus === "done" && report.document?.extractionJobStatus === "done", "Document extraction or delegated review is incomplete.");
      requireValue(report.document?.extractedCharacterCount >= 5_000 && report.document?.extractedChunkCount >= 1, "Document extraction evidence is incomplete.");
      requireValue(/^[a-f0-9]{64}$/i.test(String(report.document?.checksumSha256 || "")), "Document download integrity was not verified.");
      requireValue(report.audit?.records >= 4, "Document audit evidence is incomplete.");
      return {
        extractionCompleted: true,
        extractedCharacters: report.document.extractedCharacterCount,
        extractedChunks: report.document.extractedChunkCount,
        delegatedReviewCompleted: true,
        checksumVerified: true,
        auditRecords: report.audit.records
      };
    default:
      throw new Error(`Unknown board capability journey: ${id}.`);
  }
}

export function certifyBoardCapabilityJourney(id, report) {
  const definition = BOARD_CAPABILITY_JOURNEYS.find(item => item.id === id);
  requireValue(definition, `Unknown board capability journey: ${id}.`);
  requireValue(report?.ok === true, `${definition.label} did not report success.`);
  exactReset(report);
  return {
    id: definition.id,
    label: definition.label,
    ok: true,
    capabilities: [...definition.capabilities],
    evidence: evidenceFor(id, report),
    reset: BOARD_CAPABILITY_READINESS
  };
}

function exactLoopbackLink(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  requireValue(url.protocol === "http:" && url.hostname === "127.0.0.1", `${label} is not an exact loopback URL.`);
  return url.toString();
}

export function certifyBoardReadinessReport(report) {
  requireValue(report?.ok === true && report.passed === 12 && report.total === 12, "Board readiness is not 12/12.");
  return {
    checkedAt: report.checkedAt,
    readiness: BOARD_CAPABILITY_READINESS,
    visitor: exactLoopbackLink(report.links?.visitor, "Visitor link"),
    operations: exactLoopbackLink(report.links?.operations, "Operations link")
  };
}

export function certifyBoardBrowserReport(report, expectedEngine) {
  requireValue(report?.ok === true && report.passed === BOARD_CAPABILITY_BROWSER_CHECKS && report.total === BOARD_CAPABILITY_BROWSER_CHECKS, `${expectedEngine} browser acceptance is not ${BOARD_CAPABILITY_BROWSER_CHECKS}/${BOARD_CAPABILITY_BROWSER_CHECKS}.`);
  requireValue(report.browserEngine === expectedEngine, `Browser acceptance used ${report.browserEngine || "an unknown engine"} instead of ${expectedEngine}.`);
  return {
    engine: expectedEngine,
    ok: true,
    passed: report.passed,
    total: report.total,
    responsive: true,
    browserErrors: 0
  };
}

export function boardCapabilityCoverage(journeys = BOARD_CAPABILITY_JOURNEYS) {
  return [...new Set(journeys.flatMap(item => item.capabilities))];
}

function exactList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateBoardCapabilityCertificate(certificate, {
  source,
  links,
  now = new Date(),
  maxAgeMs = BOARD_CAPABILITY_CERTIFICATE_MAX_AGE_MS
} = {}) {
  const errors = [];
  const expectedJourneyIds = BOARD_CAPABILITY_JOURNEYS.map(item => item.id);
  const expectedCapabilities = [
    "source_and_service_readiness",
    ...boardCapabilityCoverage(),
    "responsive_cross_browser_web"
  ];
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  const completedAtMs = validTimestamp(certificate?.completedAt);
  const startedAtMs = validTimestamp(certificate?.startedAt);

  if (!certificate || typeof certificate !== "object" || Array.isArray(certificate)) {
    errors.push("The board capability certificate is missing or malformed.");
  } else {
    if (certificate.schemaVersion !== BOARD_CAPABILITY_CERTIFICATE_SCHEMA_VERSION) {
      errors.push("The board capability certificate schema is not current.");
    }
    if (
      certificate.kind !== "sandfest_board_capability_certificate"
      || certificate.mode !== "synthetic_board_demo"
      || certificate.scope !== "full"
      || certificate.ok !== true
      || certificate.failure !== null
    ) {
      errors.push("The board capability certificate is not a successful full-scope board certificate.");
    }
    if (
      !source
      || source.branch !== "main"
      || source.dirty !== false
      || source.matchesOriginMain !== true
      || !source.commit
      || source.commit !== source.originMainCommit
    ) {
      errors.push("The active presentation source is not clean main at origin/main.");
    } else if (
      certificate.source?.branch !== source.branch
      || certificate.source?.commit !== source.commit
      || certificate.source?.originMainCommit !== source.originMainCommit
      || certificate.source?.matchesOriginMain !== true
      || certificate.source?.dirty !== false
    ) {
      errors.push("The board capability certificate does not match the active source revision.");
    }
    if (
      !links?.visitor
      || !links?.operations
      || certificate.links?.visitor !== links.visitor
      || certificate.links?.operations !== links.operations
    ) {
      errors.push("The board capability certificate does not match the active presentation links.");
    }
    if (
      certificate.readiness?.before !== BOARD_CAPABILITY_READINESS
      || certificate.readiness?.after !== BOARD_CAPABILITY_READINESS
      || certificate.readiness?.baselineRestored !== true
    ) {
      errors.push("The board capability certificate did not prove exact baseline restoration.");
    }
    if (!exactList(certificate.selectedJourneys, expectedJourneyIds)) {
      errors.push("The board capability certificate does not include every required journey.");
    }
    const journeys = Array.isArray(certificate.journeys) ? certificate.journeys : [];
    if (
      journeys.length !== BOARD_CAPABILITY_JOURNEYS.length
      || journeys.some((journey, index) => {
        const expected = BOARD_CAPABILITY_JOURNEYS[index];
        return journey?.id !== expected.id
          || journey?.label !== expected.label
          || journey?.ok !== true
          || journey?.reset !== BOARD_CAPABILITY_READINESS
          || !exactList(journey?.capabilities, expected.capabilities)
          || !journey?.evidence
          || typeof journey.evidence !== "object"
          || Array.isArray(journey.evidence)
          || Object.keys(journey.evidence).length < 2
          || !Number.isFinite(journey?.durationMs)
          || journey.durationMs < 0;
      })
    ) {
      errors.push("The board capability certificate journey evidence is incomplete.");
    }
    const browsers = Array.isArray(certificate.browsers) ? certificate.browsers : [];
    if (
      browsers.length !== 2
      || ["chromium", "webkit"].some((engine, index) => (
        browsers[index]?.engine !== engine
        || browsers[index]?.ok !== true
        || browsers[index]?.passed !== BOARD_CAPABILITY_BROWSER_CHECKS
        || browsers[index]?.total !== BOARD_CAPABILITY_BROWSER_CHECKS
        || browsers[index]?.responsive !== true
        || browsers[index]?.browserErrors !== 0
      ))
    ) {
      errors.push(`The board capability certificate does not include ${BOARD_CAPABILITY_BROWSER_CHECKS}/${BOARD_CAPABILITY_BROWSER_CHECKS} Chromium and WebKit acceptance.`);
    }
    if (!exactList(certificate.certifiedCapabilities, expectedCapabilities)) {
      errors.push("The board capability certificate coverage is incomplete.");
    }
    if (!exactList(certificate.deferredProductionGates, BOARD_CAPABILITY_DEFERRED_GATES)) {
      errors.push("The board capability certificate does not preserve the approved post-board production deferrals.");
    }
    if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      errors.push("The board capability certificate freshness policy is invalid.");
    } else if (completedAtMs === null || startedAtMs === null || startedAtMs > completedAtMs) {
      errors.push("The board capability certificate timestamps are invalid.");
    } else {
      if (completedAtMs > nowMs + BOARD_CAPABILITY_CERTIFICATE_FUTURE_TOLERANCE_MS) {
        errors.push("The board capability certificate completion time is in the future.");
      } else if (nowMs - completedAtMs > maxAgeMs) {
        errors.push("The board capability certificate is outside the allowed freshness window.");
      }
      const measuredDuration = completedAtMs - startedAtMs;
      if (
        !Number.isFinite(certificate.durationMs)
        || certificate.durationMs < 0
        || Math.abs(certificate.durationMs - measuredDuration) > 1_000
      ) {
        errors.push("The board capability certificate duration is inconsistent.");
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    completedAt: completedAtMs === null ? null : new Date(completedAtMs).toISOString(),
    ageMs: completedAtMs === null || !Number.isFinite(nowMs) ? null : Math.max(0, nowMs - completedAtMs),
    journeyCount: Array.isArray(certificate?.journeys) ? certificate.journeys.length : 0,
    browsers: Array.isArray(certificate?.browsers)
      ? certificate.browsers.map(item => ({
        engine: item?.engine || null,
        passed: Number(item?.passed || 0),
        total: Number(item?.total || 0)
      }))
      : []
  };
}

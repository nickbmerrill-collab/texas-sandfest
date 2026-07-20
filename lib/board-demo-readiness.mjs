const BOARD_WEB_MARKER = "globalThis.__SANDFEST_BOARD_ADMIN_TOKEN__";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BOARD_EMAIL_MESSAGE_ID = /^board-mail-[a-f0-9]{32}$/;
const BOARD_EMAIL_EVENT_ID = /^board_[a-f0-9]{64}$/;

export function boardDemoLoopbackUrl(value, label = "Board demo URL") {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be an absolute loopback URL.`);
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error(`${label} must use HTTP on an exact loopback host without embedded credentials.`);
  }
  return url;
}

function loopbackBase(value, label) {
  const url = boardDemoLoopbackUrl(value, label);
  if (url.search || url.hash) throw new Error(`${label} cannot include a query string or fragment.`);
  return url.toString().replace(/\/+$/, "");
}

export function boardDemoCheckEndpoints(env = {}) {
  const apiBase = loopbackBase(env.SANDFEST_BOARD_API_BASE || "http://127.0.0.1:8806", "SANDFEST_BOARD_API_BASE");
  let webUrl;
  if (env.SANDFEST_BOARD_WEB_URL) {
    webUrl = boardDemoLoopbackUrl(env.SANDFEST_BOARD_WEB_URL, "SANDFEST_BOARD_WEB_URL");
  } else {
    webUrl = boardDemoLoopbackUrl(env.SANDFEST_BOARD_PUBLIC_SITE_URL || "http://127.0.0.1:5175", "SANDFEST_BOARD_PUBLIC_SITE_URL");
    if (webUrl.search || webUrl.hash) throw new Error("SANDFEST_BOARD_PUBLIC_SITE_URL cannot include a query string or fragment.");
    webUrl.searchParams.set("apiBase", apiBase);
    webUrl.searchParams.set("mode", "visitor");
  }
  return {
    webUrl: webUrl.toString(),
    webOrigin: webUrl.origin,
    apiBase,
    emailBase: loopbackBase(env.SANDFEST_BOARD_EMAIL_BASE || "http://127.0.0.1:8807", "SANDFEST_BOARD_EMAIL_BASE"),
    smsBase: loopbackBase(env.SANDFEST_BOARD_SMS_BASE || "http://127.0.0.1:8808", "SANDFEST_BOARD_SMS_BASE")
  };
}

export function boardDemoPresentationLinks(env = {}) {
  const { webOrigin, apiBase } = boardDemoCheckEndpoints(env);
  const visitor = new URL("/", webOrigin);
  visitor.searchParams.set("apiBase", apiBase);
  visitor.searchParams.set("mode", "visitor");
  const operations = new URL("/admin.html", webOrigin);
  operations.searchParams.set("apiBase", apiBase);
  return { visitor: visitor.toString(), operations: operations.toString() };
}

function check(id, label, ok, detail, action = null) {
  return { id, label, ok: ok === true, detail, action: ok ? null : action };
}

function urlOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function hasDurableBoardEmailDelivery(item) {
  return item?.status === "sent"
    && item?.deliveryStatus === "delivered"
    && item?.provider === "brevo"
    && BOARD_EMAIL_MESSAGE_ID.test(String(item?.providerMessageId || ""))
    && Number.isFinite(Date.parse(item?.deliveredAt))
    && (Array.isArray(item?.deliveryEvents) ? item.deliveryEvents : []).some(event => (
      event?.provider === "brevo"
      && event?.type === "delivered"
      && event?.status === "delivered"
      && BOARD_EMAIL_EVENT_ID.test(String(event?.providerEventId || ""))
    ));
}

export function evaluateBoardDemoReadiness(state = {}) {
  const webReady = state.web?.ok === true && Number(state.web?.status) === 200;
  const autoSessionReady = webReady && String(state.web?.html || "").includes(BOARD_WEB_MARKER);
  const boardApiReady = state.health?.ok === true
    && state.health?.service === "sandfest-admin-api"
    && state.bootstrap?.runtime?.mode === "board_demo";
  const checkoutProducts = (Array.isArray(state.tickets?.products) ? state.tickets.products : [])
    .filter(product => product?.availableForCheckout === true);
  const ticketSandboxReady = state.health?.ticketCheckoutReady === true
    && state.health?.ticketCheckoutEnvironment === "board_sandbox"
    && state.tickets?.checkoutEnvironment === "board_sandbox"
    && checkoutProducts.length >= 4
    && !JSON.stringify(state.tickets || {}).includes("stripePriceId");
  const partnerPaymentSandboxReady = state.health?.partnerPaymentCheckoutReady === true
    && state.health?.partnerPaymentCheckoutEnvironment === "board_sandbox";
  const webOrigin = urlOrigin(state.webOrigin);
  const publicLinkOriginReady = boardApiReady
    && Boolean(webOrigin)
    && urlOrigin(state.health?.publicSiteUrl) === webOrigin;
  const automationReady = state.ready?.ok === true
    && state.ready?.checks?.workerStatus?.healthy === true
    && state.ready?.checks?.queueStatus?.operational === true
    && Number(state.ready?.checks?.queueStatus?.unhandledFailed || 0) === 0;
  const sandboxesReady = state.emailSandbox?.ok === true
    && state.emailSandbox?.service === "sandfest-board-email-sandbox"
    && state.emailSandbox?.mode === "board_demo"
    && state.smsSandbox?.ok === true
    && state.smsSandbox?.service === "sandfest-board-sms-sandbox"
    && state.smsSandbox?.mode === "board_demo";
  const partners = state.partners || {};
  const partnerSummary = partners.summary || {};
  const applicationSummary = partnerSummary.applications || {};
  const financeSummary = partnerSummary.finance || {};
  const operationsSummary = partnerSummary.operations || {};
  const outreachSummary = partnerSummary.outreach || {};
  const staffDirectory = partners.staffDirectory || {};
  const taskBoardTotals = partners.taskBoard?.totals || {};
  const vendorReadiness = partners.vendorReadiness?.totals || {};
  const fulfillment = partners.fulfillment || {};
  const tasks = Array.isArray(partners.tasks) ? partners.tasks : [];
  const milestones = Array.isArray(partners.milestones) ? partners.milestones : [];
  const followups = Array.isArray(partners.followups) ? partners.followups : [];
  const taskAssignmentTypes = new Set(tasks
    .filter(item => item?.assigneeId && item?.assigneeType !== "unassigned")
    .map(item => item.assigneeType));
  const actionableMessageStatuses = new Set(["draft", "draft_ready", "approved", "queued", "sending", "sent", "failed_retryable"]);
  const acknowledgmentMessages = followups.filter(item => item?.kind === "application_received" && actionableMessageStatuses.has(item.status));
  const taskAssignmentMessages = followups.filter(item => item?.kind === "task_assignment" && actionableMessageStatuses.has(item.status));
  const taskAssignmentPortalsReady = taskAssignmentMessages.length >= 2
    && taskAssignmentMessages.every(item => String(item?.body || "").includes("#task-status?task=") && String(item.body).includes("&token=tsft_"));
  const deliveredLocalMessages = followups.filter(hasDurableBoardEmailDelivery);
  const deliveredTransactionalMessages = deliveredLocalMessages.filter(item => item?.automationPolicy === "partner_transactional_v1");
  const deliveredCampaignMessages = deliveredLocalMessages.filter(item => item?.automationPolicy === "outreach_campaign_v1");
  const deliveredMilestoneReminders = deliveredTransactionalMessages.filter(item => item?.kind === "milestone_reminder");
  const deliveredPaymentConfirmations = deliveredTransactionalMessages.filter(item => item?.kind === "payment_received");
  const deliveredSponsorProofReviews = deliveredTransactionalMessages.filter(item => item?.kind === "sponsor_deliverable_review");
  const deliveredVendorOpenings = deliveredTransactionalMessages.filter(item => item?.kind === "vendor_applications_open");
  const reviewReadyOutreachMessages = followups.filter(item => item?.kind === "sponsor_outreach"
    && item?.status === "draft_ready"
    && !item?.automationPolicy);
  const accountingReady = Number(financeSummary.amountExpectedCents || 0) > 0
    && Number(financeSummary.amountPaidCents || 0) > 0
    && Number(financeSummary.balanceCents || 0) > 0
    && Array.isArray(partners.invoices)
    && partners.invoices.some(item => ["approved", "synced", "paid", "partial"].includes(item?.status))
    && Array.isArray(partners.payments)
    && partners.payments.some(item => ["succeeded", "partially_refunded"].includes(item?.status));
  const keyDatesReady = milestones.length >= 8
    && milestones.every(item => item?.applicationId && Number.isFinite(Date.parse(item?.dueAt)))
    && Number(operationsSummary.dueSoonMilestones || 0) >= 1;
  const reviewFirstMessagingReady = partners.automationMode === "review_first";
  const localAutomationReady = partners.automationMode === "transactional_auto"
    && partners.automation?.active === true
    && deliveredTransactionalMessages.length >= 1
    && deliveredCampaignMessages.length >= 1
    && deliveredMilestoneReminders.length >= 1
    && deliveredPaymentConfirmations.length >= 1
    && deliveredSponsorProofReviews.length >= 1
    && deliveredVendorOpenings.length >= 1
    && Number(state.emailSandbox?.callbackFailures || 0) === 0;
  const messagingReady = partners.email?.ready === true
    && partners.automation?.providerReady === true
    && (reviewFirstMessagingReady || localAutomationReady)
    && acknowledgmentMessages.length >= 5
    && taskAssignmentPortalsReady;
  const delegationReady = taskAssignmentTypes.has("staff")
    && taskAssignmentTypes.has("volunteer")
    && taskAssignmentTypes.has("team")
    && Number(taskBoardTotals.unassigned || 0) === 0;
  const sponsorFulfillmentReady = Number(fulfillment.profiles?.approved || 0) >= 1
    && Number(fulfillment.assets?.approved || 0) >= 2
    && Number(fulfillment.deliverables?.total || 0) >= 5;
  const vendorWorkflowReady = Number(vendorReadiness.ready || 0) >= 1
    && Number(vendorReadiness.blocked || 0) >= 1;
  const outreachReady = Number(outreachSummary.prospects || 0) >= 1
    && Number(outreachSummary.qualified || 0) >= 1
    && Number(outreachSummary.campaigns || 0) >= 1
    && Number(outreachSummary.draftsAwaitingReview || 0) >= 1
    && reviewReadyOutreachMessages.length >= 1
    && Number(outreachSummary.nextActionsScheduled || 0) >= 1
    && Number(outreachSummary.unassigned || 0) === 0;
  const budgetSummary = state.budget?.summary || {};
  const budgetTotals = budgetSummary.totals || {};
  const budgetCounts = budgetSummary.counts || {};
  const budgetReady = state.budget?.eventId === state.bootstrap?.guide?.id
    && state.budget?.currency === "usd"
    && Number(budgetCounts.budgetLines || 0) === 6
    && Number(budgetCounts.expenses || 0) === 7
    && Number(budgetCounts.pendingApprovals || 0) === 2
    && Number(budgetCounts.byStatus?.approved || 0) === 2
    && Number(budgetCounts.byStatus?.paid || 0) === 2
    && Number(budgetCounts.byStatus?.rejected || 0) === 1
    && Number(budgetTotals.budgetCents || 0) === 53_000_000
    && Number(budgetTotals.committedCents || 0) === 18_640_000
    && Number(budgetTotals.submittedCents || 0) === 9_200_000;
  const accountingExportsReady = state.budgetExport?.ok === true
    && Number(state.budgetExport?.status) === 200
    && String(state.budgetExport?.contentType || "").startsWith("text/csv")
    && String(state.budgetExport?.body || "").includes("Annual budget")
    && String(state.budgetExport?.body || "").includes("Remaining after pipeline")
    && state.expenseExport?.ok === true
    && Number(state.expenseExport?.status) === 200
    && String(state.expenseExport?.contentType || "").startsWith("text/csv")
    && String(state.expenseExport?.body || "").includes("Vendor or payee")
    && String(state.expenseExport?.body || "").includes("Payment reference");
  const documentSummary = state.documents?.summary || {};
  const boardBriefing = state.documents?.documents?.find(item => item?.title === "SandFest board platform briefing");
  const boardSponsor = state.sponsors?.sponsors?.find(item => item?.displayName === "Gulf Shore Credit Union");
  const sponsorBrandReady = boardSponsor?.packageName === "Marlin"
    && boardSponsor?.primaryColor === "#006B63"
    && boardSponsor?.secondaryColor === "#F4B942"
    && String(boardSponsor?.logo?.path || "").startsWith("/api/public/sponsor-showcase/assets/")
    && boardSponsor?.logo?.contentType === "image/png"
    && state.sponsorLogo?.ok === true
    && Number(state.sponsorLogo?.status) === 200
    && String(state.sponsorLogo?.contentType || "").startsWith("image/png");
  const documentsReady = Number(documentSummary.total || 0) >= 4
    && Number(documentSummary.extractionReady || 0) >= 4
    && Number(documentSummary.extractionQueued || 0) === 0
    && Number(documentSummary.extractionNeedsReview || 0) === 0
    && boardBriefing?.extractionStatus === "ready"
    && Number(boardBriefing?.extractedCharacterCount || 0) > 5_000
    && Number(boardBriefing?.extractedChunkCount || 0) > 0
    && String(boardBriefing?.textPreview || "").includes("TEXAS SANDFEST")
    && !("storageKey" in (boardBriefing || {}))
    && !("extractionChunks" in (boardBriefing || {}));
  const operationsReady = Number(applicationSummary.total || 0) >= 5
    && Number(applicationSummary.vendors || 0) >= 3
    && Number(applicationSummary.sponsors || 0) >= 2
    && staffDirectory.ready === true
    && Number(staffDirectory.routedTeams || 0) === Number(staffDirectory.totalTeams || 0)
    && Number(staffDirectory.totalTeams || 0) >= 7
    && accountingReady
    && keyDatesReady
    && messagingReady
    && delegationReady
    && sponsorFulfillmentReady
    && vendorWorkflowReady
    && outreachReady
    && budgetReady
    && accountingExportsReady
    && documentsReady
    && sponsorBrandReady
    && ticketSandboxReady
    && partnerPaymentSandboxReady;
  const weather = state.conditions?.weather || {};
  const ferry = state.conditions?.ferry || {};
  const liveCameraIds = new Set((Array.isArray(state.conditions?.cameras) ? state.conditions.cameras : [])
    .filter(camera => camera?.freshness?.state === "live"
      && ["live", "degraded"].includes(camera?.operationalStatus)
      && camera?.observation)
    .map(camera => camera.id));
  const ferryDirectionCameras = {
    "to-port-aransas": ["harbor-island-entrance", "harbor-island-stacking"],
    "to-aransas-pass": ["ferry-loading", "ferry-stacking"]
  };
  const ferryDirections = Array.isArray(ferry.directions) ? ferry.directions : [];
  const currentFerryDirectionStates = new Set(["live", "service_interruption"]);
  const officialFerryDirectionsCurrent = ferryDirections.length === 2
    && ferryDirections.every(direction => currentFerryDirectionStates.has(direction?.status));
  const ferryDirectionsCovered = ferryDirections.length === 2 && ferryDirections.every(direction => (
    currentFerryDirectionStates.has(direction?.status)
    || (ferryDirectionCameras[direction?.id] || []).some(cameraId => liveCameraIds.has(cameraId))
  ));
  const ferryCurrent = ferry.status === "live"
    || (["partial", "service_interruption"].includes(ferry.status) && ferryDirectionsCovered);
  const islandFeedsReady = weather.status === "live"
    && weather.freshness?.state === "live"
    && ferry.freshness?.state === "live"
    && ferryCurrent;
  const syntheticFeeds = weather.source === "Board weather simulation" && ferry.source === "Board ferry simulation";
  const islandFeedsDetail = syntheticFeeds
    ? "Visibly synthetic weather and ferry conditions are current and require no external network."
    : ferry.status === "live"
      ? "NWS weather and both-direction TxDOT ferry data are current."
      : officialFerryDirectionsCurrent
        ? "NWS weather and current TxDOT ferry service notices are ready."
        : "NWS weather and current TxDOT ferry data are ready; signed camera metrics cover the unavailable direction.";
  const cameraSummary = state.conditions?.summary || {};
  const cameraFleetReady = Array.isArray(state.conditions?.cameras)
    && state.conditions.cameras.length === 8
    && Number(cameraSummary.configuredCameras || 0) === 8
    && Number(cameraSummary.armedCameras || 0) === 8
    && Number(cameraSummary.liveCameras || 0) === 8
    && Number(cameraSummary.healthyPipelines || 0) === 8
    && Number(cameraSummary.offlinePipelines || 0) === 0;

  const checks = [
    check("web", "Board web", webReady, webReady ? "Loopback site is responding." : "The board site is not responding on its configured loopback URL.", "Start the configured site with npm run board:web."),
    check("auto_session", "Automatic operations session", autoSessionReady, autoSessionReady ? "The board-only local session is injected." : "The configured board URL is serving an ordinary dev session, so Operations requires manual credentials.", "Restart the configured port with npm run board:web."),
    check("api", "Isolated board API", boardApiReady, boardApiReady ? "The API identifies the synthetic board runtime." : "The API is unavailable or is not using the isolated board_demo runtime.", "Run npm run board:runtime, then npm run board:api."),
    check("public_links", "Private-link origin", publicLinkOriginReady, publicLinkOriginReady ? "Generated partner and outreach links return to this board site." : "The API public origin does not match the verified board site.", `Set SANDFEST_BOARD_PUBLIC_SITE_URL=${webOrigin || "http://127.0.0.1:5175"} before starting the API and worker.`),
    check("automation", "Worker and queue", automationReady, automationReady ? "The worker heartbeat is current and the queue has no unhandled failures." : "The worker is stale, the queue is unavailable, or an unhandled failure remains.", "Run npm run board:worker:watch and resolve any failed queue item."),
    check("sandboxes", "Local email and SMS", sandboxesReady, sandboxesReady ? "Both loopback-only provider sandboxes are ready." : "One or both local provider sandboxes are unavailable or in the wrong mode.", "Run npm run board:mailbox and npm run board:sms."),
    check("operations", "Seeded workflows", operationsReady, operationsReady ? `${applicationSummary.total} applications, ${partners.invoices.length} invoice, ${partners.payments.length} payment, local ticket and partner-invoice checkout, ${budgetCounts.budgetLines} budget allocations, ${budgetCounts.expenses} expense approvals with accounting downloads, ${checkoutProducts.length} local-checkout ticket products, ${milestones.length} key dates, staff/volunteer/team delegation, ${localAutomationReady ? `${deliveredLocalMessages.length} locally delivered messages including vendor opening, payment confirmation, and key-date follow-up` : `${followups.length} review-ready message records`}, ready and blocked vendor paths, sponsor fulfillment, and targeted outreach are ready.` : "The board runtime is missing budget approvals or accounting downloads, finance, local payment checkout, vendor opening notice, payment confirmation, due-soon key dates, automatic key-date follow-up, local messaging proof, staff/volunteer/team delegation, sponsor fulfillment, vendor readiness, outreach, governed documents, staff routes, or published sponsor branding.", "Stop the stack, rebuild it with npm run board:demo -- --reset, and rerun npm run board:check."),
    check("island_feeds", "Weather and ferry", islandFeedsReady, islandFeedsReady ? islandFeedsDetail : "A current Island Conditions source or directional camera fallback is unavailable.", "Run npm run test:live-feeds, verify the ferry camera lanes, and retry."),
    check("camera_fleet", "Eight-camera playback", cameraFleetReady, cameraFleetReady ? "All eight synthetic playback pipelines are armed, healthy, and current." : `${Number(cameraSummary.liveCameras || 0)}/8 synthetic playback pipelines are current and ${Number(cameraSummary.offlinePipelines || 0)} need attention.`, "Run npm run board:cameras and keep it running during the presentation.")
  ];

  return {
    ok: checks.every(item => item.ok),
    passed: checks.filter(item => item.ok).length,
    total: checks.length,
    checks
  };
}

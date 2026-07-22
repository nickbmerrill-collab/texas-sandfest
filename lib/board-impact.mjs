const SOURCE_LABELS = Object.freeze({
  revenue: "Revenue ledger",
  partners: "Partner operations",
  budget: "Budget control",
  volunteers: "Volunteer mirror",
  passport: "Sculpture Passport",
  voting: "People's Choice",
  booths: "Booth operations",
  documents: "Document intake"
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function count(value) {
  return Math.max(0, Math.round(number(value)));
}

function cents(value) {
  return Math.round(number(value));
}

function percent(value) {
  return Math.max(0, Math.min(100, Math.round(number(value) * 10) / 10));
}

function timestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function metric(id, label, value, unit, source, status = "tracking", context = null) {
  return {
    id,
    label,
    value: unit === "cents" ? cents(value) : unit === "percent" ? percent(value) : unit === "hours" ? Math.max(0, Math.round(number(value) * 100) / 100) : count(value),
    unit,
    status,
    source,
    context: context ? String(context).slice(0, 120) : null
  };
}

function ratioContext(current, total) {
  return `${count(current)} of ${count(total)}`;
}

function sourceRows(sourceUpdatedAt = {}) {
  return Object.entries(SOURCE_LABELS).map(([id, label]) => ({
    id,
    label,
    updatedAt: timestamp(sourceUpdatedAt[id])
  }));
}

export function buildBoardImpactSnapshot(input = {}) {
  const revenue = input.revenue || {};
  const partners = input.partners || {};
  const tasks = input.tasks || {};
  const budget = input.budget || {};
  const volunteers = input.volunteers || {};
  const passport = input.passport || {};
  const voting = input.voting || {};
  const booths = input.booths || {};
  const documents = input.documents || {};

  const revenueTotals = revenue.totals || {};
  const reconciliation = revenue.reconciliation || {};
  const ticketTotals = revenue.tickets || {};
  const applications = partners.applications || {};
  const partnerFinance = partners.finance || {};
  const fulfillment = partners.fulfillment || {};
  const brandAssets = fulfillment.assets || {};
  const deliverables = fulfillment.deliverables || {};
  const vendorReadiness = partners.vendorReadiness || {};
  const outreach = partners.outreach || {};
  const partnerOperations = partners.operations || {};
  const taskTotals = tasks.totals || {};
  const budgetTotals = budget.totals || {};
  const budgetCounts = budget.counts || {};
  const volunteerTotals = volunteers.totals || {};
  const passportTotals = passport.totals || {};
  const votingTotals = voting.totals || {};
  const boothTotals = booths.totals || {};
  const documentStatuses = documents.byStatus || {};

  const staffingNeedsAttention = count(volunteerTotals.openGaps) > 0;
  const partnerNeedsAttention = count(partnerFinance.reconciliationExceptions) > 0 || cents(partnerFinance.balanceCents) > 0;
  const deliveryNeedsAttention = count(taskTotals.blocked) > 0 || count(taskTotals.overdue) > 0 || count(partnerOperations.overdueMilestones) > 0;
  const vendorNeedsAttention = count(vendorReadiness.blocked) > 0;
  const documentNeedsAttention = count(documents.overdue) > 0 || count(documents.extractionNeedsReview) > 0;
  const budgetNeedsAttention = count(budgetCounts.overBudgetLines) > 0 || count(budgetCounts.pipelineOverBudgetLines) > 0;
  const reviewDrafts = Math.max(count(partnerOperations.draftsAwaitingReview), count(outreach.draftsAwaitingReview));
  const unknownDeliveries = Math.max(count(partnerOperations.unknownDeliveryMessages), count(outreach.unknownDeliveryMessages));
  const messageAttentionCount = reviewDrafts + unknownDeliveries;
  const messagingNeedsAttention = messageAttentionCount > 0;
  const outreachNeedsAttention = count(outreach.nextActionsOverdue) > 0;
  const attentionSignals = [staffingNeedsAttention, partnerNeedsAttention, deliveryNeedsAttention, vendorNeedsAttention, documentNeedsAttention, budgetNeedsAttention, messagingNeedsAttention, outreachNeedsAttention].filter(Boolean).length;

  const highlights = [
    metric("net_revenue", "Net revenue", revenueTotals.netCents, "cents", "revenue", "ok"),
    metric("partner_collected", "Partner funds collected", partnerFinance.amountPaidCents, "cents", "partners", cents(partnerFinance.balanceCents) > 0 ? "tracking" : "ok"),
    metric("budget_remaining", "Budget remaining", budgetTotals.remainingCents, "cents", "budget", budgetNeedsAttention ? "attention" : "ok"),
    metric("volunteer_hours", "Volunteer hours logged", volunteerTotals.totalHours, "hours", "volunteers", count(volunteerTotals.openHourLogs) > 0 ? "tracking" : "ok"),
    metric("vendors_ready", "Vendors ready", vendorReadiness.ready, "count", "partners", vendorNeedsAttention ? "attention" : "ok", ratioContext(vendorReadiness.ready, vendorReadiness.vendors)),
    metric("engagement_actions", "Engagement actions", count(passportTotals.stamps) + count(votingTotals.totalVotes), "count", "passport", "tracking", "Passport stamps and People's Choice votes")
  ];

  const sections = [
    {
      id: "revenue",
      label: "Revenue and stewardship",
      metrics: [
        metric("gross_revenue", "Gross revenue", revenueTotals.grossCents, "cents", "revenue"),
        metric("net_revenue", "Net revenue", revenueTotals.netCents, "cents", "revenue", "ok"),
        metric("reconciled", "Entries reconciled", reconciliation.pctReconciled, "percent", "revenue", percent(reconciliation.pctReconciled) === 100 ? "ok" : "attention"),
        metric("tickets_sold", "Tickets sold", ticketTotals.sold, "count", "revenue")
      ]
    },
    {
      id: "partners",
      label: "Partner revenue",
      metrics: [
        metric("applications", "Applications", applications.total, "count", "partners"),
        metric("sponsors", "Sponsors", applications.sponsors, "count", "partners"),
        metric("vendors", "Vendors", applications.vendors, "count", "partners"),
        metric("expected", "Expected", partnerFinance.amountExpectedCents, "cents", "partners"),
        metric("collected", "Collected", partnerFinance.amountPaidCents, "cents", "partners", "ok"),
        metric("outstanding", "Outstanding", partnerFinance.balanceCents, "cents", "partners", cents(partnerFinance.balanceCents) > 0 ? "attention" : "ok")
      ]
    },
    {
      id: "budget",
      label: "Accounting",
      metrics: [
        metric("annual_budget", "Annual budget", budgetTotals.budgetCents, "cents", "budget"),
        metric("committed", "Committed", budgetTotals.committedCents, "cents", "budget", budgetNeedsAttention ? "attention" : "tracking"),
        metric("paid", "Paid", budgetTotals.paidCents, "cents", "budget"),
        metric("remaining", "Remaining", budgetTotals.remainingCents, "cents", "budget", budgetNeedsAttention ? "attention" : "ok"),
        metric("pending_approvals", "Pending approvals", budgetCounts.pendingApprovals, "count", "budget", count(budgetCounts.pendingApprovals) > 0 ? "tracking" : "ok")
      ]
    },
    {
      id: "people",
      label: "Volunteer impact",
      metrics: [
        metric("volunteers", "Volunteers", volunteerTotals.volunteers, "count", "volunteers"),
        metric("confirmed", "Confirmed", volunteerTotals.confirmed, "count", "volunteers"),
        metric("checked_in", "Checked in", volunteerTotals.checkedIn, "count", "volunteers"),
        metric("hours", "Hours logged", volunteerTotals.totalHours, "hours", "volunteers", count(volunteerTotals.openHourLogs) > 0 ? "tracking" : "ok"),
        metric("shift_fill", "Shift fill", volunteerTotals.fillPct, "percent", "volunteers", staffingNeedsAttention ? "attention" : "ok"),
        metric("open_gaps", "Open staffing gaps", volunteerTotals.openGaps, "count", "volunteers", staffingNeedsAttention ? "attention" : "ok")
      ]
    },
    {
      id: "delivery",
      label: "Operational delivery",
      metrics: [
        metric("benefits_complete", "Sponsor benefits complete", deliverables.complete, "count", "partners", count(deliverables.complete) === count(deliverables.total) ? "ok" : "tracking", ratioContext(deliverables.complete, deliverables.total)),
        metric("brand_assets_approved", "Brand assets approved", brandAssets.approved, "count", "partners", count(brandAssets.awaitingReview) > 0 ? "tracking" : "ok", ratioContext(brandAssets.approved, brandAssets.total)),
        metric("vendors_ready", "Vendors ready", vendorReadiness.ready, "count", "partners", vendorNeedsAttention ? "attention" : "ok", ratioContext(vendorReadiness.ready, vendorReadiness.vendors)),
        metric("booths_assigned", "Booths assigned", boothTotals.assigned, "count", "booths", count(boothTotals.open) > 0 ? "tracking" : "ok", ratioContext(boothTotals.assigned, boothTotals.booths)),
        metric("tasks_complete", "Tasks complete", taskTotals.completed, "count", "partners", "ok", ratioContext(taskTotals.completed, taskTotals.total)),
        metric("documents_approved", "Documents approved", documentStatuses.approved, "count", "documents", documentNeedsAttention ? "attention" : "tracking", ratioContext(documentStatuses.approved, documents.total))
      ]
    },
    {
      id: "engagement",
      label: "Visitor engagement",
      metrics: [
        metric("passport_stamps", "Passport stamps", passportTotals.stamps, "count", "passport"),
        metric("passport_participants", "Passport participants", passportTotals.uniqueAttendees, "count", "passport"),
        metric("passport_finishers", "Passport finishers", passportTotals.finishers, "count", "passport"),
        metric("choice_votes", "People's Choice votes", votingTotals.totalVotes, "count", "voting"),
        metric("choice_voters", "Unique voters", votingTotals.uniqueVoters, "count", "voting"),
        metric("public_booth_pins", "Public booth pins", boothTotals.publicPins, "count", "booths")
      ]
    },
    {
      id: "outreach",
      label: "Sponsor outreach",
      metrics: [
        metric("prospects", "Prospects", outreach.prospects, "count", "partners"),
        metric("qualified", "Qualified", outreach.qualified, "count", "partners"),
        metric("won", "Won", outreach.won, "count", "partners", count(outreach.won) > 0 ? "ok" : "tracking"),
        metric("messages_sent", "Messages sent", outreach.messagesSent, "count", "partners"),
        metric("active_campaigns", "Active campaigns", outreach.activeCampaigns, "count", "partners"),
        metric("drafts_awaiting_review", "Drafts awaiting review", outreach.draftsAwaitingReview, "count", "partners", count(outreach.draftsAwaitingReview) > 0 ? "tracking" : "ok")
      ]
    },
    {
      id: "attention",
      label: "Needs attention",
      metrics: [
        metric("staffing_gaps", "Staffing gaps", volunteerTotals.openGaps, "count", "volunteers", staffingNeedsAttention ? "attention" : "ok"),
        metric("blocked_vendors", "Blocked vendors", vendorReadiness.blocked, "count", "partners", vendorNeedsAttention ? "attention" : "ok"),
        metric("blocked_tasks", "Blocked tasks", taskTotals.blocked, "count", "partners", count(taskTotals.blocked) > 0 ? "attention" : "ok"),
        metric("overdue_tasks", "Overdue tasks", taskTotals.overdue, "count", "partners", count(taskTotals.overdue) > 0 ? "attention" : "ok"),
        metric("overdue_milestones", "Overdue milestones", partnerOperations.overdueMilestones, "count", "partners", count(partnerOperations.overdueMilestones) > 0 ? "attention" : "ok"),
        metric("reconciliation_exceptions", "Reconciliation exceptions", partnerFinance.reconciliationExceptions, "count", "partners", count(partnerFinance.reconciliationExceptions) > 0 ? "attention" : "ok"),
        metric("messages_requiring_action", "Messages requiring action", messageAttentionCount, "count", "partners", messagingNeedsAttention ? "attention" : "ok", messagingNeedsAttention ? `${reviewDrafts} drafts; ${unknownDeliveries} provider checks` : null),
        metric("outreach_actions_overdue", "Outreach actions overdue", outreach.nextActionsOverdue, "count", "partners", outreachNeedsAttention ? "attention" : "ok")
      ]
    }
  ];

  return {
    schemaVersion: 1,
    eventId: String(input.eventId || "current-event").slice(0, 120),
    generatedAt: timestamp(input.generatedAt) || new Date().toISOString(),
    headline: {
      attentionSignals,
      status: attentionSignals > 0 ? "attention" : "ok"
    },
    highlights,
    sections,
    sources: sourceRows(input.sourceUpdatedAt)
  };
}

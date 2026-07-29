import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";

function commandQueuePriority(item) {
  return ({ blocked: 0, attention: 1, tracking: 2 }[item.state] ?? 9);
}

function dueDetail(value, fallback = "No due date") {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : fallback;
}

export function renderAdminCommandActionQueue({
  payload,
  outreach,
  conditions,
  conditionLabel,
  adminMoney,
  taskDueState,
  taskAssignmentType,
  prospectNextActionState
}) {
  const target = document.querySelector("#admin-command-action-queue");
  if (!target || !payload) return;
  const now = new Date();
  const applications = payload.applications || [];
  const appLabel = applicationId => {
    const application = applications.find(item => item.id === applicationId);
    return application ? `${application.organizationName} · ${application.reference}` : "Partner account";
  };
  const items = [];
  const add = item => items.push(item);

  for (const followup of payload.followups || []) {
    if (followup.status === "delivery_unknown") {
      add({ id: `followup-${followup.id}`, lane: "Delivery review", title: followup.subject || "Partner message needs verification", detail: `${appLabel(followup.applicationId)} · provider outcome needs staff proof`, href: "#admin-partner-followups-workspace", state: "blocked", at: followup.updatedAt || followup.createdAt });
    } else if (followup.status === "draft_ready" && followup.manualReviewRequiredAt) {
      add({ id: `followup-${followup.id}`, lane: "Staff approval", title: followup.subject || "Partner message awaiting review", detail: `${appLabel(followup.applicationId)} · review before delivery`, href: "#admin-partner-followups-workspace", state: "attention", at: followup.manualReviewRequiredAt || followup.createdAt });
    }
  }

  for (const task of payload.tasks || []) {
    const dueState = taskDueState(task, now);
    const unassigned = taskAssignmentType(task) === "unassigned";
    if (dueState === "overdue" || task.status === "blocked" || unassigned) {
      const owner = task.assigneeName || task.assigneeId || task.assigneeRole || "Unassigned";
      add({ id: `task-${task.id}`, lane: task.status === "blocked" ? "Blocked assignment" : dueState === "overdue" ? "Overdue assignment" : "Needs owner", title: task.title || "Staff or volunteer task", detail: `${owner} · ${dueState === "overdue" ? "due " : ""}${dueDetail(task.dueAt)}`, href: "#admin-partner-tasks-workspace", state: task.status === "blocked" || unassigned ? "blocked" : "attention", at: task.dueAt || task.updatedAt });
    }
  }

  for (const milestone of payload.milestones || []) {
    const dueState = taskDueState(milestone, now);
    if (dueState === "overdue" || dueState === "today") {
      add({ id: `milestone-${milestone.id}`, lane: dueState === "overdue" ? "Overdue key date" : "Due today", title: milestone.label || "Partner key date", detail: `${appLabel(milestone.applicationId)} · ${dueDetail(milestone.dueAt)}`, href: "#admin-partner-milestones-workspace", state: dueState === "overdue" ? "attention" : "tracking", at: milestone.dueAt });
    }
  }

  for (const account of payload.receivables?.accounts || []) {
    if (Number(account.balanceCents || 0) > 0 && (account.agingBucket === "overdue" || account.reconciliationStatus !== "current")) {
      add({ id: `receivable-${account.applicationId || account.reference}`, lane: "Receivable follow-up", title: account.organizationName || "Open partner balance", detail: `${adminMoney(account.balanceCents, "$0.00")} open · ${conditionLabel(account.agingBucket || account.reconciliationStatus)}`, href: "#admin-receivables-workspace", state: account.reconciliationStatus === "current" ? "attention" : "blocked", at: account.invoice?.dueAt || account.updatedAt });
    }
  }

  const vendorBlocked = (payload.vendorReadiness?.vendors || []).find(item => ["blocked", "missing"].includes(item.status));
  if (vendorBlocked) add({ id: `vendor-${vendorBlocked.applicationId}`, lane: "Vendor readiness", title: appLabel(vendorBlocked.applicationId), detail: `${Number(vendorBlocked.compliance?.missing || 0)} missing compliance · ${conditionLabel(vendorBlocked.assignmentStatus || "unassigned")} load-in`, href: "#admin-vendor-readiness-workspace", state: "attention", at: vendorBlocked.updatedAt });

  const sponsorNeedsProof = (payload.fulfillment?.sponsors || []).find(item => Number(item.deliverables?.needsProof || 0) > 0);
  if (sponsorNeedsProof) {
    const count = Number(sponsorNeedsProof.deliverables.needsProof || 0);
    add({ id: `sponsor-${sponsorNeedsProof.applicationId}`, lane: "Sponsor proof", title: appLabel(sponsorNeedsProof.applicationId), detail: `${count} benefit proof${count === 1 ? "" : "s"} needed`, href: "#admin-sponsor-fulfillment-workspace", state: "attention", at: sponsorNeedsProof.updatedAt });
  }

  const overdueProspect = (outreach?.prospects || []).find(prospect => prospectNextActionState(prospect, now) === "overdue");
  if (overdueProspect) add({ id: `outreach-${overdueProspect.id}`, lane: "Outreach next step", title: overdueProspect.organizationName || "Sponsor prospect", detail: `${conditionLabel(overdueProspect.ownerTeam || "sponsor")} · next action ${dueDetail(overdueProspect.nextActionAt)}`, href: "#admin-outreach-prospects-workspace", state: "attention", at: overdueProspect.nextActionAt });

  const field = conditions?.incidentSummary || {};
  if (Number(field.unassigned || 0) > 0 || Number(field.critical || 0) > 0) {
    add({ id: "field-incidents", lane: "Island operations", title: "Field incident ownership", detail: `${Number(field.critical || 0)} critical · ${Number(field.unassigned || 0)} without owner`, href: "#admin-incident-command", state: Number(field.critical || 0) > 0 ? "blocked" : "attention", at: conditions?.lastUpdated });
  }

  const ranked = items
    .sort((left, right) => commandQueuePriority(left) - commandQueuePriority(right)
      || String(left.at || "9999").localeCompare(String(right.at || "9999"))
      || String(left.title).localeCompare(String(right.title)))
    .slice(0, 5);
  target.innerHTML = ranked.length ? `<div><strong>Next actions</strong><span>${ranked.length} priority item${ranked.length === 1 ? "" : "s"} across partner, finance, staffing, outreach, and island operations</span></div><ol>${ranked.map(item => `<li data-command-action="${escapeAttr(item.id)}" data-state="${escapeAttr(item.state)}"><a href="${escapeAttr(item.href)}"><span>${escapeHtml(item.lane)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></a></li>`).join("")}</ol>` : `<div><strong>Next actions</strong><span>All tracked board workflows are current.</span></div>`;
  target.setAttribute("aria-busy", "false");
}

const WORKFLOW_PRESENTATION = Object.freeze({
  "sms.alert_fanout": ["Safety alert preparation", "Safety messaging", "#admin-consent"],
  "sms.alert.send": ["Safety message delivery", "Safety messaging", "#admin-consent"],
  "quickbooks.sync_stub": ["Accounting connectivity check", "Systems", "#admin-system-monitor"],
  "quickbooks.partner_invoice.sync": ["Invoice synchronization", "Receivables", "#admin-receivables-workspace"],
  "quickbooks.partner_invoice.reconcile": ["Invoice reconciliation", "Receivables", "#admin-receivables-workspace"],
  "document.extract": ["Private document extraction", "Document intake", "#admin-documents"],
  "partner.followup.prepare": ["Partner message preparation", "Message drafts", "#admin-partner-followups-workspace"],
  "partner.followup.send": ["Partner message delivery", "Message drafts", "#admin-partner-followups-workspace"],
  "incident.dispatch.send": ["Incident dispatch delivery", "Incident command", "#admin-incident-command"]
});

const JOB_STATUSES = new Set(["queued", "running", "done", "failed"]);

function boundedInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalInstant(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function workflowPresentation(type) {
  const [label, workspaceLabel, workspaceHref] = WORKFLOW_PRESENTATION[String(type || "")] || [
    "Background automation",
    "Systems",
    "#admin-system-monitor"
  ];
  return { label, workspaceLabel, workspaceHref };
}

export function adminJobView(job = {}) {
  const status = JOB_STATUSES.has(job.status) ? job.status : "unknown";
  const workflow = workflowPresentation(job.type);
  const failureHandledAt = optionalInstant(job.failureHandledAt);
  const requiresAcknowledgement = status === "failed" && !failureHandledAt;
  const leaseExpired = String(job.lastError || "").startsWith("Worker lease expired");
  return {
    id: String(job.id || "").slice(0, 200),
    type: String(job.type || "").slice(0, 120),
    ...workflow,
    status,
    attempts: boundedInteger(job.attempts),
    maxAttempts: boundedInteger(job.maxAttempts),
    createdAt: optionalInstant(job.createdAt),
    updatedAt: optionalInstant(job.updatedAt),
    runAfter: status === "queued" ? optionalInstant(job.runAfter) : null,
    leaseExpiresAt: status === "running" ? optionalInstant(job.leaseExpiresAt) : null,
    failureHandledAt,
    requiresAcknowledgement,
    failureSummary: status === "failed"
      ? leaseExpired
        ? "The worker stopped before completion could be confirmed. Review the owning workflow."
        : "Processing ended after the available attempts. Review the owning workflow."
      : null
  };
}

export function adminJobViews(jobs) {
  return (Array.isArray(jobs) ? jobs : []).map(adminJobView);
}

export function prioritizedAdminJobViews(recentJobs, unhandledJobs) {
  const prioritized = adminJobViews(unhandledJobs).filter(job => job.requiresAcknowledgement);
  const seen = new Set(prioritized.map(job => job.id));
  for (const job of adminJobViews(recentJobs)) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    prioritized.push(job);
  }
  return prioritized;
}

export function adminJobDisplayRows(jobs) {
  const actionable = [];
  const completed = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (job?.status !== "done") {
      actionable.push({ ...job, displayKind: "job", completedCount: 0 });
      continue;
    }
    const key = [job.label, job.workspaceLabel, job.workspaceHref].join("\u0000");
    const timestamp = optionalInstant(job.updatedAt) || optionalInstant(job.createdAt);
    const current = completed.get(key);
    if (!current) {
      completed.set(key, {
        displayKind: "completed_group",
        label: String(job.label || "Background automation").slice(0, 160),
        workspaceLabel: String(job.workspaceLabel || "Systems").slice(0, 120),
        workspaceHref: String(job.workspaceHref || "#admin-system-monitor").slice(0, 200),
        status: "done",
        completedCount: 1,
        updatedAt: timestamp
      });
      continue;
    }
    current.completedCount += 1;
    if (timestamp && (!current.updatedAt || timestamp > current.updatedAt)) current.updatedAt = timestamp;
  }
  return [...actionable, ...completed.values()].sort((left, right) => {
    if (left.displayKind !== right.displayKind) return left.displayKind === "job" ? -1 : 1;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
}

export function jobResolutionNote(value) {
  const note = String(value || "").replace(/\s+/g, " ").trim();
  if (note.length < 12) return { ok: false, error: "Add a resolution note of at least 12 characters." };
  if (note.length > 500) return { ok: false, error: "Resolution notes must be 500 characters or fewer." };
  return { ok: true, note };
}

export function validAdminJobId(value) {
  return /^job_[a-zA-Z0-9-]{8,80}$/.test(String(value || ""));
}

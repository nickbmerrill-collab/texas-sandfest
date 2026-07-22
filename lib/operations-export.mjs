import { normalizePartnerOperations, summarizePartnerReceivables } from "./partner-ops.mjs";
import { normalizeBudgetControl, summarizeBudgetControl } from "./budget-control.mjs";

const CSV_FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).replace(/\r\n?/g, "\n");
}

export function csvCell(value) {
  const raw = text(value);
  const safe = CSV_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function renderCsv(columns, rows) {
  const header = columns.map(column => csvCell(column.header)).join(",");
  const body = rows.map(row => columns.map(column => csvCell(column.value(row))).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

function money(cents) {
  const value = Number(cents);
  return Number.isFinite(value) ? (Math.round(value) / 100).toFixed(2) : "0.00";
}

function applicationIndex(doc) {
  return new Map(doc.applications.map(application => [application.id, application]));
}

function csvExport(fileName, columns, rows) {
  return {
    body: Buffer.from(renderCsv(columns, rows), "utf8"),
    contentType: "text/csv; charset=utf-8",
    fileName,
    rowCount: rows.length,
    format: "csv"
  };
}

export function partnerDirectoryExport(docInput, eventId) {
  const doc = normalizePartnerOperations(docInput);
  const rows = doc.applications.slice().sort((a, b) => String(a.organizationName).localeCompare(String(b.organizationName)));
  return csvExport(`${eventId}-partners.csv`, [
    { header: "Reference", value: row => row.reference },
    { header: "Type", value: row => row.type },
    { header: "Status", value: row => row.status },
    { header: "Organization", value: row => row.organizationName },
    { header: "Contact name", value: row => row.contactName },
    { header: "Contact email", value: row => row.contactEmail },
    { header: "Contact phone", value: row => row.contactPhone },
    { header: "Website", value: row => row.website },
    { header: "City", value: row => row.city },
    { header: "State", value: row => row.state },
    { header: "Postal code", value: row => row.postalCode },
    { header: "Category", value: row => row.category },
    { header: "Offering / package", value: row => row.offeringName || row.packageName },
    { header: "Expected amount", value: row => money(row.expectedAmountCents || row.requestedAmountCents) },
    { header: "Owner ID", value: row => row.ownerId },
    { header: "Source", value: row => row.source },
    { header: "Created at", value: row => row.createdAt },
    { header: "Updated at", value: row => row.updatedAt }
  ], rows);
}

export function receivablesExport(docInput, eventId, now = new Date().toISOString()) {
  const summary = summarizePartnerReceivables(docInput, now);
  return csvExport(`${eventId}-receivables.csv`, [
    { header: "Reference", value: row => row.reference },
    { header: "Organization", value: row => row.organizationName },
    { header: "Type", value: row => row.type },
    { header: "Application status", value: row => row.applicationStatus },
    { header: "Expected amount", value: row => money(row.expectedAmountCents) },
    { header: "Collected amount", value: row => money(row.paidAmountCents) },
    { header: "Outstanding amount", value: row => money(row.balanceCents) },
    { header: "Credit amount", value: row => money(row.creditCents) },
    { header: "Unapplied amount", value: row => money(row.unappliedAmountCents) },
    { header: "Invoice ID", value: row => row.invoice?.id },
    { header: "Invoice status", value: row => row.invoice?.status },
    { header: "Invoice due at", value: row => row.invoice?.dueAt },
    { header: "Invoice balance", value: row => money(row.invoice?.balanceCents) },
    { header: "Days overdue", value: row => row.daysOverdue },
    { header: "Aging bucket", value: row => row.agingBucket },
    { header: "Reconciliation status", value: row => row.reconciliationStatus },
    { header: "QuickBooks document", value: row => row.invoice?.quickBooksDocNumber },
    { header: "QuickBooks balance", value: row => row.invoice?.quickBooksBalanceCents === null || row.invoice?.quickBooksBalanceCents === undefined ? "" : money(row.invoice.quickBooksBalanceCents) }
  ], summary.accounts);
}

export function paymentsExport(docInput, eventId) {
  const doc = normalizePartnerOperations(docInput);
  const applications = applicationIndex(doc);
  const rows = doc.payments.slice().sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  return csvExport(`${eventId}-partner-payments.csv`, [
    { header: "Payment ID", value: row => row.id },
    { header: "Partner reference", value: row => applications.get(row.applicationId)?.reference },
    { header: "Organization", value: row => applications.get(row.applicationId)?.organizationName },
    { header: "Invoice ID", value: row => row.invoiceId },
    { header: "Amount", value: row => money(row.amountCents) },
    { header: "Applied amount", value: row => money(row.appliedAmountCents) },
    { header: "Unapplied amount", value: row => money(row.unappliedAmountCents) },
    { header: "Refunded amount", value: row => money(row.refundedAmountCents) },
    { header: "Method", value: row => row.method },
    { header: "Status", value: row => row.status },
    { header: "Reconciliation status", value: row => row.reconciliationStatus },
    { header: "External reference", value: row => row.externalRef },
    { header: "Provider event ID", value: row => row.providerEventId },
    { header: "Payment intent ID", value: row => row.paymentIntentId },
    { header: "Received at", value: row => row.receivedAt },
    { header: "Recorded by", value: row => row.createdBy },
    { header: "Reversed at", value: row => row.reversedAt },
    { header: "Reversal reason", value: row => row.reversalReason }
  ], rows);
}

function currentEventBudget(docInput, eventId) {
  const doc = normalizeBudgetControl(docInput, { eventId });
  const budgetLines = doc.budgetLines.filter(line => line.eventId === eventId);
  const lineIds = new Set(budgetLines.map(line => line.id));
  return {
    ...doc,
    eventId,
    budgetLines,
    expenses: doc.expenses.filter(expense => expense.eventId === eventId && lineIds.has(expense.budgetLineId))
  };
}

export function budgetAllocationsExport(docInput, eventId) {
  const doc = currentEventBudget(docInput, eventId);
  const rows = summarizeBudgetControl(doc).lines
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return csvExport(`${eventId}-budget-allocations.csv`, [
    { header: "Budget line ID", value: row => row.id },
    { header: "Allocation", value: row => row.name },
    { header: "Owner team", value: row => row.ownerTeam },
    { header: "Annual budget", value: row => money(row.budgetCents) },
    { header: "Awaiting approval", value: row => money(row.submittedCents) },
    { header: "Approved", value: row => money(row.approvedCents) },
    { header: "Paid", value: row => money(row.paidCents) },
    { header: "Committed", value: row => money(row.committedCents) },
    { header: "Forecast", value: row => money(row.forecastCents) },
    { header: "Remaining after commitments", value: row => money(row.remainingCents) },
    { header: "Remaining after pipeline", value: row => money(row.remainingAfterPipelineCents) },
    { header: "Expense count", value: row => row.expenseCount },
    { header: "Active", value: row => row.active },
    { header: "Over committed budget", value: row => row.overBudget },
    { header: "Pipeline over budget", value: row => row.pipelineOverBudget },
    { header: "Notes", value: row => row.notes },
    { header: "Last change note", value: row => row.lastChangeNote },
    { header: "Created at", value: row => row.createdAt },
    { header: "Updated at", value: row => row.updatedAt }
  ], rows);
}

export function expenseRegisterExport(docInput, eventId) {
  const doc = currentEventBudget(docInput, eventId);
  const lines = new Map(doc.budgetLines.map(line => [line.id, line]));
  const rows = doc.expenses
    .slice()
    .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"))
      || String(a.vendorName).localeCompare(String(b.vendorName)));
  return csvExport(`${eventId}-expense-register.csv`, [
    { header: "Expense ID", value: row => row.id },
    { header: "Allocation", value: row => lines.get(row.budgetLineId)?.name },
    { header: "Owner team", value: row => lines.get(row.budgetLineId)?.ownerTeam },
    { header: "Vendor or payee", value: row => row.vendorName },
    { header: "Description", value: row => row.description },
    { header: "Amount", value: row => money(row.amountCents) },
    { header: "Due date", value: row => row.dueDate },
    { header: "Status", value: row => row.status },
    { header: "Requested by", value: row => row.requestedBy },
    { header: "Submitted at", value: row => row.submittedAt },
    { header: "Approved by", value: row => row.approvedBy },
    { header: "Approved at", value: row => row.approvedAt },
    { header: "Rejected by", value: row => row.rejectedBy },
    { header: "Rejected at", value: row => row.rejectedAt },
    { header: "Paid by", value: row => row.paidBy },
    { header: "Paid at", value: row => row.paidAt },
    { header: "Payment method", value: row => row.paymentMethod },
    { header: "Payment reference", value: row => row.paymentReference },
    { header: "Voided by", value: row => row.voidedBy },
    { header: "Voided at", value: row => row.voidedAt },
    { header: "Over-budget override", value: row => row.overBudgetOverride },
    { header: "Resolution note", value: row => row.resolutionNote },
    { header: "Created at", value: row => row.createdAt },
    { header: "Updated at", value: row => row.updatedAt }
  ], rows);
}

export function tasksExport(docInput, eventId) {
  const doc = normalizePartnerOperations(docInput);
  const rows = doc.tasks
    .map(task => {
      const notification = doc.followups
        .filter(item => item.taskId === task.id)
        .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] ?? null;
      return {
        ...task,
        notificationStatus: notification?.deliveryStatus || notification?.status || (task.assigneeType === "unassigned" ? "not_configured" : "awaiting_directory"),
        notificationKind: notification?.kind || null,
        notificationUpdatedAt: notification?.updatedAt || notification?.createdAt || null
      };
    })
    .sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")));
  return csvExport(`${eventId}-staff-volunteer-tasks.csv`, [
    { header: "Task ID", value: row => row.id },
    { header: "Task", value: row => row.title },
    { header: "Description", value: row => row.description },
    { header: "Status", value: row => row.status },
    { header: "Priority", value: row => row.priority },
    { header: "Assignment type", value: row => row.assigneeType },
    { header: "Assignee ID", value: row => row.assigneeId },
    { header: "Assignee name", value: row => row.assigneeName },
    { header: "Assignee role", value: row => row.assigneeRole },
    { header: "Related type", value: row => row.relatedEntityType },
    { header: "Related ID", value: row => row.relatedEntityId },
    { header: "Due at", value: row => row.dueAt },
    { header: "Notification status", value: row => row.notificationStatus },
    { header: "Notification kind", value: row => row.notificationKind },
    { header: "Notification updated at", value: row => row.notificationUpdatedAt },
    { header: "Created at", value: row => row.createdAt },
    { header: "Updated at", value: row => row.updatedAt },
    { header: "Completed at", value: row => row.completedAt }
  ], rows);
}

export function outreachProspectsExport(docInput, eventId) {
  const doc = normalizePartnerOperations(docInput);
  const rows = doc.prospects.slice().sort((a, b) => String(a.organizationName).localeCompare(String(b.organizationName)));
  return csvExport(`${eventId}-sponsor-outreach.csv`, [
    { header: "Prospect ID", value: row => row.id },
    { header: "Organization", value: row => row.organizationName },
    { header: "Industry", value: row => row.industry },
    { header: "Website", value: row => row.website },
    { header: "City", value: row => row.city },
    { header: "State", value: row => row.state },
    { header: "Postal code", value: row => row.postalCode },
    { header: "Latitude", value: row => row.latitude },
    { header: "Longitude", value: row => row.longitude },
    { header: "Contact name", value: row => row.contactName },
    { header: "Contact email", value: row => row.contactEmail },
    { header: "Status", value: row => row.status },
    { header: "Fit score", value: row => row.fitScore },
    { header: "Distance miles", value: row => row.distanceMiles },
    { header: "Community fit", value: row => row.communityFit },
    { header: "Contact basis", value: row => row.contactBasis },
    { header: "Owner ID", value: row => row.ownerId },
    { header: "Next action", value: row => row.nextAction },
    { header: "Next action due at", value: row => row.nextActionAt },
    { header: "Suppressed at", value: row => row.suppressedAt },
    { header: "Suppression reason", value: row => row.suppressionReason },
    { header: "Source", value: row => row.source },
    { header: "Source batch", value: row => row.sourceBatch },
    { header: "Updated at", value: row => row.updatedAt }
  ], rows);
}

function impactMetricValue(metric) {
  if (metric.unit === "cents") return money(metric.value);
  if (metric.unit === "hours") return number(metric.value).toFixed(2);
  if (metric.unit === "percent") return number(metric.value).toFixed(1);
  return String(Math.round(number(metric.value)));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function impactReportExport(snapshot, eventId) {
  const sourceUpdatedAt = new Map((snapshot?.sources || []).map(source => [source.id, source.updatedAt || ""]));
  const rows = (snapshot?.sections || []).flatMap(section => (section.metrics || []).map(metric => ({
    section: section.label,
    metric: metric.label,
    value: impactMetricValue(metric),
    unit: metric.unit,
    status: metric.status,
    context: metric.context || "",
    sourceUpdatedAt: sourceUpdatedAt.get(metric.source) || "",
    generatedAt: snapshot?.generatedAt || ""
  })));
  return csvExport(`${eventId}-board-impact.csv`, [
    { header: "Section", value: row => row.section },
    { header: "Metric", value: row => row.metric },
    { header: "Value", value: row => row.value },
    { header: "Unit", value: row => row.unit },
    { header: "Status", value: row => row.status },
    { header: "Context", value: row => row.context },
    { header: "Source updated at", value: row => row.sourceUpdatedAt },
    { header: "Report generated at", value: row => row.generatedAt }
  ], rows);
}

function icsText(value) {
  return text(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function icsTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line) {
  const segments = [];
  let segment = "";
  for (const character of line) {
    const limit = segments.length === 0 ? 75 : 74;
    if (segment && Buffer.byteLength(segment + character, "utf8") > limit) {
      segments.push(segment);
      segment = character;
    } else {
      segment += character;
    }
  }
  if (segment || !segments.length) segments.push(segment);
  return segments.map((value, index) => index === 0 ? value : ` ${value}`).join("\r\n");
}

export function milestonesCalendarExport(docInput, eventId, generatedAt = new Date().toISOString()) {
  const doc = normalizePartnerOperations(docInput);
  const applications = applicationIndex(doc);
  const stamp = icsTimestamp(generatedAt) || icsTimestamp(new Date());
  const milestones = doc.milestones
    .filter(item => icsTimestamp(item.dueAt))
    .slice()
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Texas SandFest//Partner Operations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`Texas SandFest ${eventId.match(/(\d{4})$/)?.[1] || ""} Partner Key Dates`.trim())}`
  ];
  for (const item of milestones) {
    const application = applications.get(item.applicationId);
    const organization = application?.organizationName || "Unassigned partner";
    const due = icsTimestamp(item.dueAt);
    const description = `${organization} | ${item.status || "open"} | ${item.assigneeTeam || "operations"} | reminder ${Number(item.reminderLeadDays || 0)} day(s) before`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(`${item.id}@texassandfest.org`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${due}`,
      `SUMMARY:${icsText(`${organization}: ${item.label || "Partner key date"}`)}`,
      `DESCRIPTION:${icsText(description)}`,
      `CATEGORIES:${icsText(item.assigneeTeam || "operations")}`,
      `STATUS:${item.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      `SEQUENCE:${Math.max(0, Number(item.scheduleVersion || 1) - 1)}`
    );
    if (item.status === "completed" && icsTimestamp(item.completedAt)) lines.push(`COMPLETED:${icsTimestamp(item.completedAt)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return {
    body: Buffer.from(`${lines.map(foldIcsLine).join("\r\n")}\r\n`, "utf8"),
    contentType: "text/calendar; charset=utf-8",
    fileName: `${eventId}-partner-key-dates.ics`,
    rowCount: milestones.length,
    format: "ics"
  };
}

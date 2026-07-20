const EXPENSE_STATUSES = ["submitted", "approved", "rejected", "paid", "voided"];
const PAYMENT_METHODS = ["ramp", "ach", "check", "card", "cash", "other"];
const MAX_BUDGET_CENTS = 1_000_000_000;
const MAX_EXPENSE_CENTS = 500_000_000;

function clean(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cents(value, { max = MAX_BUDGET_CENTS } = {}) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= max ? amount : null;
}

function dateOnly(value) {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text;
}

function instant(value, fallback = null) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function failure(error, code = "INVALID_INPUT") {
  return { ok: false, error, code };
}

function statusCounts(expenses) {
  return Object.fromEntries(EXPENSE_STATUSES.map(status => [
    status,
    expenses.filter(expense => expense.status === status).length
  ]));
}

export function emptyBudgetControl(eventId) {
  return {
    _note: "Operational budget control. QuickBooks remains the accounting source of truth.",
    eventId,
    currency: "usd",
    lastUpdated: null,
    budgetLines: [],
    expenses: []
  };
}

export function normalizeBudgetControl(raw, { eventId = null } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const resolvedEventId = clean(source.eventId || eventId, 100) || null;
  const budgetLines = (Array.isArray(source.budgetLines) ? source.budgetLines : []).map(line => ({
    id: clean(line.id, 120),
    eventId: clean(line.eventId || resolvedEventId, 100) || null,
    name: clean(line.name, 140),
    ownerTeam: clean(line.ownerTeam, 100),
    budgetCents: Math.max(0, Math.round(Number(line.budgetCents) || 0)),
    notes: clean(line.notes, 500),
    active: line.active !== false,
    createdBy: clean(line.createdBy, 180) || null,
    lastChangedBy: clean(line.lastChangedBy, 180) || null,
    lastChangeNote: clean(line.lastChangeNote, 500) || null,
    createdAt: instant(line.createdAt),
    updatedAt: instant(line.updatedAt)
  })).filter(line => line.id && line.name && line.budgetCents > 0);
  const lineIds = new Set(budgetLines.map(line => line.id));
  const expenses = (Array.isArray(source.expenses) ? source.expenses : []).map(expense => ({
    id: clean(expense.id, 120),
    eventId: clean(expense.eventId || resolvedEventId, 100) || null,
    budgetLineId: clean(expense.budgetLineId, 120),
    vendorName: clean(expense.vendorName, 180),
    description: clean(expense.description, 500),
    amountCents: Math.max(0, Math.round(Number(expense.amountCents) || 0)),
    dueDate: dateOnly(expense.dueDate),
    status: EXPENSE_STATUSES.includes(expense.status) ? expense.status : "submitted",
    requestedBy: clean(expense.requestedBy, 180) || null,
    submittedAt: instant(expense.submittedAt),
    approvedAt: instant(expense.approvedAt),
    approvedBy: clean(expense.approvedBy, 180) || null,
    rejectedAt: instant(expense.rejectedAt),
    rejectedBy: clean(expense.rejectedBy, 180) || null,
    paidAt: instant(expense.paidAt),
    paidBy: clean(expense.paidBy, 180) || null,
    voidedAt: instant(expense.voidedAt),
    voidedBy: clean(expense.voidedBy, 180) || null,
    resolutionNote: clean(expense.resolutionNote, 500) || null,
    paymentMethod: PAYMENT_METHODS.includes(expense.paymentMethod) ? expense.paymentMethod : null,
    paymentReference: clean(expense.paymentReference, 180) || null,
    overBudgetOverride: expense.overBudgetOverride === true,
    createdAt: instant(expense.createdAt),
    updatedAt: instant(expense.updatedAt)
  })).filter(expense => expense.id && lineIds.has(expense.budgetLineId) && expense.amountCents > 0);
  return {
    _note: clean(source._note, 500) || "Operational budget control. QuickBooks remains the accounting source of truth.",
    eventId: resolvedEventId,
    currency: "usd",
    lastUpdated: instant(source.lastUpdated),
    budgetLines,
    expenses
  };
}

export function summarizeBudgetControl(raw) {
  const doc = normalizeBudgetControl(raw, { eventId: raw?.eventId });
  const lines = doc.budgetLines.map(line => {
    const expenses = doc.expenses.filter(expense => expense.budgetLineId === line.id);
    const submittedCents = expenses.filter(expense => expense.status === "submitted").reduce((sum, expense) => sum + expense.amountCents, 0);
    const approvedCents = expenses.filter(expense => expense.status === "approved").reduce((sum, expense) => sum + expense.amountCents, 0);
    const paidCents = expenses.filter(expense => expense.status === "paid").reduce((sum, expense) => sum + expense.amountCents, 0);
    const committedCents = approvedCents + paidCents;
    const forecastCents = submittedCents + committedCents;
    return {
      ...line,
      submittedCents,
      approvedCents,
      paidCents,
      committedCents,
      forecastCents,
      remainingCents: line.budgetCents - committedCents,
      remainingAfterPipelineCents: line.budgetCents - forecastCents,
      overBudget: committedCents > line.budgetCents,
      pipelineOverBudget: forecastCents > line.budgetCents,
      expenseCount: expenses.length
    };
  });
  const total = field => lines.reduce((sum, line) => sum + line[field], 0);
  const totals = {
    budgetCents: total("budgetCents"),
    submittedCents: total("submittedCents"),
    approvedCents: total("approvedCents"),
    paidCents: total("paidCents"),
    committedCents: total("committedCents"),
    forecastCents: total("forecastCents")
  };
  totals.remainingCents = totals.budgetCents - totals.committedCents;
  totals.remainingAfterPipelineCents = totals.budgetCents - totals.forecastCents;
  totals.committedPct = totals.budgetCents ? Math.round((totals.committedCents / totals.budgetCents) * 1000) / 10 : 0;
  return {
    eventId: doc.eventId,
    currency: doc.currency,
    lastUpdated: doc.lastUpdated,
    totals,
    counts: {
      budgetLines: lines.length,
      activeBudgetLines: lines.filter(line => line.active).length,
      expenses: doc.expenses.length,
      pendingApprovals: doc.expenses.filter(expense => expense.status === "submitted").length,
      overBudgetLines: lines.filter(line => line.overBudget).length,
      pipelineOverBudgetLines: lines.filter(line => line.pipelineOverBudget).length,
      byStatus: statusCounts(doc.expenses)
    },
    lines
  };
}

export function createBudgetLine(raw, input, { actorId = "unknown", idFactory, now = new Date().toISOString() } = {}) {
  const doc = normalizeBudgetControl(raw, { eventId: raw?.eventId });
  const name = clean(input?.name, 140);
  const ownerTeam = clean(input?.ownerTeam, 100);
  const budgetCents = cents(input?.budgetCents);
  if (!doc.eventId) return failure("Budget control requires a current event.");
  if (name.length < 3) return failure("Budget line name must contain at least 3 characters.");
  if (ownerTeam.length < 2) return failure("Choose an accountable owner team.");
  if (!budgetCents) return failure("Budget amount must be a positive whole-cent value no greater than $10,000,000.");
  if (doc.budgetLines.some(line => line.active && line.name.toLowerCase() === name.toLowerCase())) {
    return failure("An active budget line already uses that name.", "DUPLICATE_BUDGET_LINE");
  }
  const at = instant(now, new Date().toISOString());
  const line = {
    id: clean(idFactory?.("budget_line") || `budget_line_${Date.now()}`, 120),
    eventId: doc.eventId,
    name,
    ownerTeam,
    budgetCents,
    notes: clean(input?.notes, 500),
    active: true,
    createdBy: clean(actorId, 180),
    createdAt: at,
    updatedAt: at
  };
  return {
    ok: true,
    line,
    doc: { ...doc, lastUpdated: at, budgetLines: [...doc.budgetLines, line] }
  };
}

export function updateBudgetLine(raw, lineId, input, { actorId = "unknown", now = new Date().toISOString() } = {}) {
  const doc = normalizeBudgetControl(raw, { eventId: raw?.eventId });
  const index = doc.budgetLines.findIndex(line => line.id === lineId);
  if (index < 0) return failure("Budget line not found.", "NOT_FOUND");
  const current = doc.budgetLines[index];
  const nextAmount = Object.hasOwn(input || {}, "budgetCents") ? cents(input.budgetCents) : current.budgetCents;
  if (!nextAmount) return failure("Budget amount must be a positive whole-cent value no greater than $10,000,000.");
  const amountChanged = nextAmount !== current.budgetCents;
  const changeNote = clean(input?.changeNote, 500);
  if (amountChanged && changeNote.length < 12) return failure("Budget amount changes require a note of at least 12 characters.");
  const name = Object.hasOwn(input || {}, "name") ? clean(input.name, 140) : current.name;
  const ownerTeam = Object.hasOwn(input || {}, "ownerTeam") ? clean(input.ownerTeam, 100) : current.ownerTeam;
  const active = Object.hasOwn(input || {}, "active") ? input.active !== false : current.active;
  if (name.length < 3 || ownerTeam.length < 2) return failure("Budget line name and owner team are required.");
  if (active && doc.budgetLines.some((line, lineIndex) => lineIndex !== index && line.active && line.name.toLowerCase() === name.toLowerCase())) {
    return failure("An active budget line already uses that name.", "DUPLICATE_BUDGET_LINE");
  }
  const at = instant(now, new Date().toISOString());
  const line = {
    ...current,
    name,
    ownerTeam,
    budgetCents: nextAmount,
    notes: Object.hasOwn(input || {}, "notes") ? clean(input.notes, 500) : current.notes,
    active,
    lastChangedBy: clean(actorId, 180),
    lastChangeNote: amountChanged ? changeNote : current.lastChangeNote || null,
    updatedAt: at
  };
  const budgetLines = doc.budgetLines.slice();
  budgetLines[index] = line;
  return { ok: true, before: current, line, doc: { ...doc, lastUpdated: at, budgetLines } };
}

export function createExpenseRequest(raw, input, { actorId = "unknown", idFactory, now = new Date().toISOString() } = {}) {
  const doc = normalizeBudgetControl(raw, { eventId: raw?.eventId });
  const line = doc.budgetLines.find(item => item.id === clean(input?.budgetLineId, 120) && item.active);
  if (!line) return failure("Choose an active budget line.");
  const vendorName = clean(input?.vendorName, 180);
  const description = clean(input?.description, 500);
  const amountCents = cents(input?.amountCents, { max: MAX_EXPENSE_CENTS });
  const dueDate = dateOnly(input?.dueDate);
  if (vendorName.length < 2) return failure("Vendor or payee name must contain at least 2 characters.");
  if (description.length < 8) return failure("Expense description must contain at least 8 characters.");
  if (!amountCents) return failure("Expense amount must be a positive whole-cent value no greater than $5,000,000.");
  if (!dueDate) return failure("Expense due date must be a valid calendar date.");
  const at = instant(now, new Date().toISOString());
  const expense = {
    id: clean(idFactory?.("expense") || `expense_${Date.now()}`, 120),
    eventId: doc.eventId,
    budgetLineId: line.id,
    vendorName,
    description,
    amountCents,
    dueDate,
    status: "submitted",
    requestedBy: clean(actorId, 180),
    submittedAt: at,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    paidAt: null,
    paidBy: null,
    voidedAt: null,
    voidedBy: null,
    resolutionNote: null,
    paymentMethod: null,
    paymentReference: null,
    overBudgetOverride: false,
    createdAt: at,
    updatedAt: at
  };
  return { ok: true, expense, doc: { ...doc, lastUpdated: at, expenses: [...doc.expenses, expense] } };
}

export function transitionExpense(raw, expenseId, action, input = {}, { actorId = "unknown", now = new Date().toISOString() } = {}) {
  const doc = normalizeBudgetControl(raw, { eventId: raw?.eventId });
  const index = doc.expenses.findIndex(expense => expense.id === expenseId);
  if (index < 0) return failure("Expense request not found.", "NOT_FOUND");
  const current = doc.expenses[index];
  const line = doc.budgetLines.find(item => item.id === current.budgetLineId);
  if (!line) return failure("The expense budget line no longer exists.", "INVALID_STATE");
  const at = instant(now, new Date().toISOString());
  const actor = clean(actorId, 180);
  const note = clean(input.note, 500);
  let expense;
  let overBudgetOverride = false;

  if (action === "approve") {
    if (current.status !== "submitted") return failure("Only submitted expenses can be approved.", "INVALID_TRANSITION");
    const committed = doc.expenses
      .filter(item => item.id !== current.id && item.budgetLineId === line.id && ["approved", "paid"].includes(item.status))
      .reduce((sum, item) => sum + item.amountCents, 0);
    const exceedsBudget = committed + current.amountCents > line.budgetCents;
    if (exceedsBudget && input.allowOverBudget !== true) {
      return failure("Approval would exceed this budget line. Confirm an over-budget override and add a resolution note.", "OVER_BUDGET");
    }
    if (exceedsBudget && note.length < 12) return failure("Over-budget approval requires a note of at least 12 characters.");
    overBudgetOverride = exceedsBudget;
    expense = {
      ...current,
      status: "approved",
      approvedAt: at,
      approvedBy: actor,
      resolutionNote: note || null,
      overBudgetOverride,
      updatedAt: at
    };
  } else if (action === "reject") {
    if (current.status !== "submitted") return failure("Only submitted expenses can be rejected.", "INVALID_TRANSITION");
    if (note.length < 12) return failure("Rejection requires a note of at least 12 characters.");
    expense = { ...current, status: "rejected", rejectedAt: at, rejectedBy: actor, resolutionNote: note, updatedAt: at };
  } else if (action === "mark_paid") {
    if (current.status !== "approved") return failure("Only approved expenses can be marked paid.", "INVALID_TRANSITION");
    const paymentMethod = clean(input.paymentMethod, 40).toLowerCase();
    const paymentReference = clean(input.paymentReference, 180);
    const paidAt = input.paidAt == null || input.paidAt === "" ? at : instant(input.paidAt);
    if (!PAYMENT_METHODS.includes(paymentMethod)) return failure("Choose a supported payment method.");
    if (paymentReference.length < 3) return failure("Payment reference must contain at least 3 characters.");
    if (!paidAt) return failure("Payment date must be a valid timestamp.");
    expense = {
      ...current,
      status: "paid",
      paidAt,
      paidBy: actor,
      paymentMethod,
      paymentReference,
      resolutionNote: note || current.resolutionNote,
      updatedAt: at
    };
  } else if (action === "void") {
    if (!["submitted", "approved"].includes(current.status)) return failure("Only submitted or approved expenses can be voided.", "INVALID_TRANSITION");
    if (note.length < 12) return failure("Void action requires a note of at least 12 characters.");
    expense = { ...current, status: "voided", voidedAt: at, voidedBy: actor, resolutionNote: note, updatedAt: at };
  } else {
    return failure("Choose approve, reject, mark_paid, or void.");
  }

  const expenses = doc.expenses.slice();
  expenses[index] = expense;
  return {
    ok: true,
    before: clone(current),
    expense,
    overBudgetOverride,
    doc: { ...doc, lastUpdated: at, expenses }
  };
}

export const BUDGET_PAYMENT_METHODS = PAYMENT_METHODS;
export const BUDGET_EXPENSE_STATUSES = EXPENSE_STATUSES;

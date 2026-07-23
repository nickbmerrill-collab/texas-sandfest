import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";
import { submitCreation } from "./admin-creation.js";

const panelMarkup = `
  <div class="admin-budget-panel" id="admin-budget">
    <div class="editor-heading admin-budget-heading">
      <div>
        <p class="eyebrow">Budget control</p>
        <h2>Plan, approve, and track festival spend</h2>
      </div>
      <button id="admin-load-budget" class="button secondary" data-requires-permission="budget:read" type="button">Refresh budget</button>
    </div>
    <p id="admin-budget-updated" class="admin-revenue-updated">Operational commitments and payment evidence stay visible here; QuickBooks remains the post-board accounting source of truth.</p>
    <div id="admin-budget-kpis" class="admin-revenue-kpis">
      <article class="empty-state"><span>No budget loaded.</span></article>
    </div>
    <div class="admin-budget-workspace">
      <section aria-labelledby="admin-budget-lines-title">
        <div class="admin-task-board-heading">
          <strong id="admin-budget-lines-title">Budget by owner</strong>
          <span id="admin-budget-line-summary">No allocations loaded.</span>
        </div>
        <div id="admin-budget-lines" class="admin-budget-list keyboard-scroll-region" role="region" aria-label="Budget allocations by owner" tabindex="0">
          <article class="empty-state"><span>No budget allocations loaded.</span></article>
        </div>
      </section>
      <section aria-labelledby="admin-expenses-title">
        <div class="admin-task-board-heading">
          <strong id="admin-expenses-title">Expense approvals</strong>
          <span id="admin-expense-summary">No requests loaded.</span>
        </div>
        <div id="admin-expense-list" class="admin-budget-list keyboard-scroll-region" role="region" aria-label="Expense approval queue" tabindex="0">
          <article class="empty-state"><span>No expense requests loaded.</span></article>
        </div>
      </section>
    </div>
    <div class="admin-budget-create">
      <form id="admin-create-budget-line" class="admin-inline-form" data-requires-permission="budget:write">
        <strong>Add budget allocation</strong>
        <label><span>Name</span><input name="name" required maxlength="140" placeholder="Beach infrastructure" /></label>
        <label><span>Owner team</span><select name="ownerTeam" required><option value="production">Production</option><option value="operations">Operations</option><option value="traffic">Traffic and parking</option><option value="guest-services">Guest services</option><option value="sponsor">Sponsor</option><option value="finance">Finance</option><option value="volunteer-captains">Volunteer captains</option></select></label>
        <label><span>Annual amount</span><input name="amount" type="number" min="0.01" max="10000000" step="0.01" required /></label>
        <label><span>Notes</span><input name="notes" maxlength="500" placeholder="What this allocation covers" /></label>
        <button class="button secondary" type="submit">Add allocation</button>
        <p class="partner-form-status admin-finance-form-status" data-finance-create-status role="status" aria-live="polite"></p>
      </form>
      <form id="admin-create-expense" class="admin-inline-form" data-requires-permission="budget:write">
        <strong>Submit expense request</strong>
        <label><span>Budget line</span><select name="budgetLineId" required><option value="">Load active allocations</option></select></label>
        <label><span>Vendor or payee</span><input name="vendorName" required maxlength="180" /></label>
        <label><span>Amount</span><input name="amount" type="number" min="0.01" max="5000000" step="0.01" required /></label>
        <label><span>Due date</span><input name="dueDate" type="date" required /></label>
        <label class="admin-import-wide"><span>Description</span><input name="description" required minlength="8" maxlength="500" /></label>
        <button class="button primary" type="submit">Submit for approval</button>
        <p class="partner-form-status admin-finance-form-status" data-finance-create-status role="status" aria-live="polite"></p>
      </form>
    </div>
  </div>`;

function label(value) {
  return String(value || "unknown").replace(/[-_]/g, " ");
}

function paymentLabel(method) {
  return method === "ach" ? "ACH" : label(method);
}

function inputCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function createAdminBudgetUi({
  adminCan,
  adminFetch,
  adminMoney,
  getAdminSessionState,
  renderAdminSession,
  requestOutcomeIsAmbiguous,
  revenueKpiCard,
  setAdminStatus
}) {
  let mounted = false;
  const creationDeps = { adminFetch, loadAdminPartners: options => load(options), requestOutcomeIsAmbiguous, setAdminStatus };

  function lineById(payload, lineId) {
    return (payload?.summary?.lines || []).find(line => line.id === lineId)
      || (payload?.budgetLines || []).find(line => line.id === lineId)
      || null;
  }

  function lineCard(line) {
    const forecast = Math.max(0, Number(line.forecastCents || 0));
    const ratio = line.budgetCents ? Math.min(100, Math.round((forecast / line.budgetCents) * 100)) : 0;
    const state = line.overBudget ? "over" : line.pipelineOverBudget ? "risk" : "ok";
    const controls = adminCan("budget:write") ? `
      <form class="admin-budget-line-actions" data-budget-line-update>
        <label><span>Annual amount</span><input name="amount" type="number" min="0.01" max="10000000" step="0.01" value="${escapeAttr((Number(line.budgetCents || 0) / 100).toFixed(2))}" required /></label>
        <label class="admin-check"><input name="active" type="checkbox" ${line.active ? "checked" : ""} /><span>Active allocation</span></label>
        <label class="admin-budget-action-note"><span>Change note</span><input name="changeNote" maxlength="500" placeholder="Required when amount changes" /></label>
        <button class="button secondary" type="submit">Save allocation</button>
      </form>` : "";
    return `
      <article data-budget-line="${escapeAttr(line.id)}" data-budget-state="${state}">
        <header><div><strong>${escapeHtml(line.name)}</strong><span>${escapeHtml(label(line.ownerTeam))}</span></div><b>${escapeHtml(adminMoney(line.budgetCents))}</b></header>
        <progress max="100" value="${ratio}" aria-label="${escapeAttr(`${line.name} forecast use`)}">${ratio}%</progress>
        <div class="admin-budget-line-values">
          <span><b>${escapeHtml(adminMoney(line.committedCents))}</b> committed</span>
          <span><b>${escapeHtml(adminMoney(line.submittedCents))}</b> awaiting approval</span>
          <span><b>${escapeHtml(adminMoney(line.remainingAfterPipelineCents))}</b> after pipeline</span>
        </div>
        ${controls}
      </article>`;
  }

  function expenseActions(expense, line) {
    if (!adminCan("budget:write")) return "";
    if (expense.status === "submitted") {
      const wouldExceed = Number(expense.amountCents || 0) > Number(line?.remainingCents || 0);
      return `
        <div class="admin-budget-expense-actions">
          <label class="admin-budget-action-note"><span>Resolution note</span><input data-expense-note maxlength="500" placeholder="Required for rejection${wouldExceed ? " or override" : ""}" /></label>
          ${wouldExceed ? `<label class="admin-check"><input data-expense-over-budget type="checkbox" /><span>Authorize over-budget commitment</span></label>` : ""}
          <div><button class="button primary" data-expense-action="approve" type="button">Approve</button><button class="button secondary" data-expense-action="reject" type="button">Reject</button></div>
        </div>`;
    }
    if (expense.status === "approved") {
      return `
        <div class="admin-budget-expense-actions">
          <label><span>Payment method</span><select data-expense-payment-method><option value="ramp">Ramp</option><option value="ach">ACH</option><option value="check">Check</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
          <label><span>Payment reference</span><input data-expense-payment-reference maxlength="180" placeholder="Provider or check reference" /></label>
          <label class="admin-budget-action-note"><span>Void note</span><input data-expense-note maxlength="500" placeholder="Required only when voiding" /></label>
          <div><button class="button primary" data-expense-action="mark-paid" type="button">Mark paid</button><button class="button secondary" data-expense-action="void" type="button">Void</button></div>
        </div>`;
    }
    return "";
  }

  function expenseCard(expense, payload) {
    const line = lineById(payload, expense.budgetLineId);
    const detail = [line?.name, expense.dueDate ? `due ${new Date(`${expense.dueDate}T12:00:00`).toLocaleDateString()}` : null].filter(Boolean).join(" · ");
    return `
      <article data-budget-expense="${escapeAttr(expense.id)}" data-expense-status="${escapeAttr(expense.status)}">
        <header><div><strong>${escapeHtml(expense.vendorName)}</strong><span>${escapeHtml(detail || "Unassigned budget line")}</span></div><b>${escapeHtml(adminMoney(expense.amountCents))}</b></header>
        <p>${escapeHtml(expense.description)}</p>
        <div class="admin-budget-expense-status"><span>${escapeHtml(label(expense.status))}</span>${expense.overBudgetOverride ? "<b>Budget override recorded</b>" : ""}${expense.paymentMethod ? `<b>${escapeHtml(paymentLabel(expense.paymentMethod))} payment recorded</b>` : ""}</div>
        ${expense.resolutionNote ? `<small>${escapeHtml(expense.resolutionNote)}</small>` : ""}
        ${expenseActions(expense, line)}
      </article>`;
  }

  function bindLineActions() {
    document.querySelectorAll("[data-budget-line] [data-budget-line-update]").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const card = form.closest("[data-budget-line]");
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const result = await adminFetch(`/api/admin/budget/lines/${encodeURIComponent(card.dataset.budgetLine)}`, {
            method: "PATCH",
            body: JSON.stringify({
              budgetCents: inputCents(form.elements.amount.value),
              active: form.elements.active.checked,
              changeNote: form.elements.changeNote.value
            })
          });
          await load({ quiet: true });
          setAdminStatus(`Updated ${result.line.name} to ${adminMoney(result.line.budgetCents)}.`, "ok");
        } catch (error) {
          setAdminStatus(error.message, "error");
          button.disabled = !adminCan("budget:write");
        }
      });
    });
  }

  function bindExpenseActions() {
    document.querySelectorAll("[data-budget-expense] [data-expense-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const card = button.closest("[data-budget-expense]");
        const action = button.dataset.expenseAction;
        const body = {
          note: card.querySelector("[data-expense-note]")?.value || "",
          allowOverBudget: card.querySelector("[data-expense-over-budget]")?.checked === true,
          paymentMethod: card.querySelector("[data-expense-payment-method]")?.value,
          paymentReference: card.querySelector("[data-expense-payment-reference]")?.value || ""
        };
        card.querySelectorAll("button, input, select").forEach(control => { control.disabled = true; });
        try {
          await adminFetch(`/api/admin/budget/expenses/${encodeURIComponent(card.dataset.budgetExpense)}/${action}`, {
            method: "POST",
            body: JSON.stringify(body)
          });
          await load({ quiet: true });
          setAdminStatus(`Expense ${action.replace(/-/g, " ")} recorded.`, "ok");
        } catch (error) {
          setAdminStatus(error.message, "error");
          card.querySelectorAll("button, input, select").forEach(control => { control.disabled = !adminCan("budget:write"); });
        }
      });
    });
  }

  function render(payload) {
    const summary = payload.summary;
    const totals = summary?.totals || {};
    const counts = summary?.counts || {};
    const kpis = document.querySelector("#admin-budget-kpis");
    const updated = document.querySelector("#admin-budget-updated");
    const lines = document.querySelector("#admin-budget-lines");
    const expenses = document.querySelector("#admin-expense-list");
    const lineSummary = document.querySelector("#admin-budget-line-summary");
    const expenseSummary = document.querySelector("#admin-expense-summary");
    const lineSelect = document.querySelector("#admin-create-expense select[name=budgetLineId]");
    if (!kpis || !summary || !lines || !expenses) return;
    kpis.innerHTML = [
      revenueKpiCard("Annual budget", adminMoney(totals.budgetCents || 0), `${counts.activeBudgetLines || 0} active allocations`),
      revenueKpiCard("Committed", adminMoney(totals.committedCents || 0), `${totals.committedPct || 0}% of budget`),
      revenueKpiCard("Paid", adminMoney(totals.paidCents || 0), `${counts.byStatus?.paid || 0} payments recorded`),
      revenueKpiCard("Awaiting approval", adminMoney(totals.submittedCents || 0), `${counts.pendingApprovals || 0} requests`),
      revenueKpiCard("Available", adminMoney(totals.remainingCents || 0), "after approved commitments"),
      revenueKpiCard("Pipeline balance", adminMoney(totals.remainingAfterPipelineCents || 0), counts.pipelineOverBudgetLines ? `${counts.pipelineOverBudgetLines} allocation${counts.pipelineOverBudgetLines === 1 ? "" : "s"} at risk` : "No allocation over forecast")
    ].join("");
    lines.innerHTML = (summary.lines || []).map(lineCard).join("") || '<article class="empty-state"><span>No budget allocations loaded.</span></article>';
    expenses.innerHTML = (payload.expenses || []).map(expense => expenseCard(expense, payload)).join("") || '<article class="empty-state"><span>No expense requests loaded.</span></article>';
    if (lineSummary) lineSummary.textContent = `${counts.activeBudgetLines || 0} active · ${counts.overBudgetLines || 0} over committed budget`;
    if (expenseSummary) expenseSummary.textContent = `${counts.pendingApprovals || 0} awaiting approval · ${counts.byStatus?.approved || 0} approved · ${counts.byStatus?.paid || 0} paid`;
    if (updated) updated.textContent = `${payload.eventId || "Current event"} · ${payload.lastUpdated ? `updated ${new Date(payload.lastUpdated).toLocaleString()} · ` : ""}Operational control only; QuickBooks synchronization remains separate.`;
    if (lineSelect) {
      const previous = lineSelect.value;
      lineSelect.innerHTML = (payload.budgetLines || []).filter(line => line.active).map(line => `<option value="${escapeAttr(line.id)}">${escapeHtml(line.name)} · ${escapeHtml(adminMoney(line.budgetCents))}</option>`).join("") || '<option value="">No active allocation</option>';
      if ([...lineSelect.options].some(option => option.value === previous)) lineSelect.value = previous;
    }
    bindLineActions();
    bindExpenseActions();
    const session = getAdminSessionState();
    if (session) renderAdminSession(session);
  }

  async function load({ quiet = false } = {}) {
    mount();
    const button = document.querySelector("#admin-load-budget");
    if (button) button.disabled = true;
    try {
      const data = await adminFetch("/api/admin/budget");
      render(data);
      if (!quiet) setAdminStatus(`Loaded budget control: ${adminMoney(data.summary.totals.committedCents)} committed with ${data.summary.counts.pendingApprovals} awaiting approval.`, "ok");
      return data;
    } catch (error) {
      if (!quiet) setAdminStatus(error.message, "error");
      throw error;
    } finally {
      if (button) button.disabled = !adminCan("budget:read");
    }
  }

  function bindStaticActions() {
    document.querySelector("#admin-load-budget")?.addEventListener("click", () => load());
    document.querySelector("#admin-create-budget-line")?.addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = {
        name: form.elements.name.value,
        ownerTeam: form.elements.ownerTeam.value,
        budgetCents: inputCents(form.elements.amount.value),
        notes: form.elements.notes.value
      };
      void submitCreation(form, "/api/admin/budget/lines", body, "Try the same allocation again; Finance will record it only once.", result => `Added ${result.line.name} at ${adminMoney(result.line.budgetCents)}.`, creationDeps, undefined, () => !adminCan("budget:write"));
    });
    document.querySelector("#admin-create-expense")?.addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = {
        budgetLineId: form.elements.budgetLineId.value,
        vendorName: form.elements.vendorName.value,
        description: form.elements.description.value,
        amountCents: inputCents(form.elements.amount.value),
        dueDate: form.elements.dueDate.value
      };
      const selectedLine = form.elements.budgetLineId.value;
      void submitCreation(form, "/api/admin/budget/expenses", body, "Try the same expense again; Finance will record it only once.", result => `Submitted ${adminMoney(result.expense.amountCents)} for ${result.expense.vendorName}.`, creationDeps, () => {
        form.elements.dueDate.value = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        if ([...form.elements.budgetLineId.options].some(option => option.value === selectedLine)) form.elements.budgetLineId.value = selectedLine;
      }, () => !adminCan("budget:write"));
    });
    const dueDate = document.querySelector("#admin-create-expense input[name=dueDate]");
    if (dueDate && !dueDate.value) dueDate.value = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  }

  function mount() {
    if (mounted) return;
    const target = document.querySelector("#admin-budget-module");
    if (!target) return;
    target.outerHTML = panelMarkup;
    mounted = true;
    bindStaticActions();
  }

  return { load, mount, render };
}

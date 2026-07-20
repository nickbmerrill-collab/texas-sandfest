import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";
import { REQUIRED_TICKET_POLICY_NOTICES } from "../lib/ticket-policy-schema.mjs";

const PENDING_NOTICE_STATUSES = new Set(["pending", "draft_ready", "approved", "queued", "sending"]);

export function taskAssignmentNoticeAction(task, assignmentType, assignmentNotice) {
  const pending = PENDING_NOTICE_STATUSES.has(assignmentNotice?.status);
  return {
    disabled: !["open", "in_progress", "blocked"].includes(task.status) || assignmentType === "unassigned" || pending,
    label: pending ? "Notice pending" : assignmentNotice ? "Resend notice" : "Send notice"
  };
}

export function bindTaskAssignmentNoticeActions(tasks, { adminFetch, loadAdminPartners, setAdminStatus }) {
  tasks.querySelectorAll("[data-resend-task]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const requestId = globalThis.crypto?.randomUUID?.() || `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await adminFetch(`/api/admin/partners/tasks/${encodeURIComponent(button.dataset.resendTask)}/assignment-notice`, {
        method: "POST",
        body: JSON.stringify({ requestId })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(result.replay ? "Assignment notice was already queued." : "Assignment notice queued.", "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }));
}

export function ticketPolicyEditorMarkup() {
  return `
    <form id="admin-ticket-policy-form" class="admin-ticket-policy" aria-labelledby="admin-ticket-policy-heading">
      <header class="admin-edit-title">
        <div><strong id="admin-ticket-policy-heading">Checkout policies</strong><span id="admin-ticket-policy-updated">Not loaded</span></div>
        <b id="admin-ticket-policy-state" data-state="pending">Pending</b>
      </header>
      <label><span>Policy version</span><input name="version" maxlength="80" autocomplete="off" /></label>
      <label><span>Customer acknowledgement</span><textarea name="acknowledgment" rows="3" maxlength="500"></textarea></label>
      <div id="admin-ticket-policy-notices" class="admin-ticket-policy-notices"></div>
      <div class="admin-edit-actions">
        <span id="admin-ticket-policy-readiness">Load the ticket catalog to review policy readiness.</span>
        <div>
          <button class="button secondary" type="button" data-save-ticket-policy="save_draft" data-requires-permission="ticket:write">Save draft</button>
          <button class="button primary" type="button" data-save-ticket-policy="approve" data-requires-permission="ticket:write">Approve policy</button>
        </div>
      </div>
      <p id="admin-ticket-policy-status" class="partner-form-status" role="status" aria-live="polite"></p>
    </form>
  `;
}

export function renderTicketPolicyEditor(configState) {
  const form = document.querySelector("#admin-ticket-policy-form");
  if (!form) return;
  const policy = configState?.tickets?.checkoutPolicy || {};
  const readiness = configState?.ticketPolicyReadiness || {
    ready: false,
    errors: ["Ticket policy readiness has not been checked."]
  };
  const noticeById = new Map((policy.notices || []).map(item => [item.id, item]));
  form.elements.version.value = policy.version || "";
  form.elements.acknowledgment.value = policy.acknowledgment || "";
  document.querySelector("#admin-ticket-policy-notices").innerHTML = REQUIRED_TICKET_POLICY_NOTICES.map(required => `
    <label data-admin-ticket-policy-notice="${escapeAttr(required.id)}">
      <span>${escapeHtml(required.label)}</span>
      <textarea name="notice_${escapeAttr(required.id)}" rows="3" maxlength="2000">${escapeHtml(noticeById.get(required.id)?.summary || "")}</textarea>
    </label>
  `).join("");
  const state = document.querySelector("#admin-ticket-policy-state");
  state.textContent = readiness.ready ? "Approved" : policy.status === "draft" ? "Draft" : "Pending";
  state.dataset.state = readiness.ready ? "ok" : "pending";
  document.querySelector("#admin-ticket-policy-updated").textContent = policy.updatedAt
    ? `${readiness.ready ? "Approved" : "Updated"} ${new Date(policy.updatedAt).toLocaleString()}`
    : "Not yet saved";
  document.querySelector("#admin-ticket-policy-readiness").textContent = readiness.ready
    ? `Version ${policy.version} is approved for checkout.`
    : readiness.errors?.join(" ") || "Policy approval is required before checkout.";
}

export function bindTicketPolicyEditor({
  adminFetch,
  getConfigState,
  getSessionState,
  loadDeployment,
  renderSession,
  setFormStatus
}) {
  document.querySelectorAll("[data-save-ticket-policy]").forEach(button => {
    if (button.dataset.ticketPolicyBound === "true") return;
    button.dataset.ticketPolicyBound = "true";
    button.addEventListener("click", async () => {
      const form = document.querySelector("#admin-ticket-policy-form");
      const status = document.querySelector("#admin-ticket-policy-status");
      const payload = {
        action: button.dataset.saveTicketPolicy,
        version: form.elements.version.value,
        acknowledgment: form.elements.acknowledgment.value,
        notices: REQUIRED_TICKET_POLICY_NOTICES.map(required => ({
          id: required.id,
          summary: form.elements[`notice_${required.id}`].value
        }))
      };
      const buttons = form.querySelectorAll("[data-save-ticket-policy]");
      buttons.forEach(item => { item.disabled = true; });
      setFormStatus(status, payload.action === "approve" ? "Validating and approving ticket policies..." : "Saving ticket policy draft...", "loading");
      try {
        const result = await adminFetch("/api/admin/ticket-policy", {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        const configState = getConfigState();
        configState.tickets.checkoutPolicy = result.policy;
        configState.ticketPolicyReadiness = result.readiness;
        renderTicketPolicyEditor(configState);
        const sessionState = getSessionState();
        if (sessionState) renderSession(sessionState);
        setFormStatus(status, result.readiness.ready
          ? `Ticket policy ${result.policy.version} approved. Checkout now requires this exact acknowledgement.`
          : "Ticket policy draft saved. Approval is still required before checkout.", "ok");
        await loadDeployment();
      } catch (error) {
        setFormStatus(status, error.message, "error");
      } finally {
        buttons.forEach(item => { item.disabled = false; });
      }
    });
  });
}

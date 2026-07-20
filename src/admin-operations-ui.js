import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";
import { REQUIRED_TICKET_POLICY_NOTICES } from "../lib/ticket-policy-schema.mjs";

const PENDING_NOTICE_STATUSES = new Set(["pending", "draft_ready", "approved", "queued", "sending"]);

export function taskAssignmentNoticeAction(task, assignmentType, assignmentSummary) {
  const pending = PENDING_NOTICE_STATUSES.has(assignmentSummary?.latestStatus);
  return {
    disabled: !["open", "in_progress", "blocked"].includes(task.status) || assignmentType === "unassigned" || pending,
    label: pending ? "Notice pending" : assignmentSummary?.count ? "Resend notice" : "Send notice"
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

export function draftEditor(item) {
  if (item.status !== "draft_ready") return "";
  return `<details class="admin-followup-editor admin-dispatch-message">
    <summary class="button secondary">Edit draft</summary>
    <input aria-label="Message subject" maxlength="180" value="${escapeAttr(item.subject || "")}" />
    <textarea aria-label="Message body" maxlength="7500" rows="7">${escapeHtml(item.body || "")}</textarea>
    <button type="button" class="button primary" data-save-draft="${escapeAttr(item.id)}" value="${escapeAttr(item.updatedAt || "")}">Save changes</button>
  </details>`;
}

export function bindDraftEditors(followups, { adminFetch, loadAdminPartners, setAdminStatus }) {
  for (const button of followups.querySelectorAll("[data-save-draft]")) button.onclick = async () => {
    const editor = button.parentNode;
    button.disabled = true;
    try {
      await adminFetch(`/api/admin/partners/followups/${encodeURIComponent(button.dataset.saveDraft)}/draft`, {
        method: "PATCH",
        body: JSON.stringify({
          subject: editor.querySelector('input[aria-label="Message subject"]').value,
          body: editor.querySelector('textarea[aria-label="Message body"]').value,
          expectedUpdatedAt: button.value
        })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus("Draft saved; approval still required.", "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
}

export function followupAutomationLabel(item) {
  if (item.manualReviewRequiredAt) return "staff review required";
  if (item.automationPolicy === "outreach_campaign_v1") return "campaign-approved automation";
  if (!item.automationPolicy) return "";
  return {
    payment_received: "automatic payment confirmation",
    payment_adjustment: "automatic payment adjustment",
    sponsor_brand_changes: "automatic sponsor brand review",
    sponsor_deliverable_review: "automatic sponsor proof review",
    milestone_reminder: "automatic key-date reminder"
  }[item.kind] || "transactional automation";
}

export function applicationDecisionStatusMessage(result) {
  if (result.decisionNotice?.requiresManualReview) {
    return "Application status saved. The decision message requires staff review.";
  }
  if (result.decisionNotice) {
    return "Application status saved. The approval message is ready for review or transactional automation.";
  }
  return result.dismissedDecisionNotices
    ? "Application status saved. The stale decision message was removed."
    : "Application status saved.";
}

export function incidentDispatchAssignmentOptions(directory, assigneeType) {
  if (assigneeType === "team") {
    const teams = Array.isArray(directory?.teams) ? directory.teams : [];
    return teams.length
      ? teams.map(team => `<option value="${escapeAttr(team.id)}" data-name="${escapeAttr(team.name)}">${escapeHtml(team.name)}${team.notificationReady ? " · email routed" : " · assignment only"}</option>`).join("")
      : '<option value="">No teams available</option>';
  }
  if (assigneeType === "volunteer") {
    const volunteers = (Array.isArray(directory?.volunteers) ? directory.volunteers : [])
      .filter(volunteer => !["no_show", "withdrawn", "inactive"].includes(volunteer.status));
    return volunteers.length
      ? volunteers.map(volunteer => `<option value="${escapeAttr(volunteer.id)}" data-name="${escapeAttr(volunteer.name)}">${escapeHtml(volunteer.name)}${volunteer.emailAvailable ? " · email on file" : " · no email"}</option>`).join("")
      : '<option value="">No available volunteers</option>';
  }
  if (assigneeType === "staff") {
    const staff = (Array.isArray(directory?.staff) ? directory.staff : [])
      .filter(item => ["active", "on_call"].includes(item.status));
    return staff.length
      ? staff.map(item => `<option value="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}">${escapeHtml(item.name)}${item.emailAvailable ? " · email on file" : " · assignment only"}</option>`).join("")
      : '<option value="">No active staff available</option>';
  }
  return '<option value="">No assignments available</option>';
}

export function incidentDispatchMarkup(dispatch, incident, payload, canWrite, conditionLabel) {
  const notification = dispatch.notification || {};
  const statusOptions = ["assigned", "acknowledged", "en_route", "on_scene", "completed", "canceled"];
  const outcomeUnknown = notification.deliveryOutcomeUnknown === true;
  const canReview = canWrite && notification.status === "draft_ready";
  const canDismiss = canWrite && !outcomeUnknown && ["draft_ready", "approved", "failed"].includes(notification.status);
  const canSend = canWrite && !outcomeUnknown && ["approved", "failed"].includes(notification.status) && payload.email?.ready;
  const deliveryResolution = notification.deliveryResolution
    ? `<span data-delivery-resolution-slot="${escapeAttr(dispatch.id)}"></span>`
    : "";
  const reconciliation = outcomeUnknown
    ? `<span data-reconcile-dispatch-slot data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}"></span>`
    : "";
  const emailDraft = notification.channel === "email" ? `
    <div class="admin-dispatch-message" data-dispatch-message>
      <div><strong>Operational email</strong><span data-status="${escapeAttr(notification.status)}">${escapeHtml(conditionLabel(notification.status || "not_requested"))} · version ${notification.version || 1}</span></div>
      <label><span>Subject</span><input name="subject" maxlength="998" value="${escapeAttr(notification.subject || "")}" ${["queued", "sending", "sent", "canceled"].includes(notification.status) ? "disabled" : ""} /></label>
      <label><span>Message</span><textarea name="body" rows="5" maxlength="10000" ${["queued", "sending", "sent", "canceled"].includes(notification.status) ? "disabled" : ""}>${escapeHtml(notification.body || "")}</textarea></label>
      ${notification.lastError ? `<p class="admin-delivery-error">${escapeHtml(notification.lastError)}</p>` : ""}
      ${deliveryResolution}
      ${reconciliation}
      <div class="admin-dispatch-message-actions">
        ${canReview ? `<button class="button secondary" type="button" data-review-dispatch="approve" data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}">Approve draft</button>` : ""}
        ${canDismiss ? `<button class="button secondary" type="button" data-review-dispatch="dismiss" data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}">Dismiss draft</button>` : ""}
        ${!outcomeUnknown && ["approved", "failed"].includes(notification.status) ? `<button class="button primary" type="button" data-send-dispatch data-incident-id="${escapeAttr(incident.id)}" data-dispatch-id="${escapeAttr(dispatch.id)}" ${canSend ? "" : "disabled"}>Queue email</button>` : ""}
        ${!outcomeUnknown && ["approved", "failed"].includes(notification.status) && !payload.email?.ready ? "<span>Transactional email is not configured.</span>" : ""}
        ${notification.sentAt ? `<span>Sent ${escapeHtml(new Date(notification.sentAt).toLocaleString())}${notification.provider ? ` via ${escapeHtml(notification.provider)}` : ""}</span>` : ""}
      </div>
    </div>` : "";
  return `
    <div class="admin-dispatch-row" data-dispatch-control="${escapeAttr(dispatch.id)}">
      <div class="admin-dispatch-heading">
        <div><strong>${escapeHtml(dispatch.title)}</strong><span>${escapeHtml(dispatch.assigneeName)} · ${escapeHtml(conditionLabel(dispatch.assigneeType))}${dispatch.assigneeRole ? ` · ${escapeHtml(dispatch.assigneeRole)}` : ""}</span></div>
        <b data-status="${escapeAttr(dispatch.status)}">${escapeHtml(conditionLabel(dispatch.status))}</b>
      </div>
      <p>${escapeHtml(dispatch.instructions || "No additional instructions.")}</p>
      <div class="admin-dispatch-controls">
        <label><span>Status</span><select name="dispatchStatus" ${canWrite ? "" : "disabled"}>${statusOptions.map(value => `<option value="${value}" ${dispatch.status === value ? "selected" : ""}>${escapeHtml(conditionLabel(value))}</option>`).join("")}</select></label>
        <label><span>Closeout or update note</span><input name="dispatchNote" maxlength="1000" ${canWrite ? "" : "disabled"} /></label>
        <button class="button secondary" type="button" data-save-dispatch="${escapeAttr(dispatch.id)}" data-incident-id="${escapeAttr(incident.id)}" ${canWrite ? "" : "disabled"}>Save dispatch</button>
      </div>
      ${emailDraft}
    </div>`;
}

export function incidentDispatchCreateMarkup(incident, payload, canWrite) {
  if (!["open", "acknowledged", "responding", "monitoring"].includes(incident.status)) return "";
  return `
    <form class="admin-dispatch-create" data-create-dispatch="${escapeAttr(incident.id)}">
      <div class="admin-dispatch-section-heading"><strong>New dispatch</strong><span>Assign a responder and optionally prepare an email for review.</span></div>
      <label><span>Assignment</span><select name="assigneeType" ${canWrite ? "" : "disabled"}><option value="team">Team</option><option value="volunteer">Volunteer</option><option value="staff">Staff</option></select></label>
      <label data-dispatch-assignee-field><span>Assignee</span><select name="assigneeId" ${canWrite ? "" : "disabled"}>${incidentDispatchAssignmentOptions(payload.assignmentDirectory, "team")}</select></label>
      <label><span>Notification</span><select name="channel" ${canWrite ? "" : "disabled"}><option value="none">Assignment only</option><option value="email">Prepare email draft</option></select></label>
      <label class="admin-dispatch-wide"><span>Assignment title</span><input name="title" maxlength="180" placeholder="Respond to ${escapeAttr(incident.title)}" ${canWrite ? "" : "disabled"} /></label>
      <label class="admin-dispatch-wide"><span>Instructions</span><textarea name="instructions" rows="2" maxlength="2000" ${canWrite ? "" : "disabled"}></textarea></label>
      <label><span>Due</span><input name="dueAt" type="datetime-local" ${canWrite ? "" : "disabled"} /></label>
      <button class="button primary" type="submit" ${canWrite ? "" : "disabled"}>Create dispatch</button>
    </form>`;
}

export function bindApplicationStatusActions(applications, { adminFetch, loadAdminPartners, setAdminStatus }) {
  for (const button of applications.querySelectorAll("[data-save-application]")) button.onclick = async () => {
    const card = button.closest("[data-partner-application]");
    button.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(button.dataset.saveApplication)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: card.querySelector('[name="status"]').value })
      });
      await loadAdminPartners({ quiet: true });
      setAdminStatus(applicationDecisionStatusMessage(result), "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
}

export function bindPartnerPortalActions(applications, {
  adminFetch,
  apiBase,
  boardDemoEnabled,
  loadAdminPartners,
  setAdminStatus,
  writeClipboardText
}) {
  async function createFreshAccess(applicationId) {
    const result = await adminFetch(`/api/admin/partners/applications/${encodeURIComponent(applicationId)}/portal-access`, {
      method: "POST",
      body: "{}"
    });
    let url = result.portalAccess.url;
    if (boardDemoEnabled) {
      const boardUrl = new URL(url);
      boardUrl.searchParams.set("apiBase", apiBase);
      url = boardUrl.toString();
    }
    return { ...result, portalAccess: { ...result.portalAccess, url } };
  }

  for (const button of applications.querySelectorAll("[data-open-demo-portal]")) button.onclick = async () => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setAdminStatus("The partner portal window could not be opened.", "error");
      return;
    }
    popup.opener = null;
    button.disabled = true;
    try {
      const result = await createFreshAccess(button.dataset.openDemoPortal);
      popup.location.replace(result.portalAccess.url);
      await loadAdminPartners({ quiet: true });
      setAdminStatus(`Opened a fresh private demo portal for ${result.application.reference}. The previous link no longer works.`, "ok");
    } catch (error) {
      if (!popup.closed) popup.close();
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };

  for (const button of applications.querySelectorAll("[data-rotate-portal]")) button.onclick = async () => {
    button.disabled = true;
    try {
      const result = await createFreshAccess(button.dataset.rotatePortal);
      const copied = await writeClipboardText(result.portalAccess.url);
      await loadAdminPartners({ quiet: true });
      setAdminStatus(copied
        ? `A new private portal link for ${result.application.reference} is on the clipboard. The previous link no longer works.`
        : boardDemoEnabled
          ? `A new private portal link for ${result.application.reference} was created, but the browser blocked clipboard access. Use Open demo portal to continue.`
          : `A new private portal link for ${result.application.reference} was created, but the browser blocked clipboard access. Allow clipboard access and rotate the link again before handing it off.`, copied ? "ok" : "warning");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
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

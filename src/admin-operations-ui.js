import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";
import {
  EVENT_SCHEDULE_CATEGORIES,
  EVENT_SCHEDULE_DAYS
} from "../lib/event-schedule.mjs";
import {
  VISITOR_GUIDANCE_CATEGORIES,
  VISITOR_GUIDANCE_RISK_LEVELS
} from "../lib/visitor-guidance.mjs";
import { REQUIRED_TICKET_POLICY_NOTICES } from "../lib/ticket-policy-schema.mjs";
import { setCreationStatus, submitCreation } from "./admin-creation.js";

const PENDING_NOTICE_STATUSES = new Set(["pending", "draft_ready", "approved", "queued", "sending"]);
const OUTREACH_RETRY_MESSAGE = "Retry safely; saved once.";

export function bindTaskCreation(form, deps) {
  if (!form || form.dataset.creationBound === "true") return;
  form.dataset.creationBound = "true";
  form.addEventListener("submit", event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const body = { ...values, dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null };
    void submitCreation(form, "/api/admin/partners/tasks", body, "Try the same task again; Operations will delegate it only once.", "Task delegated.", deps);
  });
}

export function bindMilestoneCreation(form, deps) {
  if (!form) return;
  form.onsubmit = event => {
    event.preventDefault();
    const dueAt = form.elements.dueAt.value;
    if (!form.elements.applicationId.value || !dueAt) {
      setCreationStatus(form, "Choose a partner and due date.", "error", deps.setAdminStatus);
      return;
    }
    const body = {
      label: form.elements.label.value.trim(),
      dueAt: new Date(dueAt).toISOString(),
      assigneeTeam: form.elements.assigneeTeam.value,
      reminderLeadDays: Number(form.elements.reminderLeadDays.value)
    };
    void submitCreation(form, `/api/admin/partners/applications/${encodeURIComponent(form.elements.applicationId.value)}/milestones`, body, "Try the same key date again; Operations will record it only once.", "Partner key date added.", deps, () => {
      form.elements.reminderLeadDays.value = "3";
    });
  };
}

export function bindOutreachProspectCreation(form, deps) {
  if (!form) return;
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const body = {
      ...values,
      latitude: values.latitude || null,
      longitude: values.longitude || null,
      communityFit: form.elements.communityFit.checked,
      nextActionAt: deps.localDateTimeToIso(values.nextActionAt)
    };
    void submitCreation(form, "/api/admin/outreach/prospects", body, OUTREACH_RETRY_MESSAGE, data => `Scored ${data.prospect.organizationName} at ${data.prospect.fitScore}/100.`, deps, () => {
      form.elements.state.value = "TX";
    });
  };
}

export function bindOutreachCampaignCreation(form, deps) {
  if (!form) return;
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.dataset.audiencePreviewFingerprint || form.dataset.audiencePreviewFingerprint !== deps.campaignFormFingerprint(form)) {
      deps.invalidateCampaignAudiencePreview(form, { force: true });
      setCreationStatus(form, "Preview the current campaign audience before saving the draft.", "error", deps.setAdminStatus);
      return;
    }
    const body = deps.campaignFormPayload(form);
    void submitCreation(form, "/api/admin/outreach/campaigns", body, OUTREACH_RETRY_MESSAGE, data => `${data.campaign.name} saved.`, deps, () => {
      deps.invalidateCampaignAudiencePreview(form, { force: true, message: "Campaign draft saved. Change the campaign name or targeting, then preview again before creating another draft." });
    }, () => !deps.adminCan("outreach:write") || !form.dataset.audiencePreviewFingerprint, false);
  };
}

function bindGeneratedCatalogId(form) {
  form.elements.name.addEventListener("input", event => {
    const idInput = form.elements.id;
    if (idInput.dataset.manuallyEdited === "true") return;
    idInput.value = event.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  });
  form.elements.id.addEventListener("input", event => {
    event.currentTarget.dataset.manuallyEdited = event.currentTarget.value ? "true" : "false";
  });
}

export function bindSponsorPackageCreation(form, deps) {
  if (!form) return;
  bindGeneratedCatalogId(form);
  form.onsubmit = () => {
    const values = Object.fromEntries(new FormData(form));
    const body = {
      ...values,
      amount: deps.centsFromInput(values.amount),
      benefits: values.benefits.split("\n").map(item => item.trim()).filter(Boolean),
      active: Boolean(values.active),
      requiresApproval: Boolean(values.requiresApproval)
    };
    void submitCreation(form, "/api/admin/sponsor-packages", body, OUTREACH_RETRY_MESSAGE, "Saved.", deps, null, () => !deps.adminCan("sponsor:write"));
    return false;
  };
}

export function bindVendorOfferingCreation(form, deps) {
  if (!form) return;
  bindGeneratedCatalogId(form);
  form.onsubmit = () => {
    const values = new FormData(form);
    const body = {
      ...Object.fromEntries(values),
      amount: deps.centsFromInput(values.get("amount")),
      categories: values.getAll("categories"),
      inclusions: values.get("inclusions").split("\n").map(item => item.trim()).filter(Boolean),
      active: values.has("active"),
      requiresApproval: values.has("requiresApproval")
    };
    void submitCreation(form, "/api/admin/vendor-offerings", body, OUTREACH_RETRY_MESSAGE, "Saved.", deps, null, () => !deps.adminCan("finance:write"));
    return false;
  };
}

export function createAdminWorkspaceRecovery({ access, load, status }) {
  let timer = null;
  let attempt = 0;

  return {
    retryable(error) {
      return Boolean(access()) && (!error.status || error.status === 408 || error.status === 429 || error.status >= 500);
    },
    transition(state, retry = false) {
      const node = status();
      globalThis.clearTimeout(timer);
      timer = null;
      if (state === "ready" || (state === "failed" && !retry)) attempt = 0;
      if (!retry) return;

      const delay = Math.min(30_000, 2_000 * (2 ** attempt++));
      timer = globalThis.setTimeout(() => {
        timer = null;
        if (node?.dataset.workspaceState === "failed" && access()) void load();
      }, delay);
    }
  };
}

export function operationsNavigationLinks({ islandLabel = "Island conditions" } = {}) {
  return `<a href="#admin-config">Overview</a>
    <a href="#admin-impact-report">Impact</a>
    <a href="#admin-guest-services">Guest services</a>
    <a href="#admin-documents">Documents</a>
    <a href="#admin-partners">Partners</a>
    <a href="#admin-budget">Accounting</a>
    <a href="#admin-volunteers">Staffing</a>
    <a href="#admin-island-conditions">${escapeHtml(islandLabel)}</a>
    <a href="#admin-system-monitor">Systems</a>`;
}

export function guestServicesMarkup() {
  return `<section class="admin-guest-services" id="admin-guest-services" aria-labelledby="admin-guest-services-title">
    <div class="admin-guest-services-heading">
      <div>
        <p class="eyebrow">Visitor support desk</p>
        <h2 id="admin-guest-services-title">Guest Services cases</h2>
        <p id="admin-guest-services-status">Waiting for current-event requests.</p>
      </div>
      <div class="admin-guest-services-actions">
        <label><span>View</span><select id="admin-guest-services-filter"><option value="active">Active</option><option value="all">All cases</option><option value="resolved">Resolved</option></select></label>
        <button id="admin-load-guest-services" class="button secondary" data-requires-permission="guest_services:read" type="button">Refresh</button>
      </div>
    </div>
    <div id="admin-guest-services-kpis" class="admin-guest-services-kpis" aria-live="polite" aria-busy="true">
      <article><span>Active</span><strong>—</strong></article>
      <article><span>Urgent</span><strong>—</strong></article>
      <article><span>Resolved</span><strong>—</strong></article>
    </div>
    <div id="admin-guest-services-list" class="admin-guest-services-list keyboard-scroll-region" role="region" aria-label="Guest Services case queue" tabindex="0">
      <article class="empty-state"><span>No Guest Services cases loaded.</span></article>
    </div>
  </section>`;
}

function guestServicesDate(value) {
  if (!value) return "Not updated";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not updated" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function guestServicesLabel(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function guestServicesCaseMarkup(item, teams, canWrite) {
  const publicUpdates = (item.updates || []).filter(update => update.public).slice(-2).reverse();
  return `<article class="admin-guest-services-case" data-guest-services-case="${escapeAttr(item.id)}" data-status="${escapeAttr(item.status)}" data-priority="${escapeAttr(item.priority)}">
    <header>
      <div><span>${escapeHtml(item.reference)} · ${escapeHtml(guestServicesLabel(item.category))}</span><strong>${escapeHtml(item.title)}</strong></div>
      <div><b>${escapeHtml(guestServicesLabel(item.priority))}</b><em>${escapeHtml(guestServicesLabel(item.status))}</em></div>
    </header>
    <div class="admin-guest-services-details">
      <p>${escapeHtml(item.details)}</p>
      <dl>
        <div><dt>Location</dt><dd>${escapeHtml(item.location || "Not provided")}</dd></div>
        <div><dt>Contact</dt><dd>${escapeHtml(item.contact?.name || "Not provided")}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(item.contact?.email || "Not provided")}</dd></div>
        <div><dt>Mobile</dt><dd>${escapeHtml(item.contact?.phone || "Not provided")}</dd></div>
      </dl>
    </div>
    ${publicUpdates.length ? `<div class="admin-guest-services-history">${publicUpdates.map(update => `<p><strong>${escapeHtml(guestServicesDate(update.at))}</strong><span>${escapeHtml(update.message)}</span></p>`).join("")}</div>` : ""}
    <form class="admin-guest-services-update">
      <label><span>Status</span><select name="status" ${canWrite ? "" : "disabled"}>${["open", "in_progress", "waiting_for_guest", "resolved", "closed"].map(value => `<option value="${value}" ${item.status === value ? "selected" : ""}>${guestServicesLabel(value)}</option>`).join("")}</select></label>
      <label><span>Priority</span><select name="priority" ${canWrite ? "" : "disabled"}>${["normal", "high", "urgent"].map(value => `<option value="${value}" ${item.priority === value ? "selected" : ""}>${guestServicesLabel(value)}</option>`).join("")}</select></label>
      <label><span>Response team</span><select name="assignedTeam" ${canWrite ? "" : "disabled"}>${teams.map(team => `<option value="${escapeAttr(team.id)}" ${item.assignedTeam === team.id ? "selected" : ""}>${escapeHtml(team.label)}</option>`).join("")}</select></label>
      <label class="admin-guest-services-wide"><span>Visitor update</span><textarea name="publicMessage" rows="2" maxlength="1000" ${canWrite ? "" : "disabled"}></textarea></label>
      <label class="admin-guest-services-wide"><span>Internal note</span><textarea name="internalNote" rows="2" maxlength="1000" ${canWrite ? "" : "disabled"}></textarea></label>
      <label class="admin-guest-services-publish"><input name="publishUpdate" type="checkbox" ${canWrite ? "" : "disabled"} /><span>Publish the visitor update in the private status view</span></label>
      <button class="button primary" type="submit" ${canWrite ? "" : "disabled"}>Save case</button>
    </form>
    <footer>Opened ${escapeHtml(guestServicesDate(item.createdAt))} · updated ${escapeHtml(guestServicesDate(item.updatedAt))}</footer>
  </article>`;
}

export function createGuestServicesUi({ adminCan, adminFetch, setAdminStatus }) {
  let payload = null;
  let mounted = false;

  function filteredCases() {
    const filter = document.querySelector("#admin-guest-services-filter")?.value || "active";
    const cases = payload?.cases || [];
    if (filter === "resolved") return cases.filter(item => ["resolved", "closed"].includes(item.status));
    if (filter === "active") return cases.filter(item => !["resolved", "closed"].includes(item.status));
    return cases;
  }

  function render() {
    const list = document.querySelector("#admin-guest-services-list");
    const kpis = document.querySelector("#admin-guest-services-kpis");
    const status = document.querySelector("#admin-guest-services-status");
    if (!list || !kpis || !payload) return;
    const summary = payload.summary || {};
    kpis.innerHTML = [
      ["Active", summary.active || 0],
      ["Urgent", summary.urgent || 0],
      ["Resolved", summary.resolved || 0]
    ].map(([label, value]) => `<article><span>${label}</span><strong>${Number(value).toLocaleString()}</strong></article>`).join("");
    kpis.setAttribute("aria-busy", "false");
    const cases = filteredCases();
    list.innerHTML = cases.map(item => guestServicesCaseMarkup(item, payload.teams || [], adminCan("guest_services:write"))).join("") || '<article class="empty-state"><span>No cases match this view.</span></article>';
    if (status) status.textContent = `${payload.eventId} · ${summary.active || 0} active · updated ${guestServicesDate(payload.lastUpdated)}`;
    list.querySelectorAll(".admin-guest-services-update").forEach(form => form.addEventListener("submit", async event => {
      event.preventDefault();
      const card = form.closest("[data-guest-services-case]");
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form).entries());
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/guest-services/cases/${encodeURIComponent(card.dataset.guestServicesCase)}`, {
          method: "PATCH",
          body: JSON.stringify({ ...values, publishUpdate: form.elements.publishUpdate.checked })
        });
        await load({ quiet: true });
        setAdminStatus("Guest Services case saved.", "ok");
      } catch (error) {
        setAdminStatus(error.message, "error");
        button.disabled = !adminCan("guest_services:write");
      }
    }));
  }

  async function load({ quiet = false } = {}) {
    if (!adminCan("guest_services:read")) return null;
    const button = document.querySelector("#admin-load-guest-services");
    if (button) button.disabled = true;
    try {
      payload = await adminFetch("/api/admin/guest-services");
      render();
      if (!quiet) setAdminStatus(`Loaded ${payload.summary.active} active Guest Services case${payload.summary.active === 1 ? "" : "s"}.`, "ok");
      return payload;
    } catch (error) {
      if (!quiet) setAdminStatus(error.message, "error");
      throw error;
    } finally {
      if (button) button.disabled = !adminCan("guest_services:read");
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    document.querySelector("#admin-load-guest-services")?.addEventListener("click", () => load());
    document.querySelector("#admin-guest-services-filter")?.addEventListener("change", render);
  }

  return { load, mount, render };
}

export function boardImpactReportMarkup() {
  return `<section class="admin-impact-report" id="admin-impact-report" aria-labelledby="admin-impact-title">
    <div class="admin-impact-heading">
      <div>
        <p class="eyebrow">Board and post-event reporting</p>
        <h2 id="admin-impact-title">Impact snapshot</h2>
        <p id="admin-impact-status">Waiting for current-event totals.</p>
      </div>
      <div class="admin-impact-actions">
        <button id="admin-load-impact" class="button secondary" data-requires-permission="impact:read" type="button">Refresh</button>
        <button id="admin-download-impact" class="button primary" data-requires-permission="impact:read" type="button">Download CSV</button>
      </div>
    </div>
    <div id="admin-impact-highlights" class="admin-impact-highlights" aria-live="polite" aria-busy="true">
      <article class="empty-state"><span>No impact totals loaded.</span></article>
    </div>
    <div id="admin-impact-sections" class="admin-impact-sections"></div>
    <div id="admin-impact-sources" class="admin-impact-sources"></div>
  </section>`;
}

function impactValue(metric, adminMoney) {
  const value = Number(metric?.value || 0);
  if (metric?.unit === "cents") return adminMoney(value);
  if (metric?.unit === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (metric?.unit === "hours") return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
  return Math.round(value).toLocaleString("en-US");
}

function renderBoardImpactSnapshot(snapshot, { adminMoney, conditionLabel }) {
  const highlights = document.querySelector("#admin-impact-highlights");
  const sections = document.querySelector("#admin-impact-sections");
  const sources = document.querySelector("#admin-impact-sources");
  const status = document.querySelector("#admin-impact-status");
  if (!highlights || !sections || !sources || !status) return;

  highlights.innerHTML = (snapshot?.highlights || []).map(item => `<article data-impact-state="${escapeAttr(item.status)}">
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(impactValue(item, adminMoney))}</strong>
    <small>${escapeHtml(item.context || conditionLabel(item.status))}</small>
  </article>`).join("") || '<article class="empty-state"><span>No impact totals loaded.</span></article>';
  highlights.setAttribute("aria-busy", "false");

  sections.innerHTML = (snapshot?.sections || []).map(section => `<article class="admin-impact-section" data-impact-section="${escapeAttr(section.id)}">
    <h3>${escapeHtml(section.label)}</h3>
    <dl>${(section.metrics || []).map(item => `<div data-impact-state="${escapeAttr(item.status)}">
      <dt>${escapeHtml(item.label)}${item.context ? `<small>${escapeHtml(item.context)}</small>` : ""}</dt>
      <dd>${escapeHtml(impactValue(item, adminMoney))}</dd>
    </div>`).join("")}</dl>
  </article>`).join("");

  const sourceRows = snapshot?.sources || [];
  sources.innerHTML = sourceRows.length ? `<strong>Source freshness</strong><ul>${sourceRows.map(item => `<li><span>${escapeHtml(item.label)}</span>${item.updatedAt ? `<time datetime="${escapeAttr(item.updatedAt)}">${escapeHtml(new Date(item.updatedAt).toLocaleString())}</time>` : "<small>No update recorded</small>"}</li>`).join("")}</ul>` : "";
  const generated = snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString() : "just now";
  const attention = Number(snapshot?.headline?.attentionSignals || 0);
  status.textContent = `${snapshot?.eventId || "Current event"} · generated ${generated} · ${attention} attention signal${attention === 1 ? "" : "s"}`;
  status.dataset.state = attention ? "attention" : "ok";
}

export function createBoardImpactUi({
  adminCan,
  adminFetch,
  adminMoney,
  conditionLabel,
  downloadAdminExport,
  setAdminStatus
}) {
  let mounted = false;

  async function load({ quiet = false } = {}) {
    if (!adminCan("impact:read")) return null;
    const button = document.querySelector("#admin-load-impact");
    if (button) button.disabled = true;
    try {
      const data = await adminFetch("/api/admin/impact");
      renderBoardImpactSnapshot(data.snapshot, { adminMoney, conditionLabel });
      if (!quiet) {
        const attention = Number(data.snapshot?.headline?.attentionSignals || 0);
        setAdminStatus(`Loaded the board impact snapshot with ${attention} attention signal${attention === 1 ? "" : "s"}.`, attention ? "warning" : "ok");
      }
      return data;
    } catch (error) {
      const status = document.querySelector("#admin-impact-status");
      if (status) {
        status.textContent = error.message;
        status.dataset.state = "error";
      }
      if (!quiet) setAdminStatus(error.message, "error");
      throw error;
    } finally {
      if (button) button.disabled = !adminCan("impact:read");
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    const exportType = document.querySelector("#admin-export-type");
    if (exportType && !exportType.querySelector('[value="impact.csv"]')) {
      const option = document.createElement("option");
      option.value = "impact.csv";
      option.textContent = "Board impact snapshot";
      exportType.insertBefore(option, exportType.querySelector('[value="milestones.ics"]'));
    }
    document.querySelector("#admin-load-impact")?.addEventListener("click", () => {
      load().catch(() => {});
    });
    document.querySelector("#admin-download-impact")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const fileName = await downloadAdminExport("impact.csv");
        setAdminStatus(`${fileName} is ready.`, "ok");
      } catch (error) {
        setAdminStatus(error.message, "error");
      } finally {
        button.disabled = !adminCan("impact:read");
      }
    });
  }

  return { load, mount };
}

export function renderVolunteerAttendance(attendanceEl, payload, dependencies) {
  const {
    adminCan,
    adminFetch,
    conditionLabel,
    loadAdminVolunteers,
    setAdminStatus
  } = dependencies;
  const assignments = [...(payload?.assignments || [])].sort((left, right) => {
    const rank = { checked_in: 0, scheduled: 1, checked_in_elsewhere: 2, no_show: 3, cancelled: 4, checked_out: 5 };
    const statusDifference = (rank[left.attendanceStatus] ?? 9) - (rank[right.attendanceStatus] ?? 9);
    if (statusDifference) return statusDifference;
    return String(left.startsAt || "").localeCompare(String(right.startsAt || "")) || left.volunteerName.localeCompare(right.volunteerName);
  });
  attendanceEl.innerHTML = assignments.map(item => {
    const starts = item.startsAt ? new Date(item.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Time pending";
    const ends = item.endsAt ? new Date(item.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    const action = item.canCheckOut ? "check_out" : item.canCheckIn ? "check_in" : "";
    const actionLabel = item.canCheckOut ? "Check out" : item.canCheckIn ? "Check in" : "Recorded";
    return `<article data-volunteer-assignment="${escapeAttr(item.id)}" data-attendance-status="${escapeAttr(item.attendanceStatus)}">
      <div>
        <strong>${escapeHtml(item.volunteerName)}${item.captain ? " · Captain" : ""}</strong>
        <span>${escapeHtml(item.day || "Scheduled")} · ${escapeHtml(item.zoneLabel)} · ${escapeHtml(conditionLabel(item.roleId))}</span>
        <small>${escapeHtml(`${starts}${ends ? ` - ${ends}` : ""}`)}${item.checkInAt ? ` · In ${escapeHtml(new Date(item.checkInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""}${item.checkOutAt ? ` · Out ${escapeHtml(new Date(item.checkOutAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""}</small>
      </div>
      <b data-status="${escapeAttr(item.attendanceStatus)}">${escapeHtml(conditionLabel(item.attendanceStatus))}</b>
      <button class="button ${item.canCheckOut ? "primary" : "secondary"}" type="button" data-volunteer-attendance-action="${escapeAttr(action)}" data-volunteer-id="${escapeAttr(item.volunteerId)}" data-shift-id="${escapeAttr(item.shiftId)}" data-attendance-id="${escapeAttr(item.attendanceId || "")}" ${action && adminCan("volunteers:write") ? "" : "disabled"}>${actionLabel}</button>
    </article>`;
  }).join("") || '<article class="empty-state"><span>No assigned volunteer shifts.</span></article>';

  attendanceEl.querySelectorAll("[data-volunteer-attendance-action]").forEach(button => {
    if (!button.dataset.volunteerAttendanceAction) return;
    button.addEventListener("click", async () => {
      const action = button.dataset.volunteerAttendanceAction;
      button.disabled = true;
      try {
        const result = await adminFetch("/api/admin/volunteers/attendance", {
          method: "POST",
          body: JSON.stringify({
            action,
            volunteerId: button.dataset.volunteerId,
            shiftId: button.dataset.shiftId,
            attendanceId: button.dataset.attendanceId || null,
            method: "captain"
          })
        });
        await loadAdminVolunteers({ quiet: true });
        const verb = action === "check_in" ? "Checked in" : "Checked out";
        setAdminStatus(`${verb} ${result.volunteer.name}${result.replay ? "; the attendance record was already current" : ""}.`, "ok");
      } catch (error) {
        setAdminStatus(error.message, "error");
        button.disabled = !adminCan("volunteers:write");
      }
    });
  });
}

export function eventScheduleEditorMarkup() {
  return `<div class="admin-event-schedule-panel">
    <div class="editor-heading admin-edit-title admin-event-schedule-heading">
      <div>
        <p class="eyebrow">Published program</p>
        <h2>Daily schedule</h2>
        <p id="admin-event-schedule-readiness" class="admin-event-guide-status">Not loaded</p>
      </div>
      <button id="admin-add-event-schedule-item" class="button secondary" data-requires-permission="content:write" type="button">Add item</button>
    </div>
    <form id="admin-event-schedule-form" class="admin-event-schedule-form" data-requires-permission="content:write">
      <div id="admin-event-schedule-rows" class="admin-event-schedule-rows"></div>
      <div class="admin-form-grid admin-event-schedule-publication">
        <label><span>Official source</span><input name="sourceUrl" type="url" inputmode="url" required /></label>
        <label><span>Source checked</span><input name="sourceCheckedAt" type="datetime-local" required /></label>
      </div>
      <div class="admin-form-grid admin-event-schedule-actions">
        <label><span>Hold reason</span><input name="holdReason" maxlength="500" placeholder="Required only when holding publication" /></label>
        <button id="admin-hold-event-schedule" class="button secondary" type="button">Hold schedule</button>
        <button id="admin-publish-event-schedule" class="button primary" type="submit">Publish schedule</button>
      </div>
    </form>
  </div>`;
}

export function visitorGuidanceEditorMarkup() {
  return `<div class="admin-visitor-guidance-panel">
    <div class="editor-heading admin-edit-title admin-visitor-guidance-heading">
      <div>
        <p class="eyebrow">Plan your visit</p>
        <h2>Visitor guidance</h2>
        <p id="admin-visitor-guidance-readiness" class="admin-event-guide-status">Not loaded</p>
      </div>
      <button id="admin-add-visitor-guidance" class="button secondary" data-requires-permission="content:write" type="button">Add answer</button>
    </div>
    <form id="admin-visitor-guidance-form" class="admin-visitor-guidance-form" data-requires-permission="content:write">
      <div id="admin-visitor-guidance-rows" class="admin-visitor-guidance-rows"></div>
      <div class="admin-form-grid admin-visitor-guidance-publication">
        <label><span>Official source</span><input name="sourceUrl" type="url" inputmode="url" required /></label>
        <label><span>Source checked</span><input name="sourceCheckedAt" type="datetime-local" required /></label>
      </div>
      <div class="admin-form-grid admin-visitor-guidance-actions">
        <label><span>Hold reason</span><input name="holdReason" maxlength="500" placeholder="Required only when holding publication" /></label>
        <button id="admin-hold-visitor-guidance" class="button secondary" type="button">Hold guidance</button>
        <button id="admin-publish-visitor-guidance" class="button primary" type="submit">Publish guidance</button>
      </div>
    </form>
  </div>`;
}

function visitorGuidanceOptions(values, selected) {
  return values.map(value => `<option value="${escapeAttr(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function visitorGuidanceRow(item = {}, isoToLocalDateTime = value => value || "") {
  return `<article class="admin-visitor-guidance-row">
    <div class="admin-form-grid admin-visitor-guidance-primary">
      <label><span>Question</span><input name="question" maxlength="180" value="${escapeAttr(item.question ?? "")}" required /></label>
      <label><span>Category</span><select name="category" required>${visitorGuidanceOptions(VISITOR_GUIDANCE_CATEGORIES, item.category || VISITOR_GUIDANCE_CATEGORIES[0])}</select></label>
      <button class="button secondary admin-visitor-guidance-remove" data-remove-visitor-guidance type="button" aria-label="Remove visitor answer">&times;</button>
    </div>
    <label><span>Public answer</span><textarea name="answer" rows="3" maxlength="1200" required>${escapeHtml(item.answer ?? "")}</textarea></label>
    <label><span>Matching words</span><input name="keywords" maxlength="600" value="${escapeAttr((item.keywords ?? []).join(", "))}" required /></label>
    <div class="admin-form-grid">
      <label><span>Source label</span><input name="sourceLabel" maxlength="120" value="${escapeAttr(item.sourceLabel ?? "")}" required /></label>
      <label><span>Source URL</span><input name="itemSourceUrl" type="url" inputmode="url" value="${escapeAttr(item.sourceUrl ?? "")}" required /></label>
      <label><span>Reviewed</span><input name="itemSourceCheckedAt" type="datetime-local" value="${escapeAttr(isoToLocalDateTime(item.sourceCheckedAt))}" required /></label>
      <label><span>Effective</span><input name="effectiveAt" type="datetime-local" value="${escapeAttr(isoToLocalDateTime(item.effectiveAt))}" required /></label>
      <label><span>Expires</span><input name="expiresAt" type="datetime-local" value="${escapeAttr(isoToLocalDateTime(item.expiresAt))}" required /></label>
      <label><span>Risk</span><select name="riskLevel" required>${visitorGuidanceOptions(VISITOR_GUIDANCE_RISK_LEVELS, item.riskLevel || "medium")}</select></label>
      <label><span>Owner team</span><input name="ownerTeam" maxlength="80" value="${escapeAttr(item.ownerTeam ?? "guest-services")}" required /></label>
      <label><span>Escalation email</span><input name="escalationContact" type="email" maxlength="254" value="${escapeAttr(item.escalationContact ?? "info@texassandfest.org")}" required /></label>
      <label><span>Status</span><select name="status"><option value="active" ${item.status === "active" ? "selected" : ""}>Active</option><option value="draft" ${item.status !== "active" ? "selected" : ""}>Draft</option></select></label>
    </div>
    <input name="guidanceId" type="hidden" value="${escapeAttr(item.id ?? "")}" />
  </article>`;
}

export function renderVisitorGuidance(bootstrap, readiness, isoToLocalDateTime) {
  const form = document.querySelector("#admin-visitor-guidance-form");
  const rows = document.querySelector("#admin-visitor-guidance-rows");
  if (!form || !rows) return;
  rows.innerHTML = (Array.isArray(bootstrap?.guidance) ? bootstrap.guidance : []).map(item => visitorGuidanceRow(item, isoToLocalDateTime)).join("");
  form.elements.sourceUrl.value = bootstrap?.guidancePublication?.sourceUrl ?? "https://www.texassandfest.org/faq";
  form.elements.sourceCheckedAt.value = isoToLocalDateTime(bootstrap?.guidancePublication?.sourceCheckedAt);
  form.elements.holdReason.value = "";
  const status = document.querySelector("#admin-visitor-guidance-readiness");
  if (status) {
    const hold = readiness?.publication?.holdReason ? ` Hold: ${readiness.publication.holdReason}` : "";
    status.textContent = `${readiness?.reason ?? "Visitor guidance readiness has not been checked."}${hold}`;
    status.dataset.state = readiness?.ready ? "ok" : "warning";
  }
}

function serializeVisitorGuidance(form, localDateTimeToIso) {
  const values = new FormData(form);
  const fields = ["guidanceId", "category", "question", "answer", "keywords", "sourceLabel", "itemSourceUrl", "itemSourceCheckedAt", "effectiveAt", "expiresAt", "riskLevel", "ownerTeam", "escalationContact", "status"];
  return values.getAll("question").map((_, index) => {
    const row = Object.fromEntries(fields.map(field => [field, values.getAll(field)[index]]));
    const generatedId = String(row.question || "answer")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || `answer-${index + 1}`;
    return {
      id: row.guidanceId || generatedId,
      category: row.category,
      question: row.question,
      answer: row.answer,
      keywords: row.keywords.split(",").map(value => value.trim()).filter(Boolean),
      sourceLabel: row.sourceLabel,
      sourceUrl: row.itemSourceUrl,
      sourceCheckedAt: localDateTimeToIso(row.itemSourceCheckedAt),
      effectiveAt: localDateTimeToIso(row.effectiveAt),
      expiresAt: localDateTimeToIso(row.expiresAt),
      audience: "public",
      riskLevel: row.riskLevel,
      ownerTeam: row.ownerTeam,
      escalationContact: row.escalationContact,
      status: row.status
    };
  });
}

export function bindVisitorGuidanceEditor({ adminFetch, localDateTimeToIso, isoToLocalDateTime, refresh, setAdminStatus }) {
  const form = document.querySelector("#admin-visitor-guidance-form");
  if (!form) return;
  const rows = document.querySelector("#admin-visitor-guidance-rows");
  rows.addEventListener("click", event => event.target.closest("[data-remove-visitor-guidance]")?.closest(".admin-visitor-guidance-row")?.remove());
  document.querySelector("#admin-add-visitor-guidance")?.addEventListener("click", () => {
    const now = new Date();
    const expires = new Date(now.getTime() + 90 * 86_400_000);
    rows.insertAdjacentHTML("beforeend", visitorGuidanceRow({
      category: "At the festival",
      riskLevel: "medium",
      ownerTeam: "guest-services",
      escalationContact: "info@texassandfest.org",
      status: "draft",
      effectiveAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      sourceCheckedAt: now.toISOString()
    }, isoToLocalDateTime));
  });
  const save = async (publish, button) => {
    button.disabled = true;
    try {
      const data = await adminFetch("/api/admin/visitor-guidance/publish", {
        method: "POST",
        body: JSON.stringify(publish ? {
          publish: true,
          guidance: serializeVisitorGuidance(form, localDateTimeToIso),
          sourceUrl: form.elements.sourceUrl.value,
          sourceCheckedAt: localDateTimeToIso(form.elements.sourceCheckedAt.value)
        } : { publish: false, reason: form.elements.holdReason.value })
      });
      await refresh();
      setAdminStatus(publish
        ? `Published ${data.readiness.current.length} current visitor answer${data.readiness.current.length === 1 ? "" : "s"}.`
        : "Visitor guidance is held and no FAQ answers are public.", publish ? "ok" : "warning");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
  form.addEventListener("submit", event => {
    event.preventDefault();
    save(true, document.querySelector("#admin-publish-visitor-guidance"));
  });
  document.querySelector("#admin-hold-visitor-guidance")?.addEventListener("click", event => save(false, event.currentTarget));
}

function eventScheduleTimeInput(value) {
  const input = String(value ?? "").trim();
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input)) return input;
  const match = input.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) return "";
  const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function eventScheduleOptions(values, selected) {
  return values.map(value => `<option ${value === selected ? "selected" : ""}>${value}</option>`).join("");
}

function eventScheduleRow(item = {}) {
  return `<div class="admin-form-grid admin-event-schedule-row">
    <input name="id" type="hidden" value="${escapeAttr(item.id ?? "")}" />
    <label><span>Day</span><select name="day" required>${eventScheduleOptions(EVENT_SCHEDULE_DAYS, item.day)}</select></label>
    <label><span>Time</span><input name="time" type="time" value="${escapeAttr(eventScheduleTimeInput(item.time))}" required /></label>
    <label><span>Program</span><input name="title" maxlength="180" value="${escapeAttr(item.title ?? "")}" required /></label>
    <label><span>Location</span><input name="zone" maxlength="120" value="${escapeAttr(item.zone ?? "")}" required /></label>
    <label><span>Category</span><select name="category" required>${eventScheduleOptions(EVENT_SCHEDULE_CATEGORIES, item.category)}</select></label>
    <button class="button secondary admin-event-schedule-remove" data-remove-event-schedule-item type="button" aria-label="Remove schedule item">&times;</button>
  </div>`;
}

export function renderEventSchedule(bootstrap, readiness, isoToLocalDateTime) {
  const form = document.querySelector("#admin-event-schedule-form");
  const rows = document.querySelector("#admin-event-schedule-rows");
  if (!form || !rows) return;
  rows.innerHTML = (Array.isArray(bootstrap?.schedule) ? bootstrap.schedule : []).map(eventScheduleRow).join("");
  form.elements.sourceUrl.value = bootstrap?.schedulePublication?.sourceUrl ?? "https://www.texassandfest.org/daily-schedule";
  form.elements.sourceCheckedAt.value = isoToLocalDateTime(bootstrap?.schedulePublication?.sourceCheckedAt);
  form.elements.holdReason.value = "";
  const status = document.querySelector("#admin-event-schedule-readiness");
  if (status) {
    const hold = readiness?.publication?.holdReason ? ` Hold: ${readiness.publication.holdReason}` : "";
    status.textContent = `${readiness?.reason ?? "Schedule readiness has not been checked."}${hold}`;
    status.dataset.state = readiness?.ready ? "ok" : "warning";
  }
}

function serializeEventSchedule(form) {
  const fields = ["id", "day", "time", "title", "zone", "category"];
  const values = new FormData(form);
  return values.getAll("day").map((_, index) => Object.fromEntries(fields.map(field => [field, values.getAll(field)[index]])));
}

export function bindEventScheduleEditor({ adminFetch, localDateTimeToIso, refresh, setAdminStatus }) {
  const form = document.querySelector("#admin-event-schedule-form");
  if (!form) return;
  const rows = document.querySelector("#admin-event-schedule-rows");
  rows.addEventListener("click", event => event.target.closest("[data-remove-event-schedule-item]")?.closest(".admin-event-schedule-row")?.remove());
  document.querySelector("#admin-add-event-schedule-item")?.addEventListener("click", () => {
    rows.insertAdjacentHTML("beforeend", eventScheduleRow({ day: "Friday", time: "09:00", category: "Program" }));
  });
  const save = async (publish, button) => {
    button.disabled = true;
    try {
      const data = await adminFetch("/api/admin/event-schedule/publish", {
        method: "POST",
        body: JSON.stringify(publish ? {
          publish: true,
          schedule: serializeEventSchedule(form),
          sourceUrl: form.elements.sourceUrl.value,
          sourceCheckedAt: localDateTimeToIso(form.elements.sourceCheckedAt.value)
        } : { publish: false, reason: form.elements.holdReason.value })
      });
      await refresh();
      setAdminStatus(publish
        ? `Published ${data.schedule.length} schedule item${data.schedule.length === 1 ? "" : "s"}.`
        : "The daily schedule is held and no detailed program is public.", publish ? "ok" : "warning");
    } catch (error) {
      setAdminStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
  form.addEventListener("submit", event => {
    event.preventDefault();
    save(true, document.querySelector("#admin-publish-event-schedule"));
  });
  document.querySelector("#admin-hold-event-schedule")?.addEventListener("click", event => {
    save(false, event.currentTarget);
  });
}

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

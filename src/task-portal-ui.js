import { escapeHtml } from "../lib/html-escape.mjs";
import { shouldForgetTaskPortalAccess, taskPortalSafeHash } from "../lib/partner-portal-session.mjs";

export const TASK_PORTAL_SESSION_KEY = "sandfest_task_portal_v1";

function accessFromFragment(location) {
  const hash = String(location?.hash || "").slice(1);
  if (!hash.startsWith("task-status?")) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  const taskId = params.get("task")?.trim();
  const token = params.get("token")?.trim();
  return taskId && token ? { taskId, token } : null;
}

function savedAccess(storage) {
  try {
    const access = JSON.parse(storage?.getItem(TASK_PORTAL_SESSION_KEY) || "null");
    return access?.taskId && access?.token ? access : null;
  } catch {
    return null;
  }
}

function taskPortalMarkup() {
  return `<section class="section task-status-section" id="task-status" hidden>
    <header class="task-status-heading">
      <div><p class="eyebrow">Team assignment</p><h2>Your SandFest task</h2></div>
      <span>Private link</span>
    </header>
    <div id="task-status-result" class="task-status-result" aria-live="polite" tabindex="-1">
      <strong>Opening your assignment...</strong>
      <span>Verifying this private task link.</span>
    </div>
    <form id="task-status-update" class="task-status-update" hidden>
      <label>Update for Operations<textarea name="note" rows="3" maxlength="500" placeholder="Add progress or details. A note is required when reporting a blocker."></textarea></label>
      <div class="task-status-actions">
        <button class="button secondary" type="button" data-task-action="acknowledge">Acknowledge</button>
        <button class="button secondary" type="button" data-task-action="start">Start work</button>
        <button class="button secondary" type="button" data-task-action="block">Report blocker</button>
        <button class="button primary" type="button" data-task-action="complete">Mark complete</button>
      </div>
      <p class="task-status-message" aria-live="polite"></p>
    </form>
    <p class="task-status-privacy">Only someone with this private assignment link can view or update this task. Contact the SandFest operations team if the owner or deadline is incorrect.</p>
  </section>`;
}

export function createTaskPortalController(options) {
  const document = options.document;
  const window = options.window;
  const storage = options.storage;
  let activeAccess = null;
  let activeTask = null;
  let loadVersion = 0;

  function mount() {
    if (document.querySelector("#task-status")) return;
    const surfaces = document.querySelector("#surfaces");
    if (surfaces) surfaces.insertAdjacentHTML("beforebegin", taskPortalMarkup());
    else document.querySelector("main")?.insertAdjacentHTML("beforeend", taskPortalMarkup());
    document.querySelector("#task-status-update")?.addEventListener("click", event => {
      const button = event.target instanceof window.Element ? event.target.closest("[data-task-action]") : null;
      if (button) submit(button.dataset.taskAction);
    });
  }

  function remember(access) {
    try { storage?.setItem(TASK_PORTAL_SESSION_KEY, JSON.stringify(access)); } catch { /* ignore */ }
  }

  function forget(access) {
    try {
      const saved = savedAccess(storage);
      if (saved?.taskId === access?.taskId && saved?.token === access?.token) storage?.removeItem(TASK_PORTAL_SESSION_KEY);
    } catch { /* ignore */ }
    if (!access || (activeAccess?.taskId === access.taskId && activeAccess?.token === access.token)) {
      activeAccess = null;
      activeTask = null;
    }
  }

  function concealCapability() {
    const safeHash = taskPortalSafeHash(window.location.hash);
    if (safeHash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${safeHash}`);
  }

  function dateTime(value, fallback = "Not recorded") {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function render(task) {
    mount();
    const section = document.querySelector("#task-status");
    const result = document.querySelector("#task-status-result");
    const form = document.querySelector("#task-status-update");
    if (!section || !result || !form) return;
    activeTask = task;
    section.hidden = false;
    const updates = (task.updates || []).slice().reverse().map(item => `<li><div><strong>${escapeHtml(options.conditionLabel(item.action))}</strong><span>${escapeHtml(dateTime(item.at))}</span></div>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</li>`).join("");
    result.dataset.state = task.status;
    result.innerHTML = `<header><div><span>${escapeHtml(options.conditionLabel(task.priority))} priority</span><h3>${escapeHtml(task.title)}</h3></div><b>${escapeHtml(options.conditionLabel(task.status))}</b></header>
      <p class="task-status-owner">Assigned to ${escapeHtml(task.assignee?.name || "SandFest team member")}${task.assignee?.role ? ` | ${escapeHtml(options.conditionLabel(task.assignee.role))}` : ""}</p>
      ${task.description ? `<p class="task-status-description">${escapeHtml(task.description)}</p>` : ""}
      <dl class="task-status-facts"><div><dt>Due</dt><dd>${escapeHtml(dateTime(task.dueAt, "No due date"))}</dd></div><div><dt>Acknowledged</dt><dd>${escapeHtml(dateTime(task.acknowledgedAt, "Awaiting response"))}</dd></div><div><dt>Last update</dt><dd>${escapeHtml(dateTime(task.updatedAt))}</dd></div></dl>
      ${updates ? `<div class="task-status-history"><strong>Updates shared with Operations</strong><ul>${updates}</ul></div>` : ""}`;
    const allowed = new Set(task.allowedActions || []);
    form.querySelectorAll("[data-task-action]").forEach(button => { button.hidden = !allowed.has(button.dataset.taskAction); });
    form.hidden = allowed.size === 0;
  }

  async function load(access, loadOptions = {}) {
    mount();
    const section = document.querySelector("#task-status");
    const result = document.querySelector("#task-status-result");
    const form = document.querySelector("#task-status-update");
    if (!section || !result || !form || !access?.taskId || !access?.token) return;
    const currentLoadVersion = ++loadVersion;
    activeAccess = access;
    section.hidden = false;
    form.hidden = true;
    result.dataset.state = "loading";
    result.innerHTML = "<strong>Opening your assignment...</strong><span>Verifying this private task link.</span>";
    concealCapability();
    try {
      const response = await options.fetchWithTimeout(`${options.publicApiBase()}/api/public/task-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(access)
      });
      const data = await response.json().catch(() => ({}));
      if (currentLoadVersion !== loadVersion) return;
      if (!response.ok) {
        const error = new Error(data.error || `Task lookup failed with ${response.status}`);
        error.status = response.status;
        throw error;
      }
      remember(access);
      render(data.task);
      if (loadOptions.scroll) {
        options.stabilizeRenderedHashTarget({ behavior: loadOptions.scrollBehavior === "auto" ? "instant" : "smooth" });
        result.focus({ preventScroll: true });
      }
    } catch (error) {
      if (currentLoadVersion !== loadVersion) return;
      const rejected = shouldForgetTaskPortalAccess(error.status);
      if (rejected) forget(access);
      else remember(access);
      result.dataset.state = "error";
      result.innerHTML = rejected
        ? "<strong>This assignment link is no longer valid.</strong><span>Ask the SandFest operations team to send the current private link.</span>"
        : "<strong>Task status is temporarily unavailable.</strong><span>Your private access is saved in this browser. Try again when the connection recovers.</span>";
    }
  }

  async function submit(action) {
    const form = document.querySelector("#task-status-update");
    const status = form?.querySelector(".task-status-message");
    const note = form?.elements.note.value.trim() || "";
    if (!form || !status || !activeAccess) return;
    if (action === "block" && !note) {
      status.dataset.state = "error";
      status.textContent = "Describe the blocker so Operations can respond.";
      form.elements.note.focus();
      return;
    }
    const buttons = [...form.querySelectorAll("[data-task-action]")];
    buttons.forEach(button => { button.disabled = true; });
    status.dataset.state = "loading";
    status.textContent = "Updating Operations...";
    try {
      const response = await options.fetchWithTimeout(`${options.publicApiBase()}/api/public/task-status/update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...activeAccess, action, note })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `Task update failed with ${response.status}`);
        error.status = response.status;
        throw error;
      }
      render(data.task);
      form.elements.note.value = "";
      status.dataset.state = "ok";
      status.textContent = data.replay ? "Operations already has this update." : "Operations has your update.";
    } catch (error) {
      if (shouldForgetTaskPortalAccess(error.status)) forget(activeAccess);
      status.dataset.state = "error";
      status.textContent = options.friendlyRequestError(error, "This task could not be updated.");
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  return {
    activeTask: () => activeTask,
    hasAccess: () => Boolean(activeAccess || savedAccess(storage)),
    loadFromLocation(loadOptions = {}) {
      const access = accessFromFragment(window.location)
        || (window.location.hash === "#task-status" ? savedAccess(storage) : null);
      return access ? load(access, loadOptions) : Promise.resolve();
    },
    reload() {
      const access = activeAccess || savedAccess(storage);
      return access ? load(access) : Promise.resolve();
    }
  };
}

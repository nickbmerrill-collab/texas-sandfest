import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";

const SESSION_KEY = "sandfest_guest_services_v1";

function statusLabel(value) {
  return ({ open: "Received", in_progress: "In progress", waiting_for_guest: "Waiting for you", resolved: "Resolved", closed: "Closed" })[value] || value;
}

function teamLabel(value) {
  return String(value || "guest-services").replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function displayDate(value, fallback = "Just now") {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : fallback;
}

function setStatus(target, message, state = "idle") {
  if (!target) return;
  target.dataset.state = state;
  target.setAttribute("role", state === "error" ? "alert" : "status");
  target.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
  target.textContent = message;
}

function friendlyError(error, fallback) {
  if (error?.name === "AbortError") return "The request timed out. Check the connection and try again.";
  if (error instanceof TypeError || /failed to fetch|network error|load failed/i.test(String(error?.message || ""))) return "We could not reach SandFest. Check the connection and try again.";
  return error?.message || fallback;
}

function requestWithTimeout(input, init = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => globalThis.clearTimeout(timeout));
}

function remember(access) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(access)); } catch { /* ignore */ }
}

function saved() {
  try {
    const access = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return access?.reference && access?.token ? access : null;
  } catch {
    return null;
  }
}

function categoryOptions(categories = []) {
  if (!categories.length) return '<option value="">Checking availability...</option>';
  return `<option value="">Choose one</option>${categories.map(category => `<option value="${escapeAttr(category.id)}">${escapeHtml(category.label)}</option>`).join("")}`;
}

function markup({ eventPhone }) {
  const phone = String(eventPhone || "").replace(/[^\d+]/g, "");
  return `<div class="section-heading">
      <div><p class="eyebrow">Visitor support</p><h2>Guest Services</h2><p class="section-copy">Request help with a lost item, accessibility, tickets, a separated party, or another festival question.</p></div>
      <a class="button secondary" href="tel:${escapeAttr(phone)}">Call Guest Services</a>
    </div>
    <p class="guest-services-emergency"><strong>For an immediate threat or medical emergency, call 911.</strong> Do not submit health information, payment details, government IDs, or passwords.</p>
    <div class="guest-services-layout">
      <form id="guest-services-form" class="guest-services-form" data-turnstile-action="guest_services_request" data-public-intake-state="checking">
        <div class="partner-form-title"><span>New request</span><h3>How can we help?</h3></div>
        <div class="guest-services-fields">
          <label>Type of help<select name="category" required disabled>${categoryOptions()}</select></label>
          <label>Festival day<select name="festivalDay"><option value="">Not sure</option><option>Friday</option><option>Saturday</option><option>Sunday</option></select></label>
          <label class="guest-services-wide">Short summary<input name="title" required minlength="4" maxlength="140" /></label>
          <label class="guest-services-wide">Details<textarea name="details" required minlength="10" maxlength="2000" rows="4"></textarea></label>
          <label>Where did this happen?<input name="location" maxlength="160" placeholder="Gate, booth, or beach marker" /></label>
          <label>Contact name<input name="contactName" required maxlength="120" autocomplete="name" /></label>
          <label>Email<input name="contactEmail" type="email" maxlength="254" autocomplete="email" /></label>
          <label>Mobile<input name="contactPhone" type="tel" maxlength="40" autocomplete="tel" /></label>
          <label>Preferred reply<select name="contactPreference"><option value="email">Email</option><option value="phone">Phone</option></select></label>
        </div>
        <p class="partner-data-use-note">Texas SandFest uses these details only to respond to and operate this Guest Services request. The private status capability is not included in staff exports or public pages.</p>
        <label class="partner-consent"><input name="consentToContact" type="checkbox" required /><span>I agree that Texas SandFest may store these details and contact me about this request.</span></label>
        <div class="partner-verification" data-turnstile-verification hidden><div data-turnstile-widget></div></div>
        <button class="button primary" type="submit" disabled>Checking availability...</button>
        <p class="partner-form-status" aria-live="polite"></p>
      </form>
      <div class="guest-services-status-panel">
        <form id="guest-services-status-form" class="guest-services-status-form">
          <div class="partner-form-title"><span>Private status</span><h3>Track a request</h3></div>
          <p>Use the reference and private access code created with your request.</p>
          <label>Request reference<input name="reference" required maxlength="40" autocomplete="off" placeholder="TSF-GS-XXXXXXXX" /></label>
          <label>Private access code<input name="token" required type="password" maxlength="240" autocomplete="off" placeholder="tsfg_..." /></label>
          <div class="guest-services-status-actions"><button class="button primary" type="submit">View status</button><button id="guest-services-forget" class="button secondary" type="button" hidden>Forget this browser</button></div>
          <p class="partner-form-status" aria-live="polite"></p>
        </form>
        <div id="guest-services-status-result" class="guest-services-status-result" aria-live="polite" tabindex="-1"><div class="partner-status-empty"><strong>Your request stays private</strong><span>Status updates appear here after secure access.</span></div></div>
      </div>
    </div>`;
}

export function createGuestServicesUi({ apiBase, eventPhone, intakeReady, turnstileSiteKey = "" }) {
  const root = document.querySelector("#guest-services");
  if (!root) return { mount: () => {}, loadStatus: () => null };
  let botProtection = { enabled: false, tokenFor: () => "", reset: () => {} };
  let botPromise = null;
  let intakeAvailable = false;

  function applyReadiness(payload = {}) {
    const form = root.querySelector("#guest-services-form");
    const select = form.querySelector('[name="category"]');
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".partner-form-status");
    const categories = Array.isArray(payload.categories)
      ? payload.categories.filter(category => category?.id && category?.label).slice(0, 20)
      : [];
    intakeAvailable = intakeReady === true && payload.available === true && categories.length > 0;
    form.dataset.publicIntakeState = intakeAvailable ? "ready" : "unavailable";
    select.innerHTML = categoryOptions(categories);
    select.disabled = !intakeAvailable;
    button.disabled = !intakeAvailable;
    button.textContent = intakeAvailable ? "Send request" : "Guest Services unavailable";
    setStatus(status, intakeAvailable ? "" : "Online requests are temporarily unavailable. Call Guest Services for help.", intakeAvailable ? "idle" : "error");
  }

  async function loadReadiness() {
    try {
      const response = await requestWithTimeout(`${apiBase()}/api/public/guest-services`, { cache: "no-store" }, 10_000);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Guest Services availability could not be confirmed.");
      applyReadiness(payload);
      return payload;
    } catch {
      applyReadiness();
      return null;
    } finally {
      root.setAttribute("aria-busy", "false");
    }
  }

  async function ensureBotProtection() {
    if (!turnstileSiteKey) return;
    botPromise ||= import("./partner-bot-protection.js").then(({ createPartnerBotProtection }) => createPartnerBotProtection({ siteKey: turnstileSiteKey, forms: [root.querySelector("#guest-services-form")] })).then(instance => { botProtection = instance; });
    return botPromise;
  }

  function renderStatus(request) {
    const target = root.querySelector("#guest-services-status-result");
    const updates = (request.updates || []).slice().reverse();
    target.innerHTML = `<div class="guest-services-status-heading"><div><span>${escapeHtml(request.reference)}</span><h4>${escapeHtml(request.title)}</h4></div><b data-status="${escapeAttr(request.status)}">${escapeHtml(statusLabel(request.status))}</b></div>
      <dl class="guest-services-status-summary"><div><dt>Request type</dt><dd>${escapeHtml(request.categoryLabel)}</dd></div><div><dt>Response team</dt><dd>${escapeHtml(teamLabel(request.assignedTeam))}</dd></div><div><dt>Last updated</dt><dd>${escapeHtml(displayDate(request.updatedAt))}</dd></div></dl>
      <div class="guest-services-public-updates">${updates.map(update => `<article><strong>${escapeHtml(statusLabel(update.status))}</strong><span>${escapeHtml(update.message)}</span><time>${escapeHtml(displayDate(update.at))}</time></article>`).join("") || "<p>No public updates yet.</p>"}</div>`;
    root.querySelector("#guest-services-forget").hidden = false;
  }

  async function loadStatus(access, { focus = false } = {}) {
    const form = root.querySelector("#guest-services-status-form");
    const status = form.querySelector(".partner-form-status");
    const button = form.querySelector('button[type="submit"]');
    if (!access?.reference || !access?.token) return null;
    form.elements.reference.value = access.reference;
    form.elements.token.value = access.token;
    button.disabled = true;
    setStatus(status, "Checking private status...", "loading");
    try {
      const response = await requestWithTimeout(`${apiBase()}/api/public/guest-services/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(access), cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Status request failed with ${response.status}`);
      remember(access);
      renderStatus(data.request);
      setStatus(status, "Private status loaded.", "ok");
      if (focus) root.querySelector("#guest-services-status-result").focus({ preventScroll: true });
      return data.request;
    } catch (error) {
      setStatus(status, friendlyError(error, "Private status could not be loaded."), "error");
      throw error;
    } finally {
      button.disabled = false;
    }
  }

  async function submit(form) {
    const status = form.querySelector(".partner-form-status");
    const button = form.querySelector('button[type="submit"]');
    if (!intakeAvailable) {
      setStatus(status, "Online requests are temporarily unavailable. Call Guest Services for help.", "error");
      return;
    }
    await ensureBotProtection();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.consentToContact = form.elements.consentToContact.checked === true;
    if (turnstileSiteKey) payload.botToken = botProtection.tokenFor(form);
    form.dataset.idempotencyKey ||= `guest-services-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    button.disabled = true;
    setStatus(status, "Sending your request...", "loading");
    try {
      const response = await requestWithTimeout(`${apiBase()}/api/public/guest-services`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": form.dataset.idempotencyKey }, body: JSON.stringify(payload), cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
      remember(data.access);
      renderStatus(data.request);
      const statusForm = root.querySelector("#guest-services-status-form");
      statusForm.elements.reference.value = data.access.reference;
      statusForm.elements.token.value = data.access.token;
      setStatus(status, `Request ${data.request.reference} was received. Its private status is open on this browser.`, "ok");
      form.reset();
      delete form.dataset.idempotencyKey;
      botProtection.reset(form);
      root.querySelector("#guest-services-status-result").focus({ preventScroll: true });
    } catch (error) {
      setStatus(status, friendlyError(error, "Guest Services request could not be sent."), "error");
      botProtection.reset(form);
    } finally {
      button.disabled = !intakeAvailable;
    }
  }

  function forget() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    const form = root.querySelector("#guest-services-status-form");
    form.reset();
    root.querySelector("#guest-services-forget").hidden = true;
    root.querySelector("#guest-services-status-result").innerHTML = '<div class="partner-status-empty"><strong>Your request stays private</strong><span>Status updates appear here after secure access.</span></div>';
    setStatus(form.querySelector(".partner-form-status"), "Private access removed from this browser.", "ok");
  }

  function mount() {
    root.innerHTML = markup({ eventPhone });
    root.setAttribute("aria-busy", "true");
    const intake = root.querySelector("#guest-services-form");
    intake.addEventListener("submit", event => { event.preventDefault(); void submit(intake); });
    if (turnstileSiteKey) {
      intake.addEventListener("focusin", () => { void ensureBotProtection(); }, { once: true });
      intake.addEventListener("pointerdown", () => { void ensureBotProtection(); }, { once: true });
    }
    root.querySelector("#guest-services-status-form").addEventListener("submit", event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      void loadStatus({ reference: values.reference.trim(), token: values.token.trim() }, { focus: true });
    });
    root.querySelector("#guest-services-forget").addEventListener("click", forget);
    const existing = saved();
    if (existing) void loadStatus(existing).catch(() => null);
    return loadReadiness();
  }

  return { loadStatus, mount };
}

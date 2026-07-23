import { publicPartnerServerReadinessSafety } from "../lib/public-partner-server-readiness.mjs";

export function createPartnerIntakeReadinessUi({
  bundleReadiness,
  eventId,
  apiBase,
  fetchWithTimeout,
  turnstileSiteKey,
  getBotProtection,
  initBotProtection,
  formPayload,
  setFormStatus,
  friendlyRequestError,
  escapeHtml,
  escapeAttr,
  getProgram,
  rememberPortalAccess,
  loadPortalStatus,
  clearSponsorInvitation,
  renderSponsorChoices,
  renderVendorChoices,
  onChange
}) {
  let state = { status: "checking", readiness: null };

  const intakeAvailable = () => bundleReadiness.ready && state.readiness?.intakeAvailable === true;
  const recoveryAvailable = () => bundleReadiness.ready && state.readiness?.recoveryAvailable === true;
  const intakeUnavailableMessage = () => {
    if (!bundleReadiness.ready) return bundleReadiness.message;
    if (state.status === "checking") return "Checking secure online application availability.";
    return "Online partner applications are temporarily unavailable. View the current programs or contact SandFest for help.";
  };
  const recoveryUnavailableMessage = () => {
    if (!bundleReadiness.ready) return bundleReadiness.message;
    if (state.status === "checking") return "Checking private-access email availability.";
    return "Private-access email is temporarily unavailable. Use your saved private link or contact the SandFest team.";
  };
  const contactFallback = (kind, readinessStatus) => {
    if (["loading", "checking"].includes(readinessStatus)) return "";
    if (kind === "sponsor") return ' or <a href="mailto:sponsors@texassandfest.org">email the sponsorship team</a>';
    if (kind === "vendor") return ' or <a href="mailto:vendors@texassandfest.org">email the vendor team</a>';
    return "";
  };

  function renderRecovery() {
    const form = document.querySelector("#partner-portal-recovery-form");
    if (!form) return;
    const button = form.querySelector('button[type="submit"]');
    const availability = form.querySelector("[data-partner-recovery-availability]");
    const ready = recoveryAvailable();
    const checking = bundleReadiness.ready && state.status === "checking";
    form.dataset.publicIntakeState = ready ? "ready" : checking ? "checking" : "unavailable";
    form.setAttribute("aria-busy", String(checking));
    if (availability) {
      availability.hidden = ready;
      availability.textContent = checking
        ? "Checking private-access email availability."
        : recoveryUnavailableMessage();
    }
    if (button) {
      button.disabled = !ready;
      button.textContent = ready
        ? "Email private access link"
        : checking ? "Checking availability..." : "Private-access email unavailable";
    }
  }

  function publish() {
    renderRecovery();
    onChange?.();
  }

  async function load() {
    try {
      const response = await fetchWithTimeout(`${apiBase()}/api/public/partner-intake`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      const safety = publicPartnerServerReadinessSafety(data, { eventId });
      if (!response.ok || !safety.ready) throw new Error("Partner readiness could not be confirmed.");
      state = { status: "ready", readiness: data };
    } catch {
      state = { status: "unavailable", readiness: null };
    }
    publish();
    return state.readiness;
  }

  async function submitRecovery(form) {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".partner-form-status");
    if (!recoveryAvailable()) {
      setFormStatus(status, recoveryUnavailableMessage(), "error");
      return;
    }
    if (turnstileSiteKey && !getBotProtection().enabled) await initBotProtection();
    if (turnstileSiteKey && !getBotProtection().tokenFor(form)) {
      setFormStatus(status, "Complete the security check and try again.", "error");
      return;
    }
    const fallbackKey = () => `recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const idempotencyKey = form.dataset.idempotencyKey || globalThis.crypto?.randomUUID?.() || fallbackKey();
    form.dataset.idempotencyKey = idempotencyKey;
    button.disabled = true;
    setFormStatus(status, "Requesting access...", "loading");
    try {
      const response = await fetchWithTimeout(`${apiBase()}/api/public/partner-portal-recovery`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(formPayload(form))
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const requestError = new Error(data.error || `Access request failed with ${response.status}`);
        requestError.status = response.status;
        requestError.retryAfter = response.headers.get("retry-after");
        throw requestError;
      }
      setFormStatus(status, data.message || "If the reference and email match an application, a private access link will be sent shortly.", "ok");
      delete form.dataset.idempotencyKey;
      form.elements.contactEmail.value = "";
      getBotProtection().reset(form);
    } catch (error) {
      if ([400, 401, 403, 422].includes(error.status)) delete form.dataset.idempotencyKey;
      const message = error.status === 429
        ? `Too many attempts. Wait${error.retryAfter ? ` ${error.retryAfter} seconds` : " a moment"} and try again.`
        : friendlyRequestError(error, "Private access email is temporarily unavailable. Try again shortly.");
      setFormStatus(status, message, "error");
      getBotProtection().reset(form);
    } finally {
      renderRecovery();
    }
  }

  async function submitPartner(form, endpoint) {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".partner-form-status");
    const program = getProgram(form);
    if (!program.available) {
      setFormStatus(status, program.message, "error");
      return;
    }
    if (!intakeAvailable()) {
      setFormStatus(status, intakeUnavailableMessage(), "error");
      return;
    }
    if (turnstileSiteKey && !getBotProtection().enabled) await initBotProtection();
    if (turnstileSiteKey && !getBotProtection().tokenFor(form)) {
      setFormStatus(status, "Complete the security check and try again.", "error");
      return;
    }
    const fallbackKey = () => `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    const idempotencyKey = form.dataset.idempotencyKey || globalThis.crypto?.randomUUID?.() || fallbackKey();
    form.dataset.idempotencyKey = idempotencyKey;
    button.disabled = true;
    setFormStatus(status, "Submitting...", "loading");
    try {
      const response = await fetchWithTimeout(`${apiBase()}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(formPayload(form))
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const submissionError = new Error(data.error || `Submission failed with ${response.status}`);
        submissionError.status = response.status;
        submissionError.retryAfter = response.headers.get("retry-after");
        throw submissionError;
      }
      const isVendorInterest = data.application.type === "vendor" && data.application.intakeMode === "interest";
      const submissionLabel = isVendorInterest ? "Interest" : "Application";
      setFormStatus(
        status,
        `<strong>${data.duplicate ? `${submissionLabel} already received.` : `${submissionLabel} received.`}</strong> Reference ${escapeHtml(data.application.reference)}. ${escapeHtml(data.nextStep)}`,
        "ok",
        { html: true }
      );
      const portalAccess = { reference: data.application.reference, token: data.portalAccess?.token };
      if (portalAccess.token) {
        rememberPortalAccess(portalAccess);
        await loadPortalStatus(portalAccess, { scroll: true });
      }
      clearSponsorInvitation(form);
      delete form.dataset.idempotencyKey;
      form.reset();
      if (form.id === "vendor-application-form") {
        form.elements.state.value = "TX";
        renderVendorChoices();
      } else if (form.id === "sponsor-inquiry-form") {
        renderSponsorChoices();
      }
      getBotProtection().reset(form);
    } catch (error) {
      if ([400, 401, 403, 409, 422].includes(error.status)) delete form.dataset.idempotencyKey;
      const message = error.status === 409 && /not been published/i.test(error.message)
        ? error.message
        : error.status === 409
          ? "These submission details changed after an earlier attempt. Review them and submit once more."
          : error.status === 429
            ? `Too many attempts. Wait${error.retryAfter ? ` ${error.retryAfter} seconds` : " a moment"} and try again; your entries are still here.`
            : !error.status
              ? `${friendlyRequestError(error)} Your entries are still here, and retry protection remains active.`
              : error.message;
      setFormStatus(status, message, "error");
      getBotProtection().reset(form);
    } finally {
      if (form.id === "sponsor-inquiry-form") renderSponsorChoices();
      else renderVendorChoices();
    }
  }

  function sponsorShowcaseInitials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join("") || "TSF";
  }

  function sponsorShowcaseWebsite(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function renderSponsorShowcase(items = []) {
    const showcase = document.querySelector("#public-sponsor-showcase");
    const featured = document.querySelector("#public-sponsor-featured");
    if (!showcase) return;
    const sponsors = (Array.isArray(items) ? items : []).filter(item => item?.displayName);
    if (featured) featured.hidden = sponsors.length === 0;
    showcase.hidden = sponsors.length === 0;
    showcase.dataset.count = String(sponsors.length);
    showcase.innerHTML = sponsors.map(item => {
      const website = sponsorShowcaseWebsite(item.website);
      const primary = /^#[0-9A-F]{6}$/i.test(item.primaryColor || "") ? item.primaryColor : "#12333A";
      const secondary = /^#[0-9A-F]{6}$/i.test(item.secondaryColor || "") ? item.secondaryColor : "#F4B942";
      const assetPrefix = "/api/public/sponsor-showcase/assets/";
      const candidateLogoPath = String(item.logo?.path || "");
      const logoAssetId = candidateLogoPath.startsWith(assetPrefix) ? candidateLogoPath.slice(assetPrefix.length) : "";
      const logoPath = /^[A-Za-z0-9._~-]+$/.test(logoAssetId) ? `${assetPrefix}${logoAssetId}` : "";
      const logo = logoPath
        ? `<img src="${escapeAttr(`${apiBase()}${logoPath}`)}" alt="${escapeAttr(item.logo?.label || `${item.displayName} logo`)}" loading="lazy" decoding="async" />`
        : `<span aria-hidden="true">${escapeHtml(sponsorShowcaseInitials(item.displayName))}</span>`;
      const content = `<span class="public-sponsor-mark">${logo}</span>
        <span class="public-sponsor-copy">
          ${item.packageName ? `<small>${escapeHtml(item.packageName)} partner</small>` : ""}
          <strong>${escapeHtml(item.displayName)}</strong>
          ${item.tagline ? `<span>${escapeHtml(item.tagline)}</span>` : ""}
          ${website ? '<span class="public-sponsor-visit">Visit partner <span aria-hidden="true">&#8599;</span></span>' : ""}
        </span>`;
      const style = `--sponsor-primary:${primary};--sponsor-secondary:${secondary}`;
      return website
        ? `<a class="public-sponsor-card" href="${escapeAttr(website)}" target="_blank" rel="noopener noreferrer" style="${escapeAttr(style)}">${content}</a>`
        : `<article class="public-sponsor-card" style="${escapeAttr(style)}">${content}</article>`;
    }).join("");
  }

  return {
    intakeAvailable,
    recoveryAvailable,
    intakeUnavailableMessage,
    contactFallback,
    status: () => state.status,
    load,
    renderRecovery,
    submitRecovery,
    submitPartner,
    renderSponsorShowcase
  };
}

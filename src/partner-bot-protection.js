const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstileScript(documentRef, windowRef) {
  if (windowRef.turnstile?.render) return Promise.resolve(windowRef.turnstile);
  const existing = documentRef.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`);

  return new Promise((resolve, reject) => {
    const script = existing || documentRef.createElement("script");
    const timeout = windowRef.setTimeout(() => reject(new Error("Security verification did not load.")), 15_000);
    const finish = () => {
      windowRef.clearTimeout(timeout);
      if (windowRef.turnstile?.render) resolve(windowRef.turnstile);
      else reject(new Error("Security verification did not initialize."));
    };
    const fail = () => {
      windowRef.clearTimeout(timeout);
      reject(new Error("Security verification is unavailable."));
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      documentRef.head.append(script);
    }
  });
}

export async function createPartnerBotProtection(options = {}) {
  const siteKey = String(options.siteKey || "").trim();
  const documentRef = options.documentRef ?? document;
  const windowRef = options.windowRef ?? window;
  const forms = [...(options.forms ?? documentRef.querySelectorAll("form[data-turnstile-action]"))];
  if (!siteKey || !forms.length) {
    return { enabled: false, tokenFor: () => "", reset: () => {}, destroy: () => {} };
  }

  const turnstile = await loadTurnstileScript(documentRef, windowRef);
  const entries = new Map();

  for (const form of forms) {
    const wrapper = form.querySelector("[data-turnstile-verification]");
    const container = wrapper?.querySelector("[data-turnstile-widget]");
    const action = String(form.dataset.turnstileAction || "partner_intake").slice(0, 32);
    if (!wrapper || !container) continue;

    wrapper.hidden = false;
    const state = { token: "", widgetId: null };
    state.widgetId = turnstile.render(container, {
      sitekey: siteKey,
      action,
      theme: "light",
      size: "flexible",
      callback: token => { state.token = String(token || ""); },
      "expired-callback": () => { state.token = ""; },
      "timeout-callback": () => { state.token = ""; },
      "error-callback": () => { state.token = ""; }
    });
    entries.set(form, state);
  }

  return {
    enabled: true,
    tokenFor(form) {
      return entries.get(form)?.token || "";
    },
    reset(form) {
      const state = entries.get(form);
      if (!state) return;
      state.token = "";
      turnstile.reset(state.widgetId);
    },
    destroy() {
      for (const state of entries.values()) turnstile.remove(state.widgetId);
      entries.clear();
    }
  };
}

function clearCreationRetry(form) {
  delete form.dataset.idempotencyKey;
}

function creationRetryKey(form) {
  if (!form.dataset.creationTracked) {
    form.addEventListener("input", () => clearCreationRetry(form));
    form.dataset.creationTracked = "true";
  }
  return form.dataset.idempotencyKey ||= crypto.randomUUID();
}

function setCreationStatus(form, message, state, setAdminStatus) {
  const status = form.querySelector(".partner-form-status");
  if (status) {
    status.textContent = message;
    status.dataset.state = state;
    status.role = state === "error" ? "alert" : "status";
    status.ariaLive = state === "error" ? "assertive" : "polite";
  }
  setAdminStatus(message, state);
}

export async function submitCreation(form, path, body, recovery, message, deps, after, disabled = () => false, reset = true) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await deps.adminFetch(path, {
      method: "POST",
      headers: { "idempotency-key": creationRetryKey(form) },
      body: JSON.stringify(body)
    });
    clearCreationRetry(form);
    if (reset) form.reset();
    await deps.loadAdminPartners({ quiet: true });
    after?.(data);
    setCreationStatus(form, typeof message === "function" ? message(data) : message, "ok", deps.setAdminStatus);
  } catch (error) {
    const ambiguous = deps.requestOutcomeIsAmbiguous(error);
    if (!ambiguous) clearCreationRetry(form);
    setCreationStatus(form, ambiguous ? `${error.message} ${recovery}` : error.message, "error", deps.setAdminStatus);
  } finally {
    button.disabled = disabled();
  }
}

export { setCreationStatus };

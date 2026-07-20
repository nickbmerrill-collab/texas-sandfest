import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";

function resolutionMarkup(notification) {
  return `<p class="admin-delivery-resolution" data-resolution="${escapeAttr(notification.deliveryResolution)}">
    ${notification.deliveryResolution === "confirmed_sent" ? "Provider delivery confirmed" : "Provider confirmed no delivery"}${notification.deliveryReconciledAt ? ` · ${escapeHtml(new Date(notification.deliveryReconciledAt).toLocaleString())}` : ""}${notification.deliveryResolutionNote ? ` · ${escapeHtml(notification.deliveryResolutionNote)}` : ""}
  </p>`;
}

export function bindIncidentDeliveryReconciliation(container, {
  adminFetch,
  canWrite,
  dispatches,
  loadAdminConditions,
  setAdminStatus
}) {
  const dispatchById = new Map((dispatches || []).map(dispatch => [dispatch.id, dispatch]));
  for (const slot of container.querySelectorAll("[data-delivery-resolution-slot]")) {
    slot.outerHTML = resolutionMarkup(dispatchById.get(slot.dataset.deliveryResolutionSlot)?.notification || {});
  }
  const template = document.querySelector("#admin-delivery-reconciliation-template");
  if (!template) return;
  for (const slot of container.querySelectorAll("[data-reconcile-dispatch-slot]")) {
    const form = template.content.firstElementChild.cloneNode(true);
    form.dataset.incidentId = slot.dataset.incidentId;
    form.dataset.dispatchId = slot.dataset.dispatchId;
    for (const control of form.elements) control.disabled = !canWrite;
    slot.replaceWith(form);
  }
  for (const form of container.querySelectorAll("[data-reconcile-dispatch]")) form.addEventListener("submit", async event => {
    event.preventDefault();
    const action = event.submitter?.value;
    const buttons = form.querySelectorAll('button[type="submit"]');
    buttons.forEach(button => { button.disabled = true; });
    try {
      await adminFetch(`/api/admin/island-conditions/incidents/${encodeURIComponent(form.dataset.incidentId)}/dispatches/${encodeURIComponent(form.dataset.dispatchId)}/delivery-reconciliation`, {
        method: "POST",
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), action })
      });
      await loadAdminConditions({ quiet: true });
      setAdminStatus(action === "confirmed_sent" ? "Provider delivery recorded." : "Provider confirmed no delivery; the outcome is ready for staff follow-up.", "ok");
    } catch (error) {
      setAdminStatus(error.message, "error");
      buttons.forEach(button => { button.disabled = !canWrite; });
    }
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function money(amountCents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "usd").toUpperCase()
  }).format(Number(amountCents || 0) / 100);
}

export function showPartnerPaymentSandbox(checkout, { complete, onComplete }) {
  if (checkout?.mode !== "board_sandbox"
    || checkout.completeEndpoint !== "/api/public/board-partner-checkout/complete"
    || typeof checkout.token !== "string"
    || !Number.isInteger(checkout.amountCents)
    || checkout.amountCents < 1) {
    throw new Error("The local partner payment sandbox returned an invalid checkout.");
  }
  const invoice = document.querySelector(".partner-status-invoice");
  if (!invoice) throw new Error("The invoice payment panel is unavailable.");
  invoice.querySelector("[data-partner-payment-sandbox]")?.remove();

  const panel = element("section", "ticket-demo-checkout partner-payment-sandbox");
  panel.style.gridColumn = "1 / -1";
  panel.style.margin = "4px 0 0";
  panel.dataset.partnerPaymentSandbox = "true";
  panel.setAttribute("aria-label", "Local partner payment sandbox");
  const header = element("header");
  const heading = element("div");
  heading.append(element("span", "", "Local payment sandbox"), element("strong", "", "Review invoice payment"));
  header.append(heading, element("b", "", `${money(checkout.amountCents, checkout.currency)} demo`));
  const note = element("p", "", "This records the approved invoice payment in the isolated board runtime. No external charge is sent.");
  note.style.margin = "0";
  panel.append(header, note);

  const actions = element("div", "ticket-demo-actions");
  const pay = element("button", "button primary", "Complete demo payment");
  pay.type = "button";
  pay.dataset.completePartnerDemoPayment = "true";
  const cancel = element("button", "button secondary", "Return to invoice");
  cancel.type = "button";
  actions.append(pay, cancel);
  const status = element("p", "partner-payment-status", "Ready to record the local demonstration payment.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(actions, status);
  invoice.append(panel);

  cancel.addEventListener("click", () => panel.remove());
  pay.addEventListener("click", async () => {
    pay.disabled = true;
    cancel.disabled = true;
    status.dataset.state = "loading";
    status.textContent = "Recording demonstration payment...";
    try {
      const result = await complete(checkout.completeEndpoint, checkout.token);
      if (!result?.application || result.receipt?.environment !== "board_sandbox") {
        throw new Error("The local payment receipt was incomplete.");
      }
      onComplete(result.application, result.receipt);
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error.message;
      pay.disabled = false;
      cancel.disabled = false;
    }
  });
  pay.focus();
}

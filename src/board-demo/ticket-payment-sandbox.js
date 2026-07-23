function money(amountCents, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency).toUpperCase()
  }).format(Number(amountCents || 0) / 100);
}

function summaryLine(label, value) {
  const line = document.createElement("p");
  const name = document.createElement("span");
  const detail = document.createElement("strong");
  name.textContent = label;
  detail.textContent = value;
  line.append(name, detail);
  return line;
}

function ambiguousOutcome(error) {
  return ["request_timeout", "network_error"].includes(error?.code)
    || [408, 429].includes(error?.status)
    || error?.status >= 500;
}

export function showTicketPaymentSandbox(checkout, { complete, onCancel, onComplete }) {
  if (checkout?.mode !== "board_sandbox"
    || checkout.completeEndpoint !== "/api/public/board-ticket-checkout/complete"
    || typeof checkout.token !== "string"
    || !Number.isInteger(checkout.amountCents)
    || checkout.amountCents < 1
    || !Array.isArray(checkout.lineItems)) {
    throw new Error("The local payment sandbox returned an invalid checkout.");
  }
  const panel = document.querySelector("#ticket-demo-checkout");
  const amount = document.querySelector("#ticket-demo-amount");
  const summary = document.querySelector("#ticket-demo-summary");
  const status = document.querySelector("#ticket-demo-status");
  const pay = document.querySelector("#ticket-demo-pay");
  const cancel = document.querySelector("#ticket-demo-cancel");
  if (!panel || !amount || !summary || !status || !pay || !cancel) {
    throw new Error("The local payment sandbox is unavailable.");
  }

  amount.textContent = `${money(checkout.amountCents, checkout.currency)} demo`;
  summary.replaceChildren(...checkout.lineItems.map(line => summaryLine(
    `${line.quantity} x ${line.name}`,
    money(line.unitAmount * line.quantity, checkout.currency)
  )));
  status.textContent = "Ready to simulate an approved payment. This stays on the local board runtime.";
  status.dataset.state = "idle";
  pay.hidden = false;
  pay.disabled = false;
  cancel.hidden = false;
  cancel.disabled = false;
  panel.hidden = false;

  cancel.onclick = () => onCancel();
  pay.onclick = async () => {
    pay.disabled = true;
    cancel.disabled = true;
    status.dataset.state = "loading";
    status.textContent = "Recording the local payment and creating fulfillment...";
    try {
      const result = await complete(checkout.completeEndpoint, checkout.token);
      const receipt = result?.receipt;
      if (result?.order?.status !== "paid" || receipt?.environment !== "board_sandbox") {
        throw new Error("The local payment did not return a paid receipt.");
      }
      onComplete(result);
      summary.replaceChildren(
        summaryLine("Order", receipt.orderId),
        summaryLine("Fulfillment", `${receipt.fulfillmentCount} wristband${receipt.fulfillmentCount === 1 ? "" : "s"} queued`)
      );
      pay.hidden = true;
      cancel.hidden = true;
      status.dataset.state = "ok";
      status.textContent = "Demo payment complete. The order, payment event, fulfillment, and ticket revenue are now visible in operations.";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = ambiguousOutcome(error)
        ? `${error.message} The payment result could not be confirmed. Select Complete demo payment again; the same order will be reused.`
        : error.message;
      pay.disabled = false;
      cancel.disabled = false;
    }
  };
  pay.focus();
}

// Twilio SMS scaffold — Phase 1 glue from docs/research/08-marketing-communications.md.
//
// Disabled by default (SMS_ENABLED=false). When enabled and credentials are
// present, sends via Twilio REST API. Never throws into the alert publish path
// on network failure — returns a structured result so ops can see skip/fail.
//
// Production requirements before enabling:
//   - A2P 10DLC brand + separate marketing vs emergency campaigns
//   - Short code for 100k-scale safety blasts (provision weeks ahead)
//   - Consent captured at checkout (lib/consent.mjs); STOP/HELP handling

export function smsConfigFromEnv(env = process.env) {
  const enabled = env.SMS_ENABLED === "true";
  const accountSid = env.TWILIO_ACCOUNT_SID || "";
  const authToken = env.TWILIO_AUTH_TOKEN || "";
  const fromNumber = env.TWILIO_FROM_NUMBER || "";
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID || "";
  const hasAuth = Boolean(accountSid && authToken);
  const hasFrom = Boolean(messagingServiceSid || fromNumber);
  return {
    enabled,
    accountSid,
    authTokenConfigured: Boolean(authToken),
    fromNumber: fromNumber || null,
    messagingServiceSid: messagingServiceSid || null,
    ready: enabled && hasAuth && hasFrom,
    reason: !enabled
      ? "SMS_ENABLED is not true."
      : !hasAuth
        ? "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required."
        : !hasFrom
          ? "Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER."
          : "ready"
  };
}

/**
 * Send one SMS. Pure-ish: takes an optional fetchImpl for tests.
 * Returns { ok, skipped?, status, sid?, error?, to, bodyPreview }.
 */
export async function sendSms(to, body, opts = {}) {
  const config = opts.config || smsConfigFromEnv(opts.env || process.env);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const text = String(body ?? "").trim().slice(0, 1600);
  const destination = String(to ?? "").trim();

  if (!destination) {
    return { ok: false, error: "Missing destination phone number.", to: null, bodyPreview: text.slice(0, 80) };
  }
  if (!text) {
    return { ok: false, error: "SMS body is empty.", to: destination, bodyPreview: "" };
  }
  if (!config.ready) {
    return {
      ok: false,
      skipped: true,
      status: "skipped",
      error: config.reason,
      to: destination,
      bodyPreview: text.slice(0, 80)
    };
  }

  const params = new URLSearchParams();
  params.set("To", destination);
  params.set("Body", text);
  if (config.messagingServiceSid) {
    params.set("MessagingServiceSid", config.messagingServiceSid);
  } else {
    params.set("From", config.fromNumber);
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.accountSid}:${opts.env?.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || ""}`).toString("base64");

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: "error",
        error: data.message || data.error_message || `Twilio HTTP ${response.status}`,
        to: destination,
        bodyPreview: text.slice(0, 80),
        twilioCode: data.code ?? null
      };
    }
    return {
      ok: true,
      status: data.status || "queued",
      sid: data.sid || null,
      to: destination,
      bodyPreview: text.slice(0, 80)
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error.message || "Twilio request failed.",
      to: destination,
      bodyPreview: text.slice(0, 80)
    };
  }
}

/**
 * Fan-out a public alert to opted-in safety SMS recipients.
 * Caps at opts.limit (default 500) to avoid accidental full-list blast in dev.
 */
export async function sendAlertSms(alert, recipients = [], opts = {}) {
  const config = opts.config || smsConfigFromEnv(opts.env || process.env);
  const limit = opts.limit ?? 500;
  const title = String(alert?.title || "SandFest alert").trim();
  const message = String(alert?.message || "").trim();
  const body = `SandFest ${String(alert?.severity || "alert").toUpperCase()}: ${title}. ${message}`.slice(0, 320);
  const list = recipients.slice(0, limit);

  if (!config.ready) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: list.length,
      reason: config.reason,
      results: []
    };
  }

  const results = [];
  let sent = 0;
  let failed = 0;
  for (const recipient of list) {
    const phone = recipient.phone || recipient;
    const result = await sendSms(phone, body, { ...opts, config });
    results.push(result);
    if (result.ok) sent += 1;
    else if (!result.skipped) failed += 1;
  }

  return {
    attempted: list.length,
    sent,
    failed,
    skipped: results.filter(r => r.skipped).length,
    reason: null,
    results: results.slice(0, 20) // cap payload size in audit
  };
}

const DEFAULT_MINOR_VERSION = "75";

export function quickBooksConfig(env = process.env) {
  const environment = env.QB_ENVIRONMENT === "production" ? "production" : "sandbox";
  return {
    environment,
    invoiceSyncEnabled: env.QB_INVOICE_SYNC_ENABLED === "true",
    clientId: env.QB_CLIENT_ID || "",
    clientSecret: env.QB_CLIENT_SECRET || "",
    redirectUri: env.QB_REDIRECT_URI || "http://127.0.0.1:8787/api/integrations/quickbooks/callback",
    realmId: env.QB_REALM_ID || "",
    refreshToken: env.QB_REFRESH_TOKEN || "",
    minorVersion: env.QB_MINOR_VERSION || DEFAULT_MINOR_VERSION,
    authBaseUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    apiBaseUrl: environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com"
  };
}

export function quickBooksReadiness(env = process.env) {
  const config = quickBooksConfig(env);
  const required = ["clientId", "clientSecret", "redirectUri"];
  const missing = required.filter(key => !config[key]);
  const canBuildAuthUrl = missing.length === 0;
  const canRefreshToken = canBuildAuthUrl && Boolean(config.refreshToken);
  const canCallAccountingApi = canRefreshToken && Boolean(config.realmId);
  const canSyncPartnerInvoices = config.invoiceSyncEnabled && canCallAccountingApi;

  return {
    environment: config.environment,
    minorVersion: config.minorVersion,
    invoiceSyncEnabled: config.invoiceSyncEnabled,
    canBuildAuthUrl,
    canRefreshToken,
    canCallAccountingApi,
    canSyncPartnerInvoices,
    missing,
    reason: canSyncPartnerInvoices
      ? null
      : !config.invoiceSyncEnabled
        ? "QuickBooks invoice sync is disabled."
        : `QuickBooks is missing ${[...missing, ...(!config.refreshToken ? ["refreshToken"] : []), ...(!config.realmId ? ["realmId"] : [])].join(", ")}.`
  };
}

export function buildAuthorizationUrl({ state, scopes = ["com.intuit.quickbooks.accounting"] } = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.clientId) throw new Error("QB_CLIENT_ID is required");
  if (!config.redirectUri) throw new Error("QB_REDIRECT_URI is required");
  if (!state) throw new Error("state is required for CSRF protection");

  const url = new URL(config.authBaseUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.href;
}

export async function exchangeCodeForTokens({ code, realmId }, env = process.env, options = {}) {
  const config = quickBooksConfig(env);
  if (!code) throw new Error("authorization code is required");
  if (!realmId) throw new Error("realmId is required");
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri
  }, config, options.fetchImpl);
  return { realmId, ...token };
}

export async function refreshAccessToken(env = process.env, options = {}) {
  const config = quickBooksConfig(env);
  if (!config.refreshToken) throw new Error("QB_REFRESH_TOKEN is required");
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken
  }, config, options.fetchImpl);
}

export async function quickBooksQuery(query, { accessToken, fetchImpl = fetch } = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.realmId) throw new Error("QB_REALM_ID is required");
  if (!accessToken) throw new Error("accessToken is required");

  const url = new URL(`/v3/company/${config.realmId}/query`, config.apiBaseUrl);
  url.searchParams.set("minorversion", config.minorVersion);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json",
      "content-type": "application/text"
    },
    body: query
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`QuickBooks query failed: ${response.status} ${body}`);
  }
  return JSON.parse(body);
}

export async function quickBooksCreate(resourceName, payload, {
  accessToken,
  requestId,
  fetchImpl = fetch
} = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.realmId) throw new Error("QB_REALM_ID is required");
  if (!accessToken) throw new Error("accessToken is required");
  if (!/^[a-z]+$/i.test(String(resourceName || ""))) throw new Error("QuickBooks resource name is invalid");
  if (!payload || typeof payload !== "object") throw new Error("QuickBooks payload is required");

  const url = new URL(`/v3/company/${config.realmId}/${resourceName}`, config.apiBaseUrl);
  url.searchParams.set("minorversion", config.minorVersion);
  if (requestId) url.searchParams.set("requestid", String(requestId).slice(0, 50));

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`QuickBooks ${resourceName} create failed: ${response.status} ${body}`);
  }
  return JSON.parse(body);
}

export async function quickBooksRead(resourceName, resourceId, {
  accessToken,
  fetchImpl = fetch
} = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.realmId) throw new Error("QB_REALM_ID is required");
  if (!accessToken) throw new Error("accessToken is required");
  if (!/^[a-z]+$/i.test(String(resourceName || ""))) throw new Error("QuickBooks resource name is invalid");
  if (!/^[a-z0-9_-]+$/i.test(String(resourceId || ""))) throw new Error("QuickBooks resource ID is invalid");

  const url = new URL(`/v3/company/${config.realmId}/${resourceName}/${resourceId}`, config.apiBaseUrl);
  url.searchParams.set("minorversion", config.minorVersion);
  const response = await fetchImpl(url, {
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json"
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`QuickBooks ${resourceName} read failed: ${response.status} ${body}`);
  }
  return JSON.parse(body);
}

function queryLiteral(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function dateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invoice date is invalid");
  return date.toISOString().slice(0, 10);
}

function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (value == null || value === "") return false;
    if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
    return true;
  }));
}

export async function syncPartnerInvoiceToQuickBooks({ application, invoice }, options = {}, env = process.env) {
  const readiness = quickBooksReadiness(env);
  if (!readiness.canSyncPartnerInvoices) throw new Error(readiness.reason || "QuickBooks invoice sync is not ready.");
  if (!application?.id || !application.organizationName) throw new Error("Partner application is required");
  if (!invoice?.id || !Number.isInteger(invoice.amountCents) || invoice.amountCents <= 0) throw new Error("Approved invoice amount is required");
  if (!invoice.quickBooksItemId) throw new Error("A QuickBooks item ID is required for this invoice");

  const fetchImpl = options.fetchImpl || fetch;
  const token = await refreshAccessToken(env, { fetchImpl });
  const accessToken = token.access_token;
  if (!accessToken) throw new Error("QuickBooks token refresh returned no access token");

  const displayName = String(application.organizationName).trim().slice(0, 100);
  const found = await quickBooksQuery(
    `SELECT * FROM Customer WHERE DisplayName = '${queryLiteral(displayName)}' MAXRESULTS 1`,
    { accessToken, fetchImpl },
    env
  );
  let customer = found?.QueryResponse?.Customer?.[0] ?? null;
  let customerCreated = false;

  if (!customer) {
    const billAddr = compactObject({
      City: application.city || undefined,
      CountrySubDivisionCode: application.state || undefined,
      PostalCode: application.postalCode || undefined
    });
    const customerPayload = compactObject({
      DisplayName: displayName,
      CompanyName: displayName,
      PrimaryEmailAddr: application.contactEmail ? { Address: application.contactEmail } : undefined,
      PrimaryPhone: application.contactPhone ? { FreeFormNumber: application.contactPhone } : undefined,
      BillAddr: Object.keys(billAddr).length ? billAddr : undefined
    });
    const created = await quickBooksCreate("customer", customerPayload, {
      accessToken,
      requestId: `sf-customer-${String(application.id).slice(-36)}`,
      fetchImpl
    }, env);
    customer = created?.Customer ?? null;
    customerCreated = true;
  }
  if (!customer?.Id) throw new Error("QuickBooks customer response did not include an ID");

  const payload = compactObject({
    CustomerRef: { value: String(customer.Id) },
    TxnDate: dateOnly(invoice.approvedAt || invoice.createdAt),
    DueDate: dateOnly(invoice.dueAt),
    BillEmail: application.contactEmail ? { Address: application.contactEmail } : undefined,
    PrivateNote: `Texas SandFest ${application.reference || application.id} / ${invoice.id}`.slice(0, 4000),
    Line: [{
      Amount: invoice.amountCents / 100,
      DetailType: "SalesItemLineDetail",
      Description: String(invoice.description || `${application.type} package for ${application.organizationName}`).slice(0, 4000),
      SalesItemLineDetail: { ItemRef: { value: String(invoice.quickBooksItemId) } }
    }]
  });
  const createdInvoice = await quickBooksCreate("invoice", payload, {
    accessToken,
    requestId: `sf-invoice-${String(invoice.id).slice(-36)}`,
    fetchImpl
  }, env);
  const synced = createdInvoice?.Invoice;
  if (!synced?.Id) throw new Error("QuickBooks invoice response did not include an ID");

  return {
    ok: true,
    provider: "quickbooks",
    environment: readiness.environment,
    customerCreated,
    customerId: String(customer.Id),
    invoiceId: String(synced.Id),
    docNumber: synced.DocNumber ? String(synced.DocNumber) : null,
    totalCents: Number.isFinite(Number(synced.TotalAmt)) ? Math.round(Number(synced.TotalAmt) * 100) : invoice.amountCents,
    balanceCents: Number.isFinite(Number(synced.Balance)) ? Math.round(Number(synced.Balance) * 100) : invoice.amountCents,
    providerUpdatedAt: synced.MetaData?.LastUpdatedTime || null,
    syncedAt: new Date().toISOString()
  };
}

export async function reconcilePartnerInvoiceFromQuickBooks({ invoice }, options = {}, env = process.env) {
  const readiness = quickBooksReadiness(env);
  if (!readiness.canSyncPartnerInvoices) throw new Error(readiness.reason || "QuickBooks invoice reconciliation is not ready.");
  if (!invoice?.id || !invoice.quickBooksInvoiceId) throw new Error("A synced partner invoice is required");

  const fetchImpl = options.fetchImpl || fetch;
  const token = await refreshAccessToken(env, { fetchImpl });
  const accessToken = token.access_token;
  if (!accessToken) throw new Error("QuickBooks token refresh returned no access token");
  const response = await quickBooksRead("invoice", invoice.quickBooksInvoiceId, { accessToken, fetchImpl }, env);
  const current = response?.Invoice;
  if (!current?.Id || String(current.Id) !== String(invoice.quickBooksInvoiceId)) {
    throw new Error("QuickBooks invoice response did not match the requested invoice");
  }
  const total = Number(current.TotalAmt);
  const balance = Number(current.Balance);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(balance) || balance < 0) {
    throw new Error("QuickBooks invoice response did not include valid totals");
  }

  return {
    ok: true,
    provider: "quickbooks",
    environment: readiness.environment,
    invoiceId: String(current.Id),
    docNumber: current.DocNumber ? String(current.DocNumber) : null,
    totalCents: Math.round(total * 100),
    balanceCents: Math.round(balance * 100),
    providerUpdatedAt: current.MetaData?.LastUpdatedTime || null,
    reconciledAt: new Date().toISOString()
  };
}

export async function getCompanyInfo({ accessToken, fetchImpl = fetch } = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.realmId) throw new Error("QB_REALM_ID is required");
  if (!accessToken) throw new Error("accessToken is required");

  const url = new URL(`/v3/company/${config.realmId}/companyinfo/${config.realmId}`, config.apiBaseUrl);
  url.searchParams.set("minorversion", config.minorVersion);

  const response = await fetchImpl(url, {
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json"
    }
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`QuickBooks company info failed: ${response.status} ${body}`);
  }
  return JSON.parse(body);
}

async function tokenRequest(params, config, fetchImpl = fetch) {
  if (!config.clientId) throw new Error("QB_CLIENT_ID is required");
  if (!config.clientSecret) throw new Error("QB_CLIENT_SECRET is required");

  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: {
      "authorization": `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "accept": "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`QuickBooks token request failed: ${response.status} ${body}`);
  }
  return JSON.parse(body);
}

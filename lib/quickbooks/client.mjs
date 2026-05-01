const DEFAULT_MINOR_VERSION = "75";

export function quickBooksConfig(env = process.env) {
  const environment = env.QB_ENVIRONMENT === "production" ? "production" : "sandbox";
  return {
    environment,
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

  return {
    environment: config.environment,
    minorVersion: config.minorVersion,
    canBuildAuthUrl,
    canRefreshToken,
    canCallAccountingApi,
    missing
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

export async function exchangeCodeForTokens({ code, realmId }, env = process.env) {
  const config = quickBooksConfig(env);
  if (!code) throw new Error("authorization code is required");
  if (!realmId) throw new Error("realmId is required");
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri
  }, config);
  return { realmId, ...token };
}

export async function refreshAccessToken(env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.refreshToken) throw new Error("QB_REFRESH_TOKEN is required");
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken
  }, config);
}

export async function quickBooksQuery(query, { accessToken } = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.realmId) throw new Error("QB_REALM_ID is required");
  if (!accessToken) throw new Error("accessToken is required");

  const url = new URL(`/v3/company/${config.realmId}/query`, config.apiBaseUrl);
  url.searchParams.set("minorversion", config.minorVersion);

  const response = await fetch(url, {
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

export async function getCompanyInfo({ accessToken } = {}, env = process.env) {
  const config = quickBooksConfig(env);
  if (!config.realmId) throw new Error("QB_REALM_ID is required");
  if (!accessToken) throw new Error("accessToken is required");

  const url = new URL(`/v3/company/${config.realmId}/companyinfo/${config.realmId}`, config.apiBaseUrl);
  url.searchParams.set("minorversion", config.minorVersion);

  const response = await fetch(url, {
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

async function tokenRequest(params, config) {
  if (!config.clientId) throw new Error("QB_CLIENT_ID is required");
  if (!config.clientSecret) throw new Error("QB_CLIENT_SECRET is required");

  const response = await fetch(config.tokenUrl, {
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

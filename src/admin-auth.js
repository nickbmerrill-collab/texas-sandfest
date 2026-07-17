import { UserManager, WebStorageStateStore } from "oidc-client-ts";

const AUTH_CALLBACK_PARAMS = [
  "code",
  "state",
  "session_state",
  "iss",
  "error",
  "error_description",
  "error_uri"
];

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required when admin auth mode is oidc.`);
  return normalized;
}

function browserUrl(value, name, { allowLocalHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(allowLocalHttp && local)) {
    throw new Error(`${name} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain credentials.`);
  return parsed.href;
}

export function normalizeAdminAuthConfig(env = {}, locationHref = "http://127.0.0.1/") {
  const mode = String(env.VITE_SANDFEST_AUTH_MODE || "token").trim().toLowerCase();
  if (!new Set(["token", "oidc"]).has(mode)) {
    throw new Error("VITE_SANDFEST_AUTH_MODE must be token or oidc.");
  }
  if (mode === "token") return { mode };

  const location = new URL(locationHref);
  location.search = "";
  location.hash = "";
  const allowLocalHttp = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  const issuer = browserUrl(required(env.VITE_SANDFEST_AUTH_ISSUER, "VITE_SANDFEST_AUTH_ISSUER"), "VITE_SANDFEST_AUTH_ISSUER", { allowLocalHttp });
  const clientId = required(env.VITE_SANDFEST_AUTH_CLIENT_ID, "VITE_SANDFEST_AUTH_CLIENT_ID");
  const redirectUri = browserUrl(env.VITE_SANDFEST_AUTH_REDIRECT_URI || location.href, "VITE_SANDFEST_AUTH_REDIRECT_URI", { allowLocalHttp });
  const postLogoutRedirectUri = browserUrl(env.VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI || redirectUri, "VITE_SANDFEST_AUTH_POST_LOGOUT_REDIRECT_URI", { allowLocalHttp });
  const metadataUrl = env.VITE_SANDFEST_AUTH_METADATA_URL
    ? browserUrl(env.VITE_SANDFEST_AUTH_METADATA_URL, "VITE_SANDFEST_AUTH_METADATA_URL", { allowLocalHttp })
    : null;
  const scope = String(env.VITE_SANDFEST_AUTH_SCOPES || "openid profile email")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  if (!scope.split(" ").includes("openid")) {
    throw new Error("VITE_SANDFEST_AUTH_SCOPES must include openid.");
  }

  return {
    mode,
    issuer,
    clientId,
    redirectUri,
    postLogoutRedirectUri,
    metadataUrl,
    scope,
    audience: String(env.VITE_SANDFEST_AUTH_AUDIENCE || "").trim() || null
  };
}

export function isSigninCallback(locationHref) {
  const params = new URL(locationHref).searchParams;
  return params.has("state") && (params.has("code") || params.has("error"));
}

export function isSignoutCallback(locationHref) {
  const params = new URL(locationHref).searchParams;
  return params.has("state") && !params.has("code") && !params.has("error");
}

export function cleanAuthCallbackUrl(locationHref) {
  const url = new URL(locationHref);
  AUTH_CALLBACK_PARAMS.forEach(param => url.searchParams.delete(param));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isUsableOidcUser(user, now = Date.now()) {
  if (!user?.access_token || user.expired) return false;
  if (!Number.isFinite(user.expires_at)) return false;
  return (user.expires_at * 1_000) > now + 5_000;
}

export function oidcManagerSettings(config, storage) {
  if (config.mode !== "oidc") throw new Error("OIDC manager settings require oidc mode.");
  const stateStore = new WebStorageStateStore({ store: storage });
  return {
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    response_type: "code",
    scope: config.scope,
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    revokeTokensOnSignout: false,
    staleStateAgeInSeconds: 600,
    stateStore,
    userStore: new WebStorageStateStore({ store: storage }),
    fetchRequestCredentials: "omit",
    ...(config.metadataUrl ? { metadataUrl: config.metadataUrl } : {}),
    ...(config.audience ? { extraQueryParams: { audience: config.audience } } : {})
  };
}

export function createAdminAuthClient({
  env = {},
  windowObject = globalThis.window,
  ManagerClass = UserManager,
  onSessionExpired = () => {}
} = {}) {
  const config = normalizeAdminAuthConfig(env, windowObject?.location?.href);
  if (config.mode === "token") {
    return {
      mode: "token",
      config,
      currentUser: null,
      async initialize() { return { authenticated: false, callbackHandled: false }; },
      accessToken() { return null; },
      async signIn() {},
      async signOut() {}
    };
  }
  if (!windowObject?.sessionStorage || !windowObject?.history || !windowObject?.location) {
    throw new Error("OIDC admin auth requires a browser with session storage.");
  }

  const manager = new ManagerClass(oidcManagerSettings(config, windowObject.sessionStorage));
  const client = {
    mode: "oidc",
    config,
    manager,
    currentUser: null,
    async initialize() {
      let callbackHandled = false;
      try {
        if (isSigninCallback(windowObject.location.href)) {
          client.currentUser = await manager.signinRedirectCallback(windowObject.location.href);
          callbackHandled = true;
          windowObject.history.replaceState({}, windowObject.document?.title || "", cleanAuthCallbackUrl(windowObject.location.href));
        } else if (isSignoutCallback(windowObject.location.href)) {
          await manager.signoutRedirectCallback(windowObject.location.href);
          await manager.removeUser();
          callbackHandled = true;
          windowObject.history.replaceState({}, windowObject.document?.title || "", cleanAuthCallbackUrl(windowObject.location.href));
        } else {
          client.currentUser = await manager.getUser();
        }
        await manager.clearStaleState();
      } catch (error) {
        await manager.removeUser().catch(() => {});
        client.currentUser = null;
        if (isSigninCallback(windowObject.location.href) || isSignoutCallback(windowObject.location.href)) {
          windowObject.history.replaceState({}, windowObject.document?.title || "", cleanAuthCallbackUrl(windowObject.location.href));
        }
        throw error;
      }

      if (!isUsableOidcUser(client.currentUser)) {
        await manager.removeUser().catch(() => {});
        client.currentUser = null;
      }
      return { authenticated: Boolean(client.currentUser), callbackHandled };
    },
    accessToken() {
      return isUsableOidcUser(client.currentUser) ? client.currentUser.access_token : null;
    },
    async signIn() {
      await manager.clearStaleState();
      await manager.signinRedirect();
    },
    async signOut() {
      const user = client.currentUser || await manager.getUser();
      client.currentUser = null;
      if (!user) {
        await manager.removeUser();
        windowObject.location.assign(config.postLogoutRedirectUri);
        return;
      }
      try {
        await manager.signoutRedirect({ id_token_hint: user.id_token });
      } catch {
        await manager.removeUser();
        windowObject.location.assign(config.postLogoutRedirectUri);
      }
    },
    async clear() {
      client.currentUser = null;
      await manager.removeUser();
    }
  };

  manager.events.addUserLoaded(user => {
    client.currentUser = user;
  });
  manager.events.addUserUnloaded(() => {
    client.currentUser = null;
  });
  manager.events.addAccessTokenExpired(async () => {
    client.currentUser = null;
    await manager.removeUser().catch(() => {});
    onSessionExpired();
  });

  return client;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function boardDemoAccessConfig({ development = false, authMode = "token", apiBase = "", token = "" } = {}) {
  if (!development) {
    return { enabled: false, reason: "Board demo access is disabled outside development." };
  }
  if (String(authMode || "").trim().toLowerCase() !== "token") {
    return { enabled: false, reason: "Board demo access requires local token authentication." };
  }

  const cleanToken = String(token || "").trim();
  if (cleanToken.length < 24) {
    return { enabled: false, reason: "Board demo access requires a dedicated local token." };
  }

  let endpoint;
  try {
    endpoint = new URL(String(apiBase || ""));
  } catch {
    return { enabled: false, reason: "Board demo access requires a valid loopback API URL." };
  }
  if (!["http:", "https:"].includes(endpoint.protocol)
    || !LOOPBACK_HOSTS.has(endpoint.hostname)
    || endpoint.username
    || endpoint.password) {
    return { enabled: false, reason: "Board demo access is limited to an exact loopback API host." };
  }

  return {
    enabled: true,
    reason: "Local board demo access is ready.",
    token: cleanToken
  };
}

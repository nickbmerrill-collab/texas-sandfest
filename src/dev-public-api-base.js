const OFFICIAL_PUBLIC_API_BASE = "https://api.heyelab.com/sandfest";

export function persistDevelopmentPublicApiBase(value, { storage = globalThis.localStorage } = {}) {
  try { storage?.setItem("sandfest_api_base", value); } catch { /* ignore */ }
}

export function developmentPublicApiBase({ location = globalThis.location, storage = globalThis.localStorage } = {}) {
  const queryBase = new URLSearchParams(location?.search || "").get("apiBase");
  if (queryBase) {
    persistDevelopmentPublicApiBase(queryBase, { storage });
    return queryBase;
  }

  try {
    const saved = storage?.getItem("sandfest_api_base");
    if (saved) return saved;
  } catch {
    /* ignore */
  }

  if (location?.hostname === "127.0.0.1" || location?.hostname === "localhost") {
    return location.port === "5175" ? "http://127.0.0.1:8806" : "http://127.0.0.1:8788";
  }
  return OFFICIAL_PUBLIC_API_BASE;
}

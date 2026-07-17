const DEFINITIVE_ACCESS_FAILURES = new Set([400, 401, 403, 404]);

export function partnerPortalSafeHash(hash) {
  return String(hash || "").startsWith("#partner-status?") ? "#partner-status" : null;
}

export function shouldForgetPartnerPortalAccess(status) {
  return DEFINITIVE_ACCESS_FAILURES.has(Number(status));
}

export function forgetMatchingPartnerPortalAccess(storage, key, access) {
  if (!storage?.getItem || !storage?.removeItem || !key) return false;
  const raw = storage.getItem(key);
  if (!raw) return false;

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    storage.removeItem(key);
    return true;
  }

  if (saved?.reference !== access?.reference || saved?.token !== access?.token) return false;
  storage.removeItem(key);
  return true;
}

// Read-only public launch policy shared by the release gate, the Vite build and the
// browser bundle. The mode is opt-in: nothing here changes behaviour unless
// SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE=read_only is set for the Vercel build.

export const READ_ONLY_LAUNCH_ENV = "SANDFEST_VERCEL_PUBLIC_BRIDGE_MODE";
export const READ_ONLY_LAUNCH_VALUE = "read_only";
export const READ_ONLY_LAUNCH_ERROR_CODE = "read_only_launch";

// The only state-changing public request a read-only launch may send. Ask Sandy answers
// from governed public data and stores nothing.
export const READ_ONLY_ALLOWED_POSTS = Object.freeze(["/api/public/concierge"]);

// Paths that must never be requested from the public site in a read-only launch, even
// with GET: staff, admin, board, and payment surfaces.
const BLOCKED_PATH_PREFIXES = Object.freeze([
  "/api/admin",
  "/api/staff",
  "/api/board",
  "/api/stripe",
  "/api/quickbooks",
  "/api/sms",
  "/api/webhooks"
]);

export function readOnlyLaunchSetting(env = {}) {
  const raw = String(env?.[READ_ONLY_LAUNCH_ENV] ?? "").trim();
  if (!raw) return { enabled: false, error: null };
  if (raw.toLowerCase() === READ_ONLY_LAUNCH_VALUE) return { enabled: true, error: null };
  return {
    enabled: false,
    error: `${READ_ONLY_LAUNCH_ENV} must be unset or "${READ_ONLY_LAUNCH_VALUE}"; received "${raw}". Refusing to guess a launch mode.`
  };
}

export function readOnlyLaunchBlockReason(input, init = {}, { enabled = false } = {}) {
  if (!enabled) return null;
  const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  let url;
  try {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
    url = new URL(raw, "https://read-only.invalid");
  } catch {
    return "The request address is not valid.";
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (BLOCKED_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return "Staff, payment, and administration requests are not available in a read-only launch.";
  }
  if (method === "GET" || method === "HEAD") return null;
  if (method === "POST" && READ_ONLY_ALLOWED_POSTS.includes(pathname)) return null;
  return "This online action is not open yet.";
}

// Browser entry point. The bundles import this lazily and only when the build flag is on, so
// the default (full-mode) bundles carry none of it.
export function readOnlyLaunchGuard(input, init = {}) {
  const reason = readOnlyLaunchBlockReason(input, init, { enabled: true });
  if (!reason) return null;
  const blocked = new Error(`${reason} Use the official Texas SandFest contact information for help.`);
  blocked.code = READ_ONLY_LAUNCH_ERROR_CODE;
  return blocked;
}

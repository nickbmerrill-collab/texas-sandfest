const RESERVED_HOSTS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "localhost"
]);

const RESERVED_SUFFIXES = [
  ".example",
  ".invalid",
  ".local",
  ".localhost",
  ".test"
];

function privateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function privateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (!normalized.includes(":")) return false;
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb");
}

export function safePublicHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    const reservedHost = RESERVED_HOSTS.has(hostname)
      || [...RESERVED_HOSTS].some(host => hostname.endsWith(`.${host}`))
      || RESERVED_SUFFIXES.some(suffix => hostname.endsWith(suffix));
    if (!hostname || reservedHost || privateIpv4(hostname) || privateIpv6(hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

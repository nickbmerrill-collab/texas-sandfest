const LOOPBACK_HOST = "127.0.0.1";

export function normalizeBoardIOSMode(value) {
  const mode = String(value || "admin").trim().toLowerCase();
  if (["visitor", "customer"].includes(mode)) return "visitor";
  if (mode === "admin") return "admin";
  throw new Error("Board iOS mode must be admin or visitor.");
}

export function exactBoardIOSAPIBase(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("The active board API URL is invalid.");
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== LOOPBACK_HOST
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("The iOS board rehearsal requires an exact loopback HTTP API origin.");
  }
  return url.origin;
}

export function selectBoardIOSSimulator(devices, configuredId = "") {
  const available = (Array.isArray(devices) ? devices : [])
    .filter(device => device?.isAvailable && String(device.deviceTypeIdentifier || "").includes("iPhone"));
  const requested = String(configuredId || "").trim();
  if (requested) {
    const match = available.find(device => device.udid === requested);
    if (!match) throw new Error(`SANDFEST_IOS_SIMULATOR_ID does not identify an available iPhone simulator: ${requested}`);
    return match;
  }
  return available.find(device => device.state === "Booted")
    || available.find(device => device.name === "iPhone 17 Pro")
    || available.find(device => String(device.name || "").includes("Pro"))
    || available[0]
    || null;
}

export function boardIOSLaunchArguments({ apiBase, mode = "admin", adminToken = "" } = {}) {
  const normalizedMode = normalizeBoardIOSMode(mode);
  const normalizedAPIBase = exactBoardIOSAPIBase(apiBase);
  const args = ["-apiBase", normalizedAPIBase];
  if (normalizedMode === "admin") {
    const token = String(adminToken || "").trim();
    if (token.length < 24) throw new Error("The local board administrator token is unavailable.");
    args.push("-boardAdminToken", token, "-startMode", "admin");
  }
  return args;
}

export function parseBoardIOSLaunch(output, bundleIdentifier) {
  const value = String(output || "").trim();
  const separator = value.lastIndexOf(":");
  const bundle = value.slice(0, separator).trim();
  const pid = Number(value.slice(separator + 1).trim());
  if (separator < 1 || bundle !== bundleIdentifier || !Number.isInteger(pid) || pid < 1) {
    throw new Error("The simulator did not return a valid app process identifier.");
  }
  return pid;
}

export function parseBoardIOSUserDomain(output) {
  const match = String(output || "").match(/\buser\/(\d+)\b/);
  const uid = Number(match?.[1]);
  if (!Number.isInteger(uid) || uid < 1) {
    throw new Error("The simulator did not expose an active user launch domain.");
  }
  return `user/${uid}`;
}

export function boardIOSProcessIsActive(output, bundleIdentifier, pid) {
  const marker = `UIKitApplication:${bundleIdentifier}[`;
  return String(output || "")
    .split("\n")
    .some(line => line.includes(marker) && Number(line.trim().split(/\s+/)[0]) === Number(pid));
}

export function assessBoardIOSScreenshot(metadata, channels) {
  const colorChannels = (Array.isArray(channels) ? channels : []).slice(0, 3);
  const reasons = [];
  if (metadata?.format !== "png") reasons.push("the capture is not PNG");
  if (Number(metadata?.width || 0) < 320 || Number(metadata?.height || 0) < 568) reasons.push("the capture is smaller than an iPhone viewport");
  if (colorChannels.length !== 3 || colorChannels.some(channel => Number(channel?.stdev || 0) < 8)) reasons.push("the capture is blank or visually uniform");
  return { ok: reasons.length === 0, reasons };
}

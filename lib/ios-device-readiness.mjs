function physicalIOSDevices(devices) {
  return (Array.isArray(devices) ? devices : []).filter(device =>
    device?.hardwareProperties?.platform === "iOS"
      && device?.hardwareProperties?.reality === "physical"
  );
}

function deviceName(device) {
  return device?.hardwareProperties?.marketingName
    || device?.deviceProperties?.name
    || "The selected iOS device";
}

function deviceIsReady(device) {
  return Boolean(
    device?.hardwareProperties?.udid
      && device?.connectionProperties?.pairingState === "paired"
      && device?.connectionProperties?.transportType
      && device?.deviceProperties?.developerModeStatus === "enabled"
  );
}

function connectionScore(device) {
  return Number(device?.connectionProperties?.pairingState === "paired") * 4
    + Number(device?.deviceProperties?.developerModeStatus === "enabled") * 2
    + Number(Boolean(device?.connectionProperties?.transportType));
}

function deviceFailure(device) {
  const name = deviceName(device);
  if (!device?.hardwareProperties?.udid) {
    return `${name} does not expose a hardware identifier to Xcode. Reconnect and unlock it, then retry.`;
  }
  if (device?.connectionProperties?.pairingState !== "paired") {
    return `${name} is not paired with this Mac. Connect it over USB, unlock it, trust this Mac, and retry.`;
  }
  if (device?.deviceProperties?.developerModeStatus !== "enabled") {
    return `Developer Mode is not enabled on ${name}. Enable it in Settings > Privacy & Security, reconnect, and retry.`;
  }
  if (!device?.connectionProperties?.transportType) {
    return `${name} is paired and Developer Mode is enabled, but it is not connected. Connect and unlock it over USB, or enable network device access in Xcode, then retry.`;
  }
  return `${name} is not currently available for an Xcode device install.`;
}

export function resolveIOSInstallDevice(devices, requestedIdentifier = "") {
  const physical = physicalIOSDevices(devices);
  const requested = String(requestedIdentifier || "").trim();
  if (requested) {
    const device = physical.find(item =>
      item?.identifier === requested || item?.hardwareProperties?.udid === requested
    );
    if (!device) {
      return {
        device: null,
        reason: "SANDFEST_IOS_DEVICE_ID does not identify a physical iOS device known to Xcode."
      };
    }
    return deviceIsReady(device) ? { device, reason: null } : { device: null, reason: deviceFailure(device) };
  }

  const eligible = physical
    .filter(deviceIsReady)
    .sort((left, right) =>
      Date.parse(right.connectionProperties?.lastConnectionDate || 0)
        - Date.parse(left.connectionProperties?.lastConnectionDate || 0)
    );
  if (eligible[0]) return { device: eligible[0], reason: null };
  if (!physical.length) {
    return {
      device: null,
      reason: "No physical iOS device is known to Xcode. Connect and unlock a device, trust this Mac, and retry."
    };
  }

  const closest = [...physical].sort((left, right) => connectionScore(right) - connectionScore(left))[0];
  return { device: null, reason: deviceFailure(closest) };
}

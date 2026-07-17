const SUPPORTED_PROVIDERS = new Set([
  "render-managed",
  "external-managed",
  "self-managed"
]);

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsedInstant(value) {
  const text = String(value || "").trim();
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? { text: new Date(timestamp).toISOString(), timestamp } : null;
}

export function recoveryReadiness(env = process.env, { now = Date.now() } = {}) {
  const nowMs = new Date(now).getTime();
  const provider = String(env.SANDFEST_BACKUP_PROVIDER || "").trim().toLowerCase();
  const databaseRecoveryWindowDays = positiveInteger(env.SANDFEST_DATABASE_RECOVERY_WINDOW_DAYS);
  const assetSnapshotRetentionDays = positiveInteger(env.SANDFEST_ASSET_SNAPSHOT_RETENTION_DAYS);
  const restoreDrillMaxAgeDays = positiveInteger(env.SANDFEST_RESTORE_DRILL_MAX_AGE_DAYS, 90);
  const databaseRestoreDrill = parsedInstant(env.SANDFEST_DATABASE_RESTORE_DRILL_AT);
  const assetRestoreDrill = parsedInstant(env.SANDFEST_ASSET_RESTORE_DRILL_AT);
  const drillStatus = drill => {
    const ageDays = drill && Number.isFinite(nowMs)
      ? Math.max(0, Math.floor((nowMs - drill.timestamp) / 86_400_000))
      : null;
    const notFuture = Boolean(drill && drill.timestamp <= nowMs + 5 * 60_000);
    return {
      ageDays,
      notFuture,
      current: Boolean(drill && notFuture && nowMs - drill.timestamp <= restoreDrillMaxAgeDays * 86_400_000)
    };
  };
  const databaseDrillStatus = drillStatus(databaseRestoreDrill);
  const assetDrillStatus = drillStatus(assetRestoreDrill);
  const checks = {
    provider: SUPPORTED_PROVIDERS.has(provider),
    databaseRecoveryWindow: databaseRecoveryWindowDays >= 3,
    assetSnapshots: assetSnapshotRetentionDays >= 7,
    databaseRestoreDrill: databaseDrillStatus.current,
    assetRestoreDrill: assetDrillStatus.current
  };
  const failures = [];
  if (!checks.provider) failures.push("configure a supported managed backup provider");
  if (!checks.databaseRecoveryWindow) failures.push("confirm at least three days of database point-in-time recovery");
  if (!checks.assetSnapshots) failures.push("confirm at least seven days of private asset snapshots");
  if (!databaseRestoreDrill) failures.push("record a successful isolated database restore drill");
  else if (!databaseDrillStatus.notFuture) failures.push("database restore drill timestamp cannot be in the future");
  else if (!checks.databaseRestoreDrill) failures.push(`repeat the database restore drill; evidence is older than ${restoreDrillMaxAgeDays} days`);
  if (!assetRestoreDrill) failures.push("record a successful isolated private-asset restore drill");
  else if (!assetDrillStatus.notFuture) failures.push("asset restore drill timestamp cannot be in the future");
  else if (!checks.assetRestoreDrill) failures.push(`repeat the asset restore drill; evidence is older than ${restoreDrillMaxAgeDays} days`);

  return {
    ready: Object.values(checks).every(Boolean),
    provider: provider || "not-configured",
    databaseRecoveryWindowDays,
    assetSnapshotRetentionDays,
    databaseRestoreDrillAt: databaseRestoreDrill?.text || null,
    databaseRestoreDrillAgeDays: databaseDrillStatus.ageDays,
    assetRestoreDrillAt: assetRestoreDrill?.text || null,
    assetRestoreDrillAgeDays: assetDrillStatus.ageDays,
    oldestRestoreDrillAgeDays: Math.max(databaseDrillStatus.ageDays ?? 0, assetDrillStatus.ageDays ?? 0),
    restoreDrillMaxAgeDays,
    checks,
    reason: failures.length ? `Recovery is not ready: ${failures.join("; ")}.` : "Database and private-asset recovery evidence is current."
  };
}

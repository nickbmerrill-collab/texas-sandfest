const LEVELS = ["unknown", "low", "moderate", "high", "critical"];
const CAMERA_HEALTH_STATES = ["starting", "healthy", "degraded", "error"];
const INCIDENT_SEVERITIES = ["low", "moderate", "high", "critical"];
const INCIDENT_STATUSES = ["open", "acknowledged", "responding", "monitoring", "resolved", "dismissed"];
const INCIDENT_SOURCE_TYPES = ["camera_condition", "camera_health", "operator"];
const INCIDENT_TEAMS = ["operations", "traffic", "guest-services", "safety", "medical", "security", "production", "volunteer-captains"];
const ACTIVE_INCIDENT_STATUSES = new Set(["open", "acknowledged", "responding", "monitoring"]);
const INCIDENT_DISPATCH_STATUSES = ["assigned", "acknowledged", "en_route", "on_scene", "completed", "canceled"];
const ACTIVE_DISPATCH_STATUSES = new Set(["assigned", "acknowledged", "en_route", "on_scene"]);
const INCIDENT_MESSAGE_STATUSES = ["not_requested", "draft_ready", "approved", "queued", "sent", "failed", "dismissed", "canceled"];
const INCIDENT_ASSIGNEE_TYPES = ["team", "volunteer", "staff"];
const DEFAULT_INCIDENT_POLICY = Object.freeze({
  enabled: true,
  highTriggerCount: 2,
  criticalTriggerCount: 1,
  recoveryCount: 3,
  signalWindowMinutes: 10,
  requireHumanResolution: true
});
const TXDOT_FERRY_DMS_URL = "https://its.txdot.gov/its/DistrictIts/GetDmsListByDistrict?districtCode=CRP";
const TXDOT_FERRY_SOURCE_URL = "https://its.txdot.gov/its/District/CRP/dms-messages";
const TXDOT_FERRY_SIGNS = [
  {
    id: "to-port-aransas",
    label: "To Port Aransas",
    destination: "PORT ARANSAS",
    signIds: ["CRP-SH361 at Dale Miller Brdg"]
  },
  {
    id: "to-aransas-pass",
    label: "To Aransas Pass",
    destination: "ARANSAS PASS",
    signIds: ["CRP-SH361 at New Port Golf", "CRP-PA Ferry_C"]
  }
];

export function islandConditionsLiveFeedsEnabled(env = {}, { boardMode = "" } = {}) {
  return String(boardMode || "").trim().toLowerCase() === "official"
    || String(env.SANDFEST_ISLAND_CONDITIONS_LIVE_FEEDS_ENABLED || "").trim().toLowerCase() === "true";
}

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function iso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedNumber(value, min, max, fallback = null) {
  const parsed = number(value, fallback);
  if (parsed == null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sourceId(value) {
  return text(value, 100).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "");
}

function publicUrl(value) {
  const candidate = text(value, 1000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeCamera(input) {
  const camera = input && typeof input === "object" ? input : {};
  const status = ["awaiting_source", "configured", "disabled"].includes(camera.status) ? camera.status : "awaiting_source";
  return {
    ...camera,
    id: sourceId(camera.id),
    name: text(camera.name, 120),
    zone: text(camera.zone, 120),
    kind: ["traffic", "queue", "crowd", "line"].includes(camera.kind) ? camera.kind : "crowd",
    status,
    sourceId: sourceId(camera.sourceId) || null,
    sourceUrl: publicUrl(camera.sourceUrl),
    staleAfterMinutes: Math.round(boundedNumber(camera.staleAfterMinutes, 1, 120, 15)),
    monitoringEnabled: status === "configured" && camera.monitoringEnabled === true,
    health: normalizeCameraHealth(camera.health),
    privacyMode: "metrics_only"
  };
}

function normalizeCameraHealth(input) {
  if (!input || typeof input !== "object") return null;
  const observedAt = iso(input.observedAt, null);
  if (!observedAt) return null;
  const status = CAMERA_HEALTH_STATES.includes(input.status) ? input.status : "error";
  return {
    heartbeatId: sourceId(input.heartbeatId) || null,
    status,
    observedAt,
    sourceId: sourceId(input.sourceId) || null,
    agentId: sourceId(input.agentId) || null,
    framesPerSecond: boundedNumber(input.framesPerSecond, 0, 240, null),
    inferenceLatencyMs: input.inferenceLatencyMs == null ? null : Math.round(boundedNumber(input.inferenceLatencyMs, 0, 600_000, null)),
    droppedFramePct: boundedNumber(input.droppedFramePct, 0, 100, null),
    uptimeSeconds: input.uptimeSeconds == null ? null : Math.round(boundedNumber(input.uptimeSeconds, 0, 10 * 365 * 24 * 60 * 60, null)),
    agentVersion: text(input.agentVersion, 100) || null,
    modelName: text(input.modelName, 100) || null,
    modelVersion: text(input.modelVersion, 100) || null,
    modelSha256: /^[a-f0-9]{64}$/i.test(text(input.modelSha256, 64)) ? text(input.modelSha256, 64).toLowerCase() : null,
    lastError: text(input.lastError, 500) || null,
    rawMediaStored: false
  };
}

function normalizeIncidentPolicy(input) {
  const policy = input && typeof input === "object" ? input : {};
  return {
    enabled: policy.enabled !== false,
    highTriggerCount: Math.round(boundedNumber(policy.highTriggerCount, 1, 10, DEFAULT_INCIDENT_POLICY.highTriggerCount)),
    criticalTriggerCount: Math.round(boundedNumber(policy.criticalTriggerCount, 1, 5, DEFAULT_INCIDENT_POLICY.criticalTriggerCount)),
    recoveryCount: Math.round(boundedNumber(policy.recoveryCount, 1, 20, DEFAULT_INCIDENT_POLICY.recoveryCount)),
    signalWindowMinutes: Math.round(boundedNumber(policy.signalWindowMinutes, 1, 60, DEFAULT_INCIDENT_POLICY.signalWindowMinutes)),
    requireHumanResolution: policy.requireHumanResolution !== false
  };
}

function normalizeIncidentTimelineEntry(input) {
  if (!input || typeof input !== "object") return null;
  const at = iso(input.at, null);
  if (!at) return null;
  return {
    at,
    action: sourceId(input.action) || "updated",
    actorId: text(input.actorId, 120) || "system",
    note: text(input.note, 1000) || null,
    fromStatus: INCIDENT_STATUSES.includes(input.fromStatus) ? input.fromStatus : null,
    toStatus: INCIDENT_STATUSES.includes(input.toStatus) ? input.toStatus : null,
    fromSeverity: INCIDENT_SEVERITIES.includes(input.fromSeverity) ? input.fromSeverity : null,
    toSeverity: INCIDENT_SEVERITIES.includes(input.toSeverity) ? input.toSeverity : null
  };
}

function normalizeOperationsIncident(input) {
  if (!input || typeof input !== "object") return null;
  const id = sourceId(input.id);
  const title = text(input.title, 180);
  if (!id || !title) return null;
  const sourceType = INCIDENT_SOURCE_TYPES.includes(input.sourceType) ? input.sourceType : "operator";
  const status = INCIDENT_STATUSES.includes(input.status) ? input.status : "open";
  const severity = INCIDENT_SEVERITIES.includes(input.severity) ? input.severity : "moderate";
  const ownerTeam = INCIDENT_TEAMS.includes(input.ownerTeam) ? input.ownerTeam : "operations";
  const createdAt = iso(input.createdAt, new Date(0).toISOString());
  const updatedAt = iso(input.updatedAt, createdAt);
  return {
    id,
    sourceType,
    sourceId: sourceId(input.sourceId) || id,
    cameraId: sourceId(input.cameraId) || null,
    title,
    summary: text(input.summary, 1000),
    severity,
    status,
    ownerTeam,
    ownerName: text(input.ownerName, 120) || null,
    publicImpact: input.publicImpact === true,
    publicAlertRecommended: input.publicAlertRecommended === true,
    latestSignalAt: iso(input.latestSignalAt, null),
    latestLevel: LEVELS.includes(input.latestLevel) ? input.latestLevel : null,
    latestMetrics: input.latestMetrics && typeof input.latestMetrics === "object" ? input.latestMetrics : null,
    createdAt,
    createdBy: text(input.createdBy, 120) || "system",
    updatedAt,
    updatedBy: text(input.updatedBy, 120) || "system",
    acknowledgedAt: iso(input.acknowledgedAt, null),
    acknowledgedBy: text(input.acknowledgedBy, 120) || null,
    resolvedAt: iso(input.resolvedAt, null),
    resolvedBy: text(input.resolvedBy, 120) || null,
    resolution: text(input.resolution, 1000) || null,
    timeline: (Array.isArray(input.timeline) ? input.timeline : []).map(normalizeIncidentTimelineEntry).filter(Boolean).slice(-100)
  };
}

function normalizeIncidentSignal(input) {
  if (!input || typeof input !== "object") return null;
  const observedAt = iso(input.observedAt, null);
  const sourceType = INCIDENT_SOURCE_TYPES.includes(input.sourceType) ? input.sourceType : null;
  const source = sourceId(input.sourceId);
  if (!observedAt || !sourceType || !source) return null;
  return {
    id: sourceId(input.id) || `${sourceType}-${source}-${observedAt}`,
    sourceType,
    sourceId: source,
    cameraId: sourceId(input.cameraId) || null,
    level: LEVELS.includes(input.level) ? input.level : "unknown",
    observedAt,
    metrics: input.metrics && typeof input.metrics === "object" ? input.metrics : null
  };
}

function emailAddress(value) {
  const candidate = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function normalizeDispatchTimelineEntry(input) {
  if (!input || typeof input !== "object") return null;
  const at = iso(input.at, null);
  if (!at) return null;
  return {
    at,
    action: sourceId(input.action) || "updated",
    actorId: text(input.actorId, 120) || "system",
    note: text(input.note, 1000) || null,
    fromStatus: INCIDENT_DISPATCH_STATUSES.includes(input.fromStatus) ? input.fromStatus : null,
    toStatus: INCIDENT_DISPATCH_STATUSES.includes(input.toStatus) ? input.toStatus : null
  };
}

function normalizeIncidentNotification(input) {
  const notification = input && typeof input === "object" ? input : {};
  const channel = notification.channel === "email" ? "email" : "none";
  const status = INCIDENT_MESSAGE_STATUSES.includes(notification.status)
    ? notification.status
    : channel === "email" ? "draft_ready" : "not_requested";
  return {
    channel,
    recipient: channel === "email" ? emailAddress(notification.recipient) : null,
    subject: channel === "email" ? text(notification.subject, 998) : "",
    body: channel === "email" ? text(notification.body, 10_000) : "",
    status,
    version: Math.max(1, Math.round(boundedNumber(notification.version, 1, 10_000, 1))),
    approvedAt: iso(notification.approvedAt, null),
    approvedBy: text(notification.approvedBy, 120) || null,
    dismissedAt: iso(notification.dismissedAt, null),
    dismissedBy: text(notification.dismissedBy, 120) || null,
    queuedAt: iso(notification.queuedAt, null),
    sentAt: iso(notification.sentAt, null),
    provider: text(notification.provider, 80) || null,
    providerMessageId: text(notification.providerMessageId, 500) || null,
    deliveryAttempts: Math.max(0, Math.round(boundedNumber(notification.deliveryAttempts, 0, 100, 0))),
    lastAttemptAt: iso(notification.lastAttemptAt, null),
    lastError: text(notification.lastError, 1000) || null
  };
}

function normalizeIncidentDispatch(input) {
  if (!input || typeof input !== "object") return null;
  const id = sourceId(input.id);
  const incidentId = sourceId(input.incidentId);
  const title = text(input.title, 180);
  const assigneeType = INCIDENT_ASSIGNEE_TYPES.includes(input.assigneeType) ? input.assigneeType : null;
  const assigneeId = text(input.assigneeId, 120);
  const assigneeName = text(input.assigneeName, 120);
  if (!id || !incidentId || !title || !assigneeType || !assigneeId || !assigneeName) return null;
  const status = INCIDENT_DISPATCH_STATUSES.includes(input.status) ? input.status : "assigned";
  const createdAt = iso(input.createdAt, new Date(0).toISOString());
  const updatedAt = iso(input.updatedAt, createdAt);
  return {
    id,
    incidentId,
    title,
    instructions: text(input.instructions, 2000),
    status,
    priority: INCIDENT_SEVERITIES.includes(input.priority) ? input.priority : "moderate",
    assigneeType,
    assigneeId,
    assigneeName,
    assigneeRole: text(input.assigneeRole, 200) || null,
    dueAt: iso(input.dueAt, null),
    notification: normalizeIncidentNotification(input.notification),
    createdAt,
    createdBy: text(input.createdBy, 120) || "system",
    updatedAt,
    updatedBy: text(input.updatedBy, 120) || "system",
    acknowledgedAt: iso(input.acknowledgedAt, null),
    completedAt: iso(input.completedAt, null),
    completedBy: text(input.completedBy, 120) || null,
    canceledAt: iso(input.canceledAt, null),
    canceledBy: text(input.canceledBy, 120) || null,
    timeline: (Array.isArray(input.timeline) ? input.timeline : []).map(normalizeDispatchTimelineEntry).filter(Boolean).slice(-100)
  };
}

function appendDispatchTimeline(dispatch, entry) {
  return [...dispatch.timeline, normalizeDispatchTimelineEntry(entry)].filter(Boolean).slice(-100);
}

function incidentTeamForCamera(camera) {
  if (["traffic", "queue"].includes(camera?.kind)) return "traffic";
  if (camera?.kind === "line") return "guest-services";
  return "operations";
}

function incidentLevelRank(level) {
  return LEVELS.indexOf(level);
}

function incidentSignalStreak(signals, predicate, policy) {
  if (!signals.length) return 0;
  const newest = new Date(signals[0].observedAt).getTime();
  const windowMs = policy.signalWindowMinutes * 60_000;
  let count = 0;
  for (const signal of signals) {
    if (newest - new Date(signal.observedAt).getTime() > windowMs || !predicate(signal)) break;
    count += 1;
  }
  return count;
}

function appendIncidentTimeline(incident, entry) {
  return [...incident.timeline, normalizeIncidentTimelineEntry(entry)].filter(Boolean).slice(-100);
}

function activeIncidentFor(doc, sourceType, source) {
  return doc.incidents.find(incident => incident.sourceType === sourceType && incident.sourceId === source && ACTIVE_INCIDENT_STATUSES.has(incident.status)) ?? null;
}

export function conditionLevel(value) {
  const candidate = text(value, 20).toLowerCase();
  return LEVELS.includes(candidate) ? candidate : "unknown";
}

export function freshness(observedAt, now = new Date().toISOString(), staleAfterMinutes = 15) {
  if (!observedAt) return { state: "unavailable", ageMinutes: null };
  const ageMinutes = Math.max(0, Math.round((new Date(now).getTime() - new Date(observedAt).getTime()) / 60_000));
  return { state: ageMinutes <= staleAfterMinutes ? "live" : "stale", ageMinutes };
}

export function failedFeedRefreshNeedsRetry(feed, now = new Date().toISOString(), retryIntervalMs = 10_000) {
  if (!feed?.refreshError) return false;
  const nowMs = new Date(now).getTime();
  const lastAttemptMs = new Date(feed?.refreshAttemptedAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastAttemptMs)) return true;
  return nowMs - lastAttemptMs >= retryIntervalMs;
}

export function weatherForecastNeedsRefresh(weather, now = new Date().toISOString(), refreshIntervalMs = 10 * 60_000) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return true;
  if (weather?.refreshError) return failedFeedRefreshNeedsRetry(weather, now);
  const validUntilMs = weather?.validUntil ? new Date(weather.validUntil).getTime() : Number.NaN;
  if (Number.isFinite(validUntilMs) && validUntilMs <= nowMs) return true;
  const lastAttemptMs = new Date(weather?.refreshAttemptedAt || weather?.observedAt).getTime();
  return !Number.isFinite(lastAttemptMs) || nowMs - lastAttemptMs > refreshIntervalMs;
}

export function publicIslandConditionsRefreshDelay(randomValue = Math.random()) {
  const normalized = Number.isFinite(Number(randomValue)) ? Math.min(1, Math.max(0, Number(randomValue))) : 0;
  return 60_000 + Math.floor(normalized * 15_000);
}

export function deriveCameraCondition(metric = {}) {
  const queue = boundedNumber(metric.queueLength, 0, 10_000, 0);
  const occupancy = boundedNumber(metric.occupancyPct, 0, 100, 0);
  const wait = boundedNumber(metric.estimatedWaitMinutes, 0, 600, 0);
  const score = Math.max(occupancy, Math.min(100, queue * 5), Math.min(100, wait * 3));
  const level = score >= 85 ? "critical" : score >= 65 ? "high" : score >= 35 ? "moderate" : "low";
  return { level, score: Math.round(score), queueLength: queue, occupancyPct: occupancy, estimatedWaitMinutes: wait };
}

export function normalizeIslandConditions(input) {
  const base = input && typeof input === "object" ? input : {};
  return {
    schemaVersion: 3,
    eventId: base.eventId ?? DEFAULT_EVENT_ID,
    lastUpdated: base.lastUpdated ?? null,
    weather: base.weather && typeof base.weather === "object" ? base.weather : { status: "awaiting_live_feed" },
    ferry: base.ferry && typeof base.ferry === "object" ? base.ferry : { status: "awaiting_observation" },
    cameras: Array.isArray(base.cameras) ? base.cameras.map(normalizeCamera).filter(camera => camera.id) : [],
    observations: Array.isArray(base.observations) ? base.observations : [],
    incidentPolicy: normalizeIncidentPolicy(base.incidentPolicy),
    incidents: (Array.isArray(base.incidents) ? base.incidents : []).map(normalizeOperationsIncident).filter(Boolean).slice(-500),
    incidentSignals: (Array.isArray(base.incidentSignals) ? base.incidentSignals : []).map(normalizeIncidentSignal).filter(Boolean).slice(-2000),
    dispatches: (Array.isArray(base.dispatches) ? base.dispatches : []).map(normalizeIncidentDispatch).filter(Boolean).slice(-2000)
  };
}

export function createOperationsIncident(docInput, input, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const now = options.now ?? new Date().toISOString();
  const sourceType = INCIDENT_SOURCE_TYPES.includes(input?.sourceType) ? input.sourceType : "operator";
  const source = sourceId(input?.sourceId) || (sourceType === "operator" ? `operator-${sourceId(input?.title)}` : "");
  const title = text(input?.title, 180);
  const severity = INCIDENT_SEVERITIES.includes(input?.severity) ? input.severity : "moderate";
  const status = INCIDENT_STATUSES.includes(input?.status) && ACTIVE_INCIDENT_STATUSES.has(input.status) ? input.status : "open";
  const ownerTeam = INCIDENT_TEAMS.includes(input?.ownerTeam) ? input.ownerTeam : "operations";
  if (!title) return { ok: false, error: "Incident title is required." };
  if (!source) return { ok: false, error: "Incident source is required." };
  const duplicate = activeIncidentFor(doc, sourceType, source);
  if (duplicate) return { ok: true, changed: false, duplicate: true, incident: duplicate, doc };
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const actorId = text(options.actorId, 120) || "system";
  const incident = normalizeOperationsIncident({
    id: idFactory("incident"), sourceType, sourceId: source, cameraId: input?.cameraId,
    title, summary: input?.summary, severity, status, ownerTeam, ownerName: input?.ownerName,
    publicImpact: input?.publicImpact === true,
    publicAlertRecommended: input?.publicAlertRecommended === true,
    latestSignalAt: input?.latestSignalAt,
    latestLevel: input?.latestLevel,
    latestMetrics: input?.latestMetrics,
    createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId,
    timeline: [{ at: now, action: "created", actorId, note: input?.note, toStatus: status, toSeverity: severity }]
  });
  return {
    ok: true, changed: true, duplicate: false, incident,
    doc: { ...doc, lastUpdated: now, incidents: [...doc.incidents, incident].slice(-500) }
  };
}

export function updateOperationsIncident(docInput, incidentId, patch, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.incidents.findIndex(incident => incident.id === sourceId(incidentId));
  if (index < 0) return { ok: false, error: "Incident not found." };
  const current = doc.incidents[index];
  const now = options.now ?? new Date().toISOString();
  const actorId = text(options.actorId, 120) || "admin";
  const status = patch?.status === undefined ? current.status : patch.status;
  const severity = patch?.severity === undefined ? current.severity : patch.severity;
  const ownerTeam = patch?.ownerTeam === undefined ? current.ownerTeam : patch.ownerTeam;
  if (!INCIDENT_STATUSES.includes(status)) return { ok: false, error: "Invalid incident status." };
  if (!INCIDENT_SEVERITIES.includes(severity)) return { ok: false, error: "Invalid incident severity." };
  if (!INCIDENT_TEAMS.includes(ownerTeam)) return { ok: false, error: "Invalid incident owner team." };
  if (patch?.publicImpact !== undefined && typeof patch.publicImpact !== "boolean") return { ok: false, error: "publicImpact must be true or false." };
  const resolution = patch?.resolution === undefined ? current.resolution : text(patch.resolution, 1000) || null;
  if (["resolved", "dismissed"].includes(status) && !resolution) return { ok: false, error: "A resolution note is required to close an incident." };
  const title = patch?.title === undefined ? current.title : text(patch.title, 180);
  if (!title) return { ok: false, error: "Incident title is required." };
  const note = text(patch?.note, 1000) || null;
  const changed = title !== current.title
    || text(patch?.summary === undefined ? current.summary : patch.summary, 1000) !== current.summary
    || status !== current.status
    || severity !== current.severity
    || ownerTeam !== current.ownerTeam
    || (patch?.ownerName === undefined ? current.ownerName : text(patch.ownerName, 120) || null) !== current.ownerName
    || (patch?.publicImpact === undefined ? current.publicImpact : patch.publicImpact) !== current.publicImpact
    || note !== null
    || resolution !== current.resolution;
  if (!changed) return { ok: true, changed: false, incident: current, doc };
  const acknowledged = status === "acknowledged" && !current.acknowledgedAt;
  const closed = ["resolved", "dismissed"].includes(status);
  const incident = normalizeOperationsIncident({
    ...current,
    title,
    summary: patch?.summary === undefined ? current.summary : text(patch.summary, 1000),
    status,
    severity,
    ownerTeam,
    ownerName: patch?.ownerName === undefined ? current.ownerName : text(patch.ownerName, 120) || null,
    publicImpact: patch?.publicImpact === undefined ? current.publicImpact : patch.publicImpact,
    publicAlertRecommended: patch?.publicAlertRecommended === undefined ? current.publicAlertRecommended : patch.publicAlertRecommended === true,
    updatedAt: now,
    updatedBy: actorId,
    acknowledgedAt: acknowledged ? now : current.acknowledgedAt,
    acknowledgedBy: acknowledged ? actorId : current.acknowledgedBy,
    resolvedAt: closed ? now : null,
    resolvedBy: closed ? actorId : null,
    resolution: closed ? resolution : status === current.status ? resolution : null,
    timeline: appendIncidentTimeline(current, {
      at: now,
      action: closed ? status : status !== current.status ? "status-changed" : "updated",
      actorId,
      note: note || (closed ? resolution : null),
      fromStatus: current.status,
      toStatus: status,
      fromSeverity: current.severity,
      toSeverity: severity
    })
  });
  const incidents = doc.incidents.slice();
  incidents[index] = incident;
  let canceledDispatches = 0;
  const dispatches = closed ? doc.dispatches.map(dispatch => {
    if (dispatch.incidentId !== incident.id || !ACTIVE_DISPATCH_STATUSES.has(dispatch.status)) return dispatch;
    canceledDispatches += 1;
    return normalizeIncidentDispatch({
      ...dispatch,
      status: "canceled",
      updatedAt: now,
      updatedBy: actorId,
      canceledAt: now,
      canceledBy: actorId,
      notification: {
        ...dispatch.notification,
        status: ["sent", "dismissed"].includes(dispatch.notification.status) ? dispatch.notification.status : "canceled",
        lastError: null
      },
      timeline: appendDispatchTimeline(dispatch, {
        at: now,
        action: "incident-closed",
        actorId,
        note: resolution,
        fromStatus: dispatch.status,
        toStatus: "canceled"
      })
    });
  }) : doc.dispatches;
  return { ok: true, changed: true, incident, before: current, canceledDispatches, doc: { ...doc, lastUpdated: now, incidents, dispatches } };
}

export function createIncidentDispatch(docInput, incidentId, input, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const incident = doc.incidents.find(item => item.id === sourceId(incidentId));
  if (!incident) return { ok: false, error: "Incident not found." };
  if (!ACTIVE_INCIDENT_STATUSES.has(incident.status)) return { ok: false, error: "Only active incidents can be dispatched." };
  const assigneeType = INCIDENT_ASSIGNEE_TYPES.includes(input?.assigneeType) ? input.assigneeType : null;
  const assigneeId = text(input?.assigneeId, 120);
  const assigneeName = text(input?.assigneeName, 120);
  if (!assigneeType || !assigneeId || !assigneeName) return { ok: false, error: "A valid staff, volunteer, or team assignment is required." };
  const existing = doc.dispatches.find(item => item.incidentId === incident.id
    && item.assigneeType === assigneeType
    && item.assigneeId === assigneeId
    && ACTIVE_DISPATCH_STATUSES.has(item.status));
  if (existing) return { ok: true, changed: false, duplicate: true, dispatch: existing, incident, doc };
  const dueAt = input?.dueAt ? iso(input.dueAt, null) : null;
  if (input?.dueAt && !dueAt) return { ok: false, error: "Dispatch dueAt must be a valid date." };
  const channel = input?.channel === "email" ? "email" : "none";
  const recipient = channel === "email" ? emailAddress(input?.recipientEmail) : null;
  if (channel === "email" && !recipient) return { ok: false, error: "A valid assignment email is required for an email draft." };
  const title = text(input?.title, 180) || `Respond to ${incident.title}`;
  const instructions = text(input?.instructions, 2000) || incident.summary;
  const subject = text(input?.subject, 998) || `[SandFest ${incident.severity}] ${incident.title}`;
  const body = text(input?.body, 10_000) || [
    `Hello ${assigneeName},`,
    "",
    "You have been assigned to a Texas SandFest operations incident.",
    `Incident: ${incident.title}`,
    `Severity: ${incident.severity}`,
    `Assignment: ${title}`,
    instructions ? `Instructions: ${instructions}` : null,
    dueAt ? `Due: ${dueAt}` : null,
    "",
    "Please acknowledge with SandFest command and report when you are on scene."
  ].filter(value => value != null).join("\n");
  const now = options.now ?? new Date().toISOString();
  const actorId = text(options.actorId, 120) || "admin";
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const dispatch = normalizeIncidentDispatch({
    id: idFactory("dispatch"), incidentId: incident.id, title, instructions,
    status: "assigned", priority: input?.priority ?? incident.severity,
    assigneeType, assigneeId, assigneeName, assigneeRole: input?.assigneeRole,
    dueAt,
    notification: {
      channel,
      recipient,
      subject,
      body,
      status: channel === "email" ? "draft_ready" : "not_requested",
      version: 1
    },
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    timeline: [{ at: now, action: "assigned", actorId, note: instructions, toStatus: "assigned" }]
  });
  const incidentIndex = doc.incidents.findIndex(item => item.id === incident.id);
  const assignedIncident = normalizeOperationsIncident({
    ...incident,
    ownerName: incident.ownerName || assigneeName,
    ownerTeam: assigneeType === "team" && INCIDENT_TEAMS.includes(assigneeId) ? assigneeId : incident.ownerTeam,
    updatedAt: now,
    updatedBy: actorId,
    timeline: appendIncidentTimeline(incident, {
      at: now,
      action: "dispatch-created",
      actorId,
      note: `${title} assigned to ${assigneeName}.`,
      fromStatus: incident.status,
      toStatus: incident.status,
      fromSeverity: incident.severity,
      toSeverity: incident.severity
    })
  });
  const incidents = doc.incidents.slice();
  incidents[incidentIndex] = assignedIncident;
  return {
    ok: true,
    changed: true,
    duplicate: false,
    dispatch,
    incident: assignedIncident,
    doc: { ...doc, lastUpdated: now, incidents, dispatches: [...doc.dispatches, dispatch].slice(-2000) }
  };
}

export function updateIncidentDispatch(docInput, dispatchId, patch, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.dispatches.findIndex(item => item.id === sourceId(dispatchId));
  if (index < 0) return { ok: false, error: "Dispatch not found." };
  const current = doc.dispatches[index];
  const status = patch?.status ?? current.status;
  if (!INCIDENT_DISPATCH_STATUSES.includes(status)) return { ok: false, error: "Invalid dispatch status." };
  const note = text(patch?.note, 1000) || null;
  if (["completed", "canceled"].includes(status) && !note) return { ok: false, error: "A closeout note is required to complete or cancel a dispatch." };
  const subject = patch?.subject === undefined ? current.notification.subject : text(patch.subject, 998);
  const body = patch?.body === undefined ? current.notification.body : text(patch.body, 10_000);
  const messageChanged = subject !== current.notification.subject || body !== current.notification.body;
  if (messageChanged && ["queued", "sent"].includes(current.notification.status)) return { ok: false, error: "Queued or sent messages cannot be edited." };
  if (current.notification.channel === "email" && (!subject || !body)) return { ok: false, error: "Email subject and body are required." };
  const now = options.now ?? new Date().toISOString();
  const actorId = text(options.actorId, 120) || "admin";
  const closed = ["completed", "canceled"].includes(status);
  const notification = normalizeIncidentNotification({
    ...current.notification,
    subject,
    body,
    status: closed && !["sent", "dismissed"].includes(current.notification.status)
      ? "canceled"
      : messageChanged ? "draft_ready" : current.notification.status,
    version: messageChanged ? current.notification.version + 1 : current.notification.version,
    approvedAt: messageChanged ? null : current.notification.approvedAt,
    approvedBy: messageChanged ? null : current.notification.approvedBy,
    lastError: messageChanged ? null : current.notification.lastError
  });
  const dispatch = normalizeIncidentDispatch({
    ...current,
    title: patch?.title === undefined ? current.title : text(patch.title, 180) || current.title,
    instructions: patch?.instructions === undefined ? current.instructions : text(patch.instructions, 2000),
    status,
    notification,
    updatedAt: now,
    updatedBy: actorId,
    acknowledgedAt: status === "acknowledged" && !current.acknowledgedAt ? now : current.acknowledgedAt,
    completedAt: status === "completed" ? now : current.completedAt,
    completedBy: status === "completed" ? actorId : current.completedBy,
    canceledAt: status === "canceled" ? now : current.canceledAt,
    canceledBy: status === "canceled" ? actorId : current.canceledBy,
    timeline: appendDispatchTimeline(current, {
      at: now,
      action: status !== current.status ? "status-changed" : messageChanged ? "message-edited" : "updated",
      actorId,
      note,
      fromStatus: current.status,
      toStatus: status
    })
  });
  const dispatches = doc.dispatches.slice();
  dispatches[index] = dispatch;
  return { ok: true, changed: true, dispatch, before: current, doc: { ...doc, lastUpdated: now, dispatches } };
}

export function reviewIncidentDispatchMessage(docInput, dispatchId, action, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.dispatches.findIndex(item => item.id === sourceId(dispatchId));
  if (index < 0) return { ok: false, error: "Dispatch not found." };
  const current = doc.dispatches[index];
  if (current.notification.channel !== "email") return { ok: false, error: "This dispatch has no email draft." };
  if (action === "approve" && current.notification.status !== "draft_ready") return { ok: false, error: "Only ready drafts can be approved." };
  if (action === "dismiss" && !["draft_ready", "approved", "failed"].includes(current.notification.status)) return { ok: false, error: "This draft cannot be dismissed in its current state." };
  if (!["approve", "dismiss"].includes(action)) return { ok: false, error: "Action must be approve or dismiss." };
  if (action === "approve") {
    const recipient = resolveIncidentDispatchRecipient(doc, dispatchId, options);
    if (!recipient.ok) return recipient;
  }
  const now = options.now ?? new Date().toISOString();
  const actorId = text(options.actorId, 120) || "admin";
  const notification = normalizeIncidentNotification({
    ...current.notification,
    status: action === "approve" ? "approved" : "dismissed",
    approvedAt: action === "approve" ? now : current.notification.approvedAt,
    approvedBy: action === "approve" ? actorId : current.notification.approvedBy,
    dismissedAt: action === "dismiss" ? now : current.notification.dismissedAt,
    dismissedBy: action === "dismiss" ? actorId : current.notification.dismissedBy,
    lastError: null
  });
  const dispatch = normalizeIncidentDispatch({ ...current, notification, updatedAt: now, updatedBy: actorId });
  const dispatches = doc.dispatches.slice();
  dispatches[index] = dispatch;
  return { ok: true, dispatch, before: current, doc: { ...doc, lastUpdated: now, dispatches } };
}

export function resolveIncidentDispatchRecipient(docInput, dispatchId, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const dispatch = doc.dispatches.find(item => item.id === sourceId(dispatchId));
  if (!dispatch) return { ok: false, error: "Dispatch not found." };
  const incident = doc.incidents.find(item => item.id === dispatch.incidentId);
  if (!incident || !ACTIVE_INCIDENT_STATUSES.has(incident.status)) return { ok: false, error: "The incident is no longer active." };
  if (!ACTIVE_DISPATCH_STATUSES.has(dispatch.status)) return { ok: false, error: "The dispatch is no longer active." };
  const recipient = emailAddress(dispatch.notification.recipient);
  if (!recipient) return { ok: false, error: "Dispatch recipient is invalid." };
  let toName = dispatch.assigneeName;
  if (dispatch.assigneeType === "volunteer") {
    const volunteer = (Array.isArray(options.volunteers) ? options.volunteers : []).find(item => String(item.id) === dispatch.assigneeId);
    if (!volunteer) return { ok: false, error: "The assigned volunteer is no longer in the current roster." };
    if (["no_show", "withdrawn", "inactive"].includes(volunteer.status)) return { ok: false, error: "The assigned volunteer is not currently available." };
    if (emailAddress(volunteer.email) !== recipient) return { ok: false, error: "The volunteer email changed after this draft was created." };
  } else {
    const assignee = (Array.isArray(options.taskRecipients) ? options.taskRecipients : [])
      .find(item => item.assigneeType === dispatch.assigneeType && String(item.id) === dispatch.assigneeId);
    if (!assignee || !["active", "on_call"].includes(assignee.status)) {
      return { ok: false, error: "The assigned staff or team notification owner is no longer available." };
    }
    if (emailAddress(assignee.email) !== recipient) {
      return { ok: false, error: "The staff or team notification email changed after this draft was created." };
    }
    toName = assignee.name || toName;
  }
  return { ok: true, dispatch, incident, recipient, toName };
}

export function queueIncidentDispatchMessage(docInput, dispatchId, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.dispatches.findIndex(item => item.id === sourceId(dispatchId));
  if (index < 0) return { ok: false, error: "Dispatch not found." };
  const current = doc.dispatches[index];
  if (!["approved", "failed"].includes(current.notification.status)) return { ok: false, error: "The dispatch email must be approved before delivery." };
  const recipient = resolveIncidentDispatchRecipient(doc, dispatchId, options);
  if (!recipient.ok) return recipient;
  const now = options.now ?? new Date().toISOString();
  const dispatch = normalizeIncidentDispatch({
    ...current,
    notification: { ...current.notification, status: "queued", queuedAt: now, lastError: null },
    updatedAt: now,
    updatedBy: text(options.actorId, 120) || "admin"
  });
  const dispatches = doc.dispatches.slice();
  dispatches[index] = dispatch;
  return { ok: true, dispatch, recipient, doc: { ...doc, lastUpdated: now, dispatches } };
}

export function recordIncidentDispatchDelivery(docInput, dispatchId, delivery, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.dispatches.findIndex(item => item.id === sourceId(dispatchId));
  if (index < 0) return { ok: false, error: "Dispatch not found." };
  const current = doc.dispatches[index];
  if (current.notification.status !== "queued") return { ok: false, error: "Dispatch email is not queued." };
  const now = options.now ?? new Date().toISOString();
  const sent = delivery?.sent === true;
  const terminal = options.terminal === true;
  const notification = normalizeIncidentNotification({
    ...current.notification,
    status: sent ? "sent" : terminal ? "failed" : "queued",
    provider: delivery?.provider ?? current.notification.provider,
    providerMessageId: sent ? delivery?.providerMessageId ?? null : current.notification.providerMessageId,
    deliveryAttempts: current.notification.deliveryAttempts + 1,
    lastAttemptAt: now,
    lastError: sent ? null : text(delivery?.error || delivery?.reason || "Delivery failed", 1000),
    sentAt: sent ? now : current.notification.sentAt
  });
  const dispatch = normalizeIncidentDispatch({ ...current, notification, updatedAt: now, updatedBy: "worker" });
  const dispatches = doc.dispatches.slice();
  dispatches[index] = dispatch;
  return { ok: true, dispatch, doc: { ...doc, lastUpdated: now, dispatches } };
}

export function summarizeIncidentDispatches(docInput) {
  const doc = normalizeIslandConditions(docInput);
  const active = doc.dispatches.filter(item => ACTIVE_DISPATCH_STATUSES.has(item.status));
  return {
    total: doc.dispatches.length,
    active: active.length,
    assigned: active.filter(item => item.status === "assigned").length,
    acknowledged: active.filter(item => item.status === "acknowledged").length,
    enRoute: active.filter(item => item.status === "en_route").length,
    onScene: active.filter(item => item.status === "on_scene").length,
    completed: doc.dispatches.filter(item => item.status === "completed").length,
    draftsAwaitingReview: doc.dispatches.filter(item => item.notification.status === "draft_ready").length,
    approvedMessages: doc.dispatches.filter(item => item.notification.status === "approved").length,
    queuedMessages: doc.dispatches.filter(item => item.notification.status === "queued").length,
    sentMessages: doc.dispatches.filter(item => item.notification.status === "sent").length,
    failedMessages: doc.dispatches.filter(item => item.notification.status === "failed").length
  };
}

function applyAutomatedIncidentSignal(docInput, signalInput, incidentInput, options = {}) {
  let doc = normalizeIslandConditions(docInput);
  if (!doc.incidentPolicy.enabled) return { ok: true, changed: false, action: "disabled", incident: null, doc };
  const now = options.now ?? new Date().toISOString();
  const signal = normalizeIncidentSignal({
    id: options.idFactory ? options.idFactory("signal") : `signal_${crypto.randomUUID()}`,
    ...signalInput
  });
  if (!signal) return { ok: false, error: "Incident signal is invalid.", doc };
  doc = { ...doc, incidentSignals: [...doc.incidentSignals, signal].slice(-2000) };
  const signals = doc.incidentSignals
    .filter(item => item.sourceType === signal.sourceType && item.sourceId === signal.sourceId)
    .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)));
  const highStreak = incidentSignalStreak(signals, item => incidentLevelRank(item.level) >= incidentLevelRank("high"), doc.incidentPolicy);
  const criticalStreak = incidentSignalStreak(signals, item => item.level === "critical", doc.incidentPolicy);
  const recoveryStreak = incidentSignalStreak(signals, item => ["low", "moderate"].includes(item.level), doc.incidentPolicy);
  const shouldTrigger = criticalStreak >= doc.incidentPolicy.criticalTriggerCount || highStreak >= doc.incidentPolicy.highTriggerCount;
  const active = activeIncidentFor(doc, signal.sourceType, signal.sourceId);
  if (!active && !shouldTrigger) return { ok: true, changed: true, action: "signal-recorded", incident: null, signal, doc: { ...doc, lastUpdated: now } };
  if (!active) {
    const created = createOperationsIncident(doc, {
      ...incidentInput,
      sourceType: signal.sourceType,
      sourceId: signal.sourceId,
      cameraId: signal.cameraId,
      severity: signal.level === "critical" ? "critical" : "high",
      status: "open",
      latestSignalAt: signal.observedAt,
      latestLevel: signal.level,
      latestMetrics: signal.metrics
    }, options);
    return { ...created, action: created.changed ? "opened" : "none", signal };
  }
  const activeIndex = doc.incidents.findIndex(incident => incident.id === active.id);
  const targetSeverity = incidentLevelRank(signal.level) > incidentLevelRank(active.severity) ? signal.level : active.severity;
  let targetStatus = active.status;
  let action = "signal-recorded";
  if (shouldTrigger && active.status === "monitoring") {
    targetStatus = "responding";
    action = "reopened";
  } else if (shouldTrigger && targetSeverity !== active.severity) {
    action = "escalated";
  } else if (recoveryStreak >= doc.incidentPolicy.recoveryCount && active.status !== "monitoring") {
    targetStatus = "monitoring";
    action = "monitoring";
  }
  const publicAlertRecommended = active.publicAlertRecommended || incidentInput.publicAlertRecommended === true;
  const meaningful = action !== "signal-recorded";
  const incident = normalizeOperationsIncident({
    ...active,
    severity: targetSeverity,
    status: targetStatus,
    summary: incidentInput.summary,
    latestSignalAt: signal.observedAt,
    latestLevel: signal.level,
    latestMetrics: signal.metrics,
    publicAlertRecommended,
    updatedAt: now,
    updatedBy: `automation:${signal.sourceType}`,
    timeline: meaningful ? appendIncidentTimeline(active, {
      at: now,
      action,
      actorId: `automation:${signal.sourceType}`,
      note: incidentInput.timelineNote,
      fromStatus: active.status,
      toStatus: targetStatus,
      fromSeverity: active.severity,
      toSeverity: targetSeverity
    }) : active.timeline
  });
  const incidents = doc.incidents.slice();
  incidents[activeIndex] = incident;
  return { ok: true, changed: true, action, incident, signal, doc: { ...doc, lastUpdated: now, incidents } };
}

export function evaluateCameraObservationIncident(docInput, cameraId, observation, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const camera = doc.cameras.find(item => item.id === sourceId(cameraId));
  if (!camera) return { ok: false, error: "Camera not found.", doc };
  const level = conditionLevel(observation?.level ?? deriveCameraCondition(observation).level);
  const metrics = {
    peopleCount: Math.round(boundedNumber(observation?.peopleCount, 0, 100_000, 0)),
    vehicleCount: Math.round(boundedNumber(observation?.vehicleCount, 0, 10_000, 0)),
    flowPerMinute: boundedNumber(observation?.flowPerMinute, 0, 5_000, 0),
    queueLength: Math.round(boundedNumber(observation?.queueLength, 0, 10_000, 0)),
    occupancyPct: boundedNumber(observation?.occupancyPct, 0, 100, 0),
    estimatedWaitMinutes: boundedNumber(observation?.estimatedWaitMinutes, 0, 600, 0)
  };
  const publicAlertRecommended = level === "critical" || metrics.estimatedWaitMinutes >= 30 || metrics.occupancyPct >= 85;
  return applyAutomatedIncidentSignal(doc, {
    sourceType: "camera_condition",
    sourceId: camera.id,
    cameraId: camera.id,
    level,
    observedAt: observation?.observedAt,
    metrics
  }, {
    title: `${camera.name} ${camera.kind} threshold`,
    summary: `${camera.name} reports ${level} ${camera.kind} conditions: ${metrics.queueLength} queued, ${Math.round(metrics.occupancyPct)}% occupied, ${Math.round(metrics.estimatedWaitMinutes)} minute estimated wait.`,
    ownerTeam: incidentTeamForCamera(camera),
    publicAlertRecommended,
    timelineNote: `${level} condition signal from ${camera.name}.`
  }, options);
}

export function evaluateCameraHealthIncident(docInput, cameraId, health, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const camera = doc.cameras.find(item => item.id === sourceId(cameraId));
  if (!camera) return { ok: false, error: "Camera not found.", doc };
  const status = CAMERA_HEALTH_STATES.includes(health?.status) ? health.status : "error";
  const level = status === "error" ? "critical" : status === "degraded" ? "high" : status === "starting" ? "moderate" : "low";
  const metrics = {
    status,
    framesPerSecond: boundedNumber(health?.framesPerSecond, 0, 240, null),
    inferenceLatencyMs: health?.inferenceLatencyMs == null ? null : Math.round(boundedNumber(health.inferenceLatencyMs, 0, 600_000, null)),
    droppedFramePct: boundedNumber(health?.droppedFramePct, 0, 100, null),
    lastError: text(health?.lastError, 500) || null
  };
  return applyAutomatedIncidentSignal(doc, {
    sourceType: "camera_health",
    sourceId: camera.id,
    cameraId: camera.id,
    level,
    observedAt: health?.observedAt,
    metrics
  }, {
    title: `${camera.name} monitoring pipeline`,
    summary: status === "healthy" ? `${camera.name} monitoring pipeline is healthy.` : `${camera.name} monitoring pipeline reports ${status}${metrics.lastError ? `: ${metrics.lastError}` : "."}`,
    ownerTeam: "operations",
    publicAlertRecommended: false,
    timelineNote: `${status} pipeline heartbeat from ${camera.name}.`
  }, options);
}

export function summarizeOperationsIncidents(docInput) {
  const doc = normalizeIslandConditions(docInput);
  const active = doc.incidents.filter(incident => ACTIVE_INCIDENT_STATUSES.has(incident.status));
  return {
    total: doc.incidents.length,
    active: active.length,
    open: active.filter(incident => incident.status === "open").length,
    responding: active.filter(incident => incident.status === "responding").length,
    monitoring: active.filter(incident => incident.status === "monitoring").length,
    critical: active.filter(incident => incident.severity === "critical").length,
    unassigned: active.filter(incident => !incident.ownerName).length,
    publicAlertRecommended: active.filter(incident => incident.publicAlertRecommended && !incident.publicImpact).length,
    publicNotices: active.filter(incident => incident.publicImpact).length
  };
}

export function recordCameraObservation(docInput, cameraId, input, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const camera = doc.cameras.find(item => item.id === cameraId);
  if (!camera) return { ok: false, error: "Camera not found." };
  if (options.requireConfigured && camera.status !== "configured") return { ok: false, error: "Camera source is not enabled for ingestion." };
  if (options.requireMonitoringEnabled && !camera.monitoringEnabled) return { ok: false, error: "Camera monitoring is not armed." };
  const now = options.now ?? new Date().toISOString();
  const observedAt = iso(input?.observedAt, null);
  if (!observedAt) return { ok: false, error: "A valid observedAt timestamp is required." };
  const ageMs = new Date(now).getTime() - new Date(observedAt).getTime();
  if (ageMs < -2 * 60_000) return { ok: false, error: "Observation timestamp is too far in the future." };
  if (ageMs > 24 * 60 * 60_000) return { ok: false, error: "Observation timestamp is more than 24 hours old." };
  const eventId = sourceId(input?.eventId);
  if (options.requireEventId && eventId.length < 8) return { ok: false, error: "eventId must contain at least 8 safe characters." };
  const suppliedSourceId = sourceId(input?.sourceId);
  if (options.requireSourceMatch && (!camera.sourceId || suppliedSourceId !== camera.sourceId)) {
    return { ok: false, error: "Observation source does not match the configured camera source." };
  }
  if (eventId) {
    const duplicate = doc.observations.find(item => item.cameraId === cameraId && item.eventId === eventId);
    if (duplicate) return { ok: true, changed: false, duplicate: true, observation: duplicate, doc };
  }
  const numericFields = ["peopleCount", "vehicleCount", "flowPerMinute", "occupancyPct", "queueLength", "estimatedWaitMinutes"];
  if (!numericFields.some(key => Number.isFinite(Number(input?.[key])))) {
    return { ok: false, error: "At least one camera metric is required." };
  }
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${crypto.randomUUID()}`);
  const derived = deriveCameraCondition(input);
  const observation = {
    id: idFactory("observation"), eventId: eventId || null, cameraId, observedAt,
    sourceId: suppliedSourceId || camera.sourceId || null,
    source: text(options.source || input?.source, 80) || "operator",
    peopleCount: Math.round(boundedNumber(input?.peopleCount, 0, 100_000, 0)),
    vehicleCount: Math.round(boundedNumber(input?.vehicleCount, 0, 10_000, 0)),
    flowPerMinute: boundedNumber(input?.flowPerMinute, 0, 5_000, 0),
    ...derived,
    confidence: input?.confidence == null ? null : boundedNumber(input.confidence, 0, 1, null),
    modelName: text(input?.modelName, 100) || null,
    modelVersion: text(input?.modelVersion, 100) || null,
    modelSha256: /^[a-f0-9]{64}$/i.test(text(input?.modelSha256, 64)) ? text(input.modelSha256, 64).toLowerCase() : null,
    processingMs: input?.processingMs == null ? null : Math.round(boundedNumber(input.processingMs, 0, 600_000, null)),
    notes: text(input?.notes, 500), rawMediaStored: false, createdAt: now
  };
  return {
    ok: true, changed: true, duplicate: false, observation,
    doc: { ...doc, lastUpdated: now, observations: [...doc.observations, observation].slice(-5000) }
  };
}

export function recordCameraHeartbeat(docInput, cameraId, input, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.cameras.findIndex(item => item.id === cameraId);
  if (index < 0) return { ok: false, error: "Camera not found." };
  const camera = doc.cameras[index];
  if (options.requireConfigured && camera.status !== "configured") return { ok: false, error: "Camera source is not enabled for ingestion." };
  if (options.requireMonitoringEnabled && !camera.monitoringEnabled) return { ok: false, error: "Camera monitoring is not armed." };
  const now = options.now ?? new Date().toISOString();
  const observedAt = iso(input?.observedAt, null);
  if (!observedAt) return { ok: false, error: "A valid observedAt timestamp is required." };
  const ageMs = new Date(now).getTime() - new Date(observedAt).getTime();
  if (ageMs < -2 * 60_000) return { ok: false, error: "Heartbeat timestamp is too far in the future." };
  if (ageMs > 24 * 60 * 60_000) return { ok: false, error: "Heartbeat timestamp is more than 24 hours old." };
  const heartbeatId = sourceId(input?.heartbeatId);
  if (options.requireHeartbeatId && heartbeatId.length < 8) return { ok: false, error: "heartbeatId must contain at least 8 safe characters." };
  const suppliedSourceId = sourceId(input?.sourceId);
  if (options.requireSourceMatch && (!camera.sourceId || suppliedSourceId !== camera.sourceId)) {
    return { ok: false, error: "Heartbeat source does not match the configured camera source." };
  }
  if (heartbeatId && camera.health?.heartbeatId === heartbeatId) {
    return { ok: true, changed: false, duplicate: true, health: camera.health, doc };
  }
  const status = text(input?.status, 40).toLowerCase();
  if (!CAMERA_HEALTH_STATES.includes(status)) return { ok: false, error: "Heartbeat status must be starting, healthy, degraded, or error." };
  const health = normalizeCameraHealth({
    heartbeatId: heartbeatId || null,
    status,
    observedAt,
    sourceId: suppliedSourceId || camera.sourceId,
    agentId: input?.agentId,
    framesPerSecond: input?.framesPerSecond,
    inferenceLatencyMs: input?.inferenceLatencyMs,
    droppedFramePct: input?.droppedFramePct,
    uptimeSeconds: input?.uptimeSeconds,
    agentVersion: input?.agentVersion,
    modelName: input?.modelName,
    modelVersion: input?.modelVersion,
    modelSha256: input?.modelSha256,
    lastError: input?.lastError
  });
  const cameras = doc.cameras.slice();
  cameras[index] = { ...camera, health };
  return {
    ok: true,
    changed: true,
    duplicate: false,
    health,
    doc: { ...doc, lastUpdated: now, cameras }
  };
}

export function updateCameraSource(docInput, cameraId, patch, options = {}) {
  const doc = normalizeIslandConditions(docInput);
  const index = doc.cameras.findIndex(item => item.id === cameraId);
  if (index < 0) return { ok: false, error: "Camera not found." };
  const current = doc.cameras[index];
  const nextSourceId = patch.sourceId === undefined ? current.sourceId : sourceId(patch.sourceId) || null;
  const nextUrl = patch.sourceUrl === undefined ? current.sourceUrl : publicUrl(patch.sourceUrl);
  if (patch.sourceUrl && !nextUrl) return { ok: false, error: "sourceUrl must be a public HTTP(S) URL without embedded credentials." };
  const requestedStatus = patch.status === undefined ? current.status : text(patch.status, 40);
  if (!["awaiting_source", "configured", "disabled"].includes(requestedStatus)) return { ok: false, error: "Invalid camera status." };
  if (requestedStatus === "configured" && !nextSourceId && !nextUrl) return { ok: false, error: "Configured cameras need a sourceId or public sourceUrl." };
  if (patch.monitoringEnabled !== undefined && typeof patch.monitoringEnabled !== "boolean") return { ok: false, error: "monitoringEnabled must be true or false." };
  const monitoringEnabled = patch.monitoringEnabled === undefined ? current.monitoringEnabled : patch.monitoringEnabled;
  if (monitoringEnabled && requestedStatus !== "configured") return { ok: false, error: "Only configured cameras can be armed for monitoring." };
  const now = options.now ?? new Date().toISOString();
  const sourceChanged = nextSourceId !== current.sourceId;
  const camera = normalizeCamera({
    ...current,
    name: patch.name === undefined ? current.name : patch.name,
    zone: patch.zone === undefined ? current.zone : patch.zone,
    kind: patch.kind === undefined ? current.kind : patch.kind,
    status: requestedStatus,
    sourceId: nextSourceId,
    sourceUrl: nextUrl,
    staleAfterMinutes: patch.staleAfterMinutes === undefined ? current.staleAfterMinutes : patch.staleAfterMinutes,
    monitoringEnabled,
    health: sourceChanged ? null : current.health,
    updatedAt: now,
    updatedBy: options.actorId ?? "admin"
  });
  const cameras = doc.cameras.slice();
  cameras[index] = camera;
  return { ok: true, camera, doc: { ...doc, lastUpdated: now, cameras } };
}

export function latestCameraConditions(docInput, now = new Date().toISOString()) {
  const doc = normalizeIslandConditions(docInput);
  return doc.cameras.map(camera => {
    const observation = doc.observations
      .filter(item => item.cameraId === camera.id)
      .sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))[0] ?? null;
    const sourceReady = Boolean(camera.sourceId || camera.sourceUrl);
    const currentFreshness = freshness(observation?.observedAt, now, camera.staleAfterMinutes ?? 15);
    const healthFreshness = freshness(camera.health?.observedAt, now, camera.staleAfterMinutes ?? 15);
    const operationalStatus = camera.status === "disabled"
      ? "disabled"
      : !sourceReady || camera.status === "awaiting_source"
        ? "awaiting_source"
        : !camera.monitoringEnabled
          ? "standby"
          : healthFreshness.state === "unavailable"
            ? "awaiting_heartbeat"
            : healthFreshness.state === "stale"
              ? "offline"
              : camera.health?.status === "error"
                ? "error"
                : camera.health?.status === "degraded"
                  ? "degraded"
                  : camera.health?.status === "starting"
                    ? "starting"
                    : currentFreshness.state === "live"
                      ? "live"
                      : "awaiting_observation";
    return {
      ...camera,
      sourceStatus: sourceReady ? (camera.status ?? "configured") : "awaiting_source",
      observation,
      freshness: currentFreshness,
      healthFreshness,
      operationalStatus,
      level: currentFreshness.state === "live" ? conditionLevel(observation?.level) : "unknown"
    };
  });
}

export function publicIslandConditions(docInput, now = new Date().toISOString()) {
  const summary = summarizeIslandConditions(docInput, now);
  const weatherLive = summary.weather.status === "live" && summary.weather.freshness.state === "live";
  const ferryLive = summary.ferry.freshness.state === "live";
  const weatherAlerts = activeWeatherAlerts(summary.weather.alerts, summary.weather.freshness, now);
  return {
    lastUpdated: summary.lastUpdated,
    weather: {
      status: weatherLive ? "live" : summary.weather.status === "unavailable" ? "unavailable" : "stale",
      observedAt: summary.weather.observedAt ?? null,
      source: summary.weather.source,
      sourceUrl: summary.weather.sourceUrl,
      temperatureF: weatherLive ? summary.weather.temperatureF ?? null : null,
      windSpeed: weatherLive ? summary.weather.windSpeed ?? null : null,
      windDirection: weatherLive ? summary.weather.windDirection ?? null : null,
      shortForecast: weatherLive ? summary.weather.shortForecast ?? null : null,
      precipitationChancePct: weatherLive ? summary.weather.precipitationChancePct ?? null : null,
      validFrom: summary.weather.validFrom ?? null,
      validUntil: summary.weather.validUntil ?? null,
      alerts: weatherAlerts,
      freshness: summary.weather.freshness
    },
    ferry: {
      status: ferryLive
        ? summary.ferry.status
        : summary.ferry.status === "unavailable" || summary.ferry.freshness.state === "unavailable"
          ? "unavailable"
          : "stale",
      route: summary.ferry.route,
      source: summary.ferry.source,
      sourceUrl: summary.ferry.sourceUrl,
      observedAt: summary.ferry.observedAt,
      estimatedWaitMinutes: ferryLive ? summary.ferry.estimatedWaitMinutes : null,
      operatingFerries: ferryLive ? summary.ferry.operatingFerries : null,
      checkedAt: summary.ferry.checkedAt ?? null,
      directions: Array.isArray(summary.ferry.directions) ? summary.ferry.directions.map(direction => {
        const directionLive = ferryLive && freshness(direction.observedAt, now, 15).state === "live";
        return {
          id: direction.id,
          label: direction.label,
          status: directionLive
            ? direction.status
            : direction.status === "unavailable"
              ? "unavailable"
              : "stale",
          observedAt: direction.observedAt ?? null,
          estimatedWaitMinutes: directionLive ? direction.estimatedWaitMinutes ?? null : null,
          notice: directionLive ? direction.notice ?? null : null
        };
      }) : [],
      freshness: summary.ferry.freshness
    },
    summary: summary.summary,
    notices: summary.incidents
      .filter(incident => ACTIVE_INCIDENT_STATUSES.has(incident.status) && incident.publicImpact)
      .map(incident => ({
        id: incident.id,
        title: incident.title,
        summary: incident.summary,
        severity: incident.severity,
        updatedAt: incident.updatedAt
      })),
    cameras: summary.cameras.map(camera => {
      const observationIsPublic = camera.freshness.state === "live"
        && ["live", "degraded"].includes(camera.operationalStatus);
      return {
        id: camera.id,
        name: camera.name,
        zone: camera.zone,
        kind: camera.kind,
        sourceStatus: camera.sourceStatus,
        sourceUrl: camera.sourceUrl,
        operationalStatus: camera.operationalStatus,
        freshness: camera.freshness,
        level: camera.level,
        observation: observationIsPublic && camera.observation ? {
          observedAt: camera.observation.observedAt,
          peopleCount: camera.observation.peopleCount,
          vehicleCount: camera.observation.vehicleCount,
          flowPerMinute: camera.observation.flowPerMinute,
          queueLength: camera.observation.queueLength,
          occupancyPct: camera.observation.occupancyPct,
          estimatedWaitMinutes: camera.observation.estimatedWaitMinutes,
          level: camera.observation.level
        } : null
      };
    })
  };
}

function normalizeWeatherAlert(input) {
  if (!input || typeof input !== "object") return null;
  const id = text(input.id, 300);
  const event = text(input.event, 160);
  if (!id && !event) return null;
  return {
    id,
    event,
    severity: text(input.severity, 40),
    headline: text(input.headline, 300),
    expiresAt: iso(input.expiresAt)
  };
}

function activeWeatherAlerts(input, weatherFreshness, now) {
  const nowMs = new Date(now).getTime();
  return (Array.isArray(input) ? input : [])
    .map(normalizeWeatherAlert)
    .filter(Boolean)
    .filter(alert => {
      const expiresAtMs = alert.expiresAt ? new Date(alert.expiresAt).getTime() : Number.NaN;
      if (Number.isFinite(expiresAtMs) && Number.isFinite(nowMs)) return expiresAtMs > nowMs;
      return weatherFreshness?.state === "live";
    })
    .slice(0, 10);
}

export function summarizeIslandConditions(docInput, now = new Date().toISOString()) {
  const doc = normalizeIslandConditions(docInput);
  const cameras = latestCameraConditions(doc, now);
  const incidentSummary = summarizeOperationsIncidents(doc);
  const dispatchSummary = summarizeIncidentDispatches(doc);
  const fresh = cameras.filter(item => item.freshness.state === "live");
  const live = fresh.filter(item => item.operationalStatus === "live");
  const severity = live.reduce((max, item) => Math.max(max, LEVELS.indexOf(item.level)), 0);
  const weatherObservedFreshness = freshness(doc.weather.observedAt, now, 90);
  const weatherValidUntilMs = doc.weather.validUntil ? new Date(doc.weather.validUntil).getTime() : Number.NaN;
  const nowMs = new Date(now).getTime();
  const weatherFreshness = Number.isFinite(weatherValidUntilMs) && Number.isFinite(nowMs) && weatherValidUntilMs <= nowMs
    ? { state: "stale", ageMinutes: Math.max(0, Math.round((nowMs - weatherValidUntilMs) / 60_000)) }
    : weatherObservedFreshness;
  const directFerryFreshness = freshness(doc.ferry.observedAt, now, 15);
  const ferryCameras = live.filter(camera => camera.id.startsWith("ferry-") && camera.observation);
  const cameraFerryObservedAt = ferryCameras.map(camera => camera.observation.observedAt).sort().at(-1) ?? null;
  const cameraWait = ferryCameras.reduce((max, camera) => Math.max(max, number(camera.observation.estimatedWaitMinutes, 0)), 0);
  const ferry = directFerryFreshness.state === "live" || !cameraFerryObservedAt
    ? { ...doc.ferry, freshness: directFerryFreshness }
    : {
        ...doc.ferry,
        status: "camera_estimate",
        source: "SandFest signed camera metrics",
        observedAt: cameraFerryObservedAt,
        estimatedWaitMinutes: Math.round(cameraWait),
        freshness: freshness(cameraFerryObservedAt, now, 15)
      };
  return {
    lastUpdated: doc.lastUpdated,
    weather: { ...doc.weather, freshness: weatherFreshness },
    ferry,
    cameras,
    incidents: doc.incidents.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    dispatches: doc.dispatches.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    incidentPolicy: doc.incidentPolicy,
    incidentSummary,
    dispatchSummary,
    summary: {
      configuredCameras: cameras.filter(item => item.sourceStatus !== "awaiting_source").length,
      armedCameras: cameras.filter(item => item.monitoringEnabled).length,
      freshObservations: fresh.length,
      liveCameras: live.length,
      healthyPipelines: cameras.filter(item => item.monitoringEnabled && item.healthFreshness.state === "live" && item.health?.status === "healthy").length,
      degradedPipelines: cameras.filter(item => item.operationalStatus === "degraded").length,
      offlinePipelines: cameras.filter(item => ["offline", "error", "awaiting_heartbeat"].includes(item.operationalStatus)).length,
      standbyCameras: cameras.filter(item => item.operationalStatus === "standby").length,
      staleCameras: cameras.filter(item => item.freshness.state === "stale").length,
      awaitingSource: cameras.filter(item => item.sourceStatus === "awaiting_source").length,
      overallLevel: LEVELS[severity] ?? "unknown",
      activeIncidents: incidentSummary.active,
      publicNotices: incidentSummary.publicNotices
    }
  };
}

export function normalizeNwsForecast(forecastPayload, alertsPayload, now = new Date().toISOString()) {
  const periods = Array.isArray(forecastPayload?.properties?.periods)
    ? forecastPayload.properties.periods
    : [];
  const alerts = Array.isArray(alertsPayload?.features) ? alertsPayload.features : [];
  const nowMs = new Date(now).getTime();
  const period = periods.find(candidate => {
    const endMs = new Date(candidate?.endTime).getTime();
    return Number.isFinite(endMs) && Number.isFinite(nowMs) && endMs > nowMs;
  });
  const normalizedAlerts = activeWeatherAlerts(alerts.map(feature => ({
    id: feature.id,
    event: feature.properties?.event,
    severity: feature.properties?.severity,
    headline: feature.properties?.headline,
    expiresAt: feature.properties?.expires
  })), { state: "live" }, now);
  if (!period) {
    return {
      status: "unavailable",
      observedAt: now,
      source: "National Weather Service",
      sourceUrl: "https://api.weather.gov/gridpoints/CRP/123,36/forecast/hourly",
      alerts: normalizedAlerts
    };
  }
  return {
    status: "live",
    observedAt: now,
    source: "National Weather Service",
    sourceUrl: "https://api.weather.gov/gridpoints/CRP/123,36/forecast/hourly",
    temperatureF: number(period.temperature),
    windSpeed: text(period.windSpeed, 60),
    windDirection: text(period.windDirection, 20),
    shortForecast: text(period.shortForecast, 200),
    precipitationChancePct: number(period.probabilityOfPrecipitation?.value, 0),
    validFrom: iso(period.startTime),
    validUntil: iso(period.endTime),
    alerts: normalizedAlerts
  };
}

function txdotDmsRows(payload) {
  if (!payload?.roadwayDmses || typeof payload.roadwayDmses !== "object") return [];
  return Object.values(payload.roadwayDmses).flatMap(rows => Array.isArray(rows) ? rows : []);
}

function txdotDmsMessage(record) {
  const pages = Array.isArray(record?.messagePages) ? record.messagePages : [];
  const fromPages = pages
    .slice()
    .sort((a, b) => number(a?.pageNo, 0) - number(b?.pageNo, 0))
    .flatMap(page => Array.isArray(page?.lines) ? page.lines : [])
    .map(line => text(line, 120))
    .filter(Boolean)
    .join(" ");
  if (fromPages) return fromPages.replace(/\s+/g, " ").trim();
  return text(record?.message, 1000)
    .replace(/\[(?:nl|np)[^\]]*\]/gi, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTxdotWaitMinutes(message) {
  const normalized = text(message, 1000).toUpperCase();
  if (/\b(?:NO WAIT|NO DELAY)\b/.test(normalized)) return 0;
  const values = [...normalized.matchAll(/\b(\d{1,3})\s*(?:MIN(?:UTE)?S?)\b/g)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 600);
  return values.length ? Math.max(...values) : null;
}

function txdotServiceInterruption(message) {
  const normalized = text(message, 1000).toUpperCase();
  if (!normalized.includes("FERRY")) return false;
  return /\b(?:CLOSED|NOT OPERATING|OUT OF SERVICE|SERVICE SUSPENDED|SUSPENDED)\b/.test(normalized);
}

export function normalizeTxdotFerryStatus(payload, now = new Date().toISOString()) {
  const observedAt = iso(now, new Date().toISOString());
  const rows = txdotDmsRows(payload);
  const byId = new Map(rows.map(record => [text(record?.icd_Id, 160), record]));
  const directions = TXDOT_FERRY_SIGNS.map(spec => {
    const candidates = spec.signIds
      .map(id => byId.get(id))
      .filter(record => record && record.hasMessages === true && /online/i.test(text(record.statusDescription, 80)))
      .map(record => ({ record, message: txdotDmsMessage(record) }))
      .filter(item => item.message.toUpperCase().includes("FERRY") && item.message.toUpperCase().includes(spec.destination));
    const interruptions = candidates.filter(item => txdotServiceInterruption(item.message));
    const waits = candidates
      .map(item => parseTxdotWaitMinutes(item.message))
      .filter(value => value != null);
    const status = interruptions.length ? "service_interruption" : waits.length ? "live" : "unavailable";
    const selected = interruptions[0] ?? candidates.find(item => parseTxdotWaitMinutes(item.message) === Math.max(...waits)) ?? candidates[0];
    return {
      id: spec.id,
      label: spec.label,
      status,
      observedAt: status === "unavailable" ? null : observedAt,
      estimatedWaitMinutes: waits.length && !interruptions.length ? Math.max(...waits) : null,
      notice: interruptions.length ? text(interruptions[0].message, 300) : null,
      signId: selected ? text(selected.record.icd_Id, 160) : null,
      signName: selected ? text(selected.record.name, 160) : null,
      rawMessage: selected ? text(selected.message, 500) : null
    };
  });
  const liveDirections = directions.filter(direction => direction.status === "live");
  const interruptions = directions.filter(direction => direction.status === "service_interruption");
  const usableDirections = [...liveDirections, ...interruptions];
  const status = interruptions.length
    ? "service_interruption"
    : liveDirections.length === directions.length
      ? "live"
      : liveDirections.length
        ? "partial"
        : "unavailable";
  return {
    status,
    route: "Port Aransas Ferry",
    source: "TxDOT Corpus Christi DMS",
    sourceUrl: TXDOT_FERRY_SOURCE_URL,
    checkedAt: observedAt,
    observedAt: usableDirections.length ? observedAt : null,
    estimatedWaitMinutes: liveDirections.length
      ? Math.max(...liveDirections.map(direction => direction.estimatedWaitMinutes))
      : null,
    directions
  };
}

export async function fetchPortAransasWeather({ fetchImpl = fetch, timeoutMs = 6000, now = new Date().toISOString() } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "user-agent": "TexasSandFest-IslandConditions/1.0 contact@texassandfest.org", accept: "application/geo+json" };
  try {
    const [forecastResponse, alertsResponse] = await Promise.all([
      fetchImpl("https://api.weather.gov/gridpoints/CRP/123,36/forecast/hourly", { headers, signal: controller.signal }),
      fetchImpl("https://api.weather.gov/alerts/active?point=27.8339,-97.0611", { headers, signal: controller.signal })
    ]);
    if (!forecastResponse.ok || !alertsResponse.ok) throw new Error(`NWS returned ${forecastResponse.status}/${alertsResponse.status}`);
    return normalizeNwsForecast(await forecastResponse.json(), await alertsResponse.json(), now);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPortAransasFerryStatus({ fetchImpl = fetch, timeoutMs = 6000, now = new Date().toISOString() } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "user-agent": "TexasSandFest-IslandConditions/1.0 contact@texassandfest.org", accept: "application/json" };
  try {
    const response = await fetchImpl(TXDOT_FERRY_DMS_URL, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`TxDOT ITS returned ${response.status}`);
    return normalizeTxdotFerryStatus(await response.json(), now);
  } finally {
    clearTimeout(timeout);
  }
}
import { DEFAULT_EVENT_ID } from "./event-context.mjs";

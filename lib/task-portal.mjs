import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "sandfest-local-task-portal-secret-change-before-production";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function safeBaseUrl(value, production) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (production && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function taskPortalConfig(env = process.env) {
  const production = env.SANDFEST_ENV === "production";
  const configuredSecret = clean(env.SANDFEST_TASK_PORTAL_SECRET || env.SANDFEST_PARTNER_PORTAL_SECRET, 500);
  const secret = configuredSecret || (production ? "" : DEV_SECRET);
  const publicBaseUrl = safeBaseUrl(
    env.SANDFEST_PUBLIC_SITE_URL || (production ? "" : "http://127.0.0.1:5173"),
    production
  );
  const missing = [];
  if (secret.length < 32) missing.push("SANDFEST_TASK_PORTAL_SECRET or SANDFEST_PARTNER_PORTAL_SECRET(32+ chars)");
  if (!publicBaseUrl) missing.push(production ? "SANDFEST_PUBLIC_SITE_URL(HTTPS)" : "SANDFEST_PUBLIC_SITE_URL");
  return {
    ready: missing.length === 0,
    production,
    secret,
    publicBaseUrl,
    missing,
    reason: missing.length ? `Missing ${missing.join(", ")}` : null
  };
}

function assignmentVersion(task) {
  return Math.max(1, Math.round(Number(task?.assignmentVersion || 1)));
}

function tokenMessage(task) {
  return [
    "texas-sandfest-task-portal-v1",
    clean(task?.id, 120),
    clean(task?.assigneeType, 20).toLowerCase(),
    clean(task?.assigneeId, 120),
    String(assignmentVersion(task))
  ].join(":");
}

export function issueTaskPortalToken(task, options = {}) {
  const config = options.config ?? taskPortalConfig(options.env);
  if (!config.ready || !task?.id || !task?.assigneeId || task?.assigneeType === "unassigned") return null;
  const signature = createHmac("sha256", config.secret).update(tokenMessage(task)).digest("base64url");
  return `tsft_${signature}`;
}

export function verifyTaskPortalToken(task, token, options = {}) {
  const expected = issueTaskPortalToken(task, options);
  const received = clean(token, 200);
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function taskPortalPath(task, token) {
  if (!task?.id || !token) return null;
  return `/#task-status?task=${encodeURIComponent(task.id)}&token=${encodeURIComponent(token)}`;
}

export function taskPortalUrl(task, token, options = {}) {
  const config = options.config ?? taskPortalConfig(options.env);
  const path = taskPortalPath(task, token);
  if (!config.ready || !path) return null;
  return new URL(path, `${config.publicBaseUrl}/`).toString();
}

export function taskPortalUrlForTask(task, options = {}) {
  const config = options.config ?? taskPortalConfig(options.env);
  const token = issueTaskPortalToken(task, { config });
  return token ? taskPortalUrl(task, token, { config }) : null;
}

export function findTaskPortalTask(docInput, taskId, token, options = {}) {
  const id = clean(taskId, 120);
  const tasks = Array.isArray(docInput?.tasks) ? docInput.tasks : [];
  const task = tasks.find(item => clean(item.id, 120) === id && verifyTaskPortalToken(item, token, options));
  if (!task) return { ok: false, error: "Task assignment not found or access link invalid." };
  return { ok: true, task };
}

export function publicTaskPortalStatus(task) {
  const currentVersion = assignmentVersion(task);
  const terminal = ["done", "cancelled"].includes(task?.status);
  const updates = (Array.isArray(task?.assigneeUpdates) ? task.assigneeUpdates : [])
    .filter(item => Number(item?.assignmentVersion || 1) === currentVersion)
    .slice(-12)
    .map(item => ({
      action: clean(item.action, 30),
      note: clean(item.note, 500) || null,
      at: item.at ?? null
    }));
  const allowedActions = [];
  if (!terminal) {
    if (!task?.acknowledgedAt) allowedActions.push("acknowledge");
    if (task?.status !== "in_progress") allowedActions.push("start");
    if (task?.status !== "blocked") allowedActions.push("block");
    allowedActions.push("complete");
  }
  return {
    id: task.id,
    title: clean(task.title, 180),
    description: clean(task.description, 1000),
    status: clean(task.status, 30) || "open",
    priority: clean(task.priority, 30) || "normal",
    dueAt: task.dueAt ?? null,
    assignee: {
      type: clean(task.assigneeType, 20),
      name: clean(task.assigneeName, 120) || "SandFest assignee",
      role: clean(task.assigneeRole, 100) || null
    },
    acknowledgedAt: task.acknowledgedAt ?? null,
    startedAt: task.startedAt ?? null,
    blockedAt: task.blockedAt ?? null,
    completedAt: task.completedAt ?? null,
    updatedAt: task.updatedAt ?? null,
    updates,
    allowedActions
  };
}

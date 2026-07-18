import {
  createPartnerTask,
  normalizePartnerOperations,
  updatePartnerTask
} from "./partner-ops.mjs";
import { SANDFEST_TASK_TEAMS } from "./staff-directory.mjs";

const ACTIVE_TASK_STATUSES = new Set(["open", "in_progress", "blocked"]);
const TERMINAL_TASK_STATUSES = new Set(["done", "cancelled"]);
const DEPLOYMENT_ENTITY_TYPE = "deployment_check";
const ERROR_DUE_DAYS = 3;
const WARNING_DUE_DAYS = 14;
const DEFAULT_PRODUCTION_SYNC_INTERVAL_MS = 15 * 60_000;
const MINIMUM_SYNC_INTERVAL_MS = 60_000;
const MAXIMUM_SYNC_INTERVAL_MS = 24 * 60 * 60_000;

const TEAM_BY_GROUP = Object.freeze({
  Platform: "operations",
  Access: "operations",
  "Program data": "production",
  Revenue: "finance",
  Partners: "sponsor",
  Communications: "guest-services",
  "Field operations": "traffic"
});

const TEAM_NAMES = new Map(SANDFEST_TASK_TEAMS.map(team => [team.id, team.name]));

function deploymentChecks(input) {
  const values = Array.isArray(input) ? input : Object.values(input || {});
  return values
    .filter(check => check && String(check.id || "").trim())
    .map(check => ({
      id: String(check.id).trim().slice(0, 100),
      label: String(check.label || check.id).trim().slice(0, 140),
      group: String(check.group || "Other").trim().slice(0, 80),
      message: String(check.message || "No readiness detail was provided.").trim().slice(0, 700),
      ok: check.ok === true,
      severity: check.severity === "warning" ? "warning" : "error"
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function deadline(now, severity) {
  const days = severity === "error" ? ERROR_DUE_DAYS : WARNING_DUE_DAYS;
  return new Date(new Date(now).getTime() + days * 86_400_000).toISOString();
}

function taskFields(check) {
  const teamId = TEAM_BY_GROUP[check.group] || "operations";
  const status = check.severity === "warning" ? "Review" : "Blocked";
  return {
    title: `[Launch] ${check.label}`,
    description: `${check.group} readiness gate - ${status}: ${check.message}`,
    priority: check.severity === "warning" ? "high" : "urgent",
    assigneeType: "team",
    assigneeId: teamId,
    assigneeName: TEAM_NAMES.get(teamId) || teamId,
    assigneeRole: null,
    relatedEntityType: DEPLOYMENT_ENTITY_TYPE,
    relatedEntityId: check.id
  };
}

function newestFirst(left, right) {
  return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
}

function sameTaskFields(task, expected) {
  return task.title === expected.title
    && (task.description || "") === expected.description
    && task.priority === expected.priority
    && task.assigneeType === expected.assigneeType
    && task.assigneeId === expected.assigneeId
    && task.assigneeName === expected.assigneeName
    && (task.assigneeRole || null) === expected.assigneeRole;
}

function shouldAccelerateDueDate(task, check, targetDueAt) {
  if (!task.dueAt || Number.isNaN(new Date(task.dueAt).getTime())) return true;
  return check.severity === "error"
    && task.priority !== "urgent"
    && new Date(task.dueAt).getTime() > new Date(targetDueAt).getTime();
}

function deploymentTasks(doc) {
  return doc.tasks
    .filter(task => task.relatedEntityType === DEPLOYMENT_ENTITY_TYPE)
    .sort(newestFirst);
}

export function syncDeploymentCheckTasks(docInput, checksInput, options = {}) {
  const original = normalizePartnerOperations(docInput);
  let doc = original;
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory;
  const actorId = options.actorId || "deployment-readiness";
  const summary = {
    created: 0,
    updated: 0,
    reopened: 0,
    completed: 0,
    deduplicated: 0,
    unchanged: 0
  };

  const applyUpdate = (taskId, patch) => {
    const result = updatePartnerTask(doc, taskId, patch, { actorId, idFactory, now });
    if (!result.ok) return result;
    doc = result.doc;
    return result;
  };

  for (const check of deploymentChecks(checksInput)) {
    let changed = false;
    const matching = deploymentTasks(doc).filter(task => task.relatedEntityId === check.id);

    if (check.ok) {
      for (const task of matching.filter(item => ACTIVE_TASK_STATUSES.has(item.status))) {
        const result = applyUpdate(task.id, { status: "done" });
        if (!result.ok) return { ...summary, ok: false, changed: false, error: result.error, doc: original };
        summary.completed += 1;
        changed = true;
      }
      if (!changed) summary.unchanged += 1;
      continue;
    }

    const expected = taskFields(check);
    const active = matching.filter(task => ACTIVE_TASK_STATUSES.has(task.status));
    let task = active[0] || matching.find(item => TERMINAL_TASK_STATUSES.has(item.status)) || null;

    if (!task) {
      const result = createPartnerTask(doc, { ...expected, dueAt: deadline(now, check.severity) }, { actorId, idFactory, now });
      if (!result.ok) return { ...summary, ok: false, changed: false, error: result.error, doc: original };
      doc = result.doc;
      task = result.task;
      summary.created += 1;
      changed = true;
    } else {
      const reopening = TERMINAL_TASK_STATUSES.has(task.status);
      const targetDueAt = deadline(now, check.severity);
      const patch = {
        ...expected,
        status: reopening ? "open" : task.status
      };
      if (reopening || shouldAccelerateDueDate(task, check, targetDueAt)) patch.dueAt = targetDueAt;
      const dueDateChanged = patch.dueAt !== undefined && patch.dueAt !== task.dueAt;
      if (reopening || dueDateChanged || !sameTaskFields(task, expected)) {
        const result = applyUpdate(task.id, patch);
        if (!result.ok) return { ...summary, ok: false, changed: false, error: result.error, doc: original };
        task = result.task;
        summary[reopening ? "reopened" : "updated"] += 1;
        changed = true;
      }
    }

    for (const duplicate of deploymentTasks(doc).filter(item => item.relatedEntityId === check.id
      && item.id !== task.id
      && ACTIVE_TASK_STATUSES.has(item.status))) {
      const result = applyUpdate(duplicate.id, { status: "cancelled" });
      if (!result.ok) return { ...summary, ok: false, changed: false, error: result.error, doc: original };
      summary.deduplicated += 1;
      changed = true;
    }

    if (!changed) summary.unchanged += 1;
  }

  const tasks = deploymentTasks(doc);
  return {
    ...summary,
    ok: true,
    changed: Object.entries(summary).some(([key, value]) => key !== "unchanged" && value > 0),
    active: tasks.filter(task => ACTIVE_TASK_STATUSES.has(task.status)).length,
    taskIds: tasks.map(task => task.id),
    tasks,
    doc
  };
}

export function deploymentTaskSyncIntervalMs(value, options = {}) {
  const configured = value === undefined || value === null || String(value).trim() === ""
    ? (options.production === true ? DEFAULT_PRODUCTION_SYNC_INTERVAL_MS : 0)
    : Number(value);
  if (!Number.isFinite(configured) || !Number.isInteger(configured) || configured < 0) {
    throw new Error("SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS must be 0 or a whole number of milliseconds.");
  }
  if (configured === 0) return 0;
  if (configured < MINIMUM_SYNC_INTERVAL_MS || configured > MAXIMUM_SYNC_INTERVAL_MS) {
    throw new Error(`SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS must be between ${MINIMUM_SYNC_INTERVAL_MS} and ${MAXIMUM_SYNC_INTERVAL_MS} when enabled.`);
  }
  return configured;
}

export const deploymentTaskSyncPolicy = Object.freeze({
  entityType: DEPLOYMENT_ENTITY_TYPE,
  errorDueDays: ERROR_DUE_DAYS,
  warningDueDays: WARNING_DUE_DAYS,
  defaultProductionIntervalMs: DEFAULT_PRODUCTION_SYNC_INTERVAL_MS,
  minimumIntervalMs: MINIMUM_SYNC_INTERVAL_MS,
  maximumIntervalMs: MAXIMUM_SYNC_INTERVAL_MS,
  teamsByGroup: TEAM_BY_GROUP
});

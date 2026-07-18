import {
  createPartnerTask,
  normalizePartnerOperations,
  updatePartnerTask
} from "./partner-ops.mjs";

const DOCUMENT_TASK_STATUS = Object.freeze({
  received: "open",
  in_review: "in_progress",
  approved: "done",
  changes_requested: "blocked",
  archived: "cancelled"
});

const TEAM_LABELS = Object.freeze({
  operations: "Operations",
  sponsor: "Sponsor",
  finance: "Finance",
  "volunteer-captains": "Volunteer captains",
  traffic: "Traffic and parking",
  "guest-services": "Guest services",
  production: "Production"
});

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function reviewTaskForDocument(doc, documentId) {
  return doc.tasks.find(task => task.relatedEntityType === "incoming_document" && task.relatedEntityId === documentId) ?? null;
}

function desiredReviewTask(document) {
  const ownerTeam = clean(document?.ownerTeam, 80) || null;
  return {
    title: `Review document: ${clean(document?.title, 180)}`,
    description: `Review the private ${clean(document?.domain, 40) || "document"} intake file ${clean(document?.fileName, 180) || "source file"} in the governed document queue.`,
    status: DOCUMENT_TASK_STATUS[document?.status] || "open",
    priority: document?.status === "changes_requested" ? "high" : "normal",
    assigneeType: ownerTeam ? "team" : "unassigned",
    assigneeId: ownerTeam,
    assigneeName: ownerTeam ? TEAM_LABELS[ownerTeam] || ownerTeam : null,
    assigneeRole: ownerTeam,
    relatedEntityType: "incoming_document",
    relatedEntityId: clean(document?.id, 180),
    dueAt: document?.reviewDueAt || null
  };
}

function reviewTaskMatches(task, desired) {
  return [
    "title",
    "description",
    "status",
    "priority",
    "assigneeType",
    "assigneeId",
    "assigneeName",
    "assigneeRole",
    "relatedEntityType",
    "relatedEntityId",
    "dueAt"
  ].every(key => (task?.[key] ?? null) === (desired[key] ?? null));
}

export function syncIncomingDocumentReviewTask(docInput, document, options = {}) {
  const doc = normalizePartnerOperations(docInput);
  if (!clean(document?.id, 180) || !clean(document?.title, 180)) {
    return { ok: false, error: "Document review routing requires a document ID and title.", doc };
  }
  const desired = desiredReviewTask(document);
  const existing = reviewTaskForDocument(doc, desired.relatedEntityId);
  if (existing && reviewTaskMatches(existing, desired)) {
    return { ok: true, changed: false, created: false, task: existing, doc };
  }
  if (existing) {
    const updated = updatePartnerTask(doc, existing.id, desired, options);
    return updated.ok
      ? { ...updated, changed: true, created: false }
      : { ...updated, doc };
  }
  const created = createPartnerTask(doc, desired, options);
  if (!created.ok) return { ...created, doc };
  if (desired.status === "open") {
    return { ...created, changed: true, created: true };
  }
  const updated = updatePartnerTask(created.doc, created.task.id, desired, options);
  return updated.ok
    ? { ...updated, changed: true, created: true }
    : { ...updated, doc };
}

export function syncIncomingDocumentReviewTasks(docInput, documentsInput, options = {}) {
  let doc = normalizePartnerOperations(docInput);
  const documents = Array.isArray(documentsInput) ? documentsInput : [];
  const summary = { total: documents.length, created: 0, updated: 0, unchanged: 0 };
  for (const document of documents) {
    const documentEventId = clean(document?.eventId, 80);
    if (documentEventId && documentEventId !== doc.eventId) {
      return {
        ok: false,
        error: `Document review routing belongs to ${documentEventId}; partner operations expect ${doc.eventId}.`,
        doc,
        summary
      };
    }
    const result = syncIncomingDocumentReviewTask(doc, document, options);
    if (!result.ok) return { ...result, doc, summary };
    doc = result.doc;
    if (!result.changed) summary.unchanged += 1;
    else if (result.created) summary.created += 1;
    else summary.updated += 1;
  }
  return {
    ok: true,
    changed: summary.created + summary.updated > 0,
    doc,
    summary
  };
}

export function incomingDocumentReviewTaskView(docInput, documentId) {
  const doc = normalizePartnerOperations(docInput);
  const task = reviewTaskForDocument(doc, clean(documentId, 180));
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName,
    assigneeRole: task.assigneeRole,
    dueAt: task.dueAt,
    assignmentVersion: task.assignmentVersion,
    scheduleVersion: task.scheduleVersion,
    updatedAt: task.updatedAt
  };
}

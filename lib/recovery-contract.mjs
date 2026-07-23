import { createHash } from "node:crypto";
import {
  CURRENT_EVENT_OPERATIONAL_DOCUMENT_KEYS,
  DEFAULT_EVENT_ID,
  operationalDocumentEventId,
  parseEventId
} from "./event-context.mjs";
import { platformDocumentStorageKey } from "./platform-data.mjs";

export const RECOVERY_DATA_CONTRACT_VERSION = 1;

export const RECOVERY_REQUIRED_TABLE_COLUMNS = Object.freeze({
  config_documents: Object.freeze(["key", "data", "updated_at"]),
  orders: Object.freeze([
    "id",
    "event_id",
    "status",
    "stripe_checkout_session_id",
    "payment_intent_id",
    "idempotency_key_hash",
    "idempotency_fingerprint",
    "data",
    "created_at",
    "updated_at"
  ]),
  payment_events: Object.freeze([
    "id",
    "provider",
    "type",
    "verified",
    "checkout_session_id",
    "payment_intent_id",
    "fulfillment_status",
    "data",
    "received_at"
  ]),
  fulfillment_records: Object.freeze([
    "id",
    "order_id",
    "checkout_session_id",
    "payment_intent_id",
    "product_id",
    "status",
    "data",
    "created_at",
    "updated_at"
  ]),
  admin_audit_events: Object.freeze(["id", "action", "target_type", "target_id", "data", "created_at"]),
  config_snapshots: Object.freeze(["id", "target_type", "target_id", "data", "created_at"]),
  platform_documents: Object.freeze(["key", "data", "updated_at"]),
  hunt_completions: Object.freeze([
    "id",
    "hunt_id",
    "checkpoint_id",
    "attendee_ref",
    "method",
    "points",
    "data",
    "completed_at"
  ]),
  peoples_choice_votes: Object.freeze(["id", "event_id", "entry_id", "attendee_ref", "channel", "data", "voted_at"]),
  platform_jobs: Object.freeze([
    "id",
    "type",
    "status",
    "attempts",
    "max_attempts",
    "payload",
    "last_error",
    "run_after",
    "locked_by",
    "locked_at",
    "lease_token",
    "failure_handled_at",
    "created_at",
    "updated_at"
  ])
});

export const RECOVERY_REQUIRED_CONFIG_DOCUMENT_KEYS = Object.freeze([
  "admin-config",
  "app-bootstrap",
  "emergency-alert",
  "ticket-products"
]);

export const RECOVERY_REQUIRED_PLATFORM_DOCUMENTS = Object.freeze([
  ...CURRENT_EVENT_OPERATIONAL_DOCUMENT_KEYS.map(logicalKey => Object.freeze({
    logicalKey,
    storageKey: platformDocumentStorageKey(logicalKey),
    currentEvent: true
  })),
  Object.freeze({
    logicalKey: "revenue",
    storageKey: platformDocumentStorageKey("revenue"),
    currentEvent: false
  })
]);

const CONFIG_EVENT_BINDINGS = Object.freeze([
  Object.freeze({ key: "admin-config", path: Object.freeze(["sponsorPackagePublication", "eventId"]), label: "sponsor package publication" }),
  Object.freeze({ key: "admin-config", path: Object.freeze(["vendorOfferingPublication", "eventId"]), label: "vendor offering publication" }),
  Object.freeze({ key: "app-bootstrap", path: Object.freeze(["guide", "id"]), label: "published event guide" }),
  Object.freeze({ key: "app-bootstrap", path: Object.freeze(["schedulePublication", "eventId"]), label: "schedule publication" }),
  Object.freeze({ key: "app-bootstrap", path: Object.freeze(["guidancePublication", "eventId"]), label: "visitor guidance publication" }),
  Object.freeze({ key: "ticket-products", path: Object.freeze(["checkoutPolicy", "eventId"]), label: "ticket checkout policy" })
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rowsByKey(rows) {
  if (rows instanceof Map) return new Map(rows);
  if (Array.isArray(rows)) return new Map(rows.filter(row => row?.key).map(row => [row.key, row]));
  if (rows && typeof rows === "object") return new Map(Object.entries(rows));
  return new Map();
}

function columnsByTable(source) {
  if (source instanceof Map) {
    return new Map([...source].map(([table, columns]) => [table, new Set(columns || [])]));
  }
  if (source && typeof source === "object") {
    return new Map(Object.entries(source).map(([table, columns]) => [table, new Set(columns || [])]));
  }
  return new Map();
}

function documentData(row) {
  if (row && typeof row === "object" && "data" in row) return row.data;
  return row;
}

function updatedAt(row) {
  const value = row && typeof row === "object" ? row.updatedAt ?? row.updated_at : null;
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : null;
}

function valueAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function validDocument(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function documentManifest(rows, requiredKeys) {
  return requiredKeys.map(key => {
    const row = rows.get(key);
    return {
      key,
      updatedAt: updatedAt(row),
      dataSha256: sha256(canonicalJson(documentData(row)))
    };
  });
}

export function evaluateRecoverySchemaContract(tableColumns) {
  const errors = [];
  const schema = columnsByTable(tableColumns);
  for (const [table, requiredColumns] of Object.entries(RECOVERY_REQUIRED_TABLE_COLUMNS)) {
    const presentColumns = schema.get(table);
    if (!presentColumns) {
      errors.push(`Recovery database is missing required table ${table}.`);
      continue;
    }
    const missingColumns = requiredColumns.filter(column => !presentColumns.has(column));
    if (missingColumns.length) {
      errors.push(`Recovery table ${table} is missing required columns: ${missingColumns.join(", ")}.`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    requiredTables: Object.keys(RECOVERY_REQUIRED_TABLE_COLUMNS).length,
    requiredColumns: Object.values(RECOVERY_REQUIRED_TABLE_COLUMNS).reduce((total, columns) => total + columns.length, 0)
  };
}

export function evaluateRecoveryDataContract({
  tableColumns,
  configDocuments,
  platformDocuments,
  expectedEventId = DEFAULT_EVENT_ID,
  counts = {}
} = {}) {
  const errors = [];
  const configErrors = [];
  const operationalDocumentErrors = [];
  const eventAlignmentErrors = [];
  const schema = columnsByTable(tableColumns);
  const config = rowsByKey(configDocuments);
  const platform = rowsByKey(platformDocuments);
  const expectedEvent = parseEventId(expectedEventId);
  if (!expectedEvent) eventAlignmentErrors.push("Recovery event id must use texas-sandfest-YYYY.");

  const schemaContract = evaluateRecoverySchemaContract(schema);
  errors.push(...schemaContract.errors);

  for (const key of RECOVERY_REQUIRED_CONFIG_DOCUMENT_KEYS) {
    if (!config.has(key)) {
      configErrors.push(`Recovery database is missing required configuration ${key}.`);
      continue;
    }
    if (!validDocument(documentData(config.get(key)))) {
      configErrors.push(`Recovery configuration ${key} is not a JSON object.`);
    }
  }

  for (const requirement of RECOVERY_REQUIRED_PLATFORM_DOCUMENTS) {
    if (!platform.has(requirement.storageKey)) {
      operationalDocumentErrors.push(`Recovery database is missing required operational document ${requirement.storageKey}.`);
      continue;
    }
    const data = documentData(platform.get(requirement.storageKey));
    if (!validDocument(data)) {
      operationalDocumentErrors.push(`Recovery operational document ${requirement.storageKey} is not a JSON object.`);
      continue;
    }
    if (expectedEvent && requirement.currentEvent) {
      const actualEventId = operationalDocumentEventId(requirement.logicalKey, data);
      if (actualEventId !== expectedEvent.id) {
        eventAlignmentErrors.push(
          `Recovery operational document ${requirement.storageKey} belongs to ${actualEventId || "no event"}; expected ${expectedEvent.id}.`
        );
      }
    }
  }

  if (expectedEvent) {
    for (const binding of CONFIG_EVENT_BINDINGS) {
      const document = documentData(config.get(binding.key));
      if (!validDocument(document)) continue;
      const actualEventId = valueAtPath(document, binding.path);
      if (actualEventId !== expectedEvent.id) {
        eventAlignmentErrors.push(`Recovery ${binding.label} belongs to ${actualEventId || "no event"}; expected ${expectedEvent.id}.`);
      }
    }
    const guideStartDate = valueAtPath(documentData(config.get("app-bootstrap")), ["guide", "startDate"]);
    const guideYear = /^\d{4}-\d{2}-\d{2}$/.test(String(guideStartDate || ""))
      ? Number(String(guideStartDate).slice(0, 4))
      : null;
    if (guideYear !== expectedEvent.year) {
      eventAlignmentErrors.push(`Recovery published event guide starts in ${guideYear || "an unknown year"}; expected ${expectedEvent.year}.`);
    }
  }

  errors.push(...configErrors, ...operationalDocumentErrors, ...eventAlignmentErrors);
  const requiredTables = Object.keys(RECOVERY_REQUIRED_TABLE_COLUMNS);
  const ok = errors.length === 0;
  const manifest = ok ? {
    contractVersion: RECOVERY_DATA_CONTRACT_VERSION,
    eventId: expectedEvent.id,
    schema: requiredTables.sort().map(table => ({
      table,
      columns: [...RECOVERY_REQUIRED_TABLE_COLUMNS[table]].sort()
    })),
    configDocuments: documentManifest(config, [...RECOVERY_REQUIRED_CONFIG_DOCUMENT_KEYS].sort()),
    platformDocuments: documentManifest(
      platform,
      RECOVERY_REQUIRED_PLATFORM_DOCUMENTS.map(item => item.storageKey).sort()
    ),
    counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
  } : null;

  return {
    ok,
    errors,
    contractVersion: RECOVERY_DATA_CONTRACT_VERSION,
    eventId: expectedEvent?.id || null,
    requiredTables: schemaContract.requiredTables,
    requiredColumns: schemaContract.requiredColumns,
    requiredConfigDocuments: RECOVERY_REQUIRED_CONFIG_DOCUMENT_KEYS.length,
    requiredOperationalDocuments: RECOVERY_REQUIRED_PLATFORM_DOCUMENTS.length,
    checks: {
      schema: schemaContract.ok,
      configDocuments: configErrors.length === 0,
      operationalDocuments: operationalDocumentErrors.length === 0,
      eventAlignment: eventAlignmentErrors.length === 0
    },
    databaseManifestSha256: manifest ? sha256(canonicalJson(manifest)) : null
  };
}

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprintPath = path.join(ROOT, "render.yaml");
const blueprint = parse(fs.readFileSync(blueprintPath, "utf8"));

let passed = 0;
const failures = [];

function check(name, predicate, detail = "") {
  if (predicate) {
    passed += 1;
    console.log(`  ok ${name}`);
    return;
  }
  failures.push(detail ? `${name}: ${detail}` : name);
  console.error(`  not ok ${name}${detail ? ` - ${detail}` : ""}`);
}

const services = Array.isArray(blueprint?.services) ? blueprint.services : [];
const databases = Array.isArray(blueprint?.databases) ? blueprint.databases : [];
const serviceByName = new Map(services.map(service => [service?.name, service]));
const databaseByName = new Map(databases.map(database => [database?.name, database]));
const envEntries = service => Array.isArray(service?.envVars) ? service.envVars : [];
const envMap = service => new Map(envEntries(service).filter(entry => entry?.key).map(entry => [entry.key, entry]));

const admin = serviceByName.get("sandfest-admin");
const api = serviceByName.get("sandfest-api");
const worker = serviceByName.get("sandfest-worker");
const rateLimit = serviceByName.get("sandfest-rate-limit");
const database = databaseByName.get("sandfest-db");
const adminEnv = envMap(admin);
const apiEnv = envMap(api);
const workerEnv = envMap(worker);
const productionRepo = "https://github.com/nickbmerrill-collab/texas-sandfest";

const requiredCapabilities = [
  "camera_ingest",
  "document_ingestion",
  "outreach_discovery",
  "quickbooks_invoices",
  "sms_safety",
  "staff_directory",
  "stripe_partner_payments",
  "stripe_ticketing",
  "transactional_email"
];

const deferredProviderKeys = [
  "SANDFEST_DATABASE_RESTORE_DRILL_AT",
  "SANDFEST_ASSET_RESTORE_DRILL_AT",
  "OUTREACH_DISCOVERY_SECRET",
  "QB_CLIENT_ID",
  "QB_CLIENT_SECRET",
  "QB_REALM_ID",
  "QB_REFRESH_TOKEN",
  "QB_SPONSOR_ITEM_ID",
  "QB_VENDOR_ITEM_ID",
  "CAMERA_INGEST_KEYS",
  "CAMERA_INGEST_SECRET",
  "CAMERA_MODEL_APPROVAL_STATUS",
  "CAMERA_MODEL_NAME",
  "CAMERA_MODEL_VERSION",
  "CAMERA_MODEL_SHA256",
  "CAMERA_MODEL_LICENSE_REFERENCE",
  "CAMERA_MODEL_APPROVED_BY",
  "CAMERA_MODEL_APPROVED_AT",
  "CAMERA_MODEL_DECISION_REFERENCE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_WEBHOOK_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID"
];

const workerSharedKeys = [
  "SANDFEST_PARTNER_PORTAL_SECRET",
  "SANDFEST_OUTREACH_PREFERENCES_SECRET",
  "SANDFEST_DOCUMENT_EXTRACTION_SECRET",
  "QB_ENVIRONMENT",
  "QB_INVOICE_SYNC_ENABLED",
  "QB_REDIRECT_URI",
  "QB_TOKEN_ENCRYPTION_KEY",
  "QB_MINOR_VERSION",
  "TRANSACTIONAL_EMAIL_ENABLED",
  "BREVO_SENDER_NAME",
  "BREVO_REPLY_TO_EMAIL",
  "SMS_ENABLED",
  "TWILIO_API_BASE_URL",
  "TWILIO_STATUS_CALLBACK_URL",
  "TWILIO_SAFETY_INBOUND_WEBHOOK_URL",
  "TWILIO_MARKETING_INBOUND_WEBHOOK_URL",
  "SANDFEST_SMS_MAX_RECIPIENTS"
];

console.log("\n=== Render Blueprint production contract ===\n");

check("service names are unique", serviceByName.size === services.length);
check("database names are unique", databaseByName.size === databases.length);
check("Git-backed services declare the production repository", [admin, api, worker].every(service => service?.repo === productionRepo));
check("admin is an isolated static service", admin?.type === "web" && admin?.runtime === "static" && admin?.staticPublishPath === "./dist-admin");
check("admin publishes only after checks pass", admin?.branch === "main" && admin?.autoDeployTrigger === "checksPass" && admin?.autoDeploy === undefined);
check("admin owns the canonical operations domain", admin?.domains?.includes("sandfest-admin.heyelab.com"));
check("API is a checks-gated Docker service", api?.type === "web" && api?.runtime === "docker" && api?.branch === "main" && api?.autoDeployTrigger === "checksPass");
check("API health probe verifies the process and data plane", api?.healthCheckPath === "/health");
check("API owns a dedicated SandFest hostname", api?.domains?.includes("sandfest-api.heyelab.com"));
check("API uses the dedicated production origin without a shared path prefix", apiEnv.get("SANDFEST_ENV")?.value === "production" && !apiEnv.has("SANDFEST_API_PREFIX"));
check("API links and CORS include the canonical visitor site", apiEnv.get("SANDFEST_PUBLIC_SITE_URL")?.value === "https://sandfest.heyelab.com" && String(apiEnv.get("SANDFEST_CORS_ORIGINS")?.value || "").split(",").includes("https://sandfest.heyelab.com"));
check("API release policy covers Pages preflight and admin origins", [
  "https://nickbmerrill-collab.github.io",
  "https://sandfest-admin.heyelab.com"
].every(origin => String(apiEnv.get("SANDFEST_CORS_ORIGINS")?.value || "").split(",").includes(origin))
  && String(apiEnv.get("SANDFEST_TURNSTILE_HOSTNAMES")?.value || "").split(",").includes("nickbmerrill-collab.github.io"));
check("Stripe returns to the canonical visitor site", apiEnv.get("STRIPE_SUCCESS_URL")?.value?.startsWith("https://sandfest.heyelab.com/") && apiEnv.get("STRIPE_CANCEL_URL")?.value?.startsWith("https://sandfest.heyelab.com/"));
check("API continuously reconciles launch work", Number(apiEnv.get("SANDFEST_DEPLOYMENT_TASK_SYNC_INTERVAL_MS")?.value) === 15 * 60_000);
check("API uses private managed Postgres", apiEnv.get("SANDFEST_DATABASE_URL")?.fromDatabase?.name === "sandfest-db" && apiEnv.get("SANDFEST_DATABASE_URL")?.fromDatabase?.property === "connectionString");
check("API uses private managed rate limiting", apiEnv.get("REDIS_URL")?.fromService?.type === "keyvalue" && apiEnv.get("REDIS_URL")?.fromService?.name === "sandfest-rate-limit" && apiEnv.get("REDIS_URL")?.fromService?.property === "connectionString");
check("API private capabilities are generated", apiEnv.get("SANDFEST_PARTNER_PORTAL_SECRET")?.generateValue === true && apiEnv.get("SANDFEST_OUTREACH_PREFERENCES_SECRET")?.generateValue === true && apiEnv.get("SANDFEST_DOCUMENT_EXTRACTION_SECRET")?.generateValue === true && apiEnv.get("QB_TOKEN_ENCRYPTION_KEY")?.generateValue === true);
check("private document intake uses the attached disk", api?.disk?.mountPath === "/var/data/sandfest-partner-assets" && apiEnv.get("SANDFEST_INCOMING_DOCUMENT_DIR")?.value === "/var/data/sandfest-partner-assets/incoming-documents" && Number(apiEnv.get("SANDFEST_INCOMING_DOCUMENT_MAX_BYTES")?.value) === 20 * 1024 * 1024);
check("launch capability gates are complete", String(apiEnv.get("SANDFEST_REQUIRED_CAPABILITIES")?.value || "").split(",").sort().join(",") === requiredCapabilities.sort().join(","));
check("post-board provider capabilities default off", [
  "OUTREACH_DISCOVERY_ENABLED",
  "QB_INVOICE_SYNC_ENABLED",
  "SANDFEST_ISLAND_CONDITIONS_LIVE_FEEDS_ENABLED",
  "CAMERA_INGEST_ENABLED",
  "STRIPE_TICKETING_ENABLED",
  "STRIPE_PARTNER_PAYMENTS_ENABLED",
  "TRANSACTIONAL_EMAIL_ENABLED",
  "SMS_ENABLED"
].every(key => apiEnv.get(key)?.value === "false"));
check("post-board provider credentials are omitted until enablement", deferredProviderKeys.every(key => !apiEnv.has(key)));
check("initial Blueprint requests only core auth and intake values", [
  ...envEntries(admin).filter(entry => entry?.sync === false).map(entry => `admin:${entry.key}`),
  ...envEntries(api).filter(entry => entry?.sync === false).map(entry => `api:${entry.key}`),
  ...envEntries(worker).filter(entry => entry?.sync === false).map(entry => `worker:${entry.key}`)
].sort().join(",") === [
  "admin:VITE_SANDFEST_AUTH_CLIENT_ID",
  "api:SANDFEST_TURNSTILE_SECRET_KEY"
].sort().join(","));
check("admin still requires the registered production OIDC client", adminEnv.get("VITE_SANDFEST_AUTH_CLIENT_ID")?.sync === false);
check("worker is a checks-gated Docker service", worker?.type === "worker" && worker?.runtime === "docker" && worker?.branch === "main" && worker?.autoDeployTrigger === "checksPass");
check("worker shares the production database", workerEnv.get("SANDFEST_DATABASE_URL")?.fromDatabase?.name === "sandfest-db" && workerEnv.get("SANDFEST_DATABASE_URL")?.fromDatabase?.property === "connectionString");
check("worker event matches API event", workerEnv.get("SANDFEST_EVENT_ID")?.value === apiEnv.get("SANDFEST_EVENT_ID")?.value);
check("worker generates links for the canonical visitor site", workerEnv.get("SANDFEST_PUBLIC_SITE_URL")?.value === apiEnv.get("SANDFEST_PUBLIC_SITE_URL")?.value);
check("worker reads extraction sources through the stable API service origin, not a shared disk", workerEnv.get("SANDFEST_DOCUMENT_EXTRACTION_SOURCE_URL")?.value === "https://sandfest-api.onrender.com" && !workerEnv.has("SANDFEST_INCOMING_DOCUMENT_DIR"));

for (const key of workerSharedKeys) {
  const reference = workerEnv.get(key)?.fromService;
  check(`worker inherits ${key} from API`, reference?.type === "web" && reference?.name === "sandfest-api" && reference?.envVarKey === key);
}

check("rate limiter is private and non-evicting", rateLimit?.type === "keyvalue" && rateLimit?.plan !== "free" && Array.isArray(rateLimit?.ipAllowList) && rateLimit.ipAllowList.length === 0 && rateLimit?.maxmemoryPolicy === "noeviction");
check("rate-limit counters are intentionally ephemeral", rateLimit?.persistenceMode === "off");
check("Postgres is paid and private", database?.plan !== "free" && Array.isArray(database?.ipAllowList) && database.ipAllowList.length === 0);
check("Postgres has autoscaling storage", database?.storageAutoscalingEnabled === true && Number(database?.diskSizeGB) >= 15);

for (const service of services) {
  const entries = envEntries(service);
  const keys = entries.filter(entry => entry?.key).map(entry => entry.key);
  check(`${service.name} environment keys are unique`, new Set(keys).size === keys.length);

  for (const entry of entries) {
    if (entry?.fromDatabase) {
      check(`${service.name}.${entry.key} references an existing database`, databaseByName.has(entry.fromDatabase.name));
    }
    if (entry?.fromService) {
      const source = serviceByName.get(entry.fromService.name);
      check(`${service.name}.${entry.key} references an existing service`, Boolean(source));
      if (entry.fromService.envVarKey) {
        check(`${service.name}.${entry.key} references an existing source variable`, envMap(source).has(entry.fromService.envVarKey));
      }
    }
  }
}

console.log(`\nRender Blueprint contract: ${passed} passed, ${failures.length} failed.`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

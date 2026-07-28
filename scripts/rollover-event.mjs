#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { eventContextConfig } from "../lib/event-context.mjs";
import { planEventRollover, ROLLOVER_DOCUMENT_KEYS } from "../lib/event-rollover.mjs";
import { applyPostgresEventRollover } from "../lib/event-rollover-postgres.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";
import { resolveRuntimeRoot } from "../lib/runtime-root.mjs";
import {
  listPassportCompletions,
  listVotes,
  readPlatformDoc,
  writePlatformDoc
} from "../lib/platform-data.mjs";
import { createStorage } from "../lib/storage.mjs";

await loadDotEnv();

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolveRuntimeRoot(CODE_ROOT);
const args = process.argv.slice(2);
const valueFor = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const apply = args.includes("--apply");
const fromEventId = valueFor("--from");
const toEventId = valueFor("--to") || eventContextConfig(process.env).eventId;

if (!fromEventId) throw new Error("Usage: npm run event:rollover -- --from texas-sandfest-YYYY [--to texas-sandfest-YYYY] [--apply]");
if (apply && process.env.SANDFEST_ROLLOVER_MAINTENANCE !== "true") {
  throw new Error("Apply requires SANDFEST_ROLLOVER_MAINTENANCE=true and stopped API/worker services.");
}

const storage = await createStorage({ root: ROOT });
try {
  if (apply && storage.kind === "postgres") {
    const result = await applyPostgresEventRollover({
      root: ROOT,
      fromEventId,
      toEventId,
      actorId: process.env.SANDFEST_ADMIN_ACTOR_ID || "event-rollover-cli"
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    const bootstrap = await storage.config.read("app-bootstrap");
    const storedDocuments = Object.fromEntries(await Promise.all(
      ROLLOVER_DOCUMENT_KEYS.map(async key => [key, await readPlatformDoc(ROOT, key, null)])
    ));
    const [passportCompletions, votes] = await Promise.all([
      listPassportCompletions(ROOT, { huntId: storedDocuments.passportHunt?.hunt?.id }),
      listVotes(ROOT, { eventId: fromEventId })
    ]);
    const archiveDocuments = {
      ...storedDocuments,
      passportCompletions: { ...storedDocuments.passportCompletions, completions: passportCompletions },
      voting: { ...storedDocuments.voting, votes }
    };
    const plan = planEventRollover({ fromEventId, toEventId, guide: bootstrap.guide, documents: archiveDocuments });
    if (!plan.ok) throw new Error(plan.error);

    const result = {
      ok: true,
      mode: apply ? "applied" : "dry-run",
      storage: storage.kind,
      atomic: apply ? false : null,
      fromEventId: plan.fromEventId,
      toEventId: plan.toEventId,
      archiveDigest: plan.archiveDigest,
      summary: plan.summary
    };
    if (!apply) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const archive = {
        id: `rollover_${randomUUID()}`,
        eventId: plan.fromEventId,
        target: { type: "eventRollover", id: `${plan.fromEventId}-to-${plan.toEventId}` },
        reason: `Archive before event rollover from ${plan.fromEventId} to ${plan.toEventId}`,
        actor: { id: process.env.SANDFEST_ADMIN_ACTOR_ID || "event-rollover-cli", type: "maintenance-cli" },
        data: { archiveDigest: plan.archiveDigest, documents: archiveDocuments },
        createdAt: plan.now
      };
      await storage.snapshots.write(archive);

      const written = [];
      try {
        for (const key of ROLLOVER_DOCUMENT_KEYS) {
          await writePlatformDoc(ROOT, key, plan.documents[key]);
          written.push(key);
        }
        const persisted = Object.fromEntries(await Promise.all(
          ROLLOVER_DOCUMENT_KEYS.map(async key => [key, await readPlatformDoc(ROOT, key, null)])
        ));
        const mismatches = ROLLOVER_DOCUMENT_KEYS.filter(key => !isDeepStrictEqual(persisted[key], plan.documents[key]));
        if (mismatches.length) throw new Error(`Read-back verification failed for: ${mismatches.join(", ")}.`);
      } catch (error) {
        const restoreFailures = [];
        for (const key of written.reverse()) {
          try {
            await writePlatformDoc(ROOT, key, storedDocuments[key]);
            const restored = await readPlatformDoc(ROOT, key, null);
            if (!isDeepStrictEqual(restored, storedDocuments[key])) restoreFailures.push(`${key} (verification mismatch)`);
          } catch (restoreError) {
            restoreFailures.push(`${key} (${restoreError.message})`);
          }
        }
        if (restoreFailures.length) {
          throw new Error(`Rollover failed and automatic restore is incomplete for ${restoreFailures.join(", ")}. Original failure: ${error.message}`);
        }
        throw new Error(`Rollover failed and prior documents were restored: ${error.message}`);
      }

      result.archiveId = archive.id;
      result.verifiedDocuments = ROLLOVER_DOCUMENT_KEYS.length;
      result.restoreMode = "compensating-file-restore";
      console.log(JSON.stringify(result, null, 2));
    }
  }
} finally {
  await storage.close?.();
}

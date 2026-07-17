// Storage factory.
//
// File mode is the default — same on-disk layout as before, no extra deps.
// Postgres mode activates when SANDFEST_DATABASE_URL is set; the schema in
// lib/db/schema.sql runs idempotently on init() and config_documents is
// seeded from the matching local JSON files on first boot.

import { createFileStorage } from "./storage-file.mjs";

export async function createStorage({ root, configPaths, auditDir, orderDir, paymentEventDir, fulfillmentDir } = {}) {
  if (!root) {
    throw new Error("createStorage requires a root path.");
  }
  if (process.env.SANDFEST_DATABASE_URL) {
    const { createPostgresStorage } = await import("./storage-postgres.mjs");
    const storage = createPostgresStorage({ root, configPaths });
    await storage.init();
    return storage;
  }
  const storage = createFileStorage({ root, configPaths, auditDir, orderDir, paymentEventDir, fulfillmentDir });
  await storage.init();
  return storage;
}

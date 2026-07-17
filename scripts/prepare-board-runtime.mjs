#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBoardRuntime } from "../lib/board-runtime.mjs";
import { eventContextConfig } from "../lib/event-context.mjs";
import { loadDotEnv } from "../lib/load-env.mjs";

await loadDotEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueFor = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const targetRoot = path.resolve(ROOT, valueFor("--output") || ".sandfest-runtime/board-2027");
const result = await prepareBoardRuntime({
  sourceRoot: ROOT,
  targetRoot,
  eventId: eventContextConfig(process.env).eventId,
  replace: args.includes("--replace")
});

console.log(JSON.stringify(result, null, 2));

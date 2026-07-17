import { access, copyFile, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(root, process.env.SANDFEST_BUILD_OUT_DIR || "dist-admin");
const adminEntry = path.join(outDir, "admin.html");
const rootEntry = path.join(outDir, "index.html");

await access(adminEntry);
await copyFile(adminEntry, rootEntry);
await rm(adminEntry);

console.log(`Promoted ${path.relative(root, adminEntry)} to ${path.relative(root, rootEntry)}.`);

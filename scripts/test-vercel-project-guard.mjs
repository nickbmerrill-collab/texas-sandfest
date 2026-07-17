import assert from "node:assert/strict";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verify-vercel-project.mjs", import.meta.url));
const baseEnv = { ...process.env };

for (const key of ["VERCEL", "VERCEL_PROJECT_ID", "VERCEL_GIT_REPO_ID"]) delete baseEnv[key];

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...baseEnv, ...extraEnv }
  });
}

const local = run();
assert.equal(local.status, 0);
assert.match(local.stdout, /skipped outside Vercel/);

const expected = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_g8hcQNlvj2G1iu07pmL2iVEh8tU8",
  VERCEL_GIT_REPO_ID: "1226718335"
});
assert.equal(expected.status, 0);
assert.match(expected.stdout, /verified the dedicated Texas SandFest project/);

const wrongProject = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_wrong_project",
  VERCEL_GIT_REPO_ID: "1226718335"
});
assert.equal(wrongProject.status, 1);
assert.match(wrongProject.stderr, /unexpected Vercel project/);

const wrongRepository = run({
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_g8hcQNlvj2G1iu07pmL2iVEh8tU8",
  VERCEL_GIT_REPO_ID: "999999999"
});
assert.equal(wrongRepository.status, 1);
assert.match(wrongRepository.stderr, /not the Texas SandFest repository/);

console.log("Vercel project guard: 4 passed, 0 failed.");

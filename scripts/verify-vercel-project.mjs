import process from "node:process";

const EXPECTED_PROJECT_ID = "prj_g8hcQNlvj2G1iu07pmL2iVEh8tU8";
const EXPECTED_REPOSITORY_ID = "1226718335";

if (process.env.VERCEL !== "1") {
  console.log("Vercel project guard skipped outside Vercel.");
  process.exit(0);
}

const failures = [];

if (process.env.VERCEL_PROJECT_ID !== EXPECTED_PROJECT_ID) {
  failures.push(`project ${process.env.VERCEL_PROJECT_ID || "missing"} is not the dedicated Texas SandFest project`);
}

if (process.env.VERCEL_GIT_REPO_ID !== EXPECTED_REPOSITORY_ID) {
  failures.push(`repository ${process.env.VERCEL_GIT_REPO_ID || "missing"} is not the Texas SandFest repository`);
}

if (failures.length) {
  console.error("Refusing to build Texas SandFest in an unexpected Vercel project:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Vercel project guard verified the dedicated Texas SandFest project and repository.");

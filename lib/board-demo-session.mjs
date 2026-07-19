import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const BOARD_DEMO_SESSION_MODE = "board_demo_supervisor";
export const BOARD_DEMO_SESSION_SCHEMA_VERSION = 2;

const execFileAsync = promisify(execFile);

async function gitOutput(root, args, { optional = false } = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000
    });
    return String(stdout || "").trim();
  } catch (error) {
    if (optional) return null;
    throw new Error(`Board demo source revision could not be resolved: ${error.message}`);
  }
}

export async function boardDemoSourceRevision(root = process.cwd()) {
  const [commit, branchValue, originMainCommit, statusValue] = await Promise.all([
    gitOutput(root, ["rev-parse", "HEAD"]),
    gitOutput(root, ["branch", "--show-current"]),
    gitOutput(root, ["rev-parse", "--verify", "refs/remotes/origin/main"], { optional: true }),
    gitOutput(root, ["status", "--porcelain=v1", "--untracked-files=all"])
  ]);
  const status = String(statusValue || "")
    .split("\n")
    .map(value => value.trimEnd())
    .filter(Boolean)
    .sort()
    .join("\n");
  return {
    commit,
    branch: branchValue || "detached",
    originMainCommit,
    matchesOriginMain: Boolean(originMainCommit && commit === originMainCommit),
    dirty: Boolean(status),
    changeCount: status ? status.split("\n").length : 0,
    statusHash: createHash("sha256").update(status).digest("hex")
  };
}

export function assessBoardDemoSourceRevision(expected, current) {
  const reasons = [];
  if (!expected || !/^[a-f0-9]{40}$/i.test(String(expected.commit || ""))) {
    reasons.push("The session has no valid source commit.");
  }
  if (!current || !/^[a-f0-9]{40}$/i.test(String(current.commit || ""))) {
    reasons.push("The current source commit is unavailable.");
  }
  if (expected?.commit !== current?.commit) reasons.push("The checked-out commit changed after startup.");
  if (expected?.branch !== current?.branch) reasons.push("The checked-out branch changed after startup.");
  if (expected?.statusHash !== current?.statusHash) reasons.push("The worktree changed after startup.");
  if (expected?.requireMain && current?.branch !== "main") reasons.push("The board command requires the main branch.");
  if (expected?.requireMain && !current?.matchesOriginMain) reasons.push("The checked-out commit does not match local origin/main.");
  if (!expected?.allowDirty && current?.dirty) reasons.push("The board command requires a clean worktree.");
  return {
    ok: reasons.length === 0,
    reasons,
    detail: reasons.length
      ? reasons.join(" ")
      : `${current.branch}@${current.commit.slice(0, 8)} is ${current.dirty ? "unchanged from the explicitly allowed dirty snapshot" : "clean and unchanged"}${current.matchesOriginMain ? " at local origin/main" : ""}.`
  };
}

export function boardDemoSessionPath(env = process.env, { root = process.cwd() } = {}) {
  return path.resolve(root, String(env.SANDFEST_BOARD_SESSION_FILE || ".sandfest-runtime/board-demo-session.json"));
}

export async function readBoardDemoSession(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return value?.mode === BOARD_DEMO_SESSION_MODE ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Board demo session state is invalid: ${error.message}`);
  }
}

export async function writeBoardDemoSession(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function boardDemoEnvironmentFromSession(env = process.env, { root = process.cwd() } = {}) {
  const filePath = boardDemoSessionPath(env, { root });
  const session = await readBoardDemoSession(filePath);
  if (!session || !boardDemoSessionProcessAlive(session)) return { ...env };
  const endpoints = session.endpoints || {};
  if (!endpoints.webBase || !endpoints.apiBase || !endpoints.emailBase || !endpoints.smsBase) return { ...env };
  const resolved = { ...env };
  const sessionDefaults = {
    SANDFEST_BOARD_PUBLIC_SITE_URL: endpoints.webBase,
    SANDFEST_BOARD_API_BASE: endpoints.apiBase,
    SANDFEST_BOARD_EMAIL_BASE: endpoints.emailBase,
    SANDFEST_BOARD_SMS_BASE: endpoints.smsBase
  };
  for (const [key, value] of Object.entries(sessionDefaults)) {
    if (!String(resolved[key] || "").trim()) resolved[key] = value;
  }
  return resolved;
}

export function boardDemoSessionProcessAlive(session) {
  const pid = Number(session?.pid);
  if (!Number.isInteger(pid) || pid < 1 || ["stopped", "error"].includes(session?.status)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

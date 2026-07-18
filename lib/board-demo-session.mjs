import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const BOARD_DEMO_SESSION_MODE = "board_demo_supervisor";

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

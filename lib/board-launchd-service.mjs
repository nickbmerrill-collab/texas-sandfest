import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export const BOARD_LAUNCHD_LABEL = "com.heyelab.sandfest.board";

const execFileAsync = promisify(execFile);

function validLabel(value) {
  return /^[A-Za-z0-9.-]+$/.test(String(value || ""));
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

export function boardLaunchdTarget({ uid = process.getuid?.(), label = BOARD_LAUNCHD_LABEL } = {}) {
  if (!Number.isInteger(uid) || uid < 1) throw new Error("A valid macOS user ID is required.");
  if (!validLabel(label)) throw new Error("The board launchd label is invalid.");
  return `gui/${uid}/${label}`;
}

export function boardLaunchdCommand({
  root,
  npmPath,
  logPath = path.join(root, ".sandfest-runtime", "board-demo-supervisor.log")
}) {
  if (![root, npmPath, logPath].every(value => String(value || "").trim())) {
    throw new Error("Board launchd paths are required.");
  }
  const resolvedRoot = path.resolve(String(root));
  const resolvedNpm = path.resolve(String(npmPath));
  const resolvedLog = path.resolve(String(logPath));
  if (!path.isAbsolute(resolvedRoot) || !path.isAbsolute(resolvedNpm) || !path.isAbsolute(resolvedLog)) {
    throw new Error("Board launchd paths must be absolute.");
  }
  return `mkdir -p ${shellQuote(path.dirname(resolvedLog))} && cd ${shellQuote(resolvedRoot)} && exec ${shellQuote(resolvedNpm)} run board:demo -- --reset >> ${shellQuote(resolvedLog)} 2>&1`;
}

export function assessBoardLaunchdOwnership(output, {
  root,
  label = BOARD_LAUNCHD_LABEL
}) {
  const text = String(output || "");
  const resolvedRoot = path.resolve(String(root || ""));
  const markers = [label, resolvedRoot, "board:demo", "--reset"];
  const missing = markers.filter(marker => !text.includes(marker));
  return {
    owned: missing.length === 0,
    missing,
    detail: missing.length
      ? `Launchd job ${label} is not owned by this checkout.`
      : `Launchd job ${label} is owned by ${resolvedRoot}.`
  };
}

export function launchctlServiceMissing(error) {
  const detail = `${error?.message || ""}\n${error?.stderr || ""}`;
  return Number(error?.code) === 113
    || /could not find service/i.test(detail)
    || /service .* not found/i.test(detail);
}

export function boardLaunchdStartSafety({ serviceInstalled, supervisorAlive }) {
  if (!serviceInstalled && supervisorAlive) {
    return {
      ok: false,
      reason: "A foreground board supervisor is already active. Run npm run board:stop before installing the persistent service."
    };
  }
  return { ok: true, reason: null };
}

export function createBoardLaunchdController({
  root,
  uid = process.getuid?.(),
  platform = process.platform,
  label = BOARD_LAUNCHD_LABEL,
  runFile = execFileAsync,
  npmPath = null,
  logPath = null
}) {
  const resolvedRoot = path.resolve(String(root || ""));
  const target = boardLaunchdTarget({ uid, label });

  async function inspect() {
    if (platform !== "darwin") {
      return {
        supported: false,
        installed: false,
        owned: false,
        label,
        target,
        detail: "The board launchd service is available only on macOS."
      };
    }
    try {
      const { stdout = "" } = await runFile("launchctl", ["print", target], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 10_000
      });
      const ownership = assessBoardLaunchdOwnership(stdout, { root: resolvedRoot, label });
      return {
        supported: true,
        installed: true,
        label,
        target,
        output: String(stdout),
        ...ownership
      };
    } catch (error) {
      if (!launchctlServiceMissing(error)) throw error;
      return {
        supported: true,
        installed: false,
        owned: false,
        label,
        target,
        detail: `Launchd job ${label} is not installed.`
      };
    }
  }

  async function requireOwned() {
    const state = await inspect();
    if (!state.supported) throw new Error(state.detail);
    if (state.installed && !state.owned) {
      throw new Error(`Refusing to control ${label}; the existing job is not owned by ${resolvedRoot}.`);
    }
    return state;
  }

  async function resolvedNpmPath() {
    if (npmPath) return path.resolve(npmPath);
    const { stdout = "" } = await runFile("which", ["npm"], {
      encoding: "utf8",
      timeout: 10_000
    });
    const value = String(stdout).trim();
    if (!path.isAbsolute(value)) throw new Error("Could not resolve an absolute npm executable for launchd.");
    return value;
  }

  async function start() {
    const state = await requireOwned();
    if (state.installed) return { action: "already_running", state };
    const command = boardLaunchdCommand({
      root: resolvedRoot,
      npmPath: await resolvedNpmPath(),
      logPath: logPath || path.join(resolvedRoot, ".sandfest-runtime", "board-demo-supervisor.log")
    });
    await runFile("launchctl", [
      "submit",
      "-l",
      label,
      "--",
      "/bin/zsh",
      "-lc",
      command
    ], {
      encoding: "utf8",
      timeout: 10_000
    });
    return { action: "started", command };
  }

  async function restart() {
    const state = await requireOwned();
    if (!state.installed) return start();
    await runFile("launchctl", ["kickstart", "-k", target], {
      encoding: "utf8",
      timeout: 30_000
    });
    return { action: "restarted", state };
  }

  async function stop() {
    const state = await requireOwned();
    if (!state.installed) return { action: "not_installed", state };
    await runFile("launchctl", ["bootout", target], {
      encoding: "utf8",
      timeout: 30_000
    });
    return { action: "stopped", state };
  }

  return {
    inspect,
    start,
    restart,
    stop,
    label,
    target,
    root: resolvedRoot
  };
}

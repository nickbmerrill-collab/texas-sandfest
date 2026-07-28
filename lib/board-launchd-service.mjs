import { execFile } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const BOARD_LAUNCHD_LABEL = "com.heyelab.sandfest.board";

const execFileAsync = promisify(execFile);

function validLabel(value) {
  return /^[A-Za-z0-9.-]+$/.test(String(value || ""));
}

function requiredAbsolutePath(value, label) {
  if (!String(value || "").trim()) throw new Error(`${label} is required.`);
  const candidate = String(value);
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must be absolute.`);
  return path.resolve(candidate);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

export function boardLaunchdDomain({ uid = process.getuid?.() } = {}) {
  if (!Number.isInteger(uid) || uid < 1) throw new Error("A valid macOS user ID is required.");
  return `gui/${uid}`;
}

export function boardLaunchdTarget({ uid = process.getuid?.(), label = BOARD_LAUNCHD_LABEL } = {}) {
  if (!validLabel(label)) throw new Error("The board launchd label is invalid.");
  return `${boardLaunchdDomain({ uid })}/${label}`;
}

export function boardLaunchAgentPath({
  homeDir = os.homedir(),
  label = BOARD_LAUNCHD_LABEL
} = {}) {
  if (!validLabel(label)) throw new Error("The board launchd label is invalid.");
  return path.join(requiredAbsolutePath(homeDir, "The user home directory"), "Library", "LaunchAgents", `${label}.plist`);
}

export function boardLaunchdCommand({
  root,
  npmPath,
  logPath = path.join(root, ".sandfest-runtime", "board-demo-supervisor.log"),
  redirect = true
}) {
  const resolvedRoot = requiredAbsolutePath(root, "The board checkout");
  const resolvedNpm = requiredAbsolutePath(npmPath, "The npm executable");
  const resolvedLog = requiredAbsolutePath(logPath, "The board service log");
  const command = `mkdir -p ${shellQuote(path.dirname(resolvedLog))} && cd ${shellQuote(resolvedRoot)} && exec ${shellQuote(resolvedNpm)} run board:demo -- --reset`;
  return redirect ? `${command} >> ${shellQuote(resolvedLog)} 2>&1` : command;
}

export function boardLaunchAgentPlist({
  root,
  npmPath,
  logPath = path.join(root, ".sandfest-runtime", "board-demo-supervisor.log"),
  label = BOARD_LAUNCHD_LABEL
}) {
  if (!validLabel(label)) throw new Error("The board launchd label is invalid.");
  const resolvedRoot = requiredAbsolutePath(root, "The board checkout");
  const resolvedLog = requiredAbsolutePath(logPath, "The board service log");
  const command = boardLaunchdCommand({
    root: resolvedRoot,
    npmPath,
    logPath: resolvedLog,
    redirect: false
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(resolvedRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(resolvedLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(resolvedLog)}</string>
</dict>
</plist>
`;
}

export function assessBoardLaunchdOwnership(output, {
  root,
  label = BOARD_LAUNCHD_LABEL
}) {
  const text = String(output || "");
  const resolvedRoot = requiredAbsolutePath(root, "The board checkout");
  const markers = [label, "board:demo", "--reset"];
  const missing = markers.filter(marker => !text.includes(marker));
  if (!text.includes(resolvedRoot) && !text.includes(xmlEscape(resolvedRoot))) {
    missing.push(resolvedRoot);
  }
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

export function boardLaunchdPresentationSafety(service) {
  if (!service?.supported) {
    return { ok: false, reason: "The persistent board service is not supported on this host." };
  }
  if ((service.installed || service.configured) && service.owned !== true) {
    return { ok: false, reason: "The board service is not fully owned by this checkout." };
  }
  if (!service.installed || !service.configured || !service.persistent) {
    return { ok: false, reason: "The board service is not running from its persistent LaunchAgent." };
  }
  return { ok: true, reason: null };
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivateFileAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export function createBoardLaunchdController({
  root,
  uid = process.getuid?.(),
  platform = process.platform,
  homeDir = os.homedir(),
  label = BOARD_LAUNCHD_LABEL,
  runFile = execFileAsync,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  npmPath = null,
  logPath = null
}) {
  const resolvedRoot = requiredAbsolutePath(root, "The board checkout");
  const resolvedLog = requiredAbsolutePath(
    logPath || path.join(resolvedRoot, ".sandfest-runtime", "board-demo-supervisor.log"),
    "The board service log"
  );
  const domain = boardLaunchdDomain({ uid });
  const target = boardLaunchdTarget({ uid, label });
  const plistPath = boardLaunchAgentPath({ homeDir, label });

  async function loadedState() {
    try {
      const { stdout = "" } = await runFile("launchctl", ["print", target], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 10_000
      });
      const output = String(stdout);
      const ownership = assessBoardLaunchdOwnership(output, { root: resolvedRoot, label });
      return {
        installed: true,
        output,
        persistent: output.includes(plistPath),
        ...ownership
      };
    } catch (error) {
      if (!launchctlServiceMissing(error)) throw error;
      return {
        installed: false,
        output: "",
        persistent: false,
        owned: false,
        missing: [],
        detail: `Launchd job ${label} is not loaded.`
      };
    }
  }

  async function configuredState() {
    const output = await readOptionalFile(plistPath);
    if (output === null) {
      return {
        configured: false,
        configOwned: false,
        configOutput: "",
        configDetail: `LaunchAgent ${plistPath} is not installed.`
      };
    }
    const ownership = assessBoardLaunchdOwnership(output, { root: resolvedRoot, label });
    return {
      configured: true,
      configOwned: ownership.owned,
      configOutput: output,
      configDetail: ownership.owned
        ? `LaunchAgent ${plistPath} is owned by this checkout.`
        : `LaunchAgent ${plistPath} belongs to another checkout.`
    };
  }

  async function inspect() {
    if (platform !== "darwin") {
      return {
        supported: false,
        installed: false,
        configured: false,
        persistent: false,
        owned: false,
        label,
        domain,
        target,
        plistPath,
        detail: "The board launchd service is available only on macOS."
      };
    }
    const [loaded, configured] = await Promise.all([loadedState(), configuredState()]);
    const owned = (!loaded.installed || loaded.owned)
      && (!configured.configured || configured.configOwned);
    return {
      supported: true,
      label,
      domain,
      target,
      plistPath,
      ...loaded,
      ...configured,
      owned,
      persistent: loaded.installed && configured.configured && loaded.persistent,
      detail: !owned
        ? `Launchd service ${label} is not fully owned by ${resolvedRoot}.`
        : loaded.installed
          ? loaded.persistent
            ? `LaunchAgent ${label} is loaded from ${plistPath}.`
            : `Launchd job ${label} is running from a session-scoped submission.`
          : configured.configured
            ? `LaunchAgent ${label} is installed but not loaded.`
            : `LaunchAgent ${label} is not installed.`
    };
  }

  async function requireOwned() {
    const state = await inspect();
    if (!state.supported) throw new Error(state.detail);
    if ((state.installed || state.configured) && !state.owned) {
      throw new Error(`Refusing to control ${label}; the existing service is not owned by ${resolvedRoot}.`);
    }
    return state;
  }

  async function resolvedNpmPath() {
    if (npmPath) return requiredAbsolutePath(npmPath, "The npm executable");
    const { stdout = "" } = await runFile("which", ["npm"], {
      encoding: "utf8",
      timeout: 10_000
    });
    return requiredAbsolutePath(String(stdout).trim(), "The npm executable");
  }

  async function ensureConfiguration(state) {
    const contents = boardLaunchAgentPlist({
      root: resolvedRoot,
      npmPath: await resolvedNpmPath(),
      logPath: resolvedLog,
      label
    });
    if (state.configured && state.configOutput === contents) {
      return { changed: false, contents };
    }
    await writePrivateFileAtomic(plistPath, contents);
    return { changed: true, contents };
  }

  async function bootoutLoaded(state) {
    if (!state.installed) return false;
    await runFile("launchctl", ["bootout", target], {
      encoding: "utf8",
      timeout: 30_000
    });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (!(await loadedState()).installed) return true;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for launchd to remove ${label} after bootout.`);
  }

  async function bootstrap() {
    await runFile("launchctl", ["bootstrap", domain, plistPath], {
      encoding: "utf8",
      timeout: 30_000
    });
  }

  async function start() {
    const state = await requireOwned();
    const configuration = await ensureConfiguration(state);
    if (state.persistent && !configuration.changed) {
      return { action: "already_running", state };
    }
    await bootoutLoaded(state);
    await bootstrap();
    return {
      action: state.installed
        ? state.persistent ? "reconfigured" : "migrated"
        : "started",
      plistPath
    };
  }

  async function restart() {
    const state = await requireOwned();
    const configuration = await ensureConfiguration(state);
    if (state.persistent && !configuration.changed) {
      await runFile("launchctl", ["kickstart", "-k", target], {
        encoding: "utf8",
        timeout: 30_000
      });
      return { action: "restarted", state };
    }
    await bootoutLoaded(state);
    await bootstrap();
    return {
      action: state.installed
        ? state.persistent ? "reconfigured" : "migrated"
        : "started",
      plistPath
    };
  }

  async function stop() {
    const state = await requireOwned();
    if (!state.installed) return { action: "not_running", state };
    await bootoutLoaded(state);
    return { action: "stopped", state };
  }

  async function uninstall() {
    const state = await requireOwned();
    await bootoutLoaded(state);
    if (state.configured) await unlink(plistPath);
    return {
      action: state.installed || state.configured ? "uninstalled" : "not_installed",
      state
    };
  }

  return {
    inspect,
    start,
    restart,
    stop,
    uninstall,
    label,
    domain,
    target,
    plistPath,
    root: resolvedRoot
  };
}

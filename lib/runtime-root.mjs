import path from "node:path";

export function resolveRuntimeRoot(codeRoot, env = process.env) {
  const base = path.resolve(codeRoot);
  const configured = String(env.SANDFEST_RUNTIME_ROOT || "").trim();
  return configured ? path.resolve(base, configured) : base;
}

export function runtimeRootProfile(codeRoot, runtimeRoot) {
  const code = path.resolve(codeRoot);
  const runtime = path.resolve(runtimeRoot);
  return {
    isolated: code !== runtime,
    mode: code === runtime ? "repository" : "isolated"
  };
}

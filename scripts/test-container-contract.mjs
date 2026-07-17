import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCKERFILE_PATH = path.join(ROOT, "Dockerfile");
const DOCKERIGNORE_PATH = path.join(ROOT, ".dockerignore");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const ENTRYPOINTS = [
  "scripts/admin-api-server.mjs",
  "scripts/worker.mjs"
];

const [dockerfile, dockerignore, packageSource] = await Promise.all([
  readFile(DOCKERFILE_PATH, "utf8"),
  readFile(DOCKERIGNORE_PATH, "utf8"),
  readFile(PACKAGE_PATH, "utf8")
]);
const packageJson = JSON.parse(packageSource);
const productionDependencies = new Set(Object.keys(packageJson.dependencies || {}));
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

let passed = 0;
const failures = [];

function check(name, predicate, detail = "") {
  if (predicate) {
    passed += 1;
    console.log(`  ok ${name}`);
    return;
  }
  failures.push(detail ? `${name}: ${detail}` : name);
  console.error(`  not ok ${name}${detail ? ` - ${detail}` : ""}`);
}

function normalizedLines(source) {
  return source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

function importSpecifiers(source) {
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  const specifiers = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

async function runtimeImportClosure() {
  const pending = ENTRYPOINTS.map(relativePath => path.join(ROOT, relativePath));
  const visited = new Set();
  const packages = new Set();
  const outsideRuntimeTree = [];
  const unanalyzableImports = [];

  while (pending.length) {
    const absolutePath = pending.pop();
    const relativePath = path.relative(ROOT, absolutePath);
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);

    const source = await readFile(absolutePath, "utf8");
    const sourceWithoutLiteralDynamicImports = source.replace(
      /\bimport\s*\(\s*["'][^"']+["']\s*\)/g,
      ""
    );
    if (/\bimport\s*\(/.test(sourceWithoutLiteralDynamicImports)) {
      unanalyzableImports.push(`${relativePath}: computed import()`);
    }
    if (/\brequire\s*\(/.test(source)) {
      unanalyzableImports.push(`${relativePath}: require()`);
    }
    for (const specifier of importSpecifiers(source)) {
      if (builtins.has(specifier) || specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        packages.add(packageName(specifier));
        continue;
      }

      const importedPath = path.resolve(path.dirname(absolutePath), specifier);
      const importedRelativePath = path.relative(ROOT, importedPath);
      if (importedRelativePath.startsWith("..") || path.isAbsolute(importedRelativePath)) {
        outsideRuntimeTree.push(`${relativePath} -> ${specifier}`);
        continue;
      }
      if (!importedRelativePath.startsWith("lib/") && !importedRelativePath.startsWith("scripts/")) {
        outsideRuntimeTree.push(`${relativePath} -> ${specifier}`);
        continue;
      }
      pending.push(importedPath);
    }
  }

  return {
    files: [...visited].sort(),
    outsideRuntimeTree,
    packages: [...packages].sort(),
    unanalyzableImports
  };
}

console.log("\n=== Production container contract ===\n");

const dockerLines = normalizedLines(dockerfile);
const fromLines = dockerLines.filter(line => /^FROM\s+/i.test(line));
const runtimeStart = dockerLines.findIndex(line => /^FROM\s+node:20-alpine\s+AS\s+runtime$/i.test(line));
const runtimeLines = runtimeStart >= 0 ? dockerLines.slice(runtimeStart + 1) : [];
const runtimeCopyLines = runtimeLines.filter(line => /^COPY\s+/i.test(line));
const allowedRuntimeCopies = new Set([
  "COPY --from=deps --chown=node:node /app/node_modules ./node_modules",
  "COPY --chown=node:node package.json ./",
  "COPY --chown=node:node scripts ./scripts",
  "COPY --chown=node:node lib ./lib",
  "COPY --chown=node:node data ./data"
]);

check(
  "dependency and runtime stages use the pinned Node major",
  fromLines.length === 2
    && /^FROM\s+node:20-alpine\s+AS\s+deps$/i.test(fromLines[0])
    && /^FROM\s+node:20-alpine\s+AS\s+runtime$/i.test(fromLines[1])
);
check("lockfile is mandatory in the dependency stage", dockerLines.includes("COPY package.json package-lock.json ./"));
check("production dependencies use a frozen install", dockerLines.includes("RUN npm ci --omit=dev"));
check("dependency install has no mutable fallback", !/\|\||\bnpm\s+install\b/.test(dockerfile));
check(
  "runtime defaults to production",
  /ENV\s+NODE_ENV=production\s+\\\s*SANDFEST_ENV=production\s+\\/m.test(dockerfile)
);
check("runtime drops root privileges", runtimeLines.includes("USER node"));
check("runtime exposes only the API port", runtimeLines.includes("EXPOSE 8788"));
check("runtime starts the API entrypoint", runtimeLines.includes('CMD ["node", "scripts/admin-api-server.mjs"]'));
check(
  "runtime copies only declared application inputs",
  runtimeCopyLines.length === allowedRuntimeCopies.size
    && runtimeCopyLines.every(line => allowedRuntimeCopies.has(line)),
  runtimeCopyLines.join(", ")
);

const ignoreLines = new Set(normalizedLines(dockerignore));
for (const pattern of [
  ".git",
  ".env",
  ".env.*",
  "node_modules",
  "data/incoming",
  "data/raw",
  "data/processed/documents",
  "data/processed/job-queue",
  "data/processed/partner-assets",
  "**/*credential*",
  "**/*secret*",
  "**/*.pem",
  "**/*.key"
]) {
  check(`build context excludes ${pattern}`, ignoreLines.has(pattern));
}

const closure = await runtimeImportClosure();
check(
  "runtime imports stay inside copied source trees",
  closure.outsideRuntimeTree.length === 0,
  closure.outsideRuntimeTree.join(", ")
);
check(
  "runtime imports are statically analyzable",
  closure.unanalyzableImports.length === 0,
  closure.unanalyzableImports.join(", ")
);
const undeclaredPackages = closure.packages.filter(name => !productionDependencies.has(name));
check(
  "runtime packages are production dependencies",
  undeclaredPackages.length === 0,
  undeclaredPackages.join(", ")
);
check("both production entrypoints are covered", ENTRYPOINTS.every(entrypoint => closure.files.includes(entrypoint)));

console.log(`\nContainer import closure: ${closure.files.length} modules, ${closure.packages.length} packages.`);
console.log(`Container contract: ${passed} passed, ${failures.length} failed.`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

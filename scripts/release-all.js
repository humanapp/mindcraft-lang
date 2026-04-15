#!/usr/bin/env node

// Bulk release script for all @mindcraft-lang packages under packages/.
//
// Usage: node scripts/release-all.js <patch|minor|major> [--skip-checks]
//
// Run from any directory (cwd is not significant; paths are derived from the
// script's own location). Discovers all public @mindcraft-lang/* packages in
// packages/, resolves their full topological order from file: dependencies,
// then releases each package in order.
//
// Flags:
//   --skip-checks  Skip the pre-release build + lint step for each package.
//
// Per-package steps (same as release.js):
//   1. Optionally runs build and check:only
//   2. Bumps the version in package.json
//   3. Commits package.json and package-lock.json with message "<prefix><version>"
//   4. Tags the commit as "<prefix><version>"
//   5. Pushes the commit and tag to origin
//   6. Waits for the GitHub Actions publish workflow to succeed

const { execSync } = require("node:child_process");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const { join, resolve, dirname } = require("node:path");

const VALID_BUMPS = ["patch", "minor", "major"];
const SCOPE = "@mindcraft-lang/";

function readPkgAt(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

function runQuiet(cmd, cwd) {
  return execSync(cmd, { encoding: "utf8", cwd }).trim();
}

function shortNameOf(pkg) {
  return pkg.name.startsWith(SCOPE) ? pkg.name.replace(SCOPE, "") : pkg.name;
}

function preReleaseChecks(pkgDir) {
  const pkg = readPkgAt(pkgDir);
  const scripts = pkg.scripts || {};
  if (scripts.build) {
    run("npm run build", pkgDir);
  }
  if (scripts["check:only"]) {
    run("npm run check:only", pkgDir);
  }
}

function waitForWorkflow(tag, repoDir) {
  try {
    runQuiet("which gh", repoDir);
  } catch {
    console.error(
      "Error: GitHub CLI (gh) is required to wait for CI workflows.\n"
        + "Install it with: brew install gh"
    );
    process.exit(1);
  }

  console.log(`[${tag}] Waiting for CI workflow...`);

  let runId;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      runId = runQuiet(
        `gh run list --branch "${tag}" --limit 1 --json databaseId --jq ".[0].databaseId"`,
        repoDir
      );
      if (runId && runId !== "null") break;
    } catch {
      // ignore
    }
    runId = undefined;
    execSync("sleep 5");
  }

  if (!runId) {
    console.error(`Error: could not find a workflow run for tag ${tag} after 150s.`);
    process.exit(1);
  }

  try {
    run(`gh run watch ${runId} --exit-status`, repoDir);
  } catch {
    console.error(`Error: CI workflow for ${tag} failed. Aborting.`);
    process.exit(1);
  }
  console.log(`[${tag}] Workflow succeeded.`);
}

// Discover all public @mindcraft-lang/* packages under packagesDir.
function discoverPackages(packagesDir) {
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const pkgDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (pkg.private) continue;
    if (!pkg.name || !pkg.name.startsWith(SCOPE)) continue;
    pkgDirs.push(resolve(packagesDir, entry.name));
  }
  return pkgDirs;
}

// Build a full topological release order for the given package directories.
// Packages with no dependencies come first; dependents come after their deps.
function topoSort(pkgDirs) {
  const dirSet = new Set(pkgDirs);
  const inDegree = new Map();
  const dependents = new Map();

  for (const dir of dirSet) {
    inDegree.set(dir, 0);
    dependents.set(dir, []);
  }

  for (const dir of dirSet) {
    const pkg = readPkgAt(dir);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const seen = new Set();
    for (const val of Object.values(allDeps)) {
      if (!val.startsWith("file:")) continue;
      const depDir = resolve(dir, val.slice(5));
      if (!dirSet.has(depDir)) continue;
      if (seen.has(depDir)) continue;
      seen.add(depDir);
      inDegree.set(dir, inDegree.get(dir) + 1);
      dependents.get(depDir).push(dir);
    }
  }

  const queue = [...dirSet].filter((d) => inDegree.get(d) === 0);
  const order = [];
  while (queue.length > 0) {
    const dir = queue.shift();
    order.push(dir);
    for (const dependent of dependents.get(dir)) {
      const deg = inDegree.get(dependent) - 1;
      inDegree.set(dependent, deg);
      if (deg === 0) queue.push(dependent);
    }
  }

  if (order.length !== dirSet.size) {
    console.error("Error: cycle detected in package dependency graph.");
    process.exit(1);
  }

  return order;
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const skipChecks = args.includes("--skip-checks");
const bump = args.find((a) => !a.startsWith("--"));

if (!bump || !VALID_BUMPS.includes(bump)) {
  console.error(`Usage: node scripts/release-all.js <${VALID_BUMPS.join("|")}> [--skip-checks]`);
  process.exit(1);
}

const scriptDir = dirname(resolve(process.argv[1]));
const repoDir = resolve(scriptDir, "..");
const packagesDir = join(repoDir, "packages");

// Check for uncommitted changes
try {
  execSync("git diff --quiet && git diff --cached --quiet", { cwd: repoDir });
} catch {
  console.error("Error: working tree has uncommitted changes. Commit or stash them first.");
  process.exit(1);
}

const pkgDirs = discoverPackages(packagesDir);
const releaseOrder = topoSort(pkgDirs);
const names = releaseOrder.map((d) => shortNameOf(readPkgAt(d)));
console.log(`Release order: ${names.join(" -> ")}\n`);

const tags = [];

for (const dir of releaseOrder) {
  const pkg = readPkgAt(dir);
  const name = shortNameOf(pkg);
  const tagPrefix = `${name}-v`;

  console.log(`\n--- ${pkg.name} ---`);

  if (!skipChecks) {
    preReleaseChecks(dir);
  }

  run(`npm version ${bump} --git-tag-version=false`, dir);

  const newVersion = readPkgAt(dir).version;
  const tag = `${tagPrefix}${newVersion}`;

  run("git add package.json package-lock.json", dir);
  run(`git commit -m "${tag}"`, dir);
  run(`git tag ${tag}`, dir);
  run("git push", dir);
  run("git push --tags", dir);

  tags.push(tag);

  waitForWorkflow(tag, repoDir);
}

console.log(`\nReleased: ${tags.join(", ")}`);

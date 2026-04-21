#!/usr/bin/env node

// Shared release script for @mindcraft-lang packages.
//
// Usage: node scripts/release.js <patch|minor|major> [--skip-deps]
//
// Run from a package directory (or via the package's npm release:* scripts).
// Walks the file: dependency tree, releasing upstream packages first in
// topological order and waiting for each CI workflow to succeed before
// proceeding. Private packages are skipped.
//
// Flags:
//   --skip-deps  Skip releasing upstream dependencies. Only bump, tag, and
//                push the current package. Useful for bundled apps like sim
//                whose dependencies do not need to be published to npm.
//
// Per-package steps:
//   1. Runs the package's pre-release checks (build, lint)
//   2. Bumps the version in package.json
//   3. Commits package.json and package-lock.json with message "<prefix><version>"
//   4. Tags the commit as "<prefix><version>"
//   5. Pushes the commit and tag to origin
//   6. Waits for the GitHub Actions publish workflow to succeed
//
// file: dependencies are rewritten to version ranges by the CI publish workflow
// before running npm publish. They are never rewritten in committed files.

const { execSync } = require("node:child_process");
const { readFileSync, existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

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

// Collect the topological release order for a package directory.
// Only includes public @mindcraft-lang/* file: dependencies.
function collectReleaseDeps(pkgDir, visited, order, isRoot) {
  const realDir = resolve(pkgDir);
  if (visited.has(realDir)) return;
  visited.add(realDir);

  const pkg = readPkgAt(realDir);
  if (!isRoot && pkg.private) return;
  if (!pkg.name) return;
  if (!isRoot && !pkg.name.startsWith(SCOPE)) return;

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  for (const [name, val] of Object.entries(allDeps)) {
    if (!val.startsWith("file:")) continue;
    if (!name.startsWith(SCOPE)) continue;
    const depDir = resolve(realDir, val.slice(5));
    if (!existsSync(join(depDir, "package.json"))) continue;
    const depPkg = readPkgAt(depDir);
    if (depPkg.private) continue;
    collectReleaseDeps(depDir, visited, order, false);
  }

  order.push(realDir);
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

  // Poll until the workflow run for this tag appears (may take a few seconds)
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

  // gh run watch exits non-zero if the run fails
  try {
    run(`gh run watch ${runId} --exit-status`, repoDir);
  } catch {
    console.error(`Error: CI workflow for ${tag} failed. Aborting.`);
    process.exit(1);
  }
  console.log(`[${tag}] Workflow succeeded.`);
}

// ---------------------------------------------------------------------------

const pkgDir = process.cwd();
const repoDir = resolve(pkgDir, runQuiet("git rev-parse --show-cdup", pkgDir) || ".");

const args = process.argv.slice(2);
const skipDeps = args.includes("--skip-deps");
const bump = args.find((a) => !a.startsWith("--"));
if (!bump || !VALID_BUMPS.includes(bump)) {
  console.error(`Usage: node scripts/release.js <${VALID_BUMPS.join("|")}> [--skip-deps]`);
  process.exit(1);
}

// Check for uncommitted changes
try {
  execSync("git diff --quiet && git diff --cached --quiet", { cwd: repoDir });
} catch {
  console.error("Error: working tree has uncommitted changes. Commit or stash them first.");
  process.exit(1);
}

// Build topological release order
const visited = new Set();
const releaseOrder = [];
collectReleaseDeps(pkgDir, visited, releaseOrder, true);

if (releaseOrder.length === 0) {
  console.error("Error: no releasable package found.");
  process.exit(1);
}

// With --skip-deps, only release the root package (last in topological order).
if (skipDeps && releaseOrder.length > 1) {
  releaseOrder.splice(0, releaseOrder.length - 1);
}

const isMulti = releaseOrder.length > 1;
if (isMulti) {
  const names = releaseOrder.map((d) => shortNameOf(readPkgAt(d)));
  console.log(`Release order: ${names.join(" -> ")}\n`);
}

const tags = [];

for (const dir of releaseOrder) {
  const pkg = readPkgAt(dir);
  const name = shortNameOf(pkg);
  const tagPrefix = `${name}-v`;
  const isTarget = dir === releaseOrder[releaseOrder.length - 1];
  const effectiveBump = isTarget ? bump : "patch";

  console.log(`\n--- ${pkg.name} ---`);

  // Pre-release checks (build + lint)
  preReleaseChecks(dir);

  // Bump version
  run(`npm version ${effectiveBump} --git-tag-version=false`, dir);

  const newVersion = readPkgAt(dir).version;
  const tag = `${tagPrefix}${newVersion}`;

  run("git add package.json package-lock.json", dir);
  run(`git commit -m "${tag}"`, dir);
  run(`git tag ${tag}`, dir);
  run("git push", dir);
  run("git push --tags", dir);

  tags.push(tag);

  // Wait for CI on dependency packages before releasing the next one.
  // For the final (target) package we still wait so the user sees the result.
  waitForWorkflow(tag, repoDir);
}

console.log(`\nReleased: ${tags.join(", ")}`);

#!/usr/bin/env node

// Release the packages under packages/ that a release must include.
//
// Usage: node scripts/release-all.js <patch|minor|major> [--dry-run] [--skip-checks]
//
// Run from any directory (cwd is not significant; paths are derived from the
// script's own location). Discovers every publishable package in packages/,
// resolves their full topological order from file: dependencies, derives which
// of them the release includes, then releases each member in that order.
//
// A release includes a package when:
//
//   - it has no release tag, having never been published;
//   - its directory differs between its latest release tag and HEAD;
//   - a dependency it declares is being released to a version the caret range
//     published for it does not admit.
//
// The bump level applies to every member.
//
// Flags:
//   --dry-run      Print the derived set, the reason for each member, and the
//                  release order, then exit without changing anything.
//   --skip-checks  Skip the pre-release build + lint step for each package.
//
// Per-package steps (same as release.js):
//   1. Optionally runs build and check:only
//   2. Bumps the version in package.json
//   3. Commits package.json and package-lock.json with message "<prefix><version>"
//   4. Tags the commit carrying the bump as "<prefix><version>"
//   5. Pushes the commit and tag to origin
//   6. Waits for the GitHub Actions publish workflow to succeed

const { execSync } = require("node:child_process");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const { join, resolve, relative, dirname } = require("node:path");

const VALID_BUMPS = ["patch", "minor", "major"];
const SCOPE = "@mindcraft-lang/";

/** Prefix of a dependency specifier naming a package by its location on disk. */
const localSpecifier = "file:";

/** Width the package-name column of the plan is padded to. */
const nameColumn = 34;

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
      "Error: GitHub CLI (gh) is required to wait for CI workflows.\n" + "Install it with: brew install gh"
    );
    process.exit(1);
  }

  console.log(`[${tag}] Waiting for CI workflow...`);

  let runId;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      runId = runQuiet(`gh run list --branch "${tag}" --limit 1 --json databaseId --jq ".[0].databaseId"`, repoDir);
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

// Discover the publishable packages under packagesDir: every directory holding
// a package.json that names the package and is not private.
function discoverPackages(packagesDir) {
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const pkgDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    if (pkg.private) continue;
    if (!pkg.name) continue;
    pkgDirs.push(resolve(packagesDir, entry.name));
  }
  return pkgDirs;
}

// The directories of the local packages `pkg` declares in `dependencies`,
// resolved from `dir`.
function localRuntimeDependencies(dir, pkg) {
  const found = [];
  for (const [name, specifier] of Object.entries(pkg.dependencies || {})) {
    if (typeof specifier !== "string" || !specifier.startsWith(localSpecifier)) continue;
    found.push({ name, dir: resolve(dir, specifier.slice(localSpecifier.length)) });
  }
  return found;
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
      if (!val.startsWith(localSpecifier)) continue;
      const depDir = resolve(dir, val.slice(localSpecifier.length));
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

/** `text` as major, minor and patch numbers, or undefined when it is not `X.Y.Z`. */
function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Negative when `a` precedes `b`, positive when it follows, zero when equal. */
function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The version `npm version <bump>` produces from `version`. */
function bumpedVersion(version, bump) {
  if (bump === "major") return { major: version.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

/**
 * Whether the range `^from` admits `to`. A caret range is bounded by the
 * leftmost non-zero component of `from`, so on a `0.x` version a minor bump
 * already leaves the range and on a `0.0.x` version so does a patch bump.
 */
function caretAdmits(from, to) {
  if (compareVersions(to, from) < 0) return false;
  if (from.major !== 0) return to.major === from.major;
  if (from.minor !== 0) return to.major === 0 && to.minor === from.minor;
  return to.major === 0 && to.minor === 0 && to.patch === from.patch;
}

/**
 * The release tags the repository holds for `pkg`, highest version first. A tag
 * whose suffix is not an `X.Y.Z` version is ignored.
 */
function releaseTags(pkg, repoDir) {
  const prefix = `${shortNameOf(pkg)}-v`;
  const found = [];
  for (const line of runQuiet(`git tag --list "${prefix}*"`, repoDir).split("\n")) {
    const name = line.trim();
    if (name.length === 0) continue;
    const version = parseVersion(name.slice(prefix.length));
    if (version) found.push({ name, version });
  }
  found.sort((a, b) => compareVersions(b.version, a.version));
  return found;
}

/** Whether the tracked content of `dir` differs between `tag` and HEAD. */
function changedSinceTag(tag, dir, repoDir) {
  const path = relative(repoDir, dir);
  return runQuiet(`git diff --name-only ${tag} HEAD -- "${path}"`, repoDir).length > 0;
}

/**
 * The version of the package at `depDir` recorded in the tree `tag` names.
 * Undefined when that version is not `X.Y.Z`.
 */
function versionPublishedAgainst(tag, depDir, repoDir) {
  const path = relative(repoDir, depDir);
  return parseVersion(JSON.parse(runQuiet(`git show ${tag}:${path}/package.json`, repoDir)).version);
}

/**
 * Why the package at `dir`, published at `tag` and otherwise unchanged, must be
 * released anyway: a dependency in `members` is going to a version the range
 * published for it does not admit. Undefined when every released dependency
 * stays inside its range.
 */
function escapingDependency(dir, pkg, tag, members, bump, repoDir) {
  for (const dependency of localRuntimeDependencies(dir, pkg)) {
    if (!members.has(dependency.dir)) continue;
    const published = versionPublishedAgainst(tag, dependency.dir, repoDir);
    const releasing = bumpedVersion(parseVersion(readPkgAt(dependency.dir).version), bump);
    if (caretAdmits(published, releasing)) continue;
    return (
      `cascade-from ${dependency.name} ` +
      `(${formatVersion(releasing)} outside its published ^${formatVersion(published)})`
    );
  }
  return undefined;
}

/**
 * Which of `order` the release includes and why. `order` must run dependencies
 * before dependents.
 *
 * Returns the members as a map from directory to the reason it is in, and the
 * latest release tag of every package that has one.
 */
function deriveReleaseSet(order, bump, repoDir) {
  const members = new Map();
  const latestTag = new Map();

  for (const dir of order) {
    const pkg = readPkgAt(dir);
    const tags = releaseTags(pkg, repoDir);
    if (tags.length === 0) {
      members.set(dir, "never-published");
      continue;
    }
    const tag = tags[0].name;
    latestTag.set(dir, tag);
    if (changedSinceTag(tag, dir, repoDir)) {
      members.set(dir, `changed-since ${tag}`);
      continue;
    }
    const cascade = escapingDependency(dir, pkg, tag, members, bump, repoDir);
    if (cascade) members.set(dir, cascade);
  }

  return { members, latestTag };
}

/** Print every candidate package, whether the release includes it, and why. */
function printPlan(order, members, latestTag, bump) {
  console.log(`Bump: ${bump}`);
  console.log("Membership: each package directory at its own latest release tag, compared with HEAD.\n");
  for (const dir of order) {
    const pkg = readPkgAt(dir);
    const reason = members.get(dir);
    const marker = reason ? "release" : "hold   ";
    const detail = reason ?? `unchanged since ${latestTag.get(dir)}`;
    console.log(`  ${marker}  ${pkg.name.padEnd(nameColumn)}${detail}`);
  }
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipChecks = args.includes("--skip-checks");
const bump = args.find((a) => !a.startsWith("--"));

if (!bump || !VALID_BUMPS.includes(bump)) {
  console.error(`Usage: node scripts/release-all.js <${VALID_BUMPS.join("|")}> [--dry-run] [--skip-checks]`);
  process.exit(1);
}

const scriptDir = dirname(resolve(process.argv[1]));
const repoDir = resolve(scriptDir, "..");
const packagesDir = join(repoDir, "packages");

// Check for uncommitted changes
if (!dryRun) {
  try {
    execSync("git diff --quiet && git diff --cached --quiet", { cwd: repoDir });
  } catch {
    console.error("Error: working tree has uncommitted changes. Commit or stash them first.");
    process.exit(1);
  }
}

const pkgDirs = discoverPackages(packagesDir);
const order = topoSort(pkgDirs);

if (dryRun && runQuiet("git status --porcelain", repoDir).length > 0) {
  console.log("Note: the working tree has uncommitted changes. HEAD is the comparison point; they do not count.\n");
}

const { members, latestTag } = deriveReleaseSet(order, bump, repoDir);
const releaseOrder = order.filter((dir) => members.has(dir));

printPlan(order, members, latestTag, bump);

if (releaseOrder.length === 0) {
  console.log("\nNothing to release: every package matches its latest release tag.");
  process.exit(0);
}

const names = releaseOrder.map((d) => shortNameOf(readPkgAt(d)));
console.log(`\nRelease order: ${names.join(" -> ")}`);

if (dryRun) {
  process.exit(0);
}

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

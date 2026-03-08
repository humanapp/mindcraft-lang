#!/usr/bin/env node

// Shared release script for @mindcraft-lang packages.
//
// Usage: node scripts/release.js <patch|minor|major>
//
// Run from a package directory (or via the package's npm release:* scripts).
// The tag prefix is derived from the package name (e.g. @mindcraft-lang/core -> core-v).
//
// Steps:
//   1. Bumps the version in package.json (no auto-commit/tag)
//   2. Commits package.json with message "<prefix><version>"
//   3. Tags the commit as "<prefix><version>"
//   4. Pushes the commit and tag to origin

const { execSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const VALID_BUMPS = ["patch", "minor", "major"];
const SCOPE = "@mindcraft-lang/";

const pkgDir = process.cwd();
const pkgPath = join(pkgDir, "package.json");
const packagesDir = resolve(pkgDir, "..");

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, "utf8"));
}

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: pkgDir });
}

// Sync @mindcraft-lang/* dependency versions to the actual versions in sibling packages.
function syncInternalDeps(pkg) {
  const deps = pkg.dependencies || {};
  let changed = false;
  for (const [name, range] of Object.entries(deps)) {
    if (!name.startsWith(SCOPE)) continue;
    const siblingName = name.replace(SCOPE, "");
    const siblingPkgPath = join(packagesDir, siblingName, "package.json");
    let siblingPkg;
    try {
      siblingPkg = JSON.parse(readFileSync(siblingPkgPath, "utf8"));
    } catch {
      continue; // not a local sibling
    }
    const wanted = `^${siblingPkg.version}`;
    if (range !== wanted) {
      console.log(`Updating ${name}: ${range} -> ${wanted}`);
      deps[name] = wanted;
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return changed;
}

const pkg = readPkg();
const shortName = pkg.name.replace(SCOPE, "");
const tagPrefix = `${shortName}-v`;

const bump = process.argv[2];
if (!VALID_BUMPS.includes(bump)) {
  console.error(`Usage: node scripts/release.js <${VALID_BUMPS.join("|")}>`);
  process.exit(1);
}

// Check for uncommitted changes (beyond what we are about to do)
try {
  execSync("git diff --quiet && git diff --cached --quiet", { cwd: pkgDir });
} catch {
  console.error("Error: working tree has uncommitted changes. Commit or stash them first.");
  process.exit(1);
}

syncInternalDeps(pkg);

run(`npm version ${bump} --git-tag-version=false`);

const version = readPkg().version;
const tag = `${tagPrefix}${version}`;

run("git add package.json package-lock.json");
run(`git commit -m "${tag}"`);
run(`git tag ${tag}`);
run("git push");
run("git push --tags");

console.log(`\nReleased ${tag}`);

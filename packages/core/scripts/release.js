#!/usr/bin/env node

// Release script for @mindcraft-lang/core
//
// Usage: node scripts/release.js <patch|minor|major>
//
// Steps:
//   1. Bumps the version in package.json (no auto-commit/tag)
//   2. Commits package.json with message "core-v<version>"
//   3. Tags the commit as "core-v<version>"
//   4. Pushes the commit and tag to origin

const { execSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const VALID_BUMPS = ["patch", "minor", "major"];
const TAG_PREFIX = "core-v";

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: `${__dirname}/..` });
}

function getVersion() {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
  return pkg.version;
}

const bump = process.argv[2];
if (!VALID_BUMPS.includes(bump)) {
  console.error(`Usage: node scripts/release.js <${VALID_BUMPS.join("|")}>`);
  process.exit(1);
}

// Check for uncommitted changes (beyond what we are about to do)
try {
  execSync("git diff --quiet && git diff --cached --quiet", {
    cwd: `${__dirname}/..`,
  });
} catch {
  console.error("Error: working tree has uncommitted changes. Commit or stash them first.");
  process.exit(1);
}

run(`npm version ${bump} --git-tag-version=false`);

const version = getVersion();
const tag = `${TAG_PREFIX}${version}`;

run("git add package.json");
run(`git commit -m "${tag}"`);
run(`git tag ${tag}`);
run("git push");
run("git push --tags");

console.log(`\nReleased ${tag}`);
